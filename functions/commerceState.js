const { types: { isProxy } } = require('node:util');

const stateSchemaVersion = 1;

function immutableEnum(values) {
  return Object.freeze(Object.fromEntries(values.map((value) => [
    value.toUpperCase(),
    value,
  ])));
}

const PaymentState = immutableEnum([
  'not_required',
  'checkout_creating',
  'checkout_open',
  'checkout_failed',
  'processing',
  'paid',
  'failed',
  'expired',
  'cancelled',
]);

const RegistrationState = immutableEnum([
  'reserved',
  'confirmed',
  'attended',
  'no_show',
  'transferred',
  'cancelled',
]);

const FulfillmentState = immutableEnum([
  'unfulfilled',
  'picking',
  'packed',
  'shipped',
  'ready_for_pickup',
  'delivered',
  'picked_up',
  'return_requested',
  'returned',
  'written_off',
  'cancelled',
  'fulfilled_legacy',
]);

const ConfirmedRefundState = immutableEnum([
  'none',
  'partially_refunded',
  'refunded',
]);

const DisputeState = immutableEnum([
  'none',
  'warning_needs_response',
  'warning_under_review',
  'warning_closed',
  'needs_response',
  'under_review',
  'won',
  'lost',
  'prevented',
]);

const PAYMENT_STATES = new Set(Object.values(PaymentState));
const REGISTRATION_STATES = new Set(Object.values(RegistrationState));
const FULFILLMENT_STATES = new Set(Object.values(FulfillmentState));
const CONFIRMED_REFUND_STATES = new Set(Object.values(ConfirmedRefundState));
const DISPUTE_STATES = new Set(Object.values(DisputeState));
const LEGACY_REGISTRATION_STATUSES = new Set([
  'pending',
  'paid',
  'comp',
  'cancelled',
  'transferred',
  'partially_refunded',
  'refunded',
]);
const LEGACY_ORDER_STATUSES = new Set([
  'pending',
  'paid',
  'fulfilled',
  'cancelled',
  'partially_refunded',
  'refunded',
]);

const PAYMENT_TRANSITIONS = Object.freeze({
  checkout_creating: Object.freeze(['checkout_open', 'checkout_failed']),
  checkout_open: Object.freeze(['processing', 'paid', 'failed', 'expired', 'cancelled']),
  processing: Object.freeze(['paid', 'failed']),
});

const REGISTRATION_TRANSITIONS = Object.freeze({
  reserved: Object.freeze(['confirmed', 'cancelled']),
  confirmed: Object.freeze(['attended', 'no_show', 'transferred', 'cancelled']),
});

const FULFILLMENT_TRANSITIONS = Object.freeze({
  unfulfilled: Object.freeze(['picking', 'cancelled']),
  picking: Object.freeze(['packed', 'cancelled']),
  packed: Object.freeze(['shipped', 'ready_for_pickup', 'cancelled']),
  shipped: Object.freeze(['delivered']),
  ready_for_pickup: Object.freeze(['picked_up']),
  delivered: Object.freeze(['return_requested']),
  picked_up: Object.freeze(['return_requested']),
  fulfilled_legacy: Object.freeze(['return_requested']),
  return_requested: Object.freeze(['returned']),
  returned: Object.freeze(['written_off']),
});

const REFUND_TRANSITIONS = Object.freeze({
  none: Object.freeze(['partially_refunded', 'refunded']),
  partially_refunded: Object.freeze(['refunded']),
});

const DISPUTE_TRANSITIONS = Object.freeze({
  none: Object.freeze(Object.values(DisputeState).filter((state) => state !== 'none')),
  needs_response: Object.freeze(['under_review', 'won', 'lost']),
  under_review: Object.freeze(['won', 'lost']),
  warning_needs_response: Object.freeze([
    'warning_under_review',
    'warning_closed',
    'needs_response',
  ]),
  warning_under_review: Object.freeze(['warning_closed', 'needs_response']),
  lost: Object.freeze(['won']),
});

const FIXED_REASONS = Object.freeze({
  APPLIED: 'transition_applied',
  SAME_STATE: 'same_state',
  FORBIDDEN: 'transition_forbidden',
  UNKNOWN_STATE: 'unknown_state',
  INVALID_KIND: 'invalid_kind',
  INVALID_RECORD: 'invalid_record',
  INVALID_CANONICAL_STATE: 'invalid_canonical_state',
  REFUND_WITHOUT_PAID: 'refund_without_paid',
  DISPUTE_WITHOUT_PAID: 'dispute_without_paid',
  REGISTRATION_WITHOUT_PAYMENT: 'registration_without_payment',
  FULFILLMENT_WITHOUT_PAYMENT: 'fulfillment_without_payment',
  PAID_DOMAIN_CANCELLED: 'paid_domain_cancelled',
  NONTERMINAL_PAYMENT_CANCELLED: 'nonterminal_payment_domain_cancelled',
  LEGACY_STATUS_UNKNOWN: 'legacy_status_unknown',
  LEGACY_PROVIDER_REFERENCE_INVALID: 'legacy_provider_reference_invalid',
  LEGACY_PROVIDER_STATE_UNVERIFIED: 'legacy_provider_state_unverified',
  LEGACY_PAYMENT_STATE_UNVERIFIED: 'legacy_payment_state_unverified',
  LEGACY_DISPUTE_REQUIRES_SEPARATE_RECORD: 'legacy_dispute_requires_separate_record',
  LEGACY_OPERATION_CONFLICT: 'legacy_operational_evidence_conflict',
  LEGACY_PAYMENT_CONFLICT: 'legacy_payment_evidence_conflict',
  LEGACY_TIMESTAMP_INVALID: 'legacy_timestamp_invalid',
  LEGACY_PAID_AFTER_CANCELLATION: 'legacy_paid_after_cancellation',
  INVALID_BATCH: 'invalid_batch',
  INVALID_BATCH_ENTRY: 'invalid_batch_entry',
});

function frozenReasons(reasons) {
  return Object.freeze([...new Set(reasons)].sort());
}

function transitionResult(accepted, outcome, changed, state, reason) {
  return Object.freeze({ accepted, outcome, changed, state, reason });
}

function reduceState(current, next, knownStates, transitions) {
  const currentKnown = typeof current === 'string' && knownStates.has(current);
  const nextKnown = typeof next === 'string' && knownStates.has(next);
  if (!currentKnown || !nextKnown) {
    return transitionResult(
      false,
      'rejected',
      false,
      currentKnown ? current : null,
      FIXED_REASONS.UNKNOWN_STATE,
    );
  }
  if (current === next) {
    return transitionResult(true, 'unchanged', false, current, FIXED_REASONS.SAME_STATE);
  }
  if ((transitions[current] || []).includes(next)) {
    return transitionResult(true, 'applied', true, next, FIXED_REASONS.APPLIED);
  }
  return transitionResult(false, 'rejected', false, current, FIXED_REASONS.FORBIDDEN);
}

function reducePaymentState(current, next) {
  return reduceState(current, next, PAYMENT_STATES, PAYMENT_TRANSITIONS);
}

function reduceRegistrationState(current, next) {
  return reduceState(current, next, REGISTRATION_STATES, REGISTRATION_TRANSITIONS);
}

function reduceFulfillmentState(current, next) {
  return reduceState(current, next, FULFILLMENT_STATES, FULFILLMENT_TRANSITIONS);
}

function reduceConfirmedRefundState(current, next) {
  return reduceState(current, next, CONFIRMED_REFUND_STATES, REFUND_TRANSITIONS);
}

function reduceDisputeState(current, next) {
  return reduceState(current, next, DISPUTE_STATES, DISPUTE_TRANSITIONS);
}

function safeOwnData(value, maximumEntries = 100) {
  if (value === null || typeof value !== 'object' || isProxy(value)) return null;

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (prototype !== Object.prototype || keys.length > maximumEntries) return null;

  const entries = new Map();
  for (const key of keys) {
    if (typeof key !== 'string') return null;
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return null;
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined) {
      return null;
    }
    entries.set(key, descriptor.value);
  }

  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return null;
  }
  return entries;
}

function freezeProjection(kind, values) {
  const projection = kind === 'registration'
    ? {
      stateSchemaVersion,
      paymentStatus: values.paymentStatus,
      registrationStatus: values.registrationStatus,
      refundStatus: values.refundStatus,
    }
    : {
      stateSchemaVersion,
      paymentStatus: values.paymentStatus,
      fulfillmentStatus: values.fulfillmentStatus,
      refundStatus: values.refundStatus,
    };
  return Object.freeze(projection);
}

function validationResult(accepted, status, reasons, projection) {
  return Object.freeze({
    accepted,
    status,
    reasons: frozenReasons(reasons),
    projection,
  });
}

function canonicalCandidate(kind, entries) {
  if (kind === 'registration') {
    return {
      stateSchemaVersion: entries.get('stateSchemaVersion'),
      paymentStatus: entries.get('paymentStatus'),
      registrationStatus: entries.get('registrationStatus'),
      refundStatus: entries.get('refundStatus'),
    };
  }
  return {
    stateSchemaVersion: entries.get('stateSchemaVersion'),
    paymentStatus: entries.get('paymentStatus'),
    fulfillmentStatus: entries.get('fulfillmentStatus'),
    refundStatus: entries.get('refundStatus'),
  };
}

function hasExactCanonicalKeys(kind, entries) {
  const expected = kind === 'registration'
    ? ['stateSchemaVersion', 'paymentStatus', 'registrationStatus', 'refundStatus']
    : ['stateSchemaVersion', 'paymentStatus', 'fulfillmentStatus', 'refundStatus'];
  return entries.size === expected.length && expected.every((key) => entries.has(key));
}

function validateCommerceState(kind, candidate) {
  if (kind !== 'registration' && kind !== 'order') {
    return validationResult(false, 'rejected', [FIXED_REASONS.INVALID_KIND], null);
  }
  const entries = safeOwnData(candidate, 4);
  if (!entries || !hasExactCanonicalKeys(kind, entries)) {
    return validationResult(false, 'rejected', [FIXED_REASONS.INVALID_RECORD], null);
  }
  const values = canonicalCandidate(kind, entries);
  const domainState = kind === 'registration'
    ? values.registrationStatus
    : values.fulfillmentStatus;
  if (values.stateSchemaVersion !== stateSchemaVersion
    || !PAYMENT_STATES.has(values.paymentStatus)
    || !CONFIRMED_REFUND_STATES.has(values.refundStatus)
    || (kind === 'registration' && !REGISTRATION_STATES.has(domainState))
    || (kind === 'order' && !FULFILLMENT_STATES.has(domainState))) {
    return validationResult(
      false,
      'rejected',
      [FIXED_REASONS.INVALID_CANONICAL_STATE],
      null,
    );
  }

  const projection = freezeProjection(kind, values);
  const rejected = [];
  const review = [];
  if (values.refundStatus !== 'none' && values.paymentStatus !== 'paid') {
    rejected.push(FIXED_REASONS.REFUND_WITHOUT_PAID);
  }
  if (kind === 'registration'
    && ['confirmed', 'attended', 'no_show', 'transferred'].includes(domainState)
    && !['paid', 'not_required'].includes(values.paymentStatus)) {
    rejected.push(FIXED_REASONS.REGISTRATION_WITHOUT_PAYMENT);
  }
  if (kind === 'order'
    && !['unfulfilled', 'cancelled'].includes(domainState)
    && values.paymentStatus !== 'paid') {
    rejected.push(FIXED_REASONS.FULFILLMENT_WITHOUT_PAYMENT);
  }
  if (domainState === 'cancelled' && values.paymentStatus === 'paid') {
    review.push(FIXED_REASONS.PAID_DOMAIN_CANCELLED);
  }
  if (domainState === 'cancelled'
    && ['checkout_creating', 'checkout_open', 'processing'].includes(values.paymentStatus)) {
    review.push(FIXED_REASONS.NONTERMINAL_PAYMENT_CANCELLED);
  }

  if (rejected.length > 0) {
    return validationResult(false, 'rejected', rejected, projection);
  }
  if (review.length > 0) {
    return validationResult(true, 'review_required', review, projection);
  }
  return validationResult(true, 'valid', [], projection);
}

function validateDisputeState(candidate) {
  const entries = safeOwnData(candidate, 3);
  if (!entries
    || entries.size !== 3
    || !['stateSchemaVersion', 'paymentStatus', 'disputeStatus']
      .every((key) => entries.has(key))) {
    return validationResult(false, 'rejected', [FIXED_REASONS.INVALID_RECORD], null);
  }
  const version = entries.get('stateSchemaVersion');
  const paymentStatus = entries.get('paymentStatus');
  const disputeStatus = entries.get('disputeStatus');
  if (version !== stateSchemaVersion
    || !PAYMENT_STATES.has(paymentStatus)
    || !DISPUTE_STATES.has(disputeStatus)) {
    return validationResult(
      false,
      'rejected',
      [FIXED_REASONS.INVALID_CANONICAL_STATE],
      null,
    );
  }
  const projection = Object.freeze({
    stateSchemaVersion,
    status: disputeStatus,
  });
  if (disputeStatus !== 'none' && paymentStatus !== 'paid') {
    return validationResult(
      false,
      'rejected',
      [FIXED_REASONS.DISPUTE_WITHOUT_PAID],
      projection,
    );
  }
  return validationResult(true, 'valid', [], projection);
}

function classificationResult(accepted, status, reasons, projection) {
  return Object.freeze({
    accepted,
    status,
    reasons: frozenReasons(reasons),
    projection,
  });
}

function presentDataValue(value) {
  return value !== undefined && value !== null;
}

function providerReferenceIsSafe(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 255;
}

function providerReference(entries, key) {
  const value = entries.get(key);
  if (!presentDataValue(value)) return { present: false, invalid: false };
  if (!providerReferenceIsSafe(value)) {
    return { present: false, invalid: true };
  }
  return { present: true, invalid: false };
}

function providerReferenceList(entries, key) {
  const value = entries.get(key);
  if (!presentDataValue(value)) return { present: false, invalid: false };
  const values = safeArrayValues(value, 100);
  if (!values || values.some((item) => !providerReferenceIsSafe(item))) {
    return { present: false, invalid: true };
  }
  return { present: values.length > 0, invalid: false };
}

function disputeEvidencePresent(entries) {
  const singular = providerReference(entries, 'stripeDisputeId');
  const list = providerReferenceList(entries, 'stripeDisputeIds');
  return singular.present
    || singular.invalid
    || list.present
    || list.invalid
    || (entries.has('stripeDisputes')
      && presentDataValue(entries.get('stripeDisputes')));
}

function safeTimestampData(value) {
  if (value === null || typeof value !== 'object' || isProxy(value)) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (keys.length !== 2 || keys.some((key) => typeof key !== 'string')) return null;
  const entries = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return null;
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined) {
      return null;
    }
    entries.set(key, descriptor.value);
  }
  return entries;
}

function timestampDataIsValid(entries, secondsKey, nanosecondsKey) {
  return entries.size === 2
    && entries.has(secondsKey)
    && entries.has(nanosecondsKey)
    && Number.isSafeInteger(entries.get(secondsKey))
    && entries.get(secondsKey) >= -62135596800
    && entries.get(secondsKey) <= 253402300799
    && Number.isSafeInteger(entries.get(nanosecondsKey))
    && entries.get(nanosecondsKey) >= 0
    && entries.get(nanosecondsKey) <= 999999999;
}

function timestampEvidence(entries, key, reasons) {
  const value = entries.get(key);
  if (!presentDataValue(value)) return false;
  const data = safeTimestampData(value);
  const serialized = data && (
    timestampDataIsValid(data, 'seconds', 'nanoseconds')
    || timestampDataIsValid(data, '_seconds', '_nanoseconds')
  );
  if (!serialized) {
    reasons.push(FIXED_REASONS.LEGACY_TIMESTAMP_INVALID);
    return null;
  }
  return true;
}

function readLegacyEvidence(entries, reasons) {
  const evidence = {
    paidAt: timestampEvidence(entries, 'paidAt', reasons),
    refundedAt: timestampEvidence(entries, 'refundedAt', reasons),
    fulfilledAt: timestampEvidence(entries, 'fulfilledAt', reasons),
    cancelledAt: timestampEvidence(entries, 'cancelledAt', reasons),
  };
  return Object.values(evidence).includes(null) ? null : Object.freeze(evidence);
}

function compatiblePaymentState(value) {
  if (PAYMENT_STATES.has(value)) return value;
  if (value === 'paid_after_cancellation') return 'paid';
  if (value === 'partially_refunded' || value === 'refunded') return 'paid';
  return null;
}

function legacyPaymentForCancelled(entries, reasons) {
  const rawPayment = entries.get('paymentStatus');
  if (!presentDataValue(rawPayment)) {
    reasons.push(FIXED_REASONS.LEGACY_PAYMENT_STATE_UNVERIFIED);
    return null;
  }
  if (rawPayment === 'partially_refunded' || rawPayment === 'refunded') {
    reasons.push(FIXED_REASONS.LEGACY_PAYMENT_CONFLICT);
    return null;
  }
  const compatible = compatiblePaymentState(rawPayment);
  if (!compatible) {
    reasons.push(FIXED_REASONS.LEGACY_PAYMENT_CONFLICT);
    return null;
  }
  if (rawPayment === 'paid_after_cancellation') {
    reasons.push(FIXED_REASONS.LEGACY_PAID_AFTER_CANCELLATION);
  }
  return compatible;
}

function applyCompatiblePayment(entries, expected, alternatives, reasons) {
  const rawPayment = entries.get('paymentStatus');
  if (!presentDataValue(rawPayment)) return expected;
  if ((rawPayment === 'partially_refunded' || rawPayment === 'refunded')
    && rawPayment !== entries.get('status')) {
    reasons.push(FIXED_REASONS.LEGACY_PAYMENT_CONFLICT);
    return null;
  }
  if (rawPayment === 'paid_after_cancellation'
    && entries.get('status') !== 'cancelled') {
    reasons.push(FIXED_REASONS.LEGACY_PAYMENT_CONFLICT);
    return null;
  }
  const compatible = compatiblePaymentState(rawPayment);
  if (!compatible) {
    reasons.push(FIXED_REASONS.LEGACY_PAYMENT_CONFLICT);
    return null;
  }
  if (compatible === expected || alternatives.includes(compatible)) {
    return compatible;
  }
  reasons.push(FIXED_REASONS.LEGACY_PAYMENT_CONFLICT);
  return null;
}

function requireCompatiblePayment(entries, expected, alternatives, reasons) {
  if (!presentDataValue(entries.get('paymentStatus'))) {
    reasons.push(FIXED_REASONS.LEGACY_PAYMENT_STATE_UNVERIFIED);
    return null;
  }
  return applyCompatiblePayment(entries, expected, alternatives, reasons);
}

function legacyRegistrationProjection(entries, evidence, reasons) {
  const status = entries.get('status');
  const { cancelledAt } = evidence;
  const common = { refundStatus: 'none' };
  switch (status) {
    case 'pending': {
      const paymentStatus = applyCompatiblePayment(entries, 'checkout_creating', [
        'checkout_open',
        'checkout_failed',
        'processing',
        'failed',
        'expired',
        'cancelled',
      ], reasons);
      if (!paymentStatus) return null;
      return {
        ...common,
        paymentStatus,
        registrationStatus: 'reserved',
      };
    }
    case 'paid': {
      const paymentStatus = applyCompatiblePayment(entries, 'paid', [], reasons);
      if (!paymentStatus) return null;
      return {
        ...common,
        paymentStatus,
        registrationStatus: cancelledAt ? 'cancelled' : 'confirmed',
      };
    }
    case 'comp': {
      const paymentStatus = applyCompatiblePayment(entries, 'not_required', [], reasons);
      if (!paymentStatus) return null;
      return {
        ...common,
        paymentStatus,
        registrationStatus: cancelledAt ? 'cancelled' : 'confirmed',
      };
    }
    case 'transferred': {
      const paymentStatus = requireCompatiblePayment(
        entries,
        'paid',
        ['not_required'],
        reasons,
      );
      if (!paymentStatus) return null;
      return {
        ...common,
        paymentStatus,
        registrationStatus: 'transferred',
      };
    }
    case 'partially_refunded':
    case 'refunded': {
      const paymentStatus = applyCompatiblePayment(entries, 'paid', [], reasons);
      if (!paymentStatus) return null;
      return {
        ...common,
        paymentStatus,
        registrationStatus: cancelledAt ? 'cancelled' : 'confirmed',
        refundStatus: status,
      };
    }
    case 'cancelled': {
      const paymentStatus = legacyPaymentForCancelled(entries, reasons);
      if (!paymentStatus) return null;
      return {
        ...common,
        paymentStatus,
        registrationStatus: 'cancelled',
      };
    }
    default:
      return null;
  }
}

function legacyOrderProjection(entries, evidence, reasons) {
  const status = entries.get('status');
  const { fulfilledAt, cancelledAt } = evidence;
  const common = { refundStatus: 'none' };
  if (fulfilledAt && cancelledAt) {
    reasons.push(FIXED_REASONS.LEGACY_OPERATION_CONFLICT);
    return null;
  }

  let fulfillmentStatus = 'unfulfilled';
  if (fulfilledAt || status === 'fulfilled') fulfillmentStatus = 'fulfilled_legacy';
  if (cancelledAt || status === 'cancelled') fulfillmentStatus = 'cancelled';

  switch (status) {
    case 'pending': {
      const paymentStatus = applyCompatiblePayment(entries, 'checkout_creating', [
        'checkout_open',
        'checkout_failed',
        'processing',
        'failed',
        'expired',
        'cancelled',
      ], reasons);
      if (!paymentStatus) return null;
      return {
        ...common,
        paymentStatus,
        fulfillmentStatus,
      };
    }
    case 'paid': {
      const paymentStatus = applyCompatiblePayment(entries, 'paid', [], reasons);
      if (!paymentStatus) return null;
      return {
        ...common,
        paymentStatus,
        fulfillmentStatus,
      };
    }
    case 'fulfilled': {
      const paymentStatus = requireCompatiblePayment(entries, 'paid', [], reasons);
      if (!paymentStatus) return null;
      return {
        ...common,
        paymentStatus,
        fulfillmentStatus,
      };
    }
    case 'partially_refunded':
    case 'refunded': {
      const paymentStatus = applyCompatiblePayment(entries, 'paid', [], reasons);
      if (!paymentStatus) return null;
      return {
        ...common,
        paymentStatus,
        fulfillmentStatus,
        refundStatus: status,
      };
    }
    case 'cancelled': {
      const paymentStatus = legacyPaymentForCancelled(entries, reasons);
      if (!paymentStatus) return null;
      return {
        ...common,
        paymentStatus,
        fulfillmentStatus,
      };
    }
    default:
      return null;
  }
}

function appendLegacyEvidenceConflicts(kind, entries, evidence, reasons) {
  const status = entries.get('status');
  const {
    paidAt,
    refundedAt,
    fulfilledAt,
    cancelledAt,
  } = evidence;

  if (fulfilledAt && cancelledAt
    || (status === 'pending' && (fulfilledAt || cancelledAt))
    || (kind === 'order' && status === 'fulfilled' && cancelledAt)
    || (kind === 'order' && status === 'cancelled' && fulfilledAt)
    || (kind === 'registration' && fulfilledAt)
    || (kind === 'registration'
      && ['paid', 'comp', 'transferred'].includes(status)
      && cancelledAt)) {
    reasons.push(FIXED_REASONS.LEGACY_OPERATION_CONFLICT);
  }

  const statusesCompatibleWithPaidAt = kind === 'registration'
    ? ['paid', 'transferred', 'partially_refunded', 'refunded']
    : ['paid', 'fulfilled', 'partially_refunded', 'refunded'];
  if (paidAt && !statusesCompatibleWithPaidAt.includes(status)) {
    reasons.push(FIXED_REASONS.LEGACY_PAYMENT_CONFLICT);
  }
  if (refundedAt && !['partially_refunded', 'refunded'].includes(status)) {
    reasons.push(FIXED_REASONS.LEGACY_PAYMENT_CONFLICT);
  }
}

function classifyLegacyRecord(kind, record) {
  if (kind !== 'registration' && kind !== 'order') {
    return classificationResult(false, 'rejected', [FIXED_REASONS.INVALID_KIND], null);
  }
  const entries = safeOwnData(record);
  if (!entries) {
    return classificationResult(false, 'rejected', [FIXED_REASONS.INVALID_RECORD], null);
  }

  if (entries.has('stateSchemaVersion')) {
    if (entries.has('disputeStatus')) {
      return classificationResult(
        false,
        'rejected',
        [FIXED_REASONS.INVALID_CANONICAL_STATE],
        null,
      );
    }
    if (disputeEvidencePresent(entries)) {
      return classificationResult(
        true,
        'review_required',
        [FIXED_REASONS.LEGACY_DISPUTE_REQUIRES_SEPARATE_RECORD],
        null,
      );
    }
    const validation = validateCommerceState(kind, canonicalCandidate(kind, entries));
    if (!validation.accepted) {
      return classificationResult(
        false,
        'rejected',
        [FIXED_REASONS.INVALID_CANONICAL_STATE, ...validation.reasons],
        validation.projection,
      );
    }
    if (validation.status === 'review_required') {
      return classificationResult(true, 'review_required', validation.reasons,
        validation.projection);
    }
    return classificationResult(true, 'already_canonical', [], validation.projection);
  }

  const legacyStatuses = kind === 'registration'
    ? LEGACY_REGISTRATION_STATUSES
    : LEGACY_ORDER_STATUSES;
  if (!legacyStatuses.has(entries.get('status'))) {
    return classificationResult(
      false,
      'rejected',
      [FIXED_REASONS.LEGACY_STATUS_UNKNOWN],
      null,
    );
  }

  const reasons = [];
  const paymentReferences = [
    providerReference(entries, 'stripeSessionId'),
    providerReference(entries, 'stripePaymentLinkId'),
    providerReference(entries, 'stripePaymentIntentId'),
    providerReference(entries, 'stripeChargeId'),
  ];
  const refundReferences = [
    providerReferenceList(entries, 'stripeRefundIds'),
  ];
  const allReferences = [
    ...paymentReferences,
    ...refundReferences,
  ];
  if (allReferences.some((reference) => reference.invalid)) {
    reasons.push(FIXED_REASONS.LEGACY_PROVIDER_REFERENCE_INVALID);
    return classificationResult(true, 'review_required', reasons, null);
  }
  const paymentProviderPresent = paymentReferences.some((reference) => reference.present);
  const refundProviderPresent = refundReferences.some((reference) => reference.present);
  if (disputeEvidencePresent(entries)
    || (entries.has('disputeStatus') && entries.get('disputeStatus') !== 'none')) {
    reasons.push(FIXED_REASONS.LEGACY_DISPUTE_REQUIRES_SEPARATE_RECORD);
    return classificationResult(true, 'review_required', reasons, null);
  }
  if (refundProviderPresent
    && !['partially_refunded', 'refunded'].includes(entries.get('status'))) {
    reasons.push(FIXED_REASONS.LEGACY_PROVIDER_STATE_UNVERIFIED);
    return classificationResult(true, 'review_required', reasons, null);
  }
  const evidence = readLegacyEvidence(entries, reasons);
  if (!evidence) {
    return classificationResult(true, 'review_required', reasons, null);
  }
  appendLegacyEvidenceConflicts(kind, entries, evidence, reasons);
  if (reasons.includes(FIXED_REASONS.LEGACY_OPERATION_CONFLICT)
    || reasons.includes(FIXED_REASONS.LEGACY_PAYMENT_CONFLICT)) {
    return classificationResult(true, 'review_required', reasons, null);
  }
  if (paymentProviderPresent
    && (['pending', 'cancelled', 'comp'].includes(entries.get('status'))
      || entries.get('paymentStatus') === 'not_required')) {
    reasons.push(FIXED_REASONS.LEGACY_PROVIDER_STATE_UNVERIFIED);
    return classificationResult(true, 'review_required', reasons, null);
  }
  const values = kind === 'registration'
    ? legacyRegistrationProjection(entries, evidence, reasons)
    : legacyOrderProjection(entries, evidence, reasons);

  if (!values && reasons.length > 0) {
    return classificationResult(true, 'review_required', reasons, null);
  }
  if (!values) {
    return classificationResult(
      false,
      'rejected',
      [FIXED_REASONS.LEGACY_STATUS_UNKNOWN],
      null,
    );
  }

  const projection = freezeProjection(kind, values);
  const validation = validateCommerceState(kind, projection);
  if (!validation.accepted) {
    return classificationResult(false, 'rejected', validation.reasons, projection);
  }
  const combinedReasons = [...reasons, ...validation.reasons];
  if (combinedReasons.length > 0) {
    return classificationResult(true, 'review_required', combinedReasons, projection);
  }
  return classificationResult(true, 'mapped', [], projection);
}

function safeArrayValues(value, maximumEntries = 1000) {
  if (value === null || typeof value !== 'object' || isProxy(value)) return null;
  if (!Array.isArray(value)) return null;

  let prototype;
  let keys;
  let lengthDescriptor;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  } catch {
    return null;
  }
  if (prototype !== Array.prototype
    || !lengthDescriptor
    || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
    || lengthDescriptor.value > maximumEntries) {
    return null;
  }
  const length = lengthDescriptor.value;
  const values = new Array(length);
  const found = new Set();
  for (const key of keys) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)) return null;
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index >= length) return null;
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return null;
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined) {
      return null;
    }
    values[index] = descriptor.value;
    found.add(index);
  }
  if (found.size !== length) return null;
  return values;
}

function fixedCountObject(keys, source = {}) {
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, source[key] || 0])));
}

function summaryResult(accepted, total, statuses, reasons) {
  const fixedStatuses = fixedCountObject([
    'mapped',
    'already_canonical',
    'review_required',
    'rejected',
  ], statuses);
  const fixedReasonCounts = Object.freeze(Object.fromEntries(
    Object.entries(reasons).sort(([left], [right]) => left.localeCompare(right)),
  ));
  return Object.freeze({
    accepted,
    total,
    statuses: fixedStatuses,
    reasons: fixedReasonCounts,
  });
}

function summarizeLegacyRecords(batch) {
  const values = safeArrayValues(batch);
  if (!values) {
    return summaryResult(false, 0, { rejected: 1 }, { [FIXED_REASONS.INVALID_BATCH]: 1 });
  }

  const statuses = {};
  const reasons = {};
  for (const entry of values) {
    const data = safeOwnData(entry, 2);
    let result;
    if (!data || data.size !== 2 || !data.has('kind') || !data.has('record')) {
      result = classificationResult(
        false,
        'rejected',
        [FIXED_REASONS.INVALID_BATCH_ENTRY],
        null,
      );
    } else {
      result = classifyLegacyRecord(data.get('kind'), data.get('record'));
    }
    statuses[result.status] = (statuses[result.status] || 0) + 1;
    result.reasons.forEach((reason) => {
      reasons[reason] = (reasons[reason] || 0) + 1;
    });
  }
  return summaryResult(true, values.length, statuses, reasons);
}

module.exports = Object.freeze({
  stateSchemaVersion,
  PaymentState,
  RegistrationState,
  FulfillmentState,
  ConfirmedRefundState,
  DisputeState,
  reducePaymentState,
  reduceRegistrationState,
  reduceFulfillmentState,
  reduceConfirmedRefundState,
  reduceDisputeState,
  validateCommerceState,
  validateDisputeState,
  classifyLegacyRecord,
  summarizeLegacyRecords,
});
