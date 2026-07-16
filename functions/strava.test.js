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
      now: jest.fn(() => ({ _seconds: tick += 1 })),
    },
  };
});

jest.mock('./stripeHelpers', () => ({
  requireAppCheck: jest.fn(),
}));

const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { Timestamp } = require('firebase-admin/firestore');
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
const MAX_TOKEN_LENGTH = 2_048;
const MAX_SCOPE_LENGTH = 1_024;
const MAX_PROFILE_TEXT_LENGTH = 1_024;
const MAX_PROFILE_URL_LENGTH = 2_048;
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
    Timestamp.now.mockClear();
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
    expect(Timestamp.now).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  }

  function validExchangeResponse() {
    return {
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
    };
  }

  function mockExchangeResponse(response) {
    const json = jest.fn().mockResolvedValue(response);
    fetchMock.mockResolvedValue({
      ok: true,
      json,
    });
    return json;
  }

  function mockSuccessfulExchange() {
    return mockExchangeResponse(validExchangeResponse());
  }

  async function expectInvalidSuccessfulResponse(response) {
    const json = mockExchangeResponse(response);

    const error = await captureFailure(() => stravaExchangeCode({ code: CODE }, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'internal',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledTimes(1);
    expectNoSideEffects();
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

  describe('successful provider response validation', () => {
    test.each([
      ['undefined', undefined],
      ['null', null],
      ['a primitive', true],
      ['an array', []],
      ['a null-prototype record', Object.create(null)],
      ['a custom-prototype record', Object.create({ inherited: true })],
    ])('rejects %s root before timestamps, Firestore, or logs', async (_case, response) => {
      await expectInvalidSuccessfulResponse(response);
    });

    test('rejects a transparent root Proxy before validator-controlled reflection', async () => {
      const observedGetKeys = [];
      const secondThenFailure = new Error(
        'second-then-canary access_token=provider-secret-canary',
      );
      const reflectionTraps = {
        getOwnPropertyDescriptor: jest.fn(() => {
          throw new Error('root descriptor trap must not run');
        }),
        getPrototypeOf: jest.fn(() => {
          throw new Error('root prototype trap must not run');
        }),
        ownKeys: jest.fn(() => {
          throw new Error('root ownKeys trap must not run');
        }),
      };
      const response = new Proxy(validExchangeResponse(), {
        get: (_target, key) => {
          observedGetKeys.push(key);
          if (key !== 'then') {
            throw new Error(`unexpected root Proxy read: ${String(key)}`);
          }
          if (observedGetKeys.length > 1) throw secondThenFailure;
          return undefined;
        },
        ...reflectionTraps,
      });

      await expectInvalidSuccessfulResponse(response);

      expect(observedGetKeys).toEqual(['then']);
      Object.values(reflectionTraps).forEach((trap) => expect(trap).not.toHaveBeenCalled());
    });

    test('keeps a throwing root then trap inside the existing unavailable JSON boundary', async () => {
      const thenFailure = new Error('root-then-canary access_token=provider-secret-canary');
      const response = new Proxy(validExchangeResponse(), {
        get: (_target, key) => {
          if (key === 'then') throw thenFailure;
          throw new Error('unexpected root Proxy read');
        },
      });
      mockExchangeResponse(response);

      const error = await captureFailure(() => stravaExchangeCode({ code: CODE }, CONTEXT));

      expect(publicError(error)).toEqual({
        code: 'unavailable',
        message: FIXED_AUTHORIZATION_ERROR,
        details: undefined,
        cause: undefined,
      });
      expect(JSON.stringify(publicError(error))).not.toMatch(/root-then-canary|provider-secret/i);
      expectNoSideEffects();
    });

    test.each([
      ['access_token', undefined, true],
      ['access_token', null, false],
      ['access_token', '', false],
      ['access_token', 'token\ncanary', false],
      ['access_token', 'tökén', false],
      ['access_token', 'x'.repeat(MAX_TOKEN_LENGTH + 1), false],
      ['access_token', Object('boxed-token'), false],
      ['refresh_token', undefined, true],
      ['refresh_token', null, false],
      ['refresh_token', '', false],
      ['refresh_token', 'token\rcanary', false],
      ['refresh_token', 'tökén', false],
      ['refresh_token', 'x'.repeat(MAX_TOKEN_LENGTH + 1), false],
      ['refresh_token', { token: 'structured' }, false],
    ])('rejects invalid required %s value without coercion or writes', async (
      field,
      value,
      remove,
    ) => {
      const response = validExchangeResponse();
      if (remove) delete response[field];
      else response[field] = value;

      await expectInvalidSuccessfulResponse(response);
    });

    test.each([
      ['expires_at', undefined, true],
      ['expires_at', null, false],
      ['expires_at', '1900000000', false],
      ['expires_at', 0, false],
      ['expires_at', -1, false],
      ['expires_at', 1.5, false],
      ['expires_at', Number.MAX_SAFE_INTEGER + 1, false],
      ['athlete.id', undefined, true],
      ['athlete.id', null, false],
      ['athlete.id', '123456', false],
      ['athlete.id', 0, false],
      ['athlete.id', -1, false],
      ['athlete.id', 1.5, false],
      ['athlete.id', Number.MAX_SAFE_INTEGER + 1, false],
    ])('rejects invalid positive-safe-integer %s without writes', async (
      field,
      value,
      remove,
    ) => {
      const response = validExchangeResponse();
      const target = field === 'athlete.id' ? response.athlete : response;
      const key = field === 'athlete.id' ? 'id' : field;
      if (remove) delete target[key];
      else target[key] = value;

      await expectInvalidSuccessfulResponse(response);
    });

    test.each([
      ['missing', undefined, true],
      ['null', null, false],
      ['exact empty', '', false],
    ])('preserves %s scope as unknown null without inferring permission', async (
      _case,
      scope,
      remove,
    ) => {
      const response = validExchangeResponse();
      if (remove) delete response.scope;
      else response.scope = scope;
      mockExchangeResponse(response);

      const result = await stravaExchangeCode({ code: CODE }, CONTEXT);

      expect(result).toEqual({ ok: true, athleteId: 123456 });
      expect(admin.__getWrites()[0].data.scope).toBeNull();
      expect(Timestamp.now).toHaveBeenCalledTimes(3);
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });

    test.each([
      ['a number', 1],
      ['leading whitespace', ' read'],
      ['trailing whitespace', 'read '],
      ['repeated separators', 'read  activity:read'],
      ['a quote', 'read"activity:read'],
      ['a backslash', 'read\\activity:read'],
      ['a control', 'read\nactivity:read'],
      ['an oversized value', 'r'.repeat(MAX_SCOPE_LENGTH + 1)],
    ])('rejects present scope with %s without making an entitlement decision', async (
      _case,
      scope,
    ) => {
      const response = validExchangeResponse();
      response.scope = scope;

      await expectInvalidSuccessfulResponse(response);
    });

    test.each([
      ['a null athlete', null],
      ['an array athlete', []],
      ['a custom-prototype athlete', Object.create({ inherited: true })],
    ])('rejects %s before nested field access', async (_case, athlete) => {
      const response = validExchangeResponse();
      response.athlete = athlete;

      await expectInvalidSuccessfulResponse(response);
    });

    test('rejects a nested athlete Proxy without invoking any trap', async () => {
      const traps = ['get', 'getOwnPropertyDescriptor', 'getPrototypeOf', 'ownKeys']
        .reduce((result, name) => ({
          ...result,
          [name]: jest.fn(() => {
            throw new Error(`nested athlete ${name} trap must not run`);
          }),
        }), {});
      const response = validExchangeResponse();
      response.athlete = new Proxy(response.athlete, traps);

      await expectInvalidSuccessfulResponse(response);

      Object.values(traps).forEach((trap) => expect(trap).not.toHaveBeenCalled());
    });

    test.each([
      ['firstname', 1],
      ['firstname', 'line\nbreak'],
      ['lastname', '\ud800'],
      ['username', 'x'.repeat(MAX_PROFILE_TEXT_LENGTH + 1)],
      ['username', Object('boxed-username')],
    ])('rejects invalid optional %s without coercion or partial writes', async (field, value) => {
      const response = validExchangeResponse();
      response.athlete[field] = value;

      await expectInvalidSuccessfulResponse(response);
    });

    test.each([
      ['a relative path', '/profile.png'],
      ['plain HTTP', 'http://images.example.test/profile.png'],
      ['credentials', 'https://user:pass@images.example.test/profile.png'],
      ['raw whitespace', 'https://images.example.test/profile image.png'],
      ['a backslash', 'https://images.example.test/profile\\image.png'],
      ['a malformed URL', 'https://'],
      ['an oversized URL', `https://images.example.test/${'x'.repeat(MAX_PROFILE_URL_LENGTH)}`],
    ])('rejects profile URL with %s before writes', async (_case, profile) => {
      const response = validExchangeResponse();
      response.athlete.profile = profile;

      await expectInvalidSuccessfulResponse(response);
    });

    test.each([
      ['access_token', 'root', 'access_token'],
      ['refresh_token', 'root', 'refresh_token'],
      ['expires_at', 'root', 'expires_at'],
      ['scope', 'root', 'scope'],
      ['athlete', 'root', 'athlete'],
      ['athlete.id', 'athlete', 'id'],
      ['athlete.firstname', 'athlete', 'firstname'],
      ['athlete.lastname', 'athlete', 'lastname'],
      ['athlete.username', 'athlete', 'username'],
      ['athlete.profile', 'athlete', 'profile'],
    ])('does not invoke a selected %s accessor', async (_path, targetName, key) => {
      const response = validExchangeResponse();
      const target = targetName === 'root' ? response : response.athlete;
      const selectedGetter = jest.fn(() => target[key]);
      Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        get: selectedGetter,
      });

      await expectInvalidSuccessfulResponse(response);

      expect(selectedGetter).not.toHaveBeenCalled();
    });

    test('does not consult an inherited required-field getter', async () => {
      const inheritedGetter = jest.fn(() => 'access_token_test');
      const response = validExchangeResponse();
      delete response.access_token;
      Object.defineProperty(Object.prototype, 'access_token', {
        configurable: true,
        get: inheritedGetter,
      });

      try {
        await expectInvalidSuccessfulResponse(response);
      } finally {
        delete Object.prototype.access_token;
      }

      expect(inheritedGetter).not.toHaveBeenCalled();
    });

    test('ignores an inherited optional-field value', async () => {
      const response = validExchangeResponse();
      delete response.athlete.firstname;
      Object.defineProperty(Object.prototype, 'firstname', {
        configurable: true,
        value: 'Inherited',
      });

      try {
        mockExchangeResponse(response);
        const result = await stravaExchangeCode({ code: CODE }, CONTEXT);

        expect(result).toEqual({ ok: true, athleteId: 123456 });
        expect(admin.__getWrites()[1].data.firstName).toBeNull();
        expect(Timestamp.now).toHaveBeenCalledTimes(3);
        consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
      } finally {
        delete Object.prototype.firstname;
      }
    });

    test('does not invoke selected token coercion hooks', async () => {
      const coercionHooks = {
        toString: jest.fn(() => 'access_token_test'),
        valueOf: jest.fn(() => 'access_token_test'),
        [Symbol.toPrimitive]: jest.fn(() => 'access_token_test'),
      };
      const response = validExchangeResponse();
      response.access_token = coercionHooks;

      await expectInvalidSuccessfulResponse(response);

      expect(coercionHooks.toString).not.toHaveBeenCalled();
      expect(coercionHooks.valueOf).not.toHaveBeenCalled();
      expect(coercionHooks[Symbol.toPrimitive]).not.toHaveBeenCalled();
    });

    test.each([
      ['firstname', 'firstName', 'missing', undefined, true],
      ['firstname', 'firstName', 'null', null, false],
      ['firstname', 'firstName', 'exact empty', '', false],
      ['lastname', 'lastName', 'missing', undefined, true],
      ['lastname', 'lastName', 'null', null, false],
      ['lastname', 'lastName', 'exact empty', '', false],
      ['username', 'username', 'missing', undefined, true],
      ['username', 'username', 'null', null, false],
      ['username', 'username', 'exact empty', '', false],
      ['profile', 'profileUrl', 'missing', undefined, true],
      ['profile', 'profileUrl', 'null', null, false],
      ['profile', 'profileUrl', 'exact empty', '', false],
    ])('projects optional athlete.%s to %s as null when %s', async (
      providerField,
      documentField,
      _case,
      value,
      remove,
    ) => {
      const response = validExchangeResponse();
      if (remove) delete response.athlete[providerField];
      else response.athlete[providerField] = value;
      mockExchangeResponse(response);

      const result = await stravaExchangeCode({ code: CODE }, CONTEXT);

      expect(result).toEqual({ ok: true, athleteId: 123456 });
      expect(admin.__getWrites()[1].data[documentField]).toBeNull();
      expect(Timestamp.now).toHaveBeenCalledTimes(3);
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });

    test('preserves valid Unicode profile text, scope bytes, and HTTPS URL exactly', async () => {
      const response = validExchangeResponse();
      response.scope = 'future:Read,Variant read activity:read activity:read';
      response.athlete.firstname = 'Zoë 🏃🏽‍♀️';
      response.athlete.lastname = '李';
      response.athlete.username = 'e\u0301 runner';
      response.athlete.profile = 'https://例え.example/athlete/%E2%98%83?size=large#profile';
      mockExchangeResponse(response);

      const result = await stravaExchangeCode({ code: CODE }, CONTEXT);

      expect(result).toEqual({ ok: true, athleteId: 123456 });
      expect(admin.__getWrites()[0].data.scope).toBe(response.scope);
      expect(admin.__getWrites()[1].data).toMatchObject({
        firstName: response.athlete.firstname,
        lastName: response.athlete.lastname,
        username: response.athlete.username,
        profileUrl: response.athlete.profile,
      });
      expect(Timestamp.now).toHaveBeenCalledTimes(3);
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });

    test('accepts exact technical string bounds without normalization', async () => {
      const response = validExchangeResponse();
      const profilePrefix = 'https://images.example.test/';
      response.access_token = 'a'.repeat(MAX_TOKEN_LENGTH);
      response.refresh_token = 'b'.repeat(MAX_TOKEN_LENGTH);
      response.scope = 'r'.repeat(MAX_SCOPE_LENGTH);
      response.athlete.firstname = 'Z'.repeat(MAX_PROFILE_TEXT_LENGTH);
      response.athlete.profile = profilePrefix
        + 'p'.repeat(MAX_PROFILE_URL_LENGTH - profilePrefix.length);
      mockExchangeResponse(response);

      const result = await stravaExchangeCode({ code: CODE }, CONTEXT);

      expect(result).toEqual({ ok: true, athleteId: 123456 });
      expect(admin.__getWrites()[0].data).toMatchObject({
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        scope: response.scope,
      });
      expect(admin.__getWrites()[1].data).toMatchObject({
        firstName: response.athlete.firstname,
        profileUrl: response.athlete.profile,
      });
      expect(Timestamp.now).toHaveBeenCalledTimes(3);
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });

    test('accepts frozen JSON-shaped selected data descriptors', async () => {
      const response = validExchangeResponse();
      Object.freeze(response.athlete);
      Object.freeze(response);
      mockExchangeResponse(response);

      const result = await stravaExchangeCode({ code: CODE }, CONTEXT);

      expect(result).toEqual({ ok: true, athleteId: 123456 });
      expect(admin.__getWrites()).toHaveLength(2);
      expect(Timestamp.now).toHaveBeenCalledTimes(3);
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });

    test('accepts non-enumerable selected own data descriptors', async () => {
      const response = validExchangeResponse();
      Object.defineProperty(response, 'access_token', {
        configurable: false,
        enumerable: false,
        value: response.access_token,
        writable: false,
      });
      Object.defineProperty(response.athlete, 'firstname', {
        configurable: false,
        enumerable: false,
        value: response.athlete.firstname,
        writable: false,
      });
      mockExchangeResponse(response);

      const result = await stravaExchangeCode({ code: CODE }, CONTEXT);

      expect(result).toEqual({ ok: true, athleteId: 123456 });
      expect(admin.__getWrites()[0].data.access_token).toBe('access_token_test');
      expect(admin.__getWrites()[1].data.firstName).toBe('Synthetic');
      expect(Timestamp.now).toHaveBeenCalledTimes(3);
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });

    test('ignores unknown hostile fields without enumeration or access', async () => {
      const unknownGetter = jest.fn(() => {
        throw new Error('unknown-field-canary access_token=provider-secret-canary');
      });
      const unknownSymbolGetter = jest.fn(() => {
        throw new Error('unknown-symbol-canary refresh_token=provider-secret-canary');
      });
      const response = validExchangeResponse();
      Object.defineProperty(response, 'provider_debug', {
        configurable: true,
        enumerable: true,
        get: unknownGetter,
      });
      Object.defineProperty(response.athlete, Symbol('unknown'), {
        configurable: true,
        enumerable: true,
        get: unknownSymbolGetter,
      });
      mockExchangeResponse(response);

      const result = await stravaExchangeCode({ code: CODE }, CONTEXT);

      expect(result).toEqual({ ok: true, athleteId: 123456 });
      expect(unknownGetter).not.toHaveBeenCalled();
      expect(unknownSymbolGetter).not.toHaveBeenCalled();
      expect(admin.__getWrites()).toHaveLength(2);
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });
  });

  test('preserves the successful server-only exchange, writes, and minimal result', async () => {
    const json = mockSuccessfulExchange();

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
    expect(json).toHaveBeenCalledTimes(1);
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
    expect(admin.__getReads()).toEqual([]);
    expect(admin.__getDeletes()).toEqual([]);
    expect(Timestamp.now).toHaveBeenCalledTimes(3);
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
