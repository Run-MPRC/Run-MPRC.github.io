const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPOSITORY = path.resolve(__dirname, '..');
const SCANNER = path.join(REPOSITORY, '.github/scripts/scan-test-artifacts.mjs');
const CI_PATH = path.join(REPOSITORY, '.github/workflows/ci.yml');
const RELEASE_PATH = path.join(REPOSITORY, '.github/workflows/deploy.yml');
const ciWorkflow = fs.readFileSync(CI_PATH, 'utf8');
const releaseWorkflow = fs.readFileSync(RELEASE_PATH, 'utf8');
const temporaryDirectories = [];

const JOB_ID = 'test-artifact-scrubber';
const JOB_NAME = 'Test artifact scrubber';
const TEST_COMMAND = 'node --test tests/test-artifact-safety.test.js';
const FRONTEND_TEST_COMMAND = 'node --test tests/ci-workflow.test.js tests/release-workflow.test.js tests/firebase-release-verification.test.js tests/test-artifact-safety.test.js tests/root-dependency-security.test.js';
const NEVER_RUN = ['$', '{{ false }}'].join('');
const ALWAYS_TRUE = ['$', '{{ true }}'].join('');
const BRACKET_SECRET = ['$', "{{ secrets['SYNTHETIC_CANARY'] }}"].join('');
const BRACKET_GITHUB_TOKEN = ['$', "{{ github['token'] }}"].join('');
const EXPECTED_CI_HEADER = `${[
  'name: CI',
  '',
  'on:',
  '  push:',
  '    branches: [master, main]',
  '  pull_request:',
  '    branches: [master, main]',
  '',
  'jobs:',
].join('\n')}\n`;
const EXPECTED_SCRUBBER_JOB = `${[
  `  ${JOB_ID}:`,
  `    name: ${JOB_NAME}`,
  '    runs-on: ubuntu-latest',
  '    timeout-minutes: 5',
  '    permissions:',
  '      contents: read',
  '    steps:',
  '      - uses: actions/checkout@v6',
  '        with:',
  '          persist-credentials: false',
  '      - uses: actions/setup-node@v6',
  '        with:',
  "          node-version: '20'",
  '      - name: Run emitted test artifact safety tests',
  `        run: ${TEST_COMMAND}`,
].join('\n')}\n`;
const EXPECTED_FRONTEND_VALIDATION_STEP = [
  '      - name: Validate protected release workflow',
  '        run: |',
  '          ruby -e \'require "yaml"; YAML.safe_load(File.read(".github/workflows/deploy.yml"), permitted_classes: [], permitted_symbols: [], aliases: true)\'',
  '          ruby -e \'require "yaml"; YAML.safe_load(File.read(".github/workflows/ci.yml"), permitted_classes: [], permitted_symbols: [], aliases: true)\'',
  `          ${FRONTEND_TEST_COMMAND}`,
].join('\n');
const EXPECTED_RELEASE_JOB_LOOP = [
  '          for required_job in \\',
  '            "Frontend lint + build" \\',
  '            "Cloud Functions lint + test" \\',
  '            "Commerce command journal emulator" \\',
  `            "${JOB_NAME}" \\`,
  '            "Firestore security-rules tests"',
  '          do',
].join('\n');
const EXPECTED_RELEASE_STEP_DIGESTS = Object.freeze({
  preflight: '3dafc148dd6062bf6d1f6f9f5627f12a7a18b9baf490aff9e46dd716377e7112',
  postApproval: '93ecd6977236c93d8bb4367dec18349906a36d333587bf0891bfbdfec590fcc5',
});
const EXPECTED_RELEASE_CONTEXT_DIGESTS = Object.freeze({
  header: 'd5242cf76b0e8710346728e6f6f34852f4180e22e7df4ac628bb633d5eafa9fe',
  preflight: '55e3100f120b37c56813c149c34aeebcb9dc9095cfe9acdd5ac4a08f52e77c8f',
  postApproval: 'db137fb23dda50944583e068701f0b6049b9b0e96f5c162e4c859f39ba16fd84',
});

let scannerModule;

test.before(async () => {
  scannerModule = await import(SCANNER);
});

test.after(() => {
  temporaryDirectories.reverse().forEach((directory) => {
    fs.rmSync(directory, { force: true, recursive: true });
  });
});

function makeArtifactRoot(name = 'test-artifacts') {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mprc-artifact-safety-'));
  temporaryDirectories.push(temporaryDirectory);
  const root = path.join(temporaryDirectory, name);
  fs.mkdirSync(root, { recursive: true });
  return { root, temporaryDirectory };
}

function writeArtifact(root, relativePath, contents) {
  const destination = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
  return destination;
}

function scan(roots, options) {
  return scannerModule.scanArtifactRoots(roots, options);
}

function expectRule(ruleId, callback, context) {
  let captured;
  assert.throws(callback, (error) => {
    captured = error;
    return error && error.ruleId === ruleId;
  }, context);
  return captured;
}

function runScanner(...roots) {
  return spawnSync(process.execPath, [SCANNER, ...roots], {
    cwd: REPOSITORY,
    encoding: 'utf8',
  });
}

function jobBlock(workflow, jobId) {
  const startMarker = `  ${jobId}:\n`;
  const start = workflow.indexOf(startMarker);
  if (start < 0) return '';
  const remainder = workflow.slice(start + startMarker.length);
  const nextJob = /\n {2}[a-z0-9-]+:\n/.exec(remainder);
  const end = nextJob === null
    ? workflow.length
    : start + startMarker.length + nextJob.index;
  return workflow.slice(start, end);
}

function mutateJob(workflow, search, replacement) {
  const block = jobBlock(workflow, JOB_ID);
  assert.ok(block.includes(search), `Expected scrubber job to contain ${search}`);
  return workflow.replace(block, block.replace(search, replacement));
}

function literalCount(text, value) {
  return text.split(value).length - 1;
}

function yamlSemanticSafetyView(workflow) {
  return workflow
    .replace(/\\\r?\n[ \t]*/gu, '')
    .replace(/\\\//gu, '/')
    .replace(/\\x([0-9a-f]{2})|\\u([0-9a-f]{4})|\\U([0-9a-f]{8})/giu, (
      match,
      shortCode,
      mediumCode,
      longCode,
    ) => {
      const encoded = shortCode ?? mediumCode ?? longCode;
      const codePoint = Number.parseInt(encoded, 16);
      if (!Number.isSafeInteger(codePoint)
        || codePoint > 0x10ffff
        || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        return match;
      }
      return String.fromCodePoint(codePoint);
    });
}

function usesUnsupportedWorkflowMappingSyntax(workflow) {
  return /^[ \t]*(?:\?|%|!{1,2}|!<|&|\*|<<\s*:)/mu.test(workflow)
    || /(?:^|[{,])\s*(?:\?|!{1,2}|!<|&|\*|<<\s*:)/mu.test(workflow);
}

function hasTopLevelDataAfterJobs(workflow) {
  const jobsMarker = 'jobs:\n';
  const jobsIndex = workflow.indexOf(jobsMarker);
  if (jobsIndex < 0) return true;
  return workflow
    .slice(jobsIndex + jobsMarker.length)
    .split(/\r?\n/u)
    .some((line) => line !== '' && !/^[ \t#]/u.test(line));
}

function namedStepBlock(workflow, jobId, stepName) {
  const job = jobBlock(workflow, jobId);
  const startMarker = `      - name: ${stepName}\n`;
  const start = job.indexOf(startMarker);
  if (start < 0) return '';
  const remainder = job.slice(start + startMarker.length);
  const nextStep = /\n {6}- /u.exec(remainder);
  const end = nextStep === null
    ? job.length
    : start + startMarker.length + nextStep.index;
  return job.slice(start, end);
}

function stepBlockByName(workflow, jobId, stepName) {
  const job = jobBlock(workflow, jobId);
  const marker = `name: ${stepName}`;
  const namePosition = job.indexOf(marker);
  if (namePosition < 0 || literalCount(job, marker) !== 1) return '';
  const startMarker = job.lastIndexOf('\n      - ', namePosition);
  const start = startMarker < 0 ? 0 : startMarker + 1;
  const remainder = job.slice(namePosition);
  const nextStep = /\n {6}- /u.exec(remainder);
  const end = nextStep === null ? job.length : namePosition + nextStep.index;
  return job.slice(start, end);
}

function digestText(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function ciErrors(workflow) {
  const errors = [];
  const semanticWorkflow = yamlSemanticSafetyView(workflow);
  if (!workflow.startsWith(EXPECTED_CI_HEADER)) {
    errors.push('CI trigger must remain the exact push and pull-request header');
  }
  if (usesUnsupportedWorkflowMappingSyntax(workflow)) {
    errors.push('CI must not use explicit, tagged, anchored, aliased, or merged mapping keys');
  }
  if (hasTopLevelDataAfterJobs(workflow)) {
    errors.push('CI jobs must remain the final top-level workflow mapping');
  }
  if ([...semanticWorkflow.matchAll(/^["']?jobs["']?\s*:/gimu)].length !== 1) {
    errors.push('CI must contain one canonical jobs mapping');
  }
  ['frontend', JOB_ID].forEach((jobId) => {
    const jobKey = new RegExp(`^ {2}["']?${jobId}["']?\\s*:`, 'gimu');
    if ([...semanticWorkflow.matchAll(jobKey)].length !== 1) {
      errors.push(`${jobId} must have one canonical semantic job key`);
    }
  });
  const block = jobBlock(workflow, JOB_ID);
  if (!block) return ['missing scrubber job'];
  if (literalCount(workflow, `  ${JOB_ID}:\n`) !== 1) {
    errors.push('scrubber job ID must occur exactly once');
  }
  if (block !== EXPECTED_SCRUBBER_JOB) {
    errors.push('scrubber job must equal the dependency-free canonical block');
  }
  if (/actions\/upload-[a-z0-9._-]*artifact@/iu.test(yamlSemanticSafetyView(workflow))) {
    errors.push('CI contains an unscanned artifact upload');
  }
  if (/\bpull_request_target\s*:/.test(workflow)) {
    errors.push('CI runs untrusted code with target-repository authority');
  }
  return errors;
}

function frontendValidationErrors(workflow) {
  const step = namedStepBlock(workflow, 'frontend', 'Validate protected release workflow');
  if (step !== EXPECTED_FRONTEND_VALIDATION_STEP) {
    return ['frontend must run the exact independent workflow validation step'];
  }
  return [];
}

function releaseErrors(workflow) {
  const errors = [];
  const semanticWorkflow = yamlSemanticSafetyView(workflow);
  const jobsMarker = 'jobs:\n';
  const jobsIndex = workflow.indexOf(jobsMarker);
  const header = jobsIndex < 0 ? '' : workflow.slice(0, jobsIndex + jobsMarker.length);
  const preflightJob = jobBlock(workflow, 'preflight');
  const backendJob = jobBlock(workflow, 'deploy-backend');
  if (usesUnsupportedWorkflowMappingSyntax(workflow)) {
    errors.push('release must not use explicit, tagged, anchored, aliased, or merged mapping keys');
  }
  if (hasTopLevelDataAfterJobs(workflow)) {
    errors.push('release jobs must remain the final top-level workflow mapping');
  }
  if ([...semanticWorkflow.matchAll(/^["']?jobs["']?\s*:/gimu)].length !== 1) {
    errors.push('release workflow must contain one canonical jobs mapping');
  }
  ['preflight', 'deploy-backend'].forEach((jobId) => {
    const jobKey = new RegExp(`^ {2}["']?${jobId}["']?\\s*:`, 'gimu');
    if ([...semanticWorkflow.matchAll(jobKey)].length !== 1) {
      errors.push(`${jobId} must have one canonical semantic job key`);
    }
  });
  const preflight = stepBlockByName(
    workflow,
    'preflight',
    'Require current main and its successful push CI',
  );
  const backend = stepBlockByName(
    workflow,
    'deploy-backend',
    'Revalidate current main and exact CI after protected approval',
  );
  [
    [preflight, 'preflight'],
    [backend, 'post-approval check'],
  ].forEach(([block, label]) => {
    if (literalCount(block, EXPECTED_RELEASE_JOB_LOOP) !== 1
      || literalCount(block, `"${JOB_NAME}"`) !== 1) {
      errors.push(`${label} must contain the exact protected job loop once`);
    }
  });
  if (digestText(preflight) !== EXPECTED_RELEASE_STEP_DIGESTS.preflight) {
    errors.push('preflight CI validation step must remain canonical');
  }
  if (digestText(backend) !== EXPECTED_RELEASE_STEP_DIGESTS.postApproval) {
    errors.push('post-approval CI validation step must remain canonical');
  }
  if (digestText(header) !== EXPECTED_RELEASE_CONTEXT_DIGESTS.header) {
    errors.push('release workflow-level execution context must remain canonical');
  }
  if (digestText(preflightJob) !== EXPECTED_RELEASE_CONTEXT_DIGESTS.preflight) {
    errors.push('preflight job execution context must remain canonical');
  }
  if (digestText(backendJob) !== EXPECTED_RELEASE_CONTEXT_DIGESTS.postApproval) {
    errors.push('post-approval job execution context must remain canonical');
  }
  return errors;
}

test('safe synthetic nested reports pass and source outside explicit roots is ignored', () => {
  const { root, temporaryDirectory } = makeArtifactRoot();
  writeArtifact(root, 'nested/results.json', JSON.stringify({
    correlationId: 'corr_0123456789abcdef',
    digest: 'a'.repeat(64),
    displayName: 'Reserved Test',
    email: 'runner@example.test',
    emergencyContactName: 'Synthetic Test',
    firstName: 'Synthetic Test',
    fullName: 'Synthetic Test',
    authorization: '[REDACTED]',
    authorizationHeader: 'not-a-header-field',
    cookie: '<redacted>',
    password: '***',
    phone: '+1-202-555-0142',
    phoneNumber: '+12025550142',
    shippingAddress: '[REDACTED]',
    total: 4,
  }));
  writeArtifact(root, 'nested/coverage.lcov', 'TN:\nSF:synthetic.js\nDA:1,1\nend_of_record\n');
  writeArtifact(root, 'nested/events.jsonl', '{"count":1}\n');
  writeArtifact(root, 'nested/junit.xml', '<testsuite tests="1" failures="0"/>\n');
  writeArtifact(root, 'nested/output.log', 'synthetic outcome: pass\n');
  writeArtifact(root, 'nested/output.tap', 'TAP version 13\nok 1 - synthetic\n1..1\n');
  writeArtifact(root, 'nested/summary.txt', 'count=1\n');

  const outsideCanary = ['s', 'k', '_', 'li', 've', '_', 'Z'.repeat(24)].join('');
  fs.writeFileSync(path.join(temporaryDirectory, 'source-canary.js'), outsideCanary);

  const result = scan([root]);
  assert.equal(result.roots, 1);
  assert.equal(result.files, 7);
  assert.match(result.manifestDigest, /^[0-9a-f]{64}$/);
});

test('the exact reserved TEST-001A1 synthetic contact remains accepted', () => {
  const { root } = makeArtifactRoot('test-artifacts-a1-contact');
  writeArtifact(root, 'contact.json', JSON.stringify({
    fixture: 'synthetic-contact-v1',
    fullName: 'Synthetic Runner 000001',
    email: 'runner-000001@example.test',
    phoneNumber: '+12025550101',
    address: {
      line1: '101 Test Only Avenue',
      line2: null,
      city: 'Example',
      state: 'CA',
      postalCode: '00000',
      country: 'US',
    },
  }));
  assert.equal(scan([root]).files, 1);
});

test('recognizable credential, capability, authority, and personal-data categories fail', () => {
  const jwt = ['e'.repeat(20), 'y'.repeat(20), 's'.repeat(20)].join('.');
  const privateKey = ['-----BEGIN RSA ', 'PRIVATE KEY-----', 'synthetic-body'].join('');
  const privateBoundary = (qualifier) => [
    '-----BEGIN ', qualifier, ['PRI', 'VATE', ' KEY'].join(''), '-----',
  ].join('');
  const forbidden = [
    ['CREDENTIAL_SHAPE', ['s', 'K', '_', 'Li', 'Ve', '_', 'A'.repeat(24)].join('')],
    ['CREDENTIAL_SHAPE', ['A', 'K', 'I', 'A', 'B'.repeat(16)].join('')],
    ['CREDENTIAL_SHAPE', `pk_live_${'p'.repeat(24)}`],
    ['CREDENTIAL_SHAPE', `pk_test_${'q'.repeat(24)}`],
    ['CREDENTIAL_SHAPE', `github_pat_${'r'.repeat(30)}`],
    ['JWT_SHAPE', jwt],
    ['PRIVATE_KEY_MATERIAL', privateKey],
    ['PRIVATE_KEY_MATERIAL', privateBoundary('')],
    ['PRIVATE_KEY_MATERIAL', privateBoundary('ENCRYPTED ')],
    ['PRIVATE_KEY_MATERIAL', privateBoundary('DSA ')],
    ['PRIVATE_KEY_MATERIAL', `${privateBoundary('PGP ').slice(0, -5)} BLOCK-----`],
    ['BEARER_MATERIAL', `Authorization: Bearer ${'c'.repeat(24)}`],
    ['BEARER_MATERIAL', `Bearer ${'d'.repeat(24)}`],
    ['AUTH_MATERIAL', `Authorization: Basic ${'b'.repeat(24)}`],
    ['AUTH_MATERIAL', `Cookie=${'session'.repeat(6)}`],
    ['AUTH_MATERIAL', JSON.stringify({ clientSecret: 'f'.repeat(24) })],
    ['AUTH_MATERIAL', `https://runner:${'u'.repeat(24)}@example.test/report`],
    ['CAPABILITY_URL', `https://example.test/callback?code=${'d'.repeat(24)}`],
    ['CAPABILITY_URL', `https://example.test/callback?session-id=${'s'.repeat(24)}`],
    ['CAPABILITY_URL', `https://example.test/callback?apiKey=${'a'.repeat(24)}`],
    ['CAPABILITY_URL', `https://example.test/callback?oauth_token=${'o'.repeat(24)}`],
    ['CAPABILITY_URL', `https://example.test/callback#password=${'p'.repeat(24)}`],
    ['CAPABILITY_URL', `https://example.test/callback?set-cookie=${'c'.repeat(24)}`],
    ['CAPABILITY_URL', `https%3A%2F%2Fexample.test%2Freturn%3Fstate%3D${'e'.repeat(24)}`],
    [
      'CAPABILITY_URL',
      `noise=%ZZ&next=https%3A%2F%2Fexample.test%2Freturn%3Fsession-id%3D${'m'.repeat(24)}&tail=100%`,
    ],
    [
      'CAPABILITY_URL',
      `<testsuite name="https://example.test/callback?session-id&#x3D;${'x'.repeat(24)}"/>`,
      'result.xml',
    ],
    [
      'CREDENTIAL_SHAPE',
      `%5Cu0073%5Cu006b%5Cu005f%5Cu006c%5Cu0069%5Cu0076%5Cu0065%5Cu005f${'z'.repeat(24)}`,
    ],
    ['PRODUCTION_AUTHORITY', ['MID', '-PENINSULA-RUNNING-CLUB'].join('')],
    ['PERSONAL_EMAIL', ['runner', String.raw`\u0040`, 'private.club'].join('')],
    ['PERSONAL_PHONE', ['+1 (650)', '234', '5678'].join('-')],
    ['PERSONAL_PHONE', '+442071838750'],
    ['SENSITIVE_IDENTITY_FIELD', JSON.stringify({
      dateOfBirth: ['1970', '01', '02'].join('-'),
    })],
    ['SENSITIVE_IDENTITY_FIELD', JSON.stringify({ fullName: 'Private Runner' })],
    ['SENSITIVE_IDENTITY_FIELD', JSON.stringify({ displayName: 'Private Runner' })],
    ['SENSITIVE_IDENTITY_FIELD', JSON.stringify({ phoneNumber: 6502345678 })],
    ['SENSITIVE_IDENTITY_FIELD', 'phoneNumber: 6502345678'],
    ['SENSITIVE_IDENTITY_FIELD', 'fullName: Private Runner'],
    ['SENSITIVE_IDENTITY_FIELD', JSON.stringify({ emergencyContactName: 'Private Helper' })],
    ['SENSITIVE_IDENTITY_FIELD', 'emergencyContact: { name: Private Helper }'],
    ['SENSITIVE_IDENTITY_FIELD', JSON.stringify({
      emergencyContact: { name: 'Private Helper', phone: 6502345678 },
    })],
    ['SENSITIVE_IDENTITY_FIELD', JSON.stringify({
      address: { city: 'Private City', line1: '123 Private Street' },
    })],
    ['SENSITIVE_IDENTITY_FIELD', 'address: { city: Private City }'],
    [
      'SENSITIVE_IDENTITY_FIELD',
      '<testsuite><fullName>Private Runner</fullName></testsuite>',
      'result.xml',
    ],
    [
      'SENSITIVE_IDENTITY_FIELD',
      '<testsuite><fullName><value>Private Runner</value></fullName></testsuite>',
      'result.xml',
    ],
    [
      'SENSITIVE_IDENTITY_FIELD',
      '<testsuite><fullName value="Private Runner"/></testsuite>',
      'result.xml',
    ],
    [
      'SENSITIVE_IDENTITY_FIELD',
      '<testsuite><property name="fullName" value="Private Runner"/></testsuite>',
      'result.xml',
    ],
    [
      'AUTH_MATERIAL',
      `<testsuite><token>${'t'.repeat(24)}</token></testsuite>`,
      'result.xml',
    ],
    [
      'AUTH_MATERIAL',
      `<testsuite><token><value>${'u'.repeat(24)}</value></token></testsuite>`,
      'result.xml',
    ],
    [
      'AUTH_MATERIAL',
      `<testsuite><token value="${'u'.repeat(24)}"/></testsuite>`,
      'result.xml',
    ],
    [
      'AUTH_MATERIAL',
      `<testsuite><property name="token" value="${'u'.repeat(24)}"/></testsuite>`,
      'result.xml',
    ],
    [
      'AUTH_MATERIAL',
      `<testsuite xmlns:m="urn:synthetic"><m:token>${'u'.repeat(24)}</m:token></testsuite>`,
      'result.xml',
    ],
    ['AUTH_MATERIAL', JSON.stringify({ authToken: 'a'.repeat(24) })],
    ['AUTH_MATERIAL', JSON.stringify({ oauthToken: 'o'.repeat(24) })],
    ['AUTH_MATERIAL', JSON.stringify({ sessionToken: 's'.repeat(24) })],
    ['AUTH_MATERIAL', JSON.stringify({ csrfToken: 'c'.repeat(24) })],
    ['AUTH_MATERIAL', JSON.stringify({ verificationToken: 'v'.repeat(24) })],
    ['AUTH_MATERIAL', JSON.stringify({ resetToken: 'r'.repeat(24) })],
    ['AUTH_MATERIAL', JSON.stringify({ apiCredential: 'k'.repeat(24) })],
    ['AUTH_MATERIAL', JSON.stringify({ privateKey: 'p'.repeat(24) })],
    ['AUTH_MATERIAL', JSON.stringify({ confirmationToken: 'n'.repeat(24) })],
  ];

  forbidden.forEach(([ruleId, value, filename = 'result.txt'], index) => {
    const { root } = makeArtifactRoot(`test-artifacts-${index}`);
    writeArtifact(root, filename, value);
    expectRule(ruleId, () => scan([root]), `forbidden case ${index}: ${ruleId}`);
  });
});

test('forbidden private-key boundary fixtures are not committed as complete literals', () => {
  const source = fs.readFileSync(__filename, 'utf8');
  const boundaryPrefix = ['-----BEGIN ', 'PRI', 'VATE', ' KEY'].join('');
  assert.doesNotMatch(source, new RegExp(boundaryPrefix, 'u'));
});

test('missing, broad, source-shaped, duplicate, and escaping roots fail closed', () => {
  expectRule('ROOT_REQUIRED', () => scan([]));
  const { maxRoots } = scannerModule.TEST_ARTIFACT_LIMITS;
  expectRule('ROOT_LIMIT', () => scan(Array(maxRoots + 1).fill('test-artifacts')));
  expectRule('ROOT_TOO_BROAD', () => scan([REPOSITORY]));
  expectRule('ROOT_NOT_ARTIFACT_OUTPUT', () => scan([path.join(REPOSITORY, 'src')]));

  const { root, temporaryDirectory } = makeArtifactRoot();
  expectRule('ROOT_DUPLICATE', () => scan([root, root]));
  writeArtifact(root, 'package.json', '{}');
  expectRule('ROOT_CONTAINS_SOURCE', () => scan([root]));

  const otherRoot = path.join(temporaryDirectory, 'test-results');
  fs.mkdirSync(otherRoot);
  const escapingSpelling = `${root}${path.sep}..${path.sep}test-results`;
  expectRule('ROOT_INVALID', () => scan([escapingSpelling]));
});

test('exported API snapshots own data descriptors and replaces hostile traps with a fixed error', () => {
  const { root } = makeArtifactRoot('test-artifacts-api');
  writeArtifact(root, 'safe.txt', 'safe\n');
  const canary = 'HOSTILE_API_CANARY_MUST_NOT_ESCAPE';
  const hostileRoots = new Proxy([], {
    ownKeys() {
      throw new Error(canary);
    },
  });
  const hostileOptions = new Proxy({}, {
    ownKeys() {
      throw new Error(canary);
    },
  });
  let rootGetterCalled = false;
  const accessorRoots = [];
  Object.defineProperty(accessorRoots, '0', {
    configurable: true,
    get() {
      rootGetterCalled = true;
      throw new Error(canary);
    },
  });
  accessorRoots.length = 1;
  let optionGetterCalled = false;
  const accessorOptions = {};
  Object.defineProperty(accessorOptions, 'cwd', {
    configurable: true,
    get() {
      optionGetterCalled = true;
      throw new Error(canary);
    },
  });

  const failures = [
    () => scan(null),
    () => scan(hostileRoots),
    () => scan(accessorRoots),
    () => scan([root], null),
    () => scan([root], hostileOptions),
    () => scan([root], accessorOptions),
  ];
  failures.forEach((callback) => {
    const error = expectRule('API_INVALID', callback);
    assert.equal(error.message, 'Test artifact scan failed.');
    assert.equal(error.exitCode, 2);
    assert.doesNotMatch(`${error.name}\n${error.message}`, new RegExp(canary));
  });
  assert.equal(rootGetterCalled, false);
  assert.equal(optionGetterCalled, false);
});

test('sensitive filenames fail even when their file contents are safe', () => {
  const generic = makeArtifactRoot('test-artifacts-sensitive-name');
  writeArtifact(generic.root, `session-id-${'n'.repeat(24)}.txt`, 'safe\n');
  expectRule('SENSITIVE_FILENAME', () => scan([generic.root]));

  const credential = makeArtifactRoot('test-artifacts-credential-name');
  writeArtifact(credential.root, `whsec_${'w'.repeat(24)}.txt`, 'safe\n');
  expectRule('CREDENTIAL_SHAPE', () => scan([credential.root]));
});

test('malformed structured report formats fail closed while text remains supported', () => {
  const malformed = [
    ['broken.json', '{"count":'],
    ['broken.jsonl', '{"count":1}\nnot-json\n'],
    ['broken.xml', '<testsuite><testcase></testsuite>'],
    ['multiple-roots.xml', '<first></first><second></second>'],
    ['unterminated-attribute.xml', '<testsuite name="unterminated></testsuite>'],
    ['invalid-entity.xml', '<testsuite name="&#9999999;"/>'],
    ['invalid-control-zero.xml', '<testsuite name="&#0;"/>'],
    ['invalid-control-one.xml', '<testsuite name="&#1;"/>'],
    ['invalid-direct-character.xml', `<testsuite>${String.fromCodePoint(0xfffe)}</testsuite>`],
    ['duplicate-attribute.xml', '<testsuite name="first" name="second"/>'],
    ['misplaced-declaration.xml', '<testsuite/><?xml version="1.0"?>'],
    ['broken.tap', 'ok 1 - missing TAP header\n'],
    ['plan-mismatch.tap', 'TAP version 13\nok 1 - synthetic\n1..2\n'],
    ['duplicate-plan.tap', 'TAP version 13\nok 1 - synthetic\n1..1\n1..1\n'],
    ['malformed-result.tap', 'TAP version 13\nok synthetic\n1..1\n'],
    ['broken.lcov', 'TN:\nSF:synthetic.js\nDA:1,1\n'],
    ['broken.info', 'TN:\nSF:synthetic.js\nUNKNOWN:value\nend_of_record\n'],
    ['duplicate-source.lcov', 'SF:first.js\nSF:second.js\nend_of_record\n'],
    ['metric-outside-record.lcov', 'DA:1,1\nSF:synthetic.js\nend_of_record\n'],
    ['invalid-counter.lcov', 'SF:synthetic.js\nDA:not-a-line,1\nend_of_record\n'],
    ['extra-end.lcov', 'SF:synthetic.js\nend_of_record\nend_of_record\n'],
  ];
  malformed.forEach(([filename, contents], index) => {
    const { root } = makeArtifactRoot(`test-artifacts-format-${index}`);
    writeArtifact(root, filename, contents);
    expectRule('FORMAT_INVALID', () => scan([root]));
  });

  const text = makeArtifactRoot('test-artifacts-text-format');
  writeArtifact(text.root, 'summary.txt', 'plain synthetic summary\n');
  writeArtifact(text.root, 'output.log', 'plain synthetic log\n');
  assert.equal(scan([text.root]).files, 2);
});

test('root and nested directory path swaps fail deterministic identity checks', () => {
  ['root', 'nested'].forEach((mode) => {
    const { root } = makeArtifactRoot(`test-artifacts-swap-${mode}`);
    writeArtifact(root, 'nested/safe.txt', 'safe\n');
    const target = fs.realpathSync(mode === 'root' ? root : path.join(root, 'nested'));
    const displaced = `${target}.original`;
    const originalOpenDirectory = fs.opendirSync;
    let swapped = false;
    fs.opendirSync = function swapBeforeOpen(directory, ...args) {
      if (!swapped && path.resolve(directory) === target) {
        swapped = true;
        fs.renameSync(target, displaced);
        fs.mkdirSync(target);
        fs.writeFileSync(path.join(target, 'replacement.txt'), 'safe\n');
      }
      return originalOpenDirectory.call(fs, directory, ...args);
    };
    try {
      expectRule('ENTRY_CHANGED', () => scan([root]));
      assert.equal(swapped, true);
    } finally {
      fs.opendirSync = originalOpenDirectory;
    }
  });
});

test('a root replacement at the realpath boundary fails initial identity binding', () => {
  const { root } = makeArtifactRoot('test-artifacts-initial-swap');
  const secret = ['s', 'k', '_', 'li', 've', '_', 'i'.repeat(24)].join('');
  writeArtifact(root, 'secret.txt', secret);
  const displaced = `${root}.original`;
  const originalRealpath = fs.realpathSync;
  let swapped = false;
  fs.realpathSync = function swapAfterInitialStat(target, ...args) {
    const result = originalRealpath.call(fs, target, ...args);
    if (!swapped && path.resolve(target) === path.resolve(root)) {
      swapped = true;
      fs.renameSync(root, displaced);
      fs.mkdirSync(root);
      fs.writeFileSync(path.join(root, 'safe.txt'), 'safe\n');
    }
    return result;
  };
  try {
    expectRule('ENTRY_CHANGED', () => scan([root]));
    assert.equal(swapped, true);
  } finally {
    fs.realpathSync = originalRealpath;
  }
});

test('symlinks, archives, unsupported types, binary data, and unreadable input fail', () => {
  const outside = makeArtifactRoot('reports-outside');

  const rootLink = makeArtifactRoot('test-results-rootlink');
  fs.rmSync(rootLink.root, { recursive: true });
  fs.symlinkSync(outside.root, rootLink.root);
  expectRule('ROOT_SYMLINK', () => scan([rootLink.root]));

  const symlinkRoot = makeArtifactRoot('test-artifacts-link');
  fs.symlinkSync(outside.root, path.join(symlinkRoot.root, 'escape'));
  expectRule('SYMLINK_UNSUPPORTED', () => scan([symlinkRoot.root]));

  const archiveRoot = makeArtifactRoot('test-artifacts-archive');
  writeArtifact(archiveRoot.root, 'results.zip', 'not-an-archive');
  expectRule('ARCHIVE_UNSUPPORTED', () => scan([archiveRoot.root]));

  const unsupportedRoot = makeArtifactRoot('test-artifacts-unsupported');
  writeArtifact(unsupportedRoot.root, 'results.md', 'text');
  expectRule('FORMAT_UNSUPPORTED', () => scan([unsupportedRoot.root]));

  const binaryRoot = makeArtifactRoot('test-artifacts-binary');
  writeArtifact(binaryRoot.root, 'results.txt', Buffer.from([0x00, 0xff, 0x01]));
  expectRule('BINARY_CONTENT', () => scan([binaryRoot.root]));

  const unreadableRoot = makeArtifactRoot('test-artifacts-unreadable');
  const unreadableFile = writeArtifact(unreadableRoot.root, 'private.log', 'safe');
  fs.chmodSync(unreadableFile, 0o000);
  try {
    expectRule('ENTRY_UNREADABLE', () => scan([unreadableRoot.root]));
  } finally {
    fs.chmodSync(unreadableFile, 0o600);
  }
});

test('file size, total size, depth, file count, and entry count are bounded', () => {
  const {
    maxDepth, maxEntries, maxFileBytes, maxFiles,
  } = scannerModule.TEST_ARTIFACT_LIMITS;

  const oversizeRoot = makeArtifactRoot('test-artifacts-oversize');
  writeArtifact(oversizeRoot.root, 'large.txt', Buffer.alloc(maxFileBytes + 1, 0x61));
  expectRule('FILE_TOO_LARGE', () => scan([oversizeRoot.root]));

  const totalRoot = makeArtifactRoot('test-artifacts-total');
  for (let index = 0; index < 5; index += 1) {
    writeArtifact(totalRoot.root, `part-${index}.txt`, Buffer.alloc(maxFileBytes, 0x61));
  }
  expectRule('TOTAL_BYTES_LIMIT', () => scan([totalRoot.root]));

  const deepRoot = makeArtifactRoot('test-artifacts-depth');
  writeArtifact(
    deepRoot.root,
    `${Array.from({ length: maxDepth + 1 }, (_unused, index) => `d${index}`).join('/')}/result.txt`,
    'safe',
  );
  expectRule('DEPTH_LIMIT', () => scan([deepRoot.root]));

  const fileRoot = makeArtifactRoot('test-artifacts-files');
  for (let index = 0; index <= maxFiles; index += 1) {
    writeArtifact(fileRoot.root, `result-${String(index).padStart(3, '0')}.txt`, 'safe');
  }
  expectRule('FILE_LIMIT', () => scan([fileRoot.root]));

  const entryRoot = makeArtifactRoot('test-artifacts-entries');
  for (let index = 0; index <= maxEntries; index += 1) {
    fs.mkdirSync(path.join(entryRoot.root, `empty-${String(index).padStart(3, '0')}`));
  }
  expectRule('ENTRY_LIMIT', () => scan([entryRoot.root]));
});

test('sorted traversal and repeated multi-root scans are deterministic', () => {
  const first = makeArtifactRoot('test-artifacts-z');
  const second = makeArtifactRoot('test-results-a');
  writeArtifact(first.root, 'z/report.txt', 'third');
  writeArtifact(first.root, 'a/report.txt', 'first');
  writeArtifact(second.root, 'm/report.txt', 'second');

  const forward = scan([first.root, second.root]);
  const reverse = scan([second.root, first.root]);
  const repeated = scan([first.root, second.root]);
  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward, repeated);
});

test('CLI failures use fixed rule IDs and never echo hostile values or filenames', () => {
  const { root } = makeArtifactRoot('test-artifacts-redaction');
  const canary = ['w', 'h', 's', 'e', 'c', '_', 'Q'.repeat(24)].join('');
  const secretBearingFilename = `do-not-echo-${canary}.json`;
  writeArtifact(root, secretBearingFilename, canary);

  const result = runScanner(root);
  assert.equal(result.status, 3);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^TEST_ARTIFACT_SCAN_FAILED CREDENTIAL_SHAPE\n$/);
  assert.doesNotMatch(result.stderr, new RegExp(canary));
  assert.doesNotMatch(result.stderr, /do-not-echo/);
});

test('current scrubber CI job is exact, dependency-free, blocking, and upload-free', () => {
  assert.deepEqual(ciErrors(ciWorkflow), []);
  assert.deepEqual(frontendValidationErrors(ciWorkflow), []);
  assert.deepEqual(releaseErrors(releaseWorkflow), []);
});

test('workflow guard rejects decoys, skips, wrappers, expressions, and altered scrubber jobs', () => {
  const mutations = [
    ciWorkflow.replace(`  ${JOB_ID}:\n`, '  removed-scrubber-job:\n'),
    ciWorkflow.replace(`name: ${JOB_NAME}`, 'name: Generic output check'),
    mutateJob(ciWorkflow, `name: ${JOB_NAME}`, `name: Generic output check # name: ${JOB_NAME}`),
    mutateJob(ciWorkflow, "node-version: '20'", "node-version: '18' # '20'"),
    ciWorkflow.replace(TEST_COMMAND, 'node --test tests/spa-navigation.test.js'),
    ciWorkflow.replace('    timeout-minutes: 5', `    continue-on-error: ${ALWAYS_TRUE}`),
    mutateJob(
      ciWorkflow,
      '    timeout-minutes: 5',
      '    timeout-minutes: 5\n    needs: frontend',
    ),
    mutateJob(
      ciWorkflow,
      '    timeout-minutes: 5',
      '    timeout-minutes: 5\n    strategy:\n      fail-fast: false',
    ),
    ciWorkflow.replace(
      `      - name: Run emitted test artifact safety tests\n        run: ${TEST_COMMAND}`,
      `      - name: Run emitted test artifact safety tests\n        if: ${NEVER_RUN}\n        run: ${TEST_COMMAND}`,
    ),
    ciWorkflow.replace(TEST_COMMAND, `${TEST_COMMAND} || true`),
    mutateJob(ciWorkflow, `        run: ${TEST_COMMAND}`, `        run: ${TEST_COMMAND} | cat`),
    mutateJob(ciWorkflow, `        run: ${TEST_COMMAND}`, `        run: ! ${TEST_COMMAND}`),
    mutateJob(
      ciWorkflow,
      `        run: ${TEST_COMMAND}`,
      `        run: bash -c '${TEST_COMMAND}'`,
    ),
    mutateJob(
      ciWorkflow,
      `        run: ${TEST_COMMAND}`,
      `        run: |\n          ${TEST_COMMAND}`,
    ),
    mutateJob(
      ciWorkflow,
      '          persist-credentials: false',
      '          persist-credentials: true # false',
    ),
    mutateJob(ciWorkflow, '      contents: read', '      packages: write'),
    ciWorkflow.replace(
      `    name: ${JOB_NAME}`,
      `    name: ${JOB_NAME}\n    env:\n      TEST_TOKEN: \${{ secrets.SYNTHETIC_CANARY }}`,
    ),
    mutateJob(
      ciWorkflow,
      `    name: ${JOB_NAME}`,
      `    name: ${JOB_NAME}\n    env:\n      TEST_TOKEN: ${BRACKET_SECRET}`,
    ),
    mutateJob(
      ciWorkflow,
      `    name: ${JOB_NAME}`,
      `    name: ${JOB_NAME}\n    env:\n      GH_TOKEN: ${BRACKET_GITHUB_TOKEN}`,
    ),
    mutateJob(
      ciWorkflow,
      '      - uses: actions/setup-node@v6',
      '      - uses: actions/setup-node@v6\n      - run: true',
    ),
  ];
  mutations.forEach((mutated) => assert.notDeepEqual(ciErrors(mutated), []));
});

test('workflow guard rejects case-insensitive direct artifact upload actions anywhere in CI', () => {
  const uploadActions = [
    `actions/UpLoAd-ArTiFaCt@${'a'.repeat(40)}`,
    `actions/upload-pages-artifact@${'b'.repeat(40)}`,
  ];
  uploadActions.forEach((action) => {
    const mutated = ciWorkflow.replace(
      `        run: ${TEST_COMMAND}`,
      `        run: ${TEST_COMMAND}\n      - uses: ${action}\n        with:\n          path: test-results`,
    );
    assert.notDeepEqual(ciErrors(mutated), []);

    const flowMap = ciWorkflow.replace(
      `        run: ${TEST_COMMAND}`,
      `        run: ${TEST_COMMAND}\n      - { uses: ${action}, with: { path: test-results } }`,
    );
    assert.notDeepEqual(ciErrors(flowMap), []);

    const quotedKey = ciWorkflow.replace(
      `        run: ${TEST_COMMAND}`,
      `        run: ${TEST_COMMAND}\n      - "uses": ${action}`,
    );
    assert.notDeepEqual(ciErrors(quotedKey), []);
  });

  const escapedUploadOutsideScrubber = ciWorkflow.replace(
    '      - run: npm run test:run',
    '      - run: npm run test:run\n      - "uses": "actions/upload\\u002dartifact@v4"',
  );
  assert.notEqual(escapedUploadOutsideScrubber, ciWorkflow);
  assert.notDeepEqual(ciErrors(escapedUploadOutsideScrubber), []);
});

test('workflow guard rejects quoted or flow-style privileged triggers', () => {
  const quotedTarget = ciWorkflow.replace(
    '  pull_request:',
    '  "pull_request_target":',
  );
  const flowTarget = ciWorkflow.replace(
    EXPECTED_CI_HEADER,
    'name: CI\n\non: [pull_request_target]\n\njobs:\n',
  );
  assert.notDeepEqual(ciErrors(quotedTarget), []);
  assert.notDeepEqual(ciErrors(flowTarget), []);
});

test('workflow guard rejects duplicate and complex semantic CI keys', () => {
  const duplicateFrontend = ciWorkflow.replace(
    `  ${JOB_ID}:\n`,
    `  "front\\u0065nd":\n    runs-on: ubuntu-latest\n    steps:\n      - run: "true"\n\n  ${JOB_ID}:\n`,
  );
  assert.notDeepEqual(ciErrors(duplicateFrontend), []);

  const duplicateScrubber = ciWorkflow.replace(
    '  functions:\n',
    '  "test-artifact-scrubbe\\u0072":\n    runs-on: ubuntu-latest\n    steps:\n      - run: "true"\n\n  functions:\n',
  );
  assert.notDeepEqual(ciErrors(duplicateScrubber), []);

  const explicitScrubber = ciWorkflow.replace(
    '  functions:\n',
    `  ? ${JOB_ID}\n  :\n    runs-on: ubuntu-latest\n    steps:\n      - run: "true"\n\n  functions:\n`,
  );
  assert.notDeepEqual(ciErrors(explicitScrubber), []);

  const duplicateJobs = `${ciWorkflow}\njobs:\n  decoy:\n    runs-on: ubuntu-latest\n`;
  assert.notDeepEqual(ciErrors(duplicateJobs), []);

  const lateDefaults = `${ciWorkflow}\ndefaults:\n  run:\n    shell: bash -c 'bash "$1" || true' _ {0}\n`;
  assert.notDeepEqual(ciErrors(lateDefaults), []);
});

test('frontend independently runs the exact workflow safety suite without a skip', () => {
  const missingSafetyTest = ciWorkflow.replace(
    ' tests/test-artifact-safety.test.js',
    '',
  );
  assert.notEqual(missingSafetyTest, ciWorkflow);
  assert.notDeepEqual(frontendValidationErrors(missingSafetyTest), []);

  const missingDependencyTest = ciWorkflow.replace(
    ' tests/root-dependency-security.test.js',
    '',
  );
  assert.notEqual(missingDependencyTest, ciWorkflow);
  assert.notDeepEqual(frontendValidationErrors(missingDependencyTest), []);

  const swallowedValidation = ciWorkflow.replace(
    FRONTEND_TEST_COMMAND,
    `${FRONTEND_TEST_COMMAND} || true`,
  );
  assert.notEqual(swallowedValidation, ciWorkflow);
  assert.notDeepEqual(frontendValidationErrors(swallowedValidation), []);

  const skippedValidation = ciWorkflow.replace(
    '      - name: Validate protected release workflow\n        run: |',
    `      - name: Validate protected release workflow\n        if: ${NEVER_RUN}\n        run: |`,
  );
  assert.notDeepEqual(frontendValidationErrors(skippedValidation), []);
});

test('workflow guard rejects omission from either protected-release job loop', () => {
  const requiredLine = `            "${JOB_NAME}" \\\n`;
  const withoutFirst = releaseWorkflow.replace(requiredLine, '');
  assert.notDeepEqual(releaseErrors(withoutFirst), []);

  const secondIndex = releaseWorkflow.lastIndexOf(requiredLine);
  const withoutSecond = releaseWorkflow.slice(0, secondIndex)
    + releaseWorkflow.slice(secondIndex + requiredLine.length);
  assert.notDeepEqual(releaseErrors(withoutSecond), []);

  const decoyOnly = releaseWorkflow.replace(
    requiredLine,
    `            "Renamed artifact check" \\\n            # "${JOB_NAME}" \\\n`,
  );
  assert.notDeepEqual(releaseErrors(decoyOnly), []);

  const loopDecoy = releaseWorkflow.replace(
    requiredLine,
    '',
  ).replace(
    '          for required_job in \\\n',
    `          cat <<'INERT_JOB_LOOP' >/dev/null\n${EXPECTED_RELEASE_JOB_LOOP}\nINERT_JOB_LOOP\n\n          for required_job in \\\n`,
  );
  assert.notDeepEqual(releaseErrors(loopDecoy), []);
});

test('workflow guard binds workflow and job execution context around protected checks', () => {
  const customShell = "bash -c 'bash \"$1\" || true' _ {0}";
  const workflowDefault = releaseWorkflow.replace(
    'jobs:\n',
    `defaults:\n  run:\n    shell: ${customShell}\n\njobs:\n`,
  );
  assert.notDeepEqual(releaseErrors(workflowDefault), []);

  ['preflight', 'deploy-backend'].forEach((jobId) => {
    const jobDefault = releaseWorkflow.replace(
      `  ${jobId}:\n`,
      `  ${jobId}:\n    defaults:\n      run:\n        shell: ${customShell}\n`,
    );
    assert.notDeepEqual(releaseErrors(jobDefault), []);
  });

  const duplicatePreflight = releaseWorkflow.replace(
    '  prepare-pages:\n',
    '  "pre\\u0066light":\n    runs-on: ubuntu-latest\n    steps:\n      - run: "true"\n\n  prepare-pages:\n',
  );
  assert.notDeepEqual(releaseErrors(duplicatePreflight), []);

  const duplicateBackend = releaseWorkflow.replace(
    '  deploy-pages:\n',
    '  "deploy-backend":\n    runs-on: ubuntu-latest\n    steps:\n      - run: "true"\n\n  deploy-pages:\n',
  );
  assert.notDeepEqual(releaseErrors(duplicateBackend), []);

  const explicitPreflight = releaseWorkflow.replace(
    '  deploy-backend:\n',
    '  ? preflight\n  :\n    name: Explicit duplicate wins\n    runs-on: ubuntu-latest\n    steps:\n      - run: "true"\n\n  deploy-backend:\n',
  );
  assert.notDeepEqual(releaseErrors(explicitPreflight), []);

  const taggedBackend = releaseWorkflow.replace(
    '  deploy-pages:\n',
    '  !!str deploy-backend:\n    runs-on: ubuntu-latest\n    steps:\n      - run: "true"\n\n  deploy-pages:\n',
  );
  assert.notDeepEqual(releaseErrors(taggedBackend), []);

  const mergedJobs = releaseWorkflow.replace('jobs:\n', 'jobs:\n  <<: *alternate-jobs\n');
  assert.notDeepEqual(releaseErrors(mergedJobs), []);

  const lateDefaults = `${releaseWorkflow}\ndefaults:\n  run:\n    shell: bash -c 'bash "$1" || true' _ {0}\n`;
  assert.notDeepEqual(releaseErrors(lateDefaults), []);
});
