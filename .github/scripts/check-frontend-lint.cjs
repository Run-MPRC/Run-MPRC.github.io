'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ESLint } = require('eslint');
const onlyWarn = require('eslint-plugin-only-warn');

// The repository plugin patches ESLint globally and converts configured errors
// to warnings. Disable that patch in this dedicated process so the reviewed
// baseline preserves each rule's configured severity.
onlyWarn.disable();

const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_PATH = path.join(ROOT, '.github', 'lint-baseline.json');
const LINT_EXTENSIONS = Object.freeze(['.js', '.jsx', '.ts', '.tsx']);
const LINT_TARGETS = Object.freeze(['src']);
const ESLINT_OPTIONS = Object.freeze({
  cwd: ROOT,
  extensions: LINT_EXTENSIONS,
  fix: false,
  cache: false,
  errorOnUnmatchedPattern: true,
});
const BASELINE_ALGORITHM = 'sha256-canonical-file-and-finding-records-v2';
const MAX_RESULT_FILES = 10000;
const MAX_MESSAGES_PER_FILE = 10000;
const MAX_FINDINGS = 50000;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_BASELINE_BYTES = 4 * 1024 * 1024;
const SAFE_REJECTION_MESSAGE = 'frontend_lint_gate_rejected';
const SAFE_FAILURE_OUTPUT = 'frontend_lint_gate_failed:lint_rejected\n';
const FINDING_KEYS = Object.freeze([
  'file',
  'line',
  'column',
  'endLine',
  'endColumn',
  'severity',
  'ruleId',
  'message',
  'messageId',
  'nodeType',
  'fatal',
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireExactKeys(value, expectedKeys, label) {
  const actualKeys = Object.keys(value).sort();
  const requiredKeys = [...expectedKeys].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(requiredKeys)) {
    throw new Error(`invalid_${label}`);
  }
}

function requireInteger(value, minimum, label) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`invalid_${label}`);
  }
  return value;
}

function optionalInteger(value, label) {
  if (value === undefined || value === null) return null;
  return requireInteger(value, 1, label);
}

function optionalString(value, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`invalid_${label}`);
  }
  return value;
}

function validateRelativeFile(relative) {
  if (typeof relative !== 'string'
    || relative.length === 0
    || relative.includes('\\')
    || relative.startsWith('/')
    || relative.startsWith('../')
    || relative.includes('/../')
    || !relative.startsWith('src/')) {
    throw new Error('invalid_lint_file');
  }
  if (!LINT_EXTENSIONS.includes(path.posix.extname(relative))) {
    throw new Error('invalid_lint_extension');
  }
  return relative;
}

function normalizeFilePath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('invalid_lint_file');
  }
  const absolute = path.resolve(filePath);
  const relative = path.relative(ROOT, absolute).split(path.sep).join('/');
  if (relative === '' || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error('invalid_lint_file');
  }
  return validateRelativeFile(relative);
}

function normalizeMessage(file, message) {
  if (!isPlainObject(message)) throw new Error('invalid_lint_message');

  const severity = requireInteger(message.severity, 1, 'lint_severity');
  if (severity !== 1 && severity !== 2) throw new Error('invalid_lint_severity');
  if (message.ruleId !== null
    && (typeof message.ruleId !== 'string' || message.ruleId.length === 0)) {
    throw new Error('invalid_lint_rule');
  }
  if (typeof message.message !== 'string'
    || message.message.length === 0
    || message.message.length > MAX_MESSAGE_LENGTH) {
    throw new Error('invalid_lint_message_text');
  }
  if (hasOwn(message, 'fatal')
    && message.fatal !== undefined
    && typeof message.fatal !== 'boolean') {
    throw new Error('invalid_lint_fatal');
  }

  return Object.freeze({
    file,
    line: requireInteger(message.line, 1, 'lint_line'),
    column: requireInteger(message.column, 1, 'lint_column'),
    endLine: optionalInteger(message.endLine, 'lint_end_line'),
    endColumn: optionalInteger(message.endColumn, 'lint_end_column'),
    severity,
    ruleId: message.ruleId,
    message: message.message,
    messageId: optionalString(message.messageId, 'lint_message_id'),
    nodeType: optionalString(message.nodeType, 'lint_node_type'),
    fatal: message.fatal === true,
  });
}

function compareValues(left, right) {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'boolean' && typeof right === 'boolean') return left ? 1 : -1;
  return left < right ? -1 : 1;
}

function compareFindings(left, right) {
  for (const field of FINDING_KEYS) {
    const comparison = compareValues(left[field], right[field]);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function compareFiles(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function normalizeEslintResults(rawResults) {
  if (!Array.isArray(rawResults) || rawResults.length > MAX_RESULT_FILES) {
    throw new Error('invalid_lint_results');
  }

  const files = [];
  const findings = [];
  rawResults.forEach((result) => {
    if (!isPlainObject(result) || !Array.isArray(result.messages)
      || result.messages.length > MAX_MESSAGES_PER_FILE) {
      throw new Error('invalid_lint_result');
    }
    const file = normalizeFilePath(result.filePath);
    files.push(file);
    result.messages.forEach((message) => {
      findings.push(normalizeMessage(file, message));
      if (findings.length > MAX_FINDINGS) throw new Error('too_many_lint_findings');
    });
  });

  const sortedFiles = files.sort(compareFiles);
  if (new Set(sortedFiles).size !== sortedFiles.length) {
    throw new Error('duplicate_lint_file');
  }
  return Object.freeze({
    files: Object.freeze(sortedFiles),
    findings: Object.freeze(findings.sort(compareFindings)),
  });
}

function countFilesByExtension(files) {
  const counts = Object.fromEntries(LINT_EXTENSIONS.map((extension) => [extension, 0]));
  files.forEach((file) => {
    counts[path.posix.extname(file)] += 1;
  });
  return Object.freeze(counts);
}

function countFindingsByExtension(findings, severity) {
  const counts = Object.fromEntries(LINT_EXTENSIONS.map((extension) => [extension, 0]));
  findings.forEach((finding) => {
    if (finding.severity === severity) counts[path.posix.extname(finding.file)] += 1;
  });
  return Object.freeze(counts);
}

function findingsFingerprint(scan) {
  const canonical = JSON.stringify({
    scannedFiles: scan.files,
    findings: scan.findings,
  });
  return `sha256:${crypto.createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

function createBaseline(scan) {
  if (!isPlainObject(scan) || !Array.isArray(scan.files) || !Array.isArray(scan.findings)) {
    throw new Error('invalid_lint_scan');
  }
  const fatal = scan.findings.filter((finding) => finding.fatal);
  if (fatal.length !== 0) throw new Error(`fatal_lint_findings:${fatal.length}`);

  const errors = scan.findings.filter((finding) => finding.severity === 2);
  const warnings = scan.findings.filter((finding) => finding.severity === 1);
  if (errors.length + warnings.length !== scan.findings.length) {
    throw new Error('invalid_lint_severity_set');
  }

  return Object.freeze({
    schemaVersion: 2,
    algorithm: BASELINE_ALGORITHM,
    extensions: [...LINT_EXTENSIONS],
    targets: [...LINT_TARGETS],
    scannedFileCount: scan.files.length,
    scannedFilesByExtension: countFilesByExtension(scan.files),
    errorCount: errors.length,
    warningCount: warnings.length,
    errorsByExtension: countFindingsByExtension(scan.findings, 2),
    warningsByExtension: countFindingsByExtension(scan.findings, 1),
    fingerprint: findingsFingerprint(scan),
    scannedFiles: [...scan.files],
    findings: [...scan.findings],
  });
}

function normalizeStoredFinding(value) {
  if (!isPlainObject(value)) throw new Error('invalid_lint_baseline_finding');
  requireExactKeys(value, FINDING_KEYS, 'lint_baseline_finding_keys');
  return normalizeMessage(validateRelativeFile(value.file), value);
}

function parseBaseline(rawBaseline) {
  if (!isPlainObject(rawBaseline)) throw new Error('invalid_lint_baseline');
  requireExactKeys(rawBaseline, [
    'schemaVersion',
    'algorithm',
    'extensions',
    'targets',
    'scannedFileCount',
    'scannedFilesByExtension',
    'errorCount',
    'warningCount',
    'errorsByExtension',
    'warningsByExtension',
    'fingerprint',
    'scannedFiles',
    'findings',
  ], 'lint_baseline_keys');
  if (rawBaseline.schemaVersion !== 2 || rawBaseline.algorithm !== BASELINE_ALGORITHM) {
    throw new Error('invalid_lint_baseline_version');
  }
  if (JSON.stringify(rawBaseline.extensions) !== JSON.stringify(LINT_EXTENSIONS)
    || JSON.stringify(rawBaseline.targets) !== JSON.stringify(LINT_TARGETS)) {
    throw new Error('invalid_lint_baseline_scope');
  }
  if (!Array.isArray(rawBaseline.scannedFiles)
    || rawBaseline.scannedFiles.length > MAX_RESULT_FILES
    || !Array.isArray(rawBaseline.findings)
    || rawBaseline.findings.length > MAX_FINDINGS) {
    throw new Error('invalid_lint_baseline_records');
  }

  const files = rawBaseline.scannedFiles.map(validateRelativeFile);
  const sortedFiles = [...files].sort(compareFiles);
  if (new Set(files).size !== files.length
    || JSON.stringify(files) !== JSON.stringify(sortedFiles)) {
    throw new Error('invalid_lint_baseline_file_order');
  }
  const findings = rawBaseline.findings.map(normalizeStoredFinding);
  const sortedFindings = [...findings].sort(compareFindings);
  if (JSON.stringify(findings) !== JSON.stringify(sortedFindings)) {
    throw new Error('invalid_lint_baseline_finding_order');
  }

  const rebuilt = createBaseline({ files, findings });
  if (JSON.stringify(rebuilt) !== JSON.stringify(rawBaseline)) {
    throw new Error('invalid_lint_baseline_integrity');
  }
  return rebuilt;
}

function verifyScan(scan, rawBaseline) {
  const actual = createBaseline(scan);
  const expected = parseBaseline(rawBaseline);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `lint_baseline_mismatch:expected=${expected.errorCount}/${expected.warningCount}`
      + `:${expected.fingerprint}:actual=${actual.errorCount}/${actual.warningCount}`
      + `:${actual.fingerprint}`,
    );
  }
  return actual;
}

async function runEslint() {
  const eslint = new ESLint(ESLINT_OPTIONS);
  const results = await eslint.lintFiles(LINT_TARGETS);
  return normalizeEslintResults(results);
}

async function verifyCurrentLint(rawBaseline, lintRunner = runEslint) {
  try {
    const baseline = rawBaseline === undefined ? readBaseline() : rawBaseline;
    const scan = await lintRunner();
    return verifyScan(scan, baseline);
  } catch (_error) {
    throw new Error(SAFE_REJECTION_MESSAGE);
  }
}

function readBaseline() {
  let contents;
  try {
    contents = fs.readFileSync(BASELINE_PATH, 'utf8');
  } catch (_error) {
    throw new Error('missing_lint_baseline');
  }
  if (Buffer.byteLength(contents, 'utf8') > MAX_BASELINE_BYTES) {
    throw new Error('lint_baseline_too_large');
  }
  try {
    return JSON.parse(contents);
  } catch (_error) {
    throw new Error('invalid_lint_baseline_json');
  }
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== '--print-current-baseline')) {
    throw new Error('invalid_lint_gate_argument');
  }
  if (argv[0] === '--print-current-baseline') {
    const scan = await runEslint();
    process.stdout.write(`${JSON.stringify(createBaseline(scan), null, 2)}\n`);
    return;
  }

  const baseline = await verifyCurrentLint();
  process.stdout.write(
    `Frontend lint baseline verified: ${baseline.scannedFileCount} files; `
      + `${baseline.errorCount} reviewed legacy errors; `
      + `${baseline.warningCount} reviewed legacy warnings.\n`,
  );
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write(SAFE_FAILURE_OUTPUT);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  BASELINE_ALGORITHM,
  ESLINT_OPTIONS,
  FINDING_KEYS,
  LINT_EXTENSIONS,
  LINT_TARGETS,
  SAFE_FAILURE_OUTPUT,
  SAFE_REJECTION_MESSAGE,
  createBaseline,
  findingsFingerprint,
  normalizeEslintResults,
  parseBaseline,
  readBaseline,
  verifyCurrentLint,
  verifyScan,
});
