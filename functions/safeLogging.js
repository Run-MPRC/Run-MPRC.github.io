const {
  REQUEST_VALIDATION_REASONS,
  RequestValidationError,
  parseStrictObject,
} = require('./requestValidation');

// Every accepted value is a reviewed low-cardinality code. This primitive does
// not accept correlation IDs, provider IDs, URLs, contact data, or raw errors.
const SAFE_LOG_VALUE_LISTS = Object.freeze(Object.assign(Object.create(null), {
  event: Object.freeze([
    'request_validation',
    'command_admission',
    'command_execution',
    'provider_transition',
    'reconciliation',
    'security_control',
  ]),
  operation: Object.freeze([
    'race_registration',
    'merchandise_checkout',
    'registration_lookup',
    'order_lookup',
    'registration_refund',
    'order_refund',
    'registration_cancel',
    'order_cancel',
    'registration_substitute',
    'late_registration',
    'complimentary_registration',
    'role_change',
    'tracking_update',
    'export',
    'webhook',
    'reconciliation',
    'profile_recovery',
    'authentication',
  ]),
  outcome: Object.freeze([
    'accepted',
    'rejected',
    'succeeded',
    'failed',
    'retryable',
    'quarantined',
    'no_change',
  ]),
  code: Object.freeze([
    'none',
    'invalid_request',
    'invalid_object',
    'invalid_fields',
    'invalid_value',
    'payload_limit',
    'invalid_string',
    'invalid_array',
    'invalid_money',
    'invalid_currency',
    'invalid_date',
    'invalid_url',
    'invalid_email',
    'unauthenticated',
    'unauthorized',
    'configuration_unavailable',
    'commerce_unavailable',
    'rate_limited',
    'provider_unavailable',
    'state_conflict',
    'internal_error',
  ]),
  environment: Object.freeze(['local', 'test', 'staging', 'production']),
}));

const SAFE_LOG_FIELDS = Object.freeze(['code', 'environment', 'event', 'operation', 'outcome']);
const SAFE_LOG_VALUES = Object.assign(
  Object.create(null),
  Object.fromEntries(
    Object.entries(SAFE_LOG_VALUE_LISTS).map(([field, values]) => [field, new Set(values)]),
  ),
);

function rejectSafeLog() {
  throw new RequestValidationError(REQUEST_VALIDATION_REASONS.SAFE_LOG_INVALID);
}

/**
 * Build a flat, deterministic, low-cardinality diagnostic projection.
 * This function deliberately does not call a logger.
 */
function buildSafeLogProjection(value) {
  let parsed;
  try {
    parsed = parseStrictObject(value, { requiredKeys: SAFE_LOG_FIELDS });
  } catch (error) {
    if (!(error instanceof RequestValidationError)) throw error;
    rejectSafeLog();
  }

  for (const field of SAFE_LOG_FIELDS) {
    if (!SAFE_LOG_VALUES[field].has(parsed[field])) rejectSafeLog();
  }

  const projection = Object.create(null);
  for (const field of SAFE_LOG_FIELDS) {
    Object.defineProperty(projection, field, {
      value: parsed[field],
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return Object.freeze(projection);
}

module.exports = {
  SAFE_LOG_FIELDS,
  SAFE_LOG_VALUE_LISTS,
  buildSafeLogProjection,
};
