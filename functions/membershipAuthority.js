'use strict';

const { types: { isProxy } } = require('node:util');

const membershipAuthoritySchemaVersion = 1;
const MEMBERSHIP_AUTHORITY_ERROR_MESSAGE = 'Membership authority input is invalid.';
const MAX_TIME_MS = 8_640_000_000_000_000;
const OPAQUE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const CREATE_FIELDS = Object.freeze([
  'membershipAuthoritySchemaVersion',
  'membershipId',
  'commandId',
]);

const ASSOCIATE_COMMAND_FIELDS = Object.freeze([
  'membershipAuthoritySchemaVersion',
  'commandType',
  'commandId',
  'expectedRevision',
  'uid',
]);

const TERM_COMMAND_FIELDS = Object.freeze([
  'membershipAuthoritySchemaVersion',
  'commandType',
  'commandId',
  'expectedRevision',
  'termRevision',
  'termState',
  'termId',
  'startsAtMs',
  'endsAtMs',
  'planRef',
  'evidenceRef',
  'policyVersion',
]);

const RECORD_FIELDS = Object.freeze([
  'membershipAuthoritySchemaVersion',
  'membershipId',
  'revision',
  'association',
  'term',
  'lastCommand',
]);

const ASSOCIATION_FIELDS = Object.freeze([
  'state',
  'uid',
  'revision',
]);

const TERM_FIELDS = Object.freeze([
  'state',
  'termId',
  'startsAtMs',
  'endsAtMs',
  'planRef',
  'evidenceRef',
  'policyVersion',
  'revision',
]);

const LAST_COMMAND_FIELDS = Object.freeze([
  'commandType',
  'commandId',
  'expectedRevision',
]);

const ENTITLEMENT_INPUT_FIELDS = Object.freeze([
  'membershipAuthoritySchemaVersion',
  'record',
  'uid',
  'asOfMs',
]);

const MEMBERSHIP_AUTHORITY_ENUMS = Object.freeze({
  associationState: Object.freeze(['unlinked', 'linked']),
  commandType: Object.freeze([
    'create_membership',
    'associate_account',
    'record_term_decision',
  ]),
  termState: Object.freeze([
    'decision_pending',
    'approved',
    'suspended',
    'ended',
  ]),
});

const ASSOCIATION_STATES = new Set(MEMBERSHIP_AUTHORITY_ENUMS.associationState);
const COMMAND_TYPES = new Set(MEMBERSHIP_AUTHORITY_ENUMS.commandType);
const TERM_STATES = new Set(MEMBERSHIP_AUTHORITY_ENUMS.termState);

const RESULTS = Object.freeze({
  active: Object.freeze({
    membershipAuthoritySchemaVersion,
    entitlement: 'current_member',
    state: 'active',
  }),
  inactive: Object.freeze({
    membershipAuthoritySchemaVersion,
    entitlement: 'not_entitled',
    state: 'inactive',
  }),
  pending: Object.freeze({
    membershipAuthoritySchemaVersion,
    entitlement: 'decision_pending',
    state: 'requires_policy_decision',
  }),
});

class MembershipAuthorityError extends Error {
  constructor() {
    super(MEMBERSHIP_AUTHORITY_ERROR_MESSAGE);
    Object.defineProperty(this, 'name', {
      value: 'MembershipAuthorityError',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'message', {
      value: MEMBERSHIP_AUTHORITY_ERROR_MESSAGE,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'code', {
      value: 'invalid_membership_authority',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Error.captureStackTrace?.(this, MembershipAuthorityError);
    Object.freeze(this);
  }
}

function fail() {
  throw new MembershipAuthorityError();
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
  if (value !== membershipAuthoritySchemaVersion) fail();
}

function requireOpaqueIdentifier(value) {
  if (typeof value !== 'string' || !OPAQUE_IDENTIFIER_PATTERN.test(value)) fail();
  return value;
}

function requireRevision(value, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail();
  return value;
}

function requireTime(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIME_MS) fail();
  return value;
}

function freezeRecord(record) {
  const association = Object.freeze({
    state: record.association.state,
    uid: record.association.uid,
    revision: record.association.revision,
  });
  const term = Object.freeze({
    state: record.term.state,
    termId: record.term.termId,
    startsAtMs: record.term.startsAtMs,
    endsAtMs: record.term.endsAtMs,
    planRef: record.term.planRef,
    evidenceRef: record.term.evidenceRef,
    policyVersion: record.term.policyVersion,
    revision: record.term.revision,
  });
  const lastCommand = Object.freeze({
    commandType: record.lastCommand.commandType,
    commandId: record.lastCommand.commandId,
    expectedRevision: record.lastCommand.expectedRevision,
  });
  return Object.freeze({
    membershipAuthoritySchemaVersion,
    membershipId: record.membershipId,
    revision: record.revision,
    association,
    term,
    lastCommand,
  });
}

function readAssociation(value) {
  const association = readExactObject(value, ASSOCIATION_FIELDS);
  if (!ASSOCIATION_STATES.has(association.state)) fail();
  requireRevision(association.revision);

  if (association.state === 'unlinked') {
    if (association.uid !== null || association.revision !== 0) fail();
  } else {
    requireOpaqueIdentifier(association.uid);
    if (association.revision !== 1) fail();
  }
  return association;
}

function readTerm(value) {
  const term = readExactObject(value, TERM_FIELDS);
  if (!TERM_STATES.has(term.state)) fail();
  requireRevision(term.revision);

  if (term.revision === 0) {
    if (term.state !== 'decision_pending'
      || term.termId !== null
      || term.startsAtMs !== null
      || term.endsAtMs !== null
      || term.planRef !== null
      || term.evidenceRef !== null
      || term.policyVersion !== null) {
      fail();
    }
    return term;
  }

  requireOpaqueIdentifier(term.termId);
  requireTime(term.startsAtMs);
  requireTime(term.endsAtMs);
  if (term.startsAtMs >= term.endsAtMs) fail();
  requireOpaqueIdentifier(term.planRef);
  requireOpaqueIdentifier(term.evidenceRef);
  requireOpaqueIdentifier(term.policyVersion);
  return term;
}

function readLastCommand(value) {
  const command = readExactObject(value, LAST_COMMAND_FIELDS);
  if (!COMMAND_TYPES.has(command.commandType)) fail();
  requireOpaqueIdentifier(command.commandId);
  requireRevision(command.expectedRevision);
  return command;
}

function readRecord(value) {
  const record = readExactObject(value, RECORD_FIELDS);
  requireVersion(record.membershipAuthoritySchemaVersion);
  requireOpaqueIdentifier(record.membershipId);
  requireRevision(record.revision, 1);
  const association = readAssociation(record.association);
  const term = readTerm(record.term);
  const lastCommand = readLastCommand(record.lastCommand);

  if (record.revision !== 1 + association.revision + term.revision
    || lastCommand.expectedRevision !== record.revision - 1) {
    fail();
  }

  if (lastCommand.commandType === 'create_membership') {
    if (record.revision !== 1 || association.revision !== 0 || term.revision !== 0) fail();
  } else if (lastCommand.commandType === 'associate_account') {
    if (association.revision !== 1) fail();
  } else if (term.revision < 1) {
    fail();
  }

  return {
    membershipId: record.membershipId,
    revision: record.revision,
    association,
    term,
    lastCommand,
  };
}

function canonicalRecord(value, record) {
  if (Object.isFrozen(value)
    && Object.isFrozen(value.association)
    && Object.isFrozen(value.term)
    && Object.isFrozen(value.lastCommand)) {
    return value;
  }
  return freezeRecord(record);
}

function createMembershipAuthority(input) {
  const data = readExactObject(input, CREATE_FIELDS);
  requireVersion(data.membershipAuthoritySchemaVersion);
  requireOpaqueIdentifier(data.membershipId);
  requireOpaqueIdentifier(data.commandId);

  return freezeRecord({
    membershipId: data.membershipId,
    revision: 1,
    association: {
      state: 'unlinked',
      uid: null,
      revision: 0,
    },
    term: {
      state: 'decision_pending',
      termId: null,
      startsAtMs: null,
      endsAtMs: null,
      planRef: null,
      evidenceRef: null,
      policyVersion: null,
      revision: 0,
    },
    lastCommand: {
      commandType: 'create_membership',
      commandId: data.commandId,
      expectedRevision: 0,
    },
  });
}

function readCommand(input) {
  const inspected = readDataObject(input);
  const commandType = inspected.data.commandType;
  let expectedFields;
  if (commandType === 'associate_account') {
    expectedFields = ASSOCIATE_COMMAND_FIELDS;
  } else if (commandType === 'record_term_decision') {
    expectedFields = TERM_COMMAND_FIELDS;
  } else {
    fail();
  }

  if (inspected.keys.length !== expectedFields.length) fail();
  const keySet = new Set(inspected.keys);
  if (expectedFields.some((field) => !keySet.has(field))) fail();

  const command = inspected.data;
  requireVersion(command.membershipAuthoritySchemaVersion);
  requireOpaqueIdentifier(command.commandId);
  requireRevision(command.expectedRevision, 1);

  if (commandType === 'associate_account') {
    requireOpaqueIdentifier(command.uid);
    return command;
  }

  requireRevision(command.termRevision, 1);
  if (!TERM_STATES.has(command.termState)) fail();
  requireOpaqueIdentifier(command.termId);
  requireTime(command.startsAtMs);
  requireTime(command.endsAtMs);
  if (command.startsAtMs >= command.endsAtMs) fail();
  requireOpaqueIdentifier(command.planRef);
  requireOpaqueIdentifier(command.evidenceRef);
  requireOpaqueIdentifier(command.policyVersion);
  return command;
}

function isExactAssociationRetry(record, command) {
  return record.lastCommand.commandType === 'associate_account'
    && record.lastCommand.commandId === command.commandId
    && record.lastCommand.expectedRevision === command.expectedRevision
    && record.association.state === 'linked'
    && record.association.uid === command.uid;
}

function isExactTermRetry(record, command) {
  return record.lastCommand.commandType === 'record_term_decision'
    && record.lastCommand.commandId === command.commandId
    && record.lastCommand.expectedRevision === command.expectedRevision
    && record.term.revision === command.termRevision
    && record.term.state === command.termState
    && record.term.termId === command.termId
    && record.term.startsAtMs === command.startsAtMs
    && record.term.endsAtMs === command.endsAtMs
    && record.term.planRef === command.planRef
    && record.term.evidenceRef === command.evidenceRef
    && record.term.policyVersion === command.policyVersion;
}

function applyMembershipAuthorityCommand(recordInput, commandInput) {
  const record = readRecord(recordInput);
  const command = readCommand(commandInput);
  const current = canonicalRecord(recordInput, record);

  if (command.commandId === record.lastCommand.commandId) {
    const exact = command.commandType === 'associate_account'
      ? isExactAssociationRetry(record, command)
      : isExactTermRetry(record, command);
    if (!exact) fail();
    return current;
  }

  if (command.expectedRevision !== record.revision) fail();
  if (record.revision === Number.MAX_SAFE_INTEGER) fail();

  const nextRevision = record.revision + 1;

  if (command.commandType === 'associate_account') {
    if (record.association.state !== 'unlinked') fail();
    return freezeRecord({
      ...record,
      revision: nextRevision,
      association: {
        state: 'linked',
        uid: command.uid,
        revision: 1,
      },
      lastCommand: {
        commandType: command.commandType,
        commandId: command.commandId,
        expectedRevision: command.expectedRevision,
      },
    });
  }

  if (command.termRevision !== record.term.revision + 1) {
    fail();
  }
  return freezeRecord({
    ...record,
    revision: nextRevision,
    term: {
      state: command.termState,
      termId: command.termId,
      startsAtMs: command.startsAtMs,
      endsAtMs: command.endsAtMs,
      planRef: command.planRef,
      evidenceRef: command.evidenceRef,
      policyVersion: command.policyVersion,
      revision: command.termRevision,
    },
    lastCommand: {
      commandType: command.commandType,
      commandId: command.commandId,
      expectedRevision: command.expectedRevision,
    },
  });
}

function deriveMembershipEntitlement(input) {
  const data = readExactObject(input, ENTITLEMENT_INPUT_FIELDS);
  requireVersion(data.membershipAuthoritySchemaVersion);
  requireOpaqueIdentifier(data.uid);
  requireTime(data.asOfMs);
  const record = readRecord(data.record);

  if (record.association.state !== 'linked' || record.association.uid !== data.uid) {
    return RESULTS.inactive;
  }
  if (record.term.state === 'decision_pending') return RESULTS.pending;
  if (record.term.state !== 'approved') return RESULTS.inactive;
  if (data.asOfMs < record.term.startsAtMs || data.asOfMs >= record.term.endsAtMs) {
    return RESULTS.inactive;
  }
  return RESULTS.active;
}

Object.freeze(MembershipAuthorityError.prototype);
Object.freeze(MembershipAuthorityError);

module.exports = Object.freeze({
  membershipAuthoritySchemaVersion,
  MEMBERSHIP_AUTHORITY_ENUMS,
  MembershipAuthorityError,
  createMembershipAuthority,
  applyMembershipAuthorityCommand,
  deriveMembershipEntitlement,
});
