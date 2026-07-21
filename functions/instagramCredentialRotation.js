'use strict';

// INSTAGRAM-005A — pure credential-rotation promotion decision (pure contract).
//
// SOURCE ONLY, UNUSED: this module is imported by nothing (not by
// functions/index.js, no route, no Firestore Rules, no callable, no scheduled
// worker). It has zero runtime behavior. It is the safety-critical decision core
// for the *promotion* line of parent #95 (INSTAGRAM-005), landed and exhaustively
// negative-tested first so the eventual wiring is a mechanical hookup of
// already-proven invariants. See SYSTEM_DESIGN.md §8.15.
//
// What it decides: given the current known-good credential's metadata and a
// candidate replacement's metadata (including the caller's independent validation
// result), whether the candidate is safe to atomically promote to become the new
// current credential — or whether the known-good must be kept untouched, or the
// input denied. It is a non-throwing frozen-verdict reducer (the idiom of §8.13/
// §8.14) and NEVER throws.
//
// Holds NO secret. The artifact being rotated is the Instagram publisher's
// long-lived access credential; this contract holds only an opaque *credential
// fingerprint* (a non-secret handle by which the caller looks up the real secret
// in its own store), the provider account handle, a closed validation-outcome
// enum, and two UTC instants. There is no secret, bearer, or credential *value*
// anywhere — the module deliberately carries no such vocabulary at all, and a
// source-boundary test enforces that absence. So the promotion decision can be
// modeled, tested, and audited without any secret ever entering the contract.
//
// Safety model:
//   * Never overwrite the known-good on anything short of a fully-validated
//     improvement: the ONLY path to `promote` is a candidate whose independent
//     validation is `valid`, whose account matches the current credential's
//     account, that is a *different* fingerprint, that is not already expired, and
//     whose expiry is *strictly later* than the current one. Every other
//     well-formed input is `keep_current` (known-good untouched); every malformed
//     input is `denied`. A failed or unverified refresh can never promote.
//   * Account-bound: a candidate that validated but belongs to a different account
//     is `keep_current` (account_mismatch), never promoted.
//   * No downgrade / no replay: a candidate whose expiry is not strictly after the
//     current one is `keep_current` (not_longer_lived); an already-expired
//     candidate is `keep_current` (candidate_expired).
//   * Idempotent: same inputs -> same verdict; a candidate equal to the current
//     fingerprint is the no-op `keep_current` (same_credential).
//   * Clockless: credential lifetime is compared by lexical UTC string comparison
//     (fixed-width UTC compares chronologically); the reducer reads no clock and
//     constructs no Date. The caller supplies both the validation instant and the
//     expiry.
//   * Hostile-input-safe: every field of each record is read through an
//     own-enumerable data descriptor with no getter ever invoked; a proxy, foreign
//     prototype, inherited/extra/missing/symbol key, or out-of-shape value denies
//     as malformed rather than being partially interpreted.
//
// Requires only node:util. Reads no clock, env, network, Firestore, or provider.

const {
  types: { isProxy },
} = require('node:util');

const credentialRotationSchemaVersion = 1;

function immutableEnum(values) {
  return Object.freeze(Object.fromEntries(values.map((v) => [v.toUpperCase(), v])));
}

// ---- closed vocabularies -------------------------------------------------

// The caller's independent validation of the candidate against the expected
// provider account. Only `valid` may promote; `invalid` failed validation;
// `unverified` means validation could not be completed (e.g. provider unreachable)
// — both keep the known-good.
const VALIDATION_OUTCOMES = ['valid', 'invalid', 'unverified'];
const ROTATION_DECISIONS = ['promote', 'keep_current', 'denied'];
const ROTATION_GRANT_REASONS = ['promoted'];
const ROTATION_KEEP_REASONS = [
  'candidate_invalid',
  'candidate_unverified',
  'account_mismatch',
  'same_credential',
  'candidate_expired',
  'not_longer_lived',
];
const ROTATION_DENIAL_REASONS = ['malformed_current', 'malformed_candidate'];

const ValidationOutcome = immutableEnum(VALIDATION_OUTCOMES);
const RotationDecision = immutableEnum(ROTATION_DECISIONS);
const RotationGrantReason = immutableEnum(ROTATION_GRANT_REASONS);
const RotationKeepReason = immutableEnum(ROTATION_KEEP_REASONS);
const RotationDenialReason = immutableEnum(ROTATION_DENIAL_REASONS);

const VALIDATION_OUTCOME_SET = new Set(VALIDATION_OUTCOMES);

// ---- record shapes -------------------------------------------------------

const CURRENT_FIELDS = ['credentialRotationSchemaVersion', 'credentialRef', 'accountRef', 'expiresAt'];
const CANDIDATE_FIELDS = [
  'credentialRotationSchemaVersion',
  'credentialRef',
  'accountRef',
  'expiresAt',
  'validationOutcome',
  'asOf',
];

// A credential fingerprint and a provider account handle are both opaque,
// store-/provider-minted, url-safe handles. Unlike a human identity key they may
// legitimately be all digits (a provider account id commonly is), so no letter is
// required — only the closed url-safe shape.
const HANDLE_PATTERN = /^[A-Za-z0-9._-]{1,256}$/;
// A fixed-width UTC instant restricted to real calendar dates (see isUtcTimestamp).
// Fixed-width UTC strings over real dates compare lexically exactly as they do
// chronologically, so lifetime is decided by string comparison with no clock.
const UTC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

function isHandleString(value) {
  return typeof value === 'string' && HANDLE_PATTERN.test(value);
}

function isUtcTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12) return false;
  // Calendar-aware day bound — accept only a REAL calendar day. This is what makes
  // the fixed-width lexical comparison used for expiry/lifetime provably agree with
  // chronological order: an impossible day (a non-leap Feb 29, Feb 30/31, Apr/Jun/
  // Sep/Nov 31) would, if interpreted as an instant, roll forward past where it sorts
  // lexically, so lexical order would stop matching chronological order. Rejecting it
  // as malformed keeps the equivalence exact — and since malformed denies, this only
  // ever withholds a rotation, never enables one.
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const DAYS_IN_MONTH = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > DAYS_IN_MONTH[month - 1]) return false;
  if (hour > 23) return false;
  if (minute > 59) return false;
  if (second > 59) return false;
  return true;
}

// Read an exact, closed record: an ordinary object whose own string-keyed
// properties are precisely `expectedFields`, each an enumerable data property.
// Returns a null-prototype copy read with no getter ever invoked, or null on any
// deviation (proxy, array, foreign prototype, symbol key, wrong key count,
// missing, extra — enumerable OR non-enumerable — inherited, accessor, or
// non-enumerable field).
function readExact(value, expectedFields) {
  if (value === null || typeof value !== 'object') return null;
  // isProxy before Array.isArray: Array.isArray throws on a revoked proxy, while
  // isProxy safely reports it as a proxy (which this rejects). Order matters for
  // total, never-throwing behavior.
  if (isProxy(value)) return null;
  if (Array.isArray(value)) return null;
  if (Object.getPrototypeOf(value) !== Object.prototype) return null;
  if (Object.getOwnPropertySymbols(value).length !== 0) return null;
  // Own property NAMES, not just enumerable keys: a non-enumerable extra own
  // property must also deny — it is invisible to Object.keys but would still make
  // the record something other than the exact closed shape. With symbols already
  // rejected, this bounds the total own-key surface to exactly `expectedFields`.
  if (Object.getOwnPropertyNames(value).length !== expectedFields.length) return null;
  const keys = Object.keys(value);
  if (keys.length !== expectedFields.length) return null;
  for (const key of keys) {
    if (!expectedFields.includes(key)) return null;
  }
  const out = Object.create(null);
  for (const field of expectedFields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor) return null;
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
    if (!descriptor.enumerable) return null;
    out[field] = descriptor.value;
  }
  return out;
}

// Validate the current known-good credential's metadata.
function readCurrent(value) {
  const current = readExact(value, CURRENT_FIELDS);
  if (!current) return null;
  if (current.credentialRotationSchemaVersion !== credentialRotationSchemaVersion) return null;
  if (!isHandleString(current.credentialRef)) return null;
  if (!isHandleString(current.accountRef)) return null;
  if (!isUtcTimestamp(current.expiresAt)) return null;
  return current;
}

// Validate the candidate replacement's metadata, including the caller's
// independent validation outcome and the instant at which it was determined.
function readCandidate(value) {
  const candidate = readExact(value, CANDIDATE_FIELDS);
  if (!candidate) return null;
  if (candidate.credentialRotationSchemaVersion !== credentialRotationSchemaVersion) return null;
  if (!isHandleString(candidate.credentialRef)) return null;
  if (!isHandleString(candidate.accountRef)) return null;
  if (!isUtcTimestamp(candidate.expiresAt)) return null;
  if (typeof candidate.validationOutcome !== 'string'
    || !VALIDATION_OUTCOME_SET.has(candidate.validationOutcome)) {
    return null;
  }
  if (!isUtcTimestamp(candidate.asOf)) return null;
  return candidate;
}

// ---- verdict constructors ------------------------------------------------

const DENIALS = Object.freeze(Object.fromEntries(
  ROTATION_DENIAL_REASONS.map((reason) => [reason, Object.freeze({ decision: 'denied', reason })]),
));

const KEEPS = Object.freeze(Object.fromEntries(
  ROTATION_KEEP_REASONS.map((reason) => [reason, Object.freeze({ decision: 'keep_current', reason })]),
));

function deny(reason) {
  return DENIALS[reason];
}

function keep(reason) {
  return KEEPS[reason];
}

function promote(candidate) {
  return Object.freeze({
    decision: 'promote',
    reason: 'promoted',
    next: Object.freeze({
      credentialRef: candidate.credentialRef,
      accountRef: candidate.accountRef,
      expiresAt: candidate.expiresAt,
    }),
  });
}

// ---- the decision --------------------------------------------------------

function classifyCredentialRotationPromotion(currentEvidence, candidateEvidence) {
  const current = readCurrent(currentEvidence);
  if (!current) return deny('malformed_current');
  const candidate = readCandidate(candidateEvidence);
  if (!candidate) return deny('malformed_candidate');

  // Withhold-by-default. The known-good is never touched unless EVERY gate passes;
  // the first gate that fails yields a keep_current with a diagnostic reason.

  // 1. Independent validation must have succeeded. A failed or incomplete
  //    validation can never promote — this is the "failed refresh never overwrites
  //    the known-good" invariant.
  if (candidate.validationOutcome !== 'valid') {
    return keep(candidate.validationOutcome === 'unverified' ? 'candidate_unverified' : 'candidate_invalid');
  }

  // 2. Account-bound: a validated candidate for a different provider account is a
  //    serious anomaly — keep the known-good, never swap accounts.
  if (candidate.accountRef !== current.accountRef) return keep('account_mismatch');

  // 3. Idempotent no-op: the candidate is the credential we already hold. (A
  //    same-fingerprint expiry-metadata refresh is a different operation, out of
  //    scope for this rotation decision.)
  if (candidate.credentialRef === current.credentialRef) return keep('same_credential');

  // 4. The candidate must have remaining life at its own validation instant —
  //    exclusive: a candidate at exactly its expiry is already expired.
  if (!(candidate.asOf < candidate.expiresAt)) return keep('candidate_expired');

  // 5. No downgrade / no replay: the candidate must extend the lifetime — its
  //    expiry must be strictly later than the current credential's.
  if (!(current.expiresAt < candidate.expiresAt)) return keep('not_longer_lived');

  // Every gate passed: the candidate independently validated for the same account,
  // is a different, unexpired, strictly-longer-lived credential. Safe to promote.
  return promote(candidate);
}

module.exports = Object.freeze({
  credentialRotationSchemaVersion,
  ValidationOutcome,
  RotationDecision,
  RotationGrantReason,
  RotationKeepReason,
  RotationDenialReason,
  classifyCredentialRotationPromotion,
});
