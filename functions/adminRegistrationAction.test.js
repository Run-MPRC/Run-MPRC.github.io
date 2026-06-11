jest.mock('firebase-admin', () => {
  const firestore = {};
  firestore.FieldValue = { arrayUnion: (x) => x };
  return {
    initializeApp: jest.fn(),
    apps: [{}],
    firestore: Object.assign(() => firestore, { FieldValue: firestore.FieldValue }),
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
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    jest.resetModules();
  });

  test('rejects unauthenticated caller', async () => {
    const { adminRegistrationAction } = require('./adminRegistrationAction');
    await expect(
      adminRegistrationAction(
        { eventId: 'e1', action: 'cancel', registrationId: 'r1' },
        { auth: null },
      ),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  test('rejects non-admin caller', async () => {
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
