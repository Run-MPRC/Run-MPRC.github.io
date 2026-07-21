const fs = require('fs');
const path = require('path');

const {
  channelTaskSchemaVersion,
  ChannelTaskStatus,
  TransitionType,
  TransitionDecision,
  TransitionDenialReason,
  CompletionResult,
  FailureResult,
  WORKER_CAPABILITY,
  SUPERVISOR_CAPABILITY,
  classifyChannelTaskTransition,
} = require('./channelTaskLifecycle');

const TASK_ID = 'chn.v1.mbr_ABC123.google.7';
const HOLDER = 'worker_1';
const LEASE = '2026-07-21T12:00:00Z';
const AS_OF_LIVE = '2026-07-21T11:00:00Z'; // before the lease expiry -> lease is live
const AS_OF_STALE = '2026-07-21T12:30:00Z'; // after the lease expiry -> lease is stale
const NEW_LEASE = '2026-07-21T13:00:00Z'; // strictly after AS_OF_LIVE

function claimedTask(overrides = {}) {
  return {
    channelTaskSchemaVersion: 1,
    taskId: TASK_ID,
    status: 'claimed',
    leaseHolder: HOLDER,
    leaseExpiresAt: LEASE,
    ...overrides,
  };
}

function unheldTask(status, overrides = {}) {
  return {
    channelTaskSchemaVersion: 1,
    taskId: TASK_ID,
    status,
    leaseHolder: null,
    leaseExpiresAt: null,
    ...overrides,
  };
}

function renewCommand(overrides = {}) {
  return {
    channelTaskSchemaVersion: 1,
    type: 'renew',
    expectedStatus: 'claimed',
    actor: HOLDER,
    capability: WORKER_CAPABILITY,
    asOf: AS_OF_LIVE,
    leaseExpiresAt: NEW_LEASE,
    resultCode: null,
    ...overrides,
  };
}

function releaseCommand(overrides = {}) {
  return {
    channelTaskSchemaVersion: 1,
    type: 'release',
    expectedStatus: 'claimed',
    actor: HOLDER,
    capability: WORKER_CAPABILITY,
    asOf: AS_OF_LIVE,
    leaseExpiresAt: null,
    resultCode: null,
    ...overrides,
  };
}

function completeCommand(overrides = {}) {
  return {
    channelTaskSchemaVersion: 1,
    type: 'complete',
    expectedStatus: 'claimed',
    actor: HOLDER,
    capability: WORKER_CAPABILITY,
    asOf: AS_OF_LIVE,
    leaseExpiresAt: null,
    resultCode: 'applied',
    ...overrides,
  };
}

function failCommand(overrides = {}) {
  return {
    channelTaskSchemaVersion: 1,
    type: 'fail',
    expectedStatus: 'claimed',
    actor: HOLDER,
    capability: WORKER_CAPABILITY,
    asOf: AS_OF_LIVE,
    leaseExpiresAt: null,
    resultCode: 'provider_outage',
    ...overrides,
  };
}

function escalateCommand(overrides = {}) {
  return {
    channelTaskSchemaVersion: 1,
    type: 'escalate',
    expectedStatus: 'claimed',
    actor: 'supervisor_1',
    capability: SUPERVISOR_CAPABILITY,
    asOf: AS_OF_STALE,
    leaseExpiresAt: null,
    resultCode: null,
    ...overrides,
  };
}

const workerCommands = [
  ['renew', renewCommand],
  ['release', releaseCommand],
  ['complete', completeCommand],
  ['fail', failCommand],
];

const rawSource = fs.readFileSync(path.join(__dirname, 'channelTaskLifecycle.js'), 'utf8');

function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}
const sourceCode = codeOnly(rawSource);

describe('channelTaskLifecycle frozen surface', () => {
  test('schema version is the frozen revision 1', () => {
    expect(channelTaskSchemaVersion).toBe(1);
  });

  test('the module export object is frozen', () => {
    expect(Object.isFrozen(require('./channelTaskLifecycle'))).toBe(true);
  });

  test('the status enum is frozen and complete', () => {
    expect(ChannelTaskStatus).toEqual({
      PENDING: 'pending',
      CLAIMED: 'claimed',
      ESCALATED: 'escalated',
      COMPLETED: 'completed',
      FAILED: 'failed',
    });
    expect(Object.isFrozen(ChannelTaskStatus)).toBe(true);
  });

  test('the transition-type enum is frozen and complete', () => {
    expect(TransitionType).toEqual({
      RENEW: 'renew',
      RELEASE: 'release',
      COMPLETE: 'complete',
      FAIL: 'fail',
      ESCALATE: 'escalate',
    });
  });

  test('the decision enum is frozen and complete', () => {
    expect(TransitionDecision).toEqual({ GRANTED: 'granted', DENIED: 'denied' });
  });

  test('the completion and failure result enums are frozen and disjoint', () => {
    expect(Object.values(CompletionResult)).toEqual(['applied', 'already_current', 'manual_completed']);
    expect(Object.values(FailureResult)).toEqual(['provider_outage', 'manual_action_required', 'not_supported', 'rejected']);
    const overlap = Object.values(CompletionResult).filter((v) => Object.values(FailureResult).includes(v));
    expect(overlap).toEqual([]);
  });

  test('the capabilities are the two closed values', () => {
    expect(WORKER_CAPABILITY).toBe('channel_operator');
    expect(SUPERVISOR_CAPABILITY).toBe('channel_supervisor');
  });

  test('a denial reason vocabulary is exposed and frozen', () => {
    expect(TransitionDenialReason.MALFORMED_TASK).toBe('malformed_task');
    expect(TransitionDenialReason.NOT_LEASE_HOLDER).toBe('not_lease_holder');
    expect(Object.isFrozen(TransitionDenialReason)).toBe(true);
  });
});

describe('channelTaskLifecycle happy-path grants', () => {
  test('the lease holder renews a live claim, retaining the holder', () => {
    const verdict = classifyChannelTaskTransition(claimedTask(), renewCommand());
    expect(verdict).toEqual({
      decision: 'granted',
      reason: 'renewed',
      next: { status: 'claimed', leaseHolder: HOLDER, leaseExpiresAt: NEW_LEASE },
    });
  });

  test('the lease holder releases a live claim back to pending', () => {
    const verdict = classifyChannelTaskTransition(claimedTask(), releaseCommand());
    expect(verdict).toEqual({
      decision: 'granted',
      reason: 'released',
      next: { status: 'pending', leaseHolder: null, leaseExpiresAt: null },
    });
  });

  test.each(['applied', 'already_current', 'manual_completed'])(
    'the lease holder completes a live claim with result %p',
    (resultCode) => {
      const verdict = classifyChannelTaskTransition(claimedTask(), completeCommand({ resultCode }));
      expect(verdict).toEqual({
        decision: 'granted',
        reason: 'completed',
        next: { status: 'completed', leaseHolder: null, leaseExpiresAt: null, resultCode },
      });
    },
  );

  test.each(['provider_outage', 'manual_action_required', 'not_supported', 'rejected'])(
    'the lease holder fails a live claim with result %p',
    (resultCode) => {
      const verdict = classifyChannelTaskTransition(claimedTask(), failCommand({ resultCode }));
      expect(verdict).toEqual({
        decision: 'granted',
        reason: 'failed',
        next: { status: 'failed', leaseHolder: null, leaseExpiresAt: null, resultCode },
      });
    },
  );

  test('a supervisor escalates a stale claim, clearing the dead holder', () => {
    const verdict = classifyChannelTaskTransition(claimedTask(), escalateCommand());
    expect(verdict).toEqual({
      decision: 'granted',
      reason: 'escalated',
      next: { status: 'escalated', leaseHolder: null, leaseExpiresAt: null },
    });
  });

  test('the granted verdict and its next projection are frozen', () => {
    const verdict = classifyChannelTaskTransition(claimedTask(), renewCommand());
    expect(Object.isFrozen(verdict)).toBe(true);
    expect(Object.isFrozen(verdict.next)).toBe(true);
    try { verdict.next.status = 'completed'; } catch { /* strict-mode throw tolerated */ }
    expect(verdict.next.status).toBe('claimed');
  });

  test('renew accepts an exact lease-expiry boundary just after the instant', () => {
    const verdict = classifyChannelTaskTransition(
      claimedTask(),
      renewCommand({ asOf: AS_OF_LIVE, leaseExpiresAt: '2026-07-21T11:00:01Z' }),
    );
    expect(verdict.decision).toBe('granted');
  });
});

describe('channelTaskLifecycle at-most-one-active-worker enforcement', () => {
  test.each(workerCommands)('a %s by someone other than the lease holder is denied', (_type, make) => {
    const verdict = classifyChannelTaskTransition(claimedTask(), make({ actor: 'worker_2' }));
    expect(verdict).toEqual({ decision: 'denied', reason: 'not_lease_holder' });
  });

  test.each(workerCommands)('a %s over an expired lease is denied lease_expired', (_type, make) => {
    const task = claimedTask({ leaseExpiresAt: '2026-07-21T10:00:00Z' });
    const verdict = classifyChannelTaskTransition(task, make());
    expect(verdict).toEqual({ decision: 'denied', reason: 'lease_expired' });
  });

  test('the exact expiry instant counts as expired for a worker command', () => {
    const task = claimedTask({ leaseExpiresAt: AS_OF_LIVE });
    const verdict = classifyChannelTaskTransition(task, releaseCommand({ asOf: AS_OF_LIVE }));
    expect(verdict).toEqual({ decision: 'denied', reason: 'lease_expired' });
  });

  test('a worker command one second before expiry is honoured', () => {
    const task = claimedTask({ leaseExpiresAt: '2026-07-21T11:00:01Z' });
    const verdict = classifyChannelTaskTransition(task, releaseCommand({ asOf: AS_OF_LIVE }));
    expect(verdict.decision).toBe('granted');
  });

  test('escalate over a still-live lease is denied lease_active', () => {
    const verdict = classifyChannelTaskTransition(claimedTask(), escalateCommand({ asOf: AS_OF_LIVE }));
    expect(verdict).toEqual({ decision: 'denied', reason: 'lease_active' });
  });

  test('the exact expiry instant counts as stale for escalation', () => {
    const task = claimedTask({ leaseExpiresAt: AS_OF_STALE });
    const verdict = classifyChannelTaskTransition(task, escalateCommand({ asOf: AS_OF_STALE }));
    expect(verdict.decision).toBe('granted');
  });
});

describe('channelTaskLifecycle capability enforcement', () => {
  test.each(workerCommands)('a %s presented with the supervisor capability is denied', (_type, make) => {
    const verdict = classifyChannelTaskTransition(claimedTask(), make({ capability: SUPERVISOR_CAPABILITY }));
    expect(verdict).toEqual({ decision: 'denied', reason: 'capability_denied' });
  });

  test('an escalate presented with the worker capability is denied', () => {
    const verdict = classifyChannelTaskTransition(claimedTask(), escalateCommand({ capability: WORKER_CAPABILITY }));
    expect(verdict).toEqual({ decision: 'denied', reason: 'capability_denied' });
  });

  test('an unknown capability is denied', () => {
    const verdict = classifyChannelTaskTransition(claimedTask(), renewCommand({ capability: 'admin' }));
    expect(verdict).toEqual({ decision: 'denied', reason: 'capability_denied' });
  });
});

describe('channelTaskLifecycle optimistic concurrency and task state', () => {
  test('an expectedStatus that disagrees with the task is denied state_conflict', () => {
    const verdict = classifyChannelTaskTransition(claimedTask(), renewCommand({ expectedStatus: 'pending' }));
    expect(verdict).toEqual({ decision: 'denied', reason: 'state_conflict' });
  });

  test.each(['completed', 'failed'])('a worker command against a %s task is denied terminal_state', (status) => {
    const verdict = classifyChannelTaskTransition(
      unheldTask(status),
      completeCommand({ expectedStatus: status }),
    );
    expect(verdict).toEqual({ decision: 'denied', reason: 'terminal_state' });
  });

  test.each(['pending', 'escalated'])('a worker command against a %s task is denied not_claimed', (status) => {
    const verdict = classifyChannelTaskTransition(
      unheldTask(status),
      renewCommand({ expectedStatus: status }),
    );
    expect(verdict).toEqual({ decision: 'denied', reason: 'not_claimed' });
  });

  test('escalate against a pending task is denied not_claimed', () => {
    const verdict = classifyChannelTaskTransition(
      unheldTask('pending'),
      escalateCommand({ expectedStatus: 'pending' }),
    );
    expect(verdict).toEqual({ decision: 'denied', reason: 'not_claimed' });
  });
});

describe('channelTaskLifecycle unsupported and incoherent commands', () => {
  test.each(['claim', 'archive', 'RENEW', 'renewed'])('an unknown command type %p is denied unsupported_command', (type) => {
    const verdict = classifyChannelTaskTransition(claimedTask(), renewCommand({ type }));
    expect(verdict).toEqual({ decision: 'denied', reason: 'unsupported_command' });
  });

  test('renew without a new lease is denied malformed_command', () => {
    const verdict = classifyChannelTaskTransition(claimedTask(), renewCommand({ leaseExpiresAt: null }));
    expect(verdict).toEqual({ decision: 'denied', reason: 'malformed_command' });
  });

  test('renew carrying a result code is denied malformed_command', () => {
    const verdict = classifyChannelTaskTransition(claimedTask(), renewCommand({ resultCode: 'applied' }));
    expect(verdict).toEqual({ decision: 'denied', reason: 'malformed_command' });
  });

  test('release carrying a lease is denied malformed_command', () => {
    const verdict = classifyChannelTaskTransition(claimedTask(), releaseCommand({ leaseExpiresAt: NEW_LEASE }));
    expect(verdict).toEqual({ decision: 'denied', reason: 'malformed_command' });
  });

  test('complete without a result code is denied malformed_command', () => {
    const verdict = classifyChannelTaskTransition(claimedTask(), completeCommand({ resultCode: null }));
    expect(verdict).toEqual({ decision: 'denied', reason: 'malformed_command' });
  });

  test('complete with a failure-class result is denied malformed_command', () => {
    const verdict = classifyChannelTaskTransition(claimedTask(), completeCommand({ resultCode: 'provider_outage' }));
    expect(verdict).toEqual({ decision: 'denied', reason: 'malformed_command' });
  });

  test('fail with a success-class result is denied malformed_command', () => {
    const verdict = classifyChannelTaskTransition(claimedTask(), failCommand({ resultCode: 'applied' }));
    expect(verdict).toEqual({ decision: 'denied', reason: 'malformed_command' });
  });

  test('escalate carrying a result code is denied malformed_command', () => {
    const verdict = classifyChannelTaskTransition(claimedTask(), escalateCommand({ resultCode: 'applied' }));
    expect(verdict).toEqual({ decision: 'denied', reason: 'malformed_command' });
  });

  test('an unknown result code value is denied malformed_command', () => {
    const verdict = classifyChannelTaskTransition(claimedTask(), completeCommand({ resultCode: 'LEAK-42' }));
    expect(verdict).toEqual({ decision: 'denied', reason: 'malformed_command' });
  });

  test('renew whose new lease is not strictly after the instant is denied invalid_lease', () => {
    const equalVerdict = classifyChannelTaskTransition(claimedTask(), renewCommand({ leaseExpiresAt: AS_OF_LIVE }));
    expect(equalVerdict).toEqual({ decision: 'denied', reason: 'invalid_lease' });
    const pastVerdict = classifyChannelTaskTransition(
      claimedTask(),
      renewCommand({ leaseExpiresAt: '2026-07-21T10:30:00Z' }),
    );
    expect(pastVerdict).toEqual({ decision: 'denied', reason: 'invalid_lease' });
  });
});

describe('channelTaskLifecycle denial precedence', () => {
  test('a malformed task outranks a malformed command', () => {
    const verdict = classifyChannelTaskTransition(null, null);
    expect(verdict).toEqual({ decision: 'denied', reason: 'malformed_task' });
  });

  test('an unsupported type outranks a wrong capability', () => {
    const verdict = classifyChannelTaskTransition(claimedTask(), renewCommand({ type: 'claim', capability: 'admin' }));
    expect(verdict).toEqual({ decision: 'denied', reason: 'unsupported_command' });
  });

  test('a wrong capability outranks a state conflict', () => {
    const verdict = classifyChannelTaskTransition(
      claimedTask(),
      renewCommand({ capability: 'admin', expectedStatus: 'pending' }),
    );
    expect(verdict).toEqual({ decision: 'denied', reason: 'capability_denied' });
  });

  test('a state conflict outranks a not-lease-holder denial', () => {
    const verdict = classifyChannelTaskTransition(
      claimedTask(),
      renewCommand({ expectedStatus: 'pending', actor: 'worker_2' }),
    );
    expect(verdict).toEqual({ decision: 'denied', reason: 'state_conflict' });
  });

  test('a not-lease-holder denial outranks an expired lease', () => {
    const task = claimedTask({ leaseExpiresAt: '2026-07-21T10:00:00Z' });
    const verdict = classifyChannelTaskTransition(task, releaseCommand({ actor: 'worker_2' }));
    expect(verdict).toEqual({ decision: 'denied', reason: 'not_lease_holder' });
  });
});

describe('channelTaskLifecycle hostile task records', () => {
  test('a proxy task is denied malformed_task', () => {
    const verdict = classifyChannelTaskTransition(new Proxy(claimedTask(), {}), renewCommand());
    expect(verdict).toEqual({ decision: 'denied', reason: 'malformed_task' });
  });

  test('a null-prototype task is denied malformed_task', () => {
    const task = Object.assign(Object.create(null), claimedTask());
    expect(classifyChannelTaskTransition(task, renewCommand()).reason).toBe('malformed_task');
  });

  test('a foreign-prototype task is denied malformed_task', () => {
    class Rec {}
    const task = Object.assign(new Rec(), claimedTask());
    expect(classifyChannelTaskTransition(task, renewCommand()).reason).toBe('malformed_task');
  });

  test('a getter-bearing task is denied and the getter is not invoked', () => {
    let invoked = false;
    const task = claimedTask();
    Object.defineProperty(task, 'status', {
      get() { invoked = true; return 'claimed'; },
      enumerable: true,
      configurable: true,
    });
    expect(classifyChannelTaskTransition(task, renewCommand()).reason).toBe('malformed_task');
    expect(invoked).toBe(false);
  });

  test('a non-enumerable task field is denied malformed_task', () => {
    const task = claimedTask();
    Object.defineProperty(task, 'status', { enumerable: false });
    expect(classifyChannelTaskTransition(task, renewCommand()).reason).toBe('malformed_task');
  });

  test('an inherited task field is denied malformed_task', () => {
    const task = Object.create({ leaseExpiresAt: LEASE });
    Object.assign(task, {
      channelTaskSchemaVersion: 1, taskId: TASK_ID, status: 'claimed', leaseHolder: HOLDER,
    });
    expect(classifyChannelTaskTransition(task, renewCommand()).reason).toBe('malformed_task');
  });

  test('an extra task key is denied malformed_task', () => {
    expect(classifyChannelTaskTransition(claimedTask({ stray: 1 }), renewCommand()).reason).toBe('malformed_task');
  });

  test('a missing task key is denied malformed_task', () => {
    const task = claimedTask();
    delete task.leaseExpiresAt;
    expect(classifyChannelTaskTransition(task, renewCommand()).reason).toBe('malformed_task');
  });

  test('a wrong task version is denied malformed_task', () => {
    expect(classifyChannelTaskTransition(claimedTask({ channelTaskSchemaVersion: 2 }), renewCommand()).reason)
      .toBe('malformed_task');
  });

  test('an unknown task status is denied malformed_task', () => {
    expect(classifyChannelTaskTransition(claimedTask({ status: 'unknown' }), renewCommand()).reason)
      .toBe('malformed_task');
  });

  test('a claimed task with a null holder is incoherent and denied malformed_task', () => {
    expect(classifyChannelTaskTransition(claimedTask({ leaseHolder: null }), renewCommand()).reason)
      .toBe('malformed_task');
  });

  test('a claimed task with a malformed lease expiry is denied malformed_task', () => {
    expect(classifyChannelTaskTransition(claimedTask({ leaseExpiresAt: 'soon' }), renewCommand()).reason)
      .toBe('malformed_task');
  });

  test('a pending task carrying a holder is incoherent and denied malformed_task', () => {
    const task = unheldTask('pending', { leaseHolder: HOLDER });
    expect(classifyChannelTaskTransition(task, renewCommand({ expectedStatus: 'pending' })).reason)
      .toBe('malformed_task');
  });
});

describe('channelTaskLifecycle hostile command records', () => {
  test('a proxy command is denied malformed_command', () => {
    expect(classifyChannelTaskTransition(claimedTask(), new Proxy(renewCommand(), {})).reason)
      .toBe('malformed_command');
  });

  test('a getter-bearing command is denied and the getter is not invoked', () => {
    let invoked = false;
    const command = renewCommand();
    Object.defineProperty(command, 'type', {
      get() { invoked = true; return 'renew'; },
      enumerable: true,
      configurable: true,
    });
    expect(classifyChannelTaskTransition(claimedTask(), command).reason).toBe('malformed_command');
    expect(invoked).toBe(false);
  });

  test('an extra command key is denied malformed_command', () => {
    expect(classifyChannelTaskTransition(claimedTask(), renewCommand({ stray: 1 })).reason)
      .toBe('malformed_command');
  });

  test('a missing command key is denied malformed_command', () => {
    const command = renewCommand();
    delete command.resultCode;
    expect(classifyChannelTaskTransition(claimedTask(), command).reason).toBe('malformed_command');
  });

  test('a wrong command version is denied malformed_command', () => {
    expect(classifyChannelTaskTransition(claimedTask(), renewCommand({ channelTaskSchemaVersion: 2 })).reason)
      .toBe('malformed_command');
  });

  test('an unknown expectedStatus is denied malformed_command', () => {
    expect(classifyChannelTaskTransition(claimedTask(), renewCommand({ expectedStatus: 'bogus' })).reason)
      .toBe('malformed_command');
  });

  test.each([
    ['a spaced actor', 'wor ker'],
    ['an over-long actor', 'w'.repeat(129)],
    ['a non-string actor', 7],
    ['a null actor', null],
  ])('%s is denied malformed_command', (_label, actor) => {
    expect(classifyChannelTaskTransition(claimedTask(), renewCommand({ actor })).reason)
      .toBe('malformed_command');
  });

  test('a malformed asOf is denied malformed_command', () => {
    expect(classifyChannelTaskTransition(claimedTask(), renewCommand({ asOf: '2026-07-21 11:00:00' })).reason)
      .toBe('malformed_command');
  });

  test('a non-null non-timestamp lease is denied malformed_command', () => {
    expect(classifyChannelTaskTransition(claimedTask(), renewCommand({ leaseExpiresAt: 'soon' })).reason)
      .toBe('malformed_command');
  });

  test('an empty command type is denied malformed_command', () => {
    expect(classifyChannelTaskTransition(claimedTask(), renewCommand({ type: '' })).reason)
      .toBe('malformed_command');
  });
});

describe('channelTaskLifecycle determinism, sharing, and non-echo', () => {
  test('identical inputs yield a deep-equal verdict', () => {
    expect(classifyChannelTaskTransition(claimedTask(), completeCommand()))
      .toEqual(classifyChannelTaskTransition(claimedTask(), completeCommand()));
  });

  test('denials are shared frozen singletons', () => {
    const a = classifyChannelTaskTransition(null, null);
    const b = classifyChannelTaskTransition(null, renewCommand());
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  test('a rejected command never echoes its input into the verdict', () => {
    const verdict = classifyChannelTaskTransition(
      claimedTask(),
      renewCommand({ resultCode: 'LEAK-MARKER-7777' }),
    );
    expect(JSON.stringify(verdict)).not.toContain('LEAK-MARKER-7777');
  });

  test('a denial verdict carries exactly a decision and a reason', () => {
    const verdict = classifyChannelTaskTransition(claimedTask(), renewCommand({ actor: 'worker_2' }));
    expect(Object.keys(verdict).sort()).toEqual(['decision', 'reason']);
  });
});

describe('channelTaskLifecycle source boundary', () => {
  const forbiddenApi = [
    ['ambient environment', /process\.env/],
    ['wall clock now', /Date\.now/],
    ['date construction', /new Date/],
    ['randomness', /Math\.random/],
    ['console', /console\./],
    ['fetch', /fetch\(/],
    ['a url scheme', /https?:/],
    ['firebase', /firebase/i],
    ['firestore', /firestore/i],
    ['stripe', /stripe/i],
  ];

  test.each(forbiddenApi)('the code references no %s', (_label, pattern) => {
    expect(pattern.test(sourceCode)).toBe(false);
  });

  const forbiddenVocab = [
    ['phone', /phone/i],
    ['address', /address/i],
    ['dob', /\bdob\b/i],
    ['ssn', /\bssn\b/i],
    ['secret', /secret/i],
    ['token word', /\btoken\b/i],
    ['password', /password/i],
    ['bearer', /bearer/i],
    ['api key', /api[_-]?key/i],
    ['invite', /invite/i],
    ['roster', /roster/i],
  ];

  test.each(forbiddenVocab)('the code names no %s field', (_label, pattern) => {
    expect(pattern.test(sourceCode)).toBe(false);
  });

  test('the module requires only node:util', () => {
    const requires = rawSource.match(/require\(([^)]*)\)/g) || [];
    expect(requires).toEqual(["require('node:util')"]);
  });

  test('the raw source names the issue code in its header', () => {
    expect(rawSource).toContain('CHANNEL-QUEUE-001C');
  });

  test('the functions entrypoint does not import this module', () => {
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toContain('channelTaskLifecycle');
  });
});
