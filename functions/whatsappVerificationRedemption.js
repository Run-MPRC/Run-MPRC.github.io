'use strict';

// WHATSAPP-002A — pure one-time number-control-proof redemption decision (pure contract).
//
// SOURCE ONLY, UNUSED: this module is imported by nothing (not by
// functions/index.js, no route, no Firestore Rules, no callable, no scheduled
// worker). It has zero runtime behavior. It is the safety-critical decision core
// for the *verification* line of parent #87 (WHATSAPP-002) — "generate a one-time
// server code ... hash the code (short-lived, one-use, rate/attempt limited)" —
// landed and exhaustively negative-tested first so the eventual wiring is a
// mechanical hookup of already-proven invariants. See SYSTEM_DESIGN.md §8.16.
//
// What it decides: given the durable server-side verification challenge (the
// record the server stored when it issued and sent a one-time code to a phone/
// WhatsApp number on a member's behalf) and one redemption attempt, whether that
// attempt proves the member controls the number — accept — or is rejected (and how
// the challenge's one-use / attempt budget advances), or denied as malformed. It
// is a non-throwing frozen-verdict reducer (the idiom of §8.13/§8.14/§8.15) and
// NEVER throws.
//
// Holds NO plaintext code. The one-time code the server sends is a short-lived
// shared credential, but this contract carries only its *hash* — a fixed-width
// hex digest — on both sides of the comparison. The user-supplied code is hashed
// by the caller the same way before it reaches this reducer, so a plaintext code
// can never enter the contract: the hash shape (64 lowercase hex chars) structurally
// rejects a short numeric one-time code. There is likewise no secret / token /
// bearer vocabulary anywhere in the code, and a source-boundary test enforces that
// absence. So the redemption decision is modeled, tested, and audited with no code,
// secret, or token value ever present.
//
// Safety model:
//   * One-use: a challenge that already reached a terminal state — `verified` or
//     `voided` — never redeems again (`already_verified` / `challenge_voided`); a
//     successful accept transitions it to `verified` so a replayed correct code is
//     inert.
//   * Short-lived: expiry is checked BEFORE the code is compared, exclusively
//     (`asOf` at/after `expiresAt` is expired) — a correct-but-late code cannot
//     verify, and a late wrong code leaks nothing about correctness.
//   * Attempt-bounded (brute-force resistant): every wrong code consumes exactly
//     one attempt; the miss that reaches `maxAttempts` voids the challenge; accept
//     is only reachable while attempts remain. The total number of guesses any
//     challenge can ever permit is bounded (and `maxAttempts` itself is bounded).
//   * Challenge-bound: an attempt names the challenge it redeems; an attempt for a
//     different `challengeRef` is `challenge_mismatch` and changes nothing.
//   * Owner-bound: only the member the challenge was issued for may redeem it; a
//     different actor is `actor_mismatch` and changes NO state — a stranger can
//     neither verify nor burn the owner's attempt budget.
//   * Confers nothing: an accept asserts ONLY that the member controls the phone
//     channel — it emits a non-secret `proof` of { memberRef, phoneRef } and grants
//     no Firebase auth, membership, discount, or role. The phone is a channel handle
//     (a bare all-digit value is fine); the member is a letter-requiring identity,
//     so a phone number can never masquerade as the member.
//   * Clockless: expiry is compared by lexical UTC string comparison over
//     calendar-validated instants (fixed-width UTC compares chronologically); the
//     reducer reads no clock and constructs no Date. The caller supplies `asOf`.
//   * Hostile-input-safe: every field of each record is read through an
//     own-enumerable data descriptor with no getter ever invoked; a proxy, foreign
//     prototype, inherited/extra/missing/symbol key, or out-of-shape value denies
//     as malformed rather than being partially interpreted.
//
// Requires only node:util. Reads no clock, env, network, Firestore, or provider.

const {
  types: { isProxy },
} = require('node:util');

const verificationSchemaVersion = 1;

function immutableEnum(values) {
  return Object.freeze(Object.fromEntries(values.map((v) => [v.toUpperCase(), v])));
}

// ---- closed vocabularies -------------------------------------------------

// The durable challenge's lifecycle state. `pending` may still be redeemed;
// `verified` and `voided` are terminal (one-use).
const REDEMPTION_STATUSES = ['pending', 'verified', 'voided'];
const REDEMPTION_DECISIONS = ['accepted', 'rejected', 'denied'];
const ACCEPT_REASONS = ['verified'];
// Non-terminal, state-changing and no-change rejections both live here. The first
// four leave the challenge untouched; `expired`/`too_many_attempts` void it;
// `code_mismatch` consumes an attempt (and voids on the last one).
const REJECT_REASONS = [
  'challenge_mismatch',
  'already_verified',
  'challenge_voided',
  'actor_mismatch',
  'expired',
  'too_many_attempts',
  'code_mismatch',
];
// The subset of rejections that change no challenge state at all.
const REJECT_NO_CHANGE_REASONS = [
  'challenge_mismatch',
  'already_verified',
  'challenge_voided',
  'actor_mismatch',
];
const DENIAL_REASONS = ['malformed_challenge', 'malformed_attempt'];

const RedemptionStatus = immutableEnum(REDEMPTION_STATUSES);
const RedemptionDecision = immutableEnum(REDEMPTION_DECISIONS);
const AcceptReason = immutableEnum(ACCEPT_REASONS);
const RejectReason = immutableEnum(REJECT_REASONS);
const DenialReason = immutableEnum(DENIAL_REASONS);

const REDEMPTION_STATUS_SET = new Set(REDEMPTION_STATUSES);

// ---- record shapes -------------------------------------------------------

const CHALLENGE_FIELDS = [
  'verificationSchemaVersion',
  'challengeRef',
  'memberRef',
  'phoneRef',
  'codeHash',
  'issuedAt',
  'expiresAt',
  'maxAttempts',
  'attemptsMade',
  'status',
];
const ATTEMPT_FIELDS = [
  'verificationSchemaVersion',
  'challengeRef',
  'actor',
  'providedCodeHash',
  'asOf',
];

// A challenge handle and a phone/WhatsApp channel identifier are both opaque,
// url-safe handles. A normalized phone number is legitimately all digits, so — like
// a provider account id — no letter is required: it is a channel handle, never an
// identity, and must never be treatable as one.
const HANDLE_PATTERN = /^[A-Za-z0-9._-]{1,256}$/;
// A member UID / redeeming actor is an identity key. It must contain at least one
// letter, so a bare all-digit value (the shape of a telephone number) can never be
// accepted where a member identity is required — a phone can never masquerade as
// the member it proves a channel for.
const IDENTITY_PATTERN = /^[A-Za-z0-9._-]{1,256}$/;
const IDENTITY_REQUIRES_LETTER = /[A-Za-z]/;
// A code hash is a fixed-width lowercase hex digest (a SHA-256 hex string). This is
// the structural guarantee that the contract holds no plaintext code: a short
// numeric one-time code cannot satisfy this shape, so it can never be stored here.
const CODE_HASH_PATTERN = /^[a-f0-9]{64}$/;
// A fixed-width UTC instant restricted to real calendar dates (see isUtcTimestamp).
// Fixed-width UTC strings over real dates compare lexically exactly as they do
// chronologically, so expiry is decided by string comparison with no clock.
const UTC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

// A generous upper bound on the attempt budget. It rejects Infinity, NaN, floats,
// negatives, and absurd values; keeping it bounded also caps how many guesses any
// single challenge can ever permit, independent of caller policy.
const MAX_ATTEMPT_LIMIT = 1000;

function isHandleString(value) {
  return typeof value === 'string' && HANDLE_PATTERN.test(value);
}

function isIdentityString(value) {
  return typeof value === 'string'
    && IDENTITY_PATTERN.test(value)
    && IDENTITY_REQUIRES_LETTER.test(value);
}

function isCodeHashString(value) {
  return typeof value === 'string' && CODE_HASH_PATTERN.test(value);
}

function isAttemptCount(value, min) {
  return Number.isSafeInteger(value) && value >= min && value <= MAX_ATTEMPT_LIMIT;
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
  // the fixed-width lexical comparison used for expiry provably agree with
  // chronological order: an impossible day (a non-leap Feb 29, Feb 30/31, Apr/Jun/
  // Sep/Nov 31) would, if interpreted as an instant, roll forward past where it sorts
  // lexically, so lexical order would stop matching chronological order. Rejecting it
  // as malformed keeps the equivalence exact — and since malformed denies, this only
  // ever withholds a verification, never enables one.
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

// Validate the durable server-side verification challenge.
function readChallenge(value) {
  const challenge = readExact(value, CHALLENGE_FIELDS);
  if (!challenge) return null;
  if (challenge.verificationSchemaVersion !== verificationSchemaVersion) return null;
  if (!isHandleString(challenge.challengeRef)) return null;
  if (!isIdentityString(challenge.memberRef)) return null;
  if (!isHandleString(challenge.phoneRef)) return null;
  if (!isCodeHashString(challenge.codeHash)) return null;
  // issuedAt is validated for whole-record well-formedness and audit context (a
  // corrupt field rejects the record wholesale rather than being partially trusted),
  // but it is not itself a decision input: the temporal gate compares the attempt's
  // asOf against expiresAt. It is deliberately NOT used as a lower bound on asOf, so
  // benign clock skew between the issuing and redeeming clocks can never withhold a
  // legitimate, unexpired verification.
  if (!isUtcTimestamp(challenge.issuedAt)) return null;
  if (!isUtcTimestamp(challenge.expiresAt)) return null;
  if (!isAttemptCount(challenge.maxAttempts, 1)) return null;
  if (!isAttemptCount(challenge.attemptsMade, 0)) return null;
  if (typeof challenge.status !== 'string' || !REDEMPTION_STATUS_SET.has(challenge.status)) return null;
  return challenge;
}

// Validate one redemption attempt. `providedCodeHash` is the hash of the code the
// user supplied, computed by the caller the same way as the stored `codeHash` — the
// reducer never sees a plaintext code.
function readAttempt(value) {
  const attempt = readExact(value, ATTEMPT_FIELDS);
  if (!attempt) return null;
  if (attempt.verificationSchemaVersion !== verificationSchemaVersion) return null;
  if (!isHandleString(attempt.challengeRef)) return null;
  if (!isIdentityString(attempt.actor)) return null;
  if (!isCodeHashString(attempt.providedCodeHash)) return null;
  if (!isUtcTimestamp(attempt.asOf)) return null;
  return attempt;
}

// ---- verdict constructors ------------------------------------------------

const DENIALS = Object.freeze(Object.fromEntries(
  DENIAL_REASONS.map((reason) => [reason, Object.freeze({ decision: 'denied', reason })]),
));

// Rejections that leave the challenge state untouched are context-free singletons.
const REJECTS_NO_CHANGE = Object.freeze(Object.fromEntries(
  REJECT_NO_CHANGE_REASONS.map((reason) => [reason, Object.freeze({ decision: 'rejected', reason })]),
));

function deny(reason) {
  return DENIALS[reason];
}

function rejectNoChange(reason) {
  return REJECTS_NO_CHANGE[reason];
}

// A dead challenge (expired, or exhausted while still pending) transitions to the
// terminal `voided` state; the attempt count is left as-is (neither reason is a
// guess against the code).
function voidChallenge(challenge, reason) {
  return Object.freeze({
    decision: 'rejected',
    reason,
    next: Object.freeze({
      challengeRef: challenge.challengeRef,
      status: 'voided',
      attemptsMade: challenge.attemptsMade,
    }),
  });
}

// A wrong code consumes exactly one attempt; the miss that reaches the budget voids
// the challenge so it can never be retried.
function consumeAttempt(challenge) {
  const attemptsMade = challenge.attemptsMade + 1;
  const status = attemptsMade < challenge.maxAttempts ? 'pending' : 'voided';
  return Object.freeze({
    decision: 'rejected',
    reason: 'code_mismatch',
    next: Object.freeze({
      challengeRef: challenge.challengeRef,
      status,
      attemptsMade,
    }),
  });
}

// A correct, current, in-budget redemption by the owning member. The challenge
// becomes `verified` (one-use), and the verdict carries a non-secret `proof` that
// this member controls this phone channel — and nothing else.
function accept(challenge) {
  return Object.freeze({
    decision: 'accepted',
    reason: 'verified',
    next: Object.freeze({
      challengeRef: challenge.challengeRef,
      status: 'verified',
      attemptsMade: challenge.attemptsMade,
    }),
    proof: Object.freeze({
      memberRef: challenge.memberRef,
      phoneRef: challenge.phoneRef,
    }),
  });
}

// ---- the decision --------------------------------------------------------

function classifyWhatsappVerificationRedemption(challengeEvidence, attemptEvidence) {
  const challenge = readChallenge(challengeEvidence);
  if (!challenge) return deny('malformed_challenge');
  const attempt = readAttempt(attemptEvidence);
  if (!attempt) return deny('malformed_attempt');

  // Challenge-bound: an attempt may only redeem the challenge it names. Compared
  // first so an attempt aimed at another challenge can never touch this one.
  if (attempt.challengeRef !== challenge.challengeRef) return rejectNoChange('challenge_mismatch');

  // One-use: a terminal challenge never redeems again, and reports no attempt/code
  // detail. `verified` and `voided` are both dead ends.
  if (challenge.status === 'verified') return rejectNoChange('already_verified');
  if (challenge.status === 'voided') return rejectNoChange('challenge_voided');
  // From here the challenge is `pending`.

  // Owner-bound: only the member the challenge was issued for may redeem it. A
  // different actor changes NO state — it cannot verify, and cannot burn the
  // owner's attempt budget (so it cannot grief the owner into a lockout either).
  if (attempt.actor !== challenge.memberRef) return rejectNoChange('actor_mismatch');

  // Short-lived: an expired challenge is dead regardless of the code. Checked BEFORE
  // the code compare so a correct-but-late code cannot verify. Exclusive: `asOf` at
  // exactly `expiresAt` is already expired.
  if (!(attempt.asOf < challenge.expiresAt)) return voidChallenge(challenge, 'expired');

  // Attempt-bounded: a pending challenge with no attempts left is exhausted. This is
  // a defensive branch — the miss that consumed the last attempt already voids the
  // challenge below — that also refuses to honor even a correct code once the budget
  // is spent.
  if (!(challenge.attemptsMade < challenge.maxAttempts)) return voidChallenge(challenge, 'too_many_attempts');

  // Compare the supplied code by hash. Both sides are fixed-width digests of the
  // high-entropy one-time code; the reducer holds no plaintext code. (A timing-safe
  // comparison of the underlying value is the caller's concern; at the hash level a
  // match/no-match timing signal does not help recover the code.)
  if (attempt.providedCodeHash !== challenge.codeHash) return consumeAttempt(challenge);

  // Correct code, not expired, attempts remaining, owning member, pending challenge:
  // the member controls the phone channel. Verify (one-use) and emit the proof.
  return accept(challenge);
}

module.exports = Object.freeze({
  verificationSchemaVersion,
  RedemptionStatus,
  RedemptionDecision,
  AcceptReason,
  RejectReason,
  DenialReason,
  classifyWhatsappVerificationRedemption,
});
