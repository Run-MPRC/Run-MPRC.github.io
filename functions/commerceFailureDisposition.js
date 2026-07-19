const { types: { isProxy } } = require('node:util');

const failureDispositionSchemaVersion = 1;
const FAILURE_DISPOSITION_ERROR_MESSAGE = 'Commerce failure disposition evidence is invalid.';

const EXPECTED_FIELDS = Object.freeze([
  'failureDispositionSchemaVersion',
  'failureSignal',
  'sideEffectIdempotency',
  'retryBudget',
]);

const FAILURE_DISPOSITION_ENUMS = Object.freeze({
  // The observed outcome of a side-effect delivery attempt that did not confirm
  // clean success. Transient names reuse the house `responseEvidence` vocabulary.
  failureSignal: Object.freeze([
    // Transient — retryable only when the effect is idempotent and budget remains.
    'timeout',
    'connection_lost',
    'rate_limited',
    'server_failure',
    'external_dependency_failure',
    // Permanent — never retried.
    'permanent_client_error',
    'malformed_response',
    // Needs reconciliation / unclassified — fail closed to quarantine.
    'conflict',
    'unknown',
    // The effect was already applied (idempotent replay) — no new delivery.
    'duplicate_replay',
  ]),
  // Whether repeating the side effect is safe. A non-idempotent effect is never
  // auto-retried: a second external create, refund, or send could double-apply.
  sideEffectIdempotency: Object.freeze(['idempotent', 'non_idempotent']),
  // Whether the caller's retry allowance (count/backoff/TTL — owned by PAY-003C)
  // still permits another attempt. Passed as evidence; never derived here.
  retryBudget: Object.freeze(['available', 'exhausted']),
  // Output-only dispositions.
  disposition: Object.freeze([
    'retry_transient',
    'dead_letter',
    'quarantine_permanent',
    'ignore_duplicate',
  ]),
});

// Only the input enums are validated against the incoming evidence.
const ENUM_SETS = Object.freeze({
  failureSignal: new Set(FAILURE_DISPOSITION_ENUMS.failureSignal),
  sideEffectIdempotency: new Set(FAILURE_DISPOSITION_ENUMS.sideEffectIdempotency),
  retryBudget: new Set(FAILURE_DISPOSITION_ENUMS.retryBudget),
});

// The subset of failureSignal values that are transient (retryable in principle).
const TRANSIENT_SIGNALS = new Set([
  'timeout',
  'connection_lost',
  'rate_limited',
  'server_failure',
  'external_dependency_failure',
]);

class CommerceFailureDispositionError extends Error {
  constructor() {
    super(FAILURE_DISPOSITION_ERROR_MESSAGE);
    Object.defineProperty(this, 'name', {
      value: 'CommerceFailureDispositionError',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'message', {
      value: FAILURE_DISPOSITION_ERROR_MESSAGE,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'code', {
      value: 'invalid_failure_disposition_evidence',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Error.captureStackTrace?.(this, CommerceFailureDispositionError);
    Object.freeze(this);
  }
}

function fail() {
  throw new CommerceFailureDispositionError();
}

function readExactEvidence(value) {
  if (value === null || typeof value !== 'object' || isProxy(value)) fail();

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail();
  }

  if (prototype !== Object.prototype || keys.length !== EXPECTED_FIELDS.length) fail();

  const keySet = new Set();
  for (const key of keys) {
    if (typeof key !== 'string' || keySet.has(key)) fail();
    keySet.add(key);
  }
  if (EXPECTED_FIELDS.some((field) => !keySet.has(field))) fail();

  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail();
  }

  const evidence = Object.create(null);
  for (const field of EXPECTED_FIELDS) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, field);
    } catch {
      fail();
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined) {
      fail();
    }
    evidence[field] = descriptor.value;
  }

  if (evidence.failureDispositionSchemaVersion !== failureDispositionSchemaVersion) fail();

  for (const [field, allowedValues] of Object.entries(ENUM_SETS)) {
    if (!allowedValues.has(evidence[field])) fail();
  }

  return evidence;
}

function frozenDisposition(disposition, retryable) {
  return Object.freeze({
    failureDispositionSchemaVersion,
    disposition,
    // Only a transient failure on an idempotent effect with budget remaining is
    // retryable; every other verdict is terminal for the current attempt so the
    // deferred worker never re-hits the provider unsafely.
    retryable,
  });
}

const RESULTS = Object.freeze({
  retryTransient: frozenDisposition('retry_transient', true),
  deadLetter: frozenDisposition('dead_letter', false),
  quarantinePermanent: frozenDisposition('quarantine_permanent', false),
  ignoreDuplicate: frozenDisposition('ignore_duplicate', false),
});

function classifyAttemptFailure(input) {
  const evidence = readExactEvidence(input);

  // 1. An idempotent replay means the effect already landed: no new delivery.
  if (evidence.failureSignal === 'duplicate_replay') {
    return RESULTS.ignoreDuplicate;
  }

  // 2. Anything off the transient allow-list (permanent_client_error,
  //    malformed_response, conflict, unknown) is never retried and is
  //    quarantined for reprocessing/alerting — fail closed.
  if (!TRANSIENT_SIGNALS.has(evidence.failureSignal)) {
    return RESULTS.quarantinePermanent;
  }

  // 3. Transient, but a non-idempotent side effect must never be auto-retried
  //    (a second external create, refund, or send could double-apply); quarantine
  //    it for manual handling instead.
  if (evidence.sideEffectIdempotency === 'non_idempotent') {
    return RESULTS.quarantinePermanent;
  }

  // 4. Transient and idempotent: retry while the caller's budget remains,
  //    otherwise dead-letter for operations.
  return evidence.retryBudget === 'available' ? RESULTS.retryTransient : RESULTS.deadLetter;
}

Object.freeze(CommerceFailureDispositionError.prototype);
Object.freeze(CommerceFailureDispositionError);

module.exports = Object.freeze({
  failureDispositionSchemaVersion,
  FAILURE_DISPOSITION_ENUMS,
  CommerceFailureDispositionError,
  classifyAttemptFailure,
});
