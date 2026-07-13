const { types: { isProxy } } = require('node:util');
const { Timestamp } = require('firebase-admin/firestore');

const {
  commandIdentityVersion,
  CommandIdentityError,
  createCommandKey,
  createPayloadFingerprint,
} = require('./commerceCommandIdentity');

const journalSchemaVersion = 1;
const auditSchemaVersion = 1;
const MAXIMUM_ENDPOINT_SCHEMA_VERSION = 1000000;
const COMMAND_COLLECTION = 'checkoutRequests';
const AUDIT_COLLECTION = 'auditEvents';
const COMMAND_STATE = 'registered';
const COMMAND_REVISION = 1;
const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;
const SAFE_COMMAND_TYPE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const ENVIRONMENTS = new Set(['local', 'test', 'staging', 'production']);
const CALLER_SCOPE_KINDS = new Set([
  'firebase_uid',
  'anonymous_principal',
  'internal_system',
]);

const INPUT_FIELDS = Object.freeze([
  'db',
  'environment',
  'callerScope',
  'commandId',
  'commandType',
  'endpointSchemaVersion',
  'payload',
]);
const CALLER_SCOPE_FIELDS = Object.freeze(['kind', 'value']);
const COMMAND_FIELDS = Object.freeze([
  'journalSchemaVersion',
  'commandIdentityVersion',
  'endpointSchemaVersion',
  'environment',
  'callerScopeKind',
  'commandType',
  'payloadFingerprint',
  'state',
  'revision',
  'createdAt',
  'updatedAt',
]);
const AUDIT_FIELDS = Object.freeze([
  'auditSchemaVersion',
  'aggregateType',
  'commandKeyHash',
  'commandRevision',
  'eventType',
  'fromState',
  'toState',
  'environment',
  'callerScopeKind',
  'commandType',
  'occurredAt',
]);

const ERROR_MESSAGES = Object.freeze({
  invalid_command_input: 'Commerce command registration input is invalid.',
  command_conflict: 'Commerce command registration conflicts with an existing command.',
  journal_record_invalid: 'Commerce command registration record is invalid.',
  journal_unavailable: 'Commerce command registration is unavailable.',
});

class CommerceCommandJournalError extends Error {
  constructor(reason) {
    const safeReason = Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, reason)
      ? reason
      : 'journal_unavailable';
    super(ERROR_MESSAGES[safeReason]);
    this.name = 'CommerceCommandJournalError';
    this.code = 'commerce_command_journal_error';
    this.reason = safeReason;
    Object.freeze(this);
  }
}

function reject(reason) {
  throw new CommerceCommandJournalError(reason);
}

function readExactOwnDataObject(value, expectedFields, reason) {
  if (value === null || typeof value !== 'object' || isProxy(value)) reject(reason);

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    reject(reason);
  }
  if (prototype !== Object.prototype || keys.length !== expectedFields.length) reject(reason);

  const expected = new Set(expectedFields);
  const result = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || !expected.has(key)) reject(reason);
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
    result[key] = descriptor.value;
  }
  if (expectedFields.some((field) => !Object.prototype.hasOwnProperty.call(result, field))) {
    reject(reason);
  }
  return result;
}

function readTimestamp(value) {
  if (value === null || typeof value !== 'object' || isProxy(value)) return null;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (prototype !== Timestamp.prototype
    || keys.length !== 2
    || !keys.includes('_seconds')
    || !keys.includes('_nanoseconds')) {
    return null;
  }

  const values = Object.create(null);
  for (const key of keys) {
    if (key !== '_seconds' && key !== '_nanoseconds') return null;
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return null;
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined) {
      return null;
    }
    values[key] = descriptor.value;
  }

  const seconds = values._seconds;
  const nanoseconds = values._nanoseconds;
  if (!Number.isSafeInteger(seconds)
    || seconds < -62135596800
    || seconds > 253402300799
    || !Number.isSafeInteger(nanoseconds)
    || nanoseconds < 0
    || nanoseconds > 999999999) {
    return null;
  }
  return Object.freeze({ seconds, nanoseconds });
}

function timestampsEqual(first, second) {
  return first !== null
    && second !== null
    && first.seconds === second.seconds
    && first.nanoseconds === second.nanoseconds;
}

function validEndpointSchemaVersion(value) {
  return Number.isSafeInteger(value)
    && value >= 1
    && value <= MAXIMUM_ENDPOINT_SCHEMA_VERSION;
}

function validCommandType(value) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 64
    && SAFE_COMMAND_TYPE.test(value);
}

function validStoredCommand(record) {
  return record.journalSchemaVersion === journalSchemaVersion
    && record.commandIdentityVersion === commandIdentityVersion
    && validEndpointSchemaVersion(record.endpointSchemaVersion)
    && typeof record.environment === 'string'
    && ENVIRONMENTS.has(record.environment)
    && typeof record.callerScopeKind === 'string'
    && CALLER_SCOPE_KINDS.has(record.callerScopeKind)
    && validCommandType(record.commandType)
    && typeof record.payloadFingerprint === 'string'
    && LOWERCASE_SHA256.test(record.payloadFingerprint)
    && record.state === COMMAND_STATE
    && record.revision === COMMAND_REVISION;
}

function validStoredAudit(record) {
  return record.auditSchemaVersion === auditSchemaVersion
    && record.aggregateType === 'commerce_command'
    && typeof record.commandKeyHash === 'string'
    && LOWERCASE_SHA256.test(record.commandKeyHash)
    && record.commandRevision === COMMAND_REVISION
    && record.eventType === 'command_registered'
    && record.fromState === null
    && record.toState === COMMAND_STATE
    && typeof record.environment === 'string'
    && ENVIRONMENTS.has(record.environment)
    && typeof record.callerScopeKind === 'string'
    && CALLER_SCOPE_KINDS.has(record.callerScopeKind)
    && validCommandType(record.commandType);
}

function validateExistingPair(commandValue, auditValue, expected) {
  const command = readExactOwnDataObject(
    commandValue,
    COMMAND_FIELDS,
    'journal_record_invalid',
  );
  const audit = readExactOwnDataObject(
    auditValue,
    AUDIT_FIELDS,
    'journal_record_invalid',
  );
  const createdAt = readTimestamp(command.createdAt);
  const updatedAt = readTimestamp(command.updatedAt);
  const occurredAt = readTimestamp(audit.occurredAt);

  if (!validStoredCommand(command)
    || !validStoredAudit(audit)
    || !timestampsEqual(createdAt, updatedAt)
    || !timestampsEqual(createdAt, occurredAt)
    || audit.commandKeyHash !== expected.commandKeyHash
    || audit.commandRevision !== command.revision
    || audit.environment !== command.environment
    || audit.callerScopeKind !== command.callerScopeKind
    || audit.commandType !== command.commandType) {
    reject('journal_record_invalid');
  }

  // Environment and caller scope are part of B1's document identity. A mismatch
  // at this derived document is corruption, not a normal command reuse conflict.
  if (command.environment !== expected.environment
    || command.callerScopeKind !== expected.callerScopeKind) {
    reject('journal_record_invalid');
  }
  if (command.commandType !== expected.commandType
    || command.endpointSchemaVersion !== expected.endpointSchemaVersion
    || command.payloadFingerprint !== expected.payloadFingerprint) {
    reject('command_conflict');
  }
}

function readSnapshot(snapshot) {
  let exists;
  try {
    exists = snapshot.exists;
  } catch {
    reject('journal_unavailable');
  }
  if (exists === false) return Object.freeze({ exists: false, value: null });
  if (exists !== true) reject('journal_unavailable');

  let value;
  try {
    value = snapshot.data();
  } catch {
    reject('journal_unavailable');
  }
  return Object.freeze({ exists: true, value });
}

const REGISTERED_NEW = Object.freeze({
  journalSchemaVersion,
  outcome: 'registered_new',
  state: COMMAND_STATE,
});
const REGISTERED_EXISTING = Object.freeze({
  journalSchemaVersion,
  outcome: 'registered_existing',
  state: COMMAND_STATE,
});

async function registerCommerceCommand(input) {
  let values;
  let commandKey;
  let fingerprint;
  let callerScopeKind;
  try {
    values = readExactOwnDataObject(input, INPUT_FIELDS, 'invalid_command_input');
    if (!validEndpointSchemaVersion(values.endpointSchemaVersion)) {
      reject('invalid_command_input');
    }
    commandKey = createCommandKey({
      environment: values.environment,
      callerScope: values.callerScope,
      commandId: values.commandId,
    });
    fingerprint = createPayloadFingerprint({
      commandType: values.commandType,
      payload: values.payload,
    });
    const scope = readExactOwnDataObject(
      values.callerScope,
      CALLER_SCOPE_FIELDS,
      'invalid_command_input',
    );
    callerScopeKind = scope.kind;
  } catch (error) {
    if (error instanceof CommerceCommandJournalError) throw error;
    if (error instanceof CommandIdentityError) reject('invalid_command_input');
    reject('journal_unavailable');
  }

  let occurredAt;
  let commandRef;
  let auditRef;
  try {
    occurredAt = Timestamp.now();
    if (readTimestamp(occurredAt) === null) reject('journal_unavailable');
    Object.freeze(occurredAt);
    commandRef = values.db.collection(COMMAND_COLLECTION).doc(commandKey.commandKeyHash);
    auditRef = values.db.collection(AUDIT_COLLECTION).doc(
      `commerce_command_${commandKey.commandKeyHash}_0000000001`,
    );
  } catch (error) {
    if (error instanceof CommerceCommandJournalError) throw error;
    reject('journal_unavailable');
  }

  const commandRecord = Object.freeze({
    journalSchemaVersion,
    commandIdentityVersion,
    endpointSchemaVersion: values.endpointSchemaVersion,
    environment: values.environment,
    callerScopeKind,
    commandType: values.commandType,
    payloadFingerprint: fingerprint.payloadFingerprint,
    state: COMMAND_STATE,
    revision: COMMAND_REVISION,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  });
  const auditRecord = Object.freeze({
    auditSchemaVersion,
    aggregateType: 'commerce_command',
    commandKeyHash: commandKey.commandKeyHash,
    commandRevision: COMMAND_REVISION,
    eventType: 'command_registered',
    fromState: null,
    toState: COMMAND_STATE,
    environment: values.environment,
    callerScopeKind,
    commandType: values.commandType,
    occurredAt,
  });
  const expected = Object.freeze({
    commandKeyHash: commandKey.commandKeyHash,
    endpointSchemaVersion: values.endpointSchemaVersion,
    environment: values.environment,
    callerScopeKind,
    commandType: values.commandType,
    payloadFingerprint: fingerprint.payloadFingerprint,
  });

  try {
    const result = await values.db.runTransaction(async (transaction) => {
      const commandSnapshot = await transaction.get(commandRef);
      const auditSnapshot = await transaction.get(auditRef);
      const command = readSnapshot(commandSnapshot);
      const audit = readSnapshot(auditSnapshot);

      if (command.exists !== audit.exists) reject('journal_record_invalid');
      if (command.exists) {
        validateExistingPair(command.value, audit.value, expected);
        return REGISTERED_EXISTING;
      }

      transaction.create(commandRef, commandRecord);
      transaction.create(auditRef, auditRecord);
      return REGISTERED_NEW;
    });

    if (result !== REGISTERED_NEW && result !== REGISTERED_EXISTING) {
      reject('journal_unavailable');
    }
    return result;
  } catch (error) {
    if (error instanceof CommerceCommandJournalError) throw error;
    reject('journal_unavailable');
  }
}

Object.freeze(CommerceCommandJournalError.prototype);
Object.freeze(CommerceCommandJournalError);

module.exports = Object.freeze({
  journalSchemaVersion,
  CommerceCommandJournalError,
  registerCommerceCommand,
});
