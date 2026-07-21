'use strict';

// WHATSAPP-002B — pure one-time verification-code issuance decision (pure contract).
//
// SOURCE ONLY, UNUSED: this module is imported by nothing (not by
// functions/index.js, no route, no Firestore Rules, no callable, no scheduled
// worker). It has zero runtime behavior. It is the anti-abuse decision core for
// the *issuance* half of parent #87 (WHATSAPP-002) — "generate a one-time server
// code ... make it short-lived, one-use, RATE/ATTEMPT LIMITED, and App Check
// protected" — the half §8.16 (the redemption reducer) explicitly leaves with #87.
// It is landed and exhaustively negative-tested first so the eventual wiring is a
// mechanical hookup of already-proven invariants. See SYSTEM_DESIGN.md §8.23.
//
// What it decides: given one request to issue a verification code for a
// (member, phone) pair and the issuance-relevant projection of the durable
// challenge the server already has for that pair (or `null` when there is none),
// whether the server may issue a new one-time code now — `issue` (fresh, or
// superseding a still-live prior challenge) — or must refuse (not the owner, phone
// already verified, or still inside the reissue cooldown), or deny as malformed. It
// is a non-throwing frozen-verdict reducer (the idiom of §8.15/§8.16/§8.22) and
// NEVER throws.
//
// It composes with — and is strictly distinct from — the §8.16 redemption reducer.
// §8.16 bounds how many GUESSES a single challenge permits (per-challenge attempt
// budget, one-use, expiry). This reducer bounds how many CHALLENGES exist and how
// FAST they may be minted for a (member, phone): a cooldown that gates BOTH a
// pending resend AND a post-void reissue (so §8.16's attempt budget cannot be reset
// faster than the owner's cooldown — closing the exhaust→void→reissue loop), and a
// supersession rule so at most one live challenge exists per pair (no parallel
// challenges multiplying the total guess budget). Redemption without issuance
// leaves those two abuse vectors open; this contract closes them.
//
// Holds NO code, NO hash, mints NOTHING. The one-time code, its hash, the new
// challenge reference, the code lifetime, the attempt budget, and the next cooldown
// are all the caller's to mint and apply after an `issue` verdict — this reducer
// only decides the disposition. `supersededChallengeRef` on an `issue: superseding`
// verdict names an EXISTING challenge the caller must void; it is not a minted
// value. There is no code / secret / token / bearer vocabulary anywhere in the
// source, and a source-boundary test enforces that absence.
//
// Confers nothing: an `issue` verdict authorizes sending a code — it grants no
// Firebase auth, membership, discount, or role, and does not itself prove control
// of the phone (that is §8.16's job, later). The phone is a channel handle (a bare
// all-digit value is fine); the member and the requesting actor are letter-requiring
// identities, so a phone number can never masquerade as the member it is a code for.
//
// Invents no policy: the cooldown DURATION, the code lifetime, and the attempt
// budget are owner policy. The caller supplies the already-computed `reissueAfter`
// and `expiresAt` instants; this reducer only enforces the gates by lexical UTC
// comparison. It sets no threshold of its own (cf. the #114 owner-decision rule).
//
// Safety model:
//   * Owner-bound: only the signed-in member may request a code for their own
//     verification (`actor` must equal `memberRef`); a mismatch is `actor_not_owner`
//     and issues nothing, so no one can trigger a code-send to a phone on another
//     member's behalf (the enumeration / cross-account abuse guard). Checked before
//     any challenge state is consulted, so an unauthorized requester learns nothing.
//   * Idempotent on verified: a (member, phone) whose challenge is already `verified`
//     never issues another code (`already_verified`) — no reverify spam, and no code
//     re-sent to an already-linked number.
//   * Cooldown-bounded (anti-brute-force-loop): a request before the challenge's
//     `reissueAfter` is `cooldown_active` and issues nothing. The gate applies to a
//     `voided` prior as much as a `pending` one, so exhausting §8.16's attempt budget
//     and immediately reissuing to get a fresh budget is refused until the cooldown
//     elapses.
//   * At-most-one-live-challenge: issuing while a `pending`, not-yet-expired
//     challenge exists is `issue: superseding` and names that challenge as
//     `supersededChallengeRef` for the caller to void — so parallel live challenges
//     (which would multiply the total guess budget for one pair) never accumulate.
//   * Subject-bound: the supplied current challenge must describe the same
//     (member, phone) as the request; an unrelated challenge is `subject_mismatch`
//     and issues nothing — an issuance decision is never made from another pair's
//     challenge.
//   * Mints nothing / content-free: the verdict carries only the subject
//     (member/phone the code is for) and, when superseding, the ref of the challenge
//     to void — never a code, a hash, a new challenge id, or a policy value.
//   * Clockless: the cooldown and liveness gates compare `asOf` against
//     `reissueAfter` / `expiresAt` by lexical UTC string comparison over
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

const verificationIssuanceSchemaVersion = 1;

function immutableEnum(values) {
  return Object.freeze(Object.fromEntries(values.map((v) => [v.toUpperCase(), v])));
}

// ---- closed vocabularies -------------------------------------------------

// The issuance-relevant projection of the durable challenge's lifecycle state,
// mirroring §8.16: `pending` may still be redeemed; `verified` and `voided` are
// terminal. This reducer reads the status only to decide idempotency (verified) and
// whether a live challenge must be superseded (pending + unexpired).
const ISSUANCE_STATUSES = ['pending', 'verified', 'voided'];
const ISSUANCE_DECISIONS = ['issue', 'refuse', 'denied'];
// `fresh` — no live challenge to replace (none, terminal, or expired prior).
// `superseding` — a still-live pending challenge is being replaced; the verdict
// names it so the caller voids it (at most one live challenge per pair).
const ISSUE_REASONS = ['fresh', 'superseding'];
// Well-formed requests that are nonetheless not issued; all change NO state.
const REFUSE_REASONS = [
  'actor_not_owner',
  'subject_mismatch',
  'already_verified',
  'cooldown_active',
];
const DENIAL_REASONS = ['malformed_request', 'malformed_current_challenge'];

const IssuanceStatus = immutableEnum(ISSUANCE_STATUSES);
const IssuanceDecision = immutableEnum(ISSUANCE_DECISIONS);
const IssueReason = immutableEnum(ISSUE_REASONS);
const RefuseReason = immutableEnum(REFUSE_REASONS);
const DenialReason = immutableEnum(DENIAL_REASONS);

const ISSUANCE_STATUS_SET = new Set(ISSUANCE_STATUSES);

// ---- record shapes -------------------------------------------------------

const REQUEST_FIELDS = [
  'verificationIssuanceSchemaVersion',
  'memberRef',
  'phoneRef',
  'actor',
  'asOf',
];
// The issuance-relevant projection of the durable challenge — NOT the full §8.16
// record. The caller projects the stored challenge into exactly these fields; the
// contract validates its own closed shape (a raw §8.16 challenge, with a different
// field set and schema-version key, denies as malformed rather than being partly
// read).
const CURRENT_CHALLENGE_FIELDS = [
  'verificationIssuanceSchemaVersion',
  'challengeRef',
  'memberRef',
  'phoneRef',
  'status',
  'expiresAt',
  'reissueAfter',
];

// A challenge handle and a phone/WhatsApp channel identifier are both opaque,
// url-safe handles. A normalized phone number is legitimately all digits, so — like
// a provider account id — no letter is required: it is a channel handle, never an
// identity, and must never be treatable as one.
const HANDLE_PATTERN = /^[A-Za-z0-9._-]{1,256}$/;
// A member UID / requesting actor is an identity key. It must contain at least one
// letter, so a bare all-digit value (the shape of a telephone number) can never be
// accepted where a member identity is required — a phone can never masquerade as
// the member a code is being issued for.
const IDENTITY_PATTERN = /^[A-Za-z0-9._-]{1,256}$/;
const IDENTITY_REQUIRES_LETTER = /[A-Za-z]/;
// A fixed-width UTC instant restricted to real calendar dates (see isUtcTimestamp).
// Fixed-width UTC strings over real dates compare lexically exactly as they do
// chronologically, so the cooldown and liveness gates are decided by string
// comparison with no clock.
const UTC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

function isHandleString(value) {
  return typeof value === 'string' && HANDLE_PATTERN.test(value);
}

function isIdentityString(value) {
  return typeof value === 'string'
    && IDENTITY_PATTERN.test(value)
    && IDENTITY_REQUIRES_LETTER.test(value);
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
  // the fixed-width lexical comparison used for the gates provably agree with
  // chronological order: an impossible day (a non-leap Feb 29, Feb 30/31, Apr/Jun/
  // Sep/Nov 31) would, if interpreted as an instant, roll forward past where it sorts
  // lexically, so lexical order would stop matching chronological order. Rejecting it
  // as malformed keeps the equivalence exact — and since malformed denies, this only
  // ever withholds an issuance, never enables one past a cooldown.
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

// Validate one issuance request.
function readRequest(value) {
  const request = readExact(value, REQUEST_FIELDS);
  if (!request) return null;
  if (request.verificationIssuanceSchemaVersion !== verificationIssuanceSchemaVersion) return null;
  if (!isIdentityString(request.memberRef)) return null;
  if (!isHandleString(request.phoneRef)) return null;
  if (!isIdentityString(request.actor)) return null;
  if (!isUtcTimestamp(request.asOf)) return null;
  return request;
}

// Validate the issuance-relevant projection of the durable challenge.
function readCurrentChallenge(value) {
  const challenge = readExact(value, CURRENT_CHALLENGE_FIELDS);
  if (!challenge) return null;
  if (challenge.verificationIssuanceSchemaVersion !== verificationIssuanceSchemaVersion) return null;
  if (!isHandleString(challenge.challengeRef)) return null;
  if (!isIdentityString(challenge.memberRef)) return null;
  if (!isHandleString(challenge.phoneRef)) return null;
  if (typeof challenge.status !== 'string' || !ISSUANCE_STATUS_SET.has(challenge.status)) return null;
  if (!isUtcTimestamp(challenge.expiresAt)) return null;
  if (!isUtcTimestamp(challenge.reissueAfter)) return null;
  return challenge;
}

// ---- verdict constructors ------------------------------------------------

const DENIALS = Object.freeze(Object.fromEntries(
  DENIAL_REASONS.map((reason) => [reason, Object.freeze({ decision: 'denied', reason })]),
));

// Every refusal leaves all state untouched — issues nothing, supersedes nothing —
// so each is a context-free frozen singleton.
const REFUSALS = Object.freeze(Object.fromEntries(
  REFUSE_REASONS.map((reason) => [reason, Object.freeze({ decision: 'refuse', reason })]),
));

function deny(reason) {
  return DENIALS[reason];
}

function refuse(reason) {
  return REFUSALS[reason];
}

// Issue a fresh code — no live challenge to replace (no prior, or the prior is
// terminal or expired). The verdict carries only the subject the code is for and
// mints nothing.
function issueFresh(request) {
  return Object.freeze({
    decision: 'issue',
    reason: 'fresh',
    subject: Object.freeze({
      memberRef: request.memberRef,
      phoneRef: request.phoneRef,
    }),
  });
}

// Issue a code that supersedes a still-live pending challenge. Names the prior
// challenge so the caller voids it, keeping at most one live challenge per pair.
function issueSuperseding(request, challenge) {
  return Object.freeze({
    decision: 'issue',
    reason: 'superseding',
    subject: Object.freeze({
      memberRef: request.memberRef,
      phoneRef: request.phoneRef,
    }),
    supersededChallengeRef: challenge.challengeRef,
  });
}

// ---- the decision --------------------------------------------------------

function classifyWhatsappVerificationIssuance(requestEvidence, currentChallengeEvidence) {
  const request = readRequest(requestEvidence);
  if (!request) return deny('malformed_request');
  // A literal `null` is the sole "no challenge yet" signal and is NOT malformed;
  // anything else must be an exact well-formed projection. The request is read first,
  // so a malformed request outranks a malformed challenge.
  let challenge = null;
  if (currentChallengeEvidence !== null) {
    challenge = readCurrentChallenge(currentChallengeEvidence);
    if (!challenge) return deny('malformed_current_challenge');
  }

  // Owner-bound: authorization to trigger a code-send is the first semantic gate. An
  // actor who is not the member is refused before any challenge state is consulted,
  // so no one can trigger a send to a phone on another member's behalf and an
  // unauthorized requester learns nothing about the challenge.
  if (request.actor !== request.memberRef) return refuse('actor_not_owner');

  if (challenge !== null) {
    // Subject-bound: an issuance decision is never made from another pair's
    // challenge. The supplied projection must describe the same (member, phone).
    if (challenge.memberRef !== request.memberRef) return refuse('subject_mismatch');
    if (challenge.phoneRef !== request.phoneRef) return refuse('subject_mismatch');

    // Idempotent on verified: a proven pair never gets another code. Checked before
    // the cooldown so a verified pair reports `already_verified`, not `cooldown_active`.
    if (challenge.status === 'verified') return refuse('already_verified');

    // Cooldown-bounded: no new code until `reissueAfter`. Applies to a `voided` prior
    // as much as a `pending` one, so exhausting §8.16's attempt budget then reissuing
    // for a fresh budget is refused until the cooldown elapses. Inclusive: `asOf`
    // exactly at `reissueAfter` is allowed (the cooldown has elapsed).
    if (request.asOf < challenge.reissueAfter) return refuse('cooldown_active');

    // Permitted. A still-live pending challenge is superseded (and named for the
    // caller to void); a terminal or already-expired prior leaves nothing live, so
    // the issue is fresh. Liveness is exclusive: `asOf` at exactly `expiresAt` is
    // already expired, hence not live to supersede.
    if (challenge.status === 'pending' && request.asOf < challenge.expiresAt) {
      return issueSuperseding(request, challenge);
    }
  }

  return issueFresh(request);
}

module.exports = Object.freeze({
  verificationIssuanceSchemaVersion,
  IssuanceStatus,
  IssuanceDecision,
  IssueReason,
  RefuseReason,
  DenialReason,
  classifyWhatsappVerificationIssuance,
});
