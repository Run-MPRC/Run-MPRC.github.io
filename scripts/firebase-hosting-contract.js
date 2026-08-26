'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REJECTION = 'firebase_hosting_contract_rejected';
const PRODUCTION_PROJECT_ID = 'mid-peninsula-running-club';
const PRODUCTION_CONFIGURATION = Object.freeze({
  REACT_APP_FIREBASE_API_KEY: 'AIzaSyD2u17HMhDPZ0Tn9D3H71fep1vZgT-njnw',
  REACT_APP_FIREBASE_AUTH_DOMAIN: 'mid-peninsula-running-club.firebaseapp.com',
  REACT_APP_FIREBASE_PROJECT_ID: PRODUCTION_PROJECT_ID,
  REACT_APP_FIREBASE_STORAGE_BUCKET: (
    'mid-peninsula-running-club.firebasestorage.app'
  ),
  REACT_APP_FIREBASE_MESSAGING_SENDER_ID: '253289716314',
  REACT_APP_FIREBASE_APP_ID: '1:253289716314:web:dcad9766d820044d7f9663',
  REACT_APP_FIREBASE_MEASUREMENT_ID: 'G-ECN7TT0BGF',
});
const PRODUCTION_IDENTIFIERS = Object.freeze(
  Object.values(PRODUCTION_CONFIGURATION),
);
const STAGING_FIELDS = Object.freeze([
  'REACT_APP_FIREBASE_API_KEY',
  'REACT_APP_FIREBASE_AUTH_DOMAIN',
  'REACT_APP_FIREBASE_PROJECT_ID',
  'REACT_APP_FIREBASE_STORAGE_BUCKET',
  'REACT_APP_FIREBASE_MESSAGING_SENDER_ID',
  'REACT_APP_FIREBASE_APP_ID',
]);
const APP_CHECK_SITE_KEY_FIELD = 'REACT_APP_RECAPTCHA_SITE_KEY';
const APP_CHECK_SITE_KEY_PATTERN = /^[A-Za-z0-9_-]{30,128}$/u;
const APP_CHECK_PLACEHOLDER_PATTERN = (
  /(?:dummy|example|placeholder|public[-_]?site|replace|synthetic|test[-_]?key)/iu
);
const MAX_EXECUTABLE_FILES = 10000;
const MAX_EXECUTABLE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_EXECUTABLE_BYTES = 128 * 1024 * 1024;

function reject() {
  throw new Error(REJECTION);
}

function requiredValue(environment, key) {
  const value = environment?.[key];
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > 256
    || value.trim() !== value) {
    reject();
  }
  return value;
}

function includesProductionIdentity(value) {
  return PRODUCTION_IDENTIFIERS.some((identity) => value.includes(identity));
}

function validateStagingAppCheckSiteKey(environment) {
  const siteKey = requiredValue(environment, APP_CHECK_SITE_KEY_FIELD);
  if (!APP_CHECK_SITE_KEY_PATTERN.test(siteKey)
    || APP_CHECK_PLACEHOLDER_PATTERN.test(siteKey)
    || includesProductionIdentity(siteKey)) reject();
  return siteKey;
}

function validateStagingConfiguration(environment) {
  const values = Object.fromEntries(
    STAGING_FIELDS.map((key) => [key, requiredValue(environment, key)]),
  );
  if (Object.values(values).some(includesProductionIdentity)) reject();

  const projectId = values.REACT_APP_FIREBASE_PROJECT_ID;
  const senderId = values.REACT_APP_FIREBASE_MESSAGING_SENDER_ID;
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(projectId)) reject();
  if (!/(?:^|-)staging(?:-|$)/u.test(projectId)) reject();
  if (!/^[A-Za-z0-9_-]{20,128}$/u.test(values.REACT_APP_FIREBASE_API_KEY)) reject();
  if (values.REACT_APP_FIREBASE_AUTH_DOMAIN !== `${projectId}.firebaseapp.com`) reject();
  if (values.REACT_APP_FIREBASE_STORAGE_BUCKET !== `${projectId}.appspot.com`
    && values.REACT_APP_FIREBASE_STORAGE_BUCKET
      !== `${projectId}.firebasestorage.app`) reject();
  if (!/^[0-9]{6,20}$/u.test(senderId)) reject();
  if (!new RegExp(`^1:${senderId}:web:[A-Za-z0-9]{8,64}$`, 'u')
    .test(values.REACT_APP_FIREBASE_APP_ID)) reject();
  if (environment.REACT_APP_FIREBASE_MEASUREMENT_ID !== undefined) {
    const measurementId = requiredValue(
      environment,
      'REACT_APP_FIREBASE_MEASUREMENT_ID',
    );
    if (includesProductionIdentity(measurementId)
      || !/^G-[A-Z0-9]{6,20}$/u.test(measurementId)) reject();
  }

  return Object.freeze({
    environment: 'staging',
    projectId,
  });
}

function validateBuildEnvironment(environment = process.env) {
  const selected = environment?.REACT_APP_FIREBASE_ENVIRONMENT;
  if (selected === 'production') {
    Object.entries(PRODUCTION_CONFIGURATION).forEach(([key, expected]) => {
      if (requiredValue(environment, key) !== expected) reject();
    });
    return Object.freeze({
      environment: 'production',
      projectId: PRODUCTION_PROJECT_ID,
    });
  }
  if (selected === 'staging') return validateStagingConfiguration(environment);
  return reject();
}

function validateDeployEnvironment(environment = process.env) {
  const selected = validateBuildEnvironment(environment);
  if (requiredValue(environment, 'GCLOUD_PROJECT') !== selected.projectId) {
    reject();
  }
  if (selected.environment === 'staging') {
    validateStagingAppCheckSiteKey(environment);
  }
  return selected;
}

function executableFiles(root, relative = '', state = { count: 0 }) {
  const directory = path.join(root, relative);
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return reject();
  }
  const files = [];
  entries.sort((left, right) => left.name.localeCompare(right.name))
    .forEach((entry) => {
      const child = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) reject();
      if (entry.isDirectory()) {
        files.push(...executableFiles(root, child, state));
        return;
      }
      if (!entry.isFile()) reject();
      if (!entry.name.endsWith('.js') || entry.name.endsWith('.js.map')) return;
      state.count += 1;
      if (state.count > MAX_EXECUTABLE_FILES) reject();
      files.push(child);
    });
  return files;
}

function verifyExecutableArtifact(directory, environment = process.env) {
  if (typeof directory !== 'string' || directory.length === 0) reject();
  const selected = validateBuildEnvironment(environment);
  const root = path.resolve(directory);
  const files = executableFiles(root);
  if (files.length === 0) reject();

  const requiredIdentifiers = selected.environment === 'production'
    ? PRODUCTION_IDENTIFIERS
    : [
      ...STAGING_FIELDS.map((key) => requiredValue(environment, key)),
      ...(environment.REACT_APP_FIREBASE_MEASUREMENT_ID === undefined
        ? []
        : [requiredValue(environment, 'REACT_APP_FIREBASE_MEASUREMENT_ID')]),
      ...(environment[APP_CHECK_SITE_KEY_FIELD] === undefined
        ? []
        : [requiredValue(environment, APP_CHECK_SITE_KEY_FIELD)]),
    ];
  const foundIdentifiers = new Set();
  let totalBytes = 0;
  files.forEach((relative) => {
    let stat;
    let contents;
    try {
      stat = fs.statSync(path.join(root, relative));
      if (!stat.isFile() || stat.size > MAX_EXECUTABLE_BYTES) reject();
      totalBytes += stat.size;
      if (totalBytes > MAX_TOTAL_EXECUTABLE_BYTES) reject();
      contents = fs.readFileSync(path.join(root, relative), 'utf8');
    } catch {
      reject();
    }
    requiredIdentifiers.forEach((identity) => {
      if (contents.includes(identity)) foundIdentifiers.add(identity);
    });
    if (selected.environment === 'staging'
      && PRODUCTION_IDENTIFIERS.some((identity) => contents.includes(identity))) {
      reject();
    }
  });
  if (foundIdentifiers.size !== new Set(requiredIdentifiers).size) reject();

  return Object.freeze({
    environment: selected.environment,
    executableFileCount: files.length,
  });
}

function runCli(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === 'validate') {
    validateBuildEnvironment();
    process.stdout.write('firebase_hosting_contract_valid\n');
    return;
  }
  if (args.length === 1 && args[0] === 'validate-deploy') {
    validateDeployEnvironment();
    process.stdout.write('firebase_hosting_deploy_contract_valid\n');
    return;
  }
  if (args.length === 2 && args[0] === 'verify') {
    verifyExecutableArtifact(args[1]);
    process.stdout.write('firebase_hosting_artifact_valid\n');
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
  validateBuildEnvironment,
  validateDeployEnvironment,
  verifyExecutableArtifact,
};
