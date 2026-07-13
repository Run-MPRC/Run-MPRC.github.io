jest.mock('firebase-admin', () => {
  const documents = new Map();
  let transactionTail = Promise.resolve();

  const doc = (uid) => {
    const ref = {
      path: `members/${uid}`,
      get: jest.fn(async () => ({
        exists: documents.has(ref.path),
        data: () => documents.get(ref.path),
      })),
    };
    return ref;
  };
  const firestoreApi = {
    collection: jest.fn((name) => {
      if (name !== 'members') throw new Error(`Unexpected collection: ${name}`);
      return { doc };
    }),
    runTransaction: jest.fn((handler) => {
      const run = transactionTail.then(() => handler({
        get: jest.fn(async (ref) => ({
          exists: documents.has(ref.path),
          data: () => documents.get(ref.path),
        })),
        create: jest.fn((ref, data) => {
          if (documents.has(ref.path)) throw new Error('already exists');
          documents.set(ref.path, data);
        }),
      }));
      transactionTail = run.catch(() => undefined);
      return run;
    }),
  };

  const getUser = jest.fn();
  const setCustomUserClaims = jest.fn().mockResolvedValue(undefined);
  const timestamp = { _seconds: 1_800_000_000 };

  return {
    auth: jest.fn(() => ({ getUser, setCustomUserClaims })),
    firestore: jest.fn(() => firestoreApi),
    __reset: () => {
      documents.clear();
      transactionTail = Promise.resolve();
      getUser.mockReset();
      setCustomUserClaims.mockClear();
      firestoreApi.collection.mockClear();
      firestoreApi.runTransaction.mockClear();
    },
    __seed: (uid, data) => documents.set(`members/${uid}`, data),
    __read: (uid) => documents.get(`members/${uid}`),
    __mocks: { getUser, setCustomUserClaims, firestoreApi },
    __timestamp: timestamp,
  };
});

jest.mock('firebase-admin/firestore', () => {
  const admin = require('firebase-admin');
  return { Timestamp: { now: jest.fn(() => admin.__timestamp) } };
});

jest.mock('firebase-functions', () => {
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  return {
    auth: { user: () => ({ onCreate: (handler) => handler }) },
    https: {
      onCall: (handler) => handler,
      HttpsError,
    },
  };
});

jest.mock('./stripeHelpers', () => ({
  requireAppCheck: jest.fn(),
}));

const admin = require('firebase-admin');
const { requireAppCheck } = require('./stripeHelpers');

const AUTH_USER = {
  uid: 'caller-uid',
  email: 'member@example.com',
  emailVerified: true,
  displayName: 'Synthetic Member',
  phoneNumber: '+16505550123',
  providerData: [{ providerId: 'password' }],
};

const CONTEXT = {
  auth: { uid: AUTH_USER.uid, token: { email: AUTH_USER.email } },
  app: { appId: 'synthetic-app' },
};

describe('ensureMemberProfile callable', () => {
  beforeEach(() => {
    admin.__reset();
    requireAppCheck.mockReset();
    admin.__mocks.getUser.mockResolvedValue(AUTH_USER);
  });

  test('creates one exact pending profile from the authenticated Firebase user', async () => {
    const { ensureMemberProfile } = require('./ensureMemberProfile');

    await expect(ensureMemberProfile({}, CONTEXT)).resolves.toEqual({ ready: true });

    expect(requireAppCheck).toHaveBeenCalledWith(CONTEXT);
    expect(admin.__mocks.getUser).toHaveBeenCalledWith(AUTH_USER.uid);
    expect(admin.__read(AUTH_USER.uid)).toEqual({
      fullName: 'Synthetic Member',
      email: 'member@example.com',
      createdAt: admin.__timestamp,
      lastLogin: admin.__timestamp,
      phoneNumber: '+16505550123',
      role: 'unverified',
      emailVerified: true,
      provider: 'password',
    });
    expect(admin.__mocks.setCustomUserClaims).not.toHaveBeenCalled();
  });

  test.each([undefined, null, {}])('accepts an empty request shape: %p', async (data) => {
    const { ensureMemberProfile } = require('./ensureMemberProfile');
    await expect(ensureMemberProfile(data, CONTEXT)).resolves.toEqual({ ready: true });
  });

  test('retries and concurrent calls leave one unchanged profile', async () => {
    const { ensureMemberProfile } = require('./ensureMemberProfile');

    const results = await Promise.all([
      ensureMemberProfile({}, CONTEXT),
      ensureMemberProfile({}, CONTEXT),
      ensureMemberProfile({}, CONTEXT),
    ]);

    expect(results).toEqual([
      { ready: true },
      { ready: true },
      { ready: true },
    ]);
    const original = admin.__read(AUTH_USER.uid);
    await expect(ensureMemberProfile({}, CONTEXT)).resolves.toEqual({ ready: true });
    expect(admin.__read(AUTH_USER.uid)).toBe(original);
  });

  test('recognizes an existing privileged profile without changing any field', async () => {
    const existing = {
      email: AUTH_USER.email,
      fullName: 'Existing Name',
      phoneNumber: 'existing-phone',
      role: 'admin',
      customField: 'preserve-me',
    };
    admin.__seed(AUTH_USER.uid, existing);
    const { ensureMemberProfile } = require('./ensureMemberProfile');

    admin.__mocks.getUser.mockRejectedValue(new Error('Auth temporarily unavailable'));

    await expect(ensureMemberProfile({}, CONTEXT)).resolves.toEqual({ ready: true });
    expect(admin.__read(AUTH_USER.uid)).toBe(existing);
    expect(admin.__mocks.getUser).not.toHaveBeenCalled();
    expect(admin.__mocks.setCustomUserClaims).not.toHaveBeenCalled();
  });

  test('bounds Auth-derived editable fields without truncating identity data', async () => {
    admin.__mocks.getUser.mockResolvedValue({
      ...AUTH_USER,
      email: ' Member@Example.COM ',
      displayName: '🏃'.repeat(101),
      phoneNumber: '📞'.repeat(21),
    });
    const { ensureMemberProfile } = require('./ensureMemberProfile');

    await ensureMemberProfile({}, CONTEXT);

    expect(admin.__read(AUTH_USER.uid)).toMatchObject({
      email: 'member@example.com',
      fullName: null,
      phoneNumber: '',
      role: 'unverified',
    });
    expect(admin.__mocks.setCustomUserClaims).not.toHaveBeenCalled();
  });

  test('preserves Auth-derived fields at the exact Unicode boundaries', async () => {
    const displayName = '🏃'.repeat(100);
    const phoneNumber = '📞'.repeat(20);
    admin.__mocks.getUser.mockResolvedValue({
      ...AUTH_USER,
      displayName,
      phoneNumber,
    });
    const { ensureMemberProfile } = require('./ensureMemberProfile');

    await ensureMemberProfile({}, CONTEXT);

    expect(admin.__read(AUTH_USER.uid)).toMatchObject({
      fullName: displayName,
      phoneNumber,
      role: 'unverified',
    });
  });

  test.each([
    [{ uid: 'another-user' }],
    [{ email: 'injected@example.com' }],
    [{ role: 'admin' }],
    [{ membershipPaid: true }],
    [[]],
    ['unexpected'],
  ])('rejects caller-supplied profile or authority data: %p', async (data) => {
    const { ensureMemberProfile } = require('./ensureMemberProfile');

    await expect(ensureMemberProfile(data, CONTEXT)).rejects.toMatchObject({
      code: 'invalid-argument',
      message: 'Profile setup request is invalid.',
    });
    expect(admin.__mocks.getUser).not.toHaveBeenCalled();
  });

  test('rejects anonymous callers before looking up an account', async () => {
    const { ensureMemberProfile } = require('./ensureMemberProfile');

    await expect(ensureMemberProfile({}, { auth: null })).rejects.toMatchObject({
      code: 'unauthenticated',
      message: 'Sign-in required.',
    });
    expect(admin.__mocks.getUser).not.toHaveBeenCalled();
  });

  test('preserves the shared App Check rejection before any profile work', async () => {
    const error = Object.assign(new Error('app check rejected'), {
      code: 'failed-precondition',
    });
    requireAppCheck.mockImplementation(() => { throw error; });
    const { ensureMemberProfile } = require('./ensureMemberProfile');

    await expect(ensureMemberProfile({}, CONTEXT)).rejects.toBe(error);
    expect(admin.__mocks.getUser).not.toHaveBeenCalled();
  });

  test('returns a generic unavailable error without leaking provider details', async () => {
    admin.__mocks.getUser.mockRejectedValue(
      new Error('auth/user-not-found for member@example.com'),
    );
    const { ensureMemberProfile } = require('./ensureMemberProfile');

    let caught;
    try {
      await ensureMemberProfile({}, CONTEXT);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: 'unavailable',
      message: 'Profile setup is temporarily unavailable.',
    });
    expect(caught.message).not.toContain('member@example.com');
    expect(caught.message).not.toContain('auth/user-not-found');
  });
});

describe('signup profile compatibility', () => {
  beforeEach(() => {
    admin.__reset();
  });

  test('the signup trigger does not overwrite a profile created by recovery', async () => {
    const existing = {
      email: AUTH_USER.email,
      fullName: 'Member-entered name',
      phoneNumber: 'member-entered phone',
      role: 'member',
    };
    admin.__seed(AUTH_USER.uid, existing);
    const { onSignUp } = require('./signup');

    await onSignUp(AUTH_USER);

    expect(admin.__read(AUTH_USER.uid)).toBe(existing);
    expect(admin.__mocks.setCustomUserClaims).not.toHaveBeenCalled();
  });

  test('the signup trigger never changes claims when it creates the profile', async () => {
    const { onSignUp } = require('./signup');

    await onSignUp(AUTH_USER);

    expect(admin.__read(AUTH_USER.uid)).toMatchObject({ role: 'unverified' });
    expect(admin.__mocks.setCustomUserClaims).not.toHaveBeenCalled();
  });

  test('logs only the fixed failure outcome and never user or provider data', async () => {
    const canaries = [
      'signup-member@example.test',
      '+1-555-010-4242',
      'oauth-token-canary',
      'provider-response-canary',
      'request-body-canary',
      'https://runmprc.com/account?token=capability-canary#private',
      'signup-uid-canary',
      'Private Signup Name Canary',
    ];
    const hostileUser = {
      ...AUTH_USER,
      uid: canaries[6],
      email: canaries[0],
      displayName: canaries[7],
      phoneNumber: canaries[1],
      providerData: [{ providerId: canaries[3] }],
    };
    const providerFailure = Object.assign(new Error(canaries.join(' ')), {
      email: canaries[0],
      phone: canaries[1],
      token: canaries[2],
      response: { message: canaries[3] },
      request: { body: canaries[4] },
      url: canaries[5],
    });
    const consoleDebug = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const consoleInfo = jest.spyOn(console, 'info').mockImplementation(() => {});
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const otherConsoleSpies = [consoleDebug, consoleInfo, consoleLog, consoleWarn];
    const allConsoleSpies = [consoleError, ...otherConsoleSpies];
    const { onSignUp } = require('./signup');

    try {
      await onSignUp(AUTH_USER);
      allConsoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());

      admin.__mocks.firestoreApi.runTransaction.mockRejectedValueOnce(providerFailure);
      let caught;
      try {
        await onSignUp(hostileUser);
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({
        code: 'internal',
        message: 'Failed to create member record',
      });
      expect(caught).not.toBe(providerFailure);
      expect(caught.cause).toBeUndefined();
      expect(consoleError.mock.calls).toEqual([
        ['Member profile setup failed during account creation.'],
      ]);
      otherConsoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());

      const serializedConsole = JSON.stringify(
        allConsoleSpies.map((spy) => spy.mock.calls),
      );
      const returnedError = `${caught.code}: ${caught.message}`;
      canaries.forEach((canary) => {
        expect(serializedConsole).not.toContain(canary);
        expect(returnedError).not.toContain(canary);
      });
    } finally {
      allConsoleSpies.forEach((spy) => spy.mockRestore());
    }
  });
});
