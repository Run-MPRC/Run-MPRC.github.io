'use strict';

// Exhaustive, negative-heavy contract test for the INSTAGRAM-005C publisher-alert
// disposition decision (SOURCE ONLY, UNUSED — imported by nothing; see
// SYSTEM_DESIGN.md §8.21). The crown jewel: a genuine NEW fault is never silent
// (fail-loud), and only an exact duplicate of an already-open alert is ever
// debounced. Severity is reducer-owned and cannot be forged by the observation.

const fs = require('fs');
const path = require('path');

const alerts = require('./instagramPublisherAlerts');

const {
  publisherAlertSchemaVersion,
  AlertCondition,
  HealthState,
  AlertSeverity,
  AlertDecision,
  SuppressReason,
  DenialReason,
  classifyPublisherAlert,
} = alerts;

// ---- collision-free fixtures --------------------------------------------

const SUBJECT_REF = 'acct_17205550143';
const OTHER_SUBJECT_REF = 'acct_98761234500';

const ALL_CONDITIONS = [
  'refresh_failure',
  'provider_restriction',
  'kill_switch_activated',
  'schedule_lag',
  'stuck_container',
  'unknown_outcome',
  'quota_pressure',
];
const ALL_HEALTH = ['faulting', 'healthy'];

function openAlert(overrides = {}) {
  return {
    publisherAlertSchemaVersion: 1,
    condition: 'refresh_failure',
    subjectRef: SUBJECT_REF,
    ...overrides,
  };
}

function observation(overrides = {}) {
  return {
    publisherAlertSchemaVersion: 1,
    condition: 'refresh_failure',
    subjectRef: SUBJECT_REF,
    health: 'faulting',
    ...overrides,
  };
}

// ---- independent oracles (hand-authored; NOT imported from the module) ---

// Keyed by `${health}|${openPresence}` for a COHERENT (matching condition+subject)
// pairing. This is the whole legitimate decision surface.
const CORE_ORACLE = {
  'faulting|none': { decision: 'raise' },
  'faulting|open': { decision: 'suppress', reason: 'duplicate_open' },
  'healthy|none': { decision: 'suppress', reason: 'already_clear' },
  'healthy|open': { decision: 'resolve' },
};

// Independently transcribed from #95's condition list — never read from the module.
const SEVERITY_ORACLE = {
  refresh_failure: 'critical',
  provider_restriction: 'critical',
  kill_switch_activated: 'critical',
  schedule_lag: 'warning',
  stuck_container: 'warning',
  unknown_outcome: 'warning',
  quota_pressure: 'info',
};

// ---- 1. frozen surface & closed vocabularies -----------------------------

describe('frozen surface & closed vocabularies', () => {
  test('module and every exported enum are frozen', () => {
    expect(Object.isFrozen(alerts)).toBe(true);
    for (const e of [AlertCondition, HealthState, AlertSeverity, AlertDecision,
      SuppressReason, DenialReason]) {
      expect(Object.isFrozen(e)).toBe(true);
    }
  });

  test('schema version is the pinned integer', () => {
    expect(publisherAlertSchemaVersion).toBe(1);
  });

  test('condition enum is exactly the seven monitored conditions', () => {
    expect(new Set(Object.values(AlertCondition))).toEqual(new Set(ALL_CONDITIONS));
    expect(Object.values(AlertCondition)).toHaveLength(7);
  });

  test('health / severity / decision / reason enums are exactly their closed sets', () => {
    expect(new Set(Object.values(HealthState))).toEqual(new Set(['faulting', 'healthy']));
    expect(new Set(Object.values(AlertSeverity))).toEqual(new Set(['critical', 'warning', 'info']));
    expect(new Set(Object.values(AlertDecision)))
      .toEqual(new Set(['raise', 'suppress', 'resolve', 'denied']));
    expect(new Set(Object.values(SuppressReason)))
      .toEqual(new Set(['duplicate_open', 'already_clear']));
    expect(new Set(Object.values(DenialReason)))
      .toEqual(new Set(['malformed_open_state', 'malformed_observation', 'subject_mismatch']));
  });

  test('output vocabulary contains NO publish/republish/retry/escalate action', () => {
    // This is a per-condition dedup+classify core: it neither publishes nor escalates.
    // Assert the actual decision/reason ALPHABET carries none of that vocabulary.
    const vocab = [
      ...Object.values(AlertDecision),
      ...Object.values(SuppressReason),
      ...Object.values(DenialReason),
    ].join(' ');
    for (const forbidden of ['publish', 'republish', 'retry', 'escalate', 'send', 'post']) {
      expect(vocab).not.toContain(forbidden);
    }
  });
});

// ---- 2. the 2x2 core matrix vs the independent oracle ---------------------

describe('core decision matrix vs an independent oracle', () => {
  const coveredCells = new Set();

  test('every (condition x health x open-presence) coherent pairing matches the oracle', () => {
    for (const condition of ALL_CONDITIONS) {
      for (const health of ALL_HEALTH) {
        for (const openPresence of ['none', 'open']) {
          const openState = openPresence === 'none'
            ? null
            : openAlert({ condition, subjectRef: SUBJECT_REF });
          const v = classifyPublisherAlert(openState, observation({ condition, health }));
          const key = `${health}|${openPresence}`;
          const expected = CORE_ORACLE[key];
          coveredCells.add(key);

          expect(v.decision).toBe(expected.decision);
          if (expected.reason) {
            expect(v.reason).toBe(expected.reason);
          } else {
            expect(v).not.toHaveProperty('reason');
          }
          // Every non-denied verdict reports the condition's reducer-owned severity.
          expect(v.condition).toBe(condition);
          expect(v.subjectRef).toBe(SUBJECT_REF);
          expect(v.severity).toBe(SEVERITY_ORACLE[condition]);
        }
      }
    }
  });

  test('the matrix is non-vacuous — all four oracle cells were exercised', () => {
    expect(coveredCells).toEqual(new Set(Object.keys(CORE_ORACLE)));
  });
});

// ---- 3. severity is reducer-owned and correctly classified ----------------

describe('severity classification (reducer-owned, unforgeable)', () => {
  test('each condition maps to the oracle severity on a raised alert', () => {
    for (const condition of ALL_CONDITIONS) {
      const v = classifyPublisherAlert(null, observation({ condition, health: 'faulting' }));
      expect(v.decision).toBe('raise');
      expect(v.severity).toBe(SEVERITY_ORACLE[condition]);
    }
  });

  test('all three severity levels are exercised by the seven conditions', () => {
    const seen = new Set(ALL_CONDITIONS.map((condition) => classifyPublisherAlert(
      null, observation({ condition, health: 'faulting' }),
    ).severity));
    expect(seen).toEqual(new Set(['critical', 'warning', 'info']));
  });

  test('an observation cannot inject/forge a severity — an extra key denies', () => {
    // quota_pressure is 'info'; an attacker adding severity:'critical' (or trying to
    // quiet a critical to 'info') must NOT take effect — the extra key is malformed.
    const forged = observation({ condition: 'quota_pressure', health: 'faulting' });
    forged.severity = 'critical';
    const v = classifyPublisherAlert(null, forged);
    expect(v.decision).toBe('denied');
    expect(v.reason).toBe('malformed_observation');
  });

  test('the open-alert record carries no severity field to read back', () => {
    // Even a well-formed open alert cannot smuggle a severity: adding one denies.
    const withSeverity = openAlert();
    withSeverity.severity = 'info';
    const v = classifyPublisherAlert(withSeverity, observation());
    expect(v.decision).toBe('denied');
    expect(v.reason).toBe('malformed_open_state');
  });
});

// ---- 4. CROWN JEWEL: fail-loud / notify semantics -------------------------

describe('crown jewel — a new fault is never silent; only duplicates debounce', () => {
  test('a NEW fault (faulting + nothing open) ALWAYS raises & notifies, for every condition', () => {
    for (const condition of ALL_CONDITIONS) {
      const v = classifyPublisherAlert(null, observation({ condition, health: 'faulting' }));
      expect(v.decision).toBe('raise');
      expect(v.notify).toBe(true);
    }
  });

  test('notify === false IFF decision === suppress, across the whole coherent matrix', () => {
    for (const condition of ALL_CONDITIONS) {
      for (const health of ALL_HEALTH) {
        for (const openPresence of ['none', 'open']) {
          const openState = openPresence === 'none'
            ? null
            : openAlert({ condition, subjectRef: SUBJECT_REF });
          const v = classifyPublisherAlert(openState, observation({ condition, health }));
          expect(v.notify === false).toBe(v.decision === 'suppress');
        }
      }
    }
  });

  test('every denied verdict notifies (a malformed monitoring signal is itself loud)', () => {
    for (const reason of ['malformed_open_state', 'malformed_observation', 'subject_mismatch']) {
      // reach each denial reason
      let v;
      if (reason === 'malformed_open_state') v = classifyPublisherAlert(42, observation());
      else if (reason === 'malformed_observation') v = classifyPublisherAlert(null, 42);
      else {
        v = classifyPublisherAlert(
          openAlert({ subjectRef: SUBJECT_REF }),
          observation({ subjectRef: OTHER_SUBJECT_REF }),
        );
      }
      expect(v.decision).toBe('denied');
      expect(v.reason).toBe(reason);
      expect(v.notify).toBe(true);
    }
  });

  test('a forged healthy reading can flap but never permanently hide a persisting fault', () => {
    const open = openAlert({ condition: 'refresh_failure', subjectRef: SUBJECT_REF });
    // Forge healthy on an open critical alert -> resolves it (still notifies; not silent).
    const resolved = classifyPublisherAlert(open, observation({ health: 'healthy' }));
    expect(resolved.decision).toBe('resolve');
    expect(resolved.notify).toBe(true);
    // The fault persists; with nothing open now, the next faulting reading re-raises.
    const reraised = classifyPublisherAlert(null, observation({ health: 'faulting' }));
    expect(reraised.decision).toBe('raise');
    expect(reraised.notify).toBe(true);
  });

  test('no verdict in the coherent matrix carries a publish/escalate action anywhere', () => {
    for (const condition of ALL_CONDITIONS) {
      for (const health of ALL_HEALTH) {
        for (const openPresence of ['none', 'open']) {
          const openState = openPresence === 'none'
            ? null
            : openAlert({ condition, subjectRef: SUBJECT_REF });
          const v = classifyPublisherAlert(openState, observation({ condition, health }));
          const blob = `${Object.keys(v).join(' ')} ${Object.values(v).join(' ')}`;
          for (const forbidden of ['publish', 'retry', 'escalate']) {
            expect(blob).not.toContain(forbidden);
          }
        }
      }
    }
  });
});

// ---- 5. dedup correctness & subject binding -------------------------------

describe('dedup only debounces an exact (condition, subject) duplicate', () => {
  test('duplicate_open requires a matching open alert', () => {
    const v = classifyPublisherAlert(
      openAlert({ condition: 'stuck_container', subjectRef: SUBJECT_REF }),
      observation({ condition: 'stuck_container', subjectRef: SUBJECT_REF, health: 'faulting' }),
    );
    expect(v.decision).toBe('suppress');
    expect(v.reason).toBe('duplicate_open');
  });

  test('a DIFFERENT condition open on the same subject never debounces a fault — it denies', () => {
    const v = classifyPublisherAlert(
      openAlert({ condition: 'schedule_lag', subjectRef: SUBJECT_REF }),
      observation({ condition: 'stuck_container', subjectRef: SUBJECT_REF, health: 'faulting' }),
    );
    expect(v.decision).toBe('denied');
    expect(v.reason).toBe('subject_mismatch');
  });

  test('a different SUBJECT open never debounces a fault — it denies', () => {
    const v = classifyPublisherAlert(
      openAlert({ condition: 'stuck_container', subjectRef: SUBJECT_REF }),
      observation({ condition: 'stuck_container', subjectRef: OTHER_SUBJECT_REF, health: 'faulting' }),
    );
    expect(v.decision).toBe('denied');
    expect(v.reason).toBe('subject_mismatch');
  });

  test('a mismatched open alert cannot resolve a different subject either', () => {
    const v = classifyPublisherAlert(
      openAlert({ condition: 'stuck_container', subjectRef: SUBJECT_REF }),
      observation({ condition: 'stuck_container', subjectRef: OTHER_SUBJECT_REF, health: 'healthy' }),
    );
    expect(v.decision).toBe('denied');
    expect(v.reason).toBe('subject_mismatch');
  });
});

// ---- 6. resolve requires an explicit healthy reading of an open alert -----

describe('resolve is explicit-clear-only; never fabricated', () => {
  test('healthy + matching open -> resolve', () => {
    const v = classifyPublisherAlert(
      openAlert({ condition: 'quota_pressure', subjectRef: SUBJECT_REF }),
      observation({ condition: 'quota_pressure', subjectRef: SUBJECT_REF, health: 'healthy' }),
    );
    expect(v.decision).toBe('resolve');
    expect(v.severity).toBe('info');
  });

  test('healthy + nothing open -> suppress already_clear (never a fabricated resolve)', () => {
    const v = classifyPublisherAlert(null, observation({ health: 'healthy' }));
    expect(v.decision).toBe('suppress');
    expect(v.reason).toBe('already_clear');
    expect(v.notify).toBe(false);
  });

  test('a faulting reading never resolves', () => {
    for (const openPresence of ['none', 'open']) {
      const openState = openPresence === 'none' ? null : openAlert();
      const v = classifyPublisherAlert(openState, observation({ health: 'faulting' }));
      expect(v.decision).not.toBe('resolve');
    }
  });
});

// ---- 7. malformed OPEN-STATE battery -------------------------------------

describe('malformed open-state denies (fail-loud), and null means "nothing open"', () => {
  test('a literal null open-state is NONE (not malformed) — a fault still raises', () => {
    const v = classifyPublisherAlert(null, observation({ health: 'faulting' }));
    expect(v.decision).toBe('raise');
  });

  const revocable = Proxy.revocable(openAlert(), {});
  revocable.revoke();

  const inheritedOpen = Object.create({ subjectRef: SUBJECT_REF });
  inheritedOpen.publisherAlertSchemaVersion = 1;
  inheritedOpen.condition = 'refresh_failure';

  let getterInvoked = false;
  const accessorOpen = {
    publisherAlertSchemaVersion: 1,
    condition: 'refresh_failure',
  };
  Object.defineProperty(accessorOpen, 'subjectRef', {
    enumerable: true,
    get() { getterInvoked = true; return SUBJECT_REF; },
  });

  const cases = [
    ['undefined', undefined],
    ['a number', 42],
    ['a string', 'refresh_failure'],
    ['a boolean', true],
    ['a bigint', 10n],
    ['a symbol', Symbol('x')],
    ['a function', () => openAlert()],
    ['an array', [1, 2, 3]],
    ['a live proxy', new Proxy(openAlert(), {})],
    ['a revoked proxy', revocable.proxy],
    ['a foreign prototype (null-proto)', Object.assign(Object.create(null), openAlert())],
    ['an inherited field', inheritedOpen],
    ['an extra key', openAlert({ extra: 1 })],
    ['a health key (observation shape)', openAlert({ health: 'faulting' })],
    ['a missing key', { publisherAlertSchemaVersion: 1, condition: 'refresh_failure' }],
    ['a symbol key', Object.assign(openAlert(), { [Symbol('s')]: 1 })],
    ['wrong schema version', openAlert({ publisherAlertSchemaVersion: 2 })],
    ['a string schema version', openAlert({ publisherAlertSchemaVersion: '1' })],
    ['a non-enum condition', openAlert({ condition: 'meteor_strike' })],
    ['a non-string condition', openAlert({ condition: 7 })],
    ['an empty subjectRef', openAlert({ subjectRef: '' })],
    ['a too-long subjectRef', openAlert({ subjectRef: 'a'.repeat(257) })],
    ['a spaced subjectRef', openAlert({ subjectRef: 'has space' })],
    ['a newline subjectRef', openAlert({ subjectRef: 'acct_1\n' })],
    ['a comma subjectRef', openAlert({ subjectRef: 'a,b' })],
    ['a non-string subjectRef', openAlert({ subjectRef: 123 })],
    ['a null subjectRef', openAlert({ subjectRef: null })],
    ['an accessor field (getter must not run)', accessorOpen],
  ];

  test.each(cases)('open-state %s -> denied malformed_open_state', (_label, bad) => {
    const v = classifyPublisherAlert(bad, observation());
    expect(v.decision).toBe('denied');
    expect(v.reason).toBe('malformed_open_state');
  });

  test('the accessor getter was never invoked', () => {
    expect(getterInvoked).toBe(false);
  });
});

// ---- 8. malformed OBSERVATION battery ------------------------------------

describe('malformed observation denies (fail-loud)', () => {
  const revocable = Proxy.revocable(observation(), {});
  revocable.revoke();

  const inheritedObs = Object.create({ health: 'faulting' });
  inheritedObs.publisherAlertSchemaVersion = 1;
  inheritedObs.condition = 'refresh_failure';
  inheritedObs.subjectRef = SUBJECT_REF;

  let getterInvoked = false;
  const accessorObs = {
    publisherAlertSchemaVersion: 1,
    condition: 'refresh_failure',
    subjectRef: SUBJECT_REF,
  };
  Object.defineProperty(accessorObs, 'health', {
    enumerable: true,
    get() { getterInvoked = true; return 'faulting'; },
  });

  const cases = [
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['an array', [1, 2, 3]],
    ['a live proxy', new Proxy(observation(), {})],
    ['a revoked proxy', revocable.proxy],
    ['a foreign prototype (null-proto)', Object.assign(Object.create(null), observation())],
    ['an inherited field', inheritedObs],
    ['an extra key', observation({ extra: 1 })],
    ['an injected severity key', observation({ severity: 'info' })],
    ['a missing health', {
      publisherAlertSchemaVersion: 1, condition: 'refresh_failure', subjectRef: SUBJECT_REF,
    }],
    ['a missing condition', {
      publisherAlertSchemaVersion: 1, subjectRef: SUBJECT_REF, health: 'faulting',
    }],
    ['a symbol key', Object.assign(observation(), { [Symbol('s')]: 1 })],
    ['wrong schema version', observation({ publisherAlertSchemaVersion: 2 })],
    ['a non-enum condition', observation({ condition: 'meteor_strike' })],
    ['a non-enum health', observation({ health: 'degraded' })],
    ['a non-string health', observation({ health: 1 })],
    ['an empty subjectRef', observation({ subjectRef: '' })],
    ['a newline subjectRef', observation({ subjectRef: 'acct_1\n' })],
    ['a non-string subjectRef', observation({ subjectRef: {} })],
    ['an accessor field (getter must not run)', accessorObs],
  ];

  test.each(cases)('observation %s -> denied malformed_observation', (_label, bad) => {
    const v = classifyPublisherAlert(null, bad);
    expect(v.decision).toBe('denied');
    expect(v.reason).toBe('malformed_observation');
  });

  test('the accessor getter was never invoked', () => {
    expect(getterInvoked).toBe(false);
  });
});

// ---- 9. hostile input never throws ---------------------------------------

describe('never throws on hostile input', () => {
  const hostile = [
    null,
    undefined,
    42,
    'x',
    10n,
    Symbol('s'),
    () => {},
    [1, 2, 3],
    new Proxy({}, { get() { throw new Error('trap'); } }),
    (() => { const r = Proxy.revocable({}, {}); r.revoke(); return r.proxy; })(),
    Object.assign(Object.create(null), { a: 1 }),
    { publisherAlertSchemaVersion: 1 },
    'a'.repeat(100000),
    { deeply: { nested: { and: { irrelevant: true } } } },
  ];

  test('classify(a, b) over the hostile cross-product returns a valid frozen verdict', () => {
    const decisions = new Set(['raise', 'suppress', 'resolve', 'denied']);
    for (const a of hostile) {
      for (const b of hostile) {
        let v;
        expect(() => { v = classifyPublisherAlert(a, b); }).not.toThrow();
        expect(Object.isFrozen(v)).toBe(true);
        expect(decisions.has(v.decision)).toBe(true);
        expect(typeof v.notify).toBe('boolean');
      }
    }
  });
});

// ---- 10. determinism, immutability, singletons ---------------------------

describe('determinism, immutability, and singletons', () => {
  test('identical inputs yield a deep-equal verdict every time', () => {
    const a = classifyPublisherAlert(null, observation({ condition: 'kill_switch_activated' }));
    const b = classifyPublisherAlert(null, observation({ condition: 'kill_switch_activated' }));
    expect(a).toEqual(b);
  });

  test('denied verdicts are shared frozen singletons per reason', () => {
    const one = classifyPublisherAlert(42, observation());
    const two = classifyPublisherAlert('bad', observation());
    expect(one).toBe(two);
    expect(Object.isFrozen(one)).toBe(true);
  });

  test('every verdict family is frozen', () => {
    const raised = classifyPublisherAlert(null, observation({ health: 'faulting' }));
    const suppressed = classifyPublisherAlert(openAlert(), observation({ health: 'faulting' }));
    const resolved = classifyPublisherAlert(openAlert(), observation({ health: 'healthy' }));
    const denied = classifyPublisherAlert(42, observation());
    for (const v of [raised, suppressed, resolved, denied]) {
      expect(Object.isFrozen(v)).toBe(true);
    }
  });

  test('a frozen verdict cannot be tampered by write-through (strict mode)', () => {
    const v = classifyPublisherAlert(null, observation({ health: 'faulting' }));
    expect(() => { v.notify = false; }).toThrow(TypeError);
    expect(() => { v.decision = 'publish'; }).toThrow(TypeError);
    expect(() => { v.severity = 'info'; }).toThrow(TypeError);
    expect(() => { v.injected = 'x'; }).toThrow(TypeError);
    expect(v.notify).toBe(true);
    expect(v.decision).toBe('raise');
    expect(v).not.toHaveProperty('injected');
  });
});

// ---- 11. source boundary (SOURCE ONLY, UNUSED) ---------------------------

describe('source boundary — pure, content-free, imported by nothing', () => {
  const modulePath = path.join(__dirname, 'instagramPublisherAlerts.js');
  const source = fs.readFileSync(modulePath, 'utf8');
  const codeOnly = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  test('header names the unit, section, and SOURCE ONLY status', () => {
    expect(source).toContain('INSTAGRAM-005C');
    expect(source).toContain('SOURCE ONLY, UNUSED');
    expect(source).toContain('§8.21');
  });

  test('code carries no post-content or secret vocabulary', () => {
    const lowered = codeOnly.toLowerCase();
    for (const forbidden of ['caption', 'secret', 'password', 'sk_live', 'whsec',
      'bearer', 'token', 'date of birth', 'emergency contact', 'address',
      'phone number']) {
      // Word-bounded so a short token does not collide with a legitimate
      // identifier (e.g. "dob" inside "readObservation").
      const pattern = new RegExp(`\\b${forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      expect(lowered).not.toMatch(pattern);
    }
  });

  test('requires only node:util', () => {
    const requires = [...source.matchAll(/require\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(requires).toEqual(["'node:util'"]);
  });

  test('no sibling functions module imports this one (imported by nothing)', () => {
    const dir = __dirname;
    const importers = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.js') && f !== 'instagramPublisherAlerts.js'
        && f !== 'instagramPublisherAlerts.test.js')
      .filter((f) => {
        const text = fs.readFileSync(path.join(dir, f), 'utf8');
        return text.includes('instagramPublisherAlerts');
      });
    expect(importers).toEqual([]);
  });
});
