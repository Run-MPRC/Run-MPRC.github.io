'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/deploy.yml');
const NETLIFY_CONFIG_PATH = path.join(ROOT, 'netlify.toml');
const NETLIFY_GATE_PATH = path.join(ROOT, 'scripts/netlify-ignore-build.js');
const GITIGNORE_PATH = path.join(ROOT, '.gitignore');
const PUBLIC_CNAME_PATH = path.join(ROOT, 'public/CNAME');
const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');
const netlifyConfig = fs.readFileSync(NETLIFY_CONFIG_PATH, 'utf8');
const gitignore = fs.readFileSync(GITIGNORE_PATH, 'utf8');

function runNetlifyGate(context) {
  const env = { ...process.env };
  if (context === undefined) {
    delete env.CONTEXT;
  } else {
    env.CONTEXT = context;
  }
  return spawnSync(process.execPath, [NETLIFY_GATE_PATH], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
}

test('release workflow is manual, exact-commit, and fixed-scope', () => {
  assert.match(workflow, /\bon:\n  workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n  push:/);
  assert.match(workflow, /source_commit:/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /Source commit must equal the current tip of main/);
  assert.match(workflow, /actions\/workflows\/ci\.yml\/runs/);
  assert.doesNotMatch(workflow, /-f status=completed/);
  assert.match(workflow, /\.head_branch == "main"/);
  assert.match(workflow, /\.event == "push"/);
  assert.match(workflow, /sort_by\(\[\.run_number, \(\.run_attempt \/\/ 0\)\]\)/);
  assert.match(workflow, /\.status == "completed" and \.conclusion == "success"/);
  assert.match(workflow, /\.conclusion == "success"/);
  assert.match(workflow, /Frontend lint \+ build/);
  assert.match(workflow, /Cloud Functions lint \+ test/);
  assert.equal(
    (workflow.match(/"Commerce command journal emulator"/g) ?? []).length,
    2,
  );
  assert.match(workflow, /Firestore security-rules tests/);
  assert.match(workflow, /options:\n          - profile-recovery/);
  assert.match(workflow, /RELEASE_PLAN: \$\{\{ inputs\.release_plan \}\}/);
  assert.match(workflow, /Unsupported release plan/);
  assert.match(
    workflow,
    /--only firestore:rules,functions:createMemberOnSignUp,functions:ensureMemberProfile/,
  );
  assert.doesNotMatch(workflow, /--only[= ]+functions(?:\s|$)/m);
  assert.equal((workflow.match(/npx --no-install firebase deploy/g) ?? []).length, 1);
  assert.match(workflow, /Staging is unavailable until #113\/#133/);
});

test('website is prebuilt, then backend is read back before publication', () => {
  const preparePosition = workflow.indexOf('  prepare-pages:');
  const backendPosition = workflow.indexOf('  deploy-backend:');
  const pagesPosition = workflow.indexOf('  deploy-pages:');

  assert.ok(preparePosition > 0);
  assert.ok(backendPosition > preparePosition);
  assert.ok(pagesPosition > backendPosition);
  assert.match(workflow.slice(preparePosition, backendPosition), /upload-artifact@[0-9a-f]{40}/);
  assert.match(workflow.slice(backendPosition, pagesPosition), /Always read back Rules and both Function revisions/);
  assert.match(workflow.slice(backendPosition, pagesPosition), /if: \$\{\{ always\(\)/);
  assert.match(
    workflow.slice(pagesPosition),
    /needs:\n      - preflight\n      - prepare-pages\n      - deploy-backend/,
  );
  assert.match(
    workflow.slice(pagesPosition),
    /needs\.deploy-backend\.outputs\.backend_verified == 'true'/,
  );
  assert.match(workflow.slice(pagesPosition), /download-artifact@[0-9a-f]{40}/);
  assert.match(workflow.slice(pagesPosition), /release-commit\.txt/);
  assert.match(workflow.slice(preparePosition, backendPosition), /retention-days: 30/);
});

test('release uses protected short-lived authority and committed tooling', () => {
  const backendHeader = workflow.slice(
    workflow.indexOf('  deploy-backend:'),
    workflow.indexOf('    steps:', workflow.indexOf('  deploy-backend:')),
  );

  assert.match(workflow, /permissions: \{\}/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /google-github-actions\/auth@[0-9a-f]{40}/);
  assert.match(workflow, /access_token_lifetime: 3300s/);
  assert.match(workflow, /npx --no-install firebase --version/);
  assert.match(workflow, /npm ci --legacy-peer-deps --ignore-scripts/);
  assert.doesNotMatch(workflow, /firebase-tools@latest/);
  assert.doesNotMatch(workflow, /npm install -g/);
  assert.doesNotMatch(workflow, /secrets\.FIREBASE_SERVICE_ACCOUNT/);
  assert.doesNotMatch(workflow, /secrets\.FIREBASE_TOKEN/);
  assert.doesNotMatch(workflow, /^\s+FIREBASE_SERVICE_ACCOUNT:/m);
  assert.doesNotMatch(workflow, /^\s+FIREBASE_TOKEN:/m);
  assert.doesNotMatch(workflow, /No .*skipping Firebase deploy/i);
  assert.match(gitignore, /^gha-creds-\*\.json$/m);
  assert.doesNotMatch(backendHeader, /secrets\.GCP_/);

  const installPosition = workflow.indexOf('Install committed deploy dependencies');
  const authPosition = workflow.indexOf('Obtain short-lived Google Cloud credentials');
  const capturePosition = workflow.indexOf('Capture private provider state');
  const postApprovalArtifactPosition = workflow.indexOf(
    'Confirm the prebuilt Pages artifact is still available after approval',
  );
  const postApprovalCiPosition = workflow.indexOf(
    'Revalidate current main and exact CI after protected approval',
  );
  assert.ok(installPosition > 0 && authPosition > installPosition);
  assert.ok(postApprovalArtifactPosition > installPosition);
  assert.ok(postApprovalCiPosition > postApprovalArtifactPosition);
  assert.ok(authPosition > postApprovalCiPosition);
  assert.ok(capturePosition > authPosition);
  assert.match(workflow, /Main advanced after this release was requested/);
  assert.match(workflow, /approved CI run is no longer the newest exact run/);
  assert.match(workflow, /Release request is older than 24 hours/);

  for (const actionLine of workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)) {
    assert.match(actionLine[1], /@[0-9a-f]{40}$/);
  }
});

test('frontend preparation and publication receive no cloud identity', () => {
  const prepareJob = workflow.slice(
    workflow.indexOf('  prepare-pages:'),
    workflow.indexOf('  deploy-backend:'),
  );
  const pagesJob = workflow.slice(workflow.indexOf('  deploy-pages:'));

  assert.doesNotMatch(prepareJob, /id-token:/);
  assert.doesNotMatch(prepareJob, /secrets\.GCP_/);
  assert.doesNotMatch(pagesJob, /id-token:/);
  assert.doesNotMatch(pagesJob, /secrets\.GCP_/);
  assert.doesNotMatch(pagesJob, /^\s+DEPLOY_SERVICE_ACCOUNT:/m);
  assert.doesNotMatch(pagesJob, /^\s+WORKLOAD_IDENTITY_PROVIDER:/m);
  assert.match(prepareJob, /Reject server-credential material/);
  assert.match(pagesJob, /credential separation/);
  assert.equal((workflow.match(/grep -R -q -E/g) ?? []).length, 3);
  assert.doesNotMatch(workflow, /grep -R -E/);
  assert.match(workflow, /secrets\.GCP_WORKLOAD_IDENTITY_PROVIDER/);
  assert.match(workflow, /secrets\.GCP_DEPLOY_SERVICE_ACCOUNT/);
  assert.doesNotMatch(pagesJob, /^    environment:/m);
  assert.doesNotMatch(pagesJob, /^\s+cname:/m);
  assert.equal(fs.existsSync(PUBLIC_CNAME_PATH), false);
});

test('Netlify production Git builds stop while previews remain available', () => {
  assert.match(
    netlifyConfig,
    /ignore = "node \.\/scripts\/netlify-ignore-build\.js"/,
  );

  for (const context of [undefined, 'production', 'future-unknown-context']) {
    const result = runNetlifyGate(context);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /production builds are paused/);
  }

  for (const context of ['deploy-preview', 'branch-deploy']) {
    const result = runNetlifyGate(context);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /may continue/);
  }
});
