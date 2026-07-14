'use strict';

const {
  REFUND_RESPONSE_VALIDATION_REASONS,
  buildRefundExpectation,
  validateSucceededRefundResponse,
} = require('./refundResponseValidation');

const VALID_PARTIAL_INPUT = Object.freeze({
  action: 'refund_partial',
  paymentIntentId: 'pi_synthetic123',
  currency: 'usd',
  originalAmountCents: 2500,
  requestedAmountCents: 1000,
});

function validResponse(overrides = {}) {
  return {
    id: 're_synthetic123',
    object: 'refund',
    amount: 1000,
    currency: 'usd',
    payment_intent: 'pi_synthetic123',
    status: 'succeeded',
    ...overrides,
  };
}

describe('buildRefundExpectation', () => {
  test.each([
    ['missing input', undefined],
    ['unknown action', { ...VALID_PARTIAL_INPUT, action: 'refund_everything' }],
    ['missing PaymentIntent', { ...VALID_PARTIAL_INPUT, paymentIntentId: undefined }],
    ['non-string PaymentIntent', { ...VALID_PARTIAL_INPUT, paymentIntentId: ['pi_synthetic123'] }],
    ['malformed PaymentIntent', { ...VALID_PARTIAL_INPUT, paymentIntentId: 'payment-1' }],
    ['uppercase currency', { ...VALID_PARTIAL_INPUT, currency: 'USD' }],
    ['different currency', { ...VALID_PARTIAL_INPUT, currency: 'eur' }],
    ['missing original amount', { ...VALID_PARTIAL_INPUT, originalAmountCents: undefined }],
    ['zero original amount', { ...VALID_PARTIAL_INPUT, originalAmountCents: 0 }],
    ['fractional original amount', { ...VALID_PARTIAL_INPUT, originalAmountCents: 2500.5 }],
    ['unsafe original amount', {
      ...VALID_PARTIAL_INPUT,
      originalAmountCents: Number.MAX_SAFE_INTEGER + 1,
    }],
    ['missing partial amount', { ...VALID_PARTIAL_INPUT, requestedAmountCents: undefined }],
    ['zero partial amount', { ...VALID_PARTIAL_INPUT, requestedAmountCents: 0 }],
    ['equal partial amount', { ...VALID_PARTIAL_INPUT, requestedAmountCents: 2500 }],
    ['fractional partial amount', { ...VALID_PARTIAL_INPUT, requestedAmountCents: 1.5 }],
  ])('rejects %s without coercion', (_caseName, input) => {
    expect(buildRefundExpectation(input)).toEqual({
      ok: false,
      reason: REFUND_RESPONSE_VALIDATION_REASONS.INVALID_EXPECTATION,
    });
  });

  test('returns a deeply immutable partial expectation', () => {
    const result = buildRefundExpectation(VALID_PARTIAL_INPUT);

    expect(result).toEqual({
      ok: true,
      action: 'refund_partial',
      paymentIntentId: 'pi_synthetic123',
      currency: 'usd',
      originalAmountCents: 2500,
      requestedAmountCents: 1000,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('returns a deeply immutable full-remaining expectation without a requested amount', () => {
    const result = buildRefundExpectation({
      ...VALID_PARTIAL_INPUT,
      action: 'refund_full',
      requestedAmountCents: null,
    });

    expect(result).toEqual({
      ok: true,
      action: 'refund_full',
      paymentIntentId: 'pi_synthetic123',
      currency: 'usd',
      originalAmountCents: 2500,
      requestedAmountCents: null,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe('validateSucceededRefundResponse', () => {
  let partialExpectation;
  let fullExpectation;

  beforeEach(() => {
    partialExpectation = buildRefundExpectation(VALID_PARTIAL_INPUT);
    fullExpectation = buildRefundExpectation({
      ...VALID_PARTIAL_INPUT,
      action: 'refund_full',
      requestedAmountCents: null,
    });
  });

  test.each([
    ['missing', undefined],
    ['null', null],
    ['string', 'refund'],
    ['array', [validResponse()]],
    ['surprising prototype', Object.assign(Object.create({ inherited: true }), validResponse())],
    ['missing ID', validResponse({ id: undefined })],
    ['malformed ID', validResponse({ id: 'refund-1' })],
    ['wrong object', validResponse({ object: 'payment_intent' })],
    ['missing amount', validResponse({ amount: undefined })],
    ['zero amount', validResponse({ amount: 0 })],
    ['fraction amount', validResponse({ amount: 1000.5 })],
    ['unsafe amount', validResponse({ amount: Number.MAX_SAFE_INTEGER + 1 })],
    ['missing currency', validResponse({ currency: undefined })],
    ['missing PaymentIntent', validResponse({ payment_intent: undefined })],
    ['expanded PaymentIntent', validResponse({ payment_intent: { id: 'pi_synthetic123' } })],
    ['missing status', validResponse({ status: undefined })],
  ])('rejects a structurally invalid %s response', (_caseName, refund) => {
    expect(validateSucceededRefundResponse({
      refund,
      expectation: partialExpectation,
    })).toEqual({
      ok: false,
      reason: REFUND_RESPONSE_VALIDATION_REASONS.INVALID_RESPONSE,
    });
  });

  test('rejects accessor-backed fields without invoking them', () => {
    const refund = validResponse();
    const getter = jest.fn(() => {
      throw new Error('accessor must not run');
    });
    Object.defineProperty(refund, 'id', { enumerable: true, get: getter });

    expect(validateSucceededRefundResponse({
      refund,
      expectation: partialExpectation,
    })).toEqual({
      ok: false,
      reason: REFUND_RESPONSE_VALIDATION_REASONS.INVALID_RESPONSE,
    });
    expect(getter).not.toHaveBeenCalled();
  });

  test.each(['pending', 'requires_action', 'failed', 'canceled', 'future_status'])('rejects %s as unconfirmed', (status) => {
    expect(validateSucceededRefundResponse({
      refund: validResponse({ status }),
      expectation: partialExpectation,
    })).toEqual({
      ok: false,
      reason: REFUND_RESPONSE_VALIDATION_REASONS.UNCONFIRMED_RESPONSE,
    });
  });

  test.each([
    ['different PaymentIntent', { payment_intent: 'pi_different123' }],
    ['different currency', { currency: 'cad' }],
    ['different partial amount', { amount: 999 }],
    ['over-original amount', { amount: 2501 }],
  ])('rejects a %s', (_caseName, overrides) => {
    expect(validateSucceededRefundResponse({
      refund: validResponse(overrides),
      expectation: partialExpectation,
    })).toEqual({
      ok: false,
      reason: REFUND_RESPONSE_VALIDATION_REASONS.MISMATCHED_RESPONSE,
    });
  });

  test('returns only a frozen validated projection for an exact partial result', () => {
    const refund = validResponse({ private_provider_detail: 'must-not-copy' });
    const result = validateSucceededRefundResponse({ refund, expectation: partialExpectation });

    expect(result).toEqual({
      ok: true,
      refundId: 're_synthetic123',
      amountCents: 1000,
      currency: 'usd',
      paymentIntentId: 'pi_synthetic123',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).not.toHaveProperty('private_provider_detail');
  });

  test.each([1, 2500])('accepts full remaining provider amount %i', (amount) => {
    expect(validateSucceededRefundResponse({
      refund: validResponse({ amount }),
      expectation: fullExpectation,
    })).toEqual({
      ok: true,
      refundId: 're_synthetic123',
      amountCents: amount,
      currency: 'usd',
      paymentIntentId: 'pi_synthetic123',
    });
  });

  test('rejects a full response above the stored original', () => {
    expect(validateSucceededRefundResponse({
      refund: validResponse({ amount: 2501 }),
      expectation: fullExpectation,
    })).toEqual({
      ok: false,
      reason: REFUND_RESPONSE_VALIDATION_REASONS.MISMATCHED_RESPONSE,
    });
  });
});
