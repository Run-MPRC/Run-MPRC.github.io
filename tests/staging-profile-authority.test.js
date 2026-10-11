'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  contract, REQUIRED_JOBS, validateContext, verifyCurrentSource,
  validatePermissions, verifyCloudAuthority,
} = require('../scripts/staging-profile-authority');

const ROOT = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/verify-staging-profile-authority.yml'), 'utf8');
const script = fs.readFileSync(path.join(ROOT, 'scripts/staging-profile-authority.js'), 'utf8');
const sha = 'a'.repeat(40);
const context = Object.freeze({
  GITHUB_REPOSITORY: 'Run-MPRC/Run-MPRC.github.io',
  GITHUB_REPOSITORY_ID: '718285092',
  GITHUB_REPOSITORY_OWNER_ID: '150727922',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_WORKFLOW_REF: 'Run-MPRC/Run-MPRC.github.io/.github/workflows/verify-staging-profile-authority.yml@refs/heads/main',
  GITHUB_SHA: sha,
  GITHUB_WORKFLOW_SHA: sha,
  TARGET_ENVIRONMENT: 'backend-staging',
  TARGET_PROJECT_ID: 'run-mprc-staging',
  DEPLOY_SERVICE_ACCOUNT: 'synthetic@run-mprc-staging.iam.gserviceaccount.com',
  WORKLOAD_IDENTITY_PROVIDER: 'projects/123456/locations/global/workloadIdentityPools/synthetic/providers/github',
  GH_TOKEN: 'synthetic-github-token',
  GCP_ACCESS_TOKEN: 'synthetic-cloud-token',
});
const fingerprint = createHash('sha256').update(
  `${context.WORKLOAD_IDENTITY_PROVIDER}\n${context.DEPLOY_SERVICE_ACCOUNT}`,
).digest('hex');

function mockFetch(responses, calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    assert.ok(responses.length > 0, 'unexpected request');
    const value = responses.shift();
    return { ok: true, json: async () => value };
  };
}
function sourceResponses() {
  return [
    { object: { sha } },
    { workflow_runs: [{ id: 7, run_number: 10, run_attempt: 1, head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' }] },
    { total_count: 6, jobs: REQUIRED_JOBS.map((name) => ({ name, status: 'completed', conclusion: 'success', steps: [{ name: 'synthetic check', status: 'completed', conclusion: 'success' }] })) },
  ];
}

test('context accepts only the closed immutable manual staging context', () => {
  assert.doesNotThrow(() => validateContext(context, fingerprint));
  for (const [name, value] of Object.entries({
    GITHUB_REPOSITORY: 'different/repository', GITHUB_REPOSITORY_ID: '1',
    GITHUB_REPOSITORY_OWNER_ID: '1', GITHUB_REF: 'refs/heads/other',
    GITHUB_EVENT_NAME: 'push', GITHUB_WORKFLOW_REF: 'other.yml',
    GITHUB_SHA: 'invalid', GITHUB_WORKFLOW_SHA: 'b'.repeat(40),
    TARGET_ENVIRONMENT: 'production', TARGET_PROJECT_ID: 'mid-peninsula-running-club',
    DEPLOY_SERVICE_ACCOUNT: 'different.test', WORKLOAD_IDENTITY_PROVIDER: 'different.test',
  })) {
    assert.throws(() => validateContext({ ...context, [name]: value }, fingerprint));
  }
  for (const name of Object.keys(context).filter((name) => !name.endsWith('TOKEN'))) {
    const missing = { ...context };
    delete missing[name];
    assert.throws(() => validateContext(missing, fingerprint));
  }
  assert.throws(() => validateContext(context), 'synthetic authority cannot match real contract');
});

test('current-main and all six successful jobs are required, using fixed read-only GitHub URLs', async () => {
  const calls = [];
  await verifyCurrentSource(context, mockFetch(sourceResponses(), calls));
  assert.equal(calls.length, 3);
  assert.ok(calls.every(({ url, options }) => url.startsWith('https://api.github.com/repos/Run-MPRC/Run-MPRC.github.io/') && options.method === 'GET' && options.redirect === 'error'));
  const stale = sourceResponses();
  stale[0].object.sha = 'b'.repeat(40);
  const staleCalls = [];
  await assert.rejects(verifyCurrentSource(context, mockFetch(stale, staleCalls)));
  assert.equal(staleCalls.length, 1);
});

test('missing, duplicate, skipped or failed job/step cannot borrow another successful CI result', async () => {
  for (const mutate of [
    (r) => { r[1].workflow_runs[0].conclusion = 'failure'; },
    (r) => { r[1].workflow_runs[0].status = 'in_progress'; },
    (r) => { r[1].workflow_runs[0].head_branch = 'other'; },
    (r) => { r[1].workflow_runs[0].event = 'pull_request'; },
    (r) => { r[1].workflow_runs[0].run_number = 'invalid'; },
    (r) => { r[2].jobs.pop(); },
    (r) => { r[2].jobs.push(r[2].jobs[0]); },
    (r) => { r[2].jobs[0].conclusion = 'skipped'; },
    (r) => { r[2].jobs[0].steps[0].conclusion = 'skipped'; },
    (r) => { r[2].jobs[0].steps = []; },
    (r) => { r[2].total_count = 101; },
  ]) {
    const responses = sourceResponses();
    mutate(responses);
    await assert.rejects(verifyCurrentSource(context, mockFetch(responses)));
  }
});

test('latest failed or pending rerun beats older success; wrong-head runs are ignored', async () => {
  for (const status of ['completed', 'in_progress']) {
    const responses = sourceResponses();
    responses[1].workflow_runs.push({ ...responses[1].workflow_runs[0], id: 8, run_attempt: 2, status, conclusion: status === 'completed' ? 'failure' : null });
    await assert.rejects(verifyCurrentSource(context, mockFetch(responses)));
  }
  const responses = sourceResponses();
  responses[1].workflow_runs.push({ ...responses[1].workflow_runs[0], head_sha: 'b'.repeat(40), run_number: 100, conclusion: 'failure' });
  await verifyCurrentSource(context, mockFetch(responses));
});

test('authority check uses only exact staging metadata and read-only testIamPermissions', async () => {
  const calls = [];
  await verifyCloudAuthority(context, mockFetch([
    { name: 'projects/123456', projectId: 'run-mprc-staging', state: 'ACTIVE' },
    { permissions: contract.permissions },
  ], calls));
  assert.deepEqual(calls.map(({ url, options }) => [url, options.method]), [
    ['https://cloudresourcemanager.googleapis.com/v3/projects/run-mprc-staging', 'GET'],
    ['https://cloudresourcemanager.googleapis.com/v1/projects/run-mprc-staging:testIamPermissions', 'POST'],
  ]);
  assert.deepEqual(JSON.parse(calls[1].options.body).permissions, [...contract.permissions, ...contract.deniedPermissions]);
  for (const invalid of [
    { name: 'projects/123456', projectId: 'production', state: 'ACTIVE' },
    { name: 'invalid', projectId: 'run-mprc-staging', state: 'ACTIVE' },
    { name: 'projects/999999', projectId: 'run-mprc-staging', state: 'ACTIVE' },
    { name: 'projects/123456', projectId: 'run-mprc-staging', state: 'DELETE_REQUESTED' },
  ]) await assert.rejects(verifyCloudAuthority(context, mockFetch([invalid])));
});

test('required deployment permissions present and every prohibited data/admin permission absent', () => {
  validatePermissions({ permissions: [...contract.permissions] });
  for (const missing of contract.permissions) {
    assert.throws(() => validatePermissions({ permissions: contract.permissions.filter((p) => p !== missing) }));
  }
  for (const prohibited of contract.deniedPermissions) {
    assert.throws(() => validatePermissions({ permissions: [...contract.permissions, prohibited] }));
  }
  for (const invalid of [{}, { permissions: null }, { permissions: [null] }, { permissions: [...contract.permissions, 'unexpected'] }]) {
    assert.throws(() => validatePermissions(invalid));
  }
  assert.equal(new Set(contract.permissions).size, contract.permissions.length);
  assert.deepEqual(contract.futureFunctionTargets, ['createMemberOnSignUp', 'ensureMemberProfile']);
});

test('workflow is manual, pinned, separately protected and never deploys or creates a credential file', () => {
  assert.match(workflow, /\bon:\n  workflow_dispatch:\n/);
  assert.doesNotMatch(workflow, /\n  (push|pull_request|schedule):|inputs:/);
  assert.match(workflow, /environment:\n      name: backend-staging/);
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.match(workflow, /access_token_lifetime: 300s/);
  assert.match(workflow, /create_credentials_file: false/);
  assert.match(workflow, /export_environment_variables: false/);
  assert.match(workflow, /persist-credentials: false/);
  for (const action of workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)) assert.match(action[1], /@[0-9a-f]{40}$/);
  assert.ok(workflow.indexOf('staging-profile-authority.js context') < workflow.indexOf('google-github-actions/auth@'));
  assert.doesNotMatch(`${workflow}\n${script}`, /firebase\s+deploy|gcloud\s|credentials_json|FIREBASE_TOKEN|setIamPolicy\(/);
  assert.doesNotMatch(script, /console\.|JSON.stringify\((?:project|permissions|env)\)/);
});

test('CLI rejects invalid context and extra arguments without printing any synthetic credential or locator', () => {
  for (const args of [['context'], ['cloud'], ['context', 'override']]) {
    const result = spawnSync(process.execPath, ['scripts/staging-profile-authority.js', ...args], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...context },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'staging_profile_authority_failed\n');
  }
});
