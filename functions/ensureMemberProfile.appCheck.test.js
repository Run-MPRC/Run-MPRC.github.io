const { EventEmitter } = require('node:events');

// Keep the actual Functions SDK and callable request wrapper. Only the token
// verifier and business stores are synthetic: no socket, credential or cloud
// endpoint is used. This is not cryptographic or hosted-provider proof.
jest.mock('firebase-admin/app', () => ({
  getApp: () => ({ name: 'synthetic-admin-app' }),
}));
jest.mock('firebase-admin/auth', () => {
  const verifyIdToken = jest.fn();
  return { getAuth: () => ({ verifyIdToken }) };
});
jest.mock('firebase-admin/app-check', () => {
  const verifyToken = jest.fn();
  return { getAppCheck: () => ({ verifyToken }) };
});
jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({ getUser: jest.fn().mockResolvedValue({ uid: 'synthetic-uid' }) })),
}));
jest.mock('./memberProfile', () => ({
  memberProfileExists: jest.fn(),
  ensureMemberProfileDocument: jest.fn(),
}));
jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));

const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const { getAppCheck } = require('firebase-admin/app-check');
const { memberProfileExists, ensureMemberProfileDocument } = require('./memberProfile');
const { verifyToken } = getAppCheck();
const { verifyIdToken } = getAuth();

async function request(handler, headers = {}, data = {}) {
  const requestHeaders = { 'content-type': 'application/json', ...headers };
  const req = {
    method: 'POST', body: { data }, headers: requestHeaders,
    header: (name) => requestHeaders[name.toLowerCase()],
  };
  const res = new EventEmitter();
  const responseHeaders = new Map();
  res.setHeader = (name, value) => responseHeaders.set(name.toLowerCase(), value);
  res.getHeader = (name) => responseHeaders.get(name.toLowerCase());
  res.status = (status) => { res.statusCode = status; return res; };
  res.send = (body) => { res.body = body; res.emit('finish'); return res; };
  await handler(req, res);
  return { status: res.statusCode, body: res.body };
}

describe('profile recovery native App Check request boundary', () => {
  const saved = {};
  let handler;

  beforeAll(() => {
    for (const key of ['ENFORCE_APP_CHECK', 'FIREBASE_DEBUG_MODE', 'FIREBASE_DEBUG_FEATURES']) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    // Do not let an emulator debug token-decoding shortcut substitute for the
    // actual SDK verification branch exercised by the synthetic verifiers.
    handler = require('./ensureMemberProfile').ensureMemberProfile;
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    verifyIdToken.mockResolvedValue({ uid: 'synthetic-uid' });
    memberProfileExists.mockResolvedValue(false);
    ensureMemberProfileDocument.mockResolvedValue(undefined);
    verifyToken.mockImplementation(async (token) => {
      if (token !== 'synthetic-valid-app-token') throw new Error('Synthetic verification rejection.');
      return { appId: 'synthetic-app-id' };
    });
  });

  describe.each([undefined, 'false', 'true'])('optional environment flag %s', (flag) => {
    beforeEach(() => {
      if (flag === undefined) delete process.env.ENFORCE_APP_CHECK;
      else process.env.ENFORCE_APP_CHECK = flag;
    });

    test.each([undefined, 'synthetic-invalid-app-token'])(
      'rejects an unverified app before profile work: %s', async (appToken) => {
        const headers = { authorization: 'Bearer synthetic-auth-token' };
        if (appToken !== undefined) headers['x-firebase-appcheck'] = appToken;
        const response = await request(handler, headers);
        expect(response).toEqual({
          status: 401,
          body: { error: { status: 'UNAUTHENTICATED', message: 'Unauthenticated' } },
        });
        expect(admin.auth).not.toHaveBeenCalled();
        expect(memberProfileExists).not.toHaveBeenCalled();
        expect(ensureMemberProfileDocument).not.toHaveBeenCalled();
        expect(verifyToken).toHaveBeenCalledTimes(appToken === undefined ? 0 : 1);
      },
    );

    test('verified app and authenticated caller retain profile recovery', async () => {
      const response = await request(handler, {
        authorization: 'Bearer synthetic-auth-token',
        'x-firebase-appcheck': 'synthetic-valid-app-token',
      });
      expect(response).toEqual({ status: 200, body: { result: { ready: true } } });
      expect(verifyToken).toHaveBeenCalledWith('synthetic-valid-app-token');
      expect(verifyIdToken).toHaveBeenCalledWith('synthetic-auth-token');
      expect(memberProfileExists).toHaveBeenCalledWith('synthetic-uid');
      expect(ensureMemberProfileDocument).toHaveBeenCalledWith({ uid: 'synthetic-uid' });
    });

    test('verified app does not replace authentication', async () => {
      const response = await request(handler, {
        'x-firebase-appcheck': 'synthetic-valid-app-token',
      });
      expect(response.status).toBe(401);
      expect(response.body.error.status).toBe('UNAUTHENTICATED');
      expect(admin.auth).not.toHaveBeenCalled();
      expect(memberProfileExists).not.toHaveBeenCalled();
      expect(ensureMemberProfileDocument).not.toHaveBeenCalled();
    });

    test('verified app cannot admit an invalid Auth token', async () => {
      verifyIdToken.mockRejectedValue(new Error('Synthetic authentication rejection.'));
      const response = await request(handler, {
        authorization: 'Bearer synthetic-invalid-auth-token',
        'x-firebase-appcheck': 'synthetic-valid-app-token',
      });
      expect(response).toEqual({
        status: 401,
        body: { error: { status: 'UNAUTHENTICATED', message: 'Unauthenticated' } },
      });
      expect(admin.auth).not.toHaveBeenCalled();
      expect(memberProfileExists).not.toHaveBeenCalled();
      expect(ensureMemberProfileDocument).not.toHaveBeenCalled();
    });

    test('verified app does not authorize injected profile fields', async () => {
      const response = await request(handler, {
        authorization: 'Bearer synthetic-auth-token',
        'x-firebase-appcheck': 'synthetic-valid-app-token',
      }, { role: 'admin' });
      expect(response.status).toBe(400);
      expect(response.body.error.status).toBe('INVALID_ARGUMENT');
      expect(admin.auth).not.toHaveBeenCalled();
      expect(memberProfileExists).not.toHaveBeenCalled();
      expect(ensureMemberProfileDocument).not.toHaveBeenCalled();
    });
  });
});
