const { types: { isProxy } } = require('node:util');

const STRIPE_MINIMUM_USD_CENTS = 50;
const STRIPE_UNIT_AMOUNT_MAX_CENTS = 99_999_999;
const INVALID_PRICE_VALUE = Symbol('invalid-merchandise-price-value');

const numberIsSafeInteger = Number.isSafeInteger;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwn = Object.hasOwn;
const objectIs = Object.is;
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

function ownEnumerableDataValue(record, key) {
  let descriptor;
  try {
    descriptor = objectGetOwnPropertyDescriptor(record, key);
  } catch (_error) {
    return INVALID_PRICE_VALUE;
  }
  if (!descriptor
    || !objectHasOwn(descriptor, 'value')
    || descriptor.enumerable !== true) {
    return INVALID_PRICE_VALUE;
  }
  return descriptor.value;
}

function projectMerchandisePriceCents(product) {
  if (!isPlainRecord(product)) return null;

  const priceCents = ownEnumerableDataValue(product, 'priceCents');
  if (
    typeof priceCents !== 'number'
    || !numberIsSafeInteger(priceCents)
    || objectIs(priceCents, -0)
    || priceCents < STRIPE_MINIMUM_USD_CENTS
    || priceCents > STRIPE_UNIT_AMOUNT_MAX_CENTS
  ) {
    return null;
  }

  return priceCents;
}

module.exports = {
  STRIPE_MINIMUM_USD_CENTS,
  STRIPE_UNIT_AMOUNT_MAX_CENTS,
  projectMerchandisePriceCents,
};
