const fs = require('fs');
const path = require('path');

const {
  channelTaskSchemaVersion,
  ChannelTaskStatus,
  ClaimDecision,
  ClaimDenialReason,
  CLAIM_CAPABILITY,
  classifyChannelTaskClaim,
} = require('./channelTaskClaim');

// A base pending task and a base valid claim command. Each helper deep-copies
// the frozen literal and applies overrides so a test can perturb one field
// without disturbing the others.
function pendingTask(overrides = {}) {
  return {
    channelTaskSchemaVersion: 1,
    taskId: 'chn.v1.mbr_ABC123.google.7',
    status: 'pending',
    leaseHolder: null,
    leaseExpiresAt: null,
    ...overrides,
  };
}

function claimedTask(overrides = {}) {
  return {
    channelTaskSchemaVersion: 1,
    taskId: 'chn.v1.mbr_ABC123.google.7',
    status: 'claimed',
    leaseHolder: 'worker_A1',
    leaseExpiresAt: '2026-07-21T12:00:00Z',
    ...overrides,
  };
}

function claimCommand(overrides = {}) {
  return {
    channelTaskSchemaVersion: 1,
    type: 'claim',
    expectedStatus: 'pending',
    actor: 'worker_B2',
    capability: 'channel_operator',
    asOf: '2026-07-21T11:00:00Z',
    leaseExpiresAt: '2026-07-21T11:30:00Z',
    ...overrides,
  };
}

// Reclaim scaffolding: a claimed task whose lease has already expired relative
// to the command's asOf.
function expiredClaimedTask(overrides = {}) {
  return claimedTask({ leaseExpiresAt: '2026-07-21T10:00:00Z', ...overrides });
}

const rawSource = fs.readFileSync(path.join(__dirname, 'channelTaskClaim.js'), 'utf8');

// Strip block and line comments so the source-boundary batteries test executable
// code, not the header documentation (which legitimately names excluded field
// categories and the issue code).
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}
const sourceCode = codeOnly(rawSource);

describe('channelTaskClaim frozen versioned surface', () => {
  test('schema version is the frozen revision 1', () => {
    expect(channelTaskSchemaVersion).toBe(1);
  });

  test('module export object is frozen', () => {
    const surface = require('./channelTaskClaim');
    expect(Object.isFrozen(surface)).toBe(true);
  });

  test('status enum is frozen and complete', () => {
    expect(ChannelTaskStatus).toEqual({
      PENDING: 'pending',
      CLAIMED: 'claimed',
      COMPLETED: 'completed',
      FAILED: 'failed',
    });
    expect(Object.isFrozen(ChannelTaskStatus)).toBe(true);
  });

  test('decision enum is frozen and complete', () => {
    expect(ClaimDecision).toEqual({ GRANTED: 'granted', DENIED: 'denied' });
    expect(Object.isFrozen(ClaimDecision)).toBe(true);
  });

  test('denial-reason enum is frozen and complete', () => {
    expect(ClaimDenialReason).toEqual({
      MALFORMED_TASK: 'malformed_task',
      MALFORMED_COMMAND: 'malformed_command',
      UNSUPPORTED_COMMAND: 'unsupported_command',
      CAPABILITY_DENIED: 'capability_denied',
      INVALID_LEASE: 'invalid_lease',
      STATE_CONFLICT: 'state_conflict',
      ALREADY_CLAIMED: 'already_claimed',
      TERMINAL_STATE: 'terminal_state',
    });
    expect(Object.isFrozen(ClaimDenialReason)).toBe(true);
  });

  test('claim capability is the single closed value', () => {
    expect(CLAIM_CAPABILITY).toBe('channel_operator');
  });
});

describe('channelTaskClaim happy-path grant', () => {
  test('a valid claim on a pending task is granted', () => {
    const verdict = classifyChannelTaskClaim(pendingTask(), claimCommand());
    expect(verdict).toEqual({
      decision: 'granted',
      reason: 'claim_granted',
      grant: {
        status: 'claimed',
        leaseHolder: 'worker_B2',
        leaseExpiresAt: '2026-07-21T11:30:00Z',
      },
    });
  });

  test('the grant carries the command actor and the command lease expiry', () => {
    const verdict = classifyChannelTaskClaim(
      pendingTask(),
      claimCommand({ actor: 'operator_ZZ9', leaseExpiresAt: '2026-08-01T00:00:00Z' }),
    );
    expect(verdict.grant.leaseHolder).toBe('operator_ZZ9');
    expect(verdict.grant.leaseExpiresAt).toBe('2026-08-01T00:00:00Z');
  });

  test('the verdict and its grant are frozen', () => {
    const verdict = classifyChannelTaskClaim(pendingTask(), claimCommand());
    expect(Object.isFrozen(verdict)).toBe(true);
    expect(Object.isFrozen(verdict.grant)).toBe(true);
  });

  test('the granted verdict has exactly the decision, reason, and grant keys', () => {
    const verdict = classifyChannelTaskClaim(pendingTask(), claimCommand());
    expect(Object.keys(verdict).sort()).toEqual(['decision', 'grant', 'reason']);
    expect(Object.keys(verdict.grant).sort()).toEqual([
      'leaseExpiresAt',
      'leaseHolder',
      'status',
    ]);
  });
});

describe('channelTaskClaim expired-lease reclaim', () => {
  test('a claimed task whose lease has expired is reclaimable', () => {
    const verdict = classifyChannelTaskClaim(
      expiredClaimedTask(),
      claimCommand({ expectedStatus: 'claimed' }),
    );
    expect(verdict.decision).toBe('granted');
    expect(verdict.grant.leaseHolder).toBe('worker_B2');
  });

  test('reclaim replaces the prior holder with the new actor', () => {
    const verdict = classifyChannelTaskClaim(
      expiredClaimedTask({ leaseHolder: 'worker_OLD' }),
      claimCommand({ expectedStatus: 'claimed', actor: 'worker_NEW' }),
    );
    expect(verdict.grant.leaseHolder).toBe('worker_NEW');
  });

  test('the lease-expiry boundary: asOf exactly at the lease expiry reclaims', () => {
    const verdict = classifyChannelTaskClaim(
      claimedTask({ leaseExpiresAt: '2026-07-21T11:00:00Z' }),
      claimCommand({ expectedStatus: 'claimed', asOf: '2026-07-21T11:00:00Z' }),
    );
    expect(verdict.decision).toBe('granted');
  });

  test('one second before expiry the lease is still live', () => {
    const verdict = classifyChannelTaskClaim(
      claimedTask({ leaseExpiresAt: '2026-07-21T11:00:01Z' }),
      claimCommand({ expectedStatus: 'claimed', asOf: '2026-07-21T11:00:00Z' }),
    );
    expect(verdict).toEqual({ decision: 'denied', reason: 'already_claimed' });
  });
});

describe('channelTaskClaim already_claimed (only one active worker)', () => {
  test('a claim against a live lease is denied', () => {
    const verdict = classifyChannelTaskClaim(
      claimedTask({ leaseExpiresAt: '2026-07-21T12:00:00Z' }),
      claimCommand({ expectedStatus: 'claimed', asOf: '2026-07-21T11:00:00Z' }),
    );
    expect(verdict).toEqual({ decision: 'denied', reason: 'already_claimed' });
  });

  test('even the current lease holder is denied a duplicate live claim', () => {
    const verdict = classifyChannelTaskClaim(
      claimedTask({ leaseHolder: 'worker_A1', leaseExpiresAt: '2026-07-21T12:00:00Z' }),
      claimCommand({ expectedStatus: 'claimed', actor: 'worker_A1', asOf: '2026-07-21T11:00:00Z' }),
    );
    expect(verdict.reason).toBe('already_claimed');
  });
});

describe('channelTaskClaim state_conflict (optimistic concurrency)', () => {
  const mismatches = [
    ['pending task, command expects claimed', pendingTask(), 'claimed'],
    ['pending task, command expects completed', pendingTask(), 'completed'],
    ['pending task, command expects failed', pendingTask(), 'failed'],
    ['claimed task, command expects pending', claimedTask(), 'pending'],
    ['claimed task, command expects completed', claimedTask(), 'completed'],
  ];

  test.each(mismatches)('%s is denied state_conflict', (_label, task, expectedStatus) => {
    const verdict = classifyChannelTaskClaim(
      task,
      claimCommand({ expectedStatus, leaseExpiresAt: '2026-07-21T11:30:00Z' }),
    );
    expect(verdict).toEqual({ decision: 'denied', reason: 'state_conflict' });
  });

  test('a matching expectedStatus does not trip state_conflict', () => {
    const verdict = classifyChannelTaskClaim(
      pendingTask(),
      claimCommand({ expectedStatus: 'pending' }),
    );
    expect(verdict.decision).toBe('granted');
  });
});

describe('channelTaskClaim terminal_state', () => {
  test.each(['completed', 'failed'])('a %s task is never claimable', (status) => {
    const verdict = classifyChannelTaskClaim(
      pendingTask({ status, leaseHolder: null, leaseExpiresAt: null }),
      claimCommand({ expectedStatus: status }),
    );
    expect(verdict).toEqual({ decision: 'denied', reason: 'terminal_state' });
  });
});

describe('channelTaskClaim capability_denied', () => {
  test.each([
    'channel_supervisor',
    'member',
    'channel_operator_admin',
    'operator',
    '',
    'CHANNEL_OPERATOR',
  ])('capability %p that is not the claim capability is denied', (capability) => {
    const verdict = classifyChannelTaskClaim(
      pendingTask(),
      claimCommand({ capability }),
    );
    expect(verdict).toEqual({ decision: 'denied', reason: 'capability_denied' });
  });

  test('a non-string capability is malformed, not merely denied', () => {
    const verdict = classifyChannelTaskClaim(
      pendingTask(),
      claimCommand({ capability: 123 }),
    );
    expect(verdict.reason).toBe('malformed_command');
  });
});

describe('channelTaskClaim unsupported_command', () => {
  test.each([
    'renew',
    'release',
    'complete',
    'fail',
    'escalate',
    'Claim',
    'CLAIM',
    'claim ',
  ])('command type %p that is not exactly a claim is unsupported', (type) => {
    const verdict = classifyChannelTaskClaim(pendingTask(), claimCommand({ type }));
    expect(verdict).toEqual({ decision: 'denied', reason: 'unsupported_command' });
  });

  test('a non-string type is malformed, not merely unsupported', () => {
    const verdict = classifyChannelTaskClaim(pendingTask(), claimCommand({ type: 7 }));
    expect(verdict.reason).toBe('malformed_command');
  });
});

describe('channelTaskClaim invalid_lease', () => {
  test.each([
    ['lease equal to asOf (zero length)', '2026-07-21T11:00:00Z', '2026-07-21T11:00:00Z'],
    ['lease before asOf (already expired)', '2026-07-21T11:00:00Z', '2026-07-21T10:59:59Z'],
  ])('%s is denied invalid_lease', (_label, asOf, leaseExpiresAt) => {
    const verdict = classifyChannelTaskClaim(
      pendingTask(),
      claimCommand({ asOf, leaseExpiresAt }),
    );
    expect(verdict).toEqual({ decision: 'denied', reason: 'invalid_lease' });
  });

  test('a lease one second after asOf is valid', () => {
    const verdict = classifyChannelTaskClaim(
      pendingTask(),
      claimCommand({ asOf: '2026-07-21T11:00:00Z', leaseExpiresAt: '2026-07-21T11:00:01Z' }),
    );
    expect(verdict.decision).toBe('granted');
  });
});

describe('channelTaskClaim denial precedence', () => {
  test('a malformed task outranks a malformed command', () => {
    const verdict = classifyChannelTaskClaim(null, null);
    expect(verdict.reason).toBe('malformed_task');
  });

  test('a malformed command outranks an unsupported type', () => {
    // Valid task; command is malformed (extra key) yet also a non-claim type.
    const verdict = classifyChannelTaskClaim(
      pendingTask(),
      { ...claimCommand({ type: 'renew' }), stray: 1 },
    );
    expect(verdict.reason).toBe('malformed_command');
  });

  test('an unsupported type outranks a denied capability', () => {
    const verdict = classifyChannelTaskClaim(
      pendingTask(),
      claimCommand({ type: 'renew', capability: 'member' }),
    );
    expect(verdict.reason).toBe('unsupported_command');
  });

  test('a denied capability outranks an invalid lease', () => {
    const verdict = classifyChannelTaskClaim(
      pendingTask(),
      claimCommand({ capability: 'member', asOf: '2026-07-21T11:00:00Z', leaseExpiresAt: '2026-07-21T11:00:00Z' }),
    );
    expect(verdict.reason).toBe('capability_denied');
  });

  test('an invalid lease outranks a state conflict', () => {
    const verdict = classifyChannelTaskClaim(
      pendingTask(),
      claimCommand({ expectedStatus: 'claimed', asOf: '2026-07-21T11:00:00Z', leaseExpiresAt: '2026-07-21T11:00:00Z' }),
    );
    expect(verdict.reason).toBe('invalid_lease');
  });

  test('a state conflict outranks terminal-state and already-claimed logic', () => {
    // Task is completed (terminal) but the command expects pending, so the
    // conflict is reported before the terminal branch.
    const verdict = classifyChannelTaskClaim(
      pendingTask({ status: 'completed' }),
      claimCommand({ expectedStatus: 'pending' }),
    );
    expect(verdict.reason).toBe('state_conflict');
  });
});

describe('channelTaskClaim malformed task', () => {
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['a string', 'chn.v1'],
    ['a boolean', true],
    ['an array', [1, 2, 3]],
  ])('a non-object task (%s) is malformed', (_label, task) => {
    expect(classifyChannelTaskClaim(task, claimCommand()).reason).toBe('malformed_task');
  });

  test('an extra own key is malformed', () => {
    expect(classifyChannelTaskClaim(pendingTask({ stray: 1 }), claimCommand()).reason)
      .toBe('malformed_task');
  });

  test('a missing key is malformed', () => {
    const task = pendingTask();
    delete task.status;
    expect(classifyChannelTaskClaim(task, claimCommand()).reason).toBe('malformed_task');
  });

  test('a wrong schema version is malformed', () => {
    expect(classifyChannelTaskClaim(pendingTask({ channelTaskSchemaVersion: 2 }), claimCommand()).reason)
      .toBe('malformed_task');
  });

  test.each([
    ['empty', ''],
    ['too long (257)', `${'a'.repeat(257)}`],
    ['a space', 'chn v1'],
    ['an at sign', 'chn@v1'],
    ['an emoji', 'chn\u{1F600}'],
    ['a non-string', 12345],
  ])('a taskId that is %s is malformed', (_label, taskId) => {
    expect(classifyChannelTaskClaim(pendingTask({ taskId }), claimCommand()).reason)
      .toBe('malformed_task');
  });

  test('a 256-char taskId is accepted', () => {
    const verdict = classifyChannelTaskClaim(
      pendingTask({ taskId: 'a'.repeat(256) }),
      claimCommand(),
    );
    expect(verdict.decision).toBe('granted');
  });

  test.each([
    ['an unknown status', 'archived'],
    ['a non-string status', 3],
    ['a capitalized status', 'Pending'],
  ])('%s is malformed', (_label, status) => {
    expect(classifyChannelTaskClaim(pendingTask({ status }), claimCommand()).reason)
      .toBe('malformed_task');
  });

  test('a claimed task with no lease holder is incoherent and malformed', () => {
    const task = claimedTask({ leaseHolder: null });
    expect(classifyChannelTaskClaim(task, claimCommand({ expectedStatus: 'claimed' })).reason)
      .toBe('malformed_task');
  });

  test('a claimed task with no lease expiry is incoherent and malformed', () => {
    const task = claimedTask({ leaseExpiresAt: null });
    expect(classifyChannelTaskClaim(task, claimCommand({ expectedStatus: 'claimed' })).reason)
      .toBe('malformed_task');
  });

  test('a pending task that still names a lease holder is incoherent and malformed', () => {
    expect(classifyChannelTaskClaim(pendingTask({ leaseHolder: 'worker_A1' }), claimCommand()).reason)
      .toBe('malformed_task');
  });

  test('a pending task that still carries a lease expiry is incoherent and malformed', () => {
    expect(classifyChannelTaskClaim(pendingTask({ leaseExpiresAt: '2026-07-21T12:00:00Z' }), claimCommand()).reason)
      .toBe('malformed_task');
  });

  test('a completed task that still names a lease holder is malformed', () => {
    const task = pendingTask({ status: 'completed', leaseHolder: 'worker_A1', leaseExpiresAt: null });
    expect(classifyChannelTaskClaim(task, claimCommand({ expectedStatus: 'completed' })).reason)
      .toBe('malformed_task');
  });

  test('a claimed task with a bad lease-holder token is malformed', () => {
    const task = claimedTask({ leaseHolder: 'worker A1' });
    expect(classifyChannelTaskClaim(task, claimCommand({ expectedStatus: 'claimed' })).reason)
      .toBe('malformed_task');
  });

  test('a claimed task with a bad lease-expiry timestamp is malformed', () => {
    const task = claimedTask({ leaseExpiresAt: '2026-07-21 12:00:00' });
    expect(classifyChannelTaskClaim(task, claimCommand({ expectedStatus: 'claimed' })).reason)
      .toBe('malformed_task');
  });

  test('a proxy task is malformed and no trap is a decision path', () => {
    const task = new Proxy(pendingTask(), {});
    expect(classifyChannelTaskClaim(task, claimCommand()).reason).toBe('malformed_task');
  });

  test('a null-prototype task is malformed', () => {
    const task = Object.assign(Object.create(null), pendingTask());
    expect(classifyChannelTaskClaim(task, claimCommand()).reason).toBe('malformed_task');
  });

  test('a task on a foreign prototype is malformed', () => {
    class Task {}
    const task = Object.assign(new Task(), pendingTask());
    expect(classifyChannelTaskClaim(task, claimCommand()).reason).toBe('malformed_task');
  });

  test('a getter-bearing task is malformed and its getter is never invoked', () => {
    let invoked = false;
    const task = pendingTask();
    Object.defineProperty(task, 'status', {
      get() { invoked = true; return 'pending'; },
      enumerable: true,
      configurable: true,
    });
    expect(classifyChannelTaskClaim(task, claimCommand()).reason).toBe('malformed_task');
    expect(invoked).toBe(false);
  });

  test('a non-enumerable task property is malformed', () => {
    const task = pendingTask();
    Object.defineProperty(task, 'status', { enumerable: false });
    expect(classifyChannelTaskClaim(task, claimCommand()).reason).toBe('malformed_task');
  });

  test('an inherited key masquerading as a field is malformed', () => {
    const base = { status: 'pending' };
    const task = Object.create(base);
    Object.assign(task, {
      channelTaskSchemaVersion: 1,
      taskId: 'chn.v1.mbr_ABC123.google.7',
      leaseHolder: null,
      leaseExpiresAt: null,
    });
    expect(classifyChannelTaskClaim(task, claimCommand()).reason).toBe('malformed_task');
  });
});

describe('channelTaskClaim malformed command', () => {
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['a string', 'claim'],
    ['an array', ['claim']],
  ])('a non-object command (%s) is malformed', (_label, command) => {
    expect(classifyChannelTaskClaim(pendingTask(), command).reason).toBe('malformed_command');
  });

  test('an extra own key is malformed', () => {
    expect(classifyChannelTaskClaim(pendingTask(), claimCommand({ stray: 1 })).reason)
      .toBe('malformed_command');
  });

  test('a missing key is malformed', () => {
    const command = claimCommand();
    delete command.actor;
    expect(classifyChannelTaskClaim(pendingTask(), command).reason).toBe('malformed_command');
  });

  test('a wrong schema version is malformed', () => {
    expect(classifyChannelTaskClaim(pendingTask(), claimCommand({ channelTaskSchemaVersion: 0 })).reason)
      .toBe('malformed_command');
  });

  test.each([
    ['an unknown expectedStatus', 'archived'],
    ['a non-string expectedStatus', 5],
  ])('%s is malformed', (_label, expectedStatus) => {
    expect(classifyChannelTaskClaim(pendingTask(), claimCommand({ expectedStatus })).reason)
      .toBe('malformed_command');
  });

  test.each([
    ['empty', ''],
    ['too long (129)', 'a'.repeat(129)],
    ['a space', 'worker A'],
    ['a slash', 'worker/A'],
    ['an emoji', 'worker\u{1F642}'],
    ['a non-string', 99],
  ])('an actor that is %s is malformed', (_label, actor) => {
    expect(classifyChannelTaskClaim(pendingTask(), claimCommand({ actor })).reason)
      .toBe('malformed_command');
  });

  test('a 128-char actor is accepted', () => {
    const verdict = classifyChannelTaskClaim(
      pendingTask(),
      claimCommand({ actor: 'a'.repeat(128) }),
    );
    expect(verdict.decision).toBe('granted');
  });

  test.each([
    ['a bad shape', '2026-07-21 11:00:00'],
    ['no Z', '2026-07-21T11:00:00'],
    ['milliseconds', '2026-07-21T11:00:00.000Z'],
    ['month 00', '2026-00-21T11:00:00Z'],
    ['month 13', '2026-13-21T11:00:00Z'],
    ['day 00', '2026-07-00T11:00:00Z'],
    ['day 32', '2026-07-32T11:00:00Z'],
    ['hour 24', '2026-07-21T24:00:00Z'],
    ['minute 60', '2026-07-21T11:60:00Z'],
    ['second 60', '2026-07-21T11:00:60Z'],
    ['a non-string', 1_700_000_000],
  ])('an asOf that is %s is malformed', (_label, asOf) => {
    expect(classifyChannelTaskClaim(pendingTask(), claimCommand({ asOf })).reason)
      .toBe('malformed_command');
  });

  test('a bad leaseExpiresAt timestamp is malformed', () => {
    expect(classifyChannelTaskClaim(pendingTask(), claimCommand({ leaseExpiresAt: 'tomorrow' })).reason)
      .toBe('malformed_command');
  });

  test('a proxy command is malformed', () => {
    const command = new Proxy(claimCommand(), {});
    expect(classifyChannelTaskClaim(pendingTask(), command).reason).toBe('malformed_command');
  });

  test('a null-prototype command is malformed', () => {
    const command = Object.assign(Object.create(null), claimCommand());
    expect(classifyChannelTaskClaim(pendingTask(), command).reason).toBe('malformed_command');
  });

  test('a getter-bearing command is malformed and its getter is never invoked', () => {
    let invoked = false;
    const command = claimCommand();
    Object.defineProperty(command, 'capability', {
      get() { invoked = true; return 'channel_operator'; },
      enumerable: true,
      configurable: true,
    });
    expect(classifyChannelTaskClaim(pendingTask(), command).reason).toBe('malformed_command');
    expect(invoked).toBe(false);
  });

  test('a non-enumerable command property is malformed', () => {
    const command = claimCommand();
    Object.defineProperty(command, 'capability', { enumerable: false });
    expect(classifyChannelTaskClaim(pendingTask(), command).reason).toBe('malformed_command');
  });

  test('an inherited command key masquerading as a field is malformed', () => {
    const base = { capability: 'channel_operator' };
    const command = Object.create(base);
    Object.assign(command, {
      channelTaskSchemaVersion: 1,
      type: 'claim',
      expectedStatus: 'pending',
      actor: 'worker_B2',
      asOf: '2026-07-21T11:00:00Z',
      leaseExpiresAt: '2026-07-21T11:30:00Z',
    });
    expect(classifyChannelTaskClaim(pendingTask(), command).reason).toBe('malformed_command');
  });
});

describe('channelTaskClaim token and timestamp acceptance', () => {
  test.each([
    'worker_B2',
    'a',
    'A-B_C.9',
    'worker.subteam.42',
    'x'.repeat(128),
  ])('an opaque actor %p is accepted', (actor) => {
    expect(classifyChannelTaskClaim(pendingTask(), claimCommand({ actor })).decision)
      .toBe('granted');
  });

  test.each([
    'chn.v1.mbr_ABC123.google.7',
    'a',
    'x'.repeat(256),
  ])('a task identity %p is accepted', (taskId) => {
    expect(classifyChannelTaskClaim(pendingTask({ taskId }), claimCommand()).decision)
      .toBe('granted');
  });

  test.each([
    '2026-01-01T00:00:00Z',
    '2026-12-31T23:59:59Z',
    '2026-07-21T11:00:01Z',
  ])('a valid asOf %p is accepted', (asOf) => {
    expect(classifyChannelTaskClaim(
      pendingTask(),
      claimCommand({ asOf, leaseExpiresAt: '2027-01-01T00:00:00Z' }),
    ).decision).toBe('granted');
  });
});

describe('channelTaskClaim determinism and non-echo', () => {
  test('identical inputs yield a deep-equal verdict', () => {
    const a = classifyChannelTaskClaim(pendingTask(), claimCommand());
    const b = classifyChannelTaskClaim(pendingTask(), claimCommand());
    expect(a).toEqual(b);
  });

  test('a denial verdict carries exactly the decision and reason, nothing from the input', () => {
    const verdict = classifyChannelTaskClaim(
      claimedTask({ leaseExpiresAt: '2026-07-21T12:00:00Z' }),
      claimCommand({ expectedStatus: 'claimed', actor: 'LEAK-MARKER-4242' }),
    );
    expect(Object.keys(verdict).sort()).toEqual(['decision', 'reason']);
    expect(JSON.stringify(verdict)).not.toContain('LEAK-MARKER-4242');
  });

  test('the same denial reason returns the same shared frozen object', () => {
    const a = classifyChannelTaskClaim(null, claimCommand());
    const b = classifyChannelTaskClaim(undefined, claimCommand());
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  test('a denial verdict cannot be mutated', () => {
    const verdict = classifyChannelTaskClaim(null, claimCommand());
    expect(Object.isFrozen(verdict)).toBe(true);
    try { verdict.reason = 'granted'; } catch { /* strict-mode throw is also acceptable */ }
    expect(verdict.reason).toBe('malformed_task');
  });
});

describe('channelTaskClaim source boundary', () => {
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
    expect(rawSource).toContain('CHANNEL-QUEUE-001B');
  });

  test('the functions entrypoint does not import this module', () => {
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toContain('channelTaskClaim');
  });
});
