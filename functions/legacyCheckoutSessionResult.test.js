'use strict';

const vm = require('node:vm');

const legacyCheckoutSessionResult = require('./legacyCheckoutSessionResult');

const {
  LEGACY_CHECKOUT_RESULT_FAILURE_MESSAGE,
  buildLegacyCheckoutSessionExpectation,
  projectLegacyCheckoutSessionResult,
} = legacyCheckoutSessionResult;

const TEST_SESSION_ID = 'cs_test_syntheticresult0001';
const LIVE_SESSION_ID = 'cs_live_syntheticresult0001';
const CHECKOUT_URL = (
  'https://checkout.stripe.com/c/pay/synthetic-result'
  + '?client_reference_id=test-only#opaque-fragment'
);
const SUCCESS_URL = (
  'https://www.example.test/register/success'
  + '?session_id={CHECKOUT_SESSION_ID}&reg=registration_test_000001'
);
const CANCEL_URL = 'https://www.example.test/events/example-race?cancelled=1';
const SHOP_SUCCESS_URL = (
  'https://www.example.test/shop/purchase/success'
  + '?session_id={CHECKOUT_SESSION_ID}&order=order_test_000001'
);
const SHOP_CANCEL_URL = (
  'https://www.example.test/shop/synthetic%2Fslug?cancelled=1'
);

const SESSION_JSON_FIELDS = Object.freeze([
  'id',
  'object',
  'livemode',
  'mode',
  'status',
  'payment_status',
  'amount_total',
  'currency',
  'customer_email',
  'metadata',
  'success_url',
  'cancel_url',
  'url',
]);
const SESSION_FIELDS = Object.freeze([
  ...SESSION_JSON_FIELDS,
  'lastResponse',
]);
const RACE_METADATA_KEYS = Object.freeze([
  'schemaVersion',
  'eventId',
  'registrationId',
  'priceTier',
]);
const MERCH_METADATA_KEYS = Object.freeze([
  'schemaVersion',
  'type',
  'productSlug',
  'orderId',
  'size',
  'color',
]);

function raceMetadata(overrides = {}) {
  return {
    schemaVersion: '1',
    eventId: 'event_test_000001',
    registrationId: 'registration_test_000001',
    priceTier: 'nonMember',
    ...overrides,
  };
}

function merchMetadata(overrides = {}) {
  return {
    schemaVersion: '1',
    type: 'merch',
    productSlug: 'synthetic/slug',
    orderId: 'order_test_000001',
    size: '',
    color: '',
    ...overrides,
  };
}

function raceExpectationInput(overrides = {}) {
  return {
    livemode: false,
    amountCents: 2500,
    customerEmail: 'runner-000001@example.test',
    successUrl: SUCCESS_URL,
    cancelUrl: CANCEL_URL,
    metadata: raceMetadata(),
    ...overrides,
  };
}

function merchExpectationInput(overrides = {}) {
  return {
    livemode: true,
    amountCents: 3200,
    customerEmail: 'buyer-000001@example.test',
    successUrl: SHOP_SUCCESS_URL,
    cancelUrl: SHOP_CANCEL_URL,
    metadata: merchMetadata(),
    ...overrides,
  };
}

function defineData(
  record,
  key,
  value,
  {
    enumerable = true,
    writable = true,
    configurable = true,
  } = {},
) {
  Object.defineProperty(record, key, {
    value,
    enumerable,
    writable,
    configurable,
  });
}

function makeLastResponse({
  statusCode = 200,
  statusDescriptor,
  unknownDescriptors = {},
} = {}) {
  const response = {};
  if (statusDescriptor) {
    Object.defineProperty(response, 'statusCode', statusDescriptor);
  } else {
    defineData(response, 'statusCode', statusCode);
  }
  for (const key of Reflect.ownKeys(unknownDescriptors)) {
    Object.defineProperty(response, key, unknownDescriptors[key]);
  }
  return response;
}

function sessionDefaults({
  live = false,
  metadata,
  lastResponse,
} = {}) {
  const isLive = live === true;
  return {
    id: isLive ? LIVE_SESSION_ID : TEST_SESSION_ID,
    object: 'checkout.session',
    livemode: isLive,
    mode: 'payment',
    status: 'open',
    payment_status: 'unpaid',
    amount_total: isLive ? 3200 : 2500,
    currency: 'usd',
    customer_email: isLive
      ? 'buyer-000001@example.test'
      : 'runner-000001@example.test',
    metadata: metadata || (isLive ? merchMetadata() : raceMetadata()),
    success_url: isLive ? SHOP_SUCCESS_URL : SUCCESS_URL,
    cancel_url: isLive ? SHOP_CANCEL_URL : CANCEL_URL,
    url: CHECKOUT_URL,
    lastResponse: lastResponse || makeLastResponse(),
  };
}

function makeSession({
  live = false,
  values = {},
  omit,
  descriptors = {},
  metadata,
  lastResponse,
  target,
} = {}) {
  const session = target || {};
  const allValues = {
    ...sessionDefaults({ live, metadata, lastResponse }),
    ...values,
  };
  for (const key of SESSION_FIELDS) {
    if (key === omit) continue;
    if (Object.hasOwn(descriptors, key)) {
      Object.defineProperty(session, key, descriptors[key]);
    } else if (key === 'lastResponse') {
      defineData(session, key, allValues[key], {
        enumerable: false,
        writable: false,
        configurable: false,
      });
    } else {
      defineData(session, key, allValues[key]);
    }
  }
  return session;
}

function buildRaceExpectation(overrides) {
  return buildLegacyCheckoutSessionExpectation(
    raceExpectationInput(overrides),
  );
}

function buildMerchExpectation(overrides) {
  return buildLegacyCheckoutSessionExpectation(
    merchExpectationInput(overrides),
  );
}

function projectRace(sessionOptions = {}, expectation = buildRaceExpectation()) {
  return projectLegacyCheckoutSessionResult(
    makeSession(sessionOptions),
    expectation,
  );
}

function projectMerch(sessionOptions = {}, expectation = buildMerchExpectation()) {
  return projectLegacyCheckoutSessionResult(
    makeSession({ live: true, ...sessionOptions }),
    expectation,
  );
}

describe('legacy Checkout Session module surface', () => {
  test('exports only the frozen legacy boundary and fixed public failure text', () => {
    expect(Reflect.ownKeys(legacyCheckoutSessionResult)).toEqual([
      'LEGACY_CHECKOUT_RESULT_FAILURE_MESSAGE',
      'buildLegacyCheckoutSessionExpectation',
      'projectLegacyCheckoutSessionResult',
    ]);
    expect(Object.isFrozen(legacyCheckoutSessionResult)).toBe(true);
    expect(LEGACY_CHECKOUT_RESULT_FAILURE_MESSAGE).toBe(
      'Checkout result could not be confirmed. Do not retry. Contact MPRC.',
    );
  });
});

describe('buildLegacyCheckoutSessionExpectation', () => {
  test('builds a detached, deeply frozen, closed race expectation', () => {
    const input = raceExpectationInput();
    const inputMetadata = input.metadata;
    const expectation = buildLegacyCheckoutSessionExpectation(input);

    expect(expectation).not.toBeNull();
    expect(Object.getPrototypeOf(expectation)).toBeNull();
    expect(Object.isFrozen(expectation)).toBe(true);
    expect(Reflect.ownKeys(expectation)).toEqual([
      'livemode',
      'amountCents',
      'customerEmail',
      'successUrl',
      'cancelUrl',
      'metadata',
    ]);
    expect(expectation).toEqual({
      livemode: false,
      amountCents: 2500,
      customerEmail: 'runner-000001@example.test',
      successUrl: SUCCESS_URL,
      cancelUrl: CANCEL_URL,
      metadata: raceMetadata(),
    });
    expect(expectation.metadata).not.toBe(inputMetadata);
    expect(Object.getPrototypeOf(expectation.metadata)).toBeNull();
    expect(Object.isFrozen(expectation.metadata)).toBe(true);
    expect(Reflect.ownKeys(expectation.metadata)).toEqual(RACE_METADATA_KEYS);

    input.amountCents = 9999;
    inputMetadata.eventId = 'event_test_changed';
    expect(expectation.amountCents).toBe(2500);
    expect(expectation.metadata.eventId).toBe('event_test_000001');
  });

  test('builds the exact merch schema and preserves normalized empty options', () => {
    const expectation = buildMerchExpectation();

    expect(expectation).not.toBeNull();
    expect(Object.getPrototypeOf(expectation)).toBeNull();
    expect(Object.isFrozen(expectation)).toBe(true);
    expect(Object.getPrototypeOf(expectation.metadata)).toBeNull();
    expect(Object.isFrozen(expectation.metadata)).toBe(true);
    expect(Reflect.ownKeys(expectation.metadata)).toEqual(MERCH_METADATA_KEYS);
    expect(expectation.metadata).toEqual(merchMetadata());
    expect(expectation.metadata.size).toBe('');
    expect(expectation.metadata.color).toBe('');
  });

  test.each([
    ['missing input', undefined],
    ['null input', null],
    ['primitive input', 'expectation'],
    ['array input', []],
    ['null-prototype input', Object.assign(Object.create(null), raceExpectationInput())],
    ['class instance', Object.assign(new (class Input {})(), raceExpectationInput())],
    ['missing root field', (() => {
      const input = raceExpectationInput();
      delete input.cancelUrl;
      return input;
    })()],
    ['extra root field', { ...raceExpectationInput(), extra: 'blocked' }],
    ['inherited root fields', Object.create(raceExpectationInput())],
  ])('rejects a non-closed %s', (_caseName, input) => {
    expect(buildLegacyCheckoutSessionExpectation(input)).toBeNull();
  });

  test('rejects root symbol keys', () => {
    const input = raceExpectationInput();
    input[Symbol('extra')] = 'blocked';
    expect(buildLegacyCheckoutSessionExpectation(input)).toBeNull();
  });

  test.each([
    ['livemode', 'false'],
    ['livemode', 0],
    ['amountCents', 0],
    ['amountCents', -1],
    ['amountCents', -0],
    ['amountCents', 2500.5],
    ['amountCents', Number.MAX_SAFE_INTEGER + 1],
    ['amountCents', '2500'],
    ['customerEmail', 'Runner-000001@example.test'],
    ['customerEmail', ' runner-000001@example.test'],
    ['customerEmail', 'runner-000001@example.test '],
    ['customerEmail', 'runner-000001@example'],
    ['customerEmail', 'runner\u0000@example.test'],
    ['customerEmail', 'runner-\u00e9@example.test'],
    ['customerEmail', ''],
    ['customerEmail', { toString: () => 'runner-000001@example.test' }],
    ['successUrl', ''],
    ['successUrl', 'https://www.example.test/\nresult'],
    ['successUrl', 'x'.repeat(8193)],
    ['successUrl', new String(SUCCESS_URL)],
    ['cancelUrl', ''],
    ['cancelUrl', 'https://www.example.test/\u007fcancel'],
    ['cancelUrl', 'x'.repeat(8193)],
    ['cancelUrl', { href: CANCEL_URL }],
  ])('rejects malformed %s without coercion', (key, value) => {
    expect(buildRaceExpectation({ [key]: value })).toBeNull();
  });

  test.each([
    ['schema version', { schemaVersion: '2' }],
    ['empty event ID', { eventId: '' }],
    ['non-string event ID', { eventId: 1 }],
    ['empty registration ID', { registrationId: '' }],
    ['non-string registration ID', { registrationId: {} }],
    ['comp race tier', { priceTier: 'comp' }],
    ['unknown race tier', { priceTier: 'future' }],
    ['non-string race tier', { priceTier: ['nonMember'] }],
  ])('rejects malformed race metadata %s', (_caseName, overrides) => {
    expect(buildRaceExpectation({ metadata: raceMetadata(overrides) })).toBeNull();
  });

  test.each([
    ['schema version', { schemaVersion: '2' }],
    ['type', { type: 'race' }],
    ['empty product slug', { productSlug: '' }],
    ['non-string product slug', { productSlug: 1 }],
    ['empty order ID', { orderId: '' }],
    ['non-string order ID', { orderId: null }],
    ['non-string size', { size: null }],
    ['non-string color', { color: false }],
  ])('rejects malformed merch metadata %s', (_caseName, overrides) => {
    expect(buildMerchExpectation({ metadata: merchMetadata(overrides) })).toBeNull();
  });

  test.each([
    ['missing race key', (() => {
      const metadata = raceMetadata();
      delete metadata.eventId;
      return metadata;
    })()],
    ['extra race key', { ...raceMetadata(), extra: 'blocked' }],
    ['missing merch key', (() => {
      const metadata = merchMetadata();
      delete metadata.color;
      return metadata;
    })()],
    ['extra merch key', { ...merchMetadata(), extra: 'blocked' }],
    ['surprising metadata prototype', Object.assign(
      Object.create({ inherited: 'blocked' }),
      raceMetadata(),
    )],
    ['metadata array', Object.values(raceMetadata())],
    ['metadata primitive', 'metadata'],
  ])('rejects %s', (_caseName, metadata) => {
    expect(buildRaceExpectation({ metadata })).toBeNull();
  });

  test('rejects metadata symbols and accessors without invoking them', () => {
    const symbolMetadata = raceMetadata();
    symbolMetadata[Symbol('extra')] = 'blocked';
    expect(buildRaceExpectation({ metadata: symbolMetadata })).toBeNull();

    for (const key of RACE_METADATA_KEYS) {
      const metadata = raceMetadata();
      const getter = jest.fn(() => {
        throw new Error('metadata accessor executed');
      });
      Object.defineProperty(metadata, key, {
        enumerable: true,
        configurable: true,
        get: getter,
      });
      expect(buildRaceExpectation({ metadata })).toBeNull();
      expect(getter).not.toHaveBeenCalled();
    }
  });

  test('rejects root accessors without invoking them', () => {
    for (const key of [
      'livemode',
      'amountCents',
      'customerEmail',
      'successUrl',
      'cancelUrl',
      'metadata',
    ]) {
      const input = raceExpectationInput();
      const getter = jest.fn(() => {
        throw new Error('expectation accessor executed');
      });
      Object.defineProperty(input, key, {
        enumerable: true,
        configurable: true,
        get: getter,
      });
      expect(buildLegacyCheckoutSessionExpectation(input)).toBeNull();
      expect(getter).not.toHaveBeenCalled();
    }
  });

  test('rejects root, metadata, and revoked proxies without traps', () => {
    let trapCalls = 0;
    const traps = {
      get() { trapCalls += 1; throw new Error('get trap executed'); },
      getOwnPropertyDescriptor() {
        trapCalls += 1;
        throw new Error('descriptor trap executed');
      },
      getPrototypeOf() {
        trapCalls += 1;
        throw new Error('prototype trap executed');
      },
      ownKeys() { trapCalls += 1; throw new Error('ownKeys trap executed'); },
    };
    const rootProxy = new Proxy(raceExpectationInput(), traps);
    const metadataProxy = new Proxy(raceMetadata(), traps);
    const revoked = Proxy.revocable(raceExpectationInput(), traps);
    revoked.revoke();

    expect(buildLegacyCheckoutSessionExpectation(rootProxy)).toBeNull();
    expect(buildRaceExpectation({ metadata: metadataProxy })).toBeNull();
    expect(buildLegacyCheckoutSessionExpectation(revoked.proxy)).toBeNull();
    expect(trapCalls).toBe(0);
  });
});

describe('projectLegacyCheckoutSessionResult valid projections', () => {
  test('projects only a fresh frozen null-prototype race result', () => {
    const session = makeSession();
    const expectation = buildRaceExpectation();
    const result = projectLegacyCheckoutSessionResult(session, expectation);
    const second = projectLegacyCheckoutSessionResult(session, expectation);

    expect(result).not.toBeNull();
    expect(result).toEqual({
      sessionId: TEST_SESSION_ID,
      url: CHECKOUT_URL,
    });
    expect(Reflect.ownKeys(result)).toEqual(['sessionId', 'url']);
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.isFrozen(result)).toBe(true);
    expect(second).toEqual(result);
    expect(second).not.toBe(result);
  });

  test('projects an exact live merch result with empty size and color', () => {
    expect(projectMerch()).toEqual({
      sessionId: LIVE_SESSION_ID,
      url: CHECKOUT_URL,
    });
  });

  test.each([
    [false, 'cs_test_a', buildRaceExpectation()],
    [false, `cs_test_${'a'.repeat(247)}`, buildRaceExpectation()],
    [true, 'cs_live_a', buildMerchExpectation()],
    [true, `cs_live_${'a'.repeat(247)}`, buildMerchExpectation()],
  ])('admits the %s mode Session ID boundary %s', (live, id, expectation) => {
    const session = makeSession({ live, values: { id } });
    expect(projectLegacyCheckoutSessionResult(session, expectation)).toEqual({
      sessionId: id,
      url: CHECKOUT_URL,
    });
  });

  test('admits and preserves an 8192-byte canonical opaque Checkout URL', () => {
    const prefix = 'https://checkout.stripe.com/?opaque=';
    const url = `${prefix}${'x'.repeat(8192 - prefix.length)}`;
    expect(url.length).toBe(8192);

    expect(projectRace({ values: { url } })).toEqual({
      sessionId: TEST_SESSION_ID,
      url,
    });
  });

  test.each([
    'https://checkout.stripe.com/',
    'https://checkout.stripe.com//opaque/path?x=1&x=2#fragment',
    'https://checkout.stripe.com/c/pay/%7Esynthetic?encoded=%0A#%23',
    'https://checkout.stripe.com/?return=https%3A%2F%2Fwww.example.test%2F',
  ])('preserves canonical opaque path/query/fragment bytes', (url) => {
    expect(projectRace({ values: { url } })).toEqual({
      sessionId: TEST_SESSION_ID,
      url,
    });
  });

  test('detaches the output from later source mutation', () => {
    const metadata = raceMetadata();
    const session = makeSession({ metadata });
    const result = projectLegacyCheckoutSessionResult(
      session,
      buildRaceExpectation(),
    );

    session.id = 'cs_test_changed';
    session.url = 'https://checkout.stripe.com/changed';
    metadata.eventId = 'event_test_changed';

    expect(result).toEqual({
      sessionId: TEST_SESSION_ID,
      url: CHECKOUT_URL,
    });
  });
});

describe('projectLegacyCheckoutSessionResult Session structure', () => {
  test.each([
    ['missing', undefined],
    ['null', null],
    ['string', 'session'],
    ['function', () => {}],
    ['array', []],
    ['null prototype', Object.create(null)],
    ['date', new Date(0)],
    ['class instance', new (class Session {})()],
  ])('rejects a non-ordinary %s root', (_caseName, rawSession) => {
    expect(projectLegacyCheckoutSessionResult(
      rawSession,
      buildRaceExpectation(),
    )).toBeNull();
  });

  test('rejects an ordinary object from another realm', () => {
    const crossRealmSession = vm.runInNewContext('({})');
    makeSession({ target: crossRealmSession });

    expect(projectLegacyCheckoutSessionResult(
      crossRealmSession,
      buildRaceExpectation(),
    )).toBeNull();
  });

  test('rejects root and revoked Proxies with no trap calls', () => {
    let trapCalls = 0;
    const traps = {
      get() { trapCalls += 1; throw new Error('get trap executed'); },
      getOwnPropertyDescriptor() {
        trapCalls += 1;
        throw new Error('descriptor trap executed');
      },
      getPrototypeOf() {
        trapCalls += 1;
        throw new Error('prototype trap executed');
      },
      ownKeys() { trapCalls += 1; throw new Error('ownKeys trap executed'); },
    };
    const rootProxy = new Proxy(makeSession(), traps);
    const revoked = Proxy.revocable(makeSession(), traps);
    revoked.revoke();

    expect(projectLegacyCheckoutSessionResult(
      rootProxy,
      buildRaceExpectation(),
    )).toBeNull();
    expect(projectLegacyCheckoutSessionResult(
      revoked.proxy,
      buildRaceExpectation(),
    )).toBeNull();
    expect(trapCalls).toBe(0);
  });

  test.each(SESSION_FIELDS)(
    'rejects missing and inherited %s without invoking inherited hooks',
    (key) => {
      const session = makeSession({ omit: key });
      const inheritedGetter = jest.fn(() => {
        throw new Error('inherited selected getter executed');
      });
      Object.defineProperty(Object.prototype, key, {
        configurable: true,
        get: inheritedGetter,
      });
      try {
        expect(projectLegacyCheckoutSessionResult(
          session,
          buildRaceExpectation(),
        )).toBeNull();
        expect(inheritedGetter).not.toHaveBeenCalled();
      } finally {
        delete Object.prototype[key];
      }
    },
  );

  test.each(SESSION_FIELDS)(
    'rejects accessor-backed %s without invoking it',
    (key) => {
      const getter = jest.fn(() => {
        throw new Error('selected Session getter executed');
      });
      const descriptor = {
        enumerable: key !== 'lastResponse',
        configurable: key !== 'lastResponse',
        get: getter,
      };
      expect(projectRace({
        descriptors: { [key]: descriptor },
      })).toBeNull();
      expect(getter).not.toHaveBeenCalled();
    },
  );

  test.each(SESSION_JSON_FIELDS)(
    'rejects every wrong installed-SDK descriptor flag for %s',
    (key) => {
      const value = sessionDefaults()[key];
      const cases = [
        { enumerable: false, writable: true, configurable: true },
        { enumerable: true, writable: false, configurable: true },
        { enumerable: true, writable: true, configurable: false },
      ];
      for (const flags of cases) {
        expect(projectRace({
          descriptors: {
            [key]: {
              value,
              ...flags,
            },
          },
        })).toBeNull();
      }
    },
  );

  test('rejects every wrong lastResponse attachment flag', () => {
    const response = makeLastResponse();
    const cases = [
      { enumerable: true, writable: false, configurable: false },
      { enumerable: false, writable: true, configurable: false },
      { enumerable: false, writable: false, configurable: true },
    ];
    for (const flags of cases) {
      expect(projectRace({
        descriptors: {
          lastResponse: {
            value: response,
            ...flags,
          },
        },
      })).toBeNull();
    }
  });
});

describe('projectLegacyCheckoutSessionResult business equality', () => {
  test.each([
    ['wrong object', { object: 'payment_intent' }],
    ['wrong livemode', { livemode: true }],
    ['wrong mode', { mode: 'subscription' }],
    ['complete status', { status: 'complete' }],
    ['expired status', { status: 'expired' }],
    ['paid payment status', { payment_status: 'paid' }],
    ['no-payment-required status', { payment_status: 'no_payment_required' }],
    ['different amount', { amount_total: 2501 }],
    ['fractional amount', { amount_total: 2500.5 }],
    ['string amount', { amount_total: '2500' }],
    ['uppercase currency', { currency: 'USD' }],
    ['different currency', { currency: 'cad' }],
    ['different customer email', { customer_email: 'other@example.test' }],
    ['uppercase customer email', { customer_email: 'Runner-000001@example.test' }],
    ['different success callback', { success_url: `${SUCCESS_URL}x` }],
    ['different cancel callback', { cancel_url: `${CANCEL_URL}x` }],
  ])('rejects %s', (_caseName, values) => {
    expect(projectRace({ values })).toBeNull();
  });

  test.each([
    'cs_test_',
    `cs_test_${'a'.repeat(248)}`,
    'cs_test_contains-hyphen',
    'cs_test_contains_underscore',
    'cs_test_contains/slash',
    'cs_test_\u00e9',
    'cs_test_a\u0000',
    LIVE_SESSION_ID,
    'cs_live_',
    'checkout_session_test_1',
    '',
  ])('rejects malformed or mode-mismatched Session ID %s', (id) => {
    expect(projectRace({ values: { id } })).toBeNull();
  });

  test('rejects non-string selected values without coercion', () => {
    const coercion = {
      toString: jest.fn(() => {
        throw new Error('selected value coerced');
      }),
      valueOf: jest.fn(() => {
        throw new Error('selected value coerced');
      }),
      [Symbol.toPrimitive]: jest.fn(() => {
        throw new Error('selected value coerced');
      }),
    };

    expect(projectRace({ values: { id: coercion } })).toBeNull();
    expect(coercion.toString).not.toHaveBeenCalled();
    expect(coercion.valueOf).not.toHaveBeenCalled();
    expect(coercion[Symbol.toPrimitive]).not.toHaveBeenCalled();
  });
});

describe('projectLegacyCheckoutSessionResult metadata containment', () => {
  test.each(RACE_METADATA_KEYS)(
    'rejects missing, accessor, and wrong-descriptor race metadata %s',
    (key) => {
      const missing = raceMetadata();
      delete missing[key];
      expect(projectRace({ metadata: missing })).toBeNull();

      const accessor = raceMetadata();
      const getter = jest.fn(() => {
        throw new Error('raw metadata getter executed');
      });
      Object.defineProperty(accessor, key, {
        enumerable: true,
        configurable: true,
        get: getter,
      });
      expect(projectRace({ metadata: accessor })).toBeNull();
      expect(getter).not.toHaveBeenCalled();

      const wrongDescriptor = raceMetadata();
      Object.defineProperty(wrongDescriptor, key, {
        value: wrongDescriptor[key],
        enumerable: true,
        writable: false,
        configurable: true,
      });
      expect(projectRace({ metadata: wrongDescriptor })).toBeNull();
    },
  );

  test.each(MERCH_METADATA_KEYS)(
    'rejects missing and mismatched merch metadata %s',
    (key) => {
      const missing = merchMetadata();
      delete missing[key];
      expect(projectMerch({ metadata: missing })).toBeNull();

      const mismatch = merchMetadata();
      mismatch[key] = key === 'size' || key === 'color'
        ? 'unexpected-option'
        : 'unexpected-value';
      expect(projectMerch({ metadata: mismatch })).toBeNull();
    },
  );

  test.each([
    ['schema version', { schemaVersion: '2' }],
    ['event ID', { eventId: 'event_test_changed' }],
    ['registration ID', { registrationId: 'registration_test_changed' }],
    ['price tier', { priceTier: 'member' }],
  ])('rejects race metadata mismatch for %s', (_caseName, overrides) => {
    expect(projectRace({ metadata: raceMetadata(overrides) })).toBeNull();
  });

  test('rejects extra and symbol metadata without reading extra values', () => {
    let extraReads = 0;
    const extra = raceMetadata();
    Object.defineProperty(extra, 'privateExtra', {
      enumerable: true,
      configurable: true,
      get() {
        extraReads += 1;
        throw new Error('extra metadata read');
      },
    });
    const symbol = raceMetadata();
    Object.defineProperty(symbol, Symbol('privateExtra'), {
      enumerable: true,
      configurable: true,
      get() {
        extraReads += 1;
        throw new Error('symbol metadata read');
      },
    });

    expect(projectRace({ metadata: extra })).toBeNull();
    expect(projectRace({ metadata: symbol })).toBeNull();
    expect(extraReads).toBe(0);
  });

  test('rejects surprising metadata prototypes', () => {
    const inherited = Object.assign(
      Object.create({ privateExtra: 'blocked' }),
      raceMetadata(),
    );
    const nullPrototype = Object.assign(Object.create(null), raceMetadata());

    expect(projectRace({ metadata: inherited })).toBeNull();
    expect(projectRace({ metadata: nullPrototype })).toBeNull();
  });

  test('rejects metadata and revoked Proxies without traps', () => {
    let trapCalls = 0;
    const traps = {
      get() { trapCalls += 1; throw new Error('metadata get trap executed'); },
      getOwnPropertyDescriptor() {
        trapCalls += 1;
        throw new Error('metadata descriptor trap executed');
      },
      getPrototypeOf() {
        trapCalls += 1;
        throw new Error('metadata prototype trap executed');
      },
      ownKeys() {
        trapCalls += 1;
        throw new Error('metadata ownKeys trap executed');
      },
    };
    const proxy = new Proxy(raceMetadata(), traps);
    const revoked = Proxy.revocable(raceMetadata(), traps);
    revoked.revoke();

    expect(projectRace({ metadata: proxy })).toBeNull();
    expect(projectRace({ metadata: revoked.proxy })).toBeNull();
    expect(trapCalls).toBe(0);
  });
});

describe('projectLegacyCheckoutSessionResult Checkout URL policy', () => {
  test.each([
    '',
    'http://checkout.stripe.com/',
    'https://checkout.example.test/',
    'https://checkout.stripe.com.example.test/',
    'https://checkout-stripe.com/',
    'https://checkout.stripe.com./',
    'https://CHECKOUT.stripe.com/',
    'HTTPS://checkout.stripe.com/',
    'https://checkout.stripe.com',
    'https://checkout.stripe.com:443/',
    'https://checkout.stripe.com:444/',
    'https://user@checkout.stripe.com/',
    'https://user:password@checkout.stripe.com/',
    'https://@checkout.stripe.com/',
    'https://checkout.stripe.com/a/../b',
    'https://checkout.stripe.com/\ncontrol',
    'https://checkout.stripe.com/\u007fcontrol',
    ' https://checkout.stripe.com/',
    'https://checkout.stripe.com/ ',
    `https://checkout.stripe.com/?q=${'x'.repeat(8192)}`,
    'not-a-url',
  ])('rejects an unapproved or noncanonical URL', (url) => {
    expect(projectRace({ values: { url } })).toBeNull();
  });

  test('rejects a URL object without coercing it', () => {
    const value = {
      toString: jest.fn(() => {
        throw new Error('URL coerced');
      }),
      [Symbol.toPrimitive]: jest.fn(() => {
        throw new Error('URL coerced');
      }),
    };
    expect(projectRace({ values: { url: value } })).toBeNull();
    expect(value.toString).not.toHaveBeenCalled();
    expect(value[Symbol.toPrimitive]).not.toHaveBeenCalled();
  });
});

describe('projectLegacyCheckoutSessionResult installed SDK response', () => {
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'response'],
    ['number', 200],
    ['function', () => {}],
  ])('rejects a %s lastResponse', (_caseName, lastResponse) => {
    expect(projectRace({ values: { lastResponse } })).toBeNull();
  });

  test.each([
    ['missing', {}],
    ['inherited', Object.create({ statusCode: 200 })],
    ['non-200', makeLastResponse({ statusCode: 201 })],
    ['string status', makeLastResponse({ statusCode: '200' })],
    ['null status', makeLastResponse({ statusCode: null })],
  ])('rejects a response with %s statusCode', (_caseName, lastResponse) => {
    expect(projectRace({ lastResponse })).toBeNull();
  });

  test('rejects an accessor statusCode without invoking it', () => {
    const getter = jest.fn(() => {
      throw new Error('statusCode getter executed');
    });
    const response = makeLastResponse({
      statusDescriptor: {
        enumerable: true,
        configurable: true,
        get: getter,
      },
    });

    expect(projectRace({ lastResponse: response })).toBeNull();
    expect(getter).not.toHaveBeenCalled();
  });

  test.each([
    { enumerable: false, writable: true, configurable: true },
    { enumerable: true, writable: false, configurable: true },
    { enumerable: true, writable: true, configurable: false },
  ])('rejects wrong statusCode descriptor flags %#', (flags) => {
    const response = makeLastResponse({
      statusDescriptor: {
        value: 200,
        ...flags,
      },
    });
    expect(projectRace({ lastResponse: response })).toBeNull();
  });

  test('rejects response and revoked Proxies without traps', () => {
    let trapCalls = 0;
    const traps = {
      get() { trapCalls += 1; throw new Error('response get trap executed'); },
      getOwnPropertyDescriptor() {
        trapCalls += 1;
        throw new Error('response descriptor trap executed');
      },
      getPrototypeOf() {
        trapCalls += 1;
        throw new Error('response prototype trap executed');
      },
      ownKeys() {
        trapCalls += 1;
        throw new Error('response ownKeys trap executed');
      },
    };
    const proxy = new Proxy(makeLastResponse(), traps);
    const revoked = Proxy.revocable(makeLastResponse(), traps);
    revoked.revoke();

    expect(projectRace({ lastResponse: proxy })).toBeNull();
    expect(projectRace({ lastResponse: revoked.proxy })).toBeNull();
    expect(trapCalls).toBe(0);
  });

  test('accepts a non-Proxy response object without inspecting its prototype', () => {
    const response = Object.create({
      inheritedPrivateTransportValue: 'ignored',
    });
    defineData(response, 'statusCode', 200);

    expect(projectRace({ lastResponse: response })).toEqual({
      sessionId: TEST_SESSION_ID,
      url: CHECKOUT_URL,
    });
  });
});

describe('projectLegacyCheckoutSessionResult privacy and expectation defenses', () => {
  test('ignores unknown Session and response fields without access or logging', () => {
    let unknownReads = 0;
    const unknownGetter = {
      enumerable: true,
      configurable: true,
      get() {
        unknownReads += 1;
        throw new Error('unknown private field read');
      },
    };
    const response = makeLastResponse({
      unknownDescriptors: {
        requestId: unknownGetter,
        apiVersion: unknownGetter,
        idempotencyKey: unknownGetter,
        stripeAccount: unknownGetter,
        headers: unknownGetter,
      },
    });
    const session = makeSession({ lastResponse: response });
    for (const key of [
      'client_secret',
      'customer_details',
      'payment_intent',
      'shipping_details',
      'toJSON',
    ]) {
      Object.defineProperty(session, key, unknownGetter);
    }
    Object.defineProperty(session, Symbol('unknown-private-symbol'), unknownGetter);

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(projectLegacyCheckoutSessionResult(
        session,
        buildRaceExpectation(),
      )).toEqual({
        sessionId: TEST_SESSION_ID,
        url: CHECKOUT_URL,
      });
      expect(unknownReads).toBe(0);
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  test('rejects malformed expectations instead of trusting caller objects', () => {
    const valid = buildRaceExpectation();
    const unfrozen = Object.assign(Object.create(null), valid);
    const extra = Object.assign(Object.create(null), valid, {
      extra: 'blocked',
    });
    Object.freeze(extra);

    expect(projectLegacyCheckoutSessionResult(makeSession(), null)).toBeNull();
    expect(projectLegacyCheckoutSessionResult(makeSession(), unfrozen)).toBeNull();
    expect(projectLegacyCheckoutSessionResult(makeSession(), extra)).toBeNull();
  });

  test('rejects expectation and revoked Proxies without traps', () => {
    let trapCalls = 0;
    const traps = {
      get() {
        trapCalls += 1;
        throw new Error('expectation get trap executed');
      },
      getOwnPropertyDescriptor() {
        trapCalls += 1;
        throw new Error('expectation descriptor trap executed');
      },
      getPrototypeOf() {
        trapCalls += 1;
        throw new Error('expectation prototype trap executed');
      },
      isExtensible() {
        trapCalls += 1;
        throw new Error('expectation extensibility trap executed');
      },
      ownKeys() {
        trapCalls += 1;
        throw new Error('expectation ownKeys trap executed');
      },
    };
    const proxy = new Proxy(buildRaceExpectation(), traps);
    const revoked = Proxy.revocable(buildRaceExpectation(), traps);
    revoked.revoke();

    expect(projectLegacyCheckoutSessionResult(makeSession(), proxy)).toBeNull();
    expect(projectLegacyCheckoutSessionResult(
      makeSession(),
      revoked.proxy,
    )).toBeNull();
    expect(trapCalls).toBe(0);
  });
});
