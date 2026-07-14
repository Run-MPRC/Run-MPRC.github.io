const functions = require('firebase-functions');
const admin = require('firebase-admin');

const {
  getStripe,
  requireAdmin,
  requireAppCheck,
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

const ACTIONS = new Set([
  'mark_fulfilled',
  'set_tracking',
  'add_note',
  'cancel',
  'refund_full',
  'refund_partial',
]);

function orderRef(orderId) {
  return admin.firestore().collection('orders').doc(orderId);
}

exports.adminOrderAction = functions
  .runWith({ secrets: ['STRIPE_SECRET_KEY'] })
  .https.onCall(async (data, context) => {
    requireAppCheck(context);
    await requireAdmin(context);
    const serverConfig = loadCallableServerConfig({
      requireStripeKey: true,
      requireCommerceCeiling: true,
    });

    const { orderId, action, payload = {} } = data || {};
    if (!orderId) {
      throw new functions.https.HttpsError('invalid-argument', 'orderId required');
    }
    if (!ACTIONS.has(action)) {
      throw new functions.https.HttpsError('invalid-argument', `Unknown action: ${action}`);
    }

    const db = admin.firestore();
    if (action === 'refund_full' || action === 'refund_partial') {
      await requireCommerceAdmission({
        db,
        operation: COMMERCE_OPERATIONS.INCIDENT_REFUND,
        deploymentEnabled: serverConfig.commerceEnabled,
      });
    }

    const ref = orderRef(orderId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'Order not found');
    }
    const order = snap.data();
    const actor = {
      uid: context.auth.uid,
      email: context.auth.token?.email || null,
    };

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

    if (action === 'mark_fulfilled') {
      await ref.update({
        status: 'fulfilled',
        fulfilledAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        fulfillmentNote: payload.note || order.fulfillmentNote || null,
        trackingNumber: payload.trackingNumber || order.trackingNumber || null,
        auditLog: admin.firestore.FieldValue.arrayUnion(
          auditEntry({
            actorUid: actor.uid, actorEmail: actor.email, action: 'admin.mark_fulfilled', note: payload.note || '',
          }),
        ),
      });
      return { ok: true };
    }

    if (action === 'set_tracking') {
      await ref.update({
        trackingNumber: payload.trackingNumber || null,
        updatedAt: Timestamp.now(),
        auditLog: admin.firestore.FieldValue.arrayUnion(
          auditEntry({
            actorUid: actor.uid, actorEmail: actor.email, action: 'admin.set_tracking', note: payload.trackingNumber || '',
          }),
        ),
      });
      return { ok: true };
    }

    if (action === 'cancel') {
      await ref.update({
        status: 'cancelled',
        cancelledAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        auditLog: admin.firestore.FieldValue.arrayUnion(
          auditEntry({
            actorUid: actor.uid, actorEmail: actor.email, action: 'admin.cancel', note: payload.note || '',
          }),
        ),
      });
      return { ok: true };
    }

    if (action === 'refund_full' || action === 'refund_partial') {
      let amountCents = null;
      if (action === 'refund_partial') {
        const validation = validatePartialRefundAmount({
          amountCents: payload?.amountCents,
          originalAmountCents: order.amountCents,
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
        paymentIntentId: order.stripePaymentIntentId,
        currency: order.currency,
        originalAmountCents: order.amountCents,
        requestedAmountCents: amountCents,
      });
      if (!expectation.ok) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Stored refund target is unavailable',
        );
      }
      const stripe = getStripe();
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
        await ref.update({
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

    throw new functions.https.HttpsError('internal', 'Unhandled action');
  });
