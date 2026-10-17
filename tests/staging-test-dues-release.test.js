'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const c = require('../scripts/staging-test-dues-contract');
const r = require('../scripts/staging-test-dues-release');
const community = require('../scripts/staging-community-release');
const profile = require('../scripts/staging-profile-release');
const ROOT = path.resolve(__dirname, '..');
const plan = { stripeAccount: 'acct_synthetic', keyVersion: '1', webhookVersion: '2' };
const sha = 'a'.repeat(40); const digest = 'b'.repeat(64);
const spec = target => c.functionSpec(target, sha, digest, 'https://storage.googleapis.com/synthetic', plan);
const native = target => ({ ...spec(target), status: 'ACTIVE', versionId: '1' });
const inventory = () => ({ functions: [
  ...['createMemberOnSignUp', 'ensureMemberProfile'].map(n => ({ ...profile.functionSpec(n, sha, digest, 'https://storage.googleapis.com/synthetic'), status: 'ACTIVE', versionId: '1' })),
  { ...community.functionSpec(sha, digest, 'https://storage.googleapis.com/synthetic'), status: 'ACTIVE', versionId: '7' },
  ...c.TARGETS.map(native),
] });
test('plan allows only an explicit account and immutable versions; secrets never belong in it', () => {
  assert.equal(c.validatePlan(plan), plan);
  for (const p of [null, {}, { ...plan, keyVersion: 'latest' }, { ...plan, keyVersion: '0' }, { ...plan, webhookVersion: 2 }, { ...plan, stripeAccount: 'sk_test_synthetic' }, { ...plan, key: 'sk_test_synthetic' }, { ...plan, project: 'production' }]) assert.throws(() => c.validatePlan(p));
});
test('source archive is deterministic and includes every relative runtime dependency, never legacy entrypoints', () => {
  const a = c.createBundle(ROOT); const b = c.createBundle(ROOT);
  assert.equal(a.digest, b.digest); assert.ok(a.zip.equals(b.zip) && a.zip.length < 1_000_000);
  assert.ok(c.FILES.includes('duesTestOnly.js') && !c.FILES.includes('index.js') && !c.FILES.includes('communityOnly.js'));
  for (const name of c.FILES.filter(n => n.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(ROOT, 'functions', name), 'utf8');
    for (const match of source.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g)) assert.ok(c.FILES.includes(`${match[1]}.js`), `missing relative import from ${name}`);
  }
});
test('exact two-function contract rejects live flags, other identities, secret drift and extra authority', () => {
  for (const target of c.TARGETS) {
    const expected = spec(target); const valid = native(target);
    assert.doesNotThrow(() => c.validateHostedFunction(valid, expected));
    assert.doesNotThrow(() => c.validateKnownDues(valid));
    for (const change of [{ status: 'DEPLOYING' }, { versionId: '' }, { serviceAccountEmail: 'default' }, { minInstances: 1 }, { maxInstances: 3 }, { runtime: 'nodejs20' }, { secretVolumes: [{}] }, { vpcConnector: 'other' }, { eventTrigger: {} }, { environmentVariables: { ...valid.environmentVariables, COMMERCE_ENABLED: 'true' } }, { environmentVariables: { ...valid.environmentVariables, GCLOUD_PROJECT: 'production' } }, { secretEnvironmentVariables: valid.secretEnvironmentVariables.map(s => ({ ...s, version: 'latest' })) }, { secretEnvironmentVariables: [...valid.secretEnvironmentVariables, { key: 'LIVE_KEY' }] }, { labels: { ...valid.labels, extra: 'unknown' } }]) assert.throws(() => c.validateHostedFunction({ ...valid, ...change }, expected));
  }
  assert.throws(() => c.functionSpec('index', sha, digest, 'https://storage.googleapis.com/synthetic', plan));
  assert.throws(() => c.functionSpec(c.TARGETS[0], sha, digest, 'https://storage.googleapis.com.attacker.invalid/upload', plan));
});
test('runtime has exactly six data/auth permissions, no project secret grant and no managed user key', () => {
  const data = { role: { name: c.ROLE, includedPermissions: [...c.PERMISSIONS] }, policy: { bindings: [{ role: c.ROLE, members: [`serviceAccount:${c.RUNTIME}`] }] }, keys: [] };
  assert.doesNotThrow(() => c.validateRuntimeAuthority(data));
  for (const change of [{ keys: [{}] }, { role: { ...data.role, deleted: true } }, { role: { ...data.role, includedPermissions: [...c.PERMISSIONS, 'datastore.entities.delete'] } }, { policy: { bindings: [...data.policy.bindings, { role: 'roles/secretmanager.secretAccessor', members: [`serviceAccount:${c.RUNTIME}`] }] } }, { policy: { bindings: [{ ...data.policy.bindings[0], condition: {} }] } }]) assert.throws(() => c.validateRuntimeAuthority({ ...data, ...change }));
});
test('secret metadata checks only pinned enabled versions and per-secret runtime access', () => {
  for (const project of [c.PROJECT, c.PROJECT_NUMBER]) {
    const secret = { name: `projects/${project}/secrets/${c.SECRETS[0]}`, labels: { 'managed-by': 'mprc-test-dues-stage' } };
    const version = { name: `${secret.name}/versions/1`, state: 'ENABLED' };
    const policy = { bindings: [{ role: 'roles/secretmanager.secretAccessor', members: [`serviceAccount:${c.RUNTIME}`] }] };
    assert.doesNotThrow(() => c.validateSecretMetadata(secret, version, policy, c.SECRETS[0], '1'));
    for (const [s, v, p] of [[{ ...secret, name: 'projects/other/secrets/MPRC_TEST_STRIPE_KEY' }, version, policy], [secret, { ...version, state: 'DISABLED' }, policy], [secret, { ...version, name: `${secret.name}/versions/latest` }, policy], [secret, version, { bindings: [{ ...policy.bindings[0], members: ['allUsers'] }] }], [secret, version, { bindings: [...policy.bindings, policy.bindings[0]] }]]) assert.throws(() => c.validateSecretMetadata(s, v, p, c.SECRETS[0], '1'));
  }
});
test('project-wide secret access for other accounts is not accepted as minimum setup', () => {
  for (const role of ['roles/secretmanager.secretAccessor', 'roles/secretmanager.admin']) {
    const authority = { role: { name: c.ROLE, includedPermissions: [...c.PERMISSIONS] }, policy: { bindings: [{ role: c.ROLE, members: [`serviceAccount:${c.RUNTIME}`] }, { role, members: ['serviceAccount:other@run-mprc-staging.iam.gserviceaccount.com'] }] }, keys: [] };
    assert.throws(() => c.validateRuntimeAuthority(authority));
  }
});
test('transport blocks secret payloads, production, arbitrary fields and all verification writes before fetch', async () => {
  const calls = []; const request = r.requestFor(true, async (...args) => { calls.push(args); return { ok: true, json: async () => ({}) }; });
  for (const [url, method, body] of [
    ['https://secretmanager.googleapis.com/v1/projects/run-mprc-staging/secrets/MPRC_TEST_STRIPE_KEY/versions/1:access', 'GET'],
    ['https://cloudfunctions.googleapis.com/v1/projects/production/locations/us-central1/functions/membershipTestDues', 'GET'],
    [`${c.BASE}/functions/membershipTestDues:setIamPolicy`, 'POST', { policy: { version: 1, bindings: [] } }],
    [`${c.BASE}/functions`, 'POST', spec(c.TARGETS[0])],
    [`${c.BASE}/functions:generateUploadUrl`, 'POST', {}],
    ['https://iam.googleapis.com/v1/projects/run-mprc-staging/serviceAccounts/other:setIamPolicy', 'POST', {}],
  ]) await assert.rejects(request(url, 'synthetic', method, body));
  assert.equal(calls.length, 0);
  await request(`${c.BASE}/functions/membershipTestDues`, 'synthetic');
  await request(`${c.BASE}/functions/membershipTestDues:generateDownloadUrl`, 'synthetic', 'POST', {});
  assert.equal(calls.length, 2); assert.ok(calls.every(([, opts]) => opts.redirect === 'error' && opts.headers['x-goog-user-project'] === c.PROJECT));
  assert.equal(r.allowedRequest(`${c.BASE}/functions`, 'POST', spec(c.TARGETS[0]), false), true);
  assert.equal(r.allowedRequest(`${c.BASE}/functions`, 'POST', { ...spec(c.TARGETS[0]), buildEnvironmentVariables: { OTHER: 'value' } }, false), false);
});
test('inventory requires exact existing services; missing, duplicate, foreign or changed resources stop', () => {
  assert.doesNotThrow(() => r.validateInventory(inventory(), true));
  const base = inventory(); base.functions = base.functions.slice(0, 3); assert.doesNotThrow(() => r.validateInventory(base));
  assert.throws(() => r.validateInventory(base, true));
  for (const mutate of [i => { i.nextPageToken = 'more'; }, i => { i.functions.push(i.functions[0]); }, i => { i.functions[3].name = i.functions[3].name.replace(c.PROJECT, 'production'); }, i => { i.functions[2].entryPoint = 'unknown'; }, i => { i.functions[4].environmentVariables.COMMERCE_ENABLED = 'true'; }]) {
    const changed = inventory(); mutate(changed); assert.throws(() => r.validateInventory(changed));
  }
  const changed = inventory(); changed.functions[0].versionId = '2'; assert.throws(() => r.validateUnchanged(inventory(), changed));
  assert.doesNotThrow(() => r.validateUnchanged(inventory(), inventory()));
});
test('native verification requires both actual archives, exact account/versions, provenance and public transport only', async () => {
  const bytes = Buffer.from('synthetic archive'); const hash = createHash('sha256').update(bytes).digest('hex');
  const data = inventory(); for (const fn of data.functions.slice(3)) fn.labels = { ...fn.labels, 'bundle-a': hash.slice(0, 32), 'bundle-b': hash.slice(32) };
  const args = { inventory: data, plan, digest: hash, sha, token: 'synthetic', request: async url => url.endsWith(':getIamPolicy') ? { bindings: [{ role: 'roles/cloudfunctions.invoker', members: ['allUsers'] }] } : { downloadUrl: 'https://storage.googleapis.com/synthetic' }, fetchImpl: async (_url, opts) => { assert.equal(opts.headers, undefined); return new Response(bytes); } };
  assert.equal((await r.verifyFunctions(args)).length, 2);
  await assert.rejects(r.verifyFunctions({ ...args, digest }));
  await assert.rejects(r.verifyFunctions({ ...args, plan: { ...plan, stripeAccount: 'acct_other' } }));
  await assert.rejects(r.verifyFunctions({ ...args, sha: 'c'.repeat(40) }));
  await assert.rejects(r.verifyFunctions({ ...args, request: async () => ({ bindings: [{ role: 'roles/editor', members: ['allUsers'] }] }) }));
  await assert.rejects(r.verifyFunctions({ ...args, fetchImpl: async () => new Response(Buffer.from('wrong archive')) }));
});
test('CLI rejects malformed invocation without reading credentials and prints only a fixed error', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/staging-test-dues-release.js'), 'deploy', 'private-arg', 'extra'], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, 'staging_test_dues_failed\n');
});
test('ordinary Hosting removes inherited dues availability; explicit mode requires exact staging', () => {
  const { duesEnvironment } = require('../scripts/staging-community-hosting');
  const env = { REACT_APP_TEST_DUES_STAGING: 'true', REACT_APP_FIREBASE_ENVIRONMENT: 'staging', REACT_APP_FIREBASE_PROJECT_ID: c.PROJECT, REACT_APP_COMMUNITY_STAGING: 'true' };
  assert.equal(duesEnvironment(env, null).REACT_APP_TEST_DUES_STAGING, undefined);
  assert.equal(env.REACT_APP_TEST_DUES_STAGING, 'true');
  assert.equal(duesEnvironment(env, plan).REACT_APP_TEST_DUES_STAGING, 'true');
  for (const change of [{ REACT_APP_FIREBASE_ENVIRONMENT: 'production' }, { REACT_APP_FIREBASE_PROJECT_ID: 'other' }, { REACT_APP_COMMUNITY_STAGING: 'false' }]) assert.throws(() => duesEnvironment({ ...env, ...change }, plan));
});
