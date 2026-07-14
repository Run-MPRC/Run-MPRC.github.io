'use strict';

const {
  REFUND_VALIDATION_REASONS,
  validatePartialRefundAmount,
} = require('./refundValidation');

const INVALID_PARTIAL_AMOUNTS = [
  ['missing', undefined],
  ['null', null],
  ['zero', 0],
  ['negative zero', -0],
  ['negative', -1],
  ['equal to original', 2500],
  ['over original', 2501],
  ['fraction', 1.5],
  ['NaN', Number.NaN],
  ['positive infinity', Number.POSITIVE_INFINITY],
  ['negative infinity', Number.NEGATIVE_INFINITY],
  ['numeric string', '1'],
  ['infinity string', 'Infinity'],
  ['boolean', true],
  ['array', [1]],
  ['object', { amount: 1 }],
  ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
];

const INVALID_STORED_TOTALS = [
  ['missing', undefined],
  ['null', null],
  ['zero', 0],
  ['negative', -1],
  ['string', '2500'],
  ['fraction', 2500.5],
  ['NaN', Number.NaN],
  ['positive infinity', Number.POSITIVE_INFINITY],
  ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
];

describe('validatePartialRefundAmount', () => {
  test.each(INVALID_PARTIAL_AMOUNTS)('rejects %s caller input without coercion', (
    _caseName,
    amountCents,
  ) => {
    expect(validatePartialRefundAmount({
      amountCents,
      originalAmountCents: 2500,
    })).toEqual({
      ok: false,
      reason: REFUND_VALIDATION_REASONS.INVALID_PARTIAL_AMOUNT,
    });
  });

  test.each(INVALID_STORED_TOTALS)('rejects a %s stored total', (
    _caseName,
    originalAmountCents,
  ) => {
    expect(validatePartialRefundAmount({
      amountCents: 1,
      originalAmountCents,
    })).toEqual({
      ok: false,
      reason: REFUND_VALIDATION_REASONS.INVALID_STORED_TOTAL,
    });
  });

  test.each([1, 2499])('returns exact valid boundary amount %i', (amountCents) => {
    const result = validatePartialRefundAmount({
      amountCents,
      originalAmountCents: 2500,
    });

    expect(result).toEqual({ ok: true, amountCents });
    expect(Object.isFrozen(result)).toBe(true);
  });
});
