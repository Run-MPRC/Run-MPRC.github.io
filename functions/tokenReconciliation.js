'use strict';

// MEMBERS-DUES-001E — pure token-refresh/revocation disposition (pure contract).
//
// SOURCE ONLY, UNUSED: this module is imported by nothing (not by
// functions/index.js, no route, no Firestore Rules, no callable, no webhook, no
// scheduled worker, no Admin SDK call). It has zero runtime behavior. It is the
// access-revocation decision core for item 4 of parent #114 (MEMBERS-DUES-001) —
// "Expiry/reconciliation job and derived Auth-claim/access refresh/revocation
// without deleting membership history", whose acceptance criterion requires that
// expiry, refund/chargeback/dispute, suspension, and offboarding "force safe token
// refresh/revocation". See SYSTEM_DESIGN.md §8.0g.
//
// It is the piece the shipped-source claim contract membershipClaimReconciliation.js
// (MEMBERS-IDENTITY-001E, §8.0c, #373) explicitly DEFERS: that reducer derives the
// desired member-claim VALUE (aligned / grant_member / revoke_member) and states in
// its own text that "the actual custom-claim write, token refresh, and revocation
// remain gated on the AUTH-001/AUTH-003 Functions/Admin authorization work." This
// module CONSUMES that reconciliation disposition and derives the next, distinct
// decision: given the desired claim change plus whether the subject holds an
// outstanding session and which claims-version that session's token carries, whether
// to FORCE-REVOKE outstanding sessions, FORCE a token REFRESH, or do NOTHING.
//
// The marquee property is fail-closed access removal: a revoked member authorization
// (reconciliationDisposition === 'revoke_member') ALWAYS maps to force_revoke —
// unconditionally, regardless of the observed session/version evidence — and NO other
// disposition can produce force_revoke. So a de-entitled subject's outstanding
// sessions are always invalidated NOW (revokeRefreshTokens is idempotent and sets a
// revocation watermark, so even a session this evidence did not observe is killed),
// and a member is never spuriously kicked. A newly granted claim propagates only on
// refresh, so an active session is force-refreshed to pick it up; a claim that is
// already the correct VALUE but stamped at a stale claims-version is force-refreshed
// so version-gated consumers converge; anything already coherent is a noop.
//
// Why throwing (the idiom of its §8.0c sibling): the evidence is assembled from
// trusted authoritative sources — the §8.0c disposition, an Admin-side session query,
// and the authoritative claims-version cursor. A malformed shape, an unknown enum, a
// non-integer version, an extra/missing/accessor/inherited field, or a proxy is a
// caller ASSEMBLY BUG, not a business outcome, so it fails through one fixed error
// that never echoes the input — exactly as membershipClaimReconciliation.js does. A
// stale token version or an absent session is a NORMAL state and resolves to a frozen
// verdict, never a throw.
//
// It invents no revocation SLA, grace period, expiry date, timing, or clock: it reads
// no clock and compares only caller-supplied version cursors, honoring the #114
// owner-decision constraint ("Do not invent ... grace period ... Record approved
// values as versioned server configuration"). Membership governs ONLY the member
// authorization claim; the separately-administered officer (admin) role is never
// touched (officerRoleAffected: false), and this verdict itself confers no membership,
// price, or role (grantsAuthority: false). It writes no token, mints/revokes nothing,
// calls no Firebase/Admin/Stripe/provider service, stores nothing, and logs nothing.
// The actual refresh-token revocation and forced re-mint remain gated on the
// AUTH-001/AUTH-003 Functions/Admin authorization work. Source tests and a merge are
// not Firebase deployment or live-behavior proof.

const { types: { isProxy } } = require('node:util');

const tokenReconciliationSchemaVersion = 1;
const TOKEN_RECONCILIATION_ERROR_MESSAGE =
  'Token reconciliation input is invalid.';

const EXPECTED_FIELDS = Object.freeze([
  'tokenReconciliationSchemaVersion',
  'reconciliationDisposition',
  'sessionState',
  'authoritativeClaimsVersion',
  'observedTokenClaimsVersion',
]);

const TOKEN_RECONCILIATION_ENUMS = Object.freeze({
  // The desired member-claim VALUE derived by membershipClaimReconciliation.js
  // (MEMBERS-IDENTITY-001E, §8.0c, #373). This module consumes that verdict.
  reconciliationDisposition: Object.freeze(['aligned', 'grant_member', 'revoke_member']),
  // Whether the subject currently holds an outstanding refresh-token session.
  sessionState: Object.freeze(['active_session', 'no_session']),
  // Output-only token dispositions.
  action: Object.freeze(['force_revoke', 'force_refresh', 'noop']),
});

// Only the input enums are validated against the incoming evidence.
const ENUM_SETS = Object.freeze({
  reconciliationDisposition: new Set(TOKEN_RECONCILIATION_ENUMS.reconciliationDisposition),
  sessionState: new Set(TOKEN_RECONCILIATION_ENUMS.sessionState),
});

// The two claims-version fields are non-negative safe integers. A version cursor is
// an authoritative monotone counter, never a float, boxed Number, bigint, NaN,
// Infinity, or negative. Number.isSafeInteger already rejects every non-number,
// non-integer, and out-of-safe-range value; the >= 0 guard rejects negatives.
const INTEGER_FIELDS = Object.freeze([
  'authoritativeClaimsVersion',
  'observedTokenClaimsVersion',
]);

class TokenReconciliationError extends Error {
  constructor() {
    super(TOKEN_RECONCILIATION_ERROR_MESSAGE);
    Object.defineProperty(this, 'name', {
      value: 'TokenReconciliationError',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'message', {
      value: TOKEN_RECONCILIATION_ERROR_MESSAGE,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'code', {
      value: 'invalid_token_reconciliation',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Error.captureStackTrace?.(this, TokenReconciliationError);
    Object.freeze(this);
  }
}

function fail() {
  throw new TokenReconciliationError();
}

function isClaimsVersion(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function readDataObject(value) {
  if (value === null || typeof value !== 'object' || isProxy(value)) fail();

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail();
  }
  if (prototype !== Object.prototype) fail();

  const data = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || Object.prototype.hasOwnProperty.call(data, key)) fail();
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
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
    data[key] = descriptor.value;
  }
  return { data, keys };
}

function readExactObject(value, expectedFields) {
  const { data, keys } = readDataObject(value);
  if (keys.length !== expectedFields.length) fail();
  const keySet = new Set(keys);
  if (expectedFields.some((field) => !keySet.has(field))) fail();
  return data;
}

function readExactEvidence(input) {
  const evidence = readExactObject(input, EXPECTED_FIELDS);
  if (evidence.tokenReconciliationSchemaVersion !== tokenReconciliationSchemaVersion) fail();
  for (const [field, allowedValues] of Object.entries(ENUM_SETS)) {
    if (!allowedValues.has(evidence[field])) fail();
  }
  for (const field of INTEGER_FIELDS) {
    if (!isClaimsVersion(evidence[field])) fail();
  }
  return evidence;
}

function frozenAction(action, reason) {
  return Object.freeze({
    tokenReconciliationSchemaVersion,
    action,
    reason,
    // A token verdict never itself confers membership, price, or role...
    grantsAuthority: false,
    // ...and membership never grants or revokes the separately-administered
    // officer (admin) role.
    officerRoleAffected: false,
  });
}

const RESULTS = Object.freeze({
  // Fail-closed access removal: unconditional, ignoring session/version evidence.
  forceRevoke: frozenAction('force_revoke', 'deentitled_revoke_sessions'),
  // A newly granted claim propagates only on refresh.
  grantRefresh: frozenAction('force_refresh', 'entitled_refresh_active_session'),
  grantNoSession: frozenAction('noop', 'entitled_pending_next_signin'),
  // The claim VALUE is correct; only a stale claims-version needs a refresh.
  alignedStale: frozenAction('force_refresh', 'aligned_stale_claims_version'),
  alignedCurrent: frozenAction('noop', 'aligned_current_claims_version'),
  alignedNoSession: frozenAction('noop', 'aligned_no_session'),
});

function classifyTokenReconciliation(input) {
  const evidence = readExactEvidence(input);

  // Fail-closed: a revoked member authorization claim forces outstanding sessions
  // to be revoked NOW, regardless of the observed session/version evidence.
  // revokeRefreshTokens is idempotent and sets a revocation watermark, so even a
  // session this evidence did not observe is invalidated. This is the ONLY branch
  // that yields force_revoke, so force_revoke <=> revoke_member.
  if (evidence.reconciliationDisposition === 'revoke_member') {
    return RESULTS.forceRevoke;
  }

  // A newly granted member claim propagates only on token refresh. An active
  // session is force-refreshed to pick it up; with no outstanding session the next
  // sign-in mints the claim on the normal path, so nothing is forced.
  if (evidence.reconciliationDisposition === 'grant_member') {
    return evidence.sessionState === 'active_session'
      ? RESULTS.grantRefresh
      : RESULTS.grantNoSession;
  }

  // aligned: the claim VALUE already matches. With no outstanding session there is
  // nothing to act on. With an active session whose stamped claims-version diverges
  // from the authoritative cursor, force a refresh so version-gated consumers
  // converge; an already-current session needs nothing.
  if (evidence.sessionState === 'no_session') {
    return RESULTS.alignedNoSession;
  }
  return evidence.observedTokenClaimsVersion !== evidence.authoritativeClaimsVersion
    ? RESULTS.alignedStale
    : RESULTS.alignedCurrent;
}

Object.freeze(TokenReconciliationError.prototype);
Object.freeze(TokenReconciliationError);

module.exports = Object.freeze({
  tokenReconciliationSchemaVersion,
  TOKEN_RECONCILIATION_ENUMS,
  TokenReconciliationError,
  classifyTokenReconciliation,
});
