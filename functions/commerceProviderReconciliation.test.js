'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { inspect } = require('node:util');

const {
  reconciliationPolicySchemaVersion,
  RECONCILIATION_POLICY_ENUMS,
  CommerceProviderReconciliationError,
  classifyInitialStripeReconciliation,
} = require('./commerceProviderReconciliation');

const HOSTILE_CANARY = 'private-runner@example.test/token?secret=do-not-copy';

function evidence(overrides = {}) {
  return {
    reconciliationPolicySchemaVersion: 1,
    provider: 'stripe',
    providerAttempt: 1,
    planBinding: 'exact',
    evidenceSource: 'trusted_dispatch_history',
    evidenceCompleteness: 'complete',
    dispatchEvidence: 'execution_never_began',
    responseEvidence: 'none',
    idempotencyEvidence: 'not_relied_upon',
    providerObjectEvidence: 'none',
    paymentEvidence: 'none',
    eventEvidence: 'none',
    searchEvidence: 'none',
    businessTransitionEvidence: 'same_operation_eligible',
    ...overrides,
  };
}

function expiredEvidence(overrides = {}) {
  return evidence({
    evidenceSource: 'verified_provider_and_event',
    dispatchEvidence: 'execution_started',
    responseEvidence: 'accepted',
    providerObjectEvidence: 'exact_expired',
    paymentEvidence: 'unpaid',
    eventEvidence: 'verified_expiry',
    searchEvidence: 'exact_lookup_complete',
    businessTransitionEvidence: 'new_generation_eligible',
    ...overrides,
  });
}

function openEvidence(overrides = {}) {
  return evidence({
    evidenceSource: 'verified_provider_object',
    dispatchEvidence: 'execution_started',
    responseEvidence: 'accepted',
    providerObjectEvidence: 'exact_open',
    paymentEvidence: 'unpaid',
    searchEvidence: 'exact_lookup_complete',
    businessTransitionEvidence: 'ineligible',
    ...overrides,
  });
}

function successfulEvidence(paymentEvidence = 'paid', overrides = {}) {
  return evidence({
    evidenceSource: 'verified_provider_and_event',
    dispatchEvidence: 'execution_started',
    responseEvidence: 'accepted',
    providerObjectEvidence: 'exact_complete',
    paymentEvidence,
    eventEvidence: 'verified_success',
    searchEvidence: 'exact_lookup_complete',
    businessTransitionEvidence: 'already_succeeded',
    ...overrides,
  });
}

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected callback to throw');
}

function expectSafeError(callback, rawValue = HOSTILE_CANARY) {
  const error = captureError(callback);
  expect(error).toBeInstanceOf(CommerceProviderReconciliationError);
  expect(error).toMatchObject({
    name: 'CommerceProviderReconciliationError',
    code: 'invalid_reconciliation_evidence',
    message: 'Commerce provider reconciliation evidence is invalid.',
  });
  expect(Object.isFrozen(error)).toBe(true);
  const rendered = [
    error.message,
    String(error),
    JSON.stringify(error),
    inspect(error),
    error.stack,
  ].join('\n');
  if (rawValue) expect(rendered).not.toContain(rawValue);
  expect(rendered).not.toContain(HOSTILE_CANARY);
  return error;
}

function expectResult(input, classification, state) {
  const result = classifyInitialStripeReconciliation(input);
  expect(result).toEqual({
    reconciliationPolicySchemaVersion: 1,
    classification,
    state,
  });
  expect(Object.isFrozen(result)).toBe(true);
  expect(JSON.stringify(result)).not.toContain(HOSTILE_CANARY);
  return result;
}

describe('closed reconciliation classifications', () => {
  test('exports one frozen versioned API and frozen closed enum catalog', () => {
    const api = require('./commerceProviderReconciliation');
    expect(reconciliationPolicySchemaVersion).toBe(1);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(RECONCILIATION_POLICY_ENUMS)).toBe(true);
    for (const values of Object.values(RECONCILIATION_POLICY_ENUMS)) {
      expect(Object.isFrozen(values)).toBe(true);
    }
    expect(Object.isFrozen(CommerceProviderReconciliationError)).toBe(true);
    expect(Object.isFrozen(CommerceProviderReconciliationError.prototype)).toBe(true);
  });

  test('classifies only complete trusted never-dispatched evidence as a same-operation candidate', () => {
    const input = evidence();
    const before = JSON.stringify(input);
    const first = expectResult(
      input,
      'new_attempt_candidate',
      'requires_persistence_and_authorization',
    );
    const second = classifyInitialStripeReconciliation(evidence());
    expect(second).toBe(first);
    expect(JSON.stringify(input)).toBe(before);
  });

  test('classifies only exact verified expired and unpaid evidence as a new-generation candidate', () => {
    expectResult(
      expiredEvidence(),
      'new_attempt_candidate',
      'requires_persistence_and_authorization',
    );
  });

  test('finds an exact open attempt and never treats it as reusable or advanceable', () => {
    expectResult(openEvidence(), 'existing_attempt_found', 'do_not_advance');
  });

  test.each(['paid', 'no_payment_required'])(
    'finds an exact successful attempt with %s evidence and does not advance',
    (paymentEvidence) => {
      expectResult(
        successfulEvidence(paymentEvidence),
        'existing_attempt_found',
        'do_not_advance',
      );
    },
  );

  test('returns the same frozen reconciliation result for every otherwise valid unsafe matrix row', () => {
    const unsafe = [
      evidence({ dispatchEvidence: 'timeout' }),
      evidence({ dispatchEvidence: 'connection_lost' }),
      evidence({ dispatchEvidence: 'unknown' }),
      evidence({ responseEvidence: 'conflict' }),
      evidence({ responseEvidence: 'external_dependency_failure' }),
      evidence({ responseEvidence: 'rate_limited' }),
      evidence({ responseEvidence: 'server_failure' }),
      evidence({ idempotencyEvidence: 'old_or_pruned' }),
      evidence({ idempotencyEvidence: 'unknown' }),
      evidence({ providerObjectEvidence: 'missing_reference' }),
      evidence({
        evidenceSource: 'verified_provider_object',
        dispatchEvidence: 'unknown',
        responseEvidence: 'unknown',
        providerObjectEvidence: 'not_found',
        searchEvidence: 'exact_lookup_complete',
      }),
      evidence({ searchEvidence: 'empty' }),
      evidence({ searchEvidence: 'partial' }),
      evidence({ evidenceCompleteness: 'partial' }),
      evidence({ evidenceCompleteness: 'conflicting' }),
      evidence({ planBinding: 'missing' }),
      evidence({ planBinding: 'conflicting' }),
      expiredEvidence({ paymentEvidence: 'processing' }),
      expiredEvidence({ providerObjectEvidence: 'exact_unknown' }),
      successfulEvidence('processing'),
      successfulEvidence('unpaid'),
      successfulEvidence('paid', { eventEvidence: 'partial' }),
      openEvidence({ providerObjectEvidence: 'conflicting' }),
      openEvidence({ paymentEvidence: 'unknown' }),
      evidence({ evidenceSource: 'unverified_or_missing' }),
      evidence({ businessTransitionEvidence: 'unknown' }),
      evidence({ businessTransitionEvidence: 'conflicting' }),
    ];

    const results = unsafe.map((input) => expectResult(
      input,
      'reconciliation_required',
      'requires_reconciliation',
    ));
    expect(new Set(results).size).toBe(1);
    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(1);
  });

  test('one changed evidence dimension removes each candidate classification', () => {
    const candidates = [evidence(), expiredEvidence()];
    for (const baseline of candidates) {
      for (const [field, values] of Object.entries(RECONCILIATION_POLICY_ENUMS)) {
        for (const value of values) {
          if (value === baseline[field]) continue;
          expectResult(
            { ...baseline, [field]: value },
            'reconciliation_required',
            'requires_reconciliation',
          );
        }
      }
    }
  });

  test('one changed evidence dimension removes each existing-attempt classification', () => {
    const existing = [
      openEvidence(),
      successfulEvidence('paid'),
      successfulEvidence('no_payment_required'),
    ];
    for (const baseline of existing) {
      for (const [field, values] of Object.entries(RECONCILIATION_POLICY_ENUMS)) {
        for (const value of values) {
          if (value === baseline[field]) continue;
          const alternateSuccessfulPayment = baseline.providerObjectEvidence === 'exact_complete'
            && field === 'paymentEvidence'
            && ['paid', 'no_payment_required'].includes(value);
          if (alternateSuccessfulPayment) {
            expectResult(
              { ...baseline, [field]: value },
              'existing_attempt_found',
              'do_not_advance',
            );
            continue;
          }
          expectResult(
            { ...baseline, [field]: value },
            'reconciliation_required',
            'requires_reconciliation',
          );
        }
      }
    }
  });

  test('a classification is not send, execution, advancement, persistence, or replay authorization', () => {
    for (const input of [evidence(), expiredEvidence(), openEvidence(), successfulEvidence()]) {
      const result = classifyInitialStripeReconciliation(input);
      expect(Object.keys(result)).toEqual([
        'reconciliationPolicySchemaVersion',
        'classification',
        'state',
      ]);
      for (const forbidden of [
        'send_permitted',
        'shouldExecute',
        'shouldAdvance',
        'providerAttempt',
        'attempt2',
        'result',
        'response',
        'providerObject',
      ]) {
        expect(result).not.toHaveProperty(forbidden);
      }
    }
  });
});

describe('hostile and malformed evidence fails with one fixed error', () => {
  test.each([
    undefined,
    null,
    true,
    1,
    'stripe',
    [],
    new Date(0),
    new Number(1),
  ])('rejects a non-plain root case %#', (input) => {
    expectSafeError(() => classifyInitialStripeReconciliation(input));
  });

  test('rejects every missing field and every extra string or symbol field', () => {
    for (const field of Object.keys(evidence())) {
      const input = evidence();
      delete input[field];
      expectSafeError(() => classifyInitialStripeReconciliation(input));
    }

    expectSafeError(() => classifyInitialStripeReconciliation({
      ...evidence(),
      [HOSTILE_CANARY]: 'extra',
    }));
    const symbolInput = evidence();
    symbolInput[Symbol(HOSTILE_CANARY)] = 'extra';
    expectSafeError(() => classifyInitialStripeReconciliation(symbolInput));
    for (const field of ['__proto__', 'constructor', 'prototype']) {
      const input = evidence();
      Object.defineProperty(input, field, {
        value: HOSTILE_CANARY,
        enumerable: true,
        configurable: true,
      });
      expectSafeError(() => classifyInitialStripeReconciliation(input));
    }
  });

  test('rejects inherited, custom, null, and polluted prototypes', () => {
    const inherited = Object.create(evidence());
    expectSafeError(() => classifyInitialStripeReconciliation(inherited));

    const custom = Object.assign(Object.create({ inherited: HOSTILE_CANARY }), evidence());
    expectSafeError(() => classifyInitialStripeReconciliation(custom));

    const nullPrototype = Object.assign(Object.create(null), evidence());
    expectSafeError(() => classifyInitialStripeReconciliation(nullPrototype));

    Object.defineProperty(Object.prototype, 'temporaryReconciliationPollution', {
      value: HOSTILE_CANARY,
      enumerable: true,
      configurable: true,
    });
    try {
      expectSafeError(() => classifyInitialStripeReconciliation(evidence()));
    } finally {
      delete Object.prototype.temporaryReconciliationPollution;
    }
  });

  test('rejects accessors without invoking them', () => {
    let getterCalls = 0;
    const input = evidence();
    Object.defineProperty(input, 'provider', {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error(HOSTILE_CANARY);
      },
    });
    expectSafeError(() => classifyInitialStripeReconciliation(input));
    expect(getterCalls).toBe(0);
  });

  test('rejects proxies before invoking any hostile trap', () => {
    let trapCalls = 0;
    const handler = new Proxy({}, {
      get() {
        return () => {
          trapCalls += 1;
          throw new Error(HOSTILE_CANARY);
        };
      },
    });
    const input = new Proxy(evidence(), handler);
    expectSafeError(() => classifyInitialStripeReconciliation(input));
    expect(trapCalls).toBe(0);
  });

  test('rejects non-enumerable data fields without reading through them', () => {
    const input = evidence();
    Object.defineProperty(input, 'provider', {
      value: 'stripe',
      enumerable: false,
      configurable: true,
    });
    expectSafeError(() => classifyInitialStripeReconciliation(input));
  });

  test.each([
    ['reconciliationPolicySchemaVersion', 2],
    ['reconciliationPolicySchemaVersion', '1'],
    ['provider', 'STRIPE'],
    ['provider', 'str\uD800ipe'],
    ['providerAttempt', 0],
    ['providerAttempt', 2],
    ['providerAttempt', '1'],
    ['planBinding', 'exact '],
    ['evidenceSource', 'future_source'],
    ['evidenceCompleteness', HOSTILE_CANARY],
    ['dispatchEvidence', 'http_500'],
    ['responseEvidence', 500],
    ['idempotencyEvidence', { state: 'active_exact' }],
    ['providerObjectEvidence', 'cs_test_private'],
    ['paymentEvidence', 'PAID'],
    ['eventEvidence', 'evt_private'],
    ['searchEvidence', false],
    ['businessTransitionEvidence', Symbol(HOSTILE_CANARY)],
  ])('rejects an unknown/future/non-enum value for %s', (field, value) => {
    expectSafeError(
      () => classifyInitialStripeReconciliation(evidence({ [field]: value })),
      typeof value === 'string' && value.length >= 5 ? value : HOSTILE_CANARY,
    );
  });

  test('all validation errors are byte-equivalent and never contain supplied input', () => {
    const errors = [
      captureError(() => classifyInitialStripeReconciliation(null)),
      captureError(() => classifyInitialStripeReconciliation(evidence({
        evidenceSource: HOSTILE_CANARY,
      }))),
      captureError(() => classifyInitialStripeReconciliation({
        ...evidence(),
        extra: HOSTILE_CANARY,
      })),
    ];
    const publicShapes = errors.map((error) => JSON.stringify({
      name: error.name,
      code: error.code,
      message: error.message,
      enumerable: JSON.stringify(error),
    }));
    expect(new Set(publicShapes).size).toBe(1);
    expect(publicShapes[0]).not.toContain(HOSTILE_CANARY);
  });
});

describe('immutability, redaction, and zero-side-effect boundary', () => {
  test('callers cannot mutate canonical outputs, enum arrays, or error fields', () => {
    const result = classifyInitialStripeReconciliation(evidence());
    expect(() => { result.classification = HOSTILE_CANARY; }).toThrow(TypeError);
    expect(() => { result.extra = HOSTILE_CANARY; }).toThrow(TypeError);
    expect(() => { RECONCILIATION_POLICY_ENUMS.planBinding.push(HOSTILE_CANARY); })
      .toThrow(TypeError);

    const error = captureError(() => classifyInitialStripeReconciliation(null));
    expect(() => { error.message = HOSTILE_CANARY; }).toThrow(TypeError);
    expect(() => { error.code = HOSTILE_CANARY; }).toThrow(TypeError);
  });

  test('source imports only the proxy detector and contains no forbidden side-effect primitive', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'commerceProviderReconciliation.js'),
      'utf8',
    );
    const requires = [...source.matchAll(/require\((['"])([^'"]+)\1\)/g)]
      .map((match) => match[2]);
    expect(requires).toEqual(['node:util']);
    for (const forbidden of [
      'firebase',
      "require('stripe')",
      'process.env',
      'console.',
      'Math.random',
      'Date.',
      'new Date',
      'fetch(',
      'node:http',
      'node:https',
      'node:net',
      'node:dns',
      'node:fs',
      'child_process',
      'import(',
      'providerAttempts/0000000002',
      'send_permitted',
      'shouldExecute',
      'shouldAdvance',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  test('no runtime or index entry point adopts the inert policy module', () => {
    const files = fs.readdirSync(__dirname)
      .filter((fileName) => fileName.endsWith('.js'))
      .filter((fileName) => fileName !== 'commerceProviderReconciliation.js')
      .filter((fileName) => fileName !== 'commerceProviderReconciliation.test.js');
    for (const fileName of files) {
      const source = fs.readFileSync(path.join(__dirname, fileName), 'utf8');
      expect({ fileName, importsPolicy: source.includes('commerceProviderReconciliation') })
        .toEqual({ fileName, importsPolicy: false });
    }
  });
});
