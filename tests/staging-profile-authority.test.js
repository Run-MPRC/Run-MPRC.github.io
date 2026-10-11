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

const release = require('../scripts/staging-profile-release');
const releaseWorkflow = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy-staging-profiles.yml'), 'utf8');
const releaseContext = { ...context, GITHUB_WORKFLOW_REF: 'Run-MPRC/Run-MPRC.github.io/.github/workflows/deploy-staging-profiles.yml@refs/heads/main' };
const expectedFunction = (target = 'ensureMemberProfile') => release.functionSpec(target, sha, 'b'.repeat(64), 'https://storage.googleapis.com/synthetic');

test('release context retains all immutable checks and cannot use the verifier workflow', () => {
  release.validateReleaseContext(releaseContext, fingerprint);
  assert.throws(() => release.validateReleaseContext(context, fingerprint));
  for (const [name, value] of Object.entries({ GITHUB_SHA: 'invalid', GITHUB_REF: 'refs/heads/other', GITHUB_WORKFLOW_SHA: 'b'.repeat(40), GITHUB_EVENT_NAME: 'push', TARGET_PROJECT_ID: 'production', TARGET_ENVIRONMENT: 'staging', DEPLOY_SERVICE_ACCOUNT: 'changed', GITHUB_REPOSITORY_ID: '1' })) {
    assert.throws(() => release.validateReleaseContext({ ...releaseContext, [name]: value }, fingerprint));
  }
});

test('deterministic deployment bundle ships no prototype handler, dependencies or private input', () => {
  const entries = release.bundleFiles(ROOT);
  assert.deepEqual(entries.map(([name]) => name), release.FILES);
  assert.ok(!release.FILES.includes('index.js'));
  const before = JSON.parse(fs.readFileSync(path.join(ROOT, 'functions/package.json')));
  const after = JSON.parse(entries.find(([name]) => name === 'package.json')[1]);
  assert.deepEqual(after, { ...before, main: 'profileOnly.js' });
  const source = entries.find(([name]) => name === 'profileOnly.js')[1].toString();
  assert.deepEqual([...source.matchAll(/^exports\.([A-Za-z]+)\s*=/gm)].map((m) => m[1]), release.TARGETS);
  assert.doesNotMatch(source, /require\('\.\/index'\)|stripeWebhook|Checkout|setMemberRole|sendConfirmation/);
  const first = release.createBundle(ROOT);
  const second = release.createBundle(ROOT);
  assert.equal(first.digest, second.digest);
  assert.deepEqual(first.zip, second.zip);
});

test('two first-generation specs use explicit identities, limits and no secrets/commerce', () => {
  assert.throws(() => expectedFunction('stripeWebhook'));
  for (const target of release.TARGETS) {
    const spec = expectedFunction(target);
    assert.equal(spec.runtime, 'nodejs22');
    assert.equal(spec.minInstances, 0);
    assert.equal(spec.maxInstances, 2);
    assert.equal(spec.availableMemoryMb, 256);
    assert.equal(spec.timeout, '30s');
    assert.match(spec.serviceAccountEmail, /^mprc-profile-runtime@run-mprc-staging\./);
    assert.match(spec.buildServiceAccount, /^projects\/run-mprc-staging\/serviceAccounts\/mprc-profile-build@/);
    assert.equal(spec.environmentVariables.COMMERCE_ENABLED, 'false');
    assert.ok(!spec.secretEnvironmentVariables && !spec.secretVolumes);
    if (target === 'ensureMemberProfile') assert.equal(spec.httpsTrigger.securityLevel, 'SECURE_ALWAYS');
    else assert.equal(spec.eventTrigger.resource, 'projects/run-mprc-staging');
  }
  for (const url of ['http://storage.googleapis.com/synthetic', 'https://other.test/synthetic', 'https://user:password@storage.googleapis.com/synthetic', 'https://storage.googleapis.com:444/synthetic']) {
    assert.throws(() => release.functionSpec('ensureMemberProfile', sha, 'b'.repeat(64), url));
  }
});

test('hosted resource readback rejects broad identities, foreign config, missing limits and stale provenance', () => {
  for (const target of release.TARGETS) {
    const expected = expectedFunction(target);
    const actual = { ...expected, status: 'ACTIVE' };
    release.validateHostedFunction(actual, expected);
    const omittedZero = { ...actual }; delete omittedZero.minInstances;
    release.validateHostedFunction(omittedZero, expected);
    for (const [field, value] of Object.entries({ runtime: 'nodejs20', serviceAccountEmail: 'default', buildServiceAccount: 'default', minInstances: 1, maxInstances: undefined, availableMemoryMb: 512, timeout: '540s', status: 'DEPLOY_IN_PROGRESS', secretEnvironmentVariables: [{}], vpcConnector: 'foreign', labels: {}, environmentVariables: { ...expected.environmentVariables, COMMERCE_ENABLED: 'true' } })) {
      assert.throws(() => release.validateHostedFunction({ ...actual, [field]: value }, expected));
    }
    if (target === 'createMemberOnSignUp') {
      release.validateHostedFunction({ ...actual, eventTrigger: { ...expected.eventTrigger, failurePolicy: {} } }, expected);
      for (const failurePolicy of [{ retry: {} }, { unexpected: true }, [], null]) {
        assert.throws(() => release.validateHostedFunction({ ...actual, eventTrigger: { ...expected.eventTrigger, failurePolicy } }, expected));
      }
      assert.throws(() => release.validateHostedFunction({ ...actual, eventTrigger: { ...expected.eventTrigger, resource: 'projects/production' } }, expected));
    }
  }
});

test('runtime/build actAs is checked on exact accounts without accepting key creation', async () => {
  const calls = [];
  await release.validateActAs('synthetic-token', mockFetch([{ permissions: ['iam.serviceAccounts.actAs'] }, { permissions: ['iam.serviceAccounts.actAs'] }], calls));
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ url }) => url.startsWith('https://iam.googleapis.com/v1/projects/run-mprc-staging/serviceAccounts/mprc-profile-')));
  await assert.rejects(release.validateActAs('synthetic-token', mockFetch([{ permissions: [] }])));
  await assert.rejects(release.validateActAs('synthetic-token', mockFetch([{ permissions: ['iam.serviceAccounts.actAs', 'iam.serviceAccountKeys.create'] }])));
});

test('operation polling is bounded, and failed or malformed operations never count as success', async () => {
  let requests = 0;
  await release.waitForOperation({ name: 'operations/synthetic' }, 'synthetic-token', async () => ({ done: ++requests === 2 }), async () => {});
  assert.equal(requests, 2);
  await assert.rejects(release.waitForOperation({ name: 'operations/synthetic' }, 'synthetic-token', async () => ({ done: true, error: { message: 'private provider error' } }), async () => {}));
  await assert.rejects(release.waitForOperation({ name: 'https://other.test' }, 'synthetic-token', async () => ({ done: true }), async () => {}));
  requests = 0;
  await assert.rejects(release.waitForOperation({ name: 'operations/synthetic' }, 'synthetic-token', async () => { requests += 1; return {}; }, async () => {}));
  assert.equal(requests, 90);
});

test('protected release is fixed manual staging-only, pinned and has no credential file or data/payment access', () => {
  assert.match(releaseWorkflow, /\bon:\n  workflow_dispatch:\n/);
  assert.doesNotMatch(releaseWorkflow, /\n  (push|pull_request|schedule):|inputs:|upload-artifact|firebase deploy|gcloud|credentials_json|FIREBASE_TOKEN/);
  assert.match(releaseWorkflow, /environment:\n      name: backend-staging/);
  assert.match(releaseWorkflow, /access_token_lifetime: 1800s/);
  assert.match(releaseWorkflow, /create_credentials_file: false/);
  assert.match(releaseWorkflow, /export_environment_variables: false/);
  assert.ok(releaseWorkflow.indexOf('staging-profile-release.js context') < releaseWorkflow.indexOf('google-github-actions/auth@'));
  for (const action of releaseWorkflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)) assert.match(action[1], /@[0-9a-f]{40}$/);
  const invalid = spawnSync(process.execPath, ['scripts/staging-profile-release.js', 'release'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...context } });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, '');
  assert.equal(invalid.stderr, 'staging_profile_release_failed\n');
});
