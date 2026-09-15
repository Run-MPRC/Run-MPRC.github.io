const fs = require('node:fs');
const path = require('node:path');

const {
  socialPostStoreSchemaVersion,
  socialPostAuditSchemaVersion,
  SOCIAL_POST_COLLECTION,
  SOCIAL_POST_AUDIT_COLLECTION,
  SOCIAL_POST_AGGREGATE_TYPE,
  buildSocialPostPersistencePlan,
} = require('./socialPostStore');

// A value that must never be echoed by a rejection or carried into a plan. It
// stands in for the protected content a hostile extra field could smuggle in.
const HOSTILE_CANARY = 'caption=leak; media=https://cdn.example/signed?sig=abc; contact=+12025550123';

const AUTHOR = 'officer_author';
const REVIEWER = 'officer_reviewer_1';
const HASH_V1 = 'hash_v1';
const HASH_V2 = 'hash_v2';
const POST_ID = 'post_abc123';
const SOURCE_REF = 'event_2026_summer_series.r4';
const CORRELATION = 'corr_0001';
const INSTANT = '2026-08-30T15:04:05.000Z';

// A durable record in `draft` with no approval.
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

function approvedRecord(overrides = {}) {
  return record({
    lifecycleStatus: 'approved',
    approvedHash: HASH_V1,
    approverActor: REVIEWER,
    ...overrides,
  });
}

// A canonical valid reducer command. Defaults to a `submit` by the author-editor.
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

// The store envelope the builder consumes.
function envelope(overrides = {}) {
  return {
    socialPostStoreSchemaVersion: 1,
    postId: POST_ID,
    sourceRef: SOURCE_REF,
    expectedRevision: 7,
    correlationId: CORRELATION,
    auditInstant: INSTANT,
    current: record(),
    command: command(),
    ...overrides,
  };
}

function expectDeeplyFrozen(plan) {
  expect(Object.isFrozen(plan)).toBe(true);
  expect(Object.isFrozen(plan.writes)).toBe(true);
  for (const write of plan.writes) {
    expect(Object.isFrozen(write)).toBe(true);
    expect(Object.isFrozen(write.data)).toBe(true);
  }
  if (plan.precondition) expect(Object.isFrozen(plan.precondition)).toBe(true);
}

function expectNoCanary(plan) {
  expect(JSON.stringify(plan)).not.toContain(HOSTILE_CANARY);
}

describe('versioned surface', () => {
  test('schema constants and collection names are stable', () => {
    expect(socialPostStoreSchemaVersion).toBe(1);
    expect(socialPostAuditSchemaVersion).toBe(1);
    expect(SOCIAL_POST_COLLECTION).toBe('socialPosts');
    expect(SOCIAL_POST_AUDIT_COLLECTION).toBe('auditEvents');
    expect(SOCIAL_POST_AGGREGATE_TYPE).toBe('social_post');
  });

  test('the module export is frozen', () => {
    expect(Object.isFrozen(require('./socialPostStore'))).toBe(true);
  });
});

describe('applied transition — plan shape', () => {
  test('a valid submit yields exactly a post update and one appended audit row', () => {
    const plan = buildSocialPostPersistencePlan(envelope());

    expect(plan.committed).toBe(true);
    expect(plan.outcome).toBe('applied');
    expect(plan.reason).toBe('plan_built');
    expect(plan.reducerReason).toBe('transition_applied');
    expect(plan.precondition).toEqual({
      collection: 'socialPosts',
      docId: POST_ID,
      expectedRevision: 7,
    });
    expect(plan.writes).toHaveLength(2);
    expectDeeplyFrozen(plan);
  });

  test('the post write carries only the reducer projection plus the bumped revision', () => {
    const plan = buildSocialPostPersistencePlan(envelope());
    const [postWrite] = plan.writes;

    expect(postWrite).toEqual({
      collection: 'socialPosts',
      docId: POST_ID,
      op: 'update',
      data: {
        socialPostStoreSchemaVersion: 1,
        socialPostSchemaVersion: 1,
        revision: 8,
        lifecycleStatus: 'pending_review',
        payloadHash: HASH_V1,
        approvedHash: null,
        approverActor: null,
      },
    });
  });

  test('the audit write is append-only, keyed by post id and next revision', () => {
    const plan = buildSocialPostPersistencePlan(envelope());
    const auditWrite = plan.writes[1];

    expect(auditWrite.collection).toBe('auditEvents');
    expect(auditWrite.op).toBe('create');
    expect(auditWrite.docId).toBe('social_post_post_abc123_0000000008');
    expect(auditWrite.data).toEqual({
      auditSchemaVersion: 1,
      aggregateType: 'social_post',
      aggregateId: POST_ID,
      sourceRef: SOURCE_REF,
      revision: 8,
      eventType: 'social_post_submitted',
      fromState: 'draft',
      toState: 'pending_review',
      actor: AUTHOR,
      capability: 'officer_editor',
      approvalRecorded: false,
      approvalCleared: false,
      correlationId: CORRELATION,
      auditInstant: INSTANT,
    });
  });

  test('a retried transaction reuses the same audit document id', () => {
    const first = buildSocialPostPersistencePlan(envelope());
    const again = buildSocialPostPersistencePlan(envelope());
    expect(first.writes[1].docId).toBe(again.writes[1].docId);
    expect(first).toEqual(again);
  });
});

describe('applied transition — every command type maps to one audit event type', () => {
  const CASES = [
    ['submit', record(), { type: 'submit', expectedLifecycle: 'draft' }, 'social_post_submitted', 'pending_review'],
    ['edit', record({ lifecycleStatus: 'pending_review' }), {
      type: 'edit', expectedLifecycle: 'pending_review', payloadHash: HASH_V2, capability: 'officer_editor',
    }, 'social_post_edited', 'draft'],
    ['approve', record({ lifecycleStatus: 'pending_review' }), {
      type: 'approve', expectedLifecycle: 'pending_review', payloadHash: HASH_V1, actor: REVIEWER, capability: 'officer_reviewer',
    }, 'social_post_approved', 'approved'],
    ['reject', record({ lifecycleStatus: 'pending_review' }), {
      type: 'reject', expectedLifecycle: 'pending_review', actor: REVIEWER, capability: 'officer_reviewer',
    }, 'social_post_rejected', 'draft'],
    ['schedule', approvedRecord(), {
      type: 'schedule', expectedLifecycle: 'approved', actor: REVIEWER, capability: 'officer_reviewer',
    }, 'social_post_scheduled', 'scheduled'],
    ['begin_publish', approvedRecord({ lifecycleStatus: 'scheduled' }), {
      type: 'begin_publish', expectedLifecycle: 'scheduled', actor: null, capability: 'system_publisher',
    }, 'social_post_publish_started', 'publishing'],
    ['provider_confirmed', approvedRecord({ lifecycleStatus: 'publishing' }), {
      type: 'provider_confirmed', expectedLifecycle: 'publishing', actor: null, capability: 'system_publisher',
    }, 'social_post_publish_confirmed', 'published'],
    ['provider_failed', approvedRecord({ lifecycleStatus: 'publishing' }), {
      type: 'provider_failed', expectedLifecycle: 'publishing', actor: null, capability: 'system_publisher',
    }, 'social_post_publish_failed', 'failed'],
    ['provider_indeterminate', approvedRecord({ lifecycleStatus: 'publishing' }), {
      type: 'provider_indeterminate', expectedLifecycle: 'publishing', actor: null, capability: 'system_publisher',
    }, 'social_post_publish_indeterminate', 'outcome_unknown'],
    ['retry', approvedRecord({ lifecycleStatus: 'failed' }), {
      type: 'retry', expectedLifecycle: 'failed', actor: null, capability: 'system_publisher',
    }, 'social_post_publish_retried', 'scheduled'],
    ['reconciled_published', approvedRecord({ lifecycleStatus: 'outcome_unknown' }), {
      type: 'reconciled_published', expectedLifecycle: 'outcome_unknown', actor: null, capability: 'system_reconciler',
    }, 'social_post_reconciled_published', 'published'],
    ['reconciled_failed', approvedRecord({ lifecycleStatus: 'outcome_unknown' }), {
      type: 'reconciled_failed', expectedLifecycle: 'outcome_unknown', actor: null, capability: 'system_reconciler',
    }, 'social_post_reconciled_failed', 'failed'],
    ['cancel', record({ lifecycleStatus: 'pending_review' }), {
      type: 'cancel', expectedLifecycle: 'pending_review', actor: REVIEWER, capability: 'officer_reviewer',
    }, 'social_post_cancelled', 'cancelled'],
  ];

  test.each(CASES)('%s', (_label, current, commandOverrides, eventType, toState) => {
    const plan = buildSocialPostPersistencePlan(envelope({
      current,
      command: command(commandOverrides),
    }));

    expect(plan.committed).toBe(true);
    expect(plan.writes[0].data.lifecycleStatus).toBe(toState);
    expect(plan.writes[1].data.eventType).toBe(eventType);
    expect(plan.writes[1].data.fromState).toBe(current.lifecycleStatus);
    expect(plan.writes[1].data.toState).toBe(toState);
    expectDeeplyFrozen(plan);
  });
});

describe('approval and edit reflect the reducer verdict', () => {
  test('approve records the approver on the post write and in the audit row', () => {
    const plan = buildSocialPostPersistencePlan(envelope({
      current: record({ lifecycleStatus: 'pending_review' }),
      command: command({
        type: 'approve',
        expectedLifecycle: 'pending_review',
        payloadHash: HASH_V1,
        actor: REVIEWER,
        capability: 'officer_reviewer',
      }),
    }));

    expect(plan.writes[0].data.approvedHash).toBe(HASH_V1);
    expect(plan.writes[0].data.approverActor).toBe(REVIEWER);
    expect(plan.writes[1].data.approvalRecorded).toBe(true);
    expect(plan.writes[1].data.approvalCleared).toBe(false);
  });

  test('editing an approved post mints the new hash and clears the approval', () => {
    const plan = buildSocialPostPersistencePlan(envelope({
      current: approvedRecord(),
      command: command({
        type: 'edit',
        expectedLifecycle: 'approved',
        payloadHash: HASH_V2,
        capability: 'officer_editor',
      }),
    }));

    expect(plan.writes[0].data.lifecycleStatus).toBe('draft');
    expect(plan.writes[0].data.payloadHash).toBe(HASH_V2);
    expect(plan.writes[0].data.approvedHash).toBeNull();
    expect(plan.writes[0].data.approverActor).toBeNull();
    expect(plan.writes[1].data.approvalCleared).toBe(true);
    expect(plan.writes[1].data.approvalRecorded).toBe(false);
  });
});

describe('reducer rejection passes through with no writes', () => {
  const REJECTIONS = [
    ['wrong capability', envelope({
      command: command({ type: 'approve', expectedLifecycle: 'draft', payloadHash: HASH_V1, capability: 'officer_reviewer' }),
    }), 'transition_forbidden'],
    ['state conflict', envelope({
      current: record({ lifecycleStatus: 'pending_review' }),
      command: command({ type: 'submit', expectedLifecycle: 'draft' }),
    }), 'state_conflict'],
    ['stale approval', envelope({
      current: record({ lifecycleStatus: 'pending_review' }),
      command: command({
        type: 'approve', expectedLifecycle: 'pending_review', payloadHash: HASH_V2, actor: REVIEWER, capability: 'officer_reviewer',
      }),
    }), 'stale_approval'],
    ['self approval refused by default', envelope({
      current: record({ lifecycleStatus: 'pending_review' }),
      command: command({
        type: 'approve', expectedLifecycle: 'pending_review', payloadHash: HASH_V1, actor: AUTHOR, capability: 'officer_reviewer',
      }),
    }), 'self_approval_forbidden'],
    ['invalid record', envelope({ current: { bogus: HOSTILE_CANARY } }), 'invalid_record'],
    ['invalid command', envelope({ command: { leaked: HOSTILE_CANARY } }), 'invalid_command'],
  ];

  test.each(REJECTIONS)('%s', (_label, input, reducerReason) => {
    const plan = buildSocialPostPersistencePlan(input);

    expect(plan.committed).toBe(false);
    expect(plan.outcome).toBe('rejected');
    expect(plan.reason).toBe('reducer_rejected');
    expect(plan.reducerReason).toBe(reducerReason);
    expect(plan.precondition).toBeNull();
    expect(plan.writes).toEqual([]);
    expectDeeplyFrozen(plan);
    expectNoCanary(plan);
  });
});

describe('idempotent no-op yields no writes', () => {
  test('cancelling an already-cancelled post is an unchanged no-op', () => {
    const plan = buildSocialPostPersistencePlan(envelope({
      current: record({ lifecycleStatus: 'cancelled' }),
      command: command({ type: 'cancel', expectedLifecycle: 'cancelled', actor: REVIEWER, capability: 'officer_reviewer' }),
    }));

    expect(plan.committed).toBe(false);
    expect(plan.outcome).toBe('unchanged');
    expect(plan.reason).toBe('no_write_needed');
    expect(plan.reducerReason).toBe('same_state_idempotent');
    expect(plan.writes).toEqual([]);
    expect(plan.precondition).toBeNull();
  });
});

describe('store envelope validation', () => {
  const BAD_ENVELOPES = [
    ['not an object', HOSTILE_CANARY],
    ['null', null],
    ['an array', [envelope()]],
    ['wrong store schema version', envelope({ socialPostStoreSchemaVersion: 2 })],
    ['string store schema version', envelope({ socialPostStoreSchemaVersion: '1' })],
    ['empty post id', envelope({ postId: '' })],
    ['post id with a space', envelope({ postId: 'post abc' })],
    ['post id too long', envelope({ postId: `p${'x'.repeat(200)}` })],
    ['empty source ref', envelope({ sourceRef: '' })],
    ['source ref with newline', envelope({ sourceRef: 'event\n1' })],
    ['zero expected revision', envelope({ expectedRevision: 0 })],
    ['negative expected revision', envelope({ expectedRevision: -1 })],
    ['fractional expected revision', envelope({ expectedRevision: 1.5 })],
    ['string expected revision', envelope({ expectedRevision: '7' })],
    ['over-cap expected revision', envelope({ expectedRevision: 1000000001 })],
    ['next revision would overflow the cap', envelope({ expectedRevision: 1000000000 })],
    ['empty correlation id', envelope({ correlationId: '' })],
    ['correlation id with a space', envelope({ correlationId: 'corr 1' })],
    ['non-string audit instant', envelope({ auditInstant: 1756566245000 })],
    ['audit instant with a space', envelope({ auditInstant: '2026-08-30 15:04' })],
    ['audit instant too long', envelope({ auditInstant: `2026${'0'.repeat(80)}` })],
    ['extra key', { ...envelope(), leaked: HOSTILE_CANARY }],
    ['missing key', (() => { const e = envelope(); delete e.correlationId; return e; })()],
  ];

  test.each(BAD_ENVELOPES)('%s is rejected as invalid_store_input with no writes', (_label, input) => {
    const plan = buildSocialPostPersistencePlan(input);

    expect(plan.committed).toBe(false);
    expect(plan.outcome).toBe('rejected');
    expect(plan.reason).toBe('invalid_store_input');
    expect(plan.reducerReason).toBeNull();
    expect(plan.writes).toEqual([]);
    expect(plan.precondition).toBeNull();
    expectDeeplyFrozen(plan);
    expectNoCanary(plan);
  });

  test('a Proxy envelope is rejected without invoking a trap', () => {
    let trapped = false;
    const proxied = new Proxy(envelope(), {
      get(target, prop, receiver) {
        trapped = true;
        return Reflect.get(target, prop, receiver);
      },
    });
    const plan = buildSocialPostPersistencePlan(proxied);
    expect(plan.outcome).toBe('rejected');
    expect(plan.reason).toBe('invalid_store_input');
    expect(trapped).toBe(false);
  });

  test('an accessor-backed envelope key is rejected without invoking the getter', () => {
    let invoked = false;
    const hostile = envelope();
    Object.defineProperty(hostile, 'postId', {
      enumerable: true,
      get() { invoked = true; return POST_ID; },
    });
    const plan = buildSocialPostPersistencePlan(hostile);
    expect(plan.reason).toBe('invalid_store_input');
    expect(invoked).toBe(false);
  });
});

describe('determinism', () => {
  test('identical inputs produce a deep-equal plan', () => {
    const a = buildSocialPostPersistencePlan(envelope());
    const b = buildSocialPostPersistencePlan(envelope());
    expect(a).toEqual(b);
  });

  test('the builder does not mutate its input', () => {
    const input = envelope();
    const snapshot = JSON.parse(JSON.stringify(input));
    buildSocialPostPersistencePlan(input);
    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
  });
});

describe('source boundary — pure, unused, provider-neutral', () => {
  const modulePath = path.join(__dirname, 'socialPostStore.js');
  const source = fs.readFileSync(modulePath, 'utf8');

  function codeOnly(text) {
    return text
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
  }
  const code = codeOnly(source);

  test('requires only node:util and the sibling reducer', () => {
    const requires = [...code.matchAll(/require\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(requires).toEqual(["'node:util'", "'./socialPostState'"]);
  });

  test('is not imported by the functions runtime entry point', () => {
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toContain('socialPostStore');
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
      /\btoken\b/i, /password/i, /bearer/i, /api[_-]?key/i, /caption/i,
    ]) {
      expect(code).not.toMatch(forbidden);
    }
  });
});
