'use strict';

const REFUND_VALIDATION_REASONS = Object.freeze({
  INVALID_PARTIAL_AMOUNT: 'invalid_partial_amount',
  INVALID_STORED_TOTAL: 'invalid_stored_total',
});

const INVALID_PARTIAL_AMOUNT = Object.freeze({
  ok: false,
  reason: REFUND_VALIDATION_REASONS.INVALID_PARTIAL_AMOUNT,
});

const INVALID_STORED_TOTAL = Object.freeze({
  ok: false,
  reason: REFUND_VALIDATION_REASONS.INVALID_STORED_TOTAL,
});

function validatePartialRefundAmount({ amountCents, originalAmountCents } = {}) {
  if (!Number.isSafeInteger(originalAmountCents) || originalAmountCents <= 0) {
    return INVALID_STORED_TOTAL;
  }

  if (
    !Number.isSafeInteger(amountCents)
    || amountCents <= 0
    || amountCents >= originalAmountCents
  ) {
    return INVALID_PARTIAL_AMOUNT;
  }

  return Object.freeze({ ok: true, amountCents });
}

module.exports = {
  REFUND_VALIDATION_REASONS,
  validatePartialRefundAmount,
};
