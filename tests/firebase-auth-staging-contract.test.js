'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const CONTRACT_PATH = path.join(
  ROOT,
  'scripts/firebase-auth-staging-contract.js',
);
const VALID_DEPLOY_ENVIRONMENT = Object.freeze({
  GCLOUD_PROJECT: 'run-mprc-staging',
  GOOGLE_CLOUD_QUOTA_PROJECT: 'run-mprc-staging',
  FIREBASE_DEPLOY_SCOPE: 'auth',
  RUN_MPRC_FIREBASE_ACCOUNT: 'runmprc@gmail.com',
  FIREBASE_TOKEN: 'synthetic-short-lived-credential',
});

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadContract() {
  // eslint-disable-next-line global-require, import/no-unresolved
  return require('../scripts/firebase-auth-staging-contract');
}

test('CI-001D2 source enables only password-required email Auth', () => {
  const { validateSourceContract } = loadContract();
  const firebaseConfig = JSON.parse(read('firebase.json'));
  const aliases = JSON.parse(read('.firebaserc'));

  assert.deepEqual(firebaseConfig.auth, {
    providers: {
      emailPassword: true,
    },
  });
  assert.deepEqual(validateSourceContract(firebaseConfig, aliases), {
    defaultProject: 'demo-mprc-local',
    provider: 'emailPassword',
  });
});

test('CI-001D2 rejects broader providers and deploy aliases', () => {
  const { validateSourceContract } = loadContract();
  const firebaseConfig = JSON.parse(read('firebase.json'));
  const aliases = JSON.parse(read('.firebaserc'));
  const invalidConfigs = [
    { ...clone(firebaseConfig), auth: { providers: { emailPassword: false } } },
    { ...clone(firebaseConfig), auth: { providers: { emailPassword: true, anonymous: true } } },
    { ...clone(firebaseConfig), auth: { providers: { emailPassword: true, googleSignIn: {} } } },
    { ...clone(firebaseConfig), auth: { providers: { emailPassword: true, phone: {} } } },
    { ...clone(firebaseConfig), auth: { providers: { emailPassword: true }, extra: true } },
  ];

  invalidConfigs.forEach((invalid) => {
    assert.throws(
      () => validateSourceContract(invalid, aliases),
      /firebase_auth_staging_contract_rejected/u,
    );
  });

  [
    'run-mprc-staging',
    'mid-peninsula-running-club',
    'unexpected-project',
  ].forEach((defaultProject) => {
    assert.throws(
      () => validateSourceContract(firebaseConfig, {
        projects: { default: defaultProject },
      }),
      /firebase_auth_staging_contract_rejected/u,
    );
  });
});

test('CI-001D2 deploy context is exact, Auth-only, and token-bound', () => {
  const { validateDeployEnvironment } = loadContract();

  assert.deepEqual(validateDeployEnvironment(VALID_DEPLOY_ENVIRONMENT), {
    account: 'runmprc@gmail.com',
    projectId: 'run-mprc-staging',
    scope: 'auth',
  });

  const invalidEnvironments = [
    { ...VALID_DEPLOY_ENVIRONMENT, GCLOUD_PROJECT: 'mid-peninsula-running-club' },
    { ...VALID_DEPLOY_ENVIRONMENT, GOOGLE_CLOUD_QUOTA_PROJECT: 'another-project' },
    { ...VALID_DEPLOY_ENVIRONMENT, FIREBASE_DEPLOY_SCOPE: 'auth,firestore' },
    { ...VALID_DEPLOY_ENVIRONMENT, RUN_MPRC_FIREBASE_ACCOUNT: 'another@example.invalid' },
    { ...VALID_DEPLOY_ENVIRONMENT, FIREBASE_TOKEN: '' },
    { ...VALID_DEPLOY_ENVIRONMENT, GOOGLE_APPLICATION_CREDENTIALS: '/tmp/credential.json' },
  ];

  invalidEnvironments.forEach((invalid) => {
    assert.throws(
      () => validateDeployEnvironment(invalid),
      /firebase_auth_staging_contract_rejected/u,
    );
  });
});

test('CI-001D2 pins the focused test and guarded deploy command', () => {
  const packageJson = JSON.parse(read('package.json'));
  const ci = read('.github/workflows/ci.yml');

  assert.equal(
    packageJson.scripts['test:firebase-auth-staging'],
    'node --test tests/firebase-auth-staging-contract.test.js',
  );
  assert.equal(
    packageJson.scripts['predeploy:staging-auth'],
    'node scripts/firebase-auth-staging-contract.js validate-deploy',
  );
  assert.equal(
    packageJson.scripts['deploy:staging-auth'],
    'npx --no-install firebase deploy --only auth --project run-mprc-staging --non-interactive',
  );
  assert.match(ci, /tests\/firebase-auth-staging-contract\.test\.js/u);
  assert.doesNotMatch(ci, /deploy:staging-auth|FIREBASE_TOKEN/u);
});

test('CI-001D2 CLI failures are fixed and do not echo supplied context', () => {
  const canary = 'private-auth-context-canary';
  const result = spawnSync(
    process.execPath,
    [CONTRACT_PATH, 'validate-deploy'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...VALID_DEPLOY_ENVIRONMENT,
        GCLOUD_PROJECT: canary,
        FIREBASE_TOKEN: canary,
      },
    },
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'firebase_auth_staging_contract_rejected\n');
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(canary, 'u'));
});
