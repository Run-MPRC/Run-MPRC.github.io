'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const CONTRACT_PATH = path.join(
  ROOT,
  'scripts/firebase-profile-functions-staging-contract.js',
);
const VALID_DEPLOY_ENVIRONMENT = Object.freeze({
  GCLOUD_PROJECT: 'run-mprc-staging',
  GOOGLE_CLOUD_QUOTA_PROJECT: 'run-mprc-staging',
  FIREBASE_DEPLOY_SCOPE: 'functions:createMemberOnSignUp,functions:ensureMemberProfile',
  RUN_MPRC_FIREBASE_ACCOUNT: 'runmprc@gmail.com',
  FIREBASE_TOKEN: 'synthetic-short-lived-credential',
});

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadContract() {
  // eslint-disable-next-line global-require, import/no-unresolved
  return require('../scripts/firebase-profile-functions-staging-contract');
}

function sourceContract(overrides = {}) {
  return {
    firebaseConfig: readJson('firebase.json'),
    aliases: readJson('.firebaserc'),
    functionIndex: read('functions/index.js'),
    packageJson: readJson('package.json'),
    packageLock: readJson('package-lock.json'),
    ...overrides,
  };
}

test('CI-001D3 accepts only the exact staging profile Function source contract', () => {
  const { validateSourceContract } = loadContract();

  assert.deepEqual(validateSourceContract(sourceContract()), {
    account: 'runmprc@gmail.com',
    cliVersion: '15.24.0',
    defaultProject: 'demo-mprc-local',
    functions: ['createMemberOnSignUp', 'ensureMemberProfile'],
    projectId: 'run-mprc-staging',
    scope: 'functions:createMemberOnSignUp,functions:ensureMemberProfile',
  });
});

test('CI-001D3 rejects a changed deploy alias or Functions codebase', () => {
  const { validateSourceContract } = loadContract();
  const firebaseConfig = readJson('firebase.json');

  for (const defaultProject of [
    'run-mprc-staging',
    'mid-peninsula-running-club',
    'unexpected-project',
  ]) {
    assert.throws(
      () => validateSourceContract(sourceContract({
        aliases: { projects: { default: defaultProject } },
      })),
      /firebase_profile_functions_staging_contract_rejected/u,
    );
  }

  const invalidFunctions = [
    [],
    [{ ...firebaseConfig.functions[0], source: 'another-source' }],
    [{ ...firebaseConfig.functions[0], codebase: 'another-codebase' }],
    [firebaseConfig.functions[0], clone(firebaseConfig.functions[0])],
    [{ ...firebaseConfig.functions[0], extra: true }],
  ];
  invalidFunctions.forEach((functions) => {
    assert.throws(
      () => validateSourceContract(sourceContract({
        firebaseConfig: { ...clone(firebaseConfig), functions },
      })),
      /firebase_profile_functions_staging_contract_rejected/u,
    );
  });
});

test('CI-001D3 rejects missing or redirected profile exports', () => {
  const { validateSourceContract } = loadContract();
  const functionIndex = read('functions/index.js');
  const invalidSources = [
    functionIndex.replace('exports.createMemberOnSignUp = onSignUp;', ''),
    functionIndex.replace(
      'exports.ensureMemberProfile = ensureMemberProfile;',
      'exports.ensureMemberProfile = updateMemberRole;',
    ),
    `${functionIndex}\nexports.ensureMemberProfile = ensureMemberProfile;\n`,
  ];

  invalidSources.forEach((invalid) => {
    assert.throws(
      () => validateSourceContract(sourceContract({ functionIndex: invalid })),
      /firebase_profile_functions_staging_contract_rejected/u,
    );
  });
});

test('CI-001D3 rejects changed scripts or an unpinned Firebase CLI', () => {
  const { validateSourceContract } = loadContract();
  const packageJson = readJson('package.json');
  const packageLock = readJson('package-lock.json');
  const invalidPackages = [
    {
      ...clone(packageJson),
      scripts: {
        ...packageJson.scripts,
        'deploy:staging-profile-functions': 'firebase deploy --only functions',
      },
    },
    {
      ...clone(packageJson),
      devDependencies: { ...packageJson.devDependencies, 'firebase-tools': 'latest' },
    },
  ];

  invalidPackages.forEach((invalid) => {
    assert.throws(
      () => validateSourceContract(sourceContract({ packageJson: invalid })),
      /firebase_profile_functions_staging_contract_rejected/u,
    );
  });

  const invalidLock = clone(packageLock);
  invalidLock.packages['node_modules/firebase-tools'].version = '15.23.0';
  assert.throws(
    () => validateSourceContract(sourceContract({ packageLock: invalidLock })),
    /firebase_profile_functions_staging_contract_rejected/u,
  );
});

test('CI-001D3 deploy context is exact, two-Function-only, and token-bound', () => {
  const { validateDeployEnvironment } = loadContract();

  assert.deepEqual(validateDeployEnvironment(VALID_DEPLOY_ENVIRONMENT), {
    account: 'runmprc@gmail.com',
    projectId: 'run-mprc-staging',
    scope: 'functions:createMemberOnSignUp,functions:ensureMemberProfile',
  });

  const invalidEnvironments = [
    { ...VALID_DEPLOY_ENVIRONMENT, GCLOUD_PROJECT: 'mid-peninsula-running-club' },
    { ...VALID_DEPLOY_ENVIRONMENT, GOOGLE_CLOUD_QUOTA_PROJECT: 'another-project' },
    { ...VALID_DEPLOY_ENVIRONMENT, FIREBASE_DEPLOY_SCOPE: 'functions' },
    { ...VALID_DEPLOY_ENVIRONMENT, FIREBASE_DEPLOY_SCOPE: 'functions:ensureMemberProfile' },
    { ...VALID_DEPLOY_ENVIRONMENT, FIREBASE_DEPLOY_SCOPE: `${VALID_DEPLOY_ENVIRONMENT.FIREBASE_DEPLOY_SCOPE},functions:stripeWebhook` },
    { ...VALID_DEPLOY_ENVIRONMENT, FIREBASE_DEPLOY_SCOPE: `${VALID_DEPLOY_ENVIRONMENT.FIREBASE_DEPLOY_SCOPE},firestore:rules` },
    { ...VALID_DEPLOY_ENVIRONMENT, FIREBASE_DEPLOY_SCOPE: 'auth' },
    { ...VALID_DEPLOY_ENVIRONMENT, FIREBASE_DEPLOY_SCOPE: 'hosting' },
    { ...VALID_DEPLOY_ENVIRONMENT, FIREBASE_DEPLOY_SCOPE: 'storage' },
    { ...VALID_DEPLOY_ENVIRONMENT, RUN_MPRC_FIREBASE_ACCOUNT: 'another@example.invalid' },
    { ...VALID_DEPLOY_ENVIRONMENT, FIREBASE_TOKEN: '' },
    { ...VALID_DEPLOY_ENVIRONMENT, GOOGLE_APPLICATION_CREDENTIALS: '/tmp/credential.json' },
    { ...VALID_DEPLOY_ENVIRONMENT, GOOGLE_GHA_CREDS_PATH: '/tmp/github-credential.json' },
    { ...VALID_DEPLOY_ENVIRONMENT, CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: '/tmp/gcloud-credential.json' },
    { ...VALID_DEPLOY_ENVIRONMENT, FIREBASE_SERVICE_ACCOUNT: '{}' },
  ];

  invalidEnvironments.forEach((invalid) => {
    assert.throws(
      () => validateDeployEnvironment(invalid),
      /firebase_profile_functions_staging_contract_rejected/u,
    );
  });
});

test('CI-001D3 pins an argument-closed two-Function Firebase command in CI', () => {
  const {
    DEPLOY_SCOPE,
    FIREBASE_CLI_VERSION,
    FUNCTION_IDS,
    firebaseDeployArguments,
  } = loadContract();
  const packageJson = readJson('package.json');
  const ci = read('.github/workflows/ci.yml');

  assert.equal(FIREBASE_CLI_VERSION, '15.24.0');
  assert.deepEqual(FUNCTION_IDS, [
    'createMemberOnSignUp',
    'ensureMemberProfile',
  ]);
  assert.equal(
    DEPLOY_SCOPE,
    'functions:createMemberOnSignUp,functions:ensureMemberProfile',
  );
  assert.deepEqual(firebaseDeployArguments(), [
    '--no-install',
    'firebase',
    'deploy',
    '--only',
    DEPLOY_SCOPE,
    '--project',
    'run-mprc-staging',
    '--non-interactive',
  ]);
  assert.equal(
    packageJson.scripts['deploy:staging-profile-functions'],
    'node scripts/firebase-profile-functions-staging-contract.js deploy',
  );
  assert.match(ci, /tests\/firebase-profile-functions-staging-contract\.test\.js/u);
  assert.doesNotMatch(ci, /deploy:staging-profile-functions|FIREBASE_TOKEN/u);
});

test('CI-001D3 checks the lockfile CLI before invoking the exact deployment', () => {
  const { deploy, firebaseDeployArguments } = loadContract();
  const calls = [];
  const fakeSpawn = (executable, args, options) => {
    calls.push({ executable, args, stdio: options.stdio });
    if (args.includes('--version')) return { status: 0, stdout: '15.24.0\n' };
    return { status: 0 };
  };

  assert.equal(deploy(VALID_DEPLOY_ENVIRONMENT, fakeSpawn), 0);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, [
    '--no-install',
    'firebase',
    '--version',
  ]);
  assert.equal(calls[0].stdio, undefined);
  assert.deepEqual(calls[1].args, firebaseDeployArguments());
  assert.equal(calls[1].stdio, 'inherit');

  assert.throws(
    () => deploy(VALID_DEPLOY_ENVIRONMENT, () => ({
      status: 0,
      stdout: '99.0.0\n',
    })),
    /firebase_profile_functions_staging_contract_rejected/u,
  );
});

test('CI-001D3 CLI failures are fixed and never attempt deployment with extra arguments', () => {
  const canary = 'private-profile-functions-context-canary';
  const invalidContext = spawnSync(
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
  const unexpectedArgument = spawnSync(
    process.execPath,
    [CONTRACT_PATH, 'deploy', '--only', 'functions'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...VALID_DEPLOY_ENVIRONMENT },
    },
  );

  for (const result of [invalidContext, unexpectedArgument]) {
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(
      result.stderr,
      'firebase_profile_functions_staging_contract_rejected\n',
    );
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(canary, 'u'));
  }
});
