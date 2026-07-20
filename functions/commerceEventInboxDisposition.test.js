const fs = require('node:fs');
const path = require('node:path');

const {
  eventInboxSchemaVersion,
  EVENT_INBOX_ENUMS,
  CommerceEventInboxError,
  classifyEventInboxDisposition,
} = require('./commerceEventInboxDisposition');

// A value that must never be echoed back by a rejection: it stands in for a
// business reference / opaque id that could ride in on a malformed field.
const HOSTILE_CANARY = 'private-order-ref@example.test/+12025550123?token=do-not-copy';

const RESULT_KEYS = ['eventInboxSchemaVersion', 'disposition', 'appliesEffect'];

const PRIOR = EVENT_INBOX_ENUMS.priorRecord;
const ORDERING = EVENT_INBOX_ENUMS.objectOrdering;
const DISPOSITIONS = EVENT_INBOX_ENUMS.disposition;

// Independent oracle — deliberately written differently from the module (a
// lookup map + array membership rather than an if-ladder) so agreement is a
// real cross-check, not a copy of the implementation.
const APPLIED_OR_IGNORED = ['applied', 'ignored'];
const FRESH_ORDER = ['first_for_object', 'advances'];
const APPLYING_DISPOSITIONS = ['process', 'reprocess_incomplete'];

function expectedDisposition(e) {
  // Exactly-once boundary: an id already settled dominates every ordering claim.
  if (APPLIED_OR_IGNORED.includes(e.priorRecord)) return 'ignore_duplicate';
  if (e.priorRecord === 'quarantined') return 'quarantine';
  // Ordering gate for a not-yet-settled id.
  const orderVerdict = {
    indeterminate: 'quarantine',
    stale: 'ignore_stale',
    equal: 'ignore_duplicate',
  }[e.objectOrdering];
  if (orderVerdict) return orderVerdict;
  // Fresh and in-order: resume a crashed pending attempt, else first-seen apply.
  return e.priorRecord === 'pending' ? 'reprocess_incomplete' : 'process';
}

function expectedAppliesEffect(e) {
  return APPLYING_DISPOSITIONS.includes(expectedDisposition(e));
}

function evidence(overrides = {}) {
  return {
    eventInboxSchemaVersion: 1,
    priorRecord: 'absent',
    objectOrdering: 'advances',
    ...overrides,
  };
}

function classifyError(input) {
  try {
    classifyEventInboxDisposition(input);
  } catch (err) {
    return err;
  }
  throw new Error('expected classifyEventInboxDisposition to throw');
}

function expectRejected(input) {
  const err = classifyError(input);
  expect(err).toBeInstanceOf(CommerceEventInboxError);
  expect(err.code).toBe('invalid_event_inbox_evidence');
  expect(err.message).toBe('Commerce event inbox evidence is invalid.');
  // The rejection must never echo the input back in any serialization.
  expect(JSON.stringify(err) || '').not.toContain(HOSTILE_CANARY);
  expect(String(err)).not.toContain(HOSTILE_CANARY);
  expect(err.stack || '').not.toContain(HOSTILE_CANARY);
}

describe('event-inbox disposition matrix', () => {
  const combos = [];
  for (const priorRecord of PRIOR) {
    for (const objectOrdering of ORDERING) {
      combos.push(evidence({ priorRecord, objectOrdering }));
    }
  }

  test('covers every priorRecord x objectOrdering combination exactly once', () => {
    expect(combos).toHaveLength(PRIOR.length * ORDERING.length);
    expect(combos).toHaveLength(25);
    const seen = new Set(combos.map((e) => `${e.priorRecord}|${e.objectOrdering}`));
    expect(seen.size).toBe(combos.length);
  });

  test('each verdict is a frozen, exactly-shaped disposition that matches the oracle', () => {
    for (const e of combos) {
      const result = classifyEventInboxDisposition(e);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.keys(result)).toEqual(RESULT_KEYS);
      expect(result.eventInboxSchemaVersion).toBe(1);
      expect(DISPOSITIONS).toContain(result.disposition);
      expect(typeof result.appliesEffect).toBe('boolean');
      expect(result.disposition).toBe(expectedDisposition(e));
      expect(result.appliesEffect).toBe(expectedAppliesEffect(e));
    }
  });

  test('all five dispositions are reachable across the matrix', () => {
    const produced = new Set(combos.map((e) => classifyEventInboxDisposition(e).disposition));
    expect([...produced].sort()).toEqual([...DISPOSITIONS].sort());
  });

  test('appliesEffect is true only for process and reprocess_incomplete', () => {
    for (const e of combos) {
      const result = classifyEventInboxDisposition(e);
      if (result.appliesEffect) {
        expect(APPLYING_DISPOSITIONS).toContain(result.disposition);
        expect(FRESH_ORDER).toContain(e.objectOrdering);
        expect(['absent', 'pending']).toContain(e.priorRecord);
      }
    }
  });

  test('the same evidence always yields the identical frozen result object', () => {
    const a = classifyEventInboxDisposition(evidence({ priorRecord: 'absent', objectOrdering: 'advances' }));
    const b = classifyEventInboxDisposition(evidence({ priorRecord: 'absent', objectOrdering: 'advances' }));
    expect(a).toBe(b);
  });

  test('distinct combinations that share a disposition return the identical singleton', () => {
    // (applied, advances) and (ignored, stale) both settle to ignore_duplicate.
    const viaApplied = classifyEventInboxDisposition(evidence({ priorRecord: 'applied', objectOrdering: 'advances' }));
    const viaIgnored = classifyEventInboxDisposition(evidence({ priorRecord: 'ignored', objectOrdering: 'stale' }));
    expect(viaApplied).toBe(viaIgnored);
    expect(viaApplied.disposition).toBe('ignore_duplicate');
  });
});

describe('exactly-once and fail-closed invariants', () => {
  test('an already-applied event id is ignored for EVERY ordering, even a fresh one', () => {
    for (const objectOrdering of ORDERING) {
      const result = classifyEventInboxDisposition(evidence({ priorRecord: 'applied', objectOrdering }));
      expect(result.disposition).toBe('ignore_duplicate');
      expect(result.appliesEffect).toBe(false);
    }
  });

  test('an already-ignored event id stays ignored for EVERY ordering', () => {
    for (const objectOrdering of ORDERING) {
      const result = classifyEventInboxDisposition(evidence({ priorRecord: 'ignored', objectOrdering }));
      expect(result.disposition).toBe('ignore_duplicate');
      expect(result.appliesEffect).toBe(false);
    }
  });

  test('a quarantined event id stays quarantined for EVERY ordering (no auto-release)', () => {
    for (const objectOrdering of ORDERING) {
      const result = classifyEventInboxDisposition(evidence({ priorRecord: 'quarantined', objectOrdering }));
      expect(result.disposition).toBe('quarantine');
      expect(result.appliesEffect).toBe(false);
    }
  });

  test('an unorderable event NEVER applies an effect, for every not-yet-settled prior', () => {
    for (const priorRecord of ['absent', 'pending']) {
      const result = classifyEventInboxDisposition(evidence({ priorRecord, objectOrdering: 'indeterminate' }));
      expect(result.disposition).toBe('quarantine');
      expect(result.appliesEffect).toBe(false);
    }
  });

  test('a stale event NEVER applies an effect (a newer state was already applied)', () => {
    for (const priorRecord of ['absent', 'pending']) {
      const result = classifyEventInboxDisposition(evidence({ priorRecord, objectOrdering: 'stale' }));
      expect(result.disposition).toBe('ignore_stale');
      expect(result.appliesEffect).toBe(false);
    }
  });

  test.each(ORDERING)('indeterminate/stale ordering is never applied — sweep prior at ordering %s', (objectOrdering) => {
    for (const priorRecord of PRIOR) {
      const result = classifyEventInboxDisposition(evidence({ priorRecord, objectOrdering }));
      if (objectOrdering === 'indeterminate' || objectOrdering === 'stale') {
        expect(result.appliesEffect).toBe(false);
      }
    }
  });

  test('an applied effect only ever comes from a fresh, in-order, not-yet-settled event', () => {
    for (const priorRecord of PRIOR) {
      for (const objectOrdering of ORDERING) {
        const result = classifyEventInboxDisposition(evidence({ priorRecord, objectOrdering }));
        if (result.appliesEffect) {
          expect(FRESH_ORDER).toContain(objectOrdering);
          expect(['absent', 'pending']).toContain(priorRecord);
          // Never re-apply a settled id.
          expect(priorRecord).not.toBe('applied');
          expect(priorRecord).not.toBe('ignored');
          expect(priorRecord).not.toBe('quarantined');
        }
      }
    }
  });

  test('process is reachable ONLY from a first-seen (absent) event id', () => {
    for (const priorRecord of PRIOR) {
      for (const objectOrdering of ORDERING) {
        const result = classifyEventInboxDisposition(evidence({ priorRecord, objectOrdering }));
        if (result.disposition === 'process') {
          expect(priorRecord).toBe('absent');
          expect(FRESH_ORDER).toContain(objectOrdering);
        }
      }
    }
  });

  test('a crashed pending attempt safely reprocesses when fresh and in order', () => {
    for (const objectOrdering of FRESH_ORDER) {
      const result = classifyEventInboxDisposition(evidence({ priorRecord: 'pending', objectOrdering }));
      expect(result.disposition).toBe('reprocess_incomplete');
      expect(result.appliesEffect).toBe(true);
    }
  });

  test('a clean first-seen event in order processes', () => {
    for (const objectOrdering of FRESH_ORDER) {
      const result = classifyEventInboxDisposition(evidence({ priorRecord: 'absent', objectOrdering }));
      expect(result.disposition).toBe('process');
      expect(result.appliesEffect).toBe(true);
    }
  });

  test('an equal-position event is an idempotent replay for every not-yet-settled prior', () => {
    for (const priorRecord of ['absent', 'pending']) {
      const result = classifyEventInboxDisposition(evidence({ priorRecord, objectOrdering: 'equal' }));
      expect(result.disposition).toBe('ignore_duplicate');
      expect(result.appliesEffect).toBe(false);
    }
  });

  test('the classifier itself performs no side effect (verdict is advisory only)', () => {
    // An applies-effect verdict is still just a recommendation: nothing is
    // processed, sent, or persisted. We assert the result is a plain frozen
    // data object of primitives.
    const result = classifyEventInboxDisposition(evidence());
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
    expectRejected(evidence({ eventInboxSchemaVersion: 2 }));
    expectRejected(evidence({ eventInboxSchemaVersion: '1' }));
    expectRejected(evidence({ eventInboxSchemaVersion: 0 }));
  });

  test.each([
    ['priorRecord', 'not_a_state'],
    ['objectOrdering', 'sideways'],
  ])('rejects an unknown %s enum value', (field, value) => {
    expectRejected(evidence({ [field]: value }));
  });

  test('rejects an output-only disposition value smuggled into an input field', () => {
    expectRejected(evidence({ priorRecord: 'process' }));
    expectRejected(evidence({ objectOrdering: 'quarantine' }));
    expectRejected(evidence({ priorRecord: 'reprocess_incomplete' }));
  });

  test('rejects a boolean or number where an enum is required', () => {
    expectRejected(evidence({ priorRecord: false }));
    expectRejected(evidence({ objectOrdering: 0 }));
  });

  test('rejects a missing required field', () => {
    const e = evidence();
    delete e.objectOrdering;
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
      eventInboxSchemaVersion: 1,
      priorRecord: 'absent',
    };
    Object.defineProperty(hostile, 'objectOrdering', {
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
    expect(eventInboxSchemaVersion).toBe(1);
    expect(Object.isFrozen(EVENT_INBOX_ENUMS)).toBe(true);
    for (const values of Object.values(EVENT_INBOX_ENUMS)) {
      expect(Object.isFrozen(values)).toBe(true);
    }
  });

  test('publishes the closed input and output vocabularies', () => {
    expect(EVENT_INBOX_ENUMS.priorRecord).toEqual([
      'absent',
      'pending',
      'applied',
      'ignored',
      'quarantined',
    ]);
    expect(EVENT_INBOX_ENUMS.objectOrdering).toEqual([
      'first_for_object',
      'advances',
      'equal',
      'stale',
      'indeterminate',
    ]);
    expect([...EVENT_INBOX_ENUMS.disposition].sort()).toEqual([
      'ignore_duplicate',
      'ignore_stale',
      'process',
      'quarantine',
      'reprocess_incomplete',
    ]);
  });

  test('the error is frozen, carries no own enumerable state, and serializes empty', () => {
    const err = new CommerceEventInboxError();
    expect(Object.isFrozen(err)).toBe(true);
    expect(Object.keys(err)).toEqual([]);
    expect(JSON.stringify(err)).toBe('{}');
    expect(err.name).toBe('CommerceEventInboxError');
    expect(err.code).toBe('invalid_event_inbox_evidence');
  });
});

describe('source boundary — pure, unused, provider-agnostic', () => {
  const modulePath = path.join(__dirname, 'commerceEventInboxDisposition.js');
  const source = fs.readFileSync(modulePath, 'utf8');

  test('is not imported by the functions runtime entry point', () => {
    const indexPath = path.join(__dirname, 'index.js');
    const index = fs.readFileSync(indexPath, 'utf8');
    expect(index).not.toContain('commerceEventInboxDisposition');
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

  test('hard-codes the exactly-once and fail-closed invariants in the frozen results', () => {
    expect(source).toContain('appliesEffect');
    expect(source).toContain("frozenDisposition('process', true)");
    expect(source).toContain("frozenDisposition('reprocess_incomplete', true)");
    expect(source).toContain("frozenDisposition('ignore_duplicate', false)");
    expect(source).toContain("frozenDisposition('ignore_stale', false)");
    expect(source).toContain("frozenDisposition('quarantine', false)");
  });
});
