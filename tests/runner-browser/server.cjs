'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { prepareRunnerEmulators } = require('../../functions/testSupport/runnerHttp/environment');
prepareRunnerEmulators(process.env);
if (process.env.RUNNER_HTTP_BROWSER !== '1' || process.env.REQUIRE_RUNNER_HTTP_EMULATOR !== '1') {
  throw new Error('Synthetic browser rehearsal requires the isolated launcher.');
}
process.env.FUNCTIONS_EMULATOR_HOST = '127.0.0.1:9519';
require('../../functions/testSupport/testSafety').installNetworkGuard();
process.env.NODE_ENV = 'production';
const { initializeRunnerAdmin } = require('../../functions/testSupport/runnerHttp/admin');
const { createMembershipAuthority, applyMembershipAuthorityCommand } = require('../../functions/membershipAuthority');
const { createRunnerProfileStore } = require('../../functions/runnerConnectionProfiles');
const { profile } = require('../../functions/testSupport/runnerConnectionsFixtures');
const { runnerEntryId, exclusionId } = require('../../functions/runnerConnectionReferences');
const { accountRateKey } = require('../../functions/runnerConnectionService');
const { ORIGIN, HEADERS, route } = require('./policy.cjs');

const root = path.resolve(__dirname, '../..');
const seed = randomUUID();
const actors = Object.fromEntries(['owner', 'partner', 'outsider'].map((role) => [role, `synthetic-browser-${role}-${seed}`]));
const password = 'synthetic-local-test-password-only';
const app = initializeRunnerAdmin();
const db = app.firestore();
const auth = app.auth();
let server;
let timer;
let stopping;
let startup;
let fixturesStarted = false;

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
async function build() {
  const webpack = require('webpack');
  const { createFsFromVolume, Volume } = require('memfs');
  const memory = createFsFromVolume(new Volume());
  const compiler = webpack({
    mode: 'production', context: root, entry: path.join(__dirname, 'entry.tsx'),
    output: { path: '/synthetic-runner-browser', filename: 'bundle.js' },
    devtool: false, cache: false, performance: false,
    optimization: { minimize: false },
    resolve: { extensions: ['.tsx', '.ts', '.jsx', '.js'] },
    module: { rules: [
      { test: /\.[jt]sx?$/, include: [path.join(root, 'src'), __dirname],
        loader: require.resolve('babel-loader'),
        options: { babelrc: false, configFile: false, cacheDirectory: false,
          presets: [[require.resolve('babel-preset-react-app'), { runtime: 'automatic' }]] } },
      { test: /\.css$/, use: [require.resolve('style-loader'), require.resolve('css-loader')] },
    ] },
  });
  compiler.outputFileSystem = memory;
  return new Promise((resolve, reject) => compiler.run((error, stats) => {
    compiler.close(() => {
      if (error || !stats || stats.hasErrors()) return reject(new Error('Synthetic browser bundle failed.'));
      resolve(memory.readFileSync('/synthetic-runner-browser/bundle.js'));
    });
  }));
}
async function cleanup() {
  if (fixturesStarted) {
    // Only this run's unpredictable, synthetic IDs. Never clear a collection or
    // use the Auth emulator's delete-all endpoint.
    for (const uid of Object.values(actors)) {
      for (const [collection, id] of [
        ['memberships', uid], ['runnerConnectionProfiles', uid],
        ['runnerConnectionEntries', runnerEntryId(uid)], ['runnerConnectionWindows', uid],
      ]) await db.recursiveDelete(db.collection(collection).doc(id));
      const receipts = await db.collection('auditEvents').where('actorUid', '==', uid).get();
      for (const receipt of receipts.docs) await receipt.ref.delete();
      for (const operation of ['read', 'save', 'withdraw', 'recommend', 'exclusionRead', 'exclude']) {
        await db.collection('ratelimits').doc(`runner_connection_${operation}__${accountRateKey(uid)}`).delete();
      }
      for (const target of Object.values(actors)) {
        await db.collection('runnerConnectionExclusions').doc(exclusionId(uid, target)).delete();
      }
      try { await auth.deleteUser(uid); } catch (failure) {
        if (failure.code !== 'auth/user-not-found') throw failure;
      }
    }
    assert.equal((await db.listCollections()).length, 0);
    assert.equal((await auth.listUsers(1)).users.length, 0);
    console.log('runner_browser_cleanup_verified: users=0 collections=0');
  }
}
function stop(code, response) {
  if (stopping) {
    if (response) { response.writeHead(409); response.end('Already stopping.'); }
    return stopping;
  }
  stopping = Promise.resolve().then(async () => {
    try {
      // A stop during compilation/seeding must not race cleanup with later
      // fixture creation. Reject new HTTP work immediately, then drain startup.
      await startup.catch(() => {});
      clearTimeout(timer);
      try { await cleanup(); } finally { await app.delete(); }
      if (response) { response.writeHead(200); response.end('Synthetic cleanup verified.'); }
      process.exitCode = code;
    } catch {
      if (response) { response.writeHead(500); response.end('Cleanup not verified.'); }
      console.error('runner_browser_cleanup_not_verified');
      process.exitCode = 1;
    } finally {
      if (server?.listening) { server.close(); server.closeIdleConnections(); }
    }
  });
  return stopping;
}
async function main() {
  const bundle = await build();
  // Refuse an occupied environment before creating or deleting any fixtures.
  assert.equal((await db.listCollections()).length, 0);
  assert.equal((await auth.listUsers(1)).users.length, 0);
  fixturesStarted = true;
  for (const uid of Object.values(actors)) {
    await auth.createUser({ uid, email: `${uid}@example.test`, emailVerified: true, password });
  }
  for (const uid of [actors.owner, actors.partner]) await db.collection('memberships').doc(uid).set(membership(uid));
  // A declared fixture, not user sign-up or membership administration. Only the
  // partner begins with a card; owner and outsider exercise the actual form.
  const store = createRunnerProfileStore({ db, authorize: async ({ uid }) => uid === actors.partner });
  await store.saveOwn(actors.partner, {
    requestId: randomUUID(), expectedRevision: 0, profile: profile({ displayName: 'Synthetic Browser Partner' }),
    adultConfirmed: true, consentVersion: 1,
    consent: { memberDiscovery: true, similarity: true, broadenCircle: false },
  });
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synthetic runner backend rehearsal</title></head><body><div id="root"></div><script src="/bundle.js" defer></script></body></html>';
  server = http.createServer((request, response) => {
    for (const [name, value] of Object.entries(HEADERS)) response.setHeader(name, value);
    const selected = route(request.method, request.url, request.headers.host, request.headers.origin);
    if (!selected || stopping) { response.writeHead(403); response.end('Unavailable.'); return; }
    if (selected === '/finish') { request.resume(); void stop(0, response); return; }
    const [type, body] = selected === '/' ? ['text/html; charset=utf-8', html]
      : selected === '/bundle.js' ? ['text/javascript; charset=utf-8', bundle]
        : ['application/json', JSON.stringify({ actors, password })];
    response.writeHead(200, { 'Content-Type': type });
    response.end(body);
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.on('error', () => { console.error('runner_browser_server_failed'); void stop(1); });
  server.listen(9619, '127.0.0.1', () => console.log(`runner_browser_ready: ${ORIGIN}`));
  timer = setTimeout(() => { console.error('runner_browser_expired'); void stop(1); }, 30 * 60 * 1000);
}
process.once('SIGINT', () => { void stop(1); });
process.once('SIGTERM', () => { void stop(1); });
startup = main();
startup.catch(() => { console.error('runner_browser_start_failed'); void stop(1); });
