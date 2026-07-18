'use strict';

const { types: { isProxy } } = require('node:util');

const MAX_STRIPE_PRODUCT_ID_LENGTH = 255;
const MISSING_FIELD = Symbol('missing-stripe-product-binding-field');
const INVALID_FIELD = Symbol('invalid-stripe-product-binding-field');

const numberIsSafeInteger = Number.isSafeInteger;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwn = Object.hasOwn;
const objectPrototype = Object.prototype;

function isProxyValue(value) {
  try {
    return isProxy(value);
  } catch (_error) {
    return true;
  }
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || isProxyValue(value)) {
    return false;
  }
  try {
    return objectGetPrototypeOf(value) === objectPrototype;
  } catch (_error) {
    return false;
  }
}

function readOwnDataDescriptor(record, key, expectedEnumerable) {
  let descriptor;
  try {
    descriptor = objectGetOwnPropertyDescriptor(record, key);
  } catch (_error) {
    return INVALID_FIELD;
  }
  if (descriptor === undefined) return MISSING_FIELD;
  if (!objectHasOwn(descriptor, 'value')
    || objectHasOwn(descriptor, 'get')
    || objectHasOwn(descriptor, 'set')
    || descriptor.enumerable !== expectedEnumerable) {
    return INVALID_FIELD;
  }
  return descriptor;
}

function isBoundedProductId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_STRIPE_PRODUCT_ID_LENGTH;
}

/**
 * Project one stored Product binding without inferring a Stripe ID prefix.
 *
 * @returns {string|undefined|null} string=bound, undefined=cleanly missing,
 * null=present but invalid or unsafe record.
 */
function projectStoredStripeProductId(resource) {
  if (!isPlainRecord(resource)) return null;
  const descriptor = readOwnDataDescriptor(resource, 'stripeProductId', true);
  if (descriptor === MISSING_FIELD) {
    // An own miss is clean only when the shared prototype is also clean.
    let inheritedDescriptor;
    try {
      inheritedDescriptor = objectGetOwnPropertyDescriptor(
        objectPrototype,
        'stripeProductId',
      );
    } catch (_error) {
      return null;
    }
    return inheritedDescriptor === undefined ? undefined : null;
  }
  if (descriptor === INVALID_FIELD || !isBoundedProductId(descriptor.value)) {
    return null;
  }
  return descriptor.value;
}

function readInstalledSdkStatusCode(product) {
  const lastResponseDescriptor = readOwnDataDescriptor(
    product,
    'lastResponse',
    false,
  );
  if (lastResponseDescriptor === MISSING_FIELD
    || lastResponseDescriptor === INVALID_FIELD
    || lastResponseDescriptor.configurable !== false
    || lastResponseDescriptor.writable !== false) {
    return null;
  }

  const response = lastResponseDescriptor.value;
  if (response === null || typeof response !== 'object' || isProxyValue(response)) {
    return null;
  }
  const statusDescriptor = readOwnDataDescriptor(response, 'statusCode', true);
  if (statusDescriptor === MISSING_FIELD
    || statusDescriptor === INVALID_FIELD
    || statusDescriptor.configurable !== true
    || statusDescriptor.writable !== true
    || !numberIsSafeInteger(statusDescriptor.value)
    || statusDescriptor.value < 200
    || statusDescriptor.value > 299) {
    return null;
  }
  return statusDescriptor.value;
}

/**
 * Project only the minimal Product-create result needed by current callers.
 *
 * This validates source structure and response-declared mode. It does not prove
 * provider origin, account ownership, catalog identity, or metadata binding.
 */
function projectCreatedStripeProductId(product, expectedLivemode) {
  if (!isPlainRecord(product) || typeof expectedLivemode !== 'boolean') {
    return null;
  }

  const idDescriptor = readOwnDataDescriptor(product, 'id', true);
  const objectDescriptor = readOwnDataDescriptor(product, 'object', true);
  const livemodeDescriptor = readOwnDataDescriptor(product, 'livemode', true);
  if (idDescriptor === MISSING_FIELD
    || idDescriptor === INVALID_FIELD
    || objectDescriptor === MISSING_FIELD
    || objectDescriptor === INVALID_FIELD
    || livemodeDescriptor === MISSING_FIELD
    || livemodeDescriptor === INVALID_FIELD
    || !isBoundedProductId(idDescriptor.value)
    || objectDescriptor.value !== 'product'
    || livemodeDescriptor.value !== expectedLivemode
    || readInstalledSdkStatusCode(product) === null) {
    return null;
  }

  return idDescriptor.value;
}

module.exports = {
  MAX_STRIPE_PRODUCT_ID_LENGTH,
  projectCreatedStripeProductId,
  projectStoredStripeProductId,
};
