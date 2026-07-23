'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(
  ROOT,
  'config',
  'netlify-production-release.json',
);
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const RELEASE_ID_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{4}-\d{2}-\d{2}$/;
const SOURCE_REF_PATTERN = /^refs\/heads\/[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,198}[A-Za-z0-9])?$/;
const EXPECTED_KEYS = Object.freeze([
  'active',
  'expectedProductionParent',
  'expectedSiteFileCount',
  'expectedSiteFilesSha256',
  'issueNumber',
  'previewBranch',
  'previousSourceCommit',
  'releaseId',
  'rollbackDeployId',
  'schemaVersion',
  'sourceCommit',
  'sourceRef',
  'sourceRepository',
  'sourceTree',
].sort());

function isPlainRecord(value) {
  return value !== null
    && typeof value === 'object'
    && Object.getPrototypeOf(value) === Object.prototype;
}

function isExactKeySet(value) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(EXPECTED_KEYS);
}

function validateManifest(value) {
  if (!isPlainRecord(value) || !isExactKeySet(value)) {
    return Object.freeze({ ok: false, reason: 'manifest_shape' });
  }
  if (value.schemaVersion !== 1 || typeof value.active !== 'boolean') {
    return Object.freeze({ ok: false, reason: 'manifest_version' });
  }
  if (!RELEASE_ID_PATTERN.test(value.releaseId)
    || !Number.isSafeInteger(value.issueNumber)
    || value.issueNumber < 1
    || !/^codex\/[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,198}[A-Za-z0-9])?$/u
      .test(value.previewBranch)) {
    return Object.freeze({ ok: false, reason: 'manifest_identity' });
  }
  const invalidSha = [
    'expectedProductionParent',
    'previousSourceCommit',
    'sourceCommit',
    'sourceTree',
  ].some((key) => !SHA_PATTERN.test(value[key]));
  if (invalidSha) {
    return Object.freeze({ ok: false, reason: 'manifest_sha' });
  }
  if (value.sourceRepository
      !== 'https://github.com/Run-MPRC/Run-MPRC.github.io.git'
    || !SOURCE_REF_PATTERN.test(value.sourceRef)
    || !/^[0-9a-f]{24}$/.test(value.rollbackDeployId)) {
    return Object.freeze({ ok: false, reason: 'manifest_source' });
  }
  if (!Number.isSafeInteger(value.expectedSiteFileCount)
    || value.expectedSiteFileCount < 1
    || value.expectedSiteFileCount > 512
    || !/^[0-9a-f]{64}$/.test(value.expectedSiteFilesSha256)) {
    return Object.freeze({ ok: false, reason: 'manifest_artifact' });
  }
  if (value.sourceCommit === value.previousSourceCommit
    || value.sourceCommit === value.expectedProductionParent) {
    return Object.freeze({ ok: false, reason: 'manifest_no_delta' });
  }
  return Object.freeze({ ok: true, manifest: Object.freeze({ ...value }) });
}

function loadManifest(manifestPath = MANIFEST_PATH) {
  let stat;
  let contents;
  try {
    stat = fs.lstatSync(manifestPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) {
      return Object.freeze({ ok: false, reason: 'manifest_file' });
    }
    contents = fs.readFileSync(manifestPath, 'utf8');
  } catch {
    return Object.freeze({ ok: false, reason: 'manifest_unreadable' });
  }

  try {
    const parsed = JSON.parse(contents);
    const validated = validateManifest(parsed);
    if (!validated.ok) return validated;
    if (contents !== `${JSON.stringify(parsed, null, 2)}\n`) {
      return Object.freeze({ ok: false, reason: 'manifest_canonical' });
    }
    return validated;
  } catch {
    return Object.freeze({ ok: false, reason: 'manifest_json' });
  }
}

function inspectCommit(commitRef, cwd = ROOT) {
  if (!SHA_PATTERN.test(commitRef)) {
    return Object.freeze({ ok: false, reason: 'commit_ref' });
  }

  try {
    const head = execFileSync(
      'git',
      ['rev-parse', 'HEAD'],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    const commit = execFileSync(
      'git',
      ['cat-file', '-p', commitRef],
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 128 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    const headers = commit.slice(0, commit.indexOf('\n\n')).split('\n');
    const treeLine = headers.find((line) => line.startsWith('tree '));
    const parents = headers
      .filter((line) => line.startsWith('parent '))
      .map((line) => line.slice('parent '.length));

    if (!SHA_PATTERN.test(head)
      || !treeLine
      || !SHA_PATTERN.test(treeLine.slice('tree '.length))
      || parents.some((parent) => !SHA_PATTERN.test(parent))) {
      return Object.freeze({ ok: false, reason: 'commit_shape' });
    }
    return Object.freeze({
      ok: true,
      commit: Object.freeze({
        head,
        parents: Object.freeze(parents),
        sha: commitRef,
        tree: treeLine.slice('tree '.length),
      }),
    });
  } catch {
    return Object.freeze({ ok: false, reason: 'commit_unreadable' });
  }
}

function evaluateProductionRelease({ env, manifest, commit }) {
  if (env.NETLIFY !== 'true'
    || env.CONTEXT !== 'production'
    || env.BRANCH !== 'main'
    || env.INCOMING_HOOK_TITLE !== undefined
    || env.INCOMING_HOOK_URL !== undefined
    || env.INCOMING_HOOK_BODY !== undefined) {
    return Object.freeze({ ok: false, reason: 'deploy_context' });
  }
  if (!SHA_PATTERN.test(env.COMMIT_REF)
    || !manifest.active
    || commit.sha !== env.COMMIT_REF
    || commit.head !== env.COMMIT_REF) {
    return Object.freeze({ ok: false, reason: 'deploy_identity' });
  }
  if (!Array.isArray(commit.parents)
    || commit.parents.length !== 2
    || commit.parents[0] !== manifest.expectedProductionParent
    || commit.parents[1] === manifest.expectedProductionParent) {
    return Object.freeze({ ok: false, reason: 'deploy_parent' });
  }
  return Object.freeze({ ok: true, reason: 'release_authorized' });
}

function authorizeProductionRelease({
  env = process.env,
  cwd = ROOT,
  manifestPath = MANIFEST_PATH,
} = {}) {
  const loaded = loadManifest(manifestPath);
  if (!loaded.ok) return loaded;
  const inspected = inspectCommit(env.COMMIT_REF, cwd);
  if (!inspected.ok) return inspected;
  const evaluated = evaluateProductionRelease({
    commit: inspected.commit,
    env,
    manifest: loaded.manifest,
  });
  if (!evaluated.ok) return evaluated;
  return Object.freeze({
    ok: true,
    commit: inspected.commit,
    manifest: loaded.manifest,
    reason: evaluated.reason,
  });
}

module.exports = {
  MANIFEST_PATH,
  authorizeProductionRelease,
  evaluateProductionRelease,
  inspectCommit,
  loadManifest,
  validateManifest,
};
