const { types: { isProxy } } = require('node:util');

// CHANNEL-QUEUE-001A conservative safe-by-default channel-reconciliation task
// derivation.
//
// Pure, source-only, unused. Given one exact revision-1 record describing a
// single member's authoritative membership state and the channels an active
// member of that standing should belong to, deterministically derive the
// idempotent set of provider reconciliation tasks -- or throw. It decides WHICH
// ensure/remove task each supported channel needs and what its stable identity
// is, never who runs the task, whether a provider API may act, or what any
// channel's current occupant list is.
//
// Safety model:
//   * The record describes exactly ONE member's own desired channel standing.
//     It never carries, and this contract never derives from, a channel's
//     occupant list -- so a restricted provider roster is never ingested and
//     can never leak into a task or a log.
//   * The member reference is an opaque, bounded, url-safe token that must
//     contain a letter; a bare all-digit value (the shape of a telephone
//     number) is rejected, so a phone number can never become a task identity.
//     The record carries no contact detail, invite link, secret, or credential,
//     and no such field name appears in this source.
//   * Task identity is a deterministic composite of the member reference, the
//     provider, and the membership version, joined by a delimiter that none of
//     those parts may contain. The same membership version therefore always
//     yields byte-identical task identities, so a duplicate, retried, or
//     out-of-order delivery of the same change collapses onto the same tasks
//     instead of multiplying them; a genuinely newer version yields distinct
//     identities that supersede the old ones.
//   * Every supported provider carries a write mode drawn from a closed
//     registry. Every provider is `manual` here: no provider API may write
//     channel membership until its own discovery ticket proves a supported,
//     authorized API. This contract owns the derivation MECHANISM (which task,
//     which identity, which mode), never the policy of which channels a member
//     is entitled to (that arrives as the desired-standing input) or when a
//     provider becomes automatable.
//   * The derivation is false-negative-safe: a malformed or hostile record
//     throws and produces no tasks, rather than emitting a partial or
//     mislabeled reconciliation.
//
// No runtime path imports this module. It reads no clock, randomness, network,
// environment, or provider; it logs nothing and persists nothing.

const channelReconciliationSchemaVersion = 1;
const DERIVATION_ERROR_MESSAGE = 'Channel reconciliation change evidence is invalid.';

// The closed change-record allowlist. Exactly these keys, no more, no less.
const EXPECTED_FIELDS = Object.freeze([
  'channelReconciliationSchemaVersion',
  'memberRef',
  'membershipVersion',
  'membershipActive',
  'channelDesired',
]);

function immutableEnum(values) {
  return Object.freeze(Object.fromEntries(values.map((value) => [
    value.toUpperCase(),
    value,
  ])));
}

// Supported channels, in a fixed order so derived output is deterministic.
// Extending support is an additive change to this registry plus its write mode.
const CHANNEL_PROVIDERS = Object.freeze(['google', 'strava', 'whatsapp']);

// Per-provider write capability. `manual` means a human performs the provider
// action; no provider API writes membership. Every provider is manual until its
// discovery ticket proves a supported, authorized write API -- flipping one to
// `automated` is the only edit this registry needs then.
const PROVIDER_WRITE_MODE = Object.freeze({
  google: 'manual',
  strava: 'manual',
  whatsapp: 'manual',
});

const CHANNEL_TASK_ACTIONS = Object.freeze(['ensure_present', 'ensure_absent']);

const ChannelProvider = immutableEnum(CHANNEL_PROVIDERS);
const ChannelTaskAction = immutableEnum(CHANNEL_TASK_ACTIONS);

// Conservative bounds. A membership version is a monotone counter; the cap is
// far above any real renewal count yet rejects a runaway or non-integer value.
const LIMITS = Object.freeze({
  maxMemberRefLength: 128,
  maxMembershipVersion: 1000000000,
});

// An opaque member reference: url-safe token characters only, bounded, and
// containing at least one letter so a bare all-digit value (a telephone number)
// is rejected. The delimiter `.` is deliberately excluded so it can safely join
// the composite task identity.
const MEMBER_REF_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MEMBER_REF_REQUIRES_LETTER = /[A-Za-z]/;

// Joins the parts of a task identity. None of the parts (an opaque member
// reference, a lowercase provider name, or a decimal version) may contain it,
// so the composite is unambiguous and collision-free.
const TASK_ID_DELIMITER = '.';
const TASK_ID_PREFIX = 'chn.v1';

class ChannelReconciliationError extends Error {
  constructor() {
    super(DERIVATION_ERROR_MESSAGE);
    Object.defineProperty(this, 'name', {
      value: 'ChannelReconciliationError',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'message', {
      value: DERIVATION_ERROR_MESSAGE,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'code', {
      value: 'invalid_channel_reconciliation_change',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Error.captureStackTrace?.(this, ChannelReconciliationError);
    Object.freeze(this);
  }
}

function fail() {
  throw new ChannelReconciliationError();
}

function isOpaqueMemberRef(value) {
  return typeof value === 'string'
    && value.length <= LIMITS.maxMemberRefLength
    && MEMBER_REF_PATTERN.test(value)
    && MEMBER_REF_REQUIRES_LETTER.test(value);
}

// A non-negative decimal membership version with no fractional part, sign
// trickery, or non-finite value. `Number.isSafeInteger` rejects non-numbers,
// NaN, Infinity, and fractions; the explicit range rejects negatives and a
// runaway magnitude.
function isBoundedVersion(value) {
  return Number.isSafeInteger(value)
    && value >= 0
    && value <= LIMITS.maxMembershipVersion;
}

// A clean own-data reader that never invokes a getter: rejects proxies, a
// non-Object.prototype prototype, more than the bound, non-string keys,
// accessor or non-enumerable or non-data properties, and inherited keys.
// Returns a Map of own string data properties or null.
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

function readExactEvidence(value) {
  if (value === null || typeof value !== 'object' || isProxy(value)) fail();

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail();
  }

  if (prototype !== Object.prototype || keys.length !== EXPECTED_FIELDS.length) fail();

  const keySet = new Set();
  for (const key of keys) {
    if (typeof key !== 'string' || keySet.has(key)) fail();
    keySet.add(key);
  }
  if (EXPECTED_FIELDS.some((field) => !keySet.has(field))) fail();

  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail();
  }

  const evidence = Object.create(null);
  for (const field of EXPECTED_FIELDS) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, field);
    } catch {
      fail();
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined) {
      fail();
    }
    evidence[field] = descriptor.value;
  }
  return evidence;
}

// Read the exact per-provider desired-standing map without invoking a getter:
// exactly the supported provider keys, each a strict boolean. Any missing,
// extra, or non-boolean entry throws.
function readChannelDesired(value) {
  const map = safeOwnData(value, CHANNEL_PROVIDERS.length);
  if (!map || map.size !== CHANNEL_PROVIDERS.length) fail();
  const desired = Object.create(null);
  for (const provider of CHANNEL_PROVIDERS) {
    if (!map.has(provider)) fail();
    const flag = map.get(provider);
    if (typeof flag !== 'boolean') fail();
    desired[provider] = flag;
  }
  return desired;
}

function buildTaskId(memberRef, provider, membershipVersion) {
  return [
    TASK_ID_PREFIX,
    memberRef,
    provider,
    String(membershipVersion),
  ].join(TASK_ID_DELIMITER);
}

function deriveChannelReconciliationTasks(input) {
  const evidence = readExactEvidence(input);

  if (evidence.channelReconciliationSchemaVersion !== channelReconciliationSchemaVersion) fail();
  if (!isOpaqueMemberRef(evidence.memberRef)) fail();
  if (!isBoundedVersion(evidence.membershipVersion)) fail();
  if (typeof evidence.membershipActive !== 'boolean') fail();
  const desired = readChannelDesired(evidence.channelDesired);

  const { memberRef, membershipVersion, membershipActive } = evidence;

  // One task per supported provider, in the fixed registry order. An active
  // member of the desired standing is ensured present in that channel; an
  // inactive member -- or an active member not desired in that channel -- is
  // ensured absent. A lapse (membershipActive false) therefore derives an
  // ensure_absent for every channel, and a reactivation restores ensure_present
  // for the desired ones, with no dependence on any observed occupant list.
  const tasks = CHANNEL_PROVIDERS.map((provider) => Object.freeze({
    taskId: buildTaskId(memberRef, provider, membershipVersion),
    provider,
    action: (membershipActive && desired[provider]) ? 'ensure_present' : 'ensure_absent',
    mode: PROVIDER_WRITE_MODE[provider],
    membershipVersion,
  }));

  return Object.freeze({
    channelReconciliationSchemaVersion,
    memberRef,
    membershipVersion,
    membershipActive,
    tasks: Object.freeze(tasks),
    taskCount: tasks.length,
  });
}

Object.freeze(ChannelReconciliationError.prototype);
Object.freeze(ChannelReconciliationError);

module.exports = Object.freeze({
  channelReconciliationSchemaVersion,
  CHANNEL_PROVIDERS,
  PROVIDER_WRITE_MODE,
  ChannelProvider,
  ChannelTaskAction,
  ChannelReconciliationError,
  deriveChannelReconciliationTasks,
});
