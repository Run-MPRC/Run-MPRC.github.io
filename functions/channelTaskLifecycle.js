const { types: { isProxy } } = require('node:util');

// CHANNEL-QUEUE-001C conservative safe-by-default channel-task lifecycle
// transition arbitration.
//
// Pure, source-only, unused. Given the durable record of one already-claimed
// channel-reconciliation task and one lifecycle command, deterministically
// decide whether the command may advance that task -- renew, release, complete,
// fail, or escalate -- and, if so, what the resulting task state is. It is the
// sibling of the claim-arbitration reducer (channelTaskClaim, the acquire step):
// that step decides who may take a task; this step governs the post-claim
// lifecycle, in the same non-throwing frozen-verdict idiom.
//
// Safety model:
//   * At most one active worker, across the whole lifecycle. A renew, release,
//     complete, or fail is honoured only for the current lease holder and only
//     while that lease is still live relative to the caller-supplied instant; a
//     command from anyone else is denied `not_lease_holder`, and a command whose
//     lease has already expired is denied `lease_expired`. A worker whose lease
//     lapsed can therefore never commit a result over a task that may have been
//     reassigned.
//   * Stale claims escalate safely, they are never silently completed. Only a
//     supervisor capability may `escalate`, and only a claim whose lease has
//     actually expired (a still-live lease is denied `lease_active`); escalation
//     clears the dead holder and moves the task to `escalated` for attention,
//     rather than letting a zombie worker resolve it.
//   * The result is sanitized by construction. A complete or fail carries only a
//     closed-enum `resultCode` (a fixed vocabulary of dispositions), never free
//     text, so no roster, contact detail, invite link, secret, or provider
//     payload can ride into the task record or a log through the outcome.
//   * Optimistic concurrency. The command names the status it believes current;
//     a mismatch is denied `state_conflict`, so a duplicate or out-of-order
//     command that observed a stale status never acts on a state it did not see.
//   * Point-in-time and clockless. Lease liveness is decided by lexical
//     comparison of fixed-width UTC instants -- lexical order equals
//     chronological order -- so the reducer reads no clock and constructs no
//     `Date`; the caller alone supplies the instant.
//   * False-negative-safe. A malformed or hostile task or command yields a
//     frozen denial verdict, never a throw and never a partial transition. Every
//     field of both records is read through an own-enumerable-data descriptor
//     with no getter invoked; a proxy, a foreign prototype, an inherited key, an
//     extra or missing key, an unknown enum, a wrong version, an out-of-range
//     value, an incoherent lease/holder pairing, or a command whose per-type
//     fields do not cohere is rejected.
//
// This contract owns the transition MECHANISM (may this command advance this
// task, and to what state), never the policy of which identities hold the worker
// or supervisor capability -- decided upstream -- the lease duration, which the
// caller sets as the new expiry, or what any disposition means downstream. It
// performs no provider action, writes no queue, persists no audit record, and
// grants nothing beyond the returned verdict. No runtime path imports this
// module. It reads no clock, randomness, network, environment, or provider; it
// logs nothing and persists nothing.

const channelTaskSchemaVersion = 1;

function immutableEnum(values) {
  return Object.freeze(Object.fromEntries(values.map((value) => [
    value.toUpperCase(),
    value,
  ])));
}

// The closed record allowlists. Exactly these keys, no more, no less. The task
// record is the same shape the claim step produces; the command adds the
// per-type `resultCode` the lifecycle needs.
const TASK_FIELDS = Object.freeze([
  'channelTaskSchemaVersion',
  'taskId',
  'status',
  'leaseHolder',
  'leaseExpiresAt',
]);
const COMMAND_FIELDS = Object.freeze([
  'channelTaskSchemaVersion',
  'type',
  'expectedStatus',
  'actor',
  'capability',
  'asOf',
  'leaseExpiresAt',
  'resultCode',
]);

// The closed set of task states. `claimed` is the only state a lifecycle command
// can advance; `pending` has no holder to act, `escalated` awaits attention, and
// `completed`/`failed` are terminal.
const TASK_STATUSES = Object.freeze(['pending', 'claimed', 'escalated', 'completed', 'failed']);
const TASK_STATUS_SET = new Set(TASK_STATUSES);
const TERMINAL_STATUSES = Object.freeze(['completed', 'failed']);
const TERMINAL_STATUS_SET = new Set(TERMINAL_STATUSES);

// The closed set of lifecycle transitions.
const TRANSITION_TYPES = Object.freeze(['renew', 'release', 'complete', 'fail', 'escalate']);
const TRANSITION_TYPE_SET = new Set(TRANSITION_TYPES);

// The closed decision and denial-reason vocabularies.
const TRANSITION_DECISIONS = Object.freeze(['granted', 'denied']);
const DENIAL_REASONS = Object.freeze([
  'malformed_task',
  'malformed_command',
  'unsupported_command',
  'capability_denied',
  'state_conflict',
  'terminal_state',
  'not_claimed',
  'not_lease_holder',
  'lease_expired',
  'lease_active',
  'invalid_lease',
]);

// The two closed capabilities. The worker capability may renew/release/complete/
// fail its own live claim; only the supervisor capability may escalate a stale
// one.
const WORKER_CAPABILITY = 'channel_operator';
const SUPERVISOR_CAPABILITY = 'channel_supervisor';
const REQUIRED_CAPABILITY = Object.freeze({
  renew: WORKER_CAPABILITY,
  release: WORKER_CAPABILITY,
  complete: WORKER_CAPABILITY,
  fail: WORKER_CAPABILITY,
  escalate: SUPERVISOR_CAPABILITY,
});

// The closed disposition vocabularies. A complete carries a success-class code;
// a fail carries a failure-class code. Both are fixed enums -- never free text --
// so the outcome cannot smuggle content into the record.
const COMPLETION_RESULTS = Object.freeze(['applied', 'already_current', 'manual_completed']);
const FAILURE_RESULTS = Object.freeze(['provider_outage', 'manual_action_required', 'not_supported', 'rejected']);
const COMPLETION_RESULT_SET = new Set(COMPLETION_RESULTS);
const FAILURE_RESULT_SET = new Set(FAILURE_RESULTS);
const ALL_RESULT_SET = new Set([...COMPLETION_RESULTS, ...FAILURE_RESULTS]);

const ChannelTaskStatus = immutableEnum(TASK_STATUSES);
const TransitionType = immutableEnum(TRANSITION_TYPES);
const TransitionDecision = immutableEnum(TRANSITION_DECISIONS);
const TransitionDenialReason = immutableEnum(DENIAL_REASONS);
const CompletionResult = immutableEnum(COMPLETION_RESULTS);
const FailureResult = immutableEnum(FAILURE_RESULTS);

// Task and actor identities are opaque, bounded, url-safe strings. They are not
// contact details; they carry no meaning to this module beyond identity and
// equality.
const TASK_ID_PATTERN = /^[A-Za-z0-9._-]{1,256}$/;
const ACTOR_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

// A UTC instant with second precision and a mandatory Z. Fixed width means
// lexical order equals chronological order; no clock or Date dependency.
const UTC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

// Pre-frozen denial verdicts. A denial carries only a decision and a reason and
// no input-derived data, so a single shared frozen object per reason is safe --
// it cannot leak, and it cannot be mutated.
const DENIALS = Object.freeze(Object.fromEntries(DENIAL_REASONS.map((reason) => [
  reason,
  Object.freeze({ decision: 'denied', reason }),
])));

function deny(reason) {
  return DENIALS[reason];
}

// A grant carries the advisory next task-state the caller should persist. The
// reducer itself persists nothing; `next` is a projection, not a write.
function grant(reason, next) {
  return Object.freeze({ decision: 'granted', reason, next: Object.freeze(next) });
}

function isTaskId(value) {
  return typeof value === 'string' && TASK_ID_PATTERN.test(value);
}

function isActorId(value) {
  return typeof value === 'string' && ACTOR_PATTERN.test(value);
}

function isUtcTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  return month >= 1 && month <= 12
    && day >= 1 && day <= 31
    && hour <= 23
    && minute <= 59
    && second <= 59;
}

// Read an exact-key record without invoking any getter. Returns a null-prototype
// copy of the allowlisted fields, or null if the value is a proxy, is on a
// foreign prototype, has the wrong key count, has a duplicate/non-string/
// inherited key, or exposes any field through an accessor or non-enumerable
// descriptor.
function readExact(value, expectedFields) {
  if (value === null || typeof value !== 'object' || isProxy(value)) return null;

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }

  if (prototype !== Object.prototype || keys.length !== expectedFields.length) return null;

  const seen = new Set();
  for (const key of keys) {
    if (typeof key !== 'string' || seen.has(key)) return null;
    seen.add(key);
  }
  for (const field of expectedFields) {
    if (!seen.has(field)) return null;
  }

  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return null;
  }

  const out = Object.create(null);
  for (const field of expectedFields) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, field);
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
    out[field] = descriptor.value;
  }
  return out;
}

// Read a durable task record. Coherence: a `claimed` task carries an opaque
// holder and a valid lease expiry; every other state carries neither.
function readTask(value) {
  const task = readExact(value, TASK_FIELDS);
  if (!task) return null;
  if (task.channelTaskSchemaVersion !== channelTaskSchemaVersion) return null;
  if (!isTaskId(task.taskId)) return null;
  if (typeof task.status !== 'string' || !TASK_STATUS_SET.has(task.status)) return null;
  if (task.status === 'claimed') {
    if (!isActorId(task.leaseHolder) || !isUtcTimestamp(task.leaseExpiresAt)) return null;
  } else if (task.leaseHolder !== null || task.leaseExpiresAt !== null) {
    return null;
  }
  return task;
}

// Read a lifecycle command's envelope and field shapes. Type membership and the
// per-type coherence of `leaseExpiresAt`/`resultCode` are decided by the caller
// so each produces its own verdict; here only generic shapes are enforced.
function readCommand(value) {
  const command = readExact(value, COMMAND_FIELDS);
  if (!command) return null;
  if (command.channelTaskSchemaVersion !== channelTaskSchemaVersion) return null;
  if (typeof command.type !== 'string' || command.type.length === 0) return null;
  if (typeof command.expectedStatus !== 'string' || !TASK_STATUS_SET.has(command.expectedStatus)) return null;
  if (!isActorId(command.actor)) return null;
  if (typeof command.capability !== 'string' || command.capability.length === 0) return null;
  if (!isUtcTimestamp(command.asOf)) return null;
  if (command.leaseExpiresAt !== null && !isUtcTimestamp(command.leaseExpiresAt)) return null;
  if (command.resultCode !== null
    && !(typeof command.resultCode === 'string' && ALL_RESULT_SET.has(command.resultCode))) {
    return null;
  }
  return command;
}

// Per-type field coherence. A renew supplies a new lease and no result; a release
// or escalate supplies neither; a complete supplies a success-class result and no
// lease; a fail supplies a failure-class result and no lease.
function commandFieldsCoherent(command) {
  switch (command.type) {
    case 'renew':
      return isUtcTimestamp(command.leaseExpiresAt) && command.resultCode === null;
    case 'release':
    case 'escalate':
      return command.leaseExpiresAt === null && command.resultCode === null;
    case 'complete':
      return command.leaseExpiresAt === null
        && typeof command.resultCode === 'string'
        && COMPLETION_RESULT_SET.has(command.resultCode);
    case 'fail':
      return command.leaseExpiresAt === null
        && typeof command.resultCode === 'string'
        && FAILURE_RESULT_SET.has(command.resultCode);
    default:
      return false;
  }
}

function classifyChannelTaskTransition(task, command) {
  const currentTask = readTask(task);
  if (!currentTask) return deny('malformed_task');
  const lifecycleCommand = readCommand(command);
  if (!lifecycleCommand) return deny('malformed_command');

  // Parse: a known transition whose per-type fields cohere.
  if (!TRANSITION_TYPE_SET.has(lifecycleCommand.type)) return deny('unsupported_command');
  if (!commandFieldsCoherent(lifecycleCommand)) return deny('malformed_command');

  // Authorize: the command's capability must match the transition's requirement.
  if (lifecycleCommand.capability !== REQUIRED_CAPABILITY[lifecycleCommand.type]) {
    return deny('capability_denied');
  }

  // Apply: optimistic concurrency, then the task must be an advanceable claim.
  if (lifecycleCommand.expectedStatus !== currentTask.status) return deny('state_conflict');
  if (TERMINAL_STATUS_SET.has(currentTask.status)) return deny('terminal_state');
  if (currentTask.status !== 'claimed') return deny('not_claimed');

  const leaseLive = lifecycleCommand.asOf < currentTask.leaseExpiresAt;

  if (lifecycleCommand.type === 'escalate') {
    // A supervisor escalates only a stale (lease-expired) claim; the dead
    // holder is irrelevant, and a still-live lease is left to its worker.
    if (leaseLive) return deny('lease_active');
    return grant('escalated', { status: 'escalated', leaseHolder: null, leaseExpiresAt: null });
  }

  // renew/release/complete/fail: only the current lease holder, only while the
  // lease is still live, so a lapsed worker can never commit over a task that
  // may have been reassigned.
  if (lifecycleCommand.actor !== currentTask.leaseHolder) return deny('not_lease_holder');
  if (!leaseLive) return deny('lease_expired');

  switch (lifecycleCommand.type) {
    case 'renew':
      if (!(lifecycleCommand.asOf < lifecycleCommand.leaseExpiresAt)) return deny('invalid_lease');
      return grant('renewed', {
        status: 'claimed',
        leaseHolder: currentTask.leaseHolder,
        leaseExpiresAt: lifecycleCommand.leaseExpiresAt,
      });
    case 'release':
      return grant('released', { status: 'pending', leaseHolder: null, leaseExpiresAt: null });
    case 'complete':
      return grant('completed', {
        status: 'completed',
        leaseHolder: null,
        leaseExpiresAt: null,
        resultCode: lifecycleCommand.resultCode,
      });
    case 'fail':
      return grant('failed', {
        status: 'failed',
        leaseHolder: null,
        leaseExpiresAt: null,
        resultCode: lifecycleCommand.resultCode,
      });
    default:
      // Unreachable: type is already one of renew/release/complete/fail here.
      return deny('unsupported_command');
  }
}

module.exports = Object.freeze({
  channelTaskSchemaVersion,
  ChannelTaskStatus,
  TransitionType,
  TransitionDecision,
  TransitionDenialReason,
  CompletionResult,
  FailureResult,
  WORKER_CAPABILITY,
  SUPERVISOR_CAPABILITY,
  classifyChannelTaskTransition,
});
