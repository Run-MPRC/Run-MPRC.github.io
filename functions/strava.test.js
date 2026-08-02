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
  let batchCommitFailure;
  let batchCommitPostApplyFailure;
  let batchCreateAttempts = 0;
  let batchCreationFailure;
  const batchCommitAttempts = [];
  const batchDeleteAttempts = [];
  const batchDeleteFailures = new Map();
  const batchDeletes = [];
  const batchSetAttempts = [];
  const batchSetFailures = new Map();
  const deleteFailures = new Map();
  const deletes = [];
  const directSetAttempts = [];
  const directSetPostApplyFailures = new Map();
  const documentReferenceFailures = new Map();
  const documents = new Map();
  const documentVersions = new Map();
  const readFailures = new Map();
  const readSnapshots = new Map();
  const reads = [];
  let transactionCommitFailure;
  let transactionCommitPostApplyFailure;
  const transactionCommitAttempts = [];
  const transactionDeleteAttempts = [];
  const transactionDeleteFailures = new Map();
  const transactionDeletes = [];
  const transactionGetFailures = new Map();
  const transactionReads = [];
  const transactionSetAttempts = [];
  const transactionSetFailures = new Map();
  const transactionSets = [];
  let transactionBeforeCommitHook;
  let transactionRetryHook;
  let transactionRunAttempts = 0;
  let transactionRunFailure;
  const writeFailures = new Map();
  const writes = [];

  function bumpVersion(path) {
    documentVersions.set(path, (documentVersions.get(path) || 0) + 1);
  }

  function applyDelete(path) {
    documents.delete(path);
    bumpVersion(path);
  }

  function applyWrite(operation) {
    writes.push(operation);
    if (operation.options === undefined) {
      documents.set(operation.path, operation.data);
      bumpVersion(operation.path);
    }
  }

  function applyTransactionSet(operation) {
    transactionSets.push(operation);
    writes.push(operation);
    if (operation.options && operation.options.merge === true) {
      const current = documents.get(operation.path);
      const currentDescriptors = current && typeof current === 'object'
        ? Object.getOwnPropertyDescriptors(current)
        : {};
      const updateDescriptors = Object.getOwnPropertyDescriptors(operation.data);
      Reflect.ownKeys(updateDescriptors).forEach((key) => {
        delete currentDescriptors[key];
      });
      documents.set(operation.path, Object.create(
        current && typeof current === 'object' ? Object.getPrototypeOf(current) : Object.prototype,
        { ...currentDescriptors, ...updateDescriptors },
      ));
    } else {
      documents.set(operation.path, operation.data);
    }
    bumpVersion(operation.path);
  }

  function document(path) {
    if (documentReferenceFailures.has(path)) {
      throw documentReferenceFailures.get(path);
    }
    return {
      path,
      collection: (name) => ({
        doc: (id) => document(`${path}/${name}/${id}`),
      }),
      delete: async () => {
        deletes.push(path);
        if (deleteFailures.has(path)) {
          throw deleteFailures.get(path);
        }
        applyDelete(path);
      },
      get: async () => {
        reads.push(path);
        if (readFailures.has(path)) {
          throw readFailures.get(path);
        }
        if (readSnapshots.has(path)) {
          return readSnapshots.get(path);
        }
        const exists = documents.has(path);
        const data = documents.get(path);
        return {
          exists,
          data: () => data,
        };
      },
      set: async (data, options) => {
        const operation = { path, data, options };
        directSetAttempts.push(operation);
        if (writeFailures.has(path)) {
          throw writeFailures.get(path);
        }
        applyWrite(operation);
        if (directSetPostApplyFailures.has(path)) {
          if (options && options.merge === true) {
            documents.set(path, {
              ...(documents.get(path) || {}),
              ...data,
            });
            bumpVersion(path);
          }
          throw directSetPostApplyFailures.get(path);
        }
      },
    };
  }

  function firestore() {
    return {
      batch: () => {
        batchCreateAttempts += 1;
        if (batchCreationFailure) {
          throw batchCreationFailure;
        }
        const staged = [];
        const batch = {
          delete: (ref) => {
            const operation = { type: 'delete', path: ref.path };
            batchDeleteAttempts.push(ref.path);
            if (batchDeleteFailures.has(ref.path)) {
              throw batchDeleteFailures.get(ref.path);
            }
            staged.push(operation);
            return batch;
          },
          set: (ref, data, options) => {
            const operation = { path: ref.path, data, options };
            batchSetAttempts.push(operation);
            if (batchSetFailures.has(ref.path)) {
              throw batchSetFailures.get(ref.path);
            }
            staged.push(operation);
            return batch;
          },
          commit: async () => {
            batchCommitAttempts.push([...staged]);
            if (batchCommitFailure) {
              throw batchCommitFailure;
            }
            for (const operation of staged) {
              if (operation.type !== 'delete' && writeFailures.has(operation.path)) {
                throw writeFailures.get(operation.path);
              }
            }
            staged.forEach((operation) => {
              if (operation.type === 'delete') {
                batchDeletes.push(operation.path);
                applyDelete(operation.path);
              } else {
                applyWrite(operation);
              }
            });
            if (batchCommitPostApplyFailure) {
              throw batchCommitPostApplyFailure;
            }
          },
        };
        return batch;
      },
      runTransaction: async (updateFunction) => {
        transactionRunAttempts += 1;
        if (transactionRunFailure) throw transactionRunFailure;

        for (let attempt = 0; attempt < 5; attempt += 1) {
          const readVersions = new Map();
          const stagedDeletes = [];
          const stagedSets = [];
          const transaction = {
            get: async (ref) => {
              transactionReads.push(ref.path);
              if (transactionGetFailures.has(ref.path)) {
                throw transactionGetFailures.get(ref.path);
              }
              const version = documentVersions.get(ref.path) || 0;
              const exists = documents.has(ref.path);
              const data = documents.get(ref.path);
              readVersions.set(ref.path, version);
              return {
                exists,
                data: () => data,
              };
            },
            delete: (ref) => {
              transactionDeleteAttempts.push(ref.path);
              if (transactionDeleteFailures.has(ref.path)) {
                throw transactionDeleteFailures.get(ref.path);
              }
              stagedDeletes.push(ref.path);
              return transaction;
            },
            set: (ref, data, options) => {
              const operation = { path: ref.path, data, options };
              transactionSetAttempts.push(operation);
              if (transactionSetFailures.has(ref.path)) {
                throw transactionSetFailures.get(ref.path);
              }
              stagedSets.push(operation);
              return transaction;
            },
          };

          const result = await updateFunction(transaction);
          transactionCommitAttempts.push([...stagedDeletes]);
          if (transactionCommitFailure) throw transactionCommitFailure;
          if (transactionBeforeCommitHook) await transactionBeforeCommitHook();

          let conflicted = false;
          for (const [path, readVersion] of readVersions) {
            if ((documentVersions.get(path) || 0) !== readVersion) {
              conflicted = true;
              break;
            }
          }
          if (conflicted) {
            if (transactionRetryHook) await transactionRetryHook();
            continue;
          }

          for (const operation of stagedSets) {
            if (writeFailures.has(operation.path)) {
              throw writeFailures.get(operation.path);
            }
          }

          for (const path of stagedDeletes) {
            transactionDeletes.push(path);
            applyDelete(path);
          }
          stagedSets.forEach(applyTransactionSet);
          if (transactionCommitPostApplyFailure) {
            throw transactionCommitPostApplyFailure;
          }
          return result;
        }
        throw new Error('synthetic transaction retry limit');
      },
      collection: (name) => ({
        doc: (id) => document(`${name}/${id}`),
      }),
    };
  }

  return {
    firestore,
    __clearDeletes: () => {
      deleteFailures.clear();
      deletes.splice(0, deletes.length);
    },
    __clearDocuments: () => {
      documents.clear();
      documentVersions.clear();
    },
    __clearReads: () => {
      documentReferenceFailures.clear();
      readFailures.clear();
      readSnapshots.clear();
      reads.splice(0, reads.length);
    },
    __clearWrites: () => {
      batchCommitFailure = undefined;
      batchCommitPostApplyFailure = undefined;
      batchCreateAttempts = 0;
      batchCreationFailure = undefined;
      batchCommitAttempts.splice(0, batchCommitAttempts.length);
      batchDeleteAttempts.splice(0, batchDeleteAttempts.length);
      batchDeleteFailures.clear();
      batchDeletes.splice(0, batchDeletes.length);
      batchSetAttempts.splice(0, batchSetAttempts.length);
      batchSetFailures.clear();
      directSetAttempts.splice(0, directSetAttempts.length);
      directSetPostApplyFailures.clear();
      transactionCommitFailure = undefined;
      transactionCommitPostApplyFailure = undefined;
      transactionCommitAttempts.splice(0, transactionCommitAttempts.length);
      transactionDeleteAttempts.splice(0, transactionDeleteAttempts.length);
      transactionDeleteFailures.clear();
      transactionDeletes.splice(0, transactionDeletes.length);
      transactionGetFailures.clear();
      transactionReads.splice(0, transactionReads.length);
      transactionSetAttempts.splice(0, transactionSetAttempts.length);
      transactionSetFailures.clear();
      transactionSets.splice(0, transactionSets.length);
      transactionBeforeCommitHook = undefined;
      transactionRetryHook = undefined;
      transactionRunAttempts = 0;
      transactionRunFailure = undefined;
      writeFailures.clear();
      writes.splice(0, writes.length);
    },
    __getBatchCommitAttempts: () => [...batchCommitAttempts],
    __getBatchCreateAttempts: () => batchCreateAttempts,
    __getBatchDeleteAttempts: () => [...batchDeleteAttempts],
    __getBatchDeletes: () => [...batchDeletes],
    __getBatchSetAttempts: () => [...batchSetAttempts],
    __getDeletes: () => [...deletes],
    __getDirectSetAttempts: () => [...directSetAttempts],
    __getDocument: (path) => documents.get(path),
    __getReads: () => [...reads],
    __getTransactionCommitAttempts: () => [...transactionCommitAttempts],
    __getTransactionDeleteAttempts: () => [...transactionDeleteAttempts],
    __getTransactionDeletes: () => [...transactionDeletes],
    __getTransactionReads: () => [...transactionReads],
    __getTransactionRunAttempts: () => transactionRunAttempts,
    __getTransactionSetAttempts: () => [...transactionSetAttempts],
    __getTransactionSets: () => [...transactionSets],
    __getWrites: () => [...writes],
    __hasDocument: (path) => documents.has(path),
    __setBatchCommitFailure: (error) => {
      batchCommitFailure = error;
    },
    __setBatchCommitPostApplyFailure: (error) => {
      batchCommitPostApplyFailure = error;
    },
    __setBatchCreationFailure: (error) => {
      batchCreationFailure = error;
    },
    __setBatchDeleteFailure: (path, error) => batchDeleteFailures.set(path, error),
    __setBatchSetFailure: (path, error) => batchSetFailures.set(path, error),
    __setDeleteFailure: (path, error) => deleteFailures.set(path, error),
    __setDirectSetPostApplyFailure: (path, error) => {
      directSetPostApplyFailures.set(path, error);
    },
    __setDocumentReferenceFailure: (path, error) => {
      documentReferenceFailures.set(path, error);
    },
    __removeDocument: (path) => applyDelete(path),
    __setDocument: (path, data) => {
      documents.set(path, data);
      bumpVersion(path);
    },
    __setReadFailure: (path, error) => readFailures.set(path, error),
    __setReadSnapshot: (path, snapshot) => readSnapshots.set(path, snapshot),
    __setTransactionCommitFailure: (error) => {
      transactionCommitFailure = error;
    },
    __setTransactionCommitPostApplyFailure: (error) => {
      transactionCommitPostApplyFailure = error;
    },
    __setTransactionDeleteFailure: (path, error) => {
      transactionDeleteFailures.set(path, error);
    },
    __setTransactionGetFailure: (path, error) => transactionGetFailures.set(path, error),
    __setTransactionBeforeCommitHook: (hook) => {
      transactionBeforeCommitHook = hook;
    },
    __setTransactionRetryHook: (hook) => {
      transactionRetryHook = hook;
    },
    __setTransactionRunFailure: (error) => {
      transactionRunFailure = error;
    },
    __setTransactionSetFailure: (path, error) => {
      transactionSetFailures.set(path, error);
    },
    __setWriteFailure: (path, error) => writeFailures.set(path, error),
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
const { createHash } = require('node:crypto');
const { requireAppCheck } = require('./stripeHelpers');
const {
  stravaBeginAuthorization,
  stravaDisconnect,
  stravaExchangeCode,
  stravaFetchStats,
} = require('./strava');

const FIXED_AUTHORIZATION_ERROR = 'Strava authorization could not be completed.';
const FIXED_REFRESH_ERROR = 'Strava connection could not be refreshed.';
const FIXED_DATA_ERROR = 'Strava activity data could not be loaded.';
const FIXED_STATS_REQUEST_ERROR = 'Strava statistics request is invalid.';
const FIXED_DISCONNECT_REQUEST_ERROR = 'Strava disconnect request is invalid.';
const FIXED_DISCONNECT_ERROR = 'Strava disconnect could not be confirmed.';
const FIXED_DISCONNECT_WARNING = 'strava_disconnect_revoke_failed';
const GUARDED_FETCH = global.fetch;
const AUTH_TIME = 1_700_000_000;
const CONTEXT = Object.freeze({
  app: Object.freeze({ appId: 'synthetic-app-check' }),
  auth: Object.freeze({
    uid: 'synthetic-member-000001',
    token: Object.freeze({ auth_time: AUTH_TIME }),
  }),
});
const CODE = 'synthetic_authorization_code';
const STATE = 'A'.repeat(43);
const MAX_AUTHORIZATION_CODE_LENGTH = 1_024;
const MAX_TOKEN_LENGTH = 2_048;
const MAX_SCOPE_LENGTH = 1_024;
const MAX_PROFILE_TEXT_LENGTH = 1_024;
const MAX_PROFILE_URL_LENGTH = 2_048;
const MAX_ACTIVITY_NAME_LENGTH = 1_024;
const MAX_ACTIVITY_TYPE_LENGTH = 128;
const MAX_ACTIVITY_DATE_LENGTH = 64;
const MAX_STRAVA_LONG_AS_NUMBER = 9_223_372_036_854_776_000;
const CONNECTION_PATH = 'members/synthetic-member-000001/connections/strava';
const SECRET_PATH = 'members/synthetic-member-000001/secrets/strava';
const STATE_PATH = 'members/synthetic-member-000001/secrets/stravaOAuthState';

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

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function validOAuthStateRecord({
  state = STATE,
  uid = CONTEXT.auth.uid,
  authTime = AUTH_TIME,
  issuedAtSeconds = 1_800_000_000,
  expiresAtSeconds = issuedAtSeconds + 600,
} = {}) {
  return {
    schemaVersion: 1,
    provider: 'strava',
    stateDigest: sha256Hex(state),
    uid,
    authTime,
    issuedAtSeconds,
    expiresAtSeconds,
  };
}

describe('Strava authorization challenge creation boundary', () => {
  let consoleSpies;
  let dateNowSpy;

  const NOW_SECONDS = 1_800_000_000;

  beforeEach(() => {
    admin.__clearDeletes();
    admin.__clearDocuments();
    admin.__clearReads();
    admin.__clearWrites();
    requireAppCheck.mockReset();
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW_SECONDS * 1_000);
    consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
    consoleSpies.forEach((spy) => spy.mockRestore());
  });

  function expectNoBeginSideEffects() {
    expect(admin.__getReads()).toEqual([]);
    expect(admin.__getWrites()).toEqual([]);
    expect(admin.__getDeletes()).toEqual([]);
    expect(admin.__getTransactionRunAttempts()).toBe(0);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  }

  test('runs App Check before reading Auth or creating a challenge', async () => {
    const authRead = jest.fn();
    const context = { app: CONTEXT.app };
    Object.defineProperty(context, 'auth', {
      get: () => {
        authRead();
        return CONTEXT.auth;
      },
    });
    const appCheckFailure = new functions.https.HttpsError(
      'failed-precondition',
      'synthetic app check rejection',
    );
    requireAppCheck.mockImplementationOnce(() => {
      throw appCheckFailure;
    });

    await expect(stravaBeginAuthorization({}, context)).rejects.toBe(appCheckFailure);

    expect(requireAppCheck).toHaveBeenCalledWith(context);
    expect(authRead).not.toHaveBeenCalled();
    expectNoBeginSideEffects();
  });

  test('rejects a missing caller before request validation or Firestore', async () => {
    const error = await captureFailure(() => stravaBeginAuthorization(
      { unexpected: 'synthetic' },
      { ...CONTEXT, auth: null },
    ));

    expect(publicError(error)).toEqual({
      code: 'unauthenticated',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(requireAppCheck).toHaveBeenCalledTimes(1);
    expectNoBeginSideEffects();
  });

  test.each([
    ['missing', {}],
    ['own undefined', { auth_time: undefined }],
    ['null', { auth_time: null }],
    ['zero', { auth_time: 0 }],
    ['negative', { auth_time: -1 }],
    ['fractional', { auth_time: 1.5 }],
    ['NaN', { auth_time: Number.NaN }],
    ['infinite', { auth_time: Number.POSITIVE_INFINITY }],
    ['unsafe', { auth_time: Number.MAX_SAFE_INTEGER + 1 }],
    ['string', { auth_time: String(AUTH_TIME) }],
    ['bigint', { auth_time: BigInt(AUTH_TIME) }],
    ['boxed', { auth_time: Object(AUTH_TIME) }],
    ['inherited', Object.create({ auth_time: AUTH_TIME })],
    ['proxied', new Proxy({ auth_time: AUTH_TIME }, {})],
  ])('rejects %s decoded auth_time before challenge creation', async (_name, token) => {
    const error = await captureFailure(() => stravaBeginAuthorization({}, {
      ...CONTEXT,
      auth: { uid: CONTEXT.auth.uid, token },
    }));

    expect(publicError(error)).toEqual({
      code: 'unauthenticated',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expectNoBeginSideEffects();
  });

  test('does not invoke a decoded auth_time accessor while rejecting it', async () => {
    const authTimeRead = jest.fn();
    const token = {};
    Object.defineProperty(token, 'auth_time', { enumerable: true, get: authTimeRead });

    const error = await captureFailure(() => stravaBeginAuthorization({}, {
      ...CONTEXT,
      auth: { uid: CONTEXT.auth.uid, token },
    }));

    expect(publicError(error)).toEqual({
      code: 'unauthenticated',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(authTimeRead).not.toHaveBeenCalled();
    expectNoBeginSideEffects();
  });

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['an array', []],
    ['an extra field', { unexpected: true }],
    ['a custom prototype', Object.create({ inherited: true })],
    ['a Proxy', new Proxy({}, {})],
  ])('requires an exact empty request instead of %s', async (_name, data) => {
    const error = await captureFailure(() => stravaBeginAuthorization(data, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'invalid-argument',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expectNoBeginSideEffects();
  });

  test.each([
    ['minimum', 1],
    ['maximum', Number.MAX_SAFE_INTEGER],
  ])('accepts the exact positive-safe-integer %s auth_time boundary', async (
    _name,
    authTime,
  ) => {
    const context = {
      ...CONTEXT,
      auth: { uid: CONTEXT.auth.uid, token: { auth_time: authTime } },
    };

    const result = await stravaBeginAuthorization({}, context);

    expect(result.state).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(result.expiresInSeconds).toBe(600);
    expect(admin.__getDocument(STATE_PATH)).toEqual(expect.objectContaining({ authTime }));
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('stores one digest-only fixed record and returns only the raw challenge and lifetime', async () => {
    const result = await stravaBeginAuthorization({}, CONTEXT);

    expect(result).toEqual({
      state: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      expiresInSeconds: 600,
    });
    expect(Buffer.from(result.state, 'base64url')).toHaveLength(32);
    const expectedRecord = {
      schemaVersion: 1,
      provider: 'strava',
      stateDigest: sha256Hex(result.state),
      uid: CONTEXT.auth.uid,
      authTime: AUTH_TIME,
      issuedAtSeconds: NOW_SECONDS,
      expiresAtSeconds: NOW_SECONDS + 600,
    };
    expect(admin.__getDirectSetAttempts()).toEqual([{
      path: STATE_PATH,
      data: expectedRecord,
      options: undefined,
    }]);
    expect(admin.__getDocument(STATE_PATH)).toEqual(expectedRecord);
    expect(JSON.stringify(expectedRecord)).not.toContain(result.state);
    expect(Object.keys(expectedRecord)).toEqual([
      'schemaVersion',
      'provider',
      'stateDigest',
      'uid',
      'authTime',
      'issuedAtSeconds',
      'expiresAtSeconds',
    ]);
    expect(admin.__getReads()).toEqual([]);
    expect(admin.__getDeletes()).toEqual([]);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('replaces the one prior challenge record for the same UID', async () => {
    const first = await stravaBeginAuthorization({}, CONTEXT);
    const second = await stravaBeginAuthorization({}, CONTEXT);

    expect(second.state).not.toBe(first.state);
    expect(admin.__getDirectSetAttempts()).toHaveLength(2);
    expect(admin.__getDocument(STATE_PATH)).toEqual({
      schemaVersion: 1,
      provider: 'strava',
      stateDigest: sha256Hex(second.state),
      uid: CONTEXT.auth.uid,
      authTime: AUTH_TIME,
      issuedAtSeconds: NOW_SECONDS,
      expiresAtSeconds: NOW_SECONDS + 600,
    });
    expect(JSON.stringify(admin.__getDocument(STATE_PATH))).not.toContain(first.state);
    expect(JSON.stringify(admin.__getDocument(STATE_PATH))).not.toContain(second.state);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('maps a Firestore replacement failure to one fixed error without exposing it', async () => {
    admin.__setWriteFailure(
      STATE_PATH,
      new Error('challenge-write-canary raw-state-canary'),
    );

    const error = await captureFailure(() => stravaBeginAuthorization({}, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'internal',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(JSON.stringify(publicError(error))).not.toMatch(/challenge-write-canary|raw-state-canary/u);
    expect(admin.__hasDocument(STATE_PATH)).toBe(false);
    expect(admin.__getWrites()).toEqual([]);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test.each([
    ['not-a-number', Number.NaN],
    ['zero', 0],
    ['overflow', Number.MAX_SAFE_INTEGER * 1_000],
    ['non-numeric', BigInt(NOW_SECONDS * 1_000)],
  ])('maps a %s server clock to one fixed error before challenge creation', async (
    _name,
    now,
  ) => {
    dateNowSpy.mockReturnValue(now);

    const error = await captureFailure(() => stravaBeginAuthorization({}, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'internal',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expectNoBeginSideEffects();
  });
});

describe('Strava authorization exchange failure boundary', () => {
  let fetchMock;
  let consoleSpies;
  let dateNowSpy;

  const NOW_SECONDS = 1_800_000_000;

  beforeEach(() => {
    process.env.STRAVA_CLIENT_ID = 'strava_client_test';
    process.env.STRAVA_CLIENT_SECRET = 'strava_secret_test';
    admin.__clearDeletes();
    admin.__clearDocuments();
    admin.__clearReads();
    admin.__clearWrites();
    Timestamp.now.mockClear();
    requireAppCheck.mockReset();
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW_SECONDS * 1_000);
    admin.__setDocument(STATE_PATH, validOAuthStateRecord({
      issuedAtSeconds: NOW_SECONDS - 1,
      expiresAtSeconds: NOW_SECONDS + 599,
    }));
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

  function expectedExchangeWrites() {
    return [
      {
        path: SECRET_PATH,
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
        path: CONNECTION_PATH,
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
    ];
  }

  function hostilePersistenceFailure() {
    const failure = Object.create(null);
    const probes = ['cause', 'code', 'details', 'message', 'stack', 'toString']
      .map((key) => {
        const probe = jest.fn(() => `persistence-canary-${key}`);
        Object.defineProperty(failure, key, {
          configurable: false,
          enumerable: true,
          get: probe,
        });
        return probe;
      });
    return { failure, probes };
  }

  async function expectFixedPersistenceFailure(configure) {
    const { failure, probes } = hostilePersistenceFailure();
    configure(failure);
    const json = mockSuccessfulExchange();

    const error = await captureFailure(() => stravaExchangeCode({
      code: CODE,
      state: STATE,
    }, CONTEXT));
    const exposed = publicError(error);

    expect(exposed).toEqual({
      code: 'internal',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(JSON.stringify(exposed)).not.toContain('persistence-canary');
    probes.forEach((probe) => expect(probe).not.toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledTimes(1);
    expect(admin.__getWrites()).toEqual([]);
    expect(admin.__getDirectSetAttempts()).toEqual([]);
    expect(admin.__getReads()).toEqual([]);
    expect(admin.__getDeletes()).toEqual([]);
    expect(admin.__hasDocument(SECRET_PATH)).toBe(false);
    expect(admin.__hasDocument(CONNECTION_PATH)).toBe(false);
    expect(admin.__hasDocument(STATE_PATH)).toBe(false);
    expect(admin.__getTransactionDeletes()).toEqual([STATE_PATH]);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  }

  async function expectInvalidSuccessfulResponse(response) {
    const json = mockExchangeResponse(response);

    const error = await captureFailure(() => stravaExchangeCode({
      code: CODE,
      state: STATE,
    }, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'internal',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledTimes(1);
    expect(admin.__hasDocument(STATE_PATH)).toBe(false);
    expect(admin.__getTransactionDeletes()).toEqual([STATE_PATH]);
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
      state: STATE,
    }, CONTEXT)).rejects.toBe(appCheckFailure);

    expect(requireAppCheck).toHaveBeenCalledWith(CONTEXT);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  test('rejects a missing caller before code validation, provider exchange, or Firestore', async () => {
    await expect(stravaExchangeCode({
      code: 'x'.repeat(MAX_AUTHORIZATION_CODE_LENGTH + 1),
      state: STATE,
    }, { ...CONTEXT, auth: null }))
      .rejects.toMatchObject({ code: 'unauthenticated' });

    expect(requireAppCheck).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  test('rejects a missing code before credentials, provider exchange, or Firestore', async () => {
    delete process.env.STRAVA_CLIENT_ID;
    delete process.env.STRAVA_CLIENT_SECRET;

    const error = await captureFailure(() => stravaExchangeCode({ state: STATE }, CONTEXT));

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

  test('rejects exchange before provider access when no server challenge exists', async () => {
    mockSuccessfulExchange();
    admin.__removeDocument(STATE_PATH);

    const error = await captureFailure(() => stravaExchangeCode({
      code: CODE,
      state: STATE,
    }, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'permission-denied',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  test.each([
    ['missing token', undefined],
    ['missing auth_time', {}],
    ['zero auth_time', { auth_time: 0 }],
    ['fractional auth_time', { auth_time: 1.5 }],
    ['unsafe auth_time', { auth_time: Number.MAX_SAFE_INTEGER + 1 }],
    ['string auth_time', { auth_time: String(AUTH_TIME) }],
  ])('rejects %s after Auth and before request validation or Firestore', async (
    _name,
    token,
  ) => {
    const error = await captureFailure(() => stravaExchangeCode(
      { unexpected: 'synthetic' },
      { ...CONTEXT, auth: { uid: CONTEXT.auth.uid, token } },
    ));

    expect(publicError(error)).toEqual({
      code: 'unauthenticated',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(admin.__getTransactionRunAttempts()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  test.each([
    ['undefined root', undefined],
    ['null root', null],
    ['array root', [CODE, STATE]],
    ['missing code', { state: STATE }],
    ['extra field', { code: CODE, state: STATE, unexpected: true }],
    ['custom prototype', Object.assign(Object.create({ inherited: true }), {
      code: CODE,
      state: STATE,
    })],
    ['Proxy root', new Proxy({ code: CODE, state: STATE }, {})],
  ])('rejects an inexact authorization request with %s before Firestore', async (
    _name,
    data,
  ) => {
    const error = await captureFailure(() => stravaExchangeCode(data, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'invalid-argument',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(admin.__getTransactionRunAttempts()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  test.each([
    ['missing', { code: CODE }],
    ['own undefined', { code: CODE, state: undefined }],
    ['null', { code: CODE, state: null }],
    ['empty', { code: CODE, state: '' }],
    ['short', { code: CODE, state: 'A'.repeat(42) }],
    ['long', { code: CODE, state: 'A'.repeat(44) }],
    ['non-base64url', { code: CODE, state: `${'A'.repeat(42)}+` }],
    ['padded', { code: CODE, state: `${'A'.repeat(42)}=` }],
    ['non-canonical trailing bits', { code: CODE, state: 'B'.repeat(43) }],
    ['boxed', { code: CODE, state: Object(STATE) }],
  ])('returns one fixed denial for %s state before any transaction or provider access', async (
    _name,
    data,
  ) => {
    delete process.env.STRAVA_CLIENT_ID;
    delete process.env.STRAVA_CLIENT_SECRET;

    const error = await captureFailure(() => stravaExchangeCode(data, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'permission-denied',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(admin.__getTransactionRunAttempts()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  test('returns the fixed state denial without invoking a state accessor', async () => {
    const stateRead = jest.fn();
    const data = { code: CODE };
    Object.defineProperty(data, 'state', { enumerable: true, get: stateRead });

    const error = await captureFailure(() => stravaExchangeCode(data, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'permission-denied',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(stateRead).not.toHaveBeenCalled();
    expect(admin.__getTransactionRunAttempts()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  test.each([
    ['a missing client ID', ['STRAVA_CLIENT_ID']],
    ['a missing client secret', ['STRAVA_CLIENT_SECRET']],
    ['both missing application credentials', ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET']],
  ])('OAUTH-001A1G consumes valid state before %s and never restores it', async (
    _case,
    missingVariables,
  ) => {
    process.env.STRAVA_CLIENT_ID = 'strava-client-id-canary';
    process.env.STRAVA_CLIENT_SECRET = 'strava-client-secret-canary';
    missingVariables.forEach((name) => delete process.env[name]);

    const credentialFailure = await captureFailure(() => stravaExchangeCode({
      code: CODE,
      state: STATE,
    }, CONTEXT));
    const exposed = publicError(credentialFailure);

    expect(exposed).toEqual({
      code: 'failed-precondition',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(JSON.stringify({ exposed, logs: consoleSpies.map((spy) => spy.mock.calls) }))
      .not.toMatch(
        /credentials not configured|strava-client-id-canary|strava-client-secret-canary/i,
      );
    expect(admin.__hasDocument(STATE_PATH)).toBe(false);
    expect(admin.__getTransactionRunAttempts()).toBe(1);
    expect(admin.__getTransactionReads()).toEqual([STATE_PATH]);
    expect(admin.__getTransactionDeleteAttempts()).toEqual([STATE_PATH]);
    expect(admin.__getTransactionDeletes()).toEqual([STATE_PATH]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(admin.__getReads()).toEqual([]);
    expect(admin.__getDeletes()).toEqual([]);
    expect(admin.__getWrites()).toEqual([]);
    expect(admin.__getDirectSetAttempts()).toEqual([]);
    expect(admin.__getBatchCreateAttempts()).toBe(0);
    expect(admin.__getBatchDeleteAttempts()).toEqual([]);
    expect(admin.__getBatchSetAttempts()).toEqual([]);
    expect(Timestamp.now).not.toHaveBeenCalled();
    expect(dateNowSpy).toHaveBeenCalledTimes(1);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());

    process.env.STRAVA_CLIENT_ID = 'strava_client_test';
    process.env.STRAVA_CLIENT_SECRET = 'strava_secret_test';
    const replay = await captureFailure(() => stravaExchangeCode({
      code: CODE,
      state: STATE,
    }, CONTEXT));

    expect(publicError(replay)).toEqual({
      code: 'permission-denied',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(admin.__getTransactionRunAttempts()).toBe(2);
    expect(admin.__getTransactionReads()).toEqual([STATE_PATH, STATE_PATH]);
    expect(admin.__getTransactionDeleteAttempts()).toEqual([STATE_PATH]);
    expect(admin.__getTransactionDeletes()).toEqual([STATE_PATH]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(admin.__getReads()).toEqual([]);
    expect(admin.__getDeletes()).toEqual([]);
    expect(admin.__getWrites()).toEqual([]);
    expect(admin.__getDirectSetAttempts()).toEqual([]);
    expect(admin.__getBatchCreateAttempts()).toBe(0);
    expect(admin.__getBatchDeleteAttempts()).toEqual([]);
    expect(admin.__getBatchSetAttempts()).toEqual([]);
    expect(Timestamp.now).not.toHaveBeenCalled();
    expect(dateNowSpy).toHaveBeenCalledTimes(1);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('does not invoke request accessors while rejecting them', async () => {
    const codeRead = jest.fn();
    const data = { state: STATE };
    Object.defineProperty(data, 'code', { enumerable: true, get: codeRead });

    const error = await captureFailure(() => stravaExchangeCode(data, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'invalid-argument',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(codeRead).not.toHaveBeenCalled();
    expect(admin.__getTransactionRunAttempts()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  async function expectStoredStateDenial(record, context = CONTEXT, state = STATE) {
    admin.__setDocument(STATE_PATH, record);
    delete process.env.STRAVA_CLIENT_ID;
    delete process.env.STRAVA_CLIENT_SECRET;

    const error = await captureFailure(() => stravaExchangeCode({ code: CODE, state }, context));

    expect(publicError(error)).toEqual({
      code: 'permission-denied',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(admin.__getTransactionRunAttempts()).toBe(1);
    expect(admin.__getTransactionReads()).toEqual([STATE_PATH]);
    expect(admin.__getTransactionDeleteAttempts()).toEqual([]);
    expect(admin.__getTransactionDeletes()).toEqual([]);
    expect(admin.__getWrites()).toEqual([]);
    expect(admin.__getDeletes()).toEqual([]);
    expect(admin.__getDocument(STATE_PATH)).toBe(record);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  }

  test.each([
    ['undefined root', undefined],
    ['null root', null],
    ['primitive root', true],
    ['array root', []],
    ['null-prototype root', Object.create(null)],
    ['custom-prototype root', Object.create({ inherited: true })],
    ['Proxy root', new Proxy(validOAuthStateRecord(), {})],
    ['missing field', (() => {
      const record = validOAuthStateRecord();
      delete record.provider;
      return record;
    })()],
    ['extra field', { ...validOAuthStateRecord(), unexpected: true }],
    ['wrong schema version', { ...validOAuthStateRecord(), schemaVersion: 2 }],
    ['wrong provider', { ...validOAuthStateRecord(), provider: 'other' }],
    ['short digest', { ...validOAuthStateRecord(), stateDigest: 'a'.repeat(63) }],
    ['uppercase digest', {
      ...validOAuthStateRecord(),
      stateDigest: sha256Hex(STATE).toUpperCase(),
    }],
    ['zero auth time', { ...validOAuthStateRecord(), authTime: 0 }],
    ['zero issued time', {
      ...validOAuthStateRecord(),
      issuedAtSeconds: 0,
      expiresAtSeconds: 600,
    }],
    ['non-ten-minute lifetime', {
      ...validOAuthStateRecord(),
      expiresAtSeconds: 1_800_000_601,
    }],
  ])('rejects malformed stored OAuth state with %s before provider access', async (
    _name,
    record,
  ) => {
    await expectStoredStateDenial(record);
  });

  test('does not invoke a stored digest accessor while rejecting the record', async () => {
    const digestRead = jest.fn();
    const record = validOAuthStateRecord();
    Object.defineProperty(record, 'stateDigest', {
      enumerable: true,
      get: digestRead,
    });

    await expectStoredStateDenial(record);

    expect(digestRead).not.toHaveBeenCalled();
  });

  test.each([
    ['wrong stored UID', validOAuthStateRecord({ uid: 'synthetic-other-member' }), CONTEXT],
    ['wrong Auth session', validOAuthStateRecord({ authTime: AUTH_TIME + 1 }), CONTEXT],
    ['mismatched digest', validOAuthStateRecord({ state: 'E'.repeat(43) }), CONTEXT],
  ])('rejects %s before credentials or provider access', async (_name, record, context) => {
    await expectStoredStateDenial(record, context);
  });

  test('rejects a state stored only under a different caller UID', async () => {
    const otherUid = 'synthetic-member-000002';
    const otherContext = {
      ...CONTEXT,
      auth: { uid: otherUid, token: { auth_time: AUTH_TIME } },
    };
    const otherStatePath = `members/${otherUid}/secrets/stravaOAuthState`;

    const error = await captureFailure(() => stravaExchangeCode({
      code: CODE,
      state: STATE,
    }, otherContext));

    expect(publicError(error)).toEqual({
      code: 'permission-denied',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(admin.__getTransactionReads()).toEqual([otherStatePath]);
    expect(admin.__getTransactionDeleteAttempts()).toEqual([]);
    expect(admin.__hasDocument(STATE_PATH)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(admin.__getWrites()).toEqual([]);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('rejects at the exact expiry boundary and retains the unusable record', async () => {
    const record = validOAuthStateRecord({
      issuedAtSeconds: NOW_SECONDS - 600,
      expiresAtSeconds: NOW_SECONDS,
    });

    await expectStoredStateDenial(record);
  });

  test('accepts one second before expiry and consumes before provider access', async () => {
    admin.__setDocument(STATE_PATH, validOAuthStateRecord({
      issuedAtSeconds: NOW_SECONDS - 599,
      expiresAtSeconds: NOW_SECONDS + 1,
    }));
    mockSuccessfulExchange();

    const result = await stravaExchangeCode({ code: CODE, state: STATE }, CONTEXT);

    expect(result).toEqual({ ok: true, athleteId: 123456 });
    expect(admin.__getTransactionDeletes()).toEqual([STATE_PATH]);
    expect(admin.__hasDocument(STATE_PATH)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('consumes once so a replay is denied before a second provider exchange', async () => {
    mockSuccessfulExchange();

    await expect(stravaExchangeCode({ code: CODE, state: STATE }, CONTEXT))
      .resolves.toEqual({ ok: true, athleteId: 123456 });
    const replay = await captureFailure(() => stravaExchangeCode({
      code: CODE,
      state: STATE,
    }, CONTEXT));

    expect(publicError(replay)).toEqual({
      code: 'permission-denied',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(admin.__getTransactionDeletes()).toEqual([STATE_PATH]);
    expect(admin.__hasDocument(STATE_PATH)).toBe(false);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('allows exactly one concurrent consumer to reach the provider', async () => {
    mockSuccessfulExchange();

    const outcomes = await Promise.allSettled([
      stravaExchangeCode({ code: CODE, state: STATE }, CONTEXT),
      stravaExchangeCode({ code: CODE, state: STATE }, CONTEXT),
    ]);

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find(({ status }) => status === 'rejected');
    expect(publicError(rejected.reason)).toEqual({
      code: 'permission-denied',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(admin.__getTransactionRunAttempts()).toBe(2);
    expect(admin.__getTransactionReads()).toEqual([STATE_PATH, STATE_PATH, STATE_PATH]);
    expect(admin.__getTransactionDeletes()).toEqual([STATE_PATH]);
    expect(admin.__hasDocument(STATE_PATH)).toBe(false);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('rechecks expiry when Firestore retries after a conflicting write', async () => {
    const record = validOAuthStateRecord({
      issuedAtSeconds: NOW_SECONDS - 599,
      expiresAtSeconds: NOW_SECONDS + 1,
    });
    admin.__setDocument(STATE_PATH, record);
    let introduceConflict = true;
    admin.__setTransactionBeforeCommitHook(() => {
      if (!introduceConflict) return;
      introduceConflict = false;
      admin.__setDocument(STATE_PATH, record);
    });
    admin.__setTransactionRetryHook(() => {
      dateNowSpy.mockReturnValue((NOW_SECONDS + 1) * 1_000);
    });
    mockSuccessfulExchange();

    const error = await captureFailure(() => stravaExchangeCode({
      code: CODE,
      state: STATE,
    }, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'permission-denied',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(admin.__getTransactionReads()).toEqual([STATE_PATH, STATE_PATH]);
    expect(admin.__getTransactionDeleteAttempts()).toEqual([STATE_PATH]);
    expect(admin.__getTransactionDeletes()).toEqual([]);
    expect(admin.__getDocument(STATE_PATH)).toBe(record);
    expect(Date.now).toHaveBeenCalledTimes(2);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test.each([
    ['transaction start', (failure) => admin.__setTransactionRunFailure(failure), false],
    ['transaction read', (failure) => admin.__setTransactionGetFailure(STATE_PATH, failure), false],
    ['transaction delete staging', (failure) => (
      admin.__setTransactionDeleteFailure(STATE_PATH, failure)
    ), false],
    ['transaction commit', (failure) => admin.__setTransactionCommitFailure(failure), false],
    ['transaction acknowledgement', (failure) => (
      admin.__setTransactionCommitPostApplyFailure(failure)
    ), true],
  ])('maps a %s failure to one fixed error and never reaches the provider', async (
    _name,
    configure,
    consumed,
  ) => {
    const failure = new Error('transaction-canary raw-state-canary');
    configure(failure);

    const error = await captureFailure(() => stravaExchangeCode({
      code: CODE,
      state: STATE,
    }, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'internal',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(JSON.stringify(publicError(error))).not.toMatch(/transaction-canary|raw-state-canary/u);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(admin.__hasDocument(STATE_PATH)).toBe(!consumed);
    expect(admin.__getWrites()).toEqual([]);
    expect(admin.__getDeletes()).toEqual([]);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
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

    const error = await captureFailure(() => stravaExchangeCode({
      code,
      state: STATE,
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

  test('rejects an oversized code before provider access or Firestore', async () => {
    mockSuccessfulExchange();

    const error = await captureFailure(() => stravaExchangeCode({
      code: 'x'.repeat(MAX_AUTHORIZATION_CODE_LENGTH + 1),
      state: STATE,
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
      state: STATE,
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

    const result = await stravaExchangeCode({ code, state: STATE }, CONTEXT);

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

    const error = await captureFailure(() => stravaExchangeCode({
      code: CODE,
      state: STATE,
    }, CONTEXT));

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

  describe('OAUTH-001A2J authorization response-status admission', () => {
    test('rejects an ok accessor without invoking or exposing it', async () => {
      const statusFailure = new Error(
        'authorization-ok-canary client_secret=provider-secret-canary',
      );
      const okGetter = jest.fn(() => {
        throw statusFailure;
      });
      const json = jest.fn();
      const response = { json };
      Object.defineProperty(response, 'ok', {
        configurable: true,
        enumerable: true,
        get: okGetter,
      });
      fetchMock.mockResolvedValue(response);

      const rejection = await captureFailure(() => stravaExchangeCode({
        code: CODE,
        state: STATE,
      }, CONTEXT));

      expect(rejection).not.toBe(statusFailure);
      expect(publicError(rejection)).toEqual({
        code: 'invalid-argument',
        message: FIXED_AUTHORIZATION_ERROR,
        details: undefined,
        cause: undefined,
      });
      expect(JSON.stringify(publicError(rejection)))
        .not.toMatch(/authorization-ok-canary|provider-secret-canary/i);
      expect(okGetter).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(admin.__hasDocument(STATE_PATH)).toBe(false);
      expect(admin.__getTransactionDeletes()).toEqual([STATE_PATH]);
      expectNoSideEffects();
    });

    test('accepts a genuine successful Node Response', async () => {
      const json = jest.fn().mockResolvedValue(validExchangeResponse());
      const response = new Response(null, { status: 200 });
      Object.defineProperty(response, 'json', {
        configurable: true,
        value: json,
      });
      fetchMock.mockResolvedValue(response);

      const result = await stravaExchangeCode({ code: CODE, state: STATE }, CONTEXT);

      expect(result).toEqual({ ok: true, athleteId: 123456 });
      expect(json).toHaveBeenCalledTimes(1);
      expect(response.bodyUsed).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(admin.__getWrites()).toEqual(expectedExchangeWrites());
      expect(admin.__hasDocument(STATE_PATH)).toBe(false);
      expect(admin.__getTransactionDeletes()).toEqual([STATE_PATH]);
      expect(Timestamp.now).toHaveBeenCalledTimes(3);
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });
  });

  test('turns a transport failure into one fixed unavailable result', async () => {
    fetchMock.mockRejectedValue(Object.assign(
      new Error('transport-canary https://provider.example.test/?code=secret-canary'),
      { providerBody: 'provider-body-canary' },
    ));

    const error = await captureFailure(() => stravaExchangeCode({
      code: CODE,
      state: STATE,
    }, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'unavailable',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(JSON.stringify(publicError(error)))
      .not.toMatch(/transport-canary|provider\.example|secret-canary|provider-body-canary/i);
    expect(admin.__hasDocument(STATE_PATH)).toBe(false);
    expect(admin.__getTransactionDeletes()).toEqual([STATE_PATH]);
    expectNoSideEffects();
  });

  test('turns malformed provider JSON into one fixed unavailable result', async () => {
    const json = jest.fn().mockRejectedValue(
      new Error('json-canary access_token=provider-secret-canary'),
    );
    fetchMock.mockResolvedValue({ ok: true, json });

    const error = await captureFailure(() => stravaExchangeCode({
      code: CODE,
      state: STATE,
    }, CONTEXT));

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

      const error = await captureFailure(() => stravaExchangeCode({
        code: CODE,
        state: STATE,
      }, CONTEXT));

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

      const result = await stravaExchangeCode({ code: CODE, state: STATE }, CONTEXT);

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
        const result = await stravaExchangeCode({ code: CODE, state: STATE }, CONTEXT);

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

      const result = await stravaExchangeCode({ code: CODE, state: STATE }, CONTEXT);

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

      const result = await stravaExchangeCode({ code: CODE, state: STATE }, CONTEXT);

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

      const result = await stravaExchangeCode({ code: CODE, state: STATE }, CONTEXT);

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

      const result = await stravaExchangeCode({ code: CODE, state: STATE }, CONTEXT);

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

      const result = await stravaExchangeCode({ code: CODE, state: STATE }, CONTEXT);

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

      const result = await stravaExchangeCode({ code: CODE, state: STATE }, CONTEXT);

      expect(result).toEqual({ ok: true, athleteId: 123456 });
      expect(unknownGetter).not.toHaveBeenCalled();
      expect(unknownSymbolGetter).not.toHaveBeenCalled();
      expect(admin.__getWrites()).toHaveLength(2);
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });
  });

  test.each([
    [
      'batch construction',
      (failure) => admin.__setBatchCreationFailure(failure),
    ],
    [
      'secret staging',
      (failure) => admin.__setBatchSetFailure(SECRET_PATH, failure),
    ],
    [
      'connection staging',
      (failure) => admin.__setBatchSetFailure(CONNECTION_PATH, failure),
    ],
    [
      'pre-apply batch commit',
      (failure) => admin.__setBatchCommitFailure(failure),
    ],
  ])('maps %s failure to one fixed error and commits neither document', async (
    _stage,
    configure,
  ) => {
    await expectFixedPersistenceFailure(configure);
  });

  test.each([
    ['a first connection', false],
    ['a reconnect with an existing matched pair', true],
  ])('keeps both records unchanged when %s has a pre-apply rejection', async (
    _name,
    seedExisting,
  ) => {
    const previousSecret = Object.freeze({ marker: 'previous-secret-record' });
    const previousConnection = Object.freeze({ marker: 'previous-connection-record' });
    if (seedExisting) {
      admin.__setDocument(SECRET_PATH, previousSecret);
      admin.__setDocument(CONNECTION_PATH, previousConnection);
    }
    const { failure, probes } = hostilePersistenceFailure();
    admin.__setWriteFailure(CONNECTION_PATH, failure);
    const json = mockSuccessfulExchange();

    const error = await captureFailure(() => stravaExchangeCode({
      code: CODE,
      state: STATE,
    }, CONTEXT));
    const exposed = publicError(error);
    const expectedWrites = expectedExchangeWrites();

    expect(admin.__getWrites()).toEqual([]);
    if (seedExisting) {
      expect(admin.__getDocument(SECRET_PATH)).toBe(previousSecret);
      expect(admin.__getDocument(CONNECTION_PATH)).toBe(previousConnection);
    } else {
      expect(admin.__hasDocument(SECRET_PATH)).toBe(false);
      expect(admin.__hasDocument(CONNECTION_PATH)).toBe(false);
    }
    expect(exposed).toEqual({
      code: 'internal',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(JSON.stringify(exposed)).not.toContain('persistence-canary');
    probes.forEach((probe) => expect(probe).not.toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledTimes(1);
    expect(admin.__getBatchCreateAttempts()).toBe(1);
    expect(admin.__getBatchSetAttempts()).toEqual(expectedWrites);
    expect(admin.__getBatchCommitAttempts()).toEqual([expectedWrites]);
    expect(admin.__getDirectSetAttempts()).toEqual([]);
    expect(admin.__getReads()).toEqual([]);
    expect(admin.__getDeletes()).toEqual([]);
    expect(Timestamp.now).toHaveBeenCalledTimes(3);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('keeps an acknowledgement-lost outcome atomic and returns one fixed error', async () => {
    const { failure, probes } = hostilePersistenceFailure();
    admin.__setBatchCommitPostApplyFailure(failure);
    const json = mockSuccessfulExchange();

    const error = await captureFailure(() => stravaExchangeCode({
      code: CODE,
      state: STATE,
    }, CONTEXT));
    const exposed = publicError(error);
    const expectedWrites = expectedExchangeWrites();

    expect(admin.__getWrites()).toEqual(expectedWrites);
    expect(admin.__getBatchCreateAttempts()).toBe(1);
    expect(admin.__getBatchSetAttempts()).toEqual(expectedWrites);
    expect(admin.__getBatchCommitAttempts()).toEqual([expectedWrites]);
    expect(admin.__getDirectSetAttempts()).toEqual([]);
    expect(exposed).toEqual({
      code: 'internal',
      message: FIXED_AUTHORIZATION_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(JSON.stringify(exposed)).not.toContain('persistence-canary');
    probes.forEach((probe) => expect(probe).not.toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledTimes(1);
    expect(admin.__getReads()).toEqual([]);
    expect(admin.__getDeletes()).toEqual([]);
    expect(Timestamp.now).toHaveBeenCalledTimes(3);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('preserves the successful server-only exchange, writes, and minimal result', async () => {
    const json = mockSuccessfulExchange();

    const result = await stravaExchangeCode({ code: CODE, state: STATE }, CONTEXT);

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
    const expectedWrites = expectedExchangeWrites();
    expect(admin.__getBatchCreateAttempts()).toBe(1);
    expect(admin.__getBatchSetAttempts()).toEqual(expectedWrites);
    expect(admin.__getBatchCommitAttempts()).toEqual([expectedWrites]);
    expect(admin.__getWrites()).toEqual(expectedWrites);
    expect(admin.__getDirectSetAttempts()).toEqual([]);
    expect(admin.__getReads()).toEqual([]);
    expect(admin.__getDeletes()).toEqual([]);
    expect(Timestamp.now).toHaveBeenCalledTimes(3);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });
});

describe('Strava statistics request admission boundary', () => {
  let fetchMock;
  let consoleSpies;
  let dateNowSpy;

  beforeEach(() => {
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
  });

  function expectNoStatisticsSideEffects() {
    expect(admin.__getReads()).toEqual([]);
    expect(admin.__getWrites()).toEqual([]);
    expect(admin.__getDeletes()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dateNowSpy).not.toHaveBeenCalled();
    expect(Timestamp.now).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  }

  async function expectRejectedStatisticsRequest(data) {
    const rejection = await captureFailure(() => stravaFetchStats(data, CONTEXT));

    expect(publicError(rejection)).toEqual({
      code: 'invalid-argument',
      message: FIXED_STATS_REQUEST_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(requireAppCheck).toHaveBeenCalledTimes(1);
    expect(requireAppCheck).toHaveBeenCalledWith(CONTEXT);
    expectNoStatisticsSideEffects();
  }

  test('runs App Check before Auth, request reflection, or side effects', async () => {
    const appCheckFailure = new functions.https.HttpsError(
      'failed-precondition',
      'synthetic app check rejection',
    );
    requireAppCheck.mockImplementationOnce(() => {
      throw appCheckFailure;
    });
    const authGetter = jest.fn(() => CONTEXT.auth);
    const context = Object.defineProperty(
      { app: CONTEXT.app },
      'auth',
      { enumerable: true, get: authGetter },
    );
    const traps = {
      getPrototypeOf: jest.fn(() => {
        throw new Error('stats-request-order-canary prototype trap');
      }),
      isExtensible: jest.fn(() => {
        throw new Error('stats-request-order-canary extensible trap');
      }),
      ownKeys: jest.fn(() => {
        throw new Error('stats-request-order-canary ownKeys trap');
      }),
    };
    const data = new Proxy({}, traps);

    await expect(stravaFetchStats(data, context)).rejects.toBe(appCheckFailure);

    expect(requireAppCheck).toHaveBeenCalledWith(context);
    expect(authGetter).not.toHaveBeenCalled();
    Object.values(traps).forEach((trap) => expect(trap).not.toHaveBeenCalled());
    expectNoStatisticsSideEffects();
  });

  test('rejects a missing caller before request reflection or side effects', async () => {
    const traps = {
      getPrototypeOf: jest.fn(() => {
        throw new Error('stats-request-auth-order-canary prototype trap');
      }),
      isExtensible: jest.fn(() => {
        throw new Error('stats-request-auth-order-canary extensible trap');
      }),
      ownKeys: jest.fn(() => {
        throw new Error('stats-request-auth-order-canary ownKeys trap');
      }),
    };
    const data = new Proxy({}, traps);
    const rejection = await captureFailure(() => (
      stravaFetchStats(data, { ...CONTEXT, auth: null })
    ));

    expect(publicError(rejection)).toEqual({
      code: 'unauthenticated',
      message: 'Sign-in required',
      details: undefined,
      cause: undefined,
    });
    expect(requireAppCheck).toHaveBeenCalledTimes(1);
    Object.values(traps).forEach((trap) => expect(trap).not.toHaveBeenCalled());
    expectNoStatisticsSideEffects();
  });

  describe('request validation before side effects', () => {
    class StatisticsRequest {
      constructor() {
        this.unexpected = true;
      }
    }

    const nonEnumerableRequest = {};
    Object.defineProperty(nonEnumerableRequest, 'unexpected', {
      configurable: true,
      enumerable: false,
      value: true,
    });
    const symbolRequest = { [Symbol('unexpected')]: true };

    test.each([
      ['undefined', undefined],
      ['null', null],
      ['a boolean', false],
      ['a number', 0],
      ['a bigint', 0n],
      ['a string', ''],
      ['a symbol', Symbol('stats-request-canary')],
      ['a function', () => undefined],
      ['an array', []],
      ['a Date', new Date(0)],
      ['a class instance', new StatisticsRequest()],
      ['a null-prototype record', Object.create(null)],
      ['a custom-prototype record', Object.create({ inherited: true })],
      ['an enumerable extra key', { unexpected: true }],
      ['a non-enumerable extra key', nonEnumerableRequest],
      ['a symbol extra key', symbolRequest],
    ])('rejects %s before Firestore, provider, timestamp, write, delete, or log work', async (
      _case,
      data,
    ) => {
      await expectRejectedStatisticsRequest(data);
    });

    test('rejects a Proxy without invoking any trap', async () => {
      const traps = {
        get: jest.fn(() => {
          throw new Error('stats-request-canary get trap');
        }),
        getOwnPropertyDescriptor: jest.fn(() => {
          throw new Error('stats-request-canary descriptor trap');
        }),
        getPrototypeOf: jest.fn(() => {
          throw new Error('stats-request-canary prototype trap');
        }),
        has: jest.fn(() => {
          throw new Error('stats-request-canary has trap');
        }),
        isExtensible: jest.fn(() => {
          throw new Error('stats-request-canary extensible trap');
        }),
        ownKeys: jest.fn(() => {
          throw new Error('stats-request-canary ownKeys trap');
        }),
      };
      const data = new Proxy({}, traps);

      await expectRejectedStatisticsRequest(data);

      Object.values(traps).forEach((trap) => expect(trap).not.toHaveBeenCalled());
    });

    test('rejects a revoked Proxy without reflection', async () => {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();

      await expectRejectedStatisticsRequest(proxy);
    });

    test('rejects an accessor-backed record without invoking the accessor', async () => {
      const getter = jest.fn(() => {
        throw new Error('stats-request-canary getter');
      });
      const data = {};
      Object.defineProperty(data, 'unexpected', {
        configurable: true,
        enumerable: true,
        get: getter,
      });

      await expectRejectedStatisticsRequest(data);

      expect(getter).not.toHaveBeenCalled();
    });

    test('does not invoke coercion, iteration, or JSON hooks', async () => {
      const hooks = {
        toJSON: jest.fn(() => 'stats-request-canary'),
        toString: jest.fn(() => 'stats-request-canary'),
        valueOf: jest.fn(() => 'stats-request-canary'),
        [Symbol.iterator]: jest.fn(() => [][Symbol.iterator]()),
        [Symbol.toPrimitive]: jest.fn(() => 'stats-request-canary'),
      };

      await expectRejectedStatisticsRequest(hooks);

      expect(hooks.toJSON).not.toHaveBeenCalled();
      expect(hooks.toString).not.toHaveBeenCalled();
      expect(hooks.valueOf).not.toHaveBeenCalled();
      expect(hooks[Symbol.iterator]).not.toHaveBeenCalled();
      expect(hooks[Symbol.toPrimitive]).not.toHaveBeenCalled();
    });
  });

  test('accepts one ordinary exact empty request and reaches the connection lookup', async () => {
    const request = {};

    await expect(stravaFetchStats(request, CONTEXT)).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'Strava not connected',
    });

    expect(Object.getPrototypeOf(request)).toBe(Object.prototype);
    expect(Reflect.ownKeys(request)).toEqual([]);
    expect(admin.__getReads()).toEqual([CONNECTION_PATH]);
    expect(admin.__getWrites()).toEqual([]);
    expect(admin.__getDeletes()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dateNowSpy).not.toHaveBeenCalled();
    expect(Timestamp.now).not.toHaveBeenCalled();
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

  function expectedRefreshWrite() {
    return {
      path: SECRET_PATH,
      data: {
        access_token: 'refreshed_access_token_test',
        refresh_token: 'refreshed_refresh_token_test',
        expires_at: 1_900_000_000,
        updatedAt: expect.any(Object),
      },
      options: { merge: true },
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

  describe('OAUTH-001A2G statistics connection-record read boundary', () => {
    function hostileReadFailure() {
      const probes = [
        jest.fn(() => {
          throw new Error('connection-read-cause-getter-canary');
        }),
        jest.fn(() => {
          throw new Error('connection-read-details-getter-canary');
        }),
        jest.fn(() => {
          throw new Error('connection-read-json-getter-canary');
        }),
      ];
      const failure = new Error(
        'connection-read-canary uid=synthetic-member path=members/private token=synthetic-token',
      );
      Object.defineProperties(failure, {
        cause: { configurable: true, enumerable: true, get: probes[0] },
        details: { configurable: true, enumerable: true, get: probes[1] },
        toJSON: { configurable: true, enumerable: true, get: probes[2] },
      });
      return { failure, probes };
    }

    function expectFixedReadFailure(rejection, probes) {
      const exposed = publicError(rejection);
      expect(exposed).toEqual({
        code: 'unavailable',
        message: FIXED_DATA_ERROR,
        details: undefined,
        cause: undefined,
      });
      expect(JSON.stringify({ exposed, logs: consoleSpies.map((spy) => spy.mock.calls) }))
        .not.toMatch(
          /connection-read-canary|synthetic-member|members\/private|synthetic-token|getter-canary/i,
        );
      probes.forEach((probe) => expect(probe).not.toHaveBeenCalled());
      expect(requireAppCheck).toHaveBeenCalledWith(CONTEXT);
      expect(admin.__getReads()).toEqual([CONNECTION_PATH]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(admin.__getBatchCreateAttempts()).toBe(0);
      expect(admin.__getBatchDeleteAttempts()).toEqual([]);
      expect(admin.__getBatchDeletes()).toEqual([]);
      expect(admin.__getBatchSetAttempts()).toEqual([]);
      expect(admin.__getBatchCommitAttempts()).toEqual([]);
      expect(admin.__getDeletes()).toEqual([]);
      expect(admin.__getDirectSetAttempts()).toEqual([]);
      expect(admin.__getTransactionRunAttempts()).toBe(0);
      expect(admin.__getWrites()).toEqual([]);
      expect(admin.__hasDocument(CONNECTION_PATH)).toBe(true);
      expect(admin.__hasDocument(SECRET_PATH)).toBe(true);
      expect(dateNowSpy).not.toHaveBeenCalled();
      expect(Timestamp.now).not.toHaveBeenCalled();
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    }

    test('maps a rejected connection read to one fixed result before secret work', async () => {
      const { failure, probes } = hostileReadFailure();
      seedExpiredConnection();
      admin.__setReadFailure(CONNECTION_PATH, failure);

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expectFixedReadFailure(rejection, probes);
    });

    test('maps a throwing snapshot exists value to the fixed read boundary', async () => {
      const { failure, probes } = hostileReadFailure();
      const exists = jest.fn(() => {
        throw failure;
      });
      const snapshot = {};
      Object.defineProperty(snapshot, 'exists', {
        configurable: true,
        enumerable: true,
        get: exists,
      });
      seedExpiredConnection();
      admin.__setReadSnapshot(CONNECTION_PATH, snapshot);

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expectFixedReadFailure(rejection, probes);
      expect(exists).toHaveBeenCalledTimes(1);
    });

    test('maps a throwing snapshot data method to the fixed read boundary', async () => {
      const { failure, probes } = hostileReadFailure();
      const data = jest.fn(() => {
        throw failure;
      });
      seedExpiredConnection();
      admin.__setReadSnapshot(CONNECTION_PATH, { exists: true, data });

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expectFixedReadFailure(rejection, probes);
      expect(data).toHaveBeenCalledTimes(1);
    });
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

  describe('OAUTH-001A1D stored refresh-secret read boundary', () => {
    function hostileReadFailure() {
      const probes = [
        jest.fn(() => {
          throw new Error('refresh-read-cause-getter-canary');
        }),
        jest.fn(() => {
          throw new Error('refresh-read-details-getter-canary');
        }),
        jest.fn(() => {
          throw new Error('refresh-read-json-getter-canary');
        }),
      ];
      const failure = new Error(
        'refresh-read-canary uid=synthetic-member path=members/private token=synthetic-token',
      );
      Object.defineProperties(failure, {
        cause: { configurable: true, enumerable: true, get: probes[0] },
        details: { configurable: true, enumerable: true, get: probes[1] },
        toJSON: { configurable: true, enumerable: true, get: probes[2] },
      });
      return { failure, probes };
    }

    function expectFixedReadFailure(rejection, probes) {
      const exposed = publicError(rejection);
      expect(exposed).toEqual({
        code: 'unavailable',
        message: FIXED_REFRESH_ERROR,
        details: undefined,
        cause: undefined,
      });
      expect(JSON.stringify({ exposed, logs: consoleSpies.map((spy) => spy.mock.calls) }))
        .not.toMatch(
          /refresh-read-canary|synthetic-member|members\/private|synthetic-token|getter-canary/i,
        );
      probes.forEach((probe) => expect(probe).not.toHaveBeenCalled());
      expect(requireAppCheck).toHaveBeenCalledWith(CONTEXT);
      expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(admin.__getBatchCreateAttempts()).toBe(0);
      expect(admin.__getBatchDeleteAttempts()).toEqual([]);
      expect(admin.__getBatchDeletes()).toEqual([]);
      expect(admin.__getBatchSetAttempts()).toEqual([]);
      expect(admin.__getBatchCommitAttempts()).toEqual([]);
      expect(admin.__getDeletes()).toEqual([]);
      expect(admin.__getDirectSetAttempts()).toEqual([]);
      expect(admin.__getTransactionRunAttempts()).toBe(0);
      expect(admin.__getWrites()).toEqual([]);
      expect(admin.__hasDocument(CONNECTION_PATH)).toBe(true);
      expect(admin.__hasDocument(SECRET_PATH)).toBe(true);
      expect(dateNowSpy).not.toHaveBeenCalled();
      expect(Timestamp.now).not.toHaveBeenCalled();
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    }

    test('maps a rejected secret read to one fixed result before downstream work', async () => {
      const { failure, probes } = hostileReadFailure();
      seedStoredSecret(validStoredSecret());
      admin.__setReadFailure(SECRET_PATH, failure);

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expectFixedReadFailure(rejection, probes);
    });

    test('maps a throwing snapshot exists value to the fixed read boundary', async () => {
      const { failure, probes } = hostileReadFailure();
      const exists = jest.fn(() => {
        throw failure;
      });
      const snapshot = {};
      Object.defineProperty(snapshot, 'exists', {
        configurable: true,
        enumerable: true,
        get: exists,
      });
      seedStoredSecret(validStoredSecret());
      admin.__setReadSnapshot(SECRET_PATH, snapshot);

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expectFixedReadFailure(rejection, probes);
      expect(exists).toHaveBeenCalledTimes(1);
    });

    test('maps a throwing snapshot data method to the fixed read boundary', async () => {
      const { failure, probes } = hostileReadFailure();
      const data = jest.fn(() => {
        throw failure;
      });
      seedStoredSecret(validStoredSecret());
      admin.__setReadSnapshot(SECRET_PATH, { exists: true, data });

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expectFixedReadFailure(rejection, probes);
      expect(data).toHaveBeenCalledTimes(1);
    });
  });

  describe('OAUTH-001A1F refresh freshness-clock boundary', () => {
    function expectNoPostClockWork() {
      expect(requireAppCheck).toHaveBeenCalledWith(CONTEXT);
      expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(admin.__getBatchCreateAttempts()).toBe(0);
      expect(admin.__getBatchDeleteAttempts()).toEqual([]);
      expect(admin.__getBatchDeletes()).toEqual([]);
      expect(admin.__getBatchSetAttempts()).toEqual([]);
      expect(admin.__getBatchCommitAttempts()).toEqual([]);
      expect(admin.__getDeletes()).toEqual([]);
      expect(admin.__getDirectSetAttempts()).toEqual([]);
      expect(admin.__getTransactionRunAttempts()).toBe(0);
      expect(admin.__getTransactionReads()).toEqual([]);
      expect(admin.__getTransactionDeleteAttempts()).toEqual([]);
      expect(admin.__getWrites()).toEqual([]);
      expect(admin.__getDocument(CONNECTION_PATH)).toBe(CONNECTION);
      expect(admin.__getDocument(SECRET_PATH)).toBe(EXPIRED_SECRET);
      expect(dateNowSpy).toHaveBeenCalledTimes(1);
      expect(Timestamp.now).not.toHaveBeenCalled();
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    }

    async function expectInvalidClock(value) {
      seedExpiredConnection();
      dateNowSpy.mockReturnValueOnce(value);

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expect(publicError(rejection)).toEqual({
        code: 'internal',
        message: FIXED_REFRESH_ERROR,
        details: undefined,
        cause: undefined,
      });
      expectNoPostClockWork();
    }

    test('discards a hostile thrown clock value without reading or exposing it', async () => {
      const failure = Object.create(null);
      const probes = ['cause', 'code', 'details', 'message', 'stack', 'toJSON', 'toString']
        .map((field) => {
          const probe = jest.fn(() => {
            throw new Error(`refresh-clock-${field}-getter-canary`);
          });
          Object.defineProperty(failure, field, {
            configurable: false,
            enumerable: true,
            get: probe,
          });
          return probe;
        });
      seedExpiredConnection();
      dateNowSpy.mockImplementationOnce(() => {
        throw failure;
      });

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      if (rejection === failure) {
        throw new Error('Raw hostile refresh-clock failure escaped the fixed boundary.');
      }
      const exposed = publicError(rejection);
      expect(exposed).toEqual({
        code: 'internal',
        message: FIXED_REFRESH_ERROR,
        details: undefined,
        cause: undefined,
      });
      expect(JSON.stringify({ exposed, logs: consoleSpies.map((spy) => spy.mock.calls) }))
        .not.toMatch(/refresh-clock|getter-canary/i);
      probes.forEach((probe) => expect(probe).not.toHaveBeenCalled());
      expectNoPostClockWork();
    });

    test('maps a clock-projection failure to the same fixed boundary', async () => {
      seedExpiredConnection();
      const floorSpy = jest.spyOn(Math, 'floor').mockImplementationOnce(() => {
        throw new Error('refresh-clock-floor-canary');
      });
      let rejection;
      try {
        rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));
      } finally {
        floorSpy.mockRestore();
      }

      const exposed = publicError(rejection);
      expect(exposed).toEqual({
        code: 'internal',
        message: FIXED_REFRESH_ERROR,
        details: undefined,
        cause: undefined,
      });
      expect(JSON.stringify({ exposed, logs: consoleSpies.map((spy) => spy.mock.calls) }))
        .not.toMatch(/refresh-clock-floor-canary/i);
      expectNoPostClockWork();
    });

    test.each([
      ['not-a-number', Number.NaN],
      ['positive infinity', Number.POSITIVE_INFINITY],
      ['negative infinity', Number.NEGATIVE_INFINITY],
      ['zero', 0],
      ['a negative value', -1],
      ['a fractional millisecond', (NOW_SECONDS * 1_000) + 0.5],
      ['an unsafe millisecond integer', Number.MAX_SAFE_INTEGER + 1],
      ['a numeric string', String(NOW_SECONDS * 1_000)],
      ['a boxed number', Object(NOW_SECONDS * 1_000)],
      ['a bigint', 1n],
      ['a symbol', Symbol('refresh-clock-canary')],
    ])('rejects %s before provider or persistence work', async (_case, value) => {
      await expectInvalidClock(value);
    });

    test('rejects an invalid clock before application credentials are required', async () => {
      delete process.env.STRAVA_CLIENT_ID;
      delete process.env.STRAVA_CLIENT_SECRET;

      await expectInvalidClock(Number.NaN);
    });

    test('rejects a coercible clock object without invoking its hooks', async () => {
      const hooks = {
        toString: jest.fn(() => String(NOW_SECONDS * 1_000)),
        valueOf: jest.fn(() => NOW_SECONDS * 1_000),
        [Symbol.toPrimitive]: jest.fn(() => NOW_SECONDS * 1_000),
      };

      await expectInvalidClock(hooks);

      expect(hooks.toString).not.toHaveBeenCalled();
      expect(hooks.valueOf).not.toHaveBeenCalled();
      expect(hooks[Symbol.toPrimitive]).not.toHaveBeenCalled();
    });

    test('rejects a clock Proxy without invoking any trap', async () => {
      const traps = {
        get: jest.fn(() => {
          throw new Error('refresh-clock-proxy-get-canary');
        }),
        getOwnPropertyDescriptor: jest.fn(() => {
          throw new Error('refresh-clock-proxy-descriptor-canary');
        }),
        getPrototypeOf: jest.fn(() => {
          throw new Error('refresh-clock-proxy-prototype-canary');
        }),
        has: jest.fn(() => {
          throw new Error('refresh-clock-proxy-has-canary');
        }),
        ownKeys: jest.fn(() => {
          throw new Error('refresh-clock-proxy-ownKeys-canary');
        }),
      };
      const value = new Proxy(Object(NOW_SECONDS * 1_000), traps);

      await expectInvalidClock(value);

      Object.values(traps).forEach((trap) => expect(trap).not.toHaveBeenCalled());
    });

    test('rejects a revoked clock Proxy without reflection', async () => {
      const { proxy, revoke } = Proxy.revocable(Object(NOW_SECONDS * 1_000), {});
      revoke();

      await expectInvalidClock(proxy);
    });
  });

  describe('OAUTH-001A1H stale refreshed-secret persistence boundary', () => {
    function expectRefusedMutation(rejection) {
      expect(publicError(rejection)).toEqual({
        code: 'internal',
        message: FIXED_REFRESH_ERROR,
        details: undefined,
        cause: undefined,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
      expect(admin.__getDirectSetAttempts()).toEqual([]);
      expect(admin.__getTransactionRunAttempts()).toBe(1);
      expect(admin.__getTransactionReads()).toEqual([SECRET_PATH]);
      expect(admin.__getTransactionSetAttempts()).toEqual([]);
      expect(admin.__getTransactionSets()).toEqual([]);
      expect(admin.__getWrites()).toEqual([]);
      expect(Timestamp.now).not.toHaveBeenCalled();
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    }

    test('refuses an older refresh response after the stored token tuple rotates', async () => {
      const newerSecret = Object.freeze({
        access_token: 'newer_access_token_test',
        refresh_token: 'newer_refresh_token_test',
        expires_at: 1_950_000_000,
        scope: 'read',
      });
      seedExpiredConnection();
      const json = jest.fn().mockImplementation(async () => {
        admin.__setDocument(SECRET_PATH, newerSecret);
        return validRefreshResponse();
      });
      fetchMock
        .mockResolvedValueOnce({ ok: true, json })
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

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expectRefusedMutation(rejection);
      expect(json).toHaveBeenCalledTimes(1);
      expect(admin.__getDocument(SECRET_PATH)).toBe(newerSecret);
    });

    test.each([
      ['access token', 'access_token', 'different_access_token_test'],
      ['refresh token', 'refresh_token', 'different_refresh_token_test'],
      ['expiry', 'expires_at', 1_950_000_000],
    ])('refuses when only the stored %s changes during provider refresh', async (
      _case,
      field,
      value,
    ) => {
      const changedSecret = Object.freeze({ ...EXPIRED_SECRET, [field]: value });
      seedExpiredConnection();
      const json = jest.fn().mockImplementation(async () => {
        admin.__setDocument(SECRET_PATH, changedSecret);
        return validRefreshResponse();
      });
      fetchMock.mockResolvedValueOnce({ ok: true, json });

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expectRefusedMutation(rejection);
      expect(json).toHaveBeenCalledTimes(1);
      expect(admin.__getDocument(SECRET_PATH)).toBe(changedSecret);
    });

    test('refuses when the stored secret is deleted during provider refresh', async () => {
      seedExpiredConnection();
      const json = jest.fn().mockImplementation(async () => {
        admin.__removeDocument(SECRET_PATH);
        return validRefreshResponse();
      });
      fetchMock.mockResolvedValueOnce({ ok: true, json });

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expectRefusedMutation(rejection);
      expect(json).toHaveBeenCalledTimes(1);
      expect(admin.__hasDocument(SECRET_PATH)).toBe(false);
    });

    test('refuses malformed replacement state without inspecting unknown fields', async () => {
      const unknownGetter = jest.fn(() => {
        throw new Error('stale-refresh-malformed-unknown-canary');
      });
      const malformedSecret = { access_token: 'replacement_access_token_test' };
      Object.defineProperty(malformedSecret, 'provider_debug', {
        configurable: true,
        enumerable: true,
        get: unknownGetter,
      });
      seedExpiredConnection();
      const json = jest.fn().mockImplementation(async () => {
        admin.__setDocument(SECRET_PATH, malformedSecret);
        return validRefreshResponse();
      });
      fetchMock.mockResolvedValueOnce({ ok: true, json });

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expectRefusedMutation(rejection);
      expect(json).toHaveBeenCalledTimes(1);
      expect(unknownGetter).not.toHaveBeenCalled();
      expect(admin.__getDocument(SECRET_PATH)).toBe(malformedSecret);
    });

    test('rechecks and refuses changed state after a transaction conflict', async () => {
      const newerSecret = Object.freeze({
        access_token: 'conflicting_access_token_test',
        refresh_token: 'conflicting_refresh_token_test',
        expires_at: 1_960_000_000,
        scope: 'read',
      });
      const retryHook = jest.fn();
      let beforeCommitCalls = 0;
      seedExpiredConnection();
      mockRefreshResponse(validRefreshResponse());
      admin.__setTransactionBeforeCommitHook(() => {
        beforeCommitCalls += 1;
        if (beforeCommitCalls === 1) {
          admin.__setDocument(SECRET_PATH, newerSecret);
        }
      });
      admin.__setTransactionRetryHook(retryHook);

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expect(publicError(rejection)).toEqual({
        code: 'internal',
        message: FIXED_REFRESH_ERROR,
        details: undefined,
        cause: undefined,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(admin.__getDirectSetAttempts()).toEqual([]);
      expect(admin.__getTransactionRunAttempts()).toBe(1);
      expect(admin.__getTransactionReads()).toEqual([SECRET_PATH, SECRET_PATH]);
      expect(admin.__getTransactionSetAttempts()).toEqual([expectedRefreshWrite()]);
      expect(admin.__getTransactionSets()).toEqual([]);
      expect(admin.__getWrites()).toEqual([]);
      expect(admin.__getDocument(SECRET_PATH)).toBe(newerSecret);
      expect(retryHook).toHaveBeenCalledTimes(1);
      expect(Timestamp.now).toHaveBeenCalledTimes(1);
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });

    test('persists once and continues when the stored tuple is unchanged', async () => {
      seedExpiredConnection();
      mockValidRefreshFlow();

      const result = await stravaFetchStats({}, CONTEXT);

      const expectedWrite = expectedRefreshWrite();
      expect(result).toMatchObject({ connected: true });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(admin.__getDirectSetAttempts()).toEqual([]);
      expect(admin.__getTransactionRunAttempts()).toBe(1);
      expect(admin.__getTransactionReads()).toEqual([SECRET_PATH]);
      expect(admin.__getTransactionSetAttempts()).toEqual([expectedWrite]);
      expect(admin.__getTransactionSets()).toEqual([expectedWrite]);
      expect(admin.__getWrites()).toEqual([expectedWrite]);
      expect(admin.__getDocument(SECRET_PATH)).toEqual({
        ...EXPIRED_SECRET,
        access_token: 'refreshed_access_token_test',
        refresh_token: 'refreshed_refresh_token_test',
        expires_at: 1_900_000_000,
        updatedAt: expect.any(Object),
      });
      expect(Timestamp.now).toHaveBeenCalledTimes(1);
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });
  });

  describe('OAUTH-001A1E refreshed-secret persistence boundary', () => {
    function hostilePersistenceFailure() {
      const probes = [
        jest.fn(() => {
          throw new Error('refresh-persistence-cause-getter-canary');
        }),
        jest.fn(() => {
          throw new Error('refresh-persistence-details-getter-canary');
        }),
        jest.fn(() => {
          throw new Error('refresh-persistence-json-getter-canary');
        }),
      ];
      const failure = new Error(
        'refresh-persistence-canary path=users/private/stravaSecret token=synthetic-token',
      );
      Object.defineProperties(failure, {
        cause: { configurable: true, enumerable: true, get: probes[0] },
        details: { configurable: true, enumerable: true, get: probes[1] },
        toJSON: { configurable: true, enumerable: true, get: probes[2] },
      });
      return { failure, probes };
    }

    function expectFixedPersistenceFailure(rejection, probes) {
      const exposed = publicError(rejection);
      expect(exposed).toEqual({
        code: 'internal',
        message: FIXED_REFRESH_ERROR,
        details: undefined,
        cause: undefined,
      });
      expect(JSON.stringify({ exposed, logs: consoleSpies.map((spy) => spy.mock.calls) }))
        .not.toMatch(
          /refresh-persistence-canary|users\/private|stravaSecret|synthetic-token|getter-canary/i,
        );
      probes.forEach((probe) => expect(probe).not.toHaveBeenCalled());
      expect(requireAppCheck).toHaveBeenCalledWith(CONTEXT);
      expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
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
      expect(admin.__getBatchCreateAttempts()).toBe(0);
      expect(admin.__getBatchDeleteAttempts()).toEqual([]);
      expect(admin.__getBatchDeletes()).toEqual([]);
      expect(admin.__getBatchSetAttempts()).toEqual([]);
      expect(admin.__getBatchCommitAttempts()).toEqual([]);
      expect(admin.__getDeletes()).toEqual([]);
      expect(admin.__getDirectSetAttempts()).toEqual([]);
      expect(admin.__getTransactionDeleteAttempts()).toEqual([]);
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    }

    test('maps a timestamp failure before the secret set to one fixed result', async () => {
      const { failure, probes } = hostilePersistenceFailure();
      seedExpiredConnection();
      mockRefreshResponse(validRefreshResponse());
      Timestamp.now.mockImplementationOnce(() => {
        throw failure;
      });

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expectFixedPersistenceFailure(rejection, probes);
      expect(Timestamp.now).toHaveBeenCalledTimes(1);
      expect(admin.__getTransactionRunAttempts()).toBe(1);
      expect(admin.__getTransactionReads()).toEqual([SECRET_PATH]);
      expect(admin.__getTransactionSetAttempts()).toEqual([]);
      expect(admin.__getTransactionSets()).toEqual([]);
      expect(admin.__getWrites()).toEqual([]);
      expect(admin.__getDocument(CONNECTION_PATH)).toBe(CONNECTION);
      expect(admin.__getDocument(SECRET_PATH)).toBe(EXPIRED_SECRET);
    });

    test('maps a secret-reference failure after refresh validation to one fixed result', async () => {
      const { failure, probes } = hostilePersistenceFailure();
      seedExpiredConnection();
      const json = jest.fn().mockImplementation(async () => {
        admin.__setDocumentReferenceFailure(SECRET_PATH, failure);
        return validRefreshResponse();
      });
      fetchMock.mockResolvedValueOnce({ ok: true, json });

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expectFixedPersistenceFailure(rejection, probes);
      expect(json).toHaveBeenCalledTimes(1);
      expect(Timestamp.now).not.toHaveBeenCalled();
      expect(admin.__getTransactionRunAttempts()).toBe(0);
      expect(admin.__getTransactionReads()).toEqual([]);
      expect(admin.__getTransactionSetAttempts()).toEqual([]);
      expect(admin.__getTransactionSets()).toEqual([]);
      expect(admin.__getWrites()).toEqual([]);
      expect(admin.__getDocument(CONNECTION_PATH)).toBe(CONNECTION);
      expect(admin.__getDocument(SECRET_PATH)).toBe(EXPIRED_SECRET);
    });

    test('maps a transaction-start rejection to one fixed result', async () => {
      const { failure, probes } = hostilePersistenceFailure();
      seedExpiredConnection();
      mockRefreshResponse(validRefreshResponse());
      admin.__setTransactionRunFailure(failure);

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expectFixedPersistenceFailure(rejection, probes);
      expect(Timestamp.now).not.toHaveBeenCalled();
      expect(admin.__getTransactionRunAttempts()).toBe(1);
      expect(admin.__getTransactionReads()).toEqual([]);
      expect(admin.__getTransactionSetAttempts()).toEqual([]);
      expect(admin.__getTransactionSets()).toEqual([]);
      expect(admin.__getWrites()).toEqual([]);
      expect(admin.__getDocument(SECRET_PATH)).toBe(EXPIRED_SECRET);
    });

    test('maps a transaction-read rejection to one fixed result', async () => {
      const { failure, probes } = hostilePersistenceFailure();
      seedExpiredConnection();
      mockRefreshResponse(validRefreshResponse());
      admin.__setTransactionGetFailure(SECRET_PATH, failure);

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expectFixedPersistenceFailure(rejection, probes);
      expect(Timestamp.now).not.toHaveBeenCalled();
      expect(admin.__getTransactionRunAttempts()).toBe(1);
      expect(admin.__getTransactionReads()).toEqual([SECRET_PATH]);
      expect(admin.__getTransactionSetAttempts()).toEqual([]);
      expect(admin.__getTransactionSets()).toEqual([]);
      expect(admin.__getWrites()).toEqual([]);
      expect(admin.__getDocument(SECRET_PATH)).toBe(EXPIRED_SECRET);
    });

    test('maps a transaction-set staging rejection to one fixed result', async () => {
      const { failure, probes } = hostilePersistenceFailure();
      seedExpiredConnection();
      mockRefreshResponse(validRefreshResponse());
      admin.__setTransactionSetFailure(SECRET_PATH, failure);

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expectFixedPersistenceFailure(rejection, probes);
      expect(Timestamp.now).toHaveBeenCalledTimes(1);
      expect(admin.__getTransactionRunAttempts()).toBe(1);
      expect(admin.__getTransactionReads()).toEqual([SECRET_PATH]);
      expect(admin.__getTransactionSetAttempts()).toEqual([expectedRefreshWrite()]);
      expect(admin.__getTransactionSets()).toEqual([]);
      expect(admin.__getWrites()).toEqual([]);
      expect(admin.__getDocument(SECRET_PATH)).toBe(EXPIRED_SECRET);
    });

    test('maps a transaction-commit rejection to one fixed result', async () => {
      const { failure, probes } = hostilePersistenceFailure();
      seedExpiredConnection();
      mockRefreshResponse(validRefreshResponse());
      admin.__setTransactionCommitFailure(failure);

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expectFixedPersistenceFailure(rejection, probes);
      expect(Timestamp.now).toHaveBeenCalledTimes(1);
      expect(admin.__getTransactionRunAttempts()).toBe(1);
      expect(admin.__getTransactionReads()).toEqual([SECRET_PATH]);
      expect(admin.__getTransactionSetAttempts()).toEqual([expectedRefreshWrite()]);
      expect(admin.__getTransactionSets()).toEqual([]);
      expect(admin.__getWrites()).toEqual([]);
      expect(admin.__getDocument(SECRET_PATH)).toBe(EXPIRED_SECRET);
    });

    test('maps a pre-apply secret-set rejection to one fixed result', async () => {
      const { failure, probes } = hostilePersistenceFailure();
      seedExpiredConnection();
      mockRefreshResponse(validRefreshResponse());
      admin.__setWriteFailure(SECRET_PATH, failure);

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expectFixedPersistenceFailure(rejection, probes);
      expect(Timestamp.now).toHaveBeenCalledTimes(1);
      expect(admin.__getTransactionRunAttempts()).toBe(1);
      expect(admin.__getTransactionReads()).toEqual([SECRET_PATH]);
      expect(admin.__getTransactionSetAttempts()).toEqual([expectedRefreshWrite()]);
      expect(admin.__getTransactionSets()).toEqual([]);
      expect(admin.__getWrites()).toEqual([]);
      expect(admin.__getDocument(CONNECTION_PATH)).toBe(CONNECTION);
      expect(admin.__getDocument(SECRET_PATH)).toBe(EXPIRED_SECRET);
    });

    test('maps an acknowledgement loss to fixed internal and makes no downstream call', async () => {
      const { failure, probes } = hostilePersistenceFailure();
      seedExpiredConnection();
      mockRefreshResponse(validRefreshResponse());
      admin.__setTransactionCommitPostApplyFailure(failure);

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expectFixedPersistenceFailure(rejection, probes);
      const expectedWrite = expectedRefreshWrite();
      expect(Timestamp.now).toHaveBeenCalledTimes(1);
      expect(admin.__getTransactionRunAttempts()).toBe(1);
      expect(admin.__getTransactionReads()).toEqual([SECRET_PATH]);
      expect(admin.__getTransactionSetAttempts()).toEqual([expectedWrite]);
      expect(admin.__getTransactionSets()).toEqual([expectedWrite]);
      expect(admin.__getWrites()).toEqual([expectedWrite]);
      expect(admin.__getDocument(CONNECTION_PATH)).toBe(CONNECTION);
      expect(admin.__getDocument(SECRET_PATH)).toEqual({
        ...EXPIRED_SECRET,
        access_token: 'refreshed_access_token_test',
        refresh_token: 'refreshed_refresh_token_test',
        expires_at: 1_900_000_000,
        updatedAt: expect.any(Object),
      });
    });
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

  describe('OAUTH-001A2J refresh response-status admission', () => {
    test('rejects an ok accessor without invoking or exposing it', async () => {
      seedExpiredConnection();
      const statusFailure = new Error(
        'refresh-ok-canary refresh_token=provider-secret-canary',
      );
      const okGetter = jest.fn(() => {
        throw statusFailure;
      });
      const json = jest.fn();
      const response = { json };
      Object.defineProperty(response, 'ok', {
        configurable: true,
        enumerable: true,
        get: okGetter,
      });
      fetchMock.mockResolvedValue(response);

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expect(rejection).not.toBe(statusFailure);
      expect(publicError(rejection)).toEqual({
        code: 'failed-precondition',
        message: FIXED_REFRESH_ERROR,
        details: undefined,
        cause: undefined,
      });
      expect(JSON.stringify(publicError(rejection)))
        .not.toMatch(/refresh-ok-canary|provider-secret-canary/i);
      expect(okGetter).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
      expectNoWritesOrLogs();
    });
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

    test('uses the refresh projection then refuses a raw stored tuple mutation', async () => {
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

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expect(publicError(rejection)).toEqual({
        code: 'internal',
        message: FIXED_REFRESH_ERROR,
        details: undefined,
        cause: undefined,
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
            refresh_token: 'stored_refresh_token_test',
            grant_type: 'refresh_token',
          }),
        },
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(admin.__getDirectSetAttempts()).toEqual([]);
      expect(admin.__getTransactionRunAttempts()).toBe(1);
      expect(admin.__getTransactionReads()).toEqual([SECRET_PATH]);
      expect(admin.__getTransactionSetAttempts()).toEqual([]);
      expect(admin.__getTransactionSets()).toEqual([]);
      expect(admin.__getWrites()).toEqual([]);
      expect(dateNowSpy).toHaveBeenCalledTimes(1);
      expect(Timestamp.now).not.toHaveBeenCalled();
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

  describe('OAUTH-001A1G missing application-credential boundary', () => {
    function expectNoCredentialFailureWork() {
      expect(requireAppCheck).toHaveBeenCalledWith(CONTEXT);
      expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(admin.__getBatchCreateAttempts()).toBe(0);
      expect(admin.__getBatchDeleteAttempts()).toEqual([]);
      expect(admin.__getBatchDeletes()).toEqual([]);
      expect(admin.__getBatchSetAttempts()).toEqual([]);
      expect(admin.__getBatchCommitAttempts()).toEqual([]);
      expect(admin.__getDeletes()).toEqual([]);
      expect(admin.__getDirectSetAttempts()).toEqual([]);
      expect(admin.__getTransactionRunAttempts()).toBe(0);
      expect(admin.__getTransactionReads()).toEqual([]);
      expect(admin.__getTransactionDeleteAttempts()).toEqual([]);
      expect(admin.__getWrites()).toEqual([]);
      expect(admin.__getDocument(CONNECTION_PATH)).toBe(CONNECTION);
      expect(admin.__getDocument(SECRET_PATH)).toBe(EXPIRED_SECRET);
      expect(dateNowSpy).toHaveBeenCalledTimes(1);
      expect(Timestamp.now).not.toHaveBeenCalled();
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    }

    test.each([
      ['a missing client ID', ['STRAVA_CLIENT_ID']],
      ['a missing client secret', ['STRAVA_CLIENT_SECRET']],
      ['both missing application credentials', ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET']],
    ])('returns one fixed refresh result for %s', async (_case, missingVariables) => {
      process.env.STRAVA_CLIENT_ID = 'strava-client-id-canary';
      process.env.STRAVA_CLIENT_SECRET = 'strava-client-secret-canary';
      missingVariables.forEach((name) => delete process.env[name]);
      seedExpiredConnection();
      let readsAtClock;
      dateNowSpy.mockImplementationOnce(() => {
        readsAtClock = admin.__getReads();
        return NOW_SECONDS * 1_000;
      });

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));
      const exposed = publicError(rejection);

      expect(readsAtClock).toEqual([CONNECTION_PATH, SECRET_PATH]);
      expect(exposed).toEqual({
        code: 'failed-precondition',
        message: FIXED_REFRESH_ERROR,
        details: undefined,
        cause: undefined,
      });
      expect(JSON.stringify({ exposed, logs: consoleSpies.map((spy) => spy.mock.calls) }))
        .not.toMatch(
          /credentials not configured|strava-client-id-canary|strava-client-secret-canary/i,
        );
      expectNoCredentialFailureWork();
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

  function validProviderActivity(overrides = {}) {
    return {
      id: 987654,
      name: 'Synthetic Morning Run',
      sport_type: 'Run',
      distance: 5000.5,
      moving_time: 1500,
      start_date: '2026-01-02T12:00:00Z',
      ...overrides,
    };
  }

  function validProviderStats(overrides = {}) {
    return {
      ytd_run_totals: { distance: 12000.5, count: 3 },
      ytd_ride_totals: { distance: 20000.25, count: 2 },
      all_run_totals: { distance: 345000.75, count: 84 },
      ...overrides,
    };
  }

  function mockSuccessfulProviderData(options = {}) {
    const activities = Object.prototype.hasOwnProperty.call(options, 'activities')
      ? options.activities
      : [validProviderActivity()];
    const stats = Object.prototype.hasOwnProperty.call(options, 'stats')
      ? options.stats
      : validProviderStats();
    const activitiesJson = jest.fn(() => activities);
    const statsJson = jest.fn(() => stats);
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: activitiesJson })
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

  async function expectInvalidSuccessfulProviderData(options) {
    const { invalidSurface } = options;
    seedFreshConnection();
    const { activitiesJson, statsJson } = mockSuccessfulProviderData(options);

    const error = await captureFailure(() => stravaFetchStats({}, CONTEXT));

    expect(publicError(error)).toEqual({
      code: 'internal',
      message: FIXED_DATA_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(JSON.stringify(publicError(error)))
      .not.toMatch(/provider|canary|secret|token|access|refresh/i);
    expect(activitiesJson).toHaveBeenCalledTimes(1);
    expect(statsJson).toHaveBeenCalledTimes(invalidSurface === 'activities' ? 0 : 1);
    expectTwoFreshBearerReads();
    expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
    expect(admin.__getWrites()).toEqual([]);
    expect(admin.__getDeletes()).toEqual([]);
    expect(Timestamp.now).not.toHaveBeenCalled();
    expectNoWritesOrLogs();
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

  describe('successful Strava activity and statistics response validation', () => {
    class ProviderActivities extends Array {}

    class ProviderActivity {
      constructor() {
        Object.assign(this, validProviderActivity());
      }
    }

    class ProviderStats {
      constructor() {
        Object.assign(this, validProviderStats());
      }
    }

    test.each([
      ['undefined', undefined],
      ['null', null],
      ['a boolean', true],
      ['a number', 1],
      ['a string', 'activities'],
      ['a function', () => []],
      ['a plain record', {}],
      ['a Date', new Date(0)],
      ['a null-prototype record', Object.create(null)],
      ['a custom-prototype record', Object.create({ inherited: true })],
      ['an Array subclass', new ProviderActivities()],
    ])('rejects activities root that is %s', async (_case, activities) => {
      await expectInvalidSuccessfulProviderData({
        activities,
        invalidSurface: 'activities',
      });
    });

    test('rejects a transparent activities Proxy without inspecting it after await', async () => {
      const getTrap = jest.fn((_target, key) => {
        if (key === 'then') return undefined;
        throw new Error(`activities-root-canary ${String(key)}`);
      });
      const activities = new Proxy([validProviderActivity()], {
        get: getTrap,
        getOwnPropertyDescriptor: jest.fn(() => {
          throw new Error('activities-root-canary descriptor');
        }),
        getPrototypeOf: jest.fn(() => {
          throw new Error('activities-root-canary prototype');
        }),
        ownKeys: jest.fn(() => {
          throw new Error('activities-root-canary ownKeys');
        }),
      });

      await expectInvalidSuccessfulProviderData({
        activities,
        invalidSurface: 'activities',
      });

      expect(getTrap.mock.calls.map(([, key]) => key)).toEqual(['then']);
    });

    test('keeps a revoked activities root inside the fixed unavailable JSON boundary', async () => {
      seedFreshConnection();
      const { proxy, revoke } = Proxy.revocable([validProviderActivity()], {});
      revoke();
      const activitiesJson = jest.fn(() => proxy);
      const statsJson = jest.fn(() => validProviderStats());
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
      expect(activitiesJson).toHaveBeenCalledTimes(1);
      expect(statsJson).not.toHaveBeenCalled();
      expectTwoFreshBearerReads();
      expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
      expect(admin.__getDeletes()).toEqual([]);
      expect(Timestamp.now).not.toHaveBeenCalled();
      expectNoWritesOrLogs();
    });

    test('rejects a revoked Proxy activity entry without reflection', async () => {
      const { proxy, revoke } = Proxy.revocable(validProviderActivity(), {});
      revoke();

      await expectInvalidSuccessfulProviderData({
        activities: [proxy],
        invalidSurface: 'activities',
      });
    });

    test.each([
      ['oversized', Array.from({ length: 6 }, (_unused, index) => (
        validProviderActivity({ id: index + 1 })
      ))],
      ['sparse', new Array(1)],
    ])('rejects an %s activity array', async (_case, activities) => {
      await expectInvalidSuccessfulProviderData({
        activities,
        invalidSurface: 'activities',
      });
    });

    test('rejects an accessor-indexed activity array without invoking it', async () => {
      const indexGetter = jest.fn(() => validProviderActivity());
      const accessorIndexed = [];
      Object.defineProperty(accessorIndexed, '0', {
        configurable: true,
        enumerable: true,
        get: indexGetter,
      });
      accessorIndexed.length = 1;
      await expectInvalidSuccessfulProviderData({
        activities: accessorIndexed,
        invalidSurface: 'activities',
      });
      expect(indexGetter).not.toHaveBeenCalled();
    });

    test.each([
      ['null', null],
      ['an array', []],
      ['a Date', new Date(0)],
      ['a class instance', new ProviderActivity()],
      ['a null-prototype record', Object.assign(Object.create(null), validProviderActivity())],
      ['a custom-prototype record', Object.assign(
        Object.create({ inherited: true }),
        validProviderActivity(),
      )],
    ])('rejects an activity entry that is %s', async (_case, activity) => {
      await expectInvalidSuccessfulProviderData({
        activities: [activity],
        invalidSurface: 'activities',
      });
    });

    test.each([
      ['missing id', (activity) => { delete activity.id; }],
      ['undefined id', (activity) => { activity.id = undefined; }],
      ['zero id', (activity) => { activity.id = 0; }],
      ['negative id', (activity) => { activity.id = -1; }],
      ['fractional id', (activity) => { activity.id = 1.5; }],
      ['NaN id', (activity) => { activity.id = Number.NaN; }],
      ['infinite id', (activity) => { activity.id = Number.POSITIVE_INFINITY; }],
      ['next-representable over-cap id', (activity) => {
        activity.id = MAX_STRAVA_LONG_AS_NUMBER + 2_048;
      }],
      ['over-cap id', (activity) => { activity.id = MAX_STRAVA_LONG_AS_NUMBER * 2; }],
      ['string id', (activity) => { activity.id = '987654'; }],
      ['boxed id', (activity) => { activity.id = Object(987654); }],
      ['structured id', (activity) => { activity.id = { value: 987654 }; }],
      ['bigint id', (activity) => { activity.id = 987654n; }],
      ['symbol id', (activity) => { activity.id = Symbol('activity-id-canary'); }],
      ['empty name', (activity) => { activity.name = ''; }],
      ['oversized name', (activity) => { activity.name = 'n'.repeat(MAX_ACTIVITY_NAME_LENGTH + 1); }],
      ['control in name', (activity) => { activity.name = 'Morning\nRun'; }],
      ['lone surrogate in name', (activity) => { activity.name = '\ud800'; }],
      ['oversized type', (activity) => { activity.sport_type = 't'.repeat(MAX_ACTIVITY_TYPE_LENGTH + 1); }],
      ['control in type', (activity) => { activity.sport_type = 'Run\rRide'; }],
      ['malformed preferred type', (activity) => {
        activity.type = { value: 'Run' };
        activity.sport_type = 'Run';
      }],
      ['negative distance', (activity) => { activity.distance = -1; }],
      ['NaN distance', (activity) => { activity.distance = Number.NaN; }],
      ['infinite distance', (activity) => { activity.distance = Number.POSITIVE_INFINITY; }],
      ['over-cap distance', (activity) => { activity.distance = Number.MAX_SAFE_INTEGER + 1; }],
      ['string distance', (activity) => { activity.distance = '5000'; }],
      ['negative moving time', (activity) => { activity.moving_time = -1; }],
      ['fractional moving time', (activity) => { activity.moving_time = 1.5; }],
      ['unsafe moving time', (activity) => { activity.moving_time = Number.MAX_SAFE_INTEGER + 1; }],
      ['string moving time', (activity) => { activity.moving_time = '1500'; }],
      ['empty date', (activity) => { activity.start_date = ''; }],
      ['oversized date', (activity) => { activity.start_date = 'd'.repeat(MAX_ACTIVITY_DATE_LENGTH + 1); }],
      ['non-visible date', (activity) => { activity.start_date = '2026-01-02\n12:00:00Z'; }],
      ['malformed preferred date', (activity) => {
        activity.start_date_local = { value: '2026-01-02T12:00:00Z' };
        activity.start_date = '2026-01-02T12:00:00Z';
      }],
    ])('rejects an activity with %s', async (_case, mutate) => {
      const activity = validProviderActivity();
      mutate(activity);

      await expectInvalidSuccessfulProviderData({
        activities: [activity],
        invalidSurface: 'activities',
      });
    });

    describe('OAUTH-001A2H precision-safe activity IDs', () => {
      test('rejects the first precision-unsafe integer before statistics JSON', async () => {
        await expectInvalidSuccessfulProviderData({
          activities: [validProviderActivity({
            id: Number.MAX_SAFE_INTEGER + 1,
          })],
          invalidSurface: 'activities',
        });
      });

      test('preserves the safe-integer ceiling as an exact numeric result', async () => {
        seedFreshConnection();
        const { activitiesJson, statsJson } = mockSuccessfulProviderData({
          activities: [validProviderActivity({
            id: Number.MAX_SAFE_INTEGER,
          })],
        });

        const result = await stravaFetchStats({}, CONTEXT);

        expect(result.recentActivities[0]).toEqual({
          id: Number.MAX_SAFE_INTEGER,
          name: 'Synthetic Morning Run',
          type: 'Run',
          distanceMeters: 5000.5,
          movingTimeSeconds: 1500,
          startDate: '2026-01-02T12:00:00Z',
        });
        expect(typeof result.recentActivities[0].id).toBe('number');
        expect(activitiesJson).toHaveBeenCalledTimes(1);
        expect(statsJson).toHaveBeenCalledTimes(1);
        expectTwoFreshBearerReads();
        expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
        expect(admin.__getDeletes()).toEqual([]);
        expect(Timestamp.now).not.toHaveBeenCalled();
        expectNoWritesOrLogs();
      });
    });

    describe('OAUTH-001A2I unique activity IDs', () => {
      test('rejects a repeated valid ID before statistics JSON', async () => {
        await expectInvalidSuccessfulProviderData({
          activities: [
            validProviderActivity({ id: 987654 }),
            validProviderActivity({
              id: 987654,
              name: 'Synthetic Evening Run',
            }),
          ],
          invalidSurface: 'activities',
        });
      });

      test('preserves distinct boundary IDs in provider order as numbers', async () => {
        seedFreshConnection();
        const { activitiesJson, statsJson } = mockSuccessfulProviderData({
          activities: [
            validProviderActivity({ id: 1 }),
            validProviderActivity({ id: Number.MAX_SAFE_INTEGER }),
          ],
        });

        const result = await stravaFetchStats({}, CONTEXT);

        expect(result.recentActivities.map(({ id }) => id)).toEqual([
          1,
          Number.MAX_SAFE_INTEGER,
        ]);
        result.recentActivities.forEach(({ id }) => expect(typeof id).toBe('number'));
        expect(activitiesJson).toHaveBeenCalledTimes(1);
        expect(statsJson).toHaveBeenCalledTimes(1);
        expectTwoFreshBearerReads();
        expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
        expect(admin.__getDeletes()).toEqual([]);
        expect(Timestamp.now).not.toHaveBeenCalled();
        expectNoWritesOrLogs();
      });
    });

    test.each([
      ['id', 987654],
      ['name', 'Synthetic Morning Run'],
      ['type', 'Run'],
      ['distance', 5000.5],
      ['moving_time', 1500],
      ['start_date_local', '2026-01-02T12:00:00Z'],
    ])('rejects a selected %s accessor without invoking it', async (field, value) => {
      const getter = jest.fn(() => value);
      const activity = validProviderActivity();
      if (field === 'type') delete activity.sport_type;
      if (field === 'start_date_local') delete activity.start_date;
      Object.defineProperty(activity, field, {
        configurable: true,
        enumerable: true,
        get: getter,
      });

      await expectInvalidSuccessfulProviderData({
        activities: [activity],
        invalidSurface: 'activities',
      });

      expect(getter).not.toHaveBeenCalled();
    });

    test('preserves fallback precedence without touching hostile fallback fields', async () => {
      seedFreshConnection();
      const sportTypeGetter = jest.fn(() => {
        throw new Error('sport-type-fallback-canary');
      });
      const startDateGetter = jest.fn(() => {
        throw new Error('start-date-fallback-canary');
      });
      const preferred = validProviderActivity({
        id: 1,
        type: 'TrailRun',
        start_date_local: '2026-02-03T04:05:06Z',
      });
      Object.defineProperty(preferred, 'sport_type', {
        configurable: true,
        enumerable: true,
        get: sportTypeGetter,
      });
      Object.defineProperty(preferred, 'start_date', {
        configurable: true,
        enumerable: true,
        get: startDateGetter,
      });
      const fallback = validProviderActivity({
        id: 2,
        type: '',
        sport_type: 'Run',
        start_date_local: null,
        start_date: '2026-03-04T05:06:07Z',
      });
      mockSuccessfulProviderData({ activities: [preferred, fallback] });

      const result = await stravaFetchStats({}, CONTEXT);

      expect(result.recentActivities.map(({ id, type, startDate }) => ({ id, type, startDate })))
        .toEqual([
          { id: 1, type: 'TrailRun', startDate: '2026-02-03T04:05:06Z' },
          { id: 2, type: 'Run', startDate: '2026-03-04T05:06:07Z' },
        ]);
      expect(sportTypeGetter).not.toHaveBeenCalled();
      expect(startDateGetter).not.toHaveBeenCalled();
      expectTwoFreshBearerReads();
      expectNoWritesOrLogs();
    });

    test('accepts exact bounds, five dense entries, and the safe-integer activity ceiling', async () => {
      seedFreshConnection();
      const safeId = Number.MAX_SAFE_INTEGER;
      const activities = Array.from({ length: 5 }, (_unused, index) => validProviderActivity({
        id: index === 0 ? safeId : index + 1,
        name: index === 0 ? '🏃'.repeat(MAX_ACTIVITY_NAME_LENGTH / 2) : `Run ${index}`,
        type: index === 0 ? 't'.repeat(MAX_ACTIVITY_TYPE_LENGTH) : undefined,
        sport_type: index === 0 ? 'ignored' : 'Run',
        distance: index === 0 ? Number.MAX_SAFE_INTEGER : 5000.5,
        moving_time: index === 0 ? Number.MAX_SAFE_INTEGER : 1500,
        start_date_local: index === 0 ? 'd'.repeat(MAX_ACTIVITY_DATE_LENGTH) : undefined,
      }));
      mockSuccessfulProviderData({ activities });

      const result = await stravaFetchStats({}, CONTEXT);

      expect(result.recentActivities).toHaveLength(5);
      expect(result.recentActivities[0]).toEqual({
        id: safeId,
        name: '🏃'.repeat(MAX_ACTIVITY_NAME_LENGTH / 2),
        type: 't'.repeat(MAX_ACTIVITY_TYPE_LENGTH),
        distanceMeters: Number.MAX_SAFE_INTEGER,
        movingTimeSeconds: Number.MAX_SAFE_INTEGER,
        startDate: 'd'.repeat(MAX_ACTIVITY_DATE_LENGTH),
      });
      expectTwoFreshBearerReads();
      expectNoWritesOrLogs();
    });

    test.each([
      ['undefined', undefined],
      ['null', null],
      ['a boolean', true],
      ['a number', 1],
      ['a string', 'stats'],
      ['a function', () => ({})],
      ['an array', []],
      ['a Date', new Date(0)],
      ['a null-prototype record', Object.create(null)],
      ['a custom-prototype record', Object.create({ inherited: true })],
      ['a class instance', new ProviderStats()],
    ])('rejects successful statistics root that is %s', async (_case, stats) => {
      await expectInvalidSuccessfulProviderData({
        stats,
        invalidSurface: 'stats',
      });
    });

    test('rejects a transparent statistics Proxy without inspecting it after await', async () => {
      const getTrap = jest.fn((_target, key) => {
        if (key === 'then') return undefined;
        throw new Error(`stats-root-canary ${String(key)}`);
      });
      const stats = new Proxy(validProviderStats(), {
        get: getTrap,
        getOwnPropertyDescriptor: jest.fn(() => {
          throw new Error('stats-root-canary descriptor');
        }),
        getPrototypeOf: jest.fn(() => {
          throw new Error('stats-root-canary prototype');
        }),
        ownKeys: jest.fn(() => {
          throw new Error('stats-root-canary ownKeys');
        }),
      });

      await expectInvalidSuccessfulProviderData({ stats, invalidSurface: 'stats' });

      expect(getTrap.mock.calls.map(([, key]) => key)).toEqual(['then']);
    });

    test('keeps a revoked statistics root inside the fixed unavailable JSON boundary', async () => {
      seedFreshConnection();
      const { proxy, revoke } = Proxy.revocable(validProviderStats(), {});
      revoke();
      const activitiesJson = jest.fn(() => [validProviderActivity()]);
      const statsJson = jest.fn(() => proxy);
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
      expect(activitiesJson).toHaveBeenCalledTimes(1);
      expect(statsJson).toHaveBeenCalledTimes(1);
      expectTwoFreshBearerReads();
      expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
      expect(admin.__getDeletes()).toEqual([]);
      expect(Timestamp.now).not.toHaveBeenCalled();
      expectNoWritesOrLogs();
    });

    test.each([
      ['an own undefined group', { ytd_run_totals: undefined }],
      ['an empty string group', { ytd_run_totals: '' }],
      ['an array group', { ytd_run_totals: [] }],
      ['a proxied group', { ytd_run_totals: new Proxy({ distance: 1, count: 1 }, {}) }],
      ['negative distance', { ytd_run_totals: { distance: -1, count: 1 } }],
      ['infinite distance', {
        ytd_run_totals: { distance: Number.POSITIVE_INFINITY, count: 1 },
      }],
      ['over-cap distance', {
        ytd_run_totals: { distance: Number.MAX_SAFE_INTEGER + 1, count: 1 },
      }],
      ['string distance', { ytd_run_totals: { distance: '1', count: 1 } }],
      ['own undefined distance', {
        ytd_run_totals: { distance: undefined, count: 1 },
      }],
      ['negative count', { ytd_run_totals: { distance: 1, count: -1 } }],
      ['fractional count', { ytd_run_totals: { distance: 1, count: 1.5 } }],
      ['unsafe count', {
        ytd_run_totals: { distance: 1, count: Number.MAX_SAFE_INTEGER + 1 },
      }],
      ['string count', { ytd_run_totals: { distance: 1, count: '1' } }],
    ])('rejects statistics with %s', async (_case, overrides) => {
      await expectInvalidSuccessfulProviderData({
        stats: validProviderStats(overrides),
        invalidSurface: 'stats',
      });
    });

    test('rejects a selected statistics group that cycles to the root', async () => {
      const stats = validProviderStats();
      stats.ytd_run_totals = stats;

      await expectInvalidSuccessfulProviderData({ stats, invalidSurface: 'stats' });
    });

    test.each([
      ['ytd_run_totals', { distance: 1, count: 1 }],
      ['ytd_ride_totals', { distance: 1, count: 1 }],
      ['all_run_totals', { distance: 1, count: 1 }],
    ])('rejects a selected %s accessor without invoking it', async (field, value) => {
      const getter = jest.fn(() => value);
      const stats = validProviderStats();
      Object.defineProperty(stats, field, {
        configurable: true,
        enumerable: true,
        get: getter,
      });

      await expectInvalidSuccessfulProviderData({ stats, invalidSurface: 'stats' });

      expect(getter).not.toHaveBeenCalled();
    });

    test.each([
      ['distance', 1],
      ['count', 1],
    ])('rejects a selected statistics %s accessor without invoking it', async (field, value) => {
      const getter = jest.fn(() => value);
      const total = { distance: 1, count: 1 };
      Object.defineProperty(total, field, {
        configurable: true,
        enumerable: true,
        get: getter,
      });

      await expectInvalidSuccessfulProviderData({
        stats: validProviderStats({ ytd_run_totals: total }),
        invalidSurface: 'stats',
      });

      expect(getter).not.toHaveBeenCalled();
    });

    test('rejects inherited required activity data without invoking its getter', async () => {
      const inheritedGetter = jest.fn(() => 987654);
      const activity = validProviderActivity();
      delete activity.id;
      Object.defineProperty(Object.prototype, 'id', {
        configurable: true,
        get: inheritedGetter,
      });

      try {
        await expectInvalidSuccessfulProviderData({
          activities: [activity],
          invalidSurface: 'activities',
        });
      } finally {
        delete Object.prototype.id;
      }

      expect(inheritedGetter).not.toHaveBeenCalled();
    });

    test('rejects an inherited preferred activity field without invoking it', async () => {
      const inheritedGetter = jest.fn(() => 'InheritedRun');
      const activity = validProviderActivity();
      Object.defineProperty(Object.prototype, 'type', {
        configurable: true,
        get: inheritedGetter,
      });

      try {
        await expectInvalidSuccessfulProviderData({
          activities: [activity],
          invalidSurface: 'activities',
        });
      } finally {
        delete Object.prototype.type;
      }

      expect(inheritedGetter).not.toHaveBeenCalled();
    });

    test.each([
      ['an activity distance', (hooks) => ({
        activities: [validProviderActivity({ distance: hooks })],
        invalidSurface: 'activities',
      })],
      ['a statistics count', (hooks) => ({
        stats: validProviderStats({
          ytd_run_totals: { distance: 1, count: hooks },
        }),
        invalidSurface: 'stats',
      })],
    ])('does not invoke coercion or JSON hooks for %s', async (_case, makeOptions) => {
      const hooks = {
        toJSON: jest.fn(() => 1),
        toString: jest.fn(() => '1'),
        valueOf: jest.fn(() => 1),
        [Symbol.toPrimitive]: jest.fn(() => 1),
      };

      await expectInvalidSuccessfulProviderData(makeOptions(hooks));

      expect(hooks.toJSON).not.toHaveBeenCalled();
      expect(hooks.toString).not.toHaveBeenCalled();
      expect(hooks.valueOf).not.toHaveBeenCalled();
      expect(hooks[Symbol.toPrimitive]).not.toHaveBeenCalled();
    });

    test.each([
      ['selected totals group', 'ytd_run_totals', {}],
      ['selected total distance', 'distance', { ytd_run_totals: {} }],
    ])('rejects an inherited %s getter without invoking it', async (_case, field, stats) => {
      const inheritedGetter = jest.fn(() => ({ distance: 999, count: 999 }));
      Object.defineProperty(Object.prototype, field, {
        configurable: true,
        get: inheritedGetter,
      });

      try {
        await expectInvalidSuccessfulProviderData({ stats, invalidSurface: 'stats' });
      } finally {
        delete Object.prototype[field];
      }

      expect(inheritedGetter).not.toHaveBeenCalled();
    });

    test('preserves zero totals for missing and null selected groups and values', async () => {
      seedFreshConnection();
      const stats = {
        ytd_run_totals: { distance: null },
        ytd_ride_totals: null,
      };
      mockSuccessfulProviderData({ stats });

      const result = await stravaFetchStats({}, CONTEXT);

      expect(result.yearToDate).toEqual({
        runMeters: 0,
        runCount: 0,
        rideMeters: 0,
        rideCount: 0,
      });
      expect(result.allTime).toEqual({ runMeters: 0, runCount: 0 });
      expectTwoFreshBearerReads();
      expectNoWritesOrLogs();
    });

    test('ignores unknown provider getters, symbols, hooks, and cycles', async () => {
      seedFreshConnection();
      const unknownActivityGetter = jest.fn(() => {
        throw new Error('unknown-activity-canary');
      });
      const unknownStatsGetter = jest.fn(() => {
        throw new Error('unknown-stats-canary');
      });
      const unknownTotalGetter = jest.fn(() => {
        throw new Error('unknown-total-canary');
      });
      const activity = validProviderActivity({
        raw_token: 'provider-secret-canary',
      });
      Object.defineProperty(activity, 'unknown', {
        configurable: true,
        enumerable: true,
        get: unknownActivityGetter,
      });
      activity.self = activity;
      activity[Symbol('activity-unknown')] = { secret: 'symbol-secret-canary' };
      const runTotals = { distance: 12000.5, count: 3 };
      Object.defineProperty(runTotals, 'unknown', {
        configurable: true,
        enumerable: true,
        get: unknownTotalGetter,
      });
      runTotals.self = runTotals;
      const stats = validProviderStats({ ytd_run_totals: runTotals });
      Object.defineProperty(stats, 'unknown', {
        configurable: true,
        enumerable: true,
        get: unknownStatsGetter,
      });
      stats.self = stats;
      mockSuccessfulProviderData({ activities: [activity], stats });

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
          distanceMeters: 5000.5,
          movingTimeSeconds: 1500,
          startDate: '2026-01-02T12:00:00Z',
        }],
        yearToDate: {
          runMeters: 12000.5,
          runCount: 3,
          rideMeters: 20000.25,
          rideCount: 2,
        },
        allTime: { runMeters: 345000.75, runCount: 84 },
      });
      expect(JSON.stringify(result)).not.toMatch(/provider-secret|symbol-secret|canary/i);
      expect(unknownActivityGetter).not.toHaveBeenCalled();
      expect(unknownStatsGetter).not.toHaveBeenCalled();
      expect(unknownTotalGetter).not.toHaveBeenCalled();
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.athlete)).toBe(true);
      expect(Object.isFrozen(result.recentActivities)).toBe(true);
      expect(Object.isFrozen(result.recentActivities[0])).toBe(true);
      expect(Object.isFrozen(result.yearToDate)).toBe(true);
      expect(Object.isFrozen(result.allTime)).toBe(true);
      expectTwoFreshBearerReads();
      expectNoWritesOrLogs();
    });

    test('snapshots activities before awaiting statistics JSON', async () => {
      seedFreshConnection();
      const activity = validProviderActivity();
      let resolveStats;
      let markStatsStarted;
      const statsStarted = new Promise((resolve) => { markStatsStarted = resolve; });
      const statsPending = new Promise((resolve) => { resolveStats = resolve; });
      const activitiesJson = jest.fn(() => [activity]);
      const statsJson = jest.fn(() => {
        markStatsStarted();
        return statsPending;
      });
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: activitiesJson })
        .mockResolvedValueOnce({ ok: true, json: statsJson });

      const resultPromise = stravaFetchStats({}, CONTEXT);
      await statsStarted;
      Object.assign(activity, {
        id: 999999,
        name: 'Mutated Provider Activity',
        sport_type: 'Ride',
        distance: 999999,
        moving_time: 999999,
        start_date: '2099-01-01T00:00:00Z',
      });
      resolveStats(validProviderStats());
      const result = await resultPromise;

      expect(result.recentActivities).toEqual([{
        id: 987654,
        name: 'Synthetic Morning Run',
        type: 'Run',
        distanceMeters: 5000.5,
        movingTimeSeconds: 1500,
        startDate: '2026-01-02T12:00:00Z',
      }]);
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

  describe('OAUTH-001A2J Strava response-status admission', () => {
    test('rejects an activities ok accessor without invoking or exposing it', async () => {
      seedFreshConnection();
      const statusFailure = new Error(
        'activities-ok-canary access_token=provider-secret-canary',
      );
      const okGetter = jest.fn(() => {
        throw statusFailure;
      });
      const activitiesJson = jest.fn();
      const activitiesResponse = { json: activitiesJson };
      Object.defineProperty(activitiesResponse, 'ok', {
        configurable: true,
        enumerable: true,
        get: okGetter,
      });
      const statsJson = jest.fn();
      fetchMock
        .mockResolvedValueOnce(activitiesResponse)
        .mockResolvedValueOnce({ ok: true, json: statsJson });

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expect(rejection).not.toBe(statusFailure);
      expect(publicError(rejection)).toEqual({
        code: 'internal',
        message: FIXED_DATA_ERROR,
        details: undefined,
        cause: undefined,
      });
      expect(JSON.stringify(publicError(rejection)))
        .not.toMatch(/activities-ok-canary|provider-secret-canary/i);
      expect(okGetter).not.toHaveBeenCalled();
      expect(activitiesJson).not.toHaveBeenCalled();
      expect(statsJson).not.toHaveBeenCalled();
      expectTwoFreshBearerReads();
      expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
      expect(admin.__getWrites()).toEqual([]);
      expect(admin.__getDeletes()).toEqual([]);
      expect(Timestamp.now).not.toHaveBeenCalled();
      expectNoWritesOrLogs();
    });

    test('rejects a resolved activities Proxy without inspecting it after then lookup', async () => {
      seedFreshConnection();
      const activitiesJson = jest.fn();
      const getTrap = jest.fn((_target, key) => {
        if (key === 'then') return undefined;
        throw new Error(`activities-response-canary ${String(key)}`);
      });
      const response = new Proxy({ ok: true, json: activitiesJson }, {
        get: getTrap,
        getOwnPropertyDescriptor: jest.fn(() => {
          throw new Error('activities-response-canary descriptor');
        }),
        getPrototypeOf: jest.fn(() => {
          throw new Error('activities-response-canary prototype');
        }),
        ownKeys: jest.fn(() => {
          throw new Error('activities-response-canary keys');
        }),
      });
      const statsJson = jest.fn();
      fetchMock
        .mockResolvedValueOnce(response)
        .mockResolvedValueOnce({ ok: true, json: statsJson });

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expect(publicError(rejection)).toEqual({
        code: 'internal',
        message: FIXED_DATA_ERROR,
        details: undefined,
        cause: undefined,
      });
      const requestedKeys = getTrap.mock.calls.map(([, key]) => key);
      expect(requestedKeys.length).toBeGreaterThanOrEqual(1);
      expect(requestedKeys.every((key) => key === 'then')).toBe(true);
      expect(activitiesJson).not.toHaveBeenCalled();
      expect(statsJson).not.toHaveBeenCalled();
      expectTwoFreshBearerReads();
      expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
      expectNoWritesOrLogs();
    });

    test('contains an already-revoked activities Proxy as transport unavailable before status admission', async () => {
      seedFreshConnection();
      const { proxy: activitiesResponse, revoke } = Proxy.revocable({ ok: true }, {});
      revoke();
      const statsJson = jest.fn();
      fetchMock
        .mockResolvedValueOnce(activitiesResponse)
        .mockResolvedValueOnce({ ok: true, json: statsJson });

      const rejection = await captureFailure(() => stravaFetchStats({}, CONTEXT));

      expect(publicError(rejection)).toEqual({
        code: 'unavailable',
        message: FIXED_DATA_ERROR,
        details: undefined,
        cause: undefined,
      });
      expect(statsJson).not.toHaveBeenCalled();
      expectTwoFreshBearerReads();
      expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
      expect(admin.__getWrites()).toEqual([]);
      expect(admin.__getDeletes()).toEqual([]);
      expect(Timestamp.now).not.toHaveBeenCalled();
      expectNoWritesOrLogs();
    });

    test('rejects a statistics Proxy revoked after Promise fulfillment without inspecting it', async () => {
      seedFreshConnection();
      const activitiesJson = jest.fn().mockResolvedValue([validProviderActivity()]);
      const statsJson = jest.fn();
      const { proxy: statsResponse, revoke } = Proxy.revocable({
        ok: true,
        json: statsJson,
      }, {});
      const fulfilledStatsResponse = Promise.resolve(statsResponse);
      revoke();
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: activitiesJson })
        .mockReturnValueOnce(fulfilledStatsResponse);

      const result = await stravaFetchStats({}, CONTEXT);

      expect(result.recentActivities).toHaveLength(1);
      expect(result.yearToDate).toBeNull();
      expect(result.allTime).toBeNull();
      expect(activitiesJson).toHaveBeenCalledTimes(1);
      expect(statsJson).not.toHaveBeenCalled();
      expectTwoFreshBearerReads();
      expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
      expect(admin.__getWrites()).toEqual([]);
      expect(admin.__getDeletes()).toEqual([]);
      expect(Timestamp.now).not.toHaveBeenCalled();
      expectNoWritesOrLogs();
    });

    test('treats a statistics ok accessor as optional failure without invoking it', async () => {
      seedFreshConnection();
      const activitiesJson = jest.fn().mockResolvedValue([validProviderActivity()]);
      const statsJson = jest.fn();
      const okGetter = jest.fn(() => {
        throw new Error('statistics-ok-canary access_token=provider-secret-canary');
      });
      const statsResponse = { json: statsJson };
      Object.defineProperty(statsResponse, 'ok', {
        configurable: true,
        enumerable: true,
        get: okGetter,
      });
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: activitiesJson })
        .mockResolvedValueOnce(statsResponse);

      const result = await stravaFetchStats({}, CONTEXT);

      expect(result.recentActivities).toHaveLength(1);
      expect(result.yearToDate).toBeNull();
      expect(result.allTime).toBeNull();
      expect(okGetter).not.toHaveBeenCalled();
      expect(activitiesJson).toHaveBeenCalledTimes(1);
      expect(statsJson).not.toHaveBeenCalled();
      expectTwoFreshBearerReads();
      expect(admin.__getReads()).toEqual([CONNECTION_PATH, SECRET_PATH]);
      expect(admin.__getWrites()).toEqual([]);
      expect(admin.__getDeletes()).toEqual([]);
      expect(Timestamp.now).not.toHaveBeenCalled();
      expectNoWritesOrLogs();
    });
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
  let dateNowSpy;

  const STRAVA_REVOKE_URL = 'https://www.strava.com/oauth/revoke';
  const SYNTHETIC_CLIENT_ID = '12345';
  const SYNTHETIC_CLIENT_SECRET = 'abc123';
  const SYNTHETIC_BASIC_AUTHORIZATION = 'Basic MTIzNDU6YWJjMTIz';
  const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';
  const FIXED_CLEANUP_WARNING = 'strava_disconnect_cleanup_failed';
  const FIXED_SECRET_READ_WARNING = 'strava_disconnect_secret_read_failed';

  beforeEach(() => {
    process.env.STRAVA_CLIENT_ID = SYNTHETIC_CLIENT_ID;
    process.env.STRAVA_CLIENT_SECRET = SYNTHETIC_CLIENT_SECRET;
    admin.__clearDeletes();
    admin.__clearDocuments();
    admin.__clearReads();
    admin.__clearWrites();
    requireAppCheck.mockReset();
    Timestamp.now.mockClear();
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
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
    dateNowSpy.mockRestore();
    Object.values(consoleSpies).forEach((spy) => spy.mockRestore());
    delete process.env.STRAVA_CLIENT_ID;
    delete process.env.STRAVA_CLIENT_SECRET;
  });

  function seedStoredSecret(secret) {
    admin.__setDocument(SECRET_PATH, secret);
  }

  function seedAccessToken(accessToken = 'synthetic_disconnect_access_token_test') {
    seedStoredSecret({ access_token: accessToken });
  }

  function seedConnectedAccount(accessToken = 'synthetic_disconnect_access_token_test') {
    seedAccessToken(accessToken);
    admin.__setDocument(CONNECTION_PATH, {
      provider: 'strava',
      connected: true,
    });
  }

  function expectLocalDeletes() {
    const operations = [
      { type: 'delete', path: SECRET_PATH },
      { type: 'delete', path: CONNECTION_PATH },
    ];
    expect(admin.__getDeletes()).toEqual([]);
    expect(admin.__getBatchCreateAttempts()).toBe(1);
    expect(admin.__getBatchDeleteAttempts()).toEqual([SECRET_PATH, CONNECTION_PATH]);
    expect(admin.__getBatchDeletes()).toEqual([SECRET_PATH, CONNECTION_PATH]);
    expect(admin.__getBatchSetAttempts()).toEqual([]);
    expect(admin.__getBatchCommitAttempts()).toEqual([operations]);
    expect(admin.__getWrites()).toEqual([]);
    expect(admin.__hasDocument(SECRET_PATH)).toBe(false);
    expect(admin.__hasDocument(CONNECTION_PATH)).toBe(false);
  }

  function expectLocalRecordsPreserved() {
    expect(admin.__getDeletes()).toEqual([]);
    expect(admin.__getBatchCreateAttempts()).toBe(0);
    expect(admin.__getBatchDeleteAttempts()).toEqual([]);
    expect(admin.__getBatchDeletes()).toEqual([]);
    expect(admin.__getBatchCommitAttempts()).toEqual([]);
    expect(admin.__getWrites()).toEqual([]);
    expect(admin.__hasDocument(SECRET_PATH)).toBe(true);
    expect(admin.__hasDocument(CONNECTION_PATH)).toBe(true);
  }

  function expectFixedDisconnectError(error) {
    expect(publicError(error)).toEqual({
      code: 'unavailable',
      message: FIXED_DISCONNECT_ERROR,
      details: undefined,
      cause: undefined,
    });
  }

  function expectNoLogs() {
    Object.values(consoleSpies).forEach((spy) => expect(spy).not.toHaveBeenCalled());
  }

  function expectNoDisconnectSideEffects() {
    expect(admin.__getReads()).toEqual([]);
    expect(admin.__getDeletes()).toEqual([]);
    expect(admin.__getBatchCreateAttempts()).toBe(0);
    expect(admin.__getBatchDeleteAttempts()).toEqual([]);
    expect(admin.__getBatchDeletes()).toEqual([]);
    expect(admin.__getBatchCommitAttempts()).toEqual([]);
    expect(admin.__getWrites()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dateNowSpy).not.toHaveBeenCalled();
    expect(Timestamp.now).not.toHaveBeenCalled();
    expectNoLogs();
  }

  function expectSupportedRevokeRequest(accessToken, expectedBody) {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe(STRAVA_REVOKE_URL);
    expect(init).toEqual({
      method: 'POST',
      headers: {
        Authorization: SYNTHETIC_BASIC_AUTHORIZATION,
        'Content-Type': FORM_CONTENT_TYPE,
      },
      body: expect.any(String),
    });
    expect(init.body).not.toContain(SYNTHETIC_CLIENT_ID);
    expect(init.body).not.toContain(SYNTHETIC_CLIENT_SECRET);
    if (expectedBody !== undefined) expect(init.body).toBe(expectedBody);

    const params = new URLSearchParams(init.body);
    expect([...params.keys()]).toEqual(['token', 'token_type_hint']);
    expect(params.getAll('token')).toEqual([accessToken]);
    expect(params.getAll('token_type_hint')).toEqual(['access_token']);
    expect(params.has('access_token')).toBe(false);
    expect(params.has('client_id')).toBe(false);
    expect(params.has('client_secret')).toBe(false);
  }

  async function expectRejectedDisconnectRequest(data) {
    seedAccessToken('synthetic_disconnect_request_boundary_token');
    fetchMock.mockRejectedValue(new Error('disconnect-request provider canary'));

    const rejection = await captureFailure(() => stravaDisconnect(data, CONTEXT));

    expect(publicError(rejection)).toEqual({
      code: 'invalid-argument',
      message: FIXED_DISCONNECT_REQUEST_ERROR,
      details: undefined,
      cause: undefined,
    });
    expect(requireAppCheck).toHaveBeenCalledTimes(1);
    expect(requireAppCheck).toHaveBeenCalledWith(CONTEXT);
    expectNoDisconnectSideEffects();
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
    const authGetter = jest.fn(() => CONTEXT.auth);
    const context = Object.defineProperty(
      { app: CONTEXT.app },
      'auth',
      { enumerable: true, get: authGetter },
    );
    const traps = {
      getPrototypeOf: jest.fn(() => {
        throw new Error('disconnect-request-order-canary prototype trap');
      }),
      ownKeys: jest.fn(() => {
        throw new Error('disconnect-request-order-canary ownKeys trap');
      }),
    };
    const data = new Proxy({}, traps);

    await expect(stravaDisconnect(data, context)).rejects.toBe(appCheckFailure);

    expect(requireAppCheck).toHaveBeenCalledWith(context);
    expect(authGetter).not.toHaveBeenCalled();
    Object.values(traps).forEach((trap) => expect(trap).not.toHaveBeenCalled());
    expectNoDisconnectSideEffects();
  });

  test('rejects a missing caller before Firestore, provider access, or deletion', async () => {
    const traps = {
      getPrototypeOf: jest.fn(() => {
        throw new Error('disconnect-request-auth-order-canary prototype trap');
      }),
      ownKeys: jest.fn(() => {
        throw new Error('disconnect-request-auth-order-canary ownKeys trap');
      }),
    };
    const data = new Proxy({}, traps);
    const rejection = await captureFailure(() => (
      stravaDisconnect(data, { ...CONTEXT, auth: null })
    ));

    expect(publicError(rejection)).toEqual({
      code: 'unauthenticated',
      message: 'Sign-in required',
      details: undefined,
      cause: undefined,
    });

    expect(requireAppCheck).toHaveBeenCalledTimes(1);
    Object.values(traps).forEach((trap) => expect(trap).not.toHaveBeenCalled());
    expectNoDisconnectSideEffects();
  });

  describe('request validation before side effects', () => {
    class DisconnectRequest {
      constructor() {
        this.unexpected = true;
      }
    }

    const nonEnumerableRequest = {};
    Object.defineProperty(nonEnumerableRequest, 'unexpected', {
      configurable: true,
      enumerable: false,
      value: true,
    });
    const symbolRequest = { [Symbol('unexpected')]: true };

    test.each([
      ['undefined', undefined],
      ['null', null],
      ['a boolean', false],
      ['a number', 0],
      ['a bigint', 0n],
      ['a string', ''],
      ['a symbol', Symbol('disconnect-request-canary')],
      ['a function', () => undefined],
      ['an array', []],
      ['a Date', new Date(0)],
      ['a class instance', new DisconnectRequest()],
      ['a null-prototype record', Object.create(null)],
      ['a custom-prototype record', Object.create({ inherited: true })],
      ['an enumerable extra key', { unexpected: true }],
      ['a non-enumerable extra key', nonEnumerableRequest],
      ['a symbol extra key', symbolRequest],
    ])('rejects %s before Firestore, provider, delete, timestamp, or log work', async (
      _case,
      data,
    ) => {
      await expectRejectedDisconnectRequest(data);
    });

    test('rejects a Proxy without invoking any trap', async () => {
      const traps = {
        get: jest.fn(() => {
          throw new Error('disconnect-request-canary get trap');
        }),
        getOwnPropertyDescriptor: jest.fn(() => {
          throw new Error('disconnect-request-canary descriptor trap');
        }),
        getPrototypeOf: jest.fn(() => {
          throw new Error('disconnect-request-canary prototype trap');
        }),
        has: jest.fn(() => {
          throw new Error('disconnect-request-canary has trap');
        }),
        ownKeys: jest.fn(() => {
          throw new Error('disconnect-request-canary ownKeys trap');
        }),
      };
      const data = new Proxy({}, traps);

      await expectRejectedDisconnectRequest(data);

      Object.values(traps).forEach((trap) => expect(trap).not.toHaveBeenCalled());
    });

    test('rejects a revoked Proxy without reflection', async () => {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();

      await expectRejectedDisconnectRequest(proxy);
    });

    test('rejects an accessor-backed record without invoking the accessor', async () => {
      const getter = jest.fn(() => {
        throw new Error('disconnect-request-canary getter');
      });
      const data = {};
      Object.defineProperty(data, 'unexpected', {
        configurable: true,
        enumerable: true,
        get: getter,
      });

      await expectRejectedDisconnectRequest(data);

      expect(getter).not.toHaveBeenCalled();
    });

    test('does not invoke coercion, iteration, or JSON hooks', async () => {
      const hooks = {
        toJSON: jest.fn(() => 'disconnect-request-canary'),
        toString: jest.fn(() => 'disconnect-request-canary'),
        valueOf: jest.fn(() => 'disconnect-request-canary'),
        [Symbol.iterator]: jest.fn(() => [][Symbol.iterator]()),
        [Symbol.toPrimitive]: jest.fn(() => 'disconnect-request-canary'),
      };

      await expectRejectedDisconnectRequest(hooks);

      expect(hooks.toJSON).not.toHaveBeenCalled();
      expect(hooks.toString).not.toHaveBeenCalled();
      expect(hooks.valueOf).not.toHaveBeenCalled();
      expect(hooks[Symbol.iterator]).not.toHaveBeenCalled();
      expect(hooks[Symbol.toPrimitive]).not.toHaveBeenCalled();
    });
  });

  test('skips provider access when no server-only token exists and still deletes locally', async () => {
    const result = await stravaDisconnect({}, CONTEXT);

    expect(result).toEqual({ ok: true });
    expect(admin.__getReads()).toEqual([SECRET_PATH]);
    expect(fetchMock).not.toHaveBeenCalled();
    expectLocalDeletes();
    expectNoLogs();
  });

  describe('OAUTH-001B6 supported revoke request contract', () => {
    test('uses Basic credentials and an exact encoded token form without URL or field injection', async () => {
      const accessToken = 'synthetic+disconnect&token=%=:?/';
      seedConnectedAccount(accessToken);
      fetchMock.mockResolvedValue({ ok: true });

      const result = await stravaDisconnect({}, CONTEXT);

      expect(result).toEqual({ ok: true });
      expectSupportedRevokeRequest(
        accessToken,
        'token=synthetic%2Bdisconnect%26token%3D%25%3D%3A%3F%2F'
          + '&token_type_hint=access_token',
      );
      expect(fetchMock.mock.calls[0][1].headers.Authorization).not.toContain(accessToken);
      expectLocalDeletes();
      expectNoLogs();
    });

    test.each([
      ['client ID', 'STRAVA_CLIENT_ID'],
      ['client secret', 'STRAVA_CLIENT_SECRET'],
    ])('fails closed when the synthetic %s is missing', async (_case, variable) => {
      delete process.env[variable];
      seedConnectedAccount();
      fetchMock.mockResolvedValue({ ok: true });

      const rejection = await captureFailure(() => stravaDisconnect({}, CONTEXT));

      expectFixedDisconnectError(rejection);
      expect(fetchMock).not.toHaveBeenCalled();
      expectLocalRecordsPreserved();
      expect(consoleSpies.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpies.warn).toHaveBeenCalledWith(FIXED_DISCONNECT_WARNING);
      expect(JSON.stringify({
        public: publicError(rejection),
        logs: consoleSpies.warn.mock.calls,
      })).not.toMatch(/12345|abc123|credentials not configured/i);
      ['debug', 'error', 'info', 'log']
        .forEach((method) => expect(consoleSpies[method]).not.toHaveBeenCalled());
    });

    test.each([
      ['no secret document', null],
      ['a rejected stored token', { access_token: 'token with space' }],
    ])('does not require provider credentials for %s cleanup', async (_case, secret) => {
      delete process.env.STRAVA_CLIENT_ID;
      delete process.env.STRAVA_CLIENT_SECRET;
      if (secret !== null) seedStoredSecret(secret);

      const result = await stravaDisconnect({}, CONTEXT);

      expect(result).toEqual({ ok: true });
      expect(fetchMock).not.toHaveBeenCalled();
      expectLocalDeletes();
      expectNoLogs();
    });

    test('keeps both local records until provider success is admitted', async () => {
      let signalFetchCalled;
      let resolveResponse;
      const fetchCalled = new Promise((resolve) => {
        signalFetchCalled = resolve;
      });
      const providerResponse = new Promise((resolve) => {
        resolveResponse = resolve;
      });
      seedConnectedAccount();
      fetchMock.mockImplementation(() => {
        signalFetchCalled();
        return providerResponse;
      });

      const pendingDisconnect = stravaDisconnect({}, CONTEXT);
      await fetchCalled;

      expectSupportedRevokeRequest('synthetic_disconnect_access_token_test');
      expectLocalRecordsPreserved();
      expectNoLogs();

      resolveResponse({ ok: true });
      await expect(pendingDisconnect).resolves.toEqual({ ok: true });
      expectLocalDeletes();
      expectNoLogs();
    });

    test('preserves records after a lost acknowledgement and permits a later HTTP 200 retry', async () => {
      seedConnectedAccount();
      fetchMock.mockRejectedValue(
        new Error('first-attempt-lost-acknowledgement canary'),
      );

      const firstFailure = await captureFailure(() => stravaDisconnect({}, CONTEXT));

      expectFixedDisconnectError(firstFailure);
      expectLocalRecordsPreserved();
      expect(consoleSpies.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpies.warn).toHaveBeenCalledWith(FIXED_DISCONNECT_WARNING);
      expect(JSON.stringify(consoleSpies.warn.mock.calls))
        .not.toMatch(/lost-acknowledgement|canary/i);

      fetchMock.mockReset();
      consoleSpies.warn.mockClear();
      const response = new Response('synthetic-provider-response-body-canary', {
        status: 200,
      });
      fetchMock.mockResolvedValue(response);

      const result = await stravaDisconnect({}, CONTEXT);

      expect(result).toEqual({ ok: true });
      expectSupportedRevokeRequest('synthetic_disconnect_access_token_test');
      expect(response.bodyUsed).toBe(false);
      expectLocalDeletes();
      expectNoLogs();
    });
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
      expectSupportedRevokeRequest('synthetic_disconnect_access_token_test');
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
      expectSupportedRevokeRequest('synthetic_disconnect_access_token_test');
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
      expectSupportedRevokeRequest(accessToken);
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
      expectSupportedRevokeRequest('synthetic_disconnect_access_token_test');
      expectLocalDeletes();
      expectNoLogs();
    });
  });

  test('preserves the successful provider POST and local deletes', async () => {
    seedAccessToken();
    fetchMock.mockResolvedValue({ ok: true });

    const result = await stravaDisconnect({}, CONTEXT);

    expect(result).toEqual({ ok: true });
    expect(admin.__getReads()).toEqual([SECRET_PATH]);
    expectSupportedRevokeRequest('synthetic_disconnect_access_token_test');
    expectLocalDeletes();
    expectNoLogs();
  });

  test('accepts a genuine successful Node Response before local deletes', async () => {
    seedAccessToken();
    const response = new Response('synthetic-provider-response-body-canary', {
      status: 200,
    });
    fetchMock.mockResolvedValue(response);

    const result = await stravaDisconnect({}, CONTEXT);

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.bodyUsed).toBe(false);
    expectLocalDeletes();
    expectNoLogs();
  });

  test.each([400, 401, 429, 500])(
    'rejects provider HTTP %i without reading its body or deleting locally',
    async (status) => {
      seedConnectedAccount();
      const text = jest.fn().mockResolvedValue(
        'provider-body-canary access_token=provider-secret-canary',
      );
      const json = jest.fn();
      const statusGetter = jest.fn(() => status);
      const bodyGetter = jest.fn(() => 'provider-body-canary');
      const statusTextGetter = jest.fn(() => 'provider-status-text-canary');
      const response = { ok: false, text, json };
      Object.defineProperties(response, {
        body: {
          configurable: true,
          enumerable: true,
          get: bodyGetter,
        },
        status: {
          configurable: true,
          enumerable: true,
          get: statusGetter,
        },
        statusText: {
          configurable: true,
          enumerable: true,
          get: statusTextGetter,
        },
      });
      fetchMock.mockResolvedValue(response);

      const rejection = await captureFailure(() => stravaDisconnect({}, CONTEXT));

      expectFixedDisconnectError(rejection);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(text).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
      expect(bodyGetter).not.toHaveBeenCalled();
      expect(statusGetter).not.toHaveBeenCalled();
      expect(statusTextGetter).not.toHaveBeenCalled();
      expectLocalRecordsPreserved();
      expectNoLogs();
    },
  );

  test('rejects a genuine non-success Node Response without reading its body', async () => {
    seedConnectedAccount();
    const response = new Response('provider-body-canary access_token=secret-canary', {
      status: 503,
    });
    fetchMock.mockResolvedValue(response);

    const rejection = await captureFailure(() => stravaDisconnect({}, CONTEXT));

    expectFixedDisconnectError(rejection);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.bodyUsed).toBe(false);
    expectLocalRecordsPreserved();
    expectNoLogs();
  });

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['a boolean', true],
    ['a number', 1],
    ['a string', 'ok'],
    ['an array', [{ ok: true }]],
    ['a Date', Object.assign(new Date(0), { ok: true })],
    ['a plain record missing ok', {}],
    ['own undefined ok', { ok: undefined }],
    ['own null ok', { ok: null }],
    ['numeric ok', { ok: 1 }],
    ['string ok', { ok: 'true' }],
    ['custom-prototype ok', Object.assign(Object.create({ inherited: true }), { ok: true })],
  ])('rejects provider success evidence that is %s', async (_case, response) => {
    seedConnectedAccount();
    fetchMock.mockResolvedValue(response);

    const rejection = await captureFailure(() => stravaDisconnect({}, CONTEXT));

    expectFixedDisconnectError(rejection);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectLocalRecordsPreserved();
    expectNoLogs();
  });

  test('rejects an own ok accessor without invoking it', async () => {
    seedConnectedAccount();
    const okGetter = jest.fn(() => true);
    const response = {};
    Object.defineProperty(response, 'ok', {
      configurable: true,
      enumerable: true,
      get: okGetter,
    });
    fetchMock.mockResolvedValue(response);

    const rejection = await captureFailure(() => stravaDisconnect({}, CONTEXT));

    expectFixedDisconnectError(rejection);
    expect(okGetter).not.toHaveBeenCalled();
    expectLocalRecordsPreserved();
    expectNoLogs();
  });

  test('rejects an inherited ok accessor without invoking it', async () => {
    seedConnectedAccount();
    const okGetter = jest.fn(() => true);
    const prototype = {};
    Object.defineProperty(prototype, 'ok', {
      configurable: true,
      enumerable: true,
      get: okGetter,
    });
    fetchMock.mockResolvedValue(Object.create(prototype));

    const rejection = await captureFailure(() => stravaDisconnect({}, CONTEXT));

    expectFixedDisconnectError(rejection);
    expect(okGetter).not.toHaveBeenCalled();
    expectLocalRecordsPreserved();
    expectNoLogs();
  });

  test('rejects a Proxy provider result without inspecting it after Promise resolution', async () => {
    seedConnectedAccount();
    const traps = {
      get: jest.fn((_target, key) => {
        if (key === 'then') return undefined;
        throw new Error('disconnect-response-canary get trap');
      }),
      getOwnPropertyDescriptor: jest.fn(() => {
        throw new Error('disconnect-response-canary descriptor trap');
      }),
      getPrototypeOf: jest.fn(() => {
        throw new Error('disconnect-response-canary prototype trap');
      }),
      ownKeys: jest.fn(() => {
        throw new Error('disconnect-response-canary ownKeys trap');
      }),
    };
    fetchMock.mockResolvedValue(new Proxy({ ok: true }, traps));

    const rejection = await captureFailure(() => stravaDisconnect({}, CONTEXT));

    expectFixedDisconnectError(rejection);
    const requestedKeys = traps.get.mock.calls.map(([, key]) => key);
    expect(requestedKeys.length).toBeGreaterThanOrEqual(1);
    expect(requestedKeys.every((key) => key === 'then')).toBe(true);
    [traps.getOwnPropertyDescriptor, traps.getPrototypeOf, traps.ownKeys]
      .forEach((trap) => expect(trap).not.toHaveBeenCalled());
    expectLocalRecordsPreserved();
    expectNoLogs();
  });

  test('accepts an own true result without consulting hostile unknown fields', async () => {
    seedAccessToken();
    const unknownGetter = jest.fn(() => {
      throw new Error('disconnect-response-canary unknown getter');
    });
    const text = jest.fn();
    const json = jest.fn();
    const bodyGetter = jest.fn(() => 'disconnect-response-canary body');
    const statusTextGetter = jest.fn(() => 'disconnect-response-canary status text');
    const response = { ok: true, text, json };
    Object.defineProperties(response, {
      body: {
        configurable: true,
        enumerable: true,
        get: bodyGetter,
      },
      status: {
        configurable: true,
        enumerable: true,
        get: unknownGetter,
      },
      statusText: {
        configurable: true,
        enumerable: true,
        get: statusTextGetter,
      },
    });
    fetchMock.mockResolvedValue(response);

    const result = await stravaDisconnect({}, CONTEXT);

    expect(result).toEqual({ ok: true });
    expect(unknownGetter).not.toHaveBeenCalled();
    expect(bodyGetter).not.toHaveBeenCalled();
    expect(statusTextGetter).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expectLocalDeletes();
    expectNoLogs();
  });

  test('replaces a raw provider exception with one fixed warning and preserves local records', async () => {
    seedConnectedAccount();
    fetchMock.mockRejectedValue(Object.assign(
      new Error('transport-canary https://provider.example.test/?token=secret-canary'),
      {
        cause: new Error('cause-canary'),
        details: 'details-canary',
        providerBody: 'provider-body-canary',
      },
    ));

    const rejection = await captureFailure(() => stravaDisconnect({}, CONTEXT));

    expectFixedDisconnectError(rejection);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(consoleSpies.warn).toHaveBeenCalledTimes(1);
    expect(consoleSpies.warn).toHaveBeenCalledWith(FIXED_DISCONNECT_WARNING);
    expect(JSON.stringify(consoleSpies.warn.mock.calls))
      .not.toMatch(
        /transport-canary|provider\.example|secret-canary|cause-canary|details-canary|provider-body-canary/i,
      );
    ['debug', 'error', 'info', 'log']
      .forEach((method) => expect(consoleSpies[method]).not.toHaveBeenCalled());
    expectLocalRecordsPreserved();
  });

  describe('OAUTH-001B8 disconnect storage-read boundary', () => {
    function hostileReadFailure() {
      const probes = [
        jest.fn(() => {
          throw new Error('read-cause-getter-canary');
        }),
        jest.fn(() => {
          throw new Error('read-details-getter-canary');
        }),
        jest.fn(() => {
          throw new Error('read-json-getter-canary');
        }),
      ];
      const failure = new Error(
        'read-failure-canary uid=synthetic-member path=members/private token=synthetic-token',
      );
      Object.defineProperties(failure, {
        cause: { configurable: true, enumerable: true, get: probes[0] },
        details: { configurable: true, enumerable: true, get: probes[1] },
        toJSON: { configurable: true, enumerable: true, get: probes[2] },
      });
      return { failure, probes };
    }

    function expectFixedReadFailure(rejection, probes) {
      const exposed = publicError(rejection);
      expect(exposed).toEqual({
        code: 'unavailable',
        message: FIXED_DISCONNECT_ERROR,
        details: undefined,
        cause: undefined,
      });
      expect(consoleSpies.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpies.warn).toHaveBeenCalledWith(FIXED_SECRET_READ_WARNING);
      expect(JSON.stringify({ exposed, logs: consoleSpies.warn.mock.calls }))
        .not.toMatch(
          /read-failure-canary|synthetic-member|members\/private|synthetic-token|getter-canary/i,
        );
      probes.forEach((probe) => expect(probe).not.toHaveBeenCalled());
      ['debug', 'error', 'info', 'log']
        .forEach((method) => expect(consoleSpies[method]).not.toHaveBeenCalled());
      expect(admin.__getReads()).toEqual([SECRET_PATH]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(admin.__getBatchCreateAttempts()).toBe(0);
      expect(admin.__getBatchDeleteAttempts()).toEqual([]);
      expect(admin.__getBatchDeletes()).toEqual([]);
      expect(admin.__getBatchSetAttempts()).toEqual([]);
      expect(admin.__getBatchCommitAttempts()).toEqual([]);
      expect(admin.__getDeletes()).toEqual([]);
      expect(admin.__getDirectSetAttempts()).toEqual([]);
      expect(admin.__getTransactionRunAttempts()).toBe(0);
      expect(admin.__getWrites()).toEqual([]);
      expect(admin.__hasDocument(SECRET_PATH)).toBe(true);
      expect(admin.__hasDocument(CONNECTION_PATH)).toBe(true);
      expect(dateNowSpy).not.toHaveBeenCalled();
      expect(Timestamp.now).not.toHaveBeenCalled();
    }

    test('maps a rejected secret read to one fixed result before downstream work', async () => {
      const { failure, probes } = hostileReadFailure();
      seedConnectedAccount();
      admin.__setReadFailure(SECRET_PATH, failure);

      const rejection = await captureFailure(() => stravaDisconnect({}, CONTEXT));

      expectFixedReadFailure(rejection, probes);
    });

    test('maps a throwing snapshot exists value to the fixed read boundary', async () => {
      const { failure, probes } = hostileReadFailure();
      const exists = jest.fn(() => {
        throw failure;
      });
      const snapshot = {};
      Object.defineProperty(snapshot, 'exists', {
        configurable: true,
        enumerable: true,
        get: exists,
      });
      seedConnectedAccount();
      admin.__setReadSnapshot(SECRET_PATH, snapshot);

      const rejection = await captureFailure(() => stravaDisconnect({}, CONTEXT));

      expectFixedReadFailure(rejection, probes);
      expect(exists).toHaveBeenCalledTimes(1);
    });

    test('maps a throwing snapshot data method to the fixed read boundary', async () => {
      const { failure, probes } = hostileReadFailure();
      const data = jest.fn(() => {
        throw failure;
      });
      seedConnectedAccount();
      admin.__setReadSnapshot(SECRET_PATH, { exists: true, data });

      const rejection = await captureFailure(() => stravaDisconnect({}, CONTEXT));

      expectFixedReadFailure(rejection, probes);
      expect(data).toHaveBeenCalledTimes(1);
    });
  });

  describe('OAUTH-001B7 atomic local disconnect cleanup', () => {
    const cleanupOperations = [
      { type: 'delete', path: SECRET_PATH },
      { type: 'delete', path: CONNECTION_PATH },
    ];

    function hostileCleanupFailure() {
      const probes = [
        jest.fn(() => {
          throw new Error('cleanup-cause-getter-canary');
        }),
        jest.fn(() => {
          throw new Error('cleanup-details-getter-canary');
        }),
        jest.fn(() => {
          throw new Error('cleanup-json-getter-canary');
        }),
      ];
      const failure = new Error(
        'cleanup-failure-canary token=synthetic-provider-secret-canary',
      );
      Object.defineProperties(failure, {
        cause: { configurable: true, enumerable: true, get: probes[0] },
        details: { configurable: true, enumerable: true, get: probes[1] },
        toJSON: { configurable: true, enumerable: true, get: probes[2] },
      });
      return { failure, probes };
    }

    function expectFixedCleanupFailure(rejection, probes) {
      const exposed = publicError(rejection);
      expect(exposed).toEqual({
        code: 'unavailable',
        message: FIXED_DISCONNECT_ERROR,
        details: undefined,
        cause: undefined,
      });
      expect(consoleSpies.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpies.warn).toHaveBeenCalledWith(FIXED_CLEANUP_WARNING);
      expect(JSON.stringify({ exposed, logs: consoleSpies.warn.mock.calls }))
        .not.toMatch(/cleanup-|token=|provider-secret|canary/i);
      probes.forEach((probe) => expect(probe).not.toHaveBeenCalled());
      ['debug', 'error', 'info', 'log']
        .forEach((method) => expect(consoleSpies[method]).not.toHaveBeenCalled());
    }

    test.each([
      [
        'batch construction',
        (failure) => admin.__setBatchCreationFailure(failure),
        [],
        [],
      ],
      [
        'secret delete staging',
        (failure) => admin.__setBatchDeleteFailure(SECRET_PATH, failure),
        [SECRET_PATH],
        [],
      ],
      [
        'connection delete staging',
        (failure) => admin.__setBatchDeleteFailure(CONNECTION_PATH, failure),
        [SECRET_PATH, CONNECTION_PATH],
        [],
      ],
      [
        'pre-apply commit',
        (failure) => admin.__setBatchCommitFailure(failure),
        [SECRET_PATH, CONNECTION_PATH],
        [cleanupOperations],
      ],
    ])('maps %s failure to one fixed result and preserves both records', async (
      _stage,
      configure,
      expectedDeleteAttempts,
      expectedCommitAttempts,
    ) => {
      const { failure, probes } = hostileCleanupFailure();
      seedConnectedAccount();
      fetchMock.mockResolvedValue({ ok: true });
      configure(failure);

      const rejection = await captureFailure(() => stravaDisconnect({}, CONTEXT));

      expectFixedCleanupFailure(rejection, probes);
      expectSupportedRevokeRequest('synthetic_disconnect_access_token_test');
      expect(admin.__getBatchCreateAttempts()).toBe(1);
      expect(admin.__getBatchDeleteAttempts()).toEqual(expectedDeleteAttempts);
      expect(admin.__getBatchDeletes()).toEqual([]);
      expect(admin.__getBatchSetAttempts()).toEqual([]);
      expect(admin.__getBatchCommitAttempts()).toEqual(expectedCommitAttempts);
      expect(admin.__getDeletes()).toEqual([]);
      expect(admin.__getWrites()).toEqual([]);
      expect(admin.__hasDocument(SECRET_PATH)).toBe(true);
      expect(admin.__hasDocument(CONNECTION_PATH)).toBe(true);
    });

    test('returns an unknown result after lost acknowledgement and converges on retry', async () => {
      const { failure, probes } = hostileCleanupFailure();
      seedConnectedAccount();
      fetchMock.mockResolvedValue({ ok: true });
      admin.__setBatchCommitPostApplyFailure(failure);

      const rejection = await captureFailure(() => stravaDisconnect({}, CONTEXT));

      expectFixedCleanupFailure(rejection, probes);
      expectSupportedRevokeRequest('synthetic_disconnect_access_token_test');
      expect(admin.__getBatchDeleteAttempts()).toEqual([SECRET_PATH, CONNECTION_PATH]);
      expect(admin.__getBatchDeletes()).toEqual([SECRET_PATH, CONNECTION_PATH]);
      expect(admin.__getBatchCommitAttempts()).toEqual([cleanupOperations]);
      expect(admin.__getDeletes()).toEqual([]);
      expect(admin.__hasDocument(SECRET_PATH)).toBe(false);
      expect(admin.__hasDocument(CONNECTION_PATH)).toBe(false);

      admin.__clearWrites();
      admin.__clearReads();
      fetchMock.mockReset();
      consoleSpies.warn.mockClear();

      const retryResult = await stravaDisconnect({}, CONTEXT);

      expect(retryResult).toEqual({ ok: true });
      expect(fetchMock).not.toHaveBeenCalled();
      expectLocalDeletes();
      expectNoLogs();
    });
  });
});
