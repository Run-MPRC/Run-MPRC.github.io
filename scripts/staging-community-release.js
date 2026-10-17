'use strict';

// Owner-approved, fixed one-Function staging deployment. No credential file,
// production target, Firebase prototype index, or provider/payment secret.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { jsonRequest: providerRequest, waitForOperation } = require('./staging-profile-release');
const { verifyCurrentSource } = require('./staging-profile-authority');
const { TARGETS: DUES_TARGETS, validateKnownDues } = require('./staging-test-dues-contract');
const PROJECT = 'run-mprc-staging';
const TARGET = 'communityActions';
const REGION = 'us-central1';
const BASE = `https://cloudfunctions.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}`;
const ACCOUNT = 'runmprc@gmail.com';
const RUNTIME = `mprc-community-runtime@${PROJECT}.iam.gserviceaccount.com`;
const FILES = ['communityOnly.js', 'communityActions.js', 'communityAdministration.js', 'communityDues.js', 'communityDuesAssociation.js', 'fictionalRaceService.js', 'fictionalRaceTransitions.js', 'membershipManualEvidence.js', 'membershipCancellationPolicy.json', 'membershipAuthority.js', 'requestValidation.js', 'profileRuntime.js', 'package.json', 'package-lock.json'];
const check = (value) => { if (!value) throw new Error('staging_community_release_failed'); };
const PHASES = new Set(['arguments', 'source', 'runtime_authority', 'owner_identity', 'mfa', 'inventory', 'bundle', 'source_upload', 'function_update', 'operation_poll', 'function_readback', 'source_provenance', 'invoker_policy', 'source_archive', 'final_inventory', 'report']);
const failures = new WeakMap();
function phaseFailure(phase, error) {
  if (failures.has(error)) return error;
  const safe = new Error('staging_community_release_failed');
  failures.set(safe, PHASES.has(phase) ? phase : 'unknown');
  return safe; // Never retain the caught error, its cause, message or response.
}
function failureMessage(error) {
  return `staging_community_release_failed phase=${failures.get(error) || 'unknown'}`;
}
function validateInventory(inventory) {
  check(Array.isArray(inventory?.functions) && inventory.functions.length >= 2 && inventory.functions.length <= 5
    && !inventory.nextPageToken && !inventory.unreachable?.length);
  const names = inventory.functions.map((fn) => fn.entryPoint);
  check(new Set(names).size === names.length && names.includes('createMemberOnSignUp') && names.includes('ensureMemberProfile'));
  check(inventory.functions.every((fn) => ['createMemberOnSignUp', 'ensureMemberProfile', TARGET, ...DUES_TARGETS].includes(fn.entryPoint)
    && fn.name === `projects/${PROJECT}/locations/${REGION}/functions/${fn.entryPoint}`
    && typeof fn.versionId === 'string' && /^[1-9][0-9]*$/.test(fn.versionId)));
  inventory.functions.filter(fn => DUES_TARGETS.includes(fn.entryPoint)).forEach(validateKnownDues);
}

// Owner tokens do not inherit the CLI's --project as their API quota project.
// Keep every authenticated provider request billed/routed to staging explicitly.
function jsonRequest(url, token, method = 'GET', body, fetchImpl = fetch) {
  const authUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config`;
  if (url === authUrl || url === `${authUrl}?updateMask=mfa`) {
    check((url === authUrl && method === 'GET' && body === undefined)
      || (method === 'PATCH' && url === `${authUrl}?updateMask=mfa`
        && JSON.stringify(body) === JSON.stringify({ mfa: STAGING_MFA })));
    return fetchImpl(url, { method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }).then((response) => { check(response.ok); return response.json(); });
  }
  return providerRequest(url, token, method, body, (resource, options) => fetchImpl(resource, {
    ...options, headers: { ...options.headers, 'x-goog-user-project': PROJECT },
  }));
}

function verificationRequest(url, token, method = 'GET', body, fetchImpl = fetch) {
  const reads = [
    `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config`,
    `https://cloudfunctions.googleapis.com/v1/projects/${PROJECT}/locations/-/functions`,
    `${BASE}/functions/${TARGET}`, `${BASE}/functions/${TARGET}:getIamPolicy`,
  ];
  check((reads.includes(url) && method === 'GET' && body === undefined)
    || (url === `${BASE}/functions/${TARGET}:generateDownloadUrl` && method === 'POST'
      && body !== null && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0));
  return jsonRequest(url, token, method, body, fetchImpl);
}

function createBundle(root) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mprc-community-owned-'));
  try {
    for (const file of FILES) {
      const source = path.join(root, 'functions', file);
      check(fs.lstatSync(source).isFile() && !fs.lstatSync(source).isSymbolicLink());
      let bytes = fs.readFileSync(source);
      check(bytes.length < 1_000_000);
      if (file === 'package.json') {
        const manifest = JSON.parse(bytes); check(manifest.main === 'index.js' && manifest.engines.node === '22');
        manifest.main = 'communityOnly.js'; bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
      }
      fs.writeFileSync(path.join(directory, file), bytes, { flag: 'wx', mode: 0o600 });
      fs.utimesSync(path.join(directory, file), new Date('1980-01-01T00:00:00Z'), new Date('1980-01-01T00:00:00Z'));
    }
    const zip = execFileSync('zip', ['-X', '-q', '-', ...FILES], { cwd: directory, maxBuffer: 2_000_000 });
    check(zip.length < 1_000_000);
    return { zip, digest: createHash('sha256').update(zip).digest('hex') };
  } finally { fs.rmSync(directory, { recursive: true }); } // This exact generated folder only.
}

function functionSpec(sha, digest, uploadUrl) {
  check(/^[a-f0-9]{40}$/.test(sha) && /^[a-f0-9]{64}$/.test(digest));
  const url = new URL(uploadUrl);
  check(url.protocol === 'https:' && url.hostname === 'storage.googleapis.com' && !url.username && !url.password && !url.port);
  return {
    name: `projects/${PROJECT}/locations/${REGION}/functions/${TARGET}`, entryPoint: TARGET,
    runtime: 'nodejs22', serviceAccountEmail: RUNTIME,
    buildServiceAccount: `projects/${PROJECT}/serviceAccounts/mprc-profile-build@${PROJECT}.iam.gserviceaccount.com`,
    dockerRegistry: 'ARTIFACT_REGISTRY', dockerRepository: `projects/${PROJECT}/locations/${REGION}/repositories/mprc-profile-artifacts`,
    sourceUploadUrl: uploadUrl, availableMemoryMb: 256, timeout: '30s', minInstances: 0, maxInstances: 2,
    ingressSettings: 'ALLOW_ALL', httpsTrigger: { securityLevel: 'SECURE_ALWAYS' },
    labels: { 'managed-by': 'mprc-community-stage', 'source-sha': sha, 'bundle-a': digest.slice(0, 32), 'bundle-b': digest.slice(32) },
    environmentVariables: { FIREBASE_CONFIG: JSON.stringify({ projectId: PROJECT }), GCLOUD_PROJECT: PROJECT, COMMERCE_ENABLED: 'false' },
  };
}
function validateHostedFunction(actual, expected) {
  for (const key of ['name', 'entryPoint', 'runtime', 'serviceAccountEmail', 'buildServiceAccount', 'dockerRegistry', 'dockerRepository', 'availableMemoryMb', 'timeout', 'maxInstances', 'ingressSettings']) check(actual[key] === expected[key]);
  check(actual.status === 'ACTIVE' && (actual.minInstances ?? 0) === 0 && !actual.eventTrigger
    && actual.httpsTrigger?.securityLevel === 'SECURE_ALWAYS' && !actual.secretEnvironmentVariables?.length && !actual.secretVolumes?.length && !actual.vpcConnector);
  for (const key of ['labels', 'environmentVariables']) check(Object.keys(actual[key] || {}).length === Object.keys(expected[key]).length && Object.entries(expected[key]).every(([name, value]) => actual[key][name] === value));
}
const STAGING_MFA = { state: 'ENABLED', providerConfigs: [{ state: 'ENABLED', totpProviderConfig: { adjacentIntervals: 1 } }] };
function validateStagingMfa(config) {
  check(config.subtype === 'IDENTITY_PLATFORM' && config.signIn?.email?.enabled === true
    && config.mfa?.state === STAGING_MFA.state && config.mfa.providerConfigs?.length === 1);
  const provider = config.mfa.providerConfigs[0];
  check(provider.state === 'ENABLED' && provider.totpProviderConfig?.adjacentIntervals === 1
    && Object.keys(provider).length === 2 && Object.keys(provider.totpProviderConfig).length === 1
    && !config.mfa.enabledProviders?.length);
}
// Resource/identity/archive verification only. The sole POST requests a signed
// read URL; it never updates a Function, IAM, Auth, Hosting or member data.
async function verifyDeployment({ token, digest, sourceSha, inventory, verifyProvenance, request = verificationRequest, fetchImpl = fetch }) {
  let phase = 'inventory';
  try {
    validateInventory(inventory);
    phase = 'function_readback';
    const native = await request(`${BASE}/functions/${TARGET}`, token);
    const expected = functionSpec(native.labels?.['source-sha'], digest, 'https://storage.googleapis.com/synthetic');
    validateHostedFunction(native, expected);
    check(typeof native.versionId === 'string' && /^[1-9][0-9]*$/.test(native.versionId));
    phase = 'source_provenance';
    check(/^[a-f0-9]{40}$/.test(sourceSha));
    check(native.labels['source-sha'] === sourceSha
      || (typeof verifyProvenance === 'function' && await verifyProvenance(native.labels['source-sha']) === true));
    phase = 'invoker_policy';
    const policy = await request(`${BASE}/functions/${TARGET}:getIamPolicy`, token);
    check(policy.bindings?.length === 1 && policy.bindings[0].role === 'roles/cloudfunctions.invoker'
      && policy.bindings[0].members?.length === 1 && policy.bindings[0].members[0] === 'allUsers' && !policy.bindings[0].condition);
    phase = 'source_archive';
    const download = await request(`${BASE}/functions/${TARGET}:generateDownloadUrl`, token, 'POST', {});
    const url = new URL(download.downloadUrl);
    check(url.protocol === 'https:' && url.hostname === 'storage.googleapis.com' && !url.username && !url.password && !url.port);
    const archive = await fetchImpl(download.downloadUrl, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    check(archive.ok && archive.body);
    const reader = archive.body.getReader();
    const hash = createHash('sha256'); let bytes = 0; let complete = false;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) { complete = true; break; }
        bytes += chunk.value.byteLength;
        check(bytes <= 1_000_000);
        hash.update(chunk.value);
      }
    } finally {
      try { if (!complete) await reader.cancel(); } finally { reader.releaseLock(); }
    }
    check(bytes > 0 && hash.digest('hex') === digest);
    phase = 'final_inventory';
    const final = await request(`https://cloudfunctions.googleapis.com/v1/projects/${PROJECT}/locations/-/functions`, token);
    validateInventory(final); check(final.functions.length === 3 + inventory.functions.filter(fn => DUES_TARGETS.includes(fn.entryPoint)).length);
    const finalNative = final.functions.find((fn) => fn.entryPoint === TARGET);
    validateHostedFunction(finalNative, expected);
    check(finalNative.versionId === native.versionId);
    for (const original of inventory.functions.filter((fn) => fn.entryPoint !== TARGET)) {
      const unchanged = final.functions.find((fn) => fn.name === original.name);
      check(unchanged.versionId === original.versionId && isDeepStrictEqual(unchanged.labels, original.labels));
      if (DUES_TARGETS.includes(original.entryPoint)) check(isDeepStrictEqual(unchanged, original));
    }
    return { sourceSha: native.labels['source-sha'], digest, bytes, version: native.versionId };
  } catch (error) { throw phaseFailure(phase, error); }
}

async function performRelease(root, { verifyOnly }, phase) {
  const request = verifyOnly ? verificationRequest : jsonRequest;
  phase('source');
  const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  check(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() === '');
  const source = { GITHUB_SHA: sha, GH_TOKEN: gh('auth', 'token') };
  await verifyCurrentSource(source);
  phase('runtime_authority');
  const gcloud = (...args) => execFileSync('/opt/homebrew/bin/gcloud', [...args, `--account=${ACCOUNT}`, `--project=${PROJECT}`], { encoding: 'utf8' }).trim();
  const role = JSON.parse(gcloud('iam', 'roles', 'describe', 'mprcCommunityRuntime', '--format=json'));
  const permissions = ['datastore.databases.get', 'datastore.entities.get', 'datastore.entities.create', 'datastore.entities.update', 'datastore.entities.list', 'firebaseauth.users.get'];
  check(!role.deleted && role.includedPermissions?.length === permissions.length && permissions.every((permission) => role.includedPermissions.includes(permission)));
  const iam = JSON.parse(gcloud('projects', 'get-iam-policy', PROJECT, '--format=json'));
  const runtimeRoles = iam.bindings.filter((binding) => binding.members?.includes(`serviceAccount:${RUNTIME}`));
  check(runtimeRoles.length === 1 && runtimeRoles[0].role === `projects/${PROJECT}/roles/mprcCommunityRuntime` && !runtimeRoles[0].condition);
  const keys = JSON.parse(gcloud('iam', 'service-accounts', 'keys', 'list', `--iam-account=${RUNTIME}`, '--managed-by=user', '--format=json'));
  check(keys.length === 0);
  phase('owner_identity');
  const token = gcloud('auth', 'print-access-token'); // Memory only, never logged.
  const owner = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  check(owner.ok && (await owner.json()).email === ACCOUNT);
  phase('mfa');
  const authUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config`;
  const beforeAuth = await request(authUrl, token);
  check(beforeAuth.subtype === 'IDENTITY_PLATFORM' && beforeAuth.signIn?.email?.enabled === true);
  if (!verifyOnly && beforeAuth.mfa?.state === 'DISABLED') {
    check(!beforeAuth.mfa.providerConfigs?.length && !beforeAuth.mfa.enabledProviders?.length);
    await verifyCurrentSource(source);
    await request(`${authUrl}?updateMask=mfa`, token, 'PATCH', { mfa: STAGING_MFA });
  }
  const afterAuth = await request(authUrl, token);
  validateStagingMfa(afterAuth);
  check(isDeepStrictEqual(beforeAuth.signIn, afterAuth.signIn)
    && isDeepStrictEqual(beforeAuth.authorizedDomains, afterAuth.authorizedDomains));
  phase('inventory');
  const inventory = await request(`https://cloudfunctions.googleapis.com/v1/projects/${PROJECT}/locations/-/functions`, token);
  validateInventory(inventory);
  phase('bundle');
  const bundle = createBundle(root);
  if (verifyOnly) {
    const result = await verifyDeployment({ token, digest: bundle.digest, sourceSha: sha, inventory, request,
      verifyProvenance: async (nativeSha) => {
        execFileSync('git', ['merge-base', '--is-ancestor', nativeSha, sha], { cwd: root });
        return true;
      },
    });
    phase('source'); await verifyCurrentSource(source);
    phase('report');
    process.stdout.write(JSON.stringify({ status: 'staging_community_verified_without_deploy', reviewedSha: sha, ...result }) + '\n');
    return;
  }
  phase('source');
  await verifyCurrentSource(source);
  phase('source_upload');
  const uploaded = await jsonRequest(`${BASE}/functions:generateUploadUrl`, token, 'POST', {});
  const expected = functionSpec(sha, bundle.digest, uploaded.uploadUrl);
  const response = await fetch(uploaded.uploadUrl, { method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'Content-Type': 'application/zip', 'x-goog-content-length-range': '0,104857600' }, body: bundle.zip });
  check(response.ok);
  phase('source');
  await verifyCurrentSource(source);
  const exists = inventory.functions.some((fn) => fn.name === expected.name);
  phase('function_update');
  const operation = await jsonRequest(exists ? `${BASE}/functions/${TARGET}?updateMask=${Object.keys(expected).filter((key) => key !== 'name').join(',')}` : `${BASE}/functions`, token, exists ? 'PATCH' : 'POST', expected);
  phase('operation_poll');
  await waitForOperation(operation, token, jsonRequest);
  phase('function_readback');
  validateHostedFunction(await jsonRequest(`${BASE}/functions/${TARGET}`, token), expected);
  phase('invoker_policy');
  const prior = await jsonRequest(`${BASE}/functions/${TARGET}:getIamPolicy`, token);
  check((prior.bindings || []).every((binding) => binding.role === 'roles/cloudfunctions.invoker' && binding.members?.length === 1 && binding.members[0] === 'allUsers' && !binding.condition));
  await jsonRequest(`${BASE}/functions/${TARGET}:setIamPolicy`, token, 'POST', { policy: { version: 1, ...(prior.etag ? { etag: prior.etag } : {}), bindings: [{ role: 'roles/cloudfunctions.invoker', members: ['allUsers'] }] } });
  await verifyDeployment({ token, digest: bundle.digest, sourceSha: sha, inventory });
  phase('source'); await verifyCurrentSource(source);
  phase('report');
  process.stdout.write(JSON.stringify(releaseResult(sha, bundle)) + '\n');
}
function releaseResult(sha, bundle) {
  check(/^[a-f0-9]{40}$/.test(sha) && /^[a-f0-9]{64}$/.test(bundle.digest)
    && Buffer.isBuffer(bundle.zip) && bundle.zip.length > 0 && bundle.zip.length < 1_000_000);
  return { status: 'staging_community_deployed_verified', sha, digest: bundle.digest, bytes: bundle.zip.length };
}
async function release(root, options) {
  let phase = 'source';
  try { return await performRelease(root, options, (value) => { phase = value; }); }
  catch (error) { throw phaseFailure(phase, error); }
}
async function run(args, root, driver = release) {
  if (!(args.length === 0 || (args.length === 1 && args[0] === 'verify'))) throw phaseFailure('arguments');
  return driver(root, { verifyOnly: args.length === 1 });
}
if (require.main === module) run(process.argv.slice(2), path.resolve(__dirname, '..')).catch((error) => { process.stderr.write(`${failureMessage(error)}\n`); process.exitCode = 1; });
module.exports = { FILES, createBundle, functionSpec, validateHostedFunction, jsonRequest, verificationRequest, validateStagingMfa, verifyDeployment, failureMessage, releaseResult, run };
