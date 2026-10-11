'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { verifyCurrentSource } = require('./staging-profile-authority');
const { functionSpec, validateHostedFunction, jsonRequest } = require('./staging-community-release');
const { verifyExecutableArtifact } = require('./firebase-hosting-contract');
const PROJECT = 'run-mprc-staging';
const ACCOUNT = 'runmprc@gmail.com';
const check = (value) => { if (!value) throw new Error('staging_community_hosting_failed'); };
async function publish() {
  const root = path.resolve(__dirname, '..');
  check(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() === '');
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const source = { GITHUB_SHA: sha, GH_TOKEN: execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim() };
  await verifyCurrentSource(source);
  const token = execFileSync('/opt/homebrew/bin/gcloud', ['auth', 'print-access-token', `--account=${ACCOUNT}`, `--project=${PROJECT}`], { encoding: 'utf8' }).trim();
  const native = await jsonRequest(`https://cloudfunctions.googleapis.com/v1/projects/${PROJECT}/locations/us-central1/functions/communityActions`, token);
  const digest = `${native.labels?.['bundle-a']}${native.labels?.['bundle-b']}`;
  validateHostedFunction(native, functionSpec(sha, digest, 'https://storage.googleapis.com/synthetic'));
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
  const env = {
    ...process.env, CI: 'true', DISABLE_ESLINT_PLUGIN: 'true',
    REACT_APP_FIREBASE_ENVIRONMENT: 'staging', REACT_APP_COMMUNITY_STAGING: 'true',
    REACT_APP_FIREBASE_API_KEY: config.apiKey, REACT_APP_FIREBASE_AUTH_DOMAIN: config.authDomain,
    REACT_APP_FIREBASE_PROJECT_ID: PROJECT, REACT_APP_FIREBASE_STORAGE_BUCKET: config.storageBucket,
    REACT_APP_FIREBASE_MESSAGING_SENDER_ID: config.messagingSenderId, REACT_APP_FIREBASE_APP_ID: config.appId,
    REACT_APP_RECAPTCHA_SITE_KEY: appCheck.siteKey,
  };
  delete env.REACT_APP_FIREBASE_MEASUREMENT_ID; delete env.REACT_APP_SENTRY_DSN;
  execFileSync(path.join(root, 'node_modules/.bin/react-scripts'), ['build'], { cwd: root, env, stdio: 'pipe', timeout: 180000, maxBuffer: 2_000_000 });
  verifyExecutableArtifact(path.join(root, 'build'), env);
  fs.writeFileSync(path.join(root, 'build/community-release.json'), JSON.stringify({ schemaVersion: 1, project: PROJECT, sourceSha: sha, functionBundle: digest }) + '\n');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mprc-community-hosting-owned-'));
  try {
    const filename = path.join(directory, 'firebase.json');
    fs.writeFileSync(filename, JSON.stringify({ hosting: { site: PROJECT, public: path.join(root, 'build'), ignore: ['firebase.json', '**/.*', '**/node_modules/**'], rewrites: [{ source: '**', destination: '/index.html' }] } }));
    await verifyCurrentSource(source);
    check(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() === '');
    execFileSync(path.join(root, 'node_modules/.bin/firebase'), ['deploy', '--only', 'hosting', '--config', filename, '--project', PROJECT, '--account', ACCOUNT, '--non-interactive'], { cwd: root, env, stdio: 'pipe', timeout: 180000, maxBuffer: 2_000_000 });
    const response = await fetch(`https://${PROJECT}.web.app/community-release.json`, { cache: 'no-store', redirect: 'error' });
    check(response.ok); const marker = await response.json();
    check(marker.sourceSha === sha && marker.project === PROJECT && marker.functionBundle === digest);
    process.stdout.write(`staging_community_hosting_published_verified ${sha}\n`);
  } finally { fs.rmSync(directory, { recursive: true }); }
}
if (require.main === module) publish().catch(() => { process.stderr.write('staging_community_hosting_failed\n'); process.exitCode = 1; });
