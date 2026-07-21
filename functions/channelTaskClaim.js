const { types: { isProxy } } = require('node:util');

// CHANNEL-QUEUE-001B conservative safe-by-default channel-task claim decision.
//
// Pure, source-only, unused. Given the durable record of one channel
// reconciliation task and one claim command, decide whether the claim may be
// granted -- enforcing that at most one worker holds an active lease on a task,
// while letting a task whose lease has expired be safely reclaimed. It returns
// a frozen verdict and NEVER throws; it decides only whether a claim is
// grantable, never who the authorized workers are, what the task's provider
// action is, or when the clock reads (the caller supplies the current instant).
//
// Safety model:
//   * A claim is granted only when the task is unclaimed, or is claimed but its
//     lease has expired as of the caller-supplied instant. A claim against a
//     task with a live lease is denied `already_claimed`, so two workers can
//     never both hold an active lease -- the "only one active worker" rule.
//   * Optimistic concurrency: the command names the task status it believes
//     current; a mismatch is denied `state_conflict` rather than acting on a
//     stale view, so a duplicate or out-of-order claim cannot race a state it
//     did not observe.
//   * A claim must set a lease that expires strictly after the supplied instant;
//     a zero-length or already-expired new lease is denied `invalid_lease`.
//   * The claim capability is a single closed value; any other capability is
//     denied `capability_denied`, and any command type other than a claim is
//     denied `unsupported_command`.
//   * Actors, lease holders, and task identities are opaque, bounded, url-safe
//     tokens. The record carries no contact detail, invite link, secret, or
//     credential, and no such field name appears in this source; the verdict
//     echoes none of the input.
//   * Every part of both records is read through an own-enumerable-data
//     descriptor with no getter invoked; a proxy, a foreign prototype, an
//     inherited key, an extra or missing key, an unknown enum, a wrong version,
//     or an incoherent lease/holder pairing yields a frozen denial verdict, not
//     a throw and not a partial decision.
//
// This contract owns the claim-arbitration MECHANISM, never the policy of which
// identities may hold the claim capability (that is enforced upstream) nor the
// lease duration (the caller sets the new expiry). It performs no provider
// action, writes no queue, and grants nothing beyond the returned verdict. No
// runtime path imports this module. It reads no clock, randomness, network,
// environment, or provider; it logs nothing and persists nothing.

const channelTaskSchemaVersion = 1;

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
]);

function immutableEnum(values) {
  return Object.freeze(Object.fromEntries(values.map((value) => [
    value.toUpperCase(),
    value,
  ])));
}

const TASK_STATUSES = Object.freeze(['pending', 'claimed', 'completed', 'failed']);
const ChannelTaskStatus = immutableEnum(TASK_STATUSES);
const STATUS_SET = new Set(TASK_STATUSES);
const TERMINAL_STATUS = new Set(['completed', 'failed']);

const CLAIM_TYPE = 'claim';
const CLAIM_CAPABILITY = 'channel_operator';

const DECISIONS = Object.freeze(['granted', 'denied']);
const ClaimDecision = immutableEnum(DECISIONS);

const DENIAL_REASONS = Object.freeze([
  'malformed_task',
  'malformed_command',
  'unsupported_command',
  'capability_denied',
  'invalid_lease',
  'state_conflict',
  'already_claimed',
  'terminal_state',
]);
const ClaimDenialReason = immutableEnum(DENIAL_REASONS);
const GRANT_REASON = 'claim_granted';

// Opaque, bounded, url-safe reference tokens. A task identity may be longer to
// admit the composite reconciliation identity; an actor or lease holder is a
// capability-scoped opaque token. `.` is admitted only as an inert separator
// inside a composite identity; none of these may carry a contact detail.
const TASK_ID_PATTERN = /^[A-Za-z0-9._-]{1,256}$/;
const ACTOR_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

// A UTC instant with second precision and a mandatory Z. Fixed width means
// lexical order equals chronological order; no clock or Date dependency.
const UTC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

// Pre-frozen denial verdicts. Each denial carries no input-derived data, so a
// single shared frozen object per reason is safe and cannot leak the record.
const DENIALS = Object.freeze(Object.fromEntries(DENIAL_REASONS.map((reason) => [
  reason,
  Object.freeze({ decision: 'denied', reason }),
])));

function deny(reason) {
  return DENIALS[reason];
}

function grant(actor, leaseExpiresAt) {
  return Object.freeze({
    decision: 'granted',
    reason: GRANT_REASON,
    grant: Object.freeze({
      status: 'claimed',
      leaseHolder: actor,
      leaseExpiresAt,
    }),
  });
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

function isTaskId(value) {
  return typeof value === 'string' && TASK_ID_PATTERN.test(value);
}

function isActorToken(value) {
  return typeof value === 'string' && ACTOR_PATTERN.test(value);
}

// Read an exact-key record without invoking any getter. Returns a
// null-prototype snapshot of the expected fields or null. Rejects a proxy, a
// non-Object.prototype prototype, the wrong key count, a duplicate or
// non-string key, an inherited key, and any accessor or non-enumerable or
// non-data property.
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

  const keySet = new Set();
  for (const key of keys) {
    if (typeof key !== 'string' || keySet.has(key)) return null;
    keySet.add(key);
  }
  if (expectedFields.some((field) => !keySet.has(field))) return null;

  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return null;
  }

  const snapshot = Object.create(null);
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
    snapshot[field] = descriptor.value;
  }
  return snapshot;
}

// A well-formed durable task. A claimed task must carry an opaque lease holder
// and a valid lease expiry; every other status must carry neither, so an
// incoherent record (a claimed task with no lease, or a pending task that still
// names a holder) is rejected as malformed.
function readTask(task) {
  const snapshot = readExact(task, TASK_FIELDS);
  if (!snapshot) return null;
  if (snapshot.channelTaskSchemaVersion !== channelTaskSchemaVersion) return null;
  if (!isTaskId(snapshot.taskId)) return null;
  if (typeof snapshot.status !== 'string' || !STATUS_SET.has(snapshot.status)) return null;
  if (snapshot.status === 'claimed') {
    if (!isActorToken(snapshot.leaseHolder) || !isUtcTimestamp(snapshot.leaseExpiresAt)) return null;
  } else if (snapshot.leaseHolder !== null || snapshot.leaseExpiresAt !== null) {
    return null;
  }
  return snapshot;
}

// A well-formed claim command. Field shapes only; whether the type is a claim
// and whether the capability is the claim capability are decided by the caller
// so they map to distinct verdicts rather than a generic malformed denial.
function readCommand(command) {
  const snapshot = readExact(command, COMMAND_FIELDS);
  if (!snapshot) return null;
  if (snapshot.channelTaskSchemaVersion !== channelTaskSchemaVersion) return null;
  if (typeof snapshot.type !== 'string') return null;
  if (typeof snapshot.expectedStatus !== 'string' || !STATUS_SET.has(snapshot.expectedStatus)) return null;
  if (!isActorToken(snapshot.actor)) return null;
  if (typeof snapshot.capability !== 'string') return null;
  if (!isUtcTimestamp(snapshot.asOf)) return null;
  if (!isUtcTimestamp(snapshot.leaseExpiresAt)) return null;
  return snapshot;
}

function classifyChannelTaskClaim(task, command) {
  const taskRecord = readTask(task);
  if (!taskRecord) return deny('malformed_task');

  const commandRecord = readCommand(command);
  if (!commandRecord) return deny('malformed_command');

  if (commandRecord.type !== CLAIM_TYPE) return deny('unsupported_command');
  if (commandRecord.capability !== CLAIM_CAPABILITY) return deny('capability_denied');

  // A claim must open a lease that expires strictly after the supplied instant.
  if (!(commandRecord.asOf < commandRecord.leaseExpiresAt)) return deny('invalid_lease');

  // Optimistic concurrency: act only on the status the command observed.
  if (commandRecord.expectedStatus !== taskRecord.status) return deny('state_conflict');

  // completed or failed: terminal, never claimable.
  if (TERMINAL_STATUS.has(taskRecord.status)) return deny('terminal_state');

  // A claimed task may be reclaimed only once its lease has expired; a live
  // lease means a worker still holds the task -- the "only one active worker"
  // rule. A pending task, or a claimed task whose lease has expired, is granted.
  if (taskRecord.status === 'claimed' && commandRecord.asOf < taskRecord.leaseExpiresAt) {
    return deny('already_claimed');
  }

  return grant(commandRecord.actor, commandRecord.leaseExpiresAt);
}

module.exports = Object.freeze({
  channelTaskSchemaVersion,
  ChannelTaskStatus,
  ClaimDecision,
  ClaimDenialReason,
  CLAIM_CAPABILITY,
  classifyChannelTaskClaim,
});
