const { createHash } = require('node:crypto');
const { types: { isProxy } } = require('node:util');

const commandIdentityVersion = 1;
const INTERNAL_SYSTEM_PRINCIPAL = 'mprc_internal_system';

const COMMAND_IDENTITY_LIMITS = Object.freeze({
  maximumCallerScopeLength: 128,
  maximumFirebaseUidCharacters: 128,
  maximumFirebaseUidBytes: 512,
  maximumCommandTypeLength: 64,
  maximumProviderOperationLength: 64,
  maximumProviderAttempt: 1000000,
  maximumPayloadDepth: 6,
  maximumPayloadEntries: 100,
  maximumPayloadArrayLength: 50,
  maximumPayloadBytes: 32768,
  maximumPayloadStringBytes: 8192,
  maximumPayloadKeyBytes: 256,
});

const ENVIRONMENTS = new Set(['local', 'test', 'staging', 'production']);
const CALLER_SCOPE_KINDS = new Set([
  'firebase_uid',
  'anonymous_principal',
  'internal_system',
]);
const STRIPE_MODES = new Set(['test', 'live']);
const DANGEROUS_PAYLOAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_SCOPE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SAFE_SLUG = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const CANONICAL_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;
const SAFE_STRIPE_KEY = /^[a-z0-9_]+$/;
const HASH_MAGIC = 'mprc-commerce-command-identity-sha256';
const HASH_DOMAINS = Object.freeze({
  commandKey: 'mprc.command-key.v1',
  payloadFingerprint: 'mprc.payload-fingerprint.v1',
  stripeIdempotencyKey: 'mprc.stripe-idempotency-key.v1',
});

const ERROR_MESSAGES = Object.freeze({
  invalid_argument_shape: 'Commerce command identity arguments are invalid.',
  invalid_environment: 'Commerce command environment is invalid.',
  invalid_caller_scope: 'Commerce command caller scope is invalid.',
  invalid_command_id: 'Commerce command ID is invalid.',
  invalid_command_type: 'Commerce command type is invalid.',
  invalid_payload: 'Commerce command payload is invalid.',
  payload_not_frozen: 'Commerce command payload must be deeply frozen.',
  payload_too_deep: 'Commerce command payload exceeds the depth limit.',
  payload_too_many_entries: 'Commerce command payload exceeds the entry limit.',
  payload_too_large: 'Commerce command payload exceeds the byte limit.',
  invalid_stripe_mode: 'Commerce command Stripe mode is invalid.',
  invalid_provider_operation: 'Commerce provider operation is invalid.',
  invalid_command_key_hash: 'Commerce command key hash is invalid.',
  invalid_provider_attempt: 'Commerce provider attempt is invalid.',
});

class CommandIdentityError extends Error {
  constructor(reason) {
    const safeReason = Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, reason)
      ? reason
      : 'invalid_argument_shape';
    super(ERROR_MESSAGES[safeReason]);
    this.name = 'CommandIdentityError';
    this.code = 'invalid_command_identity';
    this.reason = safeReason;
    Object.freeze(this);
  }
}

function fail(reason) {
  throw new CommandIdentityError(reason);
}

function readExactPlainDataObject(value, expectedKeys, reason = 'invalid_argument_shape') {
  if (value === null || typeof value !== 'object' || isProxy(value)) fail(reason);

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail(reason);
  }

  if (prototype !== Object.prototype || keys.length !== expectedKeys.length) fail(reason);
  const ownStringKeys = new Set();
  for (const key of keys) {
    if (typeof key !== 'string' || ownStringKeys.has(key)) fail(reason);
    ownStringKeys.add(key);
  }
  if (expectedKeys.some((key) => !ownStringKeys.has(key))) fail(reason);

  for (const key in value) {
    if (!ownStringKeys.has(key)) fail(reason);
  }

  const result = Object.create(null);
  for (const key of expectedKeys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      fail(reason);
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined) {
      fail(reason);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function isBoundedSafeAscii(value, expression, maximumLength) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximumLength
    && expression.test(value);
}

function validateEnvironment(environment) {
  if (typeof environment !== 'string' || !ENVIRONMENTS.has(environment)) {
    fail('invalid_environment');
  }
}

function validateCommandId(commandId) {
  if (typeof commandId !== 'string' || !CANONICAL_UUID_V4.test(commandId)) {
    fail('invalid_command_id');
  }
}

function validateCallerScope(callerScope) {
  const scope = readExactPlainDataObject(
    callerScope,
    ['kind', 'value'],
    'invalid_caller_scope',
  );
  if (typeof scope.kind !== 'string' || !CALLER_SCOPE_KINDS.has(scope.kind)) {
    fail('invalid_caller_scope');
  }
  if (scope.kind === 'firebase_uid') {
    const validUid = typeof scope.value === 'string'
      && scope.value.length > 0
      && hasValidUnicode(scope.value)
      && [...scope.value].length <= COMMAND_IDENTITY_LIMITS.maximumFirebaseUidCharacters
      && Buffer.byteLength(scope.value, 'utf8') <= COMMAND_IDENTITY_LIMITS.maximumFirebaseUidBytes
      && !hasUidControlCharacter(scope.value);
    if (!validUid) fail('invalid_caller_scope');
  } else if (scope.kind === 'anonymous_principal') {
    if (!isBoundedSafeAscii(
      scope.value,
      SAFE_SCOPE_VALUE,
      COMMAND_IDENTITY_LIMITS.maximumCallerScopeLength,
    )) {
      fail('invalid_caller_scope');
    }
  } else if (scope.value !== INTERNAL_SYSTEM_PRINCIPAL) {
    fail('invalid_caller_scope');
  }
  return scope;
}

function hasUidControlCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x1F || (codePoint >= 0x7F && codePoint <= 0x9F)) return true;
  }
  return false;
}

function validateSafeSlug(value, maximumLength, reason) {
  if (!isBoundedSafeAscii(value, SAFE_SLUG, maximumLength)) fail(reason);
}

function unsignedLength(length) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32BE(length, 0);
  return buffer;
}

function asBytes(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
}

function updateLengthFramed(hash, value) {
  const bytes = asBytes(value);
  hash.update(unsignedLength(bytes.length));
  hash.update(bytes);
}

function utf8Field(name, value) {
  return Object.freeze({ name, type: 'utf8', value: Buffer.from(value, 'utf8') });
}

function bytesField(name, value) {
  return Object.freeze({ name, type: 'bytes', value });
}

function digest(domain, fields) {
  const hash = createHash('sha256');
  updateLengthFramed(hash, HASH_MAGIC);
  updateLengthFramed(hash, domain);
  for (const field of fields) {
    updateLengthFramed(hash, field.name);
    updateLengthFramed(hash, field.type);
    updateLengthFramed(hash, field.value);
  }
  return hash.digest('hex');
}

function hasValidUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xDC00 || next > 0xDFFF) return false;
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return false;
    }
  }
  return true;
}

class CanonicalWriter {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }

  push(buffer) {
    if (this.length + buffer.length > COMMAND_IDENTITY_LIMITS.maximumPayloadBytes) {
      fail('payload_too_large');
    }
    this.chunks.push(buffer);
    this.length += buffer.length;
  }

  tag(tag) {
    this.push(Buffer.from(tag, 'ascii'));
  }

  count(value) {
    this.push(unsignedLength(value));
  }

  text(value, maximumBytes) {
    if (!hasValidUnicode(value)) fail('invalid_payload');
    if (value.length > maximumBytes) fail('payload_too_large');
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.length > maximumBytes) fail('payload_too_large');
    this.count(bytes.length);
    this.push(bytes);
  }

  finish() {
    return Buffer.concat(this.chunks, this.length);
  }
}

function inspectStructuredValue(value, expectedPrototype, reason = 'invalid_payload') {
  if (isProxy(value)) fail(reason);
  let prototype;
  let keys;
  let frozen;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    frozen = Object.isFrozen(value);
  } catch {
    fail(reason);
  }
  if (prototype !== expectedPrototype) fail(reason);
  if (!frozen) fail('payload_not_frozen');

  const ownStringKeys = new Set();
  for (const key of keys) {
    if (typeof key !== 'string' || ownStringKeys.has(key)) fail(reason);
    ownStringKeys.add(key);
  }
  for (const key in value) {
    if (!ownStringKeys.has(key)) fail(reason);
  }
  return { keys, ownStringKeys };
}

function readPayloadDataDescriptor(value, key) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    fail('invalid_payload');
  }
  if (!descriptor
    || descriptor.enumerable !== true
    || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    || descriptor.get !== undefined
    || descriptor.set !== undefined) {
    fail('invalid_payload');
  }
  return descriptor.value;
}

function addEntries(state, count) {
  state.entries += count;
  if (state.entries > COMMAND_IDENTITY_LIMITS.maximumPayloadEntries) {
    fail('payload_too_many_entries');
  }
}

function encodePayloadValue(value, writer, state, depth) {
  if (depth > COMMAND_IDENTITY_LIMITS.maximumPayloadDepth) fail('payload_too_deep');

  if (value === null) {
    writer.tag('z');
    return;
  }

  if (typeof value === 'boolean') {
    writer.tag(value ? 't' : 'f');
    return;
  }

  if (typeof value === 'string') {
    writer.tag('s');
    writer.text(value, COMMAND_IDENTITY_LIMITS.maximumPayloadStringBytes);
    return;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail('invalid_payload');
    writer.tag('i');
    writer.text(String(value), 32);
    return;
  }

  if (typeof value !== 'object') fail('invalid_payload');
  if (isProxy(value)) fail('invalid_payload');
  if (state.active.has(value)) fail('invalid_payload');
  state.active.add(value);
  try {
    if (Array.isArray(value)) {
      const { keys, ownStringKeys } = inspectStructuredValue(value, Array.prototype);
      if (!ownStringKeys.has('length') || keys.length !== value.length + 1) {
        fail('invalid_payload');
      }
      if (value.length > COMMAND_IDENTITY_LIMITS.maximumPayloadArrayLength) {
        fail('payload_too_many_entries');
      }
      addEntries(state, value.length);
      writer.tag('a');
      writer.count(value.length);
      for (let index = 0; index < value.length; index += 1) {
        const key = String(index);
        if (!ownStringKeys.has(key)) fail('invalid_payload');
        encodePayloadValue(
          readPayloadDataDescriptor(value, key),
          writer,
          state,
          depth + 1,
        );
      }
      return;
    }

    const { keys } = inspectStructuredValue(value, null);
    if (keys.length > COMMAND_IDENTITY_LIMITS.maximumPayloadEntries) {
      fail('payload_too_many_entries');
    }
    const sortedKeys = [...keys].sort();
    addEntries(state, sortedKeys.length);
    writer.tag('o');
    writer.count(sortedKeys.length);
    for (const key of sortedKeys) {
      if (DANGEROUS_PAYLOAD_KEYS.has(key) || !hasValidUnicode(key)) {
        fail('invalid_payload');
      }
      writer.tag('k');
      writer.text(key, COMMAND_IDENTITY_LIMITS.maximumPayloadKeyBytes);
      encodePayloadValue(
        readPayloadDataDescriptor(value, key),
        writer,
        state,
        depth + 1,
      );
    }
  } finally {
    state.active.delete(value);
  }
}

function canonicalPayload(payload) {
  if (payload === null
    || typeof payload !== 'object'
    || isProxy(payload)
    || Array.isArray(payload)) {
    fail('invalid_payload');
  }
  const writer = new CanonicalWriter();
  encodePayloadValue(payload, writer, { entries: 0, active: new WeakSet() }, 0);
  return writer.finish();
}

function createCommandKey(input) {
  const values = readExactPlainDataObject(
    input,
    ['environment', 'callerScope', 'commandId'],
  );
  validateEnvironment(values.environment);
  const scope = validateCallerScope(values.callerScope);
  validateCommandId(values.commandId);

  const commandKeyHash = digest(HASH_DOMAINS.commandKey, [
    utf8Field('version', String(commandIdentityVersion)),
    utf8Field('environment', values.environment),
    utf8Field('caller-scope-kind', scope.kind),
    utf8Field('caller-scope-value', scope.value),
    utf8Field('command-id', values.commandId),
  ]);
  return Object.freeze({ version: commandIdentityVersion, commandKeyHash });
}

function createPayloadFingerprint(input) {
  const values = readExactPlainDataObject(input, ['commandType', 'payload']);
  validateSafeSlug(
    values.commandType,
    COMMAND_IDENTITY_LIMITS.maximumCommandTypeLength,
    'invalid_command_type',
  );
  const encodedPayload = canonicalPayload(values.payload);
  const payloadFingerprint = digest(HASH_DOMAINS.payloadFingerprint, [
    utf8Field('version', String(commandIdentityVersion)),
    utf8Field('command-type', values.commandType),
    bytesField('canonical-payload', encodedPayload),
  ]);
  return Object.freeze({ version: commandIdentityVersion, payloadFingerprint });
}

function createStripeIdempotencyKey(input) {
  const values = readExactPlainDataObject(input, [
    'stripeMode',
    'environment',
    'providerOperation',
    'commandKeyHash',
    'providerAttempt',
  ]);
  if (typeof values.stripeMode !== 'string' || !STRIPE_MODES.has(values.stripeMode)) {
    fail('invalid_stripe_mode');
  }
  validateEnvironment(values.environment);
  const expectedMode = values.environment === 'production' ? 'live' : 'test';
  if (values.stripeMode !== expectedMode) fail('invalid_stripe_mode');
  validateSafeSlug(
    values.providerOperation,
    COMMAND_IDENTITY_LIMITS.maximumProviderOperationLength,
    'invalid_provider_operation',
  );
  if (typeof values.commandKeyHash !== 'string'
    || !LOWERCASE_SHA256.test(values.commandKeyHash)) {
    fail('invalid_command_key_hash');
  }
  if (!Number.isSafeInteger(values.providerAttempt)
    || values.providerAttempt < 1
    || values.providerAttempt > COMMAND_IDENTITY_LIMITS.maximumProviderAttempt) {
    fail('invalid_provider_attempt');
  }

  const keyDigest = digest(HASH_DOMAINS.stripeIdempotencyKey, [
    utf8Field('version', String(commandIdentityVersion)),
    utf8Field('environment', values.environment),
    utf8Field('stripe-mode', values.stripeMode),
    utf8Field('provider-operation', values.providerOperation),
    utf8Field('command-key-hash', values.commandKeyHash),
    utf8Field('provider-attempt', String(values.providerAttempt)),
  ]);
  const stripeIdempotencyKey = `mprc_ci_v${commandIdentityVersion}_${values.stripeMode}_${keyDigest}`;
  if (stripeIdempotencyKey.length >= 255 || !SAFE_STRIPE_KEY.test(stripeIdempotencyKey)) {
    fail('invalid_provider_operation');
  }
  return Object.freeze({ version: commandIdentityVersion, stripeIdempotencyKey });
}

Object.freeze(CommandIdentityError.prototype);
Object.freeze(CommandIdentityError);

module.exports = Object.freeze({
  commandIdentityVersion,
  INTERNAL_SYSTEM_PRINCIPAL,
  COMMAND_IDENTITY_LIMITS,
  CommandIdentityError,
  createCommandKey,
  createPayloadFingerprint,
  createStripeIdempotencyKey,
});
