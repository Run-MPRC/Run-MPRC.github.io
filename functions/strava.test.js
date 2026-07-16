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
        const exists = documents.has(path);
        const data = documents.get(path);
        return {
          exists,
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
  let dateNowSpy;

  const NOW_SECONDS = 1_800_000_000;

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
    admin.__clearDeletes();
    admin.__clearDocuments();
    admin.__clearReads();
    admin.__clearWrites();
    Timestamp.now.mockClear();
    requireAppCheck.mockReset();
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW_SECONDS * 1000);
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
  });

  afterEach(() => {
    global.fetch = GUARDED_FETCH;
    dateNowSpy.mockRestore();
    consoleSpies.forEach((spy) => spy.mockRestore());
    delete process.env.STRAVA_CLIENT_ID;
    delete process.env.STRAVA_CLIENT_SECRET;
  });

  function seedExpiredConnection() {
    admin.__setDocument(CONNECTION_PATH, CONNECTION);
    admin.__setDocument(SECRET_PATH, EXPIRED_SECRET);
  }

  function validStoredSecret() {
    return {
      access_token: 'stored_access_token_test',
      refresh_token: 'stored_refresh_token_test',
      expires_at: NOW_SECONDS + 61,
      scope: 'read',
    };
  }

  function seedStoredSecret(secret) {
    admin.__setDocument(CONNECTION_PATH, CONNECTION);
    admin.__setDocument(SECRET_PATH, secret);
  }

  function expectNoWritesOrLogs() {
    expect(admin.__getDeletes()).toEqual([]);
    expect(admin.__getWrites()).toEqual([]);
    expect(Timestamp.now).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  }

  function validRefreshResponse() {
    return {
      token_type: 'Bearer',
      access_token: 'refreshed_access_token_test',
      expires_at: 1_900_000_000,
      expires_in: 21_600,
      refresh_token: 'refreshed_refresh_token_test',
    };
  }

  function mockRefreshResponse(response) {
    const json = jest.fn().mockResolvedValue(response);
    fetchMock.mockResolvedValueOnce({ ok: true, json });
    return json;
  }

  function mockValidRefreshFlow(response = validRefreshResponse()) {
    const refreshJson = mockRefreshResponse(response);
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          ytd_run_totals: { distance: 0, count: 0 },
          ytd_ride_totals: { distance: 0, count: 0 },
          all_run_totals: { distance: 0, count: 0 },
        }),
      });
    return refreshJson;
  }

  function mockValidStatsFlow() {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          ytd_run_totals: { distance: 0, count: 0 },
          ytd_ride_totals: { distance: 0, count: 0 },
          all_run_totals: { distance: 0, count: 0 },
        }),
      });
  }

  async function expectInvalidSuccessfulRefresh(response) {
    seedExpiredConnection();
    const json = mockRefreshResponse(response);

    const error = await captureFailure(() => stravaFetchStats({}, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'internal',
      message: FIXED_REFRESH_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
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
    expect(json).toHaveBeenCalledTimes(1);
    expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
    expectNoWritesOrLogs();
  }

  async function expectInvalidStoredSecret(secret) {
    seedStoredSecret(secret);

    const error = await captureFailure(() => stravaFetchStats({}, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'internal',
      message: FIXED_REFRESH_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(JSON.stringify(publicError(error)))
      .not.toMatch(/stored-secret-canary|provider-secret-canary/i);
    expect(requireAppCheck).toHaveBeenCalledWith(CONTEXT);
    expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
    expect(dateNowSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoWritesOrLogs();
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

  describe('stored token validation before refresh or bearer use', () => {
    class StoredSecretClass {
      constructor() {
        Object.assign(this, validStoredSecret());
      }
    }

    test.each([
      ['undefined', undefined],
      ['null', null],
      ['a boolean', true],
      ['a number', 1],
      ['a string', 'stored-secret-canary'],
      ['a bigint', 1n],
      ['a symbol', Symbol('stored-secret-canary')],
      ['a function', () => validStoredSecret()],
      ['an array', []],
      ['a null-prototype record', Object.create(null)],
      ['a custom-prototype record', Object.create({ inherited: true })],
      ['a Date', new Date(0)],
      ['a class instance', new StoredSecretClass()],
    ])('rejects %s root before clock or provider access', async (_case, secret) => {
      await expectInvalidStoredSecret(secret);
    });

    test('rejects a transparent root Proxy without invoking any trap', async () => {
      const traps = {
        get: jest.fn(() => {
          throw new Error('stored-secret-canary root get trap');
        }),
        getOwnPropertyDescriptor: jest.fn(() => {
          throw new Error('stored-secret-canary root descriptor trap');
        }),
        getPrototypeOf: jest.fn(() => {
          throw new Error('stored-secret-canary root prototype trap');
        }),
        ownKeys: jest.fn(() => {
          throw new Error('stored-secret-canary root ownKeys trap');
        }),
      };
      const secret = new Proxy(validStoredSecret(), traps);

      await expectInvalidStoredSecret(secret);

      Object.values(traps).forEach((trap) => expect(trap).not.toHaveBeenCalled());
    });

    test('rejects a revoked root Proxy without reflection', async () => {
      const { proxy, revoke } = Proxy.revocable(validStoredSecret(), {});
      revoke();

      await expectInvalidStoredSecret(proxy);
    });

    const invalidStoredTokenValues = [
      ['missing', undefined, true],
      ['own undefined', undefined, false],
      ['null', null, false],
      ['empty', '', false],
      ['literal space', 'token canary', false],
      ['control', 'token\ncanary', false],
      ['non-ASCII', 'tökén', false],
      ['oversized', 'x'.repeat(MAX_TOKEN_LENGTH + 1), false],
      ['boxed', Object('boxed-token'), false],
      ['structured', { token: 'structured' }, false],
    ];

    test.each(
      ['access_token', 'refresh_token'].flatMap((field) => (
        invalidStoredTokenValues.map(([kind, value, remove]) => [
          field,
          kind,
          value,
          remove,
        ])
      )),
    )('rejects stored %s that is %s even on the branch that does not use it', async (
      field,
      _kind,
      value,
      remove,
    ) => {
      const secret = validStoredSecret();
      secret.expires_at = field === 'access_token' ? 1 : NOW_SECONDS + 61;
      if (remove) delete secret[field];
      else secret[field] = value;

      await expectInvalidStoredSecret(secret);
    });

    test.each([
      ['access_token', NOW_SECONDS + 61],
      ['refresh_token', 1],
    ])('rejects malformed stored %s on its directly used branch', async (
      field,
      expiresAt,
    ) => {
      const secret = validStoredSecret();
      secret[field] = { token: 'stored-secret-canary' };
      secret.expires_at = expiresAt;

      await expectInvalidStoredSecret(secret);
    });

    test.each([
      ['missing', undefined, true],
      ['own undefined', undefined, false],
      ['null', null, false],
      ['a string', String(NOW_SECONDS + 61), false],
      ['zero', 0, false],
      ['a negative integer', -1, false],
      ['a fraction', 1.5, false],
      ['positive infinity', Number.POSITIVE_INFINITY, false],
      ['not-a-number', Number.NaN, false],
      ['an unsafe integer', Number.MAX_SAFE_INTEGER + 1, false],
      ['a bigint', BigInt(NOW_SECONDS + 61), false],
      ['a symbol', Symbol('stored-secret-canary'), false],
      ['a boxed number', Object(NOW_SECONDS + 61), false],
    ])('rejects stored expires_at that is %s without coercion', async (
      _case,
      value,
      remove,
    ) => {
      const secret = validStoredSecret();
      if (remove) delete secret.expires_at;
      else secret.expires_at = value;

      await expectInvalidStoredSecret(secret);
    });

    test.each([
      ['access_token', 1],
      ['refresh_token', NOW_SECONDS + 61],
      ['expires_at', NOW_SECONDS + 61],
    ])('does not invoke a selected stored %s accessor', async (field, expiresAt) => {
      const secret = validStoredSecret();
      secret.expires_at = expiresAt;
      const selectedValue = secret[field];
      const getter = jest.fn(() => selectedValue);
      Object.defineProperty(secret, field, {
        configurable: true,
        enumerable: true,
        get: getter,
      });

      await expectInvalidStoredSecret(secret);

      expect(getter).not.toHaveBeenCalled();
    });

    test.each([
      ['access_token', 'stored_access_token_test', 1],
      ['refresh_token', 'stored_refresh_token_test', NOW_SECONDS + 61],
      ['expires_at', NOW_SECONDS + 61, NOW_SECONDS + 61],
    ])('does not consult an inherited stored %s value', async (
      field,
      inheritedValue,
      expiresAt,
    ) => {
      const secret = validStoredSecret();
      secret.expires_at = expiresAt;
      delete secret[field];
      const inheritedGetter = jest.fn(() => inheritedValue);
      Object.defineProperty(Object.prototype, field, {
        configurable: true,
        get: inheritedGetter,
      });

      try {
        await expectInvalidStoredSecret(secret);
      } finally {
        delete Object.prototype[field];
      }

      expect(inheritedGetter).not.toHaveBeenCalled();
    });

    test.each([
      ['access_token', 1],
      ['refresh_token', NOW_SECONDS + 61],
      ['expires_at', NOW_SECONDS + 61],
    ])('does not invoke stored %s coercion or JSON hooks', async (field, expiresAt) => {
      const hooks = {
        toJSON: jest.fn(() => 'stored-secret-canary'),
        toString: jest.fn(() => 'stored-secret-canary'),
        valueOf: jest.fn(() => NOW_SECONDS + 61),
        [Symbol.toPrimitive]: jest.fn(() => NOW_SECONDS + 61),
      };
      const secret = validStoredSecret();
      secret[field] = hooks;
      secret.expires_at = field === 'expires_at' ? hooks : expiresAt;

      await expectInvalidStoredSecret(secret);

      expect(hooks.toJSON).not.toHaveBeenCalled();
      expect(hooks.toString).not.toHaveBeenCalled();
      expect(hooks.valueOf).not.toHaveBeenCalled();
      expect(hooks[Symbol.toPrimitive]).not.toHaveBeenCalled();
    });

    test('ignores unknown stored getters and writes only refreshed credentials', async () => {
      const secret = validStoredSecret();
      secret.expires_at = 1;
      const unknownGetters = [
        ['scope', 'read'],
        ['updatedAt', { _seconds: 1 }],
        ['then', undefined],
        ['toJSON', () => ({ access_token: 'stored-secret-canary' })],
        ['provider_debug', 'stored-secret-canary'],
      ].map(([field, value]) => {
        const getter = jest.fn(() => value);
        Object.defineProperty(secret, field, {
          configurable: true,
          enumerable: true,
          get: getter,
        });
        return getter;
      });
      const symbolGetter = jest.fn(() => 'stored-secret-canary');
      Object.defineProperty(secret, Symbol('unknown'), {
        configurable: true,
        enumerable: true,
        get: symbolGetter,
      });
      seedStoredSecret(secret);
      mockValidRefreshFlow();

      await stravaFetchStats({}, CONTEXT);

      unknownGetters.forEach((getter) => expect(getter).not.toHaveBeenCalled());
      expect(symbolGetter).not.toHaveBeenCalled();
      expect(admin.__getWrites()).toEqual([{
        path: SECRET_PATH,
        data: {
          access_token: 'refreshed_access_token_test',
          refresh_token: 'refreshed_refresh_token_test',
          expires_at: 1_900_000_000,
          updatedAt: expect.any(Object),
        },
        options: { merge: true },
      }]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(dateNowSpy).toHaveBeenCalledTimes(1);
      expect(Timestamp.now).toHaveBeenCalledTimes(1);
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });

    test('refreshes at exactly 60 seconds using only the validated refresh token', async () => {
      const secret = validStoredSecret();
      secret.expires_at = NOW_SECONDS + 60;
      seedStoredSecret(secret);
      mockValidRefreshFlow();

      await stravaFetchStats({}, CONTEXT);

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://www.strava.com/api/v3/oauth/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: 'strava_client_test',
            client_secret: 'strava_secret_test',
            refresh_token: 'stored_refresh_token_test',
            grant_type: 'refresh_token',
          }),
        },
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(dateNowSpy).toHaveBeenCalledTimes(1);
      expect(Timestamp.now).toHaveBeenCalledTimes(1);
    });

    test('uses the exact validated access token with 61 seconds remaining', async () => {
      const secret = validStoredSecret();
      seedStoredSecret(secret);
      mockValidStatsFlow();

      await stravaFetchStats({}, CONTEXT);

      const headers = { Authorization: 'Bearer stored_access_token_test' };
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
      expect(admin.__getWrites()).toEqual([]);
      expect(dateNowSpy).toHaveBeenCalledTimes(1);
      expect(Timestamp.now).not.toHaveBeenCalled();
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });

    test('uses the fresh projection after the raw record mutates during clock access', async () => {
      const secret = validStoredSecret();
      seedStoredSecret(secret);
      dateNowSpy.mockImplementationOnce(() => {
        secret.access_token = 'mutated_access_token_test';
        secret.refresh_token = 'mutated_refresh_token_test';
        secret.expires_at = 1;
        return NOW_SECONDS * 1000;
      });
      mockValidStatsFlow();

      await stravaFetchStats({}, CONTEXT);

      const headers = { Authorization: 'Bearer stored_access_token_test' };
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
      expect(admin.__getWrites()).toEqual([]);
      expect(dateNowSpy).toHaveBeenCalledTimes(1);
      expect(Timestamp.now).not.toHaveBeenCalled();
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });

    test('uses the refresh projection after the raw record mutates during clock access', async () => {
      const secret = validStoredSecret();
      secret.expires_at = NOW_SECONDS + 60;
      seedStoredSecret(secret);
      dateNowSpy.mockImplementationOnce(() => {
        secret.access_token = 'mutated_access_token_test';
        secret.refresh_token = 'mutated_refresh_token_test';
        secret.expires_at = Number.MAX_SAFE_INTEGER;
        return NOW_SECONDS * 1000;
      });
      mockValidRefreshFlow();

      await stravaFetchStats({}, CONTEXT);

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://www.strava.com/api/v3/oauth/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: 'strava_client_test',
            client_secret: 'strava_secret_test',
            refresh_token: 'stored_refresh_token_test',
            grant_type: 'refresh_token',
          }),
        },
      );
      expect(admin.__getWrites()).toEqual([{
        path: SECRET_PATH,
        data: {
          access_token: 'refreshed_access_token_test',
          refresh_token: 'refreshed_refresh_token_test',
          expires_at: 1_900_000_000,
          updatedAt: expect.any(Object),
        },
        options: { merge: true },
      }]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(dateNowSpy).toHaveBeenCalledTimes(1);
      expect(Timestamp.now).toHaveBeenCalledTimes(1);
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });

    test.each([
      ['minimum', 'a', 'b'],
      ['maximum', 'a'.repeat(MAX_TOKEN_LENGTH), 'b'.repeat(MAX_TOKEN_LENGTH)],
    ])('accepts exact stored %s token bounds byte-for-byte', async (
      _case,
      accessToken,
      refreshToken,
    ) => {
      const secret = validStoredSecret();
      secret.access_token = accessToken;
      secret.refresh_token = refreshToken;
      secret.expires_at = Number.MAX_SAFE_INTEGER;
      seedStoredSecret(secret);
      mockValidStatsFlow();

      await stravaFetchStats({}, CONTEXT);

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://www.strava.com/api/v3/athlete/activities?per_page=5',
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(admin.__getWrites()).toEqual([]);
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });

    test('accepts frozen and non-enumerable selected stored data descriptors', async () => {
      const secret = validStoredSecret();
      ['access_token', 'refresh_token', 'expires_at'].forEach((field) => {
        Object.defineProperty(secret, field, {
          configurable: false,
          enumerable: false,
          value: secret[field],
          writable: false,
        });
      });
      Object.freeze(secret);
      seedStoredSecret(secret);
      mockValidStatsFlow();

      await stravaFetchStats({}, CONTEXT);

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://www.strava.com/api/v3/athlete/activities?per_page=5',
        { headers: { Authorization: 'Bearer stored_access_token_test' } },
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(admin.__getWrites()).toEqual([]);
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });
  });

  describe('successful refresh response validation', () => {
    test.each([
      ['undefined', undefined],
      ['null', null],
      ['a primitive', true],
      ['an array', []],
      ['a null-prototype record', Object.create(null)],
      ['a custom-prototype record', Object.create({ inherited: true })],
    ])('rejects %s root before timestamps, writes, downstream calls, or logs', async (
      _case,
      response,
    ) => {
      await expectInvalidSuccessfulRefresh(response);
    });

    test('rejects a transparent root Proxy after exactly one promise then lookup', async () => {
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
      const response = new Proxy(validRefreshResponse(), {
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

      await expectInvalidSuccessfulRefresh(response);

      expect(observedGetKeys).toEqual(['then']);
      Object.values(reflectionTraps).forEach((trap) => expect(trap).not.toHaveBeenCalled());
    });

    test('keeps a throwing first root then lookup inside the unavailable JSON boundary', async () => {
      seedExpiredConnection();
      const response = new Proxy(validRefreshResponse(), {
        get: (_target, key) => {
          if (key === 'then') {
            throw new Error('root-then-canary refresh_token=provider-secret-canary');
          }
          throw new Error('unexpected root Proxy read');
        },
      });
      const json = mockRefreshResponse(response);

      const error = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expect(publicError(error)).toEqual({
        code: 'unavailable',
        message: FIXED_REFRESH_ERROR,
        details: undefined,
        cause: undefined,
      });
      expect(JSON.stringify(publicError(error)))
        .not.toMatch(/root-then-canary|provider-secret/i);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(json).toHaveBeenCalledTimes(1);
      expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
      expectNoWritesOrLogs();
    });

    test.each([
      ['access_token', undefined, true],
      ['access_token', null, false],
      ['access_token', '', false],
      ['access_token', 'token canary', false],
      ['access_token', 'token\ncanary', false],
      ['access_token', 'tökén', false],
      ['access_token', 'x'.repeat(MAX_TOKEN_LENGTH + 1), false],
      ['access_token', Object('boxed-token'), false],
      ['access_token', { token: 'structured' }, false],
      ['refresh_token', undefined, true],
      ['refresh_token', null, false],
      ['refresh_token', '', false],
      ['refresh_token', 'token canary', false],
      ['refresh_token', 'token\rcanary', false],
      ['refresh_token', 'tökén', false],
      ['refresh_token', 'x'.repeat(MAX_TOKEN_LENGTH + 1), false],
      ['refresh_token', Object('boxed-token'), false],
      ['refresh_token', { token: 'structured' }, false],
    ])('rejects invalid required %s without coercion, writes, or use', async (
      field,
      value,
      remove,
    ) => {
      const response = validRefreshResponse();
      if (remove) delete response[field];
      else response[field] = value;

      await expectInvalidSuccessfulRefresh(response);
    });

    test.each([
      ['missing', undefined, true],
      ['null', null, false],
      ['a string', '1900000000', false],
      ['zero', 0, false],
      ['a negative integer', -1, false],
      ['a fraction', 1.5, false],
      ['positive infinity', Number.POSITIVE_INFINITY, false],
      ['not-a-number', Number.NaN, false],
      ['an unsafe integer', Number.MAX_SAFE_INTEGER + 1, false],
    ])('rejects expires_at that is %s without writes or use', async (
      _case,
      value,
      remove,
    ) => {
      const response = validRefreshResponse();
      if (remove) delete response.expires_at;
      else response.expires_at = value;

      await expectInvalidSuccessfulRefresh(response);
    });

    test.each([
      ['access_token'],
      ['refresh_token'],
      ['expires_at'],
    ])('does not invoke a selected %s accessor', async (field) => {
      const response = validRefreshResponse();
      const selectedValue = response[field];
      const selectedGetter = jest.fn(() => selectedValue);
      Object.defineProperty(response, field, {
        configurable: true,
        enumerable: true,
        get: selectedGetter,
      });

      await expectInvalidSuccessfulRefresh(response);

      expect(selectedGetter).not.toHaveBeenCalled();
    });

    test.each([
      ['access_token', 'refreshed_access_token_test'],
      ['refresh_token', 'refreshed_refresh_token_test'],
      ['expires_at', 1_900_000_000],
    ])('does not consult an inherited required %s getter', async (field, selectedValue) => {
      const response = validRefreshResponse();
      const inheritedGetter = jest.fn(() => selectedValue);
      delete response[field];
      Object.defineProperty(Object.prototype, field, {
        configurable: true,
        get: inheritedGetter,
      });

      try {
        await expectInvalidSuccessfulRefresh(response);
      } finally {
        delete Object.prototype[field];
      }

      expect(inheritedGetter).not.toHaveBeenCalled();
    });

    test('does not invoke selected token coercion hooks', async () => {
      const coercionHooks = {
        toString: jest.fn(() => 'refreshed_access_token_test'),
        valueOf: jest.fn(() => 'refreshed_access_token_test'),
        [Symbol.toPrimitive]: jest.fn(() => 'refreshed_access_token_test'),
      };
      const response = validRefreshResponse();
      response.access_token = coercionHooks;

      await expectInvalidSuccessfulRefresh(response);

      expect(coercionHooks.toString).not.toHaveBeenCalled();
      expect(coercionHooks.valueOf).not.toHaveBeenCalled();
      expect(coercionHooks[Symbol.toPrimitive]).not.toHaveBeenCalled();
    });

    test('does not invoke expires_at coercion hooks', async () => {
      const coercionHooks = {
        toString: jest.fn(() => '1900000000'),
        valueOf: jest.fn(() => 1_900_000_000),
        [Symbol.toPrimitive]: jest.fn(() => 1_900_000_000),
      };
      const response = validRefreshResponse();
      response.expires_at = coercionHooks;

      await expectInvalidSuccessfulRefresh(response);

      expect(coercionHooks.toString).not.toHaveBeenCalled();
      expect(coercionHooks.valueOf).not.toHaveBeenCalled();
      expect(coercionHooks[Symbol.toPrimitive]).not.toHaveBeenCalled();
    });

    test('ignores unknown hostile fields without enumeration or access', async () => {
      const unknownGetters = [
        ['token_type', 'Bearer'],
        ['expires_in', 21_600],
        ['scope', 'read'],
        ['provider_debug', 'private-provider-value'],
      ].map(([field, value]) => {
        const getter = jest.fn(() => value);
        return { field, getter };
      });
      const unknownSymbolGetter = jest.fn(() => {
        throw new Error('unknown-symbol-canary refresh_token=provider-secret-canary');
      });
      const response = validRefreshResponse();
      unknownGetters.forEach(({ field, getter }) => {
        Object.defineProperty(response, field, {
          configurable: true,
          enumerable: true,
          get: getter,
        });
      });
      Object.defineProperty(response, Symbol('unknown'), {
        configurable: true,
        enumerable: true,
        get: unknownSymbolGetter,
      });
      seedExpiredConnection();
      mockValidRefreshFlow(response);

      await stravaFetchStats({}, CONTEXT);

      unknownGetters.forEach(({ getter }) => expect(getter).not.toHaveBeenCalled());
      expect(unknownSymbolGetter).not.toHaveBeenCalled();
      expect(admin.__getWrites()).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(Timestamp.now).toHaveBeenCalledTimes(1);
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });

    test.each([
      ['minimum', 'a', 'b'],
      ['maximum', 'a'.repeat(MAX_TOKEN_LENGTH), 'b'.repeat(MAX_TOKEN_LENGTH)],
    ])('accepts exact %s token bounds byte-for-byte', async (
      _case,
      accessToken,
      refreshToken,
    ) => {
      const response = validRefreshResponse();
      response.access_token = accessToken;
      response.refresh_token = refreshToken;
      seedExpiredConnection();
      mockValidRefreshFlow(response);

      await stravaFetchStats({}, CONTEXT);

      expect(admin.__getWrites()[0].data).toMatchObject({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: response.expires_at,
      });
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://www.strava.com/api/v3/athlete/activities?per_page=5',
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      expect(Timestamp.now).toHaveBeenCalledTimes(1);
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });

    test('accepts frozen and non-enumerable selected own data descriptors', async () => {
      const response = validRefreshResponse();
      Object.defineProperty(response, 'access_token', {
        configurable: false,
        enumerable: false,
        value: response.access_token,
        writable: false,
      });
      Object.freeze(response);
      seedExpiredConnection();
      mockValidRefreshFlow(response);

      await stravaFetchStats({}, CONTEXT);

      expect(admin.__getWrites()[0].data).toMatchObject({
        access_token: 'refreshed_access_token_test',
        refresh_token: 'refreshed_refresh_token_test',
        expires_at: 1_900_000_000,
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(Timestamp.now).toHaveBeenCalledTimes(1);
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });

    test('persists an unchanged returned refresh token as the latest token', async () => {
      const response = validRefreshResponse();
      response.refresh_token = EXPIRED_SECRET.refresh_token;
      seedExpiredConnection();
      mockValidRefreshFlow(response);

      await stravaFetchStats({}, CONTEXT);

      expect(admin.__getWrites()[0].data).toMatchObject({
        access_token: 'refreshed_access_token_test',
        refresh_token: 'synthetic_refresh_token_test',
        expires_at: 1_900_000_000,
      });
      expect(admin.__getWrites()[0].data).not.toHaveProperty('scope');
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(Timestamp.now).toHaveBeenCalledTimes(1);
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });
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
        updatedAt: expect.any(Object),
      },
      options: { merge: true },
    }]);
    expect(admin.__getDeletes()).toEqual([]);
    expect(Timestamp.now).toHaveBeenCalledTimes(1);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });
});

describe('Strava activity data failure boundary', () => {
  let fetchMock;
  let consoleSpies;
  let dateNowSpy;

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
    admin.__clearDeletes();
    admin.__clearDocuments();
    admin.__clearReads();
    admin.__clearWrites();
    Timestamp.now.mockClear();
    requireAppCheck.mockReset();
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
  });

  afterEach(() => {
    global.fetch = GUARDED_FETCH;
    dateNowSpy.mockRestore();
    consoleSpies.forEach((spy) => spy.mockRestore());
    delete process.env.STRAVA_CLIENT_ID;
    delete process.env.STRAVA_CLIENT_SECRET;
  });

  function seedFreshConnection() {
    admin.__setDocument(CONNECTION_PATH, CONNECTION);
    admin.__setDocument(SECRET_PATH, FRESH_SECRET);
  }

  function validStoredConnection(overrides = {}) {
    return { ...CONNECTION, ...overrides };
  }

  function seedStoredConnection(connection) {
    admin.__setDocument(CONNECTION_PATH, connection);
    admin.__setDocument(SECRET_PATH, FRESH_SECRET);
  }

  function mockSuccessfulActivityData(onActivitiesRequest) {
    const activitiesJson = jest.fn().mockResolvedValue([]);
    const statsJson = jest.fn().mockResolvedValue({
      ytd_run_totals: { distance: 0, count: 0 },
      ytd_ride_totals: { distance: 0, count: 0 },
      all_run_totals: { distance: 0, count: 0 },
    });
    fetchMock
      .mockImplementationOnce(async () => {
        if (onActivitiesRequest) onActivitiesRequest();
        return { ok: true, json: activitiesJson };
      })
      .mockResolvedValueOnce({ ok: true, json: statsJson });
    return { activitiesJson, statsJson };
  }

  function expectTwoFreshBearerReads(athleteId = 123456) {
    const headers = { Authorization: 'Bearer fresh_access_token_test' };
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://www.strava.com/api/v3/athlete/activities?per_page=5',
      { headers },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `https://www.strava.com/api/v3/athletes/${athleteId}/stats`,
      { headers },
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }

  function expectNoWritesOrLogs() {
    expect(admin.__getWrites()).toEqual([]);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  }

  async function expectRejectedStoredConnection(connection) {
    seedStoredConnection(connection);

    const error = await captureFailure(() => stravaFetchStats({}, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'internal',
      message: FIXED_DATA_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(admin.__getReads()).toEqual([CONNECTION_PATH]);
    expect(admin.__getWrites()).toEqual([]);
    expect(admin.__getDeletes()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dateNowSpy).not.toHaveBeenCalled();
    expect(Timestamp.now).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  }

  describe('stored connection validation before secret or provider use', () => {
    class StoredConnection {
      constructor() {
        Object.assign(this, CONNECTION);
      }
    }

    test.each([
      ['undefined', undefined],
      ['null', null],
      ['a boolean', true],
      ['a number', 1],
      ['a string', 'strava'],
      ['a function', () => CONNECTION],
      ['an array', [CONNECTION]],
      ['a null-prototype record', Object.assign(Object.create(null), CONNECTION)],
      ['a custom-prototype record', Object.assign(Object.create({ inherited: true }), CONNECTION)],
      ['a Date', new Date(0)],
      ['a class instance', new StoredConnection()],
    ])('rejects %s root before the secret read', async (_case, connection) => {
      await expectRejectedStoredConnection(connection);
    });

    test('rejects a transparent root Proxy without invoking any trap', async () => {
      const traps = {
        get: jest.fn(() => {
          throw new Error('stored-connection-canary root get trap');
        }),
        getOwnPropertyDescriptor: jest.fn(() => {
          throw new Error('stored-connection-canary root descriptor trap');
        }),
        getPrototypeOf: jest.fn(() => {
          throw new Error('stored-connection-canary root prototype trap');
        }),
        ownKeys: jest.fn(() => {
          throw new Error('stored-connection-canary root ownKeys trap');
        }),
      };
      const connection = new Proxy(validStoredConnection(), traps);

      await expectRejectedStoredConnection(connection);

      Object.values(traps).forEach((trap) => expect(trap).not.toHaveBeenCalled());
    });

    test('rejects a revoked root Proxy without reflection', async () => {
      const { proxy, revoke } = Proxy.revocable(validStoredConnection(), {});
      revoke();

      await expectRejectedStoredConnection(proxy);
    });

    test.each([
      ['missing', undefined, true],
      ['undefined', undefined, false],
      ['null', null, false],
      ['empty', '', false],
      ['whitespace', ' strava ', false],
      ['wrong case', 'STRAVA', false],
      ['a boolean', true, false],
      ['a number', 1, false],
      ['boxed', Object('strava'), false],
      ['structured', { value: 'strava' }, false],
    ])('rejects provider that is %s before the secret read', async (_case, value, remove) => {
      const connection = validStoredConnection({ provider: value });
      if (remove) delete connection.provider;

      await expectRejectedStoredConnection(connection);
    });

    test.each([
      ['missing', undefined, true],
      ['undefined', undefined, false],
      ['null', null, false],
      ['zero', 0, false],
      ['negative', -1, false],
      ['fractional', 1.5, false],
      ['NaN', Number.NaN, false],
      ['positive infinity', Number.POSITIVE_INFINITY, false],
      ['unsafe', Number.MAX_SAFE_INTEGER + 1, false],
      ['a string', '123456', false],
      ['a boolean', true, false],
      ['a bigint', 123456n, false],
      ['a symbol', Symbol('stored-connection-canary'), false],
      ['boxed', Object(123456), false],
      ['structured', { id: 123456 }, false],
    ])('rejects athleteId that is %s before the secret read', async (
      _case,
      value,
      remove,
    ) => {
      const connection = validStoredConnection({ athleteId: value });
      if (remove) delete connection.athleteId;

      await expectRejectedStoredConnection(connection);
    });

    test.each([
      ['firstName', undefined],
      ['firstName', 1],
      ['firstName', 'line\nbreak'],
      ['lastName', undefined],
      ['lastName', '\ud800'],
      ['username', undefined],
      ['username', 'x'.repeat(MAX_PROFILE_TEXT_LENGTH + 1)],
      ['username', Object('boxed-username')],
      ['username', { value: 'structured-username' }],
    ])('rejects invalid optional %s without coercion', async (field, value) => {
      await expectRejectedStoredConnection(validStoredConnection({ [field]: value }));
    });

    test.each([
      ['a relative path', '/profile.png'],
      ['plain HTTP', 'http://images.example.test/profile.png'],
      ['credentials', 'https://user:pass@images.example.test/profile.png'],
      ['raw whitespace', 'https://images.example.test/profile image.png'],
      ['a backslash', 'https://images.example.test/profile\\image.png'],
      ['a malformed URL', 'https://'],
      ['an oversized URL', `https://images.example.test/${'x'.repeat(MAX_PROFILE_URL_LENGTH)}`],
      ['undefined', undefined],
      ['a number', 1],
      ['boxed text', Object('https://images.example.test/profile.png')],
    ])('rejects profileUrl with %s before the secret read', async (_case, profileUrl) => {
      await expectRejectedStoredConnection(validStoredConnection({ profileUrl }));
    });

    test.each([
      ['provider', 'strava'],
      ['athleteId', 123456],
      ['firstName', 'Synthetic'],
      ['lastName', 'Athlete'],
      ['username', 'synthetic-athlete'],
      ['profileUrl', 'https://images.example.test/synthetic-athlete.png'],
    ])('does not invoke a selected %s accessor', async (field, value) => {
      const getter = jest.fn(() => value);
      const connection = validStoredConnection();
      Object.defineProperty(connection, field, {
        configurable: true,
        enumerable: true,
        get: getter,
      });

      await expectRejectedStoredConnection(connection);

      expect(getter).not.toHaveBeenCalled();
    });

    test.each([
      ['provider', 'strava'],
      ['athleteId', 123456],
    ])('does not consult an inherited %s getter', async (field, value) => {
      const inheritedGetter = jest.fn(() => value);
      const connection = validStoredConnection();
      delete connection[field];
      Object.defineProperty(Object.prototype, field, {
        configurable: true,
        get: inheritedGetter,
      });

      try {
        await expectRejectedStoredConnection(connection);
      } finally {
        delete Object.prototype[field];
      }

      expect(inheritedGetter).not.toHaveBeenCalled();
    });

    test('ignores inherited optional getters instead of exposing their values', async () => {
      const fields = ['firstName', 'lastName', 'username', 'profileUrl'];
      const inheritedGetters = fields.map((field) => ({
        field,
        getter: jest.fn(() => `stored-connection-canary inherited ${field}`),
      }));
      const connection = validStoredConnection();
      fields.forEach((field) => delete connection[field]);
      inheritedGetters.forEach(({ field, getter }) => {
        Object.defineProperty(Object.prototype, field, {
          configurable: true,
          get: getter,
        });
      });

      try {
        seedStoredConnection(connection);
        mockSuccessfulActivityData();

        const result = await stravaFetchStats({}, CONTEXT);

        expect(result.athlete).toEqual({
          id: 123456,
          firstName: null,
          lastName: null,
          username: null,
          profileUrl: null,
        });
      } finally {
        fields.forEach((field) => delete Object.prototype[field]);
      }

      inheritedGetters.forEach(({ getter }) => expect(getter).not.toHaveBeenCalled());
      expectTwoFreshBearerReads();
      expectNoWritesOrLogs();
    });

    test.each([
      ['provider', 'strava'],
      ['athleteId', 123456],
      ['firstName', 'Synthetic'],
      ['profileUrl', 'https://images.example.test/synthetic-athlete.png'],
    ])('does not invoke %s coercion or JSON hooks', async (field, admittedValue) => {
      const hooks = {
        toJSON: jest.fn(() => admittedValue),
        toString: jest.fn(() => String(admittedValue)),
        valueOf: jest.fn(() => admittedValue),
        [Symbol.toPrimitive]: jest.fn(() => admittedValue),
      };

      await expectRejectedStoredConnection(validStoredConnection({ [field]: hooks }));

      expect(hooks.toJSON).not.toHaveBeenCalled();
      expect(hooks.toString).not.toHaveBeenCalled();
      expect(hooks.valueOf).not.toHaveBeenCalled();
      expect(hooks[Symbol.toPrimitive]).not.toHaveBeenCalled();
    });

    test.each([
      ['firstName', 'firstName', 'missing', undefined, true],
      ['firstName', 'firstName', 'null', null, false],
      ['firstName', 'firstName', 'empty', '', false],
      ['lastName', 'lastName', 'missing', undefined, true],
      ['lastName', 'lastName', 'null', null, false],
      ['lastName', 'lastName', 'empty', '', false],
      ['username', 'username', 'missing', undefined, true],
      ['username', 'username', 'null', null, false],
      ['username', 'username', 'empty', '', false],
      ['profileUrl', 'profileUrl', 'missing', undefined, true],
      ['profileUrl', 'profileUrl', 'null', null, false],
      ['profileUrl', 'profileUrl', 'empty', '', false],
    ])('projects optional %s to %s as null when %s', async (
      storedField,
      resultField,
      _case,
      value,
      remove,
    ) => {
      const connection = validStoredConnection({ [storedField]: value });
      if (remove) delete connection[storedField];
      seedStoredConnection(connection);
      mockSuccessfulActivityData();

      const result = await stravaFetchStats({}, CONTEXT);

      expect(result.athlete[resultField]).toBeNull();
      expectTwoFreshBearerReads(connection.athleteId);
      expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
      expectNoWritesOrLogs();
    });

    test('ignores unknown hostile fields without enumeration or access', async () => {
      const unknownGetters = ['connectedAt', 'updatedAt', 'debug', 'toJSON']
        .map((field) => ({
          field,
          getter: jest.fn(() => {
            throw new Error(`stored-connection-canary unknown ${field}`);
          }),
        }));
      const symbolGetter = jest.fn(() => {
        throw new Error('stored-connection-canary unknown symbol');
      });
      const connection = validStoredConnection();
      unknownGetters.forEach(({ field, getter }) => {
        Object.defineProperty(connection, field, {
          configurable: true,
          enumerable: true,
          get: getter,
        });
      });
      Object.defineProperty(connection, Symbol('unknown'), {
        configurable: true,
        enumerable: true,
        get: symbolGetter,
      });
      seedStoredConnection(connection);
      mockSuccessfulActivityData();

      const result = await stravaFetchStats({}, CONTEXT);

      expect(result.athlete).toEqual({
        id: 123456,
        firstName: 'Synthetic',
        lastName: 'Athlete',
        username: 'synthetic-athlete',
        profileUrl: 'https://images.example.test/synthetic-athlete.png',
      });
      unknownGetters.forEach(({ getter }) => expect(getter).not.toHaveBeenCalled());
      expect(symbolGetter).not.toHaveBeenCalled();
      expectNoWritesOrLogs();
    });

    test('preserves the copied primitive snapshot after the raw record mutates', async () => {
      const connection = validStoredConnection();
      seedStoredConnection(connection);
      mockSuccessfulActivityData(() => {
        Object.assign(connection, {
          athleteId: 999999,
          firstName: 'Mutated',
          lastName: 'Connection',
          username: 'mutated-connection',
          profileUrl: 'https://images.example.test/mutated.png',
        });
      });

      const result = await stravaFetchStats({}, CONTEXT);

      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://www.strava.com/api/v3/athletes/123456/stats',
        { headers: { Authorization: 'Bearer fresh_access_token_test' } },
      );
      expect(result.athlete).toEqual({
        id: 123456,
        firstName: 'Synthetic',
        lastName: 'Athlete',
        username: 'synthetic-athlete',
        profileUrl: 'https://images.example.test/synthetic-athlete.png',
      });
      expect(connection.athleteId).toBe(999999);
      expectNoWritesOrLogs();
    });

    test.each([
      ['minimum athlete ID', { athleteId: 1 }],
      ['maximum athlete ID', { athleteId: Number.MAX_SAFE_INTEGER }],
      ['valid Unicode text', {
        firstName: 'Zoë 🏃🏽‍♀️',
        lastName: '李',
        username: 'e\u0301 runner',
      }],
      ['exact text and URL bounds', {
        firstName: 'x'.repeat(MAX_PROFILE_TEXT_LENGTH),
        profileUrl: `https://images.example.test/${'p'.repeat(
          MAX_PROFILE_URL_LENGTH - 'https://images.example.test/'.length,
        )}`,
      }],
    ])('accepts %s without normalization', async (_case, overrides) => {
      const connection = validStoredConnection(overrides);
      seedStoredConnection(connection);
      mockSuccessfulActivityData();

      const result = await stravaFetchStats({}, CONTEXT);

      expect(result.athlete).toEqual({
        id: connection.athleteId,
        firstName: connection.firstName,
        lastName: connection.lastName,
        username: connection.username,
        profileUrl: connection.profileUrl,
      });
      expectTwoFreshBearerReads(connection.athleteId);
      expectNoWritesOrLogs();
    });

    test('accepts frozen non-enumerable own selected data descriptors', async () => {
      const connection = {};
      Object.entries(CONNECTION).forEach(([field, value]) => {
        Object.defineProperty(connection, field, {
          configurable: false,
          enumerable: false,
          value,
          writable: false,
        });
      });
      Object.freeze(connection);
      seedStoredConnection(connection);
      mockSuccessfulActivityData();

      const result = await stravaFetchStats({}, CONTEXT);

      expect(result.athlete).toEqual({
        id: 123456,
        firstName: 'Synthetic',
        lastName: 'Athlete',
        username: 'synthetic-athlete',
        profileUrl: 'https://images.example.test/synthetic-athlete.png',
      });
      expectTwoFreshBearerReads();
      expectNoWritesOrLogs();
    });
  });

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

  function seedStoredSecret(secret) {
    admin.__setDocument(SECRET_PATH, secret);
  }

  function seedAccessToken(accessToken = 'synthetic_disconnect_access_token_test') {
    seedStoredSecret({ access_token: accessToken });
  }

  function expectLocalDeletes() {
    expect(admin.__getDeletes()).toEqual([SECRET_PATH, CONNECTION_PATH]);
    expect(admin.__getWrites()).toEqual([]);
  }

  function expectNoLogs() {
    Object.values(consoleSpies).forEach((spy) => expect(spy).not.toHaveBeenCalled());
  }

  async function expectRejectedStoredSecret(secret) {
    seedStoredSecret(secret);

    const result = await stravaDisconnect({}, CONTEXT);

    expect(result).toEqual({ ok: true });
    expect(admin.__getReads()).toEqual([SECRET_PATH]);
    expect(fetchMock).not.toHaveBeenCalled();
    expectLocalDeletes();
    expectNoLogs();
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

  describe('stored disconnect token validation before provider use', () => {
    class DisconnectSecret {
      constructor() {
        this.access_token = 'synthetic_disconnect_access_token_test';
      }
    }

    test.each([
      ['undefined', undefined],
      ['null', null],
      ['a boolean', true],
      ['a number', 1],
      ['a string', 'synthetic_disconnect_access_token_test'],
      ['an array', ['synthetic_disconnect_access_token_test']],
      ['a null-prototype record', Object.assign(Object.create(null), {
        access_token: 'synthetic_disconnect_access_token_test',
      })],
      ['a custom-prototype record', Object.assign(Object.create({ inherited: true }), {
        access_token: 'synthetic_disconnect_access_token_test',
      })],
      ['a Date', new Date(0)],
      ['a class instance', new DisconnectSecret()],
    ])('rejects %s root without provider access and still deletes locally', async (
      _case,
      secret,
    ) => {
      await expectRejectedStoredSecret(secret);
    });

    test('rejects a transparent root Proxy without invoking any trap', async () => {
      const traps = {
        get: jest.fn(() => {
          throw new Error('disconnect-token-canary root get trap');
        }),
        getOwnPropertyDescriptor: jest.fn(() => {
          throw new Error('disconnect-token-canary root descriptor trap');
        }),
        getPrototypeOf: jest.fn(() => {
          throw new Error('disconnect-token-canary root prototype trap');
        }),
        ownKeys: jest.fn(() => {
          throw new Error('disconnect-token-canary root ownKeys trap');
        }),
      };
      const secret = new Proxy({
        access_token: 'synthetic_disconnect_access_token_test',
      }, traps);

      await expectRejectedStoredSecret(secret);

      Object.values(traps).forEach((trap) => expect(trap).not.toHaveBeenCalled());
    });

    test('rejects a revoked root Proxy without reflection', async () => {
      const { proxy, revoke } = Proxy.revocable({
        access_token: 'synthetic_disconnect_access_token_test',
      }, {});
      revoke();

      await expectRejectedStoredSecret(proxy);
    });

    test('does not invoke an access_token accessor', async () => {
      const getter = jest.fn(() => 'synthetic_disconnect_access_token_test');
      const secret = {};
      Object.defineProperty(secret, 'access_token', {
        configurable: true,
        enumerable: true,
        get: getter,
      });

      await expectRejectedStoredSecret(secret);

      expect(getter).not.toHaveBeenCalled();
    });

    test('does not consult an inherited access_token getter', async () => {
      const inheritedGetter = jest.fn(() => 'synthetic_disconnect_access_token_test');
      Object.defineProperty(Object.prototype, 'access_token', {
        configurable: true,
        get: inheritedGetter,
      });

      try {
        await expectRejectedStoredSecret({});
      } finally {
        delete Object.prototype.access_token;
      }

      expect(inheritedGetter).not.toHaveBeenCalled();
    });

    const invalidStoredTokens = [
      ['missing', undefined, true],
      ['own undefined', undefined, false],
      ['null', null, false],
      ['empty', '', false],
      ['literal space', 'token canary', false],
      ['control', 'token\ncanary', false],
      ['DEL control', String.fromCharCode(0x7f), false],
      ['non-ASCII', 'tökén', false],
      ['oversized', 'x'.repeat(MAX_TOKEN_LENGTH + 1), false],
      ['a boolean', true, false],
      ['a number', 1, false],
      ['a bigint', 1n, false],
      ['a symbol', Symbol('disconnect-token-canary'), false],
      ['boxed', Object('synthetic_disconnect_access_token_test'), false],
      ['structured', { token: 'synthetic_disconnect_access_token_test' }, false],
    ];

    test.each(invalidStoredTokens)(
      'rejects access_token that is %s without coercion or provider access',
      async (_case, value, remove) => {
        const secret = { access_token: 'synthetic_disconnect_access_token_test' };
        if (remove) delete secret.access_token;
        else secret.access_token = value;

        await expectRejectedStoredSecret(secret);
      },
    );

    test('does not invoke access_token coercion or JSON hooks', async () => {
      const hooks = {
        toJSON: jest.fn(() => 'disconnect-token-canary'),
        toString: jest.fn(() => 'disconnect-token-canary'),
        valueOf: jest.fn(() => 'disconnect-token-canary'),
        [Symbol.toPrimitive]: jest.fn(() => 'disconnect-token-canary'),
      };

      await expectRejectedStoredSecret({ access_token: hooks });

      expect(hooks.toJSON).not.toHaveBeenCalled();
      expect(hooks.toString).not.toHaveBeenCalled();
      expect(hooks.valueOf).not.toHaveBeenCalled();
      expect(hooks[Symbol.toPrimitive]).not.toHaveBeenCalled();
    });

    test('ignores unknown hostile fields without enumeration or access', async () => {
      const unknownGetters = ['refresh_token', 'expires_at', 'scope', 'updatedAt', 'toJSON']
        .map((field) => {
          const getter = jest.fn(() => {
            throw new Error(`disconnect-token-canary unknown ${field}`);
          });
          return { field, getter };
        });
      const symbolGetter = jest.fn(() => {
        throw new Error('disconnect-token-canary unknown symbol');
      });
      const secret = { access_token: 'synthetic_disconnect_access_token_test' };
      unknownGetters.forEach(({ field, getter }) => {
        Object.defineProperty(secret, field, {
          configurable: true,
          enumerable: true,
          get: getter,
        });
      });
      Object.defineProperty(secret, Symbol('unknown'), {
        configurable: true,
        enumerable: true,
        get: symbolGetter,
      });
      seedStoredSecret(secret);
      fetchMock.mockResolvedValue({ ok: true });

      const result = await stravaDisconnect({}, CONTEXT);

      expect(result).toEqual({ ok: true });
      unknownGetters.forEach(({ getter }) => expect(getter).not.toHaveBeenCalled());
      expect(symbolGetter).not.toHaveBeenCalled();
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

    test('uses the admitted primitive after the raw record mutates during provider dispatch', async () => {
      const secret = { access_token: 'synthetic_disconnect_access_token_test' };
      seedStoredSecret(secret);
      fetchMock.mockImplementation(async () => {
        secret.access_token = 'mutated_disconnect_access_token_test';
        return { ok: true };
      });

      const result = await stravaDisconnect({}, CONTEXT);

      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://www.strava.com/oauth/deauthorize',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer synthetic_disconnect_access_token_test' },
        },
      );
      expect(secret.access_token).toBe('mutated_disconnect_access_token_test');
      expectLocalDeletes();
      expectNoLogs();
    });

    test.each([
      ['minimum', 'a'],
      ['maximum', 'x'.repeat(MAX_TOKEN_LENGTH)],
    ])('accepts the exact %s token bound byte-for-byte', async (_case, accessToken) => {
      seedAccessToken(accessToken);
      fetchMock.mockResolvedValue({ ok: true });

      const result = await stravaDisconnect({}, CONTEXT);

      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://www.strava.com/oauth/deauthorize',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      expectLocalDeletes();
      expectNoLogs();
    });

    test('accepts a frozen non-enumerable own token data descriptor', async () => {
      const secret = {};
      Object.defineProperty(secret, 'access_token', {
        configurable: false,
        enumerable: false,
        value: 'synthetic_disconnect_access_token_test',
        writable: false,
      });
      Object.freeze(secret);
      seedStoredSecret(secret);
      fetchMock.mockResolvedValue({ ok: true });

      const result = await stravaDisconnect({}, CONTEXT);

      expect(result).toEqual({ ok: true });
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
