jest.mock('firebase-functions', () => {
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  const https = {
    onCall: (handler) => handler,
    HttpsError,
  };

  return {
    runWith: () => ({ https }),
    https,
  };
});

jest.mock('firebase-admin', () => {
  const writes = [];

  function document(path) {
    return {
      collection: (name) => ({
        doc: (id) => document(`${path}/${name}/${id}`),
      }),
      set: async (data, options) => {
        writes.push({ path, data, options });
      },
    };
  }

  return {
    firestore: () => ({
      collection: (name) => ({
        doc: (id) => document(`${name}/${id}`),
      }),
    }),
    __clearWrites: () => writes.splice(0, writes.length),
    __getWrites: () => [...writes],
  };
});

jest.mock('firebase-admin/firestore', () => {
  let tick = 1_800_000_000;
  return {
    Timestamp: {
      now: () => ({ _seconds: tick += 1 }),
    },
  };
});

jest.mock('./stripeHelpers', () => ({
  requireAppCheck: jest.fn(),
}));

const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { requireAppCheck } = require('./stripeHelpers');
const { stravaExchangeCode } = require('./strava');

const FIXED_AUTHORIZATION_ERROR = 'Strava authorization could not be completed.';
const GUARDED_FETCH = global.fetch;
const CONTEXT = Object.freeze({
  app: Object.freeze({ appId: 'synthetic-app-check' }),
  auth: Object.freeze({ uid: 'synthetic-member-000001' }),
});
const CODE = 'synthetic_authorization_code';

function publicError(error) {
  return {
    code: error?.code,
    message: error?.message,
    details: error?.details,
    cause: error?.cause,
  };
}

async function captureFailure(action) {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error('Expected Strava exchange to fail.');
}

describe('Strava authorization exchange failure boundary', () => {
  let fetchMock;
  let consoleSpies;

  beforeEach(() => {
    process.env.STRAVA_CLIENT_ID = 'strava_client_test';
    process.env.STRAVA_CLIENT_SECRET = 'strava_secret_test';
    admin.__clearWrites();
    requireAppCheck.mockReset();
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
  });

  afterEach(() => {
    global.fetch = GUARDED_FETCH;
    consoleSpies.forEach((spy) => spy.mockRestore());
    delete process.env.STRAVA_CLIENT_ID;
    delete process.env.STRAVA_CLIENT_SECRET;
  });

  function expectNoSideEffects() {
    expect(admin.__getWrites()).toEqual([]);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  }

  test('runs App Check before Auth, provider exchange, or Firestore', async () => {
    const appCheckFailure = new functions.https.HttpsError(
      'failed-precondition',
      'synthetic app check rejection',
    );
    requireAppCheck.mockImplementationOnce(() => {
      throw appCheckFailure;
    });

    await expect(stravaExchangeCode({ code: CODE }, CONTEXT)).rejects.toBe(appCheckFailure);

    expect(requireAppCheck).toHaveBeenCalledWith(CONTEXT);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  test('rejects a missing caller before provider exchange or Firestore', async () => {
    await expect(stravaExchangeCode({ code: CODE }, { ...CONTEXT, auth: null }))
      .rejects.toMatchObject({ code: 'unauthenticated' });

    expect(requireAppCheck).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  test('rejects a missing code before credentials, provider exchange, or Firestore', async () => {
    delete process.env.STRAVA_CLIENT_ID;
    delete process.env.STRAVA_CLIENT_SECRET;

    await expect(stravaExchangeCode({}, CONTEXT))
      .rejects.toMatchObject({ code: 'invalid-argument' });

    expect(requireAppCheck).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  test('does not read or expose a failed provider response body or status', async () => {
    const text = jest.fn().mockResolvedValue(
      'provider-body-canary refresh_token=provider-secret-canary',
    );
    const json = jest.fn();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 599,
      text,
      json,
    });

    const error = await captureFailure(() => stravaExchangeCode({ code: CODE }, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'invalid-argument',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(JSON.stringify(publicError(error)))
      .not.toMatch(/599|provider-body-canary|provider-secret-canary/i);
    expect(text).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectNoSideEffects();
  });

  test('turns a transport failure into one fixed unavailable result', async () => {
    fetchMock.mockRejectedValue(Object.assign(
      new Error('transport-canary https://provider.example.test/?code=secret-canary'),
      { providerBody: 'provider-body-canary' },
    ));

    const error = await captureFailure(() => stravaExchangeCode({ code: CODE }, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'unavailable',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(JSON.stringify(publicError(error)))
      .not.toMatch(/transport-canary|provider\.example|secret-canary|provider-body-canary/i);
    expectNoSideEffects();
  });

  test('turns malformed provider JSON into one fixed unavailable result', async () => {
    const json = jest.fn().mockRejectedValue(
      new Error('json-canary access_token=provider-secret-canary'),
    );
    fetchMock.mockResolvedValue({ ok: true, json });

    const error = await captureFailure(() => stravaExchangeCode({ code: CODE }, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'unavailable',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(JSON.stringify(publicError(error)))
      .not.toMatch(/json-canary|provider-secret-canary/i);
    expect(json).toHaveBeenCalledTimes(1);
    expectNoSideEffects();
  });

  test('preserves the successful server-only exchange, writes, and minimal result', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        access_token: 'access_token_test',
        refresh_token: 'refresh_token_test',
        expires_at: 1_900_000_000,
        scope: 'read',
        athlete: {
          id: 123456,
          firstname: 'Synthetic',
          lastname: 'Athlete',
          username: 'synthetic-athlete',
          profile: 'https://images.example.test/synthetic-athlete.png',
        },
      }),
    });

    const result = await stravaExchangeCode({ code: CODE }, CONTEXT);

    expect(result).toEqual({ ok: true, athleteId: 123456 });
    expect(requireAppCheck.mock.invocationCallOrder[0])
      .toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.strava.com/api/v3/oauth/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: 'strava_client_test',
          client_secret: 'strava_secret_test',
          code: CODE,
          grant_type: 'authorization_code',
        }),
      },
    );
    expect(admin.__getWrites()).toEqual([
      {
        path: 'members/synthetic-member-000001/secrets/strava',
        data: {
          access_token: 'access_token_test',
          refresh_token: 'refresh_token_test',
          expires_at: 1_900_000_000,
          scope: 'read',
          updatedAt: expect.any(Object),
        },
        options: { merge: true },
      },
      {
        path: 'members/synthetic-member-000001/connections/strava',
        data: {
          provider: 'strava',
          athleteId: 123456,
          firstName: 'Synthetic',
          lastName: 'Athlete',
          username: 'synthetic-athlete',
          profileUrl: 'https://images.example.test/synthetic-athlete.png',
          connectedAt: expect.any(Object),
          updatedAt: expect.any(Object),
        },
        options: { merge: true },
      },
    ]);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });
});
