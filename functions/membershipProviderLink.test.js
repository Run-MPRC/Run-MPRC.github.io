'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  providerLinkSchemaVersion,
  MEMBERSHIP_PROVIDER_LINK_ENUMS,
  MembershipProviderLinkError,
  classifyProviderLinkReconciliation,
} = require('./membershipProviderLink');

// A PII-shaped value that must never survive into a result or a thrown error.
const HOSTILE_CANARY = 'private-member@example.test/+12025550170?token=do-not-copy';

const RESULT_KEYS = ['providerLinkSchemaVersion', 'disposition', 'reason', 'grantsAuthority'];

const PROVIDERS = MEMBERSHIP_PROVIDER_LINK_ENUMS.provider;
const CONSENTS = MEMBERSHIP_PROVIDER_LINK_ENUMS.consent;
const DESIREDS = MEMBERSHIP_PROVIDER_LINK_ENUMS.desiredState;
const OBSERVEDS = MEMBERSHIP_PROVIDER_LINK_ENUMS.observedState;

const SAME_MEMBERSHIP = 'mem-2026-ab12cd';
const OTHER_MEMBERSHIP = 'mem-2099-other1';
const BOUNDS = [null, SAME_MEMBERSHIP, OTHER_MEMBERSHIP];

function evidence(overrides = {}) {
  return {
    providerLinkSchemaVersion: 1,
    provider: 'google',
    membershipId: SAME_MEMBERSHIP,
    providerAccountRef: 'gref.9f8e7d6c5b4a',
    consent: 'granted',
    desiredState: 'linked',
    observedState: 'linked',
    boundMembershipId: null,
    ...overrides,
  };
}

// An independent restatement of the specified semantics (from the issue's
// acceptance criteria), used as the oracle for the exhaustive matrix. It does not
// call into the module.
function expectedDisposition(e) {
  if (e.desiredState === 'linked') {
    if (e.boundMembershipId !== null && e.boundMembershipId !== e.membershipId) {
      return 'collision';
    }
    if (e.consent !== 'granted') return 'blocked';
  }
  if (e.observedState === 'unknown') return 'observation_pending';
  if (e.desiredState === e.observedState) return 'aligned';
  return e.desiredState === 'linked' ? 'reconcile_link' : 'reconcile_unlink';
}

function classifyError(input) {
  try {
    classifyProviderLinkReconciliation(input);
  } catch (err) {
    return err;
  }
  return null;
}

function expectRejected(input) {
  const err = classifyError(input);
  expect(err).toBeInstanceOf(MembershipProviderLinkError);
  expect(err.message).toBe('Membership provider link input is invalid.');
  expect(err.code).toBe('invalid_membership_provider_link');
  // The fixed error must never echo any part of the offending input.
  expect(JSON.stringify(err)).not.toContain(HOSTILE_CANARY);
  expect(String(err)).not.toContain(HOSTILE_CANARY);
  return err;
}

describe('provider-neutral reconciliation matrix', () => {
  test('every provider/consent/desired/observed/bound combination is classified consistently', () => {
    let count = 0;
    const byNonProvider = new Map();
    for (const provider of PROVIDERS) {
      for (const consent of CONSENTS) {
        for (const desiredState of DESIREDS) {
          for (const observedState of OBSERVEDS) {
            for (const boundMembershipId of BOUNDS) {
              const e = evidence({
                provider, consent, desiredState, observedState, boundMembershipId,
              });
              const result = classifyProviderLinkReconciliation(e);

              expect(Object.isFrozen(result)).toBe(true);
              expect(Object.keys(result)).toEqual(RESULT_KEYS);
              expect(result.providerLinkSchemaVersion).toBe(1);
              expect(result.grantsAuthority).toBe(false);
              expect(MEMBERSHIP_PROVIDER_LINK_ENUMS.disposition).toContain(result.disposition);
              expect(result.disposition).toBe(expectedDisposition(e));

              // Record the disposition keyed without provider to prove neutrality.
              const key = `${consent}|${desiredState}|${observedState}|${boundMembershipId}`;
              if (!byNonProvider.has(key)) byNonProvider.set(key, new Set());
              byNonProvider.get(key).add(result.disposition);
              count += 1;
            }
          }
        }
      }
    }
    expect(count).toBe(
      PROVIDERS.length * CONSENTS.length * DESIREDS.length * OBSERVEDS.length * BOUNDS.length,
    );
    expect(count).toBe(216);
    // Provider-neutrality: identical non-provider inputs yield one disposition
    // regardless of which of the four providers is named.
    for (const dispositions of byNonProvider.values()) {
      expect(dispositions.size).toBe(1);
    }
  });
});

describe('explicit reconciliation dispositions', () => {
  const cases = [
    ['collision when the account is bound to another membership', {
      desiredState: 'linked', consent: 'granted', boundMembershipId: OTHER_MEMBERSHIP,
    }, 'collision', 'provider_account_linked_elsewhere'],
    ['collision outranks a missing consent', {
      desiredState: 'linked', consent: 'unknown', boundMembershipId: OTHER_MEMBERSHIP,
    }, 'collision', 'provider_account_linked_elsewhere'],
    ['blocked when linking without granted consent', {
      desiredState: 'linked', consent: 'withdrawn', boundMembershipId: null,
    }, 'blocked', 'consent_required'],
    ['blocked when re-linking an own account without consent', {
      desiredState: 'linked', consent: 'unknown', boundMembershipId: SAME_MEMBERSHIP,
    }, 'blocked', 'consent_required'],
    ['observation pending when the provider state is unknown', {
      desiredState: 'linked', consent: 'granted', observedState: 'unknown',
    }, 'observation_pending', 'observed_state_unknown'],
    ['aligned when a granted link is already observed linked', {
      desiredState: 'linked', consent: 'granted', observedState: 'linked',
    }, 'aligned', 'desired_matches_observed'],
    ['aligned when an unlink is already observed unlinked', {
      desiredState: 'unlinked', consent: 'unknown', observedState: 'unlinked',
    }, 'aligned', 'desired_matches_observed'],
    ['reconcile_link when a granted link is not yet observed', {
      desiredState: 'linked', consent: 'granted', observedState: 'unlinked',
    }, 'reconcile_link', 'link_requested_not_yet_observed'],
    ['reconcile_unlink when an unlink is still observed linked', {
      desiredState: 'unlinked', consent: 'granted', observedState: 'linked',
    }, 'reconcile_unlink', 'unlink_requested_still_observed'],
    ['unlink ignores a foreign binding and withdrawn consent', {
      desiredState: 'unlinked', consent: 'withdrawn', observedState: 'linked',
      boundMembershipId: OTHER_MEMBERSHIP,
    }, 'reconcile_unlink', 'unlink_requested_still_observed'],
  ];

  test.each(cases)('%s', (_name, overrides, disposition, reason) => {
    const result = classifyProviderLinkReconciliation(evidence(overrides));
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.disposition).toBe(disposition);
    expect(result.reason).toBe(reason);
    expect(result.grantsAuthority).toBe(false);
  });

  test('a provider link never grants authority in any classified case', () => {
    for (const overrides of cases.map((entry) => entry[1])) {
      expect(classifyProviderLinkReconciliation(evidence(overrides)).grantsAuthority).toBe(false);
    }
  });
});

describe('malformed and hostile input is rejected without echo', () => {
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'linked'],
    ['a number', 42],
    ['an array', []],
  ])('throws on %s', (_name, input) => {
    expectRejected(input);
  });

  test('rejects a wrong schema version', () => {
    expectRejected(evidence({ providerLinkSchemaVersion: 2 }));
  });

  test.each([
    ['provider', 'facebook'],
    ['consent', 'maybe'],
    ['desiredState', 'pending'],
    ['observedState', 'stale'],
  ])('rejects an unknown %s value', (field, value) => {
    expectRejected(evidence({ [field]: value }));
  });

  test('rejects non-opaque or PII-shaped identifiers', () => {
    expectRejected(evidence({ membershipId: HOSTILE_CANARY }));
    expectRejected(evidence({ providerAccountRef: 'member@example.test' }));
    expectRejected(evidence({ providerAccountRef: '+12025550170' }));
    expectRejected(evidence({ boundMembershipId: 42 }));
    expectRejected(evidence({ boundMembershipId: HOSTILE_CANARY }));
  });

  test('rejects a missing field', () => {
    const missing = evidence();
    delete missing.boundMembershipId;
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
    delete accessor.providerAccountRef;
    Object.defineProperty(accessor, 'providerAccountRef', {
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
    expect(providerLinkSchemaVersion).toBe(1);
    expect(Object.isFrozen(MEMBERSHIP_PROVIDER_LINK_ENUMS)).toBe(true);
    for (const values of Object.values(MEMBERSHIP_PROVIDER_LINK_ENUMS)) {
      expect(Object.isFrozen(values)).toBe(true);
    }
  });

  test('models the four providers under one neutral vocabulary', () => {
    expect(PROVIDERS).toEqual(['email_password', 'google', 'whatsapp', 'strava']);
    expect(PROVIDERS).not.toContain('facebook');
    expect(PROVIDERS).not.toContain('apple');
  });

  test('publishes the full disposition vocabulary', () => {
    expect([...MEMBERSHIP_PROVIDER_LINK_ENUMS.disposition].sort()).toEqual([
      'aligned',
      'blocked',
      'collision',
      'observation_pending',
      'reconcile_link',
      'reconcile_unlink',
    ]);
  });

  test('the error type is frozen and carries no input', () => {
    const err = new MembershipProviderLinkError();
    expect(Object.isFrozen(err)).toBe(true);
    expect(Object.keys(err)).toEqual([]);
    expect(JSON.stringify(err)).toBe('{}');
  });
});

describe('source boundary', () => {
  const source = fs.readFileSync(path.join(__dirname, 'membershipProviderLink.js'), 'utf8');

  test('is imported by no runtime entrypoint', () => {
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toContain('membershipProviderLink');
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
