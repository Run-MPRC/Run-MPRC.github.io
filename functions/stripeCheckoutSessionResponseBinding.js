'use strict';

const SAFE_CREATE = Object.create;
const SAFE_DEFINE_PROPERTY = Object.defineProperty;
const SAFE_FREEZE = Object.freeze;
const SAFE_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const SAFE_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const SAFE_HAS_OWN = Object.hasOwn;
const SAFE_IS_FROZEN = Object.isFrozen;
const SAFE_IS_PROXY = require('node:util').types.isProxy;
const SAFE_IS_SAFE_INTEGER = Number.isSafeInteger;
const SAFE_OWN_KEYS = Reflect.ownKeys;
const SAFE_REGEX_EXEC = Function.prototype.call.bind(RegExp.prototype.exec);

const checkoutSessionResponseBindingSchemaVersion = 1;
const CHECKOUT_SESSION_PROJECTION_SCHEMA_VERSION = 1;
const EXPECTED_API_VERSION = '2023-10-16';
const MAX_BOUNDED_STRING_LENGTH = 255;
const ERROR_MESSAGE = 'Stripe Checkout Session response binding is invalid.';
const ERROR_CODE = 'invalid_stripe_checkout_session_response_binding';

const VISIBLE_ASCII_PATTERN = /^[\x21-\x7e]+$/u;
const TEST_SESSION_ID_PATTERN = /^cs_test_[A-Za-z0-9]+$/u;
const LIVE_SESSION_ID_PATTERN = /^cs_live_[A-Za-z0-9]+$/u;
const STRIPE_ACCOUNT_ID_PATTERN = /^acct_[A-Za-z0-9]{16,64}$/u;
const CURRENCY_PATTERN = /^[a-z]{3}$/u;

const CAPSULE_KEYS = SAFE_FREEZE([
  'checkoutSessionResponseBindingSchemaVersion',
  'checkoutSessionProjection',
  'observedResponseApiVersion',
  'observedResponseIdempotencyKey',
  'observedResponseStripeAccount',
  'expectedResponseApiVersion',
  'expectedResponseIdempotencyKey',
  'expectedResponseStripeAccount',
]);

const PROJECTION_KEYS = SAFE_FREEZE([
  'checkoutSessionProjectionSchemaVersion',
  'classification',
  'state',
  'provider',
  'providerOperation',
  'sessionId',
  'object',
  'livemode',
  'mode',
  'status',
  'paymentStatus',
  'amountTotalCents',
  'currency',
  'createdEpochSeconds',
  'expiresAtEpochSeconds',
  'checkoutUrlObservation',
  'responseStatusObservation',
  'responseRequestIdObservation',
  'responseApiVersionObservation',
  'responseIdempotencyKeyObservation',
  'responseStripeAccountObservation',
]);

class StripeCheckoutSessionResponseBindingError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    SAFE_DEFINE_PROPERTY(this, 'name', {
      value: 'StripeCheckoutSessionResponseBindingError',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    SAFE_DEFINE_PROPERTY(this, 'code', {
      value: ERROR_CODE,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    SAFE_DEFINE_PROPERTY(this, 'message', {
      value: ERROR_MESSAGE,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    SAFE_FREEZE(this);
  }
}

SAFE_FREEZE(StripeCheckoutSessionResponseBindingError.prototype);
SAFE_FREEZE(StripeCheckoutSessionResponseBindingError);

function fail() {
  throw new StripeCheckoutSessionResponseBindingError();
}

function safeIsProxy(value) {
  try {
    return SAFE_IS_PROXY(value);
  } catch {
    fail();
  }
}

function validateExactFrozenNullRecordShape(record, expectedKeys) {
  if (record === null || typeof record !== 'object' || safeIsProxy(record)) {
    fail();
  }

  let prototype;
  let frozen;
  let ownKeys;
  try {
    prototype = SAFE_GET_PROTOTYPE_OF(record);
    frozen = SAFE_IS_FROZEN(record);
    ownKeys = SAFE_OWN_KEYS(record);
  } catch {
    fail();
  }

  if (prototype !== null
    || frozen !== true
    || ownKeys.length !== expectedKeys.length) {
    fail();
  }

  for (let index = 0; index < expectedKeys.length; index += 1) {
    if (ownKeys[index] !== expectedKeys[index]) fail();
  }
}

function readFrozenDataValue(record, key) {
  let descriptor;
  try {
    descriptor = SAFE_GET_OWN_PROPERTY_DESCRIPTOR(record, key);
  } catch {
    fail();
  }
  if (!descriptor
    || descriptor.enumerable !== true
    || descriptor.writable !== false
    || descriptor.configurable !== false
    || !SAFE_HAS_OWN(descriptor, 'value')
    || SAFE_HAS_OWN(descriptor, 'get')
    || SAFE_HAS_OWN(descriptor, 'set')) {
    fail();
  }
  return descriptor.value;
}

function isOneOf(value, allowed) {
  for (let index = 0; index < allowed.length; index += 1) {
    if (value === allowed[index]) return true;
  }
  return false;
}

function isBoundedVisibleString(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_BOUNDED_STRING_LENGTH
    && SAFE_REGEX_EXEC(VISIBLE_ASCII_PATTERN, value) !== null;
}

function isBoundedSessionId(value, livemode) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_BOUNDED_STRING_LENGTH
    && SAFE_REGEX_EXEC(
      livemode ? LIVE_SESSION_ID_PATTERN : TEST_SESSION_ID_PATTERN,
      value,
    ) !== null;
}

function isBoundedStripeAccount(value) {
  return typeof value === 'string'
    && value.length <= MAX_BOUNDED_STRING_LENGTH
    && SAFE_REGEX_EXEC(STRIPE_ACCOUNT_ID_PATTERN, value) !== null;
}

function validateProjection(projection) {
  validateExactFrozenNullRecordShape(projection, PROJECTION_KEYS);
  const projectionSchemaVersion = readFrozenDataValue(
    projection,
    'checkoutSessionProjectionSchemaVersion',
  );
  const classification = readFrozenDataValue(projection, 'classification');
  const state = readFrozenDataValue(projection, 'state');
  const provider = readFrozenDataValue(projection, 'provider');
  const providerOperation = readFrozenDataValue(projection, 'providerOperation');
  const sessionId = readFrozenDataValue(projection, 'sessionId');
  const object = readFrozenDataValue(projection, 'object');
  const livemode = readFrozenDataValue(projection, 'livemode');
  const mode = readFrozenDataValue(projection, 'mode');
  const status = readFrozenDataValue(projection, 'status');
  const paymentStatus = readFrozenDataValue(projection, 'paymentStatus');
  const amountTotalCents = readFrozenDataValue(projection, 'amountTotalCents');
  const currency = readFrozenDataValue(projection, 'currency');
  const createdEpochSeconds = readFrozenDataValue(
    projection,
    'createdEpochSeconds',
  );
  const expiresAtEpochSeconds = readFrozenDataValue(
    projection,
    'expiresAtEpochSeconds',
  );
  const checkoutUrlObservation = readFrozenDataValue(
    projection,
    'checkoutUrlObservation',
  );
  const responseStatusObservation = readFrozenDataValue(
    projection,
    'responseStatusObservation',
  );
  const responseRequestIdObservation = readFrozenDataValue(
    projection,
    'responseRequestIdObservation',
  );
  const responseApiVersionObservation = readFrozenDataValue(
    projection,
    'responseApiVersionObservation',
  );
  const responseIdempotencyKeyObservation = readFrozenDataValue(
    projection,
    'responseIdempotencyKeyObservation',
  );
  const responseStripeAccountObservation = readFrozenDataValue(
    projection,
    'responseStripeAccountObservation',
  );

  if (projectionSchemaVersion
      !== CHECKOUT_SESSION_PROJECTION_SCHEMA_VERSION
    || classification !== 'untrusted_checkout_session_projection'
    || state
      !== 'requires_runtime_binding_persistence_and_business_validation'
    || provider !== 'stripe'
    || providerOperation !== 'checkout_session_create'
    || object !== 'checkout.session'
    || typeof livemode !== 'boolean'
    || !isBoundedSessionId(sessionId, livemode)
    || !isOneOf(mode, ['payment', 'setup', 'subscription'])
    || !isOneOf(status, ['open', 'complete', 'expired', null])
    || !isOneOf(paymentStatus, [
      'paid',
      'unpaid',
      'no_payment_required',
    ])
    || !SAFE_IS_SAFE_INTEGER(createdEpochSeconds)
    || createdEpochSeconds < 0
    || !SAFE_IS_SAFE_INTEGER(expiresAtEpochSeconds)
    || expiresAtEpochSeconds <= createdEpochSeconds
    || !isOneOf(checkoutUrlObservation, [
      'absent',
      'bounded_https_capability_present',
    ])
    || !isOneOf(responseStatusObservation, [
      'expected_200',
      'other_2xx',
      'non_2xx',
    ])
    || !isOneOf(responseRequestIdObservation, [
      'missing',
      'bounded_present',
    ])
    || !isOneOf(responseApiVersionObservation, [
      'missing',
      'expected_2023_10_16',
      'other_bounded',
    ])
    || !isOneOf(responseIdempotencyKeyObservation, [
      'missing',
      'bounded_present',
    ])
    || !isOneOf(responseStripeAccountObservation, [
      'missing',
      'bounded_present',
    ])) {
    fail();
  }

  const hasMoney = amountTotalCents !== null || currency !== null;
  if (hasMoney) {
    if (!SAFE_IS_SAFE_INTEGER(amountTotalCents)
      || amountTotalCents < 0
      || typeof currency !== 'string'
      || SAFE_REGEX_EXEC(CURRENCY_PATTERN, currency) === null) {
      fail();
    }
  } else if (amountTotalCents !== null || currency !== null) {
    fail();
  }

  const observations = SAFE_CREATE(null);
  observations.checkoutUrlObservation = checkoutUrlObservation;
  observations.responseStatusObservation = responseStatusObservation;
  observations.responseRequestIdObservation = responseRequestIdObservation;
  observations.responseApiVersionObservation = responseApiVersionObservation;
  observations.responseIdempotencyKeyObservation = (
    responseIdempotencyKeyObservation
  );
  observations.responseStripeAccountObservation = (
    responseStripeAccountObservation
  );
  return observations;
}

function validateOptionalVisibleString(value) {
  if (value !== undefined && !isBoundedVisibleString(value)) fail();
  return value;
}

function validateOptionalStripeAccount(value) {
  if (value !== undefined && !isBoundedStripeAccount(value)) fail();
  return value;
}

function apiVersionObservation(value) {
  if (value === undefined) return 'missing';
  return value === EXPECTED_API_VERSION
    ? 'expected_2023_10_16'
    : 'other_bounded';
}

function boundedPresenceObservation(value) {
  return value === undefined ? 'missing' : 'bounded_present';
}

function makeResult(classification, state) {
  const result = SAFE_CREATE(null);
  result.checkoutSessionResponseBindingSchemaVersion = (
    checkoutSessionResponseBindingSchemaVersion
  );
  result.classification = classification;
  result.state = state;
  return SAFE_FREEZE(result);
}

/**
 * Classifies one already-captured, synchronous, in-memory observation capsule.
 * The caller must capture the projection and raw transport primitives in the
 * same call stack. This function never reads a Session, awaits, or retains an
 * input reference.
 */
function classifyStripeCheckoutSessionResponseBinding(capsule) {
  validateExactFrozenNullRecordShape(capsule, CAPSULE_KEYS);
  const bindingSchemaVersion = readFrozenDataValue(
    capsule,
    'checkoutSessionResponseBindingSchemaVersion',
  );
  const projectionInput = readFrozenDataValue(
    capsule,
    'checkoutSessionProjection',
  );
  const observedApiVersionInput = readFrozenDataValue(
    capsule,
    'observedResponseApiVersion',
  );
  const observedIdempotencyKeyInput = readFrozenDataValue(
    capsule,
    'observedResponseIdempotencyKey',
  );
  const observedStripeAccountInput = readFrozenDataValue(
    capsule,
    'observedResponseStripeAccount',
  );
  const expectedApiVersionInput = readFrozenDataValue(
    capsule,
    'expectedResponseApiVersion',
  );
  const expectedIdempotencyKeyInput = readFrozenDataValue(
    capsule,
    'expectedResponseIdempotencyKey',
  );
  const expectedStripeAccountInput = readFrozenDataValue(
    capsule,
    'expectedResponseStripeAccount',
  );

  if (bindingSchemaVersion
      !== checkoutSessionResponseBindingSchemaVersion) {
    fail();
  }

  const projection = validateProjection(projectionInput);
  const observedApiVersion = validateOptionalVisibleString(
    observedApiVersionInput,
  );
  const observedIdempotencyKey = validateOptionalVisibleString(
    observedIdempotencyKeyInput,
  );
  const observedStripeAccount = validateOptionalStripeAccount(
    observedStripeAccountInput,
  );
  const expectedApiVersion = validateOptionalVisibleString(
    expectedApiVersionInput,
  );
  const expectedIdempotencyKey = validateOptionalVisibleString(
    expectedIdempotencyKeyInput,
  );
  const expectedStripeAccount = validateOptionalStripeAccount(
    expectedStripeAccountInput,
  );

  const projectionMatchesObservedTransport = (
    projection.responseApiVersionObservation
      === apiVersionObservation(observedApiVersion)
    && projection.responseIdempotencyKeyObservation
      === boundedPresenceObservation(observedIdempotencyKey)
    && projection.responseStripeAccountObservation
      === boundedPresenceObservation(observedStripeAccount)
  );
  const exactExpectedTransport = (
    observedApiVersion === EXPECTED_API_VERSION
    && expectedApiVersion === EXPECTED_API_VERSION
    && observedApiVersion === expectedApiVersion
    && observedIdempotencyKey !== undefined
    && observedIdempotencyKey === expectedIdempotencyKey
    && observedStripeAccount === expectedStripeAccount
  );
  const candidateShape = (
    projection.checkoutUrlObservation === 'bounded_https_capability_present'
    && projection.responseStatusObservation === 'expected_200'
    && projection.responseRequestIdObservation === 'bounded_present'
    && projectionMatchesObservedTransport
    && exactExpectedTransport
  );

  if (!candidateShape) {
    return makeResult(
      'reconciliation_required',
      'requires_redacted_transport_reconciliation',
    );
  }
  return makeResult(
    'untrusted_transport_binding_candidate',
    'requires_runtime_origin_account_dispatch_business_time_url_and_persistence_binding',
  );
}

module.exports = SAFE_FREEZE({
  checkoutSessionResponseBindingSchemaVersion,
  StripeCheckoutSessionResponseBindingError,
  classifyStripeCheckoutSessionResponseBinding,
});
