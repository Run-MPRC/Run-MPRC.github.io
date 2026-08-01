'use strict';

const { Timestamp } = jest.requireActual('firebase-admin/firestore');

jest.mock('firebase-admin', () => {
  let database;
  return {
    firestore: jest.fn(() => database),
    __setDatabase: (next) => { database = next; },
  };
});

jest.mock('firebase-functions', () => {
  class HttpsError extends Error {
    constructor(code, message, details) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }
  const onCall = jest.fn((handler) => handler);
  const configuredOnCall = jest.fn((handler) => handler);
  const onWrite = jest.fn((handler) => handler);
  const document = jest.fn(() => ({ onWrite }));
  const runWith = jest.fn(() => ({
    https: { onCall: configuredOnCall },
    firestore: { document },
  }));
  return {
    https: { HttpsError, onCall },
    runWith,
    firestore: { document },
    __mocks: {
      onCall, configuredOnCall, runWith, onWrite, document,
    },
  };
});

jest.mock('./stripeHelpers', () => ({
  requireAdmin: jest.fn(),
  requireAppCheck: jest.fn(),
}));

jest.mock('./rateLimit', () => ({
  checkRateLimit: jest.fn(),
}));

const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { requireAdmin, requireAppCheck } = require('./stripeHelpers');
const { checkRateLimit } = require('./rateLimit');
const firestoreIndexes = require('../firestore.indexes.json');
const {
  MEMBER_DIRECTORY_ENTRY_COLLECTION,
  normalizeDirectoryQuery,
  buildDirectoryProjection,
  directoryEntryReference,
} = require('./memberDirectoryProjection');
const {
  SEARCH_RESULT_LIMIT,
  SEARCH_CANDIDATE_LIMIT,
  MEMBER_SEARCH_FIELD_MASK,
  SEARCH_AUDIT_FIELDS,
  MemberDirectorySearchError,
  readSearchRequest,
  searchRateLimitKey,
  searchAuditDocumentId,
  buildSearchAudit,
  executeDirectorySearch,
  reconcileMemberDirectoryEntry,
  searchMemberDirectory,
  syncMemberDirectoryEntryOnMemberWrite,
} = require('./memberDirectorySearch');

const ACTOR_UID = 'synthetic-officer';
const PERSON_UID = 'synthetic-person';
const REQUEST_1 = 'a1111111-b111-4111-8111-c11111111111';
const REQUEST_2 = 'a2222222-b222-4222-8222-c22222222222';
const NOW = Timestamp.fromMillis(1_800_000_000_000);
const LATER = Timestamp.fromMillis(1_800_000_100_000);
const HOSTILE_CANARY = 'hidden-query@example.test/private-provider-error';
const QUERY_CANARY = 'runn';
const setResponseHeader = jest.fn();
const ADMIN_CONTEXT = Object.freeze({
  app: Object.freeze({ appId: 'synthetic-app' }),
  auth: Object.freeze({
    uid: ACTOR_UID,
    token: Object.freeze({ email_verified: true, role: 'admin' }),
  }),
  rawRequest: Object.freeze({
    res: Object.freeze({ setHeader: setResponseHeader }),
  }),
});

function documentSnapshot(ref, value) {
  return {
    id: ref.id,
    ref,
    exists: value !== undefined,
    data: jest.fn(() => value),
  };
}

function createFirestoreHarness(seed = {}, options = {}) {
  const store = new Map(Object.entries(seed));
  const refs = new Map();
  const history = [];
  const getLog = [];
  const versions = new Map();
  const collectionVersions = new Map();
  let queryGetCount = 0;
  let transactionOrdinal = 0;

  function documentVersion(path) {
    return versions.get(path) || 0;
  }

  function collectionVersion(collectionName) {
    return collectionVersions.get(collectionName) || 0;
  }

  function applyOperations(operations) {
    for (const [operation, path, value] of operations) {
      if (operation === 'delete') store.delete(path);
      else store.set(path, value);
      versions.set(path, documentVersion(path) + 1);
      const collectionName = path.slice(0, path.indexOf('/'));
      collectionVersions.set(collectionName, collectionVersion(collectionName) + 1);
    }
  }

  function refFor(path) {
    if (!refs.has(path)) {
      refs.set(path, Object.freeze({
        kind: 'document',
        path,
        id: path.slice(path.lastIndexOf('/') + 1),
      }));
    }
    return refs.get(path);
  }

  function queryFor(collectionName, field, operator, value) {
    return {
      kind: 'query',
      collectionName,
      field,
      operator,
      value,
      limitValue: null,
      limit(limitValue) {
        this.limitValue = limitValue;
        return this;
      },
    };
  }

  const collection = jest.fn((collectionName) => ({
    doc: jest.fn((documentId) => refFor(`${collectionName}/${documentId}`)),
    where: jest.fn((field, operator, value) => (
      queryFor(collectionName, field, operator, value)
    )),
  }));

  const runTransaction = jest.fn(async (handler) => {
    transactionOrdinal += 1;
    const ordinal = transactionOrdinal;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const staged = [];
      const readDocumentVersions = new Map();
      const readCollectionVersions = new Map();
      const transaction = {
        get: jest.fn(async (reference) => {
          getLog.push(reference);
          if (reference.kind !== 'query') {
            if (!readDocumentVersions.has(reference.path)) {
              readDocumentVersions.set(reference.path, documentVersion(reference.path));
            }
            return documentSnapshot(reference, store.get(reference.path));
          }
          queryGetCount += 1;
          if (reference.operator !== 'array-contains') throw new Error('unexpected query');
          if (!readCollectionVersions.has(reference.collectionName)) {
            readCollectionVersions.set(
              reference.collectionName,
              collectionVersion(reference.collectionName),
            );
          }
          const prefix = `${reference.collectionName}/`;
          const candidates = [...store.entries()]
            .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
            .filter(([, value]) => Array.isArray(value.prefixDigests)
              && value.prefixDigests.includes(reference.value))
            .sort(([left], [right]) => left.localeCompare(right))
            .slice(0, reference.limitValue)
            .map(([path, value]) => {
              if (!readDocumentVersions.has(path)) {
                readDocumentVersions.set(path, documentVersion(path));
              }
              return documentSnapshot(refFor(path), value);
            });
          return Object.freeze({ docs: Object.freeze(candidates) });
        }),
        set: jest.fn((ref, value) => staged.push(['set', ref.path, value])),
        create: jest.fn((ref, value) => {
          if (store.has(ref.path) || staged.some((entry) => entry[1] === ref.path)) {
            throw new Error('document already exists');
          }
          staged.push(['create', ref.path, value]);
        }),
        delete: jest.fn((ref) => staged.push(['delete', ref.path])),
      };
      transaction.getAll = jest.fn(async (...referencesAndOptions) => {
        const readOptions = referencesAndOptions.find((value) => value?.fieldMask);
        const references = referencesAndOptions.filter((value) => value?.kind === 'document');
        const snapshots = await Promise.all(
          references.map((reference) => transaction.get(reference)),
        );
        if (!readOptions) return snapshots;
        return snapshots.map((source, index) => {
          if (!source.exists) return source;
          const sourceValue = source.data();
          const selected = Object.fromEntries(readOptions.fieldMask
            .filter((field) => Object.prototype.hasOwnProperty.call(sourceValue, field))
            .map((field) => [field, sourceValue[field]]));
          return documentSnapshot(references[index], selected);
        });
      });
      const result = await handler(transaction);
      if (typeof options.beforeCommit === 'function') {
        await options.beforeCommit({
          attempt,
          ordinal,
          applyExternalOperations: applyOperations,
        });
      }
      const conflicted = [...readDocumentVersions].some(([path, version]) => (
        documentVersion(path) !== version
      )) || [...readCollectionVersions].some(([collectionName, version]) => (
        collectionVersion(collectionName) !== version
      ));
      if (conflicted) {
        history.push({ attempt, committed: false, staged, transaction });
        continue;
      }
      if (options.failCommit) throw new Error(`${HOSTILE_CANARY}: commit failure`);
      applyOperations(staged);
      history.push({ attempt, committed: true, staged, transaction });
      return result;
    }
    throw new Error('transaction retry limit exceeded');
  });

  const db = Object.freeze({ collection, runTransaction });
  admin.__setDatabase(db);
  return {
    db,
    getLog,
    history,
    runTransaction,
    store,
    queryGetCount: () => queryGetCount,
  };
}

function memberDocument(displayName = 'Synthetic Runner', overrides = {}) {
  return {
    fullName: displayName,
    createdAt: NOW,
    updatedAt: LATER,
    email: HOSTILE_CANARY,
    role: 'unverified',
    ...overrides,
  };
}

function preferenceDocument(overrides = {}) {
  return {
    schemaVersion: 1,
    revision: 1,
    searchableByOfficers: true,
    hasPhoto: false,
    lastRequestId: REQUEST_1,
    lastAction: 'member_directory.visibility_set',
    lastExpectedRevision: 0,
    updatedAt: NOW,
    ...overrides,
  };
}

function photoDocument(overrides = {}) {
  return {
    schemaVersion: 1,
    bytes: Buffer.from('RIFF0000WEBPsynthetic-thumbnail'),
    contentType: 'image/webp',
    width: 256,
    height: 256,
    version: REQUEST_1,
    updatedAt: NOW,
    ...overrides,
  };
}

function stateFrom(preference, photo) {
  return Object.freeze({
    preference,
    photo,
    revision: preference ? preference.revision : 0,
    searchableByOfficers: preference ? preference.searchableByOfficers : false,
    hasPhoto: Boolean(photo),
  });
}

function seedVisible(harness, {
  uid = PERSON_UID,
  displayName = 'Synthetic Runner',
  withPhoto = false,
} = {}) {
  const member = memberDocument(displayName);
  const photo = withPhoto ? photoDocument() : null;
  const preference = preferenceDocument(withPhoto ? {
    hasPhoto: true,
    lastAction: 'member_directory.photo_set',
  } : {});
  const entry = buildDirectoryProjection({
    uid,
    member,
    state: stateFrom(preference, photo),
  });
  harness.store.set(`members/${uid}`, member);
  harness.store.set(`memberDirectoryPreferences/${uid}`, preference);
  if (photo) harness.store.set(`memberDirectoryPhotos/${uid}`, photo);
  harness.store.set(`${MEMBER_DIRECTORY_ENTRY_COLLECTION}/${uid}`, entry);
  return { entry, member, photo, preference };
}

function searchRequest(overrides = {}) {
  return {
    requestId: REQUEST_1,
    query: QUERY_CANARY,
    ...overrides,
  };
}

function expectSearchError(callback, kind) {
  let caught;
  try {
    callback();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(MemberDirectorySearchError);
  expect(caught.kind).toBe(kind);
  expect(caught.message).toBe('Member directory search input is invalid.');
  expect(JSON.stringify(caught)).toBe('{}');
  expect(String(caught)).not.toContain(HOSTILE_CANARY);
}

beforeEach(() => {
  requireAppCheck.mockReset();
  requireAdmin.mockReset().mockImplementation(async (context) => {
    if (context.auth?.token?.email_verified === true
      && context.auth?.token?.role === 'admin') return;
    throw new functions.https.HttpsError('permission-denied', 'Admin role required');
  });
  checkRateLimit.mockReset().mockResolvedValue(undefined);
  setResponseHeader.mockReset();
  createFirestoreHarness();
});

describe('bounded single-field search index', () => {
  test('needs no composite and retains only collection-scope CONTAINS on prefix digests', () => {
    expect(firestoreIndexes.indexes.some((index) => (
      index.collectionGroup === MEMBER_DIRECTORY_ENTRY_COLLECTION
    ))).toBe(false);
    const overrides = firestoreIndexes.fieldOverrides.filter((override) => (
      override.collectionGroup === MEMBER_DIRECTORY_ENTRY_COLLECTION
    ));
    expect(overrides.find((override) => override.fieldPath === 'prefixDigests')).toEqual({
      collectionGroup: MEMBER_DIRECTORY_ENTRY_COLLECTION,
      fieldPath: 'prefixDigests',
      indexes: [{ arrayConfig: 'CONTAINS', queryScope: 'COLLECTION' }],
    });
    for (const fieldPath of [
      'schemaVersion',
      'normalizationVersion',
      'entryRef',
      'displayName',
      'photoVersion',
      'preferenceRevision',
      'createdAt',
      'updatedAt',
    ]) {
      expect(overrides.find((override) => override.fieldPath === fieldPath)?.indexes).toEqual([]);
    }
  });

  test.each([
    ['memberDirectoryPreferences', [
      'schemaVersion', 'revision', 'searchableByOfficers', 'hasPhoto',
      'lastRequestId', 'lastAction', 'lastExpectedRevision', 'updatedAt',
    ]],
    ['memberDirectoryPhotos', [
      'schemaVersion', 'bytes', 'contentType', 'width', 'height', 'version', 'updatedAt',
    ]],
  ])('disables default indexes for direct-get-only %s fields', (collectionGroup, fields) => {
    const overrides = firestoreIndexes.fieldOverrides.filter((override) => (
      override.collectionGroup === collectionGroup
    ));
    expect(overrides.map((override) => override.fieldPath).sort()).toEqual([...fields].sort());
    for (const override of overrides) expect(override.indexes).toEqual([]);
  });
});

describe('strict search request and pseudonymous command metadata', () => {
  test('parses only the exact UUID/query shape and retains no raw query', () => {
    const result = readSearchRequest(searchRequest({ query: 'ＳＹＮＴＨ' }));
    expect(result).toEqual({
      requestId: REQUEST_1,
      queryDigest: normalizeDirectoryQuery('synth').digest,
      queryLengthBucket: '5-8',
    });
    expect(JSON.stringify(result)).not.toContain('synth');
  });

  test.each([
    null,
    undefined,
    [],
    {},
    { requestId: REQUEST_1 },
    { requestId: REQUEST_1, query: QUERY_CANARY, uid: PERSON_UID },
    { requestId: REQUEST_1, query: QUERY_CANARY, role: 'admin' },
    { requestId: REQUEST_1.toUpperCase(), query: QUERY_CANARY },
    { requestId: REQUEST_1, query: '' },
    { requestId: REQUEST_1, query: '-' },
    { requestId: REQUEST_1, query: `sy\u200dnt` },
  ])('rejects malformed, authority-bearing, or non-search input: %p', (value) => {
    expectSearchError(() => readSearchRequest(value), 'request');
  });

  test('rejects accessors and Proxies without invoking hostile code', () => {
    const getter = jest.fn(() => {
      throw new Error(HOSTILE_CANARY);
    });
    const value = { requestId: REQUEST_1 };
    Object.defineProperty(value, 'query', { enumerable: true, get: getter });
    expectSearchError(() => readSearchRequest(value), 'request');
    expect(getter).not.toHaveBeenCalled();

    const trap = jest.fn(() => {
      throw new Error(HOSTILE_CANARY);
    });
    expectSearchError(
      () => readSearchRequest(new Proxy(searchRequest(), { ownKeys: trap })),
      'request',
    );
    expect(trap).not.toHaveBeenCalled();
  });

  test('rate and audit identifiers are domain-separated and hide the actor UID', () => {
    const rateKey = searchRateLimitKey(ACTOR_UID);
    const auditId = searchAuditDocumentId(ACTOR_UID, REQUEST_1);
    expect(rateKey).toMatch(/^[0-9a-f]{64}$/);
    expect(auditId).toMatch(/^member_directory_search_[0-9a-f]{64}$/);
    expect(rateKey).not.toContain(ACTOR_UID);
    expect(auditId).not.toContain(ACTOR_UID);
    expect(rateKey).not.toBe(auditId.slice('member_directory_search_'.length));
  });

  test('builds an exact minimal query-free search audit', () => {
    const request = readSearchRequest(searchRequest());
    const audit = buildSearchAudit(ACTOR_UID, request, 2, NOW);
    expect(Object.keys(audit)).toEqual(SEARCH_AUDIT_FIELDS);
    expect(audit).toEqual({
      actorUid: ACTOR_UID,
      action: 'member_directory.search',
      purpose: 'officer_people_finder',
      requestId: REQUEST_1,
      queryLengthBucket: '2-4',
      resultCount: 2,
      outcome: 'succeeded',
      createdAt: NOW,
    });
    expect(JSON.stringify(audit)).not.toContain(QUERY_CANARY);
  });
});

describe('transactional current-truth search', () => {
  test('returns only current opted-in display name and optional processed thumbnail', async () => {
    const harness = createFirestoreHarness();
    const seeded = seedVisible(harness, { withPhoto: true });
    const request = readSearchRequest(searchRequest());
    const result = await executeDirectorySearch(harness.db, ACTOR_UID, request, NOW);
    expect(result).toEqual({
      schemaVersion: 1,
      results: [{
        entryRef: directoryEntryReference(PERSON_UID),
        displayName: 'Synthetic Runner',
        photo: {
          contentType: 'image/webp',
          base64Data: seeded.photo.bytes.toString('base64'),
          width: 256,
          height: 256,
          version: REQUEST_1,
        },
      }],
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of [PERSON_UID, HOSTILE_CANARY, 'email', 'role', 'membership', 'payment']) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(harness.getLog.some((reference) => (
      reference.path === `${MEMBER_DIRECTORY_ENTRY_COLLECTION}/${PERSON_UID}`
    ))).toBe(false);
    expect(harness.getLog.some((reference) => (
      reference.path === `memberDirectoryPreferences/${PERSON_UID}`
    ))).toBe(true);
    expect(harness.getLog.some((reference) => reference.path === `members/${PERSON_UID}`))
      .toBe(true);
    expect(harness.getLog.some((reference) => (
      reference.path === `memberDirectoryPhotos/${PERSON_UID}`
    ))).toBe(true);
    const transaction = harness.history.at(-1).transaction;
    expect(transaction.getAll).toHaveBeenCalledTimes(3);
    expect(transaction.getAll.mock.calls[1].at(-1)).toEqual({
      fieldMask: MEMBER_SEARCH_FIELD_MASK,
    });
    expect(transaction.get).not.toHaveBeenCalledWith(expect.objectContaining({
      path: `${MEMBER_DIRECTORY_ENTRY_COLLECTION}/${PERSON_UID}`,
    }));
  });

  test('creates one minimal audit in the same transaction without query or result identity', async () => {
    const harness = createFirestoreHarness();
    seedVisible(harness);
    const request = readSearchRequest(searchRequest());
    await executeDirectorySearch(harness.db, ACTOR_UID, request, NOW);
    const path = `auditEvents/${searchAuditDocumentId(ACTOR_UID, REQUEST_1)}`;
    const audit = harness.store.get(path);
    expect(Object.keys(audit)).toEqual(SEARCH_AUDIT_FIELDS);
    expect(audit.resultCount).toBe(1);
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(QUERY_CANARY);
    expect(serialized).not.toContain(PERSON_UID);
    expect(serialized).not.toContain(directoryEntryReference(PERSON_UID));
  });

  test('a browser-supplied far-future member timestamp cannot make current content stale', async () => {
    const harness = createFirestoreHarness();
    seedVisible(harness);
    const farFuture = Timestamp.fromMillis(253_402_300_799_000);
    harness.store.set(`members/${PERSON_UID}`, memberDocument('Synthetic Runner', {
      createdAt: farFuture,
      updatedAt: farFuture,
    }));
    const result = await executeDirectorySearch(
      harness.db,
      ACTOR_UID,
      readSearchRequest(searchRequest()),
      NOW,
    );
    expect(result.results).toEqual([{
      entryRef: directoryEntryReference(PERSON_UID),
      displayName: 'Synthetic Runner',
      photo: null,
    }]);
    expect(harness.history.at(-1).transaction.getAll.mock.calls[1].at(-1)).toEqual({
      fieldMask: ['fullName'],
    });
  });

  test('duplicate request ID is denied before any candidate query and does not multiply audit', async () => {
    const harness = createFirestoreHarness();
    seedVisible(harness);
    const request = readSearchRequest(searchRequest());
    await executeDirectorySearch(harness.db, ACTOR_UID, request, NOW);
    const queriesAfterFirst = harness.queryGetCount();
    await expect(executeDirectorySearch(harness.db, ACTOR_UID, request, LATER))
      .rejects.toMatchObject({
        code: 'aborted',
        message: 'Directory search could not be completed.',
      });
    expect(harness.queryGetCount()).toBe(queriesAfterFirst);
    expect([...harness.store.keys()].filter((path) => (
      path.startsWith('auditEvents/member_directory_search_')
    ))).toHaveLength(1);
  });

  test('concurrent same-UUID searches retry to one success, one fixed duplicate, and one audit', async () => {
    let competingResult;
    const harness = createFirestoreHarness({}, {
      beforeCommit: async ({ attempt, ordinal }) => {
        if (ordinal === 1 && attempt === 1) {
          competingResult = await executeDirectorySearch(
            harness.db,
            ACTOR_UID,
            readSearchRequest(searchRequest()),
            LATER,
          );
        }
      },
    });
    seedVisible(harness);

    await expect(executeDirectorySearch(
      harness.db,
      ACTOR_UID,
      readSearchRequest(searchRequest()),
      NOW,
    )).rejects.toMatchObject({
      code: 'aborted',
      message: 'Directory search could not be completed.',
    });
    expect(competingResult.results).toHaveLength(1);
    expect(harness.queryGetCount()).toBe(2);
    expect(harness.history.some((attempt) => attempt.committed === false)).toBe(true);
    expect([...harness.store.keys()].filter((path) => (
      path.startsWith('auditEvents/member_directory_search_')
    ))).toHaveLength(1);
  });

  test('opt-out committed during search forces retry that re-reads hidden truth and returns none', async () => {
    const harness = createFirestoreHarness({}, {
      beforeCommit: ({ attempt, ordinal, applyExternalOperations }) => {
        if (ordinal !== 1 || attempt !== 1) return;
        const currentPreference = harness.store.get(
          `memberDirectoryPreferences/${PERSON_UID}`,
        );
        applyExternalOperations([
          ['set', `memberDirectoryPreferences/${PERSON_UID}`, {
            ...currentPreference,
            revision: 2,
            searchableByOfficers: false,
            lastRequestId: REQUEST_2,
            lastExpectedRevision: 1,
            updatedAt: LATER,
          }],
          ['delete', `${MEMBER_DIRECTORY_ENTRY_COLLECTION}/${PERSON_UID}`],
        ]);
      },
    });
    seedVisible(harness);

    const result = await executeDirectorySearch(
      harness.db,
      ACTOR_UID,
      readSearchRequest(searchRequest()),
      NOW,
    );
    expect(result).toEqual({ schemaVersion: 1, results: [] });
    expect(harness.queryGetCount()).toBe(2);
    expect(harness.history[0]).toMatchObject({ attempt: 1, committed: false });
    expect(harness.history.at(-1)).toMatchObject({ attempt: 2, committed: true });
    expect(harness.store.get(
      `auditEvents/${searchAuditDocumentId(ACTOR_UID, REQUEST_1)}`,
    )).toMatchObject({ resultCount: 0 });
  });

  test.each([
    ['opted out', (harness, seeded) => {
      harness.store.set(`memberDirectoryPreferences/${PERSON_UID}`, {
        ...seeded.preference,
        searchableByOfficers: false,
      });
    }],
    ['name changed', (harness, seeded) => {
      harness.store.set(`members/${PERSON_UID}`, {
        ...seeded.member,
        fullName: 'Current Veloren',
      });
    }],
    ['name invalid', (harness, seeded) => {
      harness.store.set(`members/${PERSON_UID}`, { ...seeded.member, fullName: '---' });
    }],
    ['photo removed behind stale projection', (harness, seeded) => {
      harness.store.set(`memberDirectoryPreferences/${PERSON_UID}`, {
        ...seeded.preference,
        revision: 2,
        hasPhoto: false,
        lastRequestId: REQUEST_2,
        lastAction: 'member_directory.photo_removed',
        lastExpectedRevision: 1,
        updatedAt: LATER,
      });
      harness.store.delete(`memberDirectoryPhotos/${PERSON_UID}`);
    }],
    ['malformed current preference', (harness, seeded) => {
      harness.store.set(`memberDirectoryPreferences/${PERSON_UID}`, {
        ...seeded.preference,
        role: 'admin',
      });
    }],
  ])('withholds a stale candidate when current truth is %s', async (_label, mutate) => {
    const harness = createFirestoreHarness();
    const seeded = seedVisible(harness, { withPhoto: true });
    mutate(harness, seeded);
    await expect(executeDirectorySearch(
      harness.db,
      ACTOR_UID,
      readSearchRequest(searchRequest()),
      NOW,
    )).resolves.toEqual({ schemaVersion: 1, results: [] });
  });

  test('uses a candidate budget above 24 so stale early rows do not force false-empty output', async () => {
    const harness = createFirestoreHarness();
    for (let index = 0; index < SEARCH_RESULT_LIMIT; index += 1) {
      const uid = `a-stale-${String(index).padStart(2, '0')}`;
      seedVisible(harness, { uid, displayName: `Runner Stale ${index}` });
      harness.store.set(`memberDirectoryPreferences/${uid}`, {
        ...harness.store.get(`memberDirectoryPreferences/${uid}`),
        searchableByOfficers: false,
      });
    }
    seedVisible(harness, { uid: 'z-current', displayName: 'Runner Current' });
    const result = await executeDirectorySearch(
      harness.db,
      ACTOR_UID,
      readSearchRequest(searchRequest()),
      NOW,
    );
    expect(SEARCH_CANDIDATE_LIMIT).toBeGreaterThan(SEARCH_RESULT_LIMIT);
    expect(result.results).toEqual([{
      entryRef: directoryEntryReference('z-current'),
      displayName: 'Runner Current',
      photo: null,
    }]);
  });

  test('caps a broad valid prefix at exactly 24 with no cursor or total', async () => {
    const harness = createFirestoreHarness();
    for (let index = 0; index < 30; index += 1) {
      seedVisible(harness, {
        uid: `person-${String(index).padStart(2, '0')}`,
        displayName: `Runner Person ${String(index).padStart(2, '0')}`,
      });
    }
    const result = await executeDirectorySearch(
      harness.db,
      ACTOR_UID,
      readSearchRequest(searchRequest()),
      NOW,
    );
    expect(result.results).toHaveLength(24);
    expect(Object.keys(result)).toEqual(['schemaVersion', 'results']);
  });

  test('an unknown commit outcome exposes no provider detail and commits no audit', async () => {
    const harness = createFirestoreHarness({}, { failCommit: true });
    seedVisible(harness);
    await expect(executeDirectorySearch(
      harness.db,
      ACTOR_UID,
      readSearchRequest(searchRequest()),
      NOW,
    )).rejects.toMatchObject({
      code: 'internal',
      message: 'Directory search is unavailable.',
    });
    expect([...harness.store.keys()].some((path) => path.startsWith('auditEvents/'))).toBe(false);
  });
});

describe('current-document projection reconciliation trigger', () => {
  test('visible member write creates and then updates the projection from current documents', async () => {
    const harness = createFirestoreHarness();
    const member = memberDocument('Mira Veloren');
    const preference = preferenceDocument();
    harness.store.set(`members/${PERSON_UID}`, member);
    harness.store.set(`memberDirectoryPreferences/${PERSON_UID}`, preference);

    await expect(reconcileMemberDirectoryEntry(PERSON_UID)).resolves.toEqual({
      disposition: 'synchronized',
    });
    const first = harness.store.get(`${MEMBER_DIRECTORY_ENTRY_COLLECTION}/${PERSON_UID}`);
    expect(first.displayName).toBe('Mira Veloren');

    harness.store.set(`members/${PERSON_UID}`, {
      ...member,
      fullName: 'Mira Currentname',
      updatedAt: Timestamp.fromMillis(LATER.toMillis() + 1_000),
    });
    await expect(reconcileMemberDirectoryEntry(PERSON_UID)).resolves.toEqual({
      disposition: 'synchronized',
    });
    const updated = harness.store.get(`${MEMBER_DIRECTORY_ENTRY_COLLECTION}/${PERSON_UID}`);
    expect(updated.displayName).toBe('Mira Currentname');
    expect(updated.createdAt).toEqual(first.createdAt);
  });

  test('repeated trigger delivery is idempotent and performs no write', async () => {
    const harness = createFirestoreHarness();
    seedVisible(harness);
    await expect(reconcileMemberDirectoryEntry(PERSON_UID)).resolves.toEqual({
      disposition: 'unchanged',
    });
    expect(harness.history.at(-1).staged).toEqual([]);
  });

  test.each([
    ['opt-out', (harness) => {
      harness.store.set(`memberDirectoryPreferences/${PERSON_UID}`, {
        ...harness.store.get(`memberDirectoryPreferences/${PERSON_UID}`),
        searchableByOfficers: false,
      });
    }],
    ['invalid name', (harness) => {
      harness.store.set(`members/${PERSON_UID}`, {
        ...harness.store.get(`members/${PERSON_UID}`),
        fullName: '---',
      });
    }],
    ['one-unit canonical name', (harness) => {
      harness.store.set(`members/${PERSON_UID}`, {
        ...harness.store.get(`members/${PERSON_UID}`),
        fullName: '-A-',
      });
    }],
    ['deleted member', (harness) => harness.store.delete(`members/${PERSON_UID}`)],
    ['malformed preference', (harness) => {
      harness.store.set(`memberDirectoryPreferences/${PERSON_UID}`, { broken: true });
    }],
  ])('deletes an existing projection for current %s truth', async (_label, mutate) => {
    const harness = createFirestoreHarness();
    seedVisible(harness);
    mutate(harness);
    await expect(reconcileMemberDirectoryEntry(PERSON_UID)).resolves.toEqual({
      disposition: 'hidden',
    });
    expect(harness.store.has(`${MEMBER_DIRECTORY_ENTRY_COLLECTION}/${PERSON_UID}`)).toBe(false);
  });

  test('exported onWrite trigger ignores event payload and re-reads current documents', async () => {
    const harness = createFirestoreHarness();
    seedVisible(harness, { displayName: 'Current Sourceperson' });
    await syncMemberDirectoryEntryOnMemberWrite({
      after: { data: () => ({ fullName: HOSTILE_CANARY, role: 'admin' }) },
    }, { params: { uid: PERSON_UID } });
    expect(harness.store.get(`${MEMBER_DIRECTORY_ENTRY_COLLECTION}/${PERSON_UID}`).displayName)
      .toBe('Current Sourceperson');
  });
});

describe('callable authorization, no-store, rate, and runtime boundaries', () => {
  test('natively enforces App Check and exports the exact member write trigger path', () => {
    expect(functions.__mocks.runWith).toHaveBeenCalledWith({ enforceAppCheck: true });
    expect(functions.__mocks.runWith).toHaveBeenCalledWith({ failurePolicy: true });
    expect(functions.__mocks.document).toHaveBeenCalledWith('members/{uid}');
    expect(functions.__mocks.onWrite).toHaveBeenCalledTimes(1);
  });

  test('App Check precedes response, Auth, Admin, parse, rate, and Firestore', async () => {
    const harness = createFirestoreHarness();
    const rejected = new functions.https.HttpsError('failed-precondition', 'App Check required');
    requireAppCheck.mockImplementation(() => { throw rejected; });
    await expect(searchMemberDirectory({ query: HOSTILE_CANARY }, { auth: null }))
      .rejects.toBe(rejected);
    expect(setResponseHeader).not.toHaveBeenCalled();
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(harness.runTransaction).not.toHaveBeenCalled();
  });

  test('authenticated verified-admin authorization precedes request parsing', async () => {
    const harness = createFirestoreHarness();
    const memberContext = {
      ...ADMIN_CONTEXT,
      auth: { uid: 'ordinary-member', token: { email_verified: true, role: 'member' } },
    };
    await expect(searchMemberDirectory({ query: HOSTILE_CANARY }, memberContext))
      .rejects.toMatchObject({ code: 'permission-denied', message: 'Admin role required' });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(harness.runTransaction).not.toHaveBeenCalled();
  });

  test('anonymous caller fails before Admin, parse, rate, or Firestore', async () => {
    const harness = createFirestoreHarness();
    await expect(searchMemberDirectory(searchRequest(), { ...ADMIN_CONTEXT, auth: null }))
      .rejects.toMatchObject({ code: 'unauthenticated', message: 'Sign-in required.' });
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(harness.runTransaction).not.toHaveBeenCalled();
  });

  test.each([
    ['C1 control', `officer\u0085uid`],
    ['format control', `officer\u200duid`],
    ['orphan high surrogate', `officer\ud800uid`],
    ['orphan low surrogate', `officer\udc00uid`],
  ])('malformed %s actor UID fails before Admin, parse, rate, or Firestore', async (
    _label,
    uid,
  ) => {
    const harness = createFirestoreHarness();
    const context = { ...ADMIN_CONTEXT, auth: { ...ADMIN_CONTEXT.auth, uid } };
    await expect(searchMemberDirectory({ query: HOSTILE_CANARY }, context))
      .rejects.toMatchObject({ code: 'unauthenticated', message: 'Sign-in required.' });
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(harness.runTransaction).not.toHaveBeenCalled();
  });

  test.each([
    ['missing', { ...ADMIN_CONTEXT, rawRequest: {} }],
    ['throwing', {
      ...ADMIN_CONTEXT,
      rawRequest: {
        res: {
          setHeader: () => { throw new Error(HOSTILE_CANARY); },
        },
      },
    }],
  ])('%s no-store response boundary fails before Auth/Admin, parse, rate, or Firestore', async (
    _label,
    context,
  ) => {
    const harness = createFirestoreHarness();
    await expect(searchMemberDirectory({ query: HOSTILE_CANARY }, context))
      .rejects.toMatchObject({
        code: 'internal',
        message: 'Private profile response is unavailable.',
      });
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(harness.runTransaction).not.toHaveBeenCalled();
  });

  test.each([
    ['unverified', { email_verified: false, role: 'admin' }],
    ['missing role', { email_verified: true }],
    ['malformed role', { email_verified: true, role: ['admin'] }],
  ])('%s admin claims fail before parse, rate, or Firestore', async (_label, token) => {
    const harness = createFirestoreHarness();
    const context = { ...ADMIN_CONTEXT, auth: { uid: ACTOR_UID, token } };
    await expect(searchMemberDirectory({ query: HOSTILE_CANARY }, context))
      .rejects.toMatchObject({ code: 'permission-denied', message: 'Admin role required' });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(harness.runTransaction).not.toHaveBeenCalled();
  });

  test('sets private no-store headers and uses only a pseudonymous per-officer rate key', async () => {
    const harness = createFirestoreHarness();
    seedVisible(harness);
    await searchMemberDirectory(searchRequest(), ADMIN_CONTEXT);
    expect(setResponseHeader.mock.calls).toEqual([
      ['Cache-Control', 'private, no-store, max-age=0'],
      ['Pragma', 'no-cache'],
      ['Expires', '0'],
    ]);
    expect(checkRateLimit).toHaveBeenCalledWith({
      scope: 'member_directory_search',
      key: searchRateLimitKey(ACTOR_UID),
      limit: 30,
      windowMs: 60 * 60 * 1000,
    });
    expect(JSON.stringify(checkRateLimit.mock.calls)).not.toContain(ACTOR_UID);
  });

  test('preserves a fixed generic rate-limit failure without querying candidates', async () => {
    const harness = createFirestoreHarness();
    const limited = new functions.https.HttpsError(
      'resource-exhausted',
      'Too many requests. Please wait a few minutes and try again.',
    );
    checkRateLimit.mockRejectedValue(limited);
    await expect(searchMemberDirectory(searchRequest(), ADMIN_CONTEXT)).rejects.toBe(limited);
    expect(harness.runTransaction).not.toHaveBeenCalled();
  });

  test('logs no query, name, photo, result, or provider-error canary', async () => {
    const spies = ['debug', 'error', 'info', 'log', 'warn'].map((method) => (
      jest.spyOn(console, method).mockImplementation(() => undefined)
    ));
    try {
      const harness = createFirestoreHarness({}, { failCommit: true });
      seedVisible(harness);
      await expect(searchMemberDirectory(searchRequest(), ADMIN_CONTEXT)).rejects
        .toMatchObject({ code: 'internal' });
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
});
