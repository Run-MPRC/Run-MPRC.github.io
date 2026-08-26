'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REJECTION = 'firebase_auth_staging_contract_rejected';
const DEFAULT_PROJECT_ID = 'demo-mprc-local';
const STAGING_PROJECT_ID = 'run-mprc-staging';
const DEPLOY_SCOPE = 'auth';
const CLUB_ACCOUNT = 'runmprc@gmail.com';

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

function validateSourceContract(firebaseConfig, aliases) {
  if (!isPlainObject(firebaseConfig)
    || !hasExactKeys(firebaseConfig.auth, ['providers'])
    || !hasExactKeys(firebaseConfig.auth.providers, ['emailPassword'])
    || firebaseConfig.auth.providers.emailPassword !== true) {
    reject();
  }
  if (!hasExactKeys(aliases, ['projects'])
    || !hasExactKeys(aliases.projects, ['default'])
    || aliases.projects.default !== DEFAULT_PROJECT_ID) {
    reject();
  }

  return Object.freeze({
    defaultProject: DEFAULT_PROJECT_ID,
    provider: 'emailPassword',
  });
}

function validateDeployEnvironment(environment = process.env) {
  if (requiredValue(environment, 'GCLOUD_PROJECT') !== STAGING_PROJECT_ID
    || requiredValue(environment, 'GOOGLE_CLOUD_QUOTA_PROJECT')
      !== STAGING_PROJECT_ID
    || requiredValue(environment, 'FIREBASE_DEPLOY_SCOPE') !== DEPLOY_SCOPE
    || requiredValue(environment, 'RUN_MPRC_FIREBASE_ACCOUNT') !== CLUB_ACCOUNT
    || requiredValue(environment, 'FIREBASE_TOKEN').length < 16
    || (environment.GOOGLE_APPLICATION_CREDENTIALS !== undefined
      && environment.GOOGLE_APPLICATION_CREDENTIALS !== '')) {
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
  return validateSourceContract(
    readJson(root, 'firebase.json'),
    readJson(root, '.firebaserc'),
  );
}

function runCli(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === 'validate') {
    validateRepository();
    process.stdout.write('firebase_auth_staging_contract_valid\n');
    return;
  }
  if (args.length === 1 && args[0] === 'validate-deploy') {
    validateRepository();
    validateDeployEnvironment();
    process.stdout.write('firebase_auth_staging_deploy_contract_valid\n');
    return;
  }
  reject();
}

if (require.main === module) {
  try {
    runCli();
  } catch {
    process.stderr.write(`${REJECTION}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  validateDeployEnvironment,
  validateSourceContract,
};
