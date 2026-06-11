const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { requireAppCheck } = require('./stripeHelpers');
const { checkRateLimit, extractIp } = require('./rateLimit');

// Generous: success page polls ~15×/registration for 30s. Cap covers
// a single user opening multiple registrations + reloads.
const LOOKUP_PER_IP_PER_HOUR = 240;

function safeRunner(r) {
  if (!r) return null;
  return {
    firstName: r.firstName || '',
    lastName: r.lastName || '',
    email: r.email || '',
    shirtSize: r.shirtSize || null,
  };
}

exports.lookupRegistration = functions.https.onCall(async (data, context) => {
  requireAppCheck(context);
  await checkRateLimit({
    scope: 'lookup_ip',
    key: extractIp(context),
    limit: LOOKUP_PER_IP_PER_HOUR,
    windowMs: 60 * 60 * 1000,
  });
  const { eventId, registrationId, token } = data || {};
  if (!eventId || !registrationId || !token) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'eventId, registrationId, and token are required',
    );
  }

  const ref = admin.firestore()
    .collection('events').doc(eventId)
    .collection('registrations').doc(registrationId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'Registration not found');
  }
  const reg = snap.data();
  if (reg.confirmationToken !== token) {
    throw new functions.https.HttpsError('permission-denied', 'Invalid token');
  }

  return {
    id: snap.id,
    status: reg.status,
    priceTier: reg.priceTier,
    amountCents: reg.amountCents,
    currency: reg.currency,
    runner: safeRunner(reg.runner),
    eventId: reg.eventId,
    paidAt: reg.paidAt || null,
    createdAt: reg.createdAt || null,
  };
});
