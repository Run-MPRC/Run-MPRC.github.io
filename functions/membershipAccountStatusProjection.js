'use strict';

// ============================================================================
// §8.0h — MEMBERS-DUES-001F — Member/account status projection (item 6 of #114)
// ============================================================================
// SOURCE ONLY, UNUSED. Imported by nothing (no index, route, callable, Rules,
// or worker) -> zero runtime behavior; nothing here awaits the owner-gated
// deploy. Merging it deploys nothing and changes no live behavior.
//
// One pure, deterministic, NON-THROWING projection for MEMBERS-DUES-001 [#114]
// item 6 -- "Minimum member/account status projection and renewal UX after the
// server contract is proven" -- the member-facing DISPLAY read-model that
// acceptance line 66 requires member pricing and protected content to consume
// ("the server-derived active-membership projection rather than Auth provider or
// raw profile fields"). §8.17 and §8.18 both forward-declare it as unbuilt: "no
// member/account status projection or renewal UX (item 6) ... remain with #114."
//
// It is DELIBERATELY a projection OF the shipped authority §8.0a
// `deriveMembershipEntitlement` (functions/membershipAuthority.js), which it
// COMPOSES rather than re-implements. §8.0a is a clock-consuming but
// reason-COLLAPSING authorization gate: given the same reference instant and
// membership record it returns one of three frozen results -- current_member /
// not_entitled / decision_pending -- collapsing every "why" (a term an hour from
// expiry, an elapsed term, a refund-suspended term, an offboarded ended term, a
// not-yet-started future term, an unlinked record) into the same not_entitled,
// and it applies no renewal-window threshold and offers no renewal affordance. A
// member's own account page and the member-pricing surface need those reasons
// DISAGGREGATED plus a renewal affordance; that disaggregation is the ONLY thing
// this adds.
//
// WHY IT COMPOSES §8.0a (the one source-only core that imports a sibling -- a
// deliberate, documented departure from the node:util-only norm the other cores
// follow): the safety property that matters here is DISPLAY NEVER OVER-STATES
// AUTHORIZATION -- any status that reads as entitled (active / expiring_soon)
// must correspond to a current_member authorization, always. Composing the real
// authority makes that invariant TRUE BY CONSTRUCTION and robust to any future
// change in §8.0a's window logic, and it re-implements NONE of §8.0a's record
// validation (revision math, enum / time / opaque-id checks). Re-implementing
// that validation in a second module would be a divergence risk -- the salami
// failure mode this project's discipline forbids ("a duplicated slice is a new
// failure mode, not redundancy"). The imported sibling is itself pure and
// node:util-only, so purity / determinism / no-I/O hold transitively; a
// source-boundary test locks this module's require set to exactly
// { node:util, ./membershipAuthority } and locks membershipAuthority's own
// require set to { node:util }.
//
// `projectMemberAccountStatus(input, policy)` returns ONE frozen verdict and
// NEVER throws:
//   * { decision: 'projected', status, entitlement, renewalOffered, activeThroughMs }
//   * { decision: 'denied', reason }   reason in { malformed_input | malformed_policy }
//
//   input  : { membershipAccountStatusSchemaVersion, record, uid, asOfMs }
//            `record` is a §8.0a authority record (validated by the composed
//            authority, never re-validated here); `uid` is the signed-in member
//            the projection is FOR; `asOfMs` is the caller-supplied reference
//            instant (this reducer reads no clock).
//   policy : { membershipAccountStatusSchemaVersion, renewalWindowMs }
//            `renewalWindowMs` is the owner-configured "expiring soon" lead time
//            -- the SOLE source of the threshold; this reducer invents none.
//
//   status in { active | expiring_soon | upcoming | expired | suspended | ended
//               | pending | none }  (member-facing display state)
//   entitlement in { current_member | not_entitled | decision_pending }
//               -- taken VERBATIM from §8.0a (authoritative; the seam)
//   renewalOffered in { true | false } -- true ONLY for { expiring_soon | expired }
//   activeThroughMs -- the term-end instant to display (integer) for
//               { active | expiring_soon | upcoming | expired }; null otherwise.
//
// Safety invariants (all test-locked; invariant 1 proven by composing the REAL
// §8.0a over every fixture):
//   1. Display never over-states authorization:
//        status in { active, expiring_soon }         <=> entitlement current_member
//        status in { upcoming, expired, suspended,
//                    ended, none }                    ==> entitlement not_entitled
//        status === pending                           <=> entitlement decision_pending
//   2. Renewal is offered ONLY where a safe self-serve re-purchase is correct:
//        renewalOffered <=> status in { expiring_soon, expired }. NEVER for a
//        suspended term (refund/dispute clawback -- re-purchase could re-grant
//        disputed access or double-charge), an ended term (offboarding -- owner
//        re-admits), a pending decision, an already-renewed upcoming term, a
//        comfortably-active term, or a non-member ('none' is a join, not a renewal).
//   3. Invents no policy: the "expiring soon" lead time is policy.renewalWindowMs
//        (owner configuration -- the sole source); the reducer only compares
//        endsAtMs - asOfMs <= renewalWindowMs. No hardcoded window. (cf. the #114
//        owner-decision rule -- invent no grace / terms / prices.)
//   4. Clockless: consumes asOfMs; constructs no Date. Same instant -> same
//        projection.
//   5. Confers nothing / mints nothing: the verdict carries a display status, a
//        boolean, the authoritative entitlement, and one term-end instant -- no
//        code, token, role, price, amount, account reference, PII, or command.
//        It is a READ-MODEL; access stays gated by §8.0a at the access point.
//   6. Hostile-input-safe & non-throwing: input and policy are read through a
//        descriptor-based closed-object read (getters never invoked; proxy /
//        revoked proxy / foreign prototype / array / symbol key / extra / missing
//        -> malformed); the record is validated by the composed §8.0a, whose
//        throw on any malformed record is caught and mapped to malformed_input;
//        never throws for any value in either argument position.
// ============================================================================

const { types: { isProxy } } = require('node:util');
const {
  deriveMembershipEntitlement,
  membershipAuthoritySchemaVersion,
} = require('./membershipAuthority');

const membershipAccountStatusSchemaVersion = 1;

const MAX_TIME_MS = 8_640_000_000_000_000;

// The same opaque-identifier grammar §8.0a enforces on a linked association's
// uid. Kept as a local literal (the pattern is not an exported symbol) purely to
// validate the `uid` the projection is FOR; the record's own identifiers are
// validated by the composed authority.
const OPAQUE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const INPUT_FIELDS = Object.freeze([
  'membershipAccountStatusSchemaVersion',
  'record',
  'uid',
  'asOfMs',
]);

const POLICY_FIELDS = Object.freeze([
  'membershipAccountStatusSchemaVersion',
  'renewalWindowMs',
]);

// Member-facing display states.
const STATUS = Object.freeze({
  active: 'active',
  expiringSoon: 'expiring_soon',
  upcoming: 'upcoming',
  expired: 'expired',
  suspended: 'suspended',
  ended: 'ended',
  pending: 'pending',
  none: 'none',
});

const DENIAL_REASONS = Object.freeze(['malformed_input', 'malformed_policy']);

// ---- hostile-input-safe closed-object read ---------------------------------
// Read an exact, closed record: an ordinary object whose own string-keyed
// properties are precisely `expectedFields`, each an enumerable data property.
// Returns a null-prototype copy read with no getter ever invoked, or null on any
// deviation (proxy, array, foreign prototype, symbol key, wrong key count,
// missing, extra -- enumerable OR non-enumerable -- inherited, accessor, or
// non-enumerable field). Same idiom as the membership dues siblings.
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
  // property must also deny -- it is invisible to Object.keys but would still
  // make the record something other than the exact closed shape.
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

function isOpaqueIdentifier(value) {
  return typeof value === 'string' && OPAQUE_IDENTIFIER_PATTERN.test(value);
}

function isTimeMs(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME_MS;
}

// ---- verdict constructors --------------------------------------------------

const DENIALS = Object.freeze(Object.fromEntries(
  DENIAL_REASONS.map((reason) => [reason, Object.freeze({ decision: 'denied', reason })]),
));

function deny(reason) {
  return DENIALS[reason];
}

function project(status, entitlement, renewalOffered, activeThroughMs) {
  return Object.freeze({
    decision: 'projected',
    status,
    entitlement,
    renewalOffered,
    activeThroughMs,
  });
}

// Read exactly the record fields the display graduation consumes. Only ever
// called AFTER `deriveMembershipEntitlement` has SUCCEEDED on this record, which
// proves the record (and its nested association / term) are plain inert data --
// the authority rejects any proxy or accessor at every level it reads -- so
// these direct reads are TOCTOU-free. Type-guarded defensively regardless; any
// surprise (impossible post-success) resolves to null -> malformed_input.
function readGraduationView(record) {
  if (record === null || typeof record !== 'object') return null;
  const association = record.association;
  const term = record.term;
  if (association === null || typeof association !== 'object') return null;
  if (term === null || typeof term !== 'object') return null;
  const associationState = association.state;
  const associationUid = association.uid;
  const termState = term.state;
  const startsAtMs = term.startsAtMs;
  const endsAtMs = term.endsAtMs;
  if (typeof associationState !== 'string') return null;
  if (associationUid !== null && !isOpaqueIdentifier(associationUid)) return null;
  if (typeof termState !== 'string') return null;
  return { associationState, associationUid, termState, startsAtMs, endsAtMs };
}

// ---- the projection --------------------------------------------------------
function projectMemberAccountStatus(input, policy) {
  const inp = readExact(input, INPUT_FIELDS);
  if (inp === null) return deny('malformed_input');
  if (inp.membershipAccountStatusSchemaVersion !== membershipAccountStatusSchemaVersion) {
    return deny('malformed_input');
  }
  if (!isOpaqueIdentifier(inp.uid)) return deny('malformed_input');
  if (!isTimeMs(inp.asOfMs)) return deny('malformed_input');

  const pol = readExact(policy, POLICY_FIELDS);
  if (pol === null) return deny('malformed_policy');
  if (pol.membershipAccountStatusSchemaVersion !== membershipAccountStatusSchemaVersion) {
    return deny('malformed_policy');
  }
  if (!isTimeMs(pol.renewalWindowMs)) return deny('malformed_policy');

  // Compose the shipped authority. It fully validates the record (revision math,
  // enums, times, opaque ids) and returns the authoritative entitlement; any
  // malformed record makes it throw MembershipAuthorityError, caught here and
  // mapped to malformed_input so this projection never throws.
  let authority;
  try {
    authority = deriveMembershipEntitlement({
      membershipAuthoritySchemaVersion,
      record: inp.record,
      uid: inp.uid,
      asOfMs: inp.asOfMs,
    });
  } catch {
    return deny('malformed_input');
  }
  const entitlement = authority.entitlement;

  const view = readGraduationView(inp.record);
  if (view === null) return deny('malformed_input'); // impossible post-success
  const { associationState, associationUid, termState, startsAtMs, endsAtMs } = view;
  const asOfMs = inp.asOfMs;
  const renewalWindowMs = pol.renewalWindowMs;

  // Disaggregate WITHIN each authoritative entitlement bucket. Every branch takes
  // its entitlement verbatim from the authority, so the display status can never
  // contradict authorization (invariant 1).

  if (entitlement === 'decision_pending') {
    // §8.0a returns decision_pending only for a linked, matched association whose
    // term is decision_pending -- no term window to display.
    return project(STATUS.pending, entitlement, false, null);
  }

  if (entitlement === 'current_member') {
    // §8.0a's ONLY current_member branch: linked + matched association, approved
    // term, asOfMs in [startsAtMs, endsAtMs). The term therefore has valid dates;
    // guard defensively.
    if (!isTimeMs(startsAtMs) || !isTimeMs(endsAtMs)) return deny('malformed_input');
    const nearing = endsAtMs - asOfMs <= renewalWindowMs;
    const status = nearing ? STATUS.expiringSoon : STATUS.active;
    return project(status, entitlement, nearing, endsAtMs);
  }

  // entitlement === 'not_entitled'. §8.0a returns it, in order, for: association
  // not linked or uid mismatch (checked FIRST, before any term state); else a
  // suspended term; else an ended term; else an approved term outside its window.
  if (associationState !== 'linked' || associationUid !== inp.uid) {
    return project(STATUS.none, entitlement, false, null);
  }
  if (termState === 'suspended') {
    return project(STATUS.suspended, entitlement, false, null);
  }
  if (termState === 'ended') {
    return project(STATUS.ended, entitlement, false, null);
  }
  // Guaranteed here: an APPROVED term outside its window (the authority returned
  // not_entitled for a linked, matched, non-suspended, non-ended term, and a
  // decision_pending term would have been the decision_pending bucket). So
  // exactly one of asOfMs < startsAtMs (not yet started) or asOfMs >= endsAtMs
  // (elapsed) holds. Guard the dates defensively.
  if (!isTimeMs(startsAtMs) || !isTimeMs(endsAtMs)) return deny('malformed_input');
  if (asOfMs < startsAtMs) {
    return project(STATUS.upcoming, entitlement, false, endsAtMs);
  }
  return project(STATUS.expired, entitlement, true, endsAtMs);
}

module.exports = Object.freeze({
  membershipAccountStatusSchemaVersion,
  projectMemberAccountStatus,
});
