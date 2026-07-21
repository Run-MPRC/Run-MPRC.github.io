'use strict';

// MEMBERS-DUES-001B — pure verified-online-dues-payment → approved-term decision (pure contract).
//
// SOURCE ONLY, UNUSED: this module is imported by nothing (not by
// functions/index.js, no route, no Firestore Rules, no callable, no webhook, no
// scheduled worker). It has zero runtime behavior. It is the money-critical
// decision core for item 3 of parent #114 (MEMBERS-DUES-001) — "a verified payment
// event activates or renews the membership term" — landed and exhaustively
// negative-tested first so the eventual webhook wiring is a mechanical hookup of
// already-proven invariants. See SYSTEM_DESIGN.md §8.17.
//
// It is the ONLINE counterpart to the shipped manual path membershipManualEvidence.js
// (MEMBERS-ADMIN-001A): where that projects an officer-attested off-platform
// evidence command into an approved-term decision, this reconciles a verified
// provider payment outcome into the SAME approved-term decision — the exact
// `record_term_decision` command the shipped authority reducer accepts. It is the
// "dues already confirmed for the term" step membershipAssociation.js documents it
// depends on but deliberately does not perform.
//
// What it decides: given the server-approved snapshot the dues checkout was created
// against (the record that fixes WHICH membership, term, plan, price, currency,
// realm, and provider account the server authorized) and one ALREADY-VERIFIED
// provider payment outcome, whether that outcome justifies activating/renewing the
// term — accept, emitting the reducer command + an audit record — or is rejected as
// not justifying activation, or denied as malformed.
//
// Why non-throwing (unlike the manual projector): the manual path is a pure
// projection with a single outcome, so a malformed envelope is a caller bug and
// throwing is right. The online path is a reduction with several LEGITIMATE non-error
// outcomes — a verified-but-unpaid, wrong-amount, cross-account, or test-mode event
// is a normal event a webhook will see and must resolve to a safe reason-coded "do
// not activate" verdict, never an exception a webhook handler must catch (which
// risks retry storms and conflates "business says no" with "input is malformed").
// So this is a non-throwing frozen-verdict reducer (the idiom of §8.14/§8.15/§8.16)
// and NEVER throws.
//
// Safety model:
//   * Server-authoritative price: activation requires the VERIFIED paidAmountMinor to
//     exactly equal the SERVER-APPROVED expectedAmountMinor and the currency to match;
//     underpay and overpay both reject. The reducer invents neither value — it
//     reconciles the server's expectation against the verified outcome (the browser or
//     the provider report never decides price).
//   * Paid-only: only paymentStatus `paid` activates; every other known status rejects
//     `not_paid`; an unrecognized status is `malformed_outcome`. No activation on a
//     non-paid or unrecognized event.
//   * Realm-isolated: a test-mode event can never activate a live membership and vice
//     versa (livemode must match) — test/live isolation at the decision boundary.
//   * Account-bound & checkout-bound: the verified event must be about the SAME
//     checkout and from the SAME provider account the server authorized; a
//     cross-checkout or cross-account event rejects and emits no command.
//   * Invents no policy / fabricates no charge state: every owner-meaningful value
//     (termId, planRef, price, term window, revisions, policyVersion) is carried
//     opaquely from the server-approved expectation; the reducer decides only
//     consistency, and on accept emits the exact `record_term_decision` the shipped
//     authority reducer accepts.
//   * Idempotency/ordering delegated, not faked: the emitted command carries
//     expectedRevision/termRevision faithfully; duplicate and out-of-order suppression
//     is the downstream authority reducer's revision-guarded optimistic-concurrency
//     job (re-applying the same command is a read-only no-op there), not re-implemented
//     or weakened here.
//   * Confers nothing directly: an accept emits a COMMAND the caller must
//     transactionally apply plus an audit record; by itself it grants no auth, role,
//     or entitlement, and holds no card/PII/secret (only opaque refs, integer minor
//     units, a currency code, and the provider payment reference audit handle).
//   * Hostile-input-safe: every field of each record is read through an own-enumerable
//     data descriptor with no getter ever invoked; a proxy, foreign prototype,
//     inherited/extra/missing/symbol key, or out-of-shape value denies as malformed
//     rather than being partially interpreted.
//
// Requires only node:util. Reads no clock, env, network, Firestore, or provider.
// The provider signature check and canonical payment-status derivation are upstream
// (PAY-003); this contract CONSUMES a verified outcome, exactly as the manual path
// does not re-authenticate the officer.

const {
  types: { isProxy },
} = require('node:util');

const membershipDuesPaymentSchemaVersion = 1;
// The shipped authority reducer's command schema version, re-declared locally so this
// contract stays standalone. The integration test imports the real reducer and feeds
// it the emitted command, so this constant cannot silently drift from it.
const MEMBERSHIP_AUTHORITY_SCHEMA_VERSION = 1;

// Structural constants this slice always emits; none is an owner policy value.
const RECORD_TERM_DECISION_COMMAND_TYPE = 'record_term_decision';
const APPROVED_TERM_STATE = 'approved';
const VERIFIED_ONLINE_PAYMENT_PROVENANCE = 'verified_online_payment';
const PAID_STATUS = 'paid';

function immutableEnum(values) {
  return Object.freeze(Object.fromEntries(values.map((v) => [v.toUpperCase(), v])));
}

// ---- closed vocabularies -------------------------------------------------

// The verified provider payment status. Only `paid` activates; the rest are known,
// non-activating outcomes (a normal event this reducer must reject, not throw on).
const PAYMENT_STATUSES = ['paid', 'unpaid', 'failed', 'pending', 'canceled'];
const DUES_DECISIONS = ['accepted', 'rejected', 'denied'];
const ACCEPT_REASONS = ['paid'];
// Every rejection changes no state and emits no command — a rejected event simply does
// not justify activation. Ordered by the decision precedence (identity → realm →
// status → currency → amount).
const REJECT_REASONS = [
  'checkout_mismatch',
  'account_mismatch',
  'realm_mismatch',
  'not_paid',
  'currency_mismatch',
  'amount_mismatch',
];
const DENIAL_REASONS = ['malformed_expectation', 'malformed_outcome'];

const PaymentStatus = immutableEnum(PAYMENT_STATUSES);
const DuesDecision = immutableEnum(DUES_DECISIONS);
const AcceptReason = immutableEnum(ACCEPT_REASONS);
const RejectReason = immutableEnum(REJECT_REASONS);
const DenialReason = immutableEnum(DENIAL_REASONS);

const PAYMENT_STATUS_SET = new Set(PAYMENT_STATUSES);

// ---- record shapes -------------------------------------------------------

// The server-approved snapshot the dues checkout was created against — the authority
// on WHICH membership/term/plan/price/currency/realm/account is being paid for. Every
// owner-meaningful value is opaque here and carried through verbatim; the reducer never
// decides what any of them SHOULD be.
const EXPECTATION_FIELDS = [
  'membershipDuesPaymentSchemaVersion',
  'commandId',
  'membershipId',
  'termId',
  'termRevision',
  'expectedRevision',
  'planRef',
  'policyVersion',
  'checkoutRef',
  'providerAccountRef',
  'livemode',
  'expectedAmountMinor',
  'currency',
  'startsAtMs',
  'endsAtMs',
];

// The already-verified provider payment outcome — what the verified event reported.
// `observedAtMs` is carried into the audit record only and is NEVER a decision input.
const OUTCOME_FIELDS = [
  'membershipDuesPaymentSchemaVersion',
  'checkoutRef',
  'providerAccountRef',
  'livemode',
  'paymentRef',
  'paymentStatus',
  'paidAmountMinor',
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
// floats, and negatives; the exact-match check is what actually gates activation, so the
// bound is only a structural sanity guard.
const MAX_AMOUNT_MINOR = 1_000_000_000_000;

function isOpaqueIdentifier(value) {
  return typeof value === 'string' && OPAQUE_IDENTIFIER_PATTERN.test(value);
}

function isCurrencyCode(value) {
  return typeof value === 'string' && CURRENCY_PATTERN.test(value);
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
  if (e.membershipDuesPaymentSchemaVersion !== membershipDuesPaymentSchemaVersion) return null;
  if (!isOpaqueIdentifier(e.commandId)) return null;
  if (!isOpaqueIdentifier(e.membershipId)) return null;
  if (!isOpaqueIdentifier(e.termId)) return null;
  if (!isRevision(e.termRevision)) return null;
  if (!isRevision(e.expectedRevision)) return null;
  if (!isOpaqueIdentifier(e.planRef)) return null;
  if (!isOpaqueIdentifier(e.policyVersion)) return null;
  if (!isOpaqueIdentifier(e.checkoutRef)) return null;
  if (!isOpaqueIdentifier(e.providerAccountRef)) return null;
  if (!isBoolean(e.livemode)) return null;
  if (!isAmountMinor(e.expectedAmountMinor)) return null;
  if (!isCurrencyCode(e.currency)) return null;
  if (!isTimeMs(e.startsAtMs)) return null;
  if (!isTimeMs(e.endsAtMs)) return null;
  // A term must occupy a non-empty forward window; the shipped authority reducer
  // enforces the same, so an ill-ordered window could never activate anyway.
  if (!(e.startsAtMs < e.endsAtMs)) return null;
  return e;
}

// Validate the already-verified provider payment outcome.
function readOutcome(value) {
  const o = readExact(value, OUTCOME_FIELDS);
  if (!o) return null;
  if (o.membershipDuesPaymentSchemaVersion !== membershipDuesPaymentSchemaVersion) return null;
  if (!isOpaqueIdentifier(o.checkoutRef)) return null;
  if (!isOpaqueIdentifier(o.providerAccountRef)) return null;
  if (!isBoolean(o.livemode)) return null;
  if (!isOpaqueIdentifier(o.paymentRef)) return null;
  if (typeof o.paymentStatus !== 'string' || !PAYMENT_STATUS_SET.has(o.paymentStatus)) return null;
  if (!isAmountMinor(o.paidAmountMinor)) return null;
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

// Every rejection is context-free (it carries no command and no echo of the expected
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

// A verified, paid, consistent outcome. Emits the byte-exact `record_term_decision`
// command the shipped authority reducer accepts (the verified paymentRef is the term's
// dues evidence, so it becomes the command's evidenceRef — the online analogue of the
// manual path's off-platform evidence pointer) plus a provenance-stamped audit record.
function accept(expectation, outcome) {
  const reducerCommand = Object.freeze({
    membershipAuthoritySchemaVersion: MEMBERSHIP_AUTHORITY_SCHEMA_VERSION,
    commandType: RECORD_TERM_DECISION_COMMAND_TYPE,
    commandId: expectation.commandId,
    expectedRevision: expectation.expectedRevision,
    termRevision: expectation.termRevision,
    termState: APPROVED_TERM_STATE,
    termId: expectation.termId,
    startsAtMs: expectation.startsAtMs,
    endsAtMs: expectation.endsAtMs,
    planRef: expectation.planRef,
    evidenceRef: outcome.paymentRef,
    policyVersion: expectation.policyVersion,
  });

  const auditRecord = Object.freeze({
    membershipDuesPaymentSchemaVersion,
    provenance: VERIFIED_ONLINE_PAYMENT_PROVENANCE,
    membershipId: expectation.membershipId,
    commandId: expectation.commandId,
    checkoutRef: expectation.checkoutRef,
    providerAccountRef: expectation.providerAccountRef,
    livemode: expectation.livemode,
    paymentRef: outcome.paymentRef,
    paymentStatus: PAID_STATUS,
    paidAmountMinor: outcome.paidAmountMinor,
    currency: outcome.currency,
    observedAtMs: outcome.observedAtMs,
    termId: expectation.termId,
    termState: APPROVED_TERM_STATE,
    startsAtMs: expectation.startsAtMs,
    endsAtMs: expectation.endsAtMs,
    planRef: expectation.planRef,
    policyVersion: expectation.policyVersion,
  });

  return Object.freeze({
    decision: 'accepted',
    reason: PAID_STATUS,
    reducerCommand,
    auditRecord,
  });
}

// ---- the decision --------------------------------------------------------

function classifyVerifiedDuesPayment(expectationEvidence, outcomeEvidence) {
  const expectation = readExpectation(expectationEvidence);
  if (!expectation) return deny('malformed_expectation');
  const outcome = readOutcome(outcomeEvidence);
  if (!outcome) return deny('malformed_outcome');

  // Identity first: the verified event must be about the exact checkout the server
  // authorized. An event for another checkout can never touch this term.
  if (outcome.checkoutRef !== expectation.checkoutRef) return reject('checkout_mismatch');
  // ...and it must come from the same provider account the server authorized (an
  // anti-cross-account guard), before any payment fact is considered.
  if (outcome.providerAccountRef !== expectation.providerAccountRef) return reject('account_mismatch');
  // Realm isolation: a test-mode event can never activate a live membership and vice
  // versa. Checked before status/amount so a wrong-realm event learns nothing about them.
  if (outcome.livemode !== expectation.livemode) return reject('realm_mismatch');
  // Paid-only: only a fully paid outcome activates. Every other known status is a
  // legitimate non-activating event.
  if (outcome.paymentStatus !== PAID_STATUS) return reject('not_paid');
  // Server-authoritative price: currency before amount (amounts are meaningless across
  // currencies), then an EXACT match — underpay and overpay both reject.
  if (outcome.currency !== expectation.currency) return reject('currency_mismatch');
  if (outcome.paidAmountMinor !== expectation.expectedAmountMinor) return reject('amount_mismatch');

  // Verified, paid, same checkout/account/realm, exact currency and amount: this
  // outcome justifies activating/renewing the term. Emit the command and the audit.
  return accept(expectation, outcome);
}

module.exports = Object.freeze({
  membershipDuesPaymentSchemaVersion,
  PaymentStatus,
  DuesDecision,
  AcceptReason,
  RejectReason,
  DenialReason,
  classifyVerifiedDuesPayment,
});
