'use strict';

// MEMBERS-DUES-001D — pure server-authoritative dues checkout/expectation producer (pure contract).
//
// SOURCE ONLY, UNUSED: this module is imported by nothing (not by
// functions/index.js, no route, no Firestore Rules, no callable, no webhook, no
// scheduled worker). It has zero runtime behavior. It is the price-integrity
// decision core for item 2 of parent #114 (MEMBERS-DUES-001) — "the server decides
// the amount, currency, term, and plan a dues checkout is created against" — landed
// and exhaustively negative-tested first so the eventual Checkout-session wiring is a
// mechanical hookup of already-proven invariants. See SYSTEM_DESIGN.md §8.19.
//
// It is the upstream PRODUCER of the very snapshot the shipped activation contract
// membershipDuesPayment.js (MEMBERS-DUES-001B, §8.17) and its reversal twin
// membershipDuesReversal.js (MEMBERS-DUES-001C, §8.18) CONSUME: given an
// owner-approved plan snapshot, the authoritative membership standing, and a purchase
// request, it derives (a) the exact server-approved expectation those reducers later
// reconcile a verified payment/reversal against, and (b) the checkout parameters a
// provider session is created from. The marquee property is that the amount a member
// is CHARGED and the amount a later payment must MATCH to activate are both copied
// from the SAME owner-approved plan snapshot — they cannot drift, and the browser
// never decides price. It closes the loop back to §8.17/§8.18: producer → charge →
// verified payment → approved-term decision.
//
// What it decides: given the owner-approved plan snapshot (the versioned server
// configuration that fixes WHICH plan/term/price/currency/window is being sold), the
// authoritative membership standing (the record/term revision cursors and the term the
// member is already entitled under, if any), and one purchase request (which member,
// which plan, the provider account + realm the checkout runs in, and the caller's
// idempotency token) — whether to PREPARE a canonical dues order (emitting the checkout
// parameters + the byte-exact expectation §8.17 consumes), or REFUSE (a coherent but
// non-purchasable request — wrong member, wrong plan, already active, or a retired
// plan), or DENY (a malformed input).
//
// Why non-throwing (the idiom of §8.14–§8.18): a purchase request for a retired plan,
// for a member already active on the term, or cross-referencing the wrong member/plan
// is a NORMAL request a checkout endpoint will see and must resolve to a safe
// reason-coded "do not prepare an order" verdict, never an exception a request handler
// must catch (which risks 500s and conflates "business says no" with "input is
// malformed"). So this is a non-throwing frozen-verdict reducer and NEVER throws.
//
// Safety model:
//   * Price integrity end-to-end: the amount the checkout CHARGES
//     (checkout.amountMinor) and the amount a later verified payment must MATCH to
//     activate (expectation.expectedAmountMinor) are BOTH copied from the single
//     owner-approved plan snapshot (plan.amountMinor); they are structurally identical
//     and cannot drift. The request carries NO amount field at all, so a browser or
//     client cannot influence — cannot even name — the charged or expected price.
//   * Invents no policy: every owner-meaningful value (planRef, termId, price,
//     currency, term window, policyVersion) is carried opaquely from the plan snapshot;
//     the reducer decides none of them. It reads no clock, so it never fabricates a
//     term window or an effective date; the window is the owner-approved one.
//   * Single idempotency key, bound across both dedup layers: the caller's opaque
//     idempotency token is routed into BOTH the checkout (the provider idempotency key)
//     AND the expectation (the authority commandId), so a retry deduped by the provider
//     and a replay deduped by the downstream authority reducer key off the identical
//     token — the two layers cannot diverge. Determinism: identical inputs yield a
//     byte-identical order.
//   * No duplicate entitlement: a request to buy the term the member is ALREADY
//     entitled under (plan.termId === standing.activeTermId) refuses `already_active`
//     rather than preparing a second charge for access already held.
//   * Faithful revision cursors: the emitted expectation carries expectedRevision =
//     the record's current revision and termRevision = the term cursor + 1, so the
//     command §8.17 emits from it applies exactly once under the downstream authority
//     reducer's revision-guarded optimistic concurrency — duplicate/out-of-order
//     suppression stays that reducer's job, not re-implemented or weakened here.
//   * Confers/charges nothing directly: a prepared verdict is a description of an order
//     the caller must still create with the provider and persist; by itself it moves no
//     money, grants no entitlement, and holds no card/PII/secret (only opaque refs,
//     integer minor units, a currency code, and the caller's idempotency handle).
//   * Hostile-input-safe: every field of each input is read through an own-enumerable
//     data descriptor with no getter ever invoked; a proxy, foreign prototype,
//     inherited/extra/missing/symbol key, or out-of-shape value denies as malformed
//     rather than being partially interpreted.
//
// Requires only node:util. Reads no clock, env, network, Firestore, or provider. The
// provider Checkout-session creation, the plan-snapshot lookup, and the standing read
// are upstream/downstream wiring; this contract only DERIVES what a session must be
// created against and what a later payment must match.

const {
  types: { isProxy },
} = require('node:util');

const membershipDuesCheckoutSchemaVersion = 1;
// The shipped activation contract's (MEMBERS-DUES-001B) expectation schema version,
// re-declared locally so this producer stays standalone. The integration test imports
// the real §8.17 reducer and feeds it the derived expectation, so this constant cannot
// silently drift from it.
const MEMBERSHIP_DUES_PAYMENT_SCHEMA_VERSION = 1;

// The structural reason a prepared order always carries; not an owner policy value.
const ORDER_PREPARED_REASON = 'order_prepared';

function immutableEnum(values) {
  return Object.freeze(Object.fromEntries(values.map((v) => [v.toUpperCase(), v])));
}

// ---- closed vocabularies -------------------------------------------------

const DUES_DECISIONS = ['prepared', 'refused', 'denied'];
const PREPARE_REASONS = [ORDER_PREPARED_REASON];
// Every refusal prepares no order and moves no money — the request is coherent but not
// purchasable. Ordered by the decision precedence (identity → already-held → offerable).
const REFUSE_REASONS = [
  'membership_mismatch',
  'plan_mismatch',
  'already_active',
  'plan_not_offerable',
];
const DENIAL_REASONS = ['malformed_plan', 'malformed_standing', 'malformed_request'];

const DuesDecision = immutableEnum(DUES_DECISIONS);
const PrepareReason = immutableEnum(PREPARE_REASONS);
const RefuseReason = immutableEnum(REFUSE_REASONS);
const DenialReason = immutableEnum(DENIAL_REASONS);

// ---- record shapes -------------------------------------------------------

// The owner-approved plan snapshot — the versioned server configuration that fixes
// WHICH plan/term/price/currency/window is being sold. Every owner-meaningful value is
// opaque here and carried through verbatim; the producer never decides what any of them
// SHOULD be. It carries no realm (livemode) — a plan is realm-agnostic config; the realm
// is chosen per checkout in the request.
const PLAN_FIELDS = [
  'membershipDuesCheckoutSchemaVersion',
  'planRef',
  'policyVersion',
  'termId',
  'amountMinor',
  'currency',
  'startsAtMs',
  'endsAtMs',
  'offerable',
];

// The authoritative membership standing — a server-read summary of the membership
// record this checkout would eventually decide a term on. `recordRevision` and
// `termRevision` are the current revision cursors (used to derive the command's
// expectedRevision/termRevision faithfully); `activeTermId` is the term the member is
// CURRENTLY entitled under (server-computed) or null — never re-derived here.
const STANDING_FIELDS = [
  'membershipDuesCheckoutSchemaVersion',
  'membershipId',
  'recordRevision',
  'termRevision',
  'activeTermId',
];

// The purchase request — who is buying (membershipId), which plan (planRef), the
// provider account + realm the checkout runs in (providerAccountRef, livemode), and the
// caller's stable idempotency token for this purchase attempt (idempotencyKey). It
// carries NO amount, currency, term, or window: those come only from the plan snapshot,
// so a client cannot influence price or term.
const REQUEST_FIELDS = [
  'membershipDuesCheckoutSchemaVersion',
  'membershipId',
  'planRef',
  'providerAccountRef',
  'livemode',
  'idempotencyKey',
];

// An opaque, url-safe handle for every owner-meaningful reference. This is the same
// shape the shipped authority reducer and §8.17 accept for the command fields it
// carries (commandId, termId, planRef, policyVersion), so a value that passes here is a
// value those reducers accept — proven by the integration test.
const OPAQUE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
// A structural 3-letter lowercase currency-code shape. NOT a policy about which
// currencies are allowed: the producer carries the currency opaquely and never
// interprets or branches on which currency it is.
const CURRENCY_PATTERN = /^[a-z]{3}$/;

const MAX_TIME_MS = 8_640_000_000_000_000;
// A generous upper bound on a monetary amount in minor units. It rejects Infinity, NaN,
// floats, and negatives; the exact copy from the plan is what actually fixes the price,
// so the bound is only a structural sanity guard.
const MAX_AMOUNT_MINOR = 1_000_000_000_000;
// An upper bound on a revision cursor that leaves headroom to add one and stay a safe
// integer (so the derived termRevision is always exact).
const MAX_REVISION = Number.MAX_SAFE_INTEGER - 1;

function isOpaqueIdentifier(value) {
  return typeof value === 'string' && OPAQUE_IDENTIFIER_PATTERN.test(value);
}

function isNullableOpaqueIdentifier(value) {
  return value === null || isOpaqueIdentifier(value);
}

function isCurrencyCode(value) {
  return typeof value === 'string' && CURRENCY_PATTERN.test(value);
}

// The membership record's revision after creation is always >= 1.
function isRecordRevision(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_REVISION;
}

// The term-decision cursor starts at 0 (no decision yet) and only grows; the derived
// command targets cursor + 1.
function isTermRevisionCursor(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_REVISION;
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

// Validate the owner-approved plan snapshot.
function readPlan(value) {
  const p = readExact(value, PLAN_FIELDS);
  if (!p) return null;
  if (p.membershipDuesCheckoutSchemaVersion !== membershipDuesCheckoutSchemaVersion) return null;
  if (!isOpaqueIdentifier(p.planRef)) return null;
  if (!isOpaqueIdentifier(p.policyVersion)) return null;
  if (!isOpaqueIdentifier(p.termId)) return null;
  if (!isAmountMinor(p.amountMinor)) return null;
  if (!isCurrencyCode(p.currency)) return null;
  if (!isTimeMs(p.startsAtMs)) return null;
  if (!isTimeMs(p.endsAtMs)) return null;
  // A term must occupy a non-empty forward window; §8.17 enforces the same, so a plan
  // with an ill-ordered window could never produce an activatable expectation anyway.
  if (!(p.startsAtMs < p.endsAtMs)) return null;
  if (!isBoolean(p.offerable)) return null;
  return p;
}

// Validate the authoritative membership standing.
function readStanding(value) {
  const s = readExact(value, STANDING_FIELDS);
  if (!s) return null;
  if (s.membershipDuesCheckoutSchemaVersion !== membershipDuesCheckoutSchemaVersion) return null;
  if (!isOpaqueIdentifier(s.membershipId)) return null;
  if (!isRecordRevision(s.recordRevision)) return null;
  if (!isTermRevisionCursor(s.termRevision)) return null;
  if (!isNullableOpaqueIdentifier(s.activeTermId)) return null;
  return s;
}

// Validate the purchase request.
function readRequest(value) {
  const r = readExact(value, REQUEST_FIELDS);
  if (!r) return null;
  if (r.membershipDuesCheckoutSchemaVersion !== membershipDuesCheckoutSchemaVersion) return null;
  if (!isOpaqueIdentifier(r.membershipId)) return null;
  if (!isOpaqueIdentifier(r.planRef)) return null;
  if (!isOpaqueIdentifier(r.providerAccountRef)) return null;
  if (!isBoolean(r.livemode)) return null;
  if (!isOpaqueIdentifier(r.idempotencyKey)) return null;
  return r;
}

// ---- verdict constructors ------------------------------------------------

const DENIALS = Object.freeze(Object.fromEntries(
  DENIAL_REASONS.map((reason) => [reason, Object.freeze({ decision: 'denied', reason })]),
));

// Every refusal is context-free (it carries no order and no echo of the plan price), so
// the verdicts are frozen singletons.
const REFUSALS = Object.freeze(Object.fromEntries(
  REFUSE_REASONS.map((reason) => [reason, Object.freeze({ decision: 'refused', reason })]),
));

function deny(reason) {
  return DENIALS[reason];
}

function refuse(reason) {
  return REFUSALS[reason];
}

// A coherent, purchasable request. Emits the canonical dues order: the checkout
// parameters a provider session is created from, and the byte-exact expectation §8.17
// later reconciles a verified payment against. The provider assigns the session id
// (checkoutRef) on creation; the wiring stamps it onto this expectation to form the
// 15-field §8.17 expectation. Every owner-meaningful value comes from the plan snapshot;
// the amount charged and the amount expected are the SAME plan.amountMinor.
function prepare(plan, standing, request) {
  // Faithful revision cursors for the downstream authority reducer: decide against the
  // record's current revision, advancing the term cursor by exactly one.
  const expectedRevision = standing.recordRevision;
  const termRevision = standing.termRevision + 1;

  // One idempotency token, bound to BOTH dedup layers so they cannot diverge.
  const orderKey = request.idempotencyKey;

  const checkout = Object.freeze({
    membershipId: standing.membershipId,
    termId: plan.termId,
    planRef: plan.planRef,
    amountMinor: plan.amountMinor,
    currency: plan.currency,
    idempotencyKey: orderKey,
  });

  const expectation = Object.freeze({
    membershipDuesPaymentSchemaVersion: MEMBERSHIP_DUES_PAYMENT_SCHEMA_VERSION,
    commandId: orderKey,
    membershipId: standing.membershipId,
    termId: plan.termId,
    termRevision,
    expectedRevision,
    planRef: plan.planRef,
    policyVersion: plan.policyVersion,
    providerAccountRef: request.providerAccountRef,
    livemode: request.livemode,
    // Price integrity: the SAME plan.amountMinor the checkout charges.
    expectedAmountMinor: plan.amountMinor,
    currency: plan.currency,
    startsAtMs: plan.startsAtMs,
    endsAtMs: plan.endsAtMs,
  });

  return Object.freeze({
    decision: 'prepared',
    reason: ORDER_PREPARED_REASON,
    checkout,
    expectation,
  });
}

// ---- the decision --------------------------------------------------------

function deriveDuesCheckoutOrder(planEvidence, standingEvidence, requestEvidence) {
  const plan = readPlan(planEvidence);
  if (!plan) return deny('malformed_plan');
  const standing = readStanding(standingEvidence);
  if (!standing) return deny('malformed_standing');
  const request = readRequest(requestEvidence);
  if (!request) return deny('malformed_request');

  // Identity first: the request must be about the same member the standing describes...
  if (request.membershipId !== standing.membershipId) return refuse('membership_mismatch');
  // ...and about the same plan the snapshot describes (guards a wiring mismatch between
  // the requested planRef and the fetched plan snapshot).
  if (request.planRef !== plan.planRef) return refuse('plan_mismatch');
  // No duplicate entitlement: never prepare a second charge for the term the member is
  // already entitled under. `activeTermId` is null when the member holds no active term.
  if (plan.termId === standing.activeTermId) return refuse('already_active');
  // Offerable last: the request is coherent and needed, but the plan may be retired.
  if (plan.offerable !== true) return refuse('plan_not_offerable');

  // Coherent, needed, and offerable: derive the canonical dues order.
  return prepare(plan, standing, request);
}

module.exports = Object.freeze({
  membershipDuesCheckoutSchemaVersion,
  DuesDecision,
  PrepareReason,
  RefuseReason,
  DenialReason,
  deriveDuesCheckoutOrder,
});
