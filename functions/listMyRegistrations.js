const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { requireAppCheck } = require('./stripeHelpers');

function sanitize(regDoc) {
  const d = regDoc.data();
  return {
    id: regDoc.id,
    eventId: d.eventId,
    status: d.status,
    priceTier: d.priceTier,
    amountCents: d.amountCents,
    currency: d.currency,
    createdAt: d.createdAt || null,
    paidAt: d.paidAt || null,
    refundedAt: d.refundedAt || null,
    cancelledAt: d.cancelledAt || null,
  };
}

exports.listMyRegistrations = functions.https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }
  const { uid } = context.auth;

  let db;
  let byUid;
  try {
    db = admin.firestore();
    byUid = await db.collectionGroup('registrations')
      .where('uid', '==', uid)
      .get();
  } catch {
    throw new functions.https.HttpsError(
      'unavailable',
      'Registration data could not be loaded.',
    );
  }

  const results = new Map();
  try {
    byUid.forEach((d) => results.set(d.ref.path, sanitize(d)));
  } catch {
    throw new functions.https.HttpsError(
      'unavailable',
      'Registration data could not be loaded.',
    );
  }

  const eventIds = Array.from(new Set(
    Array.from(results.values()).map((r) => r.eventId).filter(Boolean),
  ));

  const events = {};
  await Promise.all(eventIds.map(async (eid) => {
    let ev;
    try {
      ev = await db.collection('events').doc(eid).get();
    } catch {
      throw new functions.https.HttpsError(
        'unavailable',
        'Registration data could not be loaded.',
      );
    }
    try {
      if (ev.exists) {
        const e = ev.data();
        events[eid] = {
          id: eid,
          slug: e.slug || eid,
          title: e.title,
          startAt: e.startAt,
          location: e.location,
        };
      }
    } catch {
      throw new functions.https.HttpsError(
        'unavailable',
        'Registration data could not be loaded.',
      );
    }
  }));

  let registrations;
  try {
    registrations = Array.from(results.values()).sort((a, b) => {
      const ta = a.createdAt?._seconds || 0;
      const tb = b.createdAt?._seconds || 0;
      return tb - ta;
    });
  } catch {
    throw new functions.https.HttpsError(
      'unavailable',
      'Registration data could not be loaded.',
    );
  }

  return { registrations, events };
});
