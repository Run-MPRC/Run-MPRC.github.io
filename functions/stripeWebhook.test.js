const crypto = require('crypto');

jest.mock('firebase-admin', () => {
  const store = new Map();

  const FieldValue = {
    arrayUnion: (...values) => ({ __op: 'arrayUnion', values }),
  };

  function getField(data, fieldPath) {
    return fieldPath.split('.').reduce((value, key) => value?.[key], data);
  }

  function applyPatch(current, patch, replace = false) {
    const next = replace ? {} : { ...(current || {}) };
    Object.entries(patch).forEach(([key, value]) => {
      if (value?.__op === 'arrayUnion') {
        const existing = Array.isArray(next[key]) ? next[key] : [];
        next[key] = [...existing, ...value.values];
      } else {
        next[key] = value;
      }
    });
    return next;
  }

  class FakeDocumentSnapshot {
    constructor(ref) {
      this.ref = ref;
      this.id = ref.id;
      this.exists = store.has(ref.path);
    }

    data() {
      return store.get(this.ref.path);
    }
  }

  class FakeDocumentReference {
    constructor(path) {
      this.path = path;
      this.id = path.split('/').at(-1);
    }

    collection(name) {
      return new FakeCollectionReference(`${this.path}/${name}`);
    }

    async get() {
      return new FakeDocumentSnapshot(this);
    }

    async set(data) {
      store.set(this.path, applyPatch(null, data, true));
    }

    async update(patch) {
      if (!store.has(this.path)) throw new Error(`Missing document: ${this.path}`);
      store.set(this.path, applyPatch(store.get(this.path), patch));
    }
  }

  class FakeQuery {
    constructor({ collectionPath = null, collectionGroup = null, filters = [], max = null }) {
      this.collectionPath = collectionPath;
      this.collectionGroup = collectionGroup;
      this.filters = filters;
      this.max = max;
    }

    where(field, operator, value) {
      if (operator !== '==') throw new Error(`Unsupported operator: ${operator}`);
      return new FakeQuery({
        collectionPath: this.collectionPath,
        collectionGroup: this.collectionGroup,
        filters: [...this.filters, { field, value }],
        max: this.max,
      });
    }

    limit(max) {
      return new FakeQuery({
        collectionPath: this.collectionPath,
        collectionGroup: this.collectionGroup,
        filters: this.filters,
        max,
      });
    }

    async get() {
      let docs = Array.from(store.keys()).filter((path) => {
        const parts = path.split('/');
        if (this.collectionGroup) {
          return parts.length >= 2 && parts.at(-2) === this.collectionGroup;
        }
        const collectionParts = this.collectionPath.split('/');
        return parts.length === collectionParts.length + 1
          && path.startsWith(`${this.collectionPath}/`);
      }).map((path) => new FakeDocumentSnapshot(new FakeDocumentReference(path)));

      docs = docs.filter((doc) => this.filters.every(({ field, value }) => (
        getField(doc.data(), field) === value
      )));
      if (this.max !== null) docs = docs.slice(0, this.max);
      return { empty: docs.length === 0, docs, size: docs.length };
    }
  }

  class FakeCollectionReference extends FakeQuery {
    constructor(path) {
      super({ collectionPath: path });
      this.path = path;
    }

    doc(id) {
      return new FakeDocumentReference(`${this.path}/${id}`);
    }
  }

  const firestore = {
    collection: (name) => new FakeCollectionReference(name),
    collectionGroup: (name) => new FakeQuery({ collectionGroup: name }),
    runTransaction: async (callback) => {
      const writes = [];
      const tx = {
        get: (ref) => ref.get(),
        update: (ref, patch) => writes.push({ kind: 'update', ref, patch }),
        set: (ref, data) => writes.push({ kind: 'set', ref, data }),
      };
      const result = await callback(tx);
      writes.forEach((write) => {
        if (write.kind === 'set') {
          store.set(write.ref.path, applyPatch(null, write.data, true));
        } else {
          if (!store.has(write.ref.path)) throw new Error(`Missing document: ${write.ref.path}`);
          store.set(
            write.ref.path,
            applyPatch(store.get(write.ref.path), write.patch),
          );
        }
      });
      return result;
    },
  };

  return {
    initializeApp: jest.fn(),
    apps: [{}],
    firestore: Object.assign(() => firestore, { FieldValue }),
    __clear: () => store.clear(),
    __seed: (path, data) => store.set(path, { ...data }),
    __get: (path) => store.get(path),
  };
});

jest.mock('firebase-functions', () => {
  const https = {
    onRequest: (fn) => fn,
    onCall: (fn) => fn,
    HttpsError: class HttpsError extends Error {
      constructor(code, message) {
        super(message);
        this.code = code;
      }
    },
  };
  return {
    runWith: () => ({ https }),
    https,
    config: () => ({}),
  };
});

jest.mock('firebase-admin/firestore', () => {
  let tick = 1_800_000_000_000;
  return {
    Timestamp: {
      now: () => ({ _milliseconds: tick += 1 }),
      fromMillis: (milliseconds) => ({ _milliseconds: milliseconds }),
    },
    FieldValue: { arrayUnion: (...values) => ({ __op: 'arrayUnion', values }) },
  };
});

const admin = require('firebase-admin');

const WEBHOOK_SECRET = 'whsec_testsecret';
process.env.STRIPE_SECRET_KEY = 'sk_test_testing';
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

const { stripeWebhook } = require('./stripeWebhook');

function stripeEvent(id, type, object) {
  return {
    id,
    object: 'event',
    api_version: '2023-10-16',
    created: 1_800_000_000,
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type,
    data: { object },
  };
}

function registrationSession(overrides = {}) {
  return {
    id: 'cs_reg_1',
    object: 'checkout.session',
    mode: 'payment',
    metadata: {
      eventId: 'race-1',
      registrationId: 'reg-1',
      priceTier: 'nonMember',
    },
    payment_status: 'paid',
    amount_subtotal: 5000,
    amount_total: 5000,
    currency: 'usd',
    payment_intent: 'pi_reg_1',
    ...overrides,
  };
}

function orderSession(overrides = {}) {
  return {
    id: 'cs_order_1',
    object: 'checkout.session',
    mode: 'payment',
    metadata: {
      type: 'merch',
      orderId: 'order-1',
      productSlug: 'hat',
    },
    payment_status: 'paid',
    amount_subtotal: 2000,
    amount_total: 2000,
    currency: 'usd',
    payment_intent: 'pi_order_1',
    shipping_details: {
      name: 'Buyer Name',
      address: {
        line1: '1 Main St',
        line2: null,
        city: 'San Mateo',
        state: 'CA',
        postal_code: '94401',
        country: 'US',
      },
    },
    ...overrides,
  };
}

function seedRegistration(overrides = {}) {
  admin.__seed('events/race-1/registrations/reg-1', {
    eventId: 'race-1',
    runner: { email: 'runner@example.com' },
    amountCents: 5000,
    currency: 'usd',
    status: 'pending',
    stripeSessionId: 'cs_reg_1',
    stripePaymentIntentId: null,
    stripeRefundIds: [],
    auditLog: [],
    ...overrides,
  });
}

function seedOrder(overrides = {}) {
  admin.__seed('orders/order-1', {
    productSlug: 'hat',
    buyer: { email: 'buyer@example.com' },
    amountCents: 2000,
    currency: 'usd',
    status: 'pending',
    stripeSessionId: 'cs_order_1',
    stripePaymentIntentId: null,
    stripeRefundIds: [],
    auditLog: [],
    ...overrides,
  });
}

function signedRequest(event, signatureOverride) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestamp}.${body}`, 'utf8')
    .digest('hex');
  const header = signatureOverride || `t=${timestamp},v1=${signature}`;
  return {
    method: 'POST',
    rawBody: Buffer.from(body),
    get: (name) => (name.toLowerCase() === 'stripe-signature' ? header : undefined),
  };
}

function mockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

async function deliver(event) {
  const response = mockResponse();
  await stripeWebhook(signedRequest(event), response);
  return response;
}

describe('stripeWebhook', () => {
  let consoleError;

  beforeAll(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  beforeEach(() => {
    admin.__clear();
    process.env.STRIPE_LIVEMODE_EXPECTED = 'false';
    consoleError.mockClear();
  });

  test('fails closed before persistence when expected Stripe mode is not configured', async () => {
    delete process.env.STRIPE_LIVEMODE_EXPECTED;
    seedRegistration();

    const response = await deliver(stripeEvent(
      'evt_missing_mode_config',
      'checkout.session.completed',
      registrationSession(),
    ));

    expect(response.status).toHaveBeenCalledWith(500);
    expect(admin.__get('events/race-1/registrations/reg-1').status).toBe('pending');
    expect(admin.__get('stripeEvents/evt_missing_mode_config')).toBeUndefined();
  });

  afterAll(() => {
    consoleError.mockRestore();
  });

  test('rejects a missing or invalid signature', async () => {
    const event = stripeEvent(
      'evt_bad_sig',
      'checkout.session.completed',
      registrationSession(),
    );
    const response = mockResponse();

    await stripeWebhook(signedRequest(event, 't=1,v1=0000'), response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.send).toHaveBeenCalledWith('Webhook signature error');
    expect(admin.__get('stripeEvents/evt_bad_sig')).toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      'Stripe webhook signature verification failed',
      { reason: 'invalid_signature_or_payload' },
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(WEBHOOK_SECRET);
  });

  test('rejects non-POST requests', async () => {
    const response = mockResponse();
    await stripeWebhook({ method: 'GET' }, response);
    expect(response.status).toHaveBeenCalledWith(405);
  });

  test('retries a supported event until its target exists, then deduplicates it', async () => {
    const event = stripeEvent(
      'evt_target_race',
      'checkout.session.completed',
      registrationSession(),
    );

    const missingResponse = await deliver(event);
    expect(missingResponse.status).toHaveBeenCalledWith(500);
    expect(admin.__get('stripeEvents/evt_target_race')).toBeUndefined();

    seedRegistration();
    const successfulResponse = await deliver(event);
    expect(successfulResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: false,
      outcome: 'payment_confirmed',
    }));
    expect(admin.__get('events/race-1/registrations/reg-1').status).toBe('paid');
    expect(admin.__get('stripeEvents/evt_target_race')).toMatchObject({
      status: 'processed',
      outcome: 'payment_confirmed',
    });

    const replayResponse = await deliver(event);
    expect(replayResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: true,
      outcome: 'payment_confirmed',
    }));
  });

  test('acknowledges and deduplicates unsupported event types', async () => {
    const event = stripeEvent('evt_unsupported', 'customer.created', {
      id: 'cus_1',
      object: 'customer',
    });

    const firstResponse = await deliver(event);
    const replayResponse = await deliver(event);

    expect(firstResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: false,
      outcome: 'ignored:unsupported_event',
    }));
    expect(admin.__get('stripeEvents/evt_unsupported')).toMatchObject({
      status: 'processed',
      outcome: 'ignored:unsupported_event',
      requiresReview: false,
    });
    expect(replayResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      duplicate: true,
    }));
  });

  test('acknowledges an unrelated supported event without retrying forever', async () => {
    const event = stripeEvent(
      'evt_other_checkout',
      'checkout.session.completed',
      registrationSession({
        id: 'cs_other_integration',
        metadata: { integration: 'another_application' },
      }),
    );

    const firstResponse = await deliver(event);
    const replayResponse = await deliver(event);

    expect(firstResponse.status).not.toHaveBeenCalled();
    expect(firstResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: false,
      outcome: 'ignored:unmatched_integration_event',
    }));
    expect(admin.__get('stripeEvents/evt_other_checkout')).toMatchObject({
      status: 'processed',
      outcome: 'ignored:unmatched_integration_event',
      requiresReview: false,
      ownership: 'unrelated',
    });
    expect(replayResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      duplicate: true,
    }));
  });

  test('quarantines a malformed claimed MPRC reference without endless retries', async () => {
    const event = stripeEvent(
      'evt_malformed_reference',
      'checkout.session.completed',
      registrationSession({
        id: 'cs_malformed_reference',
        metadata: { eventId: 'race-1' },
      }),
    );

    const response = await deliver(event);

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: false,
      outcome: 'needs_review:invalid_registration_reference',
      requiresReview: true,
    }));
    expect(admin.__get('stripeEvents/evt_malformed_reference')).toMatchObject({
      status: 'processed',
      requiresReview: true,
      ownership: 'malformed',
      ownershipReason: 'invalid_registration_reference',
    });
  });

  test('never resolves conflicting order and registration metadata', async () => {
    seedOrder();
    seedRegistration();
    const event = stripeEvent(
      'evt_conflicting_reference',
      'checkout.session.completed',
      orderSession({
        metadata: {
          type: 'merch',
          orderId: 'order-1',
          eventId: 'race-1',
          registrationId: 'reg-1',
        },
      }),
    );

    await deliver(event);

    expect(admin.__get('orders/order-1').status).toBe('pending');
    expect(admin.__get('events/race-1/registrations/reg-1').status).toBe('pending');
    expect(admin.__get('stripeEvents/evt_conflicting_reference')).toMatchObject({
      outcome: 'needs_review:conflicting_reference',
      requiresReview: true,
      targetPath: null,
      ownership: 'malformed',
    });
  });

  test('never resolves metadata that conflicts with the client reference', async () => {
    seedOrder();
    seedRegistration();
    const event = stripeEvent(
      'evt_conflicting_claim_sources',
      'checkout.session.completed',
      orderSession({
        client_reference_id: 'mprc:registration:race-1:reg-1',
      }),
    );

    const response = await deliver(event);

    expect(response.status).not.toHaveBeenCalled();
    expect(admin.__get('orders/order-1').status).toBe('pending');
    expect(admin.__get('events/race-1/registrations/reg-1').status).toBe('pending');
    expect(admin.__get('stripeEvents/evt_conflicting_claim_sources')).toMatchObject({
      outcome: 'needs_review:conflicting_reference',
      requiresReview: true,
      targetPath: null,
    });
  });

  test('retries a missing claimed target without falling back to another Session owner', async () => {
    seedRegistration({ stripeSessionId: 'cs_claimed_missing' });
    const event = stripeEvent(
      'evt_claimed_target_missing',
      'checkout.session.completed',
      registrationSession({
        id: 'cs_claimed_missing',
        metadata: { eventId: 'race-missing', registrationId: 'reg-missing' },
      }),
    );

    const response = await deliver(event);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(admin.__get('events/race-1/registrations/reg-1').status).toBe('pending');
    expect(admin.__get('stripeEvents/evt_claimed_target_missing')).toBeUndefined();
  });

  test('fails closed when a direct target conflicts with another Session owner', async () => {
    seedRegistration();
    seedOrder({ stripeSessionId: 'cs_reg_1' });

    const response = await deliver(stripeEvent(
      'evt_direct_session_conflict',
      'checkout.session.completed',
      registrationSession(),
    ));

    expect(response.status).toHaveBeenCalledWith(500);
    expect(admin.__get('events/race-1/registrations/reg-1').status).toBe('pending');
    expect(admin.__get('orders/order-1').status).toBe('pending');
    expect(admin.__get('stripeEvents/evt_direct_session_conflict')).toBeUndefined();
  });

  test('resolves a namespaced MPRC client reference', async () => {
    seedRegistration();
    await deliver(stripeEvent(
      'evt_client_reference',
      'checkout.session.completed',
      registrationSession({
        metadata: {},
        client_reference_id: 'mprc:registration:race-1:reg-1',
      }),
    ));

    expect(admin.__get('events/race-1/registrations/reg-1').status).toBe('paid');
    expect(admin.__get('stripeEvents/evt_client_reference')).toMatchObject({
      outcome: 'payment_confirmed',
      ownership: 'local_match',
      targetSource: 'client_reference_id',
    });
  });

  test('quarantines a configured livemode mismatch without changing the target', async () => {
    process.env.STRIPE_LIVEMODE_EXPECTED = 'true';
    seedRegistration();
    const event = stripeEvent(
      'evt_wrong_mode',
      'checkout.session.completed',
      registrationSession(),
    );

    const response = await deliver(event);
    const registration = admin.__get('events/race-1/registrations/reg-1');

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: false,
      outcome: 'needs_review:livemode_mismatch',
      requiresReview: true,
    }));
    expect(registration.status).toBe('pending');
    expect(registration.auditLog).toEqual([]);
    expect(admin.__get('stripeEvents/evt_wrong_mode')).toMatchObject({
      status: 'processed',
      outcome: 'needs_review:livemode_mismatch',
      requiresReview: true,
      targetPath: null,
    });
  });

  test('confirms a paid registration and records actual Stripe totals atomically', async () => {
    seedRegistration();
    const event = stripeEvent(
      'evt_reg_paid',
      'checkout.session.completed',
      registrationSession({
        amount_total: 5000,
      }),
    );

    const response = await deliver(event);
    const registration = admin.__get('events/race-1/registrations/reg-1');
    const ledger = admin.__get('stripeEvents/evt_reg_paid');

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: false,
      outcome: 'payment_confirmed',
    }));
    expect(registration).toMatchObject({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_reg_1',
      stripeAmountSubtotalCents: 5000,
      stripeAmountTotalCents: 5000,
      stripeCurrency: 'usd',
    });
    expect(registration.auditLog).toHaveLength(1);
    expect(ledger).toMatchObject({
      status: 'processed',
      outcome: 'payment_confirmed',
      targetType: 'registration',
      targetPath: 'events/race-1/registrations/reg-1',
      targetSource: 'metadata',
    });
    expect(admin.__get('stripeObjectBindings/checkout_session:cs_reg_1')).toMatchObject({
      targetType: 'registration',
      targetPath: 'events/race-1/registrations/reg-1',
      firstEventId: 'evt_reg_paid',
    });
    expect(admin.__get('stripeObjectBindings/payment_intent:pi_reg_1')).toMatchObject({
      targetType: 'registration',
      targetPath: 'events/race-1/registrations/reg-1',
    });
  });

  test('quarantines a non-payment Checkout Session', async () => {
    seedRegistration();

    await deliver(stripeEvent(
      'evt_wrong_checkout_mode',
      'checkout.session.completed',
      registrationSession({ mode: 'setup' }),
    ));

    expect(admin.__get('events/race-1/registrations/reg-1')).toMatchObject({
      status: 'pending',
      paymentReviewRequired: true,
      paymentReviewReason: 'invalid_checkout_mode',
    });
  });

  test('records paid evidence and flags an order fulfilled before confirmation', async () => {
    seedOrder({ status: 'fulfilled', paymentStatus: null });

    await deliver(stripeEvent(
      'evt_paid_after_fulfilled',
      'checkout.session.completed',
      orderSession(),
    ));

    expect(admin.__get('orders/order-1')).toMatchObject({
      status: 'fulfilled',
      paymentStatus: 'paid',
      paymentReviewRequired: true,
      paymentReviewReason: 'fulfilled_before_payment_confirmation',
      stripeAmountTotalCents: 2000,
    });
    expect(admin.__get('stripeEvents/evt_paid_after_fulfilled')).toMatchObject({
      outcome: 'needs_review:fulfilled_before_payment_confirmation',
      requiresReview: true,
    });
  });

  test('confirms a paid merchandise order and captures shipping', async () => {
    seedOrder();
    await deliver(stripeEvent(
      'evt_order_paid',
      'checkout.session.completed',
      orderSession(),
    ));

    const order = admin.__get('orders/order-1');
    expect(order).toMatchObject({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_order_1',
      stripeAmountSubtotalCents: 2000,
      stripeAmountTotalCents: 2000,
      shipping: {
        line1: '1 Main St',
        city: 'San Mateo',
        postalCode: '94401',
        country: 'US',
        recipientName: 'Buyer Name',
      },
    });
  });

  test('does not mark an unpaid completed Session paid', async () => {
    seedRegistration();
    const event = stripeEvent(
      'evt_reg_unpaid',
      'checkout.session.completed',
      registrationSession({ payment_status: 'unpaid' }),
    );

    const response = await deliver(event);
    const registration = admin.__get('events/race-1/registrations/reg-1');

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'awaiting_payment',
    }));
    expect(registration.status).toBe('pending');
    expect(registration.paymentStatus).toBe('processing');
    expect(registration.paidAt).toBeUndefined();
  });

  test('confirms a delayed payment only after async success', async () => {
    seedRegistration();
    await deliver(stripeEvent(
      'evt_async_started',
      'checkout.session.completed',
      registrationSession({ payment_status: 'unpaid' }),
    ));
    await deliver(stripeEvent(
      'evt_async_succeeded',
      'checkout.session.async_payment_succeeded',
      registrationSession({ payment_status: 'paid' }),
    ));

    const registration = admin.__get('events/race-1/registrations/reg-1');
    expect(registration.status).toBe('paid');
    expect(registration.paymentStatus).toBe('paid');
    expect(registration.auditLog).toHaveLength(2);
  });

  test('quarantines a same-Session event that changes the bound PaymentIntent', async () => {
    seedRegistration({ stripePaymentIntentId: 'pi_original' });

    await deliver(stripeEvent(
      'evt_changed_payment_intent',
      'checkout.session.async_payment_succeeded',
      registrationSession({ payment_intent: 'pi_replacement' }),
    ));

    expect(admin.__get('events/race-1/registrations/reg-1')).toMatchObject({
      status: 'pending',
      stripePaymentIntentId: 'pi_original',
      paymentReviewRequired: true,
      paymentReviewReason: 'payment_intent_mismatch',
    });
    expect(admin.__get('stripeEvents/evt_changed_payment_intent')).toMatchObject({
      outcome: 'needs_review:payment_intent_mismatch',
      requiresReview: true,
    });
  });

  test('cancels pending orders after an async payment failure', async () => {
    seedOrder();
    await deliver(stripeEvent(
      'evt_async_failed',
      'checkout.session.async_payment_failed',
      orderSession({ payment_status: 'unpaid' }),
    ));

    const order = admin.__get('orders/order-1');
    expect(order.status).toBe('cancelled');
    expect(order.paymentStatus).toBe('failed');
    expect(order.cancelledAt).toBeDefined();
  });

  test.each([
    ['failure', 'checkout.session.async_payment_failed', 'failed'],
    ['expiry', 'checkout.session.expired', 'expired'],
  ])('does not let an async %s event undo verified payment', async (_label, type, reason) => {
    seedRegistration();
    await deliver(stripeEvent(
      'evt_paid_before_unsuccessful',
      'checkout.session.completed',
      registrationSession(),
    ));
    await deliver(stripeEvent(
      `evt_${reason}_after_paid`,
      type,
      registrationSession({ payment_status: 'unpaid' }),
    ));

    expect(admin.__get('events/race-1/registrations/reg-1')).toMatchObject({
      status: 'paid',
      paymentStatus: 'paid',
    });
    expect(admin.__get(`stripeEvents/evt_${reason}_after_paid`)).toMatchObject({
      outcome: `${reason}_ignored:paid`,
    });
  });

  test.each([
    ['failure', 'checkout.session.async_payment_failed', 'failed'],
    ['expiry', 'checkout.session.expired', 'expired'],
  ])('does not resurrect an async %s cancellation after late success', async (_label, type, reason) => {
    seedRegistration();
    await deliver(stripeEvent(
      `evt_${reason}_before_success`,
      type,
      registrationSession({ payment_status: 'unpaid' }),
    ));
    await deliver(stripeEvent(
      `evt_success_after_${reason}`,
      'checkout.session.async_payment_succeeded',
      registrationSession(),
    ));

    expect(admin.__get('events/race-1/registrations/reg-1')).toMatchObject({
      status: 'cancelled',
      paymentStatus: 'paid_after_cancellation',
      paymentReviewReason: 'paid_after_cancellation',
    });
    expect(admin.__get(`stripeEvents/evt_success_after_${reason}`)).toMatchObject({
      outcome: 'needs_review:paid_after_cancellation',
      requiresReview: true,
    });
  });

  test('deduplicates replayed events without adding a second audit entry', async () => {
    seedRegistration();
    const event = stripeEvent(
      'evt_duplicate',
      'checkout.session.completed',
      registrationSession(),
    );

    await deliver(event);
    const secondResponse = await deliver(event);

    const registration = admin.__get('events/race-1/registrations/reg-1');
    expect(registration.auditLog).toHaveLength(1);
    expect(secondResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: true,
      outcome: 'payment_confirmed',
    }));
  });

  test.each([
    ['amount', { amount_subtotal: 4999, amount_total: 4999 }, 'amount_mismatch'],
    ['total', { amount_total: 4999 }, 'total_mismatch'],
    ['currency', { currency: 'cad' }, 'currency_mismatch'],
  ])('quarantines a %s mismatch without confirming payment', async (_label, patch, reason) => {
    seedRegistration();
    const eventId = `evt_${reason}`;
    await deliver(stripeEvent(
      eventId,
      'checkout.session.completed',
      registrationSession(patch),
    ));

    const registration = admin.__get('events/race-1/registrations/reg-1');
    const ledger = admin.__get(`stripeEvents/${eventId}`);
    expect(registration.status).toBe('pending');
    expect(registration).toMatchObject({
      paymentReviewRequired: true,
      paymentReviewReason: reason,
    });
    expect(ledger).toMatchObject({
      status: 'processed',
      requiresReview: true,
      outcome: `needs_review:${reason}`,
    });
  });

  test.each([
    ['missing stored currency', { currency: undefined }, {}, 'invalid_expected_currency'],
    ['missing Stripe subtotal', {}, { amount_subtotal: null }, 'invalid_stripe_subtotal'],
  ])('quarantines %s instead of inferring money fields', async (
    _label,
    recordPatch,
    sessionPatch,
    reason,
  ) => {
    seedRegistration(recordPatch);
    await deliver(stripeEvent(
      `evt_${reason}`,
      'checkout.session.completed',
      registrationSession(sessionPatch),
    ));

    expect(admin.__get('events/race-1/registrations/reg-1')).toMatchObject({
      status: 'pending',
      paymentReviewRequired: true,
      paymentReviewReason: reason,
    });
  });

  test('does not resurrect a cancelled registration when payment arrives', async () => {
    seedRegistration({ status: 'cancelled' });
    await deliver(stripeEvent(
      'evt_paid_after_cancel',
      'checkout.session.completed',
      registrationSession(),
    ));

    const registration = admin.__get('events/race-1/registrations/reg-1');
    expect(registration.status).toBe('cancelled');
    expect(registration).toMatchObject({
      paymentStatus: 'paid_after_cancellation',
      paymentReviewRequired: true,
      paymentReviewReason: 'paid_after_cancellation',
    });
  });

  test('preserves fulfillment but records and flags a late payment confirmation', async () => {
    seedOrder({ status: 'fulfilled' });
    const response = await deliver(stripeEvent(
      'evt_fulfilled_replay',
      'checkout.session.completed',
      orderSession(),
    ));

    const order = admin.__get('orders/order-1');
    expect(order.status).toBe('fulfilled');
    expect(order.paymentStatus).toBe('paid');
    expect(order.paymentReviewRequired).toBe(true);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'needs_review:fulfilled_before_payment_confirmation',
      requiresReview: true,
    }));
  });

  test('expires pending registrations and orders', async () => {
    seedRegistration();
    seedOrder();

    await deliver(stripeEvent(
      'evt_reg_expired',
      'checkout.session.expired',
      registrationSession({ payment_status: 'unpaid', payment_intent: null }),
    ));
    await deliver(stripeEvent(
      'evt_order_expired',
      'checkout.session.expired',
      orderSession({ payment_status: 'unpaid', payment_intent: null }),
    ));

    expect(admin.__get('events/race-1/registrations/reg-1')).toMatchObject({
      status: 'cancelled',
      paymentStatus: 'expired',
    });
    expect(admin.__get('orders/order-1')).toMatchObject({
      status: 'cancelled',
      paymentStatus: 'expired',
    });
  });

  test('falls back to the legacy Session query when metadata is absent', async () => {
    seedRegistration();
    await deliver(stripeEvent(
      'evt_legacy_session',
      'checkout.session.completed',
      registrationSession({ metadata: {} }),
    ));

    expect(admin.__get('events/race-1/registrations/reg-1').status).toBe('paid');
    expect(admin.__get('stripeEvents/evt_legacy_session')).toMatchObject({
      targetSource: 'session_query',
      targetType: 'registration',
    });
  });

  test('fails closed when two registrations own the same legacy Session', async () => {
    seedRegistration();
    admin.__seed('events/race-2/registrations/reg-2', {
      amountCents: 5000,
      currency: 'usd',
      status: 'pending',
      stripeSessionId: 'cs_reg_1',
      auditLog: [],
    });

    const response = await deliver(stripeEvent(
      'evt_duplicate_registration_session',
      'checkout.session.completed',
      registrationSession({ metadata: {} }),
    ));

    expect(response.status).toHaveBeenCalledWith(500);
    expect(admin.__get('events/race-1/registrations/reg-1').status).toBe('pending');
    expect(admin.__get('events/race-2/registrations/reg-2').status).toBe('pending');
    expect(admin.__get('stripeEvents/evt_duplicate_registration_session')).toBeUndefined();
  });

  test('fails closed when an order and registration own the same legacy Session', async () => {
    seedRegistration();
    seedOrder({ stripeSessionId: 'cs_reg_1' });

    const response = await deliver(stripeEvent(
      'evt_cross_type_session',
      'checkout.session.completed',
      registrationSession({ metadata: {} }),
    ));

    expect(response.status).toHaveBeenCalledWith(500);
    expect(admin.__get('events/race-1/registrations/reg-1').status).toBe('pending');
    expect(admin.__get('orders/order-1').status).toBe('pending');
    expect(admin.__get('stripeEvents/evt_cross_type_session')).toBeUndefined();
  });

  test('durably quarantines a transaction-time provider binding conflict', async () => {
    seedRegistration();
    admin.__seed('stripeObjectBindings/checkout_session:cs_reg_1', {
      providerObjectType: 'checkout_session',
      providerObjectId: 'cs_reg_1',
      targetType: 'order',
      targetPath: 'orders/order-other',
    });

    const response = await deliver(stripeEvent(
      'evt_binding_conflict',
      'checkout.session.completed',
      registrationSession(),
    ));

    expect(response.status).not.toHaveBeenCalled();
    expect(admin.__get('events/race-1/registrations/reg-1').status).toBe('pending');
    expect(admin.__get('stripeEvents/evt_binding_conflict')).toMatchObject({
      outcome: 'needs_review:provider_binding_conflict',
      requiresReview: true,
    });
  });

  test('binds the first Session created by a matching legacy Payment Link', async () => {
    seedRegistration({ stripeSessionId: null, stripePaymentLinkId: 'plink_late_1' });
    await deliver(stripeEvent(
      'evt_payment_link',
      'checkout.session.completed',
      registrationSession({
        id: 'cs_from_link_1',
        payment_link: 'plink_late_1',
        metadata: {
          eventId: 'race-1',
          registrationId: 'reg-1',
          late_add: 'true',
        },
      }),
    ));

    expect(admin.__get('events/race-1/registrations/reg-1')).toMatchObject({
      status: 'paid',
      stripeSessionId: 'cs_from_link_1',
    });
  });

  test.each([
    ['Session', { stripeSessionId: 'cs_other' }, {}, 'session_mismatch'],
    [
      'Payment Link',
      { stripeSessionId: null, stripePaymentLinkId: 'plink_expected' },
      { payment_link: 'plink_other' },
      'payment_link_mismatch',
    ],
    [
      'unbound Session',
      { stripeSessionId: null, stripePaymentLinkId: null },
      {},
      'unbound_session',
    ],
  ])('quarantines a %s binding failure', async (_label, recordPatch, sessionPatch, reason) => {
    seedRegistration(recordPatch);

    await deliver(stripeEvent(
      `evt_${reason}`,
      'checkout.session.completed',
      registrationSession(sessionPatch),
    ));

    expect(admin.__get('events/race-1/registrations/reg-1')).toMatchObject({
      status: 'pending',
      paymentReviewRequired: true,
      paymentReviewReason: reason,
    });
    expect(admin.__get(`stripeEvents/evt_${reason}`)).toMatchObject({
      outcome: `needs_review:${reason}`,
    });
  });

  test('retries a missing claimed refund target without falling back by PaymentIntent', async () => {
    seedRegistration({ stripePaymentIntentId: 'pi_shared_refund' });
    const charge = {
      id: 'ch_claimed_missing',
      object: 'charge',
      payment_intent: 'pi_shared_refund',
      amount: 5000,
      amount_refunded: 500,
      currency: 'usd',
      metadata: { type: 'merch', orderId: 'order-missing' },
    };

    const response = await deliver(stripeEvent(
      'evt_claimed_refund_missing',
      'charge.refunded',
      charge,
    ));

    expect(response.status).toHaveBeenCalledWith(500);
    expect(admin.__get('events/race-1/registrations/reg-1').status).toBe('pending');
    expect(admin.__get('stripeEvents/evt_claimed_refund_missing')).toBeUndefined();
  });

  test('fails closed when a claimed refund target conflicts with another PI owner', async () => {
    seedOrder({ status: 'paid', paymentStatus: 'paid' });
    seedRegistration({ stripePaymentIntentId: 'pi_shared_refund' });
    const response = await deliver(stripeEvent(
      'evt_direct_refund_pi_conflict',
      'charge.refunded',
      {
        id: 'ch_shared_refund',
        object: 'charge',
        payment_intent: 'pi_shared_refund',
        amount: 2000,
        amount_refunded: 500,
        currency: 'usd',
        metadata: { type: 'merch', orderId: 'order-1' },
      },
    ));

    expect(response.status).toHaveBeenCalledWith(500);
    expect(admin.__get('orders/order-1')).toMatchObject({
      status: 'paid',
      paymentStatus: 'paid',
    });
    expect(admin.__get('events/race-1/registrations/reg-1').status).toBe('pending');
    expect(admin.__get('stripeEvents/evt_direct_refund_pi_conflict')).toBeUndefined();
  });

  test('durably flags an unmatched refund for officer review', async () => {
    const charge = {
      id: 'ch_unmatched_refund',
      object: 'charge',
      payment_intent: 'pi_unmatched_refund',
      amount: 5000,
      amount_refunded: 500,
      currency: 'usd',
      metadata: {},
    };

    const response = await deliver(stripeEvent(
      'evt_unmatched_refund',
      'charge.refunded',
      charge,
    ));

    expect(response.status).not.toHaveBeenCalled();
    expect(admin.__get('stripeEvents/evt_unmatched_refund')).toMatchObject({
      outcome: 'needs_review:unmatched_refund',
      requiresReview: true,
      targetPath: null,
    });
  });

  test.each([
    ['charge', { id: 'ch_replacement' }, { stripeChargeId: 'ch_bound' }, 'charge_mismatch'],
    ['currency', { currency: 'cad' }, {}, 'refund_currency_mismatch'],
    ['total', { amount: 1999 }, {}, 'refund_total_mismatch'],
    ['stored currency', {}, { currency: undefined }, 'invalid_expected_currency'],
  ])('quarantines a refund %s mismatch', async (_label, chargePatch, recordPatch, reason) => {
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_order_1',
      stripeAmountTotalCents: 2000,
      ...recordPatch,
    });
    const charge = {
      id: 'ch_order_1',
      object: 'charge',
      payment_intent: 'pi_order_1',
      amount: 2000,
      amount_refunded: 500,
      currency: 'usd',
      metadata: { type: 'merch', orderId: 'order-1' },
      refunds: { data: [{ id: 're_order_1' }] },
      ...chargePatch,
    };

    await deliver(stripeEvent(`evt_refund_${reason}`, 'charge.refunded', charge));

    expect(admin.__get('orders/order-1')).toMatchObject({
      status: 'paid',
      paymentStatus: 'paid',
      paymentReviewRequired: true,
      paymentReviewReason: reason,
    });
    expect(admin.__get(`stripeEvents/evt_refund_${reason}`)).toMatchObject({
      outcome: `needs_review:${reason}`,
      requiresReview: true,
    });
  });

  test('applies merchandise refunds idempotently and preserves fulfillment state', async () => {
    seedOrder({
      status: 'fulfilled',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_order_1',
    });
    const charge = {
      id: 'ch_order_1',
      object: 'charge',
      payment_intent: 'pi_order_1',
      amount: 2000,
      currency: 'usd',
      amount_refunded: 500,
      metadata: { type: 'merch', orderId: 'order-1' },
      refunds: { data: [{ id: 're_order_1' }] },
    };
    const event = stripeEvent('evt_order_refund', 'charge.refunded', charge);

    await deliver(event);
    await deliver(event);
    await deliver(stripeEvent(
      'evt_order_refund_duplicate_object',
      'charge.refunded',
      charge,
    ));

    const order = admin.__get('orders/order-1');
    expect(order).toMatchObject({
      status: 'fulfilled',
      paymentStatus: 'partially_refunded',
      stripeAmountRefundedCents: 500,
      stripeChargeId: 'ch_order_1',
      stripeRefundIds: ['re_order_1'],
    });
    expect(order.auditLog).toHaveLength(1);
    expect(admin.__get('stripeEvents/evt_order_refund_duplicate_object')).toMatchObject({
      outcome: 'already_partially_refunded',
    });
  });

  test.each(['cancelled', 'comp', 'fulfilled', 'transferred'])(
    'preserves terminal %s status while recording a refund',
    async (status) => {
      seedOrder({
        status,
        paymentStatus: 'paid',
        stripePaymentIntentId: 'pi_order_1',
        stripeChargeId: 'ch_order_1',
      });
      await deliver(stripeEvent(`evt_refund_${status}`, 'charge.refunded', {
        id: 'ch_order_1',
        object: 'charge',
        payment_intent: 'pi_order_1',
        amount: 2000,
        amount_refunded: 500,
        currency: 'usd',
        metadata: { type: 'merch', orderId: 'order-1' },
      }));

      expect(admin.__get('orders/order-1')).toMatchObject({
        status,
        paymentStatus: 'partially_refunded',
        stripeAmountRefundedCents: 500,
      });
    },
  );

  test('does not regress a legacy refunded record that lacks a refund counter', async () => {
    seedOrder({
      status: 'refunded',
      paymentStatus: 'refunded',
      stripePaymentIntentId: 'pi_order_1',
      stripeChargeId: 'ch_order_1',
      stripeAmountRefundedCents: undefined,
    });
    await deliver(stripeEvent('evt_legacy_refunded_partial', 'charge.refunded', {
      id: 'ch_order_1',
      object: 'charge',
      payment_intent: 'pi_order_1',
      amount: 2000,
      amount_refunded: 500,
      currency: 'usd',
      metadata: { type: 'merch', orderId: 'order-1' },
    }));

    expect(admin.__get('orders/order-1')).toMatchObject({
      status: 'refunded',
      paymentStatus: 'refunded',
    });
    expect(admin.__get('orders/order-1').stripeAmountRefundedCents).toBeUndefined();
    expect(admin.__get('stripeEvents/evt_legacy_refunded_partial')).toMatchObject({
      outcome: 'stale_refund_ignored',
    });
  });

  test('does not let an older partial-refund event downgrade a full refund', async () => {
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_order_1',
      stripeAmountTotalCents: 2000,
    });
    const charge = {
      id: 'ch_order_1',
      object: 'charge',
      payment_intent: 'pi_order_1',
      amount: 2000,
      currency: 'usd',
      metadata: { type: 'merch', orderId: 'order-1' },
    };

    await deliver(stripeEvent('evt_refund_full', 'charge.refunded', {
      ...charge,
      amount_refunded: 2000,
      refunds: { data: [{ id: 're_full' }] },
    }));
    await deliver(stripeEvent('evt_refund_old_partial', 'charge.refunded', {
      ...charge,
      amount_refunded: 500,
      refunds: { data: [{ id: 're_partial' }] },
    }));

    expect(admin.__get('orders/order-1')).toMatchObject({
      status: 'refunded',
      paymentStatus: 'refunded',
      stripeAmountRefundedCents: 2000,
      stripeRefundIds: ['re_full'],
    });
    expect(admin.__get('stripeEvents/evt_refund_old_partial')).toMatchObject({
      outcome: 'stale_refund_ignored',
    });
  });

  test('keeps refund state and records payment evidence when refund arrives first', async () => {
    seedRegistration();
    const refundFirst = stripeEvent('evt_refund_before_completion', 'charge.refunded', {
      id: 'ch_reg_1',
      object: 'charge',
      payment_intent: 'pi_reg_1',
      amount: 5000,
      currency: 'usd',
      amount_refunded: 500,
      created: 1_799_999_900,
      metadata: { eventId: 'race-1', registrationId: 'reg-1' },
      refunds: { data: [{ id: 're_reg_partial' }] },
    });

    await deliver(refundFirst);
    await deliver(stripeEvent(
      'evt_completion_after_refund',
      'checkout.session.completed',
      registrationSession(),
    ));

    expect(admin.__get('events/race-1/registrations/reg-1')).toMatchObject({
      status: 'partially_refunded',
      paymentStatus: 'partially_refunded',
      stripeAmountRefundedCents: 500,
      stripeAmountTotalCents: 5000,
      stripeSessionId: 'cs_reg_1',
      stripePaymentIntentId: 'pi_reg_1',
    });
    expect(admin.__get('events/race-1/registrations/reg-1').paidAt).toBeTruthy();
    expect(admin.__get('stripeEvents/evt_completion_after_refund')).toMatchObject({
      outcome: 'payment_observed_after_partially_refunded',
    });
    expect(admin.__get('stripeObjectBindings/charge:ch_reg_1')).toMatchObject({
      targetPath: 'events/race-1/registrations/reg-1',
    });
    expect(admin.__get('stripeObjectBindings/payment_intent:pi_reg_1')).toMatchObject({
      targetPath: 'events/race-1/registrations/reg-1',
    });
  });

  test('does not bind an unanchored refund that fails money validation', async () => {
    seedOrder({ status: 'paid', paymentStatus: 'paid' });
    await deliver(stripeEvent('evt_unanchored_bad_refund', 'charge.refunded', {
      id: 'ch_unanchored_bad',
      object: 'charge',
      payment_intent: 'pi_unanchored_bad',
      amount: 1999,
      amount_refunded: 500,
      currency: 'usd',
      metadata: { type: 'merch', orderId: 'order-1' },
    }));

    expect(admin.__get('orders/order-1')).toMatchObject({
      status: 'paid',
      paymentReviewReason: 'refund_total_mismatch',
    });
    expect(admin.__get('stripeObjectBindings/charge:ch_unanchored_bad')).toBeUndefined();
    expect(admin.__get(
      'stripeObjectBindings/payment_intent:pi_unanchored_bad',
    )).toBeUndefined();
  });

  test('records merchandise disputes without overwriting order status', async () => {
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_order_1',
    });
    const dispute = {
      id: 'dp_order_1',
      object: 'dispute',
      charge: 'ch_order_1',
      payment_intent: 'pi_order_1',
      amount: 2000,
      currency: 'usd',
      reason: 'fraudulent',
      status: 'needs_response',
      metadata: { type: 'merch', orderId: 'order-1' },
    };

    await deliver(stripeEvent(
      'evt_order_dispute',
      'charge.dispute.created',
      dispute,
    ));

    expect(admin.__get('orders/order-1')).toMatchObject({
      status: 'paid',
      disputeStatus: 'needs_response',
      stripeDisputeId: 'dp_order_1',
      disputedAmountCents: 2000,
      disputeReason: 'fraudulent',
      stripeDisputeIds: ['dp_order_1'],
      stripeDisputes: {
        dp_order_1: expect.objectContaining({
          status: 'needs_response',
          paymentIntentId: 'pi_order_1',
        }),
      },
    });
    expect(admin.__get('stripeObjectBindings/dispute:dp_order_1')).toMatchObject({
      targetPath: 'orders/order-1',
      targetType: 'order',
    });
    expect(admin.__get('stripeObjectBindings/charge:ch_order_1')).toMatchObject({
      targetPath: 'orders/order-1',
    });
  });

  test('resolves a provider-normal PI-null dispute by Charge ID', async () => {
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_order_1',
      stripeChargeId: 'ch_order_1',
    });
    const dispute = {
      id: 'dp_charge_lookup',
      object: 'dispute',
      charge: 'ch_order_1',
      payment_intent: null,
      amount: 2000,
      currency: 'usd',
      reason: 'fraudulent',
      status: 'needs_response',
      metadata: {},
    };

    await deliver(stripeEvent(
      'evt_dispute_charge_lookup',
      'charge.dispute.created',
      dispute,
    ));

    expect(admin.__get('orders/order-1')).toMatchObject({
      disputeStatus: 'needs_response',
      stripeDisputeIds: ['dp_charge_lookup'],
    });
    expect(admin.__get('stripeEvents/evt_dispute_charge_lookup')).toMatchObject({
      targetSource: 'charge_query',
      outcome: 'dispute_needs_response',
    });
  });

  test.each([
    ['object type', { object: 'charge' }, {}, 'invalid_dispute_binding'],
    ['missing Charge', { charge: null, payment_intent: null }, {}, 'invalid_dispute_binding'],
    ['wrong Charge', { charge: 'ch_other', payment_intent: null }, {}, 'charge_mismatch'],
    ['PaymentIntent', { payment_intent: 'pi_other' }, {}, 'payment_intent_mismatch'],
    ['currency', { currency: 'cad' }, {}, 'dispute_currency_mismatch'],
    ['zero amount', { amount: 0 }, {}, 'invalid_dispute_amount'],
    ['excess amount', { amount: 2001 }, {}, 'invalid_dispute_amount'],
    ['missing status', { status: undefined }, {}, 'invalid_dispute_status'],
    ['invented closed status', { status: 'closed' }, {}, 'invalid_dispute_status'],
    ['stored currency', {}, { currency: undefined }, 'invalid_expected_currency'],
  ])('quarantines a dispute %s mismatch', async (
    _label,
    disputePatch,
    recordPatch,
    reason,
  ) => {
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_order_1',
      stripeChargeId: 'ch_order_1',
      stripeAmountTotalCents: 2000,
      ...recordPatch,
    });
    const dispute = {
      id: 'dp_invalid',
      object: 'dispute',
      charge: 'ch_order_1',
      payment_intent: 'pi_order_1',
      amount: 2000,
      currency: 'usd',
      reason: 'fraudulent',
      status: 'needs_response',
      metadata: { type: 'merch', orderId: 'order-1' },
      ...disputePatch,
    };

    await deliver(stripeEvent(
      `evt_dispute_${reason}_${_label.replaceAll(' ', '_')}`,
      'charge.dispute.updated',
      dispute,
    ));

    expect(admin.__get('orders/order-1')).toMatchObject({
      status: 'paid',
      paymentReviewRequired: true,
      paymentReviewReason: reason,
    });
    expect(admin.__get(
      `stripeEvents/evt_dispute_${reason}_${_label.replaceAll(' ', '_')}`,
    )).toMatchObject({
      outcome: `needs_review:${reason}`,
      requiresReview: true,
    });
  });

  test('quarantines a closed dispute event without a provider terminal status', async () => {
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_order_1',
      stripeChargeId: 'ch_order_1',
    });
    const dispute = {
      id: 'dp_closed_missing_status',
      object: 'dispute',
      charge: 'ch_order_1',
      payment_intent: 'pi_order_1',
      amount: 2000,
      currency: 'usd',
      reason: 'fraudulent',
      metadata: { type: 'merch', orderId: 'order-1' },
    };

    await deliver(stripeEvent(
      'evt_closed_missing_status',
      'charge.dispute.closed',
      dispute,
    ));

    expect(admin.__get('orders/order-1')).toMatchObject({
      status: 'paid',
      paymentReviewReason: 'invalid_dispute_status',
    });
    expect(admin.__get('stripeEvents/evt_closed_missing_status')).toMatchObject({
      outcome: 'needs_review:invalid_dispute_status',
    });
  });

  test('does not anchor a PI-null dispute to an unrelated stored PaymentIntent', async () => {
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_order_1',
      stripeChargeId: null,
    });
    await deliver(stripeEvent('evt_unanchored_bad_dispute', 'charge.dispute.updated', {
      id: 'dp_unanchored_bad',
      object: 'dispute',
      charge: 'ch_unanchored_bad',
      payment_intent: null,
      amount: 2001,
      currency: 'usd',
      reason: 'fraudulent',
      status: 'needs_response',
      metadata: { type: 'merch', orderId: 'order-1' },
    }));

    expect(admin.__get('orders/order-1')).toMatchObject({
      status: 'paid',
      paymentReviewReason: 'invalid_dispute_amount',
    });
    expect(admin.__get('stripeObjectBindings/dispute:dp_unanchored_bad')).toBeUndefined();
    expect(admin.__get('stripeObjectBindings/charge:ch_unanchored_bad')).toBeUndefined();
  });

  test('quarantines an unmatched dispute instead of acknowledging it as unrelated', async () => {
    const dispute = {
      id: 'dp_unmatched',
      object: 'dispute',
      charge: 'ch_unknown',
      payment_intent: null,
      amount: 1000,
      reason: 'fraudulent',
      status: 'needs_response',
      metadata: {},
    };

    await deliver(stripeEvent(
      'evt_dispute_unmatched',
      'charge.dispute.created',
      dispute,
    ));

    expect(admin.__get('stripeEvents/evt_dispute_unmatched')).toMatchObject({
      outcome: 'needs_review:unmatched_dispute',
      requiresReview: true,
    });
  });

  test('does not let an older dispute update regress a closed dispute', async () => {
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_order_1',
    });
    const base = {
      id: 'dp_order_reordered',
      object: 'dispute',
      payment_intent: 'pi_order_1',
      charge: 'ch_order_1',
      amount: 2000,
      currency: 'usd',
      reason: 'fraudulent',
      metadata: { type: 'merch', orderId: 'order-1' },
    };
    const closed = stripeEvent('evt_dispute_closed', 'charge.dispute.closed', {
      ...base,
      status: 'won',
    });
    closed.created = 1_800_000_100;
    const olderUpdate = stripeEvent('evt_dispute_old_update', 'charge.dispute.updated', {
      ...base,
      status: 'under_review',
    });
    olderUpdate.created = 1_800_000_000;

    await deliver(closed);
    await deliver(olderUpdate);

    expect(admin.__get('orders/order-1')).toMatchObject({
      disputeStatus: 'won',
      stripeDisputes: {
        dp_order_reordered: expect.objectContaining({ status: 'won' }),
      },
    });
    expect(admin.__get('stripeEvents/evt_dispute_old_update')).toMatchObject({
      outcome: 'stale_dispute_ignored',
    });
  });

  test('uses dispute lifecycle rank when updates share the same second', async () => {
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_order_1',
    });
    const base = {
      id: 'dp_equal_second',
      object: 'dispute',
      payment_intent: 'pi_order_1',
      charge: 'ch_order_1',
      amount: 2000,
      currency: 'usd',
      reason: 'fraudulent',
      metadata: { type: 'merch', orderId: 'order-1' },
    };
    const underReview = stripeEvent(
      'evt_equal_under_review',
      'charge.dispute.updated',
      { ...base, status: 'under_review' },
    );
    const needsResponse = stripeEvent(
      'evt_equal_needs_response',
      'charge.dispute.updated',
      { ...base, status: 'needs_response' },
    );
    underReview.created = 1_800_000_000;
    needsResponse.created = 1_800_000_000;

    await deliver(underReview);
    await deliver(needsResponse);

    expect(admin.__get('orders/order-1')).toMatchObject({
      disputeStatus: 'under_review',
      stripeDisputes: {
        dp_equal_second: expect.objectContaining({
          status: 'under_review',
          statusRank: 20,
        }),
      },
    });
    expect(admin.__get('stripeEvents/evt_equal_needs_response')).toMatchObject({
      outcome: 'stale_dispute_ignored',
    });
  });

  test('tracks multiple disputes for one payment independently', async () => {
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_order_1',
    });
    const disputeFor = (id, status) => ({
      id,
      object: 'dispute',
      payment_intent: 'pi_order_1',
      charge: 'ch_order_1',
      amount: 500,
      currency: 'usd',
      reason: 'fraudulent',
      status,
      metadata: { type: 'merch', orderId: 'order-1' },
    });

    const first = stripeEvent(
      'evt_dispute_first', 'charge.dispute.created', disputeFor('dp_first', 'needs_response'),
    );
    first.created = 1_800_000_000;
    const second = stripeEvent(
      'evt_dispute_second', 'charge.dispute.created', disputeFor('dp_second', 'under_review'),
    );
    second.created = 1_800_000_100;
    await deliver(first);
    await deliver(second);

    expect(admin.__get('orders/order-1')).toMatchObject({
      stripeDisputeIds: ['dp_first', 'dp_second'],
      stripeDisputes: {
        dp_first: expect.objectContaining({ status: 'needs_response' }),
        dp_second: expect.objectContaining({ status: 'under_review' }),
      },
      disputeStatus: 'under_review',
    });
  });
});
