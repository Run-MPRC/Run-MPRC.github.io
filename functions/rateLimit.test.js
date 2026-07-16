const { Timestamp } = jest.requireActual('firebase-admin/firestore');

jest.mock('firebase-functions', () => ({
  https: {
    HttpsError: class HttpsError extends Error {
      constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
      }
    },
  },
}));

jest.mock('firebase-admin', () => ({
  firestore: jest.fn(),
}));

const admin = require('firebase-admin');
const { checkRateLimit } = require('./rateLimit');

const NOW = 1_800_000_000_000;
const WINDOW_MS = 60_000;
const SCOPE = 'checkout_email';
const KEY = 'runner@example.test';
const LIMIT = 3;
const CORRUPT_ERROR = {
  code: 'internal',
  message: 'Rate limit state is unavailable.',
  details: undefined,
};
const LIMIT_ERROR = {
  code: 'resource-exhausted',
  message: 'Too many requests. Please wait a few minutes and try again.',
  details: undefined,
};

function bucket(overrides = {}) {
  return {
    scope: SCOPE,
    key: KEY,
    count: 1,
    windowStart: Timestamp.fromMillis(NOW - 1_000),
    windowMs: WINDOW_MS,
    expiresAt: Timestamp.fromMillis(NOW + WINDOW_MS),
    updatedAt: Timestamp.fromMillis(NOW - 1_000),
    ...overrides,
  };
}

function snapshot(value, exists = true) {
  return {
    exists,
    data: jest.fn(() => value),
  };
}

function makeHarness(value, { exists = true, transaction } = {}) {
  const ref = { id: 'rate-limit-ref' };
  const doc = jest.fn(() => ref);
  const collection = jest.fn(() => ({ doc }));
  const tx = {
    get: jest.fn(async () => snapshot(value, exists)),
    set: jest.fn(),
  };
  const runTransaction = jest.fn(transaction || (async (handler) => handler(tx)));
  const db = { collection, runTransaction };
  admin.firestore.mockReturnValue(db);
  return {
    collection, db, doc, ref, runTransaction, tx,
  };
}

async function invoke(overrides = {}) {
  return checkRateLimit({
    scope: SCOPE,
    key: KEY,
    limit: LIMIT,
    windowMs: WINDOW_MS,
    ...overrides,
  });
}

describe('checkRateLimit stored bucket integrity', () => {
  let consoleSpies;

  beforeEach(() => {
    admin.firestore.mockReset();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    consoleSpies = ['debug', 'error', 'info', 'log', 'warn'].map((method) => (
      jest.spyOn(console, method).mockImplementation(() => undefined)
    ));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function expectCorrupt(value, options) {
    const harness = makeHarness(value, options);
    await expect(invoke()).rejects.toMatchObject(CORRUPT_ERROR);
    expect(harness.tx.set).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    return harness;
  }

  test('RED: a current negative count denies instead of becoming less negative', async () => {
    await expectCorrupt(bucket({
      count: -1_000,
      windowStart: Timestamp.fromMillis(NOW),
    }));
  });

  test('creates a first bucket without reading missing snapshot data', async () => {
    const missing = snapshot(undefined, false);
    const harness = makeHarness(undefined, {
      exists: false,
      transaction: async (handler) => {
        harness.tx.get.mockResolvedValueOnce(missing);
        return handler(harness.tx);
      },
    });

    await expect(invoke()).resolves.toBeUndefined();

    expect(missing.data).not.toHaveBeenCalled();
    expect(harness.collection).toHaveBeenCalledWith('ratelimits');
    expect(harness.doc).toHaveBeenCalledWith(`${SCOPE}__${KEY}`);
    expect(harness.tx.set).toHaveBeenCalledTimes(1);
    expect(harness.tx.set).toHaveBeenCalledWith(harness.ref, {
      scope: SCOPE,
      key: KEY,
      count: 1,
      windowStart: Timestamp.fromMillis(NOW),
      windowMs: WINDOW_MS,
      expiresAt: Timestamp.fromMillis(NOW + WINDOW_MS + 60_000),
      updatedAt: Timestamp.fromMillis(NOW),
    });
  });

  test('increments a current valid frozen bucket without inspecting extra fields', async () => {
    const extraGetter = jest.fn(() => {
      throw new Error('extra-field-canary');
    });
    const start = Object.freeze(Timestamp.fromMillis(NOW - 10_000));
    const value = bucket({ count: 2, windowStart: start });
    Object.defineProperty(value, 'futureField', {
      enumerable: true,
      get: extraGetter,
    });
    Object.freeze(value);
    const harness = makeHarness(value);

    await expect(invoke()).resolves.toBeUndefined();

    expect(extraGetter).not.toHaveBeenCalled();
    expect(harness.tx.set).toHaveBeenCalledWith(harness.ref, expect.objectContaining({
      count: 3,
      windowStart: Timestamp.fromMillis(NOW - 10_000),
      expiresAt: Timestamp.fromMillis(NOW + 110_000),
      updatedAt: Timestamp.fromMillis(NOW),
    }));
  });

  test('allows the request that reaches the configured limit', async () => {
    const harness = makeHarness(bucket({ count: LIMIT - 1 }));
    await expect(invoke()).resolves.toBeUndefined();
    expect(harness.tx.set).toHaveBeenCalledWith(
      harness.ref,
      expect.objectContaining({ count: LIMIT }),
    );
  });

  test.each([LIMIT, LIMIT + 1, Number.MAX_SAFE_INTEGER])(
    'denies the next request normally when a valid current count is %p',
    async (count) => {
      const harness = makeHarness(bucket({ count }));
      await expect(invoke()).rejects.toMatchObject(LIMIT_ERROR);
      expect(harness.tx.set).not.toHaveBeenCalled();
    },
  );

  test.each([
    ['exact boundary', NOW - WINDOW_MS],
    ['older boundary', NOW - WINDOW_MS - 1],
  ])('resets a valid expired bucket at the %s', async (_label, startMs) => {
    const harness = makeHarness(bucket({
      count: Number.MAX_SAFE_INTEGER,
      windowStart: Timestamp.fromMillis(startMs),
    }));
    await expect(invoke()).resolves.toBeUndefined();
    expect(harness.tx.set).toHaveBeenCalledWith(harness.ref, {
      scope: SCOPE,
      key: KEY,
      count: 1,
      windowStart: Timestamp.fromMillis(NOW),
      windowMs: WINDOW_MS,
      expiresAt: Timestamp.fromMillis(NOW + WINDOW_MS + 60_000),
      updatedAt: Timestamp.fromMillis(NOW),
    });
  });

  test.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['string', '1'],
    ['bigint', 1n],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['object', {}],
  ])('denies a %s stored count', async (_label, count) => {
    await expectCorrupt(bucket({ count }));
  });

  test('denies an invalid count even when the window is expired', async () => {
    await expectCorrupt(bucket({
      count: -1,
      windowStart: Timestamp.fromMillis(NOW - WINDOW_MS),
    }));
  });

  test.each([
    ['scope', { scope: 'other_scope' }],
    ['raw key', { key: 'runner+collision@example.test' }],
    ['window length', { windowMs: WINDOW_MS + 1 }],
  ])('denies a stored %s mismatch', async (_label, overrides) => {
    await expectCorrupt(bucket(overrides));
  });

  test('stops after the first mismatch without inspecting later fields', async () => {
    const value = bucket({ scope: 'other_scope' });
    const laterGetters = ['key', 'windowMs', 'count', 'windowStart'].map((field) => {
      const getter = jest.fn(() => {
        throw new Error(`${field}-after-scope-canary`);
      });
      Object.defineProperty(value, field, {
        configurable: true,
        enumerable: true,
        get: getter,
      });
      return getter;
    });
    await expectCorrupt(value);
    laterGetters.forEach((getter) => expect(getter).not.toHaveBeenCalled());
  });

  test('denies raw keys that collide after document-id sanitization', async () => {
    const harness = makeHarness(bucket({ key: 'runner/name' }));
    await expect(invoke({ key: 'runner?name' })).rejects.toMatchObject(CORRUPT_ERROR);
    expect(harness.doc).toHaveBeenCalledWith(`${SCOPE}__runner_name`);
    expect(harness.tx.set).not.toHaveBeenCalled();
  });

  test.each([
    ['null', null],
    ['array', []],
    ['date', new Date(NOW)],
    ['null-prototype record', Object.create(null)],
    ['class instance', new (class Bucket {})()],
  ])('denies a %s present root', async (_label, value) => {
    await expectCorrupt(value);
  });

  test('denies a root Proxy without executing a trap', async () => {
    const trap = jest.fn(() => {
      throw new Error('root-proxy-canary');
    });
    const value = new Proxy(bucket(), {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    await expectCorrupt(value);
    expect(trap).not.toHaveBeenCalled();
  });

  test('denies a revoked root Proxy without touching it', async () => {
    const revocable = Proxy.revocable(bucket(), {});
    revocable.revoke();
    await expectCorrupt(revocable.proxy);
  });

  test.each(['scope', 'key', 'windowMs', 'count', 'windowStart'])(
    'denies a missing required own %s field',
    async (field) => {
      const value = bucket();
      delete value[field];
      await expectCorrupt(value);
    },
  );

  test('denies an inherited window start without invoking it', async () => {
    const inheritedGetter = jest.fn(() => {
      throw new Error('inherited-window-start-canary');
    });
    const priorDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'windowStart');
    Object.defineProperty(Object.prototype, 'windowStart', {
      configurable: true,
      enumerable: true,
      get: inheritedGetter,
    });
    try {
      const value = bucket();
      delete value.windowStart;
      await expectCorrupt(value);
      expect(inheritedGetter).not.toHaveBeenCalled();
    } finally {
      if (priorDescriptor) {
        Object.defineProperty(Object.prototype, 'windowStart', priorDescriptor);
      } else {
        delete Object.prototype.windowStart;
      }
    }
  });

  test.each(['scope', 'key', 'windowMs', 'count', 'windowStart'])(
    'denies a non-enumerable required %s field',
    async (field) => {
      const value = bucket();
      Object.defineProperty(value, field, {
        configurable: true,
        enumerable: false,
        value: value[field],
        writable: true,
      });
      await expectCorrupt(value);
    },
  );

  test.each(['scope', 'key', 'windowMs', 'count', 'windowStart'])(
    'denies an accessor-backed required %s without invoking it',
    async (field) => {
      const value = bucket();
      const getter = jest.fn(() => {
        throw new Error(`${field}-getter-canary`);
      });
      Object.defineProperty(value, field, {
        configurable: true,
        enumerable: true,
        get: getter,
      });
      await expectCorrupt(value);
      expect(getter).not.toHaveBeenCalled();
    },
  );

  test('denies a coercible count without invoking its coercion hook', async () => {
    const valueOf = jest.fn(() => 1);
    await expectCorrupt(bucket({ count: { valueOf } }));
    expect(valueOf).not.toHaveBeenCalled();
  });

  test('denies a Proxy count without executing a trap', async () => {
    const trap = jest.fn(() => {
      throw new Error('count-proxy-canary');
    });
    const count = new Proxy({}, {
      get: trap,
      getPrototypeOf: trap,
    });
    await expectCorrupt(bucket({ count }));
    expect(trap).not.toHaveBeenCalled();
  });

  test.each([
    ['future', Timestamp.fromMillis(NOW + 1)],
    ['Date', new Date(NOW)],
    ['null', null],
    ['number', NOW],
  ])('denies a %s window start', async (_label, windowStart) => {
    await expectCorrupt(bucket({ windowStart }));
  });

  test('denies a window start one nanosecond after the current clock', async () => {
    const now = Timestamp.fromMillis(NOW);
    await expectCorrupt(bucket({
      windowStart: new Timestamp(now.seconds, now.nanoseconds + 1),
    }));
  });

  test('denies a pseudo Timestamp without invoking its throwing method', async () => {
    const toMillis = jest.fn(() => {
      throw new Error('toMillis-canary');
    });
    await expectCorrupt(bucket({ windowStart: { toMillis } }));
    expect(toMillis).not.toHaveBeenCalled();
  });

  test('denies a Timestamp Proxy without executing a trap', async () => {
    const trap = jest.fn(() => {
      throw new Error('timestamp-proxy-canary');
    });
    const windowStart = new Proxy(Timestamp.fromMillis(NOW), {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    await expectCorrupt(bucket({ windowStart }));
    expect(trap).not.toHaveBeenCalled();
  });

  test('denies a revoked Timestamp Proxy without touching it', async () => {
    const revocable = Proxy.revocable(Timestamp.fromMillis(NOW), {});
    revocable.revoke();
    await expectCorrupt(bucket({ windowStart: revocable.proxy }));
  });

  test.each([
    ['extra key', (value) => { value.extra = true; }],
    ['extra symbol', (value) => { value[Symbol('extra')] = true; }],
    ['missing seconds', (value) => { delete value._seconds; }],
    ['fractional seconds', (value) => { value._seconds = 1.5; }],
    ['NaN seconds', (value) => { value._seconds = Number.NaN; }],
    ['infinite seconds', (value) => { value._seconds = Number.POSITIVE_INFINITY; }],
    ['negative infinite seconds', (value) => { value._seconds = Number.NEGATIVE_INFINITY; }],
    ['seconds below SDK range', (value) => { value._seconds = -62_135_596_801; }],
    ['seconds above SDK range', (value) => { value._seconds = 253_402_300_800; }],
    ['NaN nanoseconds', (value) => { value._nanoseconds = Number.NaN; }],
    ['infinite nanoseconds', (value) => { value._nanoseconds = Number.POSITIVE_INFINITY; }],
    ['negative infinite nanoseconds', (value) => {
      value._nanoseconds = Number.NEGATIVE_INFINITY;
    }],
    ['negative nanoseconds', (value) => { value._nanoseconds = -1; }],
    ['excess nanoseconds', (value) => { value._nanoseconds = 1_000_000_000; }],
  ])('denies a Timestamp with %s', async (_label, mutate) => {
    const value = Timestamp.fromMillis(NOW);
    mutate(value);
    await expectCorrupt(bucket({ windowStart: value }));
  });

  test.each(['_seconds', '_nanoseconds'])(
    'denies an accessor-backed Timestamp %s field without invoking it',
    async (field) => {
      const value = Timestamp.fromMillis(NOW);
      const getter = jest.fn(() => {
        throw new Error(`${field}-getter-canary`);
      });
      Object.defineProperty(value, field, {
        configurable: true,
        enumerable: true,
        get: getter,
      });
      await expectCorrupt(bucket({ windowStart: value }));
      expect(getter).not.toHaveBeenCalled();
    },
  );

  test('denies a Timestamp subclass', async () => {
    class SubTimestamp extends Timestamp {}
    await expectCorrupt(bucket({ windowStart: new SubTimestamp(1_800_000_000, 0) }));
  });

  test('keeps a window current one nanosecond after the expiry boundary', async () => {
    const boundary = Timestamp.fromMillis(NOW - WINDOW_MS);
    const windowStart = new Timestamp(boundary.seconds, boundary.nanoseconds + 1);
    const harness = makeHarness(bucket({ count: 1, windowStart }));

    await expect(invoke()).resolves.toBeUndefined();

    expect(harness.tx.set).toHaveBeenCalledWith(harness.ref, expect.objectContaining({
      count: 2,
      windowStart,
    }));
  });

  test('captures a fresh clock inside each Firestore transaction retry', async () => {
    let clock = NOW;
    const firstTx = {
      get: jest.fn(async () => {
        clock = NOW;
        return snapshot(undefined, false);
      }),
      set: jest.fn(),
    };
    const concurrentStart = NOW + 1;
    const secondTx = {
      get: jest.fn(async () => {
        clock = NOW + 2;
        return snapshot(bucket({
          count: 1,
          windowStart: Timestamp.fromMillis(concurrentStart),
        }));
      }),
      set: jest.fn(),
    };
    Date.now
      .mockReset()
      .mockImplementation(() => clock);
    const harness = makeHarness(null, {
      transaction: async (handler) => {
        await handler(firstTx); // Firestore discards this attempt before retrying.
        return handler(secondTx);
      },
    });

    await expect(invoke()).resolves.toBeUndefined();

    expect(Date.now).toHaveBeenCalledTimes(2);
    expect(secondTx.set).toHaveBeenCalledWith(harness.ref, expect.objectContaining({
      count: 2,
      windowStart: Timestamp.fromMillis(concurrentStart),
      updatedAt: Timestamp.fromMillis(NOW + 2),
    }));
  });

  test.each([
    ['missing scope', { scope: '' }],
    ['missing key', { key: '' }],
  ])('preserves the no-op for %s', async (_label, overrides) => {
    await expect(invoke(overrides)).resolves.toBeUndefined();
    expect(admin.firestore).not.toHaveBeenCalled();
  });
});
