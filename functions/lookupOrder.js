const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { requireAppCheck } = require('./stripeHelpers');
const { checkRateLimit, extractIp } = require('./rateLimit');

exports.lookupOrder = functions.https.onCall(async (data, context) => {
  requireAppCheck(context);
  await checkRateLimit({
    scope: 'lookup_order_ip',
    key: extractIp(context),
    limit: 240,
    windowMs: 60 * 60 * 1000,
  });

  const { orderId, token } = data || {};
  if (!orderId || !token) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'orderId and token are required',
    );
  }
  const ref = admin.firestore().collection('orders').doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'Order not found');
  }
  const order = snap.data();
  if (order.confirmationToken !== token) {
    throw new functions.https.HttpsError('permission-denied', 'Invalid token');
  }

  return {
    id: snap.id,
    status: order.status,
    amountCents: order.amountCents,
    currency: order.currency,
    productSlug: order.productSlug,
    productTitle: order.productTitle,
    size: order.size || null,
    color: order.color || null,
    buyer: {
      firstName: order.buyer?.firstName || '',
      lastName: order.buyer?.lastName || '',
      email: order.buyer?.email || '',
    },
    paidAt: order.paidAt || null,
    createdAt: order.createdAt || null,
  };
});
