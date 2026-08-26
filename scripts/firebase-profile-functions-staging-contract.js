'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REJECTION = 'firebase_profile_functions_staging_contract_rejected';
const DEFAULT_PROJECT_ID = 'demo-mprc-local';
const STAGING_PROJECT_ID = 'run-mprc-staging';
const CLUB_ACCOUNT = 'runmprc@gmail.com';
const FIREBASE_CLI_VERSION = '15.24.0';
const FUNCTION_IDS = Object.freeze([
  'createMemberOnSignUp',
  'ensureMemberProfile',
]);
const DEPLOY_SCOPE = FUNCTION_IDS
  .map((functionId) => `functions:${functionId}`)
  .join(',');
const TEST_SCRIPT = 'node --test tests/firebase-profile-functions-staging-contract.test.js';
const PREDEPLOY_SCRIPT = 'node scripts/firebase-profile-functions-staging-contract.js validate-deploy';
const DEPLOY_SCRIPT = 'node scripts/firebase-profile-functions-staging-contract.js deploy';

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

function validateFunctionsConfig(firebaseConfig) {
  if (!isPlainObject(firebaseConfig)
    || !Array.isArray(firebaseConfig.functions)
    || firebaseConfig.functions.length !== 1) {
    reject();
  }

  const [functionsConfig] = firebaseConfig.functions;
  if (!hasExactKeys(
    functionsConfig,
    ['source', 'codebase', 'ignore', 'predeploy'],
  )
    || functionsConfig.source !== 'functions'
    || functionsConfig.codebase !== 'default'
    || !hasExactArray(functionsConfig.ignore, [
      'node_modules',
      '.git',
      'firebase-debug.log',
      'firebase-debug.*.log',
    ])
    || !hasExactArray(
      functionsConfig.predeploy,
      ['npm --prefix "$RESOURCE_DIR" run build'],
    )) {
    reject();
  }
}

function validateFunctionExports(functionIndex) {
  if (typeof functionIndex !== 'string' || functionIndex.length === 0) reject();

  const exportedNames = [...functionIndex.matchAll(
    /^exports\.([A-Za-z][A-Za-z0-9_]*)\s*=/gmu,
  )].map((match) => match[1]);

  const exactAssignments = [
    'exports.createMemberOnSignUp = onSignUp;',
    'exports.ensureMemberProfile = ensureMemberProfile;',
  ];
  for (const [index, functionId] of FUNCTION_IDS.entries()) {
    if (exportedNames.filter((name) => name === functionId).length !== 1
      || functionIndex.split(exactAssignments[index]).length !== 2) {
      reject();
    }
  }
}

function validatePackageContract(packageJson, packageLock) {
  if (!isPlainObject(packageJson)
    || packageJson.scripts?.['test:firebase-profile-functions-staging']
      !== TEST_SCRIPT
    || packageJson.scripts?.['predeploy:staging-profile-functions']
      !== PREDEPLOY_SCRIPT
    || packageJson.scripts?.['deploy:staging-profile-functions']
      !== DEPLOY_SCRIPT
    || packageJson.devDependencies?.['firebase-tools'] !== FIREBASE_CLI_VERSION
    || packageLock?.packages?.['']?.devDependencies?.['firebase-tools']
      !== FIREBASE_CLI_VERSION
    || packageLock?.packages?.['node_modules/firebase-tools']?.version
      !== FIREBASE_CLI_VERSION) {
    reject();
  }
}

function validateSourceContract({
  firebaseConfig,
  aliases,
  functionIndex,
  packageJson,
  packageLock,
}) {
  validateFunctionsConfig(firebaseConfig);
  if (!hasExactKeys(aliases, ['projects'])
    || !hasExactKeys(aliases.projects, ['default'])
    || aliases.projects.default !== DEFAULT_PROJECT_ID) {
    reject();
  }
  validateFunctionExports(functionIndex);
  validatePackageContract(packageJson, packageLock);

  return Object.freeze({
    account: CLUB_ACCOUNT,
    cliVersion: FIREBASE_CLI_VERSION,
    defaultProject: DEFAULT_PROJECT_ID,
    functions: FUNCTION_IDS,
    projectId: STAGING_PROJECT_ID,
    scope: DEPLOY_SCOPE,
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
    functionIndex: fs.readFileSync(path.join(root, 'functions/index.js'), 'utf8'),
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
    process.stdout.write('firebase_profile_functions_staging_contract_valid\n');
    return 0;
  }
  if (args.length === 1 && args[0] === 'validate-deploy') {
    validateRepository();
    validateDeployEnvironment();
    process.stdout.write('firebase_profile_functions_staging_deploy_contract_valid\n');
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
  FUNCTION_IDS,
  deploy,
  firebaseDeployArguments,
  validateDeployEnvironment,
  validateSourceContract,
};
