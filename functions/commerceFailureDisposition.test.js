const fs = require('node:fs');
const path = require('node:path');

const {
  failureDispositionSchemaVersion,
  FAILURE_DISPOSITION_ENUMS,
  CommerceFailureDispositionError,
  classifyAttemptFailure,
} = require('./commerceFailureDisposition');

// A value that must never be echoed back by a rejection: it stands in for a
// runner identifier / token that could ride in on a malformed field.
const HOSTILE_CANARY = 'private-runner@example.test/+12025550123?token=do-not-copy';

const RESULT_KEYS = ['failureDispositionSchemaVersion', 'disposition', 'retryable'];

const SIGNALS = FAILURE_DISPOSITION_ENUMS.failureSignal;
const IDEMPOTENCY = FAILURE_DISPOSITION_ENUMS.sideEffectIdempotency;
const BUDGETS = FAILURE_DISPOSITION_ENUMS.retryBudget;
const DISPOSITIONS = FAILURE_DISPOSITION_ENUMS.disposition;

// Independent oracle — deliberately written differently from the module (array
// membership + explicit branches) so agreement is a real cross-check.
const TRANSIENT = [
  'timeout',
  'connection_lost',
  'rate_limited',
  'server_failure',
  'external_dependency_failure',
];

function expectedDisposition(e) {
  if (e.failureSignal === 'duplicate_replay') return 'ignore_duplicate';
  if (!TRANSIENT.includes(e.failureSignal)) return 'quarantine_permanent';
  if (e.sideEffectIdempotency === 'non_idempotent') return 'quarantine_permanent';
  return e.retryBudget === 'available' ? 'retry_transient' : 'dead_letter';
}

function expectedRetryable(e) {
  return expectedDisposition(e) === 'retry_transient';
}

function evidence(overrides = {}) {
  return {
    failureDispositionSchemaVersion: 1,
    failureSignal: 'timeout',
    sideEffectIdempotency: 'idempotent',
    retryBudget: 'available',
    ...overrides,
  };
}

function classifyError(input) {
  try {
    classifyAttemptFailure(input);
  } catch (err) {
    return err;
  }
  throw new Error('expected classifyAttemptFailure to throw');
}

function expectRejected(input) {
  const err = classifyError(input);
  expect(err).toBeInstanceOf(CommerceFailureDispositionError);
  expect(err.code).toBe('invalid_failure_disposition_evidence');
  expect(err.message).toBe('Commerce failure disposition evidence is invalid.');
  // The rejection must never echo the input back in any serialization.
  expect(JSON.stringify(err) || '').not.toContain(HOSTILE_CANARY);
  expect(String(err)).not.toContain(HOSTILE_CANARY);
  expect(err.stack || '').not.toContain(HOSTILE_CANARY);
}

describe('attempt-failure disposition matrix', () => {
  const combos = [];
  for (const failureSignal of SIGNALS) {
    for (const sideEffectIdempotency of IDEMPOTENCY) {
      for (const retryBudget of BUDGETS) {
        combos.push(evidence({ failureSignal, sideEffectIdempotency, retryBudget }));
      }
    }
  }

  test('covers every signal x idempotency x budget combination exactly once', () => {
    expect(combos).toHaveLength(SIGNALS.length * IDEMPOTENCY.length * BUDGETS.length);
    expect(combos).toHaveLength(40);
    const seen = new Set(combos.map((e) =>
      `${e.failureSignal}|${e.sideEffectIdempotency}|${e.retryBudget}`));
    expect(seen.size).toBe(combos.length);
  });

  test('each verdict is a frozen, exactly-shaped disposition that matches the oracle', () => {
    for (const e of combos) {
      const result = classifyAttemptFailure(e);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.keys(result)).toEqual(RESULT_KEYS);
      expect(result.failureDispositionSchemaVersion).toBe(1);
      expect(DISPOSITIONS).toContain(result.disposition);
      expect(typeof result.retryable).toBe('boolean');
      expect(result.disposition).toBe(expectedDisposition(e));
      expect(result.retryable).toBe(expectedRetryable(e));
    }
  });

  test('all four dispositions are reachable across the matrix', () => {
    const produced = new Set(combos.map((e) => classifyAttemptFailure(e).disposition));
    expect([...produced].sort()).toEqual([...DISPOSITIONS].sort());
  });

  test('retryable is true only for retry_transient (idempotent + transient + budget)', () => {
    for (const e of combos) {
      const result = classifyAttemptFailure(e);
      if (result.retryable) {
        expect(result.disposition).toBe('retry_transient');
        expect(e.sideEffectIdempotency).toBe('idempotent');
        expect(TRANSIENT).toContain(e.failureSignal);
        expect(e.retryBudget).toBe('available');
      }
    }
  });

  test('the same evidence always yields the identical frozen result object', () => {
    const a = classifyAttemptFailure(evidence({ failureSignal: 'server_failure' }));
    const b = classifyAttemptFailure(evidence({ failureSignal: 'server_failure' }));
    expect(a).toBe(b);
  });
});

describe('retry-safety and fail-closed invariants', () => {
  test('a non-idempotent side effect is NEVER retryable, for every signal and budget', () => {
    for (const failureSignal of SIGNALS) {
      for (const retryBudget of BUDGETS) {
        const result = classifyAttemptFailure(
          evidence({ failureSignal, sideEffectIdempotency: 'non_idempotent', retryBudget }),
        );
        expect(result.retryable).toBe(false);
        expect(result.disposition).not.toBe('retry_transient');
      }
    }
  });

  test('a transient failure on a non-idempotent effect quarantines instead of retrying', () => {
    for (const failureSignal of TRANSIENT) {
      for (const retryBudget of BUDGETS) {
        const result = classifyAttemptFailure(
          evidence({ failureSignal, sideEffectIdempotency: 'non_idempotent', retryBudget }),
        );
        expect(result.disposition).toBe('quarantine_permanent');
      }
    }
  });

  test.each(['permanent_client_error', 'malformed_response', 'conflict', 'unknown'])(
    '%s never retries and quarantines regardless of idempotency/budget',
    (failureSignal) => {
      for (const sideEffectIdempotency of IDEMPOTENCY) {
        for (const retryBudget of BUDGETS) {
          const result = classifyAttemptFailure(
            evidence({ failureSignal, sideEffectIdempotency, retryBudget }),
          );
          expect(result.disposition).toBe('quarantine_permanent');
          expect(result.retryable).toBe(false);
        }
      }
    },
  );

  test('duplicate_replay is ignored (already applied) regardless of idempotency/budget', () => {
    for (const sideEffectIdempotency of IDEMPOTENCY) {
      for (const retryBudget of BUDGETS) {
        const result = classifyAttemptFailure(
          evidence({ failureSignal: 'duplicate_replay', sideEffectIdempotency, retryBudget }),
        );
        expect(result.disposition).toBe('ignore_duplicate');
        expect(result.retryable).toBe(false);
      }
    }
  });

  test.each(TRANSIENT)(
    'idempotent %s retries while budget remains and dead-letters when exhausted',
    (failureSignal) => {
      const withBudget = classifyAttemptFailure(
        evidence({ failureSignal, sideEffectIdempotency: 'idempotent', retryBudget: 'available' }),
      );
      expect(withBudget.disposition).toBe('retry_transient');
      expect(withBudget.retryable).toBe(true);

      const exhausted = classifyAttemptFailure(
        evidence({ failureSignal, sideEffectIdempotency: 'idempotent', retryBudget: 'exhausted' }),
      );
      expect(exhausted.disposition).toBe('dead_letter');
      expect(exhausted.retryable).toBe(false);
    },
  );

  test('the classifier itself performs no side effect (verdict is advisory only)', () => {
    // A retryable verdict is still just a recommendation: nothing is retried,
    // sent, or persisted. We assert the result is a plain frozen data object.
    const result = classifyAttemptFailure(evidence());
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(typeof result).toBe('object');
    expect(Object.values(result).every((v) =>
      typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')).toBe(true);
  });
});

describe('malformed and hostile input is rejected without echo', () => {
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['string', HOSTILE_CANARY],
    ['number', 7],
    ['boolean', true],
    ['array', [HOSTILE_CANARY]],
  ])('rejects a non-object (%s)', (_label, value) => {
    expectRejected(value);
  });

  test('rejects the wrong schema version', () => {
    expectRejected(evidence({ failureDispositionSchemaVersion: 2 }));
    expectRejected(evidence({ failureDispositionSchemaVersion: '1' }));
    expectRejected(evidence({ failureDispositionSchemaVersion: 0 }));
  });

  test.each([
    ['failureSignal', 'not_a_signal'],
    ['sideEffectIdempotency', 'maybe'],
    ['retryBudget', 'infinite'],
  ])('rejects an unknown %s enum value', (field, value) => {
    expectRejected(evidence({ [field]: value }));
  });

  test('rejects an output-only disposition value smuggled into an input field', () => {
    expectRejected(evidence({ failureSignal: 'retry_transient' }));
    expectRejected(evidence({ failureSignal: 'quarantine_permanent' }));
  });

  test('rejects a boolean where an enum is required', () => {
    expectRejected(evidence({ failureSignal: false }));
    expectRejected(evidence({ retryBudget: 0 }));
  });

  test('rejects a missing required field', () => {
    const e = evidence();
    delete e.retryBudget;
    expectRejected(e);
  });

  test('rejects an extra field even when the known fields are valid', () => {
    expectRejected(evidence({ note: HOSTILE_CANARY }));
  });

  test('rejects a Proxy without tripping its traps', () => {
    const target = evidence();
    const proxy = new Proxy(target, {
      get() { throw new Error('proxy get trap must not run'); },
    });
    expectRejected(proxy);
  });

  test('rejects an accessor field without invoking the getter', () => {
    let invoked = false;
    const hostile = {
      failureDispositionSchemaVersion: 1,
      failureSignal: 'timeout',
      sideEffectIdempotency: 'idempotent',
    };
    Object.defineProperty(hostile, 'retryBudget', {
      enumerable: true,
      configurable: true,
      get() { invoked = true; return HOSTILE_CANARY; },
    });
    expectRejected(hostile);
    expect(invoked).toBe(false);
  });

  test('rejects inherited (non-own) fields', () => {
    const base = evidence();
    const derived = Object.create(base);
    expectRejected(derived);
  });

  test('rejects an object whose prototype is not Object.prototype', () => {
    const nullProto = Object.assign(Object.create(null), evidence());
    expectRejected(nullProto);
  });
});

describe('frozen versioned surface', () => {
  test('publishes revision 1 and deeply frozen enums', () => {
    expect(failureDispositionSchemaVersion).toBe(1);
    expect(Object.isFrozen(FAILURE_DISPOSITION_ENUMS)).toBe(true);
    for (const values of Object.values(FAILURE_DISPOSITION_ENUMS)) {
      expect(Object.isFrozen(values)).toBe(true);
    }
  });

  test('publishes the closed input and output vocabularies', () => {
    expect(FAILURE_DISPOSITION_ENUMS.failureSignal).toEqual([
      'timeout',
      'connection_lost',
      'rate_limited',
      'server_failure',
      'external_dependency_failure',
      'permanent_client_error',
      'malformed_response',
      'conflict',
      'unknown',
      'duplicate_replay',
    ]);
    expect(FAILURE_DISPOSITION_ENUMS.sideEffectIdempotency).toEqual(['idempotent', 'non_idempotent']);
    expect(FAILURE_DISPOSITION_ENUMS.retryBudget).toEqual(['available', 'exhausted']);
    expect([...FAILURE_DISPOSITION_ENUMS.disposition].sort()).toEqual([
      'dead_letter',
      'ignore_duplicate',
      'quarantine_permanent',
      'retry_transient',
    ]);
  });

  test('the error is frozen, carries no own enumerable state, and serializes empty', () => {
    const err = new CommerceFailureDispositionError();
    expect(Object.isFrozen(err)).toBe(true);
    expect(Object.keys(err)).toEqual([]);
    expect(JSON.stringify(err)).toBe('{}');
    expect(err.name).toBe('CommerceFailureDispositionError');
    expect(err.code).toBe('invalid_failure_disposition_evidence');
  });
});

describe('source boundary — pure, unused, provider-agnostic', () => {
  const modulePath = path.join(__dirname, 'commerceFailureDisposition.js');
  const source = fs.readFileSync(modulePath, 'utf8');

  test('is not imported by the functions runtime entry point', () => {
    const indexPath = path.join(__dirname, 'index.js');
    const index = fs.readFileSync(indexPath, 'utf8');
    expect(index).not.toContain('commerceFailureDisposition');
  });

  test('requires only node:util', () => {
    const requires = [...source.matchAll(/require\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(requires).toEqual(["'node:util'"]);
  });

  test('reads no clock, randomness, environment, network, or provider surface', () => {
    for (const forbidden of [
      /process\.env/,
      /Date\.now/,
      /new Date/,
      /Math\.random/,
      /console\./,
      /fetch\(/,
      /https?:/,
      /firebase/i,
      /firestore/i,
      /stripe/i,
    ]) {
      expect(source).not.toMatch(forbidden);
    }
  });

  test('carries no PII, credential, or provider-identifier field vocabulary', () => {
    for (const forbidden of [
      /phone/i,
      /address/i,
      /\bdob\b/i,
      /\bssn\b/i,
      /secret/i,
      /\btoken\b/i,
      /password/i,
      /bearer/i,
      /api[_-]?key/i,
    ]) {
      expect(source).not.toMatch(forbidden);
    }
  });

  test('hard-codes the retry-safety invariant in the frozen results', () => {
    expect(source).toContain('retryable');
    expect(source).toContain("frozenDisposition('retry_transient', true)");
    expect(source).toContain("frozenDisposition('dead_letter', false)");
    expect(source).toContain("frozenDisposition('quarantine_permanent', false)");
    expect(source).toContain("frozenDisposition('ignore_duplicate', false)");
  });
});
