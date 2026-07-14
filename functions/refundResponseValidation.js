'use strict';

const REFUND_RESULT_NOT_CONFIRMED_MESSAGE = (
  'Refund result could not be confirmed. Do not retry. '
  + 'Escalate to the treasurer and platform owner.'
);

const REFUND_RESPONSE_VALIDATION_REASONS = Object.freeze({
  INVALID_EXPECTATION: 'invalid_expectation',
  INVALID_RESPONSE: 'invalid_response',
  UNCONFIRMED_RESPONSE: 'unconfirmed_response',
  MISMATCHED_RESPONSE: 'mismatched_response',
});

const INVALID_EXPECTATION = Object.freeze({
  ok: false,
  reason: REFUND_RESPONSE_VALIDATION_REASONS.INVALID_EXPECTATION,
});
const INVALID_RESPONSE = Object.freeze({
  ok: false,
  reason: REFUND_RESPONSE_VALIDATION_REASONS.INVALID_RESPONSE,
});
const UNCONFIRMED_RESPONSE = Object.freeze({
  ok: false,
  reason: REFUND_RESPONSE_VALIDATION_REASONS.UNCONFIRMED_RESPONSE,
});
const MISMATCHED_RESPONSE = Object.freeze({
  ok: false,
  reason: REFUND_RESPONSE_VALIDATION_REASONS.MISMATCHED_RESPONSE,
});

const PAYMENT_INTENT_ID_PATTERN = /^pi_[A-Za-z0-9]{8,252}$/u;
const REFUND_ID_PATTERN = /^re_[A-Za-z0-9]{8,252}$/u;
const REFUND_ACTIONS = new Set(['refund_full', 'refund_partial']);
const RESPONSE_FIELDS = Object.freeze([
  'id',
  'object',
  'amount',
  'currency',
  'payment_intent',
  'status',
]);

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readOwnDataProperties(record, fieldNames) {
  const descriptors = Object.getOwnPropertyDescriptors(record);
  const values = {};
  for (const fieldName of fieldNames) {
    const descriptor = descriptors[fieldName];
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      return null;
    }
    values[fieldName] = descriptor.value;
  }
  return values;
}

function buildRefundExpectation(input) {
  if (!isPlainRecord(input)) return INVALID_EXPECTATION;

  const {
    action,
    paymentIntentId,
    currency,
    originalAmountCents,
    requestedAmountCents,
  } = input;

  if (
    !REFUND_ACTIONS.has(action)
    || typeof paymentIntentId !== 'string'
    || !PAYMENT_INTENT_ID_PATTERN.test(paymentIntentId)
    || currency !== 'usd'
    || !Number.isSafeInteger(originalAmountCents)
    || originalAmountCents <= 0
  ) {
    return INVALID_EXPECTATION;
  }

  if (action === 'refund_partial') {
    if (
      !Number.isSafeInteger(requestedAmountCents)
      || requestedAmountCents <= 0
      || requestedAmountCents >= originalAmountCents
    ) {
      return INVALID_EXPECTATION;
    }
  } else if (requestedAmountCents !== null && requestedAmountCents !== undefined) {
    return INVALID_EXPECTATION;
  }

  return Object.freeze({
    ok: true,
    action,
    paymentIntentId,
    currency,
    originalAmountCents,
    requestedAmountCents: action === 'refund_partial' ? requestedAmountCents : null,
  });
}

function isValidExpectation(expectation) {
  if (!isPlainRecord(expectation) || expectation.ok !== true) return false;
  const rebuilt = buildRefundExpectation(expectation);
  return rebuilt.ok;
}

function validateSucceededRefundResponse({ refund, expectation } = {}) {
  try {
    if (!isValidExpectation(expectation) || !isPlainRecord(refund)) {
      return INVALID_RESPONSE;
    }

    const fields = readOwnDataProperties(refund, RESPONSE_FIELDS);
    if (
      !fields
      || typeof fields.id !== 'string'
      || !REFUND_ID_PATTERN.test(fields.id)
      || fields.object !== 'refund'
      || !Number.isSafeInteger(fields.amount)
      || fields.amount <= 0
      || typeof fields.currency !== 'string'
      || typeof fields.payment_intent !== 'string'
      || typeof fields.status !== 'string'
    ) {
      return INVALID_RESPONSE;
    }

    if (fields.status !== 'succeeded') return UNCONFIRMED_RESPONSE;

    if (
      fields.payment_intent !== expectation.paymentIntentId
      || fields.currency !== expectation.currency
      || fields.amount > expectation.originalAmountCents
      || (
        expectation.action === 'refund_partial'
        && fields.amount !== expectation.requestedAmountCents
      )
    ) {
      return MISMATCHED_RESPONSE;
    }

    return Object.freeze({
      ok: true,
      refundId: fields.id,
      amountCents: fields.amount,
      currency: fields.currency,
      paymentIntentId: fields.payment_intent,
    });
  } catch {
    return INVALID_RESPONSE;
  }
}

module.exports = {
  REFUND_RESPONSE_VALIDATION_REASONS,
  REFUND_RESULT_NOT_CONFIRMED_MESSAGE,
  buildRefundExpectation,
  validateSucceededRefundResponse,
};
