'use strict';

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { inspect } = require('node:util');
const vm = require('node:vm');

const {
  checkoutSessionProjectionSchemaVersion,
  StripeCheckoutSessionProjectionError,
  projectStripeCheckoutSessionObservation,
} = require('./stripeCheckoutSessionProjection');

const TEST_SESSION_ID = 'cs_test_exampleprojection0001';
const LIVE_SESSION_ID = 'cs_live_exampleprojection0001';
const CHECKOUT_URL = 'https://checkout.example.test/c/pay/example#continue';
const REQUEST_ID = 'req_exampleprojection0001';
const IDEMPOTENCY_KEY = 'example-projection-key-0001';
const STRIPE_ACCOUNT_ID = 'acct_exampleprojection0001';
const PERSONAL_DATA_CANARY = 'private-runner@example.test';
const SECRET_CANARY = 'client-secret-example-never-copy';
const UNKNOWN_CANARY = 'future-provider-value-never-copy';

const ROOT_JSON_FIELDS = Object.freeze([
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
]);
const ROOT_FIELDS = Object.freeze([...ROOT_JSON_FIELDS, 'lastResponse']);
const RESPONSE_FIELDS = Object.freeze([
  'statusCode',
  'requestId',
  'apiVersion',
  'idempotencyKey',
  'stripeAccount',
]);
const OUTPUT_KEYS = Object.freeze([
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

const DEFAULT_ROOT_VALUES = Object.freeze({
  id: TEST_SESSION_ID,
  object: 'checkout.session',
  livemode: false,
  mode: 'payment',
  status: 'open',
  payment_status: 'unpaid',
  amount_total: 2500,
  currency: 'usd',
  created: 1700000000,
  expires_at: 1700001800,
  url: CHECKOUT_URL,
});
const DEFAULT_RESPONSE_VALUES = Object.freeze({
  statusCode: 200,
  requestId: REQUEST_ID,
  apiVersion: '2023-10-16',
  idempotencyKey: IDEMPOTENCY_KEY,
  stripeAccount: STRIPE_ACCOUNT_ID,
});

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function defineData(record, key, value, flags = {}) {
  Object.defineProperty(record, key, {
    value,
    enumerable: flags.enumerable !== undefined ? flags.enumerable : true,
    writable: flags.writable !== undefined ? flags.writable : true,
    configurable: flags.configurable !== undefined ? flags.configurable : true,
  });
}

function makeLastResponse(options = {}) {
  const prototype = Object.hasOwn(options, 'prototype')
    ? options.prototype
    : Object.prototype;
  const response = Object.create(prototype);
  const values = { ...DEFAULT_RESPONSE_VALUES, ...(options.values || {}) };
  for (const key of RESPONSE_FIELDS) {
    if (key === options.omit) continue;
    const descriptor = options.descriptors && options.descriptors[key];
    if (descriptor && descriptor.kind === 'accessor') {
      Object.defineProperty(response, key, {
        get: descriptor.get,
        set: descriptor.set,
        enumerable: descriptor.enumerable !== undefined
          ? descriptor.enumerable
          : true,
        configurable: descriptor.configurable !== undefined
          ? descriptor.configurable
          : true,
      });
      continue;
    }
    defineData(response, key, values[key], descriptor || {});
  }
  return response;
}

function makeSession(options = {}) {
  const prototype = Object.hasOwn(options, 'prototype')
    ? options.prototype
    : Object.prototype;
  const session = Object.create(prototype);
  const values = { ...DEFAULT_ROOT_VALUES, ...(options.values || {}) };
  for (const key of ROOT_JSON_FIELDS) {
    if (key === options.omit) continue;
    const descriptor = options.descriptors && options.descriptors[key];
    if (descriptor && descriptor.kind === 'accessor') {
      Object.defineProperty(session, key, {
        get: descriptor.get,
        set: descriptor.set,
        enumerable: descriptor.enumerable !== undefined
          ? descriptor.enumerable
          : true,
        configurable: descriptor.configurable !== undefined
          ? descriptor.configurable
          : true,
      });
      continue;
    }
    defineData(session, key, values[key], descriptor || {});
  }

  if (options.omit !== 'lastResponse') {
    const lastResponse = Object.hasOwn(options, 'lastResponse')
      ? options.lastResponse
      : makeLastResponse(options.responseOptions);
    const descriptor = options.descriptors && options.descriptors.lastResponse;
    if (descriptor && descriptor.kind === 'accessor') {
      Object.defineProperty(session, 'lastResponse', {
        get: descriptor.get,
        set: descriptor.set,
        enumerable: descriptor.enumerable !== undefined
          ? descriptor.enumerable
          : false,
        configurable: descriptor.configurable !== undefined
          ? descriptor.configurable
          : false,
      });
    } else {
      defineData(session, 'lastResponse', lastResponse, {
        enumerable: false,
        writable: false,
        configurable: false,
        ...(descriptor || {}),
      });
    }
  }
  return session;
}

function captureFailure(callback, rawValues = []) {
  let error;
  try {
    callback();
  } catch (caught) {
    error = caught;
  }
  if (!error) return Object.freeze({ threw: false });

  const fixedRendered = [
    String(error),
    JSON.stringify(error),
    error.name,
    error.code,
    error.message,
  ].join('\n');
  const renderedWithStack = [
    fixedRendered,
    inspect(error),
    error.stack,
  ].join('\n');
  const nameDescriptor = Object.getOwnPropertyDescriptor(error, 'name');
  const codeDescriptor = Object.getOwnPropertyDescriptor(error, 'code');
  const messageDescriptor = Object.getOwnPropertyDescriptor(error, 'message');
  const stackDescriptor = Object.getOwnPropertyDescriptor(error, 'stack');
  const descriptorsAreFixed = [
    nameDescriptor,
    codeDescriptor,
    messageDescriptor,
    stackDescriptor,
  ]
    .every((descriptor) => descriptor
      && descriptor.enumerable === false
      && descriptor.writable === false
      && descriptor.configurable === false);
  const ownKeys = Reflect.ownKeys(error);
  const exactOwnSurface = ownKeys.length === 4
    && ownKeys.every((key) => typeof key === 'string')
    && ['code', 'message', 'name', 'stack'].every((key) => ownKeys.includes(key));

  return Object.freeze({
    threw: true,
    exactClass: error instanceof StripeCheckoutSessionProjectionError,
    exactName: error.name === 'StripeCheckoutSessionProjectionError',
    exactCode: error.code === 'invalid_stripe_checkout_session_observation',
    exactMessage: error.message
      === 'Stripe Checkout Session observation is invalid.',
    frozen: Object.isFrozen(error),
    descriptorsAreFixed,
    exactOwnSurface,
    noCause: !Object.hasOwn(error, 'cause'),
    rawAbsent: rawValues
      .filter((rawValue) => typeof rawValue === 'string' && rawValue.length > 0)
      .every((rawValue) => !fixedRendered.includes(rawValue)
        && (rawValue.length < 8 || !renderedWithStack.includes(rawValue))),
    canariesAbsent: [PERSONAL_DATA_CANARY, SECRET_CANARY, UNKNOWN_CANARY]
      .every((canary) => !renderedWithStack.includes(canary)),
    error,
  });
}

function expectFixedFailure(callback, rawValues = []) {
  const observation = captureFailure(callback, rawValues);
  const safeChecks = [
    observation.threw,
    observation.exactClass,
    observation.exactName,
    observation.exactCode,
    observation.exactMessage,
    observation.frozen,
    observation.descriptorsAreFixed,
    observation.exactOwnSurface,
    observation.noCause,
    observation.rawAbsent,
    observation.canariesAbsent,
  ];
  expect(safeChecks.every(Boolean)).toBe(true);
  return observation.error;
}

function project(overrides = {}) {
  return projectStripeCheckoutSessionObservation(makeSession(overrides));
}

describe('server-only Stripe Checkout Session projection', () => {
  test('exports one frozen, versioned, unused projection API', () => {
    const api = require('./stripeCheckoutSessionProjection');
    expect(checkoutSessionProjectionSchemaVersion === 1).toBe(true);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(StripeCheckoutSessionProjectionError)).toBe(true);
    expect(Object.isFrozen(StripeCheckoutSessionProjectionError.prototype)).toBe(true);
    expect(typeof projectStripeCheckoutSessionObservation === 'function').toBe(true);
  });

  test('projects exact test/live IDs and the full installed enum matrices', () => {
    const modes = ['payment', 'setup', 'subscription'];
    const statuses = ['open', 'complete', 'expired', null];
    const paymentStatuses = ['paid', 'unpaid', 'no_payment_required'];
    let count = 0;

    for (const livemode of [false, true]) {
      for (const mode of modes) {
        for (const status of statuses) {
          for (const paymentStatus of paymentStatuses) {
            const sessionId = livemode ? LIVE_SESSION_ID : TEST_SESSION_ID;
            const output = project({
              values: {
                id: sessionId,
                livemode,
                mode,
                status,
                payment_status: paymentStatus,
              },
            });
            const safeChecks = [
              digest(output.sessionId) === digest(sessionId),
              output.livemode === livemode,
              output.mode === mode,
              output.status === status,
              output.paymentStatus === paymentStatus,
            ];
            expect(safeChecks.every(Boolean)).toBe(true);
            count += 1;
          }
        }
      }
    }
    expect(count === 72).toBe(true);
  });

  test('projects amount, currency, timestamp, URL, and response categories only', () => {
    const cases = [
      {
        values: { amount_total: 0, currency: 'usd', created: 0, expires_at: 1 },
        responseValues: DEFAULT_RESPONSE_VALUES,
        expected: [0, 'usd', 'bounded_https_capability_present', 'expected_200',
          'bounded_present', 'expected_2023_10_16', 'bounded_present',
          'bounded_present'],
      },
      {
        values: {
          amount_total: Number.MAX_SAFE_INTEGER,
          currency: 'eur',
          url: null,
        },
        responseValues: {
          statusCode: 204,
          requestId: undefined,
          apiVersion: undefined,
          idempotencyKey: undefined,
          stripeAccount: undefined,
        },
        expected: [Number.MAX_SAFE_INTEGER, 'eur', 'absent', 'other_2xx',
          'missing', 'missing', 'missing', 'missing'],
      },
      {
        values: { amount_total: null, currency: null },
        responseValues: {
          statusCode: 503,
          requestId: REQUEST_ID,
          apiVersion: '2024-12-31.example',
          idempotencyKey: IDEMPOTENCY_KEY,
          stripeAccount: STRIPE_ACCOUNT_ID,
        },
        expected: [null, null, 'bounded_https_capability_present', 'non_2xx',
          'bounded_present', 'other_bounded', 'bounded_present',
          'bounded_present'],
      },
    ];

    for (const testCase of cases) {
      const output = project({
        values: testCase.values,
        responseOptions: { values: testCase.responseValues },
      });
      const actual = [
        output.amountTotalCents,
        output.currency,
        output.checkoutUrlObservation,
        output.responseStatusObservation,
        output.responseRequestIdObservation,
        output.responseApiVersionObservation,
        output.responseIdempotencyKeyObservation,
        output.responseStripeAccountObservation,
      ];
      expect(actual.every((value, index) => value === testCase.expected[index]))
        .toBe(true);
    }
  });

  test('accepts every exact maximum technical boundary without exposing raw transport data', () => {
    const maximumRequestId = `req_${'r'.repeat(251)}`;
    const maximumApiVersion = 'v'.repeat(255);
    const maximumIdempotencyKey = 'k'.repeat(255);
    const maximumUrlPrefix = 'https://checkout.example.test/';
    const maximumUrl = maximumUrlPrefix
      + 'u'.repeat(8192 - maximumUrlPrefix.length);
    const sessionIds = [
      `cs_test_${'t'.repeat(247)}`,
      `cs_live_${'l'.repeat(247)}`,
    ];

    for (const sessionId of sessionIds) {
      const livemode = sessionId === sessionIds[1];
      for (const responseStatusCode of [100, 599]) {
        const output = project({
          values: {
            id: sessionId,
            livemode,
            amount_total: Number.MAX_SAFE_INTEGER,
            created: Number.MAX_SAFE_INTEGER - 1,
            expires_at: Number.MAX_SAFE_INTEGER,
            url: maximumUrl,
          },
          responseOptions: {
            values: {
              statusCode: responseStatusCode,
              requestId: maximumRequestId,
              apiVersion: maximumApiVersion,
              idempotencyKey: maximumIdempotencyKey,
              stripeAccount: `acct_${'a'.repeat(64)}`,
            },
          },
        });
        const serialized = JSON.stringify(output);
        const safeChecks = [
          digest(output.sessionId) === digest(sessionId),
          output.amountTotalCents === Number.MAX_SAFE_INTEGER,
          output.createdEpochSeconds === Number.MAX_SAFE_INTEGER - 1,
          output.expiresAtEpochSeconds === Number.MAX_SAFE_INTEGER,
          output.checkoutUrlObservation === 'bounded_https_capability_present',
          output.responseStatusObservation === 'non_2xx',
          output.responseRequestIdObservation === 'bounded_present',
          output.responseApiVersionObservation === 'other_bounded',
          output.responseIdempotencyKeyObservation === 'bounded_present',
          output.responseStripeAccountObservation === 'bounded_present',
          !serialized.includes(maximumUrl),
          !serialized.includes(maximumRequestId),
          !serialized.includes(maximumApiVersion),
          !serialized.includes(maximumIdempotencyKey),
        ];
        expect(safeChecks.every(Boolean)).toBe(true);
      }
    }
  });

  test('accepts minimum bounded identifier and response-string shapes', () => {
    const output = project({
      values: { id: 'cs_test_a' },
      responseOptions: {
        values: {
          statusCode: 299,
          requestId: 'req_a',
          apiVersion: 'a',
          idempotencyKey: 'a',
          stripeAccount: `acct_${'a'.repeat(16)}`,
        },
      },
    });
    const safeChecks = [
      digest(output.sessionId) === digest('cs_test_a'),
      output.responseStatusObservation === 'other_2xx',
      output.responseRequestIdObservation === 'bounded_present',
      output.responseApiVersionObservation === 'other_bounded',
      output.responseIdempotencyKeyObservation === 'bounded_present',
      output.responseStripeAccountObservation === 'bounded_present',
    ];
    expect(safeChecks.every(Boolean)).toBe(true);
  });

  test('classifies standard, custom-host, uppercase-scheme, and fragment HTTPS URLs', () => {
    const values = [
      'https://checkout.stripe.example/session/example',
      'https://custom-checkout.example.test/path?synthetic=1',
      'HTTPS://checkout.example.test/path',
      'https://checkout.example.test/path#fragment',
    ];
    for (const rawUrl of values) {
      const output = project({ values: { url: rawUrl } });
      const safeChecks = [
        output.checkoutUrlObservation === 'bounded_https_capability_present',
        !Object.values(output).includes(rawUrl),
        !JSON.stringify(output).includes(rawUrl),
      ];
      expect(safeChecks.every(Boolean)).toBe(true);
    }
  });

  test('returns the exact fresh, null-prototype, immutable flat shape', () => {
    const session = makeSession();
    const first = projectStripeCheckoutSessionObservation(session);
    const second = projectStripeCheckoutSessionObservation(session);
    const beforeDigest = digest(JSON.stringify(first));
    const descriptors = Object.getOwnPropertyDescriptors(first);

    const safeChecks = [
      Object.getPrototypeOf(first) === null,
      Object.isFrozen(first),
      first !== second,
      Object.keys(first).every((key, index) => key === OUTPUT_KEYS[index]),
      Object.keys(first).length === OUTPUT_KEYS.length,
      Object.values(first).every((value) => value === null
        || ['string', 'number', 'boolean'].includes(typeof value)),
      OUTPUT_KEYS.every((key) => descriptors[key]
        && descriptors[key].enumerable === true
        && descriptors[key].writable === false
        && descriptors[key].configurable === false),
      first.classification === 'untrusted_checkout_session_projection',
      first.state
        === 'requires_runtime_binding_persistence_and_business_validation',
      first.provider === 'stripe',
      first.providerOperation === 'checkout_session_create',
      first.object === 'checkout.session',
    ];
    expect(safeChecks.every(Boolean)).toBe(true);

    session.id = LIVE_SESSION_ID;
    session.url = 'https://changed.example.test/changed';
    session.amount_total = 1;
    session.lastResponse.requestId = 'req_changed';
    expect(digest(JSON.stringify(first)) === beforeDigest).toBe(true);
  });

  test('preserves every selected input descriptor and rejects strict output mutation', () => {
    const session = makeSession();
    const response = session.lastResponse;
    const rootBefore = new Map(ROOT_FIELDS.map((key) => [
      key,
      Object.getOwnPropertyDescriptor(session, key),
    ]));
    const responseBefore = new Map(RESPONSE_FIELDS.map((key) => [
      key,
      Object.getOwnPropertyDescriptor(response, key),
    ]));
    const output = projectStripeCheckoutSessionObservation(session);

    function descriptorUnchanged(record, key, before) {
      const after = Object.getOwnPropertyDescriptor(record, key);
      return Boolean(after)
        && Object.is(after.value, before.value)
        && after.enumerable === before.enumerable
        && after.writable === before.writable
        && after.configurable === before.configurable
        && Object.hasOwn(after, 'get') === Object.hasOwn(before, 'get')
        && Object.hasOwn(after, 'set') === Object.hasOwn(before, 'set');
    }

    let writeRejected = false;
    let deleteRejected = false;
    try {
      output.mode = 'setup';
    } catch (error) {
      writeRejected = error instanceof TypeError;
    }
    try {
      delete output.mode;
    } catch (error) {
      deleteRejected = error instanceof TypeError;
    }

    const safeChecks = [
      ROOT_FIELDS.every((key) => descriptorUnchanged(
        session,
        key,
        rootBefore.get(key),
      )),
      RESPONSE_FIELDS.every((key) => descriptorUnchanged(
        response,
        key,
        responseBefore.get(key),
      )),
      writeRejected,
      deleteRejected,
      output.mode === 'payment',
    ];
    expect(safeChecks.every(Boolean)).toBe(true);
  });

  test('never copies URL, transport identifiers, personal data, or future fields', () => {
    let getterCalls = 0;
    const baselineDigest = digest(JSON.stringify(project()));
    const response = makeLastResponse();
    const session = makeSession({ lastResponse: response });
    const hostileGetter = () => {
      getterCalls += 1;
      throw new Error('must remain unobserved');
    };
    const rootExtras = [
      'success_url', 'cancel_url', 'metadata', 'customer', 'customer_details',
      'customer_email', 'client_secret', 'line_items', 'discounts', 'tax',
      'shipping', 'payment_method', 'future_provider_field',
    ];
    const responseExtras = [
      'headers', 'body', 'socket', 'stream', 'method', 'requestUrl',
      'future_response_field',
    ];
    for (const key of rootExtras) {
      Object.defineProperty(session, key, {
        get: hostileGetter,
        enumerable: true,
        configurable: true,
      });
    }
    for (const key of responseExtras) {
      Object.defineProperty(response, key, {
        get: hostileGetter,
        enumerable: true,
        configurable: true,
      });
    }
    const ignoredProxy = new Proxy({}, {
      get() {
        getterCalls += 1;
        throw new Error('proxy trap must remain unobserved');
      },
      ownKeys() {
        getterCalls += 1;
        throw new Error('proxy trap must remain unobserved');
      },
    });
    defineData(session, 'future_nested_proxy', ignoredProxy);
    defineData(session, 'future_personal_data', PERSONAL_DATA_CANARY);
    defineData(session, 'future_secret_value', SECRET_CANARY);
    defineData(response, 'future_unknown_value', UNKNOWN_CANARY);
    defineData(session, Symbol('future-symbol'), PERSONAL_DATA_CANARY);
    defineData(response, Symbol('response-symbol'), SECRET_CANARY);

    const output = projectStripeCheckoutSessionObservation(session);
    const serialized = JSON.stringify(output);
    const inspected = inspect(output);
    const forbiddenRawValues = [
      CHECKOUT_URL,
      REQUEST_ID,
      IDEMPOTENCY_KEY,
      STRIPE_ACCOUNT_ID,
      PERSONAL_DATA_CANARY,
      SECRET_CANARY,
      UNKNOWN_CANARY,
    ];
    const safeChecks = [
      getterCalls === 0,
      digest(serialized) === baselineDigest,
      forbiddenRawValues.every((value) => !serialized.includes(value)),
      forbiddenRawValues.every((value) => !inspected.includes(value)),
      !Object.hasOwn(output, 'url'),
      !Object.hasOwn(output, 'requestId'),
      !Object.hasOwn(output, 'idempotencyKey'),
      !Object.hasOwn(output, 'stripeAccount'),
      !Object.hasOwn(output, 'lastResponse'),
      !Object.hasOwn(output, 'accepted'),
      !Object.hasOwn(output, 'authorized'),
      !Object.hasOwn(output, 'success'),
    ];
    expect(safeChecks.every(Boolean)).toBe(true);
  });

  test('accepts an IncomingMessage-like response without touching its prototype', () => {
    let inheritedCalls = 0;
    const prototype = Object.create(null);
    for (const key of ['headers', 'body', 'socket', 'pipe', 'destroy']) {
      Object.defineProperty(prototype, key, {
        get() {
          inheritedCalls += 1;
          throw new Error('inherited member must remain unobserved');
        },
        configurable: true,
      });
    }
    const response = makeLastResponse({ prototype });
    const output = project({ lastResponse: response });
    const safeChecks = [
      inheritedCalls === 0,
      output.responseStatusObservation === 'expected_200',
      output.responseRequestIdObservation === 'bounded_present',
    ];
    expect(safeChecks.every(Boolean)).toBe(true);
  });

  test('fails every missing, inherited, accessor-backed, and malformed root descriptor', () => {
    let hookCalls = 0;
    for (const key of ROOT_FIELDS) {
      expectFixedFailure(() => project({ omit: key }));

      const prior = Object.getOwnPropertyDescriptor(Object.prototype, key);
      try {
        Object.defineProperty(Object.prototype, key, {
          get() {
            hookCalls += 1;
            throw new Error('inherited getter must not run');
          },
          configurable: true,
        });
        expectFixedFailure(() => project({ omit: key }));
      } finally {
        delete Object.prototype[key];
        if (prior) Object.defineProperty(Object.prototype, key, prior);
      }

      expectFixedFailure(() => project({
        descriptors: {
          [key]: {
            kind: 'accessor',
            get() {
              hookCalls += 1;
              throw new Error('selected getter must not run');
            },
            set() {
              hookCalls += 1;
            },
          },
        },
      }));

      const expectedFlags = key === 'lastResponse'
        ? { enumerable: false, writable: false, configurable: false }
        : { enumerable: true, writable: true, configurable: true };
      for (const flag of ['enumerable', 'writable', 'configurable']) {
        expectFixedFailure(() => project({
          descriptors: {
            [key]: { ...expectedFlags, [flag]: !expectedFlags[flag] },
          },
        }));
      }
    }
    expect(hookCalls === 0).toBe(true);
  });

  test('rejects a wrong type for every selected root field without coercion', () => {
    let coercionCalls = 0;
    const coercionObject = {
      toString() {
        coercionCalls += 1;
        return 'coerced';
      },
      valueOf() {
        coercionCalls += 1;
        return 1;
      },
      [Symbol.toPrimitive]() {
        coercionCalls += 1;
        return 'coerced';
      },
    };
    const wrongValues = {
      id: coercionObject,
      object: coercionObject,
      livemode: 'false',
      mode: coercionObject,
      status: coercionObject,
      payment_status: coercionObject,
      amount_total: '2500',
      currency: coercionObject,
      created: '1700000000',
      expires_at: coercionObject,
      url: coercionObject,
    };
    for (const key of ROOT_JSON_FIELDS) {
      expectFixedFailure(
        () => project({ values: { [key]: wrongValues[key] } }),
        [wrongValues[key]],
      );
    }
    expectFixedFailure(() => project({ lastResponse: coercionObject }));
    expect(coercionCalls === 0).toBe(true);
  });

  test('fails every missing, accessor-backed, or malformed response descriptor', () => {
    let hookCalls = 0;
    for (const key of RESPONSE_FIELDS) {
      expectFixedFailure(() => project({ responseOptions: { omit: key } }));
      expectFixedFailure(() => project({
        responseOptions: {
          descriptors: {
            [key]: {
              kind: 'accessor',
              get() {
                hookCalls += 1;
                throw new Error('response getter must not run');
              },
              set() {
                hookCalls += 1;
              },
            },
          },
        },
      }));
      for (const flag of ['enumerable', 'writable', 'configurable']) {
        expectFixedFailure(() => project({
          responseOptions: {
            descriptors: { [key]: { [flag]: false } },
          },
        }));
      }
    }
    expect(hookCalls === 0).toBe(true);
  });

  test('rejects inherited selected response fields without invoking hostile getters', () => {
    let getterCalls = 0;
    for (const key of RESPONSE_FIELDS) {
      const prototype = Object.create(null);
      Object.defineProperty(prototype, key, {
        get() {
          getterCalls += 1;
          throw new Error('inherited response getter must not run');
        },
        configurable: true,
      });
      expectFixedFailure(() => project({
        lastResponse: makeLastResponse({ omit: key, prototype }),
      }));
    }
    expect(getterCalls === 0).toBe(true);
  });

  test('rejects malformed response values without coercion', () => {
    let coercionCalls = 0;
    const coercionObject = {
      toString() {
        coercionCalls += 1;
        return 'req_coerced';
      },
      valueOf() {
        coercionCalls += 1;
        return 200;
      },
      [Symbol.toPrimitive]() {
        coercionCalls += 1;
        return 'acct_coerced';
      },
    };
    const wrongValues = {
      statusCode: coercionObject,
      requestId: coercionObject,
      apiVersion: coercionObject,
      idempotencyKey: coercionObject,
      stripeAccount: coercionObject,
    };
    for (const key of RESPONSE_FIELDS) {
      expectFixedFailure(() => project({
        responseOptions: { values: { [key]: wrongValues[key] } },
      }));
    }
    expect(coercionCalls === 0).toBe(true);
  });

  test('rejects root, revoked, and raw-response Proxies before all traps', () => {
    let trapCalls = 0;
    const traps = {
      get() {
        trapCalls += 1;
        throw new Error('get trap must not run');
      },
      getOwnPropertyDescriptor() {
        trapCalls += 1;
        throw new Error('descriptor trap must not run');
      },
      getPrototypeOf() {
        trapCalls += 1;
        throw new Error('prototype trap must not run');
      },
      ownKeys() {
        trapCalls += 1;
        throw new Error('keys trap must not run');
      },
    };
    expectFixedFailure(() => projectStripeCheckoutSessionObservation(
      new Proxy(makeSession(), traps),
    ));
    expectFixedFailure(() => project({
      lastResponse: new Proxy(makeLastResponse(), traps),
    }));
    const revokedRoot = Proxy.revocable(makeSession(), traps);
    revokedRoot.revoke();
    expectFixedFailure(() => projectStripeCheckoutSessionObservation(revokedRoot.proxy));
    const revokedResponse = Proxy.revocable(makeLastResponse(), traps);
    revokedResponse.revoke();
    expectFixedFailure(() => project({ lastResponse: revokedResponse.proxy }));
    expect(trapCalls === 0).toBe(true);
  });

  test('rejects custom, null, array, function, and private-slot root prototypes', () => {
    const branded = vm.runInNewContext(`
      new (class PrivateRoot {
        #secret = 'unread';
        readSecret() { return this.#secret; }
      })()
    `);
    for (const key of ROOT_JSON_FIELDS) {
      defineData(branded, key, DEFAULT_ROOT_VALUES[key]);
    }
    defineData(branded, 'lastResponse', makeLastResponse(), {
      enumerable: false,
      writable: false,
      configurable: false,
    });
    const invalidRoots = [
      null,
      undefined,
      'checkout.session',
      [],
      Object.create(null),
      Object.create({ custom: true }),
      branded,
      function rootFunction() {},
    ];
    for (const root of invalidRoots) {
      expectFixedFailure(() => projectStripeCheckoutSessionObservation(root), [root]);
    }
  });

  test('rejects all malformed IDs, enum values, money, currency, and epochs', () => {
    const invalidCases = [
      { id: '' },
      { id: 'cs_test_' },
      { id: 'cs_live_exampleprojection0001' },
      { id: `cs_test_${'a'.repeat(248)}` },
      { id: 'cs_test_example-confusable' },
      { id: `cs_test_example\u0000` },
      { id: `cs_test_example\ud800` },
      { object: 'payment_intent' },
      { mode: 'future_mode' },
      { status: 'processing' },
      { payment_status: 'processing' },
      { amount_total: -1 },
      { amount_total: 1.5 },
      { amount_total: Number.MAX_SAFE_INTEGER + 1 },
      { amount_total: null, currency: 'usd' },
      { amount_total: 1, currency: null },
      { currency: 'USD' },
      { currency: 'us' },
      { currency: 'usd\u0000' },
      { created: -1 },
      { created: 1.5 },
      { created: Number.MAX_SAFE_INTEGER + 1 },
      { expires_at: -1 },
      { expires_at: Number.MAX_SAFE_INTEGER + 1 },
      { expires_at: 1700000000 },
      { expires_at: 1699999999 },
    ];
    for (const values of invalidCases) {
      expectFixedFailure(() => project({ values }), Object.values(values));
    }

    expectFixedFailure(() => project({
      values: { id: TEST_SESSION_ID, livemode: true },
    }), [TEST_SESSION_ID]);
    expectFixedFailure(() => project({
      values: { id: LIVE_SESSION_ID, livemode: false },
    }), [LIVE_SESSION_ID]);
  });

  test('rejects special and coercible numeric values without invoking them', () => {
    let coercionCalls = 0;
    const numericObject = {
      valueOf() {
        coercionCalls += 1;
        return 200;
      },
      toString() {
        coercionCalls += 1;
        return '200';
      },
      [Symbol.toPrimitive]() {
        coercionCalls += 1;
        return 200;
      },
    };
    const specialValues = [
      NaN,
      Infinity,
      -Infinity,
      1n,
      Symbol('synthetic-number'),
      function syntheticNumber() {},
      numericObject,
      {},
      [],
    ];
    for (const value of specialValues) {
      expectFixedFailure(() => project({ values: { amount_total: value } }));
      expectFixedFailure(() => project({ values: { created: value } }));
      expectFixedFailure(() => project({ values: { expires_at: value } }));
      expectFixedFailure(() => project({
        responseOptions: { values: { statusCode: value } },
      }));
    }
    expect(coercionCalls === 0).toBe(true);
  });

  test('rejects malformed or capability-confusing URLs without exposing them', () => {
    let coercionCalls = 0;
    const coercionUrl = {
      toString() {
        coercionCalls += 1;
        return CHECKOUT_URL;
      },
      [Symbol.toPrimitive]() {
        coercionCalls += 1;
        return CHECKOUT_URL;
      },
    };
    const overlongUrlPrefix = 'https://checkout.example.test/';
    const invalidUrls = [
      '',
      'http://checkout.example.test/path',
      '//checkout.example.test/path',
      'https:checkout.example.test/path',
      'https:\\checkout.example.test/path',
      'https://user@checkout.example.test/path',
      'https://user:password@checkout.example.test/path',
      'https://@checkout.example.test/path',
      'data:text/plain,example',
      'javascript:example',
      'https://',
      'https://exa mple.test/path',
      'https://checkout.example.test/\u0000path',
      'https://checkout.example.test/\ud800',
      overlongUrlPrefix + 'a'.repeat(8193 - overlongUrlPrefix.length),
      coercionUrl,
    ];
    for (const rawUrl of invalidUrls) {
      expectFixedFailure(() => project({ values: { url: rawUrl } }), [rawUrl]);
    }
    expect(coercionCalls === 0).toBe(true);
  });

  test('rejects invalid response status and bounded strings identically', () => {
    for (const suffixLength of [16, 64]) {
      const rawAccountId = `acct_${'a'.repeat(suffixLength)}`;
      const output = project({
        responseOptions: { values: { stripeAccount: rawAccountId } },
      });
      const safeChecks = [
        output.responseStripeAccountObservation === 'bounded_present',
        !JSON.stringify(output).includes(rawAccountId),
      ];
      expect(safeChecks.every(Boolean)).toBe(true);
    }

    const cases = [
      ['statusCode', 99],
      ['statusCode', 600],
      ['statusCode', 200.5],
      ['statusCode', Number.MAX_SAFE_INTEGER + 1],
      ['requestId', ''],
      ['requestId', 'request_example'],
      ['requestId', `req_${'a'.repeat(252)}`],
      ['requestId', 'req_example\u0000'],
      ['requestId', 'req_example\ud800'],
      ['apiVersion', ''],
      ['apiVersion', 'version\u0000'],
      ['apiVersion', '\ud800'],
      ['apiVersion', 'a'.repeat(256)],
      ['idempotencyKey', ''],
      ['idempotencyKey', 'key with space'],
      ['idempotencyKey', 'key\u0000'],
      ['idempotencyKey', '\ud800'],
      ['idempotencyKey', 'a'.repeat(256)],
      ['stripeAccount', ''],
      ['stripeAccount', 'account_example'],
      ['stripeAccount', `acct_${'a'.repeat(15)}`],
      ['stripeAccount', `acct_${'a'.repeat(65)}`],
      ['stripeAccount', 'acct_example\u0000'],
      ['stripeAccount', 'acct_example\ud800'],
    ];
    for (const [key, rawValue] of cases) {
      expectFixedFailure(() => project({
        responseOptions: { values: { [key]: rawValue } },
      }), [rawValue]);
    }
  });

  test('pre-load and post-load Object.prototype pollution stays unobserved', () => {
    const modulePath = path.join(__dirname, 'stripeCheckoutSessionProjection.js');
    const pollutionKeys = [
      'temporaryProjectionPollution',
      'value',
      'writable',
      'enumerable',
      'configurable',
      'get',
      'set',
    ];
    for (const pollutionKey of pollutionKeys) {
      const script = `
        'use strict';
        function descriptor(value, enumerable, writable, configurable) {
          const result = Object.create(null);
          result.value = value;
          result.enumerable = enumerable;
          result.writable = writable;
          result.configurable = configurable;
          return result;
        }
        function define(record, key, value, enumerable = true,
          writable = true, configurable = true) {
          Object.defineProperty(
            record,
            key,
            descriptor(value, enumerable, writable, configurable),
          );
        }
        const response = {};
        define(response, 'statusCode', 200);
        define(response, 'requestId', 'req_exampleprojection0001');
        define(response, 'apiVersion', '2023-10-16');
        define(response, 'idempotencyKey', 'example-projection-key-0001');
        define(response, 'stripeAccount', 'acct_exampleprojection0001');
        const session = {};
        define(session, 'id', 'cs_test_exampleprojection0001');
        define(session, 'object', 'checkout.session');
        define(session, 'livemode', false);
        define(session, 'mode', 'payment');
        define(session, 'status', 'open');
        define(session, 'payment_status', 'unpaid');
        define(session, 'amount_total', 2500);
        define(session, 'currency', 'usd');
        define(session, 'created', 1700000000);
        define(session, 'expires_at', 1700001800);
        define(session, 'url', 'https://checkout.example.test/example');
        define(session, 'lastResponse', response, false, false, false);
        const key = ${JSON.stringify(pollutionKey)};
        const original = Object.getOwnPropertyDescriptor(Object.prototype, key);
        let getterCalls = 0;
        function install() {
          const pollution = Object.create(null);
          pollution.get = () => {
            getterCalls += 1;
            throw new Error('pollution getter invoked');
          };
          pollution.configurable = true;
          Object.defineProperty(Object.prototype, key, pollution);
        }
        function restore() {
          delete Object.prototype[key];
          if (original) Object.defineProperty(Object.prototype, key, original);
        }
        let api;
        let first;
        let second;
        try {
          install();
          api = require(${JSON.stringify(modulePath)});
          first = api.projectStripeCheckoutSessionObservation(session);
          restore();
          install();
          second = api.projectStripeCheckoutSessionObservation(session);
        } finally {
          restore();
        }
        if (getterCalls !== 0
          || first.checkoutUrlObservation !== 'bounded_https_capability_present'
          || second.responseStatusObservation !== 'expected_200') {
          process.exit(2);
        }
        process.stdout.write('fixed-projection');
      `;
      const result = spawnSync(process.execPath, ['-e', script], {
        cwd: __dirname,
        encoding: 'utf8',
      });
      const safeChecks = [
        result.status === 0,
        result.stdout === 'fixed-projection',
        result.stderr === '',
      ];
      expect(safeChecks.every(Boolean)).toBe(true);
    }
  });

  test('post-load intrinsic monkeypatching cannot influence a projection', () => {
    const session = makeSession();
    const urlPrototype = require('node:url').URL.prototype;
    const originals = {
      getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
      getPrototypeOf: Object.getPrototypeOf,
      create: Object.create,
      freeze: Object.freeze,
      hasOwn: Object.hasOwn,
      isSafeInteger: Number.isSafeInteger,
      regexTest: RegExp.prototype.test,
      setHas: Set.prototype.has,
      protocol: Object.getOwnPropertyDescriptor(urlPrototype, 'protocol'),
      username: Object.getOwnPropertyDescriptor(urlPrototype, 'username'),
      password: Object.getOwnPropertyDescriptor(urlPrototype, 'password'),
      hostname: Object.getOwnPropertyDescriptor(urlPrototype, 'hostname'),
    };
    const thrower = () => {
      throw new Error('patched intrinsic must not run');
    };
    let safeResult = false;
    try {
      Object.getOwnPropertyDescriptor = thrower;
      Object.getPrototypeOf = thrower;
      Object.create = thrower;
      Object.freeze = thrower;
      Object.hasOwn = thrower;
      Number.isSafeInteger = thrower;
      RegExp.prototype.test = thrower;
      Set.prototype.has = thrower;
      for (const key of ['protocol', 'username', 'password', 'hostname']) {
        Object.defineProperty(urlPrototype, key, {
          get: thrower,
          set: thrower,
          configurable: true,
          enumerable: true,
        });
      }
      const output = projectStripeCheckoutSessionObservation(session);
      safeResult = output.responseApiVersionObservation
        === 'expected_2023_10_16';
    } finally {
      Object.getOwnPropertyDescriptor = originals.getOwnPropertyDescriptor;
      Object.getPrototypeOf = originals.getPrototypeOf;
      Object.create = originals.create;
      Object.freeze = originals.freeze;
      Object.hasOwn = originals.hasOwn;
      Number.isSafeInteger = originals.isSafeInteger;
      RegExp.prototype.test = originals.regexTest;
      Set.prototype.has = originals.setHas;
      for (const key of ['protocol', 'username', 'password', 'hostname']) {
        Object.defineProperty(urlPrototype, key, originals[key]);
      }
    }
    expect(safeResult).toBe(true);
  });

  test('all invalid inputs create distinct fixed errors and emit no console output', () => {
    const originalMethods = new Map(['error', 'warn', 'log', 'info'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(console, key),
    ]));
    let consoleCalls = 0;
    const replacement = () => {
      consoleCalls += 1;
    };
    let first;
    let second;
    let exactRestoration = false;
    try {
      for (const [key, descriptor] of originalMethods) {
        Object.defineProperty(console, key, { ...descriptor, value: replacement });
      }
      first = expectFixedFailure(() => project({ values: { url: SECRET_CANARY } }), [
        SECRET_CANARY,
      ]);
      second = expectFixedFailure(() => project({
        responseOptions: { values: { requestId: PERSONAL_DATA_CANARY } },
      }), [PERSONAL_DATA_CANARY]);
    } finally {
      for (const [key, descriptor] of originalMethods) {
        Object.defineProperty(console, key, descriptor);
      }
      exactRestoration = [...originalMethods].every(([key, descriptor]) => {
        const restored = Object.getOwnPropertyDescriptor(console, key);
        return restored
          && Object.is(restored.value, descriptor.value)
          && restored.enumerable === descriptor.enumerable
          && restored.writable === descriptor.writable
          && restored.configurable === descriptor.configurable;
      });
    }
    const safeChecks = [
      first !== second,
      consoleCalls === 0,
      exactRestoration,
      Object.isFrozen(first),
      Object.isFrozen(second),
    ];
    expect(safeChecks.every(Boolean)).toBe(true);
  });

  test('static boundary forbids whole-object operations, side effects, and adoption', () => {
    const modulePath = path.join(__dirname, 'stripeCheckoutSessionProjection.js');
    const source = fs.readFileSync(modulePath, 'utf8');
    const forbiddenPatterns = [
      /Object\.keys\s*\(/u,
      /Object\.values\s*\(/u,
      /Object\.entries\s*\(/u,
      /Object\.getOwnPropertyDescriptors\s*\(/u,
      /Object\.getOwnPropertyNames\s*\(/u,
      /Object\.getOwnPropertySymbols\s*\(/u,
      /Reflect\.ownKeys\s*\(/u,
      /JSON\.(?:parse|stringify)\s*\(/u,
      /\bimport\s*(?:\(|[^('"`])/u,
      /\.\.\.\s*session/u,
      /process\.env/u,
      /Date\.now\s*\(/u,
      /Math\.random\s*\(/u,
      /\bconsole\s*\./u,
      /\b(?:fetch|XMLHttpRequest)\b/u,
      /require\(['"](?:stripe|firebase|firebase-admin|firebase-functions)['"]\)/u,
      /require\(['"]node:(?:fs|http|https|net|tls|dgram)['"]\)/u,
      /commerceCommandJournal/u,
      /projection\.(?:url|checkoutUrl|requestId|apiVersion|idempotencyKey|stripeAccount)\s*=/u,
      /projection\s*\[\s*['"](?:url|checkoutUrl|requestId|apiVersion|idempotencyKey|stripeAccount)['"]\s*\]\s*=/u,
    ];
    expect(forbiddenPatterns.every((pattern) => !pattern.test(source))).toBe(true);

    const requireTokens = source.match(/\brequire\b/gu) || [];
    const requireCalls = Array.from(
      source.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/gu),
      (match) => match[2],
    );
    const exactRequireAllowlist = requireTokens.length === 2
      && requireCalls.length === 2
      && requireCalls.includes('node:url')
      && requireCalls.includes('node:util');
    expect(exactRequireAllowlist).toBe(true);

    const repositoryRoot = path.join(__dirname, '..');
    const skippedDirectories = new Set([
      '.git',
      'build',
      'coverage',
      'node_modules',
    ]);
    const productionExtensions = /\.(?:cjs|js|jsx|mjs|ts|tsx)$/u;
    function listProductionFiles(directory) {
      const files = [];
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!skippedDirectories.has(entry.name)) {
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
    const productionFiles = listProductionFiles(repositoryRoot)
      .filter((filePath) => filePath !== modulePath);
    const adopted = productionFiles.some((filePath) => {
      const contents = fs.readFileSync(filePath, 'utf8');
      return contents.includes('stripeCheckoutSessionProjection')
        || contents.includes('projectStripeCheckoutSessionObservation');
    });
    expect(adopted).toBe(false);
  });
});
