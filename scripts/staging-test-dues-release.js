'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { verifyCurrentSource } = require('./staging-profile-authority');
const { waitForOperation, functionSpec: profileSpec, validateHostedFunction: validateProfile } = require('./staging-profile-release');
const community = require('./staging-community-release');
const c = require('./staging-test-dues-contract');
const { PROJECT, PROJECT_NUMBER, BASE, TARGETS, RUNTIME, SECRETS, check } = c;
const ACCOUNT = 'runmprc@gmail.com';
const INVENTORY = `https://cloudfunctions.googleapis.com/v1/projects/${PROJECT}/locations/-/functions`;
const UPDATE_FIELDS = 'entryPoint,runtime,serviceAccountEmail,buildServiceAccount,dockerRegistry,dockerRepository,sourceUploadUrl,availableMemoryMb,timeout,minInstances,maxInstances,ingressSettings,httpsTrigger,labels,environmentVariables,secretEnvironmentVariables';
// Exact API/resource/method boundary. No secret payload access, production,
// arbitrary IAM mutation, Auth data, financial records or provider calls.
function allowedRequest(url, method, body, verifyOnly) {
  const empty = body && Object.getPrototypeOf(body) === Object.prototype && Object.keys(body).length === 0;
  const get = method === 'GET' && body === undefined;
  if (get && (url === INVENTORY || url === `https://cloudresourcemanager.googleapis.com/v3/projects/${PROJECT}`)) return true;
  if (get && /^https:\/\/cloudfunctions\.googleapis\.com\/v1\/operations\/[A-Za-z0-9_\-/]+$/.test(url)) return true;
  for (const name of SECRETS) {
    const secret = `https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${name}`;
    if (get && (url === secret || url === `${secret}:getIamPolicy` || new RegExp(`^${secret.replaceAll('.', '\\.')}\/versions\/[1-9][0-9]{0,9}$`).test(url))) return true;
  }
  for (const target of TARGETS) {
    const fn = `${BASE}/functions/${target}`;
    if (get && (url === fn || url === `${fn}:getIamPolicy`)) return true;
    if (method === 'POST' && url === `${fn}:generateDownloadUrl` && empty) return true;
    if (!verifyOnly && method === 'POST' && url === `${fn}:setIamPolicy`) {
      check(body && Object.keys(body).length === 1 && body.policy?.version === 1
        && Object.keys(body.policy).every(k => ['version', 'etag', 'bindings'].includes(k))
        && (body.policy.etag === undefined || (typeof body.policy.etag === 'string' && body.policy.etag.length <= 512)));
      c.validateInvoker(body.policy); return true;
    }
    if (!verifyOnly && ((method === 'POST' && url === `${BASE}/functions`) || (method === 'PATCH' && url === `${fn}?updateMask=${UPDATE_FIELDS}`))) {
      if (body?.entryPoint !== target) continue;
      // Reconstruct and compare the entire request; arbitrary fields fail closed.
      const refs = body.secretEnvironmentVariables || [];
      const expected = c.functionSpec(target, body.labels?.['source-sha'], `${body.labels?.['bundle-a']}${body.labels?.['bundle-b']}`, body.sourceUploadUrl,
        { stripeAccount: body.environmentVariables?.MPRC_TEST_STRIPE_ACCOUNT, keyVersion: refs.find(s => s.key === SECRETS[0])?.version, webhookVersion: refs.find(s => s.key === SECRETS[1])?.version });
      return isDeepStrictEqual(body, expected);
    }
  }
  return !verifyOnly && method === 'POST' && url === `${BASE}/functions:generateUploadUrl` && empty;
}
function requestFor(verifyOnly, fetchImpl = fetch) {
  return async (url, token, method = 'GET', body) => {
    check(allowedRequest(url, method, body, verifyOnly));
    const response = await fetchImpl(url, { method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    check(response.ok); return response.json();
  };
}
function validateInventory(inventory, complete = false) {
  check(Array.isArray(inventory?.functions) && inventory.functions.length >= 3 && inventory.functions.length <= 5
    && !inventory.nextPageToken && !inventory.unreachable?.length);
  const names = inventory.functions.map(f => f.entryPoint);
  check(new Set(names).size === names.length && ['createMemberOnSignUp', 'ensureMemberProfile', 'communityActions'].every(n => names.includes(n)));
  if (complete) check(TARGETS.every(n => names.includes(n)));
  for (const fn of inventory.functions) {
    check(/^[1-9][0-9]*$/.test(fn.versionId || ''));
    if (TARGETS.includes(fn.entryPoint)) c.validateKnownDues(fn);
    else if (fn.entryPoint === 'communityActions') community.validateHostedFunction(fn, community.functionSpec(fn.labels?.['source-sha'], `${fn.labels?.['bundle-a']}${fn.labels?.['bundle-b']}`, 'https://storage.googleapis.com/synthetic'));
    else {
      check(['createMemberOnSignUp', 'ensureMemberProfile'].includes(fn.entryPoint));
      validateProfile(fn, profileSpec(fn.entryPoint, fn.labels?.['source-sha'], `${fn.labels?.['bundle-a']}${fn.labels?.['bundle-b']}`, 'https://storage.googleapis.com/synthetic'));
    }
  }
}
function validateUnchanged(before, after) {
  for (const original of before.functions.filter(f => !TARGETS.includes(f.entryPoint))) {
    const same = after.functions.find(f => f.name === original.name);
    check(same && isDeepStrictEqual(same, original));
  }
}
async function verifyArchive(native, digest, token, request, fetchImpl = fetch) {
  const download = await request(`${BASE}/functions/${native.entryPoint}:generateDownloadUrl`, token, 'POST', {});
  const url = new URL(download.downloadUrl);
  check(url.protocol === 'https:' && url.hostname === 'storage.googleapis.com' && !url.username && !url.password && !url.port);
  const response = await fetchImpl(download.downloadUrl, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  check(response.ok && response.body);
  const reader = response.body.getReader(); const hash = createHash('sha256'); let bytes = 0; let done = false;
  try {
    while (true) { const part = await reader.read(); if (part.done) { done = true; break; } bytes += part.value.byteLength; check(bytes <= 1_000_000); hash.update(part.value); }
  } finally { try { if (!done) await reader.cancel(); } finally { reader.releaseLock(); } }
  check(bytes > 0 && hash.digest('hex') === digest); return bytes;
}
async function verifyFunctions({ inventory, plan, digest, token, sha, request = requestFor(true), verifyProvenance, fetchImpl = fetch }) {
  validateInventory(inventory, true); const receipts = [];
  for (const target of TARGETS) {
    const native = inventory.functions.find(f => f.entryPoint === target);
    c.validateHostedFunction(native, c.functionSpec(target, native.labels?.['source-sha'], digest, 'https://storage.googleapis.com/synthetic', plan));
    check(native.labels['source-sha'] === sha || (typeof verifyProvenance === 'function' && await verifyProvenance(native.labels['source-sha']) === true));
    c.validateInvoker(await request(`${BASE}/functions/${target}:getIamPolicy`, token));
    const bytes = await verifyArchive(native, digest, token, request, fetchImpl);
    receipts.push({ target, version: native.versionId, sourceSha: native.labels['source-sha'], digest, bytes });
  }
  return receipts;
}
const gcloud = (...args) => execFileSync('/opt/homebrew/bin/gcloud', [...args, `--account=${ACCOUNT}`, `--project=${PROJECT}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function ownerToken() {
  const token = gcloud('auth', 'print-access-token');
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  check(response.ok && (await response.json()).email === ACCOUNT); return token;
}
async function verifyAuthority(token, plan, request = requestFor(true)) {
  const project = await request(`https://cloudresourcemanager.googleapis.com/v3/projects/${PROJECT}`, token);
  check(project.projectId === PROJECT && project.name === `projects/${PROJECT_NUMBER}` && project.state === 'ACTIVE');
  c.validateRuntimeAuthority({
    role: JSON.parse(gcloud('iam', 'roles', 'describe', 'mprcTestDuesRuntime', '--format=json')),
    policy: JSON.parse(gcloud('projects', 'get-iam-policy', PROJECT, '--format=json')),
    keys: JSON.parse(gcloud('iam', 'service-accounts', 'keys', 'list', `--iam-account=${RUNTIME}`, '--managed-by=user', '--format=json')),
  });
  for (const [i, name] of SECRETS.entries()) {
    const url = `https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${name}`;
    const number = i ? plan.webhookVersion : plan.keyVersion;
    c.validateSecretMetadata(await request(url, token), await request(`${url}/versions/${number}`, token), await request(`${url}:getIamPolicy`, token), name, number);
  }
}
async function run(args, root = path.resolve(__dirname, '..')) {
  check(args.length === 2 && ['verify', 'deploy'].includes(args[0]));
  const plan = c.readPlan(args[1]); const verifyOnly = args[0] === 'verify';
  check(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() === '');
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const source = { GITHUB_SHA: sha, GH_TOKEN: execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  await verifyCurrentSource(source);
  const token = await ownerToken(); const request = requestFor(verifyOnly);
  await verifyAuthority(token, plan, request);
  const inventory = await request(INVENTORY, token); validateInventory(inventory);
  community.validateStagingMfa(await community.verificationRequest(`https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config`, token));
  const bundle = c.createBundle(root);
  if (!verifyOnly) {
    for (const target of TARGETS) {
      await verifyCurrentSource(source);
      const uploaded = await request(`${BASE}/functions:generateUploadUrl`, token, 'POST', {});
      const spec = c.functionSpec(target, sha, bundle.digest, uploaded.uploadUrl, plan);
      const put = await fetch(uploaded.uploadUrl, { method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'Content-Type': 'application/zip', 'x-goog-content-length-range': '0,104857600' }, body: bundle.zip });
      check(put.ok); await verifyCurrentSource(source);
      const exists = inventory.functions.some(f => f.entryPoint === target);
      const operation = await request(exists ? `${BASE}/functions/${target}?updateMask=${UPDATE_FIELDS}` : `${BASE}/functions`, token, exists ? 'PATCH' : 'POST', spec);
      await waitForOperation(operation, token, request);
      c.validateHostedFunction(await request(`${BASE}/functions/${target}`, token), spec);
      const prior = await request(`${BASE}/functions/${target}:getIamPolicy`, token);
      check(!prior.bindings?.length || (c.validateInvoker(prior), true));
      await verifyCurrentSource(source);
      await request(`${BASE}/functions/${target}:setIamPolicy`, token, 'POST', { policy: { version: 1, ...(prior.etag ? { etag: prior.etag } : {}), bindings: [{ role: 'roles/cloudfunctions.invoker', members: ['allUsers'] }] } });
    }
  }
  const final = await request(INVENTORY, token); validateInventory(final, true); validateUnchanged(inventory, final);
  const receipts = await verifyFunctions({ inventory: final, plan, digest: bundle.digest, token, sha, request: requestFor(true), verifyProvenance: async nativeSha => { execFileSync('git', ['merge-base', '--is-ancestor', nativeSha, sha], { cwd: root }); return true; } });
  const last = await request(INVENTORY, token); validateInventory(last, true); check(isDeepStrictEqual(final, last));
  await verifyAuthority(token, plan); await verifyCurrentSource(source);
  process.stdout.write(JSON.stringify({ status: verifyOnly ? 'staging_test_dues_verified_without_deploy' : 'staging_test_dues_deployed_verified', sha, receipts }) + '\n');
}
if (require.main === module) run(process.argv.slice(2)).catch(() => { process.stderr.write('staging_test_dues_failed\n'); process.exitCode = 1; });
module.exports = { allowedRequest, requestFor, validateInventory, validateUnchanged, verifyArchive, verifyFunctions, ownerToken, verifyAuthority, run };
