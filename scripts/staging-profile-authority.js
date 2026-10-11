'use strict';

const { createHash } = require('node:crypto');
const contract = require('../config/staging-profile-authority.json');

const REPOSITORY = 'Run-MPRC/Run-MPRC.github.io';
const REQUIRED_JOBS = Object.freeze([
  'Frontend lint + build',
  'Test artifact scrubber',
  'Cloud Functions lint + test',
  'Firestore security-rules tests',
  'Commerce command journal emulator',
  'Node 22 backend compatibility',
]);

function requireValid(condition) {
  if (!condition) throw new Error('staging_profile_authority_failed');
}

function validateContext(env, fingerprint = contract.authoritySha256) {
  requireValid(env.GITHUB_REPOSITORY === REPOSITORY);
  requireValid(env.GITHUB_REPOSITORY_ID === '718285092');
  requireValid(env.GITHUB_REPOSITORY_OWNER_ID === '150727922');
  requireValid(env.GITHUB_REF === 'refs/heads/main');
  requireValid(env.GITHUB_EVENT_NAME === 'workflow_dispatch');
  requireValid(env.GITHUB_WORKFLOW_REF === `${REPOSITORY}/.github/workflows/${contract.workflow}@refs/heads/main`);
  requireValid(/^[0-9a-f]{40}$/.test(env.GITHUB_SHA || ''));
  requireValid(env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA);
  requireValid(env.TARGET_ENVIRONMENT === contract.environment);
  requireValid(env.TARGET_PROJECT_ID === contract.projectId);
  requireValid(typeof env.DEPLOY_SERVICE_ACCOUNT === 'string');
  requireValid(typeof env.WORKLOAD_IDENTITY_PROVIDER === 'string');
  requireValid(createHash('sha256').update(
    `${env.WORKLOAD_IDENTITY_PROVIDER}\n${env.DEPLOY_SERVICE_ACCOUNT}`,
  ).digest('hex') === fingerprint);
}

async function readJson(fetchImpl, url, token, body) {
  requireValid(typeof token === 'string' && token.length > 0);
  const response = await fetchImpl(url, {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  requireValid(response.ok);
  // Never print a response, locator, token or provider error.
  return response.json();
}

async function verifyCurrentSource(env, fetchImpl = fetch) {
  const base = `https://api.github.com/repos/${REPOSITORY}`;
  const main = await readJson(fetchImpl, `${base}/git/ref/heads/main`, env.GH_TOKEN);
  requireValid(main.object?.sha === env.GITHUB_SHA);
  const runs = await readJson(fetchImpl,
    `${base}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${env.GITHUB_SHA}&per_page=20`, env.GH_TOKEN);
  requireValid(Array.isArray(runs.workflow_runs) && runs.workflow_runs.length <= 20);
  const candidates = runs.workflow_runs.filter((run) => run.head_sha === env.GITHUB_SHA
    && run.head_branch === 'main' && run.event === 'push');
  requireValid(candidates.every((run) => Number.isSafeInteger(run.run_number) && run.run_number > 0
    && (run.run_attempt === undefined || (Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0))));
  candidates.sort((a, b) => b.run_number - a.run_number || (b.run_attempt || 0) - (a.run_attempt || 0));
  const latest = candidates[0];
  requireValid(latest?.status === 'completed' && latest.conclusion === 'success');
  requireValid(Number.isSafeInteger(latest.id) && latest.id > 0);
  const results = await readJson(fetchImpl,
    `${base}/actions/runs/${latest.id}/jobs?filter=latest&per_page=100`, env.GH_TOKEN);
  requireValid(Array.isArray(results.jobs) && results.total_count === results.jobs.length && results.total_count <= 100);
  requireValid(REQUIRED_JOBS.every((name) => {
    const matches = results.jobs.filter((job) => job.name === name);
    return matches.length === 1 && matches[0].status === 'completed'
      && matches[0].conclusion === 'success'
      && Array.isArray(matches[0].steps) && matches[0].steps.length > 0
      && matches[0].steps.every((step) => step.status === 'completed' && step.conclusion === 'success');
  }));
}

function validatePermissions(result) {
  requireValid(Array.isArray(result.permissions));
  requireValid(result.permissions.every((permission) => typeof permission === 'string'));
  const allowed = new Set(result.permissions);
  requireValid(result.permissions.length === contract.permissions.length);
  requireValid(contract.permissions.every((permission) => allowed.has(permission)));
  requireValid(contract.deniedPermissions.every((permission) => !allowed.has(permission)));
}

async function verifyCloudAuthority(env, fetchImpl = fetch) {
  const project = await readJson(fetchImpl,
    `https://cloudresourcemanager.googleapis.com/v3/projects/${contract.projectId}`, env.GCP_ACCESS_TOKEN);
  requireValid(project.projectId === contract.projectId && project.state === 'ACTIVE');
  const number = env.WORKLOAD_IDENTITY_PROVIDER?.match(/^projects\/([0-9]+)\//)?.[1];
  requireValid(number && project.name === `projects/${number}`);
  const permissions = await readJson(fetchImpl,
    `https://cloudresourcemanager.googleapis.com/v1/projects/${contract.projectId}:testIamPermissions`,
    env.GCP_ACCESS_TOKEN, { permissions: [...contract.permissions, ...contract.deniedPermissions] });
  validatePermissions(permissions);
}

async function main() {
  try {
    requireValid(process.argv.length === 3);
    const phase = process.argv[2];
    requireValid(phase === 'context' || phase === 'cloud');
    validateContext(process.env);
    if (phase === 'context') {
      await verifyCurrentSource(process.env);
      // Secret locators are already masked by GitHub. Also mask the number
      // fragment that a third-party authentication error could echo alone.
      const number = process.env.WORKLOAD_IDENTITY_PROVIDER.match(/^projects\/([0-9]+)\//)?.[1];
      requireValid(number);
      process.stdout.write(`::add-mask::${number}\n`);
    }
    else {
      await verifyCurrentSource(process.env);
      await verifyCloudAuthority(process.env);
    }
    process.stdout.write(`staging_profile_authority_${phase}_verified\n`);
  } catch {
    process.stderr.write('staging_profile_authority_failed\n');
    process.exitCode = 1;
  }
}

if (require.main === module) void main();
module.exports = { contract, REQUIRED_JOBS, validateContext, verifyCurrentSource, validatePermissions, verifyCloudAuthority };
