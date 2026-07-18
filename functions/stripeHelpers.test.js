const mockStripeConstructor = jest.fn();
const mockLoadCallableServerConfig = jest.fn();

jest.mock('stripe', () => mockStripeConstructor);

jest.mock('firebase-functions', () => {
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  return { https: { HttpsError } };
});

jest.mock('firebase-admin', () => ({
  firestore: jest.fn(),
}));

jest.mock('firebase-admin/firestore', () => {
  const actual = jest.requireActual('firebase-admin/firestore');
  return {
    Timestamp: actual.Timestamp,
    FieldValue: actual.FieldValue,
  };
});

jest.mock('./serverConfig', () => ({
  loadCallableServerConfig: (...args) => mockLoadCallableServerConfig(...args),
}));

const {
  isEarlyBirdActive,
  isRegistrationOpen,
  pickPriceCents,
  projectEventCheckoutAudience,
  projectParticipantCapacityLimit,
  requireAdmin,
  resolveCallerRole,
  Timestamp,
} = require('./stripeHelpers');
const { MAX_CENTS } = require('./requestValidation');

const NOW_MS = 1_735_689_600_000;

function openEvent(overrides = {}) {
  return { status: 'open', ...overrides };
}

describe('event checkout audience validation', () => {
  test.each([
    ['modern public', { visibility: 'public' }, 'public'],
    ['modern members-only', { visibility: 'members_only' }, 'members_only'],
    ['legacy public', { member_only: false }, 'public'],
    ['legacy members-only', { member_only: true }, 'members_only'],
  ])('projects the %s format to %s', (_name, event, expected) => {
    Object.freeze(event);
    expect(projectEventCheckoutAudience(event)).toBe(expected);
  });

  test('rejects missing, mixed, and draft audience formats', () => {
    expect(projectEventCheckoutAudience({})).toBeUndefined();
    expect(projectEventCheckoutAudience({
      visibility: 'public',
      member_only: false,
    })).toBeUndefined();
    expect(projectEventCheckoutAudience({
      visibility: 'members_only',
      member_only: true,
    })).toBeUndefined();
    expect(projectEventCheckoutAudience({
      visibility: 'draft',
    })).toBeUndefined();
  });

  test.each([
    ['present undefined', undefined],
    ['null', null],
    ['false', false],
    ['true', true],
    ['zero', 0],
    ['number', 1],
    ['empty string', ''],
    ['draft', 'draft'],
    ['unknown string', 'synthetic_audience_canary'],
    ['case-changed string', 'Public'],
    ['hyphenated string', 'members-only'],
    ['bigint', BigInt(1)],
    ['symbol', Symbol('visibility')],
    ['boxed string', Object('public')],
    ['plain record', { value: 'public' }],
    ['array', ['public']],
    ['Date', new Date(NOW_MS)],
    ['Map', new Map([['visibility', 'public']])],
    ['Set', new Set(['public'])],
  ])('rejects a %s visibility value', (_name, visibility) => {
    expect(projectEventCheckoutAudience({ visibility })).toBeUndefined();
  });

  test.each([
    ['present undefined', undefined],
    ['null', null],
    ['zero', 0],
    ['one', 1],
    ['empty string', ''],
    ['false text', 'false'],
    ['true text', 'true'],
    ['bigint', BigInt(1)],
    ['symbol', Symbol('member-only')],
    ['boxed boolean', Object(true)],
    ['plain record', { value: true }],
    ['array', [true]],
    ['Date', new Date(NOW_MS)],
    ['Map', new Map([['member_only', true]])],
    ['Set', new Set([true])],
  ])('rejects a %s legacy member-only value', (_name, memberOnly) => {
    expect(projectEventCheckoutAudience({
      member_only: memberOnly,
    })).toBeUndefined();
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['number', 1],
    ['string', 'event'],
    ['array', []],
    ['Date', new Date(NOW_MS)],
    ['null-prototype record', Object.create(null)],
    ['custom-prototype record', Object.create({})],
  ])('rejects a %s event root without throwing', (_name, event) => {
    expect(() => projectEventCheckoutAudience(event)).not.toThrow();
    expect(projectEventCheckoutAudience(event)).toBeUndefined();
  });

  test('rejects live and revoked Proxy event roots without invoking traps', () => {
    const trap = jest.fn(() => {
      throw new Error('synthetic event trap must not run');
    });
    const proxiedEvent = new Proxy({ visibility: 'public' }, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });

    expect(projectEventCheckoutAudience(proxiedEvent)).toBeUndefined();
    expect(trap).not.toHaveBeenCalled();

    const revoked = Proxy.revocable({ visibility: 'public' }, {});
    revoked.revoke();
    expect(() => projectEventCheckoutAudience(revoked.proxy)).not.toThrow();
    expect(projectEventCheckoutAudience(revoked.proxy)).toBeUndefined();
  });

  test.each([
    ['visibility', 'public'],
    ['member_only', false],
  ])('rejects an accessor-backed or hidden %s field', (field, value) => {
    const getter = jest.fn(() => value);
    const accessorEvent = {};
    Object.defineProperty(accessorEvent, field, {
      enumerable: true,
      get: getter,
    });
    const hiddenEvent = {};
    Object.defineProperty(hiddenEvent, field, { value });

    expect(projectEventCheckoutAudience(accessorEvent)).toBeUndefined();
    expect(projectEventCheckoutAudience(hiddenEvent)).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
  });

  test.each([
    ['visibility', { member_only: false }, 'public'],
    ['member_only', { visibility: 'public' }, true],
  ])('rejects shared-prototype %s pollution without reading it', (
    field,
    event,
    value,
  ) => {
    const getter = jest.fn(() => value);
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      Object.prototype,
      field,
    );
    let projected;

    try {
      Object.defineProperty(Object.prototype, field, {
        configurable: true,
        get: getter,
      });
      projected = projectEventCheckoutAudience(event);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(Object.prototype, field, originalDescriptor);
      } else {
        delete Object.prototype[field];
      }
    }

    expect(projected).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
  });

  test.each([
    'visibility',
    'member_only',
  ])('rejects live and revoked Proxy %s values without invoking traps', (
    field,
  ) => {
    const trap = jest.fn(() => {
      throw new Error('synthetic audience trap must not run');
    });
    const proxiedValue = new Proxy({}, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });

    expect(projectEventCheckoutAudience({
      [field]: proxiedValue,
    })).toBeUndefined();
    expect(trap).not.toHaveBeenCalled();

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(() => projectEventCheckoutAudience({
      [field]: revoked.proxy,
    })).not.toThrow();
    expect(projectEventCheckoutAudience({
      [field]: revoked.proxy,
    })).toBeUndefined();
  });

  test.each([
    'visibility',
    'member_only',
  ])('does not invoke %s conversion or traversal hooks', (field) => {
    const value = {
      valueOf: jest.fn(() => field === 'visibility' ? 'public' : false),
      toString: jest.fn(() => field === 'visibility' ? 'public' : 'false'),
      toJSON: jest.fn(() => field === 'visibility' ? 'public' : false),
      [Symbol.iterator]: jest.fn(),
      [Symbol.toPrimitive]: jest.fn(
        () => field === 'visibility' ? 'public' : false,
      ),
    };

    expect(projectEventCheckoutAudience({
      [field]: value,
    })).toBeUndefined();
    [
      value.valueOf,
      value.toString,
      value.toJSON,
      value[Symbol.iterator],
      value[Symbol.toPrimitive],
    ].forEach((hook) => {
      expect(hook).not.toHaveBeenCalled();
    });
  });

  test('uses captured validation intrinsics', () => {
    const originalGetPrototypeOf = Object.getPrototypeOf;
    const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const originalHasOwn = Object.hasOwn;
    const fail = () => {
      throw new Error('synthetic replaced intrinsic must not run');
    };
    let modern;
    let legacy;

    try {
      Object.getPrototypeOf = fail;
      Object.getOwnPropertyDescriptor = fail;
      Object.hasOwn = fail;
      modern = projectEventCheckoutAudience({ visibility: 'public' });
      legacy = projectEventCheckoutAudience({ member_only: true });
    } finally {
      Object.getPrototypeOf = originalGetPrototypeOf;
      Object.getOwnPropertyDescriptor = originalGetOwnPropertyDescriptor;
      Object.hasOwn = originalHasOwn;
    }

    expect(modern).toBe('public');
    expect(legacy).toBe('members_only');
  });

  test('does not mutate or traverse unrelated fields', () => {
    const unrelatedGetter = jest.fn(() => 'private synthetic detail');
    const symbolGetter = jest.fn(() => 'private synthetic symbol detail');
    const event = { visibility: 'public' };
    event.self = event;
    Object.defineProperty(event, 'unrelated', {
      enumerable: true,
      get: unrelatedGetter,
    });
    Object.defineProperty(event, Symbol('unrelated'), {
      enumerable: true,
      get: symbolGetter,
    });
    const before = Object.getOwnPropertyDescriptors(event);

    const projected = projectEventCheckoutAudience(event);

    expect(projected).toBe('public');
    expect(Object.getOwnPropertyDescriptors(event)).toEqual(before);
    expect(unrelatedGetter).not.toHaveBeenCalled();
    expect(symbolGetter).not.toHaveBeenCalled();
    event.visibility = 'members_only';
    expect(projected).toBe('public');
  });
});

describe('participant capacity validation', () => {
  test('keeps missing and null capacity unlimited', () => {
    expect(projectParticipantCapacityLimit({})).toBeNull();
    expect(projectParticipantCapacityLimit({ capacity: null })).toBeNull();
  });

  test.each([1, Number.MAX_SAFE_INTEGER])(
    'preserves the valid positive safe-integer boundary %s',
    (capacity) => {
      expect(projectParticipantCapacityLimit({ capacity })).toBe(capacity);
    },
  );

  test.each([
    ['undefined', undefined],
    ['zero', 0],
    ['negative zero', -0],
    ['negative integer', -1],
    ['fractional number', 1.5],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['numeric string', '10'],
    ['empty string', ''],
    ['true', true],
    ['false', false],
    ['bigint', BigInt(10)],
    ['symbol', Symbol('capacity')],
    ['boxed number', Object(10)],
    ['array', [10]],
    ['Date', new Date(NOW_MS)],
    ['Map', new Map([['capacity', 10]])],
    ['Set', new Set([10])],
    ['plain record', { limit: 10 }],
  ])('rejects a present %s capacity', (_name, capacity) => {
    expect(projectParticipantCapacityLimit({ capacity })).toBeUndefined();
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['number', 1],
    ['string', 'event'],
    ['array', []],
    ['Date', new Date(NOW_MS)],
    ['null-prototype record', Object.create(null)],
    ['custom-prototype record', Object.create({})],
  ])('rejects a %s event root without throwing', (_name, event) => {
    expect(() => projectParticipantCapacityLimit(event)).not.toThrow();
    expect(projectParticipantCapacityLimit(event)).toBeUndefined();
  });

  test('rejects live and revoked Proxy event roots without invoking traps', () => {
    const trap = jest.fn(() => {
      throw new Error('synthetic event trap must not run');
    });
    const proxiedEvent = new Proxy({ capacity: 10 }, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });

    expect(projectParticipantCapacityLimit(proxiedEvent)).toBeUndefined();
    expect(trap).not.toHaveBeenCalled();

    const revoked = Proxy.revocable({ capacity: 10 }, {});
    revoked.revoke();
    expect(() => projectParticipantCapacityLimit(revoked.proxy)).not.toThrow();
    expect(projectParticipantCapacityLimit(revoked.proxy)).toBeUndefined();
  });

  test('rejects capacity accessors and hidden data without reading them', () => {
    const getter = jest.fn(() => 10);
    const accessorEvent = {};
    Object.defineProperty(accessorEvent, 'capacity', {
      enumerable: true,
      get: getter,
    });
    const hiddenEvent = {};
    Object.defineProperty(hiddenEvent, 'capacity', { value: 10 });

    expect(projectParticipantCapacityLimit(accessorEvent)).toBeUndefined();
    expect(projectParticipantCapacityLimit(hiddenEvent)).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
  });

  test('rejects inherited capacity without invoking a prototype getter', () => {
    const getter = jest.fn(() => 10);
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'capacity',
    );
    let projected;

    try {
      Object.defineProperty(Object.prototype, 'capacity', {
        configurable: true,
        get: getter,
      });
      projected = projectParticipantCapacityLimit({});
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(
          Object.prototype,
          'capacity',
          originalDescriptor,
        );
      } else {
        delete Object.prototype.capacity;
      }
    }

    expect(projected).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
  });

  test('rejects live and revoked Proxy capacity values without invoking traps', () => {
    const trap = jest.fn(() => {
      throw new Error('synthetic capacity trap must not run');
    });
    const proxiedCapacity = new Proxy({}, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });

    expect(projectParticipantCapacityLimit({
      capacity: proxiedCapacity,
    })).toBeUndefined();
    expect(trap).not.toHaveBeenCalled();

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(() => projectParticipantCapacityLimit({
      capacity: revoked.proxy,
    })).not.toThrow();
    expect(projectParticipantCapacityLimit({
      capacity: revoked.proxy,
    })).toBeUndefined();
  });

  test('does not invoke capacity conversion, iteration, or serialization hooks', () => {
    const capacity = {
      valueOf: jest.fn(() => 10),
      toString: jest.fn(() => '10'),
      toJSON: jest.fn(() => 10),
      [Symbol.iterator]: jest.fn(),
      [Symbol.toPrimitive]: jest.fn(() => 10),
    };

    expect(projectParticipantCapacityLimit({ capacity })).toBeUndefined();
    [
      capacity.valueOf,
      capacity.toString,
      capacity.toJSON,
      capacity[Symbol.iterator],
      capacity[Symbol.toPrimitive],
    ].forEach((hook) => {
      expect(hook).not.toHaveBeenCalled();
    });
  });

  test('uses captured validation intrinsics', () => {
    const originalNumberIsSafeInteger = Number.isSafeInteger;
    const originalGetPrototypeOf = Object.getPrototypeOf;
    const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const originalHasOwn = Object.hasOwn;
    const fail = () => {
      throw new Error('synthetic replaced intrinsic must not run');
    };
    let projected;

    try {
      Number.isSafeInteger = fail;
      Object.getPrototypeOf = fail;
      Object.getOwnPropertyDescriptor = fail;
      Object.hasOwn = fail;
      projected = projectParticipantCapacityLimit({ capacity: 10 });
    } finally {
      Number.isSafeInteger = originalNumberIsSafeInteger;
      Object.getPrototypeOf = originalGetPrototypeOf;
      Object.getOwnPropertyDescriptor = originalGetOwnPropertyDescriptor;
      Object.hasOwn = originalHasOwn;
    }

    expect(projected).toBe(10);
  });

  test('does not mutate or traverse unrelated fields', () => {
    const unrelatedGetter = jest.fn(() => 'private synthetic detail');
    const symbolGetter = jest.fn(() => 'private synthetic symbol detail');
    const event = { capacity: 10 };
    event.self = event;
    Object.defineProperty(event, 'unrelated', {
      enumerable: true,
      get: unrelatedGetter,
    });
    Object.defineProperty(event, Symbol('unrelated'), {
      enumerable: true,
      get: symbolGetter,
    });
    const before = Object.getOwnPropertyDescriptors(event);

    const projected = projectParticipantCapacityLimit(event);

    expect(projected).toBe(10);
    expect(Object.getOwnPropertyDescriptors(event)).toEqual(before);
    expect(unrelatedGetter).not.toHaveBeenCalled();
    expect(symbolGetter).not.toHaveBeenCalled();
    event.capacity = 20;
    expect(projected).toBe(10);
  });
});

describe('early-bird cutoff validation', () => {
  function eventWithCutoff(earlyBirdUntil, earlyBirdCents = 2_000) {
    return {
      pricing: {
        earlyBirdCents,
        earlyBirdUntil,
      },
    };
  }

  test.each([
    ['one millisecond before', NOW_MS - 1, true],
    ['at the cutoff', NOW_MS, false],
    ['one millisecond after', NOW_MS + 1, false],
  ])('uses a strict valid Timestamp cutoff %s', (_name, now, expected) => {
    expect(isEarlyBirdActive(
      eventWithCutoff(Timestamp.fromMillis(NOW_MS)),
      now,
    )).toBe(expected);
  });

  test('accepts frozen current-realm records and a frozen Timestamp', () => {
    const cutoff = Object.freeze(Timestamp.fromMillis(NOW_MS + 1));
    const pricing = Object.freeze({
      earlyBirdCents: 2_000,
      earlyBirdUntil: cutoff,
    });
    const event = Object.freeze({ pricing });

    expect(isEarlyBirdActive(event, NOW_MS)).toBe(true);
  });

  test('floors valid Timestamp nanoseconds to the stored millisecond', () => {
    const second = Math.floor(NOW_MS / 1_000);

    expect(isEarlyBirdActive(
      eventWithCutoff(new Timestamp(second, 999_999)),
      NOW_MS,
    )).toBe(false);
    expect(isEarlyBirdActive(
      eventWithCutoff(new Timestamp(second, 1_000_000)),
      NOW_MS,
    )).toBe(true);
  });

  test.each([
    ['ISO string', new Date(NOW_MS + 1_000).toISOString()],
    ['JavaScript Date', new Date(NOW_MS + 1_000)],
  ])('rejects a future %s instead of granting the discount', (_name, cutoff) => {
    expect(isEarlyBirdActive(eventWithCutoff(cutoff), NOW_MS)).toBe(false);
  });

  test('does not invoke a pseudo toMillis method', () => {
    const toMillis = jest.fn(() => NOW_MS + 1_000);
    const active = isEarlyBirdActive(eventWithCutoff({ toMillis }), NOW_MS);

    expect({ active, calls: toMillis.mock.calls.length }).toEqual({
      active: false,
      calls: 0,
    });
  });

  test('returns inactive instead of allowing a pseudo method to throw', () => {
    const toMillis = jest.fn(() => {
      throw new Error('synthetic cutoff method must not run');
    });
    let outcome;

    try {
      outcome = { active: isEarlyBirdActive(eventWithCutoff({ toMillis }), NOW_MS) };
    } catch (error) {
      outcome = { threw: error.message };
    }

    expect(outcome).toEqual({ active: false });
    expect(toMillis).not.toHaveBeenCalled();
  });

  test.each([
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['numeric string', String(NOW_MS)],
    ['JavaScript Date', new Date(NOW_MS)],
    ['null', null],
    ['undefined', undefined],
    ['boolean', true],
    ['bigint', BigInt(NOW_MS)],
  ])('rejects invalid clock input: %s', (_name, now) => {
    expect(isEarlyBirdActive(
      eventWithCutoff(Timestamp.fromMillis(NOW_MS + 1)),
      now,
    )).toBe(false);
  });

  test('rejects coercible clocks and short-circuits before a hostile event', () => {
    const clockHooks = {
      valueOf: jest.fn(() => NOW_MS),
      toString: jest.fn(() => String(NOW_MS)),
      [Symbol.toPrimitive]: jest.fn(() => NOW_MS),
    };
    const eventTrap = jest.fn(() => {
      throw new Error('synthetic event trap must not run');
    });
    const hostileEvent = new Proxy({}, {
      get: eventTrap,
      getOwnPropertyDescriptor: eventTrap,
      getPrototypeOf: eventTrap,
      ownKeys: eventTrap,
    });

    expect(isEarlyBirdActive(eventWithCutoff(
      Timestamp.fromMillis(NOW_MS + 1),
    ), clockHooks)).toBe(false);
    expect(isEarlyBirdActive(hostileEvent, Number.NaN)).toBe(false);
    expect(clockHooks.valueOf).not.toHaveBeenCalled();
    expect(clockHooks.toString).not.toHaveBeenCalled();
    expect(clockHooks[Symbol.toPrimitive]).not.toHaveBeenCalled();
    expect(eventTrap).not.toHaveBeenCalled();
  });

  test('uses captured validation intrinsics and the captured default clock', () => {
    const originalDateNow = Date.now;
    const originalNumberIsFinite = Number.isFinite;
    const originalNumberIsSafeInteger = Number.isSafeInteger;
    const originalMathFloor = Math.floor;
    const originalGetPrototypeOf = Object.getPrototypeOf;
    const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const originalHasOwn = Object.hasOwn;
    const originalOwnKeys = Reflect.ownKeys;
    const fail = () => {
      throw new Error('synthetic replaced intrinsic must not run');
    };
    const event = eventWithCutoff(Timestamp.fromMillis(originalDateNow() + 60_000));
    let active;

    try {
      Date.now = fail;
      Number.isFinite = fail;
      Number.isSafeInteger = fail;
      Math.floor = fail;
      Object.getPrototypeOf = fail;
      Object.getOwnPropertyDescriptor = fail;
      Object.hasOwn = fail;
      Reflect.ownKeys = fail;
      active = isEarlyBirdActive(event);
    } finally {
      Date.now = originalDateNow;
      Number.isFinite = originalNumberIsFinite;
      Number.isSafeInteger = originalNumberIsSafeInteger;
      Math.floor = originalMathFloor;
      Object.getPrototypeOf = originalGetPrototypeOf;
      Object.getOwnPropertyDescriptor = originalGetOwnPropertyDescriptor;
      Object.hasOwn = originalHasOwn;
      Reflect.ownKeys = originalOwnKeys;
    }

    expect(active).toBe(true);
  });

  test.each([
    ['missing', Symbol('missing')],
    ['undefined', undefined],
    ['null', null],
    ['false', false],
    ['zero', 0],
    ['negative zero', -0],
    ['empty string', ''],
    ['NaN', Number.NaN],
    ['zero bigint', BigInt(0)],
  ])('keeps a %s early-bird amount inactive', (_name, amount) => {
    const pricing = { earlyBirdUntil: Timestamp.fromMillis(NOW_MS + 1) };
    if (_name !== 'missing') pricing.earlyBirdCents = amount;

    expect(isEarlyBirdActive({ pricing }, NOW_MS)).toBe(false);
  });

  test('does not broaden the existing truthy amount gate or invoke amount hooks', () => {
    const hooks = {
      valueOf: jest.fn(() => 0),
      toString: jest.fn(() => ''),
      toJSON: jest.fn(() => 0),
      [Symbol.toPrimitive]: jest.fn(() => 0),
    };
    const truthyValues = [-1, true, '2000', BigInt(1), Symbol('amount'), hooks];

    truthyValues.forEach((amount) => {
      expect(isEarlyBirdActive(eventWithCutoff(
        Timestamp.fromMillis(NOW_MS + 1),
        amount,
      ), NOW_MS)).toBe(true);
    });
    expect(hooks.valueOf).not.toHaveBeenCalled();
    expect(hooks.toString).not.toHaveBeenCalled();
    expect(hooks.toJSON).not.toHaveBeenCalled();
    expect(hooks[Symbol.toPrimitive]).not.toHaveBeenCalled();
  });

  test('rejects inherited, accessor-backed, and hidden amount fields', () => {
    const cutoff = Timestamp.fromMillis(NOW_MS + 1);
    const inherited = Object.create({ earlyBirdCents: 2_000 });
    inherited.earlyBirdUntil = cutoff;

    const getter = jest.fn(() => 2_000);
    const accessorBacked = { earlyBirdUntil: cutoff };
    Object.defineProperty(accessorBacked, 'earlyBirdCents', { get: getter });

    const hidden = { earlyBirdUntil: cutoff };
    Object.defineProperty(hidden, 'earlyBirdCents', { value: 2_000 });

    expect(isEarlyBirdActive({ pricing: inherited }, NOW_MS)).toBe(false);
    expect(isEarlyBirdActive({ pricing: accessorBacked }, NOW_MS)).toBe(false);
    expect(isEarlyBirdActive({ pricing: hidden }, NOW_MS)).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });

  test.each([
    ['null event', null],
    ['undefined event', undefined],
    ['numeric event', 1],
    ['array event', []],
    ['Date event', new Date(NOW_MS)],
    ['null-prototype event', Object.create(null)],
    ['custom-prototype event', Object.create({})],
    ['null pricing', { pricing: null }],
    ['array pricing', { pricing: [] }],
    ['null-prototype pricing', { pricing: Object.create(null) }],
    ['custom-prototype pricing', { pricing: Object.create({}) }],
  ])('rejects an invalid container: %s', (_name, event) => {
    expect(() => isEarlyBirdActive(event, NOW_MS)).not.toThrow();
    expect(isEarlyBirdActive(event, NOW_MS)).toBe(false);
  });

  test('rejects Proxy event and pricing records without invoking traps', () => {
    const trap = jest.fn(() => {
      throw new Error('synthetic container trap must not run');
    });
    const proxyHandler = {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    };
    const proxiedEvent = new Proxy(eventWithCutoff(
      Timestamp.fromMillis(NOW_MS + 1),
    ), proxyHandler);
    const proxiedPricing = new Proxy({
      earlyBirdCents: 2_000,
      earlyBirdUntil: Timestamp.fromMillis(NOW_MS + 1),
    }, proxyHandler);

    expect(isEarlyBirdActive(proxiedEvent, NOW_MS)).toBe(false);
    expect(isEarlyBirdActive({ pricing: proxiedPricing }, NOW_MS)).toBe(false);
    expect(trap).not.toHaveBeenCalled();

    const revokedEvent = Proxy.revocable({}, {});
    const revokedPricing = Proxy.revocable({}, {});
    revokedEvent.revoke();
    revokedPricing.revoke();
    expect(isEarlyBirdActive(revokedEvent.proxy, NOW_MS)).toBe(false);
    expect(isEarlyBirdActive({ pricing: revokedPricing.proxy }, NOW_MS)).toBe(false);
  });

  test('rejects inherited, accessor-backed, and hidden pricing fields', () => {
    const pricing = {
      earlyBirdCents: 2_000,
      earlyBirdUntil: Timestamp.fromMillis(NOW_MS + 1),
    };
    const inherited = Object.create({ pricing });

    const getter = jest.fn(() => pricing);
    const accessorBacked = {};
    Object.defineProperty(accessorBacked, 'pricing', { get: getter });

    const hidden = {};
    Object.defineProperty(hidden, 'pricing', { value: pricing });

    expect(isEarlyBirdActive(inherited, NOW_MS)).toBe(false);
    expect(isEarlyBirdActive(accessorBacked, NOW_MS)).toBe(false);
    expect(isEarlyBirdActive(hidden, NOW_MS)).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });

  test.each([
    ['missing', Symbol('missing')],
    ['undefined', undefined],
    ['null', null],
    ['false', false],
    ['zero', 0],
    ['true', true],
    ['number', NOW_MS + 1],
    ['ISO string', new Date(NOW_MS + 1).toISOString()],
    ['JavaScript Date', new Date(NOW_MS + 1)],
    ['array', []],
    ['plain record', {}],
    ['Map', new Map()],
    ['Set', new Set()],
  ])('rejects a %s cutoff representation', (_name, cutoff) => {
    const pricing = { earlyBirdCents: 2_000 };
    if (_name !== 'missing') pricing.earlyBirdUntil = cutoff;

    expect(isEarlyBirdActive({ pricing }, NOW_MS)).toBe(false);
  });

  test('does not invoke cutoff accessors or conversion hooks', () => {
    const cutoffGetter = jest.fn(() => Timestamp.fromMillis(NOW_MS + 1));
    const pricing = { earlyBirdCents: 2_000 };
    Object.defineProperty(pricing, 'earlyBirdUntil', { get: cutoffGetter });

    const hooks = {
      toMillis: jest.fn(() => NOW_MS + 1),
      toJSON: jest.fn(() => new Date(NOW_MS + 1).toISOString()),
      valueOf: jest.fn(() => NOW_MS + 1),
      toString: jest.fn(() => String(NOW_MS + 1)),
      [Symbol.iterator]: jest.fn(),
      [Symbol.toPrimitive]: jest.fn(() => NOW_MS + 1),
    };

    expect(isEarlyBirdActive({ pricing }, NOW_MS)).toBe(false);
    expect(isEarlyBirdActive(eventWithCutoff(hooks), NOW_MS)).toBe(false);
    expect(cutoffGetter).not.toHaveBeenCalled();
    Object.values(hooks).forEach((hook) => expect(hook).not.toHaveBeenCalled());
  });

  test('rejects inherited and hidden cutoff fields', () => {
    const inherited = Object.create({
      earlyBirdUntil: Timestamp.fromMillis(NOW_MS + 1),
    });
    inherited.earlyBirdCents = 2_000;
    const hidden = { earlyBirdCents: 2_000 };
    Object.defineProperty(hidden, 'earlyBirdUntil', {
      value: Timestamp.fromMillis(NOW_MS + 1),
    });

    expect(isEarlyBirdActive({ pricing: inherited }, NOW_MS)).toBe(false);
    expect(isEarlyBirdActive({ pricing: hidden }, NOW_MS)).toBe(false);
  });

  test('rejects Proxy and modified Timestamp representations without side effects', () => {
    const trap = jest.fn(() => {
      throw new Error('synthetic Timestamp trap must not run');
    });
    const proxied = new Proxy(Timestamp.fromMillis(NOW_MS + 1), {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    expect(isEarlyBirdActive(eventWithCutoff(proxied), NOW_MS)).toBe(false);
    expect(trap).not.toHaveBeenCalled();

    const revoked = Proxy.revocable(Timestamp.fromMillis(NOW_MS + 1), {});
    revoked.revoke();
    expect(isEarlyBirdActive(eventWithCutoff(revoked.proxy), NOW_MS)).toBe(false);

    const modified = Timestamp.fromMillis(NOW_MS + 1);
    const ownMethod = jest.fn(() => NOW_MS + 1);
    Object.defineProperty(modified, 'toMillis', { value: ownMethod });
    expect(isEarlyBirdActive(eventWithCutoff(modified), NOW_MS)).toBe(false);
    expect(ownMethod).not.toHaveBeenCalled();

    class TimestampSubclass extends Timestamp {}
    expect(isEarlyBirdActive(eventWithCutoff(new TimestampSubclass(
      Math.floor(NOW_MS / 1_000),
      1_000_000,
    )), NOW_MS)).toBe(false);

    const extraKey = Timestamp.fromMillis(NOW_MS + 1);
    Object.defineProperty(extraKey, Symbol('synthetic-extra'), { value: true });
    expect(isEarlyBirdActive(eventWithCutoff(extraKey), NOW_MS)).toBe(false);
  });

  test('rejects accessor-backed and hidden Timestamp internals without reading them', () => {
    const internalGetter = jest.fn(() => Math.floor(NOW_MS / 1_000));
    const accessorBacked = Object.create(Timestamp.prototype);
    Object.defineProperties(accessorBacked, {
      _seconds: { get: internalGetter, enumerable: true },
      _nanoseconds: { value: 0, enumerable: true },
    });
    const hidden = Object.create(Timestamp.prototype);
    Object.defineProperties(hidden, {
      _seconds: { value: Math.floor(NOW_MS / 1_000) },
      _nanoseconds: { value: 1_000_000 },
    });

    expect(isEarlyBirdActive(eventWithCutoff(accessorBacked), NOW_MS)).toBe(false);
    expect(isEarlyBirdActive(eventWithCutoff(hidden), NOW_MS)).toBe(false);
    expect(internalGetter).not.toHaveBeenCalled();
  });

  test.each([
    ['seconds below range', -62_135_596_801, 0],
    ['seconds above range', 253_402_300_800, 0],
    ['fractional seconds', Math.floor(NOW_MS / 1_000) + 0.5, 0],
    ['non-finite seconds', Number.POSITIVE_INFINITY, 0],
    ['negative nanoseconds', Math.floor(NOW_MS / 1_000), -1],
    ['nanoseconds above range', Math.floor(NOW_MS / 1_000), 1_000_000_000],
    ['fractional nanoseconds', Math.floor(NOW_MS / 1_000), 0.5],
    ['non-finite nanoseconds', Math.floor(NOW_MS / 1_000), Number.NaN],
  ])('rejects Timestamp-shaped %s', (_name, seconds, nanoseconds) => {
    const malformed = Object.create(Timestamp.prototype);
    Object.defineProperties(malformed, {
      _seconds: { value: seconds, enumerable: true },
      _nanoseconds: { value: nanoseconds, enumerable: true },
    });

    expect(isEarlyBirdActive(eventWithCutoff(malformed), NOW_MS)).toBe(false);
  });

  test('does not mutate or traverse unrelated event and pricing fields', () => {
    const unrelatedGetter = jest.fn(() => 'private synthetic detail');
    const symbolGetter = jest.fn(() => 'private synthetic symbol detail');
    const pricing = {
      earlyBirdCents: 2_000,
      earlyBirdUntil: Timestamp.fromMillis(NOW_MS + 1),
    };
    const event = { pricing };
    pricing.self = pricing;
    event.self = event;
    Object.defineProperty(event, 'unrelated', { get: unrelatedGetter, enumerable: true });
    Object.defineProperty(pricing, Symbol('unrelated'), {
      get: symbolGetter,
      enumerable: true,
    });
    const beforeEvent = Object.getOwnPropertyDescriptors(event);
    const beforePricing = Object.getOwnPropertyDescriptors(pricing);

    const active = isEarlyBirdActive(event, NOW_MS);

    expect(active).toBe(true);
    expect(Object.getOwnPropertyDescriptors(event)).toEqual(beforeEvent);
    expect(Object.getOwnPropertyDescriptors(pricing)).toEqual(beforePricing);
    expect(unrelatedGetter).not.toHaveBeenCalled();
    expect(symbolGetter).not.toHaveBeenCalled();
    pricing.earlyBirdCents = 0;
    expect(active).toBe(true);
  });
});

describe('registration-window validation', () => {
  test('keeps missing and null bounds unbounded', () => {
    expect(isRegistrationOpen(openEvent(), NOW_MS)).toBe(true);
    expect(isRegistrationOpen(openEvent({
      registrationOpensAt: null,
      registrationClosesAt: null,
    }), NOW_MS)).toBe(true);
  });

  test.each([
    ['before the opening instant', NOW_MS - 1, false],
    ['at the opening instant', NOW_MS, true],
    ['inside the window', NOW_MS + 500, true],
    ['at the closing instant', NOW_MS + 1_000, true],
    ['after the closing instant', NOW_MS + 1_001, false],
  ])('uses inclusive valid Timestamp bounds %s', (_name, now, expected) => {
    const event = openEvent({
      registrationOpensAt: Timestamp.fromMillis(NOW_MS),
      registrationClosesAt: Timestamp.fromMillis(NOW_MS + 1_000),
    });

    expect(isRegistrationOpen(event, now)).toBe(expected);
  });

  test('accepts either valid bound alone and frozen genuine Timestamps', () => {
    const opensAtNow = Object.freeze(Timestamp.fromMillis(NOW_MS));
    const closesAtNow = Object.freeze(Timestamp.fromMillis(NOW_MS));

    expect(isRegistrationOpen(openEvent({
      registrationOpensAt: opensAtNow,
    }), NOW_MS)).toBe(true);
    expect(isRegistrationOpen(openEvent({
      registrationClosesAt: closesAtNow,
    }), NOW_MS)).toBe(true);
  });

  test.each([
    ['missing', undefined],
    ['draft', 'draft'],
    ['closed', 'closed'],
    ['cancelled', 'cancelled'],
    ['uppercase', 'OPEN'],
    ['boolean', true],
  ])('rejects a %s status', (_name, status) => {
    const event = status === undefined ? {} : { status };
    expect(isRegistrationOpen(event, NOW_MS)).toBe(false);
  });

  test.each([
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['numeric string', String(NOW_MS)],
    ['Date', new Date(NOW_MS)],
    ['null', null],
  ])('rejects non-finite-number now: %s', (_name, now) => {
    expect(isRegistrationOpen(openEvent(), now)).toBe(false);
  });

  test('rejects coercible now values without invoking coercion', () => {
    const valueOf = jest.fn(() => NOW_MS);
    const now = { valueOf };
    expect(isRegistrationOpen(openEvent({
      registrationOpensAt: Timestamp.fromMillis(NOW_MS),
    }), now)).toBe(false);
    expect(valueOf).not.toHaveBeenCalled();
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['number', 1],
    ['string', 'event'],
    ['array', []],
  ])('rejects a %s event root without throwing', (_name, event) => {
    expect(() => isRegistrationOpen(event, NOW_MS)).not.toThrow();
    expect(isRegistrationOpen(event, NOW_MS)).toBe(false);
  });

  test('rejects custom and inherited event records', () => {
    class EventRecord {
      constructor() {
        this.status = 'open';
      }
    }
    expect(isRegistrationOpen(new EventRecord(), NOW_MS)).toBe(false);

    const inheritedStatus = Object.create({ status: 'open' });
    expect(isRegistrationOpen(inheritedStatus, NOW_MS)).toBe(false);

    const inheritedBound = Object.create({
      registrationOpensAt: Timestamp.fromMillis(NOW_MS - 1),
    });
    inheritedBound.status = 'open';
    expect(isRegistrationOpen(inheritedBound, NOW_MS)).toBe(false);
  });

  const malformedBounds = [
    ['false', false],
    ['zero', 0],
    ['empty string', ''],
    ['true', true],
    ['number', NOW_MS],
    ['ISO string', new Date(NOW_MS).toISOString()],
    ['Date', new Date(NOW_MS)],
    ['array', []],
    ['plain map', {}],
    ['Map', new Map()],
    ['undefined', undefined],
    ['pseudo toMillis value', { toMillis: NOW_MS }],
  ];

  test.each(['registrationOpensAt', 'registrationClosesAt'])(
    'rejects malformed %s values without throwing',
    (field) => {
      malformedBounds.forEach(([_name, value]) => {
        expect(() => isRegistrationOpen(openEvent({ [field]: value }), NOW_MS))
          .not.toThrow();
        expect(isRegistrationOpen(openEvent({ [field]: value }), NOW_MS))
          .toBe(false);
      });
    },
  );

  test.each(['registrationOpensAt', 'registrationClosesAt'])(
    'does not invoke pseudo methods or own accessors for %s',
    (field) => {
      const pseudoMethod = jest.fn(() => NOW_MS);
      expect(isRegistrationOpen(openEvent({
        [field]: { toMillis: pseudoMethod },
      }), NOW_MS)).toBe(false);
      expect(pseudoMethod).not.toHaveBeenCalled();

      const throwingMethod = jest.fn(() => {
        throw new Error('synthetic timestamp method must not run');
      });
      expect(() => isRegistrationOpen(openEvent({
        [field]: { toMillis: throwingMethod },
      }), NOW_MS)).not.toThrow();
      expect(throwingMethod).not.toHaveBeenCalled();

      const boundGetter = jest.fn(() => Timestamp.fromMillis(NOW_MS));
      const eventWithAccessor = openEvent();
      Object.defineProperty(eventWithAccessor, field, { get: boundGetter });
      expect(isRegistrationOpen(eventWithAccessor, NOW_MS)).toBe(false);
      expect(boundGetter).not.toHaveBeenCalled();

      const toMillisGetter = jest.fn(() => () => NOW_MS);
      const timestampLike = {};
      Object.defineProperty(timestampLike, 'toMillis', { get: toMillisGetter });
      expect(isRegistrationOpen(openEvent({ [field]: timestampLike }), NOW_MS))
        .toBe(false);
      expect(toMillisGetter).not.toHaveBeenCalled();
    },
  );

  test.each(['registrationOpensAt', 'registrationClosesAt'])(
    'rejects Proxy %s values without invoking traps',
    (field) => {
      const proxyTrap = jest.fn(() => {
        throw new Error('synthetic Proxy trap must not run');
      });
      const proxiedBound = new Proxy(Timestamp.fromMillis(NOW_MS), {
        get: proxyTrap,
        getOwnPropertyDescriptor: proxyTrap,
        getPrototypeOf: proxyTrap,
        ownKeys: proxyTrap,
      });

      expect(() => isRegistrationOpen(openEvent({ [field]: proxiedBound }), NOW_MS))
        .not.toThrow();
      expect(isRegistrationOpen(openEvent({ [field]: proxiedBound }), NOW_MS))
        .toBe(false);
      expect(proxyTrap).not.toHaveBeenCalled();

      const revoked = Proxy.revocable(Timestamp.fromMillis(NOW_MS), {});
      revoked.revoke();
      expect(() => isRegistrationOpen(openEvent({
        [field]: revoked.proxy,
      }), NOW_MS)).not.toThrow();
      expect(isRegistrationOpen(openEvent({
        [field]: revoked.proxy,
      }), NOW_MS)).toBe(false);
    },
  );

  test('rejects Proxy and accessor-backed event roots without invoking them', () => {
    const rootProxyTrap = jest.fn(() => {
      throw new Error('synthetic root Proxy trap must not run');
    });
    const proxiedEvent = new Proxy(openEvent(), {
      get: rootProxyTrap,
      getOwnPropertyDescriptor: rootProxyTrap,
      getPrototypeOf: rootProxyTrap,
      ownKeys: rootProxyTrap,
    });
    expect(() => isRegistrationOpen(proxiedEvent, NOW_MS)).not.toThrow();
    expect(isRegistrationOpen(proxiedEvent, NOW_MS)).toBe(false);
    expect(rootProxyTrap).not.toHaveBeenCalled();

    const statusGetter = jest.fn(() => 'open');
    const accessorEvent = {};
    Object.defineProperty(accessorEvent, 'status', { get: statusGetter });
    expect(isRegistrationOpen(accessorEvent, NOW_MS)).toBe(false);
    expect(statusGetter).not.toHaveBeenCalled();
  });

  test('rejects modified and malformed Timestamp-shaped values', () => {
    const modified = Timestamp.fromMillis(NOW_MS);
    const ownMethod = jest.fn(() => NOW_MS);
    Object.defineProperty(modified, 'toMillis', { value: ownMethod });
    expect(isRegistrationOpen(openEvent({
      registrationOpensAt: modified,
    }), NOW_MS)).toBe(false);
    expect(ownMethod).not.toHaveBeenCalled();

    const malformed = Object.create(Timestamp.prototype);
    Object.defineProperties(malformed, {
      _seconds: { value: Number.POSITIVE_INFINITY, enumerable: true },
      _nanoseconds: { value: 0, enumerable: true },
    });
    expect(isRegistrationOpen(openEvent({
      registrationClosesAt: malformed,
    }), NOW_MS)).toBe(false);

    const internalGetter = jest.fn(() => Math.floor(NOW_MS / 1_000));
    const accessorInternals = Object.create(Timestamp.prototype);
    Object.defineProperties(accessorInternals, {
      _seconds: { get: internalGetter, enumerable: true },
      _nanoseconds: { value: 0, enumerable: true },
    });
    expect(isRegistrationOpen(openEvent({
      registrationClosesAt: accessorInternals,
    }), NOW_MS)).toBe(false);
    expect(internalGetter).not.toHaveBeenCalled();

    const nonEnumerableInternals = Object.create(Timestamp.prototype);
    Object.defineProperties(nonEnumerableInternals, {
      _seconds: { value: Math.floor(NOW_MS / 1_000) },
      _nanoseconds: { value: 0 },
    });
    expect(isRegistrationOpen(openEvent({
      registrationClosesAt: nonEnumerableInternals,
    }), NOW_MS)).toBe(false);

    class TimestampSubclass extends Timestamp {}
    expect(isRegistrationOpen(openEvent({
      registrationClosesAt: new TimestampSubclass(
        Math.floor(NOW_MS / 1_000),
        0,
      ),
    }), NOW_MS)).toBe(false);

    const extraOwnKey = Timestamp.fromMillis(NOW_MS);
    Object.defineProperty(extraOwnKey, Symbol('synthetic-extra'), { value: true });
    expect(isRegistrationOpen(openEvent({
      registrationClosesAt: extraOwnKey,
    }), NOW_MS)).toBe(false);
  });

  test.each([
    ['seconds below the SDK range', -62_135_596_801, 0],
    ['seconds above the SDK range', 253_402_300_800, 0],
    ['fractional seconds', Math.floor(NOW_MS / 1_000) + 0.5, 0],
    ['negative nanoseconds', Math.floor(NOW_MS / 1_000), -1],
    ['nanoseconds above the SDK range', Math.floor(NOW_MS / 1_000), 1_000_000_000],
    ['fractional nanoseconds', Math.floor(NOW_MS / 1_000), 0.5],
  ])('rejects Timestamp-shaped %s', (_name, seconds, nanoseconds) => {
    const malformed = Object.create(Timestamp.prototype);
    Object.defineProperties(malformed, {
      _seconds: { value: seconds, enumerable: true },
      _nanoseconds: { value: nanoseconds, enumerable: true },
    });
    expect(isRegistrationOpen(openEvent({
      registrationClosesAt: malformed,
    }), NOW_MS)).toBe(false);
  });
});

describe('selected race-price validation', () => {
  function eventWithPricing(pricing) {
    return { pricing };
  }

  test('preserves fixed free zero and rejects unknown tiers without reading event data', () => {
    const eventRead = jest.fn(() => {
      throw new Error('synthetic event read must not run');
    });
    const event = new Proxy({}, { get: eventRead });
    const tierHooks = {
      toString: jest.fn(() => 'member'),
      valueOf: jest.fn(() => 'member'),
      [Symbol.toPrimitive]: jest.fn(() => 'member'),
    };

    expect(pickPriceCents(event, 'free')).toBe(0);
    expect(pickPriceCents(event, 'unknown')).toBeNull();
    expect(pickPriceCents(event, tierHooks)).toBeNull();
    expect(eventRead).not.toHaveBeenCalled();
    expect(tierHooks.toString).not.toHaveBeenCalled();
    expect(tierHooks.valueOf).not.toHaveBeenCalled();
    expect(tierHooks[Symbol.toPrimitive]).not.toHaveBeenCalled();
  });

  test.each([
    ['member', 'memberCents'],
    ['nonMember', 'nonMemberCents'],
    ['earlyBird', 'earlyBirdCents'],
  ])('preserves exact valid %s cent boundaries', (tier, field) => {
    [0, 50, 99_999_999].forEach((value) => {
      expect(pickPriceCents(eventWithPricing({ [field]: value }), tier)).toBe(value);
    });
  });

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['negative zero', -0],
    ['negative integer', -1],
    ['one cent, below the Stripe USD minimum', 1],
    ['forty-nine cents, below the Stripe USD minimum', 49],
    ['fractional cents', 1.5],
    ['not-a-number', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['the shared generic ceiling, above the Stripe eight-digit limit', MAX_CENTS],
    ['over the shared generic ceiling', MAX_CENTS + 1],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['string', '5000'],
    ['boolean', true],
    ['bigint', BigInt(5000)],
    ['boxed number', Object(5000)],
    ['array', [5000]],
    ['record', { cents: 5000 }],
  ])('rejects selected %s', (_case, value) => {
    expect(pickPriceCents(eventWithPricing({ nonMemberCents: value }), 'nonMember'))
      .toBeNull();
  });

  test('rejects a missing selected price and missing pricing record', () => {
    expect(pickPriceCents({}, 'nonMember')).toBeNull();
    expect(pickPriceCents(eventWithPricing({}), 'nonMember')).toBeNull();
  });

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['array', []],
    ['Date', new Date(0)],
    ['null-prototype record', Object.create(null)],
    ['custom-prototype record', Object.create({ inherited: true })],
  ])('rejects %s event containers without throwing', (_case, event) => {
    expect(() => pickPriceCents(event, 'nonMember')).not.toThrow();
    expect(pickPriceCents(event, 'nonMember')).toBeNull();
  });

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['array', []],
    ['Date', new Date(0)],
    ['null-prototype record', Object.create(null)],
    ['custom-prototype record', Object.create({ inherited: true })],
  ])('rejects %s pricing containers without throwing', (_case, pricing) => {
    expect(() => pickPriceCents(eventWithPricing(pricing), 'nonMember')).not.toThrow();
    expect(pickPriceCents(eventWithPricing(pricing), 'nonMember')).toBeNull();
  });

  test.each([
    ['event', (value) => value],
    ['pricing', (value) => eventWithPricing(value)],
  ])('rejects a live Proxy %s without invoking traps', (_case, wrap) => {
    const trap = jest.fn(() => {
      throw new Error('synthetic Proxy trap must not run');
    });
    const value = new Proxy({}, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      has: trap,
      ownKeys: trap,
    });

    expect(pickPriceCents(wrap(value), 'nonMember')).toBeNull();
    expect(trap).not.toHaveBeenCalled();
  });

  test.each([
    ['event', (value) => value],
    ['pricing', (value) => eventWithPricing(value)],
  ])('rejects a revoked Proxy %s without throwing', (_case, wrap) => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(() => pickPriceCents(wrap(proxy), 'nonMember')).not.toThrow();
    expect(pickPriceCents(wrap(proxy), 'nonMember')).toBeNull();
  });

  test('rejects selected accessors without invoking them', () => {
    const pricingGetter = jest.fn(() => ({ nonMemberCents: 5000 }));
    const event = {};
    Object.defineProperty(event, 'pricing', {
      enumerable: true,
      get: pricingGetter,
    });

    const priceGetter = jest.fn(() => 5000);
    const pricing = {};
    Object.defineProperty(pricing, 'nonMemberCents', {
      enumerable: true,
      get: priceGetter,
    });

    expect(pickPriceCents(event, 'nonMember')).toBeNull();
    expect(pickPriceCents(eventWithPricing(pricing), 'nonMember')).toBeNull();
    expect(pricingGetter).not.toHaveBeenCalled();
    expect(priceGetter).not.toHaveBeenCalled();
  });

  test('rejects inherited selected values without invoking prototype getters', () => {
    const pricingGetter = jest.fn(() => ({ nonMemberCents: 5000 }));
    const eventPrototype = {};
    Object.defineProperty(eventPrototype, 'pricing', { get: pricingGetter });

    const priceGetter = jest.fn(() => 5000);
    const pricingPrototype = {};
    Object.defineProperty(pricingPrototype, 'nonMemberCents', { get: priceGetter });

    expect(pickPriceCents(Object.create(eventPrototype), 'nonMember')).toBeNull();
    expect(pickPriceCents(eventWithPricing(Object.create(pricingPrototype)), 'nonMember'))
      .toBeNull();
    expect(pricingGetter).not.toHaveBeenCalled();
    expect(priceGetter).not.toHaveBeenCalled();
  });

  test('rejects non-enumerable selected data', () => {
    const hiddenPricingEvent = {};
    Object.defineProperty(hiddenPricingEvent, 'pricing', {
      value: { nonMemberCents: 5000 },
    });
    const hiddenPrice = {};
    Object.defineProperty(hiddenPrice, 'nonMemberCents', { value: 5000 });

    expect(pickPriceCents(hiddenPricingEvent, 'nonMember')).toBeNull();
    expect(pickPriceCents(eventWithPricing(hiddenPrice), 'nonMember')).toBeNull();
  });

  test('does not invoke selected-value coercion or JSON hooks', () => {
    const hooks = {
      toJSON: jest.fn(() => 5000),
      toString: jest.fn(() => '5000'),
      valueOf: jest.fn(() => 5000),
      [Symbol.toPrimitive]: jest.fn(() => 5000),
    };

    expect(pickPriceCents(eventWithPricing({ nonMemberCents: hooks }), 'nonMember'))
      .toBeNull();
    expect(hooks.toJSON).not.toHaveBeenCalled();
    expect(hooks.toString).not.toHaveBeenCalled();
    expect(hooks.valueOf).not.toHaveBeenCalled();
    expect(hooks[Symbol.toPrimitive]).not.toHaveBeenCalled();
  });

  test('ignores hostile unselected and unknown fields without enumeration', () => {
    const eventGetter = jest.fn(() => {
      throw new Error('synthetic event getter must not run');
    });
    const unselectedGetter = jest.fn(() => {
      throw new Error('synthetic unselected getter must not run');
    });
    const unknownGetter = jest.fn(() => {
      throw new Error('synthetic unknown getter must not run');
    });
    const symbolGetter = jest.fn(() => {
      throw new Error('synthetic symbol getter must not run');
    });
    const pricing = { nonMemberCents: 5000 };
    pricing.self = pricing;
    Object.defineProperty(pricing, 'memberCents', { get: unselectedGetter });
    Object.defineProperty(pricing, 'unknown', { get: unknownGetter });
    Object.defineProperty(pricing, Symbol('unknown'), { get: symbolGetter });
    const event = eventWithPricing(pricing);
    Object.defineProperty(event, 'unknown', { get: eventGetter });

    expect(pickPriceCents(event, 'nonMember')).toBe(5000);
    expect(eventGetter).not.toHaveBeenCalled();
    expect(unselectedGetter).not.toHaveBeenCalled();
    expect(unknownGetter).not.toHaveBeenCalled();
    expect(symbolGetter).not.toHaveBeenCalled();
  });
});

describe('shared Functions role guards', () => {
  test('preserves the unauthenticated error', async () => {
    await expect(requireAdmin({ auth: null })).rejects.toMatchObject({
      code: 'unauthenticated',
      message: 'Sign-in required',
    });
  });

  test('accepts only an exact verified admin', async () => {
    await expect(requireAdmin({
      auth: {
        uid: 'synthetic-admin',
        token: { email_verified: true, role: 'admin' },
      },
    })).resolves.toBeUndefined();
  });

  test.each([
    ['missing verification', { role: 'admin' }],
    ['false verification', { email_verified: false, role: 'admin' }],
    ['string verification', { email_verified: 'true', role: 'admin' }],
    ['profile mirror', { emailVerified: true, role: 'admin' }],
    ['verified member', { email_verified: true, role: 'member' }],
    ['unknown role', { email_verified: true, role: 'officer' }],
  ])('uses the same generic denial for %s', async (_name, token) => {
    await expect(requireAdmin({
      auth: { uid: 'synthetic-user', token },
    })).rejects.toMatchObject({
      code: 'permission-denied',
      message: 'Admin role required',
    });
  });

  test('does not invoke accessor-backed claims', async () => {
    const emailGetter = jest.fn(() => true);
    const roleGetter = jest.fn(() => 'admin');
    const verificationAccessor = { role: 'admin' };
    Object.defineProperty(verificationAccessor, 'email_verified', {
      get: emailGetter,
    });
    const roleAccessor = { email_verified: true };
    Object.defineProperty(roleAccessor, 'role', {
      get: roleGetter,
    });

    await expect(requireAdmin({
      auth: { uid: 'synthetic-user', token: verificationAccessor },
    })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(requireAdmin({
      auth: { uid: 'synthetic-user', token: roleAccessor },
    })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(emailGetter).not.toHaveBeenCalled();
    expect(roleGetter).not.toHaveBeenCalled();
  });

  test.each([
    ['verified member', { email_verified: true, role: 'member' }, 'member'],
    ['verified admin', { email_verified: true, role: 'admin' }, 'admin'],
    ['unverified member', { email_verified: false, role: 'member' }, null],
    ['missing verification', { role: 'member' }, null],
    ['malformed verification', { email_verified: 1, role: 'member' }, null],
    ['unknown role', { email_verified: true, role: 'officer' }, null],
  ])('resolves %s without inventing authority', async (_name, token, expected) => {
    await expect(resolveCallerRole({
      auth: { uid: 'synthetic-user', token },
    })).resolves.toBe(expected);
  });

  test('returns null for an unauthenticated role lookup', async () => {
    await expect(resolveCallerRole({ auth: null })).resolves.toBeNull();
  });
});
