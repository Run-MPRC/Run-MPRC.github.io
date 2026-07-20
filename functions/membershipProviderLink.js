'use strict';

const { types: { isProxy } } = require('node:util');

const providerLinkSchemaVersion = 1;
const MEMBERSHIP_PROVIDER_LINK_ERROR_MESSAGE = 'Membership provider link input is invalid.';

// Shared with membershipAuthority.js: an opaque, non-secret reference token. The
// character class structurally rejects raw email/phone-shaped values, so a
// providerAccountRef can never be a bare address or phone number.
const OPAQUE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const EXPECTED_FIELDS = Object.freeze([
  'providerLinkSchemaVersion',
  'provider',
  'membershipId',
  'providerAccountRef',
  'consent',
  'desiredState',
  'observedState',
  'boundMembershipId',
]);

const MEMBERSHIP_PROVIDER_LINK_ENUMS = Object.freeze({
  // One provider-neutral vocabulary: sign-in identity (email/password, Google)
  // and external access accounts (WhatsApp, Strava) follow the same rules.
  provider: Object.freeze(['email_password', 'google', 'whatsapp', 'strava']),
  consent: Object.freeze(['granted', 'withdrawn', 'unknown']),
  desiredState: Object.freeze(['linked', 'unlinked']),
  observedState: Object.freeze(['linked', 'unlinked', 'unknown']),
  // Output-only reconciliation dispositions.
  disposition: Object.freeze([
    'aligned',
    'reconcile_link',
    'reconcile_unlink',
    'observation_pending',
    'blocked',
    'collision',
  ]),
});

// Only the input enums are validated against the incoming evidence.
const ENUM_SETS = Object.freeze({
  provider: new Set(MEMBERSHIP_PROVIDER_LINK_ENUMS.provider),
  consent: new Set(MEMBERSHIP_PROVIDER_LINK_ENUMS.consent),
  desiredState: new Set(MEMBERSHIP_PROVIDER_LINK_ENUMS.desiredState),
  observedState: new Set(MEMBERSHIP_PROVIDER_LINK_ENUMS.observedState),
});

class MembershipProviderLinkError extends Error {
  constructor() {
    super(MEMBERSHIP_PROVIDER_LINK_ERROR_MESSAGE);
    Object.defineProperty(this, 'name', {
      value: 'MembershipProviderLinkError',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'message', {
      value: MEMBERSHIP_PROVIDER_LINK_ERROR_MESSAGE,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'code', {
      value: 'invalid_membership_provider_link',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Error.captureStackTrace?.(this, MembershipProviderLinkError);
    Object.freeze(this);
  }
}

function fail() {
  throw new MembershipProviderLinkError();
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
  if (evidence.providerLinkSchemaVersion !== providerLinkSchemaVersion) fail();
  if (!isOpaqueIdentifier(evidence.membershipId)) fail();
  if (!isOpaqueIdentifier(evidence.providerAccountRef)) fail();
  // The provider account may be unbound (null) or bound to some membership.
  if (evidence.boundMembershipId !== null
    && !isOpaqueIdentifier(evidence.boundMembershipId)) {
    fail();
  }
  for (const [field, allowedValues] of Object.entries(ENUM_SETS)) {
    if (!allowedValues.has(evidence[field])) fail();
  }
  return evidence;
}

function frozenDisposition(disposition, reason) {
  return Object.freeze({
    providerLinkSchemaVersion,
    disposition,
    reason,
    // A provider link never confers membership, price, payment state, or role.
    grantsAuthority: false,
  });
}

const RESULTS = Object.freeze({
  aligned: frozenDisposition('aligned', 'desired_matches_observed'),
  reconcileLink: frozenDisposition('reconcile_link', 'link_requested_not_yet_observed'),
  reconcileUnlink: frozenDisposition('reconcile_unlink', 'unlink_requested_still_observed'),
  observationPending: frozenDisposition('observation_pending', 'observed_state_unknown'),
  consentRequired: frozenDisposition('blocked', 'consent_required'),
  collision: frozenDisposition('collision', 'provider_account_linked_elsewhere'),
});

function classifyProviderLinkReconciliation(input) {
  const evidence = readExactEvidence(input);

  // Linking is gated first: an account already bound to a different membership
  // is refused, and linking always requires granted consent.
  if (evidence.desiredState === 'linked') {
    if (evidence.boundMembershipId !== null
      && evidence.boundMembershipId !== evidence.membershipId) {
      return RESULTS.collision;
    }
    if (evidence.consent !== 'granted') {
      return RESULTS.consentRequired;
    }
  }

  // Without a fresh observation there is nothing to reconcile against.
  if (evidence.observedState === 'unknown') {
    return RESULTS.observationPending;
  }

  if (evidence.desiredState === evidence.observedState) {
    return RESULTS.aligned;
  }

  // Desired and observed differ and observed is known: exactly one drift remains.
  if (evidence.desiredState === 'linked') {
    return RESULTS.reconcileLink;
  }
  return RESULTS.reconcileUnlink;
}

Object.freeze(MembershipProviderLinkError.prototype);
Object.freeze(MembershipProviderLinkError);

module.exports = Object.freeze({
  providerLinkSchemaVersion,
  MEMBERSHIP_PROVIDER_LINK_ENUMS,
  MembershipProviderLinkError,
  classifyProviderLinkReconciliation,
});
