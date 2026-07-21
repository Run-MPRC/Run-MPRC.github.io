'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  tokenReconciliationSchemaVersion,
  TOKEN_RECONCILIATION_ENUMS,
  TokenReconciliationError,
  classifyTokenReconciliation,
} = require('./tokenReconciliation');

// The REAL upstream claim-value contract (MEMBERS-IDENTITY-001E, §8.0c). The
// cross-seam section drives its output into this reducer to prove the composed
// entitlement -> claim-value -> token-action chain closes item 4's expiry->revoke
// loop. Nothing is mocked.
const { classifyClaimReconciliation } = require('./membershipClaimReconciliation');

// A PII/secret-shaped value that must never survive into a result or a thrown error.
const HOSTILE_CANARY = 'private-member@example.test/+12025550170?token=do-not-copy';

const RESULT_KEYS = [
  'tokenReconciliationSchemaVersion',
  'action',
  'reason',
  'grantsAuthority',
  'officerRoleAffected',
];

const DISPOSITIONS = TOKEN_RECONCILIATION_ENUMS.reconciliationDisposition;
const SESSIONS = TOKEN_RECONCILIATION_ENUMS.sessionState;
// (authoritativeClaimsVersion, observedTokenClaimsVersion) pairs covering equal,
// stale-behind, ahead-anomalous, and zero cursors.
const VERSION_PAIRS = [[7, 7], [7, 6], [6, 7], [0, 0], [0, 1], [1, 0]];

function evidence(overrides = {}) {
  return {
    tokenReconciliationSchemaVersion: 1,
    reconciliationDisposition: 'aligned',
    sessionState: 'active_session',
    authoritativeClaimsVersion: 7,
    observedTokenClaimsVersion: 7,
    ...overrides,
  };
}

// An independent restatement of the specified semantics (from the issue's decision
// table), used as the oracle for the exhaustive matrix. It does not call into the
// module. It proves, by construction, that force_revoke depends ONLY on
// reconciliationDisposition === 'revoke_member' (never on session/version), that a
// granted claim refreshes only an active session, and that an aligned claim
// refreshes only a stale-version active session.
function expectedResult(e) {
  if (e.reconciliationDisposition === 'revoke_member') {
    return { action: 'force_revoke', reason: 'deentitled_revoke_sessions' };
  }
  if (e.reconciliationDisposition === 'grant_member') {
    return e.sessionState === 'active_session'
      ? { action: 'force_refresh', reason: 'entitled_refresh_active_session' }
      : { action: 'noop', reason: 'entitled_pending_next_signin' };
  }
  if (e.sessionState === 'no_session') {
    return { action: 'noop', reason: 'aligned_no_session' };
  }
  return e.observedTokenClaimsVersion !== e.authoritativeClaimsVersion
    ? { action: 'force_refresh', reason: 'aligned_stale_claims_version' }
    : { action: 'noop', reason: 'aligned_current_claims_version' };
}

function classifyError(input) {
  try {
    classifyTokenReconciliation(input);
  } catch (err) {
    return err;
  }
  return null;
}

function expectRejected(input) {
  const err = classifyError(input);
  expect(err).toBeInstanceOf(TokenReconciliationError);
  expect(err.message).toBe('Token reconciliation input is invalid.');
  expect(err.code).toBe('invalid_token_reconciliation');
  // The fixed error must never echo any part of the offending input.
  expect(JSON.stringify(err)).not.toContain(HOSTILE_CANARY);
  expect(String(err)).not.toContain(HOSTILE_CANARY);
  return err;
}

describe('token-reconciliation decision matrix', () => {
  test('every disposition/session/version combination is classified consistently', () => {
    let count = 0;
    const forceRevokeInputs = [];
    for (const reconciliationDisposition of DISPOSITIONS) {
      for (const sessionState of SESSIONS) {
        for (const [authoritativeClaimsVersion, observedTokenClaimsVersion] of VERSION_PAIRS) {
          const e = evidence({
            reconciliationDisposition,
            sessionState,
            authoritativeClaimsVersion,
            observedTokenClaimsVersion,
          });
          const result = classifyTokenReconciliation(e);

          expect(Object.isFrozen(result)).toBe(true);
          expect(Object.keys(result)).toEqual(RESULT_KEYS);
          expect(result.tokenReconciliationSchemaVersion).toBe(1);
          expect(result.grantsAuthority).toBe(false);
          expect(result.officerRoleAffected).toBe(false);
          expect(TOKEN_RECONCILIATION_ENUMS.action).toContain(result.action);

          const expected = expectedResult(e);
          expect(result.action).toBe(expected.action);
          expect(result.reason).toBe(expected.reason);

          if (result.action === 'force_revoke') forceRevokeInputs.push(e);
          count += 1;
        }
      }
    }
    expect(count).toBe(DISPOSITIONS.length * SESSIONS.length * VERSION_PAIRS.length);
    expect(count).toBe(36);

    // Crown jewel: force_revoke happens for EXACTLY the revoke_member inputs, and
    // for ALL of them (both directions of the iff).
    expect(forceRevokeInputs).toHaveLength(SESSIONS.length * VERSION_PAIRS.length);
    for (const e of forceRevokeInputs) {
      expect(e.reconciliationDisposition).toBe('revoke_member');
    }
  });

  test('force_revoke <=> revoke_member across the whole matrix (no spurious revoke, no missed revoke)', () => {
    for (const reconciliationDisposition of DISPOSITIONS) {
      for (const sessionState of SESSIONS) {
        for (const [authoritativeClaimsVersion, observedTokenClaimsVersion] of VERSION_PAIRS) {
          const result = classifyTokenReconciliation(evidence({
            reconciliationDisposition,
            sessionState,
            authoritativeClaimsVersion,
            observedTokenClaimsVersion,
          }));
          expect(result.action === 'force_revoke')
            .toBe(reconciliationDisposition === 'revoke_member');
        }
      }
    }
  });
});

describe('explicit dispositions', () => {
  const cases = [
    ['revoke_member forces session revocation (active)', {
      reconciliationDisposition: 'revoke_member', sessionState: 'active_session',
    }, 'force_revoke', 'deentitled_revoke_sessions'],
    ['revoke_member forces revocation even with no observed session (fail-closed)', {
      reconciliationDisposition: 'revoke_member', sessionState: 'no_session',
    }, 'force_revoke', 'deentitled_revoke_sessions'],
    ['grant_member forces a refresh on an active session', {
      reconciliationDisposition: 'grant_member', sessionState: 'active_session',
    }, 'force_refresh', 'entitled_refresh_active_session'],
    ['grant_member with no session defers to the next sign-in', {
      reconciliationDisposition: 'grant_member', sessionState: 'no_session',
    }, 'noop', 'entitled_pending_next_signin'],
    ['aligned with a stale-behind claims-version forces a refresh', {
      reconciliationDisposition: 'aligned', sessionState: 'active_session',
      authoritativeClaimsVersion: 9, observedTokenClaimsVersion: 8,
    }, 'force_refresh', 'aligned_stale_claims_version'],
    ['aligned with an ahead-anomalous claims-version still forces a refresh', {
      reconciliationDisposition: 'aligned', sessionState: 'active_session',
      authoritativeClaimsVersion: 8, observedTokenClaimsVersion: 9,
    }, 'force_refresh', 'aligned_stale_claims_version'],
    ['aligned with a current claims-version is a noop', {
      reconciliationDisposition: 'aligned', sessionState: 'active_session',
      authoritativeClaimsVersion: 9, observedTokenClaimsVersion: 9,
    }, 'noop', 'aligned_current_claims_version'],
    ['aligned with no session is a noop', {
      reconciliationDisposition: 'aligned', sessionState: 'no_session',
    }, 'noop', 'aligned_no_session'],
  ];

  test.each(cases)('%s', (_name, overrides, action, reason) => {
    const result = classifyTokenReconciliation(evidence(overrides));
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.action).toBe(action);
    expect(result.reason).toBe(reason);
    expect(result.grantsAuthority).toBe(false);
    expect(result.officerRoleAffected).toBe(false);
  });

  test('a token verdict never grants authority or affects the officer role', () => {
    for (const overrides of cases.map((entry) => entry[1])) {
      const result = classifyTokenReconciliation(evidence(overrides));
      expect(result.grantsAuthority).toBe(false);
      expect(result.officerRoleAffected).toBe(false);
    }
  });
});

describe('fail-closed access-revocation invariants', () => {
  test('revoke_member forces revocation regardless of session state or version cursors', () => {
    for (const sessionState of SESSIONS) {
      for (const [authoritativeClaimsVersion, observedTokenClaimsVersion] of VERSION_PAIRS) {
        const result = classifyTokenReconciliation(evidence({
          reconciliationDisposition: 'revoke_member',
          sessionState,
          authoritativeClaimsVersion,
          observedTokenClaimsVersion,
        }));
        expect(result.action).toBe('force_revoke');
        expect(result.reason).toBe('deentitled_revoke_sessions');
      }
    }
  });

  test('a still-entitled member (aligned or grant) is never spuriously revoked', () => {
    for (const reconciliationDisposition of ['aligned', 'grant_member']) {
      for (const sessionState of SESSIONS) {
        for (const [authoritativeClaimsVersion, observedTokenClaimsVersion] of VERSION_PAIRS) {
          const result = classifyTokenReconciliation(evidence({
            reconciliationDisposition,
            sessionState,
            authoritativeClaimsVersion,
            observedTokenClaimsVersion,
          }));
          expect(result.action).not.toBe('force_revoke');
        }
      }
    }
  });

  test('revoke_member ignores session/version: all such inputs share one frozen verdict', () => {
    const a = classifyTokenReconciliation(evidence({ reconciliationDisposition: 'revoke_member' }));
    const b = classifyTokenReconciliation(evidence({
      reconciliationDisposition: 'revoke_member',
      sessionState: 'no_session',
      authoritativeClaimsVersion: 3,
      observedTokenClaimsVersion: 999,
    }));
    // Same precomputed frozen result object, proving the branch reads neither field.
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });
});

describe('claims-version staleness semantics', () => {
  test('grant_member on an active session refreshes regardless of the version pair', () => {
    for (const [authoritativeClaimsVersion, observedTokenClaimsVersion] of VERSION_PAIRS) {
      const result = classifyTokenReconciliation(evidence({
        reconciliationDisposition: 'grant_member',
        sessionState: 'active_session',
        authoritativeClaimsVersion,
        observedTokenClaimsVersion,
      }));
      expect(result.action).toBe('force_refresh');
      expect(result.reason).toBe('entitled_refresh_active_session');
    }
  });

  test('aligned refreshes exactly when the active session version differs', () => {
    for (const [authoritativeClaimsVersion, observedTokenClaimsVersion] of VERSION_PAIRS) {
      const result = classifyTokenReconciliation(evidence({
        reconciliationDisposition: 'aligned',
        sessionState: 'active_session',
        authoritativeClaimsVersion,
        observedTokenClaimsVersion,
      }));
      const differ = authoritativeClaimsVersion !== observedTokenClaimsVersion;
      expect(result.action).toBe(differ ? 'force_refresh' : 'noop');
    }
  });

  test('a large but safe version cursor is accepted', () => {
    const result = classifyTokenReconciliation(evidence({
      reconciliationDisposition: 'aligned',
      sessionState: 'active_session',
      authoritativeClaimsVersion: Number.MAX_SAFE_INTEGER,
      observedTokenClaimsVersion: Number.MAX_SAFE_INTEGER - 1,
    }));
    expect(result.action).toBe('force_refresh');
  });
});

describe('malformed and hostile input is rejected without echo', () => {
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'aligned'],
    ['a number', 42],
    ['an array', []],
    ['a boolean', true],
  ])('throws on %s', (_name, input) => {
    expectRejected(input);
  });

  test('rejects a wrong schema version', () => {
    expectRejected(evidence({ tokenReconciliationSchemaVersion: 2 }));
    expectRejected(evidence({ tokenReconciliationSchemaVersion: '1' }));
  });

  test.each([
    ['reconciliationDisposition', 'suspend_member'],
    ['reconciliationDisposition', 'revoke'],
    ['sessionState', 'expired_session'],
  ])('rejects an unknown %s value', (field, value) => {
    expectRejected(evidence({ [field]: value }));
  });

  test('rejects a boolean where a string enum is required', () => {
    expectRejected(evidence({ reconciliationDisposition: true }));
    expectRejected(evidence({ sessionState: false }));
  });

  test.each([
    ['a float', 1.5],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['a negative integer', -1],
    ['a numeric string', '7'],
    ['a boolean', true],
    ['a bigint', 7n],
    ['a boxed Number', new Number(7)],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
    ['just over MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER + 2],
  ])('rejects authoritativeClaimsVersion = %s', (_name, value) => {
    expectRejected(evidence({ authoritativeClaimsVersion: value }));
  });

  test.each([
    ['a float', 2.5],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['a negative integer', -3],
    ['a numeric string', '4'],
    ['a bigint', 4n],
    ['a boxed Number', new Number(4)],
  ])('rejects observedTokenClaimsVersion = %s', (_name, value) => {
    expectRejected(evidence({ observedTokenClaimsVersion: value }));
  });

  test('validates the version shape even when the branch ignores it (revoke_member)', () => {
    // revoke_member never reads the version cursors, but the exact-shape contract
    // still rejects a malformed one: validation is shape-complete, not decision-driven.
    expectRejected(evidence({ reconciliationDisposition: 'revoke_member', authoritativeClaimsVersion: -1 }));
    expectRejected(evidence({ reconciliationDisposition: 'revoke_member', observedTokenClaimsVersion: 1.5 }));
    // ...and a well-formed revoke_member is still classified.
    expect(classifyTokenReconciliation(evidence({
      reconciliationDisposition: 'revoke_member',
    })).action).toBe('force_revoke');
  });

  test('rejects a missing field', () => {
    const missing = evidence();
    delete missing.observedTokenClaimsVersion;
    expectRejected(missing);
  });

  test('rejects an extra field and never reads its value', () => {
    expectRejected({ ...evidence(), injected: HOSTILE_CANARY });
  });

  test('rejects a proxy operand', () => {
    expectRejected(new Proxy(evidence(), {}));
  });

  test('rejects an accessor field without invoking the getter', () => {
    let invoked = 0;
    const accessor = evidence();
    delete accessor.observedTokenClaimsVersion;
    Object.defineProperty(accessor, 'observedTokenClaimsVersion', {
      enumerable: true,
      configurable: true,
      get() { invoked += 1; return HOSTILE_CANARY; },
    });
    expectRejected(accessor);
    // Proof the reader used getOwnPropertyDescriptor and never touched the getter.
    expect(invoked).toBe(0);
  });

  test('rejects a non-enumerable field', () => {
    const hidden = evidence();
    delete hidden.observedTokenClaimsVersion;
    Object.defineProperty(hidden, 'observedTokenClaimsVersion', {
      enumerable: false,
      configurable: true,
      writable: true,
      value: 7,
    });
    expectRejected(hidden);
  });

  test('rejects an operand whose fields are inherited', () => {
    expectRejected(Object.create(evidence()));
  });

  test('rejects an operand carrying an own symbol key', () => {
    const withSymbol = evidence();
    withSymbol[Symbol('extra')] = HOSTILE_CANARY;
    expectRejected(withSymbol);
  });
});

describe('determinism and immutability', () => {
  test('identical evidence yields a deeply-equal frozen result every time', () => {
    const e = evidence({ reconciliationDisposition: 'grant_member', sessionState: 'active_session' });
    const first = classifyTokenReconciliation(e);
    const second = classifyTokenReconciliation({ ...e });
    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
  });

  test('result is independent of own-key insertion order', () => {
    const forward = classifyTokenReconciliation({
      tokenReconciliationSchemaVersion: 1,
      reconciliationDisposition: 'aligned',
      sessionState: 'active_session',
      authoritativeClaimsVersion: 5,
      observedTokenClaimsVersion: 4,
    });
    const shuffled = classifyTokenReconciliation({
      observedTokenClaimsVersion: 4,
      sessionState: 'active_session',
      authoritativeClaimsVersion: 5,
      reconciliationDisposition: 'aligned',
      tokenReconciliationSchemaVersion: 1,
    });
    expect(shuffled).toEqual(forward);
    expect(shuffled.action).toBe('force_refresh');
  });

  test('the returned result cannot be mutated', () => {
    const result = classifyTokenReconciliation(evidence({ reconciliationDisposition: 'revoke_member' }));
    expect(() => { result.action = 'noop'; }).toThrow();
    expect(result.action).toBe('force_revoke');
  });
});

describe('cross-seam composition with the real §8.0c claim contract', () => {
  // Build §8.0c (membershipClaimReconciliation) evidence.
  function claimEvidence(overrides = {}) {
    return {
      claimReconciliationSchemaVersion: 1,
      entitlementDisposition: 'current_member',
      emailVerification: 'verified',
      observedMemberClaim: 'present',
      observedOfficerClaim: 'none',
      ...overrides,
    };
  }

  // The full item-4 pipeline: entitlement/claim reconciliation -> token disposition.
  function pipeline(claimOverrides, sessionState, authoritativeClaimsVersion, observedTokenClaimsVersion) {
    const claim = classifyClaimReconciliation(claimEvidence(claimOverrides));
    return {
      claim,
      token: classifyTokenReconciliation({
        tokenReconciliationSchemaVersion: 1,
        reconciliationDisposition: claim.disposition,
        sessionState,
        authoritativeClaimsVersion,
        observedTokenClaimsVersion,
      }),
    };
  }

  test('a lapsed member holding the claim: §8.0c revoke_member -> §8.0g force_revoke', () => {
    const { claim, token } = pipeline(
      { entitlementDisposition: 'not_entitled', observedMemberClaim: 'present' },
      'active_session', 5, 5,
    );
    expect(claim.disposition).toBe('revoke_member');
    expect(token.action).toBe('force_revoke');
    expect(token.reason).toBe('deentitled_revoke_sessions');
  });

  test('an unverified member holding the claim: revoke_member -> force_revoke (fail-closed)', () => {
    const { claim, token } = pipeline(
      { emailVerification: 'unverified', observedMemberClaim: 'present' },
      'active_session', 2, 2,
    );
    expect(claim.disposition).toBe('revoke_member');
    expect(token.action).toBe('force_revoke');
  });

  test('a lapsed OFFICER: member session force-revoked while the admin role is untouched', () => {
    const { claim, token } = pipeline(
      { entitlementDisposition: 'not_entitled', observedMemberClaim: 'present', observedOfficerClaim: 'admin' },
      'active_session', 1, 1,
    );
    expect(claim.disposition).toBe('revoke_member');
    expect(claim.officerRoleAffected).toBe(false);
    expect(token.action).toBe('force_revoke');
    expect(token.officerRoleAffected).toBe(false);
  });

  test('a newly entitled member lacking the claim: grant_member -> force_refresh (active) / noop (no session)', () => {
    const active = pipeline({ observedMemberClaim: 'absent' }, 'active_session', 3, 3);
    expect(active.claim.disposition).toBe('grant_member');
    expect(active.token.action).toBe('force_refresh');
    expect(active.token.reason).toBe('entitled_refresh_active_session');

    const dormant = pipeline({ observedMemberClaim: 'absent' }, 'no_session', 3, 3);
    expect(dormant.claim.disposition).toBe('grant_member');
    expect(dormant.token.action).toBe('noop');
    expect(dormant.token.reason).toBe('entitled_pending_next_signin');
  });

  test('an aligned entitled member: stale active session refreshes, current session is a noop', () => {
    const stale = pipeline({ observedMemberClaim: 'present' }, 'active_session', 8, 7);
    expect(stale.claim.disposition).toBe('aligned');
    expect(stale.token.action).toBe('force_refresh');
    expect(stale.token.reason).toBe('aligned_stale_claims_version');

    const current = pipeline({ observedMemberClaim: 'present' }, 'active_session', 8, 8);
    expect(current.claim.disposition).toBe('aligned');
    expect(current.token.action).toBe('noop');
    expect(current.token.reason).toBe('aligned_current_claims_version');
  });

  test('loop-closure: every §8.0c de-entitlement forces revocation of an active session', () => {
    // Drive the entire §8.0c input space through the pipeline. Whenever §8.0c
    // decides revoke_member, the token action for an active session MUST be
    // force_revoke -- proving item 4 ("expiry/refund/suspension -> force safe token
    // revocation") holds across every path the shipped claim contract can take.
    const ENTITLEMENTS = ['current_member', 'not_entitled', 'decision_pending'];
    const EMAILS = ['verified', 'unverified'];
    const MEMBER_CLAIMS = ['present', 'absent'];
    const OFFICER_CLAIMS = ['admin', 'none'];
    let revokeCount = 0;
    for (const entitlementDisposition of ENTITLEMENTS) {
      for (const emailVerification of EMAILS) {
        for (const observedMemberClaim of MEMBER_CLAIMS) {
          for (const observedOfficerClaim of OFFICER_CLAIMS) {
            const { claim, token } = pipeline(
              { entitlementDisposition, emailVerification, observedMemberClaim, observedOfficerClaim },
              'active_session', 4, 4,
            );
            if (claim.disposition === 'revoke_member') {
              revokeCount += 1;
              expect(token.action).toBe('force_revoke');
            } else {
              expect(token.action).not.toBe('force_revoke');
            }
          }
        }
      }
    }
    // Sanity: the space really does contain de-entitlement paths.
    expect(revokeCount).toBeGreaterThan(0);
  });
});

describe('frozen versioned surface', () => {
  test('exposes a stable version and frozen enums', () => {
    expect(tokenReconciliationSchemaVersion).toBe(1);
    expect(Object.isFrozen(TOKEN_RECONCILIATION_ENUMS)).toBe(true);
    for (const values of Object.values(TOKEN_RECONCILIATION_ENUMS)) {
      expect(Object.isFrozen(values)).toBe(true);
    }
  });

  test('publishes the closed decision vocabularies', () => {
    expect(TOKEN_RECONCILIATION_ENUMS.reconciliationDisposition).toEqual([
      'aligned', 'grant_member', 'revoke_member',
    ]);
    expect(TOKEN_RECONCILIATION_ENUMS.sessionState).toEqual(['active_session', 'no_session']);
    expect([...TOKEN_RECONCILIATION_ENUMS.action].sort()).toEqual([
      'force_refresh', 'force_revoke', 'noop',
    ]);
  });

  test('the error type is frozen and carries no input', () => {
    const err = new TokenReconciliationError();
    expect(Object.isFrozen(err)).toBe(true);
    expect(Object.keys(err)).toEqual([]);
    expect(JSON.stringify(err)).toBe('{}');
  });
});

describe('source boundary', () => {
  const rawSource = fs.readFileSync(path.join(__dirname, 'tokenReconciliation.js'), 'utf8');
  // Strip comments so legitimate domain narration (this module is ABOUT refresh-token
  // revocation) is not mistaken for a modeled credential field. The secret/PII
  // battery runs against executable CODE only.
  const codeOnly = rawSource
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');

  test('is imported by no runtime entrypoint', () => {
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toContain('tokenReconciliation');
  });

  test('requires only node:util', () => {
    const requires = [...codeOnly.matchAll(/require\(([^)]+)\)/g)].map((match) => match[1]);
    expect(requires).toEqual(["'node:util'"]);
  });

  test('the code reads no clock, randomness, network, environment, console, or URL', () => {
    for (const forbidden of [
      'process.env', 'Date.now', 'new Date', 'Math.random',
      'console.', 'fetch(', 'https:', 'http:', 'firebase', 'stripe', 'URL',
    ]) {
      expect(codeOnly).not.toContain(forbidden);
    }
  });

  test('the code models no credential VALUE, personal-data, or provider-id field', () => {
    // The data fields are integer version cursors and closed enums -- never a stored
    // token/secret/PII value. "token" here names the SESSION being reconciled.
    expect(codeOnly).not.toMatch(/accessToken|refreshToken|clientSecret|api[_]?key|bearer|passwordHash/i);
    expect(codeOnly).not.toMatch(/phoneNumber|emailAddress|streetAddress|dateOfBirth|emergencyContact/i);
    expect(codeOnly).not.toMatch(/providerId|providerAccountRef|athleteId|whatsappNumber/i);
  });

  test('the header names the issue code and the SOURCE ONLY, UNUSED status', () => {
    expect(rawSource).toContain('MEMBERS-DUES-001E');
    expect(rawSource).toContain('SOURCE ONLY, UNUSED');
    expect(rawSource).toContain('§8.0g');
  });

  test('hard-codes the no-authority and officer-untouched invariants', () => {
    expect(codeOnly).toContain('grantsAuthority: false');
    expect(codeOnly).not.toContain('grantsAuthority: true');
    expect(codeOnly).toContain('officerRoleAffected: false');
    expect(codeOnly).not.toContain('officerRoleAffected: true');
  });
});
