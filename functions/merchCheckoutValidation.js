const { types: { isProxy } } = require('node:util');

const {
  parseBoundedString,
  parseEmail,
  parseStrictObject,
  RequestValidationError,
} = require('./requestValidation');

const STRIPE_MINIMUM_USD_CENTS = 50;
const STRIPE_UNIT_AMOUNT_MAX_CENTS = 99_999_999;
const MAX_MERCH_OPTIONS = 50;
// A single merchandise checkout may buy one line item in a bounded quantity.
// The ceiling keeps the projected total a safe integer (max unit price times
// MAX_MERCH_QUANTITY stays far below Number.MAX_SAFE_INTEGER) and blocks a
// buyer from driving an implausibly large charge through a valid unit price.
const MAX_MERCH_QUANTITY = 25;
const MERCH_PRICE_SNAPSHOT_SCHEMA_VERSION = '1';
const MERCH_CHECKOUT_VALIDATION_MESSAGE = 'Merchandise checkout request is invalid';
const MERCH_CATALOG_MESSAGE = 'Merchandise catalog entry is invalid';
// Shared "not an own enumerable data value" marker for the accessor/hole/missing
// guards below. Kept module-private so a hostile getter can never forge it.
const NON_DATA_VALUE = Symbol('non-data-value');
const UNSAFE_UNICODE_SEPARATORS_OR_FORMATS = /[\p{Cf}\p{Zl}\p{Zp}]/u;

const arrayPrototype = Array.prototype;
const numberIsSafeInteger = Number.isSafeInteger;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwn = Object.hasOwn;
const objectIs = Object.is;
const objectPrototype = Object.prototype;
const reflectOwnKeys = Reflect.ownKeys;

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
    return NON_DATA_VALUE;
  }
  if (!descriptor
    || !objectHasOwn(descriptor, 'value')
    || descriptor.enumerable !== true) {
    return NON_DATA_VALUE;
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

// Project the immutable price snapshot persisted with an order (PAY-001C1C).
// The server owns every number: the unit price comes only from the stored
// product through projectMerchandisePriceCents, the quantity is re-validated
// here rather than trusted from the caller, and the total is recomputed under
// a safe-integer and Stripe-minimum guard. Any fault collapses to null so the
// caller treats the item as unavailable instead of charging a guessed amount.
// The returned record is frozen: an order persists exactly what was charged.
function projectMerchandisePriceSnapshot(product, quantity) {
  const unitAmountCents = projectMerchandisePriceCents(product);
  if (unitAmountCents === null) return null;

  if (
    typeof quantity !== 'number'
    || !numberIsSafeInteger(quantity)
    || objectIs(quantity, -0)
    || quantity < 1
    || quantity > MAX_MERCH_QUANTITY
  ) {
    return null;
  }

  const totalAmountCents = unitAmountCents * quantity;
  if (
    !numberIsSafeInteger(totalAmountCents)
    || totalAmountCents < STRIPE_MINIMUM_USD_CENTS
  ) {
    return null;
  }

  return Object.freeze({
    schemaVersion: MERCH_PRICE_SNAPSHOT_SCHEMA_VERSION,
    currency: 'usd',
    unitAmountCents,
    quantity,
    totalAmountCents,
  });
}

// --- Request-shape validation (PAY-001C1B) -------------------------------
// The buyer-supplied merchandise checkout payload is untrusted. Mirror the race
// checkout parser: bound and freeze every field before any Firestore or Stripe
// work, and collapse any parse failure to one fixed, message-stable error so
// nothing about the offending value can leak to the caller.

class MerchCheckoutValidationError extends Error {
  constructor() {
    super(MERCH_CHECKOUT_VALIDATION_MESSAGE);
    Object.defineProperty(this, 'message', {
      value: MERCH_CHECKOUT_VALIDATION_MESSAGE,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'name', {
      value: 'MerchCheckoutValidationError',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Error.captureStackTrace?.(this, MerchCheckoutValidationError);
    Object.freeze(this);
  }
}

class MerchCatalogError extends Error {
  constructor() {
    super(MERCH_CATALOG_MESSAGE);
    Object.defineProperty(this, 'message', {
      value: MERCH_CATALOG_MESSAGE,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'name', {
      value: 'MerchCatalogError',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Error.captureStackTrace?.(this, MerchCatalogError);
    Object.freeze(this);
  }
}

function rejectRequest() {
  throw new MerchCheckoutValidationError();
}

function withRequestFailure(callback) {
  try {
    return callback();
  } catch (error) {
    if (error instanceof MerchCheckoutValidationError) throw error;
    rejectRequest();
  }
}

function hasOwn(value, key) {
  return objectPrototype.hasOwnProperty.call(value, key);
}

function defineOwnDataProperty(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function hasUnsafeControl(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || (code >= 127 && code <= 159)) return true;
  }
  return UNSAFE_UNICODE_SEPARATORS_OR_FORMATS.test(value);
}

function parseText(value, { maxCodePoints, maxBytes, trim = true, allowEmpty = false }) {
  const parsed = parseBoundedString(value, {
    maxCodePoints,
    maxBytes,
    normalize: 'NFC',
    trim,
  });
  if ((!allowEmpty && parsed.length === 0) || hasUnsafeControl(parsed)) rejectRequest();
  return parsed;
}

function parseProductSlug(value) {
  const parsed = parseBoundedString(value, {
    maxCodePoints: 128,
    maxBytes: 512,
    normalize: false,
    trim: false,
  });
  if (parsed !== parsed.trim()
    || parsed.length === 0
    || hasUnsafeControl(parsed)
    || parsed === '.'
    || parsed === '..'
    || parsed.includes('/')) {
    rejectRequest();
  }
  return parsed;
}

function parseOptionalPhone(value, present) {
  if (!present || value === null) return null;
  if (typeof value !== 'string') rejectRequest();
  const parsed = parseText(value, { maxCodePoints: 32, maxBytes: 128, allowEmpty: true });
  return parsed === '' ? null : parsed;
}

function parseSelection(value) {
  return parseText(value, { maxCodePoints: 100, maxBytes: 400 });
}

// An absent quantity means one (the pre-PAY-001C1C contract). When present it
// must already be a finite number (parseStrictObject rejects NaN/Infinity/-0),
// so tighten it to a positive safe integer within the per-order ceiling. A
// float, sign, or out-of-range value is a request fault, not a silent clamp.
function parseQuantity(value, present) {
  if (!present) return 1;
  if (
    typeof value !== 'number'
    || !numberIsSafeInteger(value)
    || objectIs(value, -0)
    || value < 1
    || value > MAX_MERCH_QUANTITY
  ) {
    rejectRequest();
  }
  return value;
}

function parseBuyer(value) {
  const buyer = parseStrictObject(value, {
    requiredKeys: ['firstName', 'lastName', 'email'],
    optionalKeys: ['phone'],
    limits: {
      maxDepth: 1,
      maxEntries: 8,
      maxArrayLength: 1,
      maxKeyCodePoints: 64,
      maxKeyBytes: 256,
      maxStringCodePoints: 254,
      maxStringBytes: 1016,
      maxSerializedBytes: 4096,
    },
  });
  return Object.freeze({
    firstName: parseText(buyer.firstName, { maxCodePoints: 100, maxBytes: 400 }),
    lastName: parseText(buyer.lastName, { maxCodePoints: 100, maxBytes: 400 }),
    email: parseEmail(buyer.email),
    phone: parseOptionalPhone(buyer.phone, hasOwn(buyer, 'phone')),
  });
}

function parseMerchCheckoutRequest(data) {
  return withRequestFailure(() => {
    const request = parseStrictObject(data, {
      requiredKeys: ['productSlug', 'buyer'],
      optionalKeys: ['size', 'color', 'quantity'],
      limits: {
        maxDepth: 2,
        maxEntries: 12,
        maxArrayLength: 1,
        maxKeyCodePoints: 64,
        maxKeyBytes: 256,
        maxStringCodePoints: 254,
        maxStringBytes: 1016,
        maxSerializedBytes: 4096,
      },
    });
    const result = {
      productSlug: parseProductSlug(request.productSlug),
      buyer: parseBuyer(request.buyer),
      quantity: parseQuantity(request.quantity, hasOwn(request, 'quantity')),
    };
    if (hasOwn(request, 'size')) {
      defineOwnDataProperty(result, 'size', parseSelection(request.size));
    }
    if (hasOwn(request, 'color')) {
      defineOwnDataProperty(result, 'color', parseSelection(request.color));
    }
    return Object.freeze(result);
  });
}

// --- Stored option matching (PAY-001C1B) ---------------------------------
// The product document is server-owned but still read defensively: an option
// list may only be a dense array of clean strings. A malformed catalog entry is
// an availability fault (MerchCatalogError -> failed-precondition), while a
// selection that does not match a well-formed catalog is a request fault
// (MerchCheckoutValidationError -> invalid-argument).

function normalizeStoredOption(value) {
  let parsed;
  try {
    parsed = parseBoundedString(value, {
      maxCodePoints: 100,
      maxBytes: 400,
      normalize: 'NFC',
      trim: true,
    });
  } catch (error) {
    if (!(error instanceof RequestValidationError)) throw error;
    throw new MerchCatalogError();
  }
  if (parsed.length === 0 || hasUnsafeControl(parsed)) throw new MerchCatalogError();
  return parsed;
}

function readStoredOptionArray(value) {
  if (value === null
    || typeof value !== 'object'
    || isProxyValue(value)
    || !Array.isArray(value)) {
    throw new MerchCatalogError();
  }
  let prototype;
  let keys;
  let lengthDescriptor;
  try {
    prototype = objectGetPrototypeOf(value);
    keys = reflectOwnKeys(value);
    lengthDescriptor = objectGetOwnPropertyDescriptor(value, 'length');
  } catch (_error) {
    throw new MerchCatalogError();
  }
  if (prototype !== arrayPrototype
    || !lengthDescriptor
    || !objectHasOwn(lengthDescriptor, 'value')
    || !numberIsSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
    || lengthDescriptor.value > MAX_MERCH_OPTIONS) {
    throw new MerchCatalogError();
  }

  const length = lengthDescriptor.value;
  const values = new Map();
  for (const key of keys) {
    if (key === 'length') continue;
    if (typeof key !== 'string') throw new MerchCatalogError();
    const index = Number(key);
    if (!numberIsSafeInteger(index)
      || index < 0
      || index >= length
      || String(index) !== key) {
      throw new MerchCatalogError();
    }
    const item = ownEnumerableDataValue(value, key);
    if (item === NON_DATA_VALUE) throw new MerchCatalogError();
    values.set(index, item);
  }
  if (values.size !== length) throw new MerchCatalogError();
  for (const key in value) {
    if (!hasOwn(value, key)) throw new MerchCatalogError();
  }
  return Array.from({ length }, (_unused, index) => values.get(index));
}

function readStoredOptionAllowlist(product, catalogKey) {
  if (!objectHasOwn(product, catalogKey)) return null;
  const raw = ownEnumerableDataValue(product, catalogKey);
  if (raw === NON_DATA_VALUE) throw new MerchCatalogError();
  if (raw === undefined || raw === null) return null;

  const values = readStoredOptionArray(raw);
  if (values.length === 0) return null;

  const allowlist = new Set();
  for (const item of values) {
    const normalized = normalizeStoredOption(item);
    if (allowlist.has(normalized)) throw new MerchCatalogError();
    allowlist.add(normalized);
  }
  return allowlist;
}

function matchDimension(product, catalogKey, request, selectionKey) {
  const allowlist = readStoredOptionAllowlist(product, catalogKey);
  const supplied = hasOwn(request, selectionKey);

  if (allowlist === null) {
    // The product has no such option dimension; a selection is not permitted.
    if (supplied) rejectRequest();
    return null;
  }
  // The dimension exists and is non-empty; a matching selection is required.
  if (!supplied) rejectRequest();
  const selection = request[selectionKey];
  if (!allowlist.has(selection)) rejectRequest();
  return selection;
}

function matchMerchandiseOptions(product, request) {
  if (!isPlainRecord(product)) throw new MerchCatalogError();
  const size = matchDimension(product, 'sizes', request, 'size');
  const color = matchDimension(product, 'colors', request, 'color');
  return Object.freeze({ size, color });
}

module.exports = {
  MAX_MERCH_QUANTITY,
  MerchCatalogError,
  MerchCheckoutValidationError,
  STRIPE_MINIMUM_USD_CENTS,
  STRIPE_UNIT_AMOUNT_MAX_CENTS,
  matchMerchandiseOptions,
  parseMerchCheckoutRequest,
  projectMerchandisePriceCents,
  projectMerchandisePriceSnapshot,
};
