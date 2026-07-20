const { types: { isProxy } } = require('node:util');

const eventInboxSchemaVersion = 1;
const EVENT_INBOX_ERROR_MESSAGE = 'Commerce event inbox evidence is invalid.';

const EXPECTED_FIELDS = Object.freeze([
  'eventInboxSchemaVersion',
  'priorRecord',
  'objectOrdering',
]);

const EVENT_INBOX_ENUMS = Object.freeze({
  // The durable state of the inbox record for the exact incoming event id.
  // `absent` is a genuinely first-seen delivery; every other value means a
  // record for this exact id already exists.
  priorRecord: Object.freeze([
    // No inbox record for this event id yet — first delivery.
    'absent',
    // A record was claimed but processing did not finish (a crash mid-flight);
    // the canonical apply is idempotent, so reprocessing is safe.
    'pending',
    // This event id was already fully processed — exactly-once boundary.
    'applied',
    // This event id was already decided a deliberate no-op (duplicate/stale).
    'ignored',
    // This event id was set aside for manual reconciliation.
    'quarantined',
  ]),
  // How the incoming event's position relates to the last-applied event for the
  // same business object. The event source does not guarantee order, so this is
  // supplied as evidence from current domain state; it is never derived here.
  objectOrdering: Object.freeze([
    // No event has been applied for this object yet.
    'first_for_object',
    // The incoming event is strictly newer than the last-applied state.
    'advances',
    // The incoming event is at the same object position already applied.
    'equal',
    // The incoming event is strictly older; a newer state was already applied.
    'stale',
    // The relative order cannot be established — fail closed.
    'indeterminate',
  ]),
  // Output-only dispositions.
  disposition: Object.freeze([
    'process',
    'reprocess_incomplete',
    'ignore_duplicate',
    'ignore_stale',
    'quarantine',
  ]),
});

// Only the input enums are validated against the incoming evidence.
const ENUM_SETS = Object.freeze({
  priorRecord: new Set(EVENT_INBOX_ENUMS.priorRecord),
  objectOrdering: new Set(EVENT_INBOX_ENUMS.objectOrdering),
});

class CommerceEventInboxError extends Error {
  constructor() {
    super(EVENT_INBOX_ERROR_MESSAGE);
    Object.defineProperty(this, 'name', {
      value: 'CommerceEventInboxError',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'message', {
      value: EVENT_INBOX_ERROR_MESSAGE,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'code', {
      value: 'invalid_event_inbox_evidence',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Error.captureStackTrace?.(this, CommerceEventInboxError);
    Object.freeze(this);
  }
}

function fail() {
  throw new CommerceEventInboxError();
}

function readExactEvidence(value) {
  if (value === null || typeof value !== 'object' || isProxy(value)) fail();

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail();
  }

  if (prototype !== Object.prototype || keys.length !== EXPECTED_FIELDS.length) fail();

  const keySet = new Set();
  for (const key of keys) {
    if (typeof key !== 'string' || keySet.has(key)) fail();
    keySet.add(key);
  }
  if (EXPECTED_FIELDS.some((field) => !keySet.has(field))) fail();

  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail();
  }

  const evidence = Object.create(null);
  for (const field of EXPECTED_FIELDS) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, field);
    } catch {
      fail();
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined) {
      fail();
    }
    evidence[field] = descriptor.value;
  }

  if (evidence.eventInboxSchemaVersion !== eventInboxSchemaVersion) fail();

  for (const [field, allowedValues] of Object.entries(ENUM_SETS)) {
    if (!allowedValues.has(evidence[field])) fail();
  }

  return evidence;
}

function frozenDisposition(disposition, appliesEffect) {
  return Object.freeze({
    eventInboxSchemaVersion,
    disposition,
    // True only when the deferred worker should apply canonical/provider
    // business effects for this event; every ignore/quarantine verdict is
    // false, so a duplicate, stale, or unorderable event never re-applies.
    appliesEffect,
  });
}

const RESULTS = Object.freeze({
  process: frozenDisposition('process', true),
  reprocessIncomplete: frozenDisposition('reprocess_incomplete', true),
  ignoreDuplicate: frozenDisposition('ignore_duplicate', false),
  ignoreStale: frozenDisposition('ignore_stale', false),
  quarantine: frozenDisposition('quarantine', false),
});

function classifyEventInboxDisposition(input) {
  const { priorRecord, objectOrdering } = readExactEvidence(input);

  // 1. Exactly-once boundary: an event id already fully applied, or already
  //    decided a deliberate no-op, is never acted on again — even if fresh
  //    ordering evidence looks newer. The event id is the idempotency key.
  if (priorRecord === 'applied' || priorRecord === 'ignored') {
    return RESULTS.ignoreDuplicate;
  }

  // 2. A quarantined record stays parked for manual reconciliation; new
  //    ordering evidence never auto-releases it.
  if (priorRecord === 'quarantined') {
    return RESULTS.quarantine;
  }

  // 3. Order that cannot be established fails closed — never apply on a guess.
  if (objectOrdering === 'indeterminate') {
    return RESULTS.quarantine;
  }

  // 4. A strictly older event carries no new truth; a newer object state was
  //    already applied, so drop it.
  if (objectOrdering === 'stale') {
    return RESULTS.ignoreStale;
  }

  // 5. An event at the same object position already applied is an idempotent
  //    replay (possibly under a different event id) — no new effect.
  if (objectOrdering === 'equal') {
    return RESULTS.ignoreDuplicate;
  }

  // 6. Fresh (`first_for_object` or `advances`) and not yet applied. A pending
  //    record means a prior attempt began but did not finish; because the
  //    canonical apply is idempotent, reprocessing it is safe. An absent record
  //    is a clean first-seen delivery.
  return priorRecord === 'pending' ? RESULTS.reprocessIncomplete : RESULTS.process;
}

Object.freeze(CommerceEventInboxError.prototype);
Object.freeze(CommerceEventInboxError);

module.exports = Object.freeze({
  eventInboxSchemaVersion,
  EVENT_INBOX_ENUMS,
  CommerceEventInboxError,
  classifyEventInboxDisposition,
});
