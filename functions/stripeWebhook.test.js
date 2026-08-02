const { createSignedStripePayload } = require('./testSupport/testSafety');

jest.mock('firebase-admin', () => {
  const store = new Map();
  const readOperations = [];

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
      readOperations.push({ kind: 'document', path: this.path });
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
      readOperations.push({
        kind: 'query',
        collectionPath: this.collectionPath,
        collectionGroup: this.collectionGroup,
      });
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
    __clear: () => {
      store.clear();
      readOperations.length = 0;
    },
    __seed: (path, data) => store.set(path, { ...data }),
    __get: (path) => store.get(path),
    __readOperations: () => readOperations.map((operation) => ({ ...operation })),
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
      now: jest.fn(() => ({ _milliseconds: tick += 1 })),
      fromMillis: jest.fn((milliseconds) => {
        if (!Number.isFinite(milliseconds)
          || milliseconds < -62_135_596_800_000
          || milliseconds > 253_402_300_799_999) {
          throw new RangeError('Timestamp milliseconds out of range');
        }
        return { _milliseconds: milliseconds };
      }),
    },
    FieldValue: { arrayUnion: (...values) => ({ __op: 'arrayUnion', values }) },
  };
});

const admin = require('firebase-admin');
const { Timestamp } = require('firebase-admin/firestore');
const Stripe = require('stripe');

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
const INVALID_REFUND_CHARGE_STATUS_CASES = [
  ['missing', 'delete', undefined],
  ['null', 'value', null],
  ['pending', 'value', 'pending'],
  ['failed', 'value', 'failed'],
  ['empty string', 'value', ''],
  ['unknown string', 'value', 'hostile-status-do-not-log'],
  ['number', 'value', 1],
  ['boolean', 'value', true],
  ['object', 'value', {}],
  ['array', 'value', []],
];
const INVALID_DISPUTE_STATUS_CASES = [
  ['missing', 'delete', undefined],
  ['null', 'value', null],
  ['empty string', 'value', ''],
  ['unknown string', 'value', 'hostile-dispute-status-do-not-log'],
  ['prevented', 'value', 'prevented'],
  ['number', 'value', 1],
  ['boolean', 'value', true],
  ['object', 'value', {}],
  ['array', 'value', []],
];
const DISPUTE_STATUS_EVENT_CASES = [
  ['created', 'charge.dispute.created', 'needs_response'],
  ['updated', 'charge.dispute.updated', 'under_review'],
  ['closed', 'charge.dispute.closed', 'won'],
].flatMap(([lifecycle, type, compatibleStatus]) => (
  INVALID_DISPUTE_STATUS_CASES.map(([evidence, mutation, value]) => [
    lifecycle,
    evidence,
    type,
    compatibleStatus,
    mutation,
    value,
  ])
));
const KNOWN_DISPUTE_STATUSES = [
  'needs_response',
  'under_review',
  'won',
  'lost',
  'warning_needs_response',
  'warning_under_review',
  'warning_closed',
];
const CLOSED_TERMINAL_DISPUTE_STATUSES = ['won', 'lost', 'warning_closed'];
const CLOSED_NONTERMINAL_DISPUTE_STATUSES = KNOWN_DISPUTE_STATUSES.filter(
  (status) => !CLOSED_TERMINAL_DISPUTE_STATUSES.includes(status),
);
const VALID_DISPUTE_STATUS_EVENT_CASES = [
  ['created', 'charge.dispute.created', KNOWN_DISPUTE_STATUSES],
  ['updated', 'charge.dispute.updated', KNOWN_DISPUTE_STATUSES],
  ['closed', 'charge.dispute.closed', CLOSED_TERMINAL_DISPUTE_STATUSES],
].flatMap(([lifecycle, type, statuses]) => (
  statuses.map((status) => [lifecycle, type, status])
));
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
const FIRESTORE_TIMESTAMP_MAX_SECONDS = 253_402_300_799;
const INVALID_DISPUTE_EVENT_CREATED_CASES = [
  ['missing', 'delete', undefined],
  ['null', 'value', null],
  ['negative', 'value', -1],
  ['fractional', 'value', 1.5],
  ['string', 'value', 'hostile-event-created-do-not-log'],
  ['boolean', 'value', true],
  ['object', 'value', { marker: 'hostile-event-created-do-not-log' }],
  ['array', 'value', ['hostile-event-created-do-not-log']],
  ['NaN serialized as null', 'value', Number.NaN],
  ['infinity serialized as null', 'value', Number.POSITIVE_INFINITY],
  ['Firestore maximum plus one', 'value', FIRESTORE_TIMESTAMP_MAX_SECONDS + 1],
  ['maximum safe integer', 'value', Number.MAX_SAFE_INTEGER],
  ['unsafe integer', 'value', Number.MAX_SAFE_INTEGER + 1],
];
const DISPUTE_EVENT_CREATED_CASES = [
  ['created', 'charge.dispute.created', 'needs_response'],
  ['updated', 'charge.dispute.updated', 'under_review'],
  ['closed', 'charge.dispute.closed', 'won'],
].flatMap(([lifecycle, type, status]) => (
  INVALID_DISPUTE_EVENT_CREATED_CASES.map(([evidence, mutation, value]) => [
    lifecycle,
    evidence,
    type,
    status,
    mutation,
    value,
  ])
));
const NON_DISPUTE_EVENT_TYPES = [
  ['Checkout completed', 'checkout.session.completed'],
  ['Checkout async success', 'checkout.session.async_payment_succeeded'],
  ['Checkout async failure', 'checkout.session.async_payment_failed'],
  ['Checkout expired', 'checkout.session.expired'],
  ['refund', 'charge.refunded'],
];
const NON_DISPUTE_EVENT_CREATED_CASES = NON_DISPUTE_EVENT_TYPES.flatMap(
  ([lifecycle, type]) => INVALID_DISPUTE_EVENT_CREATED_CASES.map(
    ([evidence, mutation, value]) => [
      lifecycle,
      evidence,
      type,
      mutation,
      value,
    ],
  ),
);
const REFUND_CHARGE_CREATED_DOMAINS = ['registration', 'order'];
const INVALID_REFUND_CHARGE_CREATED_CASES = [
  ['missing', 'delete', undefined],
  ['null', 'value', null],
  ['negative', 'value', -1],
  ['fractional', 'value', 1.5],
  ['string', 'value', 'hostile-charge-created-do-not-log'],
  ['boolean', 'value', true],
  ['object', 'value', { marker: 'hostile-charge-created-do-not-log' }],
  ['array', 'value', ['hostile-charge-created-do-not-log']],
  ['NaN serialized as null', 'value', Number.NaN],
  ['positive infinity serialized as null', 'value', Number.POSITIVE_INFINITY],
  ['negative infinity serialized as null', 'value', Number.NEGATIVE_INFINITY],
  ['Firestore maximum plus one', 'value', FIRESTORE_TIMESTAMP_MAX_SECONDS + 1],
  ['maximum safe integer', 'value', Number.MAX_SAFE_INTEGER],
  ['unsafe integer', 'value', Number.MAX_SAFE_INTEGER + 1],
];
const REFUND_CHARGE_CREATED_CASES = REFUND_CHARGE_CREATED_DOMAINS.flatMap(
  (domain) => INVALID_REFUND_CHARGE_CREATED_CASES.map(
    ([evidence, mutation, value]) => [domain, evidence, mutation, value],
  ),
);

function stripeEvent(id, type, object) {
  const checkoutStatus = CHECKOUT_SESSION_STATUS_BY_EVENT_TYPE[type];
  let providerObject = object;
  if (checkoutStatus) {
    providerObject = { livemode: false, status: checkoutStatus, ...object };
  } else if (type === 'charge.refunded') {
    providerObject = {
      created: 1_799_999_900,
      livemode: false,
      status: 'succeeded',
      ...object,
    };
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

function nonDisputeEventFixture(type, suffix, { missingTarget = false } = {}) {
  if (type === 'charge.refunded') {
    if (!missingTarget) {
      seedOrder({
        status: 'paid',
        paymentStatus: 'paid',
        stripePaymentIntentId: 'pi_order_1',
        stripeAmountTotalCents: 2000,
      });
    }
    return {
      businessPath: missingTarget ? null : 'orders/order-1',
      event: stripeEvent(
        `evt_pay003a8_${suffix}`,
        type,
        orderRefundCharge({
          id: `ch_pay003a8_${suffix}`,
          metadata: missingTarget ? {
            schemaVersion: '1',
            type: 'merch',
            orderId: 'order-missing',
          } : {
            schemaVersion: '1',
            type: 'merch',
            orderId: 'order-1',
          },
        }),
      ),
    };
  }

  if (!missingTarget) seedRegistration();
  const unpaid = type === 'checkout.session.async_payment_failed'
    || type === 'checkout.session.expired';
  return {
    businessPath: missingTarget ? null : 'events/race-1/registrations/reg-1',
    event: stripeEvent(
      `evt_pay003a8_${suffix}`,
      type,
      registrationSession({
        payment_status: unpaid ? 'unpaid' : 'paid',
        metadata: missingTarget ? {
          schemaVersion: '1',
          eventId: 'race-missing',
          registrationId: 'registration-missing',
          priceTier: 'nonMember',
        } : {
          schemaVersion: '1',
          eventId: 'race-1',
          registrationId: 'reg-1',
          priceTier: 'nonMember',
        },
      }),
    ),
  };
}

function refundChargeCreatedFixture(
  domain,
  suffix,
  { missingTarget = false, existingPaidAt = null } = {},
) {
  const registration = domain === 'registration';
  const businessPath = registration
    ? 'events/race-1/registrations/reg-1'
    : 'orders/order-1';
  const paymentIntentId = `pi_pay003a9_${suffix}`;
  const amount = registration ? 5000 : 2000;
  const metadata = registration ? {
    schemaVersion: '1',
    eventId: missingTarget ? 'race-missing' : 'race-1',
    registrationId: missingTarget ? 'registration-missing' : 'reg-1',
  } : {
    schemaVersion: '1',
    type: 'merch',
    orderId: missingTarget ? 'order-missing' : 'order-1',
  };

  if (!missingTarget) {
    const record = {
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: paymentIntentId,
      stripeAmountTotalCents: amount,
      ...(existingPaidAt ? { paidAt: existingPaidAt } : {}),
    };
    if (registration) seedRegistration(record);
    else seedOrder(record);
  }

  return {
    businessPath: missingTarget ? null : businessPath,
    event: stripeEvent(
      `evt_pay003a9_${suffix}`,
      'charge.refunded',
      {
        id: `ch_pay003a9_${suffix}`,
        object: 'charge',
        payment_intent: paymentIntentId,
        amount,
        amount_refunded: 500,
        currency: 'usd',
        metadata,
        refunds: { data: [{ id: `re_pay003a9_${suffix}` }] },
      },
    ),
  };
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

async function deliverMockedConstructedEvent(event) {
  const transportEvent = stripeEvent(
    'evt_pay003a8_safe_transport',
    'checkout.session.completed',
    registrationSession(),
  );
  const constructEvent = jest.spyOn(Stripe.webhooks, 'constructEvent')
    .mockReturnValueOnce(event);
  try {
    const response = mockResponse();
    await stripeWebhook(signedRequest(transportEvent), response);
    return response;
  } finally {
    constructEvent.mockRestore();
  }
}

function storedCopy(path) {
  return JSON.parse(JSON.stringify(admin.__get(path)));
}

function setMetadataSchema(object, value) {
  object.metadata.schemaVersion = value;
}

function setRefundChargeStatus(charge, mutation, value) {
  if (mutation === 'delete') delete charge.status;
  else charge.status = value;
}

function setDisputeStatus(dispute, mutation, value) {
  if (mutation === 'delete') delete dispute.status;
  else dispute.status = value;
}

function setEventCreated(event, mutation, value) {
  if (mutation === 'delete') delete event.created;
  else event.created = value;
}

function setChargeCreated(charge, mutation, value) {
  if (mutation === 'delete') delete charge.created;
  else charge.created = value;
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

function refundAdmissionObservation({ response, event, businessSnapshots = [] }) {
  const responseBody = response.json.mock.calls.at(-1)?.[0];
  const ledger = admin.__get(`stripeEvents/${event.id}`);
  return {
    httpStatus: response.status.mock.calls.at(-1)?.[0] ?? null,
    response: responseBody ? {
      received: responseBody.received,
      duplicate: responseBody.duplicate,
      outcome: responseBody.outcome,
      requiresReview: responseBody.requiresReview,
    } : null,
    businessUnchanged: businessSnapshots.every(([path, before]) => (
      JSON.stringify(admin.__get(path)) === JSON.stringify(before)
    )),
    ledger: ledger ? {
      status: ledger.status,
      outcome: ledger.outcome,
      requiresReview: ledger.requiresReview,
      targetType: ledger.targetType,
      targetPath: ledger.targetPath,
      targetSource: ledger.targetSource,
    } : null,
    bindingPaths: providerBindingPaths(event).filter(
      (path) => admin.__get(path) !== undefined,
    ),
  };
}

function expectedChargeStatusQuarantine(bindingPaths = []) {
  return {
    httpStatus: null,
    response: {
      received: true,
      duplicate: false,
      outcome: 'needs_review:charge_status_mismatch',
      requiresReview: true,
    },
    businessUnchanged: true,
    ledger: {
      status: 'processed',
      outcome: 'needs_review:charge_status_mismatch',
      requiresReview: true,
      targetType: null,
      targetPath: null,
      targetSource: null,
    },
    bindingPaths,
  };
}

function expectedDisputeStatusQuarantine(bindingPaths = []) {
  return {
    httpStatus: null,
    response: {
      received: true,
      duplicate: false,
      outcome: 'needs_review:invalid_dispute_status',
      requiresReview: true,
    },
    businessUnchanged: true,
    ledger: {
      status: 'processed',
      outcome: 'needs_review:invalid_dispute_status',
      requiresReview: true,
      targetType: null,
      targetPath: null,
      targetSource: null,
    },
    bindingPaths,
  };
}

function expectedEventCreatedQuarantine(bindingPaths = []) {
  return {
    httpStatus: null,
    response: {
      received: true,
      duplicate: false,
      outcome: 'needs_review:invalid_event_created',
      requiresReview: true,
    },
    businessUnchanged: true,
    ledger: {
      status: 'processed',
      outcome: 'needs_review:invalid_event_created',
      requiresReview: true,
      targetType: null,
      targetPath: null,
      targetSource: null,
    },
    bindingPaths,
  };
}

function expectedChargeCreatedQuarantine(bindingPaths = []) {
  return {
    httpStatus: null,
    response: {
      received: true,
      duplicate: false,
      outcome: 'needs_review:invalid_charge_created',
      requiresReview: true,
    },
    businessUnchanged: true,
    ledger: {
      status: 'processed',
      outcome: 'needs_review:invalid_charge_created',
      requiresReview: true,
      targetType: null,
      targetPath: null,
      targetSource: null,
    },
    bindingPaths,
  };
}

function expectedChargeEventChronologyQuarantine(bindingPaths = []) {
  return {
    httpStatus: null,
    response: {
      received: true,
      duplicate: false,
      outcome: 'needs_review:invalid_charge_event_chronology',
      requiresReview: true,
    },
    businessUnchanged: true,
    ledger: {
      status: 'processed',
      outcome: 'needs_review:invalid_charge_event_chronology',
      requiresReview: true,
      targetType: null,
      targetPath: null,
      targetSource: null,
    },
    bindingPaths,
  };
}

function expectOnlyEventLedgerReads(event) {
  expect(admin.__readOperations()).toEqual([
    { kind: 'document', path: `stripeEvents/${event.id}` },
    { kind: 'document', path: `stripeEvents/${event.id}` },
  ]);
}

function expectOnlyEventLedgerTimestamps(event) {
  const ledger = admin.__get(`stripeEvents/${event.id}`);
  expect(Timestamp.fromMillis.mock.calls).toEqual([
    [event.created * 1000],
    [ledger.processedAt._milliseconds],
    [ledger.expiresAt._milliseconds],
  ]);
  expect(ledger.expiresAt._milliseconds - ledger.processedAt._milliseconds)
    .toBe(90 * 24 * 60 * 60 * 1000);
}

function seedPaidDisputeOrder(overrides = {}) {
  seedOrder({
    status: 'paid',
    paymentStatus: 'paid',
    stripePaymentIntentId: 'pi_order_1',
    stripeChargeId: 'ch_order_1',
    stripeAmountTotalCents: 2000,
    ...overrides,
  });
}

describe('stripeWebhook', () => {
  let consoleError;

  beforeAll(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  beforeEach(() => {
    admin.__clear();
    Timestamp.now.mockClear();
    Timestamp.fromMillis.mockClear();
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

  test.each(INVALID_REFUND_CHARGE_STATUS_CASES)(
    'PAY-003A5 quarantines a refund Charge with %s status evidence',
    async (label, mutation, value) => {
      seedOrder({
        status: 'paid',
        paymentStatus: 'paid',
        stripePaymentIntentId: 'pi_order_1',
        stripeAmountTotalCents: 2000,
      });
      const businessPath = 'orders/order-1';
      const before = storedCopy(businessPath);
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const event = stripeEvent(
        `evt_charge_status_${slug}`,
        'charge.refunded',
        orderRefundCharge({ id: `ch_charge_status_${slug}` }),
      );
      setRefundChargeStatus(event.data.object, mutation, value);

      const response = await deliver(event);

      expect(refundAdmissionObservation({
        response,
        event,
        businessSnapshots: [[businessPath, before]],
      })).toEqual(expectedChargeStatusQuarantine());
      expect(consoleError.mock.calls).toEqual([[
        'Stripe event requires review',
        {
          eventId: event.id,
          eventType: 'charge.refunded',
          outcome: 'needs_review:charge_status_mismatch',
          targetType: null,
        },
      ]]);
    },
  );

  test.each([
    [
      'metadata-only claim',
      {},
      { stripePaymentIntentId: 'pi_order_1' },
    ],
    [
      'client-reference-only claim',
      {
        metadata: { schemaVersion: '1' },
        client_reference_id: 'mprc:order:order-1',
      },
      {},
    ],
    [
      'matching dual claim',
      { client_reference_id: 'mprc:order:order-1' },
      {},
    ],
    [
      'legacy PaymentIntent fallback',
      { metadata: {} },
      { stripePaymentIntentId: 'pi_order_1' },
    ],
    [
      'legacy Charge fallback',
      {
        metadata: {},
        payment_intent: 'pi_status_unowned',
      },
      {
        stripePaymentIntentId: null,
        stripeChargeId: 'ch_status_route_legacy_charge_fallback',
      },
    ],
  ])('PAY-003A5 blocks a pending Charge on the %s path', async (
    label,
    chargePatch,
    recordPatch,
  ) => {
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripeAmountTotalCents: 2000,
      ...recordPatch,
    });
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const event = stripeEvent(
      `evt_charge_status_route_${slug}`,
      'charge.refunded',
      orderRefundCharge({
        id: `ch_status_route_${slug}`,
        status: 'pending',
        ...chargePatch,
      }),
    );

    const response = await deliver(event);

    expect(refundAdmissionObservation({
      response,
      event,
      businessSnapshots: [[businessPath, before]],
    })).toEqual(expectedChargeStatusQuarantine());
  });

  test('PAY-003A5 blocks a pending unmatched refund before target handling', async () => {
    const event = stripeEvent(
      'evt_charge_status_unmatched',
      'charge.refunded',
      orderRefundCharge({
        id: 'ch_charge_status_unmatched',
        payment_intent: 'pi_charge_status_unmatched',
        metadata: {},
        status: 'pending',
      }),
    );

    const response = await deliver(event);

    expect(refundAdmissionObservation({ response, event }))
      .toEqual(expectedChargeStatusQuarantine());
  });

  test('PAY-003A5 blocks an invalid Charge before ambiguous fallback queries', async () => {
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_charge_status_ambiguous',
      stripeAmountTotalCents: 2000,
    });
    seedRegistration({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_charge_status_ambiguous',
      stripeAmountTotalCents: 5000,
    });
    const snapshots = [
      ['orders/order-1', storedCopy('orders/order-1')],
      [
        'events/race-1/registrations/reg-1',
        storedCopy('events/race-1/registrations/reg-1'),
      ],
    ];
    const event = stripeEvent(
      'evt_charge_status_ambiguous',
      'charge.refunded',
      orderRefundCharge({
        id: 'ch_charge_status_ambiguous',
        payment_intent: 'pi_charge_status_ambiguous',
        metadata: {},
        status: 'pending',
      }),
    );

    const response = await deliver(event);

    expect(refundAdmissionObservation({
      response,
      event,
      businessSnapshots: snapshots,
    })).toEqual(expectedChargeStatusQuarantine());
  });

  test('PAY-003A5 blocks invalid status before provider-binding conflict reads', async () => {
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_charge_status_binding',
      stripeAmountTotalCents: 2000,
    });
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const chargeBindingPath = 'stripeObjectBindings/charge:ch_charge_status_binding';
    admin.__seed(chargeBindingPath, {
      providerObjectType: 'charge',
      providerObjectId: 'ch_charge_status_binding',
      targetType: 'registration',
      targetPath: 'events/other/registrations/other',
      firstEventId: 'evt_other',
    });
    const beforeBinding = storedCopy(chargeBindingPath);
    const event = stripeEvent(
      'evt_charge_status_binding_conflict',
      'charge.refunded',
      orderRefundCharge({
        id: 'ch_charge_status_binding',
        payment_intent: 'pi_charge_status_binding',
        status: 'pending',
      }),
    );

    const response = await deliver(event);

    expect(refundAdmissionObservation({
      response,
      event,
      businessSnapshots: [[businessPath, before]],
    })).toEqual(expectedChargeStatusQuarantine([chargeBindingPath]));
    expect(admin.__get(chargeBindingPath)).toEqual(beforeBinding);
    expect(admin.__get(
      'stripeObjectBindings/payment_intent:pi_charge_status_binding',
    )).toBeUndefined();
  });

  test.each([
    [
      'outer Event realm',
      'livemode_mismatch',
      (event) => { event.livemode = true; },
    ],
    [
      'embedded Charge realm',
      'charge_livemode_mismatch',
      (event) => { event.data.object.livemode = true; },
    ],
    [
      'metadata schema',
      'charge_status_mismatch',
      (event) => { setMetadataSchema(event.data.object, '2'); },
    ],
    [
      'malformed reference',
      'charge_status_mismatch',
      (event) => {
        Object.assign(event.data.object.metadata, {
          eventId: 'race-1',
          registrationId: 'reg-1',
        });
      },
    ],
  ])('PAY-003A5 keeps %s precedence at the Charge-status boundary', async (
    _label,
    reason,
    mutate,
  ) => {
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_order_1',
      stripeAmountTotalCents: 2000,
    });
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const event = stripeEvent(
      `evt_charge_status_precedence_${reason}`,
      'charge.refunded',
      orderRefundCharge({
        id: `ch_charge_status_precedence_${reason}`,
        status: 'pending',
      }),
    );
    mutate(event);

    const response = await deliver(event);

    expectCompatibilityQuarantine({ response, event, businessPath, before, reason });
  });

  test('PAY-003A5 processes invalid status before a claimed missing target', async () => {
    const event = stripeEvent(
      'evt_charge_status_invalid_missing_target',
      'charge.refunded',
      orderRefundCharge({
        id: 'ch_charge_status_invalid_missing_target',
        payment_intent: 'pi_charge_status_invalid_missing_target',
        metadata: {
          schemaVersion: '1',
          type: 'merch',
          orderId: 'order-missing',
        },
        status: 'pending',
      }),
    );

    const response = await deliver(event);

    expect(refundAdmissionObservation({ response, event }))
      .toEqual(expectedChargeStatusQuarantine());
  });

  test('PAY-003A5 keeps exact-succeeded missing targets retryable', async () => {
    const event = stripeEvent(
      'evt_charge_status_succeeded_missing_target',
      'charge.refunded',
      orderRefundCharge({
        id: 'ch_charge_status_succeeded_missing_target',
        payment_intent: 'pi_charge_status_succeeded_missing_target',
        metadata: {
          schemaVersion: '1',
          type: 'merch',
          orderId: 'order-missing',
        },
      }),
    );

    const response = await deliver(event);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(admin.__get(`stripeEvents/${event.id}`)).toBeUndefined();
    providerBindingPaths(event).forEach((path) => {
      expect(admin.__get(path)).toBeUndefined();
    });
  });

  test('PAY-003A5 deduplicates rejected status without mutation or bindings', async () => {
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_order_1',
      stripeAmountTotalCents: 2000,
    });
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const event = stripeEvent(
      'evt_charge_status_replay',
      'charge.refunded',
      orderRefundCharge({ id: 'ch_charge_status_replay', status: 'pending' }),
    );

    const firstResponse = await deliver(event);
    const replayResponse = await deliver(event);

    expect(refundAdmissionObservation({
      response: firstResponse,
      event,
      businessSnapshots: [[businessPath, before]],
    })).toEqual(expectedChargeStatusQuarantine());
    expect(replayResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: true,
      outcome: 'needs_review:charge_status_mismatch',
    }));
    expect(admin.__get(businessPath)).toEqual(before);
  });

  test('PAY-003A5 preserves an already-processed Event before status admission', async () => {
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_order_1',
      stripeAmountTotalCents: 2000,
    });
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const event = stripeEvent(
      'evt_charge_status_already_processed',
      'charge.refunded',
      orderRefundCharge({ status: 'pending' }),
    );
    const ledgerPath = `stripeEvents/${event.id}`;
    admin.__seed(ledgerPath, {
      status: 'processed',
      outcome: 'legacy_processed_outcome',
      targetPath: 'orders/legacy-target',
      sentinel: { preserve: true },
    });
    const beforeLedger = storedCopy(ledgerPath);

    const response = await deliver(event);

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: true,
      outcome: 'legacy_processed_outcome',
    }));
    expect(admin.__get(businessPath)).toEqual(before);
    expect(admin.__get(ledgerPath)).toEqual(beforeLedger);
    providerBindingPaths(event).forEach((path) => {
      expect(admin.__get(path)).toBeUndefined();
    });
  });

  test('PAY-003A5 admits an exact-succeeded metadata refund Charge', async () => {
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_order_1',
      stripeAmountTotalCents: 2000,
    });
    const event = stripeEvent(
      'evt_charge_status_succeeded_metadata',
      'charge.refunded',
      orderRefundCharge({ id: 'ch_charge_status_succeeded_metadata' }),
    );

    const response = await deliver(event);

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: false,
      outcome: 'partially_refunded',
    }));
    expect(admin.__get('orders/order-1')).toMatchObject({
      paymentStatus: 'partially_refunded',
      stripeChargeId: 'ch_charge_status_succeeded_metadata',
    });
  });

  test.each([
    [
      'PaymentIntent',
      { metadata: {} },
      { stripePaymentIntentId: 'pi_order_1' },
      'payment_intent_query',
    ],
    [
      'Charge',
      { metadata: {}, payment_intent: 'pi_status_positive_unowned' },
      { stripeChargeId: 'ch_charge_status_positive_charge' },
      'charge_query',
    ],
  ])('PAY-003A5 admits exact-succeeded legacy %s fallback', async (
    label,
    chargePatch,
    recordPatch,
    targetSource,
  ) => {
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripeAmountTotalCents: 2000,
      ...recordPatch,
    });
    const slug = label.toLowerCase();
    const event = stripeEvent(
      `evt_charge_status_positive_${slug}`,
      'charge.refunded',
      orderRefundCharge({
        id: `ch_charge_status_positive_${slug}`,
        ...chargePatch,
      }),
    );

    const response = await deliver(event);

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'partially_refunded',
    }));
    expect(admin.__get(`stripeEvents/${event.id}`)).toMatchObject({
      targetSource,
      targetPath: 'orders/order-1',
    });
  });

  test('PAY-003A5 keeps an exact-succeeded unmatched refund in review', async () => {
    const event = stripeEvent(
      'evt_charge_status_succeeded_unmatched',
      'charge.refunded',
      orderRefundCharge({
        id: 'ch_charge_status_succeeded_unmatched',
        payment_intent: 'pi_charge_status_succeeded_unmatched',
        metadata: {},
      }),
    );

    const response = await deliver(event);

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: false,
      outcome: 'needs_review:unmatched_refund',
      requiresReview: true,
    }));
    expect(admin.__get(`stripeEvents/${event.id}`)).toMatchObject({
      targetType: null,
      targetPath: null,
      targetSource: null,
    });
  });

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

  test.each(DISPUTE_STATUS_EVENT_CASES)(
    'PAY-003A6 quarantines a %s Dispute with %s status evidence',
    async (lifecycle, evidence, type, compatibleStatus, mutation, value) => {
      seedPaidDisputeOrder();
      const businessPath = 'orders/order-1';
      const before = storedCopy(businessPath);
      const slug = evidence.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const event = stripeEvent(
        `evt_dispute_status_${lifecycle}_${slug}`,
        type,
        orderDispute({
          id: `dp_dispute_status_${lifecycle}_${slug}`,
          status: compatibleStatus,
        }),
      );
      setDisputeStatus(event.data.object, mutation, value);

      const response = await deliver(event);

      expect(refundAdmissionObservation({
        response,
        event,
        businessSnapshots: [[businessPath, before]],
      })).toEqual(expectedDisputeStatusQuarantine());
      expect(consoleError.mock.calls).toEqual([[
        'Stripe event requires review',
        {
          eventId: event.id,
          eventType: type,
          outcome: 'needs_review:invalid_dispute_status',
          targetType: null,
        },
      ]]);
    },
  );

  test.each(CLOSED_NONTERMINAL_DISPUTE_STATUSES)(
    'PAY-003A6 quarantines a closed Dispute with known nonterminal %s status',
    async (status) => {
      seedPaidDisputeOrder();
      const businessPath = 'orders/order-1';
      const before = storedCopy(businessPath);
      const slug = status.replace(/[^a-z]+/g, '_');
      const event = stripeEvent(
        `evt_dispute_status_closed_${slug}`,
        'charge.dispute.closed',
        orderDispute({ id: `dp_dispute_status_closed_${slug}`, status }),
      );

      const response = await deliver(event);

      expect(refundAdmissionObservation({
        response,
        event,
        businessSnapshots: [[businessPath, before]],
      })).toEqual(expectedDisputeStatusQuarantine());
    },
  );

  test.each([
    ['metadata-only claim', {}, {}],
    [
      'client-reference-only claim',
      {
        metadata: { schemaVersion: '1' },
        client_reference_id: 'mprc:order:order-1',
      },
      {},
    ],
    [
      'matching dual claim',
      { client_reference_id: 'mprc:order:order-1' },
      {},
    ],
    [
      'legacy PaymentIntent fallback',
      { metadata: {} },
      {},
    ],
    [
      'legacy Charge fallback',
      { metadata: {}, payment_intent: 'pi_dispute_status_unowned' },
      { stripePaymentIntentId: null },
    ],
  ])('PAY-003A6 blocks an unknown Dispute status on the %s path', async (
    label,
    disputePatch,
    recordPatch,
  ) => {
    seedPaidDisputeOrder(recordPatch);
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const event = stripeEvent(
      `evt_dispute_status_route_${slug}`,
      'charge.dispute.updated',
      orderDispute({
        id: `dp_dispute_status_route_${slug}`,
        status: 'hostile-dispute-status-do-not-log',
        ...disputePatch,
      }),
    );

    const response = await deliver(event);

    expect(refundAdmissionObservation({
      response,
      event,
      businessSnapshots: [[businessPath, before]],
    })).toEqual(expectedDisputeStatusQuarantine());
  });

  test('PAY-003A6 blocks an invalid unmatched Dispute before target handling', async () => {
    const event = stripeEvent(
      'evt_dispute_status_unmatched',
      'charge.dispute.updated',
      orderDispute({
        id: 'dp_dispute_status_unmatched',
        charge: 'ch_dispute_status_unmatched',
        payment_intent: 'pi_dispute_status_unmatched',
        metadata: {},
        status: 'hostile-dispute-status-do-not-log',
      }),
    );

    const response = await deliver(event);

    expect(refundAdmissionObservation({ response, event }))
      .toEqual(expectedDisputeStatusQuarantine());
  });

  test('PAY-003A6 blocks an invalid Dispute before ambiguous fallback queries', async () => {
    seedPaidDisputeOrder({ stripePaymentIntentId: 'pi_dispute_status_ambiguous' });
    seedRegistration({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_dispute_status_ambiguous',
      stripeChargeId: 'ch_registration_dispute_status_ambiguous',
      stripeAmountTotalCents: 5000,
    });
    const snapshots = [
      ['orders/order-1', storedCopy('orders/order-1')],
      [
        'events/race-1/registrations/reg-1',
        storedCopy('events/race-1/registrations/reg-1'),
      ],
    ];
    const event = stripeEvent(
      'evt_dispute_status_ambiguous',
      'charge.dispute.updated',
      orderDispute({
        id: 'dp_dispute_status_ambiguous',
        charge: 'ch_dispute_status_ambiguous',
        payment_intent: 'pi_dispute_status_ambiguous',
        metadata: {},
        status: 'hostile-dispute-status-do-not-log',
      }),
    );

    const response = await deliver(event);

    expect(refundAdmissionObservation({
      response,
      event,
      businessSnapshots: snapshots,
    })).toEqual(expectedDisputeStatusQuarantine());
  });

  test('PAY-003A6 blocks invalid status before provider-binding conflict reads', async () => {
    seedPaidDisputeOrder();
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const disputeBindingPath = 'stripeObjectBindings/dispute:dp_dispute_status_binding';
    admin.__seed(disputeBindingPath, {
      providerObjectType: 'dispute',
      providerObjectId: 'dp_dispute_status_binding',
      targetType: 'registration',
      targetPath: 'events/other/registrations/other',
      firstEventId: 'evt_other',
    });
    const beforeBinding = storedCopy(disputeBindingPath);
    const event = stripeEvent(
      'evt_dispute_status_binding_conflict',
      'charge.dispute.updated',
      orderDispute({
        id: 'dp_dispute_status_binding',
        status: 'hostile-dispute-status-do-not-log',
      }),
    );

    const response = await deliver(event);

    expect(refundAdmissionObservation({
      response,
      event,
      businessSnapshots: [[businessPath, before]],
    })).toEqual(expectedDisputeStatusQuarantine([disputeBindingPath]));
    expect(admin.__get(disputeBindingPath)).toEqual(beforeBinding);
    expect(admin.__get('stripeObjectBindings/charge:ch_order_1')).toBeUndefined();
    expect(admin.__get('stripeObjectBindings/payment_intent:pi_order_1')).toBeUndefined();
  });

  test.each([
    [
      'outer Event realm',
      'livemode_mismatch',
      (event) => { event.livemode = true; },
    ],
    [
      'embedded Dispute realm',
      'dispute_livemode_mismatch',
      (event) => { event.data.object.livemode = true; },
    ],
    [
      'metadata schema',
      'invalid_dispute_status',
      (event) => { setMetadataSchema(event.data.object, '2'); },
    ],
    [
      'malformed reference',
      'invalid_dispute_status',
      (event) => {
        Object.assign(event.data.object.metadata, {
          eventId: 'race-1',
          registrationId: 'reg-1',
        });
      },
    ],
  ])('PAY-003A6 keeps %s precedence at the Dispute-status boundary', async (
    label,
    reason,
    mutate,
  ) => {
    seedPaidDisputeOrder();
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const event = stripeEvent(
      `evt_dispute_status_precedence_${slug}`,
      'charge.dispute.updated',
      orderDispute({
        id: `dp_dispute_status_precedence_${slug}`,
        status: 'hostile-dispute-status-do-not-log',
      }),
    );
    mutate(event);

    const response = await deliver(event);

    expectCompatibilityQuarantine({ response, event, businessPath, before, reason });
  });

  test.each([
    ['object binding', (event) => { event.data.object.object = 'charge'; }],
    ['currency', (event) => { event.data.object.currency = 'cad'; }],
    ['amount', (event) => { event.data.object.amount = 0; }],
    ['Event timestamp', (event) => { event.created = -1; }],
  ])('PAY-003A6 keeps invalid status ahead of %s evaluation', async (
    label,
    mutate,
  ) => {
    seedPaidDisputeOrder();
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const event = stripeEvent(
      `evt_dispute_status_later_${slug}`,
      'charge.dispute.updated',
      orderDispute({
        id: `dp_dispute_status_later_${slug}`,
        status: 'hostile-dispute-status-do-not-log',
      }),
    );
    mutate(event);

    const response = await deliver(event);

    expect(refundAdmissionObservation({
      response,
      event,
      businessSnapshots: [[businessPath, before]],
    })).toEqual(expectedDisputeStatusQuarantine());
  });

  test('PAY-003A6 processes invalid status before a claimed missing target', async () => {
    const event = stripeEvent(
      'evt_dispute_status_invalid_missing_target',
      'charge.dispute.updated',
      orderDispute({
        id: 'dp_dispute_status_invalid_missing_target',
        charge: 'ch_dispute_status_invalid_missing_target',
        payment_intent: 'pi_dispute_status_invalid_missing_target',
        metadata: {
          schemaVersion: '1',
          type: 'merch',
          orderId: 'order-missing',
        },
        status: 'hostile-dispute-status-do-not-log',
      }),
    );

    const response = await deliver(event);

    expect(refundAdmissionObservation({ response, event }))
      .toEqual(expectedDisputeStatusQuarantine());
  });

  test('PAY-003A6 keeps a compatible claimed missing target retryable', async () => {
    const event = stripeEvent(
      'evt_dispute_status_compatible_missing_target',
      'charge.dispute.updated',
      orderDispute({
        id: 'dp_dispute_status_compatible_missing_target',
        charge: 'ch_dispute_status_compatible_missing_target',
        payment_intent: 'pi_dispute_status_compatible_missing_target',
        metadata: {
          schemaVersion: '1',
          type: 'merch',
          orderId: 'order-missing',
        },
        status: 'under_review',
      }),
    );

    const response = await deliver(event);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(admin.__get(`stripeEvents/${event.id}`)).toBeUndefined();
    providerBindingPaths(event).forEach((path) => {
      expect(admin.__get(path)).toBeUndefined();
    });
  });

  test('PAY-003A6 deduplicates rejected status without mutation or bindings', async () => {
    seedPaidDisputeOrder();
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const event = stripeEvent(
      'evt_dispute_status_replay',
      'charge.dispute.updated',
      orderDispute({
        id: 'dp_dispute_status_replay',
        status: 'hostile-dispute-status-do-not-log',
      }),
    );

    const firstResponse = await deliver(event);
    const ledgerPath = `stripeEvents/${event.id}`;
    const afterFirstLedger = storedCopy(ledgerPath);
    const replayResponse = await deliver(event);

    expect(refundAdmissionObservation({
      response: firstResponse,
      event,
      businessSnapshots: [[businessPath, before]],
    })).toEqual(expectedDisputeStatusQuarantine());
    expect(replayResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: true,
      outcome: 'needs_review:invalid_dispute_status',
    }));
    expect(admin.__get(businessPath)).toEqual(before);
    expect(admin.__get(ledgerPath)).toEqual(afterFirstLedger);
  });

  test('PAY-003A6 preserves an already-processed Event before status admission', async () => {
    seedPaidDisputeOrder();
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const event = stripeEvent(
      'evt_dispute_status_already_processed',
      'charge.dispute.updated',
      orderDispute({ status: 'hostile-dispute-status-do-not-log' }),
    );
    const ledgerPath = `stripeEvents/${event.id}`;
    admin.__seed(ledgerPath, {
      status: 'processed',
      outcome: 'legacy_processed_outcome',
      targetPath: 'orders/legacy-target',
      sentinel: { preserve: true },
    });
    const beforeLedger = storedCopy(ledgerPath);

    const response = await deliver(event);

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: true,
      outcome: 'legacy_processed_outcome',
    }));
    expect(admin.__get(businessPath)).toEqual(before);
    expect(admin.__get(ledgerPath)).toEqual(beforeLedger);
    providerBindingPaths(event).forEach((path) => {
      expect(admin.__get(path)).toBeUndefined();
    });
  });

  test.each(VALID_DISPUTE_STATUS_EVENT_CASES)(
    'PAY-003A6 admits a compatible %s Dispute lifecycle with %s status',
    async (
    lifecycle,
    type,
    status,
  ) => {
    seedPaidDisputeOrder();
    const slug = status.replace(/[^a-z]+/g, '_');
    const event = stripeEvent(
      `evt_dispute_status_compatible_${lifecycle}_${slug}`,
      type,
      orderDispute({ id: `dp_dispute_status_compatible_${lifecycle}_${slug}`, status }),
    );

    const response = await deliver(event);

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: false,
      outcome: `dispute_${status}`,
    }));
    expect(admin.__get('orders/order-1')).toMatchObject({
      disputeStatus: status,
      stripeDisputeId: `dp_dispute_status_compatible_${lifecycle}_${slug}`,
    });
    },
  );

  test.each([
    [
      'PaymentIntent',
      { metadata: {} },
      {},
      'payment_intent_query',
    ],
    [
      'Charge',
      { metadata: {}, payment_intent: 'pi_dispute_status_positive_unowned' },
      { stripePaymentIntentId: null },
      'charge_query',
    ],
  ])('PAY-003A6 admits compatible legacy %s fallback', async (
    label,
    disputePatch,
    recordPatch,
    targetSource,
  ) => {
    seedPaidDisputeOrder(recordPatch);
    const slug = label.toLowerCase();
    const event = stripeEvent(
      `evt_dispute_status_positive_${slug}`,
      'charge.dispute.updated',
      orderDispute({
        id: `dp_dispute_status_positive_${slug}`,
        status: 'under_review',
        ...disputePatch,
      }),
    );

    const response = await deliver(event);

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'dispute_under_review',
    }));
    expect(admin.__get(`stripeEvents/${event.id}`)).toMatchObject({
      targetSource,
      targetPath: 'orders/order-1',
    });
  });

  test.each(DISPUTE_EVENT_CREATED_CASES)(
    'PAY-003A7 quarantines a %s Dispute with %s Event-created evidence',
    async (lifecycle, evidence, type, status, mutation, value) => {
      seedPaidDisputeOrder();
      const businessPath = 'orders/order-1';
      const before = storedCopy(businessPath);
      const slug = `${lifecycle}_${evidence}`.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const event = stripeEvent(
        `evt_dispute_time_${slug}`,
        type,
        orderDispute({ id: `dp_dispute_time_${slug}`, status }),
      );
      setEventCreated(event, mutation, value);

      const response = await deliver(event);

      expect(refundAdmissionObservation({
        response,
        event,
        businessSnapshots: [[businessPath, before]],
      })).toEqual(expectedEventCreatedQuarantine());
      expect(admin.__get(`stripeEvents/${event.id}`)).toMatchObject({
        stripeCreatedAt: null,
      });
      expectOnlyEventLedgerReads(event);
      if (Number.isSafeInteger(value)
        && value > FIRESTORE_TIMESTAMP_MAX_SECONDS) {
        expect(Timestamp.fromMillis).not.toHaveBeenCalledWith(value * 1000);
      }
      expect(consoleError).toHaveBeenCalledWith(
        'Stripe event requires review',
        {
          eventId: event.id,
          eventType: type,
          outcome: 'needs_review:invalid_event_created',
          targetType: null,
        },
      );
      expect(JSON.stringify(consoleError.mock.calls))
        .not.toContain('hostile-event-created-do-not-log');
    },
  );

  test.each([
    ['metadata-only claim', {}, {}],
    [
      'client-reference-only claim',
      {
        metadata: { schemaVersion: '1' },
        client_reference_id: 'mprc:order:order-1',
      },
      {},
    ],
    [
      'matching dual claim',
      { client_reference_id: 'mprc:order:order-1' },
      {},
    ],
    [
      'legacy PaymentIntent fallback',
      { metadata: {} },
      {},
    ],
    [
      'legacy Charge fallback',
      { metadata: {}, payment_intent: 'pi_dispute_time_unowned' },
      { stripePaymentIntentId: null },
    ],
  ])('PAY-003A7 blocks invalid Event time on the %s path', async (
    label,
    disputePatch,
    recordPatch,
  ) => {
    seedPaidDisputeOrder(recordPatch);
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const event = stripeEvent(
      `evt_dispute_time_route_${slug}`,
      'charge.dispute.updated',
      orderDispute({
        id: `dp_dispute_time_route_${slug}`,
        status: 'under_review',
        ...disputePatch,
      }),
    );
    event.created = -1;

    const response = await deliver(event);

    expect(refundAdmissionObservation({
      response,
      event,
      businessSnapshots: [[businessPath, before]],
    })).toEqual(expectedEventCreatedQuarantine());
    expectOnlyEventLedgerReads(event);
  });

  test('PAY-003A7 blocks invalid Event time before unmatched target handling', async () => {
    const event = stripeEvent(
      'evt_dispute_time_unmatched',
      'charge.dispute.updated',
      orderDispute({
        id: 'dp_dispute_time_unmatched',
        charge: 'ch_dispute_time_unmatched',
        payment_intent: 'pi_dispute_time_unmatched',
        metadata: {},
        status: 'under_review',
      }),
    );
    event.created = -1;

    const response = await deliver(event);

    expect(refundAdmissionObservation({ response, event }))
      .toEqual(expectedEventCreatedQuarantine());
    expectOnlyEventLedgerReads(event);
  });

  test('PAY-003A7 processes invalid Event time before a claimed missing target', async () => {
    const event = stripeEvent(
      'evt_dispute_time_missing_target',
      'charge.dispute.updated',
      orderDispute({
        id: 'dp_dispute_time_missing_target',
        charge: 'ch_dispute_time_missing_target',
        payment_intent: 'pi_dispute_time_missing_target',
        metadata: {
          schemaVersion: '1',
          type: 'merch',
          orderId: 'order-missing',
        },
        status: 'under_review',
      }),
    );
    event.created = -1;

    const response = await deliver(event);

    expect(refundAdmissionObservation({ response, event }))
      .toEqual(expectedEventCreatedQuarantine());
    expectOnlyEventLedgerReads(event);
  });

  test('PAY-003A7 blocks invalid Event time before ambiguous fallback queries', async () => {
    seedPaidDisputeOrder({ stripePaymentIntentId: 'pi_dispute_time_ambiguous' });
    seedRegistration({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_dispute_time_ambiguous',
      stripeChargeId: 'ch_registration_dispute_time_ambiguous',
      stripeAmountTotalCents: 5000,
    });
    const snapshots = [
      ['orders/order-1', storedCopy('orders/order-1')],
      [
        'events/race-1/registrations/reg-1',
        storedCopy('events/race-1/registrations/reg-1'),
      ],
    ];
    const event = stripeEvent(
      'evt_dispute_time_ambiguous',
      'charge.dispute.updated',
      orderDispute({
        id: 'dp_dispute_time_ambiguous',
        charge: 'ch_dispute_time_ambiguous',
        payment_intent: 'pi_dispute_time_ambiguous',
        metadata: {},
        status: 'under_review',
      }),
    );
    event.created = -1;

    const response = await deliver(event);

    expect(refundAdmissionObservation({
      response,
      event,
      businessSnapshots: snapshots,
    })).toEqual(expectedEventCreatedQuarantine());
    expectOnlyEventLedgerReads(event);
  });

  test('PAY-003A7 blocks invalid Event time before provider-binding conflicts', async () => {
    seedPaidDisputeOrder();
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const disputeBindingPath = 'stripeObjectBindings/dispute:dp_dispute_time_binding';
    admin.__seed(disputeBindingPath, {
      providerObjectType: 'dispute',
      providerObjectId: 'dp_dispute_time_binding',
      targetType: 'registration',
      targetPath: 'events/other/registrations/other',
      firstEventId: 'evt_other',
    });
    const beforeBinding = storedCopy(disputeBindingPath);
    const event = stripeEvent(
      'evt_dispute_time_binding_conflict',
      'charge.dispute.updated',
      orderDispute({
        id: 'dp_dispute_time_binding',
        status: 'under_review',
      }),
    );
    event.created = -1;

    const response = await deliver(event);

    expect(refundAdmissionObservation({
      response,
      event,
      businessSnapshots: [[businessPath, before]],
    })).toEqual(expectedEventCreatedQuarantine([disputeBindingPath]));
    expect(admin.__get(disputeBindingPath)).toEqual(beforeBinding);
    expect(admin.__get('stripeObjectBindings/charge:ch_order_1')).toBeUndefined();
    expect(admin.__get('stripeObjectBindings/payment_intent:pi_order_1')).toBeUndefined();
    expectOnlyEventLedgerReads(event);
  });

  test.each([
    [
      'outer Event realm',
      'livemode_mismatch',
      (event) => { event.livemode = true; },
    ],
    [
      'embedded Dispute realm',
      'dispute_livemode_mismatch',
      (event) => { event.data.object.livemode = true; },
    ],
    [
      'Event/status compatibility',
      'invalid_dispute_status',
      (event) => { event.data.object.status = 'hostile-dispute-status-do-not-log'; },
    ],
    [
      'metadata schema',
      'metadata_schema_version_mismatch',
      (event) => { setMetadataSchema(event.data.object, '2'); },
    ],
  ])('PAY-003A7 keeps %s precedence at the Event-created boundary', async (
    label,
    reason,
    mutate,
  ) => {
    seedPaidDisputeOrder();
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const event = stripeEvent(
      `evt_dispute_time_precedence_${slug}`,
      'charge.dispute.updated',
      orderDispute({
        id: `dp_dispute_time_precedence_${slug}`,
        status: 'under_review',
      }),
    );
    event.created = FIRESTORE_TIMESTAMP_MAX_SECONDS + 1;
    mutate(event);

    const response = await deliver(event);

    expectCompatibilityQuarantine({ response, event, businessPath, before, reason });
    expect(admin.__get(`stripeEvents/${event.id}`)).toMatchObject({
      stripeCreatedAt: null,
    });
    expectOnlyEventLedgerReads(event);
    expect(Timestamp.fromMillis).not.toHaveBeenCalledWith(
      (FIRESTORE_TIMESTAMP_MAX_SECONDS + 1) * 1000,
    );
  });

  test.each([
    ['malformed reference', (event) => {
      Object.assign(event.data.object.metadata, {
        eventId: 'race-1',
        registrationId: 'reg-1',
      });
    }],
    ['object binding', (event) => { event.data.object.object = 'charge'; }],
    ['currency', (event) => { event.data.object.currency = 'cad'; }],
    ['amount', (event) => { event.data.object.amount = 0; }],
  ])('PAY-003A7 keeps invalid Event time ahead of %s evaluation', async (
    label,
    mutate,
  ) => {
    seedPaidDisputeOrder();
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const event = stripeEvent(
      `evt_dispute_time_later_${slug}`,
      'charge.dispute.updated',
      orderDispute({
        id: `dp_dispute_time_later_${slug}`,
        status: 'under_review',
      }),
    );
    event.created = -1;
    mutate(event);

    const response = await deliver(event);

    expect(refundAdmissionObservation({
      response,
      event,
      businessSnapshots: [[businessPath, before]],
    })).toEqual(expectedEventCreatedQuarantine());
    expectOnlyEventLedgerReads(event);
  });

  test('PAY-003A7 deduplicates rejected Event time without mutation or bindings', async () => {
    seedPaidDisputeOrder();
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const event = stripeEvent(
      'evt_dispute_time_replay',
      'charge.dispute.updated',
      orderDispute({ id: 'dp_dispute_time_replay', status: 'under_review' }),
    );
    event.created = -1;

    const firstResponse = await deliver(event);
    const ledgerPath = `stripeEvents/${event.id}`;
    const afterFirstLedger = storedCopy(ledgerPath);
    const replayResponse = await deliver(event);

    expect(refundAdmissionObservation({
      response: firstResponse,
      event,
      businessSnapshots: [[businessPath, before]],
    })).toEqual(expectedEventCreatedQuarantine());
    expect(replayResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: true,
      outcome: 'needs_review:invalid_event_created',
    }));
    expect(admin.__get(businessPath)).toEqual(before);
    expect(admin.__get(ledgerPath)).toEqual(afterFirstLedger);
    providerBindingPaths(event).forEach((path) => {
      expect(admin.__get(path)).toBeUndefined();
    });
  });

  test('PAY-003A7 preserves a richer processed Event before timestamp admission', async () => {
    seedPaidDisputeOrder();
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const event = stripeEvent(
      'evt_dispute_time_already_processed',
      'charge.dispute.updated',
      orderDispute({ status: 'under_review' }),
    );
    event.created = -1;
    const ledgerPath = `stripeEvents/${event.id}`;
    admin.__seed(ledgerPath, {
      status: 'processed',
      outcome: 'legacy_processed_outcome',
      targetPath: 'orders/legacy-target',
      sentinel: { preserve: true },
    });
    const beforeLedger = storedCopy(ledgerPath);

    const response = await deliver(event);

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: true,
      outcome: 'legacy_processed_outcome',
    }));
    expect(admin.__get(businessPath)).toEqual(before);
    expect(admin.__get(ledgerPath)).toEqual(beforeLedger);
    providerBindingPaths(event).forEach((path) => {
      expect(admin.__get(path)).toBeUndefined();
    });
  });

  test.each([
    ['Unix epoch', 0],
    ['Firestore maximum', FIRESTORE_TIMESTAMP_MAX_SECONDS],
  ])('PAY-003A7 admits the inclusive %s Event-created boundary', async (
    label,
    eventCreated,
  ) => {
    seedPaidDisputeOrder();
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const event = stripeEvent(
      `evt_dispute_time_valid_${slug}`,
      'charge.dispute.created',
      orderDispute({ id: `dp_dispute_time_valid_${slug}` }),
    );
    event.created = eventCreated;

    const response = await deliver(event);

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: false,
      outcome: 'dispute_needs_response',
    }));
    expect(admin.__get('orders/order-1')).toMatchObject({
      lastDisputeEventCreated: eventCreated,
      stripeDisputeId: `dp_dispute_time_valid_${slug}`,
    });
    expect(admin.__get(`stripeEvents/${event.id}`)).toMatchObject({
      stripeCreatedAt: { _milliseconds: eventCreated * 1000 },
      targetPath: 'orders/order-1',
    });
  });

  test('PAY-003A7 keeps an admissible claimed missing target retryable', async () => {
    const event = stripeEvent(
      'evt_dispute_time_valid_missing_target',
      'charge.dispute.updated',
      orderDispute({
        id: 'dp_dispute_time_valid_missing_target',
        charge: 'ch_dispute_time_valid_missing_target',
        payment_intent: 'pi_dispute_time_valid_missing_target',
        metadata: {
          schemaVersion: '1',
          type: 'merch',
          orderId: 'order-missing',
        },
        status: 'under_review',
      }),
    );
    event.created = FIRESTORE_TIMESTAMP_MAX_SECONDS;

    const response = await deliver(event);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(admin.__get(`stripeEvents/${event.id}`)).toBeUndefined();
    providerBindingPaths(event).forEach((path) => {
      expect(admin.__get(path)).toBeUndefined();
    });
  });

  test.each(NON_DISPUTE_EVENT_CREATED_CASES)(
    'PAY-003A8 quarantines %s with %s outer Event-created evidence',
    async (lifecycle, evidence, type, mutation, value) => {
      const slug = `${lifecycle}_${evidence}`.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const { event, businessPath } = nonDisputeEventFixture(type, slug);
      const before = storedCopy(businessPath);
      setEventCreated(event, mutation, value);

      const response = await deliver(event);

      expect(refundAdmissionObservation({
        response,
        event,
        businessSnapshots: [[businessPath, before]],
      })).toEqual(expectedEventCreatedQuarantine());
      expect(admin.__get(`stripeEvents/${event.id}`)).toMatchObject({
        stripeCreatedAt: null,
      });
      expectOnlyEventLedgerReads(event);
      if (Number.isSafeInteger(value)) {
        expect(Timestamp.fromMillis).not.toHaveBeenCalledWith(value * 1000);
      }
      expect(consoleError).toHaveBeenCalledWith(
        'Stripe event requires review',
        {
          eventId: event.id,
          eventType: type,
          outcome: 'needs_review:invalid_event_created',
          targetType: null,
        },
      );
      expect(JSON.stringify({
        response: response.json.mock.calls,
        ledger: admin.__get(`stripeEvents/${event.id}`),
        logs: consoleError.mock.calls,
      })).not.toContain('hostile-event-created-do-not-log');
    },
  );

  test.each(NON_DISPUTE_EVENT_TYPES)(
    'PAY-003A8 defensively rejects a parser-return Proxy for %s without coercion',
    async (lifecycle, type) => {
      const slug = lifecycle.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const { event, businessPath } = nonDisputeEventFixture(type, `proxy_${slug}`);
      const before = storedCopy(businessPath);
      const trap = jest.fn(() => {
        throw new Error('Event-created Proxy trap must not run');
      });
      event.created = new Proxy({}, {
        get: trap,
        getOwnPropertyDescriptor: trap,
        ownKeys: trap,
      });

      const response = await deliverMockedConstructedEvent(event);

      expect(refundAdmissionObservation({
        response,
        event,
        businessSnapshots: [[businessPath, before]],
      })).toEqual(expectedEventCreatedQuarantine());
      expectOnlyEventLedgerReads(event);
      expect(trap).not.toHaveBeenCalled();
    },
  );

  test('PAY-003A8 blocks invalid Checkout time before ambiguous legacy fallback', async () => {
    seedOrder({ stripeSessionId: 'cs_pay003a8_ambiguous' });
    seedRegistration({ stripeSessionId: 'cs_pay003a8_ambiguous' });
    const snapshots = [
      ['orders/order-1', storedCopy('orders/order-1')],
      [
        'events/race-1/registrations/reg-1',
        storedCopy('events/race-1/registrations/reg-1'),
      ],
    ];
    const event = stripeEvent(
      'evt_pay003a8_checkout_fallback',
      'checkout.session.completed',
      registrationSession({
        id: 'cs_pay003a8_ambiguous',
        metadata: {},
      }),
    );
    event.created = -1;

    const response = await deliver(event);

    expect(refundAdmissionObservation({
      response,
      event,
      businessSnapshots: snapshots,
    })).toEqual(expectedEventCreatedQuarantine());
    expectOnlyEventLedgerReads(event);
  });

  test('PAY-003A8 blocks invalid refund time before ambiguous legacy fallback', async () => {
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_pay003a8_ambiguous',
      stripeAmountTotalCents: 2000,
    });
    seedRegistration({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_pay003a8_ambiguous',
      stripeAmountTotalCents: 5000,
    });
    const snapshots = [
      ['orders/order-1', storedCopy('orders/order-1')],
      [
        'events/race-1/registrations/reg-1',
        storedCopy('events/race-1/registrations/reg-1'),
      ],
    ];
    const event = stripeEvent(
      'evt_pay003a8_refund_fallback',
      'charge.refunded',
      orderRefundCharge({
        id: 'ch_pay003a8_refund_fallback',
        payment_intent: 'pi_pay003a8_ambiguous',
        metadata: {},
      }),
    );
    event.created = -1;

    const response = await deliver(event);

    expect(refundAdmissionObservation({
      response,
      event,
      businessSnapshots: snapshots,
    })).toEqual(expectedEventCreatedQuarantine());
    expectOnlyEventLedgerReads(event);
  });

  test('PAY-003A8 keeps invalid time ahead of malformed reference handling', async () => {
    const event = stripeEvent(
      'evt_pay003a8_malformed_reference',
      'checkout.session.completed',
      registrationSession({
        metadata: {
          schemaVersion: '1',
          type: 'merch',
          orderId: 'order-1',
          eventId: 'race-1',
          registrationId: 'reg-1',
        },
      }),
    );
    event.created = -1;

    const response = await deliver(event);

    expect(refundAdmissionObservation({ response, event }))
      .toEqual(expectedEventCreatedQuarantine());
    expectOnlyEventLedgerReads(event);
  });

  test.each([
    [
      'Checkout outer realm',
      'checkout.session.completed',
      'livemode_mismatch',
      (event) => { event.livemode = true; },
    ],
    [
      'Checkout embedded realm',
      'checkout.session.completed',
      'checkout_session_livemode_mismatch',
      (event) => { event.data.object.livemode = true; },
    ],
    [
      'Checkout lifecycle',
      'checkout.session.completed',
      'checkout_session_status_mismatch',
      (event) => { event.data.object.status = 'hostile-checkout-status'; },
    ],
    [
      'Checkout metadata schema',
      'checkout.session.completed',
      'metadata_schema_version_mismatch',
      (event) => { setMetadataSchema(event.data.object, '2'); },
    ],
    [
      'refund outer realm',
      'charge.refunded',
      'livemode_mismatch',
      (event) => { event.livemode = true; },
    ],
    [
      'refund embedded realm',
      'charge.refunded',
      'charge_livemode_mismatch',
      (event) => { event.data.object.livemode = true; },
    ],
    [
      'refund Charge status',
      'charge.refunded',
      'charge_status_mismatch',
      (event) => { event.data.object.status = 'pending'; },
    ],
    [
      'refund metadata schema',
      'charge.refunded',
      'metadata_schema_version_mismatch',
      (event) => { setMetadataSchema(event.data.object, '2'); },
    ],
  ])('PAY-003A8 keeps %s precedence with unusable Event time', async (
    label,
    type,
    reason,
    mutate,
  ) => {
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const { event, businessPath } = nonDisputeEventFixture(type, `precedence_${slug}`);
    const before = storedCopy(businessPath);
    event.created = FIRESTORE_TIMESTAMP_MAX_SECONDS + 1;
    mutate(event);

    const response = await deliver(event);

    expectCompatibilityQuarantine({ response, event, businessPath, before, reason });
    expect(admin.__get(`stripeEvents/${event.id}`)).toMatchObject({
      stripeCreatedAt: null,
    });
    expectOnlyEventLedgerReads(event);
    expect(Timestamp.fromMillis).not.toHaveBeenCalledWith(
      (FIRESTORE_TIMESTAMP_MAX_SECONDS + 1) * 1000,
    );
  });

  test.each(NON_DISPUTE_EVENT_TYPES)(
    'PAY-003A8 processes invalid %s Event time before a claimed missing target',
    async (lifecycle, type) => {
      const slug = lifecycle.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const { event } = nonDisputeEventFixture(type, `missing_${slug}`, {
        missingTarget: true,
      });
      event.created = -1;

      const response = await deliver(event);

      expect(refundAdmissionObservation({ response, event }))
        .toEqual(expectedEventCreatedQuarantine());
      expectOnlyEventLedgerReads(event);
    },
  );

  test.each(NON_DISPUTE_EVENT_TYPES)(
    'PAY-003A8 deduplicates rejected %s Event time without target work',
    async (lifecycle, type) => {
      const slug = lifecycle.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const { event, businessPath } = nonDisputeEventFixture(type, `replay_${slug}`);
      const before = storedCopy(businessPath);
      event.created = -1;

      const firstResponse = await deliver(event);
      const ledgerPath = `stripeEvents/${event.id}`;
      const afterFirstLedger = storedCopy(ledgerPath);
      const replayResponse = await deliver(event);

      expect(refundAdmissionObservation({
        response: firstResponse,
        event,
        businessSnapshots: [[businessPath, before]],
      })).toEqual(expectedEventCreatedQuarantine());
      expect(replayResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        received: true,
        duplicate: true,
        outcome: 'needs_review:invalid_event_created',
      }));
      expect(admin.__get(businessPath)).toEqual(before);
      expect(admin.__get(ledgerPath)).toEqual(afterFirstLedger);
      expect(admin.__readOperations()).toEqual([
        { kind: 'document', path: ledgerPath },
        { kind: 'document', path: ledgerPath },
        { kind: 'document', path: ledgerPath },
      ]);
      expect(Timestamp.fromMillis).toHaveBeenCalledTimes(2);
      expect(consoleError).toHaveBeenCalledTimes(1);
    },
  );

  test.each(NON_DISPUTE_EVENT_TYPES.flatMap(([lifecycle, type]) => [
    [lifecycle, type, 'Unix epoch', 0],
    [lifecycle, type, 'Firestore maximum', FIRESTORE_TIMESTAMP_MAX_SECONDS],
  ]))('PAY-003A8 admits the inclusive %s %s %s Event-created boundary', async (
    lifecycle,
    type,
    boundary,
    eventCreated,
  ) => {
    const slug = `${lifecycle}_${boundary}`.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const { event } = nonDisputeEventFixture(type, `valid_${slug}`);
    event.created = eventCreated;

    const response = await deliver(event);

    expect(response.status).not.toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: false,
    }));
    expect(admin.__get(`stripeEvents/${event.id}`)).toMatchObject({
      stripeCreatedAt: { _milliseconds: eventCreated * 1000 },
    });
  });

  test.each(NON_DISPUTE_EVENT_TYPES)(
    'PAY-003A8 keeps an admissible claimed missing %s target retryable',
    async (lifecycle, type) => {
      const slug = lifecycle.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const { event } = nonDisputeEventFixture(type, `valid_missing_${slug}`, {
        missingTarget: true,
      });
      event.created = FIRESTORE_TIMESTAMP_MAX_SECONDS;

      const response = await deliver(event);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(admin.__get(`stripeEvents/${event.id}`)).toBeUndefined();
      providerBindingPaths(event).forEach((path) => {
        expect(admin.__get(path)).toBeUndefined();
      });
    },
  );

  test('PAY-003A8 safely preserves an unsupported Event with unusable time', async () => {
    const event = stripeEvent(
      'evt_pay003a8_unsupported',
      'customer.created',
      { id: 'cus_pay003a8_unsupported', object: 'customer' },
    );
    event.created = FIRESTORE_TIMESTAMP_MAX_SECONDS + 1;

    const firstResponse = await deliver(event);
    const ledgerPath = `stripeEvents/${event.id}`;
    const afterFirstLedger = admin.__get(ledgerPath) === undefined
      ? undefined
      : storedCopy(ledgerPath);
    const replayResponse = await deliver(event);

    expect(firstResponse.status).not.toHaveBeenCalledWith(500);
    expect(firstResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: false,
      outcome: 'ignored:unsupported_event',
    }));
    expect(admin.__get(ledgerPath)).toMatchObject({
      outcome: 'ignored:unsupported_event',
      stripeCreatedAt: null,
      targetType: null,
      targetPath: null,
      targetSource: null,
    });
    expect(replayResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: true,
      outcome: 'ignored:unsupported_event',
    }));
    expect(admin.__get(ledgerPath)).toEqual(afterFirstLedger);
    expect(Timestamp.fromMillis).not.toHaveBeenCalledWith(
      (FIRESTORE_TIMESTAMP_MAX_SECONDS + 1) * 1000,
    );
  });

  test.each(REFUND_CHARGE_CREATED_CASES)(
    'PAY-003A9 quarantines %s refund with %s Charge-created evidence',
    async (domain, evidence, mutation, value) => {
      const slug = `${domain}_${evidence}`.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const { event, businessPath } = refundChargeCreatedFixture(domain, slug);
      const before = storedCopy(businessPath);
      setChargeCreated(event.data.object, mutation, value);

      const response = await deliver(event);

      expect(refundAdmissionObservation({
        response,
        event,
        businessSnapshots: [[businessPath, before]],
      })).toEqual(expectedChargeCreatedQuarantine());
      expect(admin.__get(`stripeEvents/${event.id}`)).toMatchObject({
        stripeCreatedAt: { _milliseconds: event.created * 1000 },
      });
      expectOnlyEventLedgerReads(event);
      expectOnlyEventLedgerTimestamps(event);
      expect(Timestamp.now).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        'Stripe event requires review',
        {
          eventId: event.id,
          eventType: 'charge.refunded',
          outcome: 'needs_review:invalid_charge_created',
          targetType: null,
        },
      );
      expect(JSON.stringify({
        response: response.json.mock.calls,
        ledger: admin.__get(`stripeEvents/${event.id}`),
        logs: consoleError.mock.calls,
      })).not.toContain('hostile-charge-created-do-not-log');
    },
  );

  test.each(REFUND_CHARGE_CREATED_DOMAINS)(
    'PAY-003A9 defensively rejects a post-parser Proxy for %s Charge-created',
    async (domain) => {
      const { event, businessPath } = refundChargeCreatedFixture(domain, `proxy_${domain}`);
      const before = storedCopy(businessPath);
      const trap = jest.fn(() => {
        throw new Error('Charge-created Proxy trap must not run');
      });
      event.data.object.created = new Proxy({}, {
        get: trap,
        getOwnPropertyDescriptor: trap,
        ownKeys: trap,
      });

      const response = await deliverMockedConstructedEvent(event);

      expect(refundAdmissionObservation({
        response,
        event,
        businessSnapshots: [[businessPath, before]],
      })).toEqual(expectedChargeCreatedQuarantine());
      expectOnlyEventLedgerReads(event);
      expect(Timestamp.now).not.toHaveBeenCalled();
      expect(trap).not.toHaveBeenCalled();
    },
  );

  test.each(REFUND_CHARGE_CREATED_DOMAINS)(
    'PAY-003A9 does not let existing %s paidAt bypass invalid Charge-created admission',
    async (domain) => {
      const existingPaidAt = { _milliseconds: 1_700_000_000_000 };
      const { event, businessPath } = refundChargeCreatedFixture(
        domain,
        `existing_paid_at_${domain}`,
        { existingPaidAt },
      );
      const before = storedCopy(businessPath);
      event.data.object.created = -1;

      const response = await deliver(event);

      expect(refundAdmissionObservation({
        response,
        event,
        businessSnapshots: [[businessPath, before]],
      })).toEqual(expectedChargeCreatedQuarantine());
      expectOnlyEventLedgerReads(event);
      expect(Timestamp.now).not.toHaveBeenCalled();
      expect(Timestamp.fromMillis).not.toHaveBeenCalledWith(-1000);
    },
  );

  test('PAY-003A9 blocks invalid Charge time before ambiguous legacy fallback', async () => {
    const paymentIntentId = 'pi_pay003a9_ambiguous';
    seedOrder({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: paymentIntentId,
      stripeAmountTotalCents: 2000,
    });
    seedRegistration({
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: paymentIntentId,
      stripeAmountTotalCents: 5000,
    });
    const snapshots = [
      ['orders/order-1', storedCopy('orders/order-1')],
      [
        'events/race-1/registrations/reg-1',
        storedCopy('events/race-1/registrations/reg-1'),
      ],
    ];
    const event = stripeEvent(
      'evt_pay003a9_ambiguous_fallback',
      'charge.refunded',
      orderRefundCharge({
        id: 'ch_pay003a9_ambiguous_fallback',
        payment_intent: paymentIntentId,
        metadata: {},
      }),
    );
    event.data.object.created = -1;

    const response = await deliver(event);

    expect(refundAdmissionObservation({
      response,
      event,
      businessSnapshots: snapshots,
    })).toEqual(expectedChargeCreatedQuarantine());
    expectOnlyEventLedgerReads(event);
  });

  test('PAY-003A9 keeps invalid Charge time ahead of malformed reference handling', async () => {
    const event = stripeEvent(
      'evt_pay003a9_malformed_reference',
      'charge.refunded',
      orderRefundCharge({
        id: 'ch_pay003a9_malformed_reference',
        metadata: {
          schemaVersion: '1',
          type: 'merch',
          orderId: 'order-1',
          eventId: 'race-1',
          registrationId: 'reg-1',
        },
      }),
    );
    event.data.object.created = -1;

    const response = await deliver(event);

    expect(refundAdmissionObservation({ response, event }))
      .toEqual(expectedChargeCreatedQuarantine());
    expectOnlyEventLedgerReads(event);
  });

  test.each(REFUND_CHARGE_CREATED_DOMAINS)(
    'PAY-003A9 processes invalid Charge time before a claimed missing %s target',
    async (domain) => {
      const { event } = refundChargeCreatedFixture(
        domain,
        `invalid_missing_${domain}`,
        { missingTarget: true },
      );
      event.data.object.created = -1;

      const response = await deliver(event);

      expect(refundAdmissionObservation({ response, event }))
        .toEqual(expectedChargeCreatedQuarantine());
      expectOnlyEventLedgerReads(event);
      expect(Timestamp.now).not.toHaveBeenCalled();
    },
  );

  test.each(REFUND_CHARGE_CREATED_DOMAINS)(
    'PAY-003A9 keeps a valid Charge time with a claimed missing %s target retryable',
    async (domain) => {
      const { event } = refundChargeCreatedFixture(
        domain,
        `valid_missing_${domain}`,
        { missingTarget: true },
      );
      event.data.object.created = FIRESTORE_TIMESTAMP_MAX_SECONDS;
      event.created = FIRESTORE_TIMESTAMP_MAX_SECONDS;

      const response = await deliver(event);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(admin.__get(`stripeEvents/${event.id}`)).toBeUndefined();
      providerBindingPaths(event).forEach((path) => {
        expect(admin.__get(path)).toBeUndefined();
      });
    },
  );

  test.each([
    [
      'outer Event realm',
      'livemode_mismatch',
      (event) => { event.livemode = true; },
      { _milliseconds: 1_800_000_000_000 },
    ],
    [
      'embedded Charge realm',
      'charge_livemode_mismatch',
      (event) => { event.data.object.livemode = true; },
      { _milliseconds: 1_800_000_000_000 },
    ],
    [
      'Charge status',
      'charge_status_mismatch',
      (event) => { event.data.object.status = 'pending'; },
      { _milliseconds: 1_800_000_000_000 },
    ],
    [
      'metadata schema',
      'metadata_schema_version_mismatch',
      (event) => { setMetadataSchema(event.data.object, '2'); },
      { _milliseconds: 1_800_000_000_000 },
    ],
    [
      'outer Event time',
      'invalid_event_created',
      (event) => { event.created = FIRESTORE_TIMESTAMP_MAX_SECONDS + 1; },
      null,
    ],
  ])('PAY-003A9 keeps %s precedence over invalid Charge time', async (
    label,
    reason,
    mutate,
    expectedStripeCreatedAt,
  ) => {
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const { event, businessPath } = refundChargeCreatedFixture(
      'order',
      `precedence_${slug}`,
    );
    const before = storedCopy(businessPath);
    event.data.object.created = FIRESTORE_TIMESTAMP_MAX_SECONDS + 1;
    mutate(event);

    const response = await deliver(event);

    expectCompatibilityQuarantine({ response, event, businessPath, before, reason });
    expect(admin.__get(`stripeEvents/${event.id}`)).toMatchObject({
      stripeCreatedAt: expectedStripeCreatedAt,
    });
    expectOnlyEventLedgerReads(event);
    expect(Timestamp.now).not.toHaveBeenCalled();
    expect(Timestamp.fromMillis).not.toHaveBeenCalledWith(
      (FIRESTORE_TIMESTAMP_MAX_SECONDS + 1) * 1000,
    );
  });

  test.each(REFUND_CHARGE_CREATED_DOMAINS)(
    'PAY-003A9 deduplicates rejected %s Charge time without target work',
    async (domain) => {
      const { event, businessPath } = refundChargeCreatedFixture(
        domain,
        `replay_${domain}`,
      );
      const before = storedCopy(businessPath);
      event.data.object.created = -1;

      const firstResponse = await deliver(event);
      const ledgerPath = `stripeEvents/${event.id}`;
      const afterFirstLedger = storedCopy(ledgerPath);
      const replayResponse = await deliver(event);

      expect(refundAdmissionObservation({
        response: firstResponse,
        event,
        businessSnapshots: [[businessPath, before]],
      })).toEqual(expectedChargeCreatedQuarantine());
      expect(replayResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        received: true,
        duplicate: true,
        outcome: 'needs_review:invalid_charge_created',
      }));
      expect(admin.__get(businessPath)).toEqual(before);
      expect(admin.__get(ledgerPath)).toEqual(afterFirstLedger);
      expect(admin.__readOperations()).toEqual([
        { kind: 'document', path: ledgerPath },
        { kind: 'document', path: ledgerPath },
        { kind: 'document', path: ledgerPath },
      ]);
      expect(Timestamp.fromMillis).toHaveBeenCalledTimes(3);
      expect(Timestamp.now).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledTimes(1);
    },
  );

  test.each(REFUND_CHARGE_CREATED_DOMAINS.flatMap((domain) => [
    [domain, 'Unix epoch', 0],
    [domain, 'Firestore maximum', FIRESTORE_TIMESTAMP_MAX_SECONDS],
  ]))('PAY-003A9 admits the inclusive %s %s Charge-created boundary', async (
    domain,
    boundary,
    chargeCreated,
  ) => {
    const slug = `${domain}_${boundary}`.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const { event, businessPath } = refundChargeCreatedFixture(domain, `valid_${slug}`);
    event.data.object.created = chargeCreated;
    if (chargeCreated === FIRESTORE_TIMESTAMP_MAX_SECONDS) event.created = chargeCreated;

    const response = await deliver(event);

    expect(response.status).not.toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      duplicate: false,
      outcome: 'partially_refunded',
    }));
    expect(admin.__get(businessPath)).toMatchObject({
      paymentStatus: 'partially_refunded',
      paidAt: { _milliseconds: chargeCreated * 1000 },
    });
    expect(admin.__get(`stripeEvents/${event.id}`)).toMatchObject({
      targetPath: businessPath,
      stripeCreatedAt: { _milliseconds: event.created * 1000 },
    });
  });

  test.each(REFUND_CHARGE_CREATED_DOMAINS)(
    'PAY-003A9 preserves an existing %s paidAt for valid Charge time',
    async (domain) => {
      const existingPaidAt = { _milliseconds: 1_700_000_000_000 };
      const { event, businessPath } = refundChargeCreatedFixture(
        domain,
        `valid_existing_paid_at_${domain}`,
        { existingPaidAt },
      );
      event.data.object.created = FIRESTORE_TIMESTAMP_MAX_SECONDS;
      event.created = FIRESTORE_TIMESTAMP_MAX_SECONDS;

      const response = await deliver(event);

      expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'partially_refunded',
      }));
      expect(admin.__get(businessPath).paidAt).toEqual(existingPaidAt);
    },
  );

  test('PAY-003A9 leaves Checkout Session-created evidence outside this child', async () => {
    seedRegistration();
    const event = stripeEvent(
      'evt_pay003a9_checkout_compatibility',
      'checkout.session.completed',
      registrationSession({ created: -1 }),
    );

    const response = await deliver(event);

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'payment_confirmed',
    }));
  });

  test('PAY-003A9 leaves Dispute-created evidence outside this child', async () => {
    seedPaidDisputeOrder();
    const event = stripeEvent(
      'evt_pay003a9_dispute_compatibility',
      'charge.dispute.updated',
      orderDispute({ created: -1, status: 'under_review' }),
    );

    const response = await deliver(event);

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'dispute_under_review',
    }));
  });

  test('PAY-003A9 leaves unsupported embedded created evidence unchanged', async () => {
    const event = stripeEvent(
      'evt_pay003a9_unsupported_compatibility',
      'customer.created',
      { id: 'cus_pay003a9_unsupported', object: 'customer', created: -1 },
    );

    const response = await deliver(event);

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'ignored:unsupported_event',
    }));
  });

  describe('PAY-003A10 refund Charge/Event chronology', () => {
    const eventCreated = 1_800_000_000;

    test.each(REFUND_CHARGE_CREATED_DOMAINS)(
      'quarantines impossible %s refund Charge/Event chronology',
      async (domain) => {
        const { event, businessPath } = refundChargeCreatedFixture(
          domain,
          `chronology_${domain}`,
        );
        const before = storedCopy(businessPath);
        event.created = eventCreated;
        event.data.object.created = eventCreated + 1;

        const response = await deliver(event);

        expect(refundAdmissionObservation({
          response,
          event,
          businessSnapshots: [[businessPath, before]],
        })).toEqual(expectedChargeEventChronologyQuarantine());
        expect(admin.__get(`stripeEvents/${event.id}`)).toMatchObject({
          stripeCreatedAt: { _milliseconds: event.created * 1000 },
        });
        expectOnlyEventLedgerReads(event);
        expectOnlyEventLedgerTimestamps(event);
        expect(Timestamp.now).not.toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalledWith(
          'Stripe event requires review',
          {
            eventId: event.id,
            eventType: 'charge.refunded',
            outcome: 'needs_review:invalid_charge_event_chronology',
            targetType: null,
          },
        );
        expect(JSON.stringify({
          response: response.json.mock.calls,
          ledger: admin.__get(`stripeEvents/${event.id}`),
          logs: consoleError.mock.calls,
        })).not.toContain(String(event.data.object.created));
      },
    );

    test('blocks impossible chronology before ambiguous legacy fallback', async () => {
      const paymentIntentId = 'pi_pay003a10_ambiguous';
      seedOrder({
        status: 'paid',
        paymentStatus: 'paid',
        stripePaymentIntentId: paymentIntentId,
        stripeAmountTotalCents: 2000,
      });
      seedRegistration({
        status: 'paid',
        paymentStatus: 'paid',
        stripePaymentIntentId: paymentIntentId,
        stripeAmountTotalCents: 5000,
      });
      const snapshots = [
        ['orders/order-1', storedCopy('orders/order-1')],
        [
          'events/race-1/registrations/reg-1',
          storedCopy('events/race-1/registrations/reg-1'),
        ],
      ];
      const event = stripeEvent(
        'evt_pay003a10_ambiguous_fallback',
        'charge.refunded',
        orderRefundCharge({
          id: 'ch_pay003a10_ambiguous_fallback',
          payment_intent: paymentIntentId,
          metadata: {},
        }),
      );
      event.created = eventCreated;
      event.data.object.created = eventCreated + 1;

      const response = await deliver(event);

      expect(refundAdmissionObservation({
        response,
        event,
        businessSnapshots: snapshots,
      })).toEqual(expectedChargeEventChronologyQuarantine());
      expectOnlyEventLedgerReads(event);
      expectOnlyEventLedgerTimestamps(event);
      expect(Timestamp.now).not.toHaveBeenCalled();
    });

    test.each(REFUND_CHARGE_CREATED_DOMAINS)(
      'makes impossible chronology durable before a missing %s target',
      async (domain) => {
        const { event } = refundChargeCreatedFixture(
          domain,
          `chronology_missing_${domain}`,
          { missingTarget: true },
        );
        event.created = eventCreated;
        event.data.object.created = eventCreated + 1;

        const response = await deliver(event);

        expect(refundAdmissionObservation({ response, event }))
          .toEqual(expectedChargeEventChronologyQuarantine());
        expect(response.status).not.toHaveBeenCalledWith(500);
        expectOnlyEventLedgerReads(event);
        expectOnlyEventLedgerTimestamps(event);
        expect(Timestamp.now).not.toHaveBeenCalled();
      },
    );

    test.each([
      [
        'outer Event realm',
        'livemode_mismatch',
        (event) => { event.livemode = true; },
        { _milliseconds: eventCreated * 1000 },
        null,
      ],
      [
        'embedded Charge realm',
        'charge_livemode_mismatch',
        (event) => { event.data.object.livemode = true; },
        { _milliseconds: eventCreated * 1000 },
        null,
      ],
      [
        'Charge status',
        'charge_status_mismatch',
        (event) => { event.data.object.status = 'pending'; },
        { _milliseconds: eventCreated * 1000 },
        null,
      ],
      [
        'metadata schema',
        'metadata_schema_version_mismatch',
        (event) => { setMetadataSchema(event.data.object, '2'); },
        { _milliseconds: eventCreated * 1000 },
        null,
      ],
      [
        'outer Event time',
        'invalid_event_created',
        (event) => { event.created = -1; },
        null,
        -1000,
      ],
      [
        'embedded Charge time',
        'invalid_charge_created',
        (event) => { event.data.object.created = FIRESTORE_TIMESTAMP_MAX_SECONDS + 1; },
        { _milliseconds: eventCreated * 1000 },
        (FIRESTORE_TIMESTAMP_MAX_SECONDS + 1) * 1000,
      ],
    ])('keeps %s precedence over chronology', async (
      label,
      reason,
      mutate,
      expectedStripeCreatedAt,
      rejectedTimestampMillis,
    ) => {
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const { event, businessPath } = refundChargeCreatedFixture(
        'order',
        `chronology_precedence_${slug}`,
      );
      const before = storedCopy(businessPath);
      event.created = eventCreated;
      event.data.object.created = eventCreated + 1;
      mutate(event);

      const response = await deliver(event);

      expectCompatibilityQuarantine({ response, event, businessPath, before, reason });
      expect(admin.__get(`stripeEvents/${event.id}`)).toMatchObject({
        stripeCreatedAt: expectedStripeCreatedAt,
      });
      expectOnlyEventLedgerReads(event);
      expect(Timestamp.now).not.toHaveBeenCalled();
      if (rejectedTimestampMillis !== null) {
        expect(Timestamp.fromMillis).not.toHaveBeenCalledWith(rejectedTimestampMillis);
      }
    });

    test.each(REFUND_CHARGE_CREATED_DOMAINS)(
      'deduplicates rejected %s chronology without target work',
      async (domain) => {
        const { event, businessPath } = refundChargeCreatedFixture(
          domain,
          `chronology_replay_${domain}`,
        );
        const before = storedCopy(businessPath);
        event.created = eventCreated;
        event.data.object.created = eventCreated + 1;

        const firstResponse = await deliver(event);
        const ledgerPath = `stripeEvents/${event.id}`;
        const afterFirstLedger = storedCopy(ledgerPath);
        const replayResponse = await deliver(event);

        expect(refundAdmissionObservation({
          response: firstResponse,
          event,
          businessSnapshots: [[businessPath, before]],
        })).toEqual(expectedChargeEventChronologyQuarantine());
        expect(replayResponse.json).toHaveBeenCalledWith(expect.objectContaining({
          received: true,
          duplicate: true,
          outcome: 'needs_review:invalid_charge_event_chronology',
        }));
        expect(admin.__get(businessPath)).toEqual(before);
        expect(admin.__get(ledgerPath)).toEqual(afterFirstLedger);
        expect(admin.__readOperations()).toEqual([
          { kind: 'document', path: ledgerPath },
          { kind: 'document', path: ledgerPath },
          { kind: 'document', path: ledgerPath },
        ]);
        expectOnlyEventLedgerTimestamps(event);
        expect(Timestamp.now).not.toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalledTimes(1);
      },
    );

    test.each(REFUND_CHARGE_CREATED_DOMAINS.flatMap((domain) => [
      [domain, 'equal', eventCreated],
      [domain, 'older', eventCreated - 1],
    ]))('admits %s refund with %s Charge/Event chronology', async (
      domain,
      chronology,
      chargeCreated,
    ) => {
      const { event, businessPath } = refundChargeCreatedFixture(
        domain,
        `chronology_${chronology}_${domain}`,
      );
      event.created = eventCreated;
      event.data.object.created = chargeCreated;

      const response = await deliver(event);

      expect(response.status).not.toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
        received: true,
        duplicate: false,
        outcome: 'partially_refunded',
      }));
      expect(admin.__get(businessPath)).toMatchObject({
        paymentStatus: 'partially_refunded',
        paidAt: { _milliseconds: chargeCreated * 1000 },
      });
      expect(admin.__get(`stripeEvents/${event.id}`)).toMatchObject({
        targetPath: businessPath,
        stripeCreatedAt: { _milliseconds: event.created * 1000 },
      });
      expect(consoleError).not.toHaveBeenCalled();
    });

    test('leaves Checkout Session chronology outside this child', async () => {
      seedRegistration();
      const event = stripeEvent(
        'evt_pay003a10_checkout_compatibility',
        'checkout.session.completed',
        registrationSession({ created: eventCreated + 1 }),
      );
      event.created = eventCreated;

      const response = await deliver(event);

      expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'payment_confirmed',
      }));
    });

    test('leaves Dispute chronology outside this child', async () => {
      seedPaidDisputeOrder();
      const event = stripeEvent(
        'evt_pay003a10_dispute_compatibility',
        'charge.dispute.updated',
        orderDispute({ created: eventCreated + 1, status: 'under_review' }),
      );
      event.created = eventCreated;

      const response = await deliver(event);

      expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'dispute_under_review',
      }));
    });
  });

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
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const event = stripeEvent(
      `evt_dispute_${reason}_${_label.replaceAll(' ', '_')}`,
      'charge.dispute.updated',
      dispute,
    );

    const response = await deliver(event);

    if (reason === 'invalid_dispute_status') {
      expectCompatibilityQuarantine({ response, event, businessPath, before, reason });
      return;
    }

    expect(admin.__get(businessPath)).toMatchObject({
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
    const businessPath = 'orders/order-1';
    const before = storedCopy(businessPath);
    const event = stripeEvent(
      'evt_closed_missing_status',
      'charge.dispute.closed',
      dispute,
    );

    const response = await deliver(event);

    expectCompatibilityQuarantine({
      response,
      event,
      businessPath,
      before,
      reason: 'invalid_dispute_status',
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
