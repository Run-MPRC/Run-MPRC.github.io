jest.mock('firebase-admin', () => {
  const users = new Map();
  const profileUpdates = new Map();
  const getUserByEmail = jest.fn(async (email) => {
    if (!users.has(email)) {
      const error = new Error('auth/user-not-found');
      error.code = 'auth/user-not-found';
      throw error;
    }
    return users.get(email);
  });
  const setCustomUserClaims = jest.fn().mockResolvedValue(undefined);
  const profileUpdate = jest.fn(async (email, patch) => {
    profileUpdates.set(email, patch);
  });
  const membersRef = {
    where: jest.fn((_field, _operator, email) => ({
      limit: jest.fn(() => ({
        get: jest.fn(async () => ({
          docs: [{
            ref: {
              update: (patch) => profileUpdate(email, patch),
            },
          }],
        })),
      })),
    })),
  };
  const firestoreApi = {
    collection: jest.fn((name) => {
      if (name !== 'members') throw new Error(`Unexpected collection: ${name}`);
      return membersRef;
    }),
  };
  const Timestamp = { now: jest.fn(() => ({ _seconds: 1_800_000_000 })) };

  return {
    auth: jest.fn(() => ({ getUserByEmail, setCustomUserClaims })),
    firestore: Object.assign(jest.fn(() => firestoreApi), { Timestamp }),
    __setUsers: (records) => {
      users.clear();
      records.forEach((record) => users.set(record.email.toLowerCase(), record));
    },
    __reset: () => {
      users.clear();
      profileUpdates.clear();
      getUserByEmail.mockClear();
      setCustomUserClaims.mockClear();
      profileUpdate.mockClear();
      membersRef.where.mockClear();
      firestoreApi.collection.mockClear();
      Timestamp.now.mockClear();
    },
    __mocks: {
      getUserByEmail,
      setCustomUserClaims,
      profileUpdate,
      profileUpdates,
    },
  };
});

jest.mock('firebase-functions', () => {
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  return {
    https: {
      onCall: (handler) => handler,
      onRequest: (handler) => handler,
      HttpsError,
    },
    config: () => ({ api: { key: 'test-api-key' } }),
  };
});

jest.mock('./stripeHelpers', () => ({
  requireAdmin: jest.fn().mockResolvedValue(undefined),
  requireAppCheck: jest.fn(),
}));

const admin = require('firebase-admin');
const { setMemberRole } = require('./setMemberRole');
const { updateMemberRole } = require('./updatemembers');

const ADMIN_CONTEXT = {
  auth: { uid: 'caller-admin', token: { role: 'admin' } },
  app: { appId: 'test-app' },
};

function mockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

function bulkRequest(body) {
  return {
    method: 'POST',
    body,
    get: (header) => (header === 'X-API-Key' ? 'test-api-key' : undefined),
  };
}

describe('role grant verification policy', () => {
  beforeEach(() => {
    admin.__reset();
  });

  test('requires authoritative verification for member and admin grants only', () => {
    const {
      assertVerifiedEmailForRole,
      EMAIL_UNVERIFIED_GRANT_CODE,
    } = require('./roleGrantPolicy');

    expect(() => assertVerifiedEmailForRole({ emailVerified: true }, 'member'))
      .not.toThrow();
    expect(() => assertVerifiedEmailForRole({ emailVerified: true }, 'admin'))
      .not.toThrow();
    expect(() => assertVerifiedEmailForRole({ emailVerified: false }, 'unverified'))
      .not.toThrow();

    for (const role of ['member', 'admin']) {
      for (const userRecord of [{ emailVerified: false }, {}, null]) {
        try {
          assertVerifiedEmailForRole(userRecord, role);
          throw new Error('Expected policy rejection');
        } catch (error) {
          expect(error).toMatchObject({ code: EMAIL_UNVERIFIED_GRANT_CODE });
        }
      }
    }
  });

  test.each(['member', 'admin'])(
    'admin callable preserves verified %s promotion',
    async (role) => {
      admin.__setUsers([{
        email: 'verified@example.com',
        uid: 'verified-uid',
        emailVerified: true,
      }]);

      await expect(setMemberRole({
        email: ' Verified@Example.com ',
        role,
      }, ADMIN_CONTEXT)).resolves.toEqual({
        ok: true,
        uid: 'verified-uid',
        role,
      });
      expect(admin.__mocks.setCustomUserClaims)
        .toHaveBeenCalledWith('verified-uid', { role });
      expect(admin.__mocks.profileUpdate).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    ['member', false],
    ['admin', undefined],
  ])(
    'admin callable rejects %s promotion when verification is %s before writes',
    async (role, emailVerified) => {
      admin.__setUsers([{
        email: 'target@example.com',
        uid: 'target-uid',
        ...(emailVerified === undefined ? {} : { emailVerified }),
      }]);

      await expect(setMemberRole({
        email: 'target@example.com',
        role,
        emailVerified: true,
      }, ADMIN_CONTEXT)).rejects.toMatchObject({
        code: 'failed-precondition',
        message: 'Target account is not eligible for this role',
      });
      expect(admin.__mocks.setCustomUserClaims).not.toHaveBeenCalled();
      expect(admin.__mocks.profileUpdate).not.toHaveBeenCalled();
    },
  );

  test('admin callable still permits demotion of an unverified target', async () => {
    admin.__setUsers([{
      email: 'target@example.com',
      uid: 'target-uid',
      emailVerified: false,
    }]);

    await expect(setMemberRole({
      email: 'target@example.com',
      role: 'unverified',
    }, ADMIN_CONTEXT)).resolves.toMatchObject({ ok: true, role: 'unverified' });
    expect(admin.__mocks.setCustomUserClaims)
      .toHaveBeenCalledWith('target-uid', { role: 'unverified' });
  });

  test('admin callable retains self-demotion protection', async () => {
    admin.__setUsers([{
      email: 'caller@example.com',
      uid: 'caller-admin',
      emailVerified: true,
    }]);

    await expect(setMemberRole({
      email: 'caller@example.com',
      role: 'unverified',
    }, ADMIN_CONTEXT)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(admin.__mocks.setCustomUserClaims).not.toHaveBeenCalled();
  });

  test('bulk sync promotes verified targets and reports indistinguishable failures', async () => {
    admin.__setUsers([
      {
        email: 'verified@example.com',
        uid: 'verified-uid',
        emailVerified: true,
      },
      {
        email: 'unverified@example.com',
        uid: 'unverified-uid',
        emailVerified: false,
      },
    ]);
    const response = mockResponse();

    await updateMemberRole(bulkRequest({
      emails: [
        'verified@example.com',
        'unverified@example.com',
        'missing@example.com',
      ],
      role: 'member',
      emailVerified: true,
    }), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      succeeded: ['verified@example.com'],
      failed: [{
        email: 'unverified@example.com',
        error: 'Role update not applied',
      }, {
        email: 'missing@example.com',
        error: 'Role update not applied',
      }],
      role: 'member',
    }));
    expect(admin.__mocks.setCustomUserClaims)
      .toHaveBeenCalledTimes(1);
    expect(admin.__mocks.setCustomUserClaims)
      .toHaveBeenCalledWith('verified-uid', { role: 'member' });
    expect(admin.__mocks.profileUpdate).toHaveBeenCalledTimes(1);
    expect(admin.__mocks.profileUpdates.has('unverified@example.com')).toBe(false);
  });

  test('bulk sync still permits unverified demotion', async () => {
    admin.__setUsers([{
      email: 'target@example.com',
      uid: 'target-uid',
      emailVerified: false,
    }]);
    const response = mockResponse();

    await updateMemberRole(bulkRequest({
      emails: ['target@example.com'],
      role: 'unverified',
    }), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(admin.__mocks.setCustomUserClaims)
      .toHaveBeenCalledWith('target-uid', { role: 'unverified' });
  });

  test('bulk sync continues to reject admin grants before user lookup', async () => {
    const response = mockResponse();

    await updateMemberRole(bulkRequest({
      emails: ['target@example.com'],
      role: 'admin',
    }), response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(admin.__mocks.getUserByEmail).not.toHaveBeenCalled();
    expect(admin.__mocks.setCustomUserClaims).not.toHaveBeenCalled();
  });
});
