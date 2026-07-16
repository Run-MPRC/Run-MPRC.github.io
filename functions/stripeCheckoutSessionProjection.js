'use strict';

const SAFE_CREATE = Object.create;
const SAFE_DEFINE_PROPERTY = Object.defineProperty;
const SAFE_FREEZE = Object.freeze;
const SAFE_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const SAFE_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const SAFE_HAS_OWN = Object.hasOwn;
const SAFE_IS_PROXY = require('node:util').types.isProxy;
const SAFE_IS_SAFE_INTEGER = Number.isSafeInteger;
const SAFE_REGEX_TEST = Function.prototype.call.bind(RegExp.prototype.test);
const SAFE_SET_HAS = Function.prototype.call.bind(Set.prototype.has);
const SAFE_URL = require('node:url').URL;

const OBJECT_PROTOTYPE = Object.prototype;
const URL_PROTOTYPE = SAFE_URL.prototype;
const SAFE_URL_PROTOCOL_GETTER = SAFE_GET_OWN_PROPERTY_DESCRIPTOR(
  URL_PROTOTYPE,
  'protocol',
).get;
const SAFE_URL_USERNAME_GETTER = SAFE_GET_OWN_PROPERTY_DESCRIPTOR(
  URL_PROTOTYPE,
  'username',
).get;
const SAFE_URL_PASSWORD_GETTER = SAFE_GET_OWN_PROPERTY_DESCRIPTOR(
  URL_PROTOTYPE,
  'password',
).get;
const SAFE_URL_HOSTNAME_GETTER = SAFE_GET_OWN_PROPERTY_DESCRIPTOR(
  URL_PROTOTYPE,
  'hostname',
).get;
const SAFE_CALL = Function.prototype.call.bind(Function.prototype.call);

const checkoutSessionProjectionSchemaVersion = 1;
const ERROR_MESSAGE = 'Stripe Checkout Session observation is invalid.';
const ERROR_CODE = 'invalid_stripe_checkout_session_observation';
const MAX_BOUNDED_STRING_BYTES = 255;
const MAX_CHECKOUT_URL_BYTES = 8192;
const EXPECTED_API_VERSION = '2023-10-16';

const TEST_SESSION_ID_PATTERN = /^cs_test_[A-Za-z0-9]+$/u;
const LIVE_SESSION_ID_PATTERN = /^cs_live_[A-Za-z0-9]+$/u;
const REQUEST_ID_PATTERN = /^req_[A-Za-z0-9]+$/u;
const STRIPE_ACCOUNT_ID_PATTERN = /^acct_[A-Za-z0-9]{16,64}$/u;
const CURRENCY_PATTERN = /^[a-z]{3}$/u;
const PRINTABLE_ASCII_PATTERN = /^[\x20-\x7e]+$/u;
const VISIBLE_ASCII_PATTERN = /^[\x21-\x7e]+$/u;
const HTTPS_PREFIX_PATTERN = /^https:\/\//iu;
const URL_AUTHORITY_CREDENTIAL_MARKER_PATTERN = /^https:\/\/[^/?#]*@/iu;

const ALLOWED_MODES = new Set(['payment', 'setup', 'subscription']);
const ALLOWED_STATUSES = new Set(['open', 'complete', 'expired', null]);
const ALLOWED_PAYMENT_STATUSES = new Set([
  'paid',
  'unpaid',
  'no_payment_required',
]);

class StripeCheckoutSessionProjectionError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    SAFE_DEFINE_PROPERTY(this, 'name', {
      value: 'StripeCheckoutSessionProjectionError',
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

SAFE_FREEZE(StripeCheckoutSessionProjectionError.prototype);
SAFE_FREEZE(StripeCheckoutSessionProjectionError);

function fail() {
  throw new StripeCheckoutSessionProjectionError();
}

function safeIsProxy(value) {
  try {
    return SAFE_IS_PROXY(value);
  } catch {
    fail();
  }
}

function readDataDescriptor(record, key, expectedFlags) {
  let descriptor;
  try {
    descriptor = SAFE_GET_OWN_PROPERTY_DESCRIPTOR(record, key);
  } catch {
    fail();
  }

  if (!descriptor
    || !SAFE_HAS_OWN(descriptor, 'value')
    || !SAFE_HAS_OWN(descriptor, 'writable')
    || !SAFE_HAS_OWN(descriptor, 'enumerable')
    || !SAFE_HAS_OWN(descriptor, 'configurable')
    || SAFE_HAS_OWN(descriptor, 'get')
    || SAFE_HAS_OWN(descriptor, 'set')
    || descriptor.writable !== expectedFlags.writable
    || descriptor.enumerable !== expectedFlags.enumerable
    || descriptor.configurable !== expectedFlags.configurable) {
    fail();
  }

  return descriptor.value;
}

const JSON_FIELD_FLAGS = SAFE_FREEZE({
  enumerable: true,
  writable: true,
  configurable: true,
});
const LAST_RESPONSE_FLAGS = SAFE_FREEZE({
  enumerable: false,
  writable: false,
  configurable: false,
});

function isBoundedString(value, pattern) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_BOUNDED_STRING_BYTES
    && SAFE_REGEX_TEST(pattern, value);
}

function isValidSessionId(value, livemode) {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_BOUNDED_STRING_BYTES) {
    return false;
  }
  return SAFE_REGEX_TEST(
    livemode ? LIVE_SESSION_ID_PATTERN : TEST_SESSION_ID_PATTERN,
    value,
  );
}

function isSafeEpoch(value) {
  return SAFE_IS_SAFE_INTEGER(value) && value >= 0;
}

function classifyCheckoutUrl(value) {
  if (value === null) return 'absent';
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_CHECKOUT_URL_BYTES
    || !SAFE_REGEX_TEST(PRINTABLE_ASCII_PATTERN, value)
    || !SAFE_REGEX_TEST(HTTPS_PREFIX_PATTERN, value)
    || SAFE_REGEX_TEST(URL_AUTHORITY_CREDENTIAL_MARKER_PATTERN, value)) {
    fail();
  }

  let parsed;
  try {
    parsed = new SAFE_URL(value);
  } catch {
    fail();
  }

  let protocol;
  let username;
  let password;
  let hostname;
  try {
    protocol = SAFE_CALL(SAFE_URL_PROTOCOL_GETTER, parsed);
    username = SAFE_CALL(SAFE_URL_USERNAME_GETTER, parsed);
    password = SAFE_CALL(SAFE_URL_PASSWORD_GETTER, parsed);
    hostname = SAFE_CALL(SAFE_URL_HOSTNAME_GETTER, parsed);
  } catch {
    fail();
  }

  if (protocol !== 'https:'
    || username !== ''
    || password !== ''
    || hostname === '') {
    fail();
  }
  return 'bounded_https_capability_present';
}

function classifyResponseStatus(statusCode) {
  if (!SAFE_IS_SAFE_INTEGER(statusCode) || statusCode < 100 || statusCode > 599) {
    fail();
  }
  if (statusCode === 200) return 'expected_200';
  if (statusCode >= 200 && statusCode <= 299) return 'other_2xx';
  return 'non_2xx';
}

function classifyRequestId(value) {
  if (value === undefined) return 'missing';
  if (!isBoundedString(value, REQUEST_ID_PATTERN)) fail();
  return 'bounded_present';
}

function classifyApiVersion(value) {
  if (value === undefined) return 'missing';
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_BOUNDED_STRING_BYTES
    || !SAFE_REGEX_TEST(VISIBLE_ASCII_PATTERN, value)) {
    fail();
  }
  return value === EXPECTED_API_VERSION
    ? 'expected_2023_10_16'
    : 'other_bounded';
}

function classifyIdempotencyKey(value) {
  if (value === undefined) return 'missing';
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_BOUNDED_STRING_BYTES
    || !SAFE_REGEX_TEST(VISIBLE_ASCII_PATTERN, value)) {
    fail();
  }
  return 'bounded_present';
}

function classifyStripeAccount(value) {
  if (value === undefined) return 'missing';
  if (!isBoundedString(value, STRIPE_ACCOUNT_ID_PATTERN)) fail();
  return 'bounded_present';
}

function projectStripeCheckoutSessionObservation(sessionLike) {
  if (safeIsProxy(sessionLike)
    || sessionLike === null
    || typeof sessionLike !== 'object') {
    fail();
  }

  let rootPrototype;
  try {
    rootPrototype = SAFE_GET_PROTOTYPE_OF(sessionLike);
  } catch {
    fail();
  }
  if (rootPrototype !== OBJECT_PROTOTYPE) fail();

  const id = readDataDescriptor(sessionLike, 'id', JSON_FIELD_FLAGS);
  const object = readDataDescriptor(sessionLike, 'object', JSON_FIELD_FLAGS);
  const livemode = readDataDescriptor(sessionLike, 'livemode', JSON_FIELD_FLAGS);
  const mode = readDataDescriptor(sessionLike, 'mode', JSON_FIELD_FLAGS);
  const status = readDataDescriptor(sessionLike, 'status', JSON_FIELD_FLAGS);
  const paymentStatus = readDataDescriptor(
    sessionLike,
    'payment_status',
    JSON_FIELD_FLAGS,
  );
  const amountTotalCents = readDataDescriptor(
    sessionLike,
    'amount_total',
    JSON_FIELD_FLAGS,
  );
  const currency = readDataDescriptor(sessionLike, 'currency', JSON_FIELD_FLAGS);
  const createdEpochSeconds = readDataDescriptor(
    sessionLike,
    'created',
    JSON_FIELD_FLAGS,
  );
  const expiresAtEpochSeconds = readDataDescriptor(
    sessionLike,
    'expires_at',
    JSON_FIELD_FLAGS,
  );
  const checkoutUrl = readDataDescriptor(sessionLike, 'url', JSON_FIELD_FLAGS);
  const lastResponse = readDataDescriptor(
    sessionLike,
    'lastResponse',
    LAST_RESPONSE_FLAGS,
  );

  if (object !== 'checkout.session'
    || typeof livemode !== 'boolean'
    || !isValidSessionId(id, livemode)
    || !SAFE_SET_HAS(ALLOWED_MODES, mode)
    || !SAFE_SET_HAS(ALLOWED_STATUSES, status)
    || !SAFE_SET_HAS(ALLOWED_PAYMENT_STATUSES, paymentStatus)
    || !isSafeEpoch(createdEpochSeconds)
    || !isSafeEpoch(expiresAtEpochSeconds)
    || expiresAtEpochSeconds <= createdEpochSeconds) {
    fail();
  }

  if (amountTotalCents === null || currency === null) {
    if (amountTotalCents !== null || currency !== null) fail();
  } else if (!SAFE_IS_SAFE_INTEGER(amountTotalCents)
    || amountTotalCents < 0
    || typeof currency !== 'string'
    || !SAFE_REGEX_TEST(CURRENCY_PATTERN, currency)) {
    fail();
  }

  const checkoutUrlObservation = classifyCheckoutUrl(checkoutUrl);

  if (safeIsProxy(lastResponse)
    || lastResponse === null
    || typeof lastResponse !== 'object') {
    fail();
  }

  const responseStatusCode = readDataDescriptor(
    lastResponse,
    'statusCode',
    JSON_FIELD_FLAGS,
  );
  const responseRequestId = readDataDescriptor(
    lastResponse,
    'requestId',
    JSON_FIELD_FLAGS,
  );
  const responseApiVersion = readDataDescriptor(
    lastResponse,
    'apiVersion',
    JSON_FIELD_FLAGS,
  );
  const responseIdempotencyKey = readDataDescriptor(
    lastResponse,
    'idempotencyKey',
    JSON_FIELD_FLAGS,
  );
  const responseStripeAccount = readDataDescriptor(
    lastResponse,
    'stripeAccount',
    JSON_FIELD_FLAGS,
  );

  const responseStatusObservation = classifyResponseStatus(responseStatusCode);
  const responseRequestIdObservation = classifyRequestId(responseRequestId);
  const responseApiVersionObservation = classifyApiVersion(responseApiVersion);
  const responseIdempotencyKeyObservation = classifyIdempotencyKey(
    responseIdempotencyKey,
  );
  const responseStripeAccountObservation = classifyStripeAccount(
    responseStripeAccount,
  );

  const projection = SAFE_CREATE(null);
  projection.checkoutSessionProjectionSchemaVersion = (
    checkoutSessionProjectionSchemaVersion
  );
  projection.classification = 'untrusted_checkout_session_projection';
  projection.state = 'requires_runtime_binding_persistence_and_business_validation';
  projection.provider = 'stripe';
  projection.providerOperation = 'checkout_session_create';
  projection.sessionId = id;
  projection.object = 'checkout.session';
  projection.livemode = livemode;
  projection.mode = mode;
  projection.status = status;
  projection.paymentStatus = paymentStatus;
  projection.amountTotalCents = amountTotalCents;
  projection.currency = currency;
  projection.createdEpochSeconds = createdEpochSeconds;
  projection.expiresAtEpochSeconds = expiresAtEpochSeconds;
  projection.checkoutUrlObservation = checkoutUrlObservation;
  projection.responseStatusObservation = responseStatusObservation;
  projection.responseRequestIdObservation = responseRequestIdObservation;
  projection.responseApiVersionObservation = responseApiVersionObservation;
  projection.responseIdempotencyKeyObservation = responseIdempotencyKeyObservation;
  projection.responseStripeAccountObservation = responseStripeAccountObservation;
  return SAFE_FREEZE(projection);
}

module.exports = SAFE_FREEZE({
  checkoutSessionProjectionSchemaVersion,
  StripeCheckoutSessionProjectionError,
  projectStripeCheckoutSessionObservation,
});
