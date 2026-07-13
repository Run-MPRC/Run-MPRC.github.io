const { isIP } = require('node:net');
const { types: { isProxy } } = require('node:util');

const REQUEST_VALIDATION_MESSAGE = 'Request data is invalid';
const REQUEST_VALIDATION_REASONS = Object.freeze({
  INVALID_OBJECT: 'invalid_object',
  INVALID_FIELDS: 'invalid_fields',
  INVALID_VALUE: 'invalid_value',
  PAYLOAD_LIMIT: 'payload_limit',
  INVALID_STRING: 'invalid_string',
  INVALID_ARRAY: 'invalid_array',
  INVALID_MONEY: 'invalid_money',
  INVALID_CURRENCY: 'invalid_currency',
  INVALID_DATE: 'invalid_date',
  INVALID_URL: 'invalid_url',
  INVALID_EMAIL: 'invalid_email',
  SAFE_LOG_INVALID: 'safe_log_invalid',
});

const VALIDATION_REASON_SET = new Set(Object.values(REQUEST_VALIDATION_REASONS));
const SAFE_VALIDATION_ERRORS = new WeakSet();
const SAFE_CLONES = new WeakSet();
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const STRICT_FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

// These are technical denial-of-service ceilings, not endpoint or product policy.
// Endpoint schemas may lower them, but may not raise them.
const DEFAULT_REQUEST_LIMITS = Object.freeze({
  maxDepth: 6,
  maxEntries: 100,
  maxArrayLength: 50,
  maxKeyCodePoints: 128,
  maxKeyBytes: 512,
  maxStringCodePoints: 2000,
  maxStringBytes: 8192,
  maxSerializedBytes: 65536,
});
const MAX_CENTS = 100000000;

class RequestValidationError extends Error {
  constructor(reason) {
    super(REQUEST_VALIDATION_MESSAGE);
    const safeReason = VALIDATION_REASON_SET.has(reason)
      ? reason
      : REQUEST_VALIDATION_REASONS.INVALID_VALUE;
    Object.defineProperty(this, 'message', {
      value: REQUEST_VALIDATION_MESSAGE,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'name', {
      value: 'RequestValidationError',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'reason', {
      value: safeReason,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Error.captureStackTrace?.(this, RequestValidationError);
    Object.freeze(this);
  }
}

function reject(reason) {
  const error = new RequestValidationError(reason);
  SAFE_VALIDATION_ERRORS.add(error);
  throw error;
}

function invalidOptions() {
  throw new TypeError('Invalid validation options');
}

function isWellFormedString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return false;
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return false;
    }
  }
  return true;
}

function codePointLength(value) {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) index += 1;
    length += 1;
  }
  return length;
}

function ownDataEntries(
  value,
  reason,
  maximumEntries = Number.MAX_SAFE_INTEGER,
  expectedPrototype = Object.prototype,
) {
  if (value === null || typeof value !== 'object' || isProxy(value)) reject(reason);

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    reject(reason);
  }
  const trustedNullPrototype = expectedPrototype === Object.prototype
    && prototype === null
    && SAFE_CLONES.has(value);
  if (prototype !== expectedPrototype && !trustedNullPrototype) reject(reason);
  if (keys.length > maximumEntries) {
    reject(REQUEST_VALIDATION_REASONS.PAYLOAD_LIMIT);
  }

  const entries = [];
  for (const key of keys) {
    if (typeof key !== 'string' || DANGEROUS_KEYS.has(key)) reject(reason);
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      reject(reason);
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined) {
      reject(reason);
    }
    entries.push([key, descriptor.value]);
  }

  // A polluted Object.prototype would otherwise look like an ordinary plain object.
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) reject(reason);
  }
  return entries;
}

function ownArrayValues(value, reason, maximumLength = Number.MAX_SAFE_INTEGER) {
  if (value === null || typeof value !== 'object' || isProxy(value)) reject(reason);
  if (!Array.isArray(value)) reject(reason);

  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    reject(reason);
  }
  if (prototype !== Array.prototype) reject(reason);

  let lengthDescriptor;
  try {
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  } catch {
    reject(reason);
  }
  if (!lengthDescriptor
    || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0) {
    reject(reason);
  }
  const length = lengthDescriptor.value;
  if (length > maximumLength) reject(REQUEST_VALIDATION_REASONS.PAYLOAD_LIMIT);

  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    reject(reason);
  }
  const descriptors = new Map();

  for (const key of keys) {
    if (key === 'length') continue;
    if (typeof key !== 'string') reject(reason);
    const index = Number(key);
    if (!Number.isSafeInteger(index)
      || index < 0
      || index >= length
      || String(index) !== key) {
      reject(reason);
    }
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      reject(reason);
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined) {
      reject(reason);
    }
    descriptors.set(index, descriptor.value);
  }

  if (descriptors.size !== length) reject(reason);
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) reject(reason);
  }
  const values = [];
  for (let index = 0; index < length; index += 1) {
    if (!descriptors.has(index)) reject(reason);
    values.push(descriptors.get(index));
  }
  return values;
}

function readOptionsObject(value, allowedKeys) {
  if (value === undefined) return new Map();
  if (value === null || typeof value !== 'object' || isProxy(value)) invalidOptions();

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    invalidOptions();
  }
  if (prototype !== Object.prototype || keys.some((key) => typeof key !== 'string')) {
    invalidOptions();
  }

  const result = new Map();
  for (const key of keys) {
    if (!allowedKeys.has(key) || DANGEROUS_KEYS.has(key)) invalidOptions();
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      invalidOptions();
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined) {
      invalidOptions();
    }
    result.set(key, descriptor.value);
  }
  return result;
}

function copyConfiguredKeys(value, label) {
  if (value === null
    || typeof value !== 'object'
    || isProxy(value)
    || !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype) {
    invalidOptions();
  }
  const values = ownArrayValuesForOptions(value);
  const seen = new Set();
  for (const key of values) {
    if (typeof key !== 'string'
      || !STRICT_FIELD_NAME.test(key)
      || key.length > DEFAULT_REQUEST_LIMITS.maxKeyCodePoints
      || DANGEROUS_KEYS.has(key)
      || seen.has(key)) {
      invalidOptions();
    }
    seen.add(key);
  }
  return { label, values: Object.freeze([...values]), set: seen };
}

function ownArrayValuesForOptions(value) {
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    invalidOptions();
  }
  const length = value.length;
  const descriptors = new Map();
  for (const key of keys) {
    if (key === 'length') continue;
    if (typeof key !== 'string') invalidOptions();
    const index = Number(key);
    if (!Number.isSafeInteger(index)
      || index < 0
      || index >= length
      || String(index) !== key) {
      invalidOptions();
    }
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      invalidOptions();
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined) {
      invalidOptions();
    }
    descriptors.set(index, descriptor.value);
  }
  if (descriptors.size !== length) invalidOptions();
  return Array.from({ length }, (_unused, index) => descriptors.get(index));
}

function normalizeLimits(value) {
  const allowed = new Set(Object.keys(DEFAULT_REQUEST_LIMITS));
  const options = readOptionsObject(value, allowed);
  const limits = {};
  for (const [name, hardMaximum] of Object.entries(DEFAULT_REQUEST_LIMITS)) {
    const candidate = options.has(name) ? options.get(name) : hardMaximum;
    const minimum = name === 'maxDepth' ? 0 : 1;
    if (!Number.isSafeInteger(candidate)
      || candidate < minimum
      || candidate > hardMaximum) {
      invalidOptions();
    }
    limits[name] = candidate;
  }
  return Object.freeze(limits);
}

function addEntries(state, amount, limits) {
  state.entries += amount;
  if (state.entries > limits.maxEntries) {
    reject(REQUEST_VALIDATION_REASONS.PAYLOAD_LIMIT);
  }
}

function jsonStringByteLength(value) {
  let bytes = 2; // Opening and closing quotation marks.
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5C) {
      bytes += 2;
    } else if ([0x08, 0x09, 0x0A, 0x0C, 0x0D].includes(code)) {
      bytes += 2;
    } else if (code <= 0x1F) {
      bytes += 6;
    } else if (code <= 0x7F) {
      bytes += 1;
    } else if (code <= 0x7FF) {
      bytes += 2;
    } else if (code >= 0xD800 && code <= 0xDBFF) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function measureSerializedBytes(value, maximum) {
  const state = { bytes: 0 };
  const add = (amount) => {
    state.bytes += amount;
    if (state.bytes > maximum) reject(REQUEST_VALIDATION_REASONS.PAYLOAD_LIMIT);
  };

  const visit = (current) => {
    if (typeof current === 'string') {
      add(jsonStringByteLength(current));
    } else if (current === null) {
      add(4);
    } else if (typeof current === 'boolean') {
      add(current ? 4 : 5);
    } else if (typeof current === 'number') {
      add(String(current).length);
    } else if (Array.isArray(current)) {
      const values = ownArrayValues(current, REQUEST_VALIDATION_REASONS.INVALID_VALUE);
      add(2 + Math.max(0, values.length - 1));
      values.forEach(visit);
    } else if (typeof current === 'object') {
      const entries = ownDataEntries(
        current,
        REQUEST_VALIDATION_REASONS.INVALID_VALUE,
        Number.MAX_SAFE_INTEGER,
        null,
      );
      add(2 + Math.max(0, entries.length - 1));
      for (const [key, child] of entries) {
        add(jsonStringByteLength(key) + 1);
        visit(child);
      }
    } else {
      reject(REQUEST_VALIDATION_REASONS.INVALID_VALUE);
    }
  };

  visit(value);
  return state.bytes;
}

function cloneBoundedValue(value, depth, state, limits, active, rootShape = null) {
  if (rootShape !== null) {
    if (value === null || typeof value !== 'object') {
      reject(REQUEST_VALIDATION_REASONS.INVALID_OBJECT);
    }
    if (isProxy(value) || Array.isArray(value)) {
      reject(REQUEST_VALIDATION_REASONS.INVALID_OBJECT);
    }
  }
  if (typeof value === 'string') {
    if (value.length > limits.maxStringBytes
      || value.length > limits.maxStringCodePoints * 2
      || !isWellFormedString(value)
      || codePointLength(value) > limits.maxStringCodePoints
      || Buffer.byteLength(value, 'utf8') > limits.maxStringBytes) {
      reject(REQUEST_VALIDATION_REASONS.PAYLOAD_LIMIT);
    }
    return value;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      reject(REQUEST_VALIDATION_REASONS.INVALID_VALUE);
    }
    return value;
  }
  if (typeof value !== 'object') reject(REQUEST_VALIDATION_REASONS.INVALID_VALUE);
  if (depth > limits.maxDepth) reject(REQUEST_VALIDATION_REASONS.PAYLOAD_LIMIT);
  if (isProxy(value)) reject(REQUEST_VALIDATION_REASONS.INVALID_VALUE);
  if (active.has(value)) reject(REQUEST_VALIDATION_REASONS.INVALID_VALUE);

  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (rootShape !== null) reject(REQUEST_VALIDATION_REASONS.INVALID_OBJECT);
      const remainingEntries = Math.max(0, limits.maxEntries - state.entries);
      const values = ownArrayValues(
        value,
        REQUEST_VALIDATION_REASONS.INVALID_ARRAY,
        Math.min(limits.maxArrayLength, remainingEntries),
      );
      addEntries(state, values.length, limits);
      const cloned = values.map((item) => (
        cloneBoundedValue(item, depth + 1, state, limits, active)
      ));
      SAFE_CLONES.add(cloned);
      return Object.freeze(cloned);
    }

    const entries = ownDataEntries(
      value,
      REQUEST_VALIDATION_REASONS.INVALID_OBJECT,
      Math.max(0, limits.maxEntries - state.entries),
    );
    for (const [key] of entries) {
      if (key.length > limits.maxKeyBytes
        || key.length > limits.maxKeyCodePoints * 2
        || !isWellFormedString(key)
        || codePointLength(key) > limits.maxKeyCodePoints
        || Buffer.byteLength(key, 'utf8') > limits.maxKeyBytes) {
        reject(REQUEST_VALIDATION_REASONS.PAYLOAD_LIMIT);
      }
    }
    const sortedEntries = [...entries].sort(([left], [right]) => {
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    });
    if (rootShape) {
      const present = new Set(sortedEntries.map(([key]) => key));
      if (sortedEntries.some(([key]) => !rootShape.allowed.has(key))
        || rootShape.required.values.some((key) => !present.has(key))) {
        reject(REQUEST_VALIDATION_REASONS.INVALID_FIELDS);
      }
    }
    addEntries(state, sortedEntries.length, limits);
    const cloned = Object.create(null);
    for (const [key, child] of sortedEntries) {
      Object.defineProperty(cloned, key, {
        value: cloneBoundedValue(child, depth + 1, state, limits, active),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    SAFE_CLONES.add(cloned);
    return Object.freeze(cloned);
  } finally {
    active.delete(value);
  }
}

/**
 * Validate one exact object boundary and return a new recursively frozen JSON-like clone.
 * Nested object schemas still need their own exact-key validation in endpoint children.
 */
function parseStrictObject(value, options = {}) {
  const optionValues = readOptionsObject(
    options,
    new Set(['requiredKeys', 'optionalKeys', 'limits']),
  );
  const required = copyConfiguredKeys(
    optionValues.has('requiredKeys') ? optionValues.get('requiredKeys') : [],
    'required',
  );
  const optional = copyConfiguredKeys(
    optionValues.has('optionalKeys') ? optionValues.get('optionalKeys') : [],
    'optional',
  );
  if (required.values.some((key) => optional.set.has(key))) invalidOptions();
  const allowed = new Set([...required.values, ...optional.values]);
  const limits = normalizeLimits(optionValues.get('limits'));
  const state = { entries: 0 };
  const result = cloneBoundedValue(
    value,
    0,
    state,
    limits,
    new WeakSet(),
    { required, allowed },
  );
  measureSerializedBytes(result, limits.maxSerializedBytes);
  return result;
}

/**
 * Bound and freeze raw items before passing each clone to a trusted, pure,
 * synchronous item parser. The parser output is independently bounded/frozen.
 */
function parseBoundedArray(value, options = {}) {
  const optionValues = readOptionsObject(options, new Set(['maxItems', 'itemParser']));
  const maxItems = optionValues.get('maxItems');
  const itemParser = optionValues.get('itemParser');
  if (!Number.isSafeInteger(maxItems)
    || maxItems < 0
    || maxItems > DEFAULT_REQUEST_LIMITS.maxArrayLength
    || typeof itemParser !== 'function') {
    invalidOptions();
  }
  const values = ownArrayValues(
    value,
    REQUEST_VALIDATION_REASONS.INVALID_ARRAY,
    maxItems,
  );

  const rawState = { entries: values.length };
  const rawActive = new WeakSet();
  const boundedInputs = values.map((item) => (
    cloneBoundedValue(item, 0, rawState, DEFAULT_REQUEST_LIMITS, rawActive)
  ));
  measureSerializedBytes(boundedInputs, DEFAULT_REQUEST_LIMITS.maxSerializedBytes);
  const outputState = { entries: values.length };
  const outputActive = new WeakSet();
  const parsed = boundedInputs.map((item, index) => {
    let result;
    try {
      result = itemParser(item, index);
    } catch (error) {
      if (SAFE_VALIDATION_ERRORS.has(error)) reject(error.reason);
      reject(REQUEST_VALIDATION_REASONS.INVALID_VALUE);
    }
    return cloneBoundedValue(result, 0, outputState, DEFAULT_REQUEST_LIMITS, outputActive);
  });
  const frozen = Object.freeze(parsed);
  measureSerializedBytes(frozen, DEFAULT_REQUEST_LIMITS.maxSerializedBytes);
  return frozen;
}

function parseBoundedString(value, options = {}) {
  const optionValues = readOptionsObject(
    options,
    new Set(['maxCodePoints', 'maxBytes', 'normalize', 'trim']),
  );
  const maxCodePoints = optionValues.get('maxCodePoints');
  const maxBytes = optionValues.get('maxBytes');
  const normalize = optionValues.has('normalize') ? optionValues.get('normalize') : 'NFC';
  const trim = optionValues.has('trim') ? optionValues.get('trim') : false;
  if (!Number.isSafeInteger(maxCodePoints)
    || maxCodePoints < 0
    || maxCodePoints > DEFAULT_REQUEST_LIMITS.maxStringCodePoints
    || !Number.isSafeInteger(maxBytes)
    || maxBytes < 0
    || maxBytes > DEFAULT_REQUEST_LIMITS.maxStringBytes
    || (normalize !== 'NFC' && normalize !== false)
    || typeof trim !== 'boolean') {
    invalidOptions();
  }
  if (typeof value !== 'string'
    || value.length > maxBytes
    || value.length > maxCodePoints * 2
    || !isWellFormedString(value)
    || codePointLength(value) > maxCodePoints
    || Buffer.byteLength(value, 'utf8') > maxBytes) {
    reject(REQUEST_VALIDATION_REASONS.INVALID_STRING);
  }

  let parsed = normalize === false ? value : value.normalize(normalize);
  if (trim) parsed = parsed.trim();
  if (!isWellFormedString(parsed)
    || codePointLength(parsed) > maxCodePoints
    || Buffer.byteLength(parsed, 'utf8') > maxBytes) {
    reject(REQUEST_VALIDATION_REASONS.INVALID_STRING);
  }
  return parsed;
}

function parseNonnegativeCents(value, options = {}) {
  const optionValues = readOptionsObject(options, new Set(['maxCents']));
  const maxCents = optionValues.has('maxCents') ? optionValues.get('maxCents') : MAX_CENTS;
  if (!Number.isSafeInteger(maxCents) || maxCents < 0 || maxCents > MAX_CENTS) {
    invalidOptions();
  }
  if (typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || Object.is(value, -0)
    || value < 0
    || value > maxCents) {
    reject(REQUEST_VALIDATION_REASONS.INVALID_MONEY);
  }
  return value;
}

function parseCurrency(value) {
  let parsed;
  try {
    parsed = parseBoundedString(value, {
      maxCodePoints: 3,
      maxBytes: 3,
      normalize: false,
      trim: false,
    });
  } catch (error) {
    if (!(error instanceof RequestValidationError)) throw error;
    reject(REQUEST_VALIDATION_REASONS.INVALID_CURRENCY);
  }
  if (!/^[A-Za-z]{3}$/.test(parsed) || parsed.toLowerCase() !== 'usd') {
    reject(REQUEST_VALIDATION_REASONS.INVALID_CURRENCY);
  }
  return 'usd';
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function parseCalendarDate(value) {
  if (typeof value !== 'string'
    || value.length !== 10
    || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    reject(REQUEST_VALIDATION_REASONS.INVALID_DATE);
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || year > 9999 || month < 1 || month > 12) {
    reject(REQUEST_VALIDATION_REASONS.INVALID_DATE);
  }
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) {
    reject(REQUEST_VALIDATION_REASONS.INVALID_DATE);
  }
  return value;
}

function canonicalIpHostname(hostname) {
  if (hostname.startsWith('[') && hostname.endsWith(']')) return hostname.slice(1, -1);
  return hostname;
}

function isLoopbackHostname(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '[::1]'
    || hostname === '::1';
}

function isValidDnsHostname(hostname) {
  if (hostname.length > 253 || !hostname.includes('.') || hostname.endsWith('.')) return false;
  const labels = hostname.split('.');
  if (labels.includes('localhost')) return false;
  return labels.every((label) => (
    label.length >= 1
    && label.length <= 63
    && !label.startsWith('xn--')
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ));
}

function hasUnsafeUrlCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7F || code === 0x5C) return true;
  }
  return false;
}

function hasNoncanonicalPercentEncoding(value) {
  const unreserved = /^[A-Za-z0-9._~-]$/;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '%') continue;
    const hex = value.slice(index + 1, index + 3);
    if (hex !== hex.toUpperCase()) return true;
    if (unreserved.test(String.fromCharCode(Number.parseInt(hex, 16)))) return true;
    index += 2;
  }
  return false;
}

function parseHttpsUrl(value, options = {}) {
  const optionValues = readOptionsObject(options, new Set(['allowLoopback']));
  const allowLoopback = optionValues.has('allowLoopback')
    ? optionValues.get('allowLoopback')
    : false;
  if (typeof allowLoopback !== 'boolean') invalidOptions();
  let parsedValue;
  try {
    parsedValue = parseBoundedString(value, {
      maxCodePoints: 2000,
      maxBytes: 8192,
      normalize: false,
      trim: false,
    });
  } catch (error) {
    if (!(error instanceof RequestValidationError)) throw error;
    reject(REQUEST_VALIDATION_REASONS.INVALID_URL);
  }
  if (hasUnsafeUrlCharacter(parsedValue)
    || /%(?![0-9A-Fa-f]{2})/.test(parsedValue)
    || /%(?:0[0-9A-F]|1[0-9A-F]|7F)/i.test(parsedValue)
    || hasNoncanonicalPercentEncoding(parsedValue)) {
    reject(REQUEST_VALIDATION_REASONS.INVALID_URL);
  }

  let parsed;
  try {
    parsed = new URL(parsedValue);
  } catch {
    reject(REQUEST_VALIDATION_REASONS.INVALID_URL);
  }
  if (parsed.href !== parsedValue
    || parsed.username !== ''
    || parsed.password !== '') {
    reject(REQUEST_VALIDATION_REASONS.INVALID_URL);
  }

  const hostname = parsed.hostname;
  const loopback = isLoopbackHostname(hostname);
  if (loopback) {
    if (!allowLoopback || !['http:', 'https:'].includes(parsed.protocol)) {
      reject(REQUEST_VALIDATION_REASONS.INVALID_URL);
    }
    return parsedValue;
  }
  if (parsed.protocol !== 'https:'
    || isIP(canonicalIpHostname(hostname)) !== 0
    || !isValidDnsHostname(hostname)) {
    reject(REQUEST_VALIDATION_REASONS.INVALID_URL);
  }
  return parsedValue;
}

function parseEmail(value) {
  // Permit ordinary surrounding spaces for form input, but reject every
  // non-ASCII/control character before normalization can create an alias.
  if (typeof value !== 'string'
    || value.length > 254
    || !/^[\x20-\x7E]*$/.test(value)) {
    reject(REQUEST_VALIDATION_REASONS.INVALID_EMAIL);
  }
  let normalized;
  try {
    normalized = parseBoundedString(value, {
      maxCodePoints: 254,
      maxBytes: 254,
      normalize: 'NFC',
      trim: true,
    }).toLowerCase();
  } catch (error) {
    if (!(error instanceof RequestValidationError)) throw error;
    reject(REQUEST_VALIDATION_REASONS.INVALID_EMAIL);
  }
  if (!/^[\x21-\x7E]+$/.test(normalized)) {
    reject(REQUEST_VALIDATION_REASONS.INVALID_EMAIL);
  }
  const at = normalized.indexOf('@');
  if (at <= 0 || at !== normalized.lastIndexOf('@')) {
    reject(REQUEST_VALIDATION_REASONS.INVALID_EMAIL);
  }
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (local.length > 64
    || local.startsWith('.')
    || local.endsWith('.')
    || local.includes('..')
    || !/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)
    || domain.length > 253
    || !domain.includes('.')) {
    reject(REQUEST_VALIDATION_REASONS.INVALID_EMAIL);
  }
  const labels = domain.split('.');
  if (!labels.every((label) => (
    label.length >= 1
    && label.length <= 63
    && !label.startsWith('xn--')
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ))) {
    reject(REQUEST_VALIDATION_REASONS.INVALID_EMAIL);
  }
  return normalized;
}

module.exports = {
  DEFAULT_REQUEST_LIMITS,
  MAX_CENTS,
  REQUEST_VALIDATION_MESSAGE,
  REQUEST_VALIDATION_REASONS,
  RequestValidationError,
  parseBoundedArray,
  parseBoundedString,
  parseCalendarDate,
  parseCurrency,
  parseEmail,
  parseHttpsUrl,
  parseNonnegativeCents,
  parseStrictObject,
};
