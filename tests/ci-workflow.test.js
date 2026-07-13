const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const CI_PATH = path.join(ROOT, '.github/workflows/ci.yml');
const RELEASE_PATH = path.join(ROOT, '.github/workflows/deploy.yml');
const ciWorkflow = fs.readFileSync(CI_PATH, 'utf8');
const releaseWorkflow = fs.readFileSync(RELEASE_PATH, 'utf8');

const JOB_ID = 'commerce-command-journal';
const JOB_NAME = 'Commerce command journal emulator';
const DEMO_PROJECT = 'demo-pay002b2-test';
const OPT_IN = 'REQUIRE_COMMERCE_COMMAND_JOURNAL_EMULATOR';
const TEST_FILE = 'commerceCommandJournal.emulator.test.js';
const NEVER_RUN = ['$', '{{ false }}'].join('');
const ALWAYS_TRUE = ['$', '{{ true }}'].join('');

function jobBlock(workflow, jobId) {
  const startMarker = `  ${jobId}:\n`;
  const start = workflow.indexOf(startMarker);
  if (start < 0) return '';

  const remainder = workflow.slice(start + startMarker.length);
  const nextJob = /\n {2}[a-z0-9-]+:\n/.exec(remainder);
  const end = nextJob === null
    ? workflow.length
    : start + startMarker.length + nextJob.index;
  return workflow.slice(start, end);
}

function ciErrors(workflow) {
  const errors = [];
  const block = jobBlock(workflow, JOB_ID);
  if (!block) return ['missing job'];

  const checks = [
    [`name: ${JOB_NAME}`, 'wrong job name'],
    ["node-version: '20'", 'wrong Node version'],
    ["distribution: 'temurin'", 'missing Java distribution'],
    ["java-version: '17'", 'wrong Java version'],
    ['npm ci --legacy-peer-deps --ignore-scripts', 'root install is not locked'],
    ['npm --prefix functions ci --ignore-scripts', 'Functions install is not locked'],
    [`${OPT_IN}: '1'`, 'missing explicit opt-in'],
    ['npx --no-install firebase emulators:exec', 'Firebase CLI is not lockfile-bound'],
    [`--project ${DEMO_PROJECT}`, 'wrong demo project'],
    ['--only firestore', 'emulator scope is not Firestore-only'],
    ['--runInBand', 'Jest is not in band'],
    [TEST_FILE, 'wrong focused test'],
  ];
  checks.forEach(([required, message]) => {
    if (!block.includes(required)) errors.push(message);
  });

  if ((workflow.match(new RegExp(`name: ${JOB_NAME}`, 'g')) ?? []).length !== 1) {
    errors.push('job name must occur exactly once');
  }
  if (/^\s+if\s*:/m.test(block)) errors.push('job or step may be skipped');
  if (/continue-on-error\s*:/.test(block)) errors.push('job may ignore failure');
  if (/\|\|\s*true\b|;\s*true\b|\bset\s+\+e\b/.test(block)) {
    errors.push('job may swallow command failure');
  }
  if (/firebase-tools@|npm install -g/.test(block)) errors.push('uncommitted CLI install');
  if (/--only\s+(?:[^\n]*,|auth|functions)/.test(block)) errors.push('broad emulator scope');
  if (/secrets\.|FIREBASE_SERVICE_ACCOUNT|FIREBASE_TOKEN|STRIPE_SECRET/.test(block)) {
    errors.push('job receives a secret or cloud credential');
  }
  if (/mid-peninsula-running-club|runmprc-97922/.test(block)) {
    errors.push('job names a hosted project');
  }
  return errors;
}

function releaseErrors(workflow) {
  const errors = [];
  const requiredName = `"${JOB_NAME}"`;
  const preflight = jobBlock(workflow, 'preflight');
  const backend = jobBlock(workflow, 'deploy-backend');
  if ((preflight.match(new RegExp(requiredName, 'g')) ?? []).length !== 1) {
    errors.push('preflight must require the job exactly once');
  }
  if ((backend.match(new RegExp(requiredName, 'g')) ?? []).length !== 1) {
    errors.push('post-approval check must require the job exactly once');
  }
  return errors;
}

test('journal emulator CI job is exact, isolated, and blocking', () => {
  assert.deepEqual(ciErrors(ciWorkflow), []);
  assert.deepEqual(releaseErrors(releaseWorkflow), []);
});

test('guard rejects missing, renamed, broadened, or unsafe CI wiring', () => {
  const mutations = [
    ciWorkflow.replace(`  ${JOB_ID}:\n`, '  removed-journal-job:\n'),
    ciWorkflow.replace(`name: ${JOB_NAME}`, 'name: Generic emulator'),
    ciWorkflow.replace(`--project ${DEMO_PROJECT}`, '--project demo-other-test'),
    ciWorkflow.replace(`${OPT_IN}: '1'`, `${OPT_IN}: '0'`),
    ciWorkflow.replace('--only firestore', '--only auth,firestore'),
    ciWorkflow.replace('npx --no-install firebase', 'npx firebase-tools@latest'),
    ciWorkflow.replace(TEST_FILE, 'another.test.js'),
    ciWorkflow.replace('timeout-minutes: 10', `continue-on-error: ${ALWAYS_TRUE}`),
    ciWorkflow.replace(
      '        run: >-\n          npx --no-install firebase emulators:exec',
      `        if: ${NEVER_RUN}\n`
        + '        run: >-\n          npx --no-install firebase emulators:exec',
    ),
    ciWorkflow.replace(TEST_FILE, `${TEST_FILE} || true`),
  ];

  mutations.forEach((mutated) => assert.notDeepEqual(ciErrors(mutated), []));
});

test('guard rejects omission from either protected-release recheck', () => {
  const requiredLine = `            "${JOB_NAME}" \\\n`;
  const withoutFirst = releaseWorkflow.replace(requiredLine, '');
  assert.notDeepEqual(releaseErrors(withoutFirst), []);

  const secondIndex = releaseWorkflow.lastIndexOf(requiredLine);
  const withoutSecond = releaseWorkflow.slice(0, secondIndex)
    + releaseWorkflow.slice(secondIndex + requiredLine.length);
  assert.notDeepEqual(releaseErrors(withoutSecond), []);

  const duplicatedOnlyInPreflight = withoutSecond.replace(
    requiredLine,
    requiredLine + requiredLine,
  );
  assert.notDeepEqual(releaseErrors(duplicatedOnlyInPreflight), []);
});
