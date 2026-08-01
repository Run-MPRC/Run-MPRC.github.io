'use strict';

const { Timestamp } = require('firebase-admin/firestore');
const {
  memberDirectoryProjectionSchemaVersion,
  memberDirectoryNormalizationVersion,
  MEMBER_DIRECTORY_ENTRY_COLLECTION,
  MAX_PREFIX_DIGESTS,
  PROJECTION_FIELDS,
  MemberDirectoryProjectionError,
  timestampsEqual,
  readDirectoryDisplayName,
  normalizeDirectoryQuery,
  prefixDigest,
  derivePrefixDigests,
  directoryEntryReference,
  readStoredDirectoryProjection,
  buildDirectoryProjection,
  directoryProjectionsEqual,
  directoryProjectionContentEqual,
} = require('./memberDirectoryProjection');

const UID = 'synthetic-directory-person';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const NOW = Timestamp.fromMillis(1_800_000_000_000);
const LATER = Timestamp.fromMillis(1_800_000_100_000);
const HOSTILE_CANARY = 'private-person@example.test/query=do-not-store';

function preference(overrides = {}) {
  return Object.freeze({
    schemaVersion: 1,
    revision: 3,
    searchableByOfficers: true,
    hasPhoto: false,
    lastRequestId: REQUEST_ID,
    lastAction: 'member_directory.visibility_set',
    lastExpectedRevision: 2,
    updatedAt: NOW,
    ...overrides,
  });
}

function state(overrides = {}) {
  const pref = overrides.preference === undefined ? preference() : overrides.preference;
  const photo = overrides.photo === undefined ? null : overrides.photo;
  return Object.freeze({
    preference: pref,
    photo,
    revision: pref ? pref.revision : 0,
    searchableByOfficers: pref ? pref.searchableByOfficers : false,
    hasPhoto: Boolean(photo),
  });
}

function member(overrides = {}) {
  return {
    fullName: 'Adera Loventon',
    createdAt: NOW,
    updatedAt: LATER,
    email: HOSTILE_CANARY,
    role: 'unverified',
    ...overrides,
  };
}

function photo() {
  return Object.freeze({
    schemaVersion: 1,
    bytes: Buffer.from('RIFF0000WEBPsynthetic'),
    contentType: 'image/webp',
    width: 256,
    height: 256,
    version: REQUEST_ID,
    updatedAt: NOW,
  });
}

function projection(overrides = {}) {
  return buildDirectoryProjection({
    uid: UID,
    member: member(),
    state: state(),
    ...overrides,
  });
}

function expectProjectionError(callback, kind) {
  let caught;
  try {
    callback();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(MemberDirectoryProjectionError);
  if (kind) expect(caught.kind).toBe(kind);
  expect(caught.message).toBe('Member directory projection input is invalid.');
  expect(JSON.stringify(caught)).toBe('{}');
  expect(String(caught)).not.toContain(HOSTILE_CANARY);
}

describe('versioned Unicode name normalization', () => {
  test('pins the projection namespace and normalization versions', () => {
    expect(memberDirectoryProjectionSchemaVersion).toBe(1);
    expect(memberDirectoryNormalizationVersion).toBe(1);
    expect(MEMBER_DIRECTORY_ENTRY_COLLECTION).toBe('memberDirectoryEntries');
  });

  test.each([
    ['  Adera   LOVENTON  ', 'adera loventon'],
    ['Ａｄｅｒａ　Ｌｏｖｅｎｔｏｎ', 'adera loventon'],
    ['Élara—Veyron', 'élara veyron'],
    ["O'VAREL", 'o varel'],
    ['İvara', 'i̇vara'],
  ])('normalizes NFKC, lowercase, whitespace, and token boundaries: %s', (raw, expected) => {
    expect(normalizeDirectoryQuery(raw).normalized).toBe(expected);
  });

  test('uses locale-independent lowercase rather than locale-specific Turkish casing', () => {
    const result = normalizeDirectoryQuery('Ivara');
    expect(result.normalized).toBe('ivara');
    expect(result.normalized).not.toBe('ıvara');
  });

  test.each([
    ['blank', '   '],
    ['punctuation only', '---'],
    ['one normalized code unit', 'A'],
    ['compatibility form that normalizes to one code unit', '𝔸'],
    ['over 80 normalized code units', 'a'.repeat(81)],
    ['C0 control', `Ad\u0000a`],
    ['DEL', `Ad\u007fa`],
    ['non-ASCII C1 control', `Ad\u0085a`],
    ['Unicode format control', 'Ad\u200da'],
    ['orphan high surrogate', `Ad\ud800a`],
    ['orphan low surrogate', `Ad\udc00a`],
    ['over raw parsing cap', `${'-'.repeat(512)}Adera`],
  ])('rejects %s without echoing input', (_label, query) => {
    expectProjectionError(() => normalizeDirectoryQuery(query), 'query');
  });

  test('accepts exact 2 and 80 normalized code-unit boundaries', () => {
    expect(normalizeDirectoryQuery('Ad').normalized).toBe('ad');
    expect(normalizeDirectoryQuery('a'.repeat(80)).normalized).toHaveLength(80);
  });

  test('uses fixed query-length buckets without retaining query text', () => {
    const cases = [
      ['ad', '2-4'],
      ['alice', '5-8'],
      ['a'.repeat(9), '9-16'],
      ['a'.repeat(17), '17-32'],
      ['a'.repeat(33), '33-80'],
    ];
    for (const [query, bucket] of cases) {
      const result = normalizeDirectoryQuery(query);
      expect(result.lengthBucket).toBe(bucket);
      expect(Object.keys(result)).toEqual(['normalized', 'digest', 'lengthBucket']);
    }
  });
});

describe('digest-only prefix derivation', () => {
  test('supports full-name and individual-token prefixes but not arbitrary substrings', () => {
    const digests = derivePrefixDigests('Adera Loventon');
    for (const matching of ['ad', 'adera', 'adera l', 'adera love', 'lo', 'loven']) {
      expect(digests).toContain(normalizeDirectoryQuery(matching).digest);
    }
    expect(digests).not.toContain(normalizeDirectoryQuery('oven').digest);
  });

  test('stores only fixed lowercase digests, never raw normalized prefixes', () => {
    const digests = derivePrefixDigests('Synthetic Runner');
    expect(digests.length).toBeGreaterThan(0);
    expect(digests.length).toBeLessThanOrEqual(MAX_PREFIX_DIGESTS);
    expect(digests).toEqual([...new Set(digests)].sort());
    for (const digest of digests) expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(digests)).not.toContain('synthetic');
    expect(prefixDigest('synthetic')).not.toBe(prefixDigest('runner'));
  });

  test('domain-separates stable opaque entry references from prefix digests', () => {
    const entryRef = directoryEntryReference(UID);
    expect(entryRef).toMatch(/^entry_[0-9a-f]{64}$/);
    expect(entryRef).toBe(directoryEntryReference(UID));
    expect(entryRef).not.toContain(UID);
    expect(entryRef.slice(6)).not.toBe(prefixDigest(UID));
  });
});

describe('minimal current projection contract', () => {
  test('builds an exact minimal projection without source authority fields', () => {
    const value = projection();
    expect(Object.keys(value)).toEqual(PROJECTION_FIELDS);
    expect(value).toEqual({
      schemaVersion: 1,
      normalizationVersion: 1,
      entryRef: directoryEntryReference(UID),
      displayName: 'Adera Loventon',
      prefixDigests: derivePrefixDigests('Adera Loventon'),
      photoVersion: null,
      preferenceRevision: 3,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const serialized = JSON.stringify(value);
    for (const forbidden of [UID, HOSTILE_CANARY, 'email', 'role', 'membership', 'payment']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test('includes only the current processed-photo version, never bytes', () => {
    const currentPhoto = photo();
    const value = projection({
      state: state({
        preference: preference({ hasPhoto: true }),
        photo: currentPhoto,
      }),
    });
    expect(value.photoVersion).toBe(REQUEST_ID);
    expect(JSON.stringify(value)).not.toContain(currentPhoto.bytes.toString('base64'));
  });

  test('missing opt-in or invalid current name produces no projection', () => {
    expect(projection({
      state: state({ preference: preference({ searchableByOfficers: false }) }),
    })).toBeNull();
    for (const fullName of [
      null,
      '',
      '---',
      'A',
      '中',
      'ß',
      '-A-',
      `Adera\u200dLoventon`,
      'x'.repeat(201),
    ]) {
      expect(projection({ member: member({ fullName }) })).toBeNull();
    }
  });

  test('uses normalized UTF-16 units for the two-unit display-name boundary', () => {
    const supplementaryLetter = '\ud801\udc00';
    expect(supplementaryLetter).toHaveLength(2);
    expect(readDirectoryDisplayName(member({ fullName: supplementaryLetter })))
      .toBe(supplementaryLetter);
    expect(projection({ member: member({ fullName: supplementaryLetter }) })).not.toBeNull();
  });

  test('accepts the maximum 272-digest canonical boundary without a retry-poisoning error', () => {
    const displayName = `a ${'b'.repeat(65)} ${'c'.repeat(65)} ${'d'.repeat(66)}`;
    expect(displayName).toHaveLength(200);
    const digests = derivePrefixDigests(displayName);
    expect(digests).toHaveLength(MAX_PREFIX_DIGESTS);
    expect(projection({ member: member({ fullName: displayName }) })).not.toBeNull();
  });

  test('withholds a raw-valid name whose NFKC canonical form expands beyond 200 code units', () => {
    const expandingName = '\ufdfa'.repeat(12);
    expect(expandingName.length).toBeLessThanOrEqual(200);
    expect(expandingName.normalize('NFKC').length).toBeGreaterThan(200);
    expect(readDirectoryDisplayName(member({ fullName: expandingName }))).toBeNull();
    expect(projection({ member: member({ fullName: expandingName }) })).toBeNull();
  });

  test('preserves an existing valid creation time while advancing current source time', () => {
    const existing = projection({ updatedAt: NOW });
    const next = projection({ existingProjection: existing, updatedAt: LATER });
    expect(next.createdAt).toBe(NOW);
    expect(next.updatedAt).toBe(LATER);
  });

  test('strictly reads and compares equal-value distinct Timestamp instances', () => {
    const value = projection();
    const clone = {
      ...value,
      prefixDigests: [...value.prefixDigests],
      createdAt: new Timestamp(value.createdAt.seconds, value.createdAt.nanoseconds),
      updatedAt: new Timestamp(value.updatedAt.seconds, value.updatedAt.nanoseconds),
    };
    expect(clone.createdAt).not.toBe(value.createdAt);
    expect(timestampsEqual(clone.createdAt, value.createdAt)).toBe(true);
    expect(readStoredDirectoryProjection(clone)).toEqual(value);
    expect(directoryProjectionsEqual(clone, value)).toBe(true);
    expect(directoryProjectionContentEqual(clone, value)).toBe(true);
  });

  test('content equality ignores projection metadata timestamps but exact equality retains them', () => {
    const value = projection();
    const metadataOnlyChange = { ...value, updatedAt: LATER };
    expect(directoryProjectionContentEqual(value, metadataOnlyChange)).toBe(true);
    expect(directoryProjectionsEqual(value, metadataOnlyChange)).toBe(false);
  });

  test('browser-controlled member timestamps never determine projection metadata', () => {
    const farFuture = Timestamp.fromMillis(253_402_300_799_000);
    const value = projection({ member: member({ createdAt: farFuture, updatedAt: farFuture }) });
    expect(value.createdAt).toBe(NOW);
    expect(value.updatedAt).toBe(NOW);
  });

  test.each([
    ['extra field', (value) => ({ ...value, uid: UID })],
    ['raw prefix', (value) => ({ ...value, prefixDigests: ['adera'] })],
    ['wrong digest order', (value) => ({
      ...value,
      prefixDigests: [...value.prefixDigests].reverse(),
    })],
    ['wrong entry reference', (value) => ({ ...value, entryRef: UID })],
    ['unsafe display name', (value) => ({ ...value, displayName: `Adera\u200dLoventon` })],
    ['wrong normalization version', (value) => ({ ...value, normalizationVersion: 2 })],
    ['unsafe photo version', (value) => ({ ...value, photoVersion: 'photo-version' })],
  ])('fails closed on stored projection %s', (_label, mutate) => {
    expectProjectionError(() => readStoredDirectoryProjection(mutate(projection())), 'stored');
  });

  test('rejects root and digest-array accessors or Proxies without invoking them', () => {
    const trap = jest.fn(() => {
      throw new Error(HOSTILE_CANARY);
    });
    expectProjectionError(
      () => readStoredDirectoryProjection(new Proxy(projection(), { ownKeys: trap })),
      'stored',
    );
    expect(trap).not.toHaveBeenCalled();

    const value = { ...projection() };
    const getter = jest.fn(() => {
      throw new Error(HOSTILE_CANARY);
    });
    Object.defineProperty(value, 'prefixDigests', { enumerable: true, get: getter });
    expectProjectionError(() => readStoredDirectoryProjection(value), 'stored');
    expect(getter).not.toHaveBeenCalled();
  });

  test('reads only an own plain display-name data field', () => {
    expect(readDirectoryDisplayName({ fullName: '  Adera Loventon  ', role: 'admin' }))
      .toBe('Adera Loventon');
    expect(readDirectoryDisplayName(Object.create({ fullName: 'Inherited Name' }))).toBeNull();
    const getter = jest.fn(() => 'Accessor Name');
    const accessor = {};
    Object.defineProperty(accessor, 'fullName', { enumerable: true, get: getter });
    expect(readDirectoryDisplayName(accessor)).toBeNull();
    expect(getter).not.toHaveBeenCalled();
  });
});
