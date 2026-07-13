import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const FUNCTION_SPECS = Object.freeze({
  createMemberOnSignUp: Object.freeze({
    entryPoint: 'createMemberOnSignUp',
    trigger: 'event',
    eventType: 'providers/firebase.auth/eventTypes/user.create',
  }),
  ensureMemberProfile: Object.freeze({
    entryPoint: 'ensureMemberProfile',
    trigger: 'https',
  }),
});

const REGION = 'us-central1';
const RUNTIME = 'nodejs20';
const FIRESTORE_RELEASE = 'cloud.firestore/(default)';
const PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const VERSION_PATTERN = /^\d+$/;

export function normalizeRulesSource(source) {
  return `${source.replace(/\r\n/g, '\n').trimEnd()}\n`;
}

export function digestRulesSource(source) {
  return createHash('sha256').update(normalizeRulesSource(source)).digest('hex');
}

function summarizeFunction(id, value) {
  if (!value) return null;
  return {
    id,
    name: value.name,
    status: value.status,
    entryPoint: value.entryPoint,
    runtime: value.runtime,
    updateTime: value.updateTime,
    versionId: value.versionId,
    buildId: value.buildId,
    trigger: value.httpsTrigger ? 'https' : value.eventTrigger ? 'event' : 'unknown',
    eventType: value.eventTrigger?.eventType,
  };
}

function summarizeRules(release, ruleset) {
  if (!release || !ruleset) return null;
  const files = Array.isArray(ruleset.source?.files)
    ? ruleset.source.files.map((file) => ({
      name: file.name,
      digest: digestRulesSource(file.content ?? ''),
    }))
    : [];
  return {
    releaseName: release.name,
    rulesetName: release.rulesetName,
    updateTime: release.updateTime,
    files,
  };
}

export function validateBackendState(before, after, expectedRulesDigest) {
  const errors = [];
  const previousFunctions = before?.functions ?? {};
  const currentFunctions = after?.functions ?? {};
  const expectedReleaseName = `projects/${after?.project}/releases/${FIRESTORE_RELEASE}`;
  const expectedRulesetPrefix = `projects/${after?.project}/rulesets/`;

  const hasExpectedRulesIdentity = (rules) => {
    if (rules?.releaseName !== expectedReleaseName) return false;
    if (typeof rules.rulesetName !== 'string') return false;
    if (!rules.rulesetName.startsWith(expectedRulesetPrefix)) return false;
    const rulesetId = rules.rulesetName.slice(expectedRulesetPrefix.length);
    return rulesetId.length > 0 && !rulesetId.includes('/');
  };

  const hasExactRulesSource = (rules) => Array.isArray(rules?.files)
    && rules.files.length === 1
    && rules.files[0]?.name === 'firestore.rules'
    && rules.files[0]?.digest === expectedRulesDigest;

  if (typeof after?.project !== 'string' || after.project !== before?.project) {
    errors.push('Backend project readback does not match the approved environment.');
  }

  if (!after?.rules) {
    errors.push('Firestore Rules release is unreadable.');
  } else {
    if (!hasExpectedRulesIdentity(after.rules)) {
      errors.push('Firestore Rules release has the wrong project or ruleset identity.');
    }
    const rulesAlreadyExact = before?.project === after.project
      && hasExpectedRulesIdentity(before?.rules)
      && hasExactRulesSource(before?.rules);
    if (
      after.rules.rulesetName === before?.rules?.rulesetName
      && !rulesAlreadyExact
    ) {
      errors.push('Firestore Rules release did not advance.');
    }
    if (!hasExactRulesSource(after.rules)) {
      errors.push('Firestore Rules source does not match the approved commit.');
    }
  }

  for (const [id, spec] of Object.entries(FUNCTION_SPECS)) {
    const current = currentFunctions[id];
    const previous = previousFunctions[id];
    if (!current) {
      errors.push(`${id} is unreadable.`);
      continue;
    }
    if (current.name !== `projects/${after.project}/locations/${REGION}/functions/${id}`) {
      errors.push(`${id} has the wrong project, region, or generation.`);
    }
    if (current.status !== 'ACTIVE') {
      errors.push(`${id} is not ACTIVE.`);
    }
    if (current.runtime !== RUNTIME || current.entryPoint !== spec.entryPoint) {
      errors.push(`${id} has the wrong runtime or entry point.`);
    }
    if (current.trigger !== spec.trigger) {
      errors.push(`${id} has the wrong trigger type.`);
    }
    if (spec.eventType && current.eventType !== spec.eventType) {
      errors.push(`${id} has the wrong event trigger.`);
    }
    const hasCurrentRevision = VERSION_PATTERN.test(current.versionId ?? '')
      && typeof current.updateTime === 'string'
      && Number.isFinite(Date.parse(current.updateTime))
      && typeof current.buildId === 'string'
      && current.buildId.length > 0;
    if (!hasCurrentRevision) {
      errors.push(`${id} revision metadata is unreadable.`);
      continue;
    }
    if (
      previous
      && (
        !VERSION_PATTERN.test(previous.versionId ?? '')
        || typeof previous.updateTime !== 'string'
        || !Number.isFinite(Date.parse(previous.updateTime))
        || typeof previous.buildId !== 'string'
        || previous.buildId.length === 0
        || BigInt(current.versionId) <= BigInt(previous.versionId)
        || Date.parse(current.updateTime) <= Date.parse(previous.updateTime)
        || current.buildId === previous.buildId
      )
    ) {
      errors.push(`${id} revision did not advance.`);
    }
  }

  return errors;
}

async function getJson(url, token, { allowNotFound = false } = {}) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Provider readback failed with HTTP ${response.status}.`);
  }
  return response.json();
}

async function readBackendState(project, token) {
  const releaseName = `projects/${project}/releases/${FIRESTORE_RELEASE}`;
  const release = await getJson(
    `https://firebaserules.googleapis.com/v1/${releaseName}`,
    token,
    { allowNotFound: true },
  );
  const ruleset = release?.rulesetName
    ? await getJson(
      `https://firebaserules.googleapis.com/v1/${release.rulesetName}`,
      token,
    )
    : null;

  const functions = {};
  for (const id of Object.keys(FUNCTION_SPECS)) {
    const name = `projects/${project}/locations/${REGION}/functions/${id}`;
    const value = await getJson(
      `https://cloudfunctions.googleapis.com/v1/${name}`,
      token,
      { allowNotFound: true },
    );
    functions[id] = summarizeFunction(id, value);
  }

  return {
    project,
    capturedAt: new Date().toISOString(),
    rules: summarizeRules(release, ruleset),
    functions,
  };
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const values = { command };
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('Invalid verification arguments.');
    }
    values[key.slice(2)] = value;
  }
  return values;
}

function requireProject(project) {
  if (!PROJECT_PATTERN.test(project ?? '')) {
    throw new Error('Approved Firebase project ID is missing or invalid.');
  }
}

function writePrivateJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

async function capture(values, token) {
  requireProject(values.project);
  if (!values.output) throw new Error('Private pre-state output path is required.');
  const state = await readBackendState(values.project, token);
  writePrivateJson(values.output, state);
  console.log('Captured the current backend state for private comparison.');
}

async function verify(values, token) {
  requireProject(values.project);
  if (!values.before || !values.rules) {
    throw new Error('Pre-state and approved Rules source are required.');
  }
  const before = JSON.parse(fs.readFileSync(values.before, 'utf8'));
  if (before.project !== values.project) {
    throw new Error('Pre-state project does not match the approved environment.');
  }

  const expectedRulesDigest = digestRulesSource(fs.readFileSync(values.rules, 'utf8'));
  const attempts = Number.parseInt(process.env.FIREBASE_VERIFY_ATTEMPTS ?? '30', 10);
  const intervalMs = Number.parseInt(process.env.FIREBASE_VERIFY_INTERVAL_MS ?? '10000', 10);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 60) {
    throw new Error('Verification attempt limit is invalid.');
  }
  if (!Number.isInteger(intervalMs) || intervalMs < 0 || intervalMs > 30000) {
    throw new Error('Verification interval is invalid.');
  }

  let lastErrors = ['Backend readback did not run.'];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const after = await readBackendState(values.project, token);
    lastErrors = validateBackendState(before, after, expectedRulesDigest);
    if (lastErrors.length === 0) {
      if (values['deploy-succeeded'] !== 'true') {
        throw new Error(
          'Deployment command failed; readable backend state is not release proof.',
        );
      }
      console.log('Rules source and both active Function revisions are verified.');
      return;
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw new Error(`Backend verification failed: ${lastErrors.join(' ')}`);
}

async function main() {
  const values = parseArguments(process.argv.slice(2));
  const token = process.env.CLOUD_ACCESS_TOKEN;
  if (!token) throw new Error('Short-lived provider readback authority is missing.');

  if (values.command === 'capture') {
    await capture(values, token);
  } else if (values.command === 'verify') {
    await verify(values, token);
  } else {
    throw new Error('Unknown verification command.');
  }
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Backend verification failed.');
    process.exitCode = 1;
  });
}
