const { createSignedStripePayload } = require('./testSupport/testSafety');

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

const WEBHOOK_SECRET = 'stripe_webhook_synthetic_test_material';
process.env.ENVIRONMENT_NAME = 'test';
process.env.SITE_ORIGIN = 'https://runmprc.test';
process.env.STRIPE_SECRET_KEY = 'sk_test_testing';
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.STRIPE_LIVEMODE_EXPECTED = 'false';

const { stripeWebhook } = require('./stripeWebhook');

const CHECKOUT_SESSION_STATUS_BY_EVENT_TYPE = Object.freeze({
  'checkout.session.completed': 'complete',
  'checkout.session.async_payment_succeeded': 'complete',
  'checkout.session.async_payment_failed': 'complete',
  'checkout.session.expired': 'expired',
});
const PROVIDER_OBJECT_REALM_EVENT_TYPES = new Set([
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
]);
const INVALID_EMBEDDED_LIVEMODE_CASES = [
  ['opposite boolean', 'value', true],
  ['missing', 'delete', undefined],
  ['null', 'value', null],
  ['string', 'value', 'false'],
  ['number', 'value', 0],
];
const INVALID_METADATA_SCHEMA_CASES = [
  ['future string', '2'],
  ['empty string', ''],
  ['null', null],
  ['number', 1],
  ['boolean', true],
  ['object', {}],
  ['array', []],
];
const DISPUTE_REALM_CASES = [
  ['created', 'charge.dispute.created', 'needs_response'],
  ['updated', 'charge.dispute.updated', 'under_review'],
  ['closed', 'charge.dispute.closed', 'won'],
].flatMap(([lifecycle, type, status]) => (
  INVALID_EMBEDDED_LIVEMODE_CASES.map(([evidence, mutation, value]) => [
    lifecycle,
    evidence,
    type,
    status,
    mutation,
    value,
  ])
));
const DISPUTE_METADATA_SCHEMA_CASES = [
  ['created', 'charge.dispute.created', 'needs_response'],
  ['updated', 'charge.dispute.updated', 'under_review'],
  ['closed', 'charge.dispute.closed', 'won'],
].flatMap(([lifecycle, type, status]) => (
  INVALID_METADATA_SCHEMA_CASES.map(([evidence, value]) => [
    lifecycle,
    evidence,
    type,
    status,
    value,
  ])
));

function stripeEvent(id, type, object) {
  const checkoutStatus = CHECKOUT_SESSION_STATUS_BY_EVENT_TYPE[type];
  let providerObject = object;
  if (checkoutStatus) {
    providerObject = { livemode: false, status: checkoutStatus, ...object };
  } else if (PROVIDER_OBJECT_REALM_EVENT_TYPES.has(type)) {
    providerObject = { livemode: false, ...object };
  }
  return {
    id,
    object: 'event',
    api_version: '2023-10-16',
    created: 1_800_000_000,
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type,
    data: {
      object: providerObject,
    },
  };
}

function registrationSession(overrides = {}) {
  return {
    id: 'cs_reg_1',
    object: 'checkout.session',
    mode: 'payment',
    metadata: {
      schemaVersion: '1',
      eventId: 'race-1',
      registrationId: 'reg-1',
      priceTier: 'nonMember',
    },
    payment_status: 'paid',
    amount_subtotal: 5000,
    amount_total: 5000,
    currency: 'usd',
    payment_intent: 'pi_reg_1',
    total_details: {
      amount_discount: 0,
      amount_shipping: 0,
      amount_tax: 0,
    },
    ...overrides,
  };
}

function orderSession(overrides = {}) {
  return {
    id: 'cs_order_1',
    object: 'checkout.session',
    mode: 'payment',
    metadata: {
      schemaVersion: '1',
      type: 'merch',
      orderId: 'order-1',
      productSlug: 'hat',
    },
    payment_status: 'paid',
    amount_subtotal: 2000,
    amount_total: 2000,
    currency: 'usd',
    payment_intent: 'pi_order_1',
    total_details: {
      amount_discount: 0,
      amount_shipping: 0,
      amount_tax: 0,
    },
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

function orderRefundCharge(overrides = {}) {
  return {
    id: 'ch_order_realm',
    object: 'charge',
    payment_intent: 'pi_order_1',
    amount: 2000,
    amount_refunded: 500,
    currency: 'usd',
    metadata: { schemaVersion: '1', type: 'merch', orderId: 'order-1' },
    refunds: { data: [{ id: 're_order_realm' }] },
    ...overrides,
  };
}

function orderDispute(overrides = {}) {
  return {
    id: 'dp_order_realm',
    object: 'dispute',
    charge: 'ch_order_1',
    payment_intent: 'pi_order_1',
    amount: 2000,
    currency: 'usd',
    reason: 'fraudulent',
    status: 'needs_response',
    metadata: { schemaVersion: '1', type: 'merch', orderId: 'order-1' },
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
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = createSignedStripePayload({
    event,
    secret: WEBHOOK_SECRET,
    timestamp,
  });
  const header = signatureOverride || signedPayload.signatureHeader;
  return {
    method: 'POST',
    rawBody: signedPayload.rawBody,
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

function storedCopy(path) {
  return JSON.parse(JSON.stringify(admin.__get(path)));
}

function setMetadataSchema(object, value) {
  object.metadata.schemaVersion = value;
}

function providerBindingPaths(event) {
  const object = event.data.object;
  const descriptors = [];
  if (CHECKOUT_SESSION_STATUS_BY_EVENT_TYPE[event.type]) {
    descriptors.push(['checkout_session', object.id]);
    descriptors.push(['payment_intent', object.payment_intent]);
    descriptors.push(['payment_link', object.payment_link]);
  } else if (event.type === 'charge.refunded') {
    descriptors.push(['charge', object.id]);
    descriptors.push(['payment_intent', object.payment_intent]);
  } else if (event.type.startsWith('charge.dispute.')) {
    descriptors.push(['dispute', object.id]);
    descriptors.push(['charge', object.charge]);
    descriptors.push(['payment_intent', object.payment_intent]);
  }
  return descriptors
    .filter(([, id]) => typeof id === 'string' && id.length > 0)
    .map(([type, id]) => `stripeObjectBindings/${type}:${id}`);
}

function expectCompatibilityQuarantine({ response, event, businessPath, before, reason }) {
  expect(response.status).not.toHaveBeenCalled();
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
    received: true,
    duplicate: false,
    outcome: `needs_review:${reason}`,
    requiresReview: true,
  }));
  expect(admin.__get(businessPath)).toEqual(before);
  expect(admin.__get(`stripeEvents/${event.id}`)).toMatchObject({
    status: 'processed',
    outcome: `needs_review:${reason}`,
    requiresReview: true,
    targetType: null,
    targetPath: null,
    targetSource: null,
  });
  providerBindingPaths(event).forEach((path) => {
    expect(admin.__get(path)).toBeUndefined();
  });
}

describe('stripeWebhook', () => {
  let consoleError;

  beforeAll(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  beforeEach(() => {
    admin.__clear();
    delete process.env.COMMERCE_ENABLED;
    process.env.ENVIRONMENT_NAME = 'test';
    process.env.SITE_ORIGIN = 'https://runmprc.test';
    process.env.STRIPE_LIVEMODE_EXPECTED = 'false';
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
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
    expect(response.send).toHaveBeenCalledWith('Server configuration is unavailable');
    expect(admin.__get('events/race-1/registrations/reg-1').status).toBe('pending');
    expect(admin.__get('stripeEvents/evt_missing_mode_config')).toBeUndefined();
  });

  test('reports a missing webhook secret as configuration failure before persistence', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    seedRegistration();

    const response = await deliver(stripeEvent(
      'evt_missing_webhook_secret',
      'checkout.session.completed',
      registrationSession(),
    ));

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.send).toHaveBeenCalledWith('Server configuration is unavailable');
    expect(admin.__get('events/race-1/registrations/reg-1').status).toBe('pending');
    expect(admin.__get('stripeEvents/evt_missing_webhook_secret')).toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      'Stripe webhook configuration unavailable',
      { reason: 'webhook_secret_missing' },
    );
  });

  afterAll(() => {
    consoleError.mockRestore();
    delete process.env.ENVIRONMENT_NAME;
    delete process.env.SITE_ORIGIN;
    delete process.env.STRIPE_LIVEMODE_EXPECTED;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.COMMERCE_ENABLED;
  });

  test('rejects a missing or invalid signature', async () => {
    delete process.env.ENVIRONMENT_NAME;
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

  test('signed payment evidence continues while the new-commerce ceiling is off', async () => {
    process.env.COMMERCE_ENABLED = 'false';
    seedRegistration();
    const event = stripeEvent(
      'evt_payment_during_pause',
      'checkout.session.completed',
      registrationSession(),
    );

    const response = await deliver(event);

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      outcome: 'payment_confirmed',
    }));
    expect(admin.__get('events/race-1/registrations/reg-1').status).toBe('paid');
    expect(admin.__get('stripeEvents/evt_payment_during_pause')).toMatchObject({
      status: 'processed',
      outcome: 'payment_confirmed',
    });
  });

  test('acknowledges and deduplicates unsupported event types', async () => {
    const event = stripeEvent('evt_unsupported', 'customer.created', {
      id: 'cus_1',
      object: 'customer',
      metadata: { schemaVersion: '2', type: 'merch', orderId: 'order-1' },
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
        metadata: { integration: 'another_application', schemaVersion: '2' },
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
    seedRegistration();
    const event = stripeEvent(
      'evt_wrong_mode',
      'checkout.session.completed',
      registrationSession(),
    );
    event.livemode = true;

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

  test.each([
    ['opposite boolean', 'value', true],
    ['missing', 'delete', undefined],
    ['null', 'value', null],
    ['string', 'value', 'false'],
    ['number', 'value', 0],
  ])('quarantines a Checkout Session with %s embedded livemode evidence', async (
    label,
    mutation,
    value,
  ) => {
    seedRegistration();
    const businessPath = 'events/race-1/registrations/reg-1';
    const before = storedCopy(businessPath);
    const event = stripeEvent(
      `evt_session_livemode_${label.replace(/[^a-z]+/g, '_')}`,
      'checkout.session.completed',
      registrationSession(),
    );
    if (mutation === 'delete') delete event.data.object.livemode;
    else event.data.object.livemode = value;

    const response = await deliver(event);

    expectCompatibilityQuarantine({
      response,
      event,
      businessPath,
      before,
      reason: 'checkout_session_livemode_mismatch',
    });
  });

  test.each([
    ['completed open', 'checkout.session.completed', 'value', 'open', 'paid'],
    ['completed expired', 'checkout.session.completed', 'value', 'expired', 'paid'],
    ['async success open', 'checkout.session.async_payment_succeeded', 'value', 'open', 'paid'],
    ['async success expired', 'checkout.session.async_payment_succeeded', 'value', 'expired', 'paid'],
    ['async failure open', 'checkout.session.async_payment_failed', 'value', 'open', 'unpaid'],
    ['async failure expired', 'checkout.session.async_payment_failed', 'value', 'expired', 'unpaid'],
    ['expired open', 'checkout.session.expired', 'value', 'open', 'unpaid'],
    ['expired complete', 'checkout.session.expired', 'value', 'complete', 'unpaid'],
    ['status missing', 'checkout.session.completed', 'delete', undefined, 'paid'],
    ['status null', 'checkout.session.completed', 'value', null, 'paid'],
    ['status unknown', 'checkout.session.completed', 'value', 'unknown', 'paid'],
    ['status non-string', 'checkout.session.completed', 'value', 1, 'paid'],
  ])('quarantines a Checkout Session whose lifecycle is %s', async (
    label,
    type,
    mutation,
    value,
    paymentStatus,
  ) => {
    seedOrder();
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const event = stripeEvent(
      `evt_session_status_${label.replace(/[^a-z]+/g, '_')}`,
      type,
      orderSession({ payment_status: paymentStatus }),
    );
    if (mutation === 'delete') delete event.data.object.status;
    else event.data.object.status = value;

    const response = await deliver(event);

    expectCompatibilityQuarantine({
      response,
      event,
      businessPath,
      before,
      reason: 'checkout_session_status_mismatch',
    });
  });

  test.each([
    ['completion', 'checkout.session.completed', 'paid', 'payment_confirmed', 'paid'],
    [
      'async success',
      'checkout.session.async_payment_succeeded',
      'paid',
      'payment_confirmed',
      'paid',
    ],
    ['async failure', 'checkout.session.async_payment_failed', 'unpaid', 'payment_failed', 'cancelled'],
    ['expiry', 'checkout.session.expired', 'unpaid', 'payment_expired', 'cancelled'],
  ])('preserves the valid Checkout Session lifecycle for %s', async (
    label,
    type,
    paymentStatus,
    outcome,
    status,
  ) => {
    seedRegistration();
    const event = stripeEvent(
      `evt_valid_session_status_${label.replace(/[^a-z]+/g, '_')}`,
      type,
      registrationSession({ payment_status: paymentStatus }),
    );

    const response = await deliver(event);

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: false,
      outcome,
    }));
    expect(admin.__get('events/race-1/registrations/reg-1').status).toBe(status);
  });

  test('quarantines an incompatible claimed Checkout Event without retrying a missing target', async () => {
    const event = stripeEvent(
      'evt_incompatible_missing_target',
      'checkout.session.completed',
      registrationSession({ status: 'open' }),
    );

    const response = await deliver(event);

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: false,
      outcome: 'needs_review:checkout_session_status_mismatch',
      requiresReview: true,
    }));
    expect(admin.__get('stripeEvents/evt_incompatible_missing_target')).toMatchObject({
      status: 'processed',
      targetType: null,
      targetPath: null,
      targetSource: null,
    });
  });

  test('keeps a compatible claimed Checkout Event retryable when its target is missing', async () => {
    const response = await deliver(stripeEvent(
      'evt_compatible_missing_target',
      'checkout.session.completed',
      registrationSession(),
    ));

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.send).toHaveBeenCalledWith('Webhook handler error');
    expect(admin.__get('stripeEvents/evt_compatible_missing_target')).toBeUndefined();
  });

  test('keeps the configured Event livemode mismatch ahead of Session contradictions', async () => {
    seedRegistration();
    const businessPath = 'events/race-1/registrations/reg-1';
    const before = storedCopy(businessPath);
    const event = stripeEvent(
      'evt_outer_livemode_precedence',
      'checkout.session.completed',
      registrationSession({ status: 'open' }),
    );
    event.livemode = true;

    const response = await deliver(event);

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'needs_review:livemode_mismatch',
      requiresReview: true,
    }));
    expect(admin.__get(businessPath)).toEqual(before);
    expect(admin.__get('stripeEvents/evt_outer_livemode_precedence')).toMatchObject({
      outcome: 'needs_review:livemode_mismatch',
      targetType: null,
      targetPath: null,
      targetSource: null,
    });
  });

  test('deduplicates an incompatible Checkout Event without a target or binding mutation', async () => {
    seedOrder();
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const event = stripeEvent(
      'evt_incompatible_replay',
      'checkout.session.expired',
      orderSession({ payment_status: 'unpaid', status: 'complete' }),
    );

    const firstResponse = await deliver(event);
    const replayResponse = await deliver(event);

    expectCompatibilityQuarantine({
      response: firstResponse,
      event,
      businessPath,
      before,
      reason: 'checkout_session_status_mismatch',
    });
    expect(replayResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: true,
      outcome: 'needs_review:checkout_session_status_mismatch',
    }));
    expect(admin.__get(businessPath)).toEqual(before);
  });

  test.each(INVALID_EMBEDDED_LIVEMODE_CASES)(
    'quarantines a refund Charge with %s embedded livemode evidence',
    async (label, mutation, value) => {
      seedOrder({
        status: 'paid',
        paymentStatus: 'paid',
        stripePaymentIntentId: 'pi_order_1',
        stripeAmountTotalCents: 2000,
      });
      const businessPath = 'orders/order-1';
      const before = storedCopy(businessPath);
      const slug = label.replace(/[^a-z]+/g, '_');
      const event = stripeEvent(
        `evt_charge_livemode_${slug}`,
        'charge.refunded',
        orderRefundCharge({ id: `ch_charge_livemode_${slug}` }),
      );
      if (mutation === 'delete') delete event.data.object.livemode;
      else event.data.object.livemode = value;

      const response = await deliver(event);

      expectCompatibilityQuarantine({
        response,
        event,
        businessPath,
        before,
        reason: 'charge_livemode_mismatch',
      });
    },
  );

  test.each(DISPUTE_REALM_CASES)(
    'quarantines a %s Dispute with %s embedded livemode evidence',
    async (lifecycle, evidence, type, status, mutation, value) => {
      seedOrder({
        status: 'paid',
        paymentStatus: 'paid',
        stripePaymentIntentId: 'pi_order_1',
        stripeChargeId: 'ch_order_1',
        stripeAmountTotalCents: 2000,
      });
      const businessPath = 'orders/order-1';
      const before = storedCopy(businessPath);
      const slug = evidence.replace(/[^a-z]+/g, '_');
      const event = stripeEvent(
        `evt_dispute_${lifecycle}_livemode_${slug}`,
        type,
        orderDispute({ id: `dp_${lifecycle}_livemode_${slug}`, status }),
      );
      if (mutation === 'delete') delete event.data.object.livemode;
      else event.data.object.livemode = value;

      const response = await deliver(event);

      expectCompatibilityQuarantine({
        response,
        event,
        businessPath,
        before,
        reason: 'dispute_livemode_mismatch',
      });
    },
  );

  test('quarantines an incompatible claimed Dispute before resolving its missing target', async () => {
    const event = stripeEvent(
      'evt_dispute_missing_target',
      'charge.dispute.created',
      orderDispute({
        id: 'dp_incompatible_missing_target',
        charge: 'ch_incompatible_missing_target',
        payment_intent: 'pi_incompatible_missing_target',
        metadata: { type: 'merch', orderId: 'order-missing' },
        livemode: true,
      }),
    );

    const response = await deliver(event);

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: false,
      outcome: 'needs_review:dispute_livemode_mismatch',
      requiresReview: true,
    }));
    expect(admin.__get(`stripeEvents/${event.id}`)).toMatchObject({
      status: 'processed',
      outcome: 'needs_review:dispute_livemode_mismatch',
      requiresReview: true,
      targetType: null,
      targetPath: null,
      targetSource: null,
    });
    providerBindingPaths(event).forEach((path) => {
      expect(admin.__get(path)).toBeUndefined();
    });
  });

  test.each([
    [
      'Charge',
      'charge.refunded',
      orderRefundCharge({ livemode: null }),
    ],
    [
      'Dispute',
      'charge.dispute.updated',
      orderDispute({ status: 'under_review', livemode: null }),
    ],
  ])('keeps the configured Event livemode mismatch ahead of embedded %s contradictions', async (
    label,
    type,
    object,
  ) => {
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_order_1',
      stripeChargeId: 'ch_order_1',
      stripeAmountTotalCents: 2000,
    });
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const event = stripeEvent(`evt_outer_precedence_${label.toLowerCase()}`, type, object);
    event.livemode = true;

    const response = await deliver(event);

    expectCompatibilityQuarantine({
      response,
      event,
      businessPath,
      before,
      reason: 'livemode_mismatch',
    });
  });

  test('deduplicates an incompatible refund Charge without target or binding mutation', async () => {
    seedRegistration({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_reg_1',
      stripeAmountTotalCents: 5000,
    });
    const businessPath = 'events/race-1/registrations/reg-1';
    const before = storedCopy(businessPath);
    const event = stripeEvent(
      'evt_refund_charge_realm_replay',
      'charge.refunded',
      {
        id: 'ch_registration_replay',
        object: 'charge',
        payment_intent: 'pi_reg_1',
        amount: 5000,
        amount_refunded: 500,
        currency: 'usd',
        metadata: { eventId: 'race-1', registrationId: 'reg-1' },
        refunds: { data: [{ id: 're_registration_replay' }] },
        livemode: true,
      },
    );

    const firstResponse = await deliver(event);
    const replayResponse = await deliver(event);

    expectCompatibilityQuarantine({
      response: firstResponse,
      event,
      businessPath,
      before,
      reason: 'charge_livemode_mismatch',
    });
    expect(replayResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: true,
      outcome: 'needs_review:charge_livemode_mismatch',
    }));
    expect(admin.__get(businessPath)).toEqual(before);
  });

  test.each(INVALID_METADATA_SCHEMA_CASES)(
    'quarantines a claimed Checkout Session with an explicit %s metadata schema',
    async (label, value) => {
      seedRegistration();
      const businessPath = 'events/race-1/registrations/reg-1';
      const before = storedCopy(businessPath);
      const event = stripeEvent(
        `evt_session_schema_${label.replace(/[^a-z]+/g, '_')}`,
        'checkout.session.completed',
        registrationSession(),
      );
      setMetadataSchema(event.data.object, value);

      const response = await deliver(event);

      expectCompatibilityQuarantine({
        response,
        event,
        businessPath,
        before,
        reason: 'metadata_schema_version_mismatch',
      });
    },
  );

  test.each(INVALID_METADATA_SCHEMA_CASES)(
    'quarantines a claimed refund Charge with an explicit %s metadata schema',
    async (label, value) => {
      seedOrder({
        status: 'paid',
        paymentStatus: 'paid',
        stripePaymentIntentId: 'pi_order_1',
        stripeAmountTotalCents: 2000,
      });
      const businessPath = 'orders/order-1';
      const before = storedCopy(businessPath);
      const event = stripeEvent(
        `evt_refund_schema_${label.replace(/[^a-z]+/g, '_')}`,
        'charge.refunded',
        orderRefundCharge({ id: `ch_refund_schema_${label.replace(/[^a-z]+/g, '_')}` }),
      );
      setMetadataSchema(event.data.object, value);

      const response = await deliver(event);

      expectCompatibilityQuarantine({
        response,
        event,
        businessPath,
        before,
        reason: 'metadata_schema_version_mismatch',
      });
    },
  );

  test.each(DISPUTE_METADATA_SCHEMA_CASES)(
    'quarantines a claimed %s Dispute with an explicit %s metadata schema',
    async (lifecycle, evidence, type, status, value) => {
      seedOrder({
        status: 'paid',
        paymentStatus: 'paid',
        stripePaymentIntentId: 'pi_order_1',
        stripeChargeId: 'ch_order_1',
        stripeAmountTotalCents: 2000,
      });
      const businessPath = 'orders/order-1';
      const before = storedCopy(businessPath);
      const slug = evidence.replace(/[^a-z]+/g, '_');
      const event = stripeEvent(
        `evt_dispute_${lifecycle}_schema_${slug}`,
        type,
        orderDispute({ id: `dp_${lifecycle}_schema_${slug}`, status }),
      );
      setMetadataSchema(event.data.object, value);

      const response = await deliver(event);

      expectCompatibilityQuarantine({
        response,
        event,
        businessPath,
        before,
        reason: 'metadata_schema_version_mismatch',
      });
    },
  );

  test.each([
    ['client reference only', true],
    ['matching metadata and client reference', false],
  ])('does not let a %s claim bypass metadata schema admission', async (_label, clientOnly) => {
    seedRegistration();
    const businessPath = 'events/race-1/registrations/reg-1';
    const before = storedCopy(businessPath);
    const session = registrationSession({
      client_reference_id: 'mprc:registration:race-1:reg-1',
    });
    if (clientOnly) session.metadata = { schemaVersion: '2' };
    else setMetadataSchema(session, '2');
    const event = stripeEvent(
      `evt_schema_claim_${clientOnly ? 'client' : 'matching'}`,
      'checkout.session.completed',
      session,
    );

    const response = await deliver(event);

    expectCompatibilityQuarantine({
      response,
      event,
      businessPath,
      before,
      reason: 'metadata_schema_version_mismatch',
    });
  });

  test.each([
    ['outer Event realm', 'livemode_mismatch', (event) => { event.livemode = true; }],
    [
      'Checkout Session realm',
      'checkout_session_livemode_mismatch',
      (event) => { event.data.object.livemode = true; },
    ],
    [
      'Checkout Session lifecycle',
      'checkout_session_status_mismatch',
      (event) => { event.data.object.status = 'open'; },
    ],
  ])('keeps %s precedence over metadata schema admission', async (_label, reason, mutate) => {
    seedRegistration();
    const businessPath = 'events/race-1/registrations/reg-1';
    const before = storedCopy(businessPath);
    const event = stripeEvent(
      `evt_schema_precedence_${reason}`,
      'checkout.session.completed',
      registrationSession(),
    );
    setMetadataSchema(event.data.object, '2');
    mutate(event);

    const response = await deliver(event);

    expectCompatibilityQuarantine({ response, event, businessPath, before, reason });
  });

  test.each([
    [
      'refund Charge realm',
      'charge.refunded',
      orderRefundCharge({ livemode: true }),
      'charge_livemode_mismatch',
    ],
    [
      'Dispute realm',
      'charge.dispute.updated',
      orderDispute({ status: 'under_review', livemode: true }),
      'dispute_livemode_mismatch',
    ],
  ])('keeps %s precedence over metadata schema admission', async (
    _label,
    type,
    object,
    reason,
  ) => {
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_order_1',
      stripeChargeId: 'ch_order_1',
      stripeAmountTotalCents: 2000,
    });
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    setMetadataSchema(object, '2');
    const event = stripeEvent(`evt_schema_precedence_${reason}`, type, object);

    const response = await deliver(event);

    expectCompatibilityQuarantine({ response, event, businessPath, before, reason });
  });

  test('keeps malformed-reference precedence over metadata schema admission', async () => {
    seedOrder();
    seedRegistration();
    const event = stripeEvent(
      'evt_schema_malformed_reference_precedence',
      'checkout.session.completed',
      orderSession({
        metadata: {
          schemaVersion: '2',
          type: 'merch',
          orderId: 'order-1',
          eventId: 'race-1',
          registrationId: 'reg-1',
        },
      }),
    );

    const response = await deliver(event);

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: false,
      outcome: 'needs_review:conflicting_reference',
      requiresReview: true,
    }));
    expect(admin.__get('orders/order-1').status).toBe('pending');
    expect(admin.__get('events/race-1/registrations/reg-1').status).toBe('pending');
    expect(admin.__get(`stripeEvents/${event.id}`)).toMatchObject({
      outcome: 'needs_review:conflicting_reference',
      targetPath: null,
    });
  });

  test('processes an incompatible claimed metadata schema before a missing target', async () => {
    const event = stripeEvent(
      'evt_schema_incompatible_missing_target',
      'checkout.session.completed',
      registrationSession({
        metadata: {
          schemaVersion: '2',
          eventId: 'race-missing',
          registrationId: 'reg-missing',
        },
      }),
    );

    const response = await deliver(event);

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: false,
      outcome: 'needs_review:metadata_schema_version_mismatch',
      requiresReview: true,
    }));
    expect(admin.__get(`stripeEvents/${event.id}`)).toMatchObject({
      status: 'processed',
      targetType: null,
      targetPath: null,
      targetSource: null,
    });
  });

  test('deduplicates an unsupported metadata schema without target or binding mutation', async () => {
    seedOrder();
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const event = stripeEvent(
      'evt_schema_incompatible_replay',
      'checkout.session.completed',
      orderSession(),
    );
    setMetadataSchema(event.data.object, '2');

    const firstResponse = await deliver(event);
    const replayResponse = await deliver(event);

    expectCompatibilityQuarantine({
      response: firstResponse,
      event,
      businessPath,
      before,
      reason: 'metadata_schema_version_mismatch',
    });
    expect(replayResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: true,
      outcome: 'needs_review:metadata_schema_version_mismatch',
    }));
    expect(admin.__get(businessPath)).toEqual(before);
  });

  test.each([
    ['exact version 1', false],
    ['missing legacy version', true],
  ])(
    'admits a claimed Checkout Session with %s',
    async (_label, omitVersion) => {
      seedRegistration();
      const session = registrationSession();
      if (omitVersion) delete session.metadata.schemaVersion;
      const event = stripeEvent(
        `evt_schema_session_compatible_${omitVersion ? 'legacy' : 'v1'}`,
        'checkout.session.completed',
        session,
      );

      const response = await deliver(event);

      expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
        received: true,
        duplicate: false,
        outcome: 'payment_confirmed',
      }));
      expect(admin.__get('events/race-1/registrations/reg-1').status).toBe('paid');
    },
  );

  test.each([
    ['exact version 1', false],
    ['missing legacy version', true],
  ])(
    'admits a claimed refund Charge with %s',
    async (_label, omitVersion) => {
      seedOrder({
        status: 'paid',
        paymentStatus: 'paid',
        stripePaymentIntentId: 'pi_order_1',
        stripeAmountTotalCents: 2000,
      });
      const suffix = omitVersion ? 'legacy' : 'v1';
      const charge = orderRefundCharge({ id: `ch_schema_refund_compatible_${suffix}` });
      if (omitVersion) delete charge.metadata.schemaVersion;
      const event = stripeEvent(
        `evt_schema_refund_compatible_${suffix}`,
        'charge.refunded',
        charge,
      );

      const response = await deliver(event);

      expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
        received: true,
        duplicate: false,
        outcome: 'partially_refunded',
      }));
      expect(admin.__get('orders/order-1').status).toBe('partially_refunded');
    },
  );

  test.each([
    ['created', 'charge.dispute.created', 'needs_response', 'dispute_needs_response', false],
    ['created legacy', 'charge.dispute.created', 'needs_response', 'dispute_needs_response', true],
    ['updated', 'charge.dispute.updated', 'under_review', 'dispute_under_review', false],
    ['updated legacy', 'charge.dispute.updated', 'under_review', 'dispute_under_review', true],
    ['closed', 'charge.dispute.closed', 'won', 'dispute_won', false],
    ['closed legacy', 'charge.dispute.closed', 'won', 'dispute_won', true],
  ])('admits a claimed %s Dispute metadata schema', async (
    label,
    type,
    status,
    outcome,
    omitVersion,
  ) => {
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_order_1',
      stripeChargeId: 'ch_order_1',
      stripeAmountTotalCents: 2000,
    });
    const dispute = orderDispute({ id: `dp_schema_${label.replace(/[^a-z]+/g, '_')}`, status });
    if (omitVersion) delete dispute.metadata.schemaVersion;
    const event = stripeEvent(
      `evt_schema_${label.replace(/[^a-z]+/g, '_')}`,
      type,
      dispute,
    );

    const response = await deliver(event);

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: false,
      outcome,
    }));
    expect(admin.__get('orders/order-1').disputeStatus).toBe(status);
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
      stripeDiscountCents: 0,
      stripeTaxCents: 0,
      stripeShippingCents: 0,
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

  test.each([
    ['partial', 4500, 'paid', 'pi_reg_1', 500],
    ['100 percent', 0, 'no_payment_required', null, 5000],
  ])('quarantines a %s unapproved promotion discount', async (
    _label,
    total,
    paymentStatus,
    paymentIntent,
    discount,
  ) => {
    seedRegistration();
    const eventId = `evt_discount_${discount}`;
    await deliver(stripeEvent(
      eventId,
      'checkout.session.completed',
      registrationSession({
        amount_total: total,
        payment_status: paymentStatus,
        payment_intent: paymentIntent,
        total_details: {
          amount_discount: discount,
          amount_shipping: 0,
          amount_tax: 0,
        },
      }),
    ));

    expect(admin.__get('events/race-1/registrations/reg-1')).toMatchObject({
      status: 'pending',
      paymentReviewRequired: true,
      paymentReviewReason: 'discount_not_allowed',
    });
    expect(admin.__get(`stripeEvents/${eventId}`)).toMatchObject({
      outcome: 'needs_review:discount_not_allowed',
      requiresReview: true,
    });
  });

  test('quarantines a discounted pre-change Session that permitted promotions', async () => {
    seedRegistration();
    await deliver(stripeEvent(
      'evt_legacy_promotion_discount',
      'checkout.session.completed',
      registrationSession({
        allow_promotion_codes: true,
        amount_total: 4500,
        total_details: {
          amount_discount: 500,
          amount_shipping: 0,
          amount_tax: 0,
        },
      }),
    ));

    expect(admin.__get('events/race-1/registrations/reg-1')).toMatchObject({
      status: 'pending',
      paymentReviewRequired: true,
      paymentReviewReason: 'discount_not_allowed',
    });
    expect(admin.__get('stripeEvents/evt_legacy_promotion_discount')).toMatchObject({
      outcome: 'needs_review:discount_not_allowed',
      requiresReview: true,
    });
  });

  test('accepts Stripe null shipping as an explicit zero adjustment', async () => {
    seedRegistration();
    await deliver(stripeEvent(
      'evt_null_shipping_zero',
      'checkout.session.completed',
      registrationSession({
        total_details: {
          amount_discount: 0,
          amount_shipping: null,
          amount_tax: 0,
        },
      }),
    ));

    expect(admin.__get('events/race-1/registrations/reg-1')).toMatchObject({
      status: 'paid',
      stripeDiscountCents: 0,
      stripeTaxCents: 0,
      stripeShippingCents: 0,
    });
  });

  test('accepts a complete all-zero Stripe shipping cost breakdown', async () => {
    seedOrder();
    await deliver(stripeEvent(
      'evt_zero_shipping_cost',
      'checkout.session.completed',
      orderSession({
        shipping_cost: { amount_subtotal: 0, amount_tax: 0, amount_total: 0 },
      }),
    ));

    expect(admin.__get('orders/order-1')).toMatchObject({
      status: 'paid',
      stripeDiscountCents: 0,
      stripeTaxCents: 0,
      stripeShippingCents: 0,
    });
  });

  test.each([
    [
      'tax',
      { amount_discount: 0, amount_shipping: 0, amount_tax: 100 },
      null,
      2100,
      'tax_not_configured',
    ],
    [
      'shipping charge',
      { amount_discount: 0, amount_shipping: 250, amount_tax: 0 },
      { amount_subtotal: 250, amount_tax: 0, amount_total: 250 },
      2250,
      'shipping_charge_not_configured',
    ],
  ])('quarantines an unconfigured %s', async (
    _label,
    totalDetails,
    shippingCost,
    total,
    reason,
  ) => {
    seedOrder();
    const eventId = `evt_${reason}_${_label.replace(/[^A-Za-z0-9]+/g, '_')}`;
    await deliver(stripeEvent(
      eventId,
      'checkout.session.completed',
      orderSession({
        amount_total: total,
        total_details: totalDetails,
        shipping_cost: shippingCost,
      }),
    ));

    expect(admin.__get('orders/order-1')).toMatchObject({
      status: 'pending',
      paymentReviewRequired: true,
      paymentReviewReason: reason,
    });
    expect(admin.__get(`stripeEvents/${eventId}`)).toMatchObject({
      outcome: `needs_review:${reason}`,
      requiresReview: true,
    });
  });

  test.each([
    ['missing details', { total_details: undefined }],
    ['null details', { total_details: null }],
    ['missing discount', {
      total_details: { amount_shipping: 0, amount_tax: 0 },
    }],
    ['null discount', {
      total_details: { amount_discount: null, amount_shipping: 0, amount_tax: 0 },
    }],
    ['missing tax', {
      total_details: { amount_discount: 0, amount_shipping: 0 },
    }],
    ['null tax', {
      total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: null },
    }],
    ['missing detail shipping', {
      total_details: { amount_discount: 0, amount_tax: 0 },
    }],
    ['negative discount', {
      total_details: { amount_discount: -1, amount_shipping: 0, amount_tax: 0 },
    }],
    ['unsafe discount', {
      total_details: {
        amount_discount: Number.MAX_SAFE_INTEGER + 1,
        amount_shipping: 0,
        amount_tax: 0,
      },
    }],
    ['fractional tax', {
      total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0.5 },
    }],
    ['string shipping', {
      total_details: { amount_discount: 0, amount_shipping: '0', amount_tax: 0 },
    }],
    ['non-object details', { total_details: 'none' }],
    ['non-object shipping cost', { shipping_cost: 'none' }],
    ['missing shipping cost subtotal', {
      shipping_cost: { amount_tax: 0, amount_total: 0 },
    }],
    ['missing shipping cost tax', {
      shipping_cost: { amount_subtotal: 0, amount_total: 0 },
    }],
    ['missing shipping cost total', {
      shipping_cost: { amount_subtotal: 0, amount_tax: 0 },
    }],
    ['null shipping cost subtotal', {
      shipping_cost: { amount_subtotal: null, amount_tax: 0, amount_total: 0 },
    }],
    ['null shipping cost tax', {
      shipping_cost: { amount_subtotal: 0, amount_tax: null, amount_total: 0 },
    }],
    ['null shipping cost total', {
      shipping_cost: { amount_subtotal: 0, amount_tax: 0, amount_total: null },
    }],
  ])('quarantines an invalid adjustment shape: %s', async (_label, patch) => {
    seedRegistration();
    const eventId = `evt_invalid_adjustment_${_label.replace(/[^A-Za-z0-9]+/g, '_')}`;
    await deliver(stripeEvent(
      eventId,
      'checkout.session.completed',
      registrationSession(patch),
    ));

    expect(admin.__get('events/race-1/registrations/reg-1')).toMatchObject({
      status: 'pending',
      paymentReviewReason: 'invalid_stripe_adjustment',
    });
    expect(admin.__get(`stripeEvents/${eventId}`)).toMatchObject({
      outcome: 'needs_review:invalid_stripe_adjustment',
    });
  });

  test('quarantines conflicting shipping total sources', async () => {
    seedOrder();
    await deliver(stripeEvent(
      'evt_shipping_source_conflict',
      'checkout.session.completed',
      orderSession({
        amount_total: 2250,
        total_details: {
          amount_discount: 0,
          amount_shipping: 0,
          amount_tax: 0,
        },
        shipping_cost: { amount_subtotal: 250, amount_tax: 0, amount_total: 250 },
      }),
    ));

    expect(admin.__get('orders/order-1')).toMatchObject({
      status: 'pending',
      paymentReviewReason: 'stripe_shipping_breakdown_mismatch',
    });
  });

  test.each([
    ['hidden subtotal', { amount_subtotal: 100, amount_tax: 0, amount_total: 0 }],
    ['hidden tax', { amount_subtotal: 0, amount_tax: 100, amount_total: 0 }],
  ])('quarantines a shipping cost with a %s', async (_label, shippingCost) => {
    seedOrder();
    const eventId = `evt_shipping_${_label.replace(/[^A-Za-z0-9]+/g, '_')}`;
    await deliver(stripeEvent(
      eventId,
      'checkout.session.completed',
      orderSession({ shipping_cost: shippingCost }),
    ));

    expect(admin.__get('orders/order-1')).toMatchObject({
      status: 'pending',
      paymentReviewReason: 'stripe_shipping_breakdown_mismatch',
    });
    expect(admin.__get(`stripeEvents/${eventId}`)).toMatchObject({
      outcome: 'needs_review:stripe_shipping_breakdown_mismatch',
      requiresReview: true,
    });
  });

  test('quarantines an inconsistent Stripe total breakdown', async () => {
    seedRegistration();
    await deliver(stripeEvent(
      'evt_total_breakdown_mismatch',
      'checkout.session.completed',
      registrationSession({
        amount_total: 5000,
        total_details: {
          amount_discount: 500,
          amount_shipping: 0,
          amount_tax: 0,
        },
      }),
    ));

    expect(admin.__get('events/race-1/registrations/reg-1')).toMatchObject({
      status: 'pending',
      paymentReviewReason: 'stripe_total_breakdown_mismatch',
    });
  });

  test('quarantines an adjustment breakdown whose computed total is unsafe', async () => {
    seedRegistration();
    await deliver(stripeEvent(
      'evt_total_breakdown_overflow',
      'checkout.session.completed',
      registrationSession({
        amount_total: Number.MAX_SAFE_INTEGER,
        total_details: {
          amount_discount: 0,
          amount_shipping: Number.MAX_SAFE_INTEGER,
          amount_tax: Number.MAX_SAFE_INTEGER,
        },
      }),
    ));

    expect(admin.__get('events/race-1/registrations/reg-1')).toMatchObject({
      status: 'pending',
      paymentReviewReason: 'stripe_total_breakdown_mismatch',
    });
    expect(admin.__get('stripeEvents/evt_total_breakdown_overflow')).toMatchObject({
      outcome: 'needs_review:stripe_total_breakdown_mismatch',
      requiresReview: true,
    });
  });

  test('never infers a missing subtotal when adjustments are present', async () => {
    seedRegistration();
    await deliver(stripeEvent(
      'evt_adjusted_missing_subtotal',
      'checkout.session.completed',
      registrationSession({
        amount_subtotal: null,
        amount_total: 4500,
        total_details: {
          amount_discount: 500,
          amount_shipping: 0,
          amount_tax: 0,
        },
      }),
    ));

    expect(admin.__get('events/race-1/registrations/reg-1')).toMatchObject({
      status: 'pending',
      paymentReviewReason: 'invalid_stripe_subtotal',
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
      stripeDiscountCents: 0,
      stripeTaxCents: 0,
      stripeShippingCents: 0,
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

  test('quarantines an unknown Checkout payment status', async () => {
    seedRegistration();
    await deliver(stripeEvent(
      'evt_unknown_payment_status',
      'checkout.session.completed',
      registrationSession({ payment_status: 'mystery' }),
    ));

    expect(admin.__get('events/race-1/registrations/reg-1')).toMatchObject({
      status: 'pending',
      paymentReviewRequired: true,
      paymentReviewReason: 'invalid_checkout_payment_status',
    });
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
    ['failure', 'checkout.session.async_payment_failed', 'failed', 'payment.async_failed'],
    ['expiry', 'checkout.session.expired', 'expired', 'session.expired'],
  ])('preserves the existing pending-order async %s cancellation', async (
    label,
    type,
    paymentStatus,
    auditAction,
  ) => {
    const eventId = `evt_pending_regression_${label}`;
    seedOrder({ pendingMarker: 'unchanged' });
    const beforeOrder = JSON.parse(JSON.stringify(admin.__get('orders/order-1')));

    const response = await deliver(stripeEvent(
      eventId,
      type,
      orderSession({ payment_status: 'unpaid' }),
    ));
    const order = admin.__get('orders/order-1');
    const ledger = admin.__get(`stripeEvents/${eventId}`);

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: false,
      outcome: `payment_${paymentStatus}`,
      requiresReview: false,
    }));
    expect(order).toMatchObject({
      status: 'cancelled',
      paymentStatus,
      stripePaymentStatus: 'unpaid',
      stripeSessionId: 'cs_order_1',
      stripePaymentIntentId: 'pi_order_1',
      pendingMarker: 'unchanged',
      lastStripeEventId: eventId,
    });
    expect(order.cancelledAt).toBeDefined();
    expect(order.updatedAt).toBeDefined();
    expect(order.auditLog).toHaveLength(1);
    expect(order.auditLog[0]).toMatchObject({
      actorUid: null,
      actorEmail: null,
      action: `order.${auditAction}`,
      note: `event=${eventId}`,
    });
    const changedFields = new Set([
      'auditLog',
      'cancelledAt',
      'lastStripeEventId',
      'paymentStatus',
      'status',
      'stripePaymentIntentId',
      'stripePaymentStatus',
      'stripeSessionId',
      'updatedAt',
    ]);
    const unchangedProjection = (record) => Object.fromEntries(
      Object.entries(record).filter(([field]) => !changedFields.has(field)),
    );
    expect(unchangedProjection(order)).toEqual(unchangedProjection(beforeOrder));
    expect(ledger).toMatchObject({
      status: 'processed',
      outcome: `payment_${paymentStatus}`,
      requiresReview: false,
      targetType: 'order',
      targetPath: 'orders/order-1',
    });
  });

  test.each([
    ['failure_missing', 'checkout.session.async_payment_failed', false, undefined],
    ['expiry_null', 'checkout.session.expired', true, null],
    ['failure_processing', 'checkout.session.async_payment_failed', true, 'processing'],
    ['expiry_failed', 'checkout.session.expired', true, 'failed'],
    ['failure_expired', 'checkout.session.async_payment_failed', true, 'expired'],
    ['expiry_legacy_unknown', 'checkout.session.expired', true, 'legacy_unknown'],
  ])('quarantines async evidence when fulfillment lacks the existing paid marker: %s', async (
    label,
    type,
    hasPaymentStatus,
    paymentStatus,
  ) => {
    const eventId = `evt_fulfilled_unverified_${label}`;
    const privateCanaries = {
      email: `private-email-${label}@example.test`,
      name: `private-name-${label}`,
      line1: `private-address-${label}`,
      city: `private-city-${label}`,
      postalCode: `private-postal-${label}`,
    };
    const recordPatch = {
      status: 'fulfilled',
      fulfilledAt: { _milliseconds: 1_799_999_999_000 },
      fulfillmentReference: 'synthetic-fulfillment-reference',
    };
    if (hasPaymentStatus) recordPatch.paymentStatus = paymentStatus;
    seedOrder(recordPatch);
    const beforeOrder = JSON.parse(JSON.stringify(admin.__get('orders/order-1')));
    const event = stripeEvent(
      eventId,
      type,
      orderSession({
        payment_status: 'unpaid',
        customer_details: { email: privateCanaries.email },
        shipping_details: {
          name: privateCanaries.name,
          address: {
            line1: privateCanaries.line1,
            city: privateCanaries.city,
            postal_code: privateCanaries.postalCode,
            country: 'US',
          },
        },
      }),
    );

    const firstResponse = await deliver(event);
    const replayResponse = await deliver(event);
    const order = admin.__get('orders/order-1');
    const ledger = admin.__get(`stripeEvents/${eventId}`);

    expect(firstResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: false,
      outcome: 'needs_review:fulfilled_without_verified_payment',
      requiresReview: true,
    }));
    expect(replayResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: true,
      outcome: 'needs_review:fulfilled_without_verified_payment',
    }));
    const expectedOrder = {
      status: 'fulfilled',
      fulfilledAt: { _milliseconds: 1_799_999_999_000 },
      fulfillmentReference: 'synthetic-fulfillment-reference',
      paymentReviewRequired: true,
      paymentReviewReason: 'fulfilled_without_verified_payment',
      lastStripeEventId: eventId,
    };
    if (hasPaymentStatus) expectedOrder.paymentStatus = paymentStatus;
    expect(order).toMatchObject(expectedOrder);
    expect(Object.hasOwn(beforeOrder, 'paymentStatus')).toBe(hasPaymentStatus);
    expect(Object.hasOwn(order, 'paymentStatus')).toBe(hasPaymentStatus);
    if (hasPaymentStatus) expect(order.paymentStatus).toBe(paymentStatus);
    expect(order.cancelledAt).toBeUndefined();
    const withoutAllowedReviewMutation = (record) => {
      const unchanged = { ...record };
      [
        'auditLog',
        'updatedAt',
        'paymentReviewRequired',
        'paymentReviewReason',
        'lastStripeEventId',
      ].forEach((field) => delete unchanged[field]);
      return unchanged;
    };
    expect(withoutAllowedReviewMutation(order))
      .toEqual(withoutAllowedReviewMutation(beforeOrder));
    expect(order.updatedAt).toBeDefined();
    expect(order.auditLog).toHaveLength(1);
    expect(order.auditLog[0]).toMatchObject({
      actorUid: null,
      actorEmail: null,
      action: 'order.payment.review_required',
      note: `event=${eventId} reason=fulfilled_without_verified_payment`,
    });
    expect(ledger).toMatchObject({
      status: 'processed',
      outcome: 'needs_review:fulfilled_without_verified_payment',
      requiresReview: true,
      targetType: 'order',
      targetPath: 'orders/order-1',
    });
    const persistedOrExposed = JSON.stringify({
      response: firstResponse.json.mock.calls,
      replay: replayResponse.json.mock.calls,
      order,
      ledger,
      logs: consoleError.mock.calls,
    });
    Object.values(privateCanaries).forEach((canary) => {
      expect(persistedOrExposed).not.toContain(canary);
    });
  });

  test.each([
    ['failure', 'checkout.session.async_payment_failed', 'failed'],
    ['expiry', 'checkout.session.expired', 'expired'],
  ])('ignores an async %s when the fulfilled record has the existing paid marker', async (
    label,
    type,
    reason,
  ) => {
    seedOrder({
      status: 'fulfilled',
      paymentStatus: 'paid',
      paymentReviewRequired: false,
      paymentReviewReason: null,
    });
    const beforeOrder = JSON.parse(JSON.stringify(admin.__get('orders/order-1')));

    await deliver(stripeEvent(
      `evt_verified_fulfilled_${label}`,
      type,
      orderSession({ payment_status: 'unpaid' }),
    ));

    const order = admin.__get('orders/order-1');
    expect(order).toEqual(beforeOrder);
    expect(order.cancelledAt).toBeUndefined();
    expect(admin.__get(`stripeEvents/evt_verified_fulfilled_${label}`)).toMatchObject({
      outcome: `${reason}_ignored:fulfilled`,
      requiresReview: false,
    });
  });

  test.each([
    ['failure', 'checkout.session.async_payment_failed', 'failed'],
    ['expiry', 'checkout.session.expired', 'expired'],
  ])('an ordinary async %s preserves an earlier review flag', async (_label, type, status) => {
    seedRegistration({
      paymentReviewRequired: true,
      paymentReviewReason: 'existing_review_reason',
    });
    await deliver(stripeEvent(
      `evt_preserve_review_${status}`,
      type,
      registrationSession({ payment_status: 'unpaid' }),
    ));

    expect(admin.__get('events/race-1/registrations/reg-1')).toMatchObject({
      status: 'cancelled',
      paymentStatus: status,
      paymentReviewRequired: true,
      paymentReviewReason: 'existing_review_reason',
    });
  });

  test.each([
    [
      'failure discount',
      'checkout.session.async_payment_failed',
      {
        amount_total: 1900,
        payment_status: 'unpaid',
        total_details: { amount_discount: 100, amount_shipping: 0, amount_tax: 0 },
      },
      'discount_not_allowed',
    ],
    [
      'expiry discount',
      'checkout.session.expired',
      {
        amount_total: 1900,
        payment_status: 'unpaid',
        total_details: { amount_discount: 100, amount_shipping: 0, amount_tax: 0 },
      },
      'discount_not_allowed',
    ],
    [
      'failure tax',
      'checkout.session.async_payment_failed',
      {
        amount_total: 2100,
        payment_status: 'unpaid',
        total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 100 },
      },
      'tax_not_configured',
    ],
    [
      'expiry tax',
      'checkout.session.expired',
      {
        amount_total: 2100,
        payment_status: 'unpaid',
        total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 100 },
      },
      'tax_not_configured',
    ],
    [
      'failure shipping',
      'checkout.session.async_payment_failed',
      {
        amount_total: 2100,
        payment_status: 'unpaid',
        total_details: { amount_discount: 0, amount_shipping: 100, amount_tax: 0 },
        shipping_cost: { amount_subtotal: 100, amount_tax: 0, amount_total: 100 },
      },
      'shipping_charge_not_configured',
    ],
    [
      'expiry shipping',
      'checkout.session.expired',
      {
        amount_total: 2100,
        payment_status: 'unpaid',
        total_details: { amount_discount: 0, amount_shipping: 100, amount_tax: 0 },
        shipping_cost: { amount_subtotal: 100, amount_tax: 0, amount_total: 100 },
      },
      'shipping_charge_not_configured',
    ],
    [
      'failure malformed breakdown',
      'checkout.session.async_payment_failed',
      { payment_status: 'unpaid', total_details: null },
      'invalid_stripe_adjustment',
    ],
    [
      'expiry malformed breakdown',
      'checkout.session.expired',
      {
        payment_status: 'unpaid',
        total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
        shipping_cost: { amount_subtotal: 0, amount_tax: 0 },
      },
      'invalid_stripe_adjustment',
    ],
    [
      'failure hidden shipping subtotal',
      'checkout.session.async_payment_failed',
      {
        payment_status: 'unpaid',
        shipping_cost: { amount_subtotal: 100, amount_tax: 0, amount_total: 0 },
      },
      'stripe_shipping_breakdown_mismatch',
    ],
  ])('quarantines an adjusted async %s Session', async (_label, type, patch, reason) => {
    seedOrder();
    const eventId = `evt_adjusted_${_label.replace(/[^A-Za-z0-9]+/g, '_')}`;
    await deliver(stripeEvent(eventId, type, orderSession(patch)));

    const order = admin.__get('orders/order-1');
    expect(order).toMatchObject({
      status: 'cancelled',
      paymentStatus: type === 'checkout.session.expired' ? 'expired' : 'failed',
      paymentReviewRequired: true,
      paymentReviewReason: reason,
    });
    expect(order.cancelledAt).toBeDefined();
    expect(order.paidAt).toBeUndefined();
    expect(order.fulfilledAt).toBeUndefined();
    expect(admin.__get(`stripeEvents/${eventId}`)).toMatchObject({
      outcome: `needs_review:${reason}`,
      requiresReview: true,
    });
  });

  test.each([
    ['failure', 'checkout.session.async_payment_failed'],
    ['expiry', 'checkout.session.expired'],
  ])('quarantines an async %s event whose Session reports paid', async (_label, type) => {
    seedRegistration();
    await deliver(stripeEvent(
      `evt_paid_${_label}`,
      type,
      registrationSession({ payment_status: 'paid' }),
    ));

    expect(admin.__get('events/race-1/registrations/reg-1')).toMatchObject({
      status: 'pending',
      paymentReviewRequired: true,
      paymentReviewReason: 'unsuccessful_event_reports_paid',
    });
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

  test('quarantines a legacy partial refund with an unknown cumulative baseline', async () => {
    seedOrder({
      status: 'partially_refunded',
      paymentStatus: 'partially_refunded',
      stripePaymentIntentId: 'pi_order_1',
      stripeChargeId: 'ch_order_1',
      stripeAmountRefundedCents: undefined,
    });
    await deliver(stripeEvent('evt_unknown_partial_baseline', 'charge.refunded', {
      id: 'ch_order_1',
      object: 'charge',
      payment_intent: 'pi_order_1',
      amount: 2000,
      amount_refunded: 500,
      currency: 'usd',
      metadata: { type: 'merch', orderId: 'order-1' },
    }));

    expect(admin.__get('orders/order-1')).toMatchObject({
      status: 'partially_refunded',
      paymentStatus: 'partially_refunded',
      paymentReviewRequired: true,
      paymentReviewReason: 'unknown_refund_baseline',
    });
    expect(admin.__get('orders/order-1').stripeAmountRefundedCents).toBeUndefined();
    expect(admin.__get('stripeEvents/evt_unknown_partial_baseline')).toMatchObject({
      outcome: 'needs_review:unknown_refund_baseline',
      requiresReview: true,
    });
  });

  test('can safely advance an unknown legacy partial baseline to fully refunded', async () => {
    seedOrder({
      status: 'partially_refunded',
      paymentStatus: 'partially_refunded',
      stripePaymentIntentId: 'pi_order_1',
      stripeChargeId: 'ch_order_1',
      stripeAmountRefundedCents: undefined,
    });
    await deliver(stripeEvent('evt_unknown_partial_to_full', 'charge.refunded', {
      id: 'ch_order_1',
      object: 'charge',
      payment_intent: 'pi_order_1',
      amount: 2000,
      amount_refunded: 2000,
      currency: 'usd',
      metadata: { type: 'merch', orderId: 'order-1' },
    }));

    expect(admin.__get('orders/order-1')).toMatchObject({
      status: 'refunded',
      paymentStatus: 'refunded',
      stripeAmountRefundedCents: 2000,
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
