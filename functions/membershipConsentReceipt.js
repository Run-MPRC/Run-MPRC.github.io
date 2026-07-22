'use strict';

const { types: { isProxy } } = require('node:util');
const {
  consentStateSchemaVersion,
  MEMBERSHIP_CONSENT_STATE_ENUMS,
  classifyConsentState,
} = require('./membershipConsentState');

const membershipConsentReceiptSchemaVersion = 1;
const MEMBERSHIP_CONSENT_RECEIPT_ERROR_MESSAGE =
  'Membership consent receipt input is invalid.';

// Purpose-specific, server-minted reference shapes keep obvious contact,
// provider-error, URL, prose, and human-name values outside this boundary.
// The shapes are structural only; a trusted server must mint every reference.
const TRACK_ID_PATTERN = /^ctrk_[a-f0-9]{32}$/;
const SUBJECT_REFERENCE_PATTERN = /^subject\.[a-f0-9]{32}$/;
const SCOPE_REFERENCE_PATTERN = /^scope\.[a-f0-9]{32}$/;
const COMMAND_ID_PATTERN = /^cmd_[a-f0-9]{32}$/;
const RECEIPT_ID_PATTERN = /^crpt_[a-f0-9]{32}$/;
const POLICY_VERSION_PATTERN = /^policy\.[a-f0-9]{32}$/;

const CREATE_FIELDS = Object.freeze([
  'membershipConsentReceiptSchemaVersion',
  'trackId',
  'provider',
  'subjectRef',
  'scopeRef',
]);

const TRACK_FIELDS = Object.freeze([
  'membershipConsentReceiptSchemaVersion',
  'trackId',
  'provider',
  'subjectRef',
  'scopeRef',
  'receiptRevision',
  'latestReceipt',
  'grantsAuthority',
]);

const COMMAND_FIELDS = Object.freeze([
  'membershipConsentReceiptSchemaVersion',
  'commandType',
  'trackId',
  'provider',
  'subjectRef',
  'scopeRef',
  'commandId',
  'receiptId',
  'expectedRevision',
  'expectedLatestReceiptId',
  'decision',
  'policyVersion',
]);

const RECEIPT_FIELDS = Object.freeze([
  'membershipConsentReceiptSchemaVersion',
  'trackId',
  'provider',
  'subjectRef',
  'scopeRef',
  'receiptId',
  'priorReceiptId',
  'receiptRevision',
  'commandId',
  'decision',
  'policyVersion',
  'grantsAuthority',
]);

const POLICY_FIELDS = Object.freeze([
  'membershipConsentReceiptSchemaVersion',
  'requiredPolicyVersion',
]);

const MEMBERSHIP_CONSENT_RECEIPT_ENUMS = Object.freeze({
  provider: MEMBERSHIP_CONSENT_STATE_ENUMS.provider,
  commandType: Object.freeze(['record_consent_decision']),
  decision: Object.freeze(['granted', 'withdrawn']),
  disposition: Object.freeze(['appended', 'already_applied']),
});

const PROVIDERS = new Set(MEMBERSHIP_CONSENT_RECEIPT_ENUMS.provider);
const DECISIONS = new Set(MEMBERSHIP_CONSENT_RECEIPT_ENUMS.decision);

class MembershipConsentReceiptError extends Error {
  constructor() {
    super(MEMBERSHIP_CONSENT_RECEIPT_ERROR_MESSAGE);
    Object.defineProperty(this, 'name', {
      value: 'MembershipConsentReceiptError',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'message', {
      value: MEMBERSHIP_CONSENT_RECEIPT_ERROR_MESSAGE,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'code', {
      value: 'invalid_membership_consent_receipt',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Error.captureStackTrace?.(this, MembershipConsentReceiptError);
    Object.freeze(this);
  }
}

function fail() {
  throw new MembershipConsentReceiptError();
}

function readDataObject(value) {
  if (value === null || typeof value !== 'object') fail();

  let proxy;
  let prototype;
  let keys;
  try {
    proxy = isProxy(value);
    if (proxy) fail();
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    if (error instanceof MembershipConsentReceiptError) throw error;
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
  return { data, keys };
}

function hasCanonicalShape(value, keys, expectedFields) {
  return Object.isFrozen(value)
    && keys.every((key, index) => key === expectedFields[index]);
}

function requireVersion(value) {
  if (value !== membershipConsentReceiptSchemaVersion) fail();
}

function requirePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function requireTrackId(value) {
  return requirePattern(value, TRACK_ID_PATTERN);
}

function requireSubjectReference(value) {
  return requirePattern(value, SUBJECT_REFERENCE_PATTERN);
}

function requireScopeReference(value) {
  return requirePattern(value, SCOPE_REFERENCE_PATTERN);
}

function requireCommandId(value) {
  return requirePattern(value, COMMAND_ID_PATTERN);
}

function requireReceiptId(value) {
  return requirePattern(value, RECEIPT_ID_PATTERN);
}

function requirePolicyVersion(value) {
  return requirePattern(value, POLICY_VERSION_PATTERN);
}

function requireSafeRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) fail();
  return value;
}

function requireProvider(value) {
  if (!PROVIDERS.has(value)) fail();
  return value;
}

function requireDecision(value) {
  if (!DECISIONS.has(value)) fail();
  return value;
}

function readBinding(data) {
  requireTrackId(data.trackId);
  requireProvider(data.provider);
  requireSubjectReference(data.subjectRef);
  requireScopeReference(data.scopeRef);
}

function freezeReceipt(data) {
  return Object.freeze({
    membershipConsentReceiptSchemaVersion,
    trackId: data.trackId,
    provider: data.provider,
    subjectRef: data.subjectRef,
    scopeRef: data.scopeRef,
    receiptId: data.receiptId,
    priorReceiptId: data.priorReceiptId,
    receiptRevision: data.receiptRevision,
    commandId: data.commandId,
    decision: data.decision,
    policyVersion: data.policyVersion,
    grantsAuthority: false,
  });
}

function readReceipt(input) {
  const { data, keys } = readExactObject(input, RECEIPT_FIELDS);
  requireVersion(data.membershipConsentReceiptSchemaVersion);
  readBinding(data);
  requireReceiptId(data.receiptId);
  requireSafeRevision(data.receiptRevision);
  if (data.receiptRevision === 0) fail();
  requireCommandId(data.commandId);
  requireDecision(data.decision);
  requirePolicyVersion(data.policyVersion);
  if (data.grantsAuthority !== false) fail();

  if (data.receiptRevision === 1) {
    if (data.priorReceiptId !== null) fail();
  } else {
    requireReceiptId(data.priorReceiptId);
    if (data.priorReceiptId === data.receiptId) fail();
  }

  const canonical = hasCanonicalShape(input, keys, RECEIPT_FIELDS)
    ? input
    : freezeReceipt(data);
  return { data, canonical };
}

function freezeTrack(data, latestReceipt) {
  return Object.freeze({
    membershipConsentReceiptSchemaVersion,
    trackId: data.trackId,
    provider: data.provider,
    subjectRef: data.subjectRef,
    scopeRef: data.scopeRef,
    receiptRevision: data.receiptRevision,
    latestReceipt,
    grantsAuthority: false,
  });
}

function sameBinding(left, right) {
  return left.trackId === right.trackId
    && left.provider === right.provider
    && left.subjectRef === right.subjectRef
    && left.scopeRef === right.scopeRef;
}

function readTrack(input) {
  const { data, keys } = readExactObject(input, TRACK_FIELDS);
  requireVersion(data.membershipConsentReceiptSchemaVersion);
  readBinding(data);
  requireSafeRevision(data.receiptRevision);
  if (data.grantsAuthority !== false) fail();

  let receipt = null;
  if (data.receiptRevision === 0) {
    if (data.latestReceipt !== null) fail();
  } else {
    receipt = readReceipt(data.latestReceipt);
    if (receipt.data.receiptRevision !== data.receiptRevision) fail();
    if (!sameBinding(data, receipt.data)) fail();
  }

  const canonicalReceipt = receipt ? receipt.canonical : null;
  const canonical = hasCanonicalShape(input, keys, TRACK_FIELDS)
    && data.latestReceipt === canonicalReceipt
    ? input
    : freezeTrack(data, canonicalReceipt);
  return { data, receipt: receipt?.data ?? null, canonical };
}

function readCreateInput(input) {
  const { data } = readExactObject(input, CREATE_FIELDS);
  requireVersion(data.membershipConsentReceiptSchemaVersion);
  readBinding(data);
  return data;
}

function readCommand(input) {
  const { data } = readExactObject(input, COMMAND_FIELDS);
  requireVersion(data.membershipConsentReceiptSchemaVersion);
  if (data.commandType !== 'record_consent_decision') fail();
  readBinding(data);
  requireCommandId(data.commandId);
  requireReceiptId(data.receiptId);
  requireSafeRevision(data.expectedRevision);
  if (data.expectedLatestReceiptId !== null) {
    requireReceiptId(data.expectedLatestReceiptId);
  }
  requireDecision(data.decision);
  requirePolicyVersion(data.policyVersion);
  return data;
}

function readPolicyInput(input) {
  const { data } = readExactObject(input, POLICY_FIELDS);
  requireVersion(data.membershipConsentReceiptSchemaVersion);
  requirePolicyVersion(data.requiredPolicyVersion);
  return data;
}

function createConsentReceiptTrack(input) {
  const data = readCreateInput(input);
  return freezeTrack({ ...data, receiptRevision: 0 }, null);
}

function isExactLatestRetry(track, receipt, command) {
  return sameBinding(track, command)
    && receipt.receiptId === command.receiptId
    && receipt.receiptRevision - 1 === command.expectedRevision
    && receipt.priorReceiptId === command.expectedLatestReceiptId
    && receipt.decision === command.decision
    && receipt.policyVersion === command.policyVersion;
}

function freezeResult(disposition, track, receipt) {
  return Object.freeze({
    membershipConsentReceiptSchemaVersion,
    disposition,
    track,
    receipt,
    grantsAuthority: false,
  });
}

function appendConsentDecisionReceipt(trackInputValue, commandInput) {
  const track = readTrack(trackInputValue);
  const commandData = readCommand(commandInput);
  const latestReceipt = track.receipt;

  // Exact retry is checked before freshness and exhaustion: the original
  // command remains read-only even after its revision became current.
  if (latestReceipt && latestReceipt.commandId === commandData.commandId) {
    if (!isExactLatestRetry(track.data, latestReceipt, commandData)) fail();
    return freezeResult(
      'already_applied',
      track.canonical,
      track.canonical.latestReceipt,
    );
  }

  if (!sameBinding(track.data, commandData)) fail();
  if (commandData.expectedRevision !== track.data.receiptRevision) fail();
  const expectedLatestReceiptId = latestReceipt ? latestReceipt.receiptId : null;
  if (commandData.expectedLatestReceiptId !== expectedLatestReceiptId) fail();
  if (latestReceipt && commandData.receiptId === latestReceipt.receiptId) fail();
  if (track.data.receiptRevision === Number.MAX_SAFE_INTEGER) fail();

  const receipt = freezeReceipt({
    ...commandData,
    priorReceiptId: expectedLatestReceiptId,
    receiptRevision: track.data.receiptRevision + 1,
  });
  const nextTrack = freezeTrack({
    ...track.data,
    receiptRevision: receipt.receiptRevision,
  }, receipt);
  return freezeResult('appended', nextTrack, receipt);
}

function deriveConsentStateFromReceiptTrack(trackInputValue, policyInput) {
  const track = readTrack(trackInputValue);
  const policy = readPolicyInput(policyInput);
  return classifyConsentState({
    consentStateSchemaVersion,
    provider: track.data.provider,
    subjectRef: track.data.subjectRef,
    scopeRef: track.data.scopeRef,
    latestDecision: track.receipt ? track.receipt.decision : 'none',
    latestPolicyVersion: track.receipt ? track.receipt.policyVersion : null,
    requiredPolicyVersion: policy.requiredPolicyVersion,
  });
}

Object.freeze(MembershipConsentReceiptError.prototype);
Object.freeze(MembershipConsentReceiptError);

module.exports = Object.freeze({
  membershipConsentReceiptSchemaVersion,
  MEMBERSHIP_CONSENT_RECEIPT_ENUMS,
  MembershipConsentReceiptError,
  createConsentReceiptTrack,
  appendConsentDecisionReceipt,
  deriveConsentStateFromReceiptTrack,
});
