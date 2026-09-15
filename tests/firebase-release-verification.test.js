'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const SCRIPT_URL = pathToFileURL(path.resolve(
  __dirname,
  '../.github/scripts/verify-firebase-release.mjs',
)).href;

function functionState(project, id, overrides = {}) {
  const isAuthTrigger = id === 'createMemberOnSignUp';
  return {
    id,
    name: `projects/${project}/locations/us-central1/functions/${id}`,
    status: 'ACTIVE',
    entryPoint: id,
    runtime: 'nodejs20',
    minInstances: 0,
    maxInstances: 2,
    availableMemoryMb: 256,
    timeout: '30s',
    updateTime: '2026-07-13T09:00:00Z',
    versionId: '2',
    buildId: 'build-2',
    trigger: isAuthTrigger ? 'event' : 'https',
    eventType: isAuthTrigger
      ? 'providers/firebase.auth/eventTypes/user.create'
      : undefined,
    ...overrides,
  };
}

function rulesState(project, rulesetId, files, overrides = {}) {
  return {
    releaseName: `projects/${project}/releases/cloud.firestore`,
    rulesetName: `projects/${project}/rulesets/${rulesetId}`,
    files,
    ...overrides,
  };
}

test('retains only safe resource settings and records the documented zero-value encoding', async () => {
  const { summarizeFunction } = await import(SCRIPT_URL);
  const id = 'ensureMemberProfile';
  const raw = {
    ...functionState('demo-approved-project', id),
    httpsTrigger: {},
    environmentVariables: { SYNTHETIC_SECRET: 'not-a-real-secret' },
  };
  const summary = summarizeFunction(id, raw);
  assert.equal(summary.minInstances, 0);
  assert.equal(summary.minInstancesReadback, 'explicit');
  assert.equal(summary.maxInstances, 2);
  assert.equal(summary.availableMemoryMb, 256);
  assert.equal(summary.timeout, '30s');
  assert.equal(summary.environmentVariables, undefined);
  assert.equal(summarizeFunction(id, null), null);
  const omittedZero = { ...raw };
  delete omittedZero.minInstances;
  assert.equal(summarizeFunction(id, omittedZero).minInstances, 0);
  assert.equal(summarizeFunction(id, omittedZero).minInstancesReadback, 'proto3-default-zero');
  assert.equal(summarizeFunction(id, { ...raw, minInstances: null }).minInstances, null);
  assert.equal(summarizeFunction(id, { ...raw, minInstances: '0' }).minInstances, '0');
  for (const field of ['maxInstances', 'availableMemoryMb', 'timeout']) {
    const incomplete = { ...raw };
    delete incomplete[field];
    assert.equal(summarizeFunction(id, incomplete)[field], undefined);
  }
});

test('accepts an omitted proto3 minimum only with the remaining complete provider evidence', async () => {
  const { summarizeFunction, validateBackendState } = await import(SCRIPT_URL);
  const project = 'demo-approved-project';
  const digest = 'expected';
  const functions = {};
  for (const id of ['createMemberOnSignUp', 'ensureMemberProfile']) {
    const raw = functionState(project, id);
    delete raw.minInstances;
    if (id === 'createMemberOnSignUp') raw.eventTrigger = { eventType: raw.eventType };
    else raw.httpsTrigger = {};
    functions[id] = summarizeFunction(id, raw);
  }
  const after = {
    project,
    rules: rulesState(project, 'new', [{ name: 'firestore.rules', digest }]),
    functions,
  };
  assert.deepEqual(validateBackendState({ project }, after, digest), []);
  functions.ensureMemberProfile = summarizeFunction('ensureMemberProfile', {});
  assert.ok(validateBackendState({ project }, after, digest)
    .includes('ensureMemberProfile has unverified or different profile resource limits.'));
});

test('requests the default database path but expects its canonical release name', async () => {
  const { firestoreReleaseNames } = await import(SCRIPT_URL);
  assert.deepEqual(firestoreReleaseNames('demo-approved-project'), {
    requestName: 'projects/demo-approved-project/releases/cloud.firestore/(default)',
    canonicalName: 'projects/demo-approved-project/releases/cloud.firestore',
  });
});

test('accepts an advanced exact Rules source and both expected Functions', async () => {
  const { digestRulesSource, validateBackendState } = await import(SCRIPT_URL);
  const project = 'demo-approved-project';
  const rules = 'rules_version = \'2\';\nservice cloud.firestore { match /databases/{database}/documents {} }\n';
  const digest = digestRulesSource(rules);
  const before = {
    project,
    rules: rulesState(project, 'old', [
      { name: 'firestore.rules', digest: 'old' },
    ]),
    functions: {
      createMemberOnSignUp: functionState(project, 'createMemberOnSignUp', {
        updateTime: '2026-07-13T08:00:00Z', versionId: '1', buildId: 'build-1',
      }),
      ensureMemberProfile: null,
    },
  };
  const after = {
    project,
    rules: rulesState(project, 'new', [{ name: 'firestore.rules', digest }]),
    functions: {
      createMemberOnSignUp: functionState(project, 'createMemberOnSignUp'),
      ensureMemberProfile: functionState(project, 'ensureMemberProfile'),
    },
  };

  assert.deepEqual(validateBackendState(before, after, digest), []);
});

test('rejects stale Rules, stale Function revisions, and wrong trigger/runtime state', async () => {
  const { digestRulesSource, validateBackendState } = await import(SCRIPT_URL);
  const project = 'demo-approved-project';
  const digest = digestRulesSource('approved rules\n');
  const staleSignup = functionState(project, 'createMemberOnSignUp', {
    versionId: '1', buildId: 'build-1', updateTime: '2026-07-13T08:00:00Z',
  });
  const before = {
    project,
    rules: rulesState(project, 'same', [
      { name: 'firestore.rules', digest: 'previous-wrong' },
    ]),
    functions: {
      createMemberOnSignUp: staleSignup,
      ensureMemberProfile: functionState(project, 'ensureMemberProfile', {
        versionId: '1', buildId: 'build-1', updateTime: '2026-07-13T08:00:00Z',
      }),
    },
  };
  const after = {
    project,
    rules: rulesState(
      project,
      'same',
      [
        { name: 'firestore.rules', digest: 'wrong' },
        { name: 'backup-firestore.rules', digest },
      ],
    ),
    functions: {
      createMemberOnSignUp: functionState(project, 'createMemberOnSignUp', {
        versionId: '1', buildId: 'build-1', updateTime: '2026-07-13T09:00:00Z',
      }),
      ensureMemberProfile: functionState(project, 'ensureMemberProfile', {
        runtime: 'nodejs18',
        trigger: 'event',
        versionId: '1',
        buildId: 'build-1',
        updateTime: '2026-07-13T08:00:00Z',
      }),
    },
  };

  const errors = validateBackendState(before, after, digest);
  assert.ok(errors.includes('Firestore Rules release did not advance.'));
  assert.ok(errors.includes('Firestore Rules source does not match the approved commit.'));
  assert.ok(errors.includes('createMemberOnSignUp revision did not advance.'));
  assert.ok(errors.includes('ensureMemberProfile has the wrong runtime or entry point.'));
  assert.ok(errors.includes('ensureMemberProfile has the wrong trigger type.'));
  assert.ok(errors.includes('ensureMemberProfile revision did not advance.'));
});

test('accepts an idempotent Rules retry when exact source is already live', async () => {
  const { validateBackendState } = await import(SCRIPT_URL);
  const project = 'demo-approved-project';
  const digest = 'expected';
  const rules = rulesState(project, 'already-live', [
    { name: 'firestore.rules', digest },
  ]);
  const before = {
    project,
    rules,
    functions: {
      createMemberOnSignUp: functionState(project, 'createMemberOnSignUp', {
        versionId: '1', buildId: 'build-1', updateTime: '2026-07-13T08:00:00Z',
      }),
      ensureMemberProfile: functionState(project, 'ensureMemberProfile', {
        versionId: '1', buildId: 'build-1', updateTime: '2026-07-13T08:00:00Z',
      }),
    },
  };
  const after = {
    project,
    rules,
    functions: {
      createMemberOnSignUp: functionState(project, 'createMemberOnSignUp'),
      ensureMemberProfile: functionState(project, 'ensureMemberProfile'),
    },
  };

  assert.deepEqual(validateBackendState(before, after, digest), []);
});

test('rejects missing Function revision evidence', async () => {
  const { validateBackendState } = await import(SCRIPT_URL);
  const project = 'demo-approved-project';
  const digest = 'expected';
  const after = {
    project,
    rules: rulesState(project, 'new', [{ name: 'firestore.rules', digest }]),
    functions: {
      createMemberOnSignUp: functionState(project, 'createMemberOnSignUp', {
        buildId: undefined,
      }),
      ensureMemberProfile: functionState(project, 'ensureMemberProfile'),
    },
  };

  const errors = validateBackendState({ project, functions: {} }, after, digest);
  assert.ok(errors.includes('createMemberOnSignUp revision metadata is unreadable.'));
});

test('rejects missing, malformed or different resource limits on either Function', async () => {
  const { validateBackendState } = await import(SCRIPT_URL);
  const project = 'demo-approved-project';
  const digest = 'expected';
  const invalidLimits = [
    { minInstances: 1 }, { minInstances: undefined }, { minInstances: null },
    { minInstances: '0' }, { maxInstances: undefined }, { maxInstances: 3 },
    { maxInstances: '2' }, { availableMemoryMb: undefined },
    { availableMemoryMb: 512 }, { availableMemoryMb: '256' },
    { timeout: undefined }, { timeout: '540s' }, { timeout: 30 },
  ];

  for (const id of ['createMemberOnSignUp', 'ensureMemberProfile']) {
    for (const limits of invalidLimits) {
      const functions = {
        createMemberOnSignUp: functionState(project, 'createMemberOnSignUp'),
        ensureMemberProfile: functionState(project, 'ensureMemberProfile'),
      };
      functions[id] = functionState(project, id, limits);
      const after = {
        project,
        rules: rulesState(project, 'new', [{ name: 'firestore.rules', digest }]),
        functions,
      };
      assert.deepEqual(validateBackendState({ project }, after, digest), [
        `${id} has unverified or different profile resource limits.`,
      ]);
    }
  }
});

test('fails closed when provider readback is incomplete or malformed', async () => {
  const { validateBackendState } = await import(SCRIPT_URL);
  const errors = validateBackendState(
    { project: 'demo-approved-project' },
    {
      project: 'demo-approved-project',
      rules: {
        releaseName: 'projects/wrong-project/releases/cloud.firestore',
        rulesetName: 'projects/demo-approved-project/rulesets/new',
        files: [{ digest: 'unexpected' }],
      },
    },
    'expected',
  );

  assert.ok(errors.includes(
    'Firestore Rules release has the wrong project or ruleset identity.',
  ));
  assert.ok(errors.includes('Firestore Rules source does not match the approved commit.'));
  assert.ok(errors.includes('createMemberOnSignUp is unreadable.'));
  assert.ok(errors.includes('ensureMemberProfile is unreadable.'));
});

test('rejects readback from a different backend project', async () => {
  const { validateBackendState } = await import(SCRIPT_URL);
  const project = 'demo-other-project';
  const digest = 'expected';
  const after = {
    project,
    rules: rulesState(project, 'new', [{ name: 'firestore.rules', digest }]),
    functions: {
      createMemberOnSignUp: functionState(project, 'createMemberOnSignUp'),
      ensureMemberProfile: functionState(project, 'ensureMemberProfile'),
    },
  };

  const errors = validateBackendState(
    { project: 'demo-approved-project', functions: {} },
    after,
    digest,
  );
  assert.ok(errors.includes(
    'Backend project readback does not match the approved environment.',
  ));
});

test('rejects noncanonical and non-default Firestore response identities', async () => {
  const { validateBackendState } = await import(SCRIPT_URL);
  const project = 'demo-approved-project';
  const digest = 'expected';
  const functions = {
    createMemberOnSignUp: functionState(project, 'createMemberOnSignUp'),
    ensureMemberProfile: functionState(project, 'ensureMemberProfile'),
  };

  for (const releaseName of [
    `projects/${project}/releases/cloud.firestore/(default)`,
    `projects/${project}/releases/cloud.firestore/other`,
  ]) {
    const after = {
      project,
      rules: rulesState(
        project,
        'new',
        [{ name: 'firestore.rules', digest }],
        { releaseName },
      ),
      functions,
    };
    const errors = validateBackendState({ project, functions: {} }, after, digest);
    assert.ok(errors.includes(
      'Firestore Rules release has the wrong project or ruleset identity.',
    ));
  }
});
