const { types: { isProxy } } = require('node:util');

// INSTAGRAM-002A approval-gated social-post lifecycle and audit-safe state.
//
// Pure, source-only, unused. A provider-neutral reducer for the lifecycle of an
// approved-before-published social post: given one durable post record and one
// server command, decide whether the transition is allowed and produce the next
// audit-safe record projection -- or a fixed rejection reason.
//
// Safety model:
//   * Human approval is mandatory before publish and is bound to an exact
//     canonical payload hash. Approving records `approvedHash := payloadHash`;
//     ANY edit mints a new `payloadHash` and clears the approval. Every edge
//     that advances toward publication (schedule, begin_publish, retry) requires
//     a CURRENT approval whose hash equals the record's payload hash, so a stale
//     approval can never authorize a publish. No path reaches `published`
//     without a recorded approval matching the published payload.
//   * Scoped verified identity. Every command is issued under a closed server
//     capability. Officer capabilities drive human edges (submit, edit, approve,
//     reject, schedule, cancel); system capabilities drive machine edges
//     (begin_publish, provider result, retry, reconcile). A client can never
//     present a system capability, so a client can never write provider or audit
//     state. Self-approval is an explicit owner policy, fail-closed.
//   * Audit-safe by construction. The record and every verdict carry only
//     opaque hashes, closed enums, and opaque capability-scoped actor
//     identifiers -- never a caption, media reference, alt text, URL, or request
//     body. The verdict is exactly the shape an append-oriented audit entry may
//     store. Only a public-event source may become a draft; membership,
//     discount, and other protected sources have no representation here.
//   * Optimistic concurrency. A command names the lifecycle it believes current;
//     a mismatch is a `state_conflict`, so a duplicate or concurrent command
//     cannot double-apply. A cancel of an already-cancelled post is idempotent.
//
// The canonical payload hash is computed by the caller from the canonical
// content; this contract only binds and compares it by equality, never computes
// it. No runtime path imports this module. It reads no clock, randomness,
// network, environment, or provider; it logs nothing and persists nothing.

const socialPostSchemaVersion = 1;

// Opaque identifier for payload hashes and capability-scoped actor references:
// unreserved characters only, bounded length. Never a name, email, address, or
// other contact detail -- an opaque server-minted reference.
const OPAQUE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function immutableEnum(values) {
  return Object.freeze(Object.fromEntries(values.map((value) => [
    value.toUpperCase(),
    value,
  ])));
}

// The versioned post lifecycle. Publication is reachable only through the
// approval-gated middle; failed/outcome_unknown are the provider-result
// branches; published and cancelled are terminal.
const SocialPostLifecycle = immutableEnum([
  'draft',
  'pending_review',
  'approved',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'outcome_unknown',
  'cancelled',
]);

const LIFECYCLE_SET = new Set(Object.values(SocialPostLifecycle));

// Closed command vocabulary. Human commands carry an actor; system commands do
// not. Each maps to exactly one target lifecycle state.
const SocialPostCommandType = immutableEnum([
  'submit',
  'edit',
  'approve',
  'reject',
  'schedule',
  'begin_publish',
  'provider_confirmed',
  'provider_failed',
  'provider_indeterminate',
  'retry',
  'reconciled_published',
  'reconciled_failed',
  'cancel',
]);

const COMMAND_TYPE_SET = new Set(Object.values(SocialPostCommandType));

// Closed server capability vocabulary. Officer capabilities are exercised by a
// verified human; system capabilities by a verified server worker. A browser
// client can present neither a system capability nor forge an officer one.
const SocialPostCapability = immutableEnum([
  'officer_editor',
  'officer_reviewer',
  'officer_admin',
  'system_publisher',
  'system_reconciler',
]);

const CAPABILITY_SET = new Set(Object.values(SocialPostCapability));
const SYSTEM_CAPABILITIES = new Set(['system_publisher', 'system_reconciler']);

// Only an intentionally public event may become a draft. Membership, discount,
// messaging, and activity sources have no representation here at all.
const SocialPostSource = immutableEnum(['public_event']);
const SOURCE_SET = new Set(Object.values(SocialPostSource));

const EDITOR_CAPABILITIES = new Set(['officer_editor', 'officer_admin']);
const REVIEWER_CAPABILITIES = new Set(['officer_reviewer', 'officer_admin']);

// Per command: the states it may leave, the single state it enters, the allowed
// capability set, whether it is a human (actor-bearing) or system command, and
// how it touches approval. The "no publish without a current approval" property
// is a record invariant (see validateSocialPostRecord), not a per-edge gate, so
// no command needs a separate approval flag.
const COMMANDS = Object.freeze({
  submit: commandSpec(['draft'], 'pending_review', EDITOR_CAPABILITIES, 'human', 'preserve'),
  edit: commandSpec(
    ['draft', 'pending_review', 'approved', 'scheduled'],
    'draft', EDITOR_CAPABILITIES, 'human', 'reset',
  ),
  approve: commandSpec(['pending_review'], 'approved', REVIEWER_CAPABILITIES, 'human', 'record'),
  reject: commandSpec(['pending_review'], 'draft', REVIEWER_CAPABILITIES, 'human', 'preserve'),
  schedule: commandSpec(['approved'], 'scheduled', REVIEWER_CAPABILITIES, 'human', 'preserve'),
  begin_publish: commandSpec(['scheduled'], 'publishing', publisherOnly(), 'system', 'preserve'),
  provider_confirmed: commandSpec(['publishing'], 'published', publisherOnly(), 'system', 'preserve'),
  provider_failed: commandSpec(['publishing'], 'failed', publisherOnly(), 'system', 'preserve'),
  provider_indeterminate: commandSpec(
    ['publishing'], 'outcome_unknown', publisherOnly(), 'system', 'preserve',
  ),
  retry: commandSpec(['failed'], 'scheduled', publisherOnly(), 'system', 'preserve'),
  reconciled_published: commandSpec(
    ['outcome_unknown'], 'published', reconcilerOnly(), 'system', 'preserve',
  ),
  reconciled_failed: commandSpec(
    ['outcome_unknown'], 'failed', reconcilerOnly(), 'system', 'preserve',
  ),
  cancel: commandSpec(
    ['draft', 'pending_review', 'approved', 'scheduled', 'failed', 'outcome_unknown'],
    'cancelled', REVIEWER_CAPABILITIES, 'human', 'preserve',
  ),
});

function commandSpec(from, to, capabilities, kind, approvalEffect) {
  return Object.freeze({
    from: new Set(from),
    to,
    capabilities,
    kind,
    approvalEffect,
  });
}

function publisherOnly() {
  return new Set(['system_publisher']);
}

function reconcilerOnly() {
  return new Set(['system_reconciler']);
}

// Lifecycle states that require a recorded, current approval to be coherent.
const APPROVED_LIFECYCLE = new Set([
  'approved',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'outcome_unknown',
]);
// Lifecycle states that must NOT carry any approval yet.
const UNAPPROVED_LIFECYCLE = new Set(['draft', 'pending_review']);

const EXPECTED_RECORD_KEYS = Object.freeze([
  'socialPostSchemaVersion',
  'lifecycleStatus',
  'sourceKind',
  'payloadHash',
  'approvedHash',
  'authorActor',
  'approverActor',
]);

const EXPECTED_COMMAND_KEYS = Object.freeze([
  'socialPostSchemaVersion',
  'type',
  'expectedLifecycle',
  'payloadHash',
  'actor',
  'capability',
  'selfApprovalAllowed',
]);

const FIXED_REASONS = Object.freeze({
  APPLIED: 'transition_applied',
  IDEMPOTENT: 'same_state_idempotent',
  FORBIDDEN: 'transition_forbidden',
  INVALID_RECORD: 'invalid_record',
  INVALID_COMMAND: 'invalid_command',
  STATE_CONFLICT: 'state_conflict',
  CAPABILITY_FORBIDDEN: 'capability_forbidden',
  STALE_APPROVAL: 'stale_approval',
  SELF_APPROVAL_FORBIDDEN: 'self_approval_forbidden',
});

function frozenReasons(reasons) {
  return Object.freeze([...new Set(reasons)].sort());
}

function isOpaqueIdentifier(value) {
  return typeof value === 'string' && OPAQUE_IDENTIFIER_PATTERN.test(value);
}

function isNullableIdentifier(value) {
  return value === null || isOpaqueIdentifier(value);
}

// Strict own-data reader: rejects a proxy, a non-plain prototype, an accessor,
// a non-enumerable own field, an inherited field, and any extra key. Returns a
// Map of own string keys to plain data values, or null. Never invokes a getter.
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

function readExactRecord(value, expectedKeys) {
  const entries = safeOwnData(value, expectedKeys.length);
  if (!entries
    || entries.size !== expectedKeys.length
    || !expectedKeys.every((key) => entries.has(key))) {
    return null;
  }
  return entries;
}

function validationResult(accepted, status, reasons, projection) {
  return Object.freeze({
    accepted,
    status,
    reasons: frozenReasons(reasons),
    projection,
  });
}

// Validate the durable post record shape and its approval/lifecycle coherence.
// A stale stored approval (approvedHash that does not equal payloadHash) is
// incoherent and rejected: an edit must have cleared it. Approval hash and
// approver actor always travel together.
function validateSocialPostRecord(candidate) {
  const entries = readExactRecord(candidate, EXPECTED_RECORD_KEYS);
  if (!entries) {
    return validationResult(false, 'rejected', [FIXED_REASONS.INVALID_RECORD], null);
  }

  const record = {
    socialPostSchemaVersion: entries.get('socialPostSchemaVersion'),
    lifecycleStatus: entries.get('lifecycleStatus'),
    sourceKind: entries.get('sourceKind'),
    payloadHash: entries.get('payloadHash'),
    approvedHash: entries.get('approvedHash'),
    authorActor: entries.get('authorActor'),
    approverActor: entries.get('approverActor'),
  };

  if (record.socialPostSchemaVersion !== socialPostSchemaVersion
    || !LIFECYCLE_SET.has(record.lifecycleStatus)
    || !SOURCE_SET.has(record.sourceKind)
    || !isOpaqueIdentifier(record.payloadHash)
    || !isOpaqueIdentifier(record.authorActor)
    || !isNullableIdentifier(record.approvedHash)
    || !isNullableIdentifier(record.approverActor)) {
    return validationResult(false, 'rejected', [FIXED_REASONS.INVALID_RECORD], null);
  }

  const hasApproval = record.approvedHash !== null;
  const coherent =
    // Approval hash and approver actor are present together or absent together.
    hasApproval === (record.approverActor !== null)
    // A stored approval is never stale: it always names the current payload.
    && (!hasApproval || record.approvedHash === record.payloadHash)
    // Pre-approval states carry no approval; post-approval states carry one.
    && (!UNAPPROVED_LIFECYCLE.has(record.lifecycleStatus) || !hasApproval)
    && (!APPROVED_LIFECYCLE.has(record.lifecycleStatus) || hasApproval);

  if (!coherent) {
    return validationResult(false, 'rejected', [FIXED_REASONS.INVALID_RECORD], null);
  }

  return validationResult(true, 'valid', [], Object.freeze({ ...record }));
}

function readCommand(candidate) {
  const entries = readExactRecord(candidate, EXPECTED_COMMAND_KEYS);
  if (!entries) return null;

  const command = {
    socialPostSchemaVersion: entries.get('socialPostSchemaVersion'),
    type: entries.get('type'),
    expectedLifecycle: entries.get('expectedLifecycle'),
    payloadHash: entries.get('payloadHash'),
    actor: entries.get('actor'),
    capability: entries.get('capability'),
    selfApprovalAllowed: entries.get('selfApprovalAllowed'),
  };

  if (command.socialPostSchemaVersion !== socialPostSchemaVersion
    || !COMMAND_TYPE_SET.has(command.type)
    || !LIFECYCLE_SET.has(command.expectedLifecycle)
    || !isNullableIdentifier(command.payloadHash)
    || !isNullableIdentifier(command.actor)
    || !CAPABILITY_SET.has(command.capability)
    || typeof command.selfApprovalAllowed !== 'boolean') {
    return null;
  }
  return command;
}

function verdict(fields) {
  return Object.freeze({
    accepted: false,
    outcome: 'rejected',
    changed: false,
    lifecycleStatus: null,
    payloadHash: null,
    approvedHash: null,
    approverActor: null,
    approvalRecorded: false,
    approvalCleared: false,
    reason: FIXED_REASONS.INVALID_COMMAND,
    ...fields,
  });
}

function rejectAs(record, reason) {
  return verdict({
    lifecycleStatus: record.lifecycleStatus,
    payloadHash: record.payloadHash,
    approvedHash: record.approvedHash,
    approverActor: record.approverActor,
    reason,
  });
}

// Reduce (current record, command) to a frozen verdict. Never throws, never
// echoes raw input. The verdict's record fields are the exact next durable
// record the caller should persist, and the whole verdict is audit-safe.
function classifySocialPostTransition(current, command) {
  const validation = validateSocialPostRecord(current);
  if (!validation.accepted) {
    return verdict({ reason: FIXED_REASONS.INVALID_RECORD });
  }
  const record = validation.projection;

  const cmd = readCommand(command);
  if (!cmd) {
    return rejectAs(record, FIXED_REASONS.INVALID_COMMAND);
  }

  const spec = COMMANDS[cmd.type];

  // Idempotent cancellation: cancelling an already-cancelled post that the
  // caller also believes cancelled is a settled no-op, not a conflict.
  if (cmd.type === 'cancel'
    && record.lifecycleStatus === 'cancelled'
    && cmd.expectedLifecycle === 'cancelled') {
    return verdict({
      accepted: true,
      outcome: 'unchanged',
      lifecycleStatus: record.lifecycleStatus,
      payloadHash: record.payloadHash,
      approvedHash: record.approvedHash,
      approverActor: record.approverActor,
      reason: FIXED_REASONS.IDEMPOTENT,
    });
  }

  // Optimistic concurrency: the command must be formed against the true current
  // state. A mismatch is a duplicate or concurrent command.
  if (cmd.expectedLifecycle !== record.lifecycleStatus) {
    return rejectAs(record, FIXED_REASONS.STATE_CONFLICT);
  }

  // Impossible transition.
  if (!spec.from.has(record.lifecycleStatus)) {
    return rejectAs(record, FIXED_REASONS.FORBIDDEN);
  }

  // Scoped verified identity: allowed capability, and actor presence matching
  // the command kind (human commands bear an actor; system commands do not).
  const systemCapability = SYSTEM_CAPABILITIES.has(cmd.capability);
  const actorPresent = cmd.actor !== null;
  if (!spec.capabilities.has(cmd.capability)
    || (spec.kind === 'human' && (systemCapability || !actorPresent))
    || (spec.kind === 'system' && (!systemCapability || actorPresent))) {
    return rejectAs(record, FIXED_REASONS.CAPABILITY_FORBIDDEN);
  }

  // Per-command payload-hash coherence.
  if (cmd.type === 'edit') {
    // An edit must supply a new, different canonical payload hash.
    if (!isOpaqueIdentifier(cmd.payloadHash) || cmd.payloadHash === record.payloadHash) {
      return rejectAs(record, FIXED_REASONS.INVALID_COMMAND);
    }
  } else if (cmd.type === 'approve') {
    // An approval must name the exact current payload; approving anything else
    // is a stale approval attempt.
    if (!isOpaqueIdentifier(cmd.payloadHash)) {
      return rejectAs(record, FIXED_REASONS.INVALID_COMMAND);
    }
    if (cmd.payloadHash !== record.payloadHash) {
      return rejectAs(record, FIXED_REASONS.STALE_APPROVAL);
    }
  } else if (cmd.payloadHash !== null) {
    // Every other command carries no payload hash.
    return rejectAs(record, FIXED_REASONS.INVALID_COMMAND);
  }

  // Self-approval is an explicit owner policy, fail-closed. A valid `approved`,
  // `scheduled`, `publishing`, or `published` record already carries a current
  // approval bound to its payload (validateSocialPostRecord), so publication is
  // unreachable without one; no separate advancing-edge gate is needed.
  if (cmd.type === 'approve'
    && cmd.actor === record.authorActor
    && cmd.selfApprovalAllowed !== true) {
    return rejectAs(record, FIXED_REASONS.SELF_APPROVAL_FORBIDDEN);
  }

  return applyTransition(record, cmd, spec);
}

function applyTransition(record, cmd, spec) {
  let payloadHash = record.payloadHash;
  let approvedHash = record.approvedHash;
  let approverActor = record.approverActor;
  let approvalRecorded = false;
  let approvalCleared = false;

  if (spec.approvalEffect === 'reset') {
    // An edit mints a new canonical payload and invalidates any approval.
    payloadHash = cmd.payloadHash;
    if (approvedHash !== null) approvalCleared = true;
    approvedHash = null;
    approverActor = null;
  } else if (spec.approvalEffect === 'record') {
    approvedHash = record.payloadHash;
    approverActor = cmd.actor;
    approvalRecorded = true;
  }

  return verdict({
    accepted: true,
    outcome: 'applied',
    changed: true,
    lifecycleStatus: spec.to,
    payloadHash,
    approvedHash,
    approverActor,
    approvalRecorded,
    approvalCleared,
    reason: FIXED_REASONS.APPLIED,
  });
}

module.exports = Object.freeze({
  socialPostSchemaVersion,
  SocialPostLifecycle,
  SocialPostCommandType,
  SocialPostCapability,
  SocialPostSource,
  validateSocialPostRecord,
  classifySocialPostTransition,
});
