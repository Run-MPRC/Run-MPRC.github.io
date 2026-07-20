'use strict';

const { types: { isProxy } } = require('node:util');

const membershipTermReceiptSchemaVersion = 1;
const MEMBERSHIP_AUTHORITY_SCHEMA_VERSION = 1;
const MEMBERSHIP_TERM_RECEIPT_ERROR_MESSAGE = 'Membership term receipt input is invalid.';
const MAX_TIME_MS = 8_640_000_000_000_000;
const OPAQUE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const RECEIPT_FIELDS = Object.freeze([
  'membershipTermReceiptSchemaVersion',
  'receiptId',
  'commandId',
  'termRevision',
  'termState',
  'termId',
  'startsAtMs',
  'endsAtMs',
  'planRef',
  'evidenceRef',
  'policyVersion',
]);

const CREATE_LEDGER_FIELDS = Object.freeze([
  'membershipTermReceiptSchemaVersion',
  'ledgerId',
]);

const LEDGER_FIELDS = Object.freeze([
  'membershipTermReceiptSchemaVersion',
  'ledgerId',
  'receiptRevision',
  'receipts',
]);

const PROJECTION_ENVELOPE_FIELDS = Object.freeze([
  'membershipAuthoritySchemaVersion',
  'expectedRevision',
]);

const MEMBERSHIP_TERM_RECEIPT_ENUMS = Object.freeze({
  termState: Object.freeze([
    'decision_pending',
    'approved',
    'suspended',
    'ended',
  ]),
});

const TERM_STATES = new Set(MEMBERSHIP_TERM_RECEIPT_ENUMS.termState);

class MembershipTermReceiptError extends Error {
  constructor() {
    super(MEMBERSHIP_TERM_RECEIPT_ERROR_MESSAGE);
    Object.defineProperty(this, 'name', {
      value: 'MembershipTermReceiptError',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'message', {
      value: MEMBERSHIP_TERM_RECEIPT_ERROR_MESSAGE,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'code', {
      value: 'invalid_membership_term_receipt',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Error.captureStackTrace?.(this, MembershipTermReceiptError);
    Object.freeze(this);
  }
}

function fail() {
  throw new MembershipTermReceiptError();
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

function readDataArray(value) {
  if (!Array.isArray(value) || isProxy(value)) fail();

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail();
  }
  if (prototype !== Array.prototype) fail();

  const { length } = value;
  if (!Number.isSafeInteger(length) || keys.length !== length + 1) fail();

  const expected = new Set();
  for (let index = 0; index < length; index += 1) expected.add(String(index));
  expected.add('length');
  for (const key of keys) {
    if (typeof key !== 'string' || !expected.has(key)) fail();
  }

  const elements = [];
  for (let index = 0; index < length; index += 1) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
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
    elements.push(descriptor.value);
  }
  return elements;
}

function requireVersion(value) {
  if (value !== membershipTermReceiptSchemaVersion) fail();
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

function readReceipt(value) {
  const receipt = readExactObject(value, RECEIPT_FIELDS);
  requireVersion(receipt.membershipTermReceiptSchemaVersion);
  requireOpaqueIdentifier(receipt.receiptId);
  requireOpaqueIdentifier(receipt.commandId);
  requireRevision(receipt.termRevision, 1);
  if (!TERM_STATES.has(receipt.termState)) fail();
  requireOpaqueIdentifier(receipt.termId);
  requireTime(receipt.startsAtMs);
  requireTime(receipt.endsAtMs);
  if (receipt.startsAtMs >= receipt.endsAtMs) fail();
  requireOpaqueIdentifier(receipt.planRef);
  requireOpaqueIdentifier(receipt.evidenceRef);
  requireOpaqueIdentifier(receipt.policyVersion);
  return {
    receiptId: receipt.receiptId,
    commandId: receipt.commandId,
    termRevision: receipt.termRevision,
    termState: receipt.termState,
    termId: receipt.termId,
    startsAtMs: receipt.startsAtMs,
    endsAtMs: receipt.endsAtMs,
    planRef: receipt.planRef,
    evidenceRef: receipt.evidenceRef,
    policyVersion: receipt.policyVersion,
  };
}

function freezeReceipt(receipt) {
  return Object.freeze({
    membershipTermReceiptSchemaVersion,
    receiptId: receipt.receiptId,
    commandId: receipt.commandId,
    termRevision: receipt.termRevision,
    termState: receipt.termState,
    termId: receipt.termId,
    startsAtMs: receipt.startsAtMs,
    endsAtMs: receipt.endsAtMs,
    planRef: receipt.planRef,
    evidenceRef: receipt.evidenceRef,
    policyVersion: receipt.policyVersion,
  });
}

function freezeLedger(ledgerId, frozenReceipts) {
  return Object.freeze({
    membershipTermReceiptSchemaVersion,
    ledgerId,
    receiptRevision: frozenReceipts.length,
    receipts: Object.freeze(frozenReceipts),
  });
}

function readLedger(value) {
  const ledger = readExactObject(value, LEDGER_FIELDS);
  requireVersion(ledger.membershipTermReceiptSchemaVersion);
  requireOpaqueIdentifier(ledger.ledgerId);
  requireRevision(ledger.receiptRevision, 0);

  const elements = readDataArray(ledger.receipts);
  if (elements.length !== ledger.receiptRevision) fail();

  const receipts = [];
  const receiptIds = new Set();
  const commandIds = new Set();
  for (let index = 0; index < elements.length; index += 1) {
    const receipt = readReceipt(elements[index]);
    if (receipt.termRevision !== index + 1) fail();
    if (receiptIds.has(receipt.receiptId) || commandIds.has(receipt.commandId)) fail();
    receiptIds.add(receipt.receiptId);
    commandIds.add(receipt.commandId);
    receipts.push(receipt);
  }

  return {
    ledgerId: ledger.ledgerId,
    receiptRevision: ledger.receiptRevision,
    receipts,
    receiptIds,
    commandIds,
  };
}

function isExactReceiptMatch(existing, candidate) {
  return existing.receiptId === candidate.receiptId
    && existing.commandId === candidate.commandId
    && existing.termRevision === candidate.termRevision
    && existing.termState === candidate.termState
    && existing.termId === candidate.termId
    && existing.startsAtMs === candidate.startsAtMs
    && existing.endsAtMs === candidate.endsAtMs
    && existing.planRef === candidate.planRef
    && existing.evidenceRef === candidate.evidenceRef
    && existing.policyVersion === candidate.policyVersion;
}

function canonicalLedger(value, ledgerId, frozenReceipts) {
  if (Object.isFrozen(value)
    && Object.isFrozen(value.receipts)
    && value.receipts.length === frozenReceipts.length
    && value.receipts.every((receipt) => Object.isFrozen(receipt))) {
    return value;
  }
  return freezeLedger(ledgerId, frozenReceipts);
}

function createTermEvidenceReceipt(input) {
  return freezeReceipt(readReceipt(input));
}

function createMembershipTermLedger(input) {
  const data = readExactObject(input, CREATE_LEDGER_FIELDS);
  requireVersion(data.membershipTermReceiptSchemaVersion);
  requireOpaqueIdentifier(data.ledgerId);
  return freezeLedger(data.ledgerId, []);
}

function appendTermEvidenceReceipt(ledgerInput, receiptInput) {
  const ledger = readLedger(ledgerInput);
  const receipt = readReceipt(receiptInput);
  const frozenReceipts = ledger.receipts.map(freezeReceipt);
  const tail = ledger.receipts.length > 0
    ? ledger.receipts[ledger.receipts.length - 1]
    : null;

  if (tail && receipt.commandId === tail.commandId) {
    if (!isExactReceiptMatch(tail, receipt)) fail();
    return canonicalLedger(ledgerInput, ledger.ledgerId, frozenReceipts);
  }

  if (ledger.commandIds.has(receipt.commandId)) fail();
  if (ledger.receiptIds.has(receipt.receiptId)) fail();
  if (receipt.termRevision !== ledger.receiptRevision + 1) fail();

  return freezeLedger(ledger.ledgerId, frozenReceipts.concat(freezeReceipt(receipt)));
}

function projectTermDecisionCommand(receiptInput, envelopeInput) {
  const receipt = readReceipt(receiptInput);
  const envelope = readExactObject(envelopeInput, PROJECTION_ENVELOPE_FIELDS);
  if (envelope.membershipAuthoritySchemaVersion !== MEMBERSHIP_AUTHORITY_SCHEMA_VERSION) fail();
  requireRevision(envelope.expectedRevision, 1);

  return Object.freeze({
    membershipAuthoritySchemaVersion: MEMBERSHIP_AUTHORITY_SCHEMA_VERSION,
    commandType: 'record_term_decision',
    commandId: receipt.commandId,
    expectedRevision: envelope.expectedRevision,
    termRevision: receipt.termRevision,
    termState: receipt.termState,
    termId: receipt.termId,
    startsAtMs: receipt.startsAtMs,
    endsAtMs: receipt.endsAtMs,
    planRef: receipt.planRef,
    evidenceRef: receipt.evidenceRef,
    policyVersion: receipt.policyVersion,
  });
}

Object.freeze(MembershipTermReceiptError.prototype);
Object.freeze(MembershipTermReceiptError);

module.exports = Object.freeze({
  membershipTermReceiptSchemaVersion,
  MEMBERSHIP_TERM_RECEIPT_ENUMS,
  MembershipTermReceiptError,
  createTermEvidenceReceipt,
  createMembershipTermLedger,
  appendTermEvidenceReceipt,
  projectTermDecisionCommand,
});
