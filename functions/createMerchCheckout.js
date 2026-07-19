const functions = require('firebase-functions');
const admin = require('firebase-admin');

const {
  getStripe,
  generateToken,
  requireAppCheck,
  auditEntry,
  Timestamp,
} = require('./stripeHelpers');
const { checkRateLimit, extractIp } = require('./rateLimit');
const { loadCallableServerConfig } = require('./serverConfig');
const {
  COMMERCE_OPERATIONS,
  requireCommerceAdmission,
} = require('./commerceControl');
const {
  MerchCatalogError,
  MerchCheckoutValidationError,
  matchMerchandiseOptions,
  parseMerchCheckoutRequest,
  projectMerchandisePriceCents,
} = require('./merchCheckoutValidation');
const {
  projectCreatedStripeProductId,
  projectStoredStripeProductId,
} = require('./stripeProductBinding');
const {
  LEGACY_CHECKOUT_RESULT_FAILURE_MESSAGE,
  buildLegacyCheckoutSessionExpectation,
  projectLegacyCheckoutSessionResult,
} = require('./legacyCheckoutSessionResult');

const HOUR_MS = 60 * 60 * 1000;
const MERCH_PER_IP_PER_HOUR = 20;
const MERCH_PER_EMAIL_PER_HOUR = 10;
const INVALID_REQUEST_MESSAGE = 'Request data is invalid';

// Bound and freeze the untrusted payload before any Firestore or Stripe work.
// A shape/field failure is a fixed, message-stable invalid-argument.
function parseRequest(data) {
  try {
    return parseMerchCheckoutRequest(data);
  } catch (error) {
    if (error instanceof MerchCheckoutValidationError) {
      throw new functions.https.HttpsError('invalid-argument', INVALID_REQUEST_MESSAGE);
    }
    throw error;
  }
}

// Match the validated selections against the stored option lists. A selection
// that does not fit a well-formed catalog is a request fault (invalid-argument);
// a malformed stored option list is an availability fault (failed-precondition).
function matchOptions(product, request) {
  try {
    return matchMerchandiseOptions(product, request);
  } catch (error) {
    if (error instanceof MerchCheckoutValidationError) {
      throw new functions.https.HttpsError('invalid-argument', INVALID_REQUEST_MESSAGE);
    }
    if (error instanceof MerchCatalogError) {
      throw new functions.https.HttpsError('failed-precondition', 'This item is unavailable');
    }
    throw error;
  }
}

async function ensureStripeProduct({
  expectedLivemode,
  product,
  productRef,
  productSlug,
  storedStripeProductId,
  stripe,
}) {
  if (storedStripeProductId !== undefined) return storedStripeProductId;
  const created = await stripe.products.create({
    name: product.title,
    description: product.description?.slice(0, 500) || undefined,
    metadata: { productId: productRef.id, slug: productSlug },
  });
  const createdStripeProductId = projectCreatedStripeProductId(
    created,
    expectedLivemode,
  );
  if (createdStripeProductId === null) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'This item is unavailable',
    );
  }
  await productRef.update({
    stripeProductId: createdStripeProductId,
    updatedAt: Timestamp.now(),
  });
  return createdStripeProductId;
}

exports.createMerchCheckout = functions
  .runWith({ secrets: ['STRIPE_SECRET_KEY'] })
  .https.onCall(async (data, context) => {
    requireAppCheck(context);
    const serverConfig = loadCallableServerConfig({
      requireStripeKey: true,
      requireCommerceCeiling: true,
    });

    const request = parseRequest(data);
    const { productSlug, buyer } = request;

    const db = admin.firestore();
    const productRef = db.collection('products').doc(productSlug);
    const { targetSnapshot: productSnap } = await requireCommerceAdmission({
      db,
      operation: COMMERCE_OPERATIONS.MERCHANDISE_CHECKOUT,
      deploymentEnabled: serverConfig.commerceEnabled,
      targetRef: productRef,
    });

    const normalizedEmail = buyer.email;
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

    const product = productSnap.data();
    if (product.status !== 'active') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        product.status === 'sold_out' ? 'This item is sold out' : 'This item is unavailable',
      );
    }

    const selections = matchOptions(product, request);

    const priceCents = projectMerchandisePriceCents(product);
    if (priceCents === null) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'This item is unavailable',
      );
    }

    const storedStripeProductId = projectStoredStripeProductId(product);
    if (storedStripeProductId === null) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'This item is unavailable',
      );
    }

    const confirmationToken = generateToken();
    const orderRef = db.collection('orders').doc();

    const orderBase = {
      productSlug,
      productTitle: product.title,
      buyer: {
        firstName: buyer.firstName,
        lastName: buyer.lastName,
        email: normalizedEmail,
        phone: buyer.phone,
      },
      shipping: null,
      size: selections.size,
      color: selections.color,
      amountCents: priceCents,
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
        note: `product=${productSlug} size=${selections.size || '-'} color=${selections.color || '-'}`,
      })],
    };

    const origin = serverConfig.siteOrigin;
    const successUrl = `${origin}/shop/purchase/success?session_id={CHECKOUT_SESSION_ID}&order=${orderRef.id}&token=${confirmationToken}`;
    const cancelUrl = `${origin}/shop/${encodeURIComponent(productSlug)}?cancelled=1`;
    const sessionMetadata = Object.freeze({
      schemaVersion: '1',
      type: 'merch',
      productSlug,
      orderId: orderRef.id,
      size: selections.size || '',
      color: selections.color || '',
    });
    const resultExpectation = buildLegacyCheckoutSessionExpectation({
      livemode: serverConfig.stripeLivemodeExpected,
      amountCents: priceCents,
      customerEmail: normalizedEmail,
      successUrl,
      cancelUrl,
      metadata: sessionMetadata,
    });
    if (resultExpectation === null) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        LEGACY_CHECKOUT_RESULT_FAILURE_MESSAGE,
      );
    }
    const stripe = getStripe();
    const stripeProductId = await ensureStripeProduct({
      expectedLivemode: serverConfig.stripeLivemodeExpected,
      product,
      productRef,
      productSlug,
      storedStripeProductId,
      stripe,
    });

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: normalizedEmail,
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: priceCents,
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
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: sessionMetadata,
        payment_intent_data: {
          metadata: sessionMetadata,
        },
      });
    } catch {
      throw new functions.https.HttpsError(
        'failed-precondition',
        LEGACY_CHECKOUT_RESULT_FAILURE_MESSAGE,
      );
    }
    const checkoutResult = projectLegacyCheckoutSessionResult(
      session,
      resultExpectation,
    );
    if (checkoutResult === null) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        LEGACY_CHECKOUT_RESULT_FAILURE_MESSAGE,
      );
    }

    await orderRef.set({
      ...orderBase,
      stripeSessionId: checkoutResult.sessionId,
    });

    return {
      sessionId: checkoutResult.sessionId,
      url: checkoutResult.url,
      orderId: orderRef.id,
    };
  });
