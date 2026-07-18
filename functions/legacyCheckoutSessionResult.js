'use strict';

const { URL: NodeUrl } = require('node:url');
const { types: { isProxy: nodeIsProxy } } = require('node:util');

const arrayIsArray = Array.isArray;
const numberIsSafeInteger = Number.isSafeInteger;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwn = Object.hasOwn;
const objectIsFrozen = Object.isFrozen;
const objectPrototype = Object.prototype;
const reflectApply = Reflect.apply;
const reflectOwnKeys = Reflect.ownKeys;
const regexpTest = Function.prototype.call.bind(RegExp.prototype.test);
const stringToLowerCase = Function.prototype.call.bind(
  String.prototype.toLowerCase,
);
const stringTrim = Function.prototype.call.bind(String.prototype.trim);

const LEGACY_CHECKOUT_RESULT_FAILURE_MESSAGE = (
  'Checkout result could not be confirmed. Do not retry. Contact MPRC.'
);

const MAX_SESSION_ID_LENGTH = 255;
const MAX_CHECKOUT_URL_LENGTH = 8192;
const MAX_CUSTOMER_EMAIL_LENGTH = 254;
const APPROVED_CHECKOUT_ORIGIN = 'https://checkout.stripe.com';

const TEST_SESSION_ID_PATTERN = /^cs_test_[A-Za-z0-9]+$/u;
const LIVE_SESSION_ID_PATTERN = /^cs_live_[A-Za-z0-9]+$/u;
const PRINTABLE_ASCII_PATTERN = /^[\x20-\x7e]+$/u;
const VISIBLE_ASCII_PATTERN = /^[\x21-\x7e]+$/u;
const NORMALIZED_EMAIL_PATTERN = (
  /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+@[a-z0-9.-]+\.[a-z0-9-]+$/u
);
const URL_AUTHORITY_CREDENTIAL_PATTERN = /^https:\/\/[^/?#]*@/u;

const EXPECTATION_KEYS = objectFreeze([
  'livemode',
  'amountCents',
  'customerEmail',
  'successUrl',
  'cancelUrl',
  'metadata',
]);
const RACE_METADATA_KEYS = objectFreeze([
  'schemaVersion',
  'eventId',
  'registrationId',
  'priceTier',
]);
const MERCH_METADATA_KEYS = objectFreeze([
  'schemaVersion',
  'type',
  'productSlug',
  'orderId',
  'size',
  'color',
]);
const RACE_PRICE_TIERS = objectFreeze([
  'member',
  'nonMember',
  'earlyBird',
]);
const SESSION_FIELDS = objectFreeze([
  'id',
  'object',
  'livemode',
  'mode',
  'status',
  'payment_status',
  'amount_total',
  'currency',
  'customer_email',
  'metadata',
  'success_url',
  'cancel_url',
  'url',
  'lastResponse',
]);

const INVALID_VALUE = Symbol('invalid-legacy-checkout-session-value');

const urlPrototype = NodeUrl.prototype;
const urlHrefGetter = objectGetOwnPropertyDescriptor(
  urlPrototype,
  'href',
).get;
const urlOriginGetter = objectGetOwnPropertyDescriptor(
  urlPrototype,
  'origin',
).get;
const urlProtocolGetter = objectGetOwnPropertyDescriptor(
  urlPrototype,
  'protocol',
).get;
const urlUsernameGetter = objectGetOwnPropertyDescriptor(
  urlPrototype,
  'username',
).get;
const urlPasswordGetter = objectGetOwnPropertyDescriptor(
  urlPrototype,
  'password',
).get;
const urlPortGetter = objectGetOwnPropertyDescriptor(
  urlPrototype,
  'port',
).get;

function isProxyValue(value) {
  try {
    return nodeIsProxy(value);
  } catch (_error) {
    return true;
  }
}

function hasExactKeys(actualKeys, expectedKeys) {
  if (actualKeys.length !== expectedKeys.length) return false;
  for (let actualIndex = 0; actualIndex < actualKeys.length; actualIndex += 1) {
    const actualKey = actualKeys[actualIndex];
    if (typeof actualKey !== 'string') return false;
    let matched = false;
    for (
      let expectedIndex = 0;
      expectedIndex < expectedKeys.length;
      expectedIndex += 1
    ) {
      if (actualKey === expectedKeys[expectedIndex]) {
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}

function isOwnDataDescriptor(descriptor) {
  return descriptor !== undefined
    && objectHasOwn(descriptor, 'value')
    && !objectHasOwn(descriptor, 'get')
    && !objectHasOwn(descriptor, 'set');
}

function readClosedDataRecord(
  record,
  expectedKeys,
  expectedPrototype,
  expectedFlags,
) {
  if (record === null
    || typeof record !== 'object'
    || arrayIsArray(record)
    || isProxyValue(record)) {
    return null;
  }

  let prototype;
  let keys;
  try {
    prototype = objectGetPrototypeOf(record);
    keys = reflectOwnKeys(record);
  } catch (_error) {
    return null;
  }
  if (prototype !== expectedPrototype || !hasExactKeys(keys, expectedKeys)) {
    return null;
  }

  const values = objectCreate(null);
  for (let index = 0; index < expectedKeys.length; index += 1) {
    const key = expectedKeys[index];
    let descriptor;
    try {
      descriptor = objectGetOwnPropertyDescriptor(record, key);
    } catch (_error) {
      return null;
    }
    if (!isOwnDataDescriptor(descriptor)) return null;
    if (expectedFlags
      && (descriptor.enumerable !== expectedFlags.enumerable
        || descriptor.writable !== expectedFlags.writable
        || descriptor.configurable !== expectedFlags.configurable)) {
      return null;
    }
    objectDefineProperty(values, key, {
      value: descriptor.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return values;
}

function isNonemptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isOneOf(value, allowedValues) {
  for (let index = 0; index < allowedValues.length; index += 1) {
    if (value === allowedValues[index]) return true;
  }
  return false;
}

function parseMetadataInput(metadata) {
  if (metadata === null
    || typeof metadata !== 'object'
    || arrayIsArray(metadata)
    || isProxyValue(metadata)) {
    return null;
  }

  let keys;
  let prototype;
  try {
    prototype = objectGetPrototypeOf(metadata);
    keys = reflectOwnKeys(metadata);
  } catch (_error) {
    return null;
  }
  if (prototype !== objectPrototype) return null;

  let expectedKeys;
  if (hasExactKeys(keys, RACE_METADATA_KEYS)) {
    expectedKeys = RACE_METADATA_KEYS;
  } else if (hasExactKeys(keys, MERCH_METADATA_KEYS)) {
    expectedKeys = MERCH_METADATA_KEYS;
  } else {
    return null;
  }

  const values = readClosedDataRecord(
    metadata,
    expectedKeys,
    objectPrototype,
    null,
  );
  if (values === null || values.schemaVersion !== '1') return null;

  if (expectedKeys === RACE_METADATA_KEYS) {
    if (!isNonemptyString(values.eventId)
      || !isNonemptyString(values.registrationId)
      || !isOneOf(values.priceTier, RACE_PRICE_TIERS)) {
      return null;
    }
  } else if (values.type !== 'merch'
    || !isNonemptyString(values.productSlug)
    || !isNonemptyString(values.orderId)
    || typeof values.size !== 'string'
    || typeof values.color !== 'string') {
    return null;
  }

  return {
    expectedKeys,
    values,
  };
}

function createFrozenNullRecord(keys, values) {
  const record = objectCreate(null);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    objectDefineProperty(record, key, {
      value: values[key],
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return objectFreeze(record);
}

function isNormalizedCustomerEmail(value) {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_CUSTOMER_EMAIL_LENGTH
    || !regexpTest(VISIBLE_ASCII_PATTERN, value)
    || !regexpTest(NORMALIZED_EMAIL_PATTERN, value)) {
    return false;
  }
  try {
    return stringTrim(value) === value && stringToLowerCase(value) === value;
  } catch (_error) {
    return false;
  }
}

function isExactCallbackString(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_CHECKOUT_URL_LENGTH
    && regexpTest(PRINTABLE_ASCII_PATTERN, value);
}

function buildLegacyCheckoutSessionExpectation(input) {
  try {
    const values = readClosedDataRecord(
      input,
      EXPECTATION_KEYS,
      objectPrototype,
      null,
    );
    if (values === null
      || typeof values.livemode !== 'boolean'
      || !numberIsSafeInteger(values.amountCents)
      || values.amountCents <= 0
      || !isNormalizedCustomerEmail(values.customerEmail)
      || !isExactCallbackString(values.successUrl)
      || !isExactCallbackString(values.cancelUrl)) {
      return null;
    }

    const metadataInput = parseMetadataInput(values.metadata);
    if (metadataInput === null) return null;
    const metadata = createFrozenNullRecord(
      metadataInput.expectedKeys,
      metadataInput.values,
    );

    return createFrozenNullRecord(EXPECTATION_KEYS, {
      livemode: values.livemode,
      amountCents: values.amountCents,
      customerEmail: values.customerEmail,
      successUrl: values.successUrl,
      cancelUrl: values.cancelUrl,
      metadata,
    });
  } catch (_error) {
    return null;
  }
}

const FROZEN_DATA_FLAGS = objectFreeze({
  enumerable: true,
  writable: false,
  configurable: false,
});
const SDK_DATA_FLAGS = objectFreeze({
  enumerable: true,
  writable: true,
  configurable: true,
});
const LAST_RESPONSE_FLAGS = objectFreeze({
  enumerable: false,
  writable: false,
  configurable: false,
});

function readExpectation(expectation) {
  if (expectation === null
    || typeof expectation !== 'object'
    || arrayIsArray(expectation)
    || isProxyValue(expectation)) {
    return null;
  }

  let frozen;
  try {
    frozen = objectIsFrozen(expectation);
  } catch (_error) {
    return null;
  }
  if (!frozen) return null;

  const values = readClosedDataRecord(
    expectation,
    EXPECTATION_KEYS,
    null,
    FROZEN_DATA_FLAGS,
  );
  if (values === null
    || typeof values.livemode !== 'boolean'
    || !numberIsSafeInteger(values.amountCents)
    || values.amountCents <= 0
    || !isNormalizedCustomerEmail(values.customerEmail)
    || !isExactCallbackString(values.successUrl)
    || !isExactCallbackString(values.cancelUrl)) {
    return null;
  }

  let metadataFrozen;
  try {
    metadataFrozen = objectIsFrozen(values.metadata);
  } catch (_error) {
    return null;
  }
  if (!metadataFrozen
    || values.metadata === null
    || typeof values.metadata !== 'object'
    || arrayIsArray(values.metadata)
    || isProxyValue(values.metadata)) {
    return null;
  }

  let metadataKeys;
  try {
    metadataKeys = reflectOwnKeys(values.metadata);
  } catch (_error) {
    return null;
  }

  let expectedMetadataKeys;
  if (hasExactKeys(metadataKeys, RACE_METADATA_KEYS)) {
    expectedMetadataKeys = RACE_METADATA_KEYS;
  } else if (hasExactKeys(metadataKeys, MERCH_METADATA_KEYS)) {
    expectedMetadataKeys = MERCH_METADATA_KEYS;
  } else {
    return null;
  }

  const metadata = readClosedDataRecord(
    values.metadata,
    expectedMetadataKeys,
    null,
    FROZEN_DATA_FLAGS,
  );
  if (metadata === null || metadata.schemaVersion !== '1') return null;
  if (expectedMetadataKeys === RACE_METADATA_KEYS) {
    if (!isNonemptyString(metadata.eventId)
      || !isNonemptyString(metadata.registrationId)
      || !isOneOf(metadata.priceTier, RACE_PRICE_TIERS)) {
      return null;
    }
  } else if (metadata.type !== 'merch'
    || !isNonemptyString(metadata.productSlug)
    || !isNonemptyString(metadata.orderId)
    || typeof metadata.size !== 'string'
    || typeof metadata.color !== 'string') {
    return null;
  }

  values.metadataKeys = expectedMetadataKeys;
  values.metadataValues = metadata;
  return values;
}

function readInstalledSdkDataValue(record, key, expectedFlags) {
  let descriptor;
  try {
    descriptor = objectGetOwnPropertyDescriptor(record, key);
  } catch (_error) {
    return INVALID_VALUE;
  }
  if (!isOwnDataDescriptor(descriptor)
    || descriptor.enumerable !== expectedFlags.enumerable
    || descriptor.writable !== expectedFlags.writable
    || descriptor.configurable !== expectedFlags.configurable) {
    return INVALID_VALUE;
  }
  return descriptor.value;
}

function isBoundedSessionId(value, livemode) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_SESSION_ID_LENGTH
    && regexpTest(
      livemode ? LIVE_SESSION_ID_PATTERN : TEST_SESSION_ID_PATTERN,
      value,
    );
}

function hasExactRawMetadata(
  metadata,
  expectedKeys,
  expectedMetadataValues,
) {
  if (metadata === null
    || typeof metadata !== 'object'
    || arrayIsArray(metadata)
    || isProxyValue(metadata)) {
    return false;
  }

  let prototype;
  let keys;
  try {
    prototype = objectGetPrototypeOf(metadata);
    keys = reflectOwnKeys(metadata);
  } catch (_error) {
    return false;
  }
  if (prototype !== objectPrototype || !hasExactKeys(keys, expectedKeys)) {
    return false;
  }

  for (let index = 0; index < expectedKeys.length; index += 1) {
    const key = expectedKeys[index];
    const value = readInstalledSdkDataValue(metadata, key, SDK_DATA_FLAGS);
    if (value === INVALID_VALUE || value !== expectedMetadataValues[key]) {
      return false;
    }
  }
  return true;
}

function isApprovedCheckoutUrl(value) {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_CHECKOUT_URL_LENGTH
    || !regexpTest(PRINTABLE_ASCII_PATTERN, value)
    || regexpTest(URL_AUTHORITY_CREDENTIAL_PATTERN, value)) {
    return false;
  }

  let parsed;
  let href;
  let origin;
  let protocol;
  let username;
  let password;
  let port;
  try {
    parsed = new NodeUrl(value);
    href = reflectApply(urlHrefGetter, parsed, []);
    origin = reflectApply(urlOriginGetter, parsed, []);
    protocol = reflectApply(urlProtocolGetter, parsed, []);
    username = reflectApply(urlUsernameGetter, parsed, []);
    password = reflectApply(urlPasswordGetter, parsed, []);
    port = reflectApply(urlPortGetter, parsed, []);
  } catch (_error) {
    return false;
  }

  return href === value
    && origin === APPROVED_CHECKOUT_ORIGIN
    && protocol === 'https:'
    && username === ''
    && password === ''
    && port === '';
}

function projectLegacyCheckoutSessionResult(rawSession, expectation) {
  try {
    const expected = readExpectation(expectation);
    if (expected === null
      || rawSession === null
      || typeof rawSession !== 'object'
      || arrayIsArray(rawSession)
      || isProxyValue(rawSession)
      || objectGetPrototypeOf(rawSession) !== objectPrototype) {
      return null;
    }

    const values = objectCreate(null);
    for (let index = 0; index < SESSION_FIELDS.length; index += 1) {
      const key = SESSION_FIELDS[index];
      const expectedFlags = key === 'lastResponse'
        ? LAST_RESPONSE_FLAGS
        : SDK_DATA_FLAGS;
      const value = readInstalledSdkDataValue(
        rawSession,
        key,
        expectedFlags,
      );
      if (value === INVALID_VALUE) return null;
      objectDefineProperty(values, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }

    if (!isBoundedSessionId(values.id, expected.livemode)
      || values.object !== 'checkout.session'
      || values.livemode !== expected.livemode
      || values.mode !== 'payment'
      || values.status !== 'open'
      || values.payment_status !== 'unpaid'
      || values.amount_total !== expected.amountCents
      || values.currency !== 'usd'
      || values.customer_email !== expected.customerEmail
      || values.success_url !== expected.successUrl
      || values.cancel_url !== expected.cancelUrl
      || !hasExactRawMetadata(
        values.metadata,
        expected.metadataKeys,
        expected.metadataValues,
      )
      || !isApprovedCheckoutUrl(values.url)) {
      return null;
    }

    const lastResponse = values.lastResponse;
    if (lastResponse === null
      || typeof lastResponse !== 'object'
      || isProxyValue(lastResponse)) {
      return null;
    }
    const statusCode = readInstalledSdkDataValue(
      lastResponse,
      'statusCode',
      SDK_DATA_FLAGS,
    );
    if (statusCode !== 200) return null;

    return createFrozenNullRecord(['sessionId', 'url'], {
      sessionId: values.id,
      url: values.url,
    });
  } catch (_error) {
    return null;
  }
}

module.exports = objectFreeze({
  LEGACY_CHECKOUT_RESULT_FAILURE_MESSAGE,
  buildLegacyCheckoutSessionExpectation,
  projectLegacyCheckoutSessionResult,
});
