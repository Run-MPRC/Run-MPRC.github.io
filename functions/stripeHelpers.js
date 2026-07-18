const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Stripe = require('stripe');
const crypto = require('crypto');
const { types: { isProxy } } = require('node:util');
const { loadCallableServerConfig } = require('./serverConfig');
const {
  isVerifiedAdmin,
  resolveVerifiedCallerRole,
} = require('./verifiedRolePolicy');

const {
  Timestamp, FieldValue,
} = require('firebase-admin/firestore');

const STRIPE_API_VERSION = '2023-10-16';
const INVALID_REGISTRATION_WINDOW_VALUE = Symbol('invalid-registration-window-value');
const MISSING_REGISTRATION_WINDOW_VALUE = Symbol('missing-registration-window-value');
const MIN_TIMESTAMP_SECONDS = -62_135_596_800;
const MAX_TIMESTAMP_SECONDS = 253_402_300_799;
const MAX_TIMESTAMP_NANOSECONDS = 999_999_999;
const dateNow = Date.now;
const mathFloor = Math.floor;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwn = Object.hasOwn;
const objectIs = Object.is;
const objectPrototype = Object.prototype;
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const STRIPE_MINIMUM_USD_CENTS = 50;
const STRIPE_UNIT_AMOUNT_MAX_CENTS = 99_999_999;
const reflectOwnKeys = Reflect.ownKeys;
const timestampPrototype = Timestamp.prototype;

let _stripeClient = null;
function getStripe() {
  loadCallableServerConfig({
    requireStripeKey: true,
    requireCommerceCeiling: true,
  });
  if (_stripeClient) return _stripeClient;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  _stripeClient = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
  return _stripeClient;
}

function getWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('Stripe webhook secret not configured');
  }
  return secret;
}

function generateToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

async function requireAdmin(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }
  if (!isVerifiedAdmin(context.auth.token)) {
    throw new functions.https.HttpsError('permission-denied', 'Admin role required');
  }
}

function requireAppCheck(context) {
  if (process.env.ENFORCE_APP_CHECK !== 'true') return;
  if (!context.app) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'App Check token missing or invalid',
    );
  }
}

async function resolveCallerRole(context) {
  if (!context.auth) return null;
  return resolveVerifiedCallerRole(context.auth.token);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateRunner(runner) {
  const errors = [];
  if (!runner || typeof runner !== 'object') {
    return ['Runner info missing'];
  }
  if (!isNonEmptyString(runner.firstName)) errors.push('First name required');
  if (!isNonEmptyString(runner.lastName)) errors.push('Last name required');
  if (!isValidEmail(runner.email)) errors.push('Valid email required');
  return errors;
}

function pickPriceCents(event, priceTier) {
  if (priceTier === 'free') return 0;

  let selectedField;
  if (priceTier === 'member') selectedField = 'memberCents';
  else if (priceTier === 'nonMember') selectedField = 'nonMemberCents';
  else if (priceTier === 'earlyBird') selectedField = 'earlyBirdCents';
  else return null;

  if (!isPlainEventRecord(event)) return null;
  const pricing = selectedOwnDataValue(event, 'pricing', true);
  if (!isPlainEventRecord(pricing)) return null;
  const priceCents = selectedOwnDataValue(pricing, selectedField, true);
  if (
    typeof priceCents !== 'number'
    || !numberIsSafeInteger(priceCents)
    || objectIs(priceCents, -0)
    || priceCents < 0
    || (priceCents !== 0 && priceCents < STRIPE_MINIMUM_USD_CENTS)
    || priceCents > STRIPE_UNIT_AMOUNT_MAX_CENTS
  ) {
    return null;
  }
  return priceCents;
}

function projectParticipantCapacityLimit(event) {
  if (!isPlainEventRecord(event)) return undefined;

  const capacity = selectedOwnDataValue(event, 'capacity', true);
  if (capacity === MISSING_REGISTRATION_WINDOW_VALUE) {
    // A legacy record may omit capacity. Do not let a polluted shared
    // prototype silently supply the value for that compatibility case.
    if (objectGetOwnPropertyDescriptor(objectPrototype, 'capacity')) {
      return undefined;
    }
    return null;
  }
  if (capacity === INVALID_REGISTRATION_WINDOW_VALUE) return undefined;
  if (capacity === null) return null;
  if (
    typeof capacity !== 'number'
    || !numberIsSafeInteger(capacity)
    || capacity <= 0
  ) {
    return undefined;
  }
  return capacity;
}

function isEarlyBirdActive(event, now = dateNow()) {
  if (!numberIsFinite(now) || !isPlainEventRecord(event)) return false;

  const pricing = selectedOwnDataValue(event, 'pricing', true);
  if (!isPlainEventRecord(pricing)) return false;

  const earlyBirdCents = selectedOwnDataValue(
    pricing,
    'earlyBirdCents',
    true,
  );
  if (
    earlyBirdCents === MISSING_REGISTRATION_WINDOW_VALUE
    || earlyBirdCents === INVALID_REGISTRATION_WINDOW_VALUE
    || !earlyBirdCents
  ) {
    return false;
  }

  const cutoff = selectedOwnDataValue(pricing, 'earlyBirdUntil', true);
  const cutoffMs = timestampToMillis(cutoff);
  return cutoffMs !== INVALID_REGISTRATION_WINDOW_VALUE && now < cutoffMs;
}

function isProxyValue(value) {
  try {
    return isProxy(value);
  } catch (_error) {
    return true;
  }
}

function isPlainEventRecord(value) {
  if (value === null || typeof value !== 'object' || isProxyValue(value)) return false;
  try {
    return objectGetPrototypeOf(value) === objectPrototype;
  } catch (_error) {
    return false;
  }
}

function selectedOwnDataValue(record, key, requireEnumerable = false) {
  let descriptor;
  try {
    descriptor = objectGetOwnPropertyDescriptor(record, key);
  } catch (_error) {
    return INVALID_REGISTRATION_WINDOW_VALUE;
  }
  if (!descriptor) return MISSING_REGISTRATION_WINDOW_VALUE;
  if (!objectHasOwn(descriptor, 'value')
    || (requireEnumerable && descriptor.enumerable !== true)) {
    return INVALID_REGISTRATION_WINDOW_VALUE;
  }
  return descriptor.value;
}

function timestampToMillis(value) {
  if (value === null || typeof value !== 'object' || isProxyValue(value)) {
    return INVALID_REGISTRATION_WINDOW_VALUE;
  }

  // Firestore decodes valid bounds as this locked SDK class. Read its scalar
  // state directly so a stored method, accessor, or coercion can never run.
  let prototype;
  let keys;
  try {
    prototype = objectGetPrototypeOf(value);
    keys = reflectOwnKeys(value);
  } catch (_error) {
    return INVALID_REGISTRATION_WINDOW_VALUE;
  }
  if (prototype !== timestampPrototype || keys.length !== 2) {
    return INVALID_REGISTRATION_WINDOW_VALUE;
  }
  const hasExactInternalKeys = (keys[0] === '_seconds' && keys[1] === '_nanoseconds')
    || (keys[0] === '_nanoseconds' && keys[1] === '_seconds');
  if (!hasExactInternalKeys) return INVALID_REGISTRATION_WINDOW_VALUE;

  const seconds = selectedOwnDataValue(value, '_seconds', true);
  const nanoseconds = selectedOwnDataValue(value, '_nanoseconds', true);
  if (!numberIsSafeInteger(seconds)
    || seconds < MIN_TIMESTAMP_SECONDS
    || seconds > MAX_TIMESTAMP_SECONDS
    || !numberIsSafeInteger(nanoseconds)
    || nanoseconds < 0
    || nanoseconds > MAX_TIMESTAMP_NANOSECONDS) {
    return INVALID_REGISTRATION_WINDOW_VALUE;
  }

  const milliseconds = seconds * 1_000 + mathFloor(nanoseconds / 1_000_000);
  return numberIsFinite(milliseconds)
    ? milliseconds
    : INVALID_REGISTRATION_WINDOW_VALUE;
}

function registrationBoundMillis(event, key) {
  const value = selectedOwnDataValue(event, key);
  if (value === MISSING_REGISTRATION_WINDOW_VALUE || value === null) {
    return MISSING_REGISTRATION_WINDOW_VALUE;
  }
  if (value === INVALID_REGISTRATION_WINDOW_VALUE) {
    return INVALID_REGISTRATION_WINDOW_VALUE;
  }
  return timestampToMillis(value);
}

function isRegistrationOpen(event, now = dateNow()) {
  if (!numberIsFinite(now) || !isPlainEventRecord(event)) return false;
  if (selectedOwnDataValue(event, 'status') !== 'open') return false;

  const opensMs = registrationBoundMillis(event, 'registrationOpensAt');
  if (opensMs === INVALID_REGISTRATION_WINDOW_VALUE) return false;
  if (opensMs !== MISSING_REGISTRATION_WINDOW_VALUE && now < opensMs) return false;

  const closesMs = registrationBoundMillis(event, 'registrationClosesAt');
  if (closesMs === INVALID_REGISTRATION_WINDOW_VALUE) return false;
  if (closesMs !== MISSING_REGISTRATION_WINDOW_VALUE && now > closesMs) return false;

  return true;
}

async function countActiveRegistrations(eventId) {
  // Counts active *participant* registrations. Volunteers (signupType==volunteer)
  // don't count against participant capacity. Firestore doesn't support an
  // `in` + `!=` composite query, so fetch and filter in memory. Event-scale
  // registrations are small enough that this is cheap.
  const snap = await admin.firestore()
    .collection('events').doc(eventId)
    .collection('registrations')
    .where('status', 'in', ['paid', 'pending', 'comp', 'partially_refunded'])
    .get();
  let count = 0;
  snap.forEach((d) => {
    if ((d.data().signupType || 'participant') !== 'volunteer') count += 1;
  });
  return count;
}

function auditEntry({ actorUid, actorEmail, action, note }) {
  return {
    ts: Timestamp.now(),
    actorUid: actorUid || null,
    actorEmail: actorEmail || null,
    action,
    note: note || null,
  };
}

module.exports = {
  STRIPE_API_VERSION,
  getStripe,
  getWebhookSecret,
  generateToken,
  requireAdmin,
  requireAppCheck,
  resolveCallerRole,
  isNonEmptyString,
  isValidEmail,
  validateRunner,
  pickPriceCents,
  projectParticipantCapacityLimit,
  isEarlyBirdActive,
  isRegistrationOpen,
  countActiveRegistrations,
  auditEntry,
  Timestamp,
  FieldValue,
};
