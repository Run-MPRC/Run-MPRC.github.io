const fs = require('node:fs');
const path = require('node:path');

const {
  socialPostSchemaVersion,
  SocialPostLifecycle,
  SocialPostCommandType,
  SocialPostCapability,
  SocialPostSource,
  validateSocialPostRecord,
  classifySocialPostTransition,
} = require('./socialPostState');

// A value that must never be echoed by a rejection. It stands in for the kind
// of protected content a hostile extra field could try to smuggle in.
const HOSTILE_CANARY = 'caption=leak; media=https://cdn.example/signed?sig=abc; contact=+12025550123';

const VERDICT_KEYS = [
  'accepted',
  'outcome',
  'changed',
  'lifecycleStatus',
  'payloadHash',
  'approvedHash',
  'approverActor',
  'approvalRecorded',
  'approvalCleared',
  'reason',
];

const AUTHOR = 'officer_author';
const REVIEWER = 'officer_reviewer_1';
const HASH_V1 = 'hash_v1';
const HASH_V2 = 'hash_v2';

// A durable record in `draft` with no approval. Every record fixture starts here.
function record(overrides = {}) {
  return {
    socialPostSchemaVersion: 1,
    lifecycleStatus: 'draft',
    sourceKind: 'public_event',
    payloadHash: HASH_V1,
    approvedHash: null,
    authorActor: AUTHOR,
    approverActor: null,
    ...overrides,
  };
}

// A durable record that already carries a current approval bound to its payload.
function approvedRecord(overrides = {}) {
  return record({
    lifecycleStatus: 'approved',
    approvedHash: HASH_V1,
    approverActor: REVIEWER,
    ...overrides,
  });
}

// A canonical valid command. Defaults to a `submit` by the author-editor.
function command(overrides = {}) {
  return {
    socialPostSchemaVersion: 1,
    type: 'submit',
    expectedLifecycle: 'draft',
    payloadHash: null,
    actor: AUTHOR,
    capability: 'officer_editor',
    selfApprovalAllowed: false,
    ...overrides,
  };
}

// Build the exact next durable record from a prior record and an applied verdict.
function nextRecord(prev, verdict) {
  return {
    socialPostSchemaVersion: 1,
    lifecycleStatus: verdict.lifecycleStatus,
    sourceKind: prev.sourceKind,
    payloadHash: verdict.payloadHash,
    approvedHash: verdict.approvedHash,
    authorActor: prev.authorActor,
    approverActor: verdict.approverActor,
  };
}

function expectValidRecord(candidate) {
  const result = validateSocialPostRecord(candidate);
  expect(result.accepted).toBe(true);
  return result.projection;
}

function expectInvalidRecord(candidate) {
  const result = validateSocialPostRecord(candidate);
  expect(result.accepted).toBe(false);
  expect(result.status).toBe('rejected');
  expect(result.reasons).toContain('invalid_record');
  expect(result.projection).toBeNull();
}

function expectRejected(current, cmd, reason) {
  const verdict = classifySocialPostTransition(current, cmd);
  expect(verdict.accepted).toBe(false);
  expect(verdict.outcome).toBe('rejected');
  expect(verdict.changed).toBe(false);
  if (reason) expect(verdict.reason).toBe(reason);
  // A rejection never echoes any raw input.
  expect(JSON.stringify(verdict)).not.toContain(HOSTILE_CANARY);
  return verdict;
}

describe('canonical fixtures validate and expose a frozen versioned surface', () => {
  test('the draft and approved fixtures are coherent records', () => {
    expectValidRecord(record());
    expectValidRecord(approvedRecord());
  });

  test('schema version is 1 and every enum is deeply frozen', () => {
    expect(socialPostSchemaVersion).toBe(1);
    for (const e of [SocialPostLifecycle, SocialPostCommandType, SocialPostCapability, SocialPostSource]) {
      expect(Object.isFrozen(e)).toBe(true);
    }
    expect(new Set(Object.values(SocialPostLifecycle))).toEqual(new Set([
      'draft', 'pending_review', 'approved', 'scheduled', 'publishing',
      'published', 'failed', 'outcome_unknown', 'cancelled',
    ]));
    expect(new Set(Object.values(SocialPostSource))).toEqual(new Set(['public_event']));
  });

  test('the module export is frozen', () => {
    expect(Object.isFrozen(require('./socialPostState'))).toBe(true);
  });
});

describe('full approval-gated happy path draft -> published', () => {
  test('a post reaches published only through submit, approve, schedule, begin_publish, confirm', () => {
    let current = record();
    const steps = [
      command({ type: 'submit', expectedLifecycle: 'draft' }),
      command({
        type: 'approve', expectedLifecycle: 'pending_review',
        payloadHash: HASH_V1, actor: REVIEWER, capability: 'officer_reviewer',
      }),
      command({
        type: 'schedule', expectedLifecycle: 'approved',
        actor: REVIEWER, capability: 'officer_reviewer',
      }),
      command({
        type: 'begin_publish', expectedLifecycle: 'scheduled',
        actor: null, capability: 'system_publisher',
      }),
      command({
        type: 'provider_confirmed', expectedLifecycle: 'publishing',
        actor: null, capability: 'system_publisher',
      }),
    ];
    const seen = [];
    for (const step of steps) {
      const verdict = classifySocialPostTransition(current, step);
      expect(verdict.accepted).toBe(true);
      expect(verdict.outcome).toBe('applied');
      expect(Object.isFrozen(verdict)).toBe(true);
      expect(Object.keys(verdict)).toEqual(VERDICT_KEYS);
      current = nextRecord(current, verdict);
      // Every intermediate durable record the reducer produces is itself valid.
      expectValidRecord(current);
      seen.push(current.lifecycleStatus);
    }
    expect(seen).toEqual(['pending_review', 'approved', 'scheduled', 'publishing', 'published']);
    // The published post carries the human approval bound to exactly its payload.
    expect(current.approvedHash).toBe(current.payloadHash);
    expect(current.approverActor).toBe(REVIEWER);
  });

  test('the approve step records approval; only that step sets approvalRecorded', () => {
    const pending = record({ lifecycleStatus: 'pending_review' });
    const verdict = classifySocialPostTransition(pending, command({
      type: 'approve', expectedLifecycle: 'pending_review',
      payloadHash: HASH_V1, actor: REVIEWER, capability: 'officer_reviewer',
    }));
    expect(verdict.approvalRecorded).toBe(true);
    expect(verdict.approvalCleared).toBe(false);
    expect(verdict.approvedHash).toBe(HASH_V1);
    expect(verdict.approverActor).toBe(REVIEWER);
  });

  test('provider results and reconciliation resolve a publishing / unknown post', () => {
    const publishing = approvedRecord({ lifecycleStatus: 'publishing' });
    for (const [type, to] of [
      ['provider_confirmed', 'published'],
      ['provider_failed', 'failed'],
      ['provider_indeterminate', 'outcome_unknown'],
    ]) {
      const verdict = classifySocialPostTransition(publishing, command({
        type, expectedLifecycle: 'publishing', actor: null, capability: 'system_publisher',
      }));
      expect(verdict.outcome).toBe('applied');
      expect(verdict.lifecycleStatus).toBe(to);
    }
    const unknown = approvedRecord({ lifecycleStatus: 'outcome_unknown' });
    for (const [type, to] of [['reconciled_published', 'published'], ['reconciled_failed', 'failed']]) {
      const verdict = classifySocialPostTransition(unknown, command({
        type, expectedLifecycle: 'outcome_unknown', actor: null, capability: 'system_reconciler',
      }));
      expect(verdict.lifecycleStatus).toBe(to);
    }
    const failed = approvedRecord({ lifecycleStatus: 'failed' });
    const retry = classifySocialPostTransition(failed, command({
      type: 'retry', expectedLifecycle: 'failed', actor: null, capability: 'system_publisher',
    }));
    expect(retry.lifecycleStatus).toBe('scheduled');
  });
});

describe('transition matrix — every lifecycle state against every command', () => {
  const CAPABILITY_FOR = {
    submit: 'officer_editor',
    edit: 'officer_editor',
    approve: 'officer_reviewer',
    reject: 'officer_reviewer',
    schedule: 'officer_reviewer',
    cancel: 'officer_reviewer',
    begin_publish: 'system_publisher',
    provider_confirmed: 'system_publisher',
    provider_failed: 'system_publisher',
    provider_indeterminate: 'system_publisher',
    retry: 'system_publisher',
    reconciled_published: 'system_reconciler',
    reconciled_failed: 'system_reconciler',
  };
  const SYSTEM_TYPES = new Set([
    'begin_publish', 'provider_confirmed', 'provider_failed', 'provider_indeterminate',
    'retry', 'reconciled_published', 'reconciled_failed',
  ]);
  // The one target state each command enters, used to check applied transitions.
  const TARGET = {
    submit: 'pending_review', edit: 'draft', approve: 'approved', reject: 'draft',
    schedule: 'scheduled', begin_publish: 'publishing', provider_confirmed: 'published',
    provider_failed: 'failed', provider_indeterminate: 'outcome_unknown', retry: 'scheduled',
    reconciled_published: 'published', reconciled_failed: 'failed', cancel: 'cancelled',
  };
  const ALLOWED_FROM = {
    submit: ['draft'],
    edit: ['draft', 'pending_review', 'approved', 'scheduled'],
    approve: ['pending_review'],
    reject: ['pending_review'],
    schedule: ['approved'],
    begin_publish: ['scheduled'],
    provider_confirmed: ['publishing'],
    provider_failed: ['publishing'],
    provider_indeterminate: ['publishing'],
    retry: ['failed'],
    reconciled_published: ['outcome_unknown'],
    reconciled_failed: ['outcome_unknown'],
    cancel: ['draft', 'pending_review', 'approved', 'scheduled', 'failed', 'outcome_unknown'],
  };
  const UNAPPROVED = new Set(['draft', 'pending_review']);

  function canonicalRecord(state) {
    if (UNAPPROVED.has(state) || state === 'cancelled') {
      return record({ lifecycleStatus: state });
    }
    return approvedRecord({ lifecycleStatus: state });
  }

  function canonicalCommand(type, state) {
    const system = SYSTEM_TYPES.has(type);
    let payloadHash = null;
    if (type === 'edit') payloadHash = HASH_V2;
    else if (type === 'approve') payloadHash = HASH_V1;
    return command({
      type,
      expectedLifecycle: state,
      payloadHash,
      actor: system ? null : (type === 'approve' ? REVIEWER : AUTHOR),
      capability: CAPABILITY_FOR[type],
      selfApprovalAllowed: false,
    });
  }

  const states = Object.values(SocialPostLifecycle);
  const types = Object.values(SocialPostCommandType);

  test('applies exactly the allowed edges and forbids every other', () => {
    let applied = 0;
    let forbidden = 0;
    for (const state of states) {
      for (const type of types) {
        const verdict = classifySocialPostTransition(canonicalRecord(state), canonicalCommand(type, state));
        // The one idempotent exception: cancel on an already-cancelled post.
        if (type === 'cancel' && state === 'cancelled') {
          expect(verdict.outcome).toBe('unchanged');
          expect(verdict.reason).toBe('same_state_idempotent');
          continue;
        }
        if (ALLOWED_FROM[type].includes(state)) {
          expect(verdict.outcome).toBe('applied');
          expect(verdict.lifecycleStatus).toBe(TARGET[type]);
          applied += 1;
        } else {
          expect(verdict.outcome).toBe('rejected');
          expect(verdict.reason).toBe('transition_forbidden');
          forbidden += 1;
        }
      }
    }
    // 9 states x 13 commands = 117; minus the 1 idempotent cancel.
    expect(applied + forbidden).toBe(116);
    expect(applied).toBe(
      Object.values(ALLOWED_FROM).reduce((n, from) => n + from.length, 0),
    );
  });
});

describe('approval binding and invalidation', () => {
  test('an edit mints a new payload hash and clears any approval', () => {
    const verdict = classifySocialPostTransition(approvedRecord(), command({
      type: 'edit', expectedLifecycle: 'approved', payloadHash: HASH_V2,
      actor: AUTHOR, capability: 'officer_editor',
    }));
    expect(verdict.outcome).toBe('applied');
    expect(verdict.lifecycleStatus).toBe('draft');
    expect(verdict.payloadHash).toBe(HASH_V2);
    expect(verdict.approvedHash).toBeNull();
    expect(verdict.approverActor).toBeNull();
    expect(verdict.approvalCleared).toBe(true);
  });

  test('after an edit, the post cannot be scheduled or published until re-approved', () => {
    const edited = nextRecord(approvedRecord(), classifySocialPostTransition(approvedRecord(), command({
      type: 'edit', expectedLifecycle: 'approved', payloadHash: HASH_V2,
      actor: AUTHOR, capability: 'officer_editor',
    })));
    expect(edited.lifecycleStatus).toBe('draft');
    expect(edited.approvedHash).toBeNull();
    // Scheduling requires the `approved` state, which the edited draft is not in.
    expectRejected(edited, command({
      type: 'schedule', expectedLifecycle: 'draft', actor: REVIEWER, capability: 'officer_reviewer',
    }), 'transition_forbidden');
    // A re-approval must name the NEW payload hash.
    const reapprove = classifySocialPostTransition(
      record({ lifecycleStatus: 'pending_review', payloadHash: HASH_V2 }),
      command({
        type: 'approve', expectedLifecycle: 'pending_review', payloadHash: HASH_V2,
        actor: REVIEWER, capability: 'officer_reviewer',
      }),
    );
    expect(reapprove.approvedHash).toBe(HASH_V2);
  });

  test('an edit must supply a new, different payload hash', () => {
    expectRejected(approvedRecord(), command({
      type: 'edit', expectedLifecycle: 'approved', payloadHash: HASH_V1, // unchanged
      actor: AUTHOR, capability: 'officer_editor',
    }), 'invalid_command');
    expectRejected(approvedRecord(), command({
      type: 'edit', expectedLifecycle: 'approved', payloadHash: null,
      actor: AUTHOR, capability: 'officer_editor',
    }), 'invalid_command');
  });

  test('approving a hash that is not the current payload is a stale approval', () => {
    expectRejected(record({ lifecycleStatus: 'pending_review' }), command({
      type: 'approve', expectedLifecycle: 'pending_review', payloadHash: 'hash_v0',
      actor: REVIEWER, capability: 'officer_reviewer',
    }), 'stale_approval');
  });
});

describe('self-approval is an explicit owner policy', () => {
  const pending = () => record({ lifecycleStatus: 'pending_review' });
  const selfApprove = (selfApprovalAllowed) => command({
    type: 'approve', expectedLifecycle: 'pending_review', payloadHash: HASH_V1,
    actor: AUTHOR, capability: 'officer_reviewer', selfApprovalAllowed,
  });

  test('the author approving their own post is forbidden by default', () => {
    expectRejected(pending(), selfApprove(false), 'self_approval_forbidden');
  });

  test('self-approval succeeds only when the owner policy explicitly allows it', () => {
    const verdict = classifySocialPostTransition(pending(), selfApprove(true));
    expect(verdict.outcome).toBe('applied');
    expect(verdict.approverActor).toBe(AUTHOR);
  });

  test('a different reviewer is never affected by the self-approval policy', () => {
    const verdict = classifySocialPostTransition(pending(), command({
      type: 'approve', expectedLifecycle: 'pending_review', payloadHash: HASH_V1,
      actor: REVIEWER, capability: 'officer_reviewer', selfApprovalAllowed: false,
    }));
    expect(verdict.outcome).toBe('applied');
  });
});

describe('no publish without a current approval (record invariant)', () => {
  const POST_APPROVAL = ['approved', 'scheduled', 'publishing', 'published', 'failed', 'outcome_unknown'];

  test.each(POST_APPROVAL)('a %s record with no approval is invalid', (lifecycleStatus) => {
    expectInvalidRecord(record({ lifecycleStatus, approvedHash: null, approverActor: null }));
  });

  test.each(POST_APPROVAL)('a %s record whose approval does not match its payload is invalid', (lifecycleStatus) => {
    // A stale stored approval (approvedHash != payloadHash) is unrepresentable.
    expectInvalidRecord(approvedRecord({ lifecycleStatus, payloadHash: HASH_V2, approvedHash: HASH_V1 }));
  });

  test('a pre-approval state that carries an approval is invalid', () => {
    expectInvalidRecord(record({ lifecycleStatus: 'draft', approvedHash: HASH_V1, approverActor: REVIEWER }));
    expectInvalidRecord(record({ lifecycleStatus: 'pending_review', approvedHash: HASH_V1, approverActor: REVIEWER }));
  });

  test('approval hash and approver actor must travel together', () => {
    expectInvalidRecord(approvedRecord({ approverActor: null }));
    expectInvalidRecord(record({ lifecycleStatus: 'approved', approvedHash: null, approverActor: REVIEWER }));
  });

  test('every scheduled/publishing/published record that validates carries a matching approval', () => {
    for (const lifecycleStatus of ['scheduled', 'publishing', 'published']) {
      const projection = expectValidRecord(approvedRecord({ lifecycleStatus }));
      expect(projection.approvedHash).toBe(projection.payloadHash);
      expect(projection.approverActor).not.toBeNull();
    }
  });
});

describe('scoped verified identity (capabilities)', () => {
  test('a human command presenting a system capability is forbidden', () => {
    expectRejected(record(), command({
      type: 'submit', expectedLifecycle: 'draft', actor: AUTHOR, capability: 'system_publisher',
    }), 'capability_forbidden');
  });

  test('a system command presenting an actor (client identity) is forbidden', () => {
    expectRejected(approvedRecord({ lifecycleStatus: 'scheduled' }), command({
      type: 'begin_publish', expectedLifecycle: 'scheduled', actor: AUTHOR, capability: 'system_publisher',
    }), 'capability_forbidden');
  });

  test('an officer capability outside the command scope is forbidden', () => {
    // Only editors may submit; a reviewer capability cannot.
    expectRejected(record(), command({
      type: 'submit', expectedLifecycle: 'draft', actor: AUTHOR, capability: 'officer_reviewer',
    }), 'capability_forbidden');
    // Only the system publisher may begin publishing; an admin cannot.
    expectRejected(approvedRecord({ lifecycleStatus: 'scheduled' }), command({
      type: 'begin_publish', expectedLifecycle: 'scheduled', actor: null, capability: 'officer_admin',
    }), 'capability_forbidden');
  });

  test('the officer_admin capability may act on both editor and reviewer edges', () => {
    expect(classifySocialPostTransition(record(), command({
      type: 'submit', expectedLifecycle: 'draft', actor: AUTHOR, capability: 'officer_admin',
    })).outcome).toBe('applied');
    expect(classifySocialPostTransition(record({ lifecycleStatus: 'pending_review' }), command({
      type: 'approve', expectedLifecycle: 'pending_review', payloadHash: HASH_V1,
      actor: REVIEWER, capability: 'officer_admin',
    })).outcome).toBe('applied');
  });

  test('reconciliation requires the reconciler capability, not the publisher', () => {
    expectRejected(approvedRecord({ lifecycleStatus: 'outcome_unknown' }), command({
      type: 'reconciled_published', expectedLifecycle: 'outcome_unknown',
      actor: null, capability: 'system_publisher',
    }), 'capability_forbidden');
  });
});

describe('optimistic concurrency and cancellation races', () => {
  test('a command formed against a stale lifecycle is a conflict', () => {
    // The caller believes the post is still a draft, but it has advanced.
    expectRejected(record({ lifecycleStatus: 'pending_review' }), command({
      type: 'submit', expectedLifecycle: 'draft', actor: AUTHOR, capability: 'officer_editor',
    }), 'state_conflict');
  });

  test('a duplicate approve after the post advanced is a conflict, not a re-approval', () => {
    expectRejected(approvedRecord(), command({
      type: 'approve', expectedLifecycle: 'pending_review', payloadHash: HASH_V1,
      actor: REVIEWER, capability: 'officer_reviewer',
    }), 'state_conflict');
  });

  test('cancelling an in-flight publishing post is forbidden', () => {
    expectRejected(approvedRecord({ lifecycleStatus: 'publishing' }), command({
      type: 'cancel', expectedLifecycle: 'publishing', actor: REVIEWER, capability: 'officer_reviewer',
    }), 'transition_forbidden');
  });

  test('cancelling an already-cancelled post is an idempotent no-op', () => {
    const verdict = classifySocialPostTransition(record({ lifecycleStatus: 'cancelled' }), command({
      type: 'cancel', expectedLifecycle: 'cancelled', actor: REVIEWER, capability: 'officer_reviewer',
    }));
    expect(verdict.accepted).toBe(true);
    expect(verdict.outcome).toBe('unchanged');
    expect(verdict.changed).toBe(false);
    expect(verdict.reason).toBe('same_state_idempotent');
    expect(verdict.lifecycleStatus).toBe('cancelled');
  });

  test('a cancel racing against a state it did not expect is a conflict', () => {
    expectRejected(record({ lifecycleStatus: 'cancelled' }), command({
      type: 'cancel', expectedLifecycle: 'scheduled', actor: REVIEWER, capability: 'officer_reviewer',
    }), 'state_conflict');
  });

  test('cancel is allowed from every non-terminal, non-publishing state', () => {
    for (const state of ['draft', 'pending_review', 'approved', 'scheduled', 'failed', 'outcome_unknown']) {
      const current = ['draft', 'pending_review'].includes(state)
        ? record({ lifecycleStatus: state })
        : approvedRecord({ lifecycleStatus: state });
      const verdict = classifySocialPostTransition(current, command({
        type: 'cancel', expectedLifecycle: state, actor: REVIEWER, capability: 'officer_reviewer',
      }));
      expect(verdict.outcome).toBe('applied');
      expect(verdict.lifecycleStatus).toBe('cancelled');
    }
  });
});

describe('only a public-event source may become a post', () => {
  test('a record whose source is not a public event is rejected', () => {
    for (const sourceKind of ['membership', 'discount', 'whatsapp', 'strava', 'internal']) {
      expectInvalidRecord(record({ sourceKind }));
    }
  });

  test('the only accepted source is the public event', () => {
    expect(Object.values(SocialPostSource)).toEqual(['public_event']);
  });
});

describe('durable record validation — malformed and hostile input', () => {
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', HOSTILE_CANARY],
    ['a number', 7],
    ['an array', [HOSTILE_CANARY]],
  ])('rejects a non-object record (%s)', (_label, value) => {
    expectInvalidRecord(value);
  });

  test('rejects an extra or missing key', () => {
    expectInvalidRecord(record({ leaked: HOSTILE_CANARY }));
    const short = record();
    delete short.approverActor;
    expectInvalidRecord(short);
  });

  test('rejects the wrong schema version and unknown enum values', () => {
    expectInvalidRecord(record({ socialPostSchemaVersion: 2 }));
    expectInvalidRecord(record({ lifecycleStatus: 'deleted' }));
  });

  test('rejects a Proxy without tripping its traps', () => {
    const proxy = new Proxy(record(), { get() { throw new Error('trap must not run'); } });
    expectInvalidRecord(proxy);
  });

  test('rejects an accessor-backed field without invoking the getter', () => {
    let invoked = false;
    const hostile = record();
    delete hostile.payloadHash;
    Object.defineProperty(hostile, 'payloadHash', {
      enumerable: true, configurable: true,
      get() { invoked = true; return HOSTILE_CANARY; },
    });
    expectInvalidRecord(hostile);
    expect(invoked).toBe(false);
  });

  test('rejects a non-enumerable own field and inherited fields', () => {
    const hostile = record();
    const value = hostile.authorActor;
    delete hostile.authorActor;
    Object.defineProperty(hostile, 'authorActor', {
      value, enumerable: false, writable: true, configurable: true,
    });
    expectInvalidRecord(hostile);
    expectInvalidRecord(Object.create(record()));
    expectInvalidRecord(Object.assign(Object.create(null), record()));
  });
});

describe('command validation — malformed and hostile input', () => {
  const validCurrent = () => record();

  test('an unparseable command is rejected without echo', () => {
    for (const bad of [null, undefined, 7, 'x', [HOSTILE_CANARY]]) {
      expectRejected(validCurrent(), bad, 'invalid_command');
    }
  });

  test('rejects an extra command key, wrong version, or unknown type', () => {
    expectRejected(validCurrent(), command({ leaked: HOSTILE_CANARY }), 'invalid_command');
    expectRejected(validCurrent(), command({ socialPostSchemaVersion: 2 }), 'invalid_command');
    expectRejected(validCurrent(), command({ type: 'nuke' }), 'invalid_command');
  });

  test('rejects a non-boolean selfApprovalAllowed and an unknown capability', () => {
    expectRejected(validCurrent(), command({ selfApprovalAllowed: 'yes' }), 'invalid_command');
    expectRejected(validCurrent(), command({ capability: 'root' }), 'invalid_command');
  });

  test('a non-edit, non-approve command carrying a payload hash is rejected', () => {
    expectRejected(validCurrent(), command({
      type: 'submit', expectedLifecycle: 'draft', payloadHash: HASH_V1,
      actor: AUTHOR, capability: 'officer_editor',
    }), 'invalid_command');
  });

  test('a rejection reflects the current record and never echoes the command', () => {
    const verdict = expectRejected(validCurrent(), command({ leaked: HOSTILE_CANARY }), 'invalid_command');
    expect(verdict.lifecycleStatus).toBe('draft');
    expect(Object.isFrozen(verdict)).toBe(true);
  });

  test('an invalid current record short-circuits to invalid_record', () => {
    const verdict = classifySocialPostTransition({ bogus: HOSTILE_CANARY }, command());
    expect(verdict.reason).toBe('invalid_record');
    expect(verdict.lifecycleStatus).toBeNull();
    expect(JSON.stringify(verdict)).not.toContain(HOSTILE_CANARY);
  });
});

describe('source boundary — pure, unused, provider-neutral', () => {
  const modulePath = path.join(__dirname, 'socialPostState.js');
  const source = fs.readFileSync(modulePath, 'utf8');

  // The code-behavior batteries below assert on executable code, not prose. The
  // module's header legitimately names its issue tracker (an Instagram epic) and
  // documents the very fields it deliberately excludes ("never a name, email,
  // address..."). Those words are allowed in comments but must never appear in
  // the CODE — which is exactly what stripping comments first lets us enforce.
  function codeOnly(text) {
    return text
      .replace(/\/\*[\s\S]*?\*\//g, ' ')      // block comments
      .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');  // line comments, never a URL's //
  }
  const code = codeOnly(source);

  test('comment stripping preserves code and removes prose', () => {
    expect(code).toContain('classifySocialPostTransition');
    expect(code).toContain('module.exports');
    expect(code).toContain('immutableEnum');
    const sample = codeOnly("keep(); // drop instagram\n/* drop address */ more();");
    expect(sample).toContain('keep()');
    expect(sample).toContain('more()');
    expect(sample).not.toMatch(/instagram/i);
    expect(sample).not.toMatch(/address/i);
  });

  test('is not imported by the functions runtime entry point', () => {
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toContain('socialPostState');
  });

  test('requires only node:util', () => {
    const requires = [...code.matchAll(/require\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(requires).toEqual(["'node:util'"]);
  });

  test('reads no clock, randomness, environment, network, or provider surface', () => {
    for (const forbidden of [
      /process\.env/, /Date\.now/, /new Date/, /Math\.random/, /console\./,
      /fetch\(/, /https?:/, /firebase/i, /firestore/i, /stripe/i,
    ]) {
      expect(code).not.toMatch(forbidden);
    }
  });

  test('the executable surface names no concrete social provider', () => {
    expect(code).not.toMatch(/instagram/i);
    expect(code).not.toMatch(/facebook/i);
  });

  test('the executable surface carries no PII or credential vocabulary', () => {
    for (const forbidden of [
      /phone/i, /address/i, /\bdob\b/i, /\bssn\b/i, /secret/i,
      /\btoken\b/i, /password/i, /bearer/i, /api[_-]?key/i,
    ]) {
      expect(code).not.toMatch(forbidden);
    }
  });

  test('hard-codes the approval-gated posture and the single public-event source', () => {
    expect(source).toContain("immutableEnum(['public_event'])");
    expect(source).toContain('self_approval_forbidden');
    expect(source).toContain('stale_approval');
  });
});
