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
const {
  REFUND_VALIDATION_REASONS,
  validatePartialRefundAmount,
} = require('./refundValidation');
const {
  REFUND_RESULT_NOT_CONFIRMED_MESSAGE,
  buildRefundExpectation,
  validateSucceededRefundResponse,
} = require('./refundResponseValidation');

const numberIsSafeInteger = Number.isSafeInteger;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwn = Object.hasOwn;
const objectIs = Object.is;
const STRIPE_MINIMUM_USD_CENTS = 50;
const STRIPE_UNIT_AMOUNT_MAX_CENTS = 99_999_999;

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

function readLateRegistrationAmountCents(registration) {
  const descriptor = objectGetOwnPropertyDescriptor(registration, 'amountCents');
  if (!descriptor || !objectHasOwn(descriptor, 'value')) return null;

  const amountCents = descriptor.value;
  if (
    typeof amountCents !== 'number'
    || !numberIsSafeInteger(amountCents)
    || objectIs(amountCents, -0)
    || amountCents < 0
    || (amountCents !== 0 && amountCents < STRIPE_MINIMUM_USD_CENTS)
    || amountCents > STRIPE_UNIT_AMOUNT_MAX_CENTS
  ) {
    return null;
  }
  return amountCents;
}

async function refund({
  stripe, doc, actor, action, expectation,
}) {
  const refundPayload = { payment_intent: expectation.paymentIntentId };
  if (action === 'refund_partial') {
    refundPayload.amount = expectation.requestedAmountCents;
  }
  let stripeRefund;
  try {
    stripeRefund = await stripe.refunds.create(refundPayload);
  } catch {
    throw new functions.https.HttpsError(
      'internal',
      REFUND_RESULT_NOT_CONFIRMED_MESSAGE,
    );
  }
  const validatedRefund = validateSucceededRefundResponse({
    refund: stripeRefund,
    expectation,
  });
  if (!validatedRefund.ok) {
    throw new functions.https.HttpsError(
      'internal',
      REFUND_RESULT_NOT_CONFIRMED_MESSAGE,
    );
  }

  const isFull = action === 'refund_full';
  try {
    await doc.ref.update({
      status: isFull ? 'refunded' : 'partially_refunded',
      refundedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      stripeRefundIds: admin.firestore.FieldValue.arrayUnion(validatedRefund.refundId),
      auditLog: admin.firestore.FieldValue.arrayUnion(
        auditEntry({
          actorUid: actor.uid,
          actorEmail: actor.email,
          action: isFull ? 'admin.refund_full' : 'admin.refund_partial',
          note: `refund=${validatedRefund.refundId} amount=${validatedRefund.amountCents}`,
        }),
      ),
    });
  } catch {
    throw new functions.https.HttpsError(
      'internal',
      REFUND_RESULT_NOT_CONFIRMED_MESSAGE,
    );
  }

  return { ok: true, refundId: validatedRefund.refundId };
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
  eventId, registration, actor, eventSnap,
}) {
  if (!registration || !isValidEmail(registration.runner?.email)) {
    throw new functions.https.HttpsError('invalid-argument', 'registration.runner.email required');
  }
  const amountCents = readLateRegistrationAmountCents(registration);
  if (amountCents === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Invalid late registration amount',
    );
  }
  if (amountCents !== 0) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Paid late registration is not available',
    );
  }
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
    status: 'paid',
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
    paidAt: Timestamp.now(),
    refundedAt: null,
    cancelledAt: null,
    auditLog: [auditEntry({
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: 'admin.late_add',
      note: `tier=${priceTier} amount=${amountCents}`,
    })],
  };

  await newRef.set(base);
  return { ok: true, registrationId: newRef.id, paymentLink: null };
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
      return addLateRegistration({
        eventId,
        registration: payload.registration,
        actor,
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
      let amountCents = null;
      if (action === 'refund_partial') {
        const validation = validatePartialRefundAmount({
          amountCents: payload?.amountCents,
          originalAmountCents: reg.amountCents,
        });
        if (!validation.ok) {
          const invalidStoredTotal = (
            validation.reason === REFUND_VALIDATION_REASONS.INVALID_STORED_TOTAL
          );
          throw new functions.https.HttpsError(
            invalidStoredTotal ? 'failed-precondition' : 'invalid-argument',
            invalidStoredTotal
              ? 'Stored refund total is unavailable'
              : 'Invalid partial refund amount',
          );
        }
        amountCents = validation.amountCents;
      }
      const expectation = buildRefundExpectation({
        action,
        paymentIntentId: reg.stripePaymentIntentId,
        currency: reg.currency,
        originalAmountCents: reg.amountCents,
        requestedAmountCents: amountCents,
      });
      if (!expectation.ok) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Stored refund target is unavailable',
        );
      }
      const stripe = getStripe();
      return refund({
        stripe, doc: snap, actor, action, expectation,
      });
    }

    throw new functions.https.HttpsError('internal', 'Unhandled action');
  });
