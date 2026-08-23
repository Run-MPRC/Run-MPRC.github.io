'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
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

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
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
    ...STAGING_BUILD_ENVIRONMENT,
    GCLOUD_PROJECT: 'mprc-staging-ci',
  }), {
    environment: 'staging',
    projectId: 'mprc-staging-ci',
  });
  assert.throws(
    () => contract.validateDeployEnvironment({
      ...STAGING_BUILD_ENVIRONMENT,
      GCLOUD_PROJECT: 'mid-peninsula-running-club',
    }),
    /firebase_hosting_contract_rejected/u,
  );
  assert.throws(
    () => contract.validateDeployEnvironment(STAGING_BUILD_ENVIRONMENT),
    /firebase_hosting_contract_rejected/u,
  );
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
