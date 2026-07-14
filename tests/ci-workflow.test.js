const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const util = require('node:util');

const ROOT = path.resolve(__dirname, '..');
const CI_PATH = path.join(ROOT, '.github/workflows/ci.yml');
const RELEASE_PATH = path.join(ROOT, '.github/workflows/deploy.yml');
const PACKAGE_PATH = path.join(ROOT, 'package.json');
const LINT_BASELINE_PATH = path.join(ROOT, '.github/lint-baseline.json');
const ciWorkflow = fs.readFileSync(CI_PATH, 'utf8');
const releaseWorkflow = fs.readFileSync(RELEASE_PATH, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
const lintBaseline = JSON.parse(fs.readFileSync(LINT_BASELINE_PATH, 'utf8'));
const lintGate = require('../.github/scripts/check-frontend-lint.cjs');

const JOB_ID = 'commerce-command-journal';
const JOB_NAME = 'Commerce command journal emulator';
const DEMO_PROJECT = 'demo-pay002b2-test';
const OPT_IN = 'REQUIRE_COMMERCE_COMMAND_JOURNAL_EMULATOR';
const TEST_FILE = 'commerceCommandJournal.emulator.test.js';
const NEVER_RUN = ['$', '{{ false }}'].join('');
const ALWAYS_TRUE = ['$', '{{ true }}'].join('');
const FRONTEND_JOB_ID = 'frontend';
const FRONTEND_JOB_NAME = 'Frontend lint + build';
const FRONTEND_RUNNER = 'ubuntu-latest';
const LINT_STEP_NAME = 'Run non-mutating frontend lint';
const LINT_COMMAND = 'node .github/scripts/check-frontend-lint.cjs';
const CLEAN_STEP_NAME = 'Verify frontend lint left the checkout unchanged';
const CLEAN_COMMANDS = Object.freeze([
  'git diff --exit-code HEAD --',
  'frontend_git_status="$(git status --porcelain=v1 --untracked-files=all)"',
  'test -z "$frontend_git_status"',
]);
const LINT_SCRIPT = 'node .github/scripts/check-frontend-lint.cjs';
const EXPECTED_LINT_FILES = 106;
const EXPECTED_LINT_ERRORS = 125;
const EXPECTED_LINT_WARNINGS = 7;
const YAML_TO_JSON = [
  'require "yaml"',
  'require "json"',
  'source = STDIN.read',
  'tree = Psych.parse_stream(source)',
  'check = lambda do |node|',
  '  if node.is_a?(Psych::Nodes::Mapping)',
  '    seen = {}',
  '    node.children.each_slice(2) do |key, value|',
  '      raise "complex_yaml_key" unless key.is_a?(Psych::Nodes::Scalar)',
  '      raise "duplicate_yaml_key" if seen[key.value]',
  '      seen[key.value] = true',
  '      check.call(value)',
  '    end',
  '  elsif node.is_a?(Psych::Nodes::Alias)',
  '    raise "yaml_alias_forbidden"',
  '  elsif node.is_a?(Psych::Nodes::Stream) || node.is_a?(Psych::Nodes::Document) || node.is_a?(Psych::Nodes::Sequence)',
  '    node.children.each { |child| check.call(child) if child }',
  '  end',
  'end',
  'check.call(tree)',
  'document = YAML.safe_load(source, permitted_classes: [], permitted_symbols: [], aliases: false)',
  'STDOUT.write(JSON.generate(document))',
].join("\n");
const parsedWorkflowCache = new Map();

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseWorkflow(workflow) {
  if (parsedWorkflowCache.has(workflow)) return parsedWorkflowCache.get(workflow);
  const result = childProcess.spawnSync('ruby', ['-e', YAML_TO_JSON], {
    input: workflow,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
  let parsed = null;
  if (result.status === 0) {
    try {
      parsed = JSON.parse(result.stdout);
    } catch (_error) {
      parsed = null;
    }
  }
  parsedWorkflowCache.set(workflow, parsed);
  return parsed;
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

function ciErrors(workflow) {
  const errors = [];
  const block = jobBlock(workflow, JOB_ID);
  if (!block) return ['missing job'];

  const checks = [
    [`name: ${JOB_NAME}`, 'wrong job name'],
    ["node-version: '20'", 'wrong Node version'],
    ["distribution: 'temurin'", 'missing Java distribution'],
    ["java-version: '17'", 'wrong Java version'],
    ['npm ci --legacy-peer-deps --ignore-scripts', 'root install is not locked'],
    ['npm --prefix functions ci --ignore-scripts', 'Functions install is not locked'],
    [`${OPT_IN}: '1'`, 'missing explicit opt-in'],
    ['npx --no-install firebase emulators:exec', 'Firebase CLI is not lockfile-bound'],
    [`--project ${DEMO_PROJECT}`, 'wrong demo project'],
    ['--only firestore', 'emulator scope is not Firestore-only'],
    ['--runInBand', 'Jest is not in band'],
    [TEST_FILE, 'wrong focused test'],
  ];
  checks.forEach(([required, message]) => {
    if (!block.includes(required)) errors.push(message);
  });

  if ((workflow.match(new RegExp(`name: ${JOB_NAME}`, 'g')) ?? []).length !== 1) {
    errors.push('job name must occur exactly once');
  }
  if (/^\s+if\s*:/m.test(block)) errors.push('job or step may be skipped');
  if (/continue-on-error\s*:/.test(block)) errors.push('job may ignore failure');
  if (/\|\|\s*true\b|;\s*true\b|\bset\s+\+e\b/.test(block)) {
    errors.push('job may swallow command failure');
  }
  if (/firebase-tools@|npm install -g/.test(block)) errors.push('uncommitted CLI install');
  if (/--only\s+(?:[^\n]*,|auth|functions)/.test(block)) errors.push('broad emulator scope');
  if (/secrets\.|FIREBASE_SERVICE_ACCOUNT|FIREBASE_TOKEN|STRIPE_SECRET/.test(block)) {
    errors.push('job receives a secret or cloud credential');
  }
  if (/mid-peninsula-running-club|runmprc-97922/.test(block)) {
    errors.push('job names a hosted project');
  }
  return errors;
}

function frontendLintErrors(workflow, scripts = packageJson.scripts) {
  const errors = [];
  const block = jobBlock(workflow, FRONTEND_JOB_ID);
  if (!block) return ['missing frontend job'];

  const parsed = parseWorkflow(workflow);
  const frontend = parsed?.jobs?.[FRONTEND_JOB_ID];
  if (!isPlainObject(parsed) || !isPlainObject(frontend) || !Array.isArray(frontend.steps)) {
    return ['workflow YAML or frontend job is invalid'];
  }
  if (Object.prototype.hasOwnProperty.call(parsed, 'defaults')
    || Object.prototype.hasOwnProperty.call(parsed, 'env')) {
    errors.push('workflow execution context may override frontend commands');
  }
  if (JSON.stringify(Object.keys(frontend).sort())
    !== JSON.stringify(['name', 'runs-on', 'permissions', 'steps'].sort())) {
    errors.push('frontend job execution context is not exact');
  }
  if (frontend.name !== FRONTEND_JOB_NAME || frontend['runs-on'] !== FRONTEND_RUNNER) {
    errors.push('frontend job identity or runner is not exact');
  }
  if (!util.isDeepStrictEqual(frontend.permissions, { contents: 'read' })) {
    errors.push('frontend job permissions are not exact');
  }

  const lines = block.split('\n');
  const lintStep = [
    `      - name: ${LINT_STEP_NAME}`,
    `        run: ${LINT_COMMAND}`,
  ];
  const cleanStep = [
    `      - name: ${CLEAN_STEP_NAME}`,
    '        run: |',
    `          ${CLEAN_COMMANDS[0]}`,
    `          ${CLEAN_COMMANDS[1]}`,
    `          ${CLEAN_COMMANDS[2]}`,
  ];
  const stepAt = (expected) => {
    const start = lines.findIndex((line) => line === expected[0]);
    if (start < 0) return false;
    const nextStep = lines.findIndex((line, index) => (
      index > start && line.startsWith('      - ')
    ));
    const end = nextStep < 0 ? lines.length : nextStep;
    return JSON.stringify(lines.slice(start, end).filter((line) => line !== ''))
      === JSON.stringify(expected);
  };
  if (!stepAt(lintStep)) errors.push('lint step is not exact');
  if (!stepAt(cleanStep)) errors.push('clean-check step is not exact');
  lintStep.concat(cleanStep).filter((requiredLine) => requiredLine !== '        run: |')
    .forEach((requiredLine) => {
      if (lines.filter((line) => line === requiredLine).length !== 1) {
        errors.push(`required line must occur exactly once: ${requiredLine.trim()}`);
      }
    });

  const lintIndexes = frontend.steps
    .map((step, index) => (isPlainObject(step) && step.name === LINT_STEP_NAME ? index : -1))
    .filter((index) => index >= 0);
  const cleanIndexes = frontend.steps
    .map((step, index) => (isPlainObject(step) && step.name === CLEAN_STEP_NAME ? index : -1))
    .filter((index) => index >= 0);
  if (lintIndexes.length !== 1 || cleanIndexes.length !== 1
    || lintIndexes[0] !== 3 || cleanIndexes[0] !== 4) {
    errors.push('trusted setup, lint, and clean-check order is not exact');
  } else {
    const lintDefinition = frontend.steps[lintIndexes[0]];
    const cleanDefinition = frontend.steps[cleanIndexes[0]];
    if (JSON.stringify(Object.keys(lintDefinition).sort()) !== JSON.stringify(['name', 'run'])) {
      errors.push('lint step execution context is not exact');
    }
    if (JSON.stringify(Object.keys(cleanDefinition).sort()) !== JSON.stringify(['name', 'run'])) {
      errors.push('clean-check step execution context is not exact');
    }
    if (lintDefinition.run !== LINT_COMMAND
      || cleanDefinition.run !== `${CLEAN_COMMANDS.join('\n')}\n`) {
      errors.push('parsed lint or clean command is not exact');
    }
  }

  const expectedPrefix = [
    {
      uses: 'actions/checkout@v6',
      with: { 'persist-credentials': false },
    },
    {
      uses: 'actions/setup-node@v6',
      with: { 'node-version': '20', cache: 'npm' },
    },
    { run: 'npm ci --legacy-peer-deps --ignore-scripts' },
    { name: LINT_STEP_NAME, run: LINT_COMMAND },
    { name: CLEAN_STEP_NAME, run: `${CLEAN_COMMANDS.join('\n')}\n` },
  ];
  if (!util.isDeepStrictEqual(frontend.steps.slice(0, expectedPrefix.length), expectedPrefix)) {
    errors.push('trusted setup and lint prefix is not exact');
  }

  if (!scripts || scripts['lint:ci'] !== LINT_SCRIPT) errors.push('wrong lint script');
  if (scripts?.['prelint:ci'] !== undefined || scripts?.['postlint:ci'] !== undefined) {
    errors.push('lint lifecycle hooks are forbidden');
  }
  if (/lint:fix|--fix\b/.test(block)) errors.push('CI lint may not mutate files');
  return errors;
}

function releaseErrors(workflow) {
  const errors = [];
  const requiredName = `"${JOB_NAME}"`;
  const preflight = jobBlock(workflow, 'preflight');
  const backend = jobBlock(workflow, 'deploy-backend');
  if ((preflight.match(new RegExp(requiredName, 'g')) ?? []).length !== 1) {
    errors.push('preflight must require the job exactly once');
  }
  if ((backend.match(new RegExp(requiredName, 'g')) ?? []).length !== 1) {
    errors.push('post-approval check must require the job exactly once');
  }
  return errors;
}

test('journal emulator CI job is exact, isolated, and blocking', () => {
  assert.deepEqual(ciErrors(ciWorkflow), []);
  assert.deepEqual(releaseErrors(releaseWorkflow), []);
});

test('frontend lint covers every source extension without mutating or swallowing failures', async () => {
  assert.deepEqual(frontendLintErrors(ciWorkflow), []);
  assert.deepEqual(lintGate.LINT_EXTENSIONS, ['.js', '.jsx', '.ts', '.tsx']);
  assert.deepEqual(lintGate.LINT_TARGETS, ['src']);
  assert.equal(lintGate.ESLINT_OPTIONS.fix, false);
  assert.equal(lintGate.ESLINT_OPTIONS.cache, false);
  assert.equal(lintGate.ESLINT_OPTIONS.errorOnUnmatchedPattern, true);
  assert.deepEqual(lintGate.ESLINT_OPTIONS.extensions, ['.js', '.jsx', '.ts', '.tsx']);

  const verified = await lintGate.verifyCurrentLint(lintBaseline);
  assert.equal(verified.scannedFileCount, EXPECTED_LINT_FILES);
  assert.equal(verified.errorCount, EXPECTED_LINT_ERRORS);
  assert.equal(verified.warningCount, EXPECTED_LINT_WARNINGS);
});

test('frontend lint workflow guard rejects unsafe wiring mutations', () => {
  const workflowMutations = [
    ciWorkflow.replace(LINT_STEP_NAME, 'Run frontend formatting'),
    ciWorkflow.replace(LINT_COMMAND, 'npm run lint:fix'),
    ciWorkflow.replace(LINT_COMMAND, `${LINT_COMMAND} || exit 0`),
    ciWorkflow.replace(
      `      - name: ${LINT_STEP_NAME}`,
      `      - name: ${LINT_STEP_NAME}\n        if: ${NEVER_RUN}`,
    ),
    ciWorkflow.replace(
      '  frontend:\n',
      `  frontend:\n    if: ${NEVER_RUN}\n`,
    ),
    ciWorkflow.replace(
      `      - name: ${CLEAN_STEP_NAME}`,
      `      - continue-on-error: ${ALWAYS_TRUE}\n        name: ${CLEAN_STEP_NAME}`,
    ),
    ciWorkflow.replace(
      `        run: ${LINT_COMMAND}`,
      `        # run: ${LINT_COMMAND}\n        run: echo lint-skipped`,
    ),
    ciWorkflow.replace(CLEAN_COMMANDS[0], `# ${CLEAN_COMMANDS[0]}`),
    ciWorkflow.replace(CLEAN_COMMANDS[1], 'git status --short'),
    ciWorkflow.replace(
      `          ${CLEAN_COMMANDS[1]}`,
      `          ${CLEAN_COMMANDS[1]}\n          ${CLEAN_COMMANDS[2]}\n        if: ${NEVER_RUN}`,
    ),
    ciWorkflow.replace(
      `      - name: ${LINT_STEP_NAME}\n`
        + `        run: ${LINT_COMMAND}\n`
        + `      - name: ${CLEAN_STEP_NAME}\n`
        + '        run: |\n'
        + `          ${CLEAN_COMMANDS.join('\n          ')}`,
      `      - name: ${CLEAN_STEP_NAME}\n`
        + '        run: |\n'
        + `          ${CLEAN_COMMANDS.join('\n          ')}\n`
        + `      - name: ${LINT_STEP_NAME}\n`
        + `        run: ${LINT_COMMAND}`,
    ),
    ciWorkflow.replace('  frontend:\n', `  frontend:\n    "if": ${NEVER_RUN}\n`),
    ciWorkflow.replace('  frontend:\n', '  frontend:\n    "continue-on-error": true\n'),
    ciWorkflow.replace(
      '  frontend:\n',
      "  frontend:\n    defaults:\n      run:\n        shell: bash -c 'bash \"$1\" || true' _ {0}\n",
    ),
    ciWorkflow.replace(
      'jobs:\n',
      "defaults:\n  run:\n    shell: bash -c 'bash \"$1\" || true' _ {0}\njobs:\n",
    ),
    ciWorkflow.replace(
      '    name: Frontend lint + build\n',
      '    name: Frontend lint + build\n    "name": Frontend decoy\n',
    ),
    ciWorkflow.replace('    runs-on: ubuntu-latest\n', '    runs-on: self-hosted\n'),
    ciWorkflow.replace(
      `      - name: ${LINT_STEP_NAME}\n`,
      '      - name: Poison later process environment\n'
        + '        run: echo NPM_CONFIG_SCRIPT_SHELL=/usr/bin/true >> "$GITHUB_ENV"\n'
        + `      - name: ${LINT_STEP_NAME}\n`,
    ),
  ];
  workflowMutations.forEach((mutated) => {
    assert.notDeepEqual(frontendLintErrors(mutated), []);
  });

  const scriptMutations = [
    { ...packageJson.scripts, 'lint:ci': 'eslint --fix src' },
    { ...packageJson.scripts, 'lint:ci': 'eslint src || true' },
    { ...packageJson.scripts, 'lint:ci': 'eslint --ext .js,.jsx src' },
    { ...packageJson.scripts, 'lint:ci': undefined },
    { ...packageJson.scripts, 'prelint:ci': 'node replace-baseline.js' },
    { ...packageJson.scripts, 'postlint:ci': 'git checkout -- .' },
  ];
  scriptMutations.forEach((scripts) => {
    assert.notDeepEqual(frontendLintErrors(ciWorkflow, scripts), []);
  });
});

function syntheticResult(messages) {
  return [{
    filePath: path.join(ROOT, 'src', 'synthetic.tsx'),
    messages,
  }];
}

function syntheticMessage(overrides = {}) {
  return {
    ruleId: 'synthetic/rule',
    severity: 1,
    message: 'Synthetic warning.',
    line: 1,
    column: 1,
    endLine: 1,
    endColumn: 2,
    nodeType: 'Identifier',
    messageId: 'synthetic',
    ...overrides,
  };
}

test('lint baseline accepts only the exact normalized file and finding records', () => {
  const exact = lintGate.normalizeEslintResults(syntheticResult([syntheticMessage()]));
  const baseline = lintGate.createBaseline(exact);
  assert.deepEqual(lintGate.verifyScan(exact, baseline), baseline);

  const added = lintGate.normalizeEslintResults(syntheticResult([
    syntheticMessage(),
    syntheticMessage({ line: 2 }),
  ]));
  const removed = lintGate.normalizeEslintResults(syntheticResult([]));
  const moved = lintGate.normalizeEslintResults(syntheticResult([
    syntheticMessage({ line: 2 }),
  ]));
  [added, removed, moved].forEach((scan) => {
    assert.throws(() => lintGate.verifyScan(scan, baseline), /lint_baseline_mismatch/);
  });
});

test('lint baseline rejects parser errors and malformed result or baseline data', async () => {
  const parserError = lintGate.normalizeEslintResults(syntheticResult([
    syntheticMessage({ ruleId: null, severity: 2, fatal: true, message: 'Parsing error.' }),
  ]));
  assert.throws(
    () => lintGate.createBaseline(parserError),
    /fatal_lint_findings/,
  );
  assert.throws(() => lintGate.normalizeEslintResults({}), /invalid_lint_results/);
  assert.throws(
    () => lintGate.normalizeEslintResults([{ filePath: 'src/file.ts', messages: {} }]),
    /invalid_lint_result/,
  );
  assert.throws(
    () => lintGate.parseBaseline({ schemaVersion: 1 }),
    /invalid_lint_baseline_keys/,
  );
  assert.throws(
    () => lintGate.normalizeEslintResults(syntheticResult([
      syntheticMessage({ fatal: 'true' }),
    ])),
    /invalid_lint_fatal/,
  );
  assert.throws(
    () => lintGate.normalizeEslintResults(syntheticResult([
      syntheticMessage({ messageId: {} }),
    ])),
    /invalid_lint_message_id/,
  );
  assert.throws(
    () => lintGate.normalizeEslintResults(syntheticResult([
      syntheticMessage({ nodeType: [] }),
    ])),
    /invalid_lint_node_type/,
  );
  const hostile = new Proxy(new Error('HOSTILE_MESSAGE_GETTER_CANARY_DO_NOT_LOG'), {
    get() {
      throw new Error('HOSTILE_PROXY_CANARY_DO_NOT_LOG');
    },
    getPrototypeOf() {
      throw new Error('HOSTILE_PROTOTYPE_CANARY_DO_NOT_LOG');
    },
  });
  await assert.rejects(
    lintGate.verifyCurrentLint(lintBaseline, async () => Promise.reject(hostile)),
    (error) => error instanceof Error
      && error.message === lintGate.SAFE_REJECTION_MESSAGE
      && !error.stack.includes('HOSTILE_'),
  );
  assert.equal(lintGate.SAFE_FAILURE_OUTPUT, 'frontend_lint_gate_failed:lint_rejected\n');
  const failedAssignment = childProcess.spawnSync('bash', ['-e', '-c', [
    'frontend_git_status="$(false)"',
    'test -z "$frontend_git_status"',
  ].join('\n')]);
  assert.notEqual(failedAssignment.status, 0);
});

test('guard rejects missing, renamed, broadened, or unsafe CI wiring', () => {
  const mutations = [
    ciWorkflow.replace(`  ${JOB_ID}:\n`, '  removed-journal-job:\n'),
    ciWorkflow.replace(`name: ${JOB_NAME}`, 'name: Generic emulator'),
    ciWorkflow.replace(`--project ${DEMO_PROJECT}`, '--project demo-other-test'),
    ciWorkflow.replace(`${OPT_IN}: '1'`, `${OPT_IN}: '0'`),
    ciWorkflow.replace('--only firestore', '--only auth,firestore'),
    ciWorkflow.replace('npx --no-install firebase', 'npx firebase-tools@latest'),
    ciWorkflow.replace(TEST_FILE, 'another.test.js'),
    ciWorkflow.replace('timeout-minutes: 10', `continue-on-error: ${ALWAYS_TRUE}`),
    ciWorkflow.replace(
      '        run: >-\n          npx --no-install firebase emulators:exec',
      `        if: ${NEVER_RUN}\n`
        + '        run: >-\n          npx --no-install firebase emulators:exec',
    ),
    ciWorkflow.replace(TEST_FILE, `${TEST_FILE} || true`),
  ];

  mutations.forEach((mutated) => assert.notDeepEqual(ciErrors(mutated), []));
});

test('guard rejects omission from either protected-release recheck', () => {
  const requiredLine = `            "${JOB_NAME}" \\\n`;
  const withoutFirst = releaseWorkflow.replace(requiredLine, '');
  assert.notDeepEqual(releaseErrors(withoutFirst), []);

  const secondIndex = releaseWorkflow.lastIndexOf(requiredLine);
  const withoutSecond = releaseWorkflow.slice(0, secondIndex)
    + releaseWorkflow.slice(secondIndex + requiredLine.length);
  assert.notDeepEqual(releaseErrors(withoutSecond), []);

  const duplicatedOnlyInPreflight = withoutSecond.replace(
    requiredLine,
    requiredLine + requiredLine,
  );
  assert.notDeepEqual(releaseErrors(duplicatedOnlyInPreflight), []);
});
