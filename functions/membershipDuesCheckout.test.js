'use strict';

const fs = require('fs');
const path = require('path');

const mod = require('./membershipDuesCheckout');
const {
  membershipDuesCheckoutSchemaVersion,
  DuesDecision,
  PrepareReason,
  RefuseReason,
  DenialReason,
  deriveDuesCheckoutOrder,
} = mod;

// The shipped activation contract (MEMBERS-DUES-001B, §8.17), imported so the
// integration battery feeds it the DERIVED expectation and proves the producer emits a
// snapshot §8.17 genuinely accepts (not merely one shaped like it), and that the
// producer-set price is the price §8.17 later enforces.
const { classifyVerifiedDuesPayment } = require('./membershipDuesPayment');

// The shipped authority reducer, imported so the round-trip proves producer -> payment
// -> authority -> entitlement end-to-end: a server-priced checkout activates membership
// only via a verified payment matching that price.
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
const RENEWAL_START_MS = 2_000_000;
const RENEWAL_END_MS = 3_000_000;
const HOSTILE_CANARY = 'private-member@example.test/+12025550208?do-not-copy';

// The owner-approved plan snapshot being sold.
function plan(overrides = {}) {
  return {
    membershipDuesCheckoutSchemaVersion: 1,
    planRef: 'plan_test_001',
    policyVersion: 'policy_test_001',
    termId: 'term_test_2026',
    amountMinor: 5000,
    currency: 'usd',
    startsAtMs: TERM_START_MS,
    endsAtMs: TERM_END_MS,
    offerable: true,
    ...overrides,
  };
}

// The authoritative membership standing for a first activation: created + associated
// (record revision 2), no term decision yet (term cursor 0), holding no active term.
function standing(overrides = {}) {
  return {
    membershipDuesCheckoutSchemaVersion: 1,
    membershipId: 'mbr_test_001',
    recordRevision: 2,
    termRevision: 0,
    activeTermId: null,
    ...overrides,
  };
}

// The purchase request. Note: NO amount / currency / term / window — those come only
// from the plan snapshot, so a client cannot influence price or term.
function request(overrides = {}) {
  return {
    membershipDuesCheckoutSchemaVersion: 1,
    membershipId: 'mbr_test_001',
    planRef: 'plan_test_001',
    providerAccountRef: 'acct_mprc_001',
    livemode: true,
    idempotencyKey: 'idem_dues_001',
    ...overrides,
  };
}

const PLAN_FIELDS = Object.keys(plan());
const STANDING_FIELDS = Object.keys(standing());
const REQUEST_FIELDS = Object.keys(request());

const CHECKOUT_FIELDS = [
  'membershipId',
  'termId',
  'planRef',
  'amountMinor',
  'currency',
  'idempotencyKey',
];

// Exactly the shipped §8.17 (MEMBERS-DUES-001B) EXPECTATION_FIELDS — the derived
// expectation is these MINUS `checkoutRef` (the provider assigns it on session
// creation; the wiring stamps it to form the full 15-field §8.17 expectation).
const PAYMENT_EXPECTATION_FIELDS = [
  'membershipDuesPaymentSchemaVersion',
  'commandId',
  'membershipId',
  'termId',
  'termRevision',
  'expectedRevision',
  'planRef',
  'policyVersion',
  'checkoutRef',
  'providerAccountRef',
  'livemode',
  'expectedAmountMinor',
  'currency',
  'startsAtMs',
  'endsAtMs',
];
const DERIVED_EXPECTATION_FIELDS = PAYMENT_EXPECTATION_FIELDS.filter((f) => f !== 'checkoutRef');

const codeOnly = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');

const rawSource = fs.readFileSync(path.join(__dirname, 'membershipDuesCheckout.js'), 'utf8');
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
  expect(result).not.toHaveProperty('checkout');
  expect(result).not.toHaveProperty('expectation');
}

function expectRefused(result, reason) {
  expect(result).toEqual({ decision: 'refused', reason });
  expect(Object.isFrozen(result)).toBe(true);
  expect(result).not.toHaveProperty('checkout');
  expect(result).not.toHaveProperty('expectation');
}

// ---- 1. frozen surface & enums ------------------------------------------

describe('frozen public surface', () => {
  test('exports one frozen versioned API and enum catalog', () => {
    expect(membershipDuesCheckoutSchemaVersion).toBe(1);
    expect(Object.isFrozen(mod)).toBe(true);
    for (const e of [DuesDecision, PrepareReason, RefuseReason, DenialReason]) {
      expect(Object.isFrozen(e)).toBe(true);
    }
    expect(typeof deriveDuesCheckoutOrder).toBe('function');
  });

  test('the enum catalogs are exactly the closed vocabularies', () => {
    expect(new Set(Object.values(DuesDecision)))
      .toEqual(new Set(['prepared', 'refused', 'denied']));
    expect(new Set(Object.values(PrepareReason))).toEqual(new Set(['order_prepared']));
    expect(new Set(Object.values(RefuseReason))).toEqual(new Set([
      'membership_mismatch', 'plan_mismatch', 'already_active', 'plan_not_offerable',
    ]));
    expect(new Set(Object.values(DenialReason)))
      .toEqual(new Set(['malformed_plan', 'malformed_standing', 'malformed_request']));
  });
});

// ---- 2. happy-path prepare -----------------------------------------------

describe('prepares a canonical dues order for a coherent, purchasable request', () => {
  test('emits the exact checkout parameters and derived expectation', () => {
    const result = deriveDuesCheckoutOrder(plan(), standing(), request());
    expect(Object.keys(result)).toEqual(['decision', 'reason', 'checkout', 'expectation']);
    expect(result.decision).toBe('prepared');
    expect(result.reason).toBe('order_prepared');

    expect(result.checkout).toEqual({
      membershipId: 'mbr_test_001',
      termId: 'term_test_2026',
      planRef: 'plan_test_001',
      amountMinor: 5000,
      currency: 'usd',
      idempotencyKey: 'idem_dues_001',
    });

    expect(result.expectation).toEqual({
      membershipDuesPaymentSchemaVersion: 1,
      commandId: 'idem_dues_001',
      membershipId: 'mbr_test_001',
      termId: 'term_test_2026',
      termRevision: 1, // term cursor 0 + 1
      expectedRevision: 2, // the record's current revision
      planRef: 'plan_test_001',
      policyVersion: 'policy_test_001',
      providerAccountRef: 'acct_mprc_001',
      livemode: true,
      expectedAmountMinor: 5000,
      currency: 'usd',
      startsAtMs: TERM_START_MS,
      endsAtMs: TERM_END_MS,
    });
  });

  test('the checkout carries exactly its documented fields', () => {
    const { checkout } = deriveDuesCheckoutOrder(plan(), standing(), request());
    expect(Object.keys(checkout).sort()).toEqual([...CHECKOUT_FIELDS].sort());
  });

  test('the derived expectation is exactly the §8.17 expectation minus checkoutRef', () => {
    const { expectation } = deriveDuesCheckoutOrder(plan(), standing(), request());
    expect(Object.keys(expectation).sort()).toEqual([...DERIVED_EXPECTATION_FIELDS].sort());
    // Stamping the provider-assigned checkoutRef yields exactly the 15 §8.17 fields.
    const stamped = { ...expectation, checkoutRef: 'cs_stripe_001' };
    expect(Object.keys(stamped).sort()).toEqual([...PAYMENT_EXPECTATION_FIELDS].sort());
  });

  test('the prepared verdict is deeply frozen', () => {
    expectDeepFrozen(deriveDuesCheckoutOrder(plan(), standing(), request()));
  });

  test('is deterministic and returns a fresh frozen structure each call', () => {
    const a = deriveDuesCheckoutOrder(plan(), standing(), request());
    const b = deriveDuesCheckoutOrder(plan(), standing(), request());
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // prepare builds a fresh order; it is not a shared singleton
    expect(a.checkout).not.toBe(b.checkout);
    expect(a.expectation).not.toBe(b.expectation);
  });

  test('a renewal into a DIFFERENT term while active on another prepares (advances the cursor)', () => {
    const result = deriveDuesCheckoutOrder(
      plan({ planRef: 'plan_2027', termId: 'term_2027', amountMinor: 5500, startsAtMs: RENEWAL_START_MS, endsAtMs: RENEWAL_END_MS }),
      standing({ recordRevision: 3, termRevision: 1, activeTermId: 'term_test_2026' }),
      request({ planRef: 'plan_2027' }),
    );
    expect(result.decision).toBe('prepared');
    expect(result.expectation.termId).toBe('term_2027');
    expect(result.expectation.termRevision).toBe(2); // cursor 1 + 1
    expect(result.expectation.expectedRevision).toBe(3);
    expect(result.expectation.expectedAmountMinor).toBe(5500);
  });

  test('a zero-amount plan that is offerable still prepares (no invented floor)', () => {
    const result = deriveDuesCheckoutOrder(plan({ amountMinor: 0 }), standing(), request());
    expect(result.decision).toBe('prepared');
    expect(result.checkout.amountMinor).toBe(0);
    expect(result.expectation.expectedAmountMinor).toBe(0);
  });

  test('a non-usd plan prepares (currency is opaque, never branched on)', () => {
    const result = deriveDuesCheckoutOrder(plan({ currency: 'eur' }), standing(), request());
    expect(result.decision).toBe('prepared');
    expect(result.checkout.currency).toBe('eur');
    expect(result.expectation.currency).toBe('eur');
  });

  test('a test-mode request prepares a test-mode expectation (realm flows from the request)', () => {
    const result = deriveDuesCheckoutOrder(plan(), standing(), request({ livemode: false }));
    expect(result.decision).toBe('prepared');
    expect(result.expectation.livemode).toBe(false);
  });
});

// ---- 3. decision precedence (test-locked) --------------------------------

describe('decision precedence', () => {
  // malformed_plan -> malformed_standing -> malformed_request -> membership_mismatch ->
  // plan_mismatch -> already_active -> plan_not_offerable -> prepared.
  test('malformed_plan precedes malformed_standing/request (and every refusal)', () => {
    expectDenied(deriveDuesCheckoutOrder(null, null, null), 'malformed_plan');
  });

  test('malformed_standing precedes malformed_request when the plan is well-formed', () => {
    expectDenied(deriveDuesCheckoutOrder(plan(), null, null), 'malformed_standing');
  });

  test('malformed_request precedes every refusal when plan and standing are well-formed', () => {
    expectDenied(deriveDuesCheckoutOrder(plan(), standing(), null), 'malformed_request');
  });

  test('membership_mismatch precedes plan_mismatch/already_active/plan_not_offerable', () => {
    const result = deriveDuesCheckoutOrder(
      plan({ offerable: false, termId: 'term_x' }),
      standing({ activeTermId: 'term_x' }),
      request({ membershipId: 'other_mbr', planRef: 'other_plan' }),
    );
    expectRefused(result, 'membership_mismatch');
  });

  test('plan_mismatch precedes already_active/plan_not_offerable', () => {
    const result = deriveDuesCheckoutOrder(
      plan({ offerable: false, termId: 'term_x' }),
      standing({ activeTermId: 'term_x' }),
      request({ planRef: 'other_plan' }),
    );
    expectRefused(result, 'plan_mismatch');
  });

  test('already_active precedes plan_not_offerable', () => {
    const result = deriveDuesCheckoutOrder(
      plan({ offerable: false }),
      standing({ activeTermId: 'term_test_2026' }),
      request(),
    );
    expectRefused(result, 'already_active');
  });

  test('plan_not_offerable is the last gate before prepare', () => {
    expectRefused(deriveDuesCheckoutOrder(plan({ offerable: false }), standing(), request()), 'plan_not_offerable');
  });
});

// ---- 4. price integrity (the marquee property) ---------------------------

describe('price integrity: the charged amount and the expected amount are the same plan amount', () => {
  test.each([0, 1, 99, 5000, 999_999, 1_000_000_000_000])(
    'plan amount %p flows identically to both checkout.amountMinor and expectation.expectedAmountMinor',
    (amountMinor) => {
      const result = deriveDuesCheckoutOrder(plan({ amountMinor }), standing(), request());
      expect(result.decision).toBe('prepared');
      expect(result.checkout.amountMinor).toBe(amountMinor);
      expect(result.expectation.expectedAmountMinor).toBe(amountMinor);
      // Structurally identical — they cannot drift.
      expect(result.checkout.amountMinor).toBe(result.expectation.expectedAmountMinor);
    },
  );

  test('the currency flows identically to both the checkout and the expectation', () => {
    for (const currency of ['usd', 'eur', 'gbp', 'cad', 'jpy']) {
      const result = deriveDuesCheckoutOrder(plan({ currency }), standing(), request());
      expect(result.checkout.currency).toBe(currency);
      expect(result.expectation.currency).toBe(currency);
    }
  });

  test('the request cannot carry — cannot even name — an amount (price is never client-supplied)', () => {
    // An extra `amountMinor` on the request is a closed-shape violation: it denies rather
    // than letting a client inject a price.
    expectDenied(deriveDuesCheckoutOrder(plan(), standing(), request({ amountMinor: 1 })), 'malformed_request');
    expectDenied(deriveDuesCheckoutOrder(plan(), standing(), request({ expectedAmountMinor: 1 })), 'malformed_request');
    expectDenied(deriveDuesCheckoutOrder(plan(), standing(), request({ currency: 'eur' })), 'malformed_request');
  });

  test('changing the plan price changes BOTH the charge and the expectation together', () => {
    const a = deriveDuesCheckoutOrder(plan({ amountMinor: 5000 }), standing(), request());
    const b = deriveDuesCheckoutOrder(plan({ amountMinor: 7500 }), standing(), request());
    expect(a.checkout.amountMinor).toBe(5000);
    expect(a.expectation.expectedAmountMinor).toBe(5000);
    expect(b.checkout.amountMinor).toBe(7500);
    expect(b.expectation.expectedAmountMinor).toBe(7500);
  });

  test('every owner-meaningful term value comes from the plan, not the request or standing', () => {
    const result = deriveDuesCheckoutOrder(
      plan({ planRef: 'plan_alt', termId: 'term_alt', policyVersion: 'policy_alt', startsAtMs: 111_111, endsAtMs: 222_222 }),
      standing(),
      request({ planRef: 'plan_alt' }),
    );
    expect(result.expectation.termId).toBe('term_alt');
    expect(result.expectation.planRef).toBe('plan_alt');
    expect(result.expectation.policyVersion).toBe('policy_alt');
    expect(result.expectation.startsAtMs).toBe(111_111);
    expect(result.expectation.endsAtMs).toBe(222_222);
  });
});

// ---- 5. single idempotency key, bound across both dedup layers -----------

describe('single idempotency key binding and determinism', () => {
  test('the caller idempotency token is the checkout key AND the authority commandId', () => {
    const result = deriveDuesCheckoutOrder(plan(), standing(), request({ idempotencyKey: 'idem_shared_777' }));
    expect(result.checkout.idempotencyKey).toBe('idem_shared_777');
    expect(result.expectation.commandId).toBe('idem_shared_777');
    // The two dedup layers key off the identical token — they cannot diverge.
    expect(result.checkout.idempotencyKey).toBe(result.expectation.commandId);
  });

  test('a different idempotency token yields a different checkout key and commandId', () => {
    const a = deriveDuesCheckoutOrder(plan(), standing(), request({ idempotencyKey: 'idem_a' }));
    const b = deriveDuesCheckoutOrder(plan(), standing(), request({ idempotencyKey: 'idem_b' }));
    expect(a.checkout.idempotencyKey).toBe('idem_a');
    expect(b.checkout.idempotencyKey).toBe('idem_b');
    expect(a.expectation.commandId).not.toBe(b.expectation.commandId);
  });

  test('identical inputs yield a byte-identical order (deterministic, no clock/random)', () => {
    const a = deriveDuesCheckoutOrder(plan(), standing(), request());
    const b = deriveDuesCheckoutOrder(plan(), standing(), request());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('the producer faithfully carries a reused token (cross-use is the downstream reducer\'s fail-closed job)', () => {
    // Two different members with the same token both prepare, each carrying it; the
    // producer does not dedup — the authority reducer\'s commandId exact-retry guard
    // fails closed on inconsistent reuse. The producer\'s job is faithful binding.
    const a = deriveDuesCheckoutOrder(plan(), standing({ membershipId: 'mbr_a' }), request({ membershipId: 'mbr_a', idempotencyKey: 'idem_reused' }));
    const b = deriveDuesCheckoutOrder(plan(), standing({ membershipId: 'mbr_b' }), request({ membershipId: 'mbr_b', idempotencyKey: 'idem_reused' }));
    expect(a.decision).toBe('prepared');
    expect(b.decision).toBe('prepared');
    expect(a.expectation.commandId).toBe('idem_reused');
    expect(b.expectation.commandId).toBe('idem_reused');
  });
});

// ---- 6. no duplicate entitlement -----------------------------------------

describe('no duplicate entitlement', () => {
  test('a request to buy the term the member is already entitled under refuses already_active', () => {
    expectRefused(
      deriveDuesCheckoutOrder(plan({ termId: 'term_held' }), standing({ activeTermId: 'term_held' }), request()),
      'already_active',
    );
  });

  test('a null activeTermId is never treated as already_active', () => {
    expect(deriveDuesCheckoutOrder(plan(), standing({ activeTermId: null }), request()).decision).toBe('prepared');
  });

  test('holding a DIFFERENT active term does not block buying this one', () => {
    expect(
      deriveDuesCheckoutOrder(plan({ termId: 'term_new' }), standing({ activeTermId: 'term_old' }), request()).decision,
    ).toBe('prepared');
  });
});

// ---- 7. membership / plan / offerable binding ----------------------------

describe('membership, plan and offerable binding', () => {
  test('a request for a different member refuses membership_mismatch', () => {
    expectRefused(
      deriveDuesCheckoutOrder(plan(), standing({ membershipId: 'mbr_real' }), request({ membershipId: 'mbr_other' })),
      'membership_mismatch',
    );
  });

  test('a request naming a different plan than the fetched snapshot refuses plan_mismatch', () => {
    expectRefused(
      deriveDuesCheckoutOrder(plan({ planRef: 'plan_real' }), standing(), request({ planRef: 'plan_other' })),
      'plan_mismatch',
    );
  });

  test('a retired plan refuses plan_not_offerable', () => {
    expectRefused(deriveDuesCheckoutOrder(plan({ offerable: false }), standing(), request()), 'plan_not_offerable');
  });

  test('a coherent, needed, offerable request prepares', () => {
    expect(deriveDuesCheckoutOrder(plan(), standing(), request()).decision).toBe('prepared');
  });
});

// ---- 8. malformed plan battery -------------------------------------------

describe('malformed plan denies without preparing', () => {
  test.each([
    null,
    undefined,
    true,
    0,
    'string',
    Symbol('s'),
    [],
    [plan()],
    () => plan(),
    Object.create(null),
    Object.create({ leaked: HOSTILE_CANARY }),
    new Date(0),
  ])('non-plain root plan case %#', (bad) => {
    expectDenied(deriveDuesCheckoutOrder(bad, standing(), request()), 'malformed_plan');
  });

  test('a missing field denies', () => {
    for (const field of PLAN_FIELDS) {
      const p = plan();
      delete p[field];
      expectDenied(deriveDuesCheckoutOrder(p, standing(), request()), 'malformed_plan');
    }
  });

  test('an extra enumerable field denies', () => {
    expectDenied(deriveDuesCheckoutOrder(plan({ surprise: 1 }), standing(), request()), 'malformed_plan');
  });

  test('an extra NON-enumerable own field denies', () => {
    const p = plan();
    Object.defineProperty(p, 'hidden', { value: 1, enumerable: false });
    expectDenied(deriveDuesCheckoutOrder(p, standing(), request()), 'malformed_plan');
  });

  test('a symbol-keyed own field denies', () => {
    const p = plan();
    p[Symbol('x')] = 1;
    expectDenied(deriveDuesCheckoutOrder(p, standing(), request()), 'malformed_plan');
  });

  test.each([
    ['membershipDuesCheckoutSchemaVersion', 2],
    ['membershipDuesCheckoutSchemaVersion', '1'],
    ['membershipDuesCheckoutSchemaVersion', 0],
    ['planRef', ''],
    ['planRef', '.startsWithDot'],
    ['planRef', 'has space'],
    ['planRef', 'x'.repeat(129)],
    ['planRef', 123],
    ['policyVersion', null],
    ['policyVersion', false],
    ['termId', ''],
    ['termId', {}],
    ['amountMinor', -1],
    ['amountMinor', 1.5],
    ['amountMinor', '5000'],
    ['amountMinor', Infinity],
    ['amountMinor', NaN],
    ['amountMinor', 1_000_000_000_001],
    ['currency', 'US'],
    ['currency', 'usdd'],
    ['currency', 'USD'],
    ['currency', 'us1'],
    ['currency', 123],
    ['startsAtMs', -1],
    ['startsAtMs', 1.5],
    ['endsAtMs', '2000000'],
    ['offerable', 'true'],
    ['offerable', 1],
    ['offerable', null],
  ])('a malformed plan field %s=%p denies', (field, badValue) => {
    expectDenied(deriveDuesCheckoutOrder(plan({ [field]: badValue }), standing(), request()), 'malformed_plan');
  });

  test('an ill-ordered term window (start >= end) denies', () => {
    expectDenied(deriveDuesCheckoutOrder(plan({ startsAtMs: 2_000_000, endsAtMs: 2_000_000 }), standing(), request()), 'malformed_plan');
    expectDenied(deriveDuesCheckoutOrder(plan({ startsAtMs: 3_000_000, endsAtMs: 2_000_000 }), standing(), request()), 'malformed_plan');
  });

  test('an accessor field is never invoked and denies', () => {
    const p = plan();
    delete p.amountMinor;
    let touched = false;
    Object.defineProperty(p, 'amountMinor', {
      enumerable: true,
      get() { touched = true; return 5000; },
    });
    expectDenied(deriveDuesCheckoutOrder(p, standing(), request()), 'malformed_plan');
    expect(touched).toBe(false);
  });
});

// ---- 9. malformed standing battery ---------------------------------------

describe('malformed standing denies without preparing', () => {
  test.each([
    null,
    undefined,
    true,
    0,
    'string',
    Symbol('s'),
    [],
    [standing()],
    () => standing(),
    Object.create(null),
    new Date(0),
  ])('non-plain root standing case %#', (bad) => {
    expectDenied(deriveDuesCheckoutOrder(plan(), bad, request()), 'malformed_standing');
  });

  test('a missing field denies', () => {
    for (const field of STANDING_FIELDS) {
      const s = standing();
      delete s[field];
      expectDenied(deriveDuesCheckoutOrder(plan(), s, request()), 'malformed_standing');
    }
  });

  test('an extra enumerable field denies', () => {
    expectDenied(deriveDuesCheckoutOrder(plan(), standing({ surprise: 1 }), request()), 'malformed_standing');
  });

  test('an extra NON-enumerable own field denies', () => {
    const s = standing();
    Object.defineProperty(s, 'hidden', { value: 1, enumerable: false });
    expectDenied(deriveDuesCheckoutOrder(plan(), s, request()), 'malformed_standing');
  });

  test('a null activeTermId is VALID (holds no active term)', () => {
    expect(deriveDuesCheckoutOrder(plan(), standing({ activeTermId: null }), request()).decision).toBe('prepared');
  });

  test.each([
    ['membershipDuesCheckoutSchemaVersion', 2],
    ['membershipDuesCheckoutSchemaVersion', '1'],
    ['membershipId', ''],
    ['membershipId', 'has space'],
    ['membershipId', 123],
    ['recordRevision', 0],
    ['recordRevision', -1],
    ['recordRevision', 1.5],
    ['recordRevision', '2'],
    ['recordRevision', Number.MAX_SAFE_INTEGER],
    ['termRevision', -1],
    ['termRevision', 1.5],
    ['termRevision', '0'],
    ['termRevision', Number.MAX_SAFE_INTEGER],
    ['activeTermId', ''],
    ['activeTermId', 'has space'],
    ['activeTermId', 123],
    ['activeTermId', {}],
    ['activeTermId', undefined],
  ])('a malformed standing field %s=%p denies', (field, badValue) => {
    expectDenied(deriveDuesCheckoutOrder(plan(), standing({ [field]: badValue }), request()), 'malformed_standing');
  });

  test('an accessor field is never invoked and denies', () => {
    const s = standing();
    delete s.recordRevision;
    let touched = false;
    Object.defineProperty(s, 'recordRevision', {
      enumerable: true,
      get() { touched = true; return 2; },
    });
    expectDenied(deriveDuesCheckoutOrder(plan(), s, request()), 'malformed_standing');
    expect(touched).toBe(false);
  });
});

// ---- 10. malformed request battery ---------------------------------------

describe('malformed request denies without preparing', () => {
  test.each([
    null,
    undefined,
    true,
    0,
    'string',
    Symbol('s'),
    [],
    [request()],
    () => request(),
    Object.create(null),
    new Date(0),
  ])('non-plain root request case %#', (bad) => {
    expectDenied(deriveDuesCheckoutOrder(plan(), standing(), bad), 'malformed_request');
  });

  test('a missing field denies', () => {
    for (const field of REQUEST_FIELDS) {
      const r = request();
      delete r[field];
      expectDenied(deriveDuesCheckoutOrder(plan(), standing(), r), 'malformed_request');
    }
  });

  test('an extra enumerable field denies', () => {
    expectDenied(deriveDuesCheckoutOrder(plan(), standing(), request({ surprise: 1 })), 'malformed_request');
  });

  test('an extra NON-enumerable own field denies', () => {
    const r = request();
    Object.defineProperty(r, 'hidden', { value: 1, enumerable: false });
    expectDenied(deriveDuesCheckoutOrder(plan(), standing(), r), 'malformed_request');
  });

  test('a symbol-keyed own field denies', () => {
    const r = request();
    r[Symbol('x')] = 1;
    expectDenied(deriveDuesCheckoutOrder(plan(), standing(), r), 'malformed_request');
  });

  test.each([
    ['membershipDuesCheckoutSchemaVersion', 2],
    ['membershipDuesCheckoutSchemaVersion', '1'],
    ['membershipId', ''],
    ['membershipId', 'has space'],
    ['membershipId', 123],
    ['planRef', ''],
    ['planRef', 'has space'],
    ['planRef', 456],
    ['providerAccountRef', ''],
    ['providerAccountRef', null],
    ['providerAccountRef', 'has space'],
    ['livemode', 'true'],
    ['livemode', 1],
    ['livemode', null],
    ['idempotencyKey', ''],
    ['idempotencyKey', 'has space'],
    ['idempotencyKey', 123],
    ['idempotencyKey', 'x'.repeat(129)],
  ])('a malformed request field %s=%p denies', (field, badValue) => {
    expectDenied(deriveDuesCheckoutOrder(plan(), standing(), request({ [field]: badValue })), 'malformed_request');
  });

  test('an accessor field is never invoked and denies', () => {
    const r = request();
    delete r.idempotencyKey;
    let touched = false;
    Object.defineProperty(r, 'idempotencyKey', {
      enumerable: true,
      get() { touched = true; return 'idem_x'; },
    });
    expectDenied(deriveDuesCheckoutOrder(plan(), standing(), r), 'malformed_request');
    expect(touched).toBe(false);
  });
});

// ---- 11. hostile input is total and never throws -------------------------

describe('hostile input is total and never throws', () => {
  test('a revoked proxy as any input denies, never throws', () => {
    const mk = () => { const r = Proxy.revocable({}, {}); r.revoke(); return r.proxy; };
    expect(() => deriveDuesCheckoutOrder(mk(), standing(), request())).not.toThrow();
    expectDenied(deriveDuesCheckoutOrder(mk(), standing(), request()), 'malformed_plan');
    expect(() => deriveDuesCheckoutOrder(plan(), mk(), request())).not.toThrow();
    expectDenied(deriveDuesCheckoutOrder(plan(), mk(), request()), 'malformed_standing');
    expect(() => deriveDuesCheckoutOrder(plan(), standing(), mk())).not.toThrow();
    expectDenied(deriveDuesCheckoutOrder(plan(), standing(), mk()), 'malformed_request');
  });

  test('a live proxy with throwing traps denies, never throws, never triggers a trap', () => {
    let trapped = false;
    const handler = {
      get() { trapped = true; throw new Error('trap'); },
      getOwnPropertyDescriptor() { trapped = true; throw new Error('trap'); },
      ownKeys() { trapped = true; throw new Error('trap'); },
    };
    const proxy = new Proxy(plan(), handler);
    expect(() => deriveDuesCheckoutOrder(proxy, standing(), request())).not.toThrow();
    expectDenied(deriveDuesCheckoutOrder(proxy, standing(), request()), 'malformed_plan');
    expect(trapped).toBe(false); // rejected as a proxy before any trap could fire
  });

  test('an object carrying throwing accessors is denied without invoking them', () => {
    const p = plan();
    delete p.currency;
    Object.defineProperty(p, 'currency', {
      enumerable: true,
      get() { throw new Error('should never run'); },
    });
    expect(() => deriveDuesCheckoutOrder(p, standing(), request())).not.toThrow();
    expectDenied(deriveDuesCheckoutOrder(p, standing(), request()), 'malformed_plan');
  });

  test('a foreign-prototype object denies', () => {
    class Sneaky {}
    const p = Object.assign(new Sneaky(), plan());
    expectDenied(deriveDuesCheckoutOrder(p, standing(), request()), 'malformed_plan');
  });
});

// ---- 12. immutability -----------------------------------------------------

describe('immutability', () => {
  test('the producer does not mutate any input', () => {
    const p = plan();
    const s = standing();
    const r = request();
    const pBefore = JSON.stringify(p);
    const sBefore = JSON.stringify(s);
    const rBefore = JSON.stringify(r);
    deriveDuesCheckoutOrder(p, s, r);
    expect(JSON.stringify(p)).toBe(pBefore);
    expect(JSON.stringify(s)).toBe(sBefore);
    expect(JSON.stringify(r)).toBe(rBefore);
  });

  test('every verdict shape is deeply frozen', () => {
    expectDeepFrozen(deriveDuesCheckoutOrder(plan(), standing(), request())); // prepared
    expectDeepFrozen(deriveDuesCheckoutOrder(plan({ offerable: false }), standing(), request())); // refused
    expectDeepFrozen(deriveDuesCheckoutOrder(null, standing(), request())); // denied
  });

  test('refusal and denial verdicts are shared frozen singletons per reason', () => {
    const a = deriveDuesCheckoutOrder(plan({ offerable: false }), standing(), request());
    const b = deriveDuesCheckoutOrder(plan({ offerable: false }), standing(), request({ idempotencyKey: 'idem_other' }));
    expect(a).toBe(b); // both reduce to the same plan_not_offerable singleton
    const active = deriveDuesCheckoutOrder(plan({ termId: 'term_held' }), standing({ activeTermId: 'term_held' }), request());
    expect(active).not.toBe(a); // a different reason is a different object
    const deniedA = deriveDuesCheckoutOrder(null, standing(), request());
    const deniedB = deriveDuesCheckoutOrder(undefined, standing(), request());
    expect(deniedA).toBe(deniedB); // denials are singletons per reason too
  });
});

// ---- 13. charges nothing directly / holds no secret ----------------------

describe('charges nothing directly and holds no secret', () => {
  const verdicts = () => [
    deriveDuesCheckoutOrder(plan(), standing(), request()), // prepared
    deriveDuesCheckoutOrder(plan({ offerable: false }), standing(), request()), // refused
    deriveDuesCheckoutOrder(null, standing(), request()), // denied
  ];

  test('no verdict carries a live-grant / auth field (the producer describes, it does not act)', () => {
    const forbidden = /"(entitlement|granted|role|roles|authToken|sessionToken|apiKey|bearer|access|charged|paid)"/i;
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

  test('only the prepared verdict carries a checkout and expectation', () => {
    const [prepared, refused, denied] = verdicts();
    expect(prepared).toHaveProperty('checkout');
    expect(prepared).toHaveProperty('expectation');
    for (const v of [refused, denied]) {
      expect(v).not.toHaveProperty('checkout');
      expect(v).not.toHaveProperty('expectation');
    }
  });
});

// ---- 14. integration: producer -> §8.17 payment -> authority -> entitlement

describe('the derived order round-trips through the shipped payment reducer and authority', () => {
  const OBSERVED_AT_MS = 1_500_000;

  // create -> associate, leaving a decision_pending term at cursor 0 on a record at
  // revision 2 (exactly what standing() describes for a first activation).
  function associatedRecord() {
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

  // ...and one more step: approve term_test_2026 at cursor 1 (record revision 3), the
  // state a renewal starts from.
  function approvedRecord() {
    return applyMembershipAuthorityCommand(associatedRecord(), {
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
      evidenceRef: 'pi_seed_activating_001',
      policyVersion: 'policy_test_001',
    });
  }

  function paymentOutcome(overrides = {}) {
    return {
      membershipDuesPaymentSchemaVersion: 1,
      checkoutRef: 'cs_stripe_001',
      providerAccountRef: 'acct_mprc_001',
      livemode: true,
      paymentRef: 'pi_paid_001',
      paymentStatus: 'paid',
      paidAmountMinor: 5000,
      currency: 'usd',
      observedAtMs: OBSERVED_AT_MS,
      ...overrides,
    };
  }

  test('the derived expectation revisions match the standing cursors', () => {
    const { expectation } = deriveDuesCheckoutOrder(plan(), standing({ recordRevision: 7, termRevision: 4 }), request());
    expect(expectation.expectedRevision).toBe(7);
    expect(expectation.termRevision).toBe(5);
  });

  test('a first activation: server-priced checkout -> verified payment -> active membership', () => {
    // 1. Producer derives the order (browser initiated; server priced).
    const order = deriveDuesCheckoutOrder(plan(), standing(), request());
    expect(order.decision).toBe('prepared');

    // 2. The provider assigns the session id; the wiring stamps it to form the §8.17
    //    expectation. A matching verified payment is then reconciled by the REAL §8.17.
    const paymentExpectation = { ...order.expectation, checkoutRef: 'cs_stripe_001' };
    const paid = classifyVerifiedDuesPayment(paymentExpectation, paymentOutcome());
    expect(paid.decision).toBe('accepted');
    expect(paid.reducerCommand.termState).toBe('approved');
    expect(paid.reducerCommand.commandId).toBe('idem_dues_001');
    expect(paid.reducerCommand.expectedRevision).toBe(2);
    expect(paid.reducerCommand.termRevision).toBe(1);

    // 3. The emitted command activates the real authority record; entitlement is active.
    const associated = associatedRecord();
    expect(associated.revision).toBe(2);
    const activated = applyMembershipAuthorityCommand(associated, paid.reducerCommand);
    expect(activated.revision).toBe(3);
    expect(activated.term.state).toBe('approved');
    expect(activated.term.termId).toBe('term_test_2026');

    const ent = deriveMembershipEntitlement({
      membershipAuthoritySchemaVersion: 1,
      record: activated,
      uid: 'uid_test_001',
      asOfMs: TERM_START_MS,
    });
    expect(ent).toEqual({
      membershipAuthoritySchemaVersion: 1,
      entitlement: 'current_member',
      state: 'active',
    });
  });

  test('the producer-set price is exactly what §8.17 enforces (under- and over-pay reject)', () => {
    const order = deriveDuesCheckoutOrder(plan({ amountMinor: 6000 }), standing(), request());
    const paymentExpectation = { ...order.expectation, checkoutRef: 'cs_stripe_001' };
    // An exact payment activates.
    expect(classifyVerifiedDuesPayment(paymentExpectation, paymentOutcome({ paidAmountMinor: 6000 })).decision).toBe('accepted');
    // One minor unit short or over both reject amount_mismatch — the producer fixed the price.
    expect(classifyVerifiedDuesPayment(paymentExpectation, paymentOutcome({ paidAmountMinor: 5999 })))
      .toEqual({ decision: 'rejected', reason: 'amount_mismatch' });
    expect(classifyVerifiedDuesPayment(paymentExpectation, paymentOutcome({ paidAmountMinor: 6001 })))
      .toEqual({ decision: 'rejected', reason: 'amount_mismatch' });
  });

  test('a renewal: server-priced renewal -> verified payment -> the new term is active', () => {
    const order = deriveDuesCheckoutOrder(
      plan({ planRef: 'plan_2027', termId: 'term_2027', amountMinor: 5500, startsAtMs: RENEWAL_START_MS, endsAtMs: RENEWAL_END_MS }),
      standing({ recordRevision: 3, termRevision: 1, activeTermId: 'term_test_2026' }),
      request({ planRef: 'plan_2027', idempotencyKey: 'idem_renew_002' }),
    );
    expect(order.decision).toBe('prepared');

    const paymentExpectation = { ...order.expectation, checkoutRef: 'cs_stripe_renew_002' };
    const paid = classifyVerifiedDuesPayment(paymentExpectation, paymentOutcome({
      checkoutRef: 'cs_stripe_renew_002',
      paymentRef: 'pi_paid_renew_002',
      paidAmountMinor: 5500,
    }));
    expect(paid.decision).toBe('accepted');
    expect(paid.reducerCommand.expectedRevision).toBe(3);
    expect(paid.reducerCommand.termRevision).toBe(2);

    const renewed = applyMembershipAuthorityCommand(approvedRecord(), paid.reducerCommand);
    expect(renewed.revision).toBe(4);
    expect(renewed.term.termId).toBe('term_2027');
    expect(renewed.term.state).toBe('approved');

    const ent = deriveMembershipEntitlement({
      membershipAuthoritySchemaVersion: 1,
      record: renewed,
      uid: 'uid_test_001',
      asOfMs: RENEWAL_START_MS,
    });
    expect(ent.state).toBe('active');
  });

  test('the locally re-declared payment schema version matches the shipped §8.17 one', () => {
    const { expectation } = deriveDuesCheckoutOrder(plan(), standing(), request());
    // Feeding it to the real reducer (above) proves it; assert the constant too.
    expect(expectation.membershipDuesPaymentSchemaVersion).toBe(1);
    expect(membershipAuthoritySchemaVersion).toBe(1);
  });
});

// ---- 15. source boundary (comment-stripped) ------------------------------

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
    expect(rawSource).toMatch(/MEMBERS-DUES-001D/);
  });

  test('functions/index.js does not import this module', () => {
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toMatch(/membershipDuesCheckout/);
  });
});
