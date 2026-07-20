'use strict';

const { types: { isProxy } } = require('node:util');

const consentStateSchemaVersion = 1;
const MEMBERSHIP_CONSENT_STATE_ERROR_MESSAGE = 'Membership consent state input is invalid.';

// Shared with membershipAuthority.js / membershipProviderLink.js: an opaque,
// non-secret reference token. The character class structurally rejects raw
// email/phone-shaped values, so a subject, scope, or policy version can never be
// a bare address or phone number.
const OPAQUE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const EXPECTED_FIELDS = Object.freeze([
  'consentStateSchemaVersion',
  'provider',
  'subjectRef',
  'scopeRef',
  'latestDecision',
  'latestPolicyVersion',
  'requiredPolicyVersion',
]);

const MEMBERSHIP_CONSENT_STATE_ENUMS = Object.freeze({
  // One provider-neutral vocabulary, shared with membershipProviderLink.js:
  // sign-in identity (email/password, Google) and external access accounts
  // (WhatsApp, Strava) follow the same consent rule.
  provider: Object.freeze(['email_password', 'google', 'whatsapp', 'strava']),
  // The latest consent decision on record for one (provider, subject, scope)
  // track; 'none' means no decision has ever been recorded for it.
  latestDecision: Object.freeze(['granted', 'withdrawn', 'none']),
  // Output-only effective-consent dispositions.
  disposition: Object.freeze([
    'active',
    'reaffirmation_required',
    'withdrawn',
    'not_consented',
  ]),
});

// Only the input enums are validated against the incoming evidence.
const ENUM_SETS = Object.freeze({
  provider: new Set(MEMBERSHIP_CONSENT_STATE_ENUMS.provider),
  latestDecision: new Set(MEMBERSHIP_CONSENT_STATE_ENUMS.latestDecision),
});

class MembershipConsentStateError extends Error {
  constructor() {
    super(MEMBERSHIP_CONSENT_STATE_ERROR_MESSAGE);
    Object.defineProperty(this, 'name', {
      value: 'MembershipConsentStateError',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'message', {
      value: MEMBERSHIP_CONSENT_STATE_ERROR_MESSAGE,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'code', {
      value: 'invalid_membership_consent_state',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Error.captureStackTrace?.(this, MembershipConsentStateError);
    Object.freeze(this);
  }
}

function fail() {
  throw new MembershipConsentStateError();
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

function isOpaqueIdentifier(value) {
  return typeof value === 'string' && OPAQUE_IDENTIFIER_PATTERN.test(value);
}

function readExactEvidence(input) {
  const evidence = readExactObject(input, EXPECTED_FIELDS);
  if (evidence.consentStateSchemaVersion !== consentStateSchemaVersion) fail();
  if (!isOpaqueIdentifier(evidence.subjectRef)) fail();
  if (!isOpaqueIdentifier(evidence.scopeRef)) fail();
  // A policy currently in force always carries a version.
  if (!isOpaqueIdentifier(evidence.requiredPolicyVersion)) fail();
  for (const [field, allowedValues] of Object.entries(ENUM_SETS)) {
    if (!allowedValues.has(evidence[field])) fail();
  }
  // The latest decision's policy version is present iff a decision was recorded:
  // null exactly when 'none', an opaque version otherwise.
  if (evidence.latestDecision === 'none') {
    if (evidence.latestPolicyVersion !== null) fail();
  } else if (!isOpaqueIdentifier(evidence.latestPolicyVersion)) {
    fail();
  }
  return evidence;
}

function frozenDisposition(disposition, reason) {
  return Object.freeze({
    consentStateSchemaVersion,
    disposition,
    reason,
    // A consent state never confers membership, price, payment state, or role.
    grantsAuthority: false,
  });
}

const RESULTS = Object.freeze({
  active: frozenDisposition('active', 'consent_current'),
  reaffirmationRequired: frozenDisposition('reaffirmation_required', 'policy_version_superseded'),
  withdrawn: frozenDisposition('withdrawn', 'consent_withdrawn'),
  notConsented: frozenDisposition('not_consented', 'no_decision_recorded'),
});

function classifyConsentState(input) {
  const evidence = readExactEvidence(input);

  // No decision on record: consent is absent, independent of any policy version.
  if (evidence.latestDecision === 'none') {
    return RESULTS.notConsented;
  }
  // Withdrawal is terminal until a fresh grant; the policy version is irrelevant.
  if (evidence.latestDecision === 'withdrawn') {
    return RESULTS.withdrawn;
  }

  // latestDecision === 'granted': the grant covers only the policy version it was
  // made under. Versions are compared for equality only -- no ordering, recency,
  // or precedence is invented -- so any differing version requires reaffirmation.
  if (evidence.latestPolicyVersion === evidence.requiredPolicyVersion) {
    return RESULTS.active;
  }
  return RESULTS.reaffirmationRequired;
}

Object.freeze(MembershipConsentStateError.prototype);
Object.freeze(MembershipConsentStateError);

module.exports = Object.freeze({
  consentStateSchemaVersion,
  MEMBERSHIP_CONSENT_STATE_ENUMS,
  MembershipConsentStateError,
  classifyConsentState,
});
