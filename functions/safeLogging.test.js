const fs = require('node:fs');
const path = require('node:path');

const {
  REQUEST_VALIDATION_MESSAGE,
  REQUEST_VALIDATION_REASONS,
  RequestValidationError,
} = require('./requestValidation');
const {
  SAFE_LOG_FIELDS,
  SAFE_LOG_VALUE_LISTS,
  buildSafeLogProjection,
} = require('./safeLogging');

const VALID_LOG = Object.freeze({
  event: 'request_validation',
  operation: 'race_registration',
  outcome: 'rejected',
  code: 'invalid_fields',
  environment: 'test',
});
const HOSTILE_CANARY = 'private-canary@example.test/callback?token=never-log';

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected safe-log projection to fail');
}

function expectSafeLogError(callback) {
  const error = captureError(callback);
  expect(error).toBeInstanceOf(RequestValidationError);
  expect(error.message).toBe(REQUEST_VALIDATION_MESSAGE);
  expect(error.reason).toBe(REQUEST_VALIDATION_REASONS.SAFE_LOG_INVALID);
  expect(Object.keys(error)).toEqual([]);
  expect(JSON.stringify(error)).toBe('{}');
  expect(`${error.name}${error.message}${error.stack}${JSON.stringify(error)}`)
    .not.toContain(HOSTILE_CANARY);
}

describe('safe low-cardinality log projection', () => {
  test('returns only fixed fields and values in a new deterministic frozen object', () => {
    const input = { ...VALID_LOG };
    const output = buildSafeLogProjection(input);

    expect(output).toEqual({
      code: 'invalid_fields',
      environment: 'test',
      event: 'request_validation',
      operation: 'race_registration',
      outcome: 'rejected',
    });
    expect(Reflect.ownKeys(output)).toEqual(SAFE_LOG_FIELDS);
    expect(output).not.toBe(input);
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.getPrototypeOf(output)).toBeNull();
    expect(Object.isFrozen(input)).toBe(false);
    output.code = HOSTILE_CANARY;
    expect(output.code).toBe('invalid_fields');

    const second = buildSafeLogProjection({ ...VALID_LOG });
    expect(second).toEqual(output);
    expect(second).not.toBe(output);
  });

  test('the exported documentation allowlist is deeply frozen and contains only fixed tokens', () => {
    expect(Object.isFrozen(SAFE_LOG_FIELDS)).toBe(true);
    expect(Object.isFrozen(SAFE_LOG_VALUE_LISTS)).toBe(true);
    expect(Object.getPrototypeOf(SAFE_LOG_VALUE_LISTS)).toBeNull();
    for (const [field, values] of Object.entries(SAFE_LOG_VALUE_LISTS)) {
      expect(SAFE_LOG_FIELDS).toContain(field);
      expect(Object.isFrozen(values)).toBe(true);
      expect(new Set(values).size).toBe(values.length);
      values.forEach((value) => expect(value).toMatch(/^[a-z][a-z0-9_]{0,47}$/));
      expect(Reflect.set(values, values.length, HOSTILE_CANARY)).toBe(false);
    }
  });

  test.each([
    ['missing field', (() => {
      const value = { ...VALID_LOG };
      delete value.code;
      return value;
    })()],
    ['unknown key', { ...VALID_LOG, arbitrary: 'accepted' }],
    ['unknown fixed field value', { ...VALID_LOG, outcome: 'member@example.test' }],
    ['nested value', { ...VALID_LOG, code: { raw: HOSTILE_CANARY } }],
    ['raw Error', { ...VALID_LOG, code: new Error(HOSTILE_CANARY) }],
  ])('rejects %s rather than emitting it', (_name, input) => {
    expectSafeLogError(() => buildSafeLogProjection(input));
  });

  test.each([
    ['requestBody', { nested: HOSTILE_CANARY }],
    ['authorization', HOSTILE_CANARY],
    ['token', HOSTILE_CANARY],
    ['sessionCookie', HOSTILE_CANARY],
    ['checkoutUrl', `https://${HOSTILE_CANARY}`],
    ['callbackUrl', `https://${HOSTILE_CANARY}`],
    ['email', 'member@example.test'],
    ['phone', '+1-555-0100'],
    ['address', 'private street'],
    ['dateOfBirth', '2000-01-01'],
    ['emergencyContact', HOSTILE_CANARY],
    ['stripePaymentIntent', 'pi_private_canary'],
    ['oauthAccessToken', 'oauth-private-canary'],
    ['rawMessage', HOSTILE_CANARY],
    ['stack', HOSTILE_CANARY],
    ['businessId', HOSTILE_CANARY],
  ])('rejects prohibited category %s even beside an otherwise valid record', (key, value) => {
    const input = { ...VALID_LOG, [key]: value };
    expectSafeLogError(() => buildSafeLogProjection(input));
    expect(JSON.stringify(input)).toContain(
      typeof value === 'string' ? value : HOSTILE_CANARY,
    );
  });

  test('rejects symbols, non-enumerable fields, accessors, and dangerous keys without reading them', () => {
    const getter = jest.fn(() => HOSTILE_CANARY);
    const symbol = { ...VALID_LOG };
    symbol[Symbol('private')] = HOSTILE_CANARY;
    const nonEnumerable = { ...VALID_LOG };
    Object.defineProperty(nonEnumerable, 'privateField', {
      value: HOSTILE_CANARY,
      enumerable: false,
    });
    const accessor = { ...VALID_LOG };
    Object.defineProperty(accessor, 'outcome', { get: getter, enumerable: true });
    const dangerous = JSON.parse(`{${Object.entries(VALID_LOG)
      .map(([key, value]) => `"${key}":"${value}"`).join(',')},"__proto__":"${HOSTILE_CANARY}"}`);

    for (const input of [symbol, nonEnumerable, accessor, dangerous]) {
      expectSafeLogError(() => buildSafeLogProjection(input));
    }
    expect(getter).not.toHaveBeenCalled();
  });

  test('rejects a Proxy before any reflection trap can execute', () => {
    const traps = {
      getPrototypeOf: jest.fn(() => Object.prototype),
      ownKeys: jest.fn(() => Reflect.ownKeys(VALID_LOG)),
      getOwnPropertyDescriptor: jest.fn(),
      get: jest.fn(),
    };
    const proxy = new Proxy({ ...VALID_LOG }, traps);

    expectSafeLogError(() => buildSafeLogProjection(proxy));
    Object.values(traps).forEach((trap) => expect(trap).not.toHaveBeenCalled());
  });

  test('serializes without invoking an inherited toJSON hook', () => {
    const hook = jest.fn(() => HOSTILE_CANARY);
    let serialized;
    Object.defineProperty(Object.prototype, 'toJSON', {
      value: hook,
      enumerable: false,
      configurable: true,
    });
    try {
      serialized = JSON.stringify(buildSafeLogProjection({ ...VALID_LOG }));
    } finally {
      delete Object.prototype.toJSON;
    }
    expect(serialized).toBe(JSON.stringify({
      code: 'invalid_fields',
      environment: 'test',
      event: 'request_validation',
      operation: 'race_registration',
      outcome: 'rejected',
    }));
    expect(hook).not.toHaveBeenCalled();
  });

  test('never invokes a logger, network, clock, randomness, or provider dependency', () => {
    const source = fs.readFileSync(path.join(__dirname, 'safeLogging.js'), 'utf8');
    const requires = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)]
      .map((match) => match[1]);
    expect(requires).toEqual(['./requestValidation']);
    expect(source).not.toMatch(/firebase|stripe|fetch\s*\(|console\.|Date\.now|Math\.random|setTimeout/);

    const previousFetch = global.fetch;
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;
    const consoleSpies = ['log', 'info', 'warn', 'error'].map((method) => (
      jest.spyOn(console, method).mockImplementation(() => {})
    ));
    const dateSpy = jest.spyOn(Date, 'now');
    const randomSpy = jest.spyOn(Math, 'random');
    try {
      expect(buildSafeLogProjection({ ...VALID_LOG })).toEqual(VALID_LOG);
      expect(fetchSpy).not.toHaveBeenCalled();
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
      expect(dateSpy).not.toHaveBeenCalled();
      expect(randomSpy).not.toHaveBeenCalled();
    } finally {
      global.fetch = previousFetch;
      consoleSpies.forEach((spy) => spy.mockRestore());
      dateSpy.mockRestore();
      randomSpy.mockRestore();
    }
  });
});
