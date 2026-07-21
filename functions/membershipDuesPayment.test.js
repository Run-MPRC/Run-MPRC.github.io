'use strict';

const fs = require('fs');
const path = require('path');

const mod = require('./membershipDuesPayment');
const {
  membershipDuesPaymentSchemaVersion,
  PaymentStatus,
  DuesDecision,
  AcceptReason,
  RejectReason,
  DenialReason,
  classifyVerifiedDuesPayment,
} = mod;

// The shipped authority reducer, imported so the integration battery feeds it the
// emitted command and proves the command is byte-exact (not merely shaped like one).
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

function expectation(overrides = {}) {
  return {
    membershipDuesPaymentSchemaVersion: 1,
    commandId: 'cmd_dues_term_001',
    membershipId: 'mbr_test_001',
    termId: 'term_test_2026',
    termRevision: 1,
    expectedRevision: 2,
    planRef: 'plan_test_001',
    policyVersion: 'policy_test_001',
    checkoutRef: 'cs_test_dues_001',
    providerAccountRef: 'acct_mprc_001',
    livemode: true,
    expectedAmountMinor: 5000,
    currency: 'usd',
    startsAtMs: TERM_START_MS,
    endsAtMs: TERM_END_MS,
    ...overrides,
  };
}

function outcome(overrides = {}) {
  return {
    membershipDuesPaymentSchemaVersion: 1,
    checkoutRef: 'cs_test_dues_001',
    providerAccountRef: 'acct_mprc_001',
    livemode: true,
    paymentRef: 'pi_test_verified_001',
    paymentStatus: 'paid',
    paidAmountMinor: 5000,
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
  'membershipDuesPaymentSchemaVersion',
  'provenance',
  'membershipId',
  'commandId',
  'checkoutRef',
  'providerAccountRef',
  'livemode',
  'paymentRef',
  'paymentStatus',
  'paidAmountMinor',
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

const rawSource = fs.readFileSync(path.join(__dirname, 'membershipDuesPayment.js'), 'utf8');
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
    expect(membershipDuesPaymentSchemaVersion).toBe(1);
    expect(Object.isFrozen(mod)).toBe(true);
    for (const e of [PaymentStatus, DuesDecision, AcceptReason, RejectReason, DenialReason]) {
      expect(Object.isFrozen(e)).toBe(true);
    }
    expect(typeof classifyVerifiedDuesPayment).toBe('function');
  });

  test('the enum catalogs are exactly the closed vocabularies', () => {
    expect(new Set(Object.values(PaymentStatus)))
      .toEqual(new Set(['paid', 'unpaid', 'failed', 'pending', 'canceled']));
    expect(new Set(Object.values(DuesDecision)))
      .toEqual(new Set(['accepted', 'rejected', 'denied']));
    expect(new Set(Object.values(AcceptReason))).toEqual(new Set(['paid']));
    expect(new Set(Object.values(RejectReason))).toEqual(new Set([
      'checkout_mismatch', 'account_mismatch', 'realm_mismatch',
      'not_paid', 'currency_mismatch', 'amount_mismatch',
    ]));
    expect(new Set(Object.values(DenialReason)))
      .toEqual(new Set(['malformed_expectation', 'malformed_outcome']));
  });
});

// ---- 2. happy-path accept ------------------------------------------------

describe('accepts a verified, paid, consistent outcome', () => {
  test('emits the exact record_term_decision command and paired audit record', () => {
    const result = classifyVerifiedDuesPayment(expectation(), outcome());
    expect(Object.keys(result)).toEqual(['decision', 'reason', 'reducerCommand', 'auditRecord']);
    expect(result.decision).toBe('accepted');
    expect(result.reason).toBe('paid');

    expect(result.reducerCommand).toEqual({
      membershipAuthoritySchemaVersion: 1,
      commandType: 'record_term_decision',
      commandId: 'cmd_dues_term_001',
      expectedRevision: 2,
      termRevision: 1,
      termState: 'approved',
      termId: 'term_test_2026',
      startsAtMs: TERM_START_MS,
      endsAtMs: TERM_END_MS,
      planRef: 'plan_test_001',
      evidenceRef: 'pi_test_verified_001', // the verified payment IS the dues evidence
      policyVersion: 'policy_test_001',
    });

    expect(result.auditRecord).toEqual({
      membershipDuesPaymentSchemaVersion: 1,
      provenance: 'verified_online_payment',
      membershipId: 'mbr_test_001',
      commandId: 'cmd_dues_term_001',
      checkoutRef: 'cs_test_dues_001',
      providerAccountRef: 'acct_mprc_001',
      livemode: true,
      paymentRef: 'pi_test_verified_001',
      paymentStatus: 'paid',
      paidAmountMinor: 5000,
      currency: 'usd',
      observedAtMs: OBSERVED_AT_MS,
      termId: 'term_test_2026',
      termState: 'approved',
      startsAtMs: TERM_START_MS,
      endsAtMs: TERM_END_MS,
      planRef: 'plan_test_001',
      policyVersion: 'policy_test_001',
    });
  });

  test('the reducerCommand carries exactly the shipped command fields', () => {
    const { reducerCommand } = classifyVerifiedDuesPayment(expectation(), outcome());
    expect(Object.keys(reducerCommand).sort()).toEqual([...REDUCER_COMMAND_FIELDS].sort());
    expect(reducerCommand.membershipAuthoritySchemaVersion).toBe(membershipAuthoritySchemaVersion);
  });

  test('the auditRecord carries exactly its documented fields', () => {
    const { auditRecord } = classifyVerifiedDuesPayment(expectation(), outcome());
    expect(Object.keys(auditRecord).sort()).toEqual([...AUDIT_RECORD_FIELDS].sort());
  });

  test('the accept verdict is deeply frozen', () => {
    expectDeepFrozen(classifyVerifiedDuesPayment(expectation(), outcome()));
  });

  test('is deterministic and returns a fresh frozen structure each call', () => {
    const a = classifyVerifiedDuesPayment(expectation(), outcome());
    const b = classifyVerifiedDuesPayment(expectation(), outcome());
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // accept builds a fresh command; it is not a shared singleton
  });

  test('a zero expected/paid amount that matches exactly still activates (no invented floor)', () => {
    const result = classifyVerifiedDuesPayment(
      expectation({ expectedAmountMinor: 0 }),
      outcome({ paidAmountMinor: 0 }),
    );
    expect(result.decision).toBe('accepted');
  });

  test('a non-usd currency that matches on both sides activates (currency is opaque, never branched on)', () => {
    const result = classifyVerifiedDuesPayment(
      expectation({ currency: 'eur' }),
      outcome({ currency: 'eur' }),
    );
    expect(result.decision).toBe('accepted');
    expect(result.auditRecord.currency).toBe('eur');
  });

  test('a test-mode payment activates a test-mode expectation (realm just has to match)', () => {
    const result = classifyVerifiedDuesPayment(
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
  // so identity is decided before realm before status before currency before amount.
  test('checkout_mismatch precedes account/realm/status/currency/amount', () => {
    const result = classifyVerifiedDuesPayment(
      expectation(),
      outcome({
        checkoutRef: 'cs_other_999',
        providerAccountRef: 'acct_other_999',
        livemode: false,
        paymentStatus: 'unpaid',
        currency: 'gbp',
        paidAmountMinor: 999,
      }),
    );
    expectRejected(result, 'checkout_mismatch');
  });

  test('account_mismatch precedes realm/status/currency/amount', () => {
    const result = classifyVerifiedDuesPayment(
      expectation(),
      outcome({
        providerAccountRef: 'acct_other_999',
        livemode: false,
        paymentStatus: 'unpaid',
        currency: 'gbp',
        paidAmountMinor: 999,
      }),
    );
    expectRejected(result, 'account_mismatch');
  });

  test('realm_mismatch precedes status/currency/amount', () => {
    const result = classifyVerifiedDuesPayment(
      expectation(),
      outcome({
        livemode: false,
        paymentStatus: 'unpaid',
        currency: 'gbp',
        paidAmountMinor: 999,
      }),
    );
    expectRejected(result, 'realm_mismatch');
  });

  test('not_paid precedes currency/amount', () => {
    const result = classifyVerifiedDuesPayment(
      expectation(),
      outcome({ paymentStatus: 'unpaid', currency: 'gbp', paidAmountMinor: 999 }),
    );
    expectRejected(result, 'not_paid');
  });

  test('currency_mismatch precedes amount', () => {
    const result = classifyVerifiedDuesPayment(
      expectation(),
      outcome({ currency: 'gbp', paidAmountMinor: 999 }),
    );
    expectRejected(result, 'currency_mismatch');
  });

  test('malformed_expectation precedes malformed_outcome (and every reject)', () => {
    // Both records malformed AND every business field mismatched -> expectation wins.
    const result = classifyVerifiedDuesPayment(null, null);
    expectDenied(result, 'malformed_expectation');
  });

  test('malformed_outcome precedes every reject when the expectation is well-formed', () => {
    const result = classifyVerifiedDuesPayment(expectation(), null);
    expectDenied(result, 'malformed_outcome');
  });
});

// ---- 4. server-authoritative price ---------------------------------------

describe('server-authoritative price', () => {
  test('an exact amount match activates', () => {
    expect(classifyVerifiedDuesPayment(
      expectation({ expectedAmountMinor: 7350 }),
      outcome({ paidAmountMinor: 7350 }),
    ).decision).toBe('accepted');
  });

  test('underpayment by one minor unit rejects amount_mismatch', () => {
    expectRejected(
      classifyVerifiedDuesPayment(expectation({ expectedAmountMinor: 5000 }), outcome({ paidAmountMinor: 4999 })),
      'amount_mismatch',
    );
  });

  test('overpayment by one minor unit rejects amount_mismatch', () => {
    expectRejected(
      classifyVerifiedDuesPayment(expectation({ expectedAmountMinor: 5000 }), outcome({ paidAmountMinor: 5001 })),
      'amount_mismatch',
    );
  });

  test('a matching amount in a mismatched currency rejects currency_mismatch, not accept', () => {
    expectRejected(
      classifyVerifiedDuesPayment(expectation({ currency: 'usd' }), outcome({ currency: 'cad', paidAmountMinor: 5000 })),
      'currency_mismatch',
    );
  });

  test('the reducer never echoes the expected amount in a rejection', () => {
    const result = classifyVerifiedDuesPayment(expectation({ expectedAmountMinor: 5000 }), outcome({ paidAmountMinor: 4999 }));
    expect(JSON.stringify(result)).not.toContain('5000');
    expect(JSON.stringify(result)).not.toContain('4999');
  });
});

// ---- 5. paid-only --------------------------------------------------------

describe('paid-only activation', () => {
  test.each([
    'unpaid',
    'failed',
    'pending',
    'canceled',
  ])('a known non-paid status %s rejects not_paid', (paymentStatus) => {
    expectRejected(classifyVerifiedDuesPayment(expectation(), outcome({ paymentStatus })), 'not_paid');
  });

  test.each([
    'PAID',
    'Paid',
    'refunded',
    'disputed',
    'succeeded',
    'complete',
    'authorized',
    '',
    'paid ',
    ' paid',
  ])('an unrecognized status %p denies malformed_outcome (never treated as paid)', (paymentStatus) => {
    expectDenied(classifyVerifiedDuesPayment(expectation(), outcome({ paymentStatus })), 'malformed_outcome');
  });

  test('only the exact string paid activates', () => {
    expect(classifyVerifiedDuesPayment(expectation(), outcome({ paymentStatus: 'paid' })).decision).toBe('accepted');
  });
});

// ---- 6. realm isolation --------------------------------------------------

describe('realm isolation', () => {
  test('a live-mode payment cannot activate a test-mode expectation', () => {
    expectRejected(
      classifyVerifiedDuesPayment(expectation({ livemode: false }), outcome({ livemode: true })),
      'realm_mismatch',
    );
  });

  test('a test-mode payment cannot activate a live-mode expectation', () => {
    expectRejected(
      classifyVerifiedDuesPayment(expectation({ livemode: true }), outcome({ livemode: false })),
      'realm_mismatch',
    );
  });
});

// ---- 7. account / checkout binding ---------------------------------------

describe('account and checkout binding', () => {
  test('an event for a different checkout rejects checkout_mismatch', () => {
    expectRejected(
      classifyVerifiedDuesPayment(expectation(), outcome({ checkoutRef: 'cs_someone_else_002' })),
      'checkout_mismatch',
    );
  });

  test('an event from a different provider account rejects account_mismatch', () => {
    expectRejected(
      classifyVerifiedDuesPayment(expectation(), outcome({ providerAccountRef: 'acct_attacker_002' })),
      'account_mismatch',
    );
  });

  test('a correct checkout from the correct account with everything matching activates', () => {
    expect(classifyVerifiedDuesPayment(expectation(), outcome()).decision).toBe('accepted');
  });
});

// ---- 8. malformed expectation battery ------------------------------------

describe('malformed expectation denies without activating', () => {
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
    expectDenied(classifyVerifiedDuesPayment(bad, outcome()), 'malformed_expectation');
  });

  test('a missing field denies', () => {
    for (const field of EXPECTATION_FIELDS) {
      const e = expectation();
      delete e[field];
      expectDenied(classifyVerifiedDuesPayment(e, outcome()), 'malformed_expectation');
    }
  });

  test('an extra enumerable field denies', () => {
    expectDenied(classifyVerifiedDuesPayment(expectation({ surprise: 1 }), outcome()), 'malformed_expectation');
  });

  test('an extra NON-enumerable own field denies', () => {
    const e = expectation();
    Object.defineProperty(e, 'hidden', { value: 1, enumerable: false });
    expectDenied(classifyVerifiedDuesPayment(e, outcome()), 'malformed_expectation');
  });

  test('a symbol-keyed own field denies', () => {
    const e = expectation();
    e[Symbol('x')] = 1;
    expectDenied(classifyVerifiedDuesPayment(e, outcome()), 'malformed_expectation');
  });

  test.each([
    ['membershipDuesPaymentSchemaVersion', 2],
    ['membershipDuesPaymentSchemaVersion', '1'],
    ['membershipDuesPaymentSchemaVersion', 0],
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
    ['livemode', 'true'],
    ['livemode', 1],
    ['livemode', null],
    ['expectedAmountMinor', -1],
    ['expectedAmountMinor', 1.5],
    ['expectedAmountMinor', '5000'],
    ['expectedAmountMinor', Infinity],
    ['expectedAmountMinor', NaN],
    ['currency', 'US'],
    ['currency', 'usdd'],
    ['currency', 'USD'],
    ['currency', 'us1'],
    ['currency', 123],
    ['startsAtMs', -1],
    ['startsAtMs', 1.5],
    ['endsAtMs', '2000000'],
  ])('a malformed expectation field %s=%p denies', (field, badValue) => {
    expectDenied(classifyVerifiedDuesPayment(expectation({ [field]: badValue }), outcome()), 'malformed_expectation');
  });

  test('an ill-ordered term window (start >= end) denies', () => {
    expectDenied(classifyVerifiedDuesPayment(expectation({ startsAtMs: 2_000_000, endsAtMs: 2_000_000 }), outcome()), 'malformed_expectation');
    expectDenied(classifyVerifiedDuesPayment(expectation({ startsAtMs: 3_000_000, endsAtMs: 2_000_000 }), outcome()), 'malformed_expectation');
  });

  test('an accessor field is never invoked and denies', () => {
    const e = expectation();
    delete e.expectedAmountMinor;
    let touched = false;
    Object.defineProperty(e, 'expectedAmountMinor', {
      enumerable: true,
      get() { touched = true; return 5000; },
    });
    expectDenied(classifyVerifiedDuesPayment(e, outcome()), 'malformed_expectation');
    expect(touched).toBe(false);
  });
});

// ---- 9. malformed outcome battery ----------------------------------------

describe('malformed outcome denies without activating', () => {
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
    expectDenied(classifyVerifiedDuesPayment(expectation(), bad), 'malformed_outcome');
  });

  test('a missing field denies', () => {
    for (const field of OUTCOME_FIELDS) {
      const o = outcome();
      delete o[field];
      expectDenied(classifyVerifiedDuesPayment(expectation(), o), 'malformed_outcome');
    }
  });

  test('an extra enumerable field denies', () => {
    expectDenied(classifyVerifiedDuesPayment(expectation(), outcome({ surprise: 1 })), 'malformed_outcome');
  });

  test('an extra NON-enumerable own field denies', () => {
    const o = outcome();
    Object.defineProperty(o, 'hidden', { value: 1, enumerable: false });
    expectDenied(classifyVerifiedDuesPayment(expectation(), o), 'malformed_outcome');
  });

  test.each([
    ['membershipDuesPaymentSchemaVersion', 2],
    ['membershipDuesPaymentSchemaVersion', '1'],
    ['checkoutRef', ''],
    ['checkoutRef', 42],
    ['providerAccountRef', null],
    ['livemode', 'false'],
    ['livemode', 0],
    ['paymentRef', ''],
    ['paymentRef', 'has space'],
    ['paymentRef', 123],
    ['paymentStatus', 'PAID'],
    ['paymentStatus', 'refunded'],
    ['paymentStatus', ''],
    ['paymentStatus', 42],
    ['paidAmountMinor', -1],
    ['paidAmountMinor', 1.5],
    ['paidAmountMinor', '5000'],
    ['paidAmountMinor', Infinity],
    ['paidAmountMinor', NaN],
    ['currency', 'USD'],
    ['currency', 'usdd'],
    ['currency', 4],
    ['observedAtMs', -1],
    ['observedAtMs', 1.5],
    ['observedAtMs', '1500000'],
    ['observedAtMs', 8_640_000_000_000_001],
  ])('a malformed outcome field %s=%p denies', (field, badValue) => {
    expectDenied(classifyVerifiedDuesPayment(expectation(), outcome({ [field]: badValue })), 'malformed_outcome');
  });

  test('an accessor field is never invoked and denies', () => {
    const o = outcome();
    delete o.paidAmountMinor;
    let touched = false;
    Object.defineProperty(o, 'paidAmountMinor', {
      enumerable: true,
      get() { touched = true; return 5000; },
    });
    expectDenied(classifyVerifiedDuesPayment(expectation(), o), 'malformed_outcome');
    expect(touched).toBe(false);
  });
});

// ---- 10. hostile input is total and never throws -------------------------

describe('hostile input is total and never throws', () => {
  test('a revoked proxy as either record denies, never throws', () => {
    const r1 = Proxy.revocable({}, {});
    r1.revoke();
    expect(() => classifyVerifiedDuesPayment(r1.proxy, outcome())).not.toThrow();
    expectDenied(classifyVerifiedDuesPayment(r1.proxy, outcome()), 'malformed_expectation');

    const r2 = Proxy.revocable({}, {});
    r2.revoke();
    expect(() => classifyVerifiedDuesPayment(expectation(), r2.proxy)).not.toThrow();
    expectDenied(classifyVerifiedDuesPayment(expectation(), r2.proxy), 'malformed_outcome');
  });

  test('a live proxy with a throwing get trap denies, never throws, never triggers the trap', () => {
    let trapped = false;
    const handler = {
      get() { trapped = true; throw new Error('trap'); },
      getOwnPropertyDescriptor() { trapped = true; throw new Error('trap'); },
      ownKeys() { trapped = true; throw new Error('trap'); },
    };
    const proxy = new Proxy(expectation(), handler);
    expect(() => classifyVerifiedDuesPayment(proxy, outcome())).not.toThrow();
    expectDenied(classifyVerifiedDuesPayment(proxy, outcome()), 'malformed_expectation');
    expect(trapped).toBe(false); // rejected as a proxy before any trap could fire
  });

  test('an object carrying throwing accessors is denied without invoking them', () => {
    const e = expectation();
    delete e.currency;
    Object.defineProperty(e, 'currency', {
      enumerable: true,
      get() { throw new Error('should never run'); },
    });
    expect(() => classifyVerifiedDuesPayment(e, outcome())).not.toThrow();
    expectDenied(classifyVerifiedDuesPayment(e, outcome()), 'malformed_expectation');
  });

  test('a foreign-prototype object denies', () => {
    class Sneaky {}
    const e = Object.assign(new Sneaky(), expectation());
    expectDenied(classifyVerifiedDuesPayment(e, outcome()), 'malformed_expectation');
  });
});

// ---- 11. immutability -----------------------------------------------------

describe('immutability', () => {
  test('the classifier does not mutate either input', () => {
    const e = expectation();
    const o = outcome({ paidAmountMinor: 4999 });
    const eBefore = JSON.stringify(e);
    const oBefore = JSON.stringify(o);
    classifyVerifiedDuesPayment(e, o);
    expect(JSON.stringify(e)).toBe(eBefore);
    expect(JSON.stringify(o)).toBe(oBefore);
  });

  test('every verdict shape is deeply frozen', () => {
    expectDeepFrozen(classifyVerifiedDuesPayment(expectation(), outcome())); // accept
    expectDeepFrozen(classifyVerifiedDuesPayment(expectation(), outcome({ paidAmountMinor: 1 }))); // reject
    expectDeepFrozen(classifyVerifiedDuesPayment(null, outcome())); // deny
  });

  test('rejection and denial verdicts are shared frozen singletons per reason', () => {
    // Two different non-paid statuses both reduce to the same not_paid singleton.
    const notPaidA = classifyVerifiedDuesPayment(expectation(), outcome({ paymentStatus: 'unpaid' }));
    const notPaidB = classifyVerifiedDuesPayment(expectation(), outcome({ paymentStatus: 'failed' }));
    expect(notPaidA).toBe(notPaidB);
    // A different reason is a different object.
    const amount = classifyVerifiedDuesPayment(expectation(), outcome({ paidAmountMinor: 1 }));
    expect(amount).not.toBe(notPaidA);
    // Denials are singletons per reason too.
    const deniedA = classifyVerifiedDuesPayment(null, outcome());
    const deniedB = classifyVerifiedDuesPayment(undefined, outcome());
    expect(deniedA).toBe(deniedB);
  });
});

// ---- 12. confers nothing directly / holds no secret ----------------------

describe('confers nothing directly and holds no secret', () => {
  const verdicts = () => [
    classifyVerifiedDuesPayment(expectation(), outcome()), // accepted
    classifyVerifiedDuesPayment(expectation(), outcome({ paidAmountMinor: 1 })), // amount_mismatch
    classifyVerifiedDuesPayment(expectation(), outcome({ paymentStatus: 'unpaid' })), // not_paid
    classifyVerifiedDuesPayment(null, outcome()), // denied
  ];

  test('no verdict carries a live-grant / auth field (the reducer decides, it does not grant)', () => {
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
  function linkedRecord() {
    return applyMembershipAuthorityCommand(
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
  }

  test('a verified payment activates the linked membership term end-to-end', () => {
    const linked = linkedRecord();
    expect(linked.revision).toBe(2);

    const { reducerCommand } = classifyVerifiedDuesPayment(expectation(), outcome());
    const approved = applyMembershipAuthorityCommand(linked, reducerCommand);
    expect(approved.revision).toBe(3);
    expect(approved.term).toEqual({
      state: 'approved',
      termId: 'term_test_2026',
      startsAtMs: TERM_START_MS,
      endsAtMs: TERM_END_MS,
      planRef: 'plan_test_001',
      evidenceRef: 'pi_test_verified_001', // the verified payment reference is the evidence
      policyVersion: 'policy_test_001',
      revision: 1,
    });

    const entitlement = deriveMembershipEntitlement({
      membershipAuthoritySchemaVersion: 1,
      record: approved,
      uid: 'uid_test_001',
      asOfMs: TERM_START_MS,
    });
    expect(entitlement).toEqual({
      membershipAuthoritySchemaVersion: 1,
      entitlement: 'current_member',
      state: 'active',
    });
  });

  test('re-applying the same emitted command is an idempotent no-op (downstream ordering guard)', () => {
    const linked = linkedRecord();
    const { reducerCommand } = classifyVerifiedDuesPayment(expectation(), outcome());
    const approved = applyMembershipAuthorityCommand(linked, reducerCommand);
    // Same command id + shape applied again is read-only, not a second write.
    expect(applyMembershipAuthorityCommand(approved, reducerCommand)).toBe(approved);
  });

  test('the locally re-declared authority schema version matches the shipped one', () => {
    const { reducerCommand } = classifyVerifiedDuesPayment(expectation(), outcome());
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
    expect(rawSource).toMatch(/MEMBERS-DUES-001B/);
  });

  test('functions/index.js does not import this module', () => {
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toMatch(/membershipDuesPayment/);
  });
});
