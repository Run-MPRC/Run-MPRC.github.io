'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/deploy.yml');
const NETLIFY_CONFIG_PATH = path.join(ROOT, 'netlify.toml');
const NETLIFY_GATE_PATH = path.join(ROOT, 'scripts/netlify-ignore-build.js');
const NETLIFY_BUILD_PATH = path.join(ROOT, 'scripts/netlify-release-build.js');
const NETLIFY_MANIFEST_PATH = path.join(
  ROOT,
  'config',
  'netlify-production-release.json',
);
const GITIGNORE_PATH = path.join(ROOT, '.gitignore');
const PUBLIC_CNAME_PATH = path.join(ROOT, 'public/CNAME');
const {
  authorizeProductionRelease,
  evaluateProductionRelease,
  loadManifest,
  validateManifest,
} = require('../scripts/netlify-release-policy');
const {
  buildEnvironment,
} = require('../scripts/netlify-release-build');

const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');
const netlifyConfig = fs.readFileSync(NETLIFY_CONFIG_PATH, 'utf8');
const netlifyBuild = fs.readFileSync(NETLIFY_BUILD_PATH, 'utf8');
const gitignore = fs.readFileSync(GITIGNORE_PATH, 'utf8');

function runNetlifyGate(context) {
  const env = { ...process.env };
  if (context === undefined) {
    delete env.CONTEXT;
  } else {
    env.CONTEXT = context;
  }
  return spawnSync(process.execPath, [NETLIFY_GATE_PATH], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
}

test('release workflow is manual, exact-commit, and fixed-scope', () => {
  assert.match(workflow, /\bon:\n  workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n  push:/);
  assert.match(workflow, /source_commit:/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /Source commit must equal the current tip of main/);
  assert.match(workflow, /actions\/workflows\/ci\.yml\/runs/);
  assert.doesNotMatch(workflow, /-f status=completed/);
  assert.match(workflow, /\.head_branch == "main"/);
  assert.match(workflow, /\.event == "push"/);
  assert.match(workflow, /sort_by\(\[\.run_number, \(\.run_attempt \/\/ 0\)\]\)/);
  assert.match(workflow, /\.status == "completed" and \.conclusion == "success"/);
  assert.match(workflow, /\.conclusion == "success"/);
  assert.match(workflow, /Frontend lint \+ build/);
  assert.match(workflow, /Cloud Functions lint \+ test/);
  assert.equal(
    (workflow.match(/"Commerce command journal emulator"/g) ?? []).length,
    2,
  );
  assert.match(workflow, /Firestore security-rules tests/);
  assert.match(workflow, /options:\n          - profile-recovery/);
  assert.match(workflow, /RELEASE_PLAN: \$\{\{ inputs\.release_plan \}\}/);
  assert.match(workflow, /Unsupported release plan/);
  assert.match(
    workflow,
    /--only firestore:rules,functions:createMemberOnSignUp,functions:ensureMemberProfile/,
  );
  assert.doesNotMatch(workflow, /--only[= ]+functions(?:\s|$)/m);
  assert.equal((workflow.match(/npx --no-install firebase deploy/g) ?? []).length, 1);
  assert.match(workflow, /Staging is unavailable until #113\/#133/);
});

test('website is prebuilt, then backend is read back before publication', () => {
  const preparePosition = workflow.indexOf('  prepare-pages:');
  const backendPosition = workflow.indexOf('  deploy-backend:');
  const pagesPosition = workflow.indexOf('  deploy-pages:');

  assert.ok(preparePosition > 0);
  assert.ok(backendPosition > preparePosition);
  assert.ok(pagesPosition > backendPosition);
  assert.match(workflow.slice(preparePosition, backendPosition), /upload-artifact@[0-9a-f]{40}/);
  assert.match(workflow.slice(backendPosition, pagesPosition), /Always read back Rules and both Function revisions/);
  assert.match(workflow.slice(backendPosition, pagesPosition), /if: \$\{\{ always\(\)/);
  assert.match(
    workflow.slice(pagesPosition),
    /needs:\n      - preflight\n      - prepare-pages\n      - deploy-backend/,
  );
  assert.match(
    workflow.slice(pagesPosition),
    /needs\.deploy-backend\.outputs\.backend_verified == 'true'/,
  );
  assert.match(workflow.slice(pagesPosition), /download-artifact@[0-9a-f]{40}/);
  assert.match(workflow.slice(pagesPosition), /release-commit\.txt/);
  assert.match(workflow.slice(preparePosition, backendPosition), /retention-days: 30/);
});

test('release uses protected short-lived authority and committed tooling', () => {
  const backendHeader = workflow.slice(
    workflow.indexOf('  deploy-backend:'),
    workflow.indexOf('    steps:', workflow.indexOf('  deploy-backend:')),
  );

  assert.match(workflow, /permissions: \{\}/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /google-github-actions\/auth@[0-9a-f]{40}/);
  assert.match(workflow, /access_token_lifetime: 3300s/);
  assert.match(workflow, /npx --no-install firebase --version/);
  assert.match(workflow, /npm ci --legacy-peer-deps --ignore-scripts/);
  assert.doesNotMatch(workflow, /firebase-tools@latest/);
  assert.doesNotMatch(workflow, /npm install -g/);
  assert.doesNotMatch(workflow, /secrets\.FIREBASE_SERVICE_ACCOUNT/);
  assert.doesNotMatch(workflow, /secrets\.FIREBASE_TOKEN/);
  assert.doesNotMatch(workflow, /^\s+FIREBASE_SERVICE_ACCOUNT:/m);
  assert.doesNotMatch(workflow, /^\s+FIREBASE_TOKEN:/m);
  assert.doesNotMatch(workflow, /No .*skipping Firebase deploy/i);
  assert.match(gitignore, /^gha-creds-\*\.json$/m);
  assert.doesNotMatch(backendHeader, /secrets\.GCP_/);

  const installPosition = workflow.indexOf('Install committed deploy dependencies');
  const authPosition = workflow.indexOf('Obtain short-lived Google Cloud credentials');
  const capturePosition = workflow.indexOf('Capture private provider state');
  const postApprovalArtifactPosition = workflow.indexOf(
    'Confirm the prebuilt Pages artifact is still available after approval',
  );
  const postApprovalCiPosition = workflow.indexOf(
    'Revalidate current main and exact CI after protected approval',
  );
  assert.ok(installPosition > 0 && authPosition > installPosition);
  assert.ok(postApprovalArtifactPosition > installPosition);
  assert.ok(postApprovalCiPosition > postApprovalArtifactPosition);
  assert.ok(authPosition > postApprovalCiPosition);
  assert.ok(capturePosition > authPosition);
  assert.match(workflow, /Main advanced after this release was requested/);
  assert.match(workflow, /approved CI run is no longer the newest exact run/);
  assert.match(workflow, /Release request is older than 24 hours/);

  for (const actionLine of workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)) {
    assert.match(actionLine[1], /@[0-9a-f]{40}$/);
  }
});

test('frontend preparation and publication receive no cloud identity', () => {
  const prepareJob = workflow.slice(
    workflow.indexOf('  prepare-pages:'),
    workflow.indexOf('  deploy-backend:'),
  );
  const pagesJob = workflow.slice(workflow.indexOf('  deploy-pages:'));

  assert.doesNotMatch(prepareJob, /id-token:/);
  assert.doesNotMatch(prepareJob, /secrets\.GCP_/);
  assert.doesNotMatch(pagesJob, /id-token:/);
  assert.doesNotMatch(pagesJob, /secrets\.GCP_/);
  assert.doesNotMatch(pagesJob, /^\s+DEPLOY_SERVICE_ACCOUNT:/m);
  assert.doesNotMatch(pagesJob, /^\s+WORKLOAD_IDENTITY_PROVIDER:/m);
  assert.match(prepareJob, /Reject server-credential material/);
  assert.match(pagesJob, /credential separation/);
  assert.equal((workflow.match(/grep -R -q -E/g) ?? []).length, 3);
  assert.doesNotMatch(workflow, /grep -R -E/);
  assert.match(workflow, /secrets\.GCP_WORKLOAD_IDENTITY_PROVIDER/);
  assert.match(workflow, /secrets\.GCP_DEPLOY_SERVICE_ACCOUNT/);
  assert.doesNotMatch(pagesJob, /^    environment:/m);
  assert.doesNotMatch(pagesJob, /^\s+cname:/m);
  assert.equal(fs.existsSync(PUBLIC_CNAME_PATH), false);
});

test('Netlify production is a pinned one-release build while previews remain available', () => {
  assert.match(
    netlifyConfig,
    /ignore = "node \.\/scripts\/netlify-ignore-build\.js"/,
  );
  assert.match(
    netlifyConfig,
    /\[context\.production\][\s\S]*command = "node \.\/scripts\/netlify-release-build\.js"/,
  );
  assert.match(
    netlifyConfig,
    /\[context\.deploy-preview\][\s\S]*command = "node \.\/scripts\/netlify-release-build\.js --preview"/,
  );
  assert.match(netlifyConfig, /NPM_FLAGS = "--legacy-peer-deps --ignore-scripts"/);
  assert.match(
    netlifyConfig,
    /for = "\/\.well-known\/run-mprc-release\.json"/,
  );

  [undefined, 'production', 'future-unknown-context'].forEach((context) => {
    const result = runNetlifyGate(context);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /production build(?:s| is) (?:are )?paused/);
  });

  ['deploy-preview', 'branch-deploy'].forEach((context) => {
    const result = runNetlifyGate(context);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /may continue/);
  });
});

test('Netlify manifest pins the reviewed hotfix source and rollback', () => {
  const loaded = loadManifest(NETLIFY_MANIFEST_PATH);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.manifest.active, true);
  assert.equal(loaded.manifest.issueNumber, 457);
  assert.equal(
    loaded.manifest.expectedProductionParent,
    '491cc22d80de1faae1960bd63c80ce62e648397b',
  );
  assert.equal(
    loaded.manifest.sourceCommit,
    'ed1b0833f25822cee80c99ded8753722b5608a3f',
  );
  assert.equal(
    loaded.manifest.sourceTree,
    '878c6628d961f4484cb49208aef53f1e9f2e3b47',
  );
  assert.equal(
    loaded.manifest.rollbackDeployId,
    '6a54a3c93db9d300082e1f5f',
  );
  assert.equal(
    loaded.manifest.sourceRef,
    'refs/heads/codex/netlify-source-457-header',
  );
  assert.equal(
    loaded.manifest.previewBranch,
    'codex/issue-457-netlify-release',
  );
  assert.equal(loaded.manifest.expectedSiteFileCount, 60);
  assert.equal(
    loaded.manifest.expectedSiteFilesSha256,
    '7570955c2a00926e5813aef135f1799172cfd046072ac89fb4e492bed0797092',
  );

  const sourceTree = spawnSync(
    'git',
    ['show', '-s', '--format=%T', loaded.manifest.sourceCommit],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const hotfixTree = spawnSync(
    'git',
    ['show', '-s', '--format=%T', 'b9f77ba9dfb153ff8ba203811dfc9c81f7cac31f'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(sourceTree.status, 0);
  assert.equal(hotfixTree.status, 0);
  assert.equal(sourceTree.stdout.trim(), loaded.manifest.sourceTree);
  assert.equal(hotfixTree.stdout.trim(), loaded.manifest.sourceTree);

  const mainOnlyFile = spawnSync(
    'git',
    ['cat-file', '-e', `${loaded.manifest.sourceCommit}:functions/commerceState.js`],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.notEqual(mainOnlyFile.status, 0);
});

test('Netlify production authorization is exact-merge scoped', () => {
  const loaded = loadManifest(NETLIFY_MANIFEST_PATH);
  assert.equal(loaded.ok, true);
  const { manifest } = loaded;
  const mergeCommit = {
    sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    head: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    tree: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    parents: [
      manifest.expectedProductionParent,
      'cccccccccccccccccccccccccccccccccccccccc',
    ],
  };
  const environment = {
    NETLIFY: 'true',
    CONTEXT: 'production',
    BRANCH: 'main',
    COMMIT_REF: mergeCommit.sha,
  };
  assert.deepEqual(
    evaluateProductionRelease({
      commit: mergeCommit,
      env: environment,
      manifest,
    }),
    { ok: true, reason: 'release_authorized' },
  );

  const failures = [
    { env: { ...environment, NETLIFY: 'false' }, commit: mergeCommit },
    { env: { ...environment, CONTEXT: 'deploy-preview' }, commit: mergeCommit },
    { env: { ...environment, BRANCH: 'release' }, commit: mergeCommit },
    {
      env: { ...environment, INCOMING_HOOK_TITLE: 'unverified-hook' },
      commit: mergeCommit,
    },
    { env: { ...environment, COMMIT_REF: 'd'.repeat(40) }, commit: mergeCommit },
    { env: environment, commit: { ...mergeCommit, head: 'd'.repeat(40) } },
    { env: environment, commit: { ...mergeCommit, parents: [] } },
    {
      env: environment,
      commit: {
        ...mergeCommit,
        parents: ['d'.repeat(40), mergeCommit.parents[1]],
      },
    },
    {
      env: environment,
      commit: {
        ...mergeCommit,
        parents: [manifest.expectedProductionParent],
      },
    },
  ];
  failures.forEach((failure) => {
    assert.equal(
      evaluateProductionRelease({
        ...failure,
        manifest,
      }).ok,
      false,
    );
  });
  assert.equal(
    evaluateProductionRelease({
      commit: mergeCommit,
      env: environment,
      manifest: { ...manifest, active: false },
    }).ok,
    false,
  );
});

test('Netlify production authorization survives a shallow merge checkout and blocks its successor', () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'mprc-netlify-policy-'),
  );
  const source = path.join(temporaryRoot, 'source');
  const shallow = path.join(temporaryRoot, 'shallow');
  const runGit = (cwd, args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    fs.mkdirSync(source);
    runGit(source, ['init', '-b', 'main']);
    runGit(source, ['config', 'user.name', 'Synthetic Release Test']);
    runGit(source, ['config', 'user.email', 'synthetic@example.test']);
    fs.writeFileSync(path.join(source, 'base.txt'), 'base\n');
    runGit(source, ['add', 'base.txt']);
    runGit(source, ['commit', '-m', 'Synthetic production base']);
    const base = runGit(source, ['rev-parse', 'HEAD']);

    runGit(source, ['switch', '-c', 'release']);
    const manifest = JSON.parse(fs.readFileSync(NETLIFY_MANIFEST_PATH, 'utf8'));
    manifest.expectedProductionParent = base;
    fs.mkdirSync(path.join(source, 'config'));
    fs.writeFileSync(
      path.join(source, 'config', 'netlify-production-release.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    runGit(source, ['add', 'config/netlify-production-release.json']);
    runGit(source, ['commit', '-m', 'Arm synthetic release']);
    runGit(source, ['switch', 'main']);
    runGit(source, ['merge', '--no-ff', 'release', '-m', 'Merge synthetic release']);
    const merge = runGit(source, ['rev-parse', 'HEAD']);

    runGit(
      temporaryRoot,
      ['clone', '--depth=1', `file://${source}`, shallow],
    );
    const shallowAuthorization = authorizeProductionRelease({
      cwd: shallow,
      env: {
        NETLIFY: 'true',
        CONTEXT: 'production',
        BRANCH: 'main',
        COMMIT_REF: merge,
      },
      manifestPath: path.join(
        shallow,
        'config',
        'netlify-production-release.json',
      ),
    });
    assert.equal(shallowAuthorization.ok, true);

    fs.writeFileSync(path.join(source, 'later.txt'), 'later\n');
    runGit(source, ['add', 'later.txt']);
    runGit(source, ['commit', '-m', 'Unrelated later merge']);
    const later = runGit(source, ['rev-parse', 'HEAD']);
    const laterAuthorization = authorizeProductionRelease({
      cwd: source,
      env: {
        NETLIFY: 'true',
        CONTEXT: 'production',
        BRANCH: 'main',
        COMMIT_REF: later,
      },
      manifestPath: path.join(
        source,
        'config',
        'netlify-production-release.json',
      ),
    });
    assert.equal(laterAuthorization.ok, false);
    assert.equal(laterAuthorization.reason, 'deploy_parent');
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('Netlify release manifest rejects malformed or expanded authority', () => {
  const manifest = JSON.parse(fs.readFileSync(NETLIFY_MANIFEST_PATH, 'utf8'));
  [
    null,
    { ...manifest, extraAuthority: true },
    { ...manifest, sourceCommit: 'not-a-commit' },
    { ...manifest, sourceRef: 'refs/tags/unreviewed' },
    { ...manifest, sourceRepository: 'https://example.com/other.git' },
    { ...manifest, rollbackDeployId: 'not-a-deploy' },
    { ...manifest, previewBranch: 'main' },
    { ...manifest, expectedSiteFileCount: 0 },
    { ...manifest, expectedSiteFilesSha256: 'not-an-artifact-digest' },
    { ...manifest, sourceCommit: manifest.previousSourceCommit },
  ].forEach((candidate) => {
    assert.equal(validateManifest(candidate).ok, false);
  });
});

test('Netlify release builder isolates source, environment, and public proof', () => {
  assert.match(netlifyBuild, /git[\s\S]*fetch[\s\S]*--depth=1/);
  assert.match(netlifyBuild, /fetchedCommit !== manifest\.sourceCommit/);
  assert.match(netlifyBuild, /fetchedTree !== manifest\.sourceTree/);
  assert.match(netlifyBuild, /npm[\s\S]*ci[\s\S]*--ignore-scripts/);
  assert.match(netlifyBuild, /expectedSiteFilesSha256/);
  assert.doesNotMatch(netlifyBuild, /env:\s*process\.env/);
  assert.doesNotMatch(netlifyBuild, /npm run build/);
  assert.match(netlifyBuild, /run-mprc-release\.json/);
  assert.match(netlifyBuild, /siteFilesSha256/);
  assert.match(netlifyBuild, /CREDENTIAL_MARKERS/);
});

test('Netlify pinned build receives no provider or React application variables', () => {
  const environment = buildEnvironment('/tmp/synthetic-home', {
    PATH: '/synthetic/bin',
    TMPDIR: '/tmp/synthetic',
    REACT_APP_RECAPTCHA_SITE_KEY: 'public-site-key',
    REACT_APP_SENTRY_ENV: 'production',
    REACT_APP_UNREVIEWED_VALUE: 'blocked',
    FIREBASE_SERVICE_ACCOUNT: 'blocked',
    STRIPE_SECRET_KEY: 'blocked',
  });
  assert.equal(environment.REACT_APP_RECAPTCHA_SITE_KEY, undefined);
  assert.equal(environment.REACT_APP_SENTRY_ENV, undefined);
  assert.equal(environment.REACT_APP_UNREVIEWED_VALUE, undefined);
  assert.equal(environment.FIREBASE_SERVICE_ACCOUNT, undefined);
  assert.equal(environment.STRIPE_SECRET_KEY, undefined);
  assert.equal(environment.PATH, '/synthetic/bin');
  assert.equal(environment.HOME, '/tmp/synthetic-home');
});

test('Netlify manifest file rejects duplicate-key or noncanonical JSON', () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'mprc-netlify-manifest-'),
  );
  const duplicatePath = path.join(temporaryRoot, 'duplicate.json');
  const canonical = fs.readFileSync(NETLIFY_MANIFEST_PATH, 'utf8');
  try {
    fs.writeFileSync(
      duplicatePath,
      canonical.replace(
        '  "active": true,',
        '  "active": false,\n  "active": true,',
      ),
    );
    const loaded = loadManifest(duplicatePath);
    assert.equal(loaded.ok, false);
    assert.equal(loaded.reason, 'manifest_canonical');
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
