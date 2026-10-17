'use strict';
// Fixed staging resources only. This module never reads credentials or deploys.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const PROJECT = 'run-mprc-staging';
const PROJECT_NUMBER = '384996399199'; // Native project identity checked October 17, 2026.
const BASE = `https://cloudfunctions.googleapis.com/v1/projects/${PROJECT}/locations/us-central1`;
const TARGETS = Object.freeze(['membershipTestDues', 'membershipTestDuesWebhook']);
const RUNTIME = `mprc-test-dues-runtime@${PROJECT}.iam.gserviceaccount.com`;
const ROLE = `projects/${PROJECT}/roles/mprcTestDuesRuntime`;
const SECRETS = Object.freeze(['MPRC_TEST_STRIPE_KEY', 'MPRC_TEST_STRIPE_WEBHOOK_SECRET']);
const PERMISSIONS = Object.freeze(['datastore.databases.get', 'datastore.entities.get', 'datastore.entities.create', 'datastore.entities.update', 'datastore.entities.list', 'firebaseauth.users.get']);
const FILES = Object.freeze(['duesTestOnly.js', 'testDuesHandlers.js', 'testDuesPolicy.js', 'testDuesStripe.js', 'testMembershipDues.js', 'membershipDuesCheckout.js', 'membershipDuesPayment.js', 'membershipAuthority.js', 'requestValidation.js', 'package.json', 'package-lock.json']);
const check = (v) => { if (!v) throw new Error('staging_test_dues_failed'); };
function validatePlan(plan) {
  check(plan && Object.getPrototypeOf(plan) === Object.prototype
    && isDeepStrictEqual(Object.keys(plan).sort(), ['keyVersion', 'stripeAccount', 'webhookVersion'])
    && typeof plan.stripeAccount === 'string' && /^acct_[A-Za-z0-9]{1,120}$/.test(plan.stripeAccount)
    && ['keyVersion', 'webhookVersion'].every(k => typeof plan[k] === 'string' && /^[1-9][0-9]{0,9}$/.test(plan[k])));
  return plan;
}
function readPlan(filename) {
  check(typeof filename === 'string' && fs.lstatSync(filename).isFile() && !fs.lstatSync(filename).isSymbolicLink() && fs.statSync(filename).size < 4096);
  return validatePlan(JSON.parse(fs.readFileSync(filename, 'utf8')));
}
function createBundle(root) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mprc-test-dues-owned-'));
  try {
    for (const file of FILES) {
      const source = path.join(root, 'functions', file);
      check(fs.lstatSync(source).isFile() && !fs.lstatSync(source).isSymbolicLink());
      let bytes = fs.readFileSync(source); check(bytes.length < 1_000_000);
      if (file === 'package.json') {
        const manifest = JSON.parse(bytes); check(manifest.main === 'index.js' && manifest.engines.node === '22');
        manifest.main = 'duesTestOnly.js'; bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
      }
      fs.writeFileSync(path.join(directory, file), bytes, { flag: 'wx', mode: 0o600 });
      fs.utimesSync(path.join(directory, file), new Date('1980-01-01T00:00:00Z'), new Date('1980-01-01T00:00:00Z'));
    }
    const zip = execFileSync('zip', ['-X', '-q', '-', ...FILES], { cwd: directory, maxBuffer: 2_000_000 });
    check(zip.length > 0 && zip.length < 1_000_000);
    return { zip, digest: createHash('sha256').update(zip).digest('hex') };
  } finally { fs.rmSync(directory, { recursive: true }); }
}
function functionSpec(target, sha, digest, uploadUrl, plan) {
  validatePlan(plan); check(TARGETS.includes(target) && /^[a-f0-9]{40}$/.test(sha) && /^[a-f0-9]{64}$/.test(digest));
  const url = new URL(uploadUrl);
  check(url.protocol === 'https:' && url.hostname === 'storage.googleapis.com' && !url.username && !url.password && !url.port);
  return {
    name: `projects/${PROJECT}/locations/us-central1/functions/${target}`, entryPoint: target,
    runtime: 'nodejs22', serviceAccountEmail: RUNTIME,
    buildServiceAccount: `projects/${PROJECT}/serviceAccounts/mprc-profile-build@${PROJECT}.iam.gserviceaccount.com`,
    dockerRegistry: 'ARTIFACT_REGISTRY', dockerRepository: `projects/${PROJECT}/locations/us-central1/repositories/mprc-profile-artifacts`,
    sourceUploadUrl: uploadUrl, availableMemoryMb: 256, timeout: '30s', minInstances: 0, maxInstances: 2,
    ingressSettings: 'ALLOW_ALL', httpsTrigger: { securityLevel: 'SECURE_ALWAYS' },
    labels: { 'managed-by': 'mprc-test-dues-stage', 'source-sha': sha, 'bundle-a': digest.slice(0, 32), 'bundle-b': digest.slice(32) },
    environmentVariables: { FIREBASE_CONFIG: JSON.stringify({ projectId: PROJECT }), GCLOUD_PROJECT: PROJECT,
      COMMERCE_ENABLED: 'false', MPRC_TEST_DUES_ENABLED: 'true', MPRC_TEST_STRIPE_ACCOUNT: plan.stripeAccount },
    secretEnvironmentVariables: SECRETS.map((key, index) => ({ key, projectId: PROJECT_NUMBER, secret: key, version: index ? plan.webhookVersion : plan.keyVersion })),
  };
}
function validateHostedFunction(actual, expected) {
  check(actual && actual.status === 'ACTIVE' && /^[1-9][0-9]*$/.test(actual.versionId || '')
    && !actual.eventTrigger && !actual.vpcConnector && !actual.secretVolumes?.length
    && (actual.minInstances ?? 0) === 0 && actual.httpsTrigger?.securityLevel === 'SECURE_ALWAYS');
  for (const k of ['name', 'entryPoint', 'runtime', 'serviceAccountEmail', 'buildServiceAccount', 'dockerRegistry', 'dockerRepository', 'availableMemoryMb', 'timeout', 'maxInstances', 'ingressSettings']) check(actual[k] === expected[k]);
  for (const k of ['labels', 'environmentVariables']) check(isDeepStrictEqual(actual[k], expected[k]));
  const sortSecrets = values => [...values].sort((a, b) => a.key.localeCompare(b.key));
  check(Array.isArray(actual.secretEnvironmentVariables) && isDeepStrictEqual(sortSecrets(actual.secretEnvironmentVariables), sortSecrets(expected.secretEnvironmentVariables)));
}
// Used by older profile/community release paths only to recognize and preserve
// these exact isolated resources. It does not authorize their deployment.
function validateKnownDues(actual) {
  const refs = actual?.secretEnvironmentVariables;
  check(Array.isArray(refs));
  const plan = { stripeAccount: actual.environmentVariables?.MPRC_TEST_STRIPE_ACCOUNT,
    keyVersion: refs.find(s => s.key === SECRETS[0])?.version,
    webhookVersion: refs.find(s => s.key === SECRETS[1])?.version };
  validateHostedFunction(actual, functionSpec(actual.entryPoint, actual.labels?.['source-sha'], `${actual.labels?.['bundle-a']}${actual.labels?.['bundle-b']}`, 'https://storage.googleapis.com/synthetic', plan));
}
function validateRuntimeAuthority({ role, policy, keys }) {
  check(role.name === ROLE && !role.deleted && Array.isArray(role.includedPermissions)
    && isDeepStrictEqual([...role.includedPermissions].sort(), [...PERMISSIONS].sort()));
  check(Array.isArray(policy.bindings) && Array.isArray(keys) && keys.length === 0);
  const grants = policy.bindings.filter(b => b.members?.includes(`serviceAccount:${RUNTIME}`));
  check(grants.length === 1 && grants[0].role === ROLE && !grants[0].condition);
}
function validateSecretMetadata(secret, version, policy, name, number) {
  check(SECRETS.includes(name) && [PROJECT, PROJECT_NUMBER].some(project => secret.name === `projects/${project}/secrets/${name}`)
    && secret.labels?.['managed-by'] === 'mprc-test-dues-stage'
    && version.name === `${secret.name}/versions/${number}` && version.state === 'ENABLED');
  check(policy.bindings?.length === 1 && policy.bindings[0].role === 'roles/secretmanager.secretAccessor'
    && !policy.bindings[0].condition && isDeepStrictEqual(policy.bindings[0].members, [`serviceAccount:${RUNTIME}`]));
}
function validateInvoker(policy) {
  check(policy.bindings?.length === 1 && policy.bindings[0].role === 'roles/cloudfunctions.invoker'
    && !policy.bindings[0].condition && isDeepStrictEqual(policy.bindings[0].members, ['allUsers']));
}
module.exports = { PROJECT, PROJECT_NUMBER, BASE, TARGETS, RUNTIME, ROLE, SECRETS, PERMISSIONS, FILES, check, validatePlan, readPlan, createBundle, functionSpec, validateHostedFunction, validateKnownDues, validateRuntimeAuthority, validateSecretMetadata, validateInvoker };
