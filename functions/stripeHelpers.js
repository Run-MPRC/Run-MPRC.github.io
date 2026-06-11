const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Stripe = require('stripe');
const crypto = require('crypto');

const {
  Timestamp, FieldValue,
} = require('firebase-admin/firestore');

const STRIPE_API_VERSION = '2023-10-16';

let _stripeClient = null;
function getStripe() {
  if (_stripeClient) return _stripeClient;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Stripe secret key not configured',
    );
  }
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
  const role = context.auth.token?.role;
  if (role !== 'admin') {
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
  return context.auth.token?.role || null;
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
  const pricing = event.pricing || {};
  if (priceTier === 'member') return pricing.memberCents;
  if (priceTier === 'nonMember') return pricing.nonMemberCents;
  if (priceTier === 'earlyBird') return pricing.earlyBirdCents;
  if (priceTier === 'free') return 0;
  return null;
}

function isEarlyBirdActive(event, now = Date.now()) {
  const pricing = event.pricing || {};
  if (!pricing.earlyBirdCents || !pricing.earlyBirdUntil) return false;
  const untilMs = pricing.earlyBirdUntil.toMillis
    ? pricing.earlyBirdUntil.toMillis()
    : new Date(pricing.earlyBirdUntil).getTime();
  return now < untilMs;
}

function isRegistrationOpen(event, now = Date.now()) {
  if (event.status !== 'open') return false;
  if (event.registrationOpensAt) {
    const opensMs = event.registrationOpensAt.toMillis
      ? event.registrationOpensAt.toMillis()
      : new Date(event.registrationOpensAt).getTime();
    if (now < opensMs) return false;
  }
  if (event.registrationClosesAt) {
    const closesMs = event.registrationClosesAt.toMillis
      ? event.registrationClosesAt.toMillis()
      : new Date(event.registrationClosesAt).getTime();
    if (now > closesMs) return false;
  }
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
    .where('status', 'in', ['paid', 'pending', 'comp'])
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
  isEarlyBirdActive,
  isRegistrationOpen,
  countActiveRegistrations,
  auditEntry,
  Timestamp,
  FieldValue,
};
