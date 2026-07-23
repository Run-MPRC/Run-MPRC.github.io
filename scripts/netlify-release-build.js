'use strict';

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  authorizeProductionRelease,
  loadManifest,
} = require('./netlify-release-policy');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'build');
const RELEASE_MARKER = path.join(
  OUTPUT,
  '.well-known',
  'run-mprc-release.json',
);
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const CREDENTIAL_MARKERS = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\b(?:FIREBASE_SERVICE_ACCOUNT|GOOGLE_APPLICATION_CREDENTIALS|NETLIFY_AUTH_TOKEN|SENTRY_AUTH_TOKEN|STRIPE_SECRET_KEY)\b/u,
  /\b(?:github_pat_|ghp_|sk_live_|sk_test_|whsec_)[A-Za-z0-9_-]{8,}/u,
]);

function safeBaseEnvironment(home, sourceEnvironment = process.env) {
  const environment = {
    CI: 'true',
    DISABLE_ESLINT_PLUGIN: 'true',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    HOME: home,
    LANG: 'C.UTF-8',
    NPM_CONFIG_AUDIT: 'false',
    NPM_CONFIG_FUND: 'false',
    NPM_CONFIG_IGNORE_SCRIPTS: 'true',
    NPM_CONFIG_USERCONFIG: '/dev/null',
    PATH: sourceEnvironment.PATH || '/usr/local/bin:/usr/bin:/bin',
  };
  if (sourceEnvironment.TMPDIR) environment.TMPDIR = sourceEnvironment.TMPDIR;
  return environment;
}

function buildEnvironment(home, sourceEnvironment = process.env) {
  return safeBaseEnvironment(home, sourceEnvironment);
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    ...options,
    stdio: 'inherit',
  });
}

function fetchAndVerifySource(manifest, temporaryDirectory) {
  const temporaryRef = `refs/netlify-release/${manifest.releaseId}`;
  const repository = path.join(temporaryDirectory, 'source.git');
  const gitEnvironment = safeBaseEnvironment(
    path.join(temporaryDirectory, 'git-home'),
  );
  fs.mkdirSync(gitEnvironment.HOME, { recursive: true });
  run('git', ['init', '--bare', '--quiet', repository], {
    cwd: temporaryDirectory,
    env: gitEnvironment,
  });

  run(
    'git',
    [
      `--git-dir=${repository}`,
      '-c',
      'credential.helper=',
      '-c',
      'core.askPass=',
      'fetch',
      '--no-tags',
      '--force',
      '--depth=1',
      manifest.sourceRepository,
      `${manifest.sourceRef}:${temporaryRef}`,
    ],
    { cwd: temporaryDirectory, env: gitEnvironment },
  );

  const fetchedCommit = execFileSync(
    'git',
    [`--git-dir=${repository}`, 'rev-parse', temporaryRef],
    {
      cwd: temporaryDirectory,
      encoding: 'utf8',
      env: gitEnvironment,
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  ).trim();
  const fetchedTree = execFileSync(
    'git',
    [`--git-dir=${repository}`, 'show', '-s', '--format=%T', fetchedCommit],
    {
      cwd: temporaryDirectory,
      encoding: 'utf8',
      env: gitEnvironment,
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  ).trim();
  if (fetchedCommit !== manifest.sourceCommit
    || fetchedTree !== manifest.sourceTree) {
    throw new Error('Pinned release source did not match its reviewed commit and tree.');
  }

  const archive = path.join(temporaryDirectory, 'source.tar');
  const source = path.join(temporaryDirectory, 'source');
  fs.mkdirSync(source);
  run(
    'git',
    [
      `--git-dir=${repository}`,
      'archive',
      `--output=${archive}`,
      fetchedCommit,
    ],
    { cwd: temporaryDirectory, env: gitEnvironment },
  );
  run('tar', ['-xf', archive, '-C', source], { env: gitEnvironment });
  return source;
}

function installAndBuild(source, temporaryDirectory) {
  const home = path.join(temporaryDirectory, 'build-home');
  fs.mkdirSync(home);
  const environment = buildEnvironment(home);

  run(
    'npm',
    [
      'ci',
      '--legacy-peer-deps',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ],
    { cwd: source, env: environment },
  );
  run(
    path.join(source, 'node_modules', '.bin', 'react-scripts'),
    ['build'],
    { cwd: source, env: environment },
  );
  return path.join(source, 'build');
}

function walkFiles(directory, relative = '') {
  const absolute = path.join(directory, relative);
  return fs.readdirSync(absolute, { withFileTypes: true })
    .sort((left, right) => {
      if (left.name < right.name) return -1;
      if (left.name > right.name) return 1;
      return 0;
    })
    .flatMap((entry) => {
      const child = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error('Release artifact must not contain symbolic links.');
      }
      if (entry.isDirectory()) return walkFiles(directory, child);
      if (!entry.isFile()) {
        throw new Error('Release artifact contains an unsupported file type.');
      }
      return [child];
    });
}

function verifyAndDigestArtifact(directory) {
  const files = walkFiles(directory);
  if (!files.includes('index.html')
    || !files.some((file) => /^static\/js\/main\.[0-9a-f]+\.js$/u.test(file))) {
    throw new Error('Release artifact is incomplete.');
  }

  const digest = crypto.createHash('sha256');
  files.forEach((relative) => {
    const contents = fs.readFileSync(path.join(directory, relative));
    const text = contents.toString('latin1');
    if (CREDENTIAL_MARKERS.some((pattern) => pattern.test(text))) {
      throw new Error('Release artifact safety scan found credential material.');
    }
    digest.update(relative);
    digest.update('\0');
    digest.update(contents);
    digest.update('\0');
  });
  return Object.freeze({
    fileCount: files.length,
    sha256: digest.digest('hex'),
  });
}

function publishArtifact(sourceBuild, manifest, controlCommit) {
  const artifact = verifyAndDigestArtifact(sourceBuild);
  if (artifact.fileCount !== manifest.expectedSiteFileCount
    || artifact.sha256 !== manifest.expectedSiteFilesSha256) {
    throw new Error(
      'Release artifact did not match its reviewed file count and digest '
      + `(${artifact.fileCount}, ${artifact.sha256}).`,
    );
  }
  fs.rmSync(OUTPUT, { force: true, recursive: true });
  fs.cpSync(sourceBuild, OUTPUT, { recursive: true });
  fs.mkdirSync(path.dirname(RELEASE_MARKER), { recursive: true });
  fs.writeFileSync(
    RELEASE_MARKER,
    `${JSON.stringify({
      schemaVersion: 1,
      releaseId: manifest.releaseId,
      issueNumber: manifest.issueNumber,
      controlCommit,
      sourceCommit: manifest.sourceCommit,
      sourceTree: manifest.sourceTree,
      previousSourceCommit: manifest.previousSourceCommit,
      rollbackDeployId: manifest.rollbackDeployId,
      siteFileCount: artifact.fileCount,
      siteFilesSha256: artifact.sha256,
    }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o644 },
  );
  return artifact;
}

function main() {
  const local = process.argv.length === 3 && process.argv[2] === '--local';
  const preview = process.argv.length === 3 && process.argv[2] === '--preview';
  if ((process.argv.length > 2 && !local && !preview)
    || (local && process.env.NETLIFY === 'true')) {
    throw new Error('Unsupported release-build invocation.');
  }

  let authorization;
  if (preview) {
    if (process.env.NETLIFY !== 'true'
      || process.env.CONTEXT !== 'deploy-preview') {
      throw new Error('Netlify pinned preview refused.');
    }
    authorization = loadManifest();
    if (!authorization.ok) {
      throw new Error(`Netlify pinned preview refused: ${authorization.reason}.`);
    }
    if (!authorization.manifest.active
      || process.env.HEAD !== authorization.manifest.previewBranch) {
      run('npm', ['run', 'build'], { cwd: ROOT });
      return;
    }
    if (!SHA_PATTERN.test(process.env.COMMIT_REF)) {
      throw new Error('Netlify pinned preview commit is unavailable.');
    }
  } else {
    authorization = local
      ? loadManifest()
      : authorizeProductionRelease();
  }
  if (!authorization.ok) {
    throw new Error(`Netlify production release refused: ${authorization.reason}.`);
  }
  const { manifest } = authorization;
  if (!manifest.active) {
    throw new Error('Netlify production release is inactive.');
  }

  const controlCommit = local
    ? 'LOCAL_VERIFICATION_ONLY'
    : (preview ? process.env.COMMIT_REF : authorization.commit.sha);
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'run-mprc-netlify-release-'),
  );
  try {
    const source = fetchAndVerifySource(manifest, temporaryDirectory);
    const sourceBuild = installAndBuild(source, temporaryDirectory);
    const artifact = publishArtifact(
      sourceBuild,
      manifest,
      controlCommit,
    );
    console.log(
      `Prepared ${manifest.releaseId} from ${manifest.sourceCommit} `
      + `(${artifact.fileCount} files, ${artifact.sha256}).`,
    );
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Release build failed.');
    process.exitCode = 1;
  }
}

module.exports = {
  buildEnvironment,
  fetchAndVerifySource,
  publishArtifact,
  safeBaseEnvironment,
  verifyAndDigestArtifact,
};
