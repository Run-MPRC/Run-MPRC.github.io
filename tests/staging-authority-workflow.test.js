'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const WORKFLOW_PATH = path.join(
  ROOT,
  '.github/workflows/verify-staging-authority.yml',
);
const CONTEXT_CHECK_PATH = path.join(
  ROOT,
  '.github/scripts/validate-staging-authority-context.sh',
);
const PROJECT_READ_PATH = path.join(
  ROOT,
  '.github/scripts/verify-staging-project-read.sh',
);
const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');
const contextCheck = fs.readFileSync(CONTEXT_CHECK_PATH, 'utf8');
const projectRead = fs.readFileSync(PROJECT_READ_PATH, 'utf8');

const VALID_CONTEXT = Object.freeze({
  GITHUB_REPOSITORY: 'Run-MPRC/Run-MPRC.github.io',
  GITHUB_REPOSITORY_ID: '718285092',
  GITHUB_REPOSITORY_OWNER_ID: '150727922',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_WORKFLOW_REF: 'Run-MPRC/Run-MPRC.github.io/.github/workflows/verify-staging-authority.yml@refs/heads/main',
  TARGET_ENVIRONMENT: 'staging',
  TARGET_PROJECT_ID: 'run-mprc-staging',
  DEPLOY_SERVICE_ACCOUNT: 'mprc-staging-deploy@run-mprc-staging.iam.gserviceaccount.com',
  WORKLOAD_IDENTITY_PROVIDER: 'projects/384996399199/locations/global/workloadIdentityPools/github-actions/providers/run-mprc-staging',
});

function runContextCheck(overrides = {}, omitted = []) {
  const env = { ...process.env, ...VALID_CONTEXT, ...overrides };
  omitted.forEach((name) => delete env[name]);
  return spawnSync('bash', [CONTEXT_CHECK_PATH], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
  });
}

test('staging authority workflow is manual, protected, pinned, and least-authority', () => {
  assert.match(workflow, /\bon:\n  workflow_dispatch:\n/);
  assert.doesNotMatch(workflow, /\n  (?:push|pull_request|schedule):/);
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.match(workflow, /environment:\n      name: staging/);
  assert.match(workflow, /permissions:\n      contents: read\n      id-token: write/);
  assert.match(workflow, /TARGET_PROJECT_ID: \$\{\{ vars\.FIREBASE_PROJECT_ID \}\}/);
  assert.match(workflow, /secrets\.GCP_WORKLOAD_IDENTITY_PROVIDER/);
  assert.match(workflow, /secrets\.GCP_DEPLOY_SERVICE_ACCOUNT/);
  assert.doesNotMatch(workflow, /FIREBASE_TOKEN|FIREBASE_SERVICE_ACCOUNT|credentials_json/);
  assert.doesNotMatch(workflow, /contents: write|actions: write|packages: write/);

  for (const action of workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)) {
    assert.match(action[1], /@[0-9a-f]{40}$/);
  }
});

test('staging authority workflow validates context before requesting OIDC', () => {
  const validatePosition = workflow.indexOf('Validate immutable repository');
  const authPosition = workflow.indexOf('google-github-actions/auth@');
  const readPosition = workflow.indexOf('verify-staging-project-read.sh');

  assert.ok(validatePosition > 0);
  assert.ok(authPosition > validatePosition);
  assert.ok(readPosition > authPosition);
  assert.match(contextCheck, /GITHUB_REPOSITORY_ID:-.*718285092/);
  assert.match(contextCheck, /GITHUB_REPOSITORY_OWNER_ID:-.*150727922/);
  assert.match(contextCheck, /GITHUB_REF:-.*refs\/heads\/main/);
  assert.match(contextCheck, /TARGET_ENVIRONMENT:-.*staging/);
  assert.match(contextCheck, /TARGET_PROJECT_ID:-.*run-mprc-staging/);
});

test('context verifier accepts only the exact reviewed authority context', () => {
  const result = runContextCheck();
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'staging_authority_context_valid\n');
  assert.equal(result.stderr, '');
});

test('wrong ref and missing authority fail with one fixed diagnostic', () => {
  const wrongRef = runContextCheck({ GITHUB_REF: 'refs/heads/not-main' });
  assert.notEqual(wrongRef.status, 0);
  assert.equal(wrongRef.stdout, '');
  assert.equal(wrongRef.stderr, 'staging_authority_context_invalid\n');

  for (const missingName of [
    'DEPLOY_SERVICE_ACCOUNT',
    'WORKLOAD_IDENTITY_PROVIDER',
  ]) {
    const missing = runContextCheck({}, [missingName]);
    assert.notEqual(missing.status, 0);
    assert.equal(missing.stdout, '');
    assert.equal(missing.stderr, 'staging_authority_context_invalid\n');
  }
});

test('post-auth verifier performs only one fixed GET and emits no response data', () => {
  assert.match(projectRead, /curl --fail --silent --show-error --request GET/);
  assert.match(
    projectRead,
    /https:\/\/cloudresourcemanager\.googleapis\.com\/v3\/projects\/run-mprc-staging/,
  );
  assert.match(projectRead, /\.projectId == "run-mprc-staging"/);
  assert.match(projectRead, /\.name == "projects\/384996399199"/);
  assert.match(projectRead, /\.state == "ACTIVE"/);
  assert.doesNotMatch(projectRead, /--request (?:POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(projectRead, /gcloud|firebase|tee|cat .*response/);
  assert.equal(
    (projectRead.match(/staging_authority_read_verified/g) ?? []).length,
    1,
  );
});

test('verification source contains no deployment or cloud mutation command', () => {
  const source = `${workflow}\n${contextCheck}\n${projectRead}`;
  assert.doesNotMatch(source, /firebase\s+deploy/);
  assert.doesNotMatch(source, /gcloud\s+(?:services|iam|projects)/);
  assert.doesNotMatch(source, /--request (?:POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(source, /functions:|firestore:rules|hosting:/);
});
