'use strict';

// Owner-approved, fixed one-Function staging deployment. No credential file,
// production target, Firebase prototype index, or provider/payment secret.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { jsonRequest, waitForOperation } = require('./staging-profile-release');
const { verifyCurrentSource } = require('./staging-profile-authority');
const PROJECT = 'run-mprc-staging';
const TARGET = 'communityActions';
const REGION = 'us-central1';
const BASE = `https://cloudfunctions.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}`;
const ACCOUNT = 'runmprc@gmail.com';
const RUNTIME = `mprc-community-runtime@${PROJECT}.iam.gserviceaccount.com`;
const FILES = ['communityOnly.js', 'communityActions.js', 'membershipCancellationPolicy.json', 'membershipAuthority.js', 'requestValidation.js', 'profileRuntime.js', 'package.json', 'package-lock.json'];
const check = (value) => { if (!value) throw new Error('staging_community_release_failed'); };

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
async function release(root) {
  const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  check(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() === '');
  const source = { GITHUB_SHA: sha, GH_TOKEN: gh('auth', 'token') };
  await verifyCurrentSource(source);
  const gcloud = (...args) => execFileSync('/opt/homebrew/bin/gcloud', [...args, `--account=${ACCOUNT}`, `--project=${PROJECT}`], { encoding: 'utf8' }).trim();
  const role = JSON.parse(gcloud('iam', 'roles', 'describe', 'mprcCommunityRuntime', '--format=json'));
  const permissions = ['datastore.databases.get', 'datastore.entities.get', 'datastore.entities.create', 'datastore.entities.update'];
  check(!role.deleted && role.includedPermissions?.length === permissions.length && permissions.every((permission) => role.includedPermissions.includes(permission)));
  const iam = JSON.parse(gcloud('projects', 'get-iam-policy', PROJECT, '--format=json'));
  const runtimeRoles = iam.bindings.filter((binding) => binding.members?.includes(`serviceAccount:${RUNTIME}`));
  check(runtimeRoles.length === 1 && runtimeRoles[0].role === `projects/${PROJECT}/roles/mprcCommunityRuntime` && !runtimeRoles[0].condition);
  const keys = JSON.parse(gcloud('iam', 'service-accounts', 'keys', 'list', `--iam-account=${RUNTIME}`, '--managed-by=user', '--format=json'));
  check(keys.length === 0);
  const token = gcloud('auth', 'print-access-token'); // Memory only, never logged.
  const inventory = await jsonRequest(`https://cloudfunctions.googleapis.com/v1/projects/${PROJECT}/locations/-/functions`, token);
  check(!inventory.nextPageToken && !inventory.unreachable?.length && inventory.functions?.length >= 2 && inventory.functions.length <= 3);
  check(inventory.functions.every((fn) => ['createMemberOnSignUp', 'ensureMemberProfile', TARGET].includes(fn.entryPoint) && fn.name.startsWith(`${BASE.replace('https://cloudfunctions.googleapis.com/v1/', '')}/functions/`)));
  const bundle = createBundle(root);
  await verifyCurrentSource(source);
  const uploaded = await jsonRequest(`${BASE}/functions:generateUploadUrl`, token, 'POST', {});
  const expected = functionSpec(sha, bundle.digest, uploaded.uploadUrl);
  const response = await fetch(uploaded.uploadUrl, { method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'Content-Type': 'application/zip', 'x-goog-content-length-range': '0,104857600' }, body: bundle.zip });
  check(response.ok);
  await verifyCurrentSource(source);
  const exists = inventory.functions.some((fn) => fn.name === expected.name);
  const operation = await jsonRequest(exists ? `${BASE}/functions/${TARGET}?updateMask=${Object.keys(expected).filter((key) => key !== 'name').join(',')}` : `${BASE}/functions`, token, exists ? 'PATCH' : 'POST', expected);
  await waitForOperation(operation, token);
  validateHostedFunction(await jsonRequest(`${BASE}/functions/${TARGET}`, token), expected);
  const prior = await jsonRequest(`${BASE}/functions/${TARGET}:getIamPolicy`, token);
  check((prior.bindings || []).every((binding) => binding.role === 'roles/cloudfunctions.invoker' && binding.members?.length === 1 && binding.members[0] === 'allUsers'));
  await jsonRequest(`${BASE}/functions/${TARGET}:setIamPolicy`, token, 'POST', { policy: { version: 1, ...(prior.etag ? { etag: prior.etag } : {}), bindings: [{ role: 'roles/cloudfunctions.invoker', members: ['allUsers'] }] } });
  // Native source readback, not labels alone, must match the submitted bytes.
  const download = await jsonRequest(`${BASE}/functions/${TARGET}:generateDownloadUrl`, token, 'POST', {});
  const archiveUrl = new URL(download.downloadUrl);
  check(archiveUrl.protocol === 'https:' && archiveUrl.hostname === 'storage.googleapis.com');
  const archive = await fetch(download.downloadUrl, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  check(archive.ok && createHash('sha256').update(Buffer.from(await archive.arrayBuffer())).digest('hex') === bundle.digest);
  const final = await jsonRequest(`https://cloudfunctions.googleapis.com/v1/projects/${PROJECT}/locations/-/functions`, token);
  check(final.functions.length === 3 && !final.nextPageToken && !final.unreachable?.length);
  for (const original of inventory.functions.filter((fn) => fn.entryPoint !== TARGET)) {
    const unchanged = final.functions.find((fn) => fn.name === original.name);
    check(unchanged?.versionId === original.versionId && JSON.stringify(unchanged.labels) === JSON.stringify(original.labels));
  }
  process.stdout.write(JSON.stringify({ status: 'staging_community_deployed_verified', sha, digest, bytes: bundle.zip.length }) + '\n');
}
if (require.main === module) release(path.resolve(__dirname, '..')).catch(() => { process.stderr.write('staging_community_release_failed\n'); process.exitCode = 1; });
module.exports = { FILES, createBundle, functionSpec, validateHostedFunction };
