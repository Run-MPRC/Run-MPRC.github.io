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

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: { now: jest.fn() },
  FieldValue: {},
}));

jest.mock('./serverConfig', () => ({
  loadCallableServerConfig: (...args) => mockLoadCallableServerConfig(...args),
}));

const {
  requireAdmin,
  resolveCallerRole,
} = require('./stripeHelpers');

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
