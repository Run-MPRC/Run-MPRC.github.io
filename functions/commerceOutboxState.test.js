const fs = require('node:fs');
const path = require('node:path');

const {
  outboxStateSchemaVersion,
  OutboxDeliveryState,
  reduceOutboxDelivery,
  validateOutboxRecord,
} = require('./commerceOutboxState');

const HOSTILE_CANARY = 'private-member@example.test/+12025550170?token=do-not-copy';

const STATES = Object.values(OutboxDeliveryState);

// Mirror of the module's declared topology; the reducer is checked against this
// independently derived matrix.
const ALLOWED = {
  queued: ['dispatching'],
  dispatching: ['dispatched', 'retry_scheduled', 'dead_letter', 'suppressed'],
  retry_scheduled: ['dispatching', 'dead_letter'],
  dispatched: ['delivered', 'dead_letter', 'suppressed'],
};
const ATTEMPT_START = new Set(['dispatching']);
const RESULT_KEYS = ['accepted', 'outcome', 'changed', 'state', 'attemptCount', 'reason'];

// Lowest attempt count coherent with a state: nothing attempted while queued,
// at least one begun attempt for every other state. A mid value (2) is used for
// non-queued states so that increments and decrements are both observable.
function baseline(state) {
  return state === 'queued' ? 0 : 2;
}

function pair(deliveryState, attemptCount) {
  return { deliveryState, attemptCount };
}

function record(overrides = {}) {
  return {
    outboxStateSchemaVersion: 1,
    outboxKey: 'race:2026-fall-classic:confirmation:v1',
    intentType: 'transactional_email',
    deliveryState: 'queued',
    attemptCount: 0,
    ...overrides,
  };
}

describe('outbox delivery reducer topology', () => {
  test('exhausts every known state pair against the declared matrix', () => {
    let pairCount = 0;
    STATES.forEach((current) => {
      STATES.forEach((next) => {
        pairCount += 1;
        const currentAttempt = baseline(current);
        let nextAttempt;
        if (current === next) {
          nextAttempt = currentAttempt;
        } else if ((ALLOWED[current] || []).includes(next)) {
          nextAttempt = currentAttempt + (ATTEMPT_START.has(next) ? 1 : 0);
        } else {
          nextAttempt = baseline(next);
        }
        const result = reduceOutboxDelivery(pair(current, currentAttempt), pair(next, nextAttempt));
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.keys(result)).toEqual(RESULT_KEYS);
        if (current === next) {
          expect(result).toEqual({
            accepted: true,
            outcome: 'unchanged',
            changed: false,
            state: current,
            attemptCount: currentAttempt,
            reason: 'same_state',
          });
        } else if ((ALLOWED[current] || []).includes(next)) {
          expect(result).toEqual({
            accepted: true,
            outcome: 'applied',
            changed: true,
            state: next,
            attemptCount: nextAttempt,
            reason: 'transition_applied',
          });
        } else {
          expect(result).toEqual({
            accepted: false,
            outcome: 'rejected',
            changed: false,
            state: current,
            attemptCount: currentAttempt,
            reason: 'transition_forbidden',
          });
        }
      });
    });
    expect(pairCount).toBe(STATES.length ** 2);
  });

  test('terminal states never resurrect and are idempotent in place', () => {
    for (const terminal of ['delivered', 'dead_letter', 'suppressed']) {
      for (const next of ['queued', 'dispatching', 'dispatched', 'retry_scheduled']) {
        const result = reduceOutboxDelivery(pair(terminal, 3), pair(next, baseline(next)));
        expect(result.accepted).toBe(false);
        expect(result.reason).toBe('transition_forbidden');
        expect(result.state).toBe(terminal);
      }
      expect(reduceOutboxDelivery(pair(terminal, 3), pair(terminal, 3))).toEqual({
        accepted: true,
        outcome: 'unchanged',
        changed: false,
        state: terminal,
        attemptCount: 3,
        reason: 'same_state',
      });
    }
  });
});

describe('monotonic attempt counter', () => {
  test('increments by exactly one only when a fresh attempt begins', () => {
    expect(reduceOutboxDelivery(pair('queued', 0), pair('dispatching', 1)).outcome).toBe('applied');
    expect(reduceOutboxDelivery(pair('retry_scheduled', 2), pair('dispatching', 3)).outcome)
      .toBe('applied');
    // Same edge, coherent but wrong delta (2, 3, 5 are all >= 1 yet never 0 + 1).
    for (const bad of [2, 3, 5]) {
      const result = reduceOutboxDelivery(pair('queued', 0), pair('dispatching', bad));
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('attempt_not_monotonic');
    }
  });

  test('holds the counter steady across non-attempt edges and rejects drift', () => {
    expect(reduceOutboxDelivery(pair('dispatching', 2), pair('dispatched', 2)).outcome)
      .toBe('applied');
    // A non-attempt edge must not bump the counter (would double-count a send).
    expect(reduceOutboxDelivery(pair('dispatching', 2), pair('dispatched', 3)).reason)
      .toBe('attempt_not_monotonic');
    // The counter must never move backward.
    expect(reduceOutboxDelivery(pair('dispatching', 2), pair('retry_scheduled', 1)).reason)
      .toBe('attempt_not_monotonic');
    expect(reduceOutboxDelivery(pair('dispatched', 2), pair('delivered', 1)).reason)
      .toBe('attempt_not_monotonic');
  });

  test('same-state replay must keep the identical attempt count', () => {
    expect(reduceOutboxDelivery(pair('dispatching', 2), pair('dispatching', 2)).outcome)
      .toBe('unchanged');
    expect(reduceOutboxDelivery(pair('dispatching', 2), pair('dispatching', 3)).reason)
      .toBe('attempt_not_monotonic');
    expect(reduceOutboxDelivery(pair('dispatching', 2), pair('dispatching', 1)).reason)
      .toBe('attempt_not_monotonic');
  });

  test('rejects state/attempt incoherence in either operand', () => {
    // queued means nothing has been attempted yet.
    expect(reduceOutboxDelivery(pair('queued', 1), pair('dispatching', 2)).reason)
      .toBe('attempt_state_mismatch');
    // a begun state cannot show zero attempts.
    expect(reduceOutboxDelivery(pair('dispatching', 0), pair('dispatched', 0)).reason)
      .toBe('attempt_state_mismatch');
    expect(reduceOutboxDelivery(pair('queued', 0), pair('dispatching', 0)).reason)
      .toBe('attempt_state_mismatch');
  });

  test('rejects non-integer, negative, and unsafe attempt counts', () => {
    for (const bad of [-1, 1.5, Number.NaN, 2 ** 53, '1', null, undefined, {}]) {
      const result = reduceOutboxDelivery(pair('dispatching', bad), pair('dispatched', 2));
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('invalid_attempt');
      expect(result.attemptCount).toBeNull();
    }
  });
});

describe('hostile and malformed reducer input', () => {
  test('rejects unknown states without echoing input', () => {
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const first = reduceOutboxDelivery(pair(HOSTILE_CANARY, 0), pair('queued', 0));
      const second = reduceOutboxDelivery(pair('queued', 0), pair(HOSTILE_CANARY, 1));
      expect(first.reason).toBe('unknown_state');
      expect(first.state).toBeNull();
      expect(second.reason).toBe('unknown_state');
      expect(JSON.stringify([first, second])).not.toContain(HOSTILE_CANARY);
      expect(consoleLog).not.toHaveBeenCalled();
      expect(consoleWarn).not.toHaveBeenCalled();
    } finally {
      consoleLog.mockRestore();
      consoleWarn.mockRestore();
    }
  });

  test('rejects non-object, extra-key, missing-key, proxy, and accessor operands', () => {
    const extraKey = { deliveryState: 'queued', attemptCount: 0, injected: HOSTILE_CANARY };
    const missingKey = { deliveryState: 'queued' };
    const proxied = new Proxy(pair('queued', 0), {});
    const accessor = {};
    Object.defineProperty(accessor, 'deliveryState', {
      enumerable: true,
      get() { return HOSTILE_CANARY; },
    });
    Object.defineProperty(accessor, 'attemptCount', { enumerable: true, value: 0 });
    const inherited = Object.create({ deliveryState: 'queued', attemptCount: 0 });

    for (const bad of [null, undefined, 'queued', 42, [], extraKey, missingKey, proxied, accessor,
      inherited]) {
      const result = reduceOutboxDelivery(bad, pair('dispatching', 1));
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('invalid_record');
      expect(result.state).toBeNull();
      expect(result.attemptCount).toBeNull();
      expect(JSON.stringify(result)).not.toContain(HOSTILE_CANARY);
    }
  });
});

describe('outbox record validation', () => {
  test('accepts a valid record and returns an independent frozen projection', () => {
    for (const [deliveryState, attemptCount] of [
      ['queued', 0],
      ['dispatching', 1],
      ['dispatched', 2],
      ['delivered', 2],
      ['retry_scheduled', 3],
      ['dead_letter', 4],
      ['suppressed', 1],
    ]) {
      const input = record({ deliveryState, attemptCount });
      const before = JSON.stringify(input);
      const result = validateOutboxRecord(input);
      expect(result.accepted).toBe(true);
      expect(result.status).toBe('valid');
      expect(result.reasons).toEqual([]);
      expect(result.projection).toEqual(input);
      expect(result.projection).not.toBe(input);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.projection)).toBe(true);
      expect(Object.isFrozen(result.reasons)).toBe(true);
      expect(JSON.stringify(input)).toBe(before);
      expect(Object.isFrozen(input)).toBe(false);
    }
  });

  test.each([
    ['wrong version', record({ outboxStateSchemaVersion: 2 }), 'invalid_version'],
    ['empty outbox key', record({ outboxKey: '' }), 'invalid_outbox_key'],
    ['spaced outbox key', record({ outboxKey: 'has spaces' }), 'invalid_outbox_key'],
    ['overlong outbox key', record({ outboxKey: `k${'x'.repeat(200)}` }), 'invalid_outbox_key'],
    ['non-string intent', record({ intentType: 42 }), 'invalid_intent_type'],
    ['unknown state', record({ deliveryState: 'sent' }), 'unknown_state'],
    ['negative attempt', record({ deliveryState: 'dispatching', attemptCount: -1 }),
      'invalid_attempt'],
    ['fractional attempt', record({ deliveryState: 'dispatching', attemptCount: 1.5 }),
      'invalid_attempt'],
    ['queued with attempts', record({ deliveryState: 'queued', attemptCount: 3 }),
      'attempt_state_mismatch'],
    ['begun with zero attempts', record({ deliveryState: 'dispatched', attemptCount: 0 }),
      'attempt_state_mismatch'],
  ])('rejects %s', (_name, input, reason) => {
    const result = validateOutboxRecord(input);
    expect(result.accepted).toBe(false);
    expect(result.status).toBe('rejected');
    expect(result.reasons).toContain(reason);
    expect(result.projection).toBeNull();
  });

  test('rejects extra keys, missing keys, proxies, and accessors as invalid records', () => {
    const extra = { ...record(), injected: HOSTILE_CANARY };
    const missing = { outboxStateSchemaVersion: 1, outboxKey: 'k', intentType: 't' };
    const proxied = new Proxy(record(), {});
    const accessor = { ...record() };
    delete accessor.outboxKey;
    Object.defineProperty(accessor, 'outboxKey', {
      enumerable: true,
      get() { return HOSTILE_CANARY; },
    });
    for (const bad of [extra, missing, proxied, accessor, null, [], 'queued']) {
      const result = validateOutboxRecord(bad);
      expect(result.accepted).toBe(false);
      expect(result.reasons).toContain('invalid_record');
      expect(JSON.stringify(result)).not.toContain(HOSTILE_CANARY);
    }
  });

  test('collects and sorts multiple independent reasons without leaking input', () => {
    const result = validateOutboxRecord(record({
      outboxStateSchemaVersion: 9,
      outboxKey: HOSTILE_CANARY,
      deliveryState: 'sent',
      attemptCount: -4,
    }));
    expect(result.accepted).toBe(false);
    expect(result.reasons).toEqual([...result.reasons].sort());
    expect(result.reasons).toEqual(expect.arrayContaining([
      'invalid_version',
      'invalid_outbox_key',
      'unknown_state',
      'invalid_attempt',
    ]));
    expect(JSON.stringify(result)).not.toContain(HOSTILE_CANARY);
  });
});

describe('frozen versioned surface', () => {
  test('exports version one and a frozen closed delivery-state enum', () => {
    expect(outboxStateSchemaVersion).toBe(1);
    expect(Object.isFrozen(OutboxDeliveryState)).toBe(true);
    expect(new Set(Object.values(OutboxDeliveryState)).size).toBe(7);
    expect(OutboxDeliveryState).not.toHaveProperty('SENT');
    expect(OutboxDeliveryState.DEAD_LETTER).toBe('dead_letter');
  });
});

describe('source boundary', () => {
  test('imports only node:util and is adopted by no runtime', () => {
    const source = fs.readFileSync(path.join(__dirname, 'commerceOutboxState.js'), 'utf8');
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toContain('commerceOutboxState');

    const requires = [...source.matchAll(/require\(([^)]+)\)/g)].map((match) => match[1]);
    expect(requires).toEqual(["'node:util'"]);

    for (const forbidden of [
      "require('firebase",
      "require('stripe",
      "require('node:fs')",
      'process.env',
      'Date.now',
      'new Date',
      'Math.random',
      'console.',
      'fetch(',
      'https:',
      'http:',
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).not.toMatch(/firebase|firestore|stripe|google|whatsapp|strava/i);
    expect(source).not.toMatch(/email|phone|address|dob|emergency|recipient|payload_body/i);
  });
});
