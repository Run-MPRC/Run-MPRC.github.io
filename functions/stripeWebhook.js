const functions = require('firebase-functions');
const admin = require('firebase-admin');

const {
  getStripe,
  getWebhookSecret,
  auditEntry,
  Timestamp,
} = require('./stripeHelpers');

async function findRegistrationBySessionId(sessionId) {
  const snap = await admin.firestore()
    .collectionGroup('registrations')
    .where('stripeSessionId', '==', sessionId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

async function findRegistrationByPaymentIntent(piId) {
  const snap = await admin.firestore()
    .collectionGroup('registrations')
    .where('stripePaymentIntentId', '==', piId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

async function findOrderBySessionId(sessionId) {
  const snap = await admin.firestore()
    .collection('orders')
    .where('stripeSessionId', '==', sessionId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

async function findOrderByPaymentIntent(piId) {
  const snap = await admin.firestore()
    .collection('orders')
    .where('stripePaymentIntentId', '==', piId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

function isMerchSession(session) {
  return session?.metadata?.type === 'merch';
}

async function handleMerchCheckoutCompleted(session) {
  const doc = await findOrderBySessionId(session.id);
  if (!doc) {
    console.warn('Webhook: no order for session', session.id);
    return;
  }
  const order = doc.data();
  if (order.status === 'paid') return;

  const shipping = session.shipping_details?.address
    ? {
      line1: session.shipping_details.address.line1 || '',
      line2: session.shipping_details.address.line2 || null,
      city: session.shipping_details.address.city || '',
      state: session.shipping_details.address.state || '',
      postalCode: session.shipping_details.address.postal_code || '',
      country: session.shipping_details.address.country || '',
      recipientName: session.shipping_details.name || null,
    }
    : null;

  await doc.ref.update({
    status: 'paid',
    stripePaymentIntentId: session.payment_intent || null,
    shipping,
    paidAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    auditLog: admin.firestore.FieldValue.arrayUnion(
      auditEntry({ action: 'order.payment_completed', note: `pi=${session.payment_intent || ''}` }),
    ),
  });
}

async function handleMerchChargeRefunded(charge) {
  const piId = charge.payment_intent;
  if (!piId) return;
  const doc = await findOrderByPaymentIntent(piId);
  if (!doc) return;
  const order = doc.data();
  const amountRefunded = charge.amount_refunded || 0;
  const totalAmount = charge.amount || order.amountCents || 0;
  const fullyRefunded = amountRefunded >= totalAmount && totalAmount > 0;
  await doc.ref.update({
    status: fullyRefunded ? 'refunded' : 'partially_refunded',
    stripeChargeId: charge.id,
    refundedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    auditLog: admin.firestore.FieldValue.arrayUnion(
      auditEntry({
        action: fullyRefunded ? 'order.refund_full' : 'order.refund_partial',
        note: `refunded=${amountRefunded} of ${totalAmount}`,
      }),
    ),
  });
}

async function handleCheckoutCompleted(session) {
  if (isMerchSession(session)) {
    await handleMerchCheckoutCompleted(session);
    return;
  }
  const doc = await findRegistrationBySessionId(session.id);
  if (!doc) {
    console.warn('Webhook: no registration for session', session.id);
    return;
  }
  const reg = doc.data();
  if (reg.status === 'paid') return;

  await doc.ref.update({
    status: 'paid',
    stripePaymentIntentId: session.payment_intent || null,
    paidAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    auditLog: admin.firestore.FieldValue.arrayUnion(
      auditEntry({ action: 'payment.completed', note: `pi=${session.payment_intent || ''}` }),
    ),
  });
}

async function handleCheckoutExpired(session) {
  const doc = await findRegistrationBySessionId(session.id);
  if (!doc) return;
  const reg = doc.data();
  if (reg.status !== 'pending') return;
  await doc.ref.update({
    status: 'cancelled',
    cancelledAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    auditLog: admin.firestore.FieldValue.arrayUnion(
      auditEntry({ action: 'session.expired' }),
    ),
  });
}

async function handleChargeRefunded(charge) {
  const paymentIntentId = charge.payment_intent;
  if (!paymentIntentId) return;
  if (charge.metadata?.type === 'merch') {
    await handleMerchChargeRefunded(charge);
    return;
  }
  const doc = await findRegistrationByPaymentIntent(paymentIntentId);
  if (!doc) {
    // Might be a merch order whose metadata didn't surface on the charge
    const merchDoc = await findOrderByPaymentIntent(paymentIntentId);
    if (merchDoc) {
      await handleMerchChargeRefunded(charge);
      return;
    }
    console.warn('Webhook: no registration for payment_intent', paymentIntentId);
    return;
  }
  const reg = doc.data();
  const amountRefunded = charge.amount_refunded || 0;
  const totalAmount = charge.amount || reg.amountCents || 0;
  const fullyRefunded = amountRefunded >= totalAmount && totalAmount > 0;
  const newStatus = fullyRefunded ? 'refunded' : 'partially_refunded';

  await doc.ref.update({
    status: newStatus,
    stripeChargeId: charge.id,
    refundedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    auditLog: admin.firestore.FieldValue.arrayUnion(
      auditEntry({
        action: fullyRefunded ? 'refund.full' : 'refund.partial',
        note: `refunded=${amountRefunded} of ${totalAmount}`,
      }),
    ),
  });
}

async function handleDisputeCreated(dispute) {
  const piId = dispute.payment_intent;
  if (!piId) return;
  const doc = await findRegistrationByPaymentIntent(piId);
  if (!doc) return;
  await doc.ref.update({
    updatedAt: Timestamp.now(),
    auditLog: admin.firestore.FieldValue.arrayUnion(
      auditEntry({
        action: 'dispute.created',
        note: `reason=${dispute.reason || ''} amount=${dispute.amount || 0}`,
      }),
    ),
  });
}

exports.stripeWebhook = functions
  .runWith({ secrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] })
  .https.onRequest(async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).send('Method not allowed');
      return;
    }

    let event;
    try {
      const stripe = getStripe();
      const signature = request.get('stripe-signature');
      event = stripe.webhooks.constructEvent(
        request.rawBody,
        signature,
        getWebhookSecret(),
      );
    } catch (err) {
      console.error('Webhook signature verification failed', err.message);
      response.status(400).send(`Webhook signature error: ${err.message}`);
      return;
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(event.data.object);
          break;
        case 'checkout.session.expired':
          await handleCheckoutExpired(event.data.object);
          break;
        case 'charge.refunded':
          await handleChargeRefunded(event.data.object);
          break;
        case 'charge.dispute.created':
          await handleDisputeCreated(event.data.object);
          break;
        default:
          break;
      }
      response.json({ received: true });
    } catch (err) {
      console.error('Webhook handler error', err);
      response.status(500).send('Webhook handler error');
    }
  });
