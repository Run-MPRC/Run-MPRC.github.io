'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  claimReconciliationSchemaVersion,
  MEMBERSHIP_CLAIM_RECONCILIATION_ENUMS,
  MembershipClaimReconciliationError,
  classifyClaimReconciliation,
} = require('./membershipClaimReconciliation');

// A PII-shaped value that must never survive into a result or a thrown error.
const HOSTILE_CANARY = 'private-member@example.test/+12025550170?token=do-not-copy';

const RESULT_KEYS = [
  'claimReconciliationSchemaVersion',
  'disposition',
  'reason',
  'grantsAuthority',
  'officerRoleAffected',
];

const ENTITLEMENTS = MEMBERSHIP_CLAIM_RECONCILIATION_ENUMS.entitlementDisposition;
const EMAILS = MEMBERSHIP_CLAIM_RECONCILIATION_ENUMS.emailVerification;
const MEMBER_CLAIMS = MEMBERSHIP_CLAIM_RECONCILIATION_ENUMS.observedMemberClaim;
const OFFICER_CLAIMS = MEMBERSHIP_CLAIM_RECONCILIATION_ENUMS.observedOfficerClaim;

function evidence(overrides = {}) {
  return {
    claimReconciliationSchemaVersion: 1,
    entitlementDisposition: 'current_member',
    emailVerification: 'verified',
    observedMemberClaim: 'present',
    observedOfficerClaim: 'none',
    ...overrides,
  };
}

// An independent restatement of the specified semantics (from the issue's
// acceptance criteria), used as the oracle for the exhaustive matrix. It does not
// call into the module, and it never inspects `observedOfficerClaim` -- so
// agreeing with it proves the member reconciliation is officer-independent.
function expectedDisposition(e) {
  const desired = (e.entitlementDisposition === 'current_member' && e.emailVerification === 'verified')
    ? 'present'
    : 'absent';
  if (desired === e.observedMemberClaim) return 'aligned';
  return desired === 'present' ? 'grant_member' : 'revoke_member';
}

function classifyError(input) {
  try {
    classifyClaimReconciliation(input);
  } catch (err) {
    return err;
  }
  return null;
}

function expectRejected(input) {
  const err = classifyError(input);
  expect(err).toBeInstanceOf(MembershipClaimReconciliationError);
  expect(err.message).toBe('Membership claim reconciliation input is invalid.');
  expect(err.code).toBe('invalid_membership_claim_reconciliation');
  // The fixed error must never echo any part of the offending input.
  expect(JSON.stringify(err)).not.toContain(HOSTILE_CANARY);
  expect(String(err)).not.toContain(HOSTILE_CANARY);
  return err;
}

describe('entitlement-to-authorization-claim reconciliation matrix', () => {
  test('every entitlement/email/member/officer combination is classified consistently', () => {
    let count = 0;
    const byNonOfficer = new Map();
    for (const entitlementDisposition of ENTITLEMENTS) {
      for (const emailVerification of EMAILS) {
        for (const observedMemberClaim of MEMBER_CLAIMS) {
          for (const observedOfficerClaim of OFFICER_CLAIMS) {
            const e = evidence({
              entitlementDisposition, emailVerification, observedMemberClaim, observedOfficerClaim,
            });
            const result = classifyClaimReconciliation(e);

            expect(Object.isFrozen(result)).toBe(true);
            expect(Object.keys(result)).toEqual(RESULT_KEYS);
            expect(result.claimReconciliationSchemaVersion).toBe(1);
            expect(result.grantsAuthority).toBe(false);
            expect(result.officerRoleAffected).toBe(false);
            expect(MEMBERSHIP_CLAIM_RECONCILIATION_ENUMS.disposition).toContain(result.disposition);
            expect(result.disposition).toBe(expectedDisposition(e));

            // Record the disposition keyed without the officer claim to prove
            // membership reconciliation is independent of the officer role.
            const key = `${entitlementDisposition}|${emailVerification}|${observedMemberClaim}`;
            if (!byNonOfficer.has(key)) byNonOfficer.set(key, new Set());
            byNonOfficer.get(key).add(result.disposition);
            count += 1;
          }
        }
      }
    }
    expect(count).toBe(
      ENTITLEMENTS.length * EMAILS.length * MEMBER_CLAIMS.length * OFFICER_CLAIMS.length,
    );
    expect(count).toBe(24);
    // Officer-independence: identical non-officer inputs yield one disposition
    // whether the subject holds admin or not.
    for (const dispositions of byNonOfficer.values()) {
      expect(dispositions.size).toBe(1);
    }
  });
});

describe('explicit reconciliation dispositions', () => {
  const cases = [
    ['aligned when an entitled verified member already holds the claim', {
      entitlementDisposition: 'current_member', emailVerification: 'verified', observedMemberClaim: 'present',
    }, 'aligned', 'member_claim_matches_entitlement'],
    ['grant_member when an entitled verified member lacks the claim', {
      entitlementDisposition: 'current_member', emailVerification: 'verified', observedMemberClaim: 'absent',
    }, 'grant_member', 'entitled_member_claim_missing'],
    ['revoke_member when a lapsed member still holds the claim', {
      entitlementDisposition: 'not_entitled', emailVerification: 'verified', observedMemberClaim: 'present',
    }, 'revoke_member', 'unentitled_member_claim_present'],
    ['revoke_member while a decision is pending (fail-closed)', {
      entitlementDisposition: 'decision_pending', emailVerification: 'verified', observedMemberClaim: 'present',
    }, 'revoke_member', 'unentitled_member_claim_present'],
    ['revoke_member when the email is unverified (fail-closed)', {
      entitlementDisposition: 'current_member', emailVerification: 'unverified', observedMemberClaim: 'present',
    }, 'revoke_member', 'unentitled_member_claim_present'],
    ['aligned when an unverified member correctly lacks the claim', {
      entitlementDisposition: 'current_member', emailVerification: 'unverified', observedMemberClaim: 'absent',
    }, 'aligned', 'member_claim_matches_entitlement'],
    ['aligned when a non-member correctly lacks the claim', {
      entitlementDisposition: 'not_entitled', emailVerification: 'verified', observedMemberClaim: 'absent',
    }, 'aligned', 'member_claim_matches_entitlement'],
  ];

  test.each(cases)('%s', (_name, overrides, disposition, reason) => {
    const result = classifyClaimReconciliation(evidence(overrides));
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.disposition).toBe(disposition);
    expect(result.reason).toBe(reason);
    expect(result.grantsAuthority).toBe(false);
    expect(result.officerRoleAffected).toBe(false);
  });

  test('a reconciliation verdict never grants authority or affects the officer role', () => {
    for (const overrides of cases.map((entry) => entry[1])) {
      const result = classifyClaimReconciliation(evidence(overrides));
      expect(result.grantsAuthority).toBe(false);
      expect(result.officerRoleAffected).toBe(false);
    }
  });

  test('membership reconciliation never grants or revokes the officer role', () => {
    // An officer whose membership lapses: the member claim is revoked, admin is untouched.
    const lapsedOfficer = classifyClaimReconciliation(evidence({
      entitlementDisposition: 'not_entitled', observedMemberClaim: 'present', observedOfficerClaim: 'admin',
    }));
    expect(lapsedOfficer.disposition).toBe('revoke_member');
    expect(lapsedOfficer.officerRoleAffected).toBe(false);

    // A brand-new member who is not an officer is never made one.
    const newMember = classifyClaimReconciliation(evidence({
      entitlementDisposition: 'current_member', emailVerification: 'verified',
      observedMemberClaim: 'absent', observedOfficerClaim: 'none',
    }));
    expect(newMember.disposition).toBe('grant_member');
    expect(newMember.officerRoleAffected).toBe(false);

    // The disposition is identical whether or not the subject is an officer.
    for (const entitlementDisposition of ENTITLEMENTS) {
      for (const observedMemberClaim of MEMBER_CLAIMS) {
        const asOfficer = classifyClaimReconciliation(evidence({
          entitlementDisposition, observedMemberClaim, observedOfficerClaim: 'admin',
        }));
        const asNonOfficer = classifyClaimReconciliation(evidence({
          entitlementDisposition, observedMemberClaim, observedOfficerClaim: 'none',
        }));
        expect(asOfficer.disposition).toBe(asNonOfficer.disposition);
      }
    }
  });
});

describe('malformed and hostile input is rejected without echo', () => {
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'present'],
    ['a number', 42],
    ['an array', []],
  ])('throws on %s', (_name, input) => {
    expectRejected(input);
  });

  test('rejects a wrong schema version', () => {
    expectRejected(evidence({ claimReconciliationSchemaVersion: 2 }));
  });

  test.each([
    ['entitlementDisposition', 'suspended'],
    ['emailVerification', 'pending'],
    ['observedMemberClaim', 'maybe'],
    ['observedOfficerClaim', 'superadmin'],
  ])('rejects an unknown %s value', (field, value) => {
    expectRejected(evidence({ [field]: value }));
  });

  test('rejects a boolean where a string enum is required', () => {
    expectRejected(evidence({ emailVerification: true }));
    expectRejected(evidence({ observedMemberClaim: false }));
  });

  test('rejects a missing field', () => {
    const missing = evidence();
    delete missing.observedOfficerClaim;
    expectRejected(missing);
  });

  test('rejects an extra field and never reads its value', () => {
    expectRejected({ ...evidence(), injected: HOSTILE_CANARY });
  });

  test('rejects a proxy operand', () => {
    expectRejected(new Proxy(evidence(), {}));
  });

  test('rejects an accessor field without invoking the getter', () => {
    const accessor = evidence();
    delete accessor.observedOfficerClaim;
    Object.defineProperty(accessor, 'observedOfficerClaim', {
      enumerable: true,
      configurable: true,
      get() { return HOSTILE_CANARY; },
    });
    expectRejected(accessor);
  });

  test('rejects an operand whose fields are inherited', () => {
    expectRejected(Object.create(evidence()));
  });
});

describe('frozen versioned surface', () => {
  test('exposes a stable version and frozen enums', () => {
    expect(claimReconciliationSchemaVersion).toBe(1);
    expect(Object.isFrozen(MEMBERSHIP_CLAIM_RECONCILIATION_ENUMS)).toBe(true);
    for (const values of Object.values(MEMBERSHIP_CLAIM_RECONCILIATION_ENUMS)) {
      expect(Object.isFrozen(values)).toBe(true);
    }
  });

  test('publishes the authorization-only vocabularies', () => {
    expect(MEMBERSHIP_CLAIM_RECONCILIATION_ENUMS.entitlementDisposition).toEqual([
      'current_member', 'not_entitled', 'decision_pending',
    ]);
    expect(MEMBERSHIP_CLAIM_RECONCILIATION_ENUMS.observedOfficerClaim).toEqual(['admin', 'none']);
    expect([...MEMBERSHIP_CLAIM_RECONCILIATION_ENUMS.disposition].sort()).toEqual([
      'aligned', 'grant_member', 'revoke_member',
    ]);
  });

  test('the error type is frozen and carries no input', () => {
    const err = new MembershipClaimReconciliationError();
    expect(Object.isFrozen(err)).toBe(true);
    expect(Object.keys(err)).toEqual([]);
    expect(JSON.stringify(err)).toBe('{}');
  });
});

describe('source boundary', () => {
  const source = fs.readFileSync(path.join(__dirname, 'membershipClaimReconciliation.js'), 'utf8');

  test('is imported by no runtime entrypoint', () => {
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toContain('membershipClaimReconciliation');
  });

  test('requires only node:util', () => {
    const requires = [...source.matchAll(/require\(([^)]+)\)/g)].map((match) => match[1]);
    expect(requires).toEqual(["'node:util'"]);
  });

  test('reads no clock, randomness, network, environment, or console', () => {
    for (const forbidden of [
      'process.env', 'Date.now', 'new Date', 'Math.random',
      'console.', 'fetch(', 'https:', 'http:', 'firebase', 'stripe',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  test('models no personal-data, provider-id, or secret fields (claims are authorization only)', () => {
    expect(source).not.toMatch(
      /phoneNumber|emailAddress|streetAddress|dateOfBirth|emergencyContact/i,
    );
    expect(source).not.toMatch(/passwordHash|accessToken|refreshToken|clientSecret|apiKey|bearer/i);
    expect(source).not.toMatch(/providerId|providerAccountRef|athleteId|whatsappNumber/i);
  });

  test('hard-codes the no-authority and officer-untouched invariants', () => {
    expect(source).toContain('grantsAuthority: false');
    expect(source).not.toContain('grantsAuthority: true');
    expect(source).toContain('officerRoleAffected: false');
    expect(source).not.toContain('officerRoleAffected: true');
  });
});
