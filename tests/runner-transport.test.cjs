'use strict';

// Real Web SDK -> loopback Functions HTTP -> local Admin Auth/Firestore.
// Emulator token decoding is NOT cryptographic Auth/App Check verification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { test, before, after } = require('node:test');
const { PROJECT, prepareRunnerEmulators } = require('../functions/testSupport/runnerHttp/environment');
const { installNetworkGuard } = require('../functions/testSupport/testSafety');

prepareRunnerEmulators(process.env);
if (process.env.REQUIRE_RUNNER_HTTP_EMULATOR !== '1') throw new Error('Runner HTTP test opt-in required.');
process.env.FUNCTIONS_EMULATOR_HOST = '127.0.0.1:9519';
installNetworkGuard();

// Compile only these reviewed local TS modules in memory. No generated client
// or duplicated implementation: tests use the shipped createRunnerClient code.
const ts = require('typescript');
const clientPaths = new Set([
  'runnerConnectionService.ts', 'runnerConnectionContract.ts', 'memberDirectoryService.ts',
].map((name) => path.resolve(__dirname, '../src/services/account', name)));
const previousTsLoader = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
  if (!clientPaths.has(filename)) throw new Error('Unexpected transport test module.');
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  });
  module._compile(result.outputText, filename);
};
const { createRunnerClient } = require('../src/services/account/runnerConnectionService.ts');
if (previousTsLoader) require.extensions['.ts'] = previousTsLoader;
else delete require.extensions['.ts'];

const { initializeApp, deleteApp } = require('firebase/app');
const { initializeAuth, inMemoryPersistence, connectAuthEmulator, signInWithEmailAndPassword, signOut } = require('firebase/auth');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');
const { initializeAppCheck, CustomProvider } = require('firebase/app-check');
const { initializeRunnerAdmin } = require('../functions/testSupport/runnerHttp/admin');
const { createMembershipAuthority, applyMembershipAuthorityCommand } = require('../functions/membershipAuthority');
const { profile } = require('../functions/testSupport/runnerConnectionsFixtures');
const { runnerEntryId, exclusionId } = require('../functions/runnerConnectionReferences');
const { accountRateKey } = require('../functions/runnerConnectionService');

const seed = randomUUID();
const owner = `synthetic-http-owner-${seed}`;
const partner = `synthetic-http-partner-${seed}`;
const outsider = `synthetic-http-outsider-${seed}`;
const actors = [owner, partner, outsider];
const apps = [];
const password = 'synthetic-local-test-password-only';
let adminApp;
let db;
let auth;
let client;
let webAuth;
let ownerApp;

function membership(uid) {
  const created = createMembershipAuthority({
    membershipAuthoritySchemaVersion: 1, membershipId: uid, commandId: 'synthetic-create',
  });
  const linked = applyMembershipAuthorityCommand(created, {
    membershipAuthoritySchemaVersion: 1, commandType: 'associate_account',
    commandId: 'synthetic-link', expectedRevision: 1, uid,
  });
  return applyMembershipAuthorityCommand(linked, {
    membershipAuthoritySchemaVersion: 1, commandType: 'record_term_decision',
    commandId: 'synthetic-term', expectedRevision: 2, termRevision: 1, termState: 'approved',
    termId: 'synthetic-term-id', startsAtMs: Date.now() - 60000, endsAtMs: Date.now() + 3600000,
    planRef: 'synthetic-plan', evidenceRef: 'synthetic-evidence', policyVersion: 'synthetic-policy',
  });
}
function appCheckToken() {
  // Unsigned test token accepted ONLY by the emulator's own debug decoder.
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${encode({ alg: 'none' })}.${encode({ sub: 'synthetic-http-app', iat: now, exp: now + 3600 })}.`;
}
async function browser(uid, appCheck = true) {
  const app = initializeApp({
    projectId: PROJECT, apiKey: 'synthetic-local-api-key', appId: 'synthetic-http-app',
  }, `${uid}-${apps.length}`);
  apps.push(app);
  const authentication = initializeAuth(app, { persistence: inMemoryPersistence });
  connectAuthEmulator(authentication, 'http://127.0.0.1:9919', { disableWarnings: true });
  connectFunctionsEmulator(getFunctions(app), '127.0.0.1', 9519);
  if (appCheck) initializeAppCheck(app, {
    provider: new CustomProvider({ getToken: async () => ({
      token: appCheckToken(), expireTimeMillis: Date.now() + 3600000,
    }) }),
    isTokenAutoRefreshEnabled: false,
  });
  await signInWithEmailAndPassword(authentication, `${uid}@example.test`, password);
  return { app, authentication, client: createRunnerClient(app, uid) };
}
const save = (expectedRevision = 0, displayName = 'Synthetic HTTP Owner') => ({
  requestId: randomUUID(), expectedRevision, profile: profile({ displayName }),
  adultConfirmed: true, consentVersion: 1,
  consent: { memberDiscovery: true, similarity: true, broadenCircle: false },
});
async function audits(uid) {
  return (await db.collection('auditEvents').where('actorUid', '==', uid).get()).size;
}

before(async () => {
  adminApp = initializeRunnerAdmin();
  db = adminApp.firestore();
  auth = adminApp.auth();
  for (const uid of actors) {
    await auth.createUser({ uid, email: `${uid}@example.test`, emailVerified: true, password });
  }
  for (const uid of [owner, partner]) await db.collection('memberships').doc(uid).set(membership(uid));
  const first = await browser(owner);
  ({ client, app: ownerApp, authentication: webAuth } = first);
});
after(async () => {
  for (const app of apps) await deleteApp(app);
  if (!db || !auth) return;
  for (const uid of actors) {
    for (const [collection, id] of [
      ['memberships', uid], ['runnerConnectionProfiles', uid],
      ['runnerConnectionEntries', runnerEntryId(uid)], ['runnerConnectionWindows', uid],
    ]) await db.recursiveDelete(db.collection(collection).doc(id));
    const receipts = await db.collection('auditEvents').where('actorUid', '==', uid).get();
    for (const receipt of receipts.docs) await receipt.ref.delete();
    for (const operation of ['read', 'save', 'withdraw', 'recommend', 'exclusionRead', 'exclude']) {
      await db.collection('ratelimits').doc(`runner_connection_${operation}__${accountRateKey(uid)}`).delete();
    }
    for (const target of actors) {
      await db.collection('runnerConnectionExclusions').doc(exclusionId(uid, target)).delete();
    }
    try { await auth.deleteUser(uid); } catch (failure) {
      if (failure.code !== 'auth/user-not-found') throw failure;
    }
  }
  assert.equal((await db.listCollections()).length, 0, 'Synthetic database cleanup incomplete.');
  assert.equal((await auth.listUsers(1)).users.length, 0, 'Synthetic account cleanup incomplete.');
  await adminApp.delete();
});

test('actual browser client recovers the same command after losing a committed HTTP reply', async () => {
  const empty = await client.read();
  assert.equal(empty.profile, null);
  assert.equal(empty.adultConfirmed, false);
  const command = save();
  const originalFetch = global.fetch;
  let lost = false;
  global.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (String(args[0]).endsWith('/saveMyRunnerConnectionProfile') && !lost) {
      assert.equal(response.status, 200);
      await response.arrayBuffer();
      lost = true;
      throw new Error('Synthetic lost reply after server commit.');
    }
    return response;
  };
  try {
    await assert.rejects(client.save(command), { code: 'functions/internal' });
  } finally { global.fetch = originalFetch; }
  assert.equal(lost, true);
  assert.equal(await audits(owner), 1);
  const saved = await client.save(command);
  assert.equal(saved.revision, 1);
  assert.equal(saved.adultConfirmed, true);
  assert.deepEqual(await client.save(command), saved);
  assert.equal(await audits(owner), 1);
  assert.deepEqual(await client.read(), saved);
});
test('missing App Check and signed-out HTTP requests are denied', async () => {
  const missing = await browser(outsider, false);
  await assert.rejects(missing.client.read(), { code: 'functions/unauthenticated' });
  const signedOut = await browser(outsider);
  await signOut(signedOut.authentication);
  await assert.rejects(httpsCallable(getFunctions(signedOut.app), 'getMyRunnerConnectionProfile')({}),
    { code: 'functions/unauthenticated' });
  assert.equal(await audits(outsider), 0);
});
test('unapproved membership is denied by server, not a browser role', async () => {
  await auth.setCustomUserClaims(outsider, { role: 'admin' });
  const member = await browser(outsider);
  await assert.rejects(member.client.save(save()), { code: 'functions/permission-denied' });
  assert.equal(await audits(outsider), 0);
});
test('server invalid-argument and revision-conflict responses traverse the actual SDK', async () => {
  await assert.rejects(httpsCallable(getFunctions(ownerApp), 'saveMyRunnerConnectionProfile')({
    ...save(1), adultConfirmed: false,
  }), { code: 'functions/invalid-argument' });
  await assert.rejects(client.save(save(0)), { code: 'functions/aborted' });
  assert.equal(await audits(owner), 1);
});
test('HTTP replies are private/no-store and contain only the closed owner projection', async () => {
  const response = await fetch(`http://127.0.0.1:9519/${PROJECT}/us-central1/getMyRunnerConnectionProfile`, {
    method: 'POST', headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await webAuth.currentUser.getIdToken()}`,
      'X-Firebase-AppCheck': appCheckToken(),
    }, body: JSON.stringify({ data: {} }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  const body = await response.json();
  assert.deepEqual(body.result, await client.read());
  assert.deepEqual(Object.keys(body.result).sort(), [
    'adultConfirmed', 'consent', 'consentVersion', 'profile', 'revision', 'schemaVersion',
  ]);
});
test('recommendation, directed privacy and same-choice retry work across real HTTP calls', async () => {
  const other = await browser(partner);
  await other.client.save(save(0, 'Synthetic HTTP Partner'));
  const result = await client.recommend();
  assert.equal(result.similar.length, 1);
  assert.equal(result.similar[0].displayName, 'Synthetic HTTP Partner');
  assert.equal(result.similar[0].email, undefined);
  assert.equal(result.similar[0].uid, undefined);
  assert.equal(result.similar[0].experiencePreferences, undefined);
  assert.equal((await other.client.recommend()).similar.length, 1);
  const { entryRef } = result.similar[0];
  assert.deepEqual(await client.exclusion(entryRef), { revision: 0, hidden: false, blocked: false });
  const block = { requestId: randomUUID(), expectedRevision: 0, entryRef, hidden: false, blocked: true };
  const blocked = await client.exclude(block);
  assert.deepEqual(blocked, { revision: 1, hidden: false, blocked: true });
  assert.deepEqual(await client.exclude(block), blocked);
  assert.deepEqual(await client.exclusion(entryRef), blocked);
  assert.equal((await client.recommend()).similar.length, 0);
  assert.equal((await other.client.recommend()).similar.length, 0);
  const undo = { ...block, requestId: randomUUID(), expectedRevision: 1, blocked: false };
  assert.deepEqual(await client.exclude(undo), { revision: 2, hidden: false, blocked: false });
  assert.equal((await client.recommend()).similar[0].displayName, 'Synthetic HTTP Partner');
  // Withdrawal by the candidate is respected on the next transport request.
  await other.client.withdraw({ requestId: randomUUID(), expectedRevision: 1 });
  assert.equal((await client.recommend()).similar.length, 0);
});
test('cached Auth tokens cannot bypass a current disabled or unverified account', async () => {
  await auth.updateUser(owner, { disabled: true });
  await assert.rejects(client.read(), { code: 'functions/permission-denied' });
  await auth.updateUser(owner, { disabled: false, emailVerified: false });
  await assert.rejects(client.read(), { code: 'functions/permission-denied' });
  await auth.updateUser(owner, { emailVerified: true });
  assert.equal((await client.read()).revision, 1);
});
test('expired membership denies saves/recommendations but permits own read and withdrawal', async () => {
  const ref = db.collection('memberships').doc(owner);
  const record = (await ref.get()).data();
  await ref.set({ ...record, term: { ...record.term, endsAtMs: Date.now() - 1000 } });
  await assert.rejects(client.save(save(1)), { code: 'functions/permission-denied' });
  await assert.rejects(client.recommend(), { code: 'functions/permission-denied' });
  assert.equal((await client.read()).revision, 1);
  const command = { requestId: randomUUID(), expectedRevision: 1 };
  const result = await client.withdraw(command);
  assert.deepEqual(await client.withdraw(command), result);
  assert.equal(result.profile, null);
  assert.equal(result.adultConfirmed, false);
  assert.deepEqual(result.consent, { memberDiscovery: false, similarity: false, broadenCircle: false });
  assert.equal((await client.read()).revision, 2);
});
