'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { inspect } = require('node:util');

const {
  checkoutSessionResponseBindingSchemaVersion,
  StripeCheckoutSessionResponseBindingError,
  classifyStripeCheckoutSessionResponseBinding,
} = require('./stripeCheckoutSessionResponseBinding');
const {
  projectStripeCheckoutSessionObservation,
} = require('./stripeCheckoutSessionProjection');

const API_VERSION = '2023-10-16';
const OTHER_API_VERSION = '2024-01-01';
const IDEMPOTENCY_KEY = 'synthetic-binding-key-0001';
const OTHER_IDEMPOTENCY_KEY = 'synthetic-binding-key-0002';
const STRIPE_ACCOUNT = 'acct_syntheticbinding0001';
const OTHER_STRIPE_ACCOUNT = 'acct_syntheticbinding0002';
const SESSION_ID = 'cs_test_syntheticbinding0001';
const CHECKOUT_URL = 'https://checkout.example.test/c/pay/synthetic#continue';
const REQUEST_ID = 'req_syntheticbinding0001';
const RAW_API_CANARY = '2099-12-31-canary-never-echo';
const RAW_KEY_CANARY = 'raw-idempotency-canary-never-echo';
const RAW_ACCOUNT_CANARY = 'acct_rawaccountcanary0001';
const SESSION_CANARY = 'cs_test_sessioncanary0001';
const URL_CANARY = 'https://private-capability.example.test/canary#secret';

const CAPSULE_KEYS = Object.freeze([
  'checkoutSessionResponseBindingSchemaVersion',
  'checkoutSessionProjection',
  'observedResponseApiVersion',
  'observedResponseIdempotencyKey',
  'observedResponseStripeAccount',
  'expectedResponseApiVersion',
  'expectedResponseIdempotencyKey',
  'expectedResponseStripeAccount',
]);
const PROJECTION_KEYS = Object.freeze([
  'checkoutSessionProjectionSchemaVersion',
  'classification',
  'state',
  'provider',
  'providerOperation',
  'sessionId',
  'object',
  'livemode',
  'mode',
  'status',
  'paymentStatus',
  'amountTotalCents',
  'currency',
  'createdEpochSeconds',
  'expiresAtEpochSeconds',
  'checkoutUrlObservation',
  'responseStatusObservation',
  'responseRequestIdObservation',
  'responseApiVersionObservation',
  'responseIdempotencyKeyObservation',
  'responseStripeAccountObservation',
]);
const RESULT_KEYS = Object.freeze([
  'checkoutSessionResponseBindingSchemaVersion',
  'classification',
  'state',
]);

const PLATFORM_CANDIDATE = Object.freeze({
  checkoutSessionResponseBindingSchemaVersion: 1,
  classification: 'untrusted_transport_binding_candidate',
  state: 'requires_runtime_origin_account_dispatch_business_time_url_and_persistence_binding',
});
const RECONCILIATION = Object.freeze({
  checkoutSessionResponseBindingSchemaVersion: 1,
  classification: 'reconciliation_required',
  state: 'requires_redacted_transport_reconciliation',
});

function defineData(record, key, value, flags = {}) {
  Object.defineProperty(record, key, {
    value,
    enumerable: flags.enumerable !== undefined ? flags.enumerable : true,
    writable: flags.writable !== undefined ? flags.writable : true,
    configurable: flags.configurable !== undefined ? flags.configurable : true,
  });
}

function makeSession(options = {}) {
  const responseValues = {
    statusCode: 200,
    requestId: REQUEST_ID,
    apiVersion: API_VERSION,
    idempotencyKey: IDEMPOTENCY_KEY,
    stripeAccount: options.account,
    ...(options.responseValues || {}),
  };
  const lastResponse = {};
  for (const key of [
    'statusCode',
    'requestId',
    'apiVersion',
    'idempotencyKey',
    'stripeAccount',
  ]) {
    defineData(lastResponse, key, responseValues[key]);
  }

  const values = {
    id: SESSION_ID,
    object: 'checkout.session',
    livemode: false,
    mode: 'payment',
    status: 'open',
    payment_status: 'unpaid',
    amount_total: 2500,
    currency: 'usd',
    created: 1800000000,
    expires_at: 1800001800,
    url: CHECKOUT_URL,
    ...(options.values || {}),
  };
  const session = {};
  for (const key of [
    'id',
    'object',
    'livemode',
    'mode',
    'status',
    'payment_status',
    'amount_total',
    'currency',
    'created',
    'expires_at',
    'url',
  ]) {
    defineData(session, key, values[key]);
  }
  defineData(session, 'lastResponse', lastResponse, {
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return session;
}

function baseProjection(options = {}) {
  return projectStripeCheckoutSessionObservation(makeSession(options));
}

function copyFrozenRecord(source, expectedKeys, options = {}) {
  const prototype = Object.hasOwn(options, 'prototype')
    ? options.prototype
    : null;
  const record = Object.create(prototype);
  const keys = options.keys || expectedKeys;
  const overrides = options.overrides || {};
  for (const key of keys) {
    if (key === options.accessorKey) {
      Object.defineProperty(record, key, {
        get: options.getter,
        enumerable: true,
        configurable: true,
      });
      continue;
    }
    const value = Object.hasOwn(overrides, key) ? overrides[key] : source[key];
    defineData(record, key, value, options.flags && options.flags[key]);
  }
  if (options.symbolKey) defineData(record, options.symbolKey, 'extra');
  if (options.freeze !== false) Object.freeze(record);
  return record;
}

function projectionWith(overrides = {}, options = {}) {
  return copyFrozenRecord(baseProjection(), PROJECTION_KEYS, {
    ...options,
    overrides,
  });
}

function capsuleWith(overrides = {}, options = {}) {
  const account = Object.hasOwn(overrides, 'observedResponseStripeAccount')
    ? overrides.observedResponseStripeAccount
    : undefined;
  const projection = Object.hasOwn(overrides, 'checkoutSessionProjection')
    ? overrides.checkoutSessionProjection
    : baseProjection({ account });
  const source = {
    checkoutSessionResponseBindingSchemaVersion: 1,
    checkoutSessionProjection: projection,
    observedResponseApiVersion: API_VERSION,
    observedResponseIdempotencyKey: IDEMPOTENCY_KEY,
    observedResponseStripeAccount: account,
    expectedResponseApiVersion: API_VERSION,
    expectedResponseIdempotencyKey: IDEMPOTENCY_KEY,
    expectedResponseStripeAccount: account,
    ...overrides,
  };
  return copyFrozenRecord(source, CAPSULE_KEYS, options);
}

function plainResult(result) {
  const output = {};
  for (const key of RESULT_KEYS) output[key] = result[key];
  return output;
}

function expectCandidate(capsule = capsuleWith()) {
  const result = classifyStripeCheckoutSessionResponseBinding(capsule);
  expect(plainResult(result)).toEqual(PLATFORM_CANDIDATE);
  return result;
}

function expectReconciliation(capsule) {
  const result = classifyStripeCheckoutSessionResponseBinding(capsule);
  expect(plainResult(result)).toEqual(RECONCILIATION);
  return result;
}

function captureFailure(callback) {
  let error;
  try {
    callback();
  } catch (caught) {
    error = caught;
  }
  expect(error instanceof StripeCheckoutSessionResponseBindingError).toBe(true);
  expect(error.name).toBe('StripeCheckoutSessionResponseBindingError');
  expect(error.code).toBe('invalid_stripe_checkout_session_response_binding');
  expect(error.message).toBe(
    'Stripe Checkout Session response binding is invalid.',
  );
  return error;
}

function expectFixedFailure(callback, canaries = []) {
  const error = captureFailure(callback);
  const rendered = [
    String(error),
    JSON.stringify(error),
    inspect(error),
    error.name,
    error.code,
    error.message,
    error.stack,
  ].join('\n');
  for (const canary of canaries) expect(rendered.includes(canary)).toBe(false);
  expect(Object.isFrozen(error)).toBe(true);
  return error;
}

function snapshotRecord(record) {
  return Reflect.ownKeys(record).map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return Object.freeze({
      key,
      descriptor: Object.freeze({ ...descriptor }),
    });
  });
}

function expectSnapshotUnchanged(record, snapshot) {
  expect(Reflect.ownKeys(record)).toEqual(snapshot.map(({ key }) => key));
  snapshot.forEach(({ key, descriptor }) => {
    const current = Object.getOwnPropertyDescriptor(record, key);
    expect(current).toEqual(descriptor);
    if (Object.hasOwn(descriptor, 'value')) {
      expect(Object.is(current.value, descriptor.value)).toBe(true);
    }
  });
}

describe('Stripe Checkout Session response transport binding', () => {
  test('exports one versioned pure policy and fixed frozen error contract', () => {
    expect(checkoutSessionResponseBindingSchemaVersion).toBe(1);
    expect(Object.isFrozen(StripeCheckoutSessionResponseBindingError)).toBe(true);
    expect(Object.isFrozen(StripeCheckoutSessionResponseBindingError.prototype))
      .toBe(true);
    const first = captureFailure(() => classifyStripeCheckoutSessionResponseBinding(null));
    const second = captureFailure(() => classifyStripeCheckoutSessionResponseBinding(null));
    expect(first).not.toBe(second);
    for (const key of Reflect.ownKeys(first)) {
      const descriptor = Object.getOwnPropertyDescriptor(first, key);
      expect(descriptor.enumerable).toBe(false);
      expect(descriptor.configurable).toBe(false);
      if (Object.hasOwn(descriptor, 'value')) {
        expect(descriptor.writable).toBe(false);
      }
    }
    expect(first.cause).toBeUndefined();
  });

  test('accepts the actual #280 projection for platform and Connect consistency', () => {
    const platformFirst = expectCandidate(capsuleWith());
    const platformSecond = expectCandidate(capsuleWith());
    const connect = expectCandidate(capsuleWith({
      observedResponseStripeAccount: STRIPE_ACCOUNT,
      expectedResponseStripeAccount: STRIPE_ACCOUNT,
    }));
    expect(platformFirst).not.toBe(platformSecond);
    expect(plainResult(connect)).toEqual(plainResult(platformFirst));
  });

  test('returns exact fresh frozen null-prototype outputs with no raw values', () => {
    const result = expectCandidate(capsuleWith({
      observedResponseStripeAccount: STRIPE_ACCOUNT,
      expectedResponseStripeAccount: STRIPE_ACCOUNT,
    }));
    expect(Reflect.ownKeys(result)).toEqual(RESULT_KEYS);
    expect(Object.getPrototypeOf(result)).toBe(null);
    expect(Object.isFrozen(result)).toBe(true);
    for (const key of RESULT_KEYS) {
      expect(Object.getOwnPropertyDescriptor(result, key)).toMatchObject({
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    let stringRendering;
    try {
      stringRendering = String(result);
    } catch (error) {
      stringRendering = String(error);
    }
    const rendered = [stringRendering, JSON.stringify(result), inspect(result)].join('\n');
    for (const rawValue of [
      SESSION_ID,
      CHECKOUT_URL,
      REQUEST_ID,
      API_VERSION,
      IDEMPOTENCY_KEY,
      STRIPE_ACCOUNT,
    ]) {
      expect(rendered.includes(rawValue)).toBe(false);
    }
  });

  test.each([
    ['observed API missing', { observedResponseApiVersion: undefined }],
    ['expected API missing', { expectedResponseApiVersion: undefined }],
    ['observed API differs', { observedResponseApiVersion: OTHER_API_VERSION }],
    ['expected API differs', { expectedResponseApiVersion: OTHER_API_VERSION }],
    ['both APIs are a different installed ceiling', {
      observedResponseApiVersion: OTHER_API_VERSION,
      expectedResponseApiVersion: OTHER_API_VERSION,
    }],
    ['observed key missing', { observedResponseIdempotencyKey: undefined }],
    ['expected key missing', { expectedResponseIdempotencyKey: undefined }],
    ['observed key differs', { observedResponseIdempotencyKey: OTHER_IDEMPOTENCY_KEY }],
    ['expected key differs', { expectedResponseIdempotencyKey: OTHER_IDEMPOTENCY_KEY }],
    ['observed account missing', {
      observedResponseStripeAccount: undefined,
      expectedResponseStripeAccount: STRIPE_ACCOUNT,
    }],
    ['expected account missing', {
      observedResponseStripeAccount: STRIPE_ACCOUNT,
      expectedResponseStripeAccount: undefined,
    }],
    ['account differs', {
      observedResponseStripeAccount: STRIPE_ACCOUNT,
      expectedResponseStripeAccount: OTHER_STRIPE_ACCOUNT,
    }],
  ])('%s requires reconciliation', (_label, overrides) => {
    expectReconciliation(capsuleWith(overrides));
  });

  test('an internally consistent other API remains below the installed ceiling', () => {
    const projection = projectionWith({
      responseApiVersionObservation: 'other_bounded',
    });
    expectReconciliation(capsuleWith({
      checkoutSessionProjection: projection,
      observedResponseApiVersion: OTHER_API_VERSION,
      expectedResponseApiVersion: OTHER_API_VERSION,
    }));
  });

  test.each([
    ['checkoutUrlObservation', 'absent'],
    ['responseStatusObservation', 'other_2xx'],
    ['responseStatusObservation', 'non_2xx'],
    ['responseRequestIdObservation', 'missing'],
  ])('valid projection condition %s=%s requires reconciliation', (field, value) => {
    const projection = projectionWith({ [field]: value });
    expectReconciliation(capsuleWith({ checkoutSessionProjection: projection }));
  });

  test.each([
    ['responseApiVersionObservation', 'missing'],
    ['responseApiVersionObservation', 'other_bounded'],
    ['responseIdempotencyKeyObservation', 'missing'],
    ['responseStripeAccountObservation', 'bounded_present'],
  ])('projection/raw contradiction %s=%s requires reconciliation', (field, value) => {
    const projection = projectionWith({ [field]: value });
    expectReconciliation(capsuleWith({ checkoutSessionProjection: projection }));
  });

  test('valid #280 business and environment values remain transport-neutral', () => {
    const cases = [
      { mode: 'payment', status: 'open', payment_status: 'unpaid' },
      { mode: 'setup', status: 'complete', payment_status: 'no_payment_required' },
      { mode: 'subscription', status: 'expired', payment_status: 'paid' },
      { status: null, amount_total: null, currency: null },
      {
        id: 'cs_live_syntheticbinding0001',
        livemode: true,
        amount_total: Number.MAX_SAFE_INTEGER,
      },
    ];
    cases.forEach((values) => {
      const projection = baseProjection({ values });
      expectCandidate(capsuleWith({ checkoutSessionProjection: projection }));
    });
  });

  test.each([
    ['missing key', { keys: CAPSULE_KEYS.slice(0, -1) }],
    ['reordered keys', { keys: [...CAPSULE_KEYS].reverse() }],
    ['ordinary prototype', { prototype: Object.prototype }],
    ['not frozen', { freeze: false }],
    ['symbol key', { symbolKey: Symbol('extra') }],
  ])('rejects capsule with %s', (_label, options) => {
    expectFixedFailure(() => classifyStripeCheckoutSessionResponseBinding(
      capsuleWith({}, options),
    ));
  });

  test('rejects extra, accessor, wrong-descriptor, Proxy, and schema capsules', () => {
    const extra = [...CAPSULE_KEYS, 'extra'];
    expectFixedFailure(() => classifyStripeCheckoutSessionResponseBinding(
      capsuleWith({ extra: 'unused' }, { keys: extra }),
    ));

    let getterCalls = 0;
    const accessor = capsuleWith({}, {
      accessorKey: 'observedResponseApiVersion',
      getter: () => {
        getterCalls += 1;
        return API_VERSION;
      },
    });
    expectFixedFailure(() => classifyStripeCheckoutSessionResponseBinding(accessor));
    expect(getterCalls).toBe(0);

    const wrongDescriptor = capsuleWith({}, {
      flags: { observedResponseApiVersion: { enumerable: false } },
    });
    expectFixedFailure(() => classifyStripeCheckoutSessionResponseBinding(
      wrongDescriptor,
    ));

    let proxyTrapCalls = 0;
    const proxy = new Proxy(capsuleWith(), {
      getPrototypeOf() { proxyTrapCalls += 1; return null; },
      ownKeys() { proxyTrapCalls += 1; return CAPSULE_KEYS; },
      getOwnPropertyDescriptor() { proxyTrapCalls += 1; return undefined; },
    });
    expectFixedFailure(() => classifyStripeCheckoutSessionResponseBinding(proxy));
    expect(proxyTrapCalls).toBe(0);

    expectFixedFailure(() => classifyStripeCheckoutSessionResponseBinding(
      capsuleWith({ checkoutSessionResponseBindingSchemaVersion: 2 }),
    ));
  });

  test.each([
    ['missing projection key', { keys: PROJECTION_KEYS.slice(0, -1) }],
    ['reordered projection keys', { keys: [...PROJECTION_KEYS].reverse() }],
    ['ordinary projection prototype', { prototype: Object.prototype }],
    ['unfrozen projection', { freeze: false }],
    ['projection symbol key', { symbolKey: Symbol('extra') }],
  ])('rejects %s', (_label, options) => {
    const projection = copyFrozenRecord(baseProjection(), PROJECTION_KEYS, options);
    expectFixedFailure(() => classifyStripeCheckoutSessionResponseBinding(
      capsuleWith({ checkoutSessionProjection: projection }),
    ));
  });

  test('rejects projection extra/accessor/wrong-descriptor/Proxy without invocation', () => {
    const source = baseProjection();
    const projectionWithExtra = copyFrozenRecord(source, PROJECTION_KEYS, {
      keys: [...PROJECTION_KEYS, 'hostileExtra'],
      overrides: { hostileExtra: Object.freeze({ canary: 'do-not-read' }) },
    });
    expectFixedFailure(() => classifyStripeCheckoutSessionResponseBinding(
      capsuleWith({ checkoutSessionProjection: projectionWithExtra }),
    ));

    let getterCalls = 0;
    const accessor = copyFrozenRecord(source, PROJECTION_KEYS, {
      accessorKey: 'sessionId',
      getter: () => {
        getterCalls += 1;
        return SESSION_CANARY;
      },
    });
    expectFixedFailure(() => classifyStripeCheckoutSessionResponseBinding(
      capsuleWith({ checkoutSessionProjection: accessor }),
    ), [SESSION_CANARY]);
    expect(getterCalls).toBe(0);

    const wrongDescriptor = copyFrozenRecord(source, PROJECTION_KEYS, {
      flags: { sessionId: { enumerable: false } },
    });
    expectFixedFailure(() => classifyStripeCheckoutSessionResponseBinding(
      capsuleWith({ checkoutSessionProjection: wrongDescriptor }),
    ));

    let proxyTrapCalls = 0;
    const proxy = new Proxy(source, {
      getPrototypeOf() { proxyTrapCalls += 1; return null; },
      ownKeys() { proxyTrapCalls += 1; return PROJECTION_KEYS; },
    });
    expectFixedFailure(() => classifyStripeCheckoutSessionResponseBinding(
      capsuleWith({ checkoutSessionProjection: proxy }),
    ));
    expect(proxyTrapCalls).toBe(0);
  });

  test.each([
    ['checkoutSessionProjectionSchemaVersion', 2],
    ['classification', 'trusted'],
    ['state', 'accepted'],
    ['provider', 'other'],
    ['providerOperation', 'refund_create'],
    ['sessionId', 'bad'],
    ['object', 'payment_intent'],
    ['livemode', 'false'],
    ['mode', 'embedded'],
    ['status', 'paid'],
    ['paymentStatus', 'processing'],
    ['amountTotalCents', -1],
    ['currency', 'USD'],
    ['createdEpochSeconds', -1],
    ['expiresAtEpochSeconds', 1800000000],
    ['checkoutUrlObservation', 'approved'],
    ['responseStatusObservation', 'accepted'],
    ['responseRequestIdObservation', 'verified'],
    ['responseApiVersionObservation', 'trusted'],
    ['responseIdempotencyKeyObservation', 'exact'],
    ['responseStripeAccountObservation', 'controlled'],
  ])('rejects malformed projection field %s', (field, value) => {
    const projection = projectionWith({ [field]: value });
    expectFixedFailure(() => classifyStripeCheckoutSessionResponseBinding(
      capsuleWith({ checkoutSessionProjection: projection }),
    ));
  });

  test('rejects inconsistent live ID and amount/currency pairs', () => {
    for (const overrides of [
      { livemode: true },
      { amountTotalCents: null, currency: 'usd' },
      { amountTotalCents: 2500, currency: null },
      { expiresAtEpochSeconds: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      const projection = projectionWith(overrides);
      expectFixedFailure(() => classifyStripeCheckoutSessionResponseBinding(
        capsuleWith({ checkoutSessionProjection: projection }),
      ));
    }
  });

  test.each([
    ['null API', { observedResponseApiVersion: null }],
    ['empty API', { observedResponseApiVersion: '' }],
    ['space API', { observedResponseApiVersion: '2023 10 16' }],
    ['control API', { observedResponseApiVersion: '2023\n10\t16' }],
    ['Unicode API', { observedResponseApiVersion: '2023-10-16-é' }],
    ['oversized API', { observedResponseApiVersion: 'A'.repeat(256) }],
    ['boxed API', { observedResponseApiVersion: new String(API_VERSION) }],
    ['null key', { observedResponseIdempotencyKey: null }],
    ['empty key', { observedResponseIdempotencyKey: '' }],
    ['space key', { observedResponseIdempotencyKey: 'key with space' }],
    ['oversized key', { observedResponseIdempotencyKey: 'K'.repeat(256) }],
    ['bad account prefix', { observedResponseStripeAccount: 'user_1234567890123456' }],
    ['short account', { observedResponseStripeAccount: 'acct_123456789012345' }],
    ['long account', { observedResponseStripeAccount: `acct_${'A'.repeat(65)}` }],
  ])('rejects malformed raw primitive: %s', (_label, overrides) => {
    const completeOverrides = Object.hasOwn(
      overrides,
      'observedResponseStripeAccount',
    )
      ? {
        checkoutSessionProjection: projectionWith({
          responseStripeAccountObservation: 'bounded_present',
        }),
        ...overrides,
      }
      : overrides;
    expectFixedFailure(() => classifyStripeCheckoutSessionResponseBinding(
      capsuleWith(completeOverrides),
    ));
  });

  test('accepts exact technical maxima and rejects the next byte', () => {
    const maxKey = 'K'.repeat(255);
    const maxAccount = `acct_${'A'.repeat(64)}`;
    const projection = projectionWith({ responseStripeAccountObservation: 'bounded_present' });
    expectCandidate(capsuleWith({
      checkoutSessionProjection: projection,
      observedResponseIdempotencyKey: maxKey,
      expectedResponseIdempotencyKey: maxKey,
      observedResponseStripeAccount: maxAccount,
      expectedResponseStripeAccount: maxAccount,
    }));
    expectFixedFailure(() => classifyStripeCheckoutSessionResponseBinding(
      capsuleWith({
        observedResponseIdempotencyKey: 'K'.repeat(256),
        expectedResponseIdempotencyKey: 'K'.repeat(256),
      }),
    ));
  });

  test('never invokes coercion, accessor, iterator, JSON, or Proxy hooks', () => {
    const calls = {
      toString: 0,
      valueOf: 0,
      primitive: 0,
      toJSON: 0,
      iterator: 0,
    };
    const hostile = Object.freeze({
      toString() { calls.toString += 1; return API_VERSION; },
      valueOf() { calls.valueOf += 1; return API_VERSION; },
      [Symbol.toPrimitive]() { calls.primitive += 1; return API_VERSION; },
      toJSON() { calls.toJSON += 1; return API_VERSION; },
      [Symbol.iterator]() { calls.iterator += 1; return [][Symbol.iterator](); },
    });
    expectFixedFailure(() => classifyStripeCheckoutSessionResponseBinding(
      capsuleWith({ observedResponseApiVersion: hostile }),
    ));
    expect(calls).toEqual({
      toString: 0,
      valueOf: 0,
      primitive: 0,
      toJSON: 0,
      iterator: 0,
    });
  });

  test('does not mutate capsule, projection, or descriptors', () => {
    const capsule = capsuleWith({
      observedResponseStripeAccount: STRIPE_ACCOUNT,
      expectedResponseStripeAccount: STRIPE_ACCOUNT,
    });
    const capsuleSnapshot = snapshotRecord(capsule);
    const projectionSnapshot = snapshotRecord(capsule.checkoutSessionProjection);
    expectCandidate(capsule);
    expectSnapshotUnchanged(capsule, capsuleSnapshot);
    expectSnapshotUnchanged(capsule.checkoutSessionProjection, projectionSnapshot);
  });

  test('ignores Object.prototype pollution and post-load intrinsic replacement', () => {
    const capsule = capsuleWith();
    const pollutedKey = '__stripeBindingPollutionForTest__';
    const originalHasOwn = Object.hasOwn;
    const originalOwnKeys = Reflect.ownKeys;
    const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const originalRegExpExec = RegExp.prototype.exec;
    let replacementCalls = 0;
    Object.defineProperty(Object.prototype, pollutedKey, {
      value: RAW_KEY_CANARY,
      enumerable: true,
      configurable: true,
    });
    Object.hasOwn = () => { replacementCalls += 1; return false; };
    Reflect.ownKeys = () => { replacementCalls += 1; return []; };
    Object.getOwnPropertyDescriptor = () => {
      replacementCalls += 1;
      return undefined;
    };
    RegExp.prototype.exec = () => {
      replacementCalls += 1;
      return null;
    };
    let result;
    try {
      result = classifyStripeCheckoutSessionResponseBinding(capsule);
    } finally {
      Object.hasOwn = originalHasOwn;
      Reflect.ownKeys = originalOwnKeys;
      Object.getOwnPropertyDescriptor = originalGetOwnPropertyDescriptor;
      RegExp.prototype.exec = originalRegExpExec;
      delete Object.prototype[pollutedKey];
    }
    expect(plainResult(result)).toEqual(PLATFORM_CANDIDATE);
    expect(replacementCalls).toBe(0);
  });

  test('fixed failures never echo raw transport, Session, URL, or personal canaries', () => {
    const projection = projectionWith({ sessionId: SESSION_CANARY });
    const capsule = capsuleWith({
      checkoutSessionProjection: projection,
      observedResponseApiVersion: RAW_API_CANARY,
      expectedResponseApiVersion: RAW_API_CANARY,
      observedResponseIdempotencyKey: RAW_KEY_CANARY,
      expectedResponseIdempotencyKey: RAW_KEY_CANARY,
      observedResponseStripeAccount: RAW_ACCOUNT_CANARY,
      expectedResponseStripeAccount: RAW_ACCOUNT_CANARY,
    });
    const error = expectFixedFailure(() => {
      const invalid = copyFrozenRecord(capsule, CAPSULE_KEYS, {
        keys: CAPSULE_KEYS.slice(0, -1),
      });
      classifyStripeCheckoutSessionResponseBinding(invalid);
    }, [
      RAW_API_CANARY,
      RAW_KEY_CANARY,
      RAW_ACCOUNT_CANARY,
      SESSION_CANARY,
      URL_CANARY,
    ]);
    expect(Object.isFrozen(error)).toBe(true);
  });

  test('never maps a transport candidate to C4C1 or permission vocabulary', () => {
    const result = plainResult(expectCandidate());
    for (const forbidden of [
      'unbound_result_candidate',
      'send_permitted',
      'provider_plan_bound',
      'pre_send_recorded',
      'authorized',
      'verified',
      'accepted',
      'trusted',
      'safe_to_persist',
    ]) {
      expect(result.classification).not.toBe(forbidden);
      expect(result.state).not.toBe(forbidden);
    }
  });

  test('static boundary has no side effect, provider, journal, config, or adoption edge', () => {
    const modulePath = path.join(
      __dirname,
      'stripeCheckoutSessionResponseBinding.js',
    );
    const source = fs.readFileSync(modulePath, 'utf8');
    const forbiddenPatterns = [
      /\basync\b/u,
      /\bawait\b/u,
      /\bPromise\b/u,
      /JSON\.(?:parse|stringify)\s*\(/u,
      /Object\.(?:keys|values|entries|getOwnPropertyDescriptors)\s*\(/u,
      /\.\.\./u,
      /process\.env/u,
      /Date\.(?:now|parse)\s*\(/u,
      /Math\.random\s*\(/u,
      /\bconsole\s*\./u,
      /\b(?:fetch|XMLHttpRequest)\b/u,
      /require\(['"](?:stripe|firebase|firebase-admin|firebase-functions)['"]\)/u,
      /require\(['"]node:(?:fs|http|https|net|tls|dgram|dns)['"]\)/u,
      /commerceCommandJournal/u,
      /commerceProviderResult/u,
      /stripeCheckoutSessionProjection/u,
      /serverConfig/u,
      /createCheckoutSession/u,
      /createMerchCheckout/u,
      /functions\/index/u,
    ];
    expect(forbiddenPatterns.every((pattern) => !pattern.test(source))).toBe(true);

    const requireTokens = source.match(/\brequire\b/gu) || [];
    const requireCalls = Array.from(
      source.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/gu),
      (match) => match[2],
    );
    expect(requireTokens.length).toBe(1);
    expect(requireCalls).toEqual(['node:util']);

    const repositoryRoot = path.join(__dirname, '..');
    const ignoredDirectories = new Set(['.git', 'build', 'coverage', 'node_modules']);
    const productionExtensions = /\.(?:cjs|js|jsx|mjs|ts|tsx)$/u;
    function listProductionFiles(directory) {
      const files = [];
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!ignoredDirectories.has(entry.name)) {
            files.push(...listProductionFiles(path.join(directory, entry.name)));
          }
          continue;
        }
        if (!entry.isFile()
          || !productionExtensions.test(entry.name)
          || /\.(?:spec|test)\.[^.]+$/u.test(entry.name)) {
          continue;
        }
        files.push(path.join(directory, entry.name));
      }
      return files;
    }
    const adopted = listProductionFiles(repositoryRoot)
      .filter((filePath) => filePath !== modulePath)
      .some((filePath) => {
        const contents = fs.readFileSync(filePath, 'utf8');
        return contents.includes('stripeCheckoutSessionResponseBinding')
          || contents.includes('classifyStripeCheckoutSessionResponseBinding');
      });
    expect(adopted).toBe(false);
  });
});
