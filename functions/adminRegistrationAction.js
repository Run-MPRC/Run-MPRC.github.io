const functions = require('firebase-functions');
const admin = require('firebase-admin');

const {
  getStripe,
  requireAdmin,
  requireAppCheck,
  generateToken,
  isValidEmail,
  auditEntry,
  Timestamp,
} = require('./stripeHelpers');
const { loadCallableServerConfig } = require('./serverConfig');
const {
  COMMERCE_OPERATIONS,
  requireCommerceAdmission,
} = require('./commerceControl');

const ACTIONS = new Set([
  'refund_full',
  'refund_partial',
  'cancel',
  'substitute',
  'mark_comp',
  'add_note',
  'add_late_registration',
]);

function regRef(eventId, registrationId) {
  return admin.firestore()
    .collection('events').doc(eventId)
    .collection('registrations').doc(registrationId);
}

async function refund({
  stripe, doc, reg, actor, amountCents,
}) {
  if (!reg.stripePaymentIntentId) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'No Stripe payment intent recorded for this registration',
    );
  }
  const refundPayload = { payment_intent: reg.stripePaymentIntentId };
  if (amountCents && amountCents > 0 && amountCents < reg.amountCents) {
    refundPayload.amount = amountCents;
  }
  const stripeRefund = await stripe.refunds.create(refundPayload);

  const isFull = !refundPayload.amount;
  await doc.ref.update({
    status: isFull ? 'refunded' : 'partially_refunded',
    refundedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    stripeRefundIds: admin.firestore.FieldValue.arrayUnion(stripeRefund.id),
    auditLog: admin.firestore.FieldValue.arrayUnion(
      auditEntry({
        actorUid: actor.uid,
        actorEmail: actor.email,
        action: isFull ? 'admin.refund_full' : 'admin.refund_partial',
        note: `refund=${stripeRefund.id} amount=${refundPayload.amount || reg.amountCents}`,
      }),
    ),
  });

  return { ok: true, refundId: stripeRefund.id };
}

async function cancel({ doc, actor, note }) {
  await doc.ref.update({
    status: 'cancelled',
    cancelledAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    auditLog: admin.firestore.FieldValue.arrayUnion(
      auditEntry({
        actorUid: actor.uid, actorEmail: actor.email, action: 'admin.cancel', note,
      }),
    ),
  });
  return { ok: true };
}

async function substitute({ doc, actor, newRunner }) {
  if (!newRunner || !isValidEmail(newRunner.email)) {
    throw new functions.https.HttpsError('invalid-argument', 'Valid newRunner.email required');
  }
  await doc.ref.update({
    runner: {
      firstName: (newRunner.firstName || '').trim(),
      lastName: (newRunner.lastName || '').trim(),
      email: newRunner.email.trim().toLowerCase(),
      phone: newRunner.phone?.trim() || null,
      dob: newRunner.dob || null,
      emergencyContactName: newRunner.emergencyContactName?.trim() || null,
      emergencyContactPhone: newRunner.emergencyContactPhone?.trim() || null,
      shirtSize: newRunner.shirtSize || null,
      extras: newRunner.extras || {},
    },
    updatedAt: Timestamp.now(),
    auditLog: admin.firestore.FieldValue.arrayUnion(
      auditEntry({
        actorUid: actor.uid,
        actorEmail: actor.email,
        action: 'admin.substitute',
        note: `new=${newRunner.email}`,
      }),
    ),
  });
  return { ok: true };
}

async function markComp({ eventId, registration, actor }) {
  if (!registration || !isValidEmail(registration.runner?.email)) {
    throw new functions.https.HttpsError('invalid-argument', 'registration.runner.email required');
  }
  const newRef = admin.firestore()
    .collection('events').doc(eventId)
    .collection('registrations').doc();

  await newRef.set({
    eventId,
    runner: {
      firstName: (registration.runner.firstName || '').trim(),
      lastName: (registration.runner.lastName || '').trim(),
      email: registration.runner.email.trim().toLowerCase(),
      phone: registration.runner.phone?.trim() || null,
      dob: registration.runner.dob || null,
      emergencyContactName: registration.runner.emergencyContactName?.trim() || null,
      emergencyContactPhone: registration.runner.emergencyContactPhone?.trim() || null,
      shirtSize: registration.runner.shirtSize || null,
      extras: registration.extras || {},
    },
    uid: null,
    priceTier: 'comp',
    amountCents: 0,
    currency: 'usd',
    promoCode: null,
    status: 'comp',
    stripeSessionId: null,
    stripePaymentIntentId: null,
    stripeChargeId: null,
    stripeRefundIds: [],
    stripePaymentLinkId: null,
    waiverAcceptedAt: Timestamp.now(),
    waiverVersion: registration.waiverVersion || null,
    confirmationToken: generateToken(),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    paidAt: Timestamp.now(),
    refundedAt: null,
    cancelledAt: null,
    auditLog: [auditEntry({
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: 'admin.mark_comp',
      note: `comp for ${registration.runner.email}`,
    })],
  });
  return { ok: true, registrationId: newRef.id };
}

async function addLateRegistration({
  stripe, eventId, registration, actor, siteOrigin, eventSnap,
}) {
  if (!registration || !isValidEmail(registration.runner?.email)) {
    throw new functions.https.HttpsError('invalid-argument', 'registration.runner.email required');
  }
  const amountCents = Number(registration.amountCents) || 0;
  const priceTier = registration.priceTier || 'nonMember';

  const event = eventSnap.data();

  const newRef = admin.firestore()
    .collection('events').doc(eventId)
    .collection('registrations').doc();
  const confirmationToken = generateToken();

  const base = {
    eventId,
    runner: {
      firstName: (registration.runner.firstName || '').trim(),
      lastName: (registration.runner.lastName || '').trim(),
      email: registration.runner.email.trim().toLowerCase(),
      phone: registration.runner.phone?.trim() || null,
      dob: registration.runner.dob || null,
      emergencyContactName: registration.runner.emergencyContactName?.trim() || null,
      emergencyContactPhone: registration.runner.emergencyContactPhone?.trim() || null,
      shirtSize: registration.runner.shirtSize || null,
      extras: registration.runner.extras || {},
    },
    uid: null,
    priceTier,
    amountCents,
    currency: 'usd',
    promoCode: null,
    status: amountCents === 0 ? 'paid' : 'pending',
    stripeSessionId: null,
    stripePaymentIntentId: null,
    stripeChargeId: null,
    stripeRefundIds: [],
    stripePaymentLinkId: null,
    waiverAcceptedAt: Timestamp.now(),
    waiverVersion: event.waiverVersion || null,
    confirmationToken,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    paidAt: amountCents === 0 ? Timestamp.now() : null,
    refundedAt: null,
    cancelledAt: null,
    auditLog: [auditEntry({
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: 'admin.late_add',
      note: `tier=${priceTier} amount=${amountCents}`,
    })],
  };

  if (amountCents === 0) {
    await newRef.set(base);
    return { ok: true, registrationId: newRef.id, paymentLink: null };
  }

  // Create a Stripe Payment Link so the registrant can pay out-of-band
  if (!event.stripeProductId) {
    const product = await stripe.products.create({
      name: event.title,
      metadata: { eventId, slug: event.slug || '' },
    });
    await eventSnap.ref.update({
      stripeProductId: product.id,
      updatedAt: Timestamp.now(),
    });
    event.stripeProductId = product.id;
  }

  const price = await stripe.prices.create({
    unit_amount: amountCents,
    currency: 'usd',
    product: event.stripeProductId,
    metadata: { eventId, registrationId: newRef.id, priceTier, late_add: 'true' },
  });

  const link = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: { eventId, registrationId: newRef.id, priceTier, late_add: 'true' },
    after_completion: {
      type: 'redirect',
      redirect: {
        url: `${siteOrigin}/register/success?reg=${newRef.id}&token=${confirmationToken}`,
      },
    },
  });

  await newRef.set({ ...base, stripePaymentLinkId: link.id });

  return { ok: true, registrationId: newRef.id, paymentLink: link.url };
}

exports.adminRegistrationAction = functions
  .runWith({ secrets: ['STRIPE_SECRET_KEY'] })
  .https.onCall(async (data, context) => {
    requireAppCheck(context);
    await requireAdmin(context);
    const serverConfig = loadCallableServerConfig({
      requireStripeKey: true,
      requireCommerceCeiling: true,
    });

    const {
      eventId, registrationId, action, payload = {},
    } = data || {};
    if (!eventId || typeof eventId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'eventId required');
    }
    if (!ACTIONS.has(action)) {
      throw new functions.https.HttpsError('invalid-argument', `Unknown action: ${action}`);
    }

    const actor = {
      uid: context.auth.uid,
      email: context.auth.token?.email || null,
    };
    const db = admin.firestore();

    // Actions that don't need an existing registration doc
    if (action === 'mark_comp') {
      const eventRef = db.collection('events').doc(eventId);
      await requireCommerceAdmission({
        db,
        operation: COMMERCE_OPERATIONS.RACE_REGISTRATION,
        deploymentEnabled: serverConfig.commerceEnabled,
        targetRef: eventRef,
      });
      return markComp({ eventId, registration: payload.registration, actor });
    }
    if (action === 'add_late_registration') {
      const eventRef = db.collection('events').doc(eventId);
      const { targetSnapshot: eventSnap } = await requireCommerceAdmission({
        db,
        operation: COMMERCE_OPERATIONS.RACE_REGISTRATION,
        deploymentEnabled: serverConfig.commerceEnabled,
        targetRef: eventRef,
      });
      const stripe = getStripe();
      return addLateRegistration({
        stripe,
        eventId,
        registration: payload.registration,
        actor,
        siteOrigin: serverConfig.siteOrigin,
        eventSnap,
      });
    }

    if (!registrationId) {
      throw new functions.https.HttpsError('invalid-argument', 'registrationId required');
    }
    if (action === 'refund_full' || action === 'refund_partial') {
      await requireCommerceAdmission({
        db,
        operation: COMMERCE_OPERATIONS.INCIDENT_REFUND,
        deploymentEnabled: serverConfig.commerceEnabled,
      });
    }

    const ref = regRef(eventId, registrationId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'Registration not found');
    }
    const reg = snap.data();

    if (action === 'add_note') {
      await ref.update({
        updatedAt: Timestamp.now(),
        auditLog: admin.firestore.FieldValue.arrayUnion(
          auditEntry({
            actorUid: actor.uid, actorEmail: actor.email, action: 'admin.note', note: payload.note || '',
          }),
        ),
      });
      return { ok: true };
    }

    if (action === 'cancel') {
      return cancel({ doc: snap, actor, note: payload.note });
    }

    if (action === 'substitute') {
      return substitute({ doc: snap, actor, newRunner: payload.newRunner });
    }

    if (action === 'refund_full' || action === 'refund_partial') {
      const stripe = getStripe();
      const amountCents = action === 'refund_partial' ? Number(payload.amountCents) : null;
      if (action === 'refund_partial' && (!amountCents || amountCents <= 0)) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'amountCents required for partial refund',
        );
      }
      return refund({
        stripe, doc: snap, reg, actor, amountCents,
      });
    }

    throw new functions.https.HttpsError('internal', 'Unhandled action');
  });
