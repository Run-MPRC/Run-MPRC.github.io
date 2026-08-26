'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const STAGING_CONTRACT_PATH = path.join(
  ROOT,
  'scripts/firebase-hosting-staging-contract.js',
);
const STAGING_APP_CHECK_SITE_KEY = (
  '6LcA1B2C3D4E5F6G7H8J9K0M1N2P3Q4R5S6T7U8'
);
const PRODUCTION_BUILD_ENVIRONMENT = Object.freeze({
  REACT_APP_FIREBASE_ENVIRONMENT: 'production',
  REACT_APP_FIREBASE_API_KEY: 'AIzaSyD2u17HMhDPZ0Tn9D3H71fep1vZgT-njnw',
  REACT_APP_FIREBASE_AUTH_DOMAIN: 'mid-peninsula-running-club.firebaseapp.com',
  REACT_APP_FIREBASE_PROJECT_ID: 'mid-peninsula-running-club',
  REACT_APP_FIREBASE_STORAGE_BUCKET: 'mid-peninsula-running-club.firebasestorage.app',
  REACT_APP_FIREBASE_MESSAGING_SENDER_ID: '253289716314',
  REACT_APP_FIREBASE_APP_ID: '1:253289716314:web:dcad9766d820044d7f9663',
  REACT_APP_FIREBASE_MEASUREMENT_ID: 'G-ECN7TT0BGF',
});
const STAGING_BUILD_ENVIRONMENT = Object.freeze({
  REACT_APP_FIREBASE_ENVIRONMENT: 'staging',
  REACT_APP_FIREBASE_API_KEY: 'synthetic-ci-api-key-not-a-credential',
  REACT_APP_FIREBASE_AUTH_DOMAIN: 'mprc-staging-ci.firebaseapp.com',
  REACT_APP_FIREBASE_PROJECT_ID: 'mprc-staging-ci',
  REACT_APP_FIREBASE_STORAGE_BUCKET: 'mprc-staging-ci.firebasestorage.app',
  REACT_APP_FIREBASE_MESSAGING_SENDER_ID: '100000000001',
  REACT_APP_FIREBASE_APP_ID: '1:100000000001:web:abcdef0123456789',
});
const STAGING_DEPLOY_ENVIRONMENT = Object.freeze({
  ...STAGING_BUILD_ENVIRONMENT,
  REACT_APP_RECAPTCHA_SITE_KEY: STAGING_APP_CHECK_SITE_KEY,
  GCLOUD_PROJECT: 'mprc-staging-ci',
});
const EXACT_STAGING_DEPLOY_ENVIRONMENT = Object.freeze({
  ...STAGING_BUILD_ENVIRONMENT,
  REACT_APP_FIREBASE_API_KEY: 'synthetic-staging-api-key-1234567890',
  REACT_APP_FIREBASE_AUTH_DOMAIN: 'run-mprc-staging.firebaseapp.com',
  REACT_APP_FIREBASE_PROJECT_ID: 'run-mprc-staging',
  REACT_APP_FIREBASE_STORAGE_BUCKET: 'run-mprc-staging.firebasestorage.app',
  REACT_APP_FIREBASE_MESSAGING_SENDER_ID: '100000000002',
  REACT_APP_FIREBASE_APP_ID: '1:100000000002:web:abcdef0123456789',
  REACT_APP_RECAPTCHA_SITE_KEY: STAGING_APP_CHECK_SITE_KEY,
  GCLOUD_PROJECT: 'run-mprc-staging',
  GOOGLE_CLOUD_QUOTA_PROJECT: 'run-mprc-staging',
  FIREBASE_DEPLOY_SCOPE: 'hosting',
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

function loadStagingContract() {
  // eslint-disable-next-line global-require, import/no-unresolved
  return require('../scripts/firebase-hosting-staging-contract');
}

function stagingSourceContract(overrides = {}) {
  return {
    firebaseConfig: readJson('firebase.json'),
    aliases: readJson('.firebaserc'),
    packageJson: readJson('package.json'),
    packageLock: readJson('package-lock.json'),
    ...overrides,
  };
}

test('WEB-001A1 keeps an unqualified Firebase CLI target in the local demo namespace', () => {
  const aliases = JSON.parse(read('.firebaserc'));

  assert.equal(aliases.projects?.default, 'demo-mprc-local');
  assert.notEqual(aliases.projects?.default, 'mid-peninsula-running-club');
});

test('WEB-001A1 configures Firebase Hosting as one static SPA without a live target', () => {
  const config = JSON.parse(read('firebase.json'));

  assert.deepEqual(config.hosting, {
    public: 'build',
    predeploy: [
      'node scripts/firebase-hosting-contract.js validate-deploy',
      'npm run build',
      'node scripts/firebase-hosting-contract.js verify build',
    ],
    ignore: [
      'firebase.json',
      '**/.*',
      '**/node_modules/**',
    ],
    rewrites: [
      {
        source: '**',
        destination: '/index.html',
      },
    ],
  });
  assert.equal(config.targets, undefined);
});

test('WEB-001A1 controlled optimized builds validate an explicit Firebase environment', () => {
  const packageJson = JSON.parse(read('package.json'));
  const ci = read('.github/workflows/ci.yml');
  const release = read('.github/workflows/deploy.yml');
  const netlifyBuilder = read('scripts/netlify-release-build.js');

  assert.match(
    packageJson.scripts.prebuild,
    /node scripts\/firebase-hosting-contract\.js validate/u,
  );
  assert.match(ci, /REACT_APP_FIREBASE_ENVIRONMENT: 'staging'/u);
  assert.match(ci, /node scripts\/firebase-hosting-contract\.js verify build/u);
  assert.match(release, /REACT_APP_FIREBASE_ENVIRONMENT: 'production'/u);
  assert.match(
    netlifyBuilder,
    /REACT_APP_FIREBASE_ENVIRONMENT: 'production'/u,
  );
  assert.match(
    netlifyBuilder,
    /REACT_APP_FIREBASE_ENVIRONMENT: 'staging'/u,
  );
});

test('WEB-001A1 validates staging fields and rejects production identities', () => {
  // eslint-disable-next-line global-require, import/no-unresolved
  const contract = require('../scripts/firebase-hosting-contract');

  assert.deepEqual(contract.validateBuildEnvironment(STAGING_BUILD_ENVIRONMENT), {
    environment: 'staging',
    projectId: 'mprc-staging-ci',
  });
  assert.deepEqual(contract.validateBuildEnvironment(
    PRODUCTION_BUILD_ENVIRONMENT,
  ), {
    environment: 'production',
    projectId: 'mid-peninsula-running-club',
  });

  assert.throws(
    () => contract.validateBuildEnvironment({}),
    /firebase_hosting_contract_rejected/u,
  );
  assert.throws(
    () => contract.validateBuildEnvironment({
      ...PRODUCTION_BUILD_ENVIRONMENT,
      REACT_APP_FIREBASE_APP_ID: '1:253289716314:web:wrongproductionapp',
    }),
    /firebase_hosting_contract_rejected/u,
  );
  assert.throws(
    () => contract.validateBuildEnvironment({
      ...STAGING_BUILD_ENVIRONMENT,
      REACT_APP_FIREBASE_PROJECT_ID: 'mid-peninsula-running-club',
    }),
    /firebase_hosting_contract_rejected/u,
  );
  assert.throws(
    () => contract.validateBuildEnvironment({
      ...STAGING_BUILD_ENVIRONMENT,
      REACT_APP_FIREBASE_APP_ID: undefined,
    }),
    /firebase_hosting_contract_rejected/u,
  );
  assert.throws(
    () => contract.validateBuildEnvironment({
      ...STAGING_BUILD_ENVIRONMENT,
      REACT_APP_FIREBASE_API_KEY: PRODUCTION_BUILD_ENVIRONMENT.REACT_APP_FIREBASE_API_KEY,
    }),
    /firebase_hosting_contract_rejected/u,
  );
  assert.throws(
    () => contract.validateBuildEnvironment({
      ...STAGING_BUILD_ENVIRONMENT,
      REACT_APP_FIREBASE_MEASUREMENT_ID: (
        PRODUCTION_BUILD_ENVIRONMENT.REACT_APP_FIREBASE_MEASUREMENT_ID
      ),
    }),
    /firebase_hosting_contract_rejected/u,
  );
  assert.throws(
    () => contract.validateBuildEnvironment({
      ...STAGING_BUILD_ENVIRONMENT,
      REACT_APP_FIREBASE_AUTH_DOMAIN: 'mprc-preview-ci.firebaseapp.com',
      REACT_APP_FIREBASE_PROJECT_ID: 'mprc-preview-ci',
      REACT_APP_FIREBASE_STORAGE_BUCKET: 'mprc-preview-ci.firebasestorage.app',
    }),
    /firebase_hosting_contract_rejected/u,
  );
  assert.throws(
    () => contract.validateBuildEnvironment({
      ...PRODUCTION_BUILD_ENVIRONMENT,
      REACT_APP_FIREBASE_MEASUREMENT_ID: undefined,
    }),
    /firebase_hosting_contract_rejected/u,
  );
});

test('WEB-001A1 binds a Hosting deploy to the selected Firebase project', () => {
  // eslint-disable-next-line global-require, import/no-unresolved
  const contract = require('../scripts/firebase-hosting-contract');

  assert.deepEqual(contract.validateDeployEnvironment({
    ...STAGING_DEPLOY_ENVIRONMENT,
  }), {
    environment: 'staging',
    projectId: 'mprc-staging-ci',
  });
  assert.throws(
    () => contract.validateDeployEnvironment({
      ...STAGING_DEPLOY_ENVIRONMENT,
      GCLOUD_PROJECT: 'mid-peninsula-running-club',
    }),
    /firebase_hosting_contract_rejected/u,
  );
  assert.throws(
    () => contract.validateDeployEnvironment(STAGING_BUILD_ENVIRONMENT),
    /firebase_hosting_contract_rejected/u,
  );
});

test('CI-001D4 requires a bounded non-placeholder App Check key only for staging deploys', () => {
  // eslint-disable-next-line global-require, import/no-unresolved
  const contract = require('../scripts/firebase-hosting-contract');

  assert.deepEqual(contract.validateBuildEnvironment(STAGING_BUILD_ENVIRONMENT), {
    environment: 'staging',
    projectId: 'mprc-staging-ci',
  });

  const invalidSiteKeys = [
    undefined,
    '',
    ' public-site-key ',
    'configured-public-site-key',
    'A'.repeat(29),
    'A'.repeat(129),
    '6Lc-invalid-site-key-with-asterisk-*',
    PRODUCTION_BUILD_ENVIRONMENT.REACT_APP_FIREBASE_API_KEY,
  ];
  invalidSiteKeys.forEach((siteKey) => {
    assert.throws(
      () => contract.validateDeployEnvironment({
        ...STAGING_DEPLOY_ENVIRONMENT,
        REACT_APP_RECAPTCHA_SITE_KEY: siteKey,
      }),
      /firebase_hosting_contract_rejected/u,
    );
  });
});

test('WEB-001A1 CLI failures are fixed and do not echo supplied configuration', () => {
  const canary = 'private-build-value-canary';
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'firebase-hosting-contract.js'), 'validate'],
    {
      encoding: 'utf8',
      env: {
        REACT_APP_FIREBASE_ENVIRONMENT: 'staging',
        REACT_APP_FIREBASE_API_KEY: canary,
      },
    },
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'firebase_hosting_contract_rejected\n');
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(canary, 'u'));
});

test('WEB-001A1 executable staging artifacts prove staging identity and reject production identity', (t) => {
  // eslint-disable-next-line global-require, import/no-unresolved
  const contract = require('../scripts/firebase-hosting-contract');
  const fixture = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'mprc-hosting-'));
  t.after(() => fs.rmSync(fixture, { force: true, recursive: true }));
  fs.mkdirSync(path.join(fixture, 'static', 'js'), { recursive: true });
  fs.writeFileSync(
    path.join(fixture, 'static', 'js', 'main.example.js'),
    `const config=${JSON.stringify(STAGING_BUILD_ENVIRONMENT)};\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(fixture, 'static', 'js', 'main.example.js.map'),
    'mid-peninsula-running-club',
    'utf8',
  );

  assert.deepEqual(contract.verifyExecutableArtifact(
    fixture,
    STAGING_BUILD_ENVIRONMENT,
  ), {
    environment: 'staging',
    executableFileCount: 1,
  });

  fs.writeFileSync(
    path.join(fixture, 'static', 'js', 'main.example.js'),
    'const project="mid-peninsula-running-club";\n',
    'utf8',
  );
  assert.throws(
    () => contract.verifyExecutableArtifact(fixture, STAGING_BUILD_ENVIRONMENT),
    /firebase_hosting_contract_rejected/u,
  );
});

test('CI-001D4 executable staging artifact contains the selected App Check key', (t) => {
  // eslint-disable-next-line global-require, import/no-unresolved
  const contract = require('../scripts/firebase-hosting-contract');
  const fixture = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'mprc-app-check-'));
  t.after(() => fs.rmSync(fixture, { force: true, recursive: true }));
  fs.mkdirSync(path.join(fixture, 'static', 'js'), { recursive: true });

  fs.writeFileSync(
    path.join(fixture, 'static', 'js', 'main.example.js'),
    `const config=${JSON.stringify(STAGING_DEPLOY_ENVIRONMENT)};\n`,
    'utf8',
  );
  assert.deepEqual(contract.verifyExecutableArtifact(
    fixture,
    STAGING_DEPLOY_ENVIRONMENT,
  ), {
    environment: 'staging',
    executableFileCount: 1,
  });

  fs.writeFileSync(
    path.join(fixture, 'static', 'js', 'main.example.js'),
    `const config=${JSON.stringify(STAGING_BUILD_ENVIRONMENT)};\n`,
    'utf8',
  );
  assert.throws(
    () => contract.verifyExecutableArtifact(fixture, STAGING_DEPLOY_ENVIRONMENT),
    /firebase_hosting_contract_rejected/u,
  );
});

test('CI-001D4 accepts only the exact staging Hosting source contract', () => {
  const { validateSourceContract } = loadStagingContract();

  assert.deepEqual(validateSourceContract(stagingSourceContract()), {
    account: 'runmprc@gmail.com',
    cliVersion: '15.24.0',
    defaultProject: 'demo-mprc-local',
    projectId: 'run-mprc-staging',
    scope: 'hosting',
  });
});

test('CI-001D4 rejects changed Hosting scripts, aliases, config, or CLI pin', () => {
  const { validateSourceContract } = loadStagingContract();
  const packageJson = readJson('package.json');
  const packageLock = readJson('package-lock.json');
  const firebaseConfig = readJson('firebase.json');

  const changedScript = clone(packageJson);
  changedScript.scripts['deploy:staging-hosting'] = 'firebase deploy --only hosting';
  const changedCli = clone(packageJson);
  changedCli.devDependencies['firebase-tools'] = 'latest';
  const changedLock = clone(packageLock);
  changedLock.packages['node_modules/firebase-tools'].version = '15.23.0';
  const changedHosting = clone(firebaseConfig);
  changedHosting.hosting.predeploy = ['npm run build'];

  [
    stagingSourceContract({ packageJson: changedScript }),
    stagingSourceContract({ packageJson: changedCli }),
    stagingSourceContract({ packageLock: changedLock }),
    stagingSourceContract({ firebaseConfig: changedHosting }),
    stagingSourceContract({ aliases: { projects: { default: 'run-mprc-staging' } } }),
  ].forEach((invalid) => {
    assert.throws(
      () => validateSourceContract(invalid),
      /firebase_hosting_staging_contract_rejected/u,
    );
  });
});

test('CI-001D4 deploy context is exact, Hosting-only, and token-bound', () => {
  const { validateDeployEnvironment } = loadStagingContract();

  assert.deepEqual(validateDeployEnvironment(EXACT_STAGING_DEPLOY_ENVIRONMENT), {
    account: 'runmprc@gmail.com',
    projectId: 'run-mprc-staging',
    scope: 'hosting',
  });

  const invalidEnvironments = [
    { ...EXACT_STAGING_DEPLOY_ENVIRONMENT, GCLOUD_PROJECT: 'mid-peninsula-running-club' },
    { ...EXACT_STAGING_DEPLOY_ENVIRONMENT, GOOGLE_CLOUD_QUOTA_PROJECT: 'another-project' },
    { ...EXACT_STAGING_DEPLOY_ENVIRONMENT, FIREBASE_DEPLOY_SCOPE: 'hosting,auth' },
    { ...EXACT_STAGING_DEPLOY_ENVIRONMENT, FIREBASE_DEPLOY_SCOPE: 'functions' },
    { ...EXACT_STAGING_DEPLOY_ENVIRONMENT, RUN_MPRC_FIREBASE_ACCOUNT: 'another@example.invalid' },
    { ...EXACT_STAGING_DEPLOY_ENVIRONMENT, FIREBASE_TOKEN: '' },
    { ...EXACT_STAGING_DEPLOY_ENVIRONMENT, REACT_APP_FIREBASE_PROJECT_ID: 'mprc-staging-ci' },
    { ...EXACT_STAGING_DEPLOY_ENVIRONMENT, REACT_APP_RECAPTCHA_SITE_KEY: 'public-site-key' },
    { ...EXACT_STAGING_DEPLOY_ENVIRONMENT, GOOGLE_APPLICATION_CREDENTIALS: '/tmp/credential.json' },
    { ...EXACT_STAGING_DEPLOY_ENVIRONMENT, GOOGLE_GHA_CREDS_PATH: '/tmp/github-credential.json' },
    { ...EXACT_STAGING_DEPLOY_ENVIRONMENT, CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: '/tmp/gcloud-credential.json' },
    { ...EXACT_STAGING_DEPLOY_ENVIRONMENT, FIREBASE_SERVICE_ACCOUNT: '{}' },
  ];
  invalidEnvironments.forEach((invalid) => {
    assert.throws(
      () => validateDeployEnvironment(invalid),
      /firebase_hosting_staging_contract_rejected/u,
    );
  });
});

test('CI-001D4 pins an argument-closed Hosting deploy command', () => {
  const {
    DEPLOY_SCOPE,
    FIREBASE_CLI_VERSION,
    firebaseDeployArguments,
  } = loadStagingContract();
  const packageJson = readJson('package.json');

  assert.equal(DEPLOY_SCOPE, 'hosting');
  assert.equal(FIREBASE_CLI_VERSION, '15.24.0');
  assert.deepEqual(firebaseDeployArguments(), [
    '--no-install',
    'firebase',
    'deploy',
    '--only',
    'hosting',
    '--project',
    'run-mprc-staging',
    '--non-interactive',
  ]);
  assert.equal(
    packageJson.scripts['predeploy:staging-hosting'],
    'node scripts/firebase-hosting-staging-contract.js validate-deploy',
  );
  assert.equal(
    packageJson.scripts['deploy:staging-hosting'],
    'node scripts/firebase-hosting-staging-contract.js deploy',
  );
});

test('CI-001D4 checks the lockfile CLI before exact Hosting deployment', () => {
  const { deploy, firebaseDeployArguments } = loadStagingContract();
  const calls = [];
  const fakeSpawn = (executable, args, options) => {
    calls.push({ executable, args, stdio: options.stdio });
    if (args.includes('--version')) return { status: 0, stdout: '15.24.0\n' };
    return { status: 0 };
  };

  assert.equal(deploy(EXACT_STAGING_DEPLOY_ENVIRONMENT, fakeSpawn), 0);
  assert.deepEqual(calls.map(({ args }) => args), [
    ['--no-install', 'firebase', '--version'],
    firebaseDeployArguments(),
  ]);
  assert.equal(calls[0].stdio, undefined);
  assert.equal(calls[1].stdio, 'inherit');
  assert.throws(
    () => deploy(EXACT_STAGING_DEPLOY_ENVIRONMENT, () => ({
      status: 0,
      stdout: '99.0.0\n',
    })),
    /firebase_hosting_staging_contract_rejected/u,
  );
});

test('CI-001D4 CLI failures are fixed and reject appended arguments', () => {
  const canary = 'private-hosting-context-canary';
  const invalidContext = spawnSync(
    process.execPath,
    [STAGING_CONTRACT_PATH, 'validate-deploy'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...EXACT_STAGING_DEPLOY_ENVIRONMENT,
        GCLOUD_PROJECT: canary,
        FIREBASE_TOKEN: canary,
      },
    },
  );
  const unexpectedArgument = spawnSync(
    process.execPath,
    [STAGING_CONTRACT_PATH, 'deploy', '--only', 'functions'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...EXACT_STAGING_DEPLOY_ENVIRONMENT },
    },
  );

  [invalidContext, unexpectedArgument].forEach((result) => {
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(
      result.stderr,
      'firebase_hosting_staging_contract_rejected\n',
    );
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(canary, 'u'));
  });
});
