'use strict';

// INSTAGRAM-002C (PROTOTYPE — not yet wired into index.js) approval-gated
// social-post command entry point.
//
// One authenticated callable that runs a single officer command against one
// social post inside a Firestore transaction, using the INSTAGRAM-002A reducer
// (`socialPostState.js`, §8.7) and the INSTAGRAM-002B plan builder
// (`socialPostStore.js`). The browser presents only the command it wants; this
// endpoint derives the actor from the verified session, applies the reducer's
// decision, and appends one audit row -- all as one server-authoritative
// operation. It publishes nothing and touches no provider.
//
// Capability model (interim): the only officer identity that exists today is a
// verified `admin` custom claim, so this endpoint requires that and then
// accepts any of the reducer's *officer* capabilities from the request,
// validated against an allowlist. AUTH-003 replaces "any verified admin may
// present any officer capability" with scoped per-actor grants. System
// capabilities (`system_publisher`, `system_reconciler`) drive machine edges
// and are never accepted from a browser caller here; a worker entry point is a
// later slice.
//
// Wiring `runSocialPostCommand` into `functions/index.js` is the final step of
// the 002C pull request; this prototype is built and unit-tested but
// unexported from the runtime so 002A/002B stay "source only".

const admin = require('firebase-admin');
const { Timestamp } = require('firebase-admin/firestore');
const functions = require('firebase-functions');

const { requireAppCheck, requireAdmin } = require('./stripeHelpers');
const {
  SOCIAL_POST_COLLECTION,
  SOCIAL_POST_AUDIT_COLLECTION,
  socialPostStoreSchemaVersion,
  buildSocialPostPersistencePlan,
} = require('./socialPostStore');
const { socialPostSchemaVersion } = require('./socialPostState');

const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPAQUE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAXIMUM_REVISION = 1000000000;

const REQUEST_FIELDS = Object.freeze([
  'requestId',
  'postId',
  'sourceRef',
  'expectedRevision',
  'type',
  'expectedLifecycle',
  'payloadHash',
  'capability',
  'selfApprovalAllowed',
]);

// The reducer's officer capabilities. System capabilities are intentionally
// absent: a browser caller can never present one.
const OFFICER_CAPABILITIES = new Set([
  'officer_editor',
  'officer_reviewer',
  'officer_admin',
]);

// The record fields the reducer needs, read back from the stored post document.
const STORED_RECORD_FIELDS = Object.freeze([
  'socialPostSchemaVersion',
  'lifecycleStatus',
  'sourceKind',
  'payloadHash',
  'approvedHash',
  'authorActor',
  'approverActor',
]);

const INVALID_REQUEST_MESSAGE = 'Social post command is invalid.';
const POST_NOT_FOUND_MESSAGE = 'Social post not found.';
const STATE_UNAVAILABLE_MESSAGE = 'Social post state is unavailable.';
const OPERATION_UNAVAILABLE_MESSAGE =
  'Social post command could not be confirmed. Reload before trying again.';

class SocialPostCommandError extends Error {
  constructor(kind) {
    super(INVALID_REQUEST_MESSAGE);
    Object.defineProperty(this, 'name', { value: 'SocialPostCommandError' });
    Object.defineProperty(this, 'kind', { value: kind });
  }
}

function fail(kind) {
  throw new SocialPostCommandError(kind);
}

function isHttpsError(error) {
  return error instanceof functions.https.HttpsError;
}

// Strict own-data reader: exact keys, plain prototype, no accessor, no proxy.
function readExactObject(value, expectedFields) {
  if (value === null || typeof value !== 'object') fail('request');
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail('request');
  }
  if (prototype !== Object.prototype || keys.length !== expectedFields.length) fail('request');

  const expected = new Set(expectedFields);
  const data = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || !expected.has(key)) fail('request');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined) {
      fail('request');
    }
    data[key] = descriptor.value;
  }
  if (expectedFields.some((field) => !Object.prototype.hasOwnProperty.call(data, field))) {
    fail('request');
  }
  return data;
}

function isOpaqueIdentifier(value) {
  return typeof value === 'string' && OPAQUE_IDENTIFIER_PATTERN.test(value);
}

// Validate the client request. The actor is NOT read here -- it is always
// derived from the verified session by `serverActorFromContext`.
function readSocialPostCommandRequest(value) {
  const data = readExactObject(value, REQUEST_FIELDS);

  if (typeof data.requestId !== 'string' || !REQUEST_ID_PATTERN.test(data.requestId)) fail('request');
  if (!isOpaqueIdentifier(data.postId)) fail('request');
  if (!isOpaqueIdentifier(data.sourceRef)) fail('request');
  if (!Number.isSafeInteger(data.expectedRevision)
    || data.expectedRevision < 1
    || data.expectedRevision >= MAXIMUM_REVISION) {
    fail('request');
  }
  if (typeof data.type !== 'string' || data.type.length === 0 || data.type.length > 64) fail('request');
  if (typeof data.expectedLifecycle !== 'string'
    || data.expectedLifecycle.length === 0
    || data.expectedLifecycle.length > 64) {
    fail('request');
  }
  if (data.payloadHash !== null && !isOpaqueIdentifier(data.payloadHash)) fail('request');
  if (!OFFICER_CAPABILITIES.has(data.capability)) fail('capability');
  if (typeof data.selfApprovalAllowed !== 'boolean') fail('request');

  return Object.freeze({
    requestId: data.requestId,
    postId: data.postId,
    sourceRef: data.sourceRef,
    expectedRevision: data.expectedRevision,
    type: data.type,
    expectedLifecycle: data.expectedLifecycle,
    payloadHash: data.payloadHash,
    capability: data.capability,
    selfApprovalAllowed: data.selfApprovalAllowed,
  });
}

// The opaque actor token for the audit trail: the verified caller's uid,
// namespaced so it can never collide with a system worker identifier.
function serverActorFromContext(context) {
  const uid = context && context.auth && context.auth.uid;
  if (typeof uid !== 'string' || !isOpaqueIdentifier(uid)) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required.');
  }
  return `officer:${uid}`;
}

// Read one stored social post document into the reducer's durable record shape,
// or throw. Creating the initial draft is a separate slice; this endpoint only
// advances an existing post.
function mapStoredSocialPost(snapshotData) {
  if (snapshotData === null || typeof snapshotData !== 'object') fail('stored');
  const record = {};
  for (const field of STORED_RECORD_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(snapshotData, field)) fail('stored');
    record[field] = snapshotData[field];
  }
  if (record.socialPostSchemaVersion !== socialPostSchemaVersion) fail('stored');
  return record;
}

// Map a reducer rejection reason to a client-safe HttpsError.
function mapReducerReasonToHttpsError(reason) {
  switch (reason) {
    case 'state_conflict':
    case 'stale_approval':
      return new functions.https.HttpsError(
        'aborted',
        'Social post changed. Reload before trying again.',
      );
    case 'capability_forbidden':
    case 'self_approval_forbidden':
      return new functions.https.HttpsError('permission-denied', 'Not permitted.');
    case 'transition_forbidden':
      return new functions.https.HttpsError('failed-precondition', 'That change is not allowed now.');
    case 'invalid_record':
      return new functions.https.HttpsError('data-loss', STATE_UNAVAILABLE_MESSAGE);
    default:
      return new functions.https.HttpsError('invalid-argument', INVALID_REQUEST_MESSAGE);
  }
}

function mapRequestError(error) {
  if (isHttpsError(error)) return error;
  if (error instanceof SocialPostCommandError && error.kind === 'capability') {
    return new functions.https.HttpsError('permission-denied', 'Not permitted.');
  }
  if (error instanceof SocialPostCommandError && error.kind === 'stored') {
    return new functions.https.HttpsError('data-loss', STATE_UNAVAILABLE_MESSAGE);
  }
  if (error instanceof SocialPostCommandError) {
    return new functions.https.HttpsError('invalid-argument', INVALID_REQUEST_MESSAGE);
  }
  return new functions.https.HttpsError('internal', OPERATION_UNAVAILABLE_MESSAGE);
}

async function applySocialPostCommand(request, actor) {
  const db = admin.firestore();
  const postRef = db.collection(SOCIAL_POST_COLLECTION).doc(request.postId);
  const nextRevision = request.expectedRevision + 1;
  const auditRef = db
    .collection(SOCIAL_POST_AUDIT_COLLECTION)
    .doc(`social_post_${request.postId}_${String(nextRevision).padStart(10, '0')}`);

  try {
    return await db.runTransaction(async (transaction) => {
      const [postSnapshot, auditSnapshot] = await Promise.all([
        transaction.get(postRef),
        transaction.get(auditRef),
      ]);
      if (!postSnapshot.exists) {
        throw new functions.https.HttpsError('not-found', POST_NOT_FOUND_MESSAGE);
      }

      const storedData = postSnapshot.data();
      const current = mapStoredSocialPost(storedData);
      const command = {
        socialPostSchemaVersion,
        type: request.type,
        expectedLifecycle: request.expectedLifecycle,
        payloadHash: request.payloadHash,
        actor,
        capability: request.capability,
        selfApprovalAllowed: request.selfApprovalAllowed,
      };

      const plan = buildSocialPostPersistencePlan({
        socialPostStoreSchemaVersion,
        postId: request.postId,
        sourceRef: request.sourceRef,
        expectedRevision: request.expectedRevision,
        correlationId: request.requestId,
        auditInstant: new Date().toISOString(),
        current,
        command,
      });

      if (plan.outcome === 'rejected' && plan.reason === 'invalid_store_input') {
        throw new functions.https.HttpsError('internal', OPERATION_UNAVAILABLE_MESSAGE);
      }
      if (plan.outcome === 'rejected') {
        throw mapReducerReasonToHttpsError(plan.reducerReason);
      }
      if (plan.outcome === 'unchanged') {
        return Object.freeze({
          ok: true,
          postId: request.postId,
          revision: storedData.revision,
          lifecycleStatus: current.lifecycleStatus,
          idempotent: true,
        });
      }

      // Applied: assert the optimistic-concurrency fence, then apply once.
      if (storedData.revision !== request.expectedRevision) {
        throw new functions.https.HttpsError(
          'aborted',
          'Social post changed. Reload before trying again.',
        );
      }
      const [postWrite, auditWrite] = plan.writes;
      if (auditSnapshot.exists) {
        // A retry of an already-applied command. The write is settled.
        return Object.freeze({
          ok: true,
          postId: request.postId,
          revision: postWrite.data.revision,
          lifecycleStatus: postWrite.data.lifecycleStatus,
          idempotent: true,
        });
      }

      transaction.update(postRef, postWrite.data);
      transaction.create(auditRef, {
        ...auditWrite.data,
        actorUid: actor,
        occurredAt: Timestamp.now(),
      });

      return Object.freeze({
        ok: true,
        postId: request.postId,
        revision: postWrite.data.revision,
        lifecycleStatus: postWrite.data.lifecycleStatus,
        idempotent: false,
      });
    });
  } catch (error) {
    if (isHttpsError(error)) throw error;
    throw new functions.https.HttpsError('internal', OPERATION_UNAVAILABLE_MESSAGE);
  }
}

const runSocialPostCommand = functions
  .runWith({ enforceAppCheck: true })
  .https.onCall(async (data, context) => {
    requireAppCheck(context);
    await requireAdmin(context);
    const actor = serverActorFromContext(context);

    let request;
    try {
      request = readSocialPostCommandRequest(data);
    } catch (error) {
      throw mapRequestError(error);
    }

    return applySocialPostCommand(request, actor);
  });

module.exports = Object.freeze({
  SocialPostCommandError,
  readSocialPostCommandRequest,
  serverActorFromContext,
  mapStoredSocialPost,
  mapReducerReasonToHttpsError,
  isHttpsError,
  runSocialPostCommand,
});
