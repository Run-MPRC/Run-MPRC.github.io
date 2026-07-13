const functions = require('firebase-functions');
const admin = require('firebase-admin');

const {
  getStripe,
  generateToken,
  requireAppCheck,
  auditEntry,
  isValidEmail,
  Timestamp,
} = require('./stripeHelpers');
const { checkRateLimit, extractIp } = require('./rateLimit');

const HOUR_MS = 60 * 60 * 1000;
const MERCH_PER_IP_PER_HOUR = 20;
const MERCH_PER_EMAIL_PER_HOUR = 10;

function resolveSiteOrigin() {
  return process.env.SITE_ORIGIN || 'https://runmprc.com';
}

async function ensureStripeProduct(stripe, productRef, product) {
  if (product.stripeProductId) return product.stripeProductId;
  const created = await stripe.products.create({
    name: product.title,
    description: product.description?.slice(0, 500) || undefined,
    metadata: { productId: productRef.id, slug: product.slug || '' },
  });
  await productRef.update({
    stripeProductId: created.id,
    updatedAt: Timestamp.now(),
  });
  return created.id;
}

exports.createMerchCheckout = functions
  .runWith({ secrets: ['STRIPE_SECRET_KEY'] })
  .https.onCall(async (data, context) => {
    requireAppCheck(context);

    const {
      productSlug,
      buyer,
      size,
      color,
    } = data || {};

    if (!productSlug || typeof productSlug !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'productSlug required');
    }
    if (!buyer || !isValidEmail(buyer.email)
      || !buyer.firstName?.trim() || !buyer.lastName?.trim()) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'buyer first name, last name, and valid email required',
      );
    }

    const normalizedEmail = buyer.email.trim().toLowerCase();
    await Promise.all([
      checkRateLimit({
        scope: 'merch_ip',
        key: extractIp(context),
        limit: MERCH_PER_IP_PER_HOUR,
        windowMs: HOUR_MS,
      }),
      checkRateLimit({
        scope: 'merch_email',
        key: normalizedEmail,
        limit: MERCH_PER_EMAIL_PER_HOUR,
        windowMs: HOUR_MS,
      }),
    ]);

    const db = admin.firestore();
    const productRef = db.collection('products').doc(productSlug);
    const productSnap = await productRef.get();
    if (!productSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Product not found');
    }
    const product = productSnap.data();
    if (product.status !== 'active') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        product.status === 'sold_out' ? 'This item is sold out' : 'This item is unavailable',
      );
    }

    if (size && Array.isArray(product.sizes) && !product.sizes.includes(size)) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid size');
    }
    if (color && Array.isArray(product.colors) && !product.colors.includes(color)) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid color');
    }

    const confirmationToken = generateToken();
    const orderRef = db.collection('orders').doc();

    const orderBase = {
      productSlug,
      productTitle: product.title,
      buyer: {
        firstName: buyer.firstName.trim(),
        lastName: buyer.lastName.trim(),
        email: normalizedEmail,
        phone: buyer.phone?.trim() || null,
      },
      shipping: null,
      size: size || null,
      color: color || null,
      amountCents: product.priceCents,
      currency: 'usd',
      status: 'pending',
      stripeSessionId: null,
      stripePaymentIntentId: null,
      stripeChargeId: null,
      stripeRefundIds: [],
      confirmationToken,
      trackingNumber: null,
      fulfillmentNote: null,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      paidAt: null,
      fulfilledAt: null,
      refundedAt: null,
      cancelledAt: null,
      auditLog: [auditEntry({
        actorEmail: normalizedEmail,
        action: 'order.created',
        note: `product=${productSlug} size=${size || '-'} color=${color || '-'}`,
      })],
    };

    const stripe = getStripe();
    const stripeProductId = await ensureStripeProduct(stripe, productRef, {
      ...product,
      slug: productSlug,
    });
    const origin = resolveSiteOrigin();

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: normalizedEmail,
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: product.priceCents,
          product: stripeProductId,
        },
        quantity: 1,
      }],
      // Discounts remain disabled until a server-approved discount snapshot
      // and reconciliation contract is implemented (PROMO-001).
      allow_promotion_codes: false,
      automatic_tax: { enabled: false },
      shipping_address_collection: {
        allowed_countries: ['US', 'CA'],
      },
      phone_number_collection: { enabled: true },
      success_url: `${origin}/shop/purchase/success?session_id={CHECKOUT_SESSION_ID}&order=${orderRef.id}&token=${confirmationToken}`,
      cancel_url: `${origin}/shop/${productSlug}?cancelled=1`,
      metadata: {
        schemaVersion: '1',
        type: 'merch',
        productSlug,
        orderId: orderRef.id,
        size: size || '',
        color: color || '',
      },
      payment_intent_data: {
        metadata: {
          schemaVersion: '1',
          type: 'merch',
          productSlug,
          orderId: orderRef.id,
          size: size || '',
          color: color || '',
        },
      },
    });

    await orderRef.set({
      ...orderBase,
      stripeSessionId: session.id,
    });

    return {
      sessionId: session.id,
      url: session.url,
      orderId: orderRef.id,
    };
  });
