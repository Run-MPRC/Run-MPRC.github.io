'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { verifyCurrentSource } = require('./staging-profile-authority');
const { createBundle, functionSpec, validateHostedFunction, jsonRequest } = require('./staging-community-release');
const { verifyExecutableArtifact } = require('./firebase-hosting-contract');
const dues = require('./staging-test-dues-contract');
const { verifyFunctions: verifyDues, verifyAuthority: verifyDuesAuthority } = require('./staging-test-dues-release');
const PROJECT = 'run-mprc-staging';
const ACCOUNT = 'runmprc@gmail.com';
const check = (value) => { if (!value) throw new Error('staging_community_hosting_failed'); };
function validateBundle(native, digest) {
  check(`${native.labels?.['bundle-a']}${native.labels?.['bundle-b']}` === digest);
  validateHostedFunction(native, functionSpec(native.labels?.['source-sha'], digest, 'https://storage.googleapis.com/synthetic'));
}
function duesEnvironment(input, plan) {
  const env = { ...input };
  delete env.REACT_APP_TEST_DUES_STAGING;
  if (plan) {
    dues.validatePlan(plan);
    check(env.REACT_APP_FIREBASE_ENVIRONMENT === 'staging' && env.REACT_APP_FIREBASE_PROJECT_ID === PROJECT && env.REACT_APP_COMMUNITY_STAGING === 'true');
    env.REACT_APP_TEST_DUES_STAGING = 'true';
  }
  return env;
}
async function ownerToken() {
  const token = execFileSync('/opt/homebrew/bin/gcloud', ['auth', 'print-access-token', `--account=${ACCOUNT}`, `--project=${PROJECT}`], { encoding: 'utf8' }).trim();
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  check(response.ok && (await response.json()).email === ACCOUNT);
  return token; // No ADC fallback, persistent login, credential file or printed token.
}
async function publish(args = []) {
  check(args.length === 0 || (args.length === 2 && args[0] === 'test-dues'));
  const plan = args.length ? dues.readPlan(args[1]) : null;
  const root = path.resolve(__dirname, '..');
  check(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() === '');
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const source = { GITHUB_SHA: sha, GH_TOKEN: execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim() };
  await verifyCurrentSource(source);
  const token = await ownerToken();
  const native = await jsonRequest(`https://cloudfunctions.googleapis.com/v1/projects/${PROJECT}/locations/us-central1/functions/communityActions`, token);
  const digest = createBundle(root).digest;
  validateBundle(native, digest);
  // Script/docs-only commits do not require another paid Function build. Require
  // ancestor provenance AND native source bytes identical to the green main bundle.
  execFileSync('git', ['merge-base', '--is-ancestor', native.labels['source-sha'], sha], { cwd: root });
  const download = await jsonRequest(`https://cloudfunctions.googleapis.com/v1/${native.name}:generateDownloadUrl`, token, 'POST', {});
  const archiveUrl = new URL(download.downloadUrl);
  check(archiveUrl.protocol === 'https:' && archiveUrl.hostname === 'storage.googleapis.com');
  const archive = await fetch(download.downloadUrl, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  check(archive.ok && createHash('sha256').update(Buffer.from(await archive.arrayBuffer())).digest('hex') === digest);
  let duesDigest;
  if (plan) {
    await verifyDuesAuthority(token, plan);
    duesDigest = dues.createBundle(root).digest;
    const inventory = await jsonRequest(`https://cloudfunctions.googleapis.com/v1/projects/${PROJECT}/locations/-/functions`, token);
    await verifyDues({ inventory, plan, digest: duesDigest, token, sha,
      verifyProvenance: async nativeSha => { execFileSync('git', ['merge-base', '--is-ancestor', nativeSha, sha], { cwd: root }); return true; } });
  }
  const configResponse = await fetch(`https://${PROJECT}.web.app/__/firebase/init.json`, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  check(configResponse.ok); const config = await configResponse.json();
  check(config.projectId === PROJECT && typeof config.appId === 'string');
  const projectNumber = config.appId.match(/^1:([0-9]+):web:/)?.[1];
  check(projectNumber && projectNumber === config.messagingSenderId);
  const appCheckResponse = await fetch(`https://firebaseappcheck.googleapis.com/v1/projects/${projectNumber}/apps/${encodeURIComponent(config.appId)}/recaptchaEnterpriseConfig`, {
    headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT }, redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  check(appCheckResponse.ok); const appCheck = await appCheckResponse.json();
  check(typeof appCheck.siteKey === 'string' && /^[A-Za-z0-9_-]{30,128}$/.test(appCheck.siteKey));
  const env = duesEnvironment({
    ...process.env, CI: 'true', DISABLE_ESLINT_PLUGIN: 'true',
    REACT_APP_FIREBASE_ENVIRONMENT: 'staging', REACT_APP_COMMUNITY_STAGING: 'true',
    REACT_APP_FIREBASE_API_KEY: config.apiKey, REACT_APP_FIREBASE_AUTH_DOMAIN: config.authDomain,
    REACT_APP_FIREBASE_PROJECT_ID: PROJECT, REACT_APP_FIREBASE_STORAGE_BUCKET: config.storageBucket,
    REACT_APP_FIREBASE_MESSAGING_SENDER_ID: config.messagingSenderId, REACT_APP_FIREBASE_APP_ID: config.appId,
    REACT_APP_RECAPTCHA_SITE_KEY: appCheck.siteKey,
  }, plan);
  delete env.REACT_APP_FIREBASE_MEASUREMENT_ID; delete env.REACT_APP_SENTRY_DSN;
  execFileSync(path.join(root, 'node_modules/.bin/react-scripts'), ['build'], { cwd: root, env, stdio: 'pipe', timeout: 180000, maxBuffer: 2_000_000 });
  verifyExecutableArtifact(path.join(root, 'build'), env);
  fs.writeFileSync(path.join(root, 'build/community-release.json'), JSON.stringify({ schemaVersion: 1, project: PROJECT, sourceSha: sha, functionBundle: digest, ...(plan ? { testDuesBundle: duesDigest } : {}) }) + '\n');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mprc-community-hosting-owned-'));
  try {
    const filename = path.join(directory, 'firebase.json');
    fs.writeFileSync(filename, JSON.stringify({ hosting: { site: PROJECT, public: path.join(root, 'build'), ignore: ['firebase.json', '**/.*', '**/node_modules/**'], rewrites: [{ source: '**', destination: '/index.html' }] } }));
    await verifyCurrentSource(source);
    if (plan) {
      await verifyDuesAuthority(token, plan);
      await verifyDues({ inventory: await jsonRequest(`https://cloudfunctions.googleapis.com/v1/projects/${PROJECT}/locations/-/functions`, token), plan, digest: duesDigest, token, sha,
        verifyProvenance: async nativeSha => { execFileSync('git', ['merge-base', '--is-ancestor', nativeSha, sha], { cwd: root }); return true; } });
    }
    check(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() === '');
    const deployEnv = { ...env, FIREBASE_TOKEN: await ownerToken(), GOOGLE_CLOUD_QUOTA_PROJECT: PROJECT };
    execFileSync(path.join(root, 'node_modules/.bin/firebase'), ['deploy', '--only', 'hosting', '--config', filename, '--project', PROJECT, '--non-interactive'], { cwd: root, env: deployEnv, stdio: 'pipe', timeout: 180000, maxBuffer: 2_000_000 });
    const response = await fetch(`https://${PROJECT}.web.app/community-release.json`, { cache: 'no-store', redirect: 'error' });
    check(response.ok); const marker = await response.json();
    check(marker.sourceSha === sha && marker.project === PROJECT && marker.functionBundle === digest
      && (plan ? marker.testDuesBundle === duesDigest : marker.testDuesBundle === undefined));
    process.stdout.write(`staging_community_hosting_published_verified ${sha}\n`);
  } finally { fs.rmSync(directory, { recursive: true }); }
}
if (require.main === module) publish(process.argv.slice(2)).catch(() => { process.stderr.write('staging_community_hosting_failed\n'); process.exitCode = 1; });
module.exports = { validateBundle, duesEnvironment };
