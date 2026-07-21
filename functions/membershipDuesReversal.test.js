'use strict';

const fs = require('fs');
const path = require('path');

const mod = require('./membershipDuesReversal');
const {
  membershipDuesReversalSchemaVersion,
  ReversalType,
  DuesDecision,
  AcceptReason,
  RejectReason,
  DenialReason,
  classifyVerifiedDuesReversal,
} = mod;

// The shipped authority reducer, imported so the integration battery feeds it the
// emitted command and proves the command is byte-exact (not merely shaped like one),
// AND that the term actually goes active -> inactive.
const {
  membershipAuthoritySchemaVersion,
  createMembershipAuthority,
  applyMembershipAuthorityCommand,
  deriveMembershipEntitlement,
} = require('./membershipAuthority');

// ---- fixtures ------------------------------------------------------------

// Proven-valid term window from the shipped authority reducer's own tests.
const TERM_START_MS = 1_000_000;
const TERM_END_MS = 2_000_000;
const OBSERVED_AT_MS = 1_500_000;
const HOSTILE_CANARY = 'private-member@example.test/+12025550208?do-not-copy';

// The expectation describes the CURRENTLY-APPROVED term to protect: term at revision 1
// on a record at revision 3 (created -> associated -> approved). The suspend command it
// emits therefore targets expectedRevision 3 / termRevision 2 — matched by the
// integration harness below.
function expectation(overrides = {}) {
  return {
    membershipDuesReversalSchemaVersion: 1,
    commandId: 'cmd_dues_suspend_001',
    membershipId: 'mbr_test_001',
    termId: 'term_test_2026',
    termRevision: 2,
    expectedRevision: 3,
    planRef: 'plan_test_001',
    policyVersion: 'policy_test_001',
    checkoutRef: 'cs_test_dues_001',
    providerAccountRef: 'acct_mprc_001',
    paymentRef: 'pi_test_activating_001',
    livemode: true,
    activatingAmountMinor: 5000,
    currency: 'usd',
    startsAtMs: TERM_START_MS,
    endsAtMs: TERM_END_MS,
    ...overrides,
  };
}

function outcome(overrides = {}) {
  return {
    membershipDuesReversalSchemaVersion: 1,
    reversalType: 'refund',
    checkoutRef: 'cs_test_dues_001',
    providerAccountRef: 'acct_mprc_001',
    paymentRef: 'pi_test_activating_001', // the SAME payment the term was activated by
    reversalRef: 'rf_test_reversal_001',
    livemode: true,
    reversedAmountMinor: 5000,
    currency: 'usd',
    observedAtMs: OBSERVED_AT_MS,
    ...overrides,
  };
}

const EXPECTATION_FIELDS = Object.keys(expectation());
const OUTCOME_FIELDS = Object.keys(outcome());

const REDUCER_COMMAND_FIELDS = [
  'membershipAuthoritySchemaVersion',
  'commandType',
  'commandId',
  'expectedRevision',
  'termRevision',
  'termState',
  'termId',
  'startsAtMs',
  'endsAtMs',
  'planRef',
  'evidenceRef',
  'policyVersion',
];

const AUDIT_RECORD_FIELDS = [
  'membershipDuesReversalSchemaVersion',
  'provenance',
  'membershipId',
  'commandId',
  'reversalType',
  'checkoutRef',
  'providerAccountRef',
  'livemode',
  'paymentRef',
  'reversalRef',
  'reversedAmountMinor',
  'currency',
  'observedAtMs',
  'termId',
  'termState',
  'startsAtMs',
  'endsAtMs',
  'planRef',
  'policyVersion',
];

const codeOnly = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');

const rawSource = fs.readFileSync(path.join(__dirname, 'membershipDuesReversal.js'), 'utf8');
const sourceCode = codeOnly(rawSource);

function expectDeepFrozen(value) {
  expect(Object.isFrozen(value)).toBe(true);
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) expectDeepFrozen(child);
  }
}

function expectDenied(result, reason) {
  expect(result).toEqual({ decision: 'denied', reason });
  expect(Object.isFrozen(result)).toBe(true);
  expect(result).not.toHaveProperty('reducerCommand');
  expect(result).not.toHaveProperty('auditRecord');
}

function expectRejected(result, reason) {
  expect(result).toEqual({ decision: 'rejected', reason });
  expect(Object.isFrozen(result)).toBe(true);
  expect(result).not.toHaveProperty('reducerCommand');
  expect(result).not.toHaveProperty('auditRecord');
}

// ---- 1. frozen surface & enums ------------------------------------------

describe('frozen public surface', () => {
  test('exports one frozen versioned API and enum catalog', () => {
    expect(membershipDuesReversalSchemaVersion).toBe(1);
    expect(Object.isFrozen(mod)).toBe(true);
    for (const e of [ReversalType, DuesDecision, AcceptReason, RejectReason, DenialReason]) {
      expect(Object.isFrozen(e)).toBe(true);
    }
    expect(typeof classifyVerifiedDuesReversal).toBe('function');
  });

  test('the enum catalogs are exactly the closed vocabularies', () => {
    expect(new Set(Object.values(ReversalType))).toEqual(new Set(['refund', 'dispute']));
    expect(new Set(Object.values(DuesDecision)))
      .toEqual(new Set(['accepted', 'rejected', 'denied']));
    // Every well-formed reversal type is an accept reason — both suspend.
    expect(new Set(Object.values(AcceptReason))).toEqual(new Set(['refund', 'dispute']));
    expect(new Set(Object.values(RejectReason))).toEqual(new Set([
      'checkout_mismatch', 'account_mismatch', 'realm_mismatch',
      'payment_mismatch', 'currency_mismatch', 'amount_mismatch',
    ]));
    expect(new Set(Object.values(DenialReason)))
      .toEqual(new Set(['malformed_expectation', 'malformed_outcome']));
  });
});

// ---- 2. happy-path accept (suspend) --------------------------------------

describe('accepts a verified, full, consistent reversal of the activating payment', () => {
  test('emits the exact suspend record_term_decision command and paired audit record', () => {
    const result = classifyVerifiedDuesReversal(expectation(), outcome());
    expect(Object.keys(result)).toEqual(['decision', 'reason', 'reducerCommand', 'auditRecord']);
    expect(result.decision).toBe('accepted');
    expect(result.reason).toBe('refund');

    expect(result.reducerCommand).toEqual({
      membershipAuthoritySchemaVersion: 1,
      commandType: 'record_term_decision',
      commandId: 'cmd_dues_suspend_001',
      expectedRevision: 3,
      termRevision: 2,
      termState: 'suspended',
      termId: 'term_test_2026',
      startsAtMs: TERM_START_MS,
      endsAtMs: TERM_END_MS,
      planRef: 'plan_test_001',
      evidenceRef: 'rf_test_reversal_001', // the reversal event IS the suspension evidence
      policyVersion: 'policy_test_001',
    });

    expect(result.auditRecord).toEqual({
      membershipDuesReversalSchemaVersion: 1,
      provenance: 'verified_payment_reversal',
      membershipId: 'mbr_test_001',
      commandId: 'cmd_dues_suspend_001',
      reversalType: 'refund',
      checkoutRef: 'cs_test_dues_001',
      providerAccountRef: 'acct_mprc_001',
      livemode: true,
      paymentRef: 'pi_test_activating_001',
      reversalRef: 'rf_test_reversal_001',
      reversedAmountMinor: 5000,
      currency: 'usd',
      observedAtMs: OBSERVED_AT_MS,
      termId: 'term_test_2026',
      termState: 'suspended',
      startsAtMs: TERM_START_MS,
      endsAtMs: TERM_END_MS,
      planRef: 'plan_test_001',
      policyVersion: 'policy_test_001',
    });
  });

  test('a verified dispute suspends too, with reason and audit reflecting the type', () => {
    const result = classifyVerifiedDuesReversal(expectation(), outcome({
      reversalType: 'dispute',
      reversalRef: 'dp_test_dispute_001',
    }));
    expect(result.decision).toBe('accepted');
    expect(result.reason).toBe('dispute');
    expect(result.auditRecord.reversalType).toBe('dispute');
    expect(result.reducerCommand.evidenceRef).toBe('dp_test_dispute_001');
    expect(result.reducerCommand.termState).toBe('suspended');
  });

  test('the reducerCommand carries exactly the shipped command fields', () => {
    const { reducerCommand } = classifyVerifiedDuesReversal(expectation(), outcome());
    expect(Object.keys(reducerCommand).sort()).toEqual([...REDUCER_COMMAND_FIELDS].sort());
    expect(reducerCommand.membershipAuthoritySchemaVersion).toBe(membershipAuthoritySchemaVersion);
  });

  test('the auditRecord carries exactly its documented fields', () => {
    const { auditRecord } = classifyVerifiedDuesReversal(expectation(), outcome());
    expect(Object.keys(auditRecord).sort()).toEqual([...AUDIT_RECORD_FIELDS].sort());
  });

  test('the accept verdict is deeply frozen', () => {
    expectDeepFrozen(classifyVerifiedDuesReversal(expectation(), outcome()));
  });

  test('is deterministic and returns a fresh frozen structure each call', () => {
    const a = classifyVerifiedDuesReversal(expectation(), outcome());
    const b = classifyVerifiedDuesReversal(expectation(), outcome());
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // accept builds a fresh command; it is not a shared singleton
  });

  test('a zero activating/reversed amount that matches exactly still suspends (no invented floor)', () => {
    const result = classifyVerifiedDuesReversal(
      expectation({ activatingAmountMinor: 0 }),
      outcome({ reversedAmountMinor: 0 }),
    );
    expect(result.decision).toBe('accepted');
  });

  test('a non-usd currency that matches on both sides suspends (currency is opaque, never branched on)', () => {
    const result = classifyVerifiedDuesReversal(
      expectation({ currency: 'eur' }),
      outcome({ currency: 'eur' }),
    );
    expect(result.decision).toBe('accepted');
    expect(result.auditRecord.currency).toBe('eur');
  });

  test('a test-mode reversal suspends a test-mode expectation (realm just has to match)', () => {
    const result = classifyVerifiedDuesReversal(
      expectation({ livemode: false }),
      outcome({ livemode: false }),
    );
    expect(result.decision).toBe('accepted');
    expect(result.auditRecord.livemode).toBe(false);
  });
});

// ---- 3. decision precedence (test-locked) --------------------------------

describe('decision precedence', () => {
  // Each row makes EVERY later check also fail, and asserts the earlier reason wins —
  // so identity is decided before payment before realm before currency before amount.
  test('checkout_mismatch precedes account/realm/payment/currency/amount', () => {
    const result = classifyVerifiedDuesReversal(
      expectation(),
      outcome({
        checkoutRef: 'cs_other_999',
        providerAccountRef: 'acct_other_999',
        livemode: false,
        paymentRef: 'pi_other_999',
        currency: 'gbp',
        reversedAmountMinor: 999,
      }),
    );
    expectRejected(result, 'checkout_mismatch');
  });

  test('account_mismatch precedes realm/payment/currency/amount', () => {
    const result = classifyVerifiedDuesReversal(
      expectation(),
      outcome({
        providerAccountRef: 'acct_other_999',
        livemode: false,
        paymentRef: 'pi_other_999',
        currency: 'gbp',
        reversedAmountMinor: 999,
      }),
    );
    expectRejected(result, 'account_mismatch');
  });

  test('realm_mismatch precedes payment/currency/amount', () => {
    const result = classifyVerifiedDuesReversal(
      expectation(),
      outcome({
        livemode: false,
        paymentRef: 'pi_other_999',
        currency: 'gbp',
        reversedAmountMinor: 999,
      }),
    );
    expectRejected(result, 'realm_mismatch');
  });

  test('payment_mismatch precedes currency/amount', () => {
    const result = classifyVerifiedDuesReversal(
      expectation(),
      outcome({ paymentRef: 'pi_other_999', currency: 'gbp', reversedAmountMinor: 999 }),
    );
    expectRejected(result, 'payment_mismatch');
  });

  test('currency_mismatch precedes amount', () => {
    const result = classifyVerifiedDuesReversal(
      expectation(),
      outcome({ currency: 'gbp', reversedAmountMinor: 999 }),
    );
    expectRejected(result, 'currency_mismatch');
  });

  test('malformed_expectation precedes malformed_outcome (and every reject)', () => {
    // Both records malformed AND every business field mismatched -> expectation wins.
    const result = classifyVerifiedDuesReversal(null, null);
    expectDenied(result, 'malformed_expectation');
  });

  test('malformed_outcome precedes every reject when the expectation is well-formed', () => {
    const result = classifyVerifiedDuesReversal(expectation(), null);
    expectDenied(result, 'malformed_outcome');
  });
});

// ---- 4. full-reversal-only (server-authoritative amount) -----------------

describe('full-reversal-only amount', () => {
  test('an exact full reversal suspends', () => {
    expect(classifyVerifiedDuesReversal(
      expectation({ activatingAmountMinor: 7350 }),
      outcome({ reversedAmountMinor: 7350 }),
    ).decision).toBe('accepted');
  });

  test('a partial reversal (one minor unit short) rejects amount_mismatch, never silently suspends', () => {
    expectRejected(
      classifyVerifiedDuesReversal(expectation({ activatingAmountMinor: 5000 }), outcome({ reversedAmountMinor: 4999 })),
      'amount_mismatch',
    );
  });

  test('an over-reversal (one minor unit more) rejects amount_mismatch', () => {
    expectRejected(
      classifyVerifiedDuesReversal(expectation({ activatingAmountMinor: 5000 }), outcome({ reversedAmountMinor: 5001 })),
      'amount_mismatch',
    );
  });

  test('a full amount in a mismatched currency rejects currency_mismatch, not accept', () => {
    expectRejected(
      classifyVerifiedDuesReversal(expectation({ currency: 'usd' }), outcome({ currency: 'cad', reversedAmountMinor: 5000 })),
      'currency_mismatch',
    );
  });

  test('the reducer never echoes the activating amount in a rejection', () => {
    const result = classifyVerifiedDuesReversal(expectation({ activatingAmountMinor: 5000 }), outcome({ reversedAmountMinor: 4999 }));
    expect(JSON.stringify(result)).not.toContain('5000');
    expect(JSON.stringify(result)).not.toContain('4999');
  });
});

// ---- 5. typed reversal (both types suspend; unknown is malformed) --------

describe('typed reversal', () => {
  test.each(['refund', 'dispute'])('a well-formed reversal type %p suspends with reason === type', (reversalType) => {
    const result = classifyVerifiedDuesReversal(expectation(), outcome({ reversalType }));
    expect(result.decision).toBe('accepted');
    expect(result.reason).toBe(reversalType);
  });

  test.each([
    'REFUND',
    'Refund',
    'DISPUTE',
    'refunded',
    'disputed',
    'chargeback',
    'reversal',
    'void',
    'cancel',
    '',
    'refund ',
    ' dispute',
  ])('an unrecognized reversal type %p denies malformed_outcome (never treated as a reversal)', (reversalType) => {
    expectDenied(classifyVerifiedDuesReversal(expectation(), outcome({ reversalType })), 'malformed_outcome');
  });

  test('a non-string reversal type denies malformed_outcome', () => {
    expectDenied(classifyVerifiedDuesReversal(expectation(), outcome({ reversalType: 42 })), 'malformed_outcome');
    expectDenied(classifyVerifiedDuesReversal(expectation(), outcome({ reversalType: null })), 'malformed_outcome');
  });
});

// ---- 6. realm isolation --------------------------------------------------

describe('realm isolation', () => {
  test('a live-mode reversal cannot suspend a test-mode expectation', () => {
    expectRejected(
      classifyVerifiedDuesReversal(expectation({ livemode: false }), outcome({ livemode: true })),
      'realm_mismatch',
    );
  });

  test('a test-mode reversal cannot suspend a live-mode expectation', () => {
    expectRejected(
      classifyVerifiedDuesReversal(expectation({ livemode: true }), outcome({ livemode: false })),
      'realm_mismatch',
    );
  });
});

// ---- 7. account / checkout / payment binding -----------------------------

describe('account, checkout and payment binding', () => {
  test('a reversal for a different checkout rejects checkout_mismatch', () => {
    expectRejected(
      classifyVerifiedDuesReversal(expectation(), outcome({ checkoutRef: 'cs_someone_else_002' })),
      'checkout_mismatch',
    );
  });

  test('a reversal from a different provider account rejects account_mismatch', () => {
    expectRejected(
      classifyVerifiedDuesReversal(expectation(), outcome({ providerAccountRef: 'acct_attacker_002' })),
      'account_mismatch',
    );
  });

  test('a reversal of a DIFFERENT payment rejects payment_mismatch (suspends nothing)', () => {
    expectRejected(
      classifyVerifiedDuesReversal(expectation(), outcome({ paymentRef: 'pi_some_other_charge_002' })),
      'payment_mismatch',
    );
  });

  test('a full reversal of the exact activating payment from the correct account suspends', () => {
    expect(classifyVerifiedDuesReversal(expectation(), outcome()).decision).toBe('accepted');
  });
});

// ---- 8. malformed expectation battery ------------------------------------

describe('malformed expectation denies without suspending', () => {
  test.each([
    null,
    undefined,
    true,
    false,
    0,
    1,
    'string',
    Symbol('s'),
    [],
    [expectation()],
    () => expectation(),
    Object.create(null),
    Object.create({ leaked: HOSTILE_CANARY }),
    new Date(0),
  ])('non-plain root expectation case %#', (bad) => {
    expectDenied(classifyVerifiedDuesReversal(bad, outcome()), 'malformed_expectation');
  });

  test('a missing field denies', () => {
    for (const field of EXPECTATION_FIELDS) {
      const e = expectation();
      delete e[field];
      expectDenied(classifyVerifiedDuesReversal(e, outcome()), 'malformed_expectation');
    }
  });

  test('an extra enumerable field denies', () => {
    expectDenied(classifyVerifiedDuesReversal(expectation({ surprise: 1 }), outcome()), 'malformed_expectation');
  });

  test('an extra NON-enumerable own field denies', () => {
    const e = expectation();
    Object.defineProperty(e, 'hidden', { value: 1, enumerable: false });
    expectDenied(classifyVerifiedDuesReversal(e, outcome()), 'malformed_expectation');
  });

  test('a symbol-keyed own field denies', () => {
    const e = expectation();
    e[Symbol('x')] = 1;
    expectDenied(classifyVerifiedDuesReversal(e, outcome()), 'malformed_expectation');
  });

  test.each([
    ['membershipDuesReversalSchemaVersion', 2],
    ['membershipDuesReversalSchemaVersion', '1'],
    ['membershipDuesReversalSchemaVersion', 0],
    ['commandId', ''],
    ['commandId', '.startsWithDot'],
    ['commandId', 'has space'],
    ['commandId', 123],
    ['membershipId', ''],
    ['termId', 'x'.repeat(129)],
    ['termRevision', 0],
    ['termRevision', -1],
    ['termRevision', 1.5],
    ['termRevision', '1'],
    ['expectedRevision', 0],
    ['expectedRevision', Number.MAX_SAFE_INTEGER + 1],
    ['planRef', null],
    ['policyVersion', false],
    ['checkoutRef', {}],
    ['providerAccountRef', []],
    ['paymentRef', ''],
    ['paymentRef', 'has space'],
    ['paymentRef', 123],
    ['livemode', 'true'],
    ['livemode', 1],
    ['livemode', null],
    ['activatingAmountMinor', -1],
    ['activatingAmountMinor', 1.5],
    ['activatingAmountMinor', '5000'],
    ['activatingAmountMinor', Infinity],
    ['activatingAmountMinor', NaN],
    ['currency', 'US'],
    ['currency', 'usdd'],
    ['currency', 'USD'],
    ['currency', 'us1'],
    ['currency', 123],
    ['startsAtMs', -1],
    ['startsAtMs', 1.5],
    ['endsAtMs', '2000000'],
  ])('a malformed expectation field %s=%p denies', (field, badValue) => {
    expectDenied(classifyVerifiedDuesReversal(expectation({ [field]: badValue }), outcome()), 'malformed_expectation');
  });

  test('an ill-ordered term window (start >= end) denies', () => {
    expectDenied(classifyVerifiedDuesReversal(expectation({ startsAtMs: 2_000_000, endsAtMs: 2_000_000 }), outcome()), 'malformed_expectation');
    expectDenied(classifyVerifiedDuesReversal(expectation({ startsAtMs: 3_000_000, endsAtMs: 2_000_000 }), outcome()), 'malformed_expectation');
  });

  test('an accessor field is never invoked and denies', () => {
    const e = expectation();
    delete e.activatingAmountMinor;
    let touched = false;
    Object.defineProperty(e, 'activatingAmountMinor', {
      enumerable: true,
      get() { touched = true; return 5000; },
    });
    expectDenied(classifyVerifiedDuesReversal(e, outcome()), 'malformed_expectation');
    expect(touched).toBe(false);
  });
});

// ---- 9. malformed outcome battery ----------------------------------------

describe('malformed outcome denies without suspending', () => {
  test.each([
    null,
    undefined,
    true,
    0,
    'string',
    Symbol('s'),
    [],
    [outcome()],
    () => outcome(),
    Object.create(null),
    new Date(0),
  ])('non-plain root outcome case %#', (bad) => {
    expectDenied(classifyVerifiedDuesReversal(expectation(), bad), 'malformed_outcome');
  });

  test('a missing field denies', () => {
    for (const field of OUTCOME_FIELDS) {
      const o = outcome();
      delete o[field];
      expectDenied(classifyVerifiedDuesReversal(expectation(), o), 'malformed_outcome');
    }
  });

  test('an extra enumerable field denies', () => {
    expectDenied(classifyVerifiedDuesReversal(expectation(), outcome({ surprise: 1 })), 'malformed_outcome');
  });

  test('an extra NON-enumerable own field denies', () => {
    const o = outcome();
    Object.defineProperty(o, 'hidden', { value: 1, enumerable: false });
    expectDenied(classifyVerifiedDuesReversal(expectation(), o), 'malformed_outcome');
  });

  test.each([
    ['membershipDuesReversalSchemaVersion', 2],
    ['membershipDuesReversalSchemaVersion', '1'],
    ['reversalType', 'REFUND'],
    ['reversalType', 'refunded'],
    ['reversalType', 'chargeback'],
    ['reversalType', ''],
    ['reversalType', 42],
    ['checkoutRef', ''],
    ['checkoutRef', 42],
    ['providerAccountRef', null],
    ['paymentRef', ''],
    ['paymentRef', 'has space'],
    ['paymentRef', 123],
    ['reversalRef', ''],
    ['reversalRef', 'has space'],
    ['reversalRef', 456],
    ['livemode', 'false'],
    ['livemode', 0],
    ['reversedAmountMinor', -1],
    ['reversedAmountMinor', 1.5],
    ['reversedAmountMinor', '5000'],
    ['reversedAmountMinor', Infinity],
    ['reversedAmountMinor', NaN],
    ['currency', 'USD'],
    ['currency', 'usdd'],
    ['currency', 4],
    ['observedAtMs', -1],
    ['observedAtMs', 1.5],
    ['observedAtMs', '1500000'],
    ['observedAtMs', 8_640_000_000_000_001],
  ])('a malformed outcome field %s=%p denies', (field, badValue) => {
    expectDenied(classifyVerifiedDuesReversal(expectation(), outcome({ [field]: badValue })), 'malformed_outcome');
  });

  test('an accessor field is never invoked and denies', () => {
    const o = outcome();
    delete o.reversedAmountMinor;
    let touched = false;
    Object.defineProperty(o, 'reversedAmountMinor', {
      enumerable: true,
      get() { touched = true; return 5000; },
    });
    expectDenied(classifyVerifiedDuesReversal(expectation(), o), 'malformed_outcome');
    expect(touched).toBe(false);
  });
});

// ---- 10. hostile input is total and never throws -------------------------

describe('hostile input is total and never throws', () => {
  test('a revoked proxy as either record denies, never throws', () => {
    const r1 = Proxy.revocable({}, {});
    r1.revoke();
    expect(() => classifyVerifiedDuesReversal(r1.proxy, outcome())).not.toThrow();
    expectDenied(classifyVerifiedDuesReversal(r1.proxy, outcome()), 'malformed_expectation');

    const r2 = Proxy.revocable({}, {});
    r2.revoke();
    expect(() => classifyVerifiedDuesReversal(expectation(), r2.proxy)).not.toThrow();
    expectDenied(classifyVerifiedDuesReversal(expectation(), r2.proxy), 'malformed_outcome');
  });

  test('a live proxy with a throwing get trap denies, never throws, never triggers the trap', () => {
    let trapped = false;
    const handler = {
      get() { trapped = true; throw new Error('trap'); },
      getOwnPropertyDescriptor() { trapped = true; throw new Error('trap'); },
      ownKeys() { trapped = true; throw new Error('trap'); },
    };
    const proxy = new Proxy(expectation(), handler);
    expect(() => classifyVerifiedDuesReversal(proxy, outcome())).not.toThrow();
    expectDenied(classifyVerifiedDuesReversal(proxy, outcome()), 'malformed_expectation');
    expect(trapped).toBe(false); // rejected as a proxy before any trap could fire
  });

  test('an object carrying throwing accessors is denied without invoking them', () => {
    const e = expectation();
    delete e.currency;
    Object.defineProperty(e, 'currency', {
      enumerable: true,
      get() { throw new Error('should never run'); },
    });
    expect(() => classifyVerifiedDuesReversal(e, outcome())).not.toThrow();
    expectDenied(classifyVerifiedDuesReversal(e, outcome()), 'malformed_expectation');
  });

  test('a foreign-prototype object denies', () => {
    class Sneaky {}
    const e = Object.assign(new Sneaky(), expectation());
    expectDenied(classifyVerifiedDuesReversal(e, outcome()), 'malformed_expectation');
  });
});

// ---- 11. immutability -----------------------------------------------------

describe('immutability', () => {
  test('the classifier does not mutate either input', () => {
    const e = expectation();
    const o = outcome({ reversedAmountMinor: 4999 });
    const eBefore = JSON.stringify(e);
    const oBefore = JSON.stringify(o);
    classifyVerifiedDuesReversal(e, o);
    expect(JSON.stringify(e)).toBe(eBefore);
    expect(JSON.stringify(o)).toBe(oBefore);
  });

  test('every verdict shape is deeply frozen', () => {
    expectDeepFrozen(classifyVerifiedDuesReversal(expectation(), outcome())); // accept
    expectDeepFrozen(classifyVerifiedDuesReversal(expectation(), outcome({ reversedAmountMinor: 1 }))); // reject
    expectDeepFrozen(classifyVerifiedDuesReversal(null, outcome())); // deny
  });

  test('rejection and denial verdicts are shared frozen singletons per reason', () => {
    // Two different foreign payments both reduce to the same payment_mismatch singleton.
    const pmA = classifyVerifiedDuesReversal(expectation(), outcome({ paymentRef: 'pi_other_1' }));
    const pmB = classifyVerifiedDuesReversal(expectation(), outcome({ paymentRef: 'pi_other_2' }));
    expect(pmA).toBe(pmB);
    // A different reason is a different object.
    const amount = classifyVerifiedDuesReversal(expectation(), outcome({ reversedAmountMinor: 1 }));
    expect(amount).not.toBe(pmA);
    // Denials are singletons per reason too.
    const deniedA = classifyVerifiedDuesReversal(null, outcome());
    const deniedB = classifyVerifiedDuesReversal(undefined, outcome());
    expect(deniedA).toBe(deniedB);
  });
});

// ---- 12. revokes nothing directly / holds no secret ----------------------

describe('revokes nothing directly and holds no secret', () => {
  const verdicts = () => [
    classifyVerifiedDuesReversal(expectation(), outcome()), // accepted (suspend)
    classifyVerifiedDuesReversal(expectation(), outcome({ reversedAmountMinor: 1 })), // amount_mismatch
    classifyVerifiedDuesReversal(expectation(), outcome({ paymentRef: 'pi_other_9' })), // payment_mismatch
    classifyVerifiedDuesReversal(null, outcome()), // denied
  ];

  test('no verdict carries a live-grant / auth field (the reducer decides, it does not act)', () => {
    const forbidden = /"(entitlement|active|granted|role|roles|authToken|sessionToken|apiKey|bearer|access|discount)"/i;
    for (const v of verdicts()) {
      expect(forbidden.test(JSON.stringify(v))).toBe(false);
    }
  });

  test('no verdict leaks secret / credential material', () => {
    const secretish = /sk_live|sk_test|whsec_|bearer\s|password|client[_-]?secret|access[_-]?token|refresh[_-]?token|api[_-]?key|\btoken\b/i;
    for (const v of verdicts()) {
      expect(secretish.test(JSON.stringify(v))).toBe(false);
    }
  });

  test('only the accept verdict emits a command or audit record', () => {
    const [accepted, reject1, reject2, denied] = verdicts();
    expect(accepted).toHaveProperty('reducerCommand');
    expect(accepted).toHaveProperty('auditRecord');
    for (const v of [reject1, reject2, denied]) {
      expect(v).not.toHaveProperty('reducerCommand');
      expect(v).not.toHaveProperty('auditRecord');
    }
  });
});

// ---- 13. integration with the shipped authority reducer ------------------

describe('the emitted command is accepted by the shipped membership authority reducer', () => {
  // create -> associate -> approve, leaving an APPROVED term at revision 1 on a record
  // at revision 3 (the state the expectation snapshot describes).
  function approvedRecord() {
    const linked = applyMembershipAuthorityCommand(
      createMembershipAuthority({
        membershipAuthoritySchemaVersion: 1,
        membershipId: 'mbr_test_001',
        commandId: 'cmd_create_001',
      }),
      {
        membershipAuthoritySchemaVersion: 1,
        commandType: 'associate_account',
        commandId: 'cmd_link_001',
        expectedRevision: 1,
        uid: 'uid_test_001',
      },
    );
    return applyMembershipAuthorityCommand(linked, {
      membershipAuthoritySchemaVersion: 1,
      commandType: 'record_term_decision',
      commandId: 'cmd_approve_001',
      expectedRevision: 2,
      termRevision: 1,
      termState: 'approved',
      termId: 'term_test_2026',
      startsAtMs: TERM_START_MS,
      endsAtMs: TERM_END_MS,
      planRef: 'plan_test_001',
      evidenceRef: 'pi_test_activating_001', // the activating payment
      policyVersion: 'policy_test_001',
    });
  }

  test('a verified reversal suspends the approved term end-to-end (active -> inactive)', () => {
    const approved = approvedRecord();
    expect(approved.revision).toBe(3);
    expect(approved.term.state).toBe('approved');

    // Entitlement is active BEFORE the reversal.
    const before = deriveMembershipEntitlement({
      membershipAuthoritySchemaVersion: 1,
      record: approved,
      uid: 'uid_test_001',
      asOfMs: TERM_START_MS,
    });
    expect(before).toEqual({
      membershipAuthoritySchemaVersion: 1,
      entitlement: 'current_member',
      state: 'active',
    });

    const { reducerCommand } = classifyVerifiedDuesReversal(expectation(), outcome());
    const suspended = applyMembershipAuthorityCommand(approved, reducerCommand);
    expect(suspended.revision).toBe(4);
    expect(suspended.term).toEqual({
      state: 'suspended',
      termId: 'term_test_2026',
      startsAtMs: TERM_START_MS,
      endsAtMs: TERM_END_MS,
      planRef: 'plan_test_001',
      evidenceRef: 'rf_test_reversal_001', // the reversal reference is the evidence
      policyVersion: 'policy_test_001',
      revision: 2,
    });

    // Entitlement is inactive AFTER the reversal — access is genuinely removed.
    const after = deriveMembershipEntitlement({
      membershipAuthoritySchemaVersion: 1,
      record: suspended,
      uid: 'uid_test_001',
      asOfMs: TERM_START_MS,
    });
    expect(after).toEqual({
      membershipAuthoritySchemaVersion: 1,
      entitlement: 'not_entitled',
      state: 'inactive',
    });
  });

  test('re-applying the same emitted command is an idempotent no-op (downstream ordering guard)', () => {
    const approved = approvedRecord();
    const { reducerCommand } = classifyVerifiedDuesReversal(expectation(), outcome());
    const suspended = applyMembershipAuthorityCommand(approved, reducerCommand);
    // Same command id + shape applied again is read-only, not a second write.
    expect(applyMembershipAuthorityCommand(suspended, reducerCommand)).toBe(suspended);
  });

  test('a stale snapshot (already past the target revision) is rejected by the authority revision guard', () => {
    const approved = approvedRecord();
    const { reducerCommand } = classifyVerifiedDuesReversal(expectation(), outcome());
    const suspended = applyMembershipAuthorityCommand(approved, reducerCommand);
    // A genuinely different later command (new commandId) still carrying the now-stale
    // expectedRevision 3 must fail the authority's revision guard: the record has
    // advanced to revision 4. Out-of-order suppression is the authority's job, faithfully
    // delegated (not re-implemented here).
    const stale = classifyVerifiedDuesReversal(
      expectation({ commandId: 'cmd_a_second_suspend_002' }),
      outcome({ reversalRef: 'rf_a_different_reversal_002' }),
    ).reducerCommand;
    expect(stale.expectedRevision).toBe(3);
    expect(() => applyMembershipAuthorityCommand(suspended, stale)).toThrow();
  });

  test('the locally re-declared authority schema version matches the shipped one', () => {
    const { reducerCommand } = classifyVerifiedDuesReversal(expectation(), outcome());
    expect(reducerCommand.membershipAuthoritySchemaVersion).toBe(membershipAuthoritySchemaVersion);
  });
});

// ---- 14. source boundary (comment-stripped) ------------------------------

describe('source boundary', () => {
  test('no clock / randomness / network / env / persistence / provider access', () => {
    const patterns = [
      /process\.env/,
      /\bDate\b/,
      /Math\.random/,
      /\bfetch\b/,
      /\brequire\(\s*['"](?!node:util)/, // the only require is node:util
      /firebase/i,
      /firestore/i,
      /stripe/i,
      /\bURL\b/,
    ];
    for (const pattern of patterns) {
      expect(pattern.test(sourceCode)).toBe(false);
    }
  });

  test.each([
    ['secret', /secret/i],
    ['token', /\btoken\b/i],
    ['bearer', /bearer/i],
    ['password', /password/i],
    ['api_key', /api[_-]?key/i],
    ['access_token', /access[_-]?token/i],
    ['refresh_token', /refresh[_-]?token/i],
    ['client_secret', /client[_-]?secret/i],
  ])('no %s vocabulary appears in the code', (_label, pattern) => {
    expect(pattern.test(sourceCode)).toBe(false);
  });

  test('no HTML sink vocabulary appears in the code', () => {
    for (const pattern of [/innerHTML/i, /dangerouslySetInnerHTML/i, /document\./, /<script/i]) {
      expect(pattern.test(sourceCode)).toBe(false);
    }
  });

  test('the module requires only node:util', () => {
    const requires = [...rawSource.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    expect(requires).toEqual(['node:util']);
  });

  test('the header names the issue code', () => {
    expect(rawSource).toMatch(/MEMBERS-DUES-001C/);
  });

  test('functions/index.js does not import this module', () => {
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toMatch(/membershipDuesReversal/);
  });
});
