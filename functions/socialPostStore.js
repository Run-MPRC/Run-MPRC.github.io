const { types: { isProxy } } = require('node:util');

const {
  socialPostSchemaVersion,
  classifySocialPostTransition,
} = require('./socialPostState');

// INSTAGRAM-002B approval-gated social-post persistence-plan builder.
//
// Pure, source-only, unused. Given the current durable post record, one server
// command, and the store envelope that names the revision the caller believes
// current, compose the INSTAGRAM-002A `classifySocialPostTransition` reducer
// (§8.7) into a deterministic PERSISTENCE PLAN: the exact ordered writes a
// caller's single Firestore transaction should apply -- the next
// `socialPosts/{postId}` document and one appended append-only `auditEvents`
// entry -- plus the optimistic-concurrency precondition that transaction must
// assert. It performs no I/O of its own.
//
// Safety model:
//   * The reducer owns every lifecycle, capability, approval, and concurrency
//     decision. This builder never second-guesses it: a rejected verdict yields
//     zero writes and the reducer's own fixed reason; an idempotent no-op
//     (`unchanged`) yields zero writes; only an applied transition yields a
//     plan. No transition rule, capability rule, or approval rule lives here.
//   * Audit-safe by construction. The plan holds only opaque identifiers,
//     closed enums, revision integers, and the reducer's own audit-safe verdict
//     fields -- never a caption, media reference, alt text, URL, timezone,
//     disclosure flag, recipient, or request body. A hostile extra field on any
//     input is rejected by a fixed reason that never echoes it.
//   * Retry-safe by construction. The appended audit document's id is a
//     deterministic function of the post id and the next revision, so a
//     retried transaction collides on the same id instead of appending a second
//     audit row. The plan's precondition pins the exact revision the caller
//     read, so a concurrent writer that already advanced the post fails the
//     transaction rather than double-applying.
//   * Clock-free and additive. The caller stamps the transaction's server time;
//     this builder takes the audit instant as an opaque caller-supplied token
//     so its output is fully deterministic. Schema is additive by construction
//     (two `*SchemaVersion` constants) with no migration to run.
//
// No runtime path imports this module. It reads no clock, randomness, network,
// environment, Firestore, or provider service; it logs nothing and persists
// nothing. It defines no Firestore Rules and wires into no endpoint.

const socialPostStoreSchemaVersion = 1;
const socialPostAuditSchemaVersion = 1;

// Where an applied plan writes. The post document is server-owned; the audit
// trail reuses the shared server-only `auditEvents` collection with a
// `social_post` aggregate discriminator, matching the commerce and directory
// audit convention.
const SOCIAL_POST_COLLECTION = 'socialPosts';
const SOCIAL_POST_AUDIT_COLLECTION = 'auditEvents';
const SOCIAL_POST_AGGREGATE_TYPE = 'social_post';

// Opaque identifier for post ids, source references, correlation ids, and
// capability-scoped actor references: unreserved characters only, bounded
// length. Never a name, email, address, caption, or media reference.
const OPAQUE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

// The caller-supplied audit instant is treated as an opaque bounded token; this
// builder never parses or compares it, it only carries it into the audit row.
const AUDIT_INSTANT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.:_+-]{0,63}$/;

// A revision is a monotone counter. The cap is far above any real post history
// yet rejects a runaway or non-integer value.
const MAXIMUM_REVISION = 1000000000;

// One appended audit row per applied transition, keyed by post id and the next
// revision zero-padded to a fixed width so ids sort in application order and a
// retry reuses the same id.
const AUDIT_REVISION_DIGITS = 10;

// Each reducer command type maps to exactly one closed audit event type.
const AUDIT_EVENT_TYPE = Object.freeze({
  submit: 'social_post_submitted',
  edit: 'social_post_edited',
  approve: 'social_post_approved',
  reject: 'social_post_rejected',
  schedule: 'social_post_scheduled',
  begin_publish: 'social_post_publish_started',
  provider_confirmed: 'social_post_publish_confirmed',
  provider_failed: 'social_post_publish_failed',
  provider_indeterminate: 'social_post_publish_indeterminate',
  retry: 'social_post_publish_retried',
  reconciled_published: 'social_post_reconciled_published',
  reconciled_failed: 'social_post_reconciled_failed',
  cancel: 'social_post_cancelled',
});

const EXPECTED_INPUT_KEYS = Object.freeze([
  'socialPostStoreSchemaVersion',
  'postId',
  'sourceRef',
  'expectedRevision',
  'correlationId',
  'auditInstant',
  'current',
  'command',
]);

const FIXED_REASONS = Object.freeze({
  APPLIED: 'plan_built',
  NO_OP: 'no_write_needed',
  REDUCER_REJECTED: 'reducer_rejected',
  INVALID_INPUT: 'invalid_store_input',
});

function isOpaqueIdentifier(value) {
  return typeof value === 'string' && OPAQUE_IDENTIFIER_PATTERN.test(value);
}

function isRevision(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAXIMUM_REVISION;
}

// Strict own-data reader: rejects a proxy, a non-plain prototype, an accessor,
// a non-enumerable own field, an inherited field, and any extra or missing key.
// Never invokes a getter. Mirrors the reader in socialPostState.js.
function safeOwnData(value, maximumEntries) {
  if (value === null || typeof value !== 'object' || isProxy(value)) return null;

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (prototype !== Object.prototype || keys.length > maximumEntries) return null;

  const entries = new Map();
  for (const key of keys) {
    if (typeof key !== 'string') return null;
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return null;
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined) {
      return null;
    }
    entries.set(key, descriptor.value);
  }

  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return null;
  }
  return entries;
}

function readExactEnvelope(value) {
  const entries = safeOwnData(value, EXPECTED_INPUT_KEYS.length);
  if (!entries
    || entries.size !== EXPECTED_INPUT_KEYS.length
    || !EXPECTED_INPUT_KEYS.every((key) => entries.has(key))) {
    return null;
  }
  return entries;
}

function invalidPlan() {
  return Object.freeze({
    committed: false,
    outcome: 'rejected',
    reason: FIXED_REASONS.INVALID_INPUT,
    reducerReason: null,
    precondition: null,
    writes: Object.freeze([]),
  });
}

function noWritePlan(outcome, reducerReason) {
  return Object.freeze({
    committed: false,
    outcome,
    reason: FIXED_REASONS.NO_OP,
    reducerReason,
    precondition: null,
    writes: Object.freeze([]),
  });
}

function auditDocumentId(postId, nextRevision) {
  const suffix = String(nextRevision).padStart(AUDIT_REVISION_DIGITS, '0');
  return `${SOCIAL_POST_AGGREGATE_TYPE}_${postId}_${suffix}`;
}

// Reduce (current record, command, store envelope) to a frozen persistence
// plan. Never throws, never echoes raw input. Every result carries a builder
// `reason`, a `reducerReason` (the §8.7 reducer's fixed code, or `null` when
// the envelope never reached the reducer), a `precondition`, and `writes`:
//
//   * `reason: 'invalid_store_input'`, `outcome: 'rejected'` -- the envelope
//     itself is malformed; `reducerReason` is `null`, `writes` is empty.
//   * `reason: 'reducer_rejected'`, `outcome: 'rejected'` -- the reducer refused
//     the transition; `reducerReason` is its fixed code, `writes` is empty.
//   * `reason: 'no_write_needed'`, `outcome: 'unchanged'` -- the reducer settled
//     an idempotent no-op; `writes` is empty.
//   * `reason: 'plan_built'`, `outcome: 'applied'`, `committed: true` -- apply
//     `writes` ([post update, audit create]) in one transaction after asserting
//     `precondition`.
function buildSocialPostPersistencePlan(input) {
  const entries = readExactEnvelope(input);
  if (!entries) return invalidPlan();

  const envelope = {
    socialPostStoreSchemaVersion: entries.get('socialPostStoreSchemaVersion'),
    postId: entries.get('postId'),
    sourceRef: entries.get('sourceRef'),
    expectedRevision: entries.get('expectedRevision'),
    correlationId: entries.get('correlationId'),
    auditInstant: entries.get('auditInstant'),
    current: entries.get('current'),
    command: entries.get('command'),
  };

  if (envelope.socialPostStoreSchemaVersion !== socialPostStoreSchemaVersion
    || !isOpaqueIdentifier(envelope.postId)
    || !isOpaqueIdentifier(envelope.sourceRef)
    || !isRevision(envelope.expectedRevision)
    || !isOpaqueIdentifier(envelope.correlationId)
    || typeof envelope.auditInstant !== 'string'
    || !AUDIT_INSTANT_PATTERN.test(envelope.auditInstant)) {
    return invalidPlan();
  }

  // The reducer owns record- and command-shape validation. A well-formed
  // envelope with an invalid record or command still routes through the reducer
  // so its fixed reason is what the caller sees.
  const verdict = classifySocialPostTransition(envelope.current, envelope.command);

  if (!verdict.accepted) {
    return Object.freeze({
      committed: false,
      outcome: 'rejected',
      reason: FIXED_REASONS.REDUCER_REJECTED,
      reducerReason: verdict.reason,
      precondition: null,
      writes: Object.freeze([]),
    });
  }

  if (!verdict.changed) {
    return noWritePlan('unchanged', verdict.reason);
  }

  const commandType = envelope.command.type;
  const eventType = AUDIT_EVENT_TYPE[commandType];
  // Defensive: an accepted verdict always carries a known command type, but a
  // missing map entry must never produce an undefined audit event type.
  if (typeof eventType !== 'string') return invalidPlan();

  const nextRevision = envelope.expectedRevision + 1;
  if (!isRevision(nextRevision)) return invalidPlan();

  // The reducer already accepted `current`, so its `lifecycleStatus` is a valid
  // closed enum value; it is the state the applied transition moves away from.
  const priorLifecycle = envelope.current.lifecycleStatus;

  const postWrite = Object.freeze({
    collection: SOCIAL_POST_COLLECTION,
    docId: envelope.postId,
    op: 'update',
    data: Object.freeze({
      socialPostStoreSchemaVersion,
      socialPostSchemaVersion,
      revision: nextRevision,
      lifecycleStatus: verdict.lifecycleStatus,
      payloadHash: verdict.payloadHash,
      approvedHash: verdict.approvedHash,
      approverActor: verdict.approverActor,
    }),
  });

  const auditWrite = Object.freeze({
    collection: SOCIAL_POST_AUDIT_COLLECTION,
    docId: auditDocumentId(envelope.postId, nextRevision),
    op: 'create',
    data: Object.freeze({
      auditSchemaVersion: socialPostAuditSchemaVersion,
      aggregateType: SOCIAL_POST_AGGREGATE_TYPE,
      aggregateId: envelope.postId,
      sourceRef: envelope.sourceRef,
      revision: nextRevision,
      eventType,
      fromState: priorLifecycle,
      toState: verdict.lifecycleStatus,
      actor: envelope.command.actor,
      capability: envelope.command.capability,
      approvalRecorded: verdict.approvalRecorded,
      approvalCleared: verdict.approvalCleared,
      correlationId: envelope.correlationId,
      auditInstant: envelope.auditInstant,
    }),
  });

  return Object.freeze({
    committed: true,
    outcome: 'applied',
    reason: FIXED_REASONS.APPLIED,
    reducerReason: verdict.reason,
    precondition: Object.freeze({
      collection: SOCIAL_POST_COLLECTION,
      docId: envelope.postId,
      expectedRevision: envelope.expectedRevision,
    }),
    writes: Object.freeze([postWrite, auditWrite]),
  });
}

module.exports = Object.freeze({
  socialPostStoreSchemaVersion,
  socialPostAuditSchemaVersion,
  SOCIAL_POST_COLLECTION,
  SOCIAL_POST_AUDIT_COLLECTION,
  SOCIAL_POST_AGGREGATE_TYPE,
  buildSocialPostPersistencePlan,
});
