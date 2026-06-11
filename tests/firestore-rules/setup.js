const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { setLogLevel } = require('firebase/firestore');

// Every assertFails() test deliberately triggers a PERMISSION_DENIED, which the
// Firestore SDK logs at warn level. Left on, that noise buries a genuine failure
// in CI output. The denials are still surfaced to assertFails(), so silencing
// warn-level logging is safe and keeps the run readable.
setLogLevel('error');

const PROJECT_ID = 'demo-rules-test';
const RULES_PATH = path.join(__dirname, '..', '..', 'firestore.rules');

let _env = null;

async function getEnv() {
  if (_env) return _env;
  _env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
  return _env;
}

async function teardown() {
  if (_env) {
    await _env.cleanup();
    _env = null;
  }
}

async function clearFirestore() {
  const env = await getEnv();
  await env.clearFirestore();
}

function ctx(role, uid) {
  return { role, uid };
}

async function db({ uid, role } = {}) {
  const env = await getEnv();
  if (!uid) return env.unauthenticatedContext().firestore();
  return env.authenticatedContext(uid, role ? { role } : {}).firestore();
}

/**
 * Seed a document while bypassing rules. Use this to create the docs you'll
 * test reads against (since most rules block writes outright).
 */
async function seed(path_, data) {
  const env = await getEnv();
  await env.withSecurityRulesDisabled(async (adminCtx) => {
    const ref = adminCtx.firestore().doc(path_);
    await ref.set(data);
  });
}

module.exports = {
  getEnv,
  teardown,
  clearFirestore,
  db,
  ctx,
  seed,
  assertFails,
  assertSucceeds,
};
