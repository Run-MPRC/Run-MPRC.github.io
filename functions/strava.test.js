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
  const deleteFailures = new Map();
  const deletes = [];
  const documents = new Map();
  const reads = [];
  const writes = [];

  function document(path) {
    return {
      collection: (name) => ({
        doc: (id) => document(`${path}/${name}/${id}`),
      }),
      delete: async () => {
        deletes.push(path);
        if (deleteFailures.has(path)) {
          throw deleteFailures.get(path);
        }
      },
      get: async () => {
        reads.push(path);
        const data = documents.get(path);
        return {
          exists: data !== undefined,
          data: () => data,
        };
      },
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
    __clearDeletes: () => {
      deleteFailures.clear();
      deletes.splice(0, deletes.length);
    },
    __clearDocuments: () => documents.clear(),
    __clearReads: () => reads.splice(0, reads.length),
    __clearWrites: () => writes.splice(0, writes.length),
    __getDeletes: () => [...deletes],
    __getReads: () => [...reads],
    __getWrites: () => [...writes],
    __setDeleteFailure: (path, error) => deleteFailures.set(path, error),
    __setDocument: (path, data) => documents.set(path, data),
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
const { stravaDisconnect, stravaExchangeCode, stravaFetchStats } = require('./strava');

const FIXED_AUTHORIZATION_ERROR = 'Strava authorization could not be completed.';
const FIXED_REFRESH_ERROR = 'Strava connection could not be refreshed.';
const FIXED_DATA_ERROR = 'Strava activity data could not be loaded.';
const FIXED_DISCONNECT_WARNING = 'strava_disconnect_revoke_failed';
const GUARDED_FETCH = global.fetch;
const CONTEXT = Object.freeze({
  app: Object.freeze({ appId: 'synthetic-app-check' }),
  auth: Object.freeze({ uid: 'synthetic-member-000001' }),
});
const CODE = 'synthetic_authorization_code';
const MAX_AUTHORIZATION_CODE_LENGTH = 1_024;
const CONNECTION_PATH = 'members/synthetic-member-000001/connections/strava';
const SECRET_PATH = 'members/synthetic-member-000001/secrets/strava';

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
  throw new Error('Expected Strava request to fail.');
}

describe('Strava authorization exchange failure boundary', () => {
  let fetchMock;
  let consoleSpies;

  beforeEach(() => {
    process.env.STRAVA_CLIENT_ID = 'strava_client_test';
    process.env.STRAVA_CLIENT_SECRET = 'strava_secret_test';
    admin.__clearDeletes();
    admin.__clearDocuments();
    admin.__clearReads();
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
    expect(admin.__getDeletes()).toEqual([]);
    expect(admin.__getReads()).toEqual([]);
    expect(admin.__getWrites()).toEqual([]);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  }

  function mockSuccessfulExchange() {
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
  }

  test('runs App Check before Auth, provider exchange, or Firestore', async () => {
    const appCheckFailure = new functions.https.HttpsError(
      'failed-precondition',
      'synthetic app check rejection',
    );
    requireAppCheck.mockImplementationOnce(() => {
      throw appCheckFailure;
    });

    await expect(stravaExchangeCode({
      code: 'x'.repeat(MAX_AUTHORIZATION_CODE_LENGTH + 1),
    }, CONTEXT)).rejects.toBe(appCheckFailure);

    expect(requireAppCheck).toHaveBeenCalledWith(CONTEXT);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  test('rejects a missing caller before code validation, provider exchange, or Firestore', async () => {
    await expect(stravaExchangeCode({
      code: 'x'.repeat(MAX_AUTHORIZATION_CODE_LENGTH + 1),
    }, { ...CONTEXT, auth: null }))
      .rejects.toMatchObject({ code: 'unauthenticated' });

    expect(requireAppCheck).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  test('rejects a missing code before credentials, provider exchange, or Firestore', async () => {
    delete process.env.STRAVA_CLIENT_ID;
    delete process.env.STRAVA_CLIENT_SECRET;

    const error = await captureFailure(() => stravaExchangeCode({}, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'invalid-argument',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(requireAppCheck).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  test.each([
    ['an undefined', undefined],
    ['a null', null],
    ['an empty string', ''],
    ['a boolean', false],
    ['a number', 0],
    ['an array', []],
    ['a plain object', {}],
    ['a boxed string', Object('synthetic-boxed-code')],
  ])('rejects %s code before reading credentials, provider access, or Firestore', async (
    _case,
    code,
  ) => {
    delete process.env.STRAVA_CLIENT_ID;
    delete process.env.STRAVA_CLIENT_SECRET;

    const error = await captureFailure(() => stravaExchangeCode({ code }, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'invalid-argument',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  test('rejects an oversized code before provider access or Firestore', async () => {
    mockSuccessfulExchange();

    const error = await captureFailure(() => stravaExchangeCode({
      code: 'x'.repeat(MAX_AUTHORIZATION_CODE_LENGTH + 1),
    }, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'invalid-argument',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  test('rejects an oversized code before reading credentials', async () => {
    delete process.env.STRAVA_CLIENT_ID;
    delete process.env.STRAVA_CLIENT_SECRET;

    const error = await captureFailure(() => stravaExchangeCode({
      code: 'x'.repeat(MAX_AUTHORIZATION_CODE_LENGTH + 1),
    }, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'invalid-argument',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  test.each([
    ['one character', 'x'],
    ['exact maximum length', 'x'.repeat(MAX_AUTHORIZATION_CODE_LENGTH)],
    ['opaque whitespace, Unicode, case, and punctuation', ' \tΩaA+/_-?&= '],
  ])('preserves an admitted %s code-unit-for-code-unit', async (_case, code) => {
    mockSuccessfulExchange();

    const result = await stravaExchangeCode({ code }, CONTEXT);

    expect(result).toEqual({ ok: true, athleteId: 123456 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0][1];
    expect(JSON.parse(request.body).code).toBe(code);
    expect(admin.__getWrites()).toHaveLength(2);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
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
    mockSuccessfulExchange();

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

describe('Strava token refresh failure boundary', () => {
  let fetchMock;
  let consoleSpies;

  const CONNECTION = Object.freeze({
    provider: 'strava',
    athleteId: 123456,
    firstName: 'Synthetic',
    lastName: 'Athlete',
    username: 'synthetic-athlete',
    profileUrl: 'https://images.example.test/synthetic-athlete.png',
  });
  const EXPIRED_SECRET = Object.freeze({
    access_token: 'expired_access_token_test',
    refresh_token: 'synthetic_refresh_token_test',
    expires_at: 1,
    scope: 'read',
  });

  beforeEach(() => {
    process.env.STRAVA_CLIENT_ID = 'strava_client_test';
    process.env.STRAVA_CLIENT_SECRET = 'strava_secret_test';
    admin.__clearDocuments();
    admin.__clearReads();
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

  function seedExpiredConnection() {
    admin.__setDocument(CONNECTION_PATH, CONNECTION);
    admin.__setDocument(SECRET_PATH, EXPIRED_SECRET);
  }

  function expectNoWritesOrLogs() {
    expect(admin.__getWrites()).toEqual([]);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  }

  test('runs App Check before Auth, Firestore, or provider access', async () => {
    const appCheckFailure = new functions.https.HttpsError(
      'failed-precondition',
      'synthetic app check rejection',
    );
    requireAppCheck.mockImplementationOnce(() => {
      throw appCheckFailure;
    });

    await expect(stravaFetchStats({}, CONTEXT)).rejects.toBe(appCheckFailure);

    expect(requireAppCheck).toHaveBeenCalledWith(CONTEXT);
    expect(admin.__getReads()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoWritesOrLogs();
  });

  test('rejects a missing caller before Firestore or provider access', async () => {
    await expect(stravaFetchStats({}, { ...CONTEXT, auth: null }))
      .rejects.toMatchObject({ code: 'unauthenticated' });

    expect(requireAppCheck).toHaveBeenCalledTimes(1);
    expect(admin.__getReads()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoWritesOrLogs();
  });

  test('stops when the Strava connection record is missing', async () => {
    await expect(stravaFetchStats({}, CONTEXT)).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'Strava not connected',
    });

    expect(admin.__getReads()).toEqual([CONNECTION_PATH]);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoWritesOrLogs();
  });

  test('stops when the server-only token record is missing', async () => {
    admin.__setDocument(CONNECTION_PATH, CONNECTION);

    await expect(stravaFetchStats({}, CONTEXT)).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'Strava not connected',
    });

    expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoWritesOrLogs();
  });

  test('does not read or expose a failed refresh response body or status', async () => {
    seedExpiredConnection();
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

    const error = await captureFailure(() => stravaFetchStats({}, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'failed-precondition',
      message: FIXED_REFRESH_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(JSON.stringify(publicError(error)))
      .not.toMatch(/599|provider-body-canary|provider-secret-canary/i);
    expect(text).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
    expectNoWritesOrLogs();
  });

  test('turns a refresh transport failure into one fixed unavailable result', async () => {
    seedExpiredConnection();
    fetchMock.mockRejectedValue(Object.assign(
      new Error('transport-canary https://provider.example.test/?token=secret-canary'),
      { providerBody: 'provider-body-canary' },
    ));

    const error = await captureFailure(() => stravaFetchStats({}, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'unavailable',
      message: FIXED_REFRESH_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(JSON.stringify(publicError(error)))
      .not.toMatch(/transport-canary|provider\.example|secret-canary|provider-body-canary/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
    expectNoWritesOrLogs();
  });

  test('turns malformed refresh JSON into one fixed unavailable result', async () => {
    seedExpiredConnection();
    const json = jest.fn().mockRejectedValue(
      new Error('json-canary access_token=provider-secret-canary'),
    );
    fetchMock.mockResolvedValue({ ok: true, json });

    const error = await captureFailure(() => stravaFetchStats({}, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'unavailable',
      message: FIXED_REFRESH_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(JSON.stringify(publicError(error)))
      .not.toMatch(/json-canary|provider-secret-canary/i);
    expect(json).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
    expectNoWritesOrLogs();
  });

  test('preserves successful refresh, secret update, and downstream stats result', async () => {
    seedExpiredConnection();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'refreshed_access_token_test',
          refresh_token: 'refreshed_refresh_token_test',
          expires_at: 1_900_000_000,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue([{
          id: 987654,
          name: 'Synthetic Morning Run',
          sport_type: 'Run',
          distance: 5000,
          moving_time: 1500,
          start_date: '2026-01-02T12:00:00Z',
        }]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          ytd_run_totals: { distance: 12000, count: 3 },
          ytd_ride_totals: { distance: 20000, count: 2 },
          all_run_totals: { distance: 345000, count: 84 },
        }),
      });

    const result = await stravaFetchStats({}, CONTEXT);

    expect(result).toEqual({
      connected: true,
      athlete: {
        id: 123456,
        firstName: 'Synthetic',
        lastName: 'Athlete',
        username: 'synthetic-athlete',
        profileUrl: 'https://images.example.test/synthetic-athlete.png',
      },
      recentActivities: [{
        id: 987654,
        name: 'Synthetic Morning Run',
        type: 'Run',
        distanceMeters: 5000,
        movingTimeSeconds: 1500,
        startDate: '2026-01-02T12:00:00Z',
      }],
      yearToDate: {
        runMeters: 12000,
        runCount: 3,
        rideMeters: 20000,
        rideCount: 2,
      },
      allTime: {
        runMeters: 345000,
        runCount: 84,
      },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://www.strava.com/api/v3/oauth/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: 'strava_client_test',
          client_secret: 'strava_secret_test',
          refresh_token: 'synthetic_refresh_token_test',
          grant_type: 'refresh_token',
        }),
      },
    );
    const bearerHeaders = { Authorization: 'Bearer refreshed_access_token_test' };
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://www.strava.com/api/v3/athlete/activities?per_page=5',
      { headers: bearerHeaders },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://www.strava.com/api/v3/athletes/123456/stats',
      { headers: bearerHeaders },
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
    expect(admin.__getWrites()).toEqual([{
      path: SECRET_PATH,
      data: {
        access_token: 'refreshed_access_token_test',
        refresh_token: 'refreshed_refresh_token_test',
        expires_at: 1_900_000_000,
        scope: 'read',
        updatedAt: expect.any(Object),
      },
      options: { merge: true },
    }]);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });
});

describe('Strava activity data failure boundary', () => {
  let fetchMock;
  let consoleSpies;

  const CONNECTION = Object.freeze({
    provider: 'strava',
    athleteId: 123456,
    firstName: 'Synthetic',
    lastName: 'Athlete',
    username: 'synthetic-athlete',
    profileUrl: 'https://images.example.test/synthetic-athlete.png',
  });
  const FRESH_SECRET = Object.freeze({
    access_token: 'fresh_access_token_test',
    refresh_token: 'synthetic_refresh_token_test',
    expires_at: 4_102_444_800,
    scope: 'read',
  });

  beforeEach(() => {
    process.env.STRAVA_CLIENT_ID = 'strava_client_test';
    process.env.STRAVA_CLIENT_SECRET = 'strava_secret_test';
    admin.__clearDocuments();
    admin.__clearReads();
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

  function seedFreshConnection() {
    admin.__setDocument(CONNECTION_PATH, CONNECTION);
    admin.__setDocument(SECRET_PATH, FRESH_SECRET);
  }

  function expectTwoFreshBearerReads() {
    const headers = { Authorization: 'Bearer fresh_access_token_test' };
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://www.strava.com/api/v3/athlete/activities?per_page=5',
      { headers },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://www.strava.com/api/v3/athletes/123456/stats',
      { headers },
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }

  function expectNoWritesOrLogs() {
    expect(admin.__getWrites()).toEqual([]);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  }

  test('does not read or expose a failed activities response body or status', async () => {
    seedFreshConnection();
    const text = jest.fn().mockResolvedValue(
      'provider-body-canary access_token=provider-secret-canary',
    );
    const activitiesJson = jest.fn();
    const statsJson = jest.fn().mockResolvedValue({});
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 599,
        text,
        json: activitiesJson,
      })
      .mockResolvedValueOnce({ ok: true, json: statsJson });

    const error = await captureFailure(() => stravaFetchStats({}, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'internal',
      message: FIXED_DATA_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(JSON.stringify(publicError(error)))
      .not.toMatch(/599|provider-body-canary|provider-secret-canary/i);
    expect(text).not.toHaveBeenCalled();
    expect(activitiesJson).not.toHaveBeenCalled();
    expect(statsJson).not.toHaveBeenCalled();
    expectTwoFreshBearerReads();
    expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
    expectNoWritesOrLogs();
  });

  test('turns an activities transport failure into one fixed unavailable result', async () => {
    seedFreshConnection();
    fetchMock
      .mockRejectedValueOnce(Object.assign(
        new Error('activities-transport-canary https://provider.example.test/?token=secret-canary'),
        { providerBody: 'provider-body-canary' },
      ))
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue({}) });

    const error = await captureFailure(() => stravaFetchStats({}, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'unavailable',
      message: FIXED_DATA_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(JSON.stringify(publicError(error)))
      .not.toMatch(/transport-canary|provider\.example|secret-canary|provider-body-canary/i);
    expectTwoFreshBearerReads();
    expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
    expectNoWritesOrLogs();
  });

  test('turns a statistics transport failure into one fixed unavailable result', async () => {
    seedFreshConnection();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue([]) })
      .mockRejectedValueOnce(Object.assign(
        new Error('stats-transport-canary https://provider.example.test/?token=secret-canary'),
        { providerBody: 'provider-body-canary' },
      ));

    const error = await captureFailure(() => stravaFetchStats({}, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'unavailable',
      message: FIXED_DATA_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(JSON.stringify(publicError(error)))
      .not.toMatch(/transport-canary|provider\.example|secret-canary|provider-body-canary/i);
    expectTwoFreshBearerReads();
    expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
    expectNoWritesOrLogs();
  });

  test('turns malformed activities JSON into one fixed unavailable result', async () => {
    seedFreshConnection();
    const activitiesJson = jest.fn().mockRejectedValue(
      new Error('activities-json-canary access_token=provider-secret-canary'),
    );
    const statsJson = jest.fn().mockResolvedValue({});
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: activitiesJson })
      .mockResolvedValueOnce({ ok: true, json: statsJson });

    const error = await captureFailure(() => stravaFetchStats({}, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'unavailable',
      message: FIXED_DATA_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(JSON.stringify(publicError(error)))
      .not.toMatch(/json-canary|provider-secret-canary/i);
    expect(activitiesJson).toHaveBeenCalledTimes(1);
    expect(statsJson).not.toHaveBeenCalled();
    expectTwoFreshBearerReads();
    expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
    expectNoWritesOrLogs();
  });

  test('turns malformed statistics JSON into one fixed unavailable result', async () => {
    seedFreshConnection();
    const activitiesJson = jest.fn().mockResolvedValue([]);
    const statsJson = jest.fn().mockRejectedValue(
      new Error('stats-json-canary access_token=provider-secret-canary'),
    );
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: activitiesJson })
      .mockResolvedValueOnce({ ok: true, json: statsJson });

    const error = await captureFailure(() => stravaFetchStats({}, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'unavailable',
      message: FIXED_DATA_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(JSON.stringify(publicError(error)))
      .not.toMatch(/json-canary|provider-secret-canary/i);
    expect(activitiesJson).toHaveBeenCalledTimes(1);
    expect(statsJson).toHaveBeenCalledTimes(1);
    expectTwoFreshBearerReads();
    expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
    expectNoWritesOrLogs();
  });

  test('preserves recent activities when optional statistics HTTP access fails', async () => {
    seedFreshConnection();
    const activitiesJson = jest.fn().mockResolvedValue([{
      id: 987654,
      name: 'Synthetic Morning Run',
      sport_type: 'Run',
      distance: 5000,
      moving_time: 1500,
      start_date: '2026-01-02T12:00:00Z',
    }]);
    const statsText = jest.fn().mockResolvedValue(
      'provider-body-canary access_token=provider-secret-canary',
    );
    const statsJson = jest.fn();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: activitiesJson })
      .mockResolvedValueOnce({
        ok: false,
        status: 599,
        text: statsText,
        json: statsJson,
      });

    const result = await stravaFetchStats({}, CONTEXT);

    expect(result).toEqual({
      connected: true,
      athlete: {
        id: 123456,
        firstName: 'Synthetic',
        lastName: 'Athlete',
        username: 'synthetic-athlete',
        profileUrl: 'https://images.example.test/synthetic-athlete.png',
      },
      recentActivities: [{
        id: 987654,
        name: 'Synthetic Morning Run',
        type: 'Run',
        distanceMeters: 5000,
        movingTimeSeconds: 1500,
        startDate: '2026-01-02T12:00:00Z',
      }],
      yearToDate: null,
      allTime: null,
    });
    expect(activitiesJson).toHaveBeenCalledTimes(1);
    expect(statsText).not.toHaveBeenCalled();
    expect(statsJson).not.toHaveBeenCalled();
    expectTwoFreshBearerReads();
    expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
    expectNoWritesOrLogs();
  });
});

describe('Strava disconnect failure log boundary', () => {
  let fetchMock;
  let consoleSpies;

  beforeEach(() => {
    admin.__clearDeletes();
    admin.__clearDocuments();
    admin.__clearReads();
    admin.__clearWrites();
    requireAppCheck.mockReset();
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    consoleSpies = Object.fromEntries(
      ['debug', 'error', 'info', 'log', 'warn']
        .map((method) => [
          method,
          jest.spyOn(console, method).mockImplementation(() => undefined),
        ]),
    );
  });

  afterEach(() => {
    global.fetch = GUARDED_FETCH;
    Object.values(consoleSpies).forEach((spy) => spy.mockRestore());
  });

  function seedAccessToken() {
    admin.__setDocument(SECRET_PATH, {
      access_token: 'synthetic_disconnect_access_token_test',
    });
  }

  function expectLocalDeletes() {
    expect(admin.__getDeletes()).toEqual([SECRET_PATH, CONNECTION_PATH]);
    expect(admin.__getWrites()).toEqual([]);
  }

  function expectNoLogs() {
    Object.values(consoleSpies).forEach((spy) => expect(spy).not.toHaveBeenCalled());
  }

  test('runs App Check before Auth, Firestore, provider access, or deletion', async () => {
    const appCheckFailure = new functions.https.HttpsError(
      'failed-precondition',
      'synthetic app check rejection',
    );
    requireAppCheck.mockImplementationOnce(() => {
      throw appCheckFailure;
    });

    await expect(stravaDisconnect({}, CONTEXT)).rejects.toBe(appCheckFailure);

    expect(requireAppCheck).toHaveBeenCalledWith(CONTEXT);
    expect(admin.__getReads()).toEqual([]);
    expect(admin.__getDeletes()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoLogs();
  });

  test('rejects a missing caller before Firestore, provider access, or deletion', async () => {
    await expect(stravaDisconnect({}, { ...CONTEXT, auth: null }))
      .rejects.toMatchObject({ code: 'unauthenticated' });

    expect(requireAppCheck).toHaveBeenCalledTimes(1);
    expect(admin.__getReads()).toEqual([]);
    expect(admin.__getDeletes()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoLogs();
  });

  test('skips provider access when no server-only token exists and still deletes locally', async () => {
    const result = await stravaDisconnect({}, CONTEXT);

    expect(result).toEqual({ ok: true });
    expect(admin.__getReads()).toEqual([SECRET_PATH]);
    expect(fetchMock).not.toHaveBeenCalled();
    expectLocalDeletes();
    expectNoLogs();
  });

  test('preserves the successful best-effort provider POST and local deletes', async () => {
    seedAccessToken();
    fetchMock.mockResolvedValue({ ok: true });

    const result = await stravaDisconnect({}, CONTEXT);

    expect(result).toEqual({ ok: true });
    expect(admin.__getReads()).toEqual([SECRET_PATH]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.strava.com/oauth/deauthorize',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer synthetic_disconnect_access_token_test' },
      },
    );
    expectLocalDeletes();
    expectNoLogs();
  });

  test('preserves current HTTP non-success handling without reading the provider body', async () => {
    seedAccessToken();
    const text = jest.fn().mockResolvedValue(
      'provider-body-canary access_token=provider-secret-canary',
    );
    const json = jest.fn();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 599,
      text,
      json,
    });

    const result = await stravaDisconnect({}, CONTEXT);

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(text).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expectLocalDeletes();
    expectNoLogs();
  });

  test('replaces a raw provider exception with one fixed warning before local deletes', async () => {
    seedAccessToken();
    fetchMock.mockRejectedValue(Object.assign(
      new Error('transport-canary https://provider.example.test/?token=secret-canary'),
      {
        cause: new Error('cause-canary'),
        details: 'details-canary',
        providerBody: 'provider-body-canary',
      },
    ));

    const result = await stravaDisconnect({}, CONTEXT);

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(consoleSpies.warn).toHaveBeenCalledTimes(1);
    expect(consoleSpies.warn).toHaveBeenCalledWith(FIXED_DISCONNECT_WARNING);
    expect(JSON.stringify(consoleSpies.warn.mock.calls))
      .not.toMatch(
        /transport-canary|provider\.example|secret-canary|cause-canary|details-canary|provider-body-canary/i,
      );
    ['debug', 'error', 'info', 'log']
      .forEach((method) => expect(consoleSpies[method]).not.toHaveBeenCalled());
    expectLocalDeletes();
  });

  test('preserves swallowed local delete failures and the current success result', async () => {
    admin.__setDeleteFailure(
      SECRET_PATH,
      new Error('synthetic secret delete failure'),
    );
    admin.__setDeleteFailure(
      CONNECTION_PATH,
      new Error('synthetic connection delete failure'),
    );

    const result = await stravaDisconnect({}, CONTEXT);

    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expectLocalDeletes();
    expectNoLogs();
  });
});
