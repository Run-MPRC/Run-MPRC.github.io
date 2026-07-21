'use strict';

// MEMBERS-DUES-001C — pure verified-payment-reversal → suspended-term decision (pure contract).
//
// SOURCE ONLY, UNUSED: this module is imported by nothing (not by
// functions/index.js, no route, no Firestore Rules, no callable, no webhook, no
// scheduled worker). It has zero runtime behavior. It is the money-critical,
// access-critical decision core for the reversal half of parent #114
// (MEMBERS-DUES-001) — "a verified refund or dispute removes membership access" —
// landed and exhaustively negative-tested first so the eventual webhook wiring is a
// mechanical hookup of already-proven invariants. See SYSTEM_DESIGN.md §8.18.
//
// It is the exact MIRROR of the shipped activation contract membershipDuesPayment.js
// (MEMBERS-DUES-001B): where that reconciles a verified `paid` outcome into an
// APPROVED-term decision, this reconciles a verified refund/dispute reversal of the
// activating payment into a SUSPENDED-term decision — the same `record_term_decision`
// command the shipped authority reducer accepts, with `termState: 'suspended'`
// (which deriveMembershipEntitlement resolves to `inactive`). It is the reversal
// counterpart the dues lifecycle needs so a clawed-back payment does not leave a
// member entitled.
//
// What it decides: given the server-approved snapshot of the CURRENTLY-APPROVED term
// to protect (the record that fixes WHICH membership, term, plan, realm, provider
// account, and — critically — WHICH activating payment and amount the server
// authorized) and one ALREADY-VERIFIED provider reversal outcome, whether that
// reversal justifies suspending the term — accept, emitting the reducer command + an
// audit record — or is rejected as not justifying suspension (a cross-payment or
// partial reversal), or denied as malformed.
//
// Why non-throwing (like its activation twin, unlike the manual projector): a
// reversal that is verified-but-partial, cross-account, cross-payment, or
// realm-mismatched is a NORMAL event a webhook will see and must resolve to a safe
// reason-coded "do not suspend" verdict, never an exception a webhook handler must
// catch (which risks retry storms and conflates "business says no" with "input is
// malformed"). So this is a non-throwing frozen-verdict reducer (the idiom of
// §8.14/§8.15/§8.16/§8.17) and NEVER throws.
//
// Safety model:
//   * Full-reversal-only (server-authoritative amount): suspension requires the
//     VERIFIED reversedAmountMinor to exactly equal the SERVER-APPROVED
//     activatingAmountMinor and the currency to match; a partial (or over-) reversal
//     rejects `amount_mismatch` and is surfaced for manual handling — never silently
//     suspended and never silently ignored. The reducer invents neither value.
//   * Payment-bound: the reversal must be of the EXACT payment (paymentRef) that
//     activated this term; a refund/dispute of some other payment rejects
//     `payment_mismatch` and suspends nothing. Removing access is bound to reversing
//     the specific charge that granted it.
//   * Realm-isolated, account-bound, checkout-bound: the reversal must be about the
//     SAME checkout, from the SAME provider account, in the SAME live/test realm the
//     server authorized; a cross-* event suspends nothing.
//   * Typed reversal: only a well-formed reversalType (`refund` or `dispute`) is read,
//     and BOTH suspend; an unrecognized type is `malformed_outcome`, never silently
//     treated as non-reversing. reversalType is carried into the audit for the trail
//     and is the accept reason, but it never changes the verdict logic.
//   * Invents no policy / fabricates no term state: every owner-meaningful value
//     (termId, planRef, term window, revisions, policyVersion) is carried opaquely
//     from the server-approved expectation; the reducer decides only consistency, and
//     on accept emits the exact `record_term_decision` (termState `suspended`) the
//     shipped authority reducer accepts.
//   * Idempotency/ordering delegated, not faked: the emitted command carries
//     expectedRevision/termRevision faithfully; duplicate and out-of-order suppression
//     is the downstream authority reducer's revision-guarded optimistic-concurrency
//     job (re-applying the same suspend is a read-only no-op there, and a stale
//     snapshot fails its revision check), not re-implemented or weakened here.
//   * Revokes nothing directly: an accept emits a COMMAND the caller must
//     transactionally apply plus an audit record; by itself it changes no auth, role,
//     or entitlement, and holds no card/PII/secret (only opaque refs, integer minor
//     units, a currency code, and the provider reversal reference audit handle).
//   * Hostile-input-safe: every field of each record is read through an own-enumerable
//     data descriptor with no getter ever invoked; a proxy, foreign prototype,
//     inherited/extra/missing/symbol key, or out-of-shape value denies as malformed
//     rather than being partially interpreted.
//
// Both error directions are real: a false suspend wrongly ejects a paying member; a
// false non-suspend lets a refunded or charged-back member keep access. So the accept
// path is bound tight (exact activating payment AND exact full amount) and every
// not-quite-matching reversal is a surfaced, reason-coded refusal.
//
// Requires only node:util. Reads no clock, env, network, Firestore, or provider. The
// provider signature check and canonical reversal-status derivation are upstream
// (PAY-003); this contract CONSUMES a verified outcome, exactly as the activation
// twin does not re-authenticate the payment.

const {
  types: { isProxy },
} = require('node:util');

const membershipDuesReversalSchemaVersion = 1;
// The shipped authority reducer's command schema version, re-declared locally so this
// contract stays standalone. The integration test imports the real reducer and feeds
// it the emitted command, so this constant cannot silently drift from it.
const MEMBERSHIP_AUTHORITY_SCHEMA_VERSION = 1;

// Structural constants this slice always emits; none is an owner policy value.
const RECORD_TERM_DECISION_COMMAND_TYPE = 'record_term_decision';
const SUSPENDED_TERM_STATE = 'suspended';
const VERIFIED_PAYMENT_REVERSAL_PROVENANCE = 'verified_payment_reversal';

function immutableEnum(values) {
  return Object.freeze(Object.fromEntries(values.map((v) => [v.toUpperCase(), v])));
}

// ---- closed vocabularies -------------------------------------------------

// The verified provider reversal type. BOTH suspend; the value is carried into the
// audit and is the accept reason, but never branches the verdict logic. An
// out-of-vocabulary value is malformed_outcome (a caller/upstream bug), not a
// non-reversing business event.
const REVERSAL_TYPES = ['refund', 'dispute'];
const DUES_DECISIONS = ['accepted', 'rejected', 'denied'];
// Every well-formed reversal type is an accept reason — both a refund and a dispute of
// the exact activating payment, in full, justify suspension. reason === reversalType.
const ACCEPT_REASONS = REVERSAL_TYPES;
// Every rejection changes no state and emits no command — a rejected reversal simply
// does not justify suspension. Ordered by the decision precedence (identity → payment
// → realm → currency → amount).
const REJECT_REASONS = [
  'checkout_mismatch',
  'account_mismatch',
  'realm_mismatch',
  'payment_mismatch',
  'currency_mismatch',
  'amount_mismatch',
];
const DENIAL_REASONS = ['malformed_expectation', 'malformed_outcome'];

const ReversalType = immutableEnum(REVERSAL_TYPES);
const DuesDecision = immutableEnum(DUES_DECISIONS);
const AcceptReason = immutableEnum(ACCEPT_REASONS);
const RejectReason = immutableEnum(REJECT_REASONS);
const DenialReason = immutableEnum(DENIAL_REASONS);

const REVERSAL_TYPE_SET = new Set(REVERSAL_TYPES);

// ---- record shapes -------------------------------------------------------

// The server-approved snapshot of the currently-approved term to protect — the
// authority on WHICH membership/term/plan/realm/account AND which activating
// payment+amount is being reversed. Every owner-meaningful value is opaque here and
// carried through verbatim; the reducer never decides what any of them SHOULD be.
const EXPECTATION_FIELDS = [
  'membershipDuesReversalSchemaVersion',
  'commandId',
  'membershipId',
  'termId',
  'termRevision',
  'expectedRevision',
  'planRef',
  'policyVersion',
  'checkoutRef',
  'providerAccountRef',
  'paymentRef',
  'livemode',
  'activatingAmountMinor',
  'currency',
  'startsAtMs',
  'endsAtMs',
];

// The already-verified provider reversal outcome — what the verified event reported.
// `reversalRef` is the reversal event's own handle (it becomes the suspend command's
// evidenceRef); `paymentRef` is the payment being reversed (must equal the activating
// payment). `observedAtMs` is carried into the audit record only and is NEVER a
// decision input.
const OUTCOME_FIELDS = [
  'membershipDuesReversalSchemaVersion',
  'reversalType',
  'checkoutRef',
  'providerAccountRef',
  'paymentRef',
  'reversalRef',
  'livemode',
  'reversedAmountMinor',
  'currency',
  'observedAtMs',
];

// An opaque, url-safe handle for every owner-meaningful reference. This is the same
// shape the shipped authority reducer accepts for the command fields it carries
// (commandId, termId, planRef, evidenceRef, policyVersion), so a value that passes here
// is a value that command reducer accepts — proven by the integration test.
const OPAQUE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
// A structural 3-letter lowercase currency-code shape. This is NOT a policy about which
// currencies are allowed: the reducer only checks the outcome currency equals the
// expectation currency; it never interprets or branches on which currency it is.
const CURRENCY_PATTERN = /^[a-z]{3}$/;

const MAX_TIME_MS = 8_640_000_000_000_000;
// A generous upper bound on a monetary amount in minor units. It rejects Infinity, NaN,
// floats, and negatives; the exact-match check is what actually gates suspension, so the
// bound is only a structural sanity guard.
const MAX_AMOUNT_MINOR = 1_000_000_000_000;

function isOpaqueIdentifier(value) {
  return typeof value === 'string' && OPAQUE_IDENTIFIER_PATTERN.test(value);
}

function isCurrencyCode(value) {
  return typeof value === 'string' && CURRENCY_PATTERN.test(value);
}

function isReversalType(value) {
  return typeof value === 'string' && REVERSAL_TYPE_SET.has(value);
}

function isRevision(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function isAmountMinor(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_AMOUNT_MINOR;
}

function isTimeMs(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME_MS;
}

function isBoolean(value) {
  return value === true || value === false;
}

// Read an exact, closed record: an ordinary object whose own string-keyed properties
// are precisely `expectedFields`, each an enumerable data property. Returns a
// null-prototype copy read with no getter ever invoked, or null on any deviation
// (proxy, array, foreign prototype, symbol key, wrong key count, missing, extra —
// enumerable OR non-enumerable — inherited, accessor, or non-enumerable field).
function readExact(value, expectedFields) {
  if (value === null || typeof value !== 'object') return null;
  // isProxy before Array.isArray: Array.isArray throws on a revoked proxy, while
  // isProxy safely reports it as a proxy (which this rejects). Order matters for
  // total, never-throwing behavior.
  if (isProxy(value)) return null;
  if (Array.isArray(value)) return null;
  if (Object.getPrototypeOf(value) !== Object.prototype) return null;
  if (Object.getOwnPropertySymbols(value).length !== 0) return null;
  // Own property NAMES, not just enumerable keys: a non-enumerable extra own property
  // must also deny — it is invisible to Object.keys but would still make the record
  // something other than the exact closed shape. With symbols already rejected, this
  // bounds the total own-key surface to exactly `expectedFields`.
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

// Validate the server-approved expectation snapshot.
function readExpectation(value) {
  const e = readExact(value, EXPECTATION_FIELDS);
  if (!e) return null;
  if (e.membershipDuesReversalSchemaVersion !== membershipDuesReversalSchemaVersion) return null;
  if (!isOpaqueIdentifier(e.commandId)) return null;
  if (!isOpaqueIdentifier(e.membershipId)) return null;
  if (!isOpaqueIdentifier(e.termId)) return null;
  if (!isRevision(e.termRevision)) return null;
  if (!isRevision(e.expectedRevision)) return null;
  if (!isOpaqueIdentifier(e.planRef)) return null;
  if (!isOpaqueIdentifier(e.policyVersion)) return null;
  if (!isOpaqueIdentifier(e.checkoutRef)) return null;
  if (!isOpaqueIdentifier(e.providerAccountRef)) return null;
  if (!isOpaqueIdentifier(e.paymentRef)) return null;
  if (!isBoolean(e.livemode)) return null;
  if (!isAmountMinor(e.activatingAmountMinor)) return null;
  if (!isCurrencyCode(e.currency)) return null;
  if (!isTimeMs(e.startsAtMs)) return null;
  if (!isTimeMs(e.endsAtMs)) return null;
  // A term must occupy a non-empty forward window; the shipped authority reducer
  // enforces the same, so an ill-ordered window could never be written anyway.
  if (!(e.startsAtMs < e.endsAtMs)) return null;
  return e;
}

// Validate the already-verified provider reversal outcome.
function readOutcome(value) {
  const o = readExact(value, OUTCOME_FIELDS);
  if (!o) return null;
  if (o.membershipDuesReversalSchemaVersion !== membershipDuesReversalSchemaVersion) return null;
  if (!isReversalType(o.reversalType)) return null;
  if (!isOpaqueIdentifier(o.checkoutRef)) return null;
  if (!isOpaqueIdentifier(o.providerAccountRef)) return null;
  if (!isOpaqueIdentifier(o.paymentRef)) return null;
  if (!isOpaqueIdentifier(o.reversalRef)) return null;
  if (!isBoolean(o.livemode)) return null;
  if (!isAmountMinor(o.reversedAmountMinor)) return null;
  if (!isCurrencyCode(o.currency)) return null;
  // Validated for whole-record well-formedness and audit context, but never a decision
  // input: the reducer branches on no time value at all (the term window is carried
  // opaquely and enforced downstream).
  if (!isTimeMs(o.observedAtMs)) return null;
  return o;
}

// ---- verdict constructors ------------------------------------------------

const DENIALS = Object.freeze(Object.fromEntries(
  DENIAL_REASONS.map((reason) => [reason, Object.freeze({ decision: 'denied', reason })]),
));

// Every rejection is context-free (it carries no command and no echo of the activating
// amount), so the verdicts are frozen singletons.
const REJECTS = Object.freeze(Object.fromEntries(
  REJECT_REASONS.map((reason) => [reason, Object.freeze({ decision: 'rejected', reason })]),
));

function deny(reason) {
  return DENIALS[reason];
}

function reject(reason) {
  return REJECTS[reason];
}

// A verified, full, consistent reversal of the exact activating payment. Emits the
// byte-exact `record_term_decision` command the shipped authority reducer accepts, with
// `termState: 'suspended'` (the reversal event's reversalRef is the term's suspension
// evidence, so it becomes the command's evidenceRef — the reversal analogue of the
// activation path's payment pointer) plus a provenance-stamped audit record.
function accept(expectation, outcome) {
  const reducerCommand = Object.freeze({
    membershipAuthoritySchemaVersion: MEMBERSHIP_AUTHORITY_SCHEMA_VERSION,
    commandType: RECORD_TERM_DECISION_COMMAND_TYPE,
    commandId: expectation.commandId,
    expectedRevision: expectation.expectedRevision,
    termRevision: expectation.termRevision,
    termState: SUSPENDED_TERM_STATE,
    termId: expectation.termId,
    startsAtMs: expectation.startsAtMs,
    endsAtMs: expectation.endsAtMs,
    planRef: expectation.planRef,
    evidenceRef: outcome.reversalRef,
    policyVersion: expectation.policyVersion,
  });

  const auditRecord = Object.freeze({
    membershipDuesReversalSchemaVersion,
    provenance: VERIFIED_PAYMENT_REVERSAL_PROVENANCE,
    membershipId: expectation.membershipId,
    commandId: expectation.commandId,
    reversalType: outcome.reversalType,
    checkoutRef: expectation.checkoutRef,
    providerAccountRef: expectation.providerAccountRef,
    livemode: expectation.livemode,
    paymentRef: outcome.paymentRef,
    reversalRef: outcome.reversalRef,
    reversedAmountMinor: outcome.reversedAmountMinor,
    currency: outcome.currency,
    observedAtMs: outcome.observedAtMs,
    termId: expectation.termId,
    termState: SUSPENDED_TERM_STATE,
    startsAtMs: expectation.startsAtMs,
    endsAtMs: expectation.endsAtMs,
    planRef: expectation.planRef,
    policyVersion: expectation.policyVersion,
  });

  return Object.freeze({
    decision: 'accepted',
    reason: outcome.reversalType,
    reducerCommand,
    auditRecord,
  });
}

// ---- the decision --------------------------------------------------------

function classifyVerifiedDuesReversal(expectationEvidence, outcomeEvidence) {
  const expectation = readExpectation(expectationEvidence);
  if (!expectation) return deny('malformed_expectation');
  const outcome = readOutcome(outcomeEvidence);
  if (!outcome) return deny('malformed_outcome');

  // Identity first: the verified reversal must be about the exact checkout the server
  // authorized. An event for another checkout can never touch this term.
  if (outcome.checkoutRef !== expectation.checkoutRef) return reject('checkout_mismatch');
  // ...and it must come from the same provider account the server authorized (an
  // anti-cross-account guard), before any payment fact is considered.
  if (outcome.providerAccountRef !== expectation.providerAccountRef) return reject('account_mismatch');
  // Realm isolation: a test-mode reversal can never suspend a live membership and vice
  // versa. Checked before payment/amount so a wrong-realm event learns nothing about them.
  if (outcome.livemode !== expectation.livemode) return reject('realm_mismatch');
  // Payment-bound: the reversal must be of the EXACT payment that activated this term.
  // A refund/dispute of some other payment suspends nothing.
  if (outcome.paymentRef !== expectation.paymentRef) return reject('payment_mismatch');
  // Full-reversal-only: currency before amount (amounts are meaningless across
  // currencies), then an EXACT match — a partial (or over-) reversal rejects and is
  // surfaced for manual handling rather than auto-suspending or being ignored.
  if (outcome.currency !== expectation.currency) return reject('currency_mismatch');
  if (outcome.reversedAmountMinor !== expectation.activatingAmountMinor) return reject('amount_mismatch');

  // Verified, same checkout/account/realm/payment, exact currency and full amount: this
  // reversal justifies suspending the term. Emit the command and the audit.
  return accept(expectation, outcome);
}

module.exports = Object.freeze({
  membershipDuesReversalSchemaVersion,
  ReversalType,
  DuesDecision,
  AcceptReason,
  RejectReason,
  DenialReason,
  classifyVerifiedDuesReversal,
});
