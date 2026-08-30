'use strict';

// INSTAGRAM-002C prototype tests. Pure request/mapping helpers plus the
// transaction body driven through a mocked Firestore. A real emulator
// concurrency test (parallel retries apply once) is part of the 002C pull
// request, not this prototype.

jest.mock('firebase-functions', () => {
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  return {
    https: { HttpsError },
    runWith: jest.fn(() => ({
      https: { onCall: jest.fn((handler) => handler) },
    })),
  };
});

const mockTxnState = { store: new Map(), updates: [], creates: [] };

jest.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: (name) => ({
      doc: (id) => ({ path: `${name}/${id}`, _name: name, _id: id }),
    }),
    runTransaction: async (fn) => fn({
      get: async (ref) => ({
        exists: mockTxnState.store.has(ref.path),
        data: () => mockTxnState.store.get(ref.path),
      }),
      update: (ref, data) => mockTxnState.updates.push({ path: ref.path, data }),
      create: (ref, data) => mockTxnState.creates.push({ path: ref.path, data }),
    }),
  }),
}));

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: { now: () => ({ _seconds: 1756566245, _nanoseconds: 0 }) },
}));

jest.mock('./stripeHelpers', () => ({
  requireAppCheck: jest.fn(),
  requireAdmin: jest.fn(async () => {}),
}));

const functions = require('firebase-functions');
const {
  SocialPostCommandError,
  readSocialPostCommandRequest,
  serverActorFromContext,
  mapStoredSocialPost,
  mapReducerReasonToHttpsError,
  runSocialPostCommand,
} = require('./socialPostCommand');

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const POST_ID = 'post_abc123';
const SOURCE_REF = 'event_2026.r4';
const AUTHOR = 'officer:uid_author';

function request(overrides = {}) {
  return {
    requestId: REQUEST_ID,
    postId: POST_ID,
    sourceRef: SOURCE_REF,
    expectedRevision: 4,
    type: 'submit',
    expectedLifecycle: 'draft',
    payloadHash: null,
    capability: 'officer_editor',
    selfApprovalAllowed: false,
    ...overrides,
  };
}

function storedPost(overrides = {}) {
  return {
    socialPostStoreSchemaVersion: 1,
    socialPostSchemaVersion: 1,
    revision: 4,
    lifecycleStatus: 'draft',
    sourceKind: 'public_event',
    payloadHash: 'hash_v1',
    approvedHash: null,
    authorActor: AUTHOR,
    approverActor: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockTxnState.store = new Map();
  mockTxnState.updates = [];
  mockTxnState.creates = [];
});

describe('readSocialPostCommandRequest', () => {
  test('accepts a well-formed request and returns a frozen projection', () => {
    const parsed = readSocialPostCommandRequest(request());
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(parsed).toEqual(request());
    expect(parsed).not.toHaveProperty('actor');
  });

  const BAD = [
    ['non-object', 'x'],
    ['null', null],
    ['bad requestId', request({ requestId: 'not-a-uuid' })],
    ['empty postId', request({ postId: '' })],
    ['postId with space', request({ postId: 'post abc' })],
    ['zero expectedRevision', request({ expectedRevision: 0 })],
    ['fractional expectedRevision', request({ expectedRevision: 1.5 })],
    ['over-cap expectedRevision', request({ expectedRevision: 1000000000 })],
    ['type too long', request({ type: 'x'.repeat(65) })],
    ['non-boolean selfApprovalAllowed', request({ selfApprovalAllowed: 'yes' })],
    ['extra key', { ...request(), actor: 'officer:evil' }],
    ['missing key', (() => { const r = request(); delete r.capability; return r; })()],
  ];
  test.each(BAD)('rejects %s', (_label, value) => {
    expect(() => readSocialPostCommandRequest(value)).toThrow(SocialPostCommandError);
  });

  test('a system capability from a browser caller is rejected', () => {
    expect(() => readSocialPostCommandRequest(request({ capability: 'system_publisher' })))
      .toThrow(SocialPostCommandError);
  });
});

describe('serverActorFromContext', () => {
  test('derives a namespaced officer actor from the verified uid', () => {
    expect(serverActorFromContext({ auth: { uid: 'uid_author' } })).toBe('officer:uid_author');
  });
  test('throws unauthenticated when there is no uid', () => {
    for (const ctx of [undefined, {}, { auth: {} }, { auth: { uid: 42 } }]) {
      expect(() => serverActorFromContext(ctx)).toThrow(functions.https.HttpsError);
    }
  });
});

describe('mapStoredSocialPost', () => {
  test('projects the reducer record fields from a full stored document', () => {
    expect(mapStoredSocialPost(storedPost())).toEqual({
      socialPostSchemaVersion: 1,
      lifecycleStatus: 'draft',
      sourceKind: 'public_event',
      payloadHash: 'hash_v1',
      approvedHash: null,
      authorActor: AUTHOR,
      approverActor: null,
    });
  });
  test('throws when a record field is missing', () => {
    const partial = storedPost();
    delete partial.authorActor;
    expect(() => mapStoredSocialPost(partial)).toThrow(SocialPostCommandError);
  });
  test('throws on a wrong schema version', () => {
    expect(() => mapStoredSocialPost(storedPost({ socialPostSchemaVersion: 2 })))
      .toThrow(SocialPostCommandError);
  });
});

describe('mapReducerReasonToHttpsError', () => {
  test.each([
    ['state_conflict', 'aborted'],
    ['stale_approval', 'aborted'],
    ['capability_forbidden', 'permission-denied'],
    ['self_approval_forbidden', 'permission-denied'],
    ['transition_forbidden', 'failed-precondition'],
    ['invalid_record', 'data-loss'],
    ['something_else', 'invalid-argument'],
  ])('%s -> %s', (reason, code) => {
    expect(mapReducerReasonToHttpsError(reason).code).toBe(code);
  });
});

describe('runSocialPostCommand (mocked transaction)', () => {
  const context = { auth: { uid: 'uid_author' }, app: {} };

  test('applies a valid submit: one post update and one appended audit row', async () => {
    mockTxnState.store.set(`socialPosts/${POST_ID}`, storedPost());

    const result = await runSocialPostCommand(request(), context);

    expect(result).toEqual({
      ok: true,
      postId: POST_ID,
      revision: 5,
      lifecycleStatus: 'pending_review',
      idempotent: false,
    });
    expect(mockTxnState.updates).toHaveLength(1);
    expect(mockTxnState.updates[0].data.lifecycleStatus).toBe('pending_review');
    expect(mockTxnState.updates[0].data.revision).toBe(5);
    expect(mockTxnState.creates).toHaveLength(1);
    expect(mockTxnState.creates[0].path).toBe(`auditEvents/social_post_${POST_ID}_0000000005`);
    expect(mockTxnState.creates[0].data.eventType).toBe('social_post_submitted');
    expect(mockTxnState.creates[0].data.actorUid).toBe('officer:uid_author');
    expect(mockTxnState.creates[0].data.occurredAt).toBeDefined();
  });

  test('missing post document -> not-found, no writes', async () => {
    await expect(runSocialPostCommand(request(), context)).rejects.toMatchObject({ code: 'not-found' });
    expect(mockTxnState.updates).toHaveLength(0);
    expect(mockTxnState.creates).toHaveLength(0);
  });

  test('reducer rejection (wrong capability for approve) -> failed-precondition, no writes', async () => {
    mockTxnState.store.set(`socialPosts/${POST_ID}`, storedPost());
    await expect(runSocialPostCommand(
      request({ type: 'approve', capability: 'officer_editor', payloadHash: 'hash_v1' }),
      context,
    )).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(mockTxnState.updates).toHaveLength(0);
  });

  test('stale expectedRevision -> aborted, no writes', async () => {
    mockTxnState.store.set(`socialPosts/${POST_ID}`, storedPost({ revision: 9 }));
    await expect(runSocialPostCommand(request({ expectedRevision: 4, expectedLifecycle: 'draft' }), context))
      .rejects.toMatchObject({ code: 'aborted' });
    expect(mockTxnState.updates).toHaveLength(0);
  });

  test('an already-applied command is an idempotent no-write replay', async () => {
    mockTxnState.store.set(`socialPosts/${POST_ID}`, storedPost());
    mockTxnState.store.set(`auditEvents/social_post_${POST_ID}_0000000005`, { eventType: 'social_post_submitted' });

    const result = await runSocialPostCommand(request(), context);

    expect(result.idempotent).toBe(true);
    expect(result.lifecycleStatus).toBe('pending_review');
    expect(mockTxnState.updates).toHaveLength(0);
    expect(mockTxnState.creates).toHaveLength(0);
  });

  test('idempotent cancel of an already-cancelled post -> unchanged, no writes', async () => {
    mockTxnState.store.set(`socialPosts/${POST_ID}`, storedPost({ lifecycleStatus: 'cancelled', revision: 4 }));

    const result = await runSocialPostCommand(request({
      type: 'cancel', expectedLifecycle: 'cancelled', capability: 'officer_reviewer',
    }), context);

    expect(result).toMatchObject({ ok: true, idempotent: true, lifecycleStatus: 'cancelled' });
    expect(mockTxnState.updates).toHaveLength(0);
    expect(mockTxnState.creates).toHaveLength(0);
  });
});

describe('source note', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  test('prototype is not yet wired into the functions runtime entry point', () => {
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toContain('socialPostCommand');
  });
});
