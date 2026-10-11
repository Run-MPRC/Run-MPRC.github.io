const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { FILES, createBundle, functionSpec, validateHostedFunction } = require('../scripts/staging-community-release');

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
  assert.deepEqual(FILES, ['communityOnly.js', 'communityActions.js', 'membershipCancellationPolicy.json', 'membershipAuthority.js', 'requestValidation.js', 'profileRuntime.js', 'package.json', 'package-lock.json']);
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
