const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_REQUEST_LIMITS,
  MAX_CENTS,
  REQUEST_VALIDATION_MESSAGE,
  REQUEST_VALIDATION_REASONS,
  RequestValidationError,
  parseBoundedArray,
  parseBoundedString,
  parseCalendarDate,
  parseCurrency,
  parseEmail,
  parseHttpsUrl,
  parseNonnegativeCents,
  parseStrictObject,
} = require('./requestValidation');

const HOSTILE_CANARY = 'private-canary@example.test/token?secret=do-not-copy';

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected validation to fail');
}

function expectSafeError(callback, reason) {
  const error = captureError(callback);
  expect(error).toBeInstanceOf(RequestValidationError);
  expect(error.message).toBe(REQUEST_VALIDATION_MESSAGE);
  expect(error.reason).toBe(reason);
  expect(Object.keys(error)).toEqual([]);
  expect(JSON.stringify(error)).toBe('{}');
  expect(error.name).toBe('RequestValidationError');
  expect(error.stack).not.toContain(HOSTILE_CANARY);
  return error;
}

function strict(value, overrides = {}) {
  return parseStrictObject(value, {
    requiredKeys: ['required'],
    optionalKeys: ['optional'],
    ...overrides,
  });
}

describe('strict request structure', () => {
  test('returns a new recursively frozen, deterministic clone without changing input', () => {
    const shared = { deep: ['one', { two: true }] };
    const input = {
      optional: shared,
      required: { shared, finiteFraction: 1.5, negative: -2 },
    };
    const before = JSON.stringify(input);
    const rootDescriptors = Object.getOwnPropertyDescriptors(input);
    const output = strict(input);

    expect(output).toEqual({
      optional: { deep: ['one', { two: true }] },
      required: {
        finiteFraction: 1.5,
        negative: -2,
        shared: { deep: ['one', { two: true }] },
      },
    });
    expect(Reflect.ownKeys(output)).toEqual(['optional', 'required']);
    expect(output).not.toBe(input);
    expect(output.optional).not.toBe(shared);
    expect(output.required.shared).not.toBe(shared);
    expect(output.optional).not.toBe(output.required.shared);
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.required)).toBe(true);
    expect(Object.isFrozen(output.optional.deep)).toBe(true);
    expect(Object.isFrozen(output.optional.deep[1])).toBe(true);
    expect(Object.getPrototypeOf(output)).toBeNull();
    expect(Object.getPrototypeOf(output.required)).toBeNull();
    expect(Object.getPrototypeOf(output.optional.deep[1])).toBeNull();
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.getOwnPropertyDescriptors(input)).toEqual(rootDescriptors);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(shared)).toBe(false);

    output.required.negative = 4;
    expect(() => output.optional.deep.push('three')).toThrow(TypeError);
    expect(output.required.negative).toBe(-2);
    expect(output.optional.deep).toHaveLength(2);
  });

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['array', []],
    ['date', new Date('2026-01-01T00:00:00Z')],
    ['regular expression', /x/],
    ['map', new Map()],
    ['set', new Set()],
    ['buffer', Buffer.from('x')],
    ['boxed primitive', new String('x')],
    ['null prototype', Object.create(null)],
    ['class instance', new (class Example {})()],
  ])('rejects a %s root', (_name, value) => {
    expectSafeError(() => strict(value), REQUEST_VALIDATION_REASONS.INVALID_OBJECT);
  });

  test.each([
    ['missing required key', { optional: true }],
    ['unknown key', { required: true, unknown: HOSTILE_CANARY }],
  ])('rejects %s with a fixed field error', (_name, value) => {
    expectSafeError(() => strict(value), REQUEST_VALIDATION_REASONS.INVALID_FIELDS);
  });

  test('rejects symbols, non-enumerable properties, and accessors without invoking them', () => {
    const getter = jest.fn(() => HOSTILE_CANARY);
    for (const value of [
      (() => {
        const candidate = { required: true };
        candidate[Symbol('hidden')] = HOSTILE_CANARY;
        return candidate;
      })(),
      (() => {
        const candidate = { required: true };
        Object.defineProperty(candidate, 'optional', {
          value: HOSTILE_CANARY,
          enumerable: false,
        });
        return candidate;
      })(),
      (() => {
        const candidate = { required: true };
        Object.defineProperty(candidate, 'optional', { get: getter, enumerable: true });
        return candidate;
      })(),
      (() => {
        const candidate = { required: true };
        Object.defineProperty(candidate, 'unknown', { get: getter, enumerable: true });
        return candidate;
      })(),
    ]) {
      expectSafeError(() => strict(value), REQUEST_VALIDATION_REASONS.INVALID_OBJECT);
    }
    expect(getter).not.toHaveBeenCalled();
  });

  test('rejects custom and polluted prototypes', () => {
    const inherited = Object.create({ inherited: HOSTILE_CANARY });
    inherited.required = true;
    expectSafeError(() => strict(inherited), REQUEST_VALIDATION_REASONS.INVALID_OBJECT);

    Object.defineProperty(Object.prototype, 'temporaryPollutionProbe', {
      value: HOSTILE_CANARY,
      enumerable: true,
      configurable: true,
    });
    try {
      expectSafeError(
        () => strict({ required: true }),
        REQUEST_VALIDATION_REASONS.INVALID_OBJECT,
      );
    } finally {
      delete Object.prototype.temporaryPollutionProbe;
    }
  });

  test.each(['__proto__', 'prototype', 'constructor'])(
    'rejects dangerous own key %s at root and nested boundaries',
    (key) => {
      const root = JSON.parse(`{"required":true,"${key}":"blocked"}`);
      expectSafeError(() => strict(root), REQUEST_VALIDATION_REASONS.INVALID_OBJECT);

      const nested = { required: JSON.parse(`{"${key}":"blocked"}`) };
      expectSafeError(() => strict(nested), REQUEST_VALIDATION_REASONS.INVALID_OBJECT);
    },
  );

  test('rejects a Proxy before any reflection trap can run', () => {
    const traps = {
      getPrototypeOf: jest.fn(() => Object.prototype),
      ownKeys: jest.fn(() => ['required']),
      getOwnPropertyDescriptor: jest.fn(() => ({
        value: true, enumerable: true, configurable: true, writable: true,
      })),
      get: jest.fn(() => true),
    };
    const proxy = new Proxy({}, traps);

    expectSafeError(() => strict(proxy), REQUEST_VALIDATION_REASONS.INVALID_OBJECT);
    Object.values(traps).forEach((trap) => expect(trap).not.toHaveBeenCalled());
  });

  test('rejects cycles but accepts and independently clones shared references', () => {
    const self = { required: true };
    self.optional = self;
    expectSafeError(() => strict(self), REQUEST_VALIDATION_REASONS.INVALID_VALUE);

    const left = {};
    const right = {};
    left.right = right;
    right.left = left;
    expectSafeError(
      () => strict({ required: left }),
      REQUEST_VALIDATION_REASONS.INVALID_VALUE,
    );

    const shared = { safe: true };
    const output = strict({ required: shared, optional: shared });
    expect(output.required).toEqual(shared);
    expect(output.optional).toEqual(shared);
    expect(output.required).not.toBe(output.optional);
  });

  test.each([
    ['undefined', undefined],
    ['function', () => {}],
    ['symbol', Symbol('value')],
    ['bigint', 1n],
    ['NaN', NaN],
    ['positive infinity', Infinity],
    ['negative infinity', -Infinity],
    ['negative zero', -0],
  ])('rejects nested non-JSON value %s', (_name, value) => {
    expectSafeError(
      () => strict({ required: value }),
      REQUEST_VALIDATION_REASONS.INVALID_VALUE,
    );
  });

  test('uses one depth and entry budget across the complete tree', () => {
    const atDepth = { required: { a: { b: true } } };
    expect(strict(atDepth, { limits: { maxDepth: 2 } })).toEqual(atDepth);
    expectSafeError(
      () => strict({ required: { a: { b: { c: true } } } }, {
        limits: { maxDepth: 2 },
      }),
      REQUEST_VALIDATION_REASONS.PAYLOAD_LIMIT,
    );

    const atEntries = { required: { a: true }, optional: false };
    expect(strict(atEntries, { limits: { maxEntries: 3 } })).toEqual(atEntries);
    expectSafeError(
      () => strict({ required: { a: true, b: false }, optional: false }, {
        limits: { maxEntries: 3 },
      }),
      REQUEST_VALIDATION_REASONS.PAYLOAD_LIMIT,
    );
  });

  test('enforces exact array, string, and serialized-byte boundaries', () => {
    expect(strict({ required: [1, 2] }, {
      limits: { maxArrayLength: 2 },
    })).toEqual({ required: [1, 2] });
    expectSafeError(
      () => strict({ required: [1, 2, 3] }, {
        limits: { maxArrayLength: 2 },
      }),
      REQUEST_VALIDATION_REASONS.PAYLOAD_LIMIT,
    );

    expect(strict({ required: '😀' }, {
      limits: { maxStringCodePoints: 1, maxStringBytes: 4 },
    })).toEqual({ required: '😀' });
    expectSafeError(
      () => strict({ required: '😀😀' }, {
        limits: { maxStringCodePoints: 1 },
      }),
      REQUEST_VALIDATION_REASONS.PAYLOAD_LIMIT,
    );
    expectSafeError(
      () => strict({ required: '😀' }, {
        limits: { maxStringBytes: 3 },
      }),
      REQUEST_VALIDATION_REASONS.PAYLOAD_LIMIT,
    );

    const payload = { required: 'abc' };
    const exactBytes = Buffer.byteLength(JSON.stringify(payload));
    expect(strict(payload, { limits: { maxSerializedBytes: exactBytes } })).toEqual(payload);
    expectSafeError(
      () => strict(payload, { limits: { maxSerializedBytes: exactBytes - 1 } }),
      REQUEST_VALIDATION_REASONS.PAYLOAD_LIMIT,
    );

    const escapedPayload = { required: '"\\\b\t\n\f\r\0😀' };
    const escapedBytes = Buffer.byteLength(JSON.stringify(escapedPayload));
    expect(strict(escapedPayload, {
      limits: { maxSerializedBytes: escapedBytes },
    })).toEqual(escapedPayload);
    expectSafeError(
      () => strict(escapedPayload, {
        limits: { maxSerializedBytes: escapedBytes - 1 },
      }),
      REQUEST_VALIDATION_REASONS.PAYLOAD_LIMIT,
    );

    const oversizedKey = 'k'.repeat(DEFAULT_REQUEST_LIMITS.maxKeyCodePoints + 1);
    expectSafeError(
      () => parseStrictObject({ [oversizedKey]: true }, {
        optionalKeys: [],
      }),
      REQUEST_VALIDATION_REASONS.PAYLOAD_LIMIT,
    );
  });

  test('never invokes inherited toJSON hooks while measuring serialized bytes', () => {
    const objectHook = jest.fn(() => {
      throw new Error(HOSTILE_CANARY);
    });
    const arrayHook = jest.fn(() => {
      throw new Error(HOSTILE_CANARY);
    });
    let output;
    Object.defineProperty(Object.prototype, 'toJSON', {
      value: objectHook,
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(Array.prototype, 'toJSON', {
      value: arrayHook,
      enumerable: false,
      configurable: true,
    });
    try {
      output = strict({ required: [{ safe: true }] });
    } finally {
      delete Array.prototype.toJSON;
      delete Object.prototype.toJSON;
    }
    expect(output).toEqual({ required: [{ safe: true }] });
    expect(objectHook).not.toHaveBeenCalled();
    expect(arrayHook).not.toHaveBeenCalled();
  });

  test('rejects sparse, accessor, symbol, extra-property, subclass, and Proxy arrays', () => {
    const getter = jest.fn(() => HOSTILE_CANARY);
    const sparse = new Array(2);
    sparse[0] = 'one';
    const accessor = ['one'];
    Object.defineProperty(accessor, '0', { get: getter, enumerable: true });
    const symbol = ['one'];
    symbol[Symbol('hidden')] = true;
    const extra = ['one'];
    extra.extra = true;
    class ArraySubclass extends Array {}
    const subclass = new ArraySubclass('one');
    const traps = { get: jest.fn(), ownKeys: jest.fn() };
    const proxy = new Proxy(['one'], traps);

    for (const value of [sparse, accessor, symbol, extra, subclass]) {
      expectSafeError(
        () => strict({ required: value }),
        REQUEST_VALIDATION_REASONS.INVALID_ARRAY,
      );
    }
    expectSafeError(
      () => strict({ required: proxy }),
      REQUEST_VALIDATION_REASONS.INVALID_VALUE,
    );
    expect(getter).not.toHaveBeenCalled();
    Object.values(traps).forEach((trap) => expect(trap).not.toHaveBeenCalled());
  });

  test('rejects an inherited enumerable array field without reading it', () => {
    const getter = jest.fn(() => HOSTILE_CANARY);
    Object.defineProperty(Array.prototype, 'pollutedCanary', {
      get: getter,
      enumerable: true,
      configurable: true,
    });
    try {
      expectSafeError(
        () => strict({ required: ['safe'] }),
        REQUEST_VALIDATION_REASONS.INVALID_ARRAY,
      );
      expectSafeError(
        () => parseBoundedArray(['safe'], {
          maxItems: 1,
          itemParser: (item) => item,
        }),
        REQUEST_VALIDATION_REASONS.INVALID_ARRAY,
      );
    } finally {
      delete Array.prototype.pollutedCanary;
    }
    expect(getter).not.toHaveBeenCalled();
  });

  test('rejects unsafe validator configuration with one fixed programmer error', () => {
    const badOptions = [
      { requiredKeys: ['same'], optionalKeys: ['same'] },
      { requiredKeys: ['duplicate', 'duplicate'] },
      { requiredKeys: ['__proto__'] },
      { requiredKeys: ['not-valid-field'] },
      { requiredKeys: null },
      { requiredKeys: false },
      { requiredKeys: 0 },
      { requiredKeys: '' },
      { optionalKeys: null },
      { optionalKeys: false },
      { optionalKeys: 0 },
      { optionalKeys: '' },
      { limits: { maxDepth: DEFAULT_REQUEST_LIMITS.maxDepth + 1 } },
      { limits: { unknownLimit: 1 } },
    ];
    for (const options of badOptions) {
      expect(() => parseStrictObject({}, options)).toThrow(
        new TypeError('Invalid validation options'),
      );
    }
  });
});

describe('bounded array and string primitives', () => {
  test('maps a dense array into a new deeply frozen result', () => {
    const input = [{ value: 'one' }, { value: 'two' }];
    const parsed = parseBoundedArray(input, {
      maxItems: 2,
      itemParser: (item) => parseStrictObject(item, { requiredKeys: ['value'] }),
    });

    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed[0]).not.toBe(input[0]);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed[0])).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input[0])).toBe(false);
  });

  test('gives the item parser a bounded frozen clone and cannot mutate caller input', () => {
    const input = [{ nested: { value: 'before' } }];
    const before = JSON.stringify(input);
    let parserInput;
    const parsed = parseBoundedArray(input, {
      maxItems: 1,
      itemParser: (item) => {
        parserInput = item;
        expect(Reflect.set(item.nested, 'value', 'after')).toBe(false);
        return item;
      },
    });

    expect(JSON.stringify(input)).toBe(before);
    expect(parserInput).not.toBe(input[0]);
    expect(Object.isFrozen(parserInput)).toBe(true);
    expect(Object.isFrozen(parserInput.nested)).toBe(true);
    expect(parsed).toEqual(input);
    expect(parsed[0]).not.toBe(parserInput);
  });

  test('bounds raw items before a projecting item parser can hide them', () => {
    const itemParser = jest.fn(() => 'projected');
    const deep = { level: true };
    let cursor = deep;
    for (let index = 0; index <= DEFAULT_REQUEST_LIMITS.maxDepth; index += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }
    expectSafeError(
      () => parseBoundedArray([deep], { maxItems: 1, itemParser }),
      REQUEST_VALIDATION_REASONS.PAYLOAD_LIMIT,
    );
    expect(itemParser).not.toHaveBeenCalled();

    const oversized = Array.from(
      { length: 33 },
      () => 'a'.repeat(DEFAULT_REQUEST_LIMITS.maxStringCodePoints),
    );
    expect(Buffer.byteLength(JSON.stringify(oversized))).toBeGreaterThan(
      DEFAULT_REQUEST_LIMITS.maxSerializedBytes,
    );
    expectSafeError(
      () => parseBoundedArray(oversized, { maxItems: 33, itemParser }),
      REQUEST_VALIDATION_REASONS.PAYLOAD_LIMIT,
    );
    expect(itemParser).not.toHaveBeenCalled();
  });

  test('validates the complete array before calling its trusted item parser', () => {
    const itemParser = jest.fn((value) => value);
    const invalid = ['one'];
    Object.defineProperty(invalid, '0', {
      get: jest.fn(() => HOSTILE_CANARY),
      enumerable: true,
    });
    expectSafeError(
      () => parseBoundedArray(invalid, { maxItems: 1, itemParser }),
      REQUEST_VALIDATION_REASONS.INVALID_ARRAY,
    );
    expect(itemParser).not.toHaveBeenCalled();
  });

  test('converts an unsafe item-parser failure to a fixed validation error', () => {
    const unsafeParser = (value) => {
      throw new Error(value);
    };
    expectSafeError(
      () => parseBoundedArray([HOSTILE_CANARY], {
        maxItems: 1,
        itemParser: unsafeParser,
      }),
      REQUEST_VALIDATION_REASONS.INVALID_VALUE,
    );
  });

  test('does not inspect a Proxy thrown by an item parser', () => {
    const getPrototypeOf = jest.fn(() => {
      throw new Error(HOSTILE_CANARY);
    });
    const thrown = new Proxy({}, { getPrototypeOf });
    expectSafeError(
      () => parseBoundedArray(['safe'], {
        maxItems: 1,
        itemParser: () => {
          throw thrown;
        },
      }),
      REQUEST_VALIDATION_REASONS.INVALID_VALUE,
    );
    expect(getPrototypeOf).not.toHaveBeenCalled();
  });

  test('does not trust a caller-constructed validation error', () => {
    const fabricated = new RequestValidationError(
      REQUEST_VALIDATION_REASONS.INVALID_EMAIL,
    );
    expect(Object.isFrozen(fabricated)).toBe(true);
    expect(Reflect.set(fabricated, 'message', HOSTILE_CANARY)).toBe(false);
    // V8's special lazy Error.stack slot can report or accept this write in
    // some Jest hosts even when Object.isFrozen is true. The fabricated error
    // is untrusted; the boundary is that the parser replaces it below.
    Reflect.set(fabricated, 'stack', HOSTILE_CANARY);
    const recaptured = expectSafeError(
      () => parseBoundedArray(['safe'], {
        maxItems: 1,
        itemParser: () => {
          throw fabricated;
        },
      }),
      REQUEST_VALIDATION_REASONS.INVALID_VALUE,
    );
    expect(recaptured).not.toBe(fabricated);
  });

  test('recaptures a genuine parser error without a value-derived function name', () => {
    const namedParser = {
      [HOSTILE_CANARY]: () => parseEmail('invalid'),
    }[HOSTILE_CANARY];
    expectSafeError(
      () => parseBoundedArray(['safe'], {
        maxItems: 1,
        itemParser: namedParser,
      }),
      REQUEST_VALIDATION_REASONS.INVALID_EMAIL,
    );
  });

  test('bounded arrays never invoke inherited toJSON hooks', () => {
    const objectHook = jest.fn(() => {
      throw new Error(HOSTILE_CANARY);
    });
    const arrayHook = jest.fn(() => {
      throw new Error(HOSTILE_CANARY);
    });
    let output;
    Object.defineProperty(Object.prototype, 'toJSON', {
      value: objectHook,
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(Array.prototype, 'toJSON', {
      value: arrayHook,
      enumerable: false,
      configurable: true,
    });
    try {
      output = parseBoundedArray([{ safe: true }], {
        maxItems: 1,
        itemParser: (item) => item,
      });
    } finally {
      delete Array.prototype.toJSON;
      delete Object.prototype.toJSON;
    }
    expect(output).toEqual([{ safe: true }]);
    expect(objectHook).not.toHaveBeenCalled();
    expect(arrayHook).not.toHaveBeenCalled();
  });

  test('normalizes NFC, counts code points, enforces bytes, and preserves opaque strings', () => {
    expect(parseBoundedString('e\u0301', {
      maxCodePoints: 2,
      maxBytes: 3,
    })).toBe('é');
    expect(parseBoundedString('😀', {
      maxCodePoints: 1,
      maxBytes: 4,
    })).toBe('😀');
    expect(parseBoundedString('  value  ', {
      maxCodePoints: 9,
      maxBytes: 9,
      trim: true,
    })).toBe('value');
    expect(parseBoundedString('e\u0301', {
      maxCodePoints: 2,
      maxBytes: 3,
      normalize: false,
    })).toBe('e\u0301');

    expectSafeError(
      () => parseBoundedString('😀😀', { maxCodePoints: 1, maxBytes: 8 }),
      REQUEST_VALIDATION_REASONS.INVALID_STRING,
    );
    expectSafeError(
      () => parseBoundedString('😀', { maxCodePoints: 1, maxBytes: 3 }),
      REQUEST_VALIDATION_REASONS.INVALID_STRING,
    );
    expectSafeError(
      () => parseBoundedString('\uD800', { maxCodePoints: 1, maxBytes: 3 }),
      REQUEST_VALIDATION_REASONS.INVALID_STRING,
    );
    expectSafeError(
      () => parseBoundedString('\uDC00', { maxCodePoints: 1, maxBytes: 3 }),
      REQUEST_VALIDATION_REASONS.INVALID_STRING,
    );
  });

  test('treats hostile markup and spreadsheet text as inert bounded data', () => {
    const fetchSpy = jest.fn(() => {
      throw new Error('network must not be called');
    });
    const previousFetch = global.fetch;
    global.fetch = fetchSpy;
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('logger must not be called');
    });
    try {
      const input = '<img src=x onerror=fetch("https://example.test/")>=HYPERLINK("x")';
      expect(parseBoundedString(input, {
        maxCodePoints: 100,
        maxBytes: 100,
      })).toBe(input);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(consoleSpy).not.toHaveBeenCalled();
    } finally {
      global.fetch = previousFetch;
      consoleSpy.mockRestore();
    }
  });
});

describe('money, currency, date, URL, and email primitives', () => {
  test.each([0, 1, MAX_CENTS])('accepts nonnegative integer cents %s', (value) => {
    expect(parseNonnegativeCents(value)).toBe(value);
  });

  test.each([
    -1,
    -0,
    MAX_CENTS + 1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    NaN,
    Infinity,
    new Number(1),
    '1',
    '+1',
    '-1',
    '1e2',
    true,
    null,
    1n,
    [],
    {},
  ])('rejects unsafe cents value %p', (value) => {
    expectSafeError(
      () => parseNonnegativeCents(value),
      REQUEST_VALIDATION_REASONS.INVALID_MONEY,
    );
  });

  test('applies an explicit lower endpoint ceiling and treats numeric exponent syntax as its value', () => {
    expect(parseNonnegativeCents(100, { maxCents: 100 })).toBe(100);
    // By the time JavaScript receives it, numeric 1e2 is exactly the number 100.
    expect(parseNonnegativeCents(1e2, { maxCents: 100 })).toBe(100);
    expectSafeError(
      () => parseNonnegativeCents(101, { maxCents: 100 }),
      REQUEST_VALIDATION_REASONS.INVALID_MONEY,
    );
    expect(() => parseNonnegativeCents(1, { maxCents: MAX_CENTS + 1 }))
      .toThrow(new TypeError('Invalid validation options'));
  });

  test('normalizes only the fixed launch currency', () => {
    expect(parseCurrency('usd')).toBe('usd');
    expect(parseCurrency('USD')).toBe('usd');
    for (const value of [' usd ', 'us', 'usdd', 'eur', 'u5d', 'uѕd', new String('usd')]) {
      expectSafeError(
        () => parseCurrency(value),
        REQUEST_VALIDATION_REASONS.INVALID_CURRENCY,
      );
    }
  });

  test.each(['0001-01-01', '2024-02-29', '9999-12-31'])(
    'accepts canonical calendar date %s',
    (value) => expect(parseCalendarDate(value)).toBe(value),
  );

  test.each([
    '0000-01-01',
    '2023-02-29',
    '2024-04-31',
    '2024-00-01',
    '2024-13-01',
    '2024-01-00',
    '2024-01-32',
    '2024-1-01',
    ' 2024-01-01',
    '2024-01-01T00:00:00Z',
    '２０２４-０１-０１',
    20240101,
    new Date('2024-01-01T00:00:00Z'),
  ])('rejects invalid calendar date %p', (value) => {
    expectSafeError(
      () => parseCalendarDate(value),
      REQUEST_VALIDATION_REASONS.INVALID_DATE,
    );
  });

  test.each([
    'https://example.test/',
    'https://example.test/A/~/%2F/%20',
    'https://example.test/path?view=public#section',
    'https://sub.example.test:8443/path',
  ])('accepts canonical HTTPS DNS URL %s', (value) => {
    expect(parseHttpsUrl(value)).toBe(value);
  });

  test.each([
    'http://localhost:3000/',
    'https://localhost:3000/',
    'http://127.0.0.1:5001/path',
    'http://[::1]:5001/path',
  ])('accepts canonical loopback URL only when explicitly enabled: %s', (value) => {
    expectSafeError(() => parseHttpsUrl(value), REQUEST_VALIDATION_REASONS.INVALID_URL);
    expect(parseHttpsUrl(value, { allowLoopback: true })).toBe(value);
  });

  test.each([
    'http://example.test/',
    'ftp://example.test/',
    'file:///tmp/example',
    'data:text/plain,hello',
    'javascript:alert(1)',
    '//example.test/path',
    'https://user:pass@example.test/',
    'https://example.test',
    'HTTPS://example.test/',
    'https://EXAMPLE.test/',
    'https://example.test:443/',
    'https://example.test/a/../b',
    'https://example.test\\evil.test/',
    'https://example.test/%0aheader',
    'https://example.test/%7f',
    'https://example.test/%zz',
    'https://example.test/%41',
    'https://example.test/%7E',
    'https://example.test/%7e',
    'https://example.test/%2f',
    'https://127.1/',
    'https://2130706433/',
    'https://0x7f000001/',
    'https://127.0.0.2/',
    'https://8.8.8.8/',
    'https://[::ffff:7f00:1]/',
    'https://0.0.0.0/',
    'https://localhost.example.test/',
    'https://xn--bcher-kva.example/',
  ])('rejects noncanonical or unsafe URL %s', (value) => {
    expectSafeError(
      () => parseHttpsUrl(value, { allowLoopback: true }),
      REQUEST_VALIDATION_REASONS.INVALID_URL,
    );
  });

  test('bounds URL length and rejects Proxy options before traps', () => {
    expectSafeError(
      () => parseHttpsUrl(`https://example.test/${'a'.repeat(2030)}`),
      REQUEST_VALIDATION_REASONS.INVALID_URL,
    );
    const get = jest.fn(() => true);
    const options = new Proxy({}, { get });
    expect(() => parseHttpsUrl('https://example.test/', options))
      .toThrow(new TypeError('Invalid validation options'));
    expect(get).not.toHaveBeenCalled();
  });

  test('normalizes a conservative ASCII email without claiming identity or delivery', () => {
    expect(parseEmail(' Person+Race@Example.TEST ')).toBe('person+race@example.test');
    const local = 'a'.repeat(64);
    const domain = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;
    const boundary = `${local}@${domain}`;
    expect(boundary).toHaveLength(254);
    expect(parseEmail(boundary)).toBe(boundary);
  });

  test.each([
    '',
    'missing-at.example.test',
    '@example.test',
    'two@@example.test',
    '.leading@example.test',
    'trailing.@example.test',
    'two..dots@example.test',
    'space here@example.test',
    '\tperson@example.test',
    'person@example.test\n',
    'line\r\nheader@example.test',
    'nul\0@example.test',
    'person@example',
    'person@example..test',
    'person@_invalid.example',
    'person@-invalid.example',
    'person@invalid-.example',
    `person@${'a'.repeat(64)}.test`,
    `${'a'.repeat(65)}@example.test`,
    `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}`,
    '"quoted"@example.test',
    'person(comment)@example.test',
    'person@[127.0.0.1]',
    'person@bücher.example',
    'K@example.test',
    'person@xn--bcher-kva.example',
    {},
  ])('rejects invalid or unsupported email %p', (value) => {
    expectSafeError(() => parseEmail(value), REQUEST_VALIDATION_REASONS.INVALID_EMAIL);
  });
});

describe('fixed errors and pure dependency boundary', () => {
  test('never includes a hostile supplied value in any public validation error', () => {
    const cases = [
      () => strict({ required: true, unknown: HOSTILE_CANARY }),
      () => parseBoundedString(HOSTILE_CANARY, { maxCodePoints: 1, maxBytes: 1 }),
      () => parseNonnegativeCents(HOSTILE_CANARY),
      () => parseCurrency(HOSTILE_CANARY),
      () => parseCalendarDate(HOSTILE_CANARY),
      () => parseHttpsUrl(HOSTILE_CANARY),
      () => parseEmail(HOSTILE_CANARY),
    ];
    for (const callback of cases) {
      const error = captureError(callback);
      expect(error).toBeInstanceOf(RequestValidationError);
      expect(`${error.name}${error.message}${error.stack}${JSON.stringify(error)}`)
        .not.toContain(HOSTILE_CANARY);
    }
  });

  test('uses only pure Node inspection helpers and performs no external/log/random/time call', () => {
    const source = fs.readFileSync(path.join(__dirname, 'requestValidation.js'), 'utf8');
    const requires = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)]
      .map((match) => match[1]);
    expect(requires).toEqual(['node:net', 'node:util']);
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
      expect(strict({ required: 'safe' })).toEqual({ required: 'safe' });
      expect(parseEmail('safe@example.test')).toBe('safe@example.test');
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
