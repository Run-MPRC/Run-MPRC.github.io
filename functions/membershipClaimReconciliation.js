'use strict';

const { types: { isProxy } } = require('node:util');

const claimReconciliationSchemaVersion = 1;
const MEMBERSHIP_CLAIM_RECONCILIATION_ERROR_MESSAGE =
  'Membership claim reconciliation input is invalid.';

const EXPECTED_FIELDS = Object.freeze([
  'claimReconciliationSchemaVersion',
  'entitlementDisposition',
  'emailVerification',
  'observedMemberClaim',
  'observedOfficerClaim',
]);

const MEMBERSHIP_CLAIM_RECONCILIATION_ENUMS = Object.freeze({
  // The membership entitlement result derived by membershipAuthority.js (#208).
  entitlementDisposition: Object.freeze(['current_member', 'not_entitled', 'decision_pending']),
  // Whether the sign-in email is verified; the member authorization requires it,
  // mirroring roleGrantPolicy.js.
  emailVerification: Object.freeze(['verified', 'unverified']),
  // The membership authorization claim currently present in the token.
  observedMemberClaim: Object.freeze(['present', 'absent']),
  // The separately-administered officer role currently present in the token.
  observedOfficerClaim: Object.freeze(['admin', 'none']),
  // Output-only reconciliation dispositions.
  disposition: Object.freeze(['aligned', 'grant_member', 'revoke_member']),
});

// Only the input enums are validated against the incoming evidence.
const ENUM_SETS = Object.freeze({
  entitlementDisposition: new Set(MEMBERSHIP_CLAIM_RECONCILIATION_ENUMS.entitlementDisposition),
  emailVerification: new Set(MEMBERSHIP_CLAIM_RECONCILIATION_ENUMS.emailVerification),
  observedMemberClaim: new Set(MEMBERSHIP_CLAIM_RECONCILIATION_ENUMS.observedMemberClaim),
  observedOfficerClaim: new Set(MEMBERSHIP_CLAIM_RECONCILIATION_ENUMS.observedOfficerClaim),
});

class MembershipClaimReconciliationError extends Error {
  constructor() {
    super(MEMBERSHIP_CLAIM_RECONCILIATION_ERROR_MESSAGE);
    Object.defineProperty(this, 'name', {
      value: 'MembershipClaimReconciliationError',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'message', {
      value: MEMBERSHIP_CLAIM_RECONCILIATION_ERROR_MESSAGE,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'code', {
      value: 'invalid_membership_claim_reconciliation',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Error.captureStackTrace?.(this, MembershipClaimReconciliationError);
    Object.freeze(this);
  }
}

function fail() {
  throw new MembershipClaimReconciliationError();
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
  if (evidence.claimReconciliationSchemaVersion !== claimReconciliationSchemaVersion) fail();
  for (const [field, allowedValues] of Object.entries(ENUM_SETS)) {
    if (!allowedValues.has(evidence[field])) fail();
  }
  return evidence;
}

function frozenDisposition(disposition, reason) {
  return Object.freeze({
    claimReconciliationSchemaVersion,
    disposition,
    reason,
    // A reconciliation verdict never itself confers membership, price, or role...
    grantsAuthority: false,
    // ...and membership never grants or revokes the separately-administered
    // officer (admin) role.
    officerRoleAffected: false,
  });
}

const RESULTS = Object.freeze({
  aligned: frozenDisposition('aligned', 'member_claim_matches_entitlement'),
  grantMember: frozenDisposition('grant_member', 'entitled_member_claim_missing'),
  revokeMember: frozenDisposition('revoke_member', 'unentitled_member_claim_present'),
});

function classifyClaimReconciliation(input) {
  const evidence = readExactEvidence(input);

  // Fail-closed: the member authorization claim belongs only to an affirmatively
  // entitled, email-verified member. not_entitled, decision_pending, and
  // unverified all resolve to a desired-absent claim, so a stale claim is revoked.
  const desiredMemberClaim =
    evidence.entitlementDisposition === 'current_member'
    && evidence.emailVerification === 'verified'
      ? 'present'
      : 'absent';

  // The officer (admin) role is administered separately (#115) and never enters
  // this decision: observedOfficerClaim does not affect the disposition.
  if (desiredMemberClaim === evidence.observedMemberClaim) {
    return RESULTS.aligned;
  }
  return desiredMemberClaim === 'present' ? RESULTS.grantMember : RESULTS.revokeMember;
}

Object.freeze(MembershipClaimReconciliationError.prototype);
Object.freeze(MembershipClaimReconciliationError);

module.exports = Object.freeze({
  claimReconciliationSchemaVersion,
  MEMBERSHIP_CLAIM_RECONCILIATION_ENUMS,
  MembershipClaimReconciliationError,
  classifyClaimReconciliation,
});
