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
const FINAL_RELEASE_TRUTH_PATHS = [
  'IMPLEMENTATION_PLAN.md',
  'OFFICER_START_HERE.md',
  'OPERATIONS_RUNBOOK.md',
  'README.md',
  'SECURITY.md',
  'SYSTEM_DESIGN.md',
  'docs/officers/ACCESS_CONTINUITY.md',
  'docs/officers/EVENTS_SHOP_MEMBERS.md',
  'docs/officers/PUBLISH_AND_CHECK.md',
  'docs/officers/README.md',
  'docs/officers/REQUEST_A_CHANGE.md',
  'docs/officers/SYSTEM_MAPS.md',
  'docs/officers/UPDATE_PUBLIC_CONTENT.md',
];
const {
  authorizeProductionRelease,
  evaluateProductionRelease,
  loadManifest,
  validateManifest,
} = require('../scripts/netlify-release-policy');
const {
  buildEnvironment,
  releaseMarkerPayload,
} = require('../scripts/netlify-release-build');

const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');
const netlifyConfig = fs.readFileSync(NETLIFY_CONFIG_PATH, 'utf8');
const netlifyBuild = fs.readFileSync(NETLIFY_BUILD_PATH, 'utf8');
const gitignore = fs.readFileSync(GITIGNORE_PATH, 'utf8');
const finalReleaseTruth = new Map(
  FINAL_RELEASE_TRUTH_PATHS.map((relativePath) => [
    relativePath,
    fs.readFileSync(path.join(ROOT, relativePath), 'utf8'),
  ]),
);

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

test('Netlify production is an exact-artifact release while previews remain available', () => {
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

test('Netlify manifest pins the inactive bounded #659 keyboard-focus release', () => {
  const loaded = loadManifest(NETLIFY_MANIFEST_PATH);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.manifest.active, false);
  assert.equal(
    loaded.manifest.releaseId,
    'WEB-002D-KEYBOARD-FOCUS-2026-08-14',
  );
  assert.equal(loaded.manifest.issueNumber, 659);
  assert.equal(
    loaded.manifest.expectedProductionParent,
    '95880748e15c03b0ee58da6e1ed11ac6c9526529',
  );
  assert.equal(
    loaded.manifest.sourceCommit,
    '7496fe0881fb52908c4ff2f40f488df09c94c908',
  );
  assert.equal(
    loaded.manifest.sourceTree,
    'ccac4c189c195db8ab594e0eefe256ea9fa04996',
  );
  assert.equal(
    loaded.manifest.previousSourceCommit,
    'c2d87d1f69f15e128a0bc9b1b9f915b7c8417aec',
  );
  assert.equal(
    loaded.manifest.rollbackDeployId,
    '6a7e072f8f346b0008510d29',
  );
  assert.equal(
    loaded.manifest.sourceRef,
    'refs/heads/codex/netlify-source-659-keyboard-focus',
  );
  assert.equal(
    loaded.manifest.previewBranch,
    'codex/issue-659-netlify-release',
  );
  assert.equal(loaded.manifest.expectedSiteFileCount, 62);
  assert.equal(
    loaded.manifest.expectedSiteFilesSha256,
    'e4c26e6f0fbcd086663d86238675f0be228fb649a00628c1c97d1166612f49c7',
  );
});

test('completed #659 records are live while #623 remains rollback history', () => {
  assert.match(
    netlifyConfig,
    /temporary #659 production authority is inactive again/i,
  );
  assert.match(
    netlifyConfig,
    /Ordinary[\s\S]{0,20}previews use their checked-out tree/i,
  );

  finalReleaseTruth.forEach((contents, relativePath) => {
    assert.match(contents, /#659/);
    assert.match(contents, /6a7ece87c5ca4d0007c1a3fc/);
    assert.match(contents, /#623/);
    assert.match(contents, /6a7e072f8f346b0008510d29/);
    if (relativePath !== 'docs/officers/UPDATE_PUBLIC_CONTENT.md') {
      assert.match(contents, /#473/);
    }
    [
      /PENDING #473 RELEASE/i,
      /Temporary #473 permissions-containment release — PENDING REVIEW AND RELEASE/i,
      /Issue #473 now prepares a replacement/i,
      /#473's narrower replacement is \*\*NOT AVAILABLE YET\*\*/i,
      /WEB-002D pending/i,
      /Temporary #659[^\n]*— (?:UNDER REVIEW|PENDING)/i,
      /#659[^\n]{0,180}(?:under review|is not published|not published|not live yet)/i,
      /(?:under review|not published)[^\n]{0,180}#659/i,
      /#659 LIVE CHECK UNDER REVIEW/i,
      /ONLY AFTER THE EXACT #659 MARKER IS LIVE/i,
      /production remains #623/i,
    ].forEach((staleClaim) => {
      assert.doesNotMatch(
        contents,
        staleClaim,
        `${relativePath} must not retain stale #659 or #473 release status`,
      );
    });
  });

  const completedTruth = new Map([
    [
      'IMPLEMENTATION_PLAN.md',
      /WEB-002D completed release boundary:[^\n]*#659[^\n]*completed[^\n]*6a7ece87c5ca4d0007c1a3fc/i,
    ],
    [
      'OFFICER_START_HERE.md',
      /#659[^\n]*completed[^\n]*6a7ece87c5ca4d0007c1a3fc[^\n]*live/i,
    ],
    [
      'OPERATIONS_RUNBOOK.md',
      /#659[^\n]*completed[^\n]*6a7ece87c5ca4d0007c1a3fc[^\n]*published/i,
    ],
    [
      'README.md',
      /#659[^\n]*completed one bounded accessibility release[^\n]*published deploy `6a7ece87c5ca4d0007c1a3fc`/i,
    ],
    [
      'SECURITY.md',
      /WEB-002D completed exact-artifact containment[^\n]*#659[^\n]*completed[^\n]*published deploy `6a7ece87c5ca4d0007c1a3fc`/i,
    ],
    [
      'SYSTEM_DESIGN.md',
      /#659[^\n]*completed[^\n]*published deploy `6a7ece87c5ca4d0007c1a3fc`/i,
    ],
    [
      'docs/officers/ACCESS_CONTINUITY.md',
      /live #659 marker[^\n]*deploy `6a7ece87c5ca4d0007c1a3fc`/i,
    ],
    [
      'docs/officers/EVENTS_SHOP_MEMBERS.md',
      /live #659 deploy `6a7ece87c5ca4d0007c1a3fc` preserves the inert #623/i,
    ],
    [
      'docs/officers/PUBLISH_AND_CHECK.md',
      /Temporary #659 keyboard-navigation and route-focus release — COMPLETED 2026-08-14/i,
    ],
    [
      'docs/officers/README.md',
      /#659[^\n]*completed[^\n]*Deploy `6a7ece87c5ca4d0007c1a3fc`[^\n]*live/i,
    ],
    [
      'docs/officers/REQUEST_A_CHANGE.md',
      /completed #659 exception published accessibility deploy `6a7ece87c5ca4d0007c1a3fc`/i,
    ],
    [
      'docs/officers/SYSTEM_MAPS.md',
      /completed #659 exception[^\n]*deploy `6a7ece87c5ca4d0007c1a3fc` remains live/i,
    ],
    [
      'docs/officers/UPDATE_PUBLIC_CONTENT.md',
      /#659 LIVE AND VERIFIED 2026-08-14[\s\S]*production deploy `6a7ece87c5ca4d0007c1a3fc`/i,
    ],
  ]);
  completedTruth.forEach((expectedTruth, relativePath) => {
    const record = finalReleaseTruth.get(relativePath);
    assert.match(
      record,
      expectedTruth,
      `${relativePath} must bind #659's completed state to the live deploy`,
    );
  });

  const canonicalRecords = [
    finalReleaseTruth.get('OPERATIONS_RUNBOOK.md'),
    finalReleaseTruth.get('docs/officers/PUBLISH_AND_CHECK.md'),
  ];
  [
    '6a7ec998bf8fde00086d2bfe',
    '137d8a8721339a6ca1079283cc34c1bd7cc2706c',
    '31781730576',
    '46e23647d8e0bf9fa3a574ea5c5f993be10a419d',
    '3ef47ed0f664e1e9a2c703332ca9071cfda27ad2',
    '31783141914',
    '6a7ece87c5ca4d0007c1a3fc',
    '7496fe0881fb52908c4ff2f40f488df09c94c908',
    'ccac4c189c195db8ab594e0eefe256ea9fa04996',
    'e4c26e6f0fbcd086663d86238675f0be228fb649a00628c1c97d1166612f49c7',
    '95880748e15c03b0ee58da6e1ed11ac6c9526529',
    '462eeb01e7a9858678802464f7dd4b76cd2fcb3c13be827efb4f98fa53ca809c',
    '6a7ecfbc90347c000804901c',
    '94c949abed3759c15cdaa98afc6896343e8a6edd',
    '31783487885',
    '3138a00c1c48e1d5d1dcda0b44722b09a2194ff7',
    'c4667394dc9a2286c3a2eda028728314e925c22f',
    '31783808994',
    '6a7ed0ddb00a46000818878d',
  ].forEach((identifier) => {
    canonicalRecords.forEach((record) => {
      assert.match(record, new RegExp(identifier));
    });
  });
  canonicalRecords.forEach((record) => {
    assert.match(record, /(?:62 files|62-file)/i);
    assert.match(
      record,
      /(?:6a7ed0ddb00a46000818878d[\s\S]{0,240}(?:unpublished|published nothing|publish nothing)|(?:unpublished|published nothing|publish nothing)[\s\S]{0,240}6a7ed0ddb00a46000818878d)/i,
    );
    assert.match(
      record,
      /(?:6a7ece87c5ca4d0007c1a3fc[\s\S]{0,300}(?:retained|remained|left|stayed)|(?:retained|remained|left|stayed)[\s\S]{0,300}6a7ece87c5ca4d0007c1a3fc)/i,
    );
  });

  // Preserve the complete historical #623 release and rollback chain.
  [
    '9d5cc8612b4321172370bd949d307e7e4ac0ec7d',
    '6a7e072f8f346b0008510d29',
    'c2d87d1f69f15e128a0bc9b1b9f915b7c8417aec',
    '411aa6ec9a9459f5d923030533ffc7c007fe6908',
    'd837272a1e5efc1575809e87f532276b38d1a63f1dd79ec1aef0533f6da8afb1',
    '019353361210021483f23003e09ee6924b78e67c',
    'c8678c623afdd9becf77d596b71f36f26f04b746',
    '6a7e081e73fdd60009f7ba57',
    '31729248865',
  ].forEach((identifier) => {
    canonicalRecords.forEach((record) => {
      assert.match(record, new RegExp(identifier));
    });
  });
  canonicalRecords.forEach((record) => {
    assert.match(
      record,
      /(?:6a7e081e73fdd60009f7ba57[\s\S]{0,240}(?:unpublished|published nothing|publish nothing)|(?:unpublished|published nothing|publish nothing)[\s\S]{0,240}6a7e081e73fdd60009f7ba57)/i,
    );
    assert.match(
      record,
      /(?:6a7e072f8f346b0008510d29[\s\S]{0,300}(?:retained|remained|left|stayed)|(?:retained|remained|left|stayed)[\s\S]{0,300}6a7e072f8f346b0008510d29)/i,
    );
  });

  // Preserve the complete historical #473 release and rollback chain.
  [
    '40728ff6141e34a279b70cc41d983c22ac5f0daa',
    '6a6dc0167fbe68000816b448',
    '1099ee8e6fdb81141fd9460de175b6d854cbcfdd',
    '6a6dc219a8136300081811db',
    'dee79511b6e371329aa129139729e112e7a51aad',
    '6a6dc35767a4ef000877e74b',
    '9ad6837756cdd409d296009fde5082eeeae5c059',
    '6a6dc9ea588b0c0008036312',
    'cb6a8f0a418fc14b448bce5ded71d68520415c92',
    '6a6dcdd47bc81e000859a249',
    '30696264830',
  ].forEach((identifier) => {
    canonicalRecords.forEach((record) => {
      assert.match(record, new RegExp(identifier));
    });
  });

  const eventsAndShop = finalReleaseTruth.get(
    'docs/officers/EVENTS_SHOP_MEMBERS.md',
  );
  assert.match(eventsAndShop, /MPRC Hat at \$10\.00/);
  assert.match(eventsAndShop, /MPRC Jacket at \$25\.00/);
  assert.match(
    eventsAndShop,
    /Error: We could not load events right now\. Please try again later\./,
  );
  assert.match(
    eventsAndShop,
    /We could not load events right now\. Please try again later\./,
  );
  assert.match(eventsAndShop, /event records remain unavailable/i);
});

test('Netlify preview and production markers separate control from stable provenance', () => {
  const loaded = loadManifest(NETLIFY_MANIFEST_PATH);
  assert.equal(loaded.ok, true);
  const artifact = Object.freeze({
    fileCount: loaded.manifest.expectedSiteFileCount,
    sha256: loaded.manifest.expectedSiteFilesSha256,
  });
  const previewControl = 'a'.repeat(40);
  const productionControl = 'b'.repeat(40);
  const preview = releaseMarkerPayload(
    loaded.manifest,
    previewControl,
    artifact,
  );
  const production = releaseMarkerPayload(
    loaded.manifest,
    productionControl,
    artifact,
  );

  assert.equal(preview.controlCommit, previewControl);
  assert.equal(production.controlCommit, productionControl);
  assert.notEqual(preview.controlCommit, production.controlCommit);
  const { controlCommit: previewDynamic, ...previewStable } = preview;
  const { controlCommit: productionDynamic, ...productionStable } = production;
  assert.equal(previewDynamic, previewControl);
  assert.equal(productionDynamic, productionControl);
  assert.deepEqual(previewStable, productionStable);
  assert.equal(previewStable.sourceCommit, loaded.manifest.sourceCommit);
  assert.equal(
    previewStable.previousSourceCommit,
    loaded.manifest.previousSourceCommit,
  );
});

test('Netlify production authorization is exact-merge scoped', () => {
  const loaded = loadManifest(NETLIFY_MANIFEST_PATH);
  assert.equal(loaded.ok, true);
  const { manifest } = loaded;
  const activeManifest = { ...manifest, active: true };
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
      manifest: activeManifest,
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
    {
      env: { ...environment, INCOMING_HOOK_URL: 'https://example.test/hook' },
      commit: mergeCommit,
    },
    {
      env: { ...environment, INCOMING_HOOK_BODY: 'unverified-body' },
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
    {
      env: environment,
      commit: {
        ...mergeCommit,
        parents: [
          manifest.expectedProductionParent,
          manifest.expectedProductionParent,
        ],
      },
    },
    {
      env: environment,
      commit: {
        ...mergeCommit,
        parents: [
          manifest.expectedProductionParent,
          mergeCommit.parents[1],
          'e'.repeat(40),
        ],
      },
    },
  ];
  failures.forEach((failure) => {
    assert.equal(
      evaluateProductionRelease({
        ...failure,
        manifest: activeManifest,
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
    manifest.active = true;
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
        /  "active": (?:true|false),/,
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
