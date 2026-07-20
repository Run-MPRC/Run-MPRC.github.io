'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  consentStateSchemaVersion,
  MEMBERSHIP_CONSENT_STATE_ENUMS,
  MembershipConsentStateError,
  classifyConsentState,
} = require('./membershipConsentState');

// A PII-shaped value that must never survive into a result or a thrown error.
const HOSTILE_CANARY = 'private-member@example.test/+12025550170?token=do-not-copy';

const RESULT_KEYS = ['consentStateSchemaVersion', 'disposition', 'reason', 'grantsAuthority'];

const PROVIDERS = MEMBERSHIP_CONSENT_STATE_ENUMS.provider;

const REQUIRED_POLICY = 'policy.v3';
const SUPERSEDED_POLICY = 'policy.v2';

function evidence(overrides = {}) {
  return {
    consentStateSchemaVersion: 1,
    provider: 'google',
    subjectRef: 'mem-2026-ab12cd',
    scopeRef: 'scope.whatsapp-messaging',
    latestDecision: 'granted',
    latestPolicyVersion: REQUIRED_POLICY,
    requiredPolicyVersion: REQUIRED_POLICY,
    ...overrides,
  };
}

// An independent restatement of the specified semantics (from the issue's
// acceptance criteria), used as the oracle for the exhaustive matrix. It does not
// call into the module, and it never inspects `provider` -- so agreeing with it
// proves the rule is provider-neutral. Policy versions are compared for equality
// only, never ordered.
function expectedDisposition(e) {
  if (e.latestDecision === 'none') return 'not_consented';
  if (e.latestDecision === 'withdrawn') return 'withdrawn';
  return e.latestPolicyVersion === e.requiredPolicyVersion ? 'active' : 'reaffirmation_required';
}

function classifyError(input) {
  try {
    classifyConsentState(input);
  } catch (err) {
    return err;
  }
  return null;
}

function expectRejected(input) {
  const err = classifyError(input);
  expect(err).toBeInstanceOf(MembershipConsentStateError);
  expect(err.message).toBe('Membership consent state input is invalid.');
  expect(err.code).toBe('invalid_membership_consent_state');
  // The fixed error must never echo any part of the offending input.
  expect(JSON.stringify(err)).not.toContain(HOSTILE_CANARY);
  expect(String(err)).not.toContain(HOSTILE_CANARY);
  return err;
}

describe('provider-neutral versioned consent-state matrix', () => {
  // The coherent (latestDecision, latestPolicyVersion) shapes for a fixed
  // requiredPolicyVersion: a policy version is present iff a decision was recorded.
  const SHAPES = [
    { key: 'none', latestDecision: 'none', latestPolicyVersion: null },
    { key: 'granted-current', latestDecision: 'granted', latestPolicyVersion: REQUIRED_POLICY },
    { key: 'granted-superseded', latestDecision: 'granted', latestPolicyVersion: SUPERSEDED_POLICY },
    { key: 'withdrawn-current', latestDecision: 'withdrawn', latestPolicyVersion: REQUIRED_POLICY },
    { key: 'withdrawn-superseded', latestDecision: 'withdrawn', latestPolicyVersion: SUPERSEDED_POLICY },
  ];

  test('every provider/decision/policy-version combination is classified consistently', () => {
    let count = 0;
    const byShape = new Map();
    for (const provider of PROVIDERS) {
      for (const shape of SHAPES) {
        const e = evidence({
          provider,
          latestDecision: shape.latestDecision,
          latestPolicyVersion: shape.latestPolicyVersion,
          requiredPolicyVersion: REQUIRED_POLICY,
        });
        const result = classifyConsentState(e);

        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.keys(result)).toEqual(RESULT_KEYS);
        expect(result.consentStateSchemaVersion).toBe(1);
        expect(result.grantsAuthority).toBe(false);
        expect(MEMBERSHIP_CONSENT_STATE_ENUMS.disposition).toContain(result.disposition);
        expect(result.disposition).toBe(expectedDisposition(e));

        // Record the disposition keyed without provider to prove neutrality.
        if (!byShape.has(shape.key)) byShape.set(shape.key, new Set());
        byShape.get(shape.key).add(result.disposition);
        count += 1;
      }
    }
    expect(count).toBe(PROVIDERS.length * SHAPES.length);
    expect(count).toBe(20);
    // Provider-neutrality: identical non-provider inputs yield one disposition
    // regardless of which of the four providers is named.
    for (const dispositions of byShape.values()) {
      expect(dispositions.size).toBe(1);
    }
  });
});

describe('explicit consent dispositions', () => {
  const cases = [
    ['active when a granted consent matches the policy in force', {
      latestDecision: 'granted', latestPolicyVersion: 'policy.v3', requiredPolicyVersion: 'policy.v3',
    }, 'active', 'consent_current'],
    ['reaffirmation_required when the granting policy version is superseded', {
      latestDecision: 'granted', latestPolicyVersion: 'policy.v2', requiredPolicyVersion: 'policy.v3',
    }, 'reaffirmation_required', 'policy_version_superseded'],
    ['reaffirmation_required even when the in-force version is the lower-numbered one', {
      // Equality only: a "newer" grant than the version in force still reaffirms.
      latestDecision: 'granted', latestPolicyVersion: 'policy.v3', requiredPolicyVersion: 'policy.v2',
    }, 'reaffirmation_required', 'policy_version_superseded'],
    ['withdrawn is terminal even under the current policy version', {
      latestDecision: 'withdrawn', latestPolicyVersion: 'policy.v3', requiredPolicyVersion: 'policy.v3',
    }, 'withdrawn', 'consent_withdrawn'],
    ['withdrawn ignores a superseded policy version', {
      latestDecision: 'withdrawn', latestPolicyVersion: 'policy.v1', requiredPolicyVersion: 'policy.v3',
    }, 'withdrawn', 'consent_withdrawn'],
    ['not_consented when no decision is on record', {
      latestDecision: 'none', latestPolicyVersion: null, requiredPolicyVersion: 'policy.v3',
    }, 'not_consented', 'no_decision_recorded'],
  ];

  test.each(cases)('%s', (_name, overrides, disposition, reason) => {
    const result = classifyConsentState(evidence(overrides));
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.disposition).toBe(disposition);
    expect(result.reason).toBe(reason);
    expect(result.grantsAuthority).toBe(false);
  });

  test('a consent state never grants authority in any classified case', () => {
    for (const overrides of cases.map((entry) => entry[1])) {
      expect(classifyConsentState(evidence(overrides)).grantsAuthority).toBe(false);
    }
  });
});

describe('malformed and hostile input is rejected without echo', () => {
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'granted'],
    ['a number', 42],
    ['an array', []],
  ])('throws on %s', (_name, input) => {
    expectRejected(input);
  });

  test('rejects a wrong schema version', () => {
    expectRejected(evidence({ consentStateSchemaVersion: 2 }));
  });

  test.each([
    ['provider', 'facebook'],
    ['latestDecision', 'maybe'],
  ])('rejects an unknown %s value', (field, value) => {
    expectRejected(evidence({ [field]: value }));
  });

  test('rejects non-opaque or PII-shaped identifiers', () => {
    expectRejected(evidence({ subjectRef: HOSTILE_CANARY }));
    expectRejected(evidence({ scopeRef: 'member@example.test' }));
    expectRejected(evidence({ requiredPolicyVersion: '+12025550170' }));
    expectRejected(evidence({ requiredPolicyVersion: 42 }));
    expectRejected(evidence({ latestPolicyVersion: HOSTILE_CANARY }));
  });

  test('rejects an incoherent decision / policy-version pairing', () => {
    // A recorded decision must carry an opaque policy version...
    expectRejected(evidence({ latestDecision: 'granted', latestPolicyVersion: null }));
    expectRejected(evidence({ latestDecision: 'withdrawn', latestPolicyVersion: null }));
    // ...and 'none' must carry exactly null, never a version (or a smuggled value).
    expectRejected(evidence({ latestDecision: 'none', latestPolicyVersion: 'policy.v3' }));
    expectRejected(evidence({ latestDecision: 'none', latestPolicyVersion: HOSTILE_CANARY }));
  });

  test('rejects a missing field', () => {
    const missing = evidence();
    delete missing.requiredPolicyVersion;
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
    delete accessor.requiredPolicyVersion;
    Object.defineProperty(accessor, 'requiredPolicyVersion', {
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
    expect(consentStateSchemaVersion).toBe(1);
    expect(Object.isFrozen(MEMBERSHIP_CONSENT_STATE_ENUMS)).toBe(true);
    for (const values of Object.values(MEMBERSHIP_CONSENT_STATE_ENUMS)) {
      expect(Object.isFrozen(values)).toBe(true);
    }
  });

  test('models the four providers under one neutral vocabulary', () => {
    expect(PROVIDERS).toEqual(['email_password', 'google', 'whatsapp', 'strava']);
    expect(PROVIDERS).not.toContain('facebook');
    expect(PROVIDERS).not.toContain('apple');
  });

  test('publishes the decision and disposition vocabularies', () => {
    expect(MEMBERSHIP_CONSENT_STATE_ENUMS.latestDecision).toEqual(['granted', 'withdrawn', 'none']);
    expect([...MEMBERSHIP_CONSENT_STATE_ENUMS.disposition].sort()).toEqual([
      'active',
      'not_consented',
      'reaffirmation_required',
      'withdrawn',
    ]);
  });

  test('the error type is frozen and carries no input', () => {
    const err = new MembershipConsentStateError();
    expect(Object.isFrozen(err)).toBe(true);
    expect(Object.keys(err)).toEqual([]);
    expect(JSON.stringify(err)).toBe('{}');
  });
});

describe('source boundary', () => {
  const source = fs.readFileSync(path.join(__dirname, 'membershipConsentState.js'), 'utf8');

  test('is imported by no runtime entrypoint', () => {
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toContain('membershipConsentState');
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

  test('models no personal-data or secret fields', () => {
    expect(source).not.toMatch(
      /phoneNumber|emailAddress|streetAddress|dateOfBirth|emergencyContact/i,
    );
    expect(source).not.toMatch(/passwordHash|accessToken|refreshToken|clientSecret|apiKey|bearer/i);
  });

  test('hard-codes the no-authority invariant', () => {
    expect(source).toContain('grantsAuthority: false');
    expect(source).not.toContain('grantsAuthority: true');
  });
});
