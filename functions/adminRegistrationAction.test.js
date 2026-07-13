const mockFirestoreAccess = jest.fn();
const mockStripeConstructor = jest.fn();

jest.mock('stripe', () => mockStripeConstructor);

jest.mock('firebase-admin', () => {
  const firestore = {};
  firestore.FieldValue = { arrayUnion: (x) => x };
  const firestoreFunction = () => {
    mockFirestoreAccess();
    return firestore;
  };
  firestoreFunction.FieldValue = firestore.FieldValue;
  return {
    initializeApp: jest.fn(),
    apps: [{}],
    firestore: firestoreFunction,
  };
});

jest.mock('firebase-functions', () => {
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  const chain = {
    https: {
      onRequest: (fn) => fn,
      onCall: (fn) => fn,
      HttpsError,
    },
  };
  return {
    runWith: () => chain,
    https: chain.https,
    config: () => ({}),
  };
});

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: { now: () => ({ _seconds: 0 }) },
  FieldValue: { arrayUnion: (x) => x },
}));

describe('adminRegistrationAction authorization', () => {
  beforeEach(() => {
    process.env.ENVIRONMENT_NAME = 'test';
    process.env.SITE_ORIGIN = 'https://runmprc.test';
    process.env.STRIPE_LIVEMODE_EXPECTED = 'false';
    process.env.COMMERCE_ENABLED = 'true';
    process.env.STRIPE_SECRET_KEY = [
      'sk', 'test', 'synthetic_admin_registration',
    ].join('_');
    mockFirestoreAccess.mockClear();
    mockStripeConstructor.mockClear();
    jest.resetModules();
  });

  afterAll(() => {
    delete process.env.ENVIRONMENT_NAME;
    delete process.env.SITE_ORIGIN;
    delete process.env.STRIPE_LIVEMODE_EXPECTED;
    delete process.env.COMMERCE_ENABLED;
    delete process.env.STRIPE_SECRET_KEY;
  });

  test('rejects invalid configuration before admin registration side effects', async () => {
    delete process.env.SITE_ORIGIN;
    const { adminRegistrationAction } = require('./adminRegistrationAction');

    await expect(adminRegistrationAction({
      eventId: 'e1',
      action: 'add_late_registration',
      payload: {
        registration: {
          runner: { email: 'runner@example.test' },
          amountCents: 1000,
        },
      },
    }, {
      auth: { uid: 'admin-1', token: { role: 'admin' } },
    })).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'Server configuration is unavailable',
    });

    expect(mockFirestoreAccess).not.toHaveBeenCalled();
    expect(mockStripeConstructor).not.toHaveBeenCalled();
  });

  test('rejects unauthenticated caller', async () => {
    delete process.env.ENVIRONMENT_NAME;
    const { adminRegistrationAction } = require('./adminRegistrationAction');
    await expect(
      adminRegistrationAction(
        { eventId: 'e1', action: 'cancel', registrationId: 'r1' },
        { auth: null },
      ),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  test('rejects non-admin caller', async () => {
    delete process.env.ENVIRONMENT_NAME;
    const { adminRegistrationAction } = require('./adminRegistrationAction');
    await expect(
      adminRegistrationAction(
        { eventId: 'e1', action: 'cancel', registrationId: 'r1' },
        { auth: { uid: 'u1', token: { role: 'member' } } },
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  test('rejects unknown action', async () => {
    const { adminRegistrationAction } = require('./adminRegistrationAction');
    await expect(
      adminRegistrationAction(
        { eventId: 'e1', action: 'nuke_database', registrationId: 'r1' },
        { auth: { uid: 'u1', token: { role: 'admin' } } },
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  test('rejects missing eventId', async () => {
    const { adminRegistrationAction } = require('./adminRegistrationAction');
    await expect(
      adminRegistrationAction(
        { action: 'cancel', registrationId: 'r1' },
        { auth: { uid: 'u1', token: { role: 'admin' } } },
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});
