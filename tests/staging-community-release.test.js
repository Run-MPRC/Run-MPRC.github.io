const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { FILES, createBundle, functionSpec, validateHostedFunction } = require('../scripts/staging-community-release');
test('staging authenticator policy requires existing Identity Platform and no SMS provider', () => {
  const { validateStagingMfa } = require('../scripts/staging-community-release');
  const config = { subtype: 'IDENTITY_PLATFORM', signIn: { email: { enabled: true } }, mfa: { state: 'ENABLED', providerConfigs: [{ state: 'ENABLED', totpProviderConfig: { adjacentIntervals: 1 } }] } };
  assert.doesNotThrow(() => validateStagingMfa(config));
  for (const invalid of [{ ...config, subtype: 'FIREBASE_AUTH' }, { ...config, mfa: { ...config.mfa, enabledProviders: ['PHONE_SMS'] } }, { ...config, mfa: { state: 'DISABLED' } }]) assert.throws(() => validateStagingMfa(invalid));
});

test('owner provider calls name only the staging quota project and retain the host boundary', async () => {
  const { jsonRequest } = require('../scripts/staging-community-release');
  let calls = 0;
  const transport = async (url, options) => {
    calls += 1;
    assert.equal(options.headers['x-goog-user-project'], 'run-mprc-staging');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-only');
    assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ verified: true }) };
  };
  assert.deepEqual(await jsonRequest('https://cloudfunctions.googleapis.com/v1/projects/run-mprc-staging/locations/-/functions', 'synthetic-only', 'GET', undefined, transport), { verified: true });
  await assert.rejects(jsonRequest('https://foreign.invalid/', 'synthetic-only', 'GET', undefined, transport));
  assert.equal(calls, 1);
});

test('bundle is deterministic, bounded and excludes all prototype commerce/PII services', () => {
  const root = path.resolve(__dirname, '..');
  const a = createBundle(root); const b = createBundle(root);
  assert.equal(a.digest, b.digest); assert.ok(a.zip.length < 1_000_000);
  assert.deepEqual(FILES, ['communityOnly.js', 'communityActions.js', 'communityAdministration.js', 'communityDues.js', 'communityDuesAssociation.js', 'membershipManualEvidence.js', 'membershipCancellationPolicy.json', 'membershipAuthority.js', 'requestValidation.js', 'profileRuntime.js', 'package.json', 'package-lock.json']);
  assert.ok(!FILES.includes('index.js') && !FILES.includes('stripeHelpers.js'));
});
test('fixed staging specification and provider readback reject drift', () => {
  const spec = functionSpec('a'.repeat(40), 'b'.repeat(64), 'https://storage.googleapis.com/synthetic');
  assert.ok(spec.name.endsWith('/communityActions') && spec.name.includes('/run-mprc-staging/'));
  assert.equal(spec.serviceAccountEmail, 'mprc-community-runtime@run-mprc-staging.iam.gserviceaccount.com');
  assert.equal(spec.environmentVariables.COMMERCE_ENABLED, 'false');
  const actual = { ...spec, status: 'ACTIVE' };
  assert.doesNotThrow(() => validateHostedFunction(actual, spec));
  for (const change of [{ runtime: 'nodejs20' }, { serviceAccountEmail: 'default' }, { maxInstances: 3 }, { minInstances: 1 }, { secretVolumes: [{}] }, { environmentVariables: { ...spec.environmentVariables, COMMERCE_ENABLED: 'true' } }]) {
    assert.throws(() => validateHostedFunction({ ...actual, ...change }, spec));
  }
});
test('rejects foreign upload destinations or malformed source identities', () => {
  assert.throws(() => functionSpec('a'.repeat(40), 'b'.repeat(64), 'https://foreign.invalid/upload'));
  assert.throws(() => functionSpec('wrong', 'b'.repeat(64), 'https://storage.googleapis.com/synthetic'));
});
test('profile release can inspect only the known isolated service, never deploy it', () => {
  const { validateKnownCommunity, functionSpec: profileSpec } = require('../scripts/staging-profile-release');
  const known = { ...functionSpec('a'.repeat(40), 'b'.repeat(64), 'https://storage.googleapis.com/synthetic'), status: 'ACTIVE' };
  assert.doesNotThrow(() => validateKnownCommunity(known));
  assert.throws(() => validateKnownCommunity({ ...known, serviceAccountEmail: 'default' }));
  assert.throws(() => profileSpec('communityActions', 'a'.repeat(40), 'b'.repeat(64), 'https://storage.googleapis.com/synthetic'));
});
test('Hosting requires the identical deployed Function bundle, not merely a label or newer commit', () => {
  const { validateBundle } = require('../scripts/staging-community-hosting');
  const native = { ...functionSpec('a'.repeat(40), 'b'.repeat(64), 'https://storage.googleapis.com/synthetic'), status: 'ACTIVE' };
  assert.doesNotThrow(() => validateBundle(native, 'b'.repeat(64)));
  assert.throws(() => validateBundle(native, 'c'.repeat(64)));
  assert.throws(() => validateBundle({ ...native, maxInstances: 5 }, 'b'.repeat(64)));
});

function verificationFixture() {
  const bytes = Buffer.from('synthetic-reviewed-archive');
  const digest = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  const sourceSha = 'a'.repeat(40);
  const native = { ...functionSpec(sourceSha, digest, 'https://storage.googleapis.com/synthetic'), status: 'ACTIVE', versionId: '4' };
  const profiles = ['createMemberOnSignUp', 'ensureMemberProfile'].map((entryPoint) => ({
    name: native.name.replace('communityActions', entryPoint), entryPoint, versionId: '1', labels: { 'source-sha': 'c'.repeat(40) },
  }));
  const inventory = { functions: [...profiles, native] };
  const requests = []; const downloads = [];
  const args = {
    token: 'synthetic-token-only', digest, sourceSha, inventory,
    request: async (url, token, method = 'GET', body) => {
      requests.push({ url, token, method, body });
      if (url.endsWith(':getIamPolicy')) return { bindings: [{ role: 'roles/cloudfunctions.invoker', members: ['allUsers'] }] };
      if (url.endsWith(':generateDownloadUrl')) return { downloadUrl: 'https://storage.googleapis.com/synthetic-archive' };
      if (url.endsWith('/locations/-/functions')) return inventory;
      return native;
    },
    fetchImpl: async (url, options) => { downloads.push({ url, options }); return new Response(bytes); },
  };
  return { args, bytes, native, inventory, profiles, requests, downloads };
}

test('read-only native verification checks exact source bytes and leaves deployment/IAM/data untouched', async () => {
  const { verifyDeployment } = require('../scripts/staging-community-release');
  const f = verificationFixture();
  const result = await verifyDeployment(f.args);
  assert.deepEqual(result, { sourceSha: f.args.sourceSha, digest: f.args.digest, bytes: f.bytes.length, version: '4' });
  assert.equal(f.requests.length, 4);
  assert.ok(f.requests.every(({ url, method, body }) => url.startsWith('https://cloudfunctions.googleapis.com/v1/projects/run-mprc-staging/')
    && (method === 'GET' || (method === 'POST' && url.endsWith(':generateDownloadUrl') && JSON.stringify(body) === '{}'))));
  assert.equal(f.downloads.length, 1);
  assert.equal(f.downloads[0].options.headers, undefined); // Signed URL gets no bearer/quota headers.
  assert.equal(f.downloads[0].options.redirect, 'error');
});

test('verification accepts script/docs-only ancestry only with identical archive and explicit provenance proof', async () => {
  const { verifyDeployment } = require('../scripts/staging-community-release');
  const f = verificationFixture(); f.args.sourceSha = 'b'.repeat(40);
  await assert.rejects(verifyDeployment(f.args));
  f.args.verifyProvenance = async (nativeSha) => { assert.equal(nativeSha, 'a'.repeat(40)); return true; };
  assert.equal((await verifyDeployment(f.args)).sourceSha, 'a'.repeat(40));
  f.args.verifyProvenance = async () => false;
  await assert.rejects(verifyDeployment(f.args));
});

test('native verification denies resource/invoker/archive/inventory drift without repair writes', async (t) => {
  const { verifyDeployment } = require('../scripts/staging-community-release');
  const cases = [
    ['inactive', f => { f.native.status = 'DEPLOY_IN_PROGRESS'; }],
    ['runtime', f => { f.native.runtime = 'nodejs20'; }],
    ['source label', f => { f.native.labels['source-sha'] = 'invalid'; }],
    ['digest label', f => { f.native.labels['bundle-a'] = '0'.repeat(32); }],
    ['missing invoker', f => { const read = f.args.request; f.args.request = async (...a) => a[0].endsWith(':getIamPolicy') ? {} : read(...a); }],
    ['conditional invoker', f => { const read = f.args.request; f.args.request = async (...a) => a[0].endsWith(':getIamPolicy') ? { bindings: [{ role: 'roles/cloudfunctions.invoker', members: ['allUsers'], condition: {} }] } : read(...a); }],
    ['extra binding', f => { const read = f.args.request; f.args.request = async (...a) => a[0].endsWith(':getIamPolicy') ? { bindings: [{ role: 'roles/cloudfunctions.invoker', members: ['allUsers'] }, { role: 'roles/owner', members: ['allUsers'] }] } : read(...a); }],
    ['source URL', f => { const read = f.args.request; f.args.request = async (...a) => a[0].endsWith(':generateDownloadUrl') ? { downloadUrl: 'https://foreign.invalid/token-private' } : read(...a); }],
    ['source userinfo', f => { const read = f.args.request; f.args.request = async (...a) => a[0].endsWith(':generateDownloadUrl') ? { downloadUrl: 'https://private@storage.googleapis.com/source' } : read(...a); }],
    ['source port', f => { const read = f.args.request; f.args.request = async (...a) => a[0].endsWith(':generateDownloadUrl') ? { downloadUrl: 'https://storage.googleapis.com:444/source' } : read(...a); }],
    ['archive mismatch', f => { f.args.fetchImpl = async () => new Response('other'); }],
    ['archive failure', f => { f.args.fetchImpl = async () => new Response('private provider body', { status: 403 }); }],
    ['archive oversized', f => { f.args.fetchImpl = async () => new Response(Buffer.alloc(1_000_001)); }],
    ['duplicate inventory', f => { f.inventory.functions[0] = f.inventory.functions[1]; }],
    ['paginated inventory', f => { f.inventory.nextPageToken = 'private-token'; }],
    ['unreachable inventory', f => { f.inventory.unreachable = ['foreign']; }],
    ['missing profile', f => { f.inventory.functions.shift(); }],
    ['foreign profile', f => { f.profiles[0].name = f.profiles[0].name.replace('run-mprc-staging', 'production'); }],
    ['profile changed during verification', f => { const read = f.args.request; f.args.request = async (...a) => a[0].endsWith('/locations/-/functions') ? { functions: f.inventory.functions.map(fn => fn.entryPoint === 'ensureMemberProfile' ? { ...fn, versionId: '2' } : fn) } : read(...a); }],
    ['target changed during verification', f => { const read = f.args.request; f.args.request = async (...a) => a[0].endsWith('/locations/-/functions') ? { functions: f.inventory.functions.map(fn => fn.entryPoint === 'communityActions' ? { ...fn, versionId: '5' } : fn) } : read(...a); }],
  ];
  for (const [name, change] of cases) await t.test(name, async () => {
    const f = verificationFixture(); change(f);
    await assert.rejects(verifyDeployment(f.args));
    assert.ok(f.requests.every(({ url, method }) => method === 'GET' || url.endsWith(':generateDownloadUrl')));
  });
});

test('closed failure phases never echo exceptions, provider bodies, URLs or forged phase fields', async () => {
  const { verifyDeployment, failureMessage } = require('../scripts/staging-community-release');
  const f = verificationFixture();
  f.args.request = async () => { throw new Error('Bearer private-token https://private.invalid/runner-record'); };
  await assert.rejects(verifyDeployment(f.args), error => {
    assert.equal(failureMessage(error), 'staging_community_release_failed phase=function_readback');
    assert.equal(error.message, 'staging_community_release_failed');
    return true;
  });
  assert.equal(failureMessage({ phase: 'private-url', message: 'private-secret' }), 'staging_community_release_failed phase=unknown');
});

test('CLI routes only no-argument deployment or exact verify, rejecting other args before work', async () => {
  const { run, failureMessage } = require('../scripts/staging-community-release');
  const calls = [];
  const driver = async (root, options) => { calls.push({ root, options }); };
  await run([], '/synthetic', driver);
  await run(['verify'], '/synthetic', driver);
  assert.deepEqual(calls, [{ root: '/synthetic', options: { verifyOnly: false } }, { root: '/synthetic', options: { verifyOnly: true } }]);
  for (const args of [['deploy'], ['production'], ['verify', '--force'], ['--project=production']]) {
    await assert.rejects(run(args, '/synthetic', driver), error => failureMessage(error) === 'staging_community_release_failed phase=arguments');
  }
  assert.equal(calls.length, 2);
});

test('completed deployment serializes the actual bundle digest instead of throwing an undefined-variable error', () => {
  const { releaseResult } = require('../scripts/staging-community-release');
  const sha = 'a'.repeat(40); const bundle = { zip: Buffer.from('synthetic-archive'), digest: 'b'.repeat(64) };
  // Reproduce the old final statement without contacting any provider.
  assert.throws(() => require('node:vm').runInNewContext(
    "JSON.stringify({ status: 'staging_community_deployed_verified', sha, digest, bytes: bundle.zip.length })",
    { sha, bundle },
  ), error => error.name === 'ReferenceError' && error.message === 'digest is not defined');
  assert.deepEqual(JSON.parse(JSON.stringify(releaseResult(sha, bundle))), {
    status: 'staging_community_deployed_verified', sha, digest: bundle.digest, bytes: bundle.zip.length,
  });
  assert.throws(() => releaseResult(sha, { ...bundle, digest: 'private-provider-message' }));
  assert.throws(() => releaseResult(sha, { ...bundle, zip: Buffer.alloc(1_000_000) }));
});

test('verification transport refuses deployment/IAM/Auth/data/foreign requests before transport access', async () => {
  const { verificationRequest } = require('../scripts/staging-community-release');
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true, json: async () => ({}) }; };
  const base = 'https://cloudfunctions.googleapis.com/v1/projects/run-mprc-staging/locations/us-central1/functions/communityActions';
  for (const [url, method, body] of [
    [base, 'PATCH', {}], [base + ':setIamPolicy', 'POST', {}],
    [base.replace('/communityActions', ':generateUploadUrl'), 'POST', {}],
    ['https://identitytoolkit.googleapis.com/admin/v2/projects/run-mprc-staging/config?updateMask=mfa', 'PATCH', {}],
    ['https://firestore.googleapis.com/v1/projects/run-mprc-staging/databases/(default)/documents/members/fictional', 'GET'],
    [base.replace('run-mprc-staging', 'production'), 'GET'],
    [base + ':generateDownloadUrl', 'POST', { injection: true }],
    [base, 'GET', {}],
  ]) assert.throws(() => verificationRequest(url, 'synthetic', method, body, fetchImpl));
  assert.equal(calls, 0);
  await verificationRequest(base, 'synthetic', 'GET', undefined, fetchImpl);
  await verificationRequest(base + ':getIamPolicy', 'synthetic', 'GET', undefined, fetchImpl);
  await verificationRequest(base + ':generateDownloadUrl', 'synthetic', 'POST', {}, fetchImpl);
  assert.equal(calls, 3);
});

test('actual CLI rejects extra verify arguments with only a safe phase and no credential work', () => {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/staging-community-release.js'), 'verify', 'private-argument'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'staging_community_release_failed phase=arguments\n');
});
