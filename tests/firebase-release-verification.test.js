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

test('accepts an advanced exact Rules source and both expected Functions', async () => {
  const { digestRulesSource, validateBackendState } = await import(SCRIPT_URL);
  const project = 'demo-approved-project';
  const rules = 'rules_version = \'2\';\nservice cloud.firestore { match /databases/{database}/documents {} }\n';
  const digest = digestRulesSource(rules);
  const before = {
    project,
    rules: { rulesetName: `projects/${project}/rulesets/old` },
    functions: {
      createMemberOnSignUp: functionState(project, 'createMemberOnSignUp', {
        updateTime: '2026-07-13T08:00:00Z', versionId: '1', buildId: 'build-1',
      }),
      ensureMemberProfile: null,
    },
  };
  const after = {
    project,
    rules: {
      rulesetName: `projects/${project}/rulesets/new`,
      files: [{ name: 'firestore.rules', digest }],
    },
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
    rules: { rulesetName: `projects/${project}/rulesets/same` },
    functions: {
      createMemberOnSignUp: staleSignup,
      ensureMemberProfile: functionState(project, 'ensureMemberProfile', {
        versionId: '1', buildId: 'build-1', updateTime: '2026-07-13T08:00:00Z',
      }),
    },
  };
  const after = {
    project,
    rules: {
      rulesetName: `projects/${project}/rulesets/same`,
      files: [{ name: 'firestore.rules', digest: 'wrong' }],
    },
    functions: {
      createMemberOnSignUp: staleSignup,
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

test('fails closed when provider readback is incomplete or malformed', async () => {
  const { validateBackendState } = await import(SCRIPT_URL);
  const errors = validateBackendState(
    { project: 'demo-approved-project' },
    {
      project: 'demo-approved-project',
      rules: {
        rulesetName: 'projects/demo-approved-project/rulesets/new',
        files: [{ digest: 'unexpected' }],
      },
    },
    'expected',
  );

  assert.ok(errors.includes('Firestore Rules source does not match the approved commit.'));
  assert.ok(errors.includes('createMemberOnSignUp is unreadable.'));
  assert.ok(errors.includes('ensureMemberProfile is unreadable.'));
});
