const { types: { isProxy } } = require('node:util');

const outboxStateSchemaVersion = 1;

const OPAQUE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function immutableEnum(values) {
  return Object.freeze(Object.fromEntries(values.map((value) => [
    value.toUpperCase(),
    value,
  ])));
}

const OutboxDeliveryState = immutableEnum([
  'queued',
  'dispatching',
  'dispatched',
  'delivered',
  'retry_scheduled',
  'dead_letter',
  'suppressed',
]);

const DELIVERY_STATES = new Set(Object.values(OutboxDeliveryState));

// A fresh provider send attempt begins only on entry to these states, so the
// monotonic attempt counter increments by exactly one across those edges and is
// unchanged across every other edge.
const ATTEMPT_START_STATES = new Set(['dispatching']);

const DELIVERY_TRANSITIONS = Object.freeze({
  queued: Object.freeze(['dispatching']),
  dispatching: Object.freeze(['dispatched', 'retry_scheduled', 'dead_letter', 'suppressed']),
  retry_scheduled: Object.freeze(['dispatching', 'dead_letter']),
  dispatched: Object.freeze(['delivered', 'dead_letter', 'suppressed']),
});
// Terminal states delivered, dead_letter, and suppressed have no outgoing edges
// and cannot be resurrected.

const EXPECTED_RECORD_KEYS = Object.freeze([
  'outboxStateSchemaVersion',
  'outboxKey',
  'intentType',
  'deliveryState',
  'attemptCount',
]);

const FIXED_REASONS = Object.freeze({
  APPLIED: 'transition_applied',
  SAME_STATE: 'same_state',
  FORBIDDEN: 'transition_forbidden',
  UNKNOWN_STATE: 'unknown_state',
  INVALID_RECORD: 'invalid_record',
  INVALID_VERSION: 'invalid_version',
  INVALID_OUTBOX_KEY: 'invalid_outbox_key',
  INVALID_INTENT_TYPE: 'invalid_intent_type',
  INVALID_ATTEMPT: 'invalid_attempt',
  ATTEMPT_NOT_MONOTONIC: 'attempt_not_monotonic',
  ATTEMPT_STATE_MISMATCH: 'attempt_state_mismatch',
});

function frozenReasons(reasons) {
  return Object.freeze([...new Set(reasons)].sort());
}

function isOpaqueIdentifier(value) {
  return typeof value === 'string' && OPAQUE_IDENTIFIER_PATTERN.test(value);
}

function validAttempt(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

// The attempt counter is pinned to lifecycle position: nothing has been attempted
// while queued, and every other state follows at least one begun attempt.
function coherentAttempt(deliveryState, attemptCount) {
  if (deliveryState === 'queued') return attemptCount === 0;
  return attemptCount >= 1;
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

function readDeliveryPair(value) {
  const entries = safeOwnData(value, 2);
  if (!entries
    || entries.size !== 2
    || !entries.has('deliveryState')
    || !entries.has('attemptCount')) {
    return null;
  }
  return {
    deliveryState: entries.get('deliveryState'),
    attemptCount: entries.get('attemptCount'),
  };
}

function deliveryResult(accepted, outcome, changed, state, attemptCount, reason) {
  return Object.freeze({
    accepted,
    outcome,
    changed,
    state,
    attemptCount,
    reason,
  });
}

function reduceOutboxDelivery(current, next) {
  const currentPair = readDeliveryPair(current);
  const nextPair = readDeliveryPair(next);
  if (!currentPair || !nextPair) {
    return deliveryResult(false, 'rejected', false, null, null, FIXED_REASONS.INVALID_RECORD);
  }

  const currentKnown = DELIVERY_STATES.has(currentPair.deliveryState);
  const nextKnown = DELIVERY_STATES.has(nextPair.deliveryState);
  if (!currentKnown || !nextKnown) {
    return deliveryResult(
      false,
      'rejected',
      false,
      currentKnown ? currentPair.deliveryState : null,
      null,
      FIXED_REASONS.UNKNOWN_STATE,
    );
  }

  if (!validAttempt(currentPair.attemptCount) || !validAttempt(nextPair.attemptCount)) {
    return deliveryResult(
      false,
      'rejected',
      false,
      currentPair.deliveryState,
      null,
      FIXED_REASONS.INVALID_ATTEMPT,
    );
  }

  if (!coherentAttempt(currentPair.deliveryState, currentPair.attemptCount)
    || !coherentAttempt(nextPair.deliveryState, nextPair.attemptCount)) {
    return deliveryResult(
      false,
      'rejected',
      false,
      currentPair.deliveryState,
      currentPair.attemptCount,
      FIXED_REASONS.ATTEMPT_STATE_MISMATCH,
    );
  }

  if (currentPair.deliveryState === nextPair.deliveryState) {
    if (nextPair.attemptCount !== currentPair.attemptCount) {
      return deliveryResult(
        false,
        'rejected',
        false,
        currentPair.deliveryState,
        currentPair.attemptCount,
        FIXED_REASONS.ATTEMPT_NOT_MONOTONIC,
      );
    }
    return deliveryResult(
      true,
      'unchanged',
      false,
      currentPair.deliveryState,
      currentPair.attemptCount,
      FIXED_REASONS.SAME_STATE,
    );
  }

  if ((DELIVERY_TRANSITIONS[currentPair.deliveryState] || []).includes(nextPair.deliveryState)) {
    const expectedDelta = ATTEMPT_START_STATES.has(nextPair.deliveryState) ? 1 : 0;
    if (nextPair.attemptCount !== currentPair.attemptCount + expectedDelta) {
      return deliveryResult(
        false,
        'rejected',
        false,
        currentPair.deliveryState,
        currentPair.attemptCount,
        FIXED_REASONS.ATTEMPT_NOT_MONOTONIC,
      );
    }
    return deliveryResult(
      true,
      'applied',
      true,
      nextPair.deliveryState,
      nextPair.attemptCount,
      FIXED_REASONS.APPLIED,
    );
  }

  return deliveryResult(
    false,
    'rejected',
    false,
    currentPair.deliveryState,
    currentPair.attemptCount,
    FIXED_REASONS.FORBIDDEN,
  );
}

function validationResult(accepted, status, reasons, projection) {
  return Object.freeze({
    accepted,
    status,
    reasons: frozenReasons(reasons),
    projection,
  });
}

function validateOutboxRecord(candidate) {
  const entries = safeOwnData(candidate, EXPECTED_RECORD_KEYS.length);
  if (!entries
    || entries.size !== EXPECTED_RECORD_KEYS.length
    || !EXPECTED_RECORD_KEYS.every((key) => entries.has(key))) {
    return validationResult(false, 'rejected', [FIXED_REASONS.INVALID_RECORD], null);
  }

  const version = entries.get('outboxStateSchemaVersion');
  const outboxKey = entries.get('outboxKey');
  const intentType = entries.get('intentType');
  const deliveryState = entries.get('deliveryState');
  const attemptCount = entries.get('attemptCount');

  const reasons = [];
  if (version !== outboxStateSchemaVersion) reasons.push(FIXED_REASONS.INVALID_VERSION);
  if (!isOpaqueIdentifier(outboxKey)) reasons.push(FIXED_REASONS.INVALID_OUTBOX_KEY);
  if (!isOpaqueIdentifier(intentType)) reasons.push(FIXED_REASONS.INVALID_INTENT_TYPE);
  const stateKnown = DELIVERY_STATES.has(deliveryState);
  if (!stateKnown) reasons.push(FIXED_REASONS.UNKNOWN_STATE);
  if (!validAttempt(attemptCount)) {
    reasons.push(FIXED_REASONS.INVALID_ATTEMPT);
  } else if (stateKnown && !coherentAttempt(deliveryState, attemptCount)) {
    reasons.push(FIXED_REASONS.ATTEMPT_STATE_MISMATCH);
  }

  if (reasons.length > 0) {
    return validationResult(false, 'rejected', reasons, null);
  }

  const projection = Object.freeze({
    outboxStateSchemaVersion,
    outboxKey,
    intentType,
    deliveryState,
    attemptCount,
  });
  return validationResult(true, 'valid', [], projection);
}

module.exports = Object.freeze({
  outboxStateSchemaVersion,
  OutboxDeliveryState,
  reduceOutboxDelivery,
  validateOutboxRecord,
});
