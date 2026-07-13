const fs = require('node:fs');
const path = require('node:path');

const {
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
} = require('./commerceState');

const HOSTILE_CANARY = 'private-runner@example.test/token?secret=do-not-copy';

const MATRICES = [
  {
    name: 'payment',
    states: Object.values(PaymentState),
    reduce: reducePaymentState,
    allowed: {
      checkout_creating: ['checkout_open', 'checkout_failed'],
      checkout_open: ['processing', 'paid', 'failed', 'expired', 'cancelled'],
      processing: ['paid', 'failed'],
    },
  },
  {
    name: 'registration',
    states: Object.values(RegistrationState),
    reduce: reduceRegistrationState,
    allowed: {
      reserved: ['confirmed', 'cancelled'],
      confirmed: ['attended', 'no_show', 'transferred', 'cancelled'],
    },
  },
  {
    name: 'fulfillment',
    states: Object.values(FulfillmentState),
    reduce: reduceFulfillmentState,
    allowed: {
      unfulfilled: ['picking', 'cancelled'],
      picking: ['packed', 'cancelled'],
      packed: ['shipped', 'ready_for_pickup', 'cancelled'],
      shipped: ['delivered'],
      ready_for_pickup: ['picked_up'],
      delivered: ['return_requested'],
      picked_up: ['return_requested'],
      fulfilled_legacy: ['return_requested'],
      return_requested: ['returned'],
      returned: ['written_off'],
    },
  },
  {
    name: 'refund',
    states: Object.values(ConfirmedRefundState),
    reduce: reduceConfirmedRefundState,
    allowed: {
      none: ['partially_refunded', 'refunded'],
      partially_refunded: ['refunded'],
    },
  },
  {
    name: 'dispute',
    states: Object.values(DisputeState),
    reduce: reduceDisputeState,
    allowed: {
      none: Object.values(DisputeState).filter((state) => state !== 'none'),
      needs_response: ['under_review', 'won', 'lost'],
      under_review: ['won', 'lost'],
      warning_needs_response: ['warning_under_review', 'warning_closed', 'needs_response'],
      warning_under_review: ['warning_closed', 'needs_response'],
      lost: ['won'],
    },
  },
];

function registrationState(overrides = {}) {
  return {
    stateSchemaVersion: 1,
    paymentStatus: 'checkout_open',
    registrationStatus: 'reserved',
    refundStatus: 'none',
    ...overrides,
  };
}

function orderState(overrides = {}) {
  return {
    stateSchemaVersion: 1,
    paymentStatus: 'checkout_open',
    fulfillmentStatus: 'unfulfilled',
    refundStatus: 'none',
    ...overrides,
  };
}

function timestamp(seconds = 1) {
  return { seconds, nanoseconds: 0 };
}

describe.each(MATRICES)('$name reducer', ({ states, reduce, allowed }) => {
  test('exhausts every known state pair against the declared matrix', () => {
    let pairCount = 0;
    states.forEach((current) => {
      states.forEach((next) => {
        pairCount += 1;
        const result = reduce(current, next);
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.keys(result)).toEqual([
          'accepted',
          'outcome',
          'changed',
          'state',
          'reason',
        ]);
        if (current === next) {
          expect(result).toEqual({
            accepted: true,
            outcome: 'unchanged',
            changed: false,
            state: current,
            reason: 'same_state',
          });
        } else if ((allowed[current] || []).includes(next)) {
          expect(result).toEqual({
            accepted: true,
            outcome: 'applied',
            changed: true,
            state: next,
            reason: 'transition_applied',
          });
        } else {
          expect(result).toEqual({
            accepted: false,
            outcome: 'rejected',
            changed: false,
            state: current,
            reason: 'transition_forbidden',
          });
        }
      });
    });
    expect(pairCount).toBe(states.length ** 2);
  });

  test('rejects unknown and non-string states without echoing input', () => {
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const first = reduce(HOSTILE_CANARY, states[0]);
      const second = reduce(states[0], { canary: HOSTILE_CANARY });
      expect(first.reason).toBe('unknown_state');
      expect(first.state).toBeNull();
      expect(second.reason).toBe('unknown_state');
      expect(JSON.stringify([first, second])).not.toContain(HOSTILE_CANARY);
      expect(consoleLog).not.toHaveBeenCalled();
      expect(consoleWarn).not.toHaveBeenCalled();
    } finally {
      consoleLog.mockRestore();
      consoleWarn.mockRestore();
    }
  });
});

describe('immutable state contract', () => {
  test('exports version one and frozen closed enums', () => {
    expect(stateSchemaVersion).toBe(1);
    for (const stateEnum of [
      PaymentState,
      RegistrationState,
      FulfillmentState,
      ConfirmedRefundState,
      DisputeState,
    ]) {
      expect(Object.isFrozen(stateEnum)).toBe(true);
      const before = JSON.stringify(stateEnum);
      stateEnum.EXTRA = HOSTILE_CANARY;
      expect(JSON.stringify(stateEnum)).toBe(before);
    }
    expect(PaymentState).not.toHaveProperty('REFUND_PENDING');
    expect(PaymentState).not.toHaveProperty('PAID_AFTER_CANCELLATION');
    expect(FulfillmentState.FULFILLED_LEGACY).toBe('fulfilled_legacy');
    expect(DisputeState.PREVENTED).toBe('prevented');
  });

  test('blocks late payment regressions and terminal refund/dispute regressions', () => {
    for (const next of ['checkout_open', 'processing', 'failed', 'expired']) {
      expect(reducePaymentState('paid', next).accepted).toBe(false);
    }
    expect(reduceConfirmedRefundState('refunded', 'partially_refunded')).toEqual({
      accepted: false,
      outcome: 'rejected',
      changed: false,
      state: 'refunded',
      reason: 'transition_forbidden',
    });
    for (const terminal of ['won', 'warning_closed', 'prevented']) {
      expect(reduceDisputeState(terminal, 'under_review').accepted).toBe(false);
      expect(reduceDisputeState(terminal, terminal).outcome).toBe('unchanged');
    }
    expect(reduceDisputeState('lost', 'won').outcome).toBe('applied');
  });

  test('same refund status is unchanged and never claims amount or event deduplication', () => {
    expect(reduceConfirmedRefundState('partially_refunded', 'partially_refunded')).toEqual({
      accepted: true,
      outcome: 'unchanged',
      changed: false,
      state: 'partially_refunded',
      reason: 'same_state',
    });
    expect(reducePaymentState('checkout_open', 'failed').outcome).toBe('applied');
    expect(reduceDisputeState('warning_under_review', 'needs_response').outcome)
      .toBe('applied');
  });
});

describe('cross-dimension validation', () => {
  test.each([
    ['registration reservation', 'registration', registrationState()],
    ['paid registration', 'registration', registrationState({
      paymentStatus: 'paid',
      registrationStatus: 'confirmed',
    })],
    ['free registration', 'registration', registrationState({
      paymentStatus: 'not_required',
      registrationStatus: 'confirmed',
    })],
    ['open order', 'order', orderState()],
    ['fulfilled order', 'order', orderState({
      paymentStatus: 'paid',
      fulfillmentStatus: 'delivered',
    })],
    ['refunded order', 'order', orderState({
      paymentStatus: 'paid',
      refundStatus: 'refunded',
    })],
  ])('accepts a valid %s', (_name, kind, input) => {
    const before = JSON.stringify(input);
    const result = validateCommerceState(kind, input);
    expect(result.status).toBe('valid');
    expect(result.accepted).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.projection).toEqual(input);
    expect(result.projection).not.toBe(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.reasons)).toBe(true);
    expect(Object.isFrozen(result.projection)).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(input)).toBe(false);
  });

  test.each([
    ['refund without paid', 'order', orderState({ refundStatus: 'partially_refunded' }),
      'refund_without_paid'],
    ['confirmed registration without payment', 'registration', registrationState({
      registrationStatus: 'confirmed',
    }), 'registration_without_payment'],
    ['fulfillment without payment', 'order', orderState({ fulfillmentStatus: 'packed' }),
      'fulfillment_without_payment'],
  ])('rejects %s', (_name, kind, input, reason) => {
    const result = validateCommerceState(kind, input);
    expect(result.accepted).toBe(false);
    expect(result.status).toBe('rejected');
    expect(result.reasons).toContain(reason);
  });

  test.each([
    ['paid cancelled registration', 'registration', registrationState({
      paymentStatus: 'paid',
      registrationStatus: 'cancelled',
    }), 'paid_domain_cancelled'],
    ['paid cancelled order', 'order', orderState({
      paymentStatus: 'paid',
      fulfillmentStatus: 'cancelled',
    }), 'paid_domain_cancelled'],
    ['open cancelled order', 'order', orderState({
      fulfillmentStatus: 'cancelled',
    }), 'nonterminal_payment_domain_cancelled'],
    ['processing cancelled registration', 'registration', registrationState({
      paymentStatus: 'processing',
      registrationStatus: 'cancelled',
    }), 'nonterminal_payment_domain_cancelled'],
    ['creating cancelled registration', 'registration', registrationState({
      paymentStatus: 'checkout_creating',
      registrationStatus: 'cancelled',
    }), 'nonterminal_payment_domain_cancelled'],
  ])('preserves but requires review for %s', (_name, kind, input, reason) => {
    const result = validateCommerceState(kind, input);
    expect(result.accepted).toBe(true);
    expect(result.status).toBe('review_required');
    expect(result.reasons).toEqual([reason]);
    expect(result.projection).toEqual(input);
  });

  test('rejects missing, extra, wrong-version, and unknown canonical fields', () => {
    for (const input of [
      null,
      [],
      { ...orderState(), extra: HOSTILE_CANARY },
      orderState({ stateSchemaVersion: 2 }),
      orderState({ paymentStatus: HOSTILE_CANARY }),
      orderState({ fulfillmentStatus: HOSTILE_CANARY }),
      orderState({ refundStatus: HOSTILE_CANARY }),
      { ...orderState(), disputeStatus: HOSTILE_CANARY },
    ]) {
      const result = validateCommerceState('order', input);
      expect(result.accepted).toBe(false);
      expect(result.status).toBe('rejected');
      expect(JSON.stringify(result)).not.toContain(HOSTILE_CANARY);
    }
  });

  test('does not invoke accessors or proxy traps and emits no diagnostic', () => {
    const getter = jest.fn(() => HOSTILE_CANARY);
    const accessor = orderState();
    Object.defineProperty(accessor, 'paymentStatus', {
      enumerable: true,
      get: getter,
    });

    const proxy = new Proxy(orderState(), {
      ownKeys() {
        throw new Error(HOSTILE_CANARY);
      },
    });
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const input of [accessor, proxy]) {
        const result = validateCommerceState('order', input);
        expect(result).toEqual({
          accepted: false,
          status: 'rejected',
          reasons: ['invalid_record'],
          projection: null,
        });
        expect(JSON.stringify(result)).not.toContain(HOSTILE_CANARY);
      }
      expect(getter).not.toHaveBeenCalled();
      expect(consoleLog).not.toHaveBeenCalled();
      expect(consoleWarn).not.toHaveBeenCalled();
    } finally {
      consoleLog.mockRestore();
      consoleWarn.mockRestore();
    }
  });
});

describe('per-dispute validation', () => {
  test.each(Object.values(DisputeState))(
    'validates supported dispute state %s separately from the business record',
    (disputeStatus) => {
      const result = validateDisputeState({
        stateSchemaVersion: 1,
        paymentStatus: 'paid',
        disputeStatus,
      });
      expect(result).toEqual({
        accepted: true,
        status: 'valid',
        reasons: [],
        projection: {
          stateSchemaVersion: 1,
          status: disputeStatus,
        },
      });
      expect(Object.isFrozen(result.projection)).toBe(true);
    },
  );

  test('requires paid payment context for a real dispute', () => {
    const result = validateDisputeState({
      stateSchemaVersion: 1,
      paymentStatus: 'processing',
      disputeStatus: 'needs_response',
    });
    expect(result).toEqual({
      accepted: false,
      status: 'rejected',
      reasons: ['dispute_without_paid'],
      projection: {
        stateSchemaVersion: 1,
        status: 'needs_response',
      },
    });
  });

  test('rejects malformed, future-version, and extra dispute validation input', () => {
    for (const candidate of [
      null,
      {
        stateSchemaVersion: 2,
        paymentStatus: 'paid',
        disputeStatus: 'won',
      },
      {
        stateSchemaVersion: 1,
        paymentStatus: 'paid',
        disputeStatus: HOSTILE_CANARY,
      },
      {
        stateSchemaVersion: 1,
        paymentStatus: 'paid',
        disputeStatus: 'won',
        disputeId: HOSTILE_CANARY,
      },
    ]) {
      const result = validateDisputeState(candidate);
      expect(result.accepted).toBe(false);
      expect(result.status).toBe('rejected');
      expect(JSON.stringify(result)).not.toContain(HOSTILE_CANARY);
    }
  });
});

describe('legacy classification', () => {
  test.each([
    ['pending', { status: 'pending' }, 'checkout_creating', 'reserved', 'none'],
    ['paid', { status: 'paid' }, 'paid', 'confirmed', 'none'],
    ['comp', { status: 'comp' }, 'not_required', 'confirmed', 'none'],
    ['cancelled', {
      status: 'cancelled',
      paymentStatus: 'cancelled',
    }, 'cancelled', 'cancelled', 'none'],
    ['transferred', {
      status: 'transferred',
      paymentStatus: 'paid',
    }, 'paid', 'transferred', 'none'],
    ['partially refunded', { status: 'partially_refunded' }, 'paid', 'confirmed',
      'partially_refunded'],
    ['refunded', { status: 'refunded' }, 'paid', 'confirmed', 'refunded'],
  ])('maps registration %s', (_name, record, payment, registration, refund) => {
    const result = classifyLegacyRecord('registration', record);
    expect(result.accepted).toBe(true);
    expect(result.status).toBe('mapped');
    expect(result.projection).toEqual(registrationState({
      paymentStatus: payment,
      registrationStatus: registration,
      refundStatus: refund,
    }));
  });

  test.each([
    ['pending', { status: 'pending' }, 'checkout_creating', 'unfulfilled', 'none'],
    ['paid', { status: 'paid' }, 'paid', 'unfulfilled', 'none'],
    ['fulfilled', {
      status: 'fulfilled',
      paymentStatus: 'paid',
    }, 'paid', 'fulfilled_legacy', 'none'],
    ['cancelled', {
      status: 'cancelled',
      paymentStatus: 'cancelled',
    }, 'cancelled', 'cancelled', 'none'],
    ['partially refunded', { status: 'partially_refunded' }, 'paid', 'unfulfilled',
      'partially_refunded'],
    ['refunded', { status: 'refunded' }, 'paid', 'unfulfilled', 'refunded'],
  ])('maps order %s', (_name, record, payment, fulfillment, refund) => {
    const result = classifyLegacyRecord('order', record);
    expect(result.accepted).toBe(true);
    expect(result.status).toBe('mapped');
    expect(result.projection).toEqual(orderState({
      paymentStatus: payment,
      fulfillmentStatus: fulfillment,
      refundStatus: refund,
    }));
  });

  test.each([
    ['transferred registration', 'registration', { status: 'transferred' }],
    ['fulfilled order', 'order', { status: 'fulfilled' }],
    ['cancelled registration', 'registration', { status: 'cancelled' }],
    ['cancelled order', 'order', { status: 'cancelled' }],
  ])('quarantines %s when operational state is the only payment evidence',
    (_name, kind, record) => {
      const result = classifyLegacyRecord(kind, record);
      expect(result).toEqual({
        accepted: true,
        status: 'review_required',
        reasons: ['legacy_payment_state_unverified'],
        projection: null,
      });
    });

  test('maps a transferred comp only when payment is explicitly not required', () => {
    const result = classifyLegacyRecord('registration', {
      status: 'transferred',
      paymentStatus: 'not_required',
    });
    expect(result.status).toBe('mapped');
    expect(result.projection.paymentStatus).toBe('not_required');
    expect(result.projection.registrationStatus).toBe('transferred');
  });

  test('quarantines unverified provider references without exposing IDs or guessing state', () => {
    const session = 'cs_test_synthetic_1';
    const pending = classifyLegacyRecord('registration', {
      status: 'pending',
      stripeSessionId: session,
    });
    const cancelled = classifyLegacyRecord('order', {
      status: 'cancelled',
      stripePaymentLinkId: 'plink_synthetic_1',
    });
    expect(pending.status).toBe('review_required');
    expect(pending.projection).toBeNull();
    expect(cancelled.status).toBe('review_required');
    expect(cancelled.projection).toBeNull();
    expect(pending.reasons).toEqual(['legacy_provider_state_unverified']);
    expect(cancelled.reasons).toEqual(['legacy_provider_state_unverified']);
    expect(JSON.stringify([pending, cancelled])).not.toContain(HOSTILE_CANARY);
  });

  test.each([
    ['PaymentIntent on pending registration', 'registration', {
      status: 'pending',
      stripePaymentIntentId: 'pi_synthetic_1',
    }],
    ['Charge on cancelled order', 'order', {
      status: 'cancelled',
      stripeChargeId: 'ch_synthetic_1',
    }],
    ['refund reference without refund status', 'order', {
      status: 'paid',
      stripeRefundIds: ['re_synthetic_1'],
    }],
    ['Charge reference on comp registration', 'registration', {
      status: 'comp',
      stripeChargeId: 'opaque_synthetic_charge',
    }],
    ['Session reference on transferred no-payment registration', 'registration', {
      status: 'transferred',
      paymentStatus: 'not_required',
      stripeSessionId: 'opaque_synthetic_session',
    }],
  ])('quarantines %s without inferring provider state', (_name, kind, record) => {
    const result = classifyLegacyRecord(kind, record);
    expect(result).toEqual({
      accepted: true,
      status: 'review_required',
      reasons: ['legacy_provider_state_unverified'],
      projection: null,
    });
    expect(JSON.stringify(result)).not.toContain(HOSTILE_CANARY);
  });

  test.each([
    { status: 'paid', stripeDisputeId: 'dp_synthetic_1' },
    { status: 'paid', stripeDisputeIds: ['dp_synthetic_1'] },
  ])('quarantines provider dispute references as separate records', (record) => {
    const result = classifyLegacyRecord('order', record);
    expect(result).toEqual({
      accepted: true,
      status: 'review_required',
      reasons: ['legacy_dispute_requires_separate_record'],
      projection: null,
    });
    expect(JSON.stringify(result)).not.toContain(HOSTILE_CANARY);
  });

  test('quarantines malformed provider references without touching nested values', () => {
    const nested = new Proxy({ canary: HOSTILE_CANARY }, {
      get() {
        throw new Error(HOSTILE_CANARY);
      },
    });
    const result = classifyLegacyRecord('registration', {
      status: 'pending',
      stripeRefundIds: nested,
    });
    expect(result).toEqual({
      accepted: true,
      status: 'review_required',
      reasons: ['legacy_provider_reference_invalid'],
      projection: null,
    });
    expect(JSON.stringify(result)).not.toContain(HOSTILE_CANARY);
  });

  test.each([
    { status: 'paid', stripeChargeId: '' },
    { status: 'refunded', stripeRefundIds: [HOSTILE_CANARY.repeat(20)] },
    { status: 'paid', stripePaymentIntentId: { canary: HOSTILE_CANARY } },
  ])('quarantines wrong-type, empty, or overlong provider references', (record) => {
    const result = classifyLegacyRecord('order', record);
    expect(result).toEqual({
      accepted: true,
      status: 'review_required',
      reasons: ['legacy_provider_reference_invalid'],
      projection: null,
    });
    expect(JSON.stringify(result)).not.toContain(HOSTILE_CANARY);
  });

  test('treats bounded Stripe IDs as opaque while keeping their contents redacted', () => {
    const result = classifyLegacyRecord('registration', {
      status: 'pending',
      stripeChargeId: HOSTILE_CANARY,
    });
    expect(result).toEqual({
      accepted: true,
      status: 'review_required',
      reasons: ['legacy_provider_state_unverified'],
      projection: null,
    });
    expect(JSON.stringify(result)).not.toContain(HOSTILE_CANARY);
  });

  test('still quarantines a pending provider reference beside a local payment string', () => {
    const result = classifyLegacyRecord('registration', {
      status: 'pending',
      paymentStatus: 'processing',
      stripeSessionId: 'cs_test_synthetic_1',
    });
    expect(result.status).toBe('review_required');
    expect(result.reasons).toEqual(['legacy_provider_state_unverified']);
    expect(result.projection).toBeNull();
    expect(JSON.stringify(result)).not.toContain(HOSTILE_CANARY);
  });

  test.each([
    ['processing', 'processing', 'nonterminal_payment_domain_cancelled'],
    ['failed', 'failed', null],
    ['expired', 'expired', null],
    ['paid_after_cancellation', 'paid', 'legacy_paid_after_cancellation'],
  ])('classifies webhook-only payment state %s', (paymentStatus, expected, reason) => {
    const result = classifyLegacyRecord('registration', {
      status: 'cancelled',
      paymentStatus,
    });
    expect(result.projection.paymentStatus).toBe(expected);
    if (reason) {
      expect(result.status).toBe('review_required');
      expect(result.reasons).toContain(reason);
    } else {
      expect(result.status).toBe('mapped');
    }
  });

  test('does not infer cancellation from a refund without cancellation evidence', () => {
    const ordinary = classifyLegacyRecord('registration', { status: 'refunded' });
    const cancelled = classifyLegacyRecord('registration', {
      status: 'refunded',
      cancelledAt: timestamp(),
    });
    expect(ordinary.projection.registrationStatus).toBe('confirmed');
    expect(cancelled.projection.registrationStatus).toBe('cancelled');
    expect(cancelled.status).toBe('review_required');
    expect(cancelled.reasons).toContain('paid_domain_cancelled');
  });

  test('preserves legacy fulfillment without inventing delivery or pickup', () => {
    const result = classifyLegacyRecord('order', {
      status: 'refunded',
      fulfilledAt: timestamp(),
    });
    expect(result.status).toBe('mapped');
    expect(result.projection.fulfillmentStatus).toBe('fulfilled_legacy');
    expect(result.projection.refundStatus).toBe('refunded');
  });

  test('quarantines conflicting fulfillment and cancellation evidence without a projection', () => {
    const result = classifyLegacyRecord('order', {
      status: 'refunded',
      fulfilledAt: timestamp(),
      cancelledAt: timestamp(2),
    });
    expect(result).toEqual({
      accepted: true,
      status: 'review_required',
      reasons: ['legacy_operational_evidence_conflict'],
      projection: null,
    });
  });

  test.each([
    ['fulfilled status with cancellation time', 'order', {
      status: 'fulfilled',
      cancelledAt: timestamp(),
    }, 'legacy_operational_evidence_conflict'],
    ['cancelled status with fulfillment time', 'order', {
      status: 'cancelled',
      fulfilledAt: timestamp(),
    }, 'legacy_operational_evidence_conflict'],
    ['pending status with payment time', 'registration', {
      status: 'pending',
      paidAt: timestamp(),
    }, 'legacy_payment_evidence_conflict'],
    ['cancelled status with payment time', 'order', {
      status: 'cancelled',
      paidAt: timestamp(),
    }, 'legacy_payment_evidence_conflict'],
    ['paid status with refund time', 'registration', {
      status: 'paid',
      refundedAt: timestamp(),
    }, 'legacy_payment_evidence_conflict'],
    ['confirmed legacy registration with cancellation time', 'registration', {
      status: 'paid',
      cancelledAt: timestamp(),
    }, 'legacy_operational_evidence_conflict'],
    ['pending registration with cancellation time', 'registration', {
      status: 'pending',
      cancelledAt: timestamp(),
    }, 'legacy_operational_evidence_conflict'],
    ['registration with fulfillment time', 'registration', {
      status: 'refunded',
      fulfilledAt: timestamp(),
    }, 'legacy_operational_evidence_conflict'],
    ['pending order with fulfillment time', 'order', {
      status: 'pending',
      fulfilledAt: timestamp(),
    }, 'legacy_operational_evidence_conflict'],
  ])('quarantines %s instead of letting a timestamp override status',
    (_name, kind, record, reason) => {
      const result = classifyLegacyRecord(kind, record);
      expect(result).toEqual({
        accepted: true,
        status: 'review_required',
        reasons: [reason],
        projection: null,
      });
    });

  test.each([
    false,
    { seconds: Number.MAX_SAFE_INTEGER, nanoseconds: 0 },
    { seconds: 1, nanoseconds: 1000000000 },
  ])('quarantines malformed or out-of-range timestamp evidence', (fulfilledAt) => {
    const result = classifyLegacyRecord('order', {
      status: 'paid',
      fulfilledAt,
    });
    expect(result).toEqual({
      accepted: true,
      status: 'review_required',
      reasons: ['legacy_timestamp_invalid'],
      projection: null,
    });
  });

  test('accepts exact Firestore Timestamp own-data shape without invoking its prototype', () => {
    class FirestoreTimestampShape {
      constructor() {
        this._seconds = 1;
        this._nanoseconds = 0;
      }
    }
    const result = classifyLegacyRecord('order', {
      status: 'refunded',
      fulfilledAt: new FirestoreTimestampShape(),
    });
    expect(result.status).toBe('mapped');
    expect(result.projection.fulfillmentStatus).toBe('fulfilled_legacy');
  });

  test('maps the same ordinary legacy fixture byte-equivalently without mutation or calls', () => {
    const record = {
      status: 'refunded',
      fulfilledAt: timestamp(),
    };
    const before = JSON.stringify(record);
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const first = classifyLegacyRecord('order', record);
      const second = classifyLegacyRecord('order', record);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(first.status).toBe('mapped');
      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.isFrozen(first.reasons)).toBe(true);
      expect(Object.isFrozen(first.projection)).toBe(true);
      expect(JSON.stringify(record)).toBe(before);
      expect(Object.isFrozen(record)).toBe(false);
      expect(consoleLog).not.toHaveBeenCalled();
      expect(consoleWarn).not.toHaveBeenCalled();
    } finally {
      consoleLog.mockRestore();
      consoleWarn.mockRestore();
    }
  });

  test('returns a deterministic no-op for valid v1 and rejects invalid v1', () => {
    const valid = Object.freeze({
      ...orderState({ paymentStatus: 'paid' }),
      ordinaryLegacyField: 'synthetic',
    });
    const first = classifyLegacyRecord('order', valid);
    const second = classifyLegacyRecord('order', valid);
    expect(first.status).toBe('already_canonical');
    expect(first.projection).toEqual(orderState({ paymentStatus: 'paid' }));
    expect(first.projection).not.toBe(valid);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));

    const invalid = classifyLegacyRecord('order', orderState({
      stateSchemaVersion: 2,
    }));
    expect(invalid.accepted).toBe(false);
    expect(invalid.status).toBe('rejected');
    expect(invalid.reasons).toContain('invalid_canonical_state');

    const singularDispute = classifyLegacyRecord('order', {
      ...orderState({ paymentStatus: 'paid' }),
      disputeStatus: 'won',
    });
    expect(singularDispute).toEqual({
      accepted: false,
      status: 'rejected',
      reasons: ['invalid_canonical_state'],
      projection: null,
    });

    const nestedDispute = new Proxy({ status: 'won' }, {
      get() {
        throw new Error(HOSTILE_CANARY);
      },
      ownKeys() {
        throw new Error(HOSTILE_CANARY);
      },
    });
    for (const disputeEvidence of [
      { stripeDisputeIds: ['du_synthetic_1'] },
      { stripeDisputes: nestedDispute },
    ]) {
      const result = classifyLegacyRecord('order', {
        ...orderState({ paymentStatus: 'paid' }),
        ...disputeEvidence,
      });
      expect(result).toEqual({
        accepted: true,
        status: 'review_required',
        reasons: ['legacy_dispute_requires_separate_record'],
        projection: null,
      });
      expect(JSON.stringify(result)).not.toContain(HOSTILE_CANARY);
    }
  });

  test.each([
    { disputeStatus: 'needs_response' },
    { stripeDisputeIds: ['du_synthetic_1'] },
    { stripeDisputes: new Proxy({}, {
      get() {
        throw new Error(HOSTILE_CANARY);
      },
    }) },
  ])('quarantines singular or nested legacy dispute evidence', (disputeEvidence) => {
    const result = classifyLegacyRecord('registration', {
      status: 'paid',
      ...disputeEvidence,
    });
    expect(result).toEqual({
      accepted: true,
      status: 'review_required',
      reasons: ['legacy_dispute_requires_separate_record'],
      projection: null,
    });
    expect(JSON.stringify(result)).not.toContain(HOSTILE_CANARY);
  });

  test.each([
    ['invalid provider reference', {
      status: HOSTILE_CANARY,
      stripeSessionId: { nested: HOSTILE_CANARY },
    }],
    ['conflicting timestamp', {
      status: HOSTILE_CANARY,
      paidAt: timestamp(),
    }],
  ])('keeps unknown status authoritative over %s', (_name, record) => {
    const result = classifyLegacyRecord('order', record);
    expect(result).toEqual({
      accepted: false,
      status: 'rejected',
      reasons: ['legacy_status_unknown'],
      projection: null,
    });
    expect(JSON.stringify(result)).not.toContain(HOSTILE_CANARY);
  });

  test('keeps local numeric state version separate from Stripe metadata schemaVersion', () => {
    const metadataOnly = classifyLegacyRecord('registration', {
      status: 'pending',
      schemaVersion: '1',
    });
    expect(metadataOnly.status).toBe('mapped');
    expect(metadataOnly.projection.stateSchemaVersion).toBe(1);

    const stringLocalVersion = classifyLegacyRecord('registration', {
      ...registrationState(),
      stateSchemaVersion: '1',
    });
    expect(stringLocalVersion.accepted).toBe(false);
    expect(stringLocalVersion.status).toBe('rejected');
    expect(stringLocalVersion.reasons).toContain('invalid_canonical_state');
  });

  test.each([
    ['failed payment beside paid status', { status: 'paid', paymentStatus: 'failed' }],
    ['refund payment beside cancelled status', {
      status: 'cancelled',
      paymentStatus: 'refunded',
    }],
    ['paid-after-cancellation beside paid status', {
      status: 'paid',
      paymentStatus: 'paid_after_cancellation',
    }],
    ['full-refund payment beside partial-refund status', {
      status: 'partially_refunded',
      paymentStatus: 'refunded',
    }],
    ['partial-refund payment beside full-refund status', {
      status: 'refunded',
      paymentStatus: 'partially_refunded',
    }],
  ])('quarantines %s without guessing a patch', (_name, record) => {
    const result = classifyLegacyRecord('order', record);
    expect(result).toEqual({
      accepted: true,
      status: 'review_required',
      reasons: ['legacy_payment_evidence_conflict'],
      projection: null,
    });
  });

  test('fails closed on unknown, prototype, accessor, and proxy records', () => {
    const getter = jest.fn(() => HOSTILE_CANARY);
    const accessor = { status: 'pending' };
    Object.defineProperty(accessor, 'private', {
      enumerable: true,
      get: getter,
    });
    const proxy = new Proxy({ status: 'pending' }, {
      getOwnPropertyDescriptor() {
        throw new Error(HOSTILE_CANARY);
      },
    });
    const polluted = Object.create({ inherited: HOSTILE_CANARY });
    polluted.status = 'pending';
    const nestedProxy = new Proxy(timestamp(), {
      get() {
        throw new Error(HOSTILE_CANARY);
      },
      ownKeys() {
        throw new Error(HOSTILE_CANARY);
      },
    });
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const results = [
        classifyLegacyRecord('order', { status: HOSTILE_CANARY }),
        classifyLegacyRecord('unknown', { status: 'pending' }),
        classifyLegacyRecord('order', accessor),
        classifyLegacyRecord('order', proxy),
        classifyLegacyRecord('order', polluted),
      ];
      results.forEach((result) => {
        expect(result.accepted).toBe(false);
        expect(result.status).toBe('rejected');
        expect(JSON.stringify(result)).not.toContain(HOSTILE_CANARY);
      });
      const nested = classifyLegacyRecord('order', {
        status: 'refunded',
        fulfilledAt: nestedProxy,
      });
      expect(nested).toEqual({
        accepted: true,
        status: 'review_required',
        reasons: ['legacy_timestamp_invalid'],
        projection: null,
      });
      expect(JSON.stringify(nested)).not.toContain(HOSTILE_CANARY);
      expect(getter).not.toHaveBeenCalled();
      expect(consoleLog).not.toHaveBeenCalled();
      expect(consoleWarn).not.toHaveBeenCalled();
    } finally {
      consoleLog.mockRestore();
      consoleWarn.mockRestore();
    }
  });
});

describe('redacted synthetic dry-run summary', () => {
  test('returns counts and fixed reasons only, without source records or identifiers', () => {
    const batch = [
      { kind: 'registration', record: { status: 'pending' } },
      {
        kind: 'order',
        record: {
          status: 'cancelled',
          stripeSessionId: 'cs_test_synthetic_1',
        },
      },
      { kind: 'order', record: { status: HOSTILE_CANARY } },
      { kind: 'registration', record: registrationState({
        paymentStatus: 'paid',
        registrationStatus: 'confirmed',
      }) },
    ];
    const first = summarizeLegacyRecords(batch);
    const second = summarizeLegacyRecords(batch);
    expect(first).toEqual({
      accepted: true,
      total: 4,
      statuses: {
        mapped: 1,
        already_canonical: 1,
        review_required: 1,
        rejected: 1,
      },
      reasons: {
        legacy_provider_state_unverified: 1,
        legacy_status_unknown: 1,
      },
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(first)).not.toContain(HOSTILE_CANARY);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.statuses)).toBe(true);
    expect(Object.isFrozen(first.reasons)).toBe(true);
    expect(first).not.toHaveProperty('records');
    expect(first).not.toHaveProperty('items');
  });

  test('rejects sparse, accessor, proxy, and malformed batches with fixed output', () => {
    const sparse = new Array(1);
    const accessor = [];
    Object.defineProperty(accessor, '0', {
      enumerable: true,
      get() {
        return HOSTILE_CANARY;
      },
    });
    accessor.length = 1;
    const proxy = new Proxy([], {
      ownKeys() {
        throw new Error(HOSTILE_CANARY);
      },
    });
    for (const value of [null, {}, sparse, accessor, proxy]) {
      const result = summarizeLegacyRecords(value);
      expect(result).toEqual({
        accepted: false,
        total: 0,
        statuses: {
          mapped: 0,
          already_canonical: 0,
          review_required: 0,
          rejected: 1,
        },
        reasons: { invalid_batch: 1 },
      });
      expect(JSON.stringify(result)).not.toContain(HOSTILE_CANARY);
    }
  });

  test('counts malformed entries without accessing record data', () => {
    const result = summarizeLegacyRecords([{ kind: 'order' }]);
    expect(result.statuses.rejected).toBe(1);
    expect(result.reasons).toEqual({ invalid_batch_entry: 1 });
  });
});

describe('source boundary', () => {
  test('contains no runtime, provider, filesystem, environment, clock, random, or logger call', () => {
    const source = fs.readFileSync(path.join(__dirname, 'commerceState.js'), 'utf8');
    for (const forbidden of [
      "require('firebase",
      "require(\"firebase",
      "require('stripe",
      "require(\"stripe",
      "require('node:fs')",
      'process.env',
      'Date.now',
      'Math.random',
      'console.',
      '.log(',
      'fetch(',
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).not.toContain('paid_after_cancellation:');
    expect(source).not.toContain('refund_pending');
  });
});
