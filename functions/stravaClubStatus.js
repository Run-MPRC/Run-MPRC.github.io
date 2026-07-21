const { types: { isProxy } } = require('node:util');

// STRAVA-002A conservative safe-by-default self-service club-status
// classification.
//
// Pure, source-only, unused. Given one exact revision-1 record describing the
// result of reading a SINGLE signed-in member's own Strava club memberships and
// the one configured immutable MPRC club identity, deterministically classify
// that member's own club status -- or throw. It decides only what informational
// status to report back to that one member, never whether they gain any MPRC
// capability, and it never reads, holds, or emits any other athlete's data or a
// club's occupant list.
//
// Safety model:
//   * The record carries only the member's OWN club memberships (the set of
//     clubs that member belongs to, as their own token would report), never a
//     club's member/admin list. A club roster is therefore never ingested and
//     can never leak into a verdict or a log; the contract has no field in which
//     one could arrive. This mirrors the provider policy that the removed Club
//     Members / Admins / Activities reads are never used.
//   * The verdict is advisory and confers nothing. Its status is a bare
//     informational label -- the member is, is not, or cannot presently be
//     determined to be in the configured club -- and the verdict carries no
//     entitlement, pricing, role, or access field. A `member` status never
//     grants MPRC website membership, member pricing, or any linked-provider
//     access; that authorization is decided elsewhere from its own evidence.
//   * The member's own club-membership list is reduced to a single presence
//     test against the configured club identity and is never echoed, so not
//     even that one member's full club list appears in the verdict.
//   * The check is point-in-time and on demand: the caller supplies the instant,
//     which the verdict echoes, and the verdict is explicitly advisory -- it is
//     a snapshot, never a continuously synchronized state.
//   * A well-formed record whose read did not succeed -- a missing scope, a
//     revoked or unauthorized token, a rate limit, or a provider outage --
//     yields an `unknown` status with the reason and a `retryable` flag that
//     tells the caller whether a backoff-and-retry or a re-authorization is the
//     right response; it never guesses membership.
//   * The classification is false-negative-safe: a malformed or hostile record
//     throws and produces no verdict, rather than reporting a wrong or partial
//     status. Every part of the record is read through an own-enumerable-data
//     descriptor with no getter invoked; a proxy, a foreign prototype, an
//     inherited key, an extra or missing key, an unknown enum, a wrong version,
//     an out-of-range value, or a club list present on a failed read is rejected.
//
// This contract owns the classification MECHANISM (which status, which reason,
// whether a retry helps), never the policy of which club is the MPRC club (the
// caller supplies the configured identity), whether a last-check result may be
// stored, or what any status entitles. It performs no network call: the read of
// the member's own memberships happens upstream and arrives as evidence. No
// runtime path imports this module. It reads no clock, randomness, network,
// environment, or provider; it logs nothing and persists nothing.

const stravaClubStatusSchemaVersion = 1;
const STATUS_CHECK_ERROR_MESSAGE = 'Strava club-status evidence is invalid.';

// The closed record allowlist. Exactly these keys, no more, no less.
const EXPECTED_FIELDS = Object.freeze([
  'stravaClubStatusSchemaVersion',
  'configuredClubId',
  'fetchOutcome',
  'memberClubIds',
  'checkedAt',
]);

function immutableEnum(values) {
  return Object.freeze(Object.fromEntries(values.map((value) => [
    value.toUpperCase(),
    value,
  ])));
}

// The closed set of read outcomes. `ok` means the member's own memberships were
// read; the rest are the failure modes the outcome must be handled for.
const FETCH_OUTCOMES = Object.freeze([
  'ok',
  'missing_scope',
  'revoked',
  'not_authorized',
  'rate_limited',
  'provider_outage',
]);

// The closed set of reportable statuses.
const CLUB_STATUSES = Object.freeze(['member', 'not_member', 'unknown']);

const FetchOutcome = immutableEnum(FETCH_OUTCOMES);
const ClubStatus = immutableEnum(CLUB_STATUSES);
const FETCH_OUTCOME_SET = new Set(FETCH_OUTCOMES);

// A Strava club identity is a bounded decimal identifier. It is a public club
// identifier, never a contact detail, so an all-digit value is correct here.
const CLUB_ID_PATTERN = /^[0-9]{1,20}$/;

// A UTC instant with second precision and a mandatory Z. Fixed width means
// lexical order equals chronological order; no clock or Date dependency.
const UTC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

const CANONICAL_INDEX_PATTERN = /^(0|[1-9][0-9]*)$/;

// Conservative bound on how many of the member's own clubs a read may report.
const LIMITS = Object.freeze({ maxMemberClubs: 512 });

// Disposition of every non-ok read. A missing scope, a revoked or unauthorized
// token needs a re-authorization rather than a blind retry, so it is not
// retryable; a rate limit or a provider outage is transient, so a backoff and
// retry is the right response.
const OUTCOME_DISPOSITION = Object.freeze({
  missing_scope: Object.freeze({ status: 'unknown', reason: 'missing_scope', retryable: false }),
  revoked: Object.freeze({ status: 'unknown', reason: 'revoked', retryable: false }),
  not_authorized: Object.freeze({ status: 'unknown', reason: 'not_authorized', retryable: false }),
  rate_limited: Object.freeze({ status: 'unknown', reason: 'rate_limited', retryable: true }),
  provider_outage: Object.freeze({ status: 'unknown', reason: 'provider_outage', retryable: true }),
});

class StravaClubStatusError extends Error {
  constructor() {
    super(STATUS_CHECK_ERROR_MESSAGE);
    Object.defineProperty(this, 'name', {
      value: 'StravaClubStatusError',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'message', {
      value: STATUS_CHECK_ERROR_MESSAGE,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'code', {
      value: 'invalid_strava_club_status_evidence',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Error.captureStackTrace?.(this, StravaClubStatusError);
    Object.freeze(this);
  }
}

function fail() {
  throw new StravaClubStatusError();
}

function isClubId(value) {
  return typeof value === 'string' && CLUB_ID_PATTERN.test(value);
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

// Read the member's own club-membership list into a Set of club identities,
// without invoking any getter: rejects a proxy, a non-Array.prototype array, a
// runaway length, a sparse hole, an accessor index, a non-club-id element, and
// any own key that is not a canonical index or `length`.
function readMemberClubIdSet(value) {
  if (!Array.isArray(value) || isProxy(value)) fail();
  if (Object.getPrototypeOf(value) !== Array.prototype) fail();

  const { length } = value;
  if (!Number.isSafeInteger(length) || length < 0 || length > LIMITS.maxMemberClubs) fail();

  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) fail();
  for (const key of keys) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !CANONICAL_INDEX_PATTERN.test(key) || Number(key) >= length) fail();
  }

  const ids = new Set();
  for (let index = 0; index < length; index += 1) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
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
    if (!isClubId(descriptor.value)) fail();
    ids.add(descriptor.value);
  }
  return ids;
}

function buildVerdict(status, reason, retryable, checkedAt) {
  return Object.freeze({
    stravaClubStatusSchemaVersion,
    status,
    reason,
    retryable,
    advisory: true,
    checkedAt,
  });
}

function classifyStravaClubStatus(input) {
  const evidence = readExactEvidence(input);

  if (evidence.stravaClubStatusSchemaVersion !== stravaClubStatusSchemaVersion) fail();
  if (!isClubId(evidence.configuredClubId)) fail();
  if (typeof evidence.fetchOutcome !== 'string' || !FETCH_OUTCOME_SET.has(evidence.fetchOutcome)) fail();
  if (!isUtcTimestamp(evidence.checkedAt)) fail();

  const { fetchOutcome, checkedAt } = evidence;

  if (fetchOutcome === 'ok') {
    // A successful read carries the member's own club list; classify by whether
    // the one configured club is among the member's own memberships. The list
    // is reduced to a single presence test and never echoed.
    const memberClubs = readMemberClubIdSet(evidence.memberClubIds);
    return memberClubs.has(evidence.configuredClubId)
      ? buildVerdict('member', 'in_club', false, checkedAt)
      : buildVerdict('not_member', 'not_in_club', false, checkedAt);
  }

  // A failed read carries no club list; anything else is an incoherent record.
  if (evidence.memberClubIds !== null) fail();
  const disposition = OUTCOME_DISPOSITION[fetchOutcome];
  return buildVerdict(disposition.status, disposition.reason, disposition.retryable, checkedAt);
}

Object.freeze(StravaClubStatusError.prototype);
Object.freeze(StravaClubStatusError);

module.exports = Object.freeze({
  stravaClubStatusSchemaVersion,
  FetchOutcome,
  ClubStatus,
  StravaClubStatusError,
  classifyStravaClubStatus,
});
