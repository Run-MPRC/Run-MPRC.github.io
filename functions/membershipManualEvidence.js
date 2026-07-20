'use strict';

// Source-only, unused contract (MEMBERS-ADMIN-001A). Given one officer-attested
// off-platform dues-evidence command, it validates an exact officer-audit
// envelope and projects two paired, frozen values: the exact
// `record_term_decision` input the shipped membership authority reducer accepts,
// and an immutable audit record stamped with a manual, off-platform provenance.
// It invents no policy (every owner-meaningful value is carried through as an
// opaque token), reads no stored record, contacts no provider, and fabricates
// no external charge state. No runtime imports it.

const { types: { isProxy } } = require('node:util');

// This slice owns the audit-record schema version.
const membershipManualEvidenceSchemaVersion = 1;
// The shipped reducer's command schema version, re-declared locally so this
// contract stays standalone. The integration test imports the real reducer and
// fails if this constant ever drifts from it.
const MEMBERSHIP_AUTHORITY_SCHEMA_VERSION = 1;

const MEMBERSHIP_MANUAL_EVIDENCE_ERROR_MESSAGE = 'Membership manual evidence input is invalid.';
const MAX_TIME_MS = 8_640_000_000_000_000;
const OPAQUE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

// Structural constants this slice always emits; none is an owner policy value.
const RECORD_TERM_DECISION_COMMAND_TYPE = 'record_term_decision';
const APPROVED_TERM_STATE = 'approved';
const MANUAL_OFF_PLATFORM_PROVENANCE = 'manual_off_platform';

const OFFICER_COMMAND_FIELDS = Object.freeze([
  'membershipManualEvidenceSchemaVersion',
  'commandId',
  'actorRef',
  'capabilityRef',
  'recentAuthRef',
  'membershipId',
  'evidenceCategoryRef',
  'evidenceRef',
  'reasonRef',
  'correlationRef',
  'expectedRevision',
  'termRevision',
  'termId',
  'startsAtMs',
  'endsAtMs',
  'planRef',
  'policyVersion',
]);

const MEMBERSHIP_MANUAL_EVIDENCE_ENUMS = Object.freeze({
  provenance: Object.freeze([MANUAL_OFF_PLATFORM_PROVENANCE]),
  termState: Object.freeze([APPROVED_TERM_STATE]),
});

class MembershipManualEvidenceError extends Error {
  constructor() {
    super(MEMBERSHIP_MANUAL_EVIDENCE_ERROR_MESSAGE);
    Object.defineProperty(this, 'name', {
      value: 'MembershipManualEvidenceError',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'message', {
      value: MEMBERSHIP_MANUAL_EVIDENCE_ERROR_MESSAGE,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'code', {
      value: 'invalid_membership_manual_evidence',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Error.captureStackTrace?.(this, MembershipManualEvidenceError);
    Object.freeze(this);
  }
}

function fail() {
  throw new MembershipManualEvidenceError();
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
  if (value !== membershipManualEvidenceSchemaVersion) fail();
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

function projectManualDuesEvidence(input) {
  const command = readExactObject(input, OFFICER_COMMAND_FIELDS);
  requireVersion(command.membershipManualEvidenceSchemaVersion);

  const commandId = requireOpaqueIdentifier(command.commandId);
  const actorRef = requireOpaqueIdentifier(command.actorRef);
  const capabilityRef = requireOpaqueIdentifier(command.capabilityRef);
  const recentAuthRef = requireOpaqueIdentifier(command.recentAuthRef);
  const membershipId = requireOpaqueIdentifier(command.membershipId);
  const evidenceCategoryRef = requireOpaqueIdentifier(command.evidenceCategoryRef);
  const evidenceRef = requireOpaqueIdentifier(command.evidenceRef);
  const reasonRef = requireOpaqueIdentifier(command.reasonRef);
  const correlationRef = requireOpaqueIdentifier(command.correlationRef);
  const expectedRevision = requireRevision(command.expectedRevision, 1);
  const termRevision = requireRevision(command.termRevision, 1);
  const termId = requireOpaqueIdentifier(command.termId);
  const startsAtMs = requireTime(command.startsAtMs);
  const endsAtMs = requireTime(command.endsAtMs);
  if (startsAtMs >= endsAtMs) fail();
  const planRef = requireOpaqueIdentifier(command.planRef);
  const policyVersion = requireOpaqueIdentifier(command.policyVersion);

  // The exact `record_term_decision` command the shipped reducer accepts. The
  // command type and the approved term state are the fixed identity of this
  // slice; every other value is carried through from the officer envelope.
  const reducerCommand = Object.freeze({
    membershipAuthoritySchemaVersion: MEMBERSHIP_AUTHORITY_SCHEMA_VERSION,
    commandType: RECORD_TERM_DECISION_COMMAND_TYPE,
    commandId,
    expectedRevision,
    termRevision,
    termState: APPROVED_TERM_STATE,
    termId,
    startsAtMs,
    endsAtMs,
    planRef,
    evidenceRef,
    policyVersion,
  });

  // The paired audit record: who acted, under what capability and recent
  // re-auth, on which membership and term, with what off-platform evidence, and
  // why. It is stamped manual/off-platform and carries no external charge
  // identifier, so "records dues without claiming an external charge" stays a
  // testable invariant.
  const auditRecord = Object.freeze({
    membershipManualEvidenceSchemaVersion,
    provenance: MANUAL_OFF_PLATFORM_PROVENANCE,
    membershipId,
    commandId,
    actorRef,
    capabilityRef,
    recentAuthRef,
    evidenceCategoryRef,
    evidenceRef,
    reasonRef,
    correlationRef,
    termId,
    termState: APPROVED_TERM_STATE,
    startsAtMs,
    endsAtMs,
    planRef,
    policyVersion,
  });

  return Object.freeze({ reducerCommand, auditRecord });
}

Object.freeze(MembershipManualEvidenceError.prototype);
Object.freeze(MembershipManualEvidenceError);

module.exports = Object.freeze({
  membershipManualEvidenceSchemaVersion,
  MEMBERSHIP_MANUAL_EVIDENCE_ENUMS,
  MembershipManualEvidenceError,
  projectManualDuesEvidence,
});
