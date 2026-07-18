const functions = require('firebase-functions');
const admin = require('firebase-admin');

const {
  getStripe,
  generateToken,
  resolveCallerRole,
  requireAppCheck,
  pickPriceCents,
  projectEventCheckoutAudience,
  projectParticipantCapacityLimit,
  isEarlyBirdActive,
  isRegistrationOpen,
  countActiveRegistrations,
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
  RaceCheckoutValidationError,
  parseRaceCheckoutRequest,
  parseRaceCheckoutAnswers,
} = require('./raceCheckoutValidation');

const HOUR_MS = 60 * 60 * 1000;
const CHECKOUT_PER_IP_PER_HOUR = 20;
const CHECKOUT_PER_EMAIL_PER_HOUR = 10;

const SUCCESS_PATH = '/register/success';
const CANCEL_PATH_PREFIX = '/events/';
const INVALID_REQUEST_MESSAGE = 'Request data is invalid';

function mapValidationError(error) {
  if (error instanceof RaceCheckoutValidationError) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      INVALID_REQUEST_MESSAGE,
    );
  }
  throw error;
}

function parseRequest(data) {
  try {
    return parseRaceCheckoutRequest(data);
  } catch (error) {
    return mapValidationError(error);
  }
}

function parseAnswers(input) {
  try {
    return parseRaceCheckoutAnswers(input);
  } catch (error) {
    return mapValidationError(error);
  }
}

function resolvePriceTier({ requestedTier, event, callerRole, now }) {
  const pricing = event.pricing || {};
  const earlyBirdActive = isEarlyBirdActive(event, now);
  const isMemberLike = callerRole === 'member' || callerRole === 'admin';

  if (requestedTier === 'earlyBird') {
    if (!earlyBirdActive) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Early-bird pricing is no longer available',
      );
    }
    return 'earlyBird';
  }

  if (requestedTier === 'member') {
    if (!isMemberLike) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Sign in as a member to claim the member price',
      );
    }
    return 'member';
  }

  if (requestedTier === 'nonMember') return 'nonMember';

  if (earlyBirdActive) return 'earlyBird';
  if (isMemberLike && typeof pricing.memberCents === 'number') return 'member';
  return 'nonMember';
}

async function ensureStripeProduct(stripe, eventRef, event) {
  if (event.stripeProductId) return event.stripeProductId;
  const product = await stripe.products.create({
    name: event.title,
    description: event.description?.slice(0, 500) || undefined,
    metadata: { eventId: eventRef.id, slug: event.slug || '' },
  });
  await eventRef.update({
    stripeProductId: product.id,
    updatedAt: Timestamp.now(),
  });
  return product.id;
}

exports.createCheckoutSession = functions
  .runWith({ secrets: ['STRIPE_SECRET_KEY'] })
  .https.onCall(async (data, context) => {
    requireAppCheck(context);
    const serverConfig = loadCallableServerConfig({
      requireStripeKey: true,
      requireCommerceCeiling: true,
    });
    const {
      eventId,
      runner,
      customFields,
      priceTier: requestedTier,
      signupType,
    } = parseRequest(data);
    const db = admin.firestore();
    const eventRef = db.collection('events').doc(eventId);
    const { targetSnapshot: eventSnap } = await requireCommerceAdmission({
      db,
      operation: COMMERCE_OPERATIONS.RACE_REGISTRATION,
      deploymentEnabled: serverConfig.commerceEnabled,
      targetRef: eventRef,
    });
    const event = eventSnap.data();
    const normalizedCustomFields = parseAnswers({
      signupType,
      customFields,
      eventCustomFields: event.customFields === undefined ? [] : event.customFields,
      volunteerCustomFields: event.volunteerFields === undefined
        ? []
        : event.volunteerFields,
    });

    const normalizedEmail = runner.email;
    await Promise.all([
      checkRateLimit({
        scope: 'checkout_ip',
        key: extractIp(context),
        limit: CHECKOUT_PER_IP_PER_HOUR,
        windowMs: HOUR_MS,
      }),
      checkRateLimit({
        scope: 'checkout_email',
        key: normalizedEmail,
        limit: CHECKOUT_PER_EMAIL_PER_HOUR,
        windowMs: HOUR_MS,
      }),
    ]);

    const now = Date.now();
    if (!isRegistrationOpen(event, now)) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Registration is not currently open for this event',
      );
    }

    const audience = projectEventCheckoutAudience(event);
    if (audience === undefined) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Registration is unavailable for this event',
      );
    }
    if (audience === 'members_only') {
      const role = await resolveCallerRole(context);
      if (role !== 'member' && role !== 'admin') {
        throw new functions.https.HttpsError(
          'permission-denied',
          'This event is open to club members only',
        );
      }
    }

    // Volunteers take the comp path: no charge, no Stripe, written as paid.
    let priceTier;
    let amountCents;
    if (signupType === 'volunteer') {
      if (event.volunteerEnabled !== true) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Volunteer signup is not enabled for this event',
        );
      }
      priceTier = 'comp';
      amountCents = 0;
    } else {
      // Capacity applies to participants only; volunteers don't count.
      const capacityLimit = projectParticipantCapacityLimit(event);
      if (capacityLimit === undefined) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Registration is unavailable for this event',
        );
      }
      if (capacityLimit !== null) {
        const active = await countActiveRegistrations(eventId);
        if (active >= capacityLimit) {
          throw new functions.https.HttpsError(
            'resource-exhausted',
            'This event is full',
          );
        }
      }
      const callerRole = await resolveCallerRole(context);
      priceTier = resolvePriceTier({
        requestedTier, event, callerRole, now,
      });
      amountCents = pickPriceCents(event, priceTier);
    }
    if (typeof amountCents !== 'number' || amountCents < 0) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Selected price tier is not available for this event',
      );
    }

    const confirmationToken = generateToken();
    const regRef = eventRef.collection('registrations').doc();
    const regBase = {
      eventId,
      runner: {
        firstName: runner.firstName,
        lastName: runner.lastName,
        email: runner.email,
        phone: runner.phone || null,
        dob: runner.dob || null,
        emergencyContactName: runner.emergencyContactName || null,
        emergencyContactPhone: runner.emergencyContactPhone || null,
        shirtSize: runner.shirtSize || null,
        extras: normalizedCustomFields,
      },
      uid: context.auth?.uid || null,
      priceTier,
      signupType,
      amountCents,
      currency: 'usd',
      promoCode: null,
      status: 'pending',
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
      paidAt: null,
      refundedAt: null,
      cancelledAt: null,
      auditLog: [auditEntry({
        actorUid: context.auth?.uid,
        actorEmail: normalizedEmail,
        action: 'registration.created',
        note: `type=${signupType} tier=${priceTier} amount=${amountCents}`,
      })],
    };

    if (amountCents === 0) {
      await regRef.set({ ...regBase, status: 'paid', paidAt: Timestamp.now() });
      return {
        free: true,
        registrationId: regRef.id,
        confirmationToken,
      };
    }

    const origin = serverConfig.siteOrigin;
    const eventSlug = event.slug || eventId;
    const successQuery = [
      'session_id={CHECKOUT_SESSION_ID}',
      `reg=${encodeURIComponent(regRef.id)}`,
      `token=${encodeURIComponent(confirmationToken)}`,
      `event=${encodeURIComponent(eventId)}`,
    ].join('&');
    const cancelUrl = `${origin}${CANCEL_PATH_PREFIX}${encodeURIComponent(eventSlug)}?cancelled=1`;
    const stripe = getStripe();
    const productId = await ensureStripeProduct(stripe, eventRef, event);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: normalizedEmail,
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: amountCents,
          product: productId,
        },
        quantity: 1,
      }],
      // Discounts remain disabled until a server-approved discount snapshot
      // and reconciliation contract is implemented (PROMO-001).
      allow_promotion_codes: false,
      automatic_tax: { enabled: false },
      success_url: `${origin}${SUCCESS_PATH}?${successQuery}`,
      cancel_url: cancelUrl,
      metadata: {
        schemaVersion: '1',
        eventId,
        registrationId: regRef.id,
        priceTier,
      },
      payment_intent_data: {
        metadata: {
          schemaVersion: '1',
          eventId,
          registrationId: regRef.id,
          priceTier,
        },
      },
    });

    await regRef.set({
      ...regBase,
      stripeSessionId: session.id,
    });

    return {
      sessionId: session.id,
      url: session.url,
      registrationId: regRef.id,
    };
  });
