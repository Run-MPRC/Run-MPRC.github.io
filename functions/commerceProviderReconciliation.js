const { types: { isProxy } } = require('node:util');

const reconciliationPolicySchemaVersion = 1;
const RECONCILIATION_ERROR_MESSAGE = 'Commerce provider reconciliation evidence is invalid.';

const EXPECTED_FIELDS = Object.freeze([
  'reconciliationPolicySchemaVersion',
  'provider',
  'providerAttempt',
  'planBinding',
  'evidenceSource',
  'evidenceCompleteness',
  'dispatchEvidence',
  'responseEvidence',
  'idempotencyEvidence',
  'providerObjectEvidence',
  'paymentEvidence',
  'eventEvidence',
  'searchEvidence',
  'businessTransitionEvidence',
]);

const RECONCILIATION_POLICY_ENUMS = Object.freeze({
  planBinding: Object.freeze(['exact', 'missing', 'conflicting']),
  evidenceSource: Object.freeze([
    'trusted_dispatch_history',
    'verified_provider_object',
    'verified_provider_and_event',
    'unverified_or_missing',
  ]),
  evidenceCompleteness: Object.freeze(['complete', 'partial', 'conflicting']),
  dispatchEvidence: Object.freeze([
    'execution_never_began',
    'execution_started',
    'timeout',
    'connection_lost',
    'unknown',
    'not_observed',
    'conflicting',
  ]),
  responseEvidence: Object.freeze([
    'none',
    'accepted',
    'conflict',
    'external_dependency_failure',
    'rate_limited',
    'server_failure',
    'other_failure',
    'unknown',
    'conflicting',
  ]),
  idempotencyEvidence: Object.freeze([
    'not_relied_upon',
    'active_exact',
    'old_or_pruned',
    'unknown',
    'conflicting',
  ]),
  providerObjectEvidence: Object.freeze([
    'none',
    'exact_open',
    'exact_complete',
    'exact_expired',
    'exact_unknown',
    'missing_reference',
    'not_found',
    'conflicting',
  ]),
  paymentEvidence: Object.freeze([
    'none',
    'unpaid',
    'paid',
    'no_payment_required',
    'processing',
    'unknown',
    'conflicting',
  ]),
  eventEvidence: Object.freeze([
    'none',
    'verified_success',
    'verified_expiry',
    'partial',
    'unknown',
    'conflicting',
  ]),
  searchEvidence: Object.freeze([
    'none',
    'exact_lookup_complete',
    'empty',
    'partial',
    'conflicting',
  ]),
  businessTransitionEvidence: Object.freeze([
    'same_operation_eligible',
    'new_generation_eligible',
    'already_succeeded',
    'ineligible',
    'unknown',
    'conflicting',
  ]),
});

const ENUM_SETS = Object.freeze(Object.fromEntries(
  Object.entries(RECONCILIATION_POLICY_ENUMS)
    .map(([field, values]) => [field, new Set(values)]),
));

const RESULTS = Object.freeze({
  existingAttemptFound: Object.freeze({
    reconciliationPolicySchemaVersion,
    classification: 'existing_attempt_found',
    state: 'do_not_advance',
  }),
  newAttemptCandidate: Object.freeze({
    reconciliationPolicySchemaVersion,
    classification: 'new_attempt_candidate',
    state: 'requires_persistence_and_authorization',
  }),
  reconciliationRequired: Object.freeze({
    reconciliationPolicySchemaVersion,
    classification: 'reconciliation_required',
    state: 'requires_reconciliation',
  }),
});

class CommerceProviderReconciliationError extends Error {
  constructor() {
    super(RECONCILIATION_ERROR_MESSAGE);
    Object.defineProperty(this, 'name', {
      value: 'CommerceProviderReconciliationError',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'message', {
      value: RECONCILIATION_ERROR_MESSAGE,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'code', {
      value: 'invalid_reconciliation_evidence',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Error.captureStackTrace?.(this, CommerceProviderReconciliationError);
    Object.freeze(this);
  }
}

function fail() {
  throw new CommerceProviderReconciliationError();
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

  if (evidence.reconciliationPolicySchemaVersion !== reconciliationPolicySchemaVersion
    || evidence.provider !== 'stripe'
    || evidence.providerAttempt !== 1) {
    fail();
  }

  for (const [field, allowedValues] of Object.entries(ENUM_SETS)) {
    if (!allowedValues.has(evidence[field])) fail();
  }

  return evidence;
}

function isDispatchNeverBeganCandidate(evidence) {
  return evidence.planBinding === 'exact'
    && evidence.evidenceSource === 'trusted_dispatch_history'
    && evidence.evidenceCompleteness === 'complete'
    && evidence.dispatchEvidence === 'execution_never_began'
    && evidence.responseEvidence === 'none'
    && evidence.idempotencyEvidence === 'not_relied_upon'
    && evidence.providerObjectEvidence === 'none'
    && evidence.paymentEvidence === 'none'
    && evidence.eventEvidence === 'none'
    && evidence.searchEvidence === 'none'
    && evidence.businessTransitionEvidence === 'same_operation_eligible';
}

function isExpiredAttemptCandidate(evidence) {
  return evidence.planBinding === 'exact'
    && evidence.evidenceSource === 'verified_provider_and_event'
    && evidence.evidenceCompleteness === 'complete'
    && evidence.dispatchEvidence === 'execution_started'
    && evidence.responseEvidence === 'accepted'
    && evidence.idempotencyEvidence === 'not_relied_upon'
    && evidence.providerObjectEvidence === 'exact_expired'
    && evidence.paymentEvidence === 'unpaid'
    && evidence.eventEvidence === 'verified_expiry'
    && evidence.searchEvidence === 'exact_lookup_complete'
    && evidence.businessTransitionEvidence === 'new_generation_eligible';
}

function isExistingOpenAttempt(evidence) {
  return evidence.planBinding === 'exact'
    && evidence.evidenceSource === 'verified_provider_object'
    && evidence.evidenceCompleteness === 'complete'
    && evidence.dispatchEvidence === 'execution_started'
    && evidence.responseEvidence === 'accepted'
    && evidence.idempotencyEvidence === 'not_relied_upon'
    && evidence.providerObjectEvidence === 'exact_open'
    && evidence.paymentEvidence === 'unpaid'
    && evidence.eventEvidence === 'none'
    && evidence.searchEvidence === 'exact_lookup_complete'
    && evidence.businessTransitionEvidence === 'ineligible';
}

function isExistingSuccessfulAttempt(evidence) {
  return evidence.planBinding === 'exact'
    && evidence.evidenceSource === 'verified_provider_and_event'
    && evidence.evidenceCompleteness === 'complete'
    && evidence.dispatchEvidence === 'execution_started'
    && evidence.responseEvidence === 'accepted'
    && evidence.idempotencyEvidence === 'not_relied_upon'
    && evidence.providerObjectEvidence === 'exact_complete'
    && (evidence.paymentEvidence === 'paid'
      || evidence.paymentEvidence === 'no_payment_required')
    && evidence.eventEvidence === 'verified_success'
    && evidence.searchEvidence === 'exact_lookup_complete'
    && evidence.businessTransitionEvidence === 'already_succeeded';
}

function classifyInitialStripeReconciliation(input) {
  const evidence = readExactEvidence(input);

  if (isExistingOpenAttempt(evidence) || isExistingSuccessfulAttempt(evidence)) {
    return RESULTS.existingAttemptFound;
  }
  if (isDispatchNeverBeganCandidate(evidence) || isExpiredAttemptCandidate(evidence)) {
    return RESULTS.newAttemptCandidate;
  }
  return RESULTS.reconciliationRequired;
}

Object.freeze(CommerceProviderReconciliationError.prototype);
Object.freeze(CommerceProviderReconciliationError);

module.exports = Object.freeze({
  reconciliationPolicySchemaVersion,
  RECONCILIATION_POLICY_ENUMS,
  CommerceProviderReconciliationError,
  classifyInitialStripeReconciliation,
});
