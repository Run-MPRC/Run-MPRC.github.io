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
  const runWith = jest.fn(() => ({
    https: { onCall: configuredOnCall },
  }));
  return {
    https: { HttpsError, onCall },
    runWith,
    __mocks: { onCall, configuredOnCall, runWith },
  };
});

jest.mock('./stripeHelpers', () => ({
  requireAppCheck: jest.fn(),
}));

jest.mock('./rateLimit', () => ({
  checkRateLimit: jest.fn(),
}));

const sharp = require('sharp');
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { requireAppCheck } = require('./stripeHelpers');
const { checkRateLimit } = require('./rateLimit');
const {
  buildDirectoryProjection,
  derivePrefixDigests,
  directoryEntryReference,
} = require('./memberDirectoryProjection');
const {
  ACTIONS,
  MemberDirectoryProfileError,
  readEmptyRequest,
  readVisibilityRequest,
  decodePhotoRequest,
  readRemoveRequest,
  readStoredState,
  reduceMemberDirectoryProfile,
  buildMutationCommand,
  buildAudit,
  auditDocumentId,
  photoRateLimitKey,
  readMemberName,
  publicState,
  processMemberDirectoryPhoto,
  getMyMemberDirectoryProfile,
  setMyMemberDirectoryVisibility,
  setMyMemberDirectoryPhoto,
  removeMyMemberDirectoryPhoto,
} = require('./memberDirectoryProfile');

const UID = 'synthetic-member-uid';
const REQUEST_1 = '11111111-1111-4111-8111-111111111111';
const REQUEST_2 = '22222222-2222-4222-8222-222222222222';
const REQUEST_3 = '33333333-3333-4333-8333-333333333333';
const HOSTILE_CANARY = 'private-name@example.test/GPS=47.6205,-122.3493';
const NOW = Timestamp.fromMillis(1_800_000_000_000);
const setResponseHeader = jest.fn();
const CONTEXT = Object.freeze({
  app: Object.freeze({ appId: 'synthetic-app' }),
  auth: Object.freeze({ uid: UID, token: Object.freeze({ email_verified: true }) }),
  rawRequest: Object.freeze({
    res: Object.freeze({ setHeader: setResponseHeader }),
  }),
});

const PATHS = Object.freeze({
  preference: `memberDirectoryPreferences/${UID}`,
  photo: `memberDirectoryPhotos/${UID}`,
  member: `members/${UID}`,
  entry: `memberDirectoryEntries/${UID}`,
});

function snapshot(value) {
  return {
    exists: value !== undefined,
    data: jest.fn(() => value),
  };
}

function createFirestoreHarness(seed = {}, options = {}) {
  const store = new Map(Object.entries(seed));
  const history = [];
  const refs = new Map();
  const refFor = (path) => {
    if (!refs.has(path)) refs.set(path, Object.freeze({ path }));
    return refs.get(path);
  };
  const collection = jest.fn((collectionName) => ({
    doc: jest.fn((documentId) => refFor(`${collectionName}/${documentId}`)),
  }));
  const runTransaction = jest.fn(async (handler, transactionOptions) => {
    const staged = [];
    const transaction = {
      get: jest.fn(async (ref) => snapshot(store.get(ref.path))),
      set: jest.fn((ref, value) => staged.push(['set', ref.path, value])),
      create: jest.fn((ref, value) => {
        if (store.has(ref.path) || staged.some((entry) => entry[1] === ref.path)) {
          throw new Error('document already exists');
        }
        staged.push(['create', ref.path, value]);
      }),
      delete: jest.fn((ref) => staged.push(['delete', ref.path])),
    };
    const result = await handler(transaction);
    if (options.failCommit) throw new Error(`${HOSTILE_CANARY}: synthetic commit failure`);
    for (const [operation, path, value] of staged) {
      if (operation === 'delete') store.delete(path);
      else store.set(path, value);
    }
    history.push({ staged, transaction, transactionOptions });
    return result;
  });
  const db = Object.freeze({ collection, runTransaction });
  admin.__setDatabase(db);
  return { db, history, runTransaction, store };
}

function fakeWebpBytes(marker = 'synthetic') {
  return Buffer.from(`RIFF0000WEBP${marker}`);
}

function photoDoc(overrides = {}) {
  return {
    schemaVersion: 1,
    bytes: fakeWebpBytes(),
    contentType: 'image/webp',
    width: 256,
    height: 256,
    version: REQUEST_1,
    updatedAt: NOW,
    ...overrides,
  };
}

function preference(overrides = {}) {
  return {
    schemaVersion: 1,
    revision: 1,
    searchableByOfficers: false,
    hasPhoto: false,
    lastRequestId: REQUEST_1,
    lastAction: ACTIONS.setVisibility,
    lastExpectedRevision: 0,
    updatedAt: NOW,
    ...overrides,
  };
}

function memberDoc(overrides = {}) {
  return {
    fullName: 'Synthetic Runner',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function entryDoc({
  currentPreference = preference({ searchableByOfficers: true }),
  currentPhoto = null,
  currentMember = memberDoc(),
} = {}) {
  return buildDirectoryProjection({
    uid: UID,
    member: currentMember,
    state: {
      preference: currentPreference,
      photo: currentPhoto,
      revision: currentPreference.revision,
      searchableByOfficers: currentPreference.searchableByOfficers,
      hasPhoto: Boolean(currentPhoto),
    },
  });
}

function command(overrides = {}) {
  return {
    action: ACTIONS.setVisibility,
    requestId: REQUEST_1,
    expectedRevision: 0,
    searchableByOfficers: false,
    photo: null,
    occurredAt: NOW,
    ...overrides,
  };
}

function visibilityRequest(overrides = {}) {
  return {
    requestId: REQUEST_1,
    expectedRevision: 0,
    searchableByOfficers: false,
    ...overrides,
  };
}

function photoRequest(bytes, contentType, overrides = {}) {
  return {
    requestId: REQUEST_1,
    expectedRevision: 0,
    contentType,
    base64Data: bytes.toString('base64'),
    ...overrides,
  };
}

function removeRequest(overrides = {}) {
  return {
    requestId: REQUEST_1,
    expectedRevision: 0,
    ...overrides,
  };
}

function expectProfileError(callback, kind) {
  let caught;
  try {
    callback();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(MemberDirectoryProfileError);
  expect(caught.kind).toBe(kind);
  expect(caught.message).toBe('Member directory profile input is invalid.');
  expect(JSON.stringify(caught)).toBe('{}');
  expect(String(caught)).not.toContain(HOSTILE_CANARY);
}

async function makeImage(format, options = {}) {
  const width = options.width || 64;
  const height = options.height || 48;
  let pipeline = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: options.background || { r: 30, g: 130, b: 210, alpha: 0.8 },
      ...(options.pageHeight ? { pageHeight: options.pageHeight } : {}),
      ...(options.noise ? { noise: { type: 'gaussian', mean: 128, sigma: 60 } } : {}),
    },
  });
  if (options.metadata) pipeline = pipeline.withMetadata(options.metadata);
  if (format === 'jpeg') return pipeline.jpeg({ quality: 85 }).toBuffer();
  if (format === 'png') return pipeline.png().toBuffer();
  return pipeline.webp({
    quality: 80,
    ...(options.delay ? { delay: options.delay, loop: 0 } : {}),
  }).toBuffer();
}

async function decodeAndProcess(bytes, contentType) {
  return processMemberDirectoryPhoto(decodePhotoRequest(photoRequest(bytes, contentType)));
}

beforeEach(() => {
  requireAppCheck.mockReset();
  checkRateLimit.mockReset().mockResolvedValue(undefined);
  setResponseHeader.mockReset();
  createFirestoreHarness();
});

describe('closed request validation', () => {
  test.each([undefined, null, {}])('accepts the exact empty get request: %p', (value) => {
    expect(readEmptyRequest(value)).toEqual({});
  });

  test.each([[], '', 1, { uid: UID }, { unexpected: true }, Object.create(null)])(
    'rejects a non-empty or exotic get request: %p',
    (value) => expectProfileError(() => readEmptyRequest(value), 'request'),
  );

  test('reads the exact visibility and removal request shapes', () => {
    expect(readVisibilityRequest(visibilityRequest())).toMatchObject({
      requestId: REQUEST_1,
      expectedRevision: 0,
      searchableByOfficers: false,
    });
    expect(readRemoveRequest(removeRequest())).toMatchObject({
      requestId: REQUEST_1,
      expectedRevision: 0,
    });
  });

  test.each([
    ['uid injection', { uid: UID }],
    ['role injection', { role: 'admin' }],
    ['extra request body', { body: HOSTILE_CANARY }],
  ])('rejects %s without echo', (_label, extra) => {
    expectProfileError(() => readVisibilityRequest({ ...visibilityRequest(), ...extra }), 'request');
  });

  test.each([
    ['uppercase UUID', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'],
    ['wrong UUID version', '11111111-1111-1111-8111-111111111111'],
    ['wrong UUID variant', '11111111-1111-4111-7111-111111111111'],
    ['prose', HOSTILE_CANARY],
  ])('rejects a non-canonical request ID: %s', (_label, requestId) => {
    expectProfileError(
      () => readVisibilityRequest(visibilityRequest({ requestId })),
      'request',
    );
  });

  test.each([
    -1,
    -0,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    '0',
    null,
  ])('rejects an invalid expected revision: %p', (expectedRevision) => {
    expectProfileError(
      () => readVisibilityRequest(visibilityRequest({ expectedRevision })),
      'request',
    );
  });

  test.each([null, 0, 1, 'false', {}, []])(
    'rejects a non-boolean visibility value: %p',
    (searchableByOfficers) => expectProfileError(
      () => readVisibilityRequest(visibilityRequest({ searchableByOfficers })),
      'request',
    ),
  );

  test('rejects an accessor without invoking it', () => {
    const getter = jest.fn(() => {
      throw new Error(HOSTILE_CANARY);
    });
    const value = visibilityRequest();
    Object.defineProperty(value, 'searchableByOfficers', {
      enumerable: true,
      get: getter,
    });
    expectProfileError(() => readVisibilityRequest(value), 'request');
    expect(getter).not.toHaveBeenCalled();
  });

  test('rejects live and revoked Proxies without consulting traps', () => {
    const trap = jest.fn(() => {
      throw new Error(HOSTILE_CANARY);
    });
    const live = new Proxy(visibilityRequest(), {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    expectProfileError(() => readVisibilityRequest(live), 'request');
    expect(trap).not.toHaveBeenCalled();

    const revocable = Proxy.revocable(visibilityRequest(), {});
    revocable.revoke();
    expectProfileError(() => readVisibilityRequest(revocable.proxy), 'request');
  });

  test('accepts only canonical standard base64 beneath the decoded byte cap', () => {
    const decoded = decodePhotoRequest(photoRequest(Buffer.from([0xff]), 'image/jpeg'));
    expect(decoded.bytes).toEqual(Buffer.from([0xff]));

    for (const base64Data of ['', '//==', '_w==', '/w', '/w===', ' /w==', '/w==\n']) {
      expectProfileError(() => decodePhotoRequest(photoRequest(
        Buffer.from([0xff]),
        'image/jpeg',
        { base64Data },
      )), 'request');
    }
  });

  test('rejects bytes beyond 2 MiB before image processing', () => {
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 1, 7);
    expectProfileError(
      () => decodePhotoRequest(photoRequest(bytes, 'image/jpeg')),
      'request',
    );
  });

  test.each(['image/jpg', 'image/gif', 'IMAGE/JPEG', 'image/jpeg; charset=binary'])(
    'rejects an unapproved or inexact content type: %s',
    (contentType) => {
    expectProfileError(
      () => decodePhotoRequest(photoRequest(Buffer.from([0xff]), contentType)),
      'request',
    );
    },
  );
});

describe('versioned pure profile state transitions', () => {
  test('projects a missing preference and photo as exact default-hidden state', () => {
    expect(readStoredState(null, null)).toEqual({
      preference: null,
      photo: null,
      revision: 0,
      searchableByOfficers: false,
      hasPhoto: false,
    });
    expect(publicState(null, null, true)).toEqual({
      schemaVersion: 1,
      revision: 0,
      searchableByOfficers: false,
      hasPhoto: false,
      photo: null,
    });
  });

  test('visibility mutation increments revision without fabricating a photo', () => {
    const result = reduceMemberDirectoryProfile(null, null, command({
      searchableByOfficers: true,
    }));
    expect(result.disposition).toBe('applied');
    expect(result.preference).toEqual(preference({ searchableByOfficers: true }));
    expect(result.photo).toBeNull();
  });

  test('photo upload preserves visibility and photo removal preserves visibility', () => {
    const currentPreference = preference({ searchableByOfficers: true });
    const nextPhoto = photoDoc({ version: REQUEST_2 });
    const uploadCommand = command({
      action: ACTIONS.setPhoto,
      requestId: REQUEST_2,
      expectedRevision: 1,
      searchableByOfficers: null,
      photo: nextPhoto,
    });
    const upload = reduceMemberDirectoryProfile(currentPreference, null, uploadCommand);
    expect(upload.preference).toMatchObject({
      revision: 2,
      searchableByOfficers: true,
      hasPhoto: true,
    });
    expect(upload.photo).toEqual(nextPhoto);

    const remove = reduceMemberDirectoryProfile(upload.preference, upload.photo, command({
      action: ACTIONS.removePhoto,
      requestId: REQUEST_3,
      expectedRevision: 2,
      searchableByOfficers: null,
      photo: null,
    }));
    expect(remove.preference).toMatchObject({
      revision: 3,
      searchableByOfficers: true,
      hasPhoto: false,
    });
    expect(remove.photo).toBeNull();
  });

  test('photo upload alone never enables visibility', () => {
    const result = reduceMemberDirectoryProfile(null, null, command({
      action: ACTIONS.setPhoto,
      searchableByOfficers: null,
      photo: photoDoc(),
    }));
    expect(result.preference).toMatchObject({
      searchableByOfficers: false,
      hasPhoto: true,
    });
  });

  test('an exact latest retry is read-only, including for a regenerated photo wrapper', () => {
    const firstPhoto = photoDoc();
    const first = reduceMemberDirectoryProfile(null, null, command({
      action: ACTIONS.setPhoto,
      searchableByOfficers: null,
      photo: firstPhoto,
    }));
    const retry = reduceMemberDirectoryProfile(first.preference, first.photo, command({
      action: ACTIONS.setPhoto,
      searchableByOfficers: null,
      photo: photoDoc({
        bytes: Buffer.from(firstPhoto.bytes),
        version: REQUEST_1,
        updatedAt: Timestamp.fromMillis(1_900_000_000_000),
      }),
    }));
    expect(retry.disposition).toBe('already_applied');
    expect(retry.preference).toEqual(first.preference);
    expect(retry.photo).toEqual(first.photo);
  });

  test.each([
    ['action', { action: ACTIONS.removePhoto, searchableByOfficers: null }],
    ['expected revision', { expectedRevision: 1 }],
    ['visibility value', { searchableByOfficers: true }],
  ])('rejects changed latest-request reuse: %s', (_label, patch) => {
    expectProfileError(
      () => reduceMemberDirectoryProfile(preference(), null, command(patch)),
      'stale',
    );
  });

  test('rejects changed normalized photo bytes under the latest upload request ID', () => {
    const first = reduceMemberDirectoryProfile(null, null, command({
      action: ACTIONS.setPhoto,
      searchableByOfficers: null,
      photo: photoDoc(),
    }));
    expectProfileError(() => reduceMemberDirectoryProfile(
      first.preference,
      first.photo,
      command({
        action: ACTIONS.setPhoto,
        searchableByOfficers: null,
        photo: photoDoc({ bytes: fakeWebpBytes('different-normalized-pixels') }),
      }),
    ), 'stale');
  });

  test.each([0, 2, Number.MAX_SAFE_INTEGER])(
    'rejects a stale, skipped, or exhausted new command at revision %p',
    (expectedRevision) => expectProfileError(
      () => reduceMemberDirectoryProfile(preference(), null, command({
        requestId: REQUEST_2,
        expectedRevision,
      })),
      'stale',
    ),
  );

  test('accepts an exact retry at MAX_SAFE_INTEGER but no new mutation', () => {
    const exhausted = preference({
      revision: Number.MAX_SAFE_INTEGER,
      lastExpectedRevision: Number.MAX_SAFE_INTEGER - 1,
    });
    const exact = command({ expectedRevision: Number.MAX_SAFE_INTEGER - 1 });
    expect(reduceMemberDirectoryProfile(exhausted, null, exact).disposition)
      .toBe('already_applied');
    expectProfileError(() => reduceMemberDirectoryProfile(exhausted, null, command({
      requestId: REQUEST_2,
      expectedRevision: Number.MAX_SAFE_INTEGER,
    })), 'stale');
  });

  test.each([
    ['orphan photo', null, photoDoc()],
    ['missing photo bytes', preference({ hasPhoto: true }), null],
    ['unexpected photo', preference(), photoDoc()],
    ['zero stored revision', preference({ revision: 0, lastExpectedRevision: 0 }), null],
    ['future cursor', preference({ revision: 2, lastExpectedRevision: 0 }), null],
    ['extra preference field', { ...preference(), role: 'admin' }, null],
    ['wrong photo MIME', preference({ hasPhoto: true }), photoDoc({ contentType: 'image/png' })],
    ['upload request/photo version mismatch', preference({
      hasPhoto: true,
      lastAction: ACTIONS.setPhoto,
    }), photoDoc({ version: REQUEST_2 })],
    ['upload preference/photo timestamp mismatch', preference({
      hasPhoto: true,
      lastAction: ACTIONS.setPhoto,
    }), photoDoc({ updatedAt: Timestamp.fromMillis(1_900_000_000_000) })],
    ['oversized processed bytes', preference({ hasPhoto: true }), photoDoc({
      bytes: Buffer.concat([fakeWebpBytes(), Buffer.alloc(64 * 1024)]),
    })],
  ])('fails closed on malformed stored state: %s', (_label, pref, photo) => {
    expectProfileError(() => readStoredState(pref, photo), 'stored');
  });

  test('rejects stored accessors and Proxies without invoking hostile code', () => {
    const getter = jest.fn(() => {
      throw new Error(HOSTILE_CANARY);
    });
    const stored = preference();
    Object.defineProperty(stored, 'revision', { enumerable: true, get: getter });
    expectProfileError(() => readStoredState(stored, null), 'stored');
    expect(getter).not.toHaveBeenCalled();

    const trap = jest.fn(() => {
      throw new Error(HOSTILE_CANARY);
    });
    const proxied = new Proxy(preference(), { get: trap, ownKeys: trap });
    expectProfileError(() => readStoredState(proxied, null), 'stored');
    expect(trap).not.toHaveBeenCalled();
  });

  test('audit records are deterministic, minimal, and non-authoritative', () => {
    const result = reduceMemberDirectoryProfile(null, null, command());
    const audit = buildAudit(UID, command(), result.preference);
    expect(Object.keys(audit)).toEqual([
      'actorUid',
      'action',
      'requestId',
      'revision',
      'hasPhoto',
      'searchableByOfficers',
      'outcome',
      'createdAt',
    ]);
    expect(audit).toEqual({
      actorUid: UID,
      action: ACTIONS.setVisibility,
      requestId: REQUEST_1,
      revision: 1,
      hasPhoto: false,
      searchableByOfficers: false,
      outcome: 'applied',
      createdAt: NOW,
    });
    expect(auditDocumentId(UID, REQUEST_1)).toBe(auditDocumentId(UID, REQUEST_1));
    expect(auditDocumentId(UID, REQUEST_1)).not.toContain(UID);
    expect(photoRateLimitKey(UID)).toMatch(/^[0-9a-f]{64}$/);
    expect(photoRateLimitKey(UID)).not.toContain(UID);
    expect(JSON.stringify(audit)).not.toContain(HOSTILE_CANARY);
  });

  test('display-name projection accepts only a bounded own data field', () => {
    expect(readMemberName({ fullName: '  Synthetic Runner  ', role: 'unverified' }))
      .toBe('Synthetic Runner');
    for (const value of [
      null,
      {},
      { fullName: '' },
      { fullName: ' '.repeat(3) },
      { fullName: 'x'.repeat(201) },
      { fullName: null },
      Object.create({ fullName: 'Inherited Name' }),
    ]) {
      expect(readMemberName(value)).toBeNull();
    }
  });
});

describe('bounded generated-image pipeline', () => {
  test.each([
    ['jpeg', 'image/jpeg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
  ])('re-encodes one generated static %s as a fixed bounded WebP', async (format, contentType) => {
    const input = await makeImage(format);
    const output = await decodeAndProcess(input, contentType);
    const metadata = await sharp(output).metadata();
    expect(output.length).toBeGreaterThan(0);
    expect(output.length).toBeLessThanOrEqual(64 * 1024);
    expect(metadata).toMatchObject({ format: 'webp', width: 256, height: 256 });
    expect(metadata.pages === undefined || metadata.pages === 1).toBe(true);
  });

  test('auto-orients and strips generated EXIF/profile metadata', async () => {
    const input = await makeImage('jpeg', {
      width: 96,
      height: 48,
      metadata: {
        orientation: 6,
        exif: { IFD0: { Copyright: HOSTILE_CANARY } },
      },
    });
    const inputMetadata = await sharp(input).metadata();
    expect(inputMetadata.orientation).toBe(6);
    expect(inputMetadata.exif).toBeDefined();

    const output = await decodeAndProcess(input, 'image/jpeg');
    const outputMetadata = await sharp(output).metadata();
    expect(outputMetadata.orientation).toBeUndefined();
    expect(outputMetadata.exif).toBeUndefined();
    expect(outputMetadata.icc).toBeUndefined();
    expect(outputMetadata.xmp).toBeUndefined();
    expect(output.includes(Buffer.from(HOSTILE_CANARY))).toBe(false);
  });

  test('rejects MIME/magic spoofing and malformed bytes with one fixed error', async () => {
    const jpeg = await makeImage('jpeg');
    const png = await makeImage('png');
    const invalid = Buffer.from('RIFF0000WEBPnot-an-image');
    for (const [bytes, contentType] of [
      [jpeg, 'image/png'],
      [png, 'image/webp'],
      [invalid, 'image/webp'],
    ]) {
      await expect(decodeAndProcess(bytes, contentType)).rejects.toMatchObject({
        kind: 'photo',
        message: 'Member directory profile input is invalid.',
      });
    }
  });

  test('rejects generated inputs over the dimension or pixel cap', async () => {
    const tooWide = await makeImage('jpeg', { width: 8_193, height: 1 });
    const tooManyPixels = await makeImage('jpeg', { width: 5_000, height: 4_001 });
    await expect(decodeAndProcess(tooWide, 'image/jpeg')).rejects.toMatchObject({ kind: 'photo' });
    await expect(decodeAndProcess(tooManyPixels, 'image/jpeg')).rejects.toMatchObject({
      kind: 'photo',
    });
  });

  test('rejects a generated animated WebP rather than retaining its first frame', async () => {
    const frame1 = await makeImage('png', {
      width: 32,
      height: 32,
      background: { r: 220, g: 30, b: 40, alpha: 1 },
    });
    const frame2 = await makeImage('png', {
      width: 32,
      height: 32,
      background: { r: 30, g: 40, b: 220, alpha: 1 },
    });
    const animated = await sharp([frame1, frame2], { join: { animated: true } })
      .webp({ delay: [40, 40], loop: 0 })
      .toBuffer();
    const metadata = await sharp(animated, { animated: true }).metadata();
    expect(metadata.pages).toBeGreaterThan(1);
    await expect(decodeAndProcess(animated, 'image/webp')).rejects.toMatchObject({
      kind: 'photo',
    });
  });

  test('bounds noisy RGBA output at or below 64 KiB', async () => {
    const noisy = await makeImage('png', {
      width: 512,
      height: 512,
      noise: true,
    });
    const output = await decodeAndProcess(noisy, 'image/png');
    expect(output.length).toBeLessThanOrEqual(64 * 1024);
  });
});

describe('callable authorization, ordering, transactions, and fixed failures', () => {
  test('natively enforces App Check and bounds the expensive upload runtime', () => {
    expect(functions.__mocks.runWith.mock.calls).toEqual([
      [{ enforceAppCheck: true }],
      [{ enforceAppCheck: true }],
      [{ enforceAppCheck: true, memory: '512MB', timeoutSeconds: 30 }],
      [{ enforceAppCheck: true }],
    ]);
    expect(functions.__mocks.configuredOnCall).toHaveBeenCalledTimes(4);
    expect(functions.__mocks.onCall).not.toHaveBeenCalled();
  });

  test('get returns the exact default-hidden state and uses a read-only transaction', async () => {
    const harness = createFirestoreHarness();
    await expect(getMyMemberDirectoryProfile({}, CONTEXT)).resolves.toEqual({
      schemaVersion: 1,
      revision: 0,
      searchableByOfficers: false,
      hasPhoto: false,
      photo: null,
    });
    expect(requireAppCheck).toHaveBeenCalledWith(CONTEXT);
    expect(setResponseHeader.mock.calls).toEqual([
      ['Cache-Control', 'private, no-store, max-age=0'],
      ['Pragma', 'no-cache'],
      ['Expires', '0'],
    ]);
    expect(requireAppCheck.mock.invocationCallOrder[0])
      .toBeLessThan(setResponseHeader.mock.invocationCallOrder[0]);
    expect(harness.history[0].transactionOptions).toEqual({ readOnly: true });
    expect(harness.history[0].staged).toEqual([]);
  });

  test('get returns only the caller own bounded processed thumbnail fields', async () => {
    const storedPhoto = photoDoc();
    createFirestoreHarness({
      [PATHS.preference]: preference({ hasPhoto: true }),
      [PATHS.photo]: storedPhoto,
    });
    await expect(getMyMemberDirectoryProfile(null, CONTEXT)).resolves.toEqual({
      schemaVersion: 1,
      revision: 1,
      searchableByOfficers: false,
      hasPhoto: true,
      photo: {
        contentType: 'image/webp',
        base64Data: storedPhoto.bytes.toString('base64'),
        width: 256,
        height: 256,
        version: storedPhoto.version,
      },
    });
  });

  test('App Check precedes Auth, validation, rate limiting, and Firestore', async () => {
    const harness = createFirestoreHarness();
    const rejection = new functions.https.HttpsError(
      'failed-precondition',
      'App Check required.',
    );
    requireAppCheck.mockImplementation(() => { throw rejection; });
    await expect(setMyMemberDirectoryPhoto({ uid: UID }, { auth: null }))
      .rejects.toBe(rejection);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(harness.runTransaction).not.toHaveBeenCalled();
  });

  test('Auth precedes request validation and rate limiting', async () => {
    const harness = createFirestoreHarness();
    await expect(setMyMemberDirectoryPhoto({ uid: UID }, { ...CONTEXT, auth: null }))
      .rejects.toMatchObject({
        code: 'unauthenticated',
        message: 'Sign-in required.',
      });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(harness.runTransaction).not.toHaveBeenCalled();
  });

  test('fails closed before Auth or private data when no response header boundary exists', async () => {
    const harness = createFirestoreHarness();
    await expect(getMyMemberDirectoryProfile({}, {
      app: CONTEXT.app,
      auth: CONTEXT.auth,
      rawRequest: {},
    })).rejects.toMatchObject({
      code: 'internal',
      message: 'Private profile response is unavailable.',
    });
    expect(harness.runTransaction).not.toHaveBeenCalled();
  });

  test('fails closed if the no-store response headers cannot be set', async () => {
    const harness = createFirestoreHarness();
    const setHeader = jest.fn(() => {
      throw new Error(HOSTILE_CANARY);
    });
    await expect(getMyMemberDirectoryProfile({}, {
      ...CONTEXT,
      rawRequest: { res: { setHeader } },
    })).rejects.toMatchObject({
      code: 'internal',
      message: 'Private profile response is unavailable.',
    });
    expect(setHeader).toHaveBeenCalledTimes(1);
    expect(harness.runTransaction).not.toHaveBeenCalled();
  });

  test('strict upload envelope validation precedes the rate limiter', async () => {
    const harness = createFirestoreHarness();
    await expect(setMyMemberDirectoryPhoto({
      requestId: REQUEST_1,
      expectedRevision: 0,
      contentType: 'image/jpeg',
      base64Data: HOSTILE_CANARY,
      uid: UID,
    }, CONTEXT)).rejects.toMatchObject({
      code: 'invalid-argument',
      message: 'Profile directory request is invalid.',
    });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(harness.runTransaction).not.toHaveBeenCalled();
  });

  test('rate limiting precedes decode and returns the shared generic exhaustion error', async () => {
    const harness = createFirestoreHarness();
    const jpeg = await makeImage('jpeg');
    const limited = new functions.https.HttpsError(
      'resource-exhausted',
      'Too many requests. Please wait a few minutes and try again.',
    );
    checkRateLimit.mockRejectedValue(limited);
    await expect(setMyMemberDirectoryPhoto(
      photoRequest(jpeg, 'image/jpeg'),
      CONTEXT,
    )).rejects.toBe(limited);
    expect(checkRateLimit).toHaveBeenCalledWith({
      scope: 'member_directory_photo',
      key: photoRateLimitKey(UID),
      limit: 10,
      windowMs: 60 * 60 * 1000,
    });
    expect(harness.runTransaction).not.toHaveBeenCalled();
  });

  test('visibility opt-in requires the exact current bounded member display name', async () => {
    const harness = createFirestoreHarness();
    await expect(setMyMemberDirectoryVisibility(visibilityRequest({
      searchableByOfficers: true,
    }), CONTEXT)).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'A valid account display name is required before enabling search.',
    });
    expect(harness.store.size).toBe(0);

    const accessor = {};
    const getter = jest.fn(() => {
      throw new Error(HOSTILE_CANARY);
    });
    Object.defineProperty(accessor, 'fullName', { enumerable: true, get: getter });
    createFirestoreHarness({ [PATHS.member]: accessor });
    await expect(setMyMemberDirectoryVisibility(visibilityRequest({
      searchableByOfficers: true,
    }), CONTEXT)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(getter).not.toHaveBeenCalled();

    createFirestoreHarness({ [PATHS.member]: memberDoc({ fullName: '-A-' }) });
    await expect(setMyMemberDirectoryVisibility(visibilityRequest({
      searchableByOfficers: true,
    }), CONTEXT)).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'A valid account display name is required before enabling search.',
    });
  });

  test('visibility commits preference and one deterministic minimal audit atomically', async () => {
    const harness = createFirestoreHarness({
      [PATHS.member]: memberDoc({ role: 'unverified', email: HOSTILE_CANARY }),
    });
    const result = await setMyMemberDirectoryVisibility(visibilityRequest({
      searchableByOfficers: true,
    }), CONTEXT);
    expect(result).toEqual({
      schemaVersion: 1,
      revision: 1,
      searchableByOfficers: true,
      hasPhoto: false,
    });
    expect(harness.store.get(PATHS.preference)).toEqual(preference({
      searchableByOfficers: true,
      updatedAt: expect.any(Timestamp),
    }));
    expect(harness.store.get(PATHS.entry)).toEqual({
      schemaVersion: 1,
      normalizationVersion: 1,
      entryRef: directoryEntryReference(UID),
      displayName: 'Synthetic Runner',
      prefixDigests: derivePrefixDigests('Synthetic Runner'),
      photoVersion: null,
      preferenceRevision: 1,
      createdAt: expect.any(Timestamp),
      updatedAt: expect.any(Timestamp),
    });
    const auditPath = `auditEvents/${auditDocumentId(UID, REQUEST_1)}`;
    expect(harness.store.get(auditPath)).toEqual({
      actorUid: UID,
      action: ACTIONS.setVisibility,
      requestId: REQUEST_1,
      revision: 1,
      hasPhoto: false,
      searchableByOfficers: true,
      outcome: 'applied',
      createdAt: expect.any(Timestamp),
    });
    expect(JSON.stringify(harness.store.get(auditPath))).not.toContain(HOSTILE_CANARY);
  });

  test('visibility opt-out preserves the photo and does not read the member name', async () => {
    const storedPhoto = photoDoc();
    const storedPreference = preference({ searchableByOfficers: true, hasPhoto: true });
    const harness = createFirestoreHarness({
      [PATHS.preference]: storedPreference,
      [PATHS.photo]: storedPhoto,
      [PATHS.entry]: entryDoc({
        currentPreference: storedPreference,
        currentPhoto: storedPhoto,
      }),
    });
    await expect(setMyMemberDirectoryVisibility(visibilityRequest({
      requestId: REQUEST_2,
      expectedRevision: 1,
      searchableByOfficers: false,
    }), CONTEXT)).resolves.toEqual({
      schemaVersion: 1,
      revision: 2,
      searchableByOfficers: false,
      hasPhoto: true,
    });
    expect(harness.store.get(PATHS.photo)).toBe(storedPhoto);
    expect(harness.store.has(PATHS.entry)).toBe(false);
    expect(harness.history[0].staged).toContainEqual(['delete', PATHS.entry]);
    expect(harness.history[0].transaction.get)
      .not.toHaveBeenCalledWith(expect.objectContaining({ path: PATHS.member }));
  });

  test('opted-in photo upload and replacement keep only the current projection revision/version', async () => {
    const firstInput = await makeImage('png', { width: 80, height: 40 });
    const secondInput = await makeImage('jpeg', { width: 72, height: 96 });
    const currentPreference = preference({ searchableByOfficers: true });
    const currentMember = memberDoc();
    const harness = createFirestoreHarness({
      [PATHS.preference]: currentPreference,
      [PATHS.member]: currentMember,
      [PATHS.entry]: entryDoc({ currentPreference, currentMember }),
    });

    await setMyMemberDirectoryPhoto(photoRequest(firstInput, 'image/png', {
      requestId: REQUEST_2,
      expectedRevision: 1,
    }), CONTEXT);
    const firstEntry = harness.store.get(PATHS.entry);
    expect(firstEntry).toMatchObject({
      photoVersion: REQUEST_2,
      preferenceRevision: 2,
      displayName: 'Synthetic Runner',
    });

    await setMyMemberDirectoryPhoto(photoRequest(secondInput, 'image/jpeg', {
      requestId: REQUEST_3,
      expectedRevision: 2,
    }), CONTEXT);
    const replacedEntry = harness.store.get(PATHS.entry);
    expect(replacedEntry).toMatchObject({
      photoVersion: REQUEST_3,
      preferenceRevision: 3,
      displayName: 'Synthetic Runner',
    });
    expect(replacedEntry.createdAt).toBe(firstEntry.createdAt);
    expect(JSON.stringify(replacedEntry)).not.toContain(REQUEST_2);
  });

  test('upload processes generated pixels, preserves visibility, and stores no original', async () => {
    const input = await makeImage('png', { width: 80, height: 40 });
    const existing = preference({ searchableByOfficers: true });
    const harness = createFirestoreHarness({ [PATHS.preference]: existing });
    const result = await setMyMemberDirectoryPhoto(photoRequest(input, 'image/png', {
      requestId: REQUEST_2,
      expectedRevision: 1,
    }), CONTEXT);
    expect(result).toEqual({
      schemaVersion: 1,
      revision: 2,
      searchableByOfficers: true,
      hasPhoto: true,
    });
    const stored = harness.store.get(PATHS.photo);
    expect(Object.keys(stored)).toEqual([
      'schemaVersion',
      'bytes',
      'contentType',
      'width',
      'height',
      'version',
      'updatedAt',
    ]);
    expect(stored).toMatchObject({
      schemaVersion: 1,
      contentType: 'image/webp',
      width: 256,
      height: 256,
      version: REQUEST_2,
      updatedAt: expect.any(Timestamp),
    });
    expect(stored.bytes.equals(input)).toBe(false);
    expect(stored.bytes.length).toBeLessThanOrEqual(64 * 1024);
    const storedPreference = harness.store.get(PATHS.preference);
    expect(Object.keys(storedPreference)).toEqual([
      'schemaVersion',
      'revision',
      'searchableByOfficers',
      'hasPhoto',
      'lastRequestId',
      'lastAction',
      'lastExpectedRevision',
      'updatedAt',
    ]);
    expect(JSON.stringify(storedPreference)).not.toContain(input.toString('base64'));
  });

  test('remove deletes active bytes while preserving visibility', async () => {
    const storedPhoto = photoDoc();
    const storedPreference = preference({ searchableByOfficers: true, hasPhoto: true });
    const currentMember = memberDoc();
    const harness = createFirestoreHarness({
      [PATHS.preference]: storedPreference,
      [PATHS.photo]: storedPhoto,
      [PATHS.member]: currentMember,
      [PATHS.entry]: entryDoc({
        currentPreference: storedPreference,
        currentPhoto: storedPhoto,
        currentMember,
      }),
    });
    await expect(removeMyMemberDirectoryPhoto(removeRequest({
      requestId: REQUEST_2,
      expectedRevision: 1,
    }), CONTEXT)).resolves.toEqual({
      schemaVersion: 1,
      revision: 2,
      searchableByOfficers: true,
      hasPhoto: false,
    });
    expect(harness.store.has(PATHS.photo)).toBe(false);
    expect(harness.store.get(PATHS.preference)).toMatchObject({
      searchableByOfficers: true,
      hasPhoto: false,
    });
    expect(harness.store.get(PATHS.entry)).toMatchObject({
      photoVersion: null,
      preferenceRevision: 2,
      displayName: 'Synthetic Runner',
    });
  });

  test.each([
    ['missing', undefined],
    ['malformed', { fullName: '---', updatedAt: NOW }],
  ])('an opted-in profile mutation hides a stale entry when the member name is %s', async (
    _label,
    currentMember,
  ) => {
    const storedPhoto = photoDoc();
    const storedPreference = preference({ searchableByOfficers: true, hasPhoto: true });
    const seed = {
      [PATHS.preference]: storedPreference,
      [PATHS.photo]: storedPhoto,
      [PATHS.entry]: entryDoc({
        currentPreference: storedPreference,
        currentPhoto: storedPhoto,
      }),
    };
    if (currentMember !== undefined) seed[PATHS.member] = currentMember;
    const harness = createFirestoreHarness(seed);

    await expect(removeMyMemberDirectoryPhoto(removeRequest({
      requestId: REQUEST_2,
      expectedRevision: 1,
    }), CONTEXT)).resolves.toMatchObject({
      revision: 2,
      searchableByOfficers: true,
      hasPhoto: false,
    });
    expect(harness.store.has(PATHS.entry)).toBe(false);
  });

  test('exact latest visibility retry validates its audit and performs no writes', async () => {
    const harness = createFirestoreHarness({ [PATHS.member]: memberDoc() });
    const request = visibilityRequest({ searchableByOfficers: true });
    const first = await setMyMemberDirectoryVisibility(request, CONTEXT);
    const firstHistory = harness.history.length;
    const originalPreference = harness.store.get(PATHS.preference);
    const originalEntry = harness.store.get(PATHS.entry);
    const auditPath = `auditEvents/${auditDocumentId(UID, REQUEST_1)}`;
    const originalAudit = harness.store.get(auditPath);
    const equalButDistinctAuditTime = new Timestamp(
      originalAudit.createdAt.seconds,
      originalAudit.createdAt.nanoseconds,
    );
    expect(equalButDistinctAuditTime).not.toBe(originalAudit.createdAt);
    const separatelyDecodedAudit = { ...originalAudit, createdAt: equalButDistinctAuditTime };
    harness.store.set(auditPath, separatelyDecodedAudit);

    await expect(setMyMemberDirectoryVisibility(request, CONTEXT)).resolves.toEqual(first);
    expect(harness.history).toHaveLength(firstHistory + 1);
    expect(harness.history.at(-1).staged).toEqual([]);
    expect(harness.store.get(PATHS.preference)).toBe(originalPreference);
    expect(harness.store.get(PATHS.entry)).toBe(originalEntry);
    expect(harness.store.get(auditPath)).toBe(separatelyDecodedAudit);
  });

  test('exact upload retry leaves domain state read-only while the safety limiter consumes quota', async () => {
    const input = await makeImage('jpeg');
    const harness = createFirestoreHarness();
    const request = photoRequest(input, 'image/jpeg');
    const first = await setMyMemberDirectoryPhoto(request, CONTEXT);
    const originalPreference = harness.store.get(PATHS.preference);
    const originalPhoto = harness.store.get(PATHS.photo);
    const auditPath = `auditEvents/${auditDocumentId(UID, REQUEST_1)}`;
    const originalAudit = harness.store.get(auditPath);

    await expect(setMyMemberDirectoryPhoto(request, CONTEXT)).resolves.toEqual(first);
    expect(checkRateLimit).toHaveBeenCalledTimes(2);
    expect(harness.history.at(-1).staged).toEqual([]);
    expect(harness.store.get(PATHS.preference)).toBe(originalPreference);
    expect(harness.store.get(PATHS.photo)).toBe(originalPhoto);
    expect(harness.store.get(auditPath)).toBe(originalAudit);
  });

  test('changed retry, stale revision, and malformed stored state fail with fixed errors', async () => {
    const initial = readVisibilityRequest(visibilityRequest());
    const pref = reduceMemberDirectoryProfile(
      null,
      null,
      buildMutationCommand(ACTIONS.setVisibility, initial),
    ).preference;
    const audit = buildAudit(
      UID,
      buildMutationCommand(ACTIONS.setVisibility, initial),
      pref,
    );
    createFirestoreHarness({
      [PATHS.preference]: pref,
      [`auditEvents/${auditDocumentId(UID, REQUEST_1)}`]: audit,
    });
    await expect(setMyMemberDirectoryVisibility(visibilityRequest({
      searchableByOfficers: true,
    }), CONTEXT)).rejects.toMatchObject({
      code: 'aborted',
      message: 'Profile directory changed. Reload before trying again.',
    });

    createFirestoreHarness({ [PATHS.preference]: { ...pref, revision: -1 } });
    await expect(getMyMemberDirectoryProfile({}, CONTEXT)).rejects.toMatchObject({
      code: 'data-loss',
      message: 'Profile directory state is unavailable.',
    });
  });

  test('a commit failure leaves no partial state and returns a fixed unknown-outcome error', async () => {
    const harness = createFirestoreHarness({}, { failCommit: true });
    await expect(setMyMemberDirectoryVisibility(visibilityRequest(), CONTEXT))
      .rejects.toMatchObject({
        code: 'internal',
        message: 'Profile directory update could not be confirmed. Reload before trying again.',
      });
    expect(harness.store.size).toBe(0);
  });

  test('no callable logs request, name, image, or provider error canaries', async () => {
    const spies = ['debug', 'error', 'info', 'log', 'warn'].map((method) => (
      jest.spyOn(console, method).mockImplementation(() => undefined)
    ));
    try {
      createFirestoreHarness({}, { failCommit: true });
      await expect(setMyMemberDirectoryVisibility(visibilityRequest(), CONTEXT)).rejects
        .toMatchObject({ code: 'internal' });
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
});
