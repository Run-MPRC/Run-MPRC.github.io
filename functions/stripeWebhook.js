const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Stripe = require('stripe');

const {
  getWebhookSecret,
  auditEntry,
  Timestamp,
} = require('./stripeHelpers');

const LEDGER_RETENTION_DAYS = 90;
const CHECKOUT_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
]);
const DISPUTE_EVENT_TYPES = new Set([
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
]);
const DISPUTE_TERMINAL_STATUSES = new Set(['won', 'lost', 'closed', 'warning_closed']);
const COMPLETION_TERMINAL_STATUSES = new Set([
  'cancelled',
  'comp',
  'fulfilled',
  'partially_refunded',
  'refunded',
  'transferred',
]);
const REFUND_STATUS_PRESERVING_STATES = new Set([
  'cancelled',
  'fulfilled',
  'transferred',
]);

function isSupportedEventType(type) {
  return CHECKOUT_EVENT_TYPES.has(type)
    || type === 'charge.refunded'
    || DISPUTE_EVENT_TYPES.has(type);
}

function validateExpectedLivemode(event) {
  const configured = process.env.STRIPE_LIVEMODE_EXPECTED;
  if (configured === undefined || configured === '') {
    throw new Error('STRIPE_LIVEMODE_EXPECTED must be explicitly configured');
  }
  if (configured !== 'true' && configured !== 'false') {
    throw new Error('STRIPE_LIVEMODE_EXPECTED must be true or false');
  }
  const expected = configured === 'true';
  if (event.livemode !== expected) {
    return { ok: false, expected, reason: 'livemode_mismatch' };
  }
  return { ok: true, expected };
}

function isValidDocId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 1500
    && !value.includes('/');
}

function clientReferenceClaim(clientReferenceId) {
  if (typeof clientReferenceId !== 'string'
    || !clientReferenceId.startsWith('mprc:')) {
    return null;
  }
  const parts = clientReferenceId.split(':');
  if (parts.length === 3 && parts[1] === 'order' && isValidDocId(parts[2])) {
    return {
      status: 'claimed',
      kind: 'order',
      source: 'client_reference_id',
      metadata: { type: 'merch', orderId: parts[2] },
    };
  }
  if (parts.length === 4 && parts[1] === 'registration'
    && isValidDocId(parts[2]) && isValidDocId(parts[3])) {
    return {
      status: 'claimed',
      kind: 'registration',
      source: 'client_reference_id',
      metadata: { eventId: parts[2], registrationId: parts[3] },
    };
  }
  return {
    status: 'malformed',
    source: 'client_reference_id',
    reason: 'invalid_client_reference_id',
  };
}

function classifyMprcReference(object) {
  const metadata = object?.metadata || {};
  const hasOrderKey = Object.prototype.hasOwnProperty.call(metadata, 'orderId');
  const hasEventKey = Object.prototype.hasOwnProperty.call(metadata, 'eventId');
  const hasRegistrationKey = Object.prototype.hasOwnProperty.call(
    metadata,
    'registrationId',
  );
  const claimsMerch = metadata.type === 'merch';
  const claimsRegistration = hasEventKey || hasRegistrationKey || metadata.late_add === 'true';
  const explicitlyMprc = metadata.integration === 'mprc';
  const claimsOrder = hasOrderKey || claimsMerch;

  if (claimsOrder && claimsRegistration) {
    return { status: 'malformed', source: 'metadata', reason: 'conflicting_reference' };
  }
  if (claimsOrder) {
    if (isValidDocId(metadata.orderId)) {
      return {
        status: 'claimed',
        kind: 'order',
        source: 'metadata',
        metadata,
      };
    }
    return { status: 'malformed', source: 'metadata', reason: 'invalid_order_reference' };
  }
  if (claimsRegistration || explicitlyMprc) {
    if (isValidDocId(metadata.eventId) && isValidDocId(metadata.registrationId)) {
      return {
        status: 'claimed',
        kind: 'registration',
        source: 'metadata',
        metadata,
      };
    }
    return {
      status: 'malformed',
      source: 'metadata',
      reason: 'invalid_registration_reference',
    };
  }

  return clientReferenceClaim(object?.client_reference_id) || {
    status: 'unrelated',
    source: null,
  };
}

function objectId(value) {
  if (typeof value === 'string') return value;
  return value?.id || null;
}

function firstDoc(snap) {
  return snap.empty ? null : snap.docs[0];
}

async function findRegistrationBySessionId(sessionId) {
  const snap = await admin.firestore()
    .collectionGroup('registrations')
    .where('stripeSessionId', '==', sessionId)
    .limit(1)
    .get();
  return firstDoc(snap);
}

async function findRegistrationByPaymentIntent(paymentIntentId) {
  const snap = await admin.firestore()
    .collectionGroup('registrations')
    .where('stripePaymentIntentId', '==', paymentIntentId)
    .limit(1)
    .get();
  return firstDoc(snap);
}

async function findRegistrationByChargeId(chargeId) {
  const snap = await admin.firestore()
    .collectionGroup('registrations')
    .where('stripeChargeId', '==', chargeId)
    .limit(1)
    .get();
  return firstDoc(snap);
}

async function findOrderBySessionId(sessionId) {
  const snap = await admin.firestore()
    .collection('orders')
    .where('stripeSessionId', '==', sessionId)
    .limit(1)
    .get();
  return firstDoc(snap);
}

async function findOrderByPaymentIntent(paymentIntentId) {
  const snap = await admin.firestore()
    .collection('orders')
    .where('stripePaymentIntentId', '==', paymentIntentId)
    .limit(1)
    .get();
  return firstDoc(snap);
}

async function findOrderByChargeId(chargeId) {
  const snap = await admin.firestore()
    .collection('orders')
    .where('stripeChargeId', '==', chargeId)
    .limit(1)
    .get();
  return firstDoc(snap);
}

function targetFromSnapshot(kind, snap, source) {
  if (!snap?.exists) return null;
  return { kind, ref: snap.ref, source };
}

async function directOrderTarget(metadata) {
  if (!isValidDocId(metadata?.orderId)) return null;
  const snap = await admin.firestore().collection('orders').doc(metadata.orderId).get();
  return targetFromSnapshot('order', snap, 'metadata');
}

async function directRegistrationTarget(metadata) {
  if (!isValidDocId(metadata?.eventId) || !isValidDocId(metadata?.registrationId)) {
    return null;
  }
  const snap = await admin.firestore()
    .collection('events').doc(metadata.eventId)
    .collection('registrations').doc(metadata.registrationId)
    .get();
  return targetFromSnapshot('registration', snap, 'metadata');
}

async function resolveSessionTarget(session) {
  const reference = classifyMprcReference(session);
  const metadata = reference.status === 'claimed'
    ? reference.metadata
    : (session?.metadata || {});
  const merchLike = reference.kind === 'order'
    || metadata.type === 'merch'
    || !!metadata.orderId;

  if (merchLike) {
    const direct = await directOrderTarget(metadata);
    if (direct) return direct;
    const legacy = await findOrderBySessionId(session.id);
    if (legacy) return targetFromSnapshot('order', legacy, 'session_query');
  } else {
    const direct = await directRegistrationTarget(metadata);
    if (direct) return direct;
    const legacy = await findRegistrationBySessionId(session.id);
    if (legacy) return targetFromSnapshot('registration', legacy, 'session_query');
  }

  // Older records and malformed legacy metadata might not identify their type.
  const order = await findOrderBySessionId(session.id);
  if (order) return targetFromSnapshot('order', order, 'session_query');
  const registration = await findRegistrationBySessionId(session.id);
  return targetFromSnapshot('registration', registration, 'session_query');
}

async function resolvePaymentTarget(paymentIntentId, metadata = {}, chargeId = null) {
  const merchLike = metadata.type === 'merch' || !!metadata.orderId;

  if (merchLike) {
    const direct = await directOrderTarget(metadata);
    if (direct) return direct;
  } else {
    const direct = await directRegistrationTarget(metadata);
    if (direct) return direct;
  }

  if (paymentIntentId) {
    const preferred = merchLike
      ? await findOrderByPaymentIntent(paymentIntentId)
      : await findRegistrationByPaymentIntent(paymentIntentId);
    if (preferred) {
      return targetFromSnapshot(
        merchLike ? 'order' : 'registration',
        preferred,
        'payment_intent_query',
      );
    }
    const fallback = merchLike
      ? await findRegistrationByPaymentIntent(paymentIntentId)
      : await findOrderByPaymentIntent(paymentIntentId);
    if (fallback) {
      return targetFromSnapshot(
        merchLike ? 'registration' : 'order',
        fallback,
        'payment_intent_query',
      );
    }
  }

  if (chargeId) {
    const order = await findOrderByChargeId(chargeId);
    if (order) return targetFromSnapshot('order', order, 'charge_query');
    const registration = await findRegistrationByChargeId(chargeId);
    if (registration) return targetFromSnapshot('registration', registration, 'charge_query');
  }
  return null;
}

async function resolveTarget(event) {
  const object = event?.data?.object || {};
  // Never let fallback queries rescue an object that explicitly claims two
  // incompatible MPRC targets. A malformed signed object is quarantined, not
  // interpreted according to whichever identifier happens to resolve first.
  if (classifyMprcReference(object).status === 'malformed') return null;
  if (CHECKOUT_EVENT_TYPES.has(event.type)) {
    return resolveSessionTarget(object);
  }
  if (event.type === 'charge.refunded') {
    return resolvePaymentTarget(
      objectId(object.payment_intent),
      object.metadata,
      objectId(object),
    );
  }
  if (DISPUTE_EVENT_TYPES.has(event.type)) {
    return resolvePaymentTarget(
      objectId(object.payment_intent),
      object.metadata,
      objectId(object.charge),
    );
  }
  return null;
}

function nonNegativeInteger(value, fallback = 0) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function validateSessionMoney(session, record) {
  const expectedSubtotal = record.amountCents;
  const expectedCurrency = String(record.currency || 'usd').toLowerCase();
  const actualCurrency = typeof session.currency === 'string'
    ? session.currency.toLowerCase()
    : null;
  const details = session.total_details || {};
  const discountCents = nonNegativeInteger(details.amount_discount);
  const taxCents = nonNegativeInteger(details.amount_tax);
  const shippingCents = nonNegativeInteger(
    details.amount_shipping,
    nonNegativeInteger(session.shipping_cost?.amount_total),
  );
  const totalCents = session.amount_total;
  let subtotalCents = session.amount_subtotal;

  if (!Number.isSafeInteger(expectedSubtotal) || expectedSubtotal < 0) {
    return { ok: false, reason: 'invalid_expected_amount' };
  }
  if (!actualCurrency || actualCurrency !== expectedCurrency) {
    return { ok: false, reason: 'currency_mismatch' };
  }
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    return { ok: false, reason: 'invalid_stripe_total' };
  }
  if (!Number.isSafeInteger(subtotalCents)) {
    const hasAdjustments = discountCents || taxCents || shippingCents;
    subtotalCents = hasAdjustments ? null : totalCents;
  }
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) {
    return { ok: false, reason: 'invalid_stripe_subtotal' };
  }
  if (subtotalCents !== expectedSubtotal) {
    return { ok: false, reason: 'amount_mismatch' };
  }
  // Checkout creation currently disables all promotion codes. Until PAY-001
  // adds a server-approved discount snapshot, any Stripe discount is an
  // unexplained reduction and must not fulfill the local record.
  if (discountCents !== 0) {
    return { ok: false, reason: 'discount_not_allowed' };
  }
  if (taxCents !== 0) {
    return { ok: false, reason: 'tax_not_configured' };
  }
  if (shippingCents !== 0) {
    return { ok: false, reason: 'shipping_charge_not_configured' };
  }
  if (subtotalCents - discountCents + taxCents + shippingCents !== totalCents) {
    return { ok: false, reason: 'stripe_total_breakdown_mismatch' };
  }

  return {
    ok: true,
    summary: {
      stripeAmountSubtotalCents: subtotalCents,
      stripeAmountTotalCents: totalCents,
      stripeDiscountCents: discountCents,
      stripeTaxCents: taxCents,
      stripeShippingCents: shippingCents,
      stripeCurrency: actualCurrency,
      stripePaymentStatus: session.payment_status || null,
    },
  };
}

function validateSessionBinding(session, record) {
  if (session.object !== 'checkout.session' || session.mode !== 'payment') {
    return { ok: false, reason: 'invalid_checkout_mode' };
  }
  const storedSessionId = record.stripeSessionId || null;
  const storedPaymentLinkId = record.stripePaymentLinkId || null;
  const sessionPaymentLinkId = objectId(session.payment_link);
  const storedPaymentIntentId = record.stripePaymentIntentId || null;
  const sessionPaymentIntentId = objectId(session.payment_intent);

  if (storedSessionId && storedSessionId !== session.id) {
    return { ok: false, reason: 'session_mismatch' };
  }
  if (storedPaymentLinkId && sessionPaymentLinkId
    && storedPaymentLinkId !== sessionPaymentLinkId) {
    return { ok: false, reason: 'payment_link_mismatch' };
  }
  if (!storedSessionId && storedPaymentLinkId
    && storedPaymentLinkId !== sessionPaymentLinkId) {
    return { ok: false, reason: 'payment_link_mismatch' };
  }
  if (storedPaymentIntentId && storedPaymentIntentId !== sessionPaymentIntentId) {
    return { ok: false, reason: 'payment_intent_mismatch' };
  }
  return { ok: true };
}

function shippingFromSession(session) {
  const details = session.shipping_details || session.collected_information?.shipping_details;
  if (!details?.address) return null;
  return {
    line1: details.address.line1 || '',
    line2: details.address.line2 || null,
    city: details.address.city || '',
    state: details.address.state || '',
    postalCode: details.address.postal_code || '',
    country: details.address.country || '',
    recipientName: details.name || null,
  };
}

function auditPatch({ target, action, note }) {
  const prefix = target.kind === 'order' ? 'order.' : '';
  return admin.firestore.FieldValue.arrayUnion(
    auditEntry({ action: `${prefix}${action}`, note }),
  );
}

function reviewTransition({ target, event, reason }) {
  return {
    outcome: `needs_review:${reason}`,
    requiresReview: true,
    patch: {
      paymentReviewRequired: true,
      paymentReviewReason: reason,
      lastStripeEventId: event.id,
      updatedAt: Timestamp.now(),
      auditLog: auditPatch({
        target,
        action: 'payment.review_required',
        note: `event=${event.id} reason=${reason}`,
      }),
    },
  };
}

function successfulPaymentTransition({ event, session, target, record }) {
  const binding = validateSessionBinding(session, record);
  if (!binding.ok) return reviewTransition({ target, event, reason: binding.reason });

  const money = validateSessionMoney(session, record);
  if (!money.ok) return reviewTransition({ target, event, reason: money.reason });

  const paymentIntentId = objectId(session.payment_intent);
  const isPaid = session.payment_status === 'paid'
    || (session.payment_status === 'no_payment_required'
      && money.summary.stripeAmountTotalCents === 0);
  const status = record.status;

  if (money.summary.stripeAmountTotalCents > 0 && !paymentIntentId) {
    return reviewTransition({ target, event, reason: 'missing_payment_intent' });
  }

  if (!isPaid) {
    if (event.type === 'checkout.session.async_payment_succeeded') {
      return reviewTransition({ target, event, reason: 'async_success_not_paid' });
    }
    if (status === 'fulfilled') {
      return reviewTransition({ target, event, reason: 'fulfilled_without_verified_payment' });
    }
    if (COMPLETION_TERMINAL_STATUSES.has(status) || status === 'paid') {
      return { outcome: `unpaid_ignored:${status}`, patch: null };
    }
    return {
      outcome: 'awaiting_payment',
      patch: {
        ...money.summary,
        paymentStatus: 'processing',
        stripeSessionId: record.stripeSessionId || session.id,
        stripePaymentIntentId: paymentIntentId || record.stripePaymentIntentId || null,
        lastStripeEventId: event.id,
        updatedAt: Timestamp.now(),
        auditLog: auditPatch({
          target,
          action: 'payment.processing',
          note: `event=${event.id}`,
        }),
      },
    };
  }

  if (status === 'paid') return { outcome: 'already_paid', patch: null };
  if (status === 'partially_refunded' || status === 'refunded') {
    return {
      outcome: `payment_observed_after_${status}`,
      patch: {
        ...money.summary,
        // Refund state is monotonic; a late completion event supplies missing
        // payment evidence but must not downgrade it back to paid.
        paymentStatus: record.paymentStatus || status,
        stripeSessionId: record.stripeSessionId || session.id,
        stripePaymentIntentId: paymentIntentId || record.stripePaymentIntentId || null,
        paidAt: record.paidAt || Timestamp.now(),
        lastStripeEventId: event.id,
        updatedAt: Timestamp.now(),
        auditLog: auditPatch({
          target,
          action: 'payment.observed_after_refund',
          note: `event=${event.id} state=${status}`,
        }),
      },
    };
  }
  if (status === 'fulfilled' || status === 'transferred') {
    const requiresReview = status === 'fulfilled';
    return {
      outcome: requiresReview
        ? 'needs_review:fulfilled_before_payment_confirmation'
        : 'payment_observed_after_transferred',
      requiresReview,
      patch: {
        ...money.summary,
        paymentStatus: 'paid',
        stripeSessionId: record.stripeSessionId || session.id,
        stripePaymentIntentId: paymentIntentId || record.stripePaymentIntentId || null,
        paidAt: record.paidAt || Timestamp.now(),
        paymentReviewRequired: requiresReview,
        paymentReviewReason: requiresReview ? 'fulfilled_before_payment_confirmation' : null,
        lastStripeEventId: event.id,
        updatedAt: Timestamp.now(),
        auditLog: auditPatch({
          target,
          action: requiresReview
            ? 'payment.confirmed_after_fulfillment'
            : 'payment.observed_after_transfer',
          note: `event=${event.id}`,
        }),
      },
    };
  }
  if (status === 'comp') {
    return reviewTransition({ target, event, reason: 'unexpected_payment_for_comp' });
  }
  if (COMPLETION_TERMINAL_STATUSES.has(status)) {
    if (status !== 'cancelled') {
      return { outcome: `terminal_state_protected:${status}`, patch: null };
    }
    return {
      outcome: 'needs_review:paid_after_cancellation',
      requiresReview: true,
      patch: {
        ...money.summary,
        paymentStatus: 'paid_after_cancellation',
        stripeSessionId: record.stripeSessionId || session.id,
        stripePaymentIntentId: paymentIntentId || record.stripePaymentIntentId || null,
        paymentReviewRequired: true,
        paymentReviewReason: 'paid_after_cancellation',
        paymentExceptionAt: Timestamp.now(),
        lastStripeEventId: event.id,
        updatedAt: Timestamp.now(),
        auditLog: auditPatch({
          target,
          action: 'payment.received_after_cancellation',
          note: `event=${event.id} pi=${paymentIntentId || ''}`,
        }),
      },
    };
  }

  const patch = {
    ...money.summary,
    status: 'paid',
    paymentStatus: 'paid',
    stripeSessionId: record.stripeSessionId || session.id,
    stripePaymentIntentId: paymentIntentId || record.stripePaymentIntentId || null,
    paymentReviewRequired: false,
    paymentReviewReason: null,
    paidAt: record.paidAt || Timestamp.now(),
    lastStripeEventId: event.id,
    updatedAt: Timestamp.now(),
    auditLog: auditPatch({
      target,
      action: 'payment.completed',
      note: `event=${event.id} pi=${paymentIntentId || ''}`,
    }),
  };
  if (target.kind === 'order') {
    const shipping = shippingFromSession(session);
    if (shipping) patch.shipping = shipping;
  }
  return { outcome: 'payment_confirmed', patch };
}

function unsuccessfulSessionTransition({ event, session, target, record, reason }) {
  const binding = validateSessionBinding(session, record);
  if (!binding.ok) return reviewTransition({ target, event, reason: binding.reason });
  if (record.status !== 'pending') {
    return { outcome: `${reason}_ignored:${record.status}`, patch: null };
  }
  const paymentIntentId = objectId(session.payment_intent);
  return {
    outcome: `payment_${reason}`,
    patch: {
      status: 'cancelled',
      paymentStatus: reason,
      stripePaymentStatus: session.payment_status || null,
      stripeSessionId: record.stripeSessionId || session.id,
      stripePaymentIntentId: paymentIntentId || record.stripePaymentIntentId || null,
      cancelledAt: record.cancelledAt || Timestamp.now(),
      lastStripeEventId: event.id,
      updatedAt: Timestamp.now(),
      auditLog: auditPatch({
        target,
        action: reason === 'expired' ? 'session.expired' : 'payment.async_failed',
        note: `event=${event.id}`,
      }),
    },
  };
}

function refundIdsFromCharge(charge) {
  const ids = (charge.refunds?.data || []).map((refund) => objectId(refund)).filter(Boolean);
  return ids.length
    ? admin.firestore.FieldValue.arrayUnion(...ids)
    : null;
}

function disputeStatusRank(status) {
  if (DISPUTE_TERMINAL_STATUSES.has(status)) return 30;
  if (status === 'under_review' || status === 'warning_under_review') return 20;
  if (status === 'needs_response' || status === 'warning_needs_response') return 10;
  return 0;
}

function refundTransition({ event, charge, target, record }) {
  const paymentIntentId = objectId(charge.payment_intent);
  const chargeId = objectId(charge);
  if (charge.object !== 'charge' || !chargeId || !paymentIntentId) {
    return reviewTransition({ target, event, reason: 'invalid_refund_binding' });
  }
  if (record.stripePaymentIntentId && paymentIntentId
    && record.stripePaymentIntentId !== paymentIntentId) {
    return reviewTransition({ target, event, reason: 'payment_intent_mismatch' });
  }
  if (record.stripeChargeId && record.stripeChargeId !== chargeId) {
    return reviewTransition({ target, event, reason: 'charge_mismatch' });
  }
  const expectedCurrency = String(record.currency || 'usd').toLowerCase();
  const chargeCurrency = typeof charge.currency === 'string'
    ? charge.currency.toLowerCase()
    : null;
  if (chargeCurrency !== expectedCurrency) {
    return reviewTransition({ target, event, reason: 'refund_currency_mismatch' });
  }
  const amountRefunded = charge.amount_refunded;
  const knownTotal = record.stripeAmountTotalCents ?? record.amountCents;
  const totalAmount = charge.amount;
  if (!Number.isSafeInteger(knownTotal) || knownTotal <= 0
    || totalAmount !== knownTotal) {
    return reviewTransition({ target, event, reason: 'refund_total_mismatch' });
  }
  if (!Number.isSafeInteger(amountRefunded) || amountRefunded <= 0
    || !Number.isSafeInteger(totalAmount) || totalAmount <= 0
    || amountRefunded > totalAmount) {
    return reviewTransition({ target, event, reason: 'invalid_refund_amount' });
  }

  const previouslyRefunded = nonNegativeInteger(record.stripeAmountRefundedCents);
  if (amountRefunded < previouslyRefunded) {
    const staleRefundIds = refundIdsFromCharge(charge);
    return {
      outcome: 'stale_refund_ignored',
      patch: staleRefundIds ? {
        stripeRefundIds: staleRefundIds,
        lastStripeEventId: event.id,
        updatedAt: Timestamp.now(),
        auditLog: auditPatch({
          target,
          action: 'refund.stale_ignored',
          note: `event=${event.id} refunded=${amountRefunded} current=${previouslyRefunded}`,
        }),
      } : null,
    };
  }

  const fullyRefunded = amountRefunded === totalAmount;
  const paymentStatus = fullyRefunded ? 'refunded' : 'partially_refunded';
  if (record.stripeChargeId === chargeId
    && record.stripeAmountRefundedCents === amountRefunded
    && record.paymentStatus === paymentStatus) {
    return { outcome: `already_${paymentStatus}`, patch: null };
  }
  const patch = {
    paymentStatus,
    stripePaymentIntentId: record.stripePaymentIntentId || paymentIntentId,
    stripeChargeId: record.stripeChargeId || chargeId,
    stripeAmountTotalCents: totalAmount,
    stripeAmountRefundedCents: amountRefunded,
    paidAt: record.paidAt || (
      Number.isSafeInteger(charge.created)
        ? Timestamp.fromMillis(charge.created * 1000)
        : Timestamp.now()
    ),
    refundedAt: Timestamp.now(),
    lastStripeEventId: event.id,
    updatedAt: Timestamp.now(),
    auditLog: auditPatch({
      target,
      action: fullyRefunded ? 'refund.full' : 'refund.partial',
      note: `event=${event.id} refunded=${amountRefunded} of ${totalAmount}`,
    }),
  };
  if (!REFUND_STATUS_PRESERVING_STATES.has(record.status)) {
    patch.status = paymentStatus;
  }
  const refundIds = refundIdsFromCharge(charge);
  if (refundIds) patch.stripeRefundIds = refundIds;
  return { outcome: paymentStatus, patch };
}

function disputeTransition({ event, dispute, target, record }) {
  const paymentIntentId = objectId(dispute.payment_intent);
  if (record.stripePaymentIntentId && paymentIntentId
    && record.stripePaymentIntentId !== paymentIntentId) {
    return reviewTransition({ target, event, reason: 'payment_intent_mismatch' });
  }
  const disputeStatus = dispute.status
    || (event.type === 'charge.dispute.closed' ? 'closed' : 'needs_response');
  const disputeId = objectId(dispute);
  if (!disputeId) {
    return reviewTransition({ target, event, reason: 'missing_dispute_id' });
  }
  const existingDisputes = record.stripeDisputes || {};
  const existingDispute = existingDisputes[disputeId] || null;
  const eventCreated = Number.isSafeInteger(event.created) ? event.created : 0;
  const existingEventCreated = nonNegativeInteger(existingDispute?.lastEventCreated);
  const incomingStatusRank = disputeStatusRank(disputeStatus);
  const existingStatusRank = existingDispute
    ? nonNegativeInteger(
      existingDispute.statusRank,
      disputeStatusRank(existingDispute.status),
    )
    : 0;
  const isDeterministicallyOlder = existingDispute && (
    eventCreated < existingEventCreated
    || (eventCreated === existingEventCreated && incomingStatusRank < existingStatusRank)
    || (eventCreated === existingEventCreated
      && incomingStatusRank === existingStatusRank
      && event.id.localeCompare(existingDispute.lastEventId || '') < 0)
  );
  if (isDeterministicallyOlder) {
    return { outcome: 'stale_dispute_ignored', patch: null };
  }
  if (existingDispute
    && DISPUTE_TERMINAL_STATUSES.has(existingDispute.status)
    && disputeStatus !== existingDispute.status) {
    return reviewTransition({ target, event, reason: 'terminal_dispute_regression' });
  }
  if (existingDispute
    && existingDispute.status === disputeStatus
    && eventCreated === existingEventCreated) {
    return { outcome: `already_dispute_${disputeStatus}`, patch: null };
  }
  const disputeState = {
    status: disputeStatus,
    statusRank: incomingStatusRank,
    amountCents: nonNegativeInteger(dispute.amount),
    reason: dispute.reason || null,
    chargeId: objectId(dispute.charge),
    paymentIntentId,
    lastEventId: event.id,
    lastEventCreated: eventCreated,
    updatedAt: Timestamp.now(),
  };
  const shouldUpdateAggregate = eventCreated >= nonNegativeInteger(
    record.lastDisputeEventCreated,
  );
  const patch = {
    stripeDisputeIds: admin.firestore.FieldValue.arrayUnion(disputeId),
    stripeDisputes: { ...existingDisputes, [disputeId]: disputeState },
    stripePaymentIntentId: record.stripePaymentIntentId || paymentIntentId,
    disputedAt: record.disputedAt || Timestamp.now(),
    lastStripeEventId: event.id,
    updatedAt: Timestamp.now(),
    auditLog: auditPatch({
      target,
      action: event.type.replace('charge.', ''),
      note: `event=${event.id} status=${disputeStatus} amount=${dispute.amount || 0}`,
    }),
  };
  if (shouldUpdateAggregate) {
    patch.disputeStatus = disputeStatus;
    patch.stripeDisputeId = disputeId;
    patch.disputedAmountCents = disputeState.amountCents;
    patch.disputeReason = disputeState.reason;
    patch.lastDisputeEventCreated = eventCreated;
  }
  if (event.type === 'charge.dispute.closed') patch.disputeClosedAt = Timestamp.now();
  return {
    outcome: `dispute_${disputeStatus}`,
    requiresReview: !DISPUTE_TERMINAL_STATUSES.has(disputeStatus)
      || disputeStatus === 'lost',
    patch,
  };
}

function transitionForEvent(event, target, targetSnap, modeValidation, ownership) {
  if (!modeValidation.ok) {
    return {
      outcome: `needs_review:${modeValidation.reason}`,
      requiresReview: true,
      patch: null,
    };
  }
  if (!target || !targetSnap?.exists) {
    if (DISPUTE_EVENT_TYPES.has(event.type)) {
      return {
        outcome: 'needs_review:unmatched_dispute',
        requiresReview: true,
        patch: null,
      };
    }
    if (isSupportedEventType(event.type) && ownership.status === 'malformed') {
      return {
        outcome: `needs_review:${ownership.reason}`,
        requiresReview: true,
        patch: null,
      };
    }
    return {
      outcome: isSupportedEventType(event.type)
        ? 'ignored:unmatched_integration_event'
        : 'ignored:unsupported_event',
      requiresReview: false,
      patch: null,
    };
  }

  const object = event.data.object;
  const record = targetSnap.data();
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return successfulPaymentTransition({ event, session: object, target, record });
    case 'checkout.session.async_payment_failed':
      return unsuccessfulSessionTransition({
        event, session: object, target, record, reason: 'failed',
      });
    case 'checkout.session.expired':
      return unsuccessfulSessionTransition({
        event, session: object, target, record, reason: 'expired',
      });
    case 'charge.refunded':
      return refundTransition({ event, charge: object, target, record });
    case 'charge.dispute.created':
    case 'charge.dispute.updated':
    case 'charge.dispute.closed':
      return disputeTransition({ event, dispute: object, target, record });
    default:
      return { outcome: 'ignored:unsupported_event', patch: null };
  }
}

function ledgerData(event, target, result, ownership) {
  const now = Date.now();
  return {
    eventId: event.id,
    type: event.type,
    objectId: objectId(event.data?.object) || null,
    livemode: event.livemode === true,
    stripeCreatedAt: Number.isSafeInteger(event.created)
      ? Timestamp.fromMillis(event.created * 1000)
      : null,
    status: 'processed',
    outcome: result.outcome,
    requiresReview: result.requiresReview === true,
    targetType: target?.kind || null,
    targetPath: target?.ref?.path || null,
    targetSource: target?.source || null,
    ownership: target ? 'local_match' : ownership.status,
    ownershipSource: target?.source || ownership.source || null,
    ownershipReason: ownership.reason || null,
    processedAt: Timestamp.fromMillis(now),
    expiresAt: Timestamp.fromMillis(
      now + LEDGER_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ),
  };
}

async function processEvent(event) {
  const db = admin.firestore();
  const eventRef = db.collection('stripeEvents').doc(event.id);
  const existing = await eventRef.get();
  if (existing.exists && existing.data()?.status === 'processed') {
    return { duplicate: true, outcome: existing.data().outcome };
  }

  const modeValidation = validateExpectedLivemode(event);
  const ownership = classifyMprcReference(event.data.object);
  const target = modeValidation.ok ? await resolveTarget(event) : null;
  // Checkout creation and the Firestore write are not atomic. A supported
  // event carrying a valid MPRC reference can therefore beat its business
  // record into Firestore. Do not write a final ledger marker in that case:
  // return 5xx and let Stripe redeliver. Unrelated Stripe traffic is handled
  // below without retrying forever.
  if (modeValidation.ok && isSupportedEventType(event.type)
    && ownership.status === 'claimed' && !target) {
    throw new Error(`Retryable Stripe target not found for ${event.id}`);
  }
  let transactionResult = null;
  await db.runTransaction(async (tx) => {
    const eventSnap = await tx.get(eventRef);
    if (eventSnap.exists && eventSnap.data()?.status === 'processed') {
      transactionResult = {
        duplicate: true,
        outcome: eventSnap.data().outcome,
      };
      return;
    }
    const targetSnap = target ? await tx.get(target.ref) : null;
    if (modeValidation.ok && isSupportedEventType(event.type)
      && target && !targetSnap?.exists) {
      throw new Error(`Retryable Stripe target disappeared for ${event.id}`);
    }
    const result = transitionForEvent(
      event,
      target,
      targetSnap,
      modeValidation,
      ownership,
    );
    if (result.patch && targetSnap?.exists) tx.update(target.ref, result.patch);
    tx.set(eventRef, ledgerData(event, target, result, ownership));
    transactionResult = {
      duplicate: false,
      outcome: result.outcome,
      requiresReview: result.requiresReview === true,
    };
  });

  if (transactionResult?.requiresReview) {
    console.error('Stripe event requires review', {
      eventId: event.id,
      eventType: event.type,
      outcome: transactionResult.outcome,
      targetPath: target?.ref?.path || null,
    });
  }
  return transactionResult;
}

exports.stripeWebhook = functions
  .runWith({ secrets: ['STRIPE_WEBHOOK_SECRET'] })
  .https.onRequest(async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).send('Method not allowed');
      return;
    }

    let event;
    try {
      const signature = request.get('stripe-signature');
      event = Stripe.webhooks.constructEvent(
        request.rawBody,
        signature,
        getWebhookSecret(),
      );
      if (!event.id || !event.type || !event.data?.object) {
        throw new Error('Malformed Stripe event');
      }
    } catch (err) {
      console.error('Webhook signature verification failed', err.message);
      response.status(400).send('Webhook signature error');
      return;
    }

    try {
      const result = await processEvent(event);
      response.json({ received: true, ...result });
    } catch (err) {
      console.error('Webhook handler error', err);
      response.status(500).send('Webhook handler error');
    }
  });
