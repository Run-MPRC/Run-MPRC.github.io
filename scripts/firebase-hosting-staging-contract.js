'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  validateDeployEnvironment: validateHostingDeployEnvironment,
} = require('./firebase-hosting-contract');

const REJECTION = 'firebase_hosting_staging_contract_rejected';
const DEFAULT_PROJECT_ID = 'demo-mprc-local';
const STAGING_PROJECT_ID = 'run-mprc-staging';
const CLUB_ACCOUNT = 'runmprc@gmail.com';
const DEPLOY_SCOPE = 'hosting';
const FIREBASE_CLI_VERSION = '15.24.0';
const TEST_SCRIPT = 'node --test tests/firebase-hosting-foundation.test.js';
const PREDEPLOY_SCRIPT = 'node scripts/firebase-hosting-staging-contract.js validate-deploy';
const DEPLOY_SCRIPT = 'node scripts/firebase-hosting-staging-contract.js deploy';

function reject() {
  throw new Error(REJECTION);
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value, expected) {
  return isPlainObject(value)
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...expected].sort());
}

function hasExactArray(value, expected) {
  return Array.isArray(value)
    && JSON.stringify(value) === JSON.stringify(expected);
}

function requiredValue(environment, key) {
  const value = environment?.[key];
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > 8192
    || value.trim() !== value) {
    reject();
  }
  return value;
}

function validateSourceContract({
  firebaseConfig,
  aliases,
  packageJson,
  packageLock,
}) {
  if (!isPlainObject(firebaseConfig)
    || !hasExactKeys(
      firebaseConfig.hosting,
      ['public', 'predeploy', 'ignore', 'rewrites'],
    )
    || firebaseConfig.hosting.public !== 'build'
    || !hasExactArray(firebaseConfig.hosting.predeploy, [
      'node scripts/firebase-hosting-contract.js validate-deploy',
      'npm run build',
      'node scripts/firebase-hosting-contract.js verify build',
    ])
    || !hasExactArray(firebaseConfig.hosting.ignore, [
      'firebase.json',
      '**/.*',
      '**/node_modules/**',
    ])
    || !hasExactArray(firebaseConfig.hosting.rewrites, [{
      source: '**',
      destination: '/index.html',
    }])
    || !hasExactKeys(aliases, ['projects'])
    || !hasExactKeys(aliases.projects, ['default'])
    || aliases.projects.default !== DEFAULT_PROJECT_ID
    || packageJson?.scripts?.['test:firebase-hosting'] !== TEST_SCRIPT
    || packageJson?.scripts?.['predeploy:staging-hosting'] !== PREDEPLOY_SCRIPT
    || packageJson?.scripts?.['deploy:staging-hosting'] !== DEPLOY_SCRIPT
    || packageJson?.devDependencies?.['firebase-tools'] !== FIREBASE_CLI_VERSION
    || packageLock?.packages?.['']?.devDependencies?.['firebase-tools']
      !== FIREBASE_CLI_VERSION
    || packageLock?.packages?.['node_modules/firebase-tools']?.version
      !== FIREBASE_CLI_VERSION) {
    reject();
  }

  return Object.freeze({
    account: CLUB_ACCOUNT,
    cliVersion: FIREBASE_CLI_VERSION,
    defaultProject: DEFAULT_PROJECT_ID,
    projectId: STAGING_PROJECT_ID,
    scope: DEPLOY_SCOPE,
  });
}

function validateDeployEnvironment(environment = process.env) {
  let selected;
  try {
    selected = validateHostingDeployEnvironment(environment);
  } catch {
    return reject();
  }
  if (selected.environment !== 'staging'
    || selected.projectId !== STAGING_PROJECT_ID
    || requiredValue(environment, 'GOOGLE_CLOUD_QUOTA_PROJECT')
      !== STAGING_PROJECT_ID
    || requiredValue(environment, 'FIREBASE_DEPLOY_SCOPE') !== DEPLOY_SCOPE
    || requiredValue(environment, 'RUN_MPRC_FIREBASE_ACCOUNT') !== CLUB_ACCOUNT
    || requiredValue(environment, 'FIREBASE_TOKEN').length < 16
    || (environment.GOOGLE_APPLICATION_CREDENTIALS !== undefined
      && environment.GOOGLE_APPLICATION_CREDENTIALS !== '')
    || (environment.GOOGLE_GHA_CREDS_PATH !== undefined
      && environment.GOOGLE_GHA_CREDS_PATH !== '')
    || (environment.CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE !== undefined
      && environment.CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE !== '')
    || (environment.FIREBASE_SERVICE_ACCOUNT !== undefined
      && environment.FIREBASE_SERVICE_ACCOUNT !== '')) {
    reject();
  }

  return Object.freeze({
    account: CLUB_ACCOUNT,
    projectId: STAGING_PROJECT_ID,
    scope: DEPLOY_SCOPE,
  });
}

function readJson(root, relativePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
  } catch {
    return reject();
  }
}

function validateRepository(root = path.resolve(__dirname, '..')) {
  return validateSourceContract({
    firebaseConfig: readJson(root, 'firebase.json'),
    aliases: readJson(root, '.firebaserc'),
    packageJson: readJson(root, 'package.json'),
    packageLock: readJson(root, 'package-lock.json'),
  });
}

function firebaseDeployArguments() {
  return Object.freeze([
    '--no-install',
    'firebase',
    'deploy',
    '--only',
    DEPLOY_SCOPE,
    '--project',
    STAGING_PROJECT_ID,
    '--non-interactive',
  ]);
}

function deploy(environment = process.env, spawn = spawnSync) {
  validateRepository();
  validateDeployEnvironment(environment);

  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const version = spawn(
    executable,
    ['--no-install', 'firebase', '--version'],
    { encoding: 'utf8', env: environment },
  );
  if (version.error
    || version.status !== 0
    || version.stdout.trim() !== FIREBASE_CLI_VERSION) {
    reject();
  }

  const result = spawn(executable, firebaseDeployArguments(), {
    env: environment,
    stdio: 'inherit',
  });
  if (result.error || !Number.isInteger(result.status)) return 1;
  return result.status;
}

function runCli(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === 'validate') {
    validateRepository();
    process.stdout.write('firebase_hosting_staging_contract_valid\n');
    return 0;
  }
  if (args.length === 1 && args[0] === 'validate-deploy') {
    validateRepository();
    validateDeployEnvironment();
    process.stdout.write('firebase_hosting_staging_deploy_contract_valid\n');
    return 0;
  }
  if (args.length === 1 && args[0] === 'deploy') return deploy();
  return reject();
}

if (require.main === module) {
  try {
    process.exitCode = runCli();
  } catch {
    process.stderr.write(`${REJECTION}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEPLOY_SCOPE,
  FIREBASE_CLI_VERSION,
  deploy,
  firebaseDeployArguments,
  validateDeployEnvironment,
  validateSourceContract,
};
