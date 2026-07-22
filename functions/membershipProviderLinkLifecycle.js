'use strict';

const { types: { isProxy } } = require('node:util');
const { createHash } = require('node:crypto');
const {
  providerLinkSchemaVersion,
  MEMBERSHIP_PROVIDER_LINK_ENUMS,
  classifyProviderLinkReconciliation,
} = require('./membershipProviderLink');

const providerLinkLifecycleSchemaVersion = 1;
const PROVIDER_LINK_LIFECYCLE_ERROR_MESSAGE = 'Membership provider link lifecycle input is invalid.';
const MEMBERSHIP_REFERENCE_PATTERN = /^mbr_[A-Za-z0-9][A-Za-z0-9._:-]{0,123}$/;
const PROVIDER_ACCOUNT_REFERENCE_PATTERN = /^provider\.[A-Za-z0-9][A-Za-z0-9._:-]{0,118}$/;
const COMMAND_ID_PATTERN = /^cmd_[A-Za-z0-9][A-Za-z0-9._:-]{0,123}$/;
const ATTEMPT_REFERENCE_PATTERN = /^attempt\.[A-Za-z0-9][A-Za-z0-9._:-]{0,118}$/;
const PAYLOAD_HASH_PATTERN = /^[a-f0-9]{64}$/;

const CREATE_FIELDS = Object.freeze([
  'providerLinkLifecycleSchemaVersion',
  'provider',
  'membershipId',
  'providerAccountRef',
  'effectiveConsentDisposition',
  'commandId',
  'commandPayloadHash',
]);

const RECORD_FIELDS = Object.freeze([
  'providerLinkLifecycleSchemaVersion',
  'provider',
  'membershipId',
  'providerAccountRef',
  'effectiveConsentDisposition',
  'desiredState',
  'observedState',
  'boundMembershipId',
  'revision',
  'lastReconciliation',
  'lastCommand',
  'grantsAuthority',
]);

const RECONCILIATION_FIELDS = Object.freeze([
  'sequence',
  'outcome',
  'attemptRef',
  'errorCode',
]);

const LAST_COMMAND_FIELDS = Object.freeze([
  'commandId',
  'commandPayloadHash',
  'expectedRevision',
]);

const SET_CONSENT_FIELDS = Object.freeze([
  'providerLinkLifecycleSchemaVersion',
  'commandType',
  'commandId',
  'commandPayloadHash',
  'expectedRevision',
  'effectiveConsentDisposition',
]);

const REQUEST_STATE_FIELDS = Object.freeze([
  'providerLinkLifecycleSchemaVersion',
  'commandType',
  'commandId',
  'commandPayloadHash',
  'expectedRevision',
  'desiredState',
]);

const REPLACE_ACCOUNT_FIELDS = Object.freeze([
  'providerLinkLifecycleSchemaVersion',
  'commandType',
  'commandId',
  'commandPayloadHash',
  'expectedRevision',
  'providerAccountRef',
]);

const RECORD_RECONCILIATION_FIELDS = Object.freeze([
  'providerLinkLifecycleSchemaVersion',
  'commandType',
  'commandId',
  'commandPayloadHash',
  'expectedRevision',
  'providerAccountRef',
  'reconciledDesiredState',
  'reconciliationSequence',
  'outcome',
  'attemptRef',
  'observedState',
  'boundMembershipId',
  'errorCode',
]);

const MEMBERSHIP_PROVIDER_LINK_LIFECYCLE_ENUMS = Object.freeze({
  provider: MEMBERSHIP_PROVIDER_LINK_ENUMS.provider,
  effectiveConsentDisposition: Object.freeze([
    'active',
    'reaffirmation_required',
    'withdrawn',
    'not_consented',
  ]),
  desiredState: MEMBERSHIP_PROVIDER_LINK_ENUMS.desiredState,
  observedState: MEMBERSHIP_PROVIDER_LINK_ENUMS.observedState,
  commandType: Object.freeze([
    'set_consent',
    'request_state',
    'record_reconciliation',
    'replace_provider_account',
  ]),
  reconciliationOutcome: Object.freeze([
    'not_attempted',
    'succeeded',
    'definitive_failure',
    'outcome_unknown',
  ]),
  reconciliationErrorCode: Object.freeze([
    'none',
    'provider_definitive_failure',
    'provider_outcome_unknown',
  ]),
});

const PROVIDERS = new Set(MEMBERSHIP_PROVIDER_LINK_LIFECYCLE_ENUMS.provider);
const CONSENT_DISPOSITIONS = new Set(
  MEMBERSHIP_PROVIDER_LINK_LIFECYCLE_ENUMS.effectiveConsentDisposition,
);
const DESIRED_STATES = new Set(MEMBERSHIP_PROVIDER_LINK_LIFECYCLE_ENUMS.desiredState);
const OBSERVED_STATES = new Set(MEMBERSHIP_PROVIDER_LINK_LIFECYCLE_ENUMS.observedState);
const RECONCILIATION_OUTCOMES = new Set(
  MEMBERSHIP_PROVIDER_LINK_LIFECYCLE_ENUMS.reconciliationOutcome,
);
const RECONCILIATION_ERROR_CODES = new Set(
  MEMBERSHIP_PROVIDER_LINK_LIFECYCLE_ENUMS.reconciliationErrorCode,
);

const CONSENT_FOR_RECONCILIATION = Object.freeze({
  active: 'granted',
  reaffirmation_required: 'unknown',
  withdrawn: 'withdrawn',
  not_consented: 'unknown',
});

class MembershipProviderLinkLifecycleError extends Error {
  constructor() {
    super(PROVIDER_LINK_LIFECYCLE_ERROR_MESSAGE);
    Object.defineProperty(this, 'name', {
      value: 'MembershipProviderLinkLifecycleError',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'message', {
      value: PROVIDER_LINK_LIFECYCLE_ERROR_MESSAGE,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'code', {
      value: 'invalid_membership_provider_link_lifecycle',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Error.captureStackTrace?.(this, MembershipProviderLinkLifecycleError);
    Object.freeze(this);
  }
}

function fail() {
  throw new MembershipProviderLinkLifecycleError();
}

function readDataObject(value) {
  if (value === null || typeof value !== 'object' || isProxy(value)) fail();

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail();
  }
  if (prototype !== Object.prototype) fail();

  const data = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || Object.prototype.hasOwnProperty.call(data, key)) fail();
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      fail();
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined) {
      fail();
    }
    data[key] = descriptor.value;
  }
  return { data, keys };
}

function readExactObject(value, expectedFields) {
  const { data, keys } = readDataObject(value);
  if (keys.length !== expectedFields.length) fail();
  const keySet = new Set(keys);
  if (expectedFields.some((field) => !keySet.has(field))) fail();
  return data;
}

function requireVersion(value) {
  if (value !== providerLinkLifecycleSchemaVersion) fail();
}

function requirePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function requireMembershipReference(value) {
  return requirePattern(value, MEMBERSHIP_REFERENCE_PATTERN);
}

function requireProviderAccountReference(value) {
  return requirePattern(value, PROVIDER_ACCOUNT_REFERENCE_PATTERN);
}

function requireCommandId(value) {
  return requirePattern(value, COMMAND_ID_PATTERN);
}

function requireAttemptReference(value) {
  return requirePattern(value, ATTEMPT_REFERENCE_PATTERN);
}

function requirePayloadHash(value) {
  return requirePattern(value, PAYLOAD_HASH_PATTERN);
}

function requireSafeInteger(value, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail();
  return value;
}

function requireEnum(value, allowed) {
  if (!allowed.has(value)) fail();
  return value;
}

function payloadHash(values) {
  return createHash('sha256').update(JSON.stringify(values), 'utf8').digest('hex');
}

function createPayloadHash(data) {
  return payloadHash([
    providerLinkLifecycleSchemaVersion,
    'create_provider_link',
    data.provider,
    data.membershipId,
    data.providerAccountRef,
    data.effectiveConsentDisposition,
  ]);
}

function commandPayloadHash(command) {
  if (command.commandType === 'set_consent') {
    return payloadHash([
      providerLinkLifecycleSchemaVersion,
      command.commandType,
      command.effectiveConsentDisposition,
    ]);
  }
  if (command.commandType === 'request_state') {
    return payloadHash([
      providerLinkLifecycleSchemaVersion,
      command.commandType,
      command.desiredState,
    ]);
  }
  if (command.commandType === 'replace_provider_account') {
    return payloadHash([
      providerLinkLifecycleSchemaVersion,
      command.commandType,
      command.providerAccountRef,
    ]);
  }
  return payloadHash([
    providerLinkLifecycleSchemaVersion,
    command.commandType,
    command.providerAccountRef,
    command.reconciledDesiredState,
    command.reconciliationSequence,
    command.outcome,
    command.attemptRef,
    command.observedState,
    command.boundMembershipId,
    command.errorCode,
  ]);
}

function readLastReconciliation(value) {
  const reconciliation = readExactObject(value, RECONCILIATION_FIELDS);
  requireSafeInteger(reconciliation.sequence);
  requireEnum(reconciliation.outcome, RECONCILIATION_OUTCOMES);
  requireEnum(reconciliation.errorCode, RECONCILIATION_ERROR_CODES);

  if (reconciliation.outcome === 'not_attempted') {
    if (reconciliation.sequence !== 0
      || reconciliation.attemptRef !== null
      || reconciliation.errorCode !== 'none') {
      fail();
    }
    return reconciliation;
  }

  if (reconciliation.sequence < 1) fail();
  requireAttemptReference(reconciliation.attemptRef);
  if (reconciliation.outcome === 'succeeded') {
    if (reconciliation.errorCode !== 'none') fail();
  } else if (reconciliation.outcome === 'definitive_failure') {
    if (reconciliation.errorCode !== 'provider_definitive_failure') fail();
  } else if (reconciliation.errorCode !== 'provider_outcome_unknown') {
    fail();
  }
  return reconciliation;
}

function readLastCommand(value) {
  const command = readExactObject(value, LAST_COMMAND_FIELDS);
  requireCommandId(command.commandId);
  requirePayloadHash(command.commandPayloadHash);
  requireSafeInteger(command.expectedRevision);
  return command;
}

function readRecord(value) {
  const record = readExactObject(value, RECORD_FIELDS);
  requireVersion(record.providerLinkLifecycleSchemaVersion);
  requireEnum(record.provider, PROVIDERS);
  requireMembershipReference(record.membershipId);
  requireProviderAccountReference(record.providerAccountRef);
  requireEnum(record.effectiveConsentDisposition, CONSENT_DISPOSITIONS);
  requireEnum(record.desiredState, DESIRED_STATES);
  requireEnum(record.observedState, OBSERVED_STATES);
  if (record.boundMembershipId !== null) {
    requireMembershipReference(record.boundMembershipId);
  }
  requireSafeInteger(record.revision, 1);
  const lastReconciliation = readLastReconciliation(record.lastReconciliation);
  const lastCommand = readLastCommand(record.lastCommand);

  if (record.grantsAuthority !== false
    || lastCommand.expectedRevision !== record.revision - 1
    || lastReconciliation.sequence > record.revision - 1) {
    fail();
  }
  if (record.revision === 1
    && (record.desiredState !== 'unlinked'
      || record.observedState !== 'unknown'
      || record.boundMembershipId !== null
      || lastReconciliation.outcome !== 'not_attempted'
      || lastCommand.commandPayloadHash !== createPayloadHash(record))) {
    fail();
  }
  if (record.observedState !== 'linked' && record.boundMembershipId !== null) fail();
  if (lastReconciliation.outcome === 'not_attempted'
    && (record.observedState !== 'unknown' || record.boundMembershipId !== null)) {
    fail();
  }
  if (lastReconciliation.outcome === 'outcome_unknown'
    && (record.observedState !== 'unknown' || record.boundMembershipId !== null)) {
    fail();
  }
  if (lastReconciliation.outcome === 'succeeded'
    && record.observedState === 'unknown'
    && record.revision < lastReconciliation.sequence + 3) {
    fail();
  }

  return {
    provider: record.provider,
    membershipId: record.membershipId,
    providerAccountRef: record.providerAccountRef,
    effectiveConsentDisposition: record.effectiveConsentDisposition,
    desiredState: record.desiredState,
    observedState: record.observedState,
    boundMembershipId: record.boundMembershipId,
    revision: record.revision,
    lastReconciliation,
    lastCommand,
  };
}

function freezeRecord(record) {
  const lastReconciliation = Object.freeze({
    sequence: record.lastReconciliation.sequence,
    outcome: record.lastReconciliation.outcome,
    attemptRef: record.lastReconciliation.attemptRef,
    errorCode: record.lastReconciliation.errorCode,
  });
  const lastCommand = Object.freeze({
    commandId: record.lastCommand.commandId,
    commandPayloadHash: record.lastCommand.commandPayloadHash,
    expectedRevision: record.lastCommand.expectedRevision,
  });
  return Object.freeze({
    providerLinkLifecycleSchemaVersion,
    provider: record.provider,
    membershipId: record.membershipId,
    providerAccountRef: record.providerAccountRef,
    effectiveConsentDisposition: record.effectiveConsentDisposition,
    desiredState: record.desiredState,
    observedState: record.observedState,
    boundMembershipId: record.boundMembershipId,
    revision: record.revision,
    lastReconciliation,
    lastCommand,
    grantsAuthority: false,
  });
}

function canonicalRecord(value, record) {
  if (Object.isFrozen(value)
    && Object.isFrozen(value.lastReconciliation)
    && Object.isFrozen(value.lastCommand)) {
    return value;
  }
  return freezeRecord(record);
}

function createProviderLinkLifecycle(input) {
  const data = readExactObject(input, CREATE_FIELDS);
  requireVersion(data.providerLinkLifecycleSchemaVersion);
  requireEnum(data.provider, PROVIDERS);
  requireMembershipReference(data.membershipId);
  requireProviderAccountReference(data.providerAccountRef);
  requireEnum(data.effectiveConsentDisposition, CONSENT_DISPOSITIONS);
  requireCommandId(data.commandId);
  requirePayloadHash(data.commandPayloadHash);
  if (data.commandPayloadHash !== createPayloadHash(data)) fail();

  return freezeRecord({
    provider: data.provider,
    membershipId: data.membershipId,
    providerAccountRef: data.providerAccountRef,
    effectiveConsentDisposition: data.effectiveConsentDisposition,
    desiredState: 'unlinked',
    observedState: 'unknown',
    boundMembershipId: null,
    revision: 1,
    lastReconciliation: {
      sequence: 0,
      outcome: 'not_attempted',
      attemptRef: null,
      errorCode: 'none',
    },
    lastCommand: {
      commandId: data.commandId,
      commandPayloadHash: data.commandPayloadHash,
      expectedRevision: 0,
    },
  });
}

function readCommand(input) {
  const inspected = readDataObject(input);
  const commandType = inspected.data.commandType;
  let expectedFields;
  if (commandType === 'set_consent') {
    expectedFields = SET_CONSENT_FIELDS;
  } else if (commandType === 'request_state') {
    expectedFields = REQUEST_STATE_FIELDS;
  } else if (commandType === 'record_reconciliation') {
    expectedFields = RECORD_RECONCILIATION_FIELDS;
  } else if (commandType === 'replace_provider_account') {
    expectedFields = REPLACE_ACCOUNT_FIELDS;
  } else {
    fail();
  }

  if (inspected.keys.length !== expectedFields.length) fail();
  const keySet = new Set(inspected.keys);
  if (expectedFields.some((field) => !keySet.has(field))) fail();

  const command = inspected.data;
  requireVersion(command.providerLinkLifecycleSchemaVersion);
  requireCommandId(command.commandId);
  requirePayloadHash(command.commandPayloadHash);
  requireSafeInteger(command.expectedRevision, 1);

  if (commandType === 'set_consent') {
    requireEnum(command.effectiveConsentDisposition, CONSENT_DISPOSITIONS);
  } else if (commandType === 'request_state') {
    requireEnum(command.desiredState, DESIRED_STATES);
  } else if (commandType === 'replace_provider_account') {
    requireProviderAccountReference(command.providerAccountRef);
  } else {
    requireProviderAccountReference(command.providerAccountRef);
    requireEnum(command.reconciledDesiredState, DESIRED_STATES);
    requireSafeInteger(command.reconciliationSequence, 1);
    requireEnum(command.outcome, RECONCILIATION_OUTCOMES);
    if (command.outcome === 'not_attempted') fail();
    requireAttemptReference(command.attemptRef);
    requireEnum(command.errorCode, RECONCILIATION_ERROR_CODES);

    if (command.outcome === 'succeeded') {
      requireEnum(command.observedState, OBSERVED_STATES);
      if (command.observedState === 'unknown' || command.errorCode !== 'none') fail();
      if (command.observedState === 'unlinked' && command.boundMembershipId !== null) fail();
      if (command.observedState === 'linked' && command.boundMembershipId !== null) {
        requireMembershipReference(command.boundMembershipId);
      }
    } else {
      if (command.observedState !== null || command.boundMembershipId !== null) fail();
      const expectedError = command.outcome === 'definitive_failure'
        ? 'provider_definitive_failure'
        : 'provider_outcome_unknown';
      if (command.errorCode !== expectedError) fail();
    }
  }
  if (command.commandPayloadHash !== commandPayloadHash(command)) fail();
  return command;
}

function applyProviderLinkLifecycleCommand(recordInput, commandInput) {
  const record = readRecord(recordInput);
  const command = readCommand(commandInput);
  const current = canonicalRecord(recordInput, record);

  if (command.commandId === record.lastCommand.commandId) {
    if (command.commandPayloadHash !== record.lastCommand.commandPayloadHash
      || command.expectedRevision !== record.lastCommand.expectedRevision) {
      fail();
    }
    return current;
  }

  if (command.expectedRevision !== record.revision
    || record.revision === Number.MAX_SAFE_INTEGER) {
    fail();
  }

  const next = {
    ...record,
    revision: record.revision + 1,
    lastCommand: {
      commandId: command.commandId,
      commandPayloadHash: command.commandPayloadHash,
      expectedRevision: command.expectedRevision,
    },
  };

  if (command.commandType === 'set_consent') {
    if (command.effectiveConsentDisposition === record.effectiveConsentDisposition) fail();
    next.effectiveConsentDisposition = command.effectiveConsentDisposition;
  } else if (command.commandType === 'request_state') {
    if (command.desiredState === record.desiredState) fail();
    next.desiredState = command.desiredState;
    if (record.observedState !== 'unknown'
      && command.desiredState === record.observedState) {
      next.observedState = 'unknown';
      next.boundMembershipId = null;
    }
  } else if (command.commandType === 'replace_provider_account') {
    if (command.providerAccountRef === record.providerAccountRef
      || record.desiredState !== 'unlinked'
      || record.observedState !== 'unlinked'
      || record.boundMembershipId !== null) {
      fail();
    }
    next.providerAccountRef = command.providerAccountRef;
    next.observedState = 'unknown';
    next.boundMembershipId = null;
    next.lastReconciliation = {
      sequence: 0,
      outcome: 'not_attempted',
      attemptRef: null,
      errorCode: 'none',
    };
  } else {
    if (command.providerAccountRef !== record.providerAccountRef
      || command.reconciledDesiredState !== record.desiredState
      || record.lastReconciliation.sequence === Number.MAX_SAFE_INTEGER
      || command.reconciliationSequence !== record.lastReconciliation.sequence + 1) {
      fail();
    }
    if (command.outcome === 'succeeded'
      && command.observedState !== record.desiredState) {
      fail();
    }

    next.lastReconciliation = {
      sequence: command.reconciliationSequence,
      outcome: command.outcome,
      attemptRef: command.attemptRef,
      errorCode: command.errorCode,
    };
    if (command.outcome === 'succeeded') {
      next.observedState = command.observedState;
      next.boundMembershipId = command.boundMembershipId;
    } else if (command.outcome === 'outcome_unknown') {
      next.observedState = 'unknown';
      next.boundMembershipId = null;
    }
  }

  return freezeRecord(next);
}

function deriveProviderLinkLifecycleVerdict(recordInput) {
  const record = readRecord(recordInput);
  const result = classifyProviderLinkReconciliation({
    providerLinkSchemaVersion,
    provider: record.provider,
    membershipId: record.membershipId,
    providerAccountRef: record.providerAccountRef,
    consent: CONSENT_FOR_RECONCILIATION[record.effectiveConsentDisposition],
    desiredState: record.desiredState,
    observedState: record.observedState,
    boundMembershipId: record.boundMembershipId,
  });
  return Object.freeze({
    providerLinkLifecycleSchemaVersion,
    disposition: result.disposition,
    reason: result.reason,
    grantsAuthority: false,
  });
}

Object.freeze(MembershipProviderLinkLifecycleError.prototype);
Object.freeze(MembershipProviderLinkLifecycleError);

module.exports = Object.freeze({
  providerLinkLifecycleSchemaVersion,
  MEMBERSHIP_PROVIDER_LINK_LIFECYCLE_ENUMS,
  MembershipProviderLinkLifecycleError,
  createProviderLinkLifecycle,
  applyProviderLinkLifecycleCommand,
  deriveProviderLinkLifecycleVerdict,
});
