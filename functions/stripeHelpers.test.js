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
  isRegistrationOpen,
  requireAdmin,
  resolveCallerRole,
  Timestamp,
} = require('./stripeHelpers');

const NOW_MS = 1_735_689_600_000;

function openEvent(overrides = {}) {
  return { status: 'open', ...overrides };
}

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
