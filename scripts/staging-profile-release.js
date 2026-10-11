'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { validateContext, verifyCurrentSource, verifyCloudAuthority } = require('./staging-profile-authority');

const PROJECT = 'run-mprc-staging';
const REGION = 'us-central1';
const WORKFLOW = 'deploy-staging-profiles.yml';
const TARGETS = Object.freeze(['createMemberOnSignUp', 'ensureMemberProfile']);
const FILES = Object.freeze([
  'profileOnly.js', 'signup.js', 'ensureMemberProfile.js', 'memberProfile.js',
  'profileRuntime.js', 'stripeHelpers.js', 'serverConfig.js', 'verifiedRolePolicy.js',
  'package.json', 'package-lock.json',
]);
const BASE = `https://cloudfunctions.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}`;
const runtimeAccount = `mprc-profile-runtime@${PROJECT}.iam.gserviceaccount.com`;
const buildAccount = `projects/${PROJECT}/serviceAccounts/mprc-profile-build@${PROJECT}.iam.gserviceaccount.com`;
const repository = `projects/${PROJECT}/locations/${REGION}/repositories/mprc-profile-artifacts`;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const check = (value) => { if (!value) throw new Error('staging_profile_release_failed'); };

function validateKnownCommunity(actual) {
  // #707 adds one separately released staging-only service. This profile path
  // may inspect it, never update it or load it into the profile bundle.
  const { functionSpec: communitySpec, validateHostedFunction: validateCommunity } = require('./staging-community-release');
  validateCommunity(actual, communitySpec(actual.labels?.['source-sha'],
    `${actual.labels?.['bundle-a']}${actual.labels?.['bundle-b']}`, 'https://storage.googleapis.com/synthetic'));
}

function validateReleaseContext(env, fingerprint) {
  check(env.GITHUB_WORKFLOW_REF === `Run-MPRC/Run-MPRC.github.io/.github/workflows/${WORKFLOW}@refs/heads/main`);
  // Reuse the immutable repo/main/environment/authority and exact-source checks;
  // only the independently checked workflow is different from the read-only job.
  validateContext({ ...env, GITHUB_WORKFLOW_REF: 'Run-MPRC/Run-MPRC.github.io/.github/workflows/verify-staging-profile-authority.yml@refs/heads/main' }, fingerprint);
}

function bundleFiles(root) {
  const entries = FILES.map((name) => {
    const filename = path.join(root, 'functions', name);
    check(fs.lstatSync(filename).isFile() && !fs.lstatSync(filename).isSymbolicLink());
    const content = fs.readFileSync(filename);
    check(content.length < 1000000);
    return [name, content];
  });
  const manifest = JSON.parse(entries.find(([name]) => name === 'package.json')[1]);
  check(manifest.main === 'index.js' && manifest.engines.node === '22');
  manifest.main = 'profileOnly.js';
  // Preserve dependencies and their reviewed lockfile. No new dependency or
  // prototype handler is shipped; Stripe remains an unused helper dependency.
  entries[FILES.indexOf('package.json')][1] = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  return entries;
}

function createBundle(root) {
  const entries = bundleFiles(root);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mprc-profile-stage-'));
  try {
    for (const [name, content] of entries) {
      fs.writeFileSync(path.join(directory, name), content, { flag: 'wx', mode: 0o600 });
      fs.utimesSync(path.join(directory, name), new Date('1980-01-01T00:00:00Z'), new Date('1980-01-01T00:00:00Z'));
    }
    const zip = execFileSync('zip', ['-X', '-q', '-', ...FILES], { cwd: directory, maxBuffer: 2000000 });
    check(zip.length > 0 && zip.length < 1000000);
    return { zip, digest: sha256(zip) };
  } finally {
    // Exact task-owned generated source only; no checkout or user data.
    fs.rmSync(directory, { recursive: true });
  }
}

function functionSpec(target, sourceSha, bundleDigest, uploadUrl) {
  check(TARGETS.includes(target));
  check(/^[0-9a-f]{40}$/.test(sourceSha) && /^[0-9a-f]{64}$/.test(bundleDigest));
  check(typeof uploadUrl === 'string');
  const parsedUpload = new URL(uploadUrl);
  check(parsedUpload.protocol === 'https:' && parsedUpload.hostname === 'storage.googleapis.com'
    && !parsedUpload.username && !parsedUpload.password && !parsedUpload.port);
  return {
    name: `projects/${PROJECT}/locations/${REGION}/functions/${target}`,
    entryPoint: target, runtime: 'nodejs22', serviceAccountEmail: runtimeAccount,
    buildServiceAccount: buildAccount, dockerRegistry: 'ARTIFACT_REGISTRY', dockerRepository: repository,
    sourceUploadUrl: uploadUrl, availableMemoryMb: 256, timeout: '30s', minInstances: 0, maxInstances: 2,
    ingressSettings: 'ALLOW_ALL',
    labels: { 'managed-by': 'mprc-profile-stage', 'source-sha': sourceSha, 'bundle-a': bundleDigest.slice(0, 32), 'bundle-b': bundleDigest.slice(32) },
    environmentVariables: { FIREBASE_CONFIG: JSON.stringify({ projectId: PROJECT }), GCLOUD_PROJECT: PROJECT, ENFORCE_APP_CHECK: 'true', COMMERCE_ENABLED: 'false' },
    ...(target === 'ensureMemberProfile'
      ? { httpsTrigger: { securityLevel: 'SECURE_ALWAYS' } }
      : { eventTrigger: { eventType: 'providers/firebase.auth/eventTypes/user.create', resource: `projects/${PROJECT}`, service: 'firebaseauth.googleapis.com' } }),
  };
}

function validateHostedFunction(actual, expected, { ready = true, previousInitialRelease = false } = {}) {
  check(actual && actual.name === expected.name);
  for (const field of ['entryPoint', 'runtime', 'serviceAccountEmail', 'buildServiceAccount', 'dockerRepository', 'availableMemoryMb', 'timeout', 'maxInstances', 'ingressSettings']) check(actual[field] === expected[field]);
  // Protobuf omits a configured numeric zero, but not other required settings.
  check((actual.minInstances === undefined ? 0 : actual.minInstances) === 0);
  check(actual.labels?.['managed-by'] === 'mprc-profile-stage');
  if (ready) {
    check(actual.status === 'ACTIVE');
    for (const [key, value] of Object.entries(expected.labels)) check(actual.labels[key] === value);
  }
  // Only the exact partial #702 signup release may lack the SDK project
  // context. Admit it for same-bundle repair, never as completed proof.
  const acceptedEnvironment = !ready && previousInitialRelease
    && actual.name.endsWith('/createMemberOnSignUp')
    && actual.labels?.['source-sha'] === '3edffdf51ccef248d83e2c5c8600c3628d2e0ae1'
    && actual.labels?.['bundle-a'] === expected.labels['bundle-a']
    && actual.labels?.['bundle-b'] === expected.labels['bundle-b']
    && actual.environmentVariables?.GCLOUD_PROJECT === undefined
    ? Object.fromEntries(Object.entries(expected.environmentVariables).filter(([key]) => key !== 'GCLOUD_PROJECT'))
    : expected.environmentVariables;
  check(Object.keys(actual.environmentVariables || {}).length === Object.keys(acceptedEnvironment).length
    && Object.entries(acceptedEnvironment).every(([key, value]) => actual.environmentVariables[key] === value));
  check(!actual.secretEnvironmentVariables?.length && !actual.secretVolumes?.length && !actual.vpcConnector);
  if (expected.httpsTrigger) {
    check(actual.httpsTrigger?.securityLevel === 'SECURE_ALWAYS' && !actual.eventTrigger);
  } else {
    check(actual.eventTrigger?.eventType === expected.eventTrigger.eventType && actual.eventTrigger?.resource === expected.eventTrigger.resource && !actual.httpsTrigger);
    // The v1 service also returns an empty FailurePolicy message for no retry.
    // A present retry message, including retry: {}, means retry is enabled.
    const failurePolicy = actual.eventTrigger.failurePolicy;
    check(failurePolicy === undefined || (failurePolicy !== null
      && typeof failurePolicy === 'object' && !Array.isArray(failurePolicy)
      && Object.keys(failurePolicy).length === 0));
  }
}

async function jsonRequest(url, token, method = 'GET', body, fetchImpl = fetch) {
  check(url.startsWith('https://cloudfunctions.googleapis.com/v1/') || url.startsWith('https://iam.googleapis.com/v1/'));
  const response = await fetchImpl(url, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  check(response.ok);
  return response.json();
}

async function validateActAs(token, fetchImpl = fetch) {
  for (const account of [runtimeAccount, buildAccount.split('/serviceAccounts/')[1]]) {
    const result = await jsonRequest(`https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts/${account}:testIamPermissions`, token, 'POST', { permissions: ['iam.serviceAccounts.actAs', 'iam.serviceAccountKeys.create'] }, fetchImpl);
    check(result.permissions?.length === 1 && result.permissions[0] === 'iam.serviceAccounts.actAs');
  }
}

async function waitForOperation(operation, token, request = jsonRequest, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  check(/^operations\/[A-Za-z0-9_\-/]+$/.test(operation.name || ''));
  for (let count = 0; count < 90; count += 1) {
    const result = await request(`https://cloudfunctions.googleapis.com/v1/${operation.name}`, token);
    if (result.done) { check(!result.error); return; }
    await sleep(10000);
  }
  throw new Error('staging_profile_release_failed');
}

async function release(env) {
  validateReleaseContext(env);
  await verifyCurrentSource(env);
  await verifyCloudAuthority(env);
  await validateActAs(env.GCP_ACCESS_TOKEN);
  const bundle = createBundle(path.resolve(__dirname, '..'));
  // Inspect all regions and refuse foreign handlers, pagination or unreachable regions.
  const inventory = await jsonRequest(`https://cloudfunctions.googleapis.com/v1/projects/${PROJECT}/locations/-/functions`, env.GCP_ACCESS_TOKEN);
  check(!inventory.nextPageToken && !inventory.unreachable?.length);
  const existing = inventory.functions || [];
  check(Array.isArray(existing) && existing.length <= 3);
  const community = existing.filter((fn) => fn.entryPoint === 'communityActions');
  check(community.length <= 1);
  community.forEach(validateKnownCommunity);
  for (const fn of existing.filter((item) => item.entryPoint !== 'communityActions')) {
    const target = fn.name?.split('/').at(-1);
    validateHostedFunction(fn, functionSpec(target, env.GITHUB_SHA, bundle.digest, 'https://storage.googleapis.com/synthetic'), { ready: false, previousInitialRelease: true });
  }
  for (const target of TARGETS) {
    await verifyCurrentSource(env); // Recheck immediately before each write.
    const uploaded = await jsonRequest(`${BASE}/functions:generateUploadUrl`, env.GCP_ACCESS_TOKEN, 'POST', {});
    const spec = functionSpec(target, env.GITHUB_SHA, bundle.digest, uploaded.uploadUrl);
    const response = await fetch(uploaded.uploadUrl, { method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'Content-Type': 'application/zip', 'x-goog-content-length-range': '0,104857600' }, body: bundle.zip });
    check(response.ok); // Signed upload URL never receives the cloud access token.
    const prior = existing.find((fn) => fn.name === spec.name);
    const operation = await jsonRequest(prior ? `${BASE}/functions/${target}?updateMask=${Object.keys(spec).filter((key) => key !== 'name').join(',')}` : `${BASE}/functions`, env.GCP_ACCESS_TOKEN, prior ? 'PATCH' : 'POST', spec);
    await waitForOperation(operation, env.GCP_ACCESS_TOKEN);
    validateHostedFunction(await jsonRequest(`${BASE}/functions/${target}`, env.GCP_ACCESS_TOKEN), spec);
    if (target === 'ensureMemberProfile') {
      // Callable transport is public, but SDK Auth/App Check verification is
      // mandatory. Never grant public access to the background trigger.
      const iam = await jsonRequest(`${BASE}/functions/${target}:getIamPolicy`, env.GCP_ACCESS_TOKEN);
      check((iam.bindings || []).every((binding) => binding.role === 'roles/cloudfunctions.invoker' && binding.members?.length === 1 && binding.members[0] === 'allUsers' && !binding.condition));
      const policy = { version: 1, ...(iam.etag ? { etag: iam.etag } : {}), bindings: [{ role: 'roles/cloudfunctions.invoker', members: ['allUsers'] }] };
      await jsonRequest(`${BASE}/functions/${target}:setIamPolicy`, env.GCP_ACCESS_TOKEN, 'POST', { policy });
    }
    process.stdout.write(`staging_profile_${target}_deployed_verified\n`);
  }
  const final = await jsonRequest(`https://cloudfunctions.googleapis.com/v1/projects/${PROJECT}/locations/-/functions`, env.GCP_ACCESS_TOKEN);
  check(final.functions?.length === 2 + community.length && !final.nextPageToken && !final.unreachable?.length);
  if (community.length) {
    const unchanged = final.functions.find((fn) => fn.name === community[0].name);
    validateKnownCommunity(unchanged);
    check(unchanged.versionId === community[0].versionId);
  }
  for (const target of TARGETS) validateHostedFunction(final.functions.find((fn) => fn.name.endsWith(`/${target}`)), functionSpec(target, env.GITHUB_SHA, bundle.digest, 'https://storage.googleapis.com/synthetic'));
  process.stdout.write(`staging_profile_bundle_sha256=${bundle.digest}\n`);
}

async function main() {
  try {
    check(process.argv.length === 3 && ['context', 'release'].includes(process.argv[2]));
    validateReleaseContext(process.env);
    if (process.argv[2] === 'context') {
      await verifyCurrentSource(process.env);
      const number = process.env.WORKLOAD_IDENTITY_PROVIDER.match(/^projects\/([0-9]+)\//)?.[1];
      check(number);
      process.stdout.write(`::add-mask::${number}\nstaging_profile_release_context_verified\n`);
    } else await release(process.env);
  } catch {
    // Do not expose URLs, identities, tokens, provider errors or build logs.
    process.stderr.write('staging_profile_release_failed\n');
    process.exitCode = 1;
  }
}

if (require.main === module) void main();
module.exports = { TARGETS, FILES, validateReleaseContext, bundleFiles, createBundle, functionSpec, validateHostedFunction, validateKnownCommunity, jsonRequest, validateActAs, waitForOperation };
