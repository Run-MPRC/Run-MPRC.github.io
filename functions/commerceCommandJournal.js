const { createHash } = require('node:crypto');
const { types: { isProxy } } = require('node:util');
const { Timestamp } = require('firebase-admin/firestore');

const {
  commandIdentityVersion,
  CommandIdentityError,
  createCommandKey,
  createPayloadFingerprint,
  createStripeIdempotencyKey,
} = require('./commerceCommandIdentity');
const {
  reconciliationPolicySchemaVersion,
  CommerceProviderReconciliationError,
  classifyInitialStripeReconciliation,
} = require('./commerceProviderReconciliation');

const journalSchemaVersion = 1;
const auditSchemaVersion = 1;
const lifecycleSchemaVersion = 1;
const lifecycleAuditSchemaVersion = 2;
const providerPlanSchemaVersion = 1;
const providerPlanAuditSchemaVersion = 1;
const providerSendEvidenceSchemaVersion = 1;
const providerSendAuditSchemaVersion = 1;
const providerReconciliationEvidenceSchemaVersion = 1;
const providerReconciliationAuditSchemaVersion = 1;
const providerAttemptAuthorizationSchemaVersion = 1;
const providerAttemptAuthorizationAuditSchemaVersion = 1;
const MAXIMUM_ENDPOINT_SCHEMA_VERSION = 1000000;
const MAXIMUM_LIFECYCLE_NUMBER = 9999999999;
const LEASE_DURATION_SECONDS = 60;
const PROVIDER_SEND_RETRY_WINDOW_SECONDS = 23 * 60 * 60;
const TRANSACTION_OPTIONS = Object.freeze({ maxAttempts: 10 });
const COMMAND_COLLECTION = 'checkoutRequests';
const AUDIT_COLLECTION = 'auditEvents';
const LIFECYCLE_COLLECTION = 'lifecycle';
const LIFECYCLE_DOCUMENT = 'current';
const PROVIDER_ATTEMPTS_COLLECTION = 'providerAttempts';
const INITIAL_PROVIDER_ATTEMPT_DOCUMENT = '0000000001';
const SEND_EVIDENCE_COLLECTION = 'sendEvidence';
const INITIAL_SEND_EVIDENCE_DOCUMENT = 'first';
const RECONCILIATION_EVIDENCE_COLLECTION = 'reconciliationEvidence';
const INITIAL_RECONCILIATION_EVIDENCE_DOCUMENT = '0000000001';
const NEXT_ATTEMPT_AUTHORIZATION_COLLECTION = 'nextAttemptAuthorizations';
const NEXT_PROVIDER_ATTEMPT_DOCUMENT = '0000000002';
const COMMAND_STATE = 'registered';
const COMMAND_REVISION = 1;
const INITIAL_PROVIDER_ATTEMPT = 1;
const NEXT_PROVIDER_ATTEMPT = 2;
const PROVIDER_PARAMETERS_COMMAND_TYPE = 'stripe.provider.parameters';
const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;
const CANONICAL_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_COMMAND_TYPE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const SAFE_STRIPE_ACCOUNT_ID = /^acct_[A-Za-z0-9]{16,64}$/;
const SAFE_STRIPE_API_VERSION = /^(20\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])(?:\.([a-z][a-z0-9]{0,31}))?$/;
const LIFECYCLE_STATES = new Set(['leased', 'succeeded', 'failed_final']);
const HASH_MAGIC = 'mprc-commerce-command-journal-sha256';
const HASH_DOMAINS = Object.freeze({
  leaseOwner: 'mprc.command-lease-owner.v1',
  terminalCommitment: 'mprc.command-terminal-commitment.v1',
  stripeAccount: 'mprc.command-provider-plan-stripe-account.v1',
  stripeParameters: 'mprc.command-provider-plan-stripe-parameters.v1',
  stripeIdempotencyKey: 'mprc.command-provider-plan-stripe-idempotency-key.v1',
  providerPlan: 'mprc.command-provider-plan-complete.v1',
  providerSendEvidence: 'mprc.command-provider-send-evidence-complete.v1',
  providerReconciliationEvidence: (
    'mprc.command-provider-reconciliation-evidence-complete.v1'
  ),
  transitionRecord: 'mprc.command-provider-transition-record.v1',
  providerAttemptAuthorization: 'mprc.command-provider-attempt-authorization-complete.v1',
});
const ENVIRONMENTS = new Set(['local', 'test', 'staging', 'production']);
const STRIPE_MODES = new Set(['test', 'live']);
const STRIPE_ENDPOINT_BY_OPERATION = Object.freeze({
  checkout_session_create: '/v1/checkout/sessions',
});
const CALLER_SCOPE_KINDS = new Set([
  'firebase_uid',
  'anonymous_principal',
  'internal_system',
]);

const INPUT_FIELDS = Object.freeze([
  'db',
  'environment',
  'callerScope',
  'commandId',
  'commandType',
  'endpointSchemaVersion',
  'payload',
]);
const ACQUIRE_INPUT_FIELDS = Object.freeze([...INPUT_FIELDS, 'leaseId']);
const COMPLETE_INPUT_FIELDS = Object.freeze([
  ...ACQUIRE_INPUT_FIELDS,
  'expectedFenceEpoch',
  'terminalReferenceFingerprint',
]);
const FAIL_INPUT_FIELDS = Object.freeze([
  ...ACQUIRE_INPUT_FIELDS,
  'expectedFenceEpoch',
]);
const BIND_PROVIDER_PLAN_INPUT_FIELDS = Object.freeze([
  ...ACQUIRE_INPUT_FIELDS,
  'expectedFenceEpoch',
  'stripeAccountId',
  'stripeMode',
  'stripeApiVersion',
  'endpointPath',
  'providerOperation',
  'providerParameters',
]);
const RECORD_PROVIDER_RECONCILIATION_INPUT_FIELDS = Object.freeze([
  ...INPUT_FIELDS,
  'stripeAccountId',
  'stripeMode',
  'stripeApiVersion',
  'endpointPath',
  'providerOperation',
  'providerParameters',
  'reconciliationEvidence',
]);
const AUTHORIZE_NEXT_PROVIDER_ATTEMPT_INPUT_FIELDS = Object.freeze([
  ...BIND_PROVIDER_PLAN_INPUT_FIELDS,
  'reconciliationEvidence',
  'transitionAuthorization',
]);
const RECONCILIATION_EVIDENCE_INPUT_FIELDS = Object.freeze([
  'reconciliationPolicySchemaVersion',
  'provider',
  'providerAttempt',
  'planBinding',
  'evidenceSource',
  'evidenceCompleteness',
  'dispatchEvidence',
  'responseEvidence',
  'idempotencyEvidence',
  'providerObjectEvidence',
  'paymentEvidence',
  'eventEvidence',
  'searchEvidence',
  'businessTransitionEvidence',
]);
const TRANSITION_AUTHORIZATION_INPUT_FIELDS = Object.freeze([
  'kind',
  'recordCommitment',
]);
const CALLER_SCOPE_FIELDS = Object.freeze(['kind', 'value']);
const COMMAND_FIELDS = Object.freeze([
  'journalSchemaVersion',
  'commandIdentityVersion',
  'endpointSchemaVersion',
  'environment',
  'callerScopeKind',
  'commandType',
  'payloadFingerprint',
  'state',
  'revision',
  'createdAt',
  'updatedAt',
]);
const AUDIT_FIELDS = Object.freeze([
  'auditSchemaVersion',
  'aggregateType',
  'commandKeyHash',
  'commandRevision',
  'eventType',
  'fromState',
  'toState',
  'environment',
  'callerScopeKind',
  'commandType',
  'occurredAt',
]);
const LIFECYCLE_FIELDS = Object.freeze([
  'lifecycleSchemaVersion',
  'commandKeyHash',
  'state',
  'commandRevision',
  'fenceEpoch',
  'leaseOwnerFingerprint',
  'leaseAcquiredAt',
  'leaseExpiresAt',
  'createdAt',
  'updatedAt',
  'terminalCommitmentKind',
  'terminalCommitmentHash',
]);
const LIFECYCLE_AUDIT_FIELDS = Object.freeze([
  'auditSchemaVersion',
  'aggregateType',
  'commandKeyHash',
  'commandRevision',
  'eventType',
  'fromState',
  'toState',
  'environment',
  'callerScopeKind',
  'commandType',
  'fenceEpoch',
  'leaseExpiresAt',
  'occurredAt',
]);
const PROVIDER_PLAN_FIELDS = Object.freeze([
  'providerPlanSchemaVersion',
  'commandIdentityVersion',
  'commandKeyHash',
  'environment',
  'provider',
  'providerAttempt',
  'providerOperation',
  'stripeMode',
  'stripeAccountFingerprint',
  'stripeApiVersion',
  'httpMethod',
  'endpointPath',
  'parametersFingerprint',
  'idempotencyKeyFingerprint',
  'boundFenceEpoch',
  'boundAt',
]);
const PROVIDER_PLAN_AUDIT_FIELDS = Object.freeze([
  'providerPlanAuditSchemaVersion',
  'aggregateType',
  'commandKeyHash',
  'providerAttempt',
  'eventType',
  'provider',
  'environment',
  'stripeMode',
  'providerOperation',
  'boundFenceEpoch',
  'occurredAt',
]);
const PROVIDER_SEND_FIELDS = Object.freeze([
  'providerSendEvidenceSchemaVersion',
  'providerPlanSchemaVersion',
  'commandIdentityVersion',
  'commandKeyHash',
  'providerAttempt',
  'provider',
  'providerPlanCommitment',
  'prePostFenceEpoch',
  'prePostRecordedAt',
  'automaticRetryDeadlineAt',
]);
const PROVIDER_SEND_AUDIT_FIELDS = Object.freeze([
  'providerSendAuditSchemaVersion',
  'aggregateType',
  'commandKeyHash',
  'providerAttempt',
  'eventType',
  'provider',
  'environment',
  'stripeMode',
  'providerOperation',
  'providerPlanCommitment',
  'prePostFenceEpoch',
  'automaticRetryDeadlineAt',
  'occurredAt',
]);
const PROVIDER_RECONCILIATION_FIELDS = Object.freeze([
  'providerReconciliationEvidenceSchemaVersion',
  'reconciliationPolicySchemaVersion',
  'providerPlanSchemaVersion',
  'providerSendEvidenceSchemaVersion',
  'commandIdentityVersion',
  'commandKeyHash',
  'providerAttempt',
  'provider',
  'evidenceRevision',
  'providerPlanCommitment',
  'providerSendEvidenceCommitment',
  'classification',
  'state',
  'planBinding',
  'evidenceSource',
  'evidenceCompleteness',
  'dispatchEvidence',
  'responseEvidence',
  'idempotencyEvidence',
  'providerObjectEvidence',
  'paymentEvidence',
  'eventEvidence',
  'searchEvidence',
  'businessTransitionEvidence',
  'observedFenceEpoch',
  'observedLeaseExpiresAt',
  'recordedAt',
]);
const PROVIDER_RECONCILIATION_AUDIT_FIELDS = Object.freeze([
  'providerReconciliationAuditSchemaVersion',
  'providerReconciliationEvidenceSchemaVersion',
  'aggregateType',
  'commandKeyHash',
  'providerAttempt',
  'evidenceRevision',
  'eventType',
  'provider',
  'environment',
  'stripeMode',
  'providerOperation',
  'providerPlanCommitment',
  'providerSendEvidenceCommitment',
  'reconciliationPolicySchemaVersion',
  'classification',
  'observedFenceEpoch',
  'observedLeaseExpiresAt',
  'reconciliationEvidenceCommitment',
  'occurredAt',
]);
const PROVIDER_ATTEMPT_AUTHORIZATION_FIELDS = Object.freeze([
  'providerAttemptAuthorizationSchemaVersion',
  'providerPlanSchemaVersion',
  'providerSendEvidenceSchemaVersion',
  'providerReconciliationEvidenceSchemaVersion',
  'reconciliationPolicySchemaVersion',
  'commandIdentityVersion',
  'commandKeyHash',
  'provider',
  'previousProviderAttempt',
  'authorizedProviderAttempt',
  'authorizationRevision',
  'environment',
  'stripeMode',
  'providerOperation',
  'providerPlanCommitment',
  'providerSendEvidenceCommitment',
  'providerReconciliationEvidenceCommitment',
  'transitionKind',
  'transitionRecordCommitment',
  'idempotencyKeyFingerprint',
  'authorizedFenceEpoch',
  'authorizedAt',
]);
const PROVIDER_ATTEMPT_AUTHORIZATION_AUDIT_FIELDS = Object.freeze([
  'providerAttemptAuthorizationAuditSchemaVersion',
  'providerAttemptAuthorizationSchemaVersion',
  'providerPlanSchemaVersion',
  'providerSendEvidenceSchemaVersion',
  'aggregateType',
  'commandKeyHash',
  'previousProviderAttempt',
  'authorizedProviderAttempt',
  'authorizationRevision',
  'eventType',
  'provider',
  'environment',
  'stripeMode',
  'providerOperation',
  'providerPlanCommitment',
  'providerSendEvidenceCommitment',
  'providerReconciliationEvidenceCommitment',
  'transitionKind',
  'transitionRecordCommitment',
  'idempotencyKeyFingerprint',
  'authorizedFenceEpoch',
  'providerAttemptAuthorizationCommitment',
  'occurredAt',
]);

const ERROR_MESSAGES = Object.freeze({
  invalid_command_input: 'Commerce command journal input is invalid.',
  command_conflict: 'Commerce command conflicts with an existing command.',
  command_not_registered: 'Commerce command is not registered.',
  journal_record_invalid: 'Commerce command journal record is invalid.',
  lease_stale: 'Commerce command lease is no longer current.',
  terminal_conflict: 'Commerce command terminal state conflicts with this request.',
  journal_unavailable: 'Commerce command journal is unavailable.',
});

class CommerceCommandJournalError extends Error {
  constructor(reason) {
    const safeReason = Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, reason)
      ? reason
      : 'journal_unavailable';
    super(ERROR_MESSAGES[safeReason]);
    this.name = 'CommerceCommandJournalError';
    this.code = 'commerce_command_journal_error';
    this.reason = safeReason;
    Object.freeze(this);
  }
}

function reject(reason) {
  throw new CommerceCommandJournalError(reason);
}

function readExactOwnDataObject(value, expectedFields, reason) {
  if (value === null || typeof value !== 'object' || isProxy(value)) reject(reason);

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    reject(reason);
  }
  if (prototype !== Object.prototype || keys.length !== expectedFields.length) reject(reason);

  const expected = new Set(expectedFields);
  const result = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || !expected.has(key)) reject(reason);
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      reject(reason);
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined) {
      reject(reason);
    }
    result[key] = descriptor.value;
  }
  if (expectedFields.some((field) => !Object.prototype.hasOwnProperty.call(result, field))) {
    reject(reason);
  }
  return result;
}

function readExactObjectWithOptionalTimeFields(
  value,
  expectedFields,
  optionalTimeFields,
  reason,
) {
  if (value === null || typeof value !== 'object' || isProxy(value)) reject(reason);

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    reject(reason);
  }
  const expected = new Set(expectedFields);
  const optional = new Set(optionalTimeFields);
  if (prototype !== Object.prototype
    || keys.length < expectedFields.length - optionalTimeFields.length
    || keys.length > expectedFields.length) {
    reject(reason);
  }

  const result = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || !expected.has(key)) reject(reason);
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      reject(reason);
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined) {
      reject(reason);
    }
    result[key] = descriptor.value;
  }
  for (const field of expectedFields) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) {
      if (!optional.has(field)) reject(reason);
      result[field] = null;
    }
  }
  return result;
}

function readTimestamp(value) {
  if (value === null || typeof value !== 'object' || isProxy(value)) return null;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (prototype !== Timestamp.prototype
    || keys.length !== 2
    || !keys.includes('_seconds')
    || !keys.includes('_nanoseconds')) {
    return null;
  }

  const values = Object.create(null);
  for (const key of keys) {
    if (key !== '_seconds' && key !== '_nanoseconds') return null;
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
    values[key] = descriptor.value;
  }

  const seconds = values._seconds;
  const nanoseconds = values._nanoseconds;
  if (!Number.isSafeInteger(seconds)
    || seconds < -62135596800
    || seconds > 253402300799
    || !Number.isSafeInteger(nanoseconds)
    || nanoseconds < 0
    || nanoseconds > 999999999) {
    return null;
  }
  return Object.freeze({ seconds, nanoseconds });
}

function timestampsEqual(first, second) {
  return first !== null
    && second !== null
    && first.seconds === second.seconds
    && first.nanoseconds === second.nanoseconds;
}

function compareTimestamps(first, second) {
  if (first.seconds !== second.seconds) return first.seconds < second.seconds ? -1 : 1;
  if (first.nanoseconds !== second.nanoseconds) {
    return first.nanoseconds < second.nanoseconds ? -1 : 1;
  }
  return 0;
}

function timestampExactlySecondsAfter(later, earlier, seconds) {
  return later.seconds === earlier.seconds + seconds
    && later.nanoseconds === earlier.nanoseconds;
}

function captureTrustedTimestamp() {
  let timestamp;
  try {
    timestamp = Timestamp.now();
  } catch {
    reject('journal_unavailable');
  }
  if (readTimestamp(timestamp) === null) reject('journal_unavailable');
  try {
    Object.freeze(timestamp);
  } catch {
    reject('journal_unavailable');
  }
  return timestamp;
}

function addTimestampSeconds(timestamp, seconds) {
  const parts = readTimestamp(timestamp);
  if (!Number.isSafeInteger(seconds)
    || seconds < 1
    || parts === null
    || parts.seconds > 253402300799 - seconds) {
    reject('journal_unavailable');
  }
  let expiresAt;
  try {
    expiresAt = new Timestamp(
      parts.seconds + seconds,
      parts.nanoseconds,
    );
    Object.freeze(expiresAt);
  } catch {
    reject('journal_unavailable');
  }
  return expiresAt;
}

function addLeaseDuration(timestamp) {
  return addTimestampSeconds(timestamp, LEASE_DURATION_SECONDS);
}

function addProviderSendRetryWindow(timestamp) {
  return addTimestampSeconds(timestamp, PROVIDER_SEND_RETRY_WINDOW_SECONDS);
}

function copyTimestamp(parts) {
  let timestamp;
  try {
    timestamp = new Timestamp(parts.seconds, parts.nanoseconds);
    Object.freeze(timestamp);
  } catch {
    reject('journal_unavailable');
  }
  return timestamp;
}

function unsignedLength(length) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32BE(length, 0);
  return buffer;
}

function updateLengthFramed(hash, value) {
  const bytes = Buffer.from(value, 'utf8');
  hash.update(unsignedLength(bytes.length));
  hash.update(bytes);
}

function digest(domain, fields) {
  try {
    const hash = createHash('sha256');
    updateLengthFramed(hash, HASH_MAGIC);
    updateLengthFramed(hash, domain);
    for (const [name, value] of fields) {
      updateLengthFramed(hash, name);
      updateLengthFramed(hash, value);
    }
    return hash.digest('hex');
  } catch (error) {
    if (error instanceof CommerceCommandJournalError) throw error;
    reject('journal_unavailable');
  }
}

function createLeaseOwnerFingerprint(commandKeyHash, leaseId) {
  return digest(HASH_DOMAINS.leaseOwner, [
    ['version', '1'],
    ['commandKeyHash', commandKeyHash],
    ['leaseId', leaseId],
  ]);
}

function createTerminalCommitment(commandKeyHash, terminalReferenceFingerprint) {
  return digest(HASH_DOMAINS.terminalCommitment, [
    ['version', '1'],
    ['commandKeyHash', commandKeyHash],
    ['kind', 'business_record_digest'],
    ['terminalReferenceFingerprint', terminalReferenceFingerprint],
  ]);
}

function createProviderCommitment(domain, commandKeyHash, valueName, value) {
  return digest(domain, [
    ['version', String(providerPlanSchemaVersion)],
    ['commandKeyHash', commandKeyHash],
    [valueName, value],
  ]);
}

function createCompleteProviderPlanCommitment(plan, boundAt) {
  if (boundAt === null) reject('journal_record_invalid');
  return digest(HASH_DOMAINS.providerPlan, [
    ['version', '1'],
    ['providerPlanSchemaVersion', String(plan.providerPlanSchemaVersion)],
    ['commandIdentityVersion', String(plan.commandIdentityVersion)],
    ['commandKeyHash', plan.commandKeyHash],
    ['environment', plan.environment],
    ['provider', plan.provider],
    ['providerAttempt', String(plan.providerAttempt)],
    ['providerOperation', plan.providerOperation],
    ['stripeMode', plan.stripeMode],
    ['stripeAccountFingerprint', plan.stripeAccountFingerprint],
    ['stripeApiVersion', plan.stripeApiVersion],
    ['httpMethod', plan.httpMethod],
    ['endpointPath', plan.endpointPath],
    ['parametersFingerprint', plan.parametersFingerprint],
    ['idempotencyKeyFingerprint', plan.idempotencyKeyFingerprint],
    ['boundFenceEpoch', String(plan.boundFenceEpoch)],
    ['boundAtSeconds', String(boundAt.seconds)],
    ['boundAtNanoseconds', String(boundAt.nanoseconds)],
  ]);
}

function createCompleteProviderSendEvidenceCommitment(providerSend) {
  if (providerSend.timeUnknown
    || providerSend.prePostRecordedAt === null
    || providerSend.automaticRetryDeadlineAt === null) {
    reject('journal_record_invalid');
  }
  const record = providerSend.record;
  const audit = providerSend.audit;
  return digest(HASH_DOMAINS.providerSendEvidence, [
    ['version', '1'],
    ['providerSendEvidenceSchemaVersion', String(record.providerSendEvidenceSchemaVersion)],
    ['providerPlanSchemaVersion', String(record.providerPlanSchemaVersion)],
    ['commandIdentityVersion', String(record.commandIdentityVersion)],
    ['commandKeyHash', record.commandKeyHash],
    ['providerAttempt', String(record.providerAttempt)],
    ['provider', record.provider],
    ['providerPlanCommitment', record.providerPlanCommitment],
    ['prePostFenceEpoch', String(record.prePostFenceEpoch)],
    ['prePostRecordedAtSeconds', String(providerSend.prePostRecordedAt.seconds)],
    ['prePostRecordedAtNanoseconds', String(providerSend.prePostRecordedAt.nanoseconds)],
    ['automaticRetryDeadlineAtSeconds', String(providerSend.automaticRetryDeadlineAt.seconds)],
    [
      'automaticRetryDeadlineAtNanoseconds',
      String(providerSend.automaticRetryDeadlineAt.nanoseconds),
    ],
    ['providerSendAuditSchemaVersion', String(audit.providerSendAuditSchemaVersion)],
    ['auditAggregateType', audit.aggregateType],
    ['auditCommandKeyHash', audit.commandKeyHash],
    ['auditProviderAttempt', String(audit.providerAttempt)],
    ['auditEventType', audit.eventType],
    ['auditProvider', audit.provider],
    ['auditEnvironment', audit.environment],
    ['auditStripeMode', audit.stripeMode],
    ['auditProviderOperation', audit.providerOperation],
    ['auditProviderPlanCommitment', audit.providerPlanCommitment],
    ['auditPrePostFenceEpoch', String(audit.prePostFenceEpoch)],
    ['auditOccurredAtSeconds', String(providerSend.prePostRecordedAt.seconds)],
    ['auditOccurredAtNanoseconds', String(providerSend.prePostRecordedAt.nanoseconds)],
    [
      'auditAutomaticRetryDeadlineAtSeconds',
      String(providerSend.automaticRetryDeadlineAt.seconds),
    ],
    [
      'auditAutomaticRetryDeadlineAtNanoseconds',
      String(providerSend.automaticRetryDeadlineAt.nanoseconds),
    ],
  ]);
}

function createCompleteProviderReconciliationEvidenceCommitment(
  record,
  observedLeaseExpiresAt,
  recordedAt,
) {
  if (observedLeaseExpiresAt === null || recordedAt === null) {
    reject('journal_record_invalid');
  }
  return digest(HASH_DOMAINS.providerReconciliationEvidence, [
    ['version', '1'],
    [
      'providerReconciliationEvidenceSchemaVersion',
      String(record.providerReconciliationEvidenceSchemaVersion),
    ],
    ['reconciliationPolicySchemaVersion', String(record.reconciliationPolicySchemaVersion)],
    ['providerPlanSchemaVersion', String(record.providerPlanSchemaVersion)],
    ['providerSendEvidenceSchemaVersion', String(record.providerSendEvidenceSchemaVersion)],
    ['commandIdentityVersion', String(record.commandIdentityVersion)],
    ['commandKeyHash', record.commandKeyHash],
    ['providerAttempt', String(record.providerAttempt)],
    ['provider', record.provider],
    ['evidenceRevision', String(record.evidenceRevision)],
    ['providerPlanCommitment', record.providerPlanCommitment],
    ['providerSendEvidenceCommitment', record.providerSendEvidenceCommitment],
    ['classification', record.classification],
    ['state', record.state],
    ['planBinding', record.planBinding],
    ['evidenceSource', record.evidenceSource],
    ['evidenceCompleteness', record.evidenceCompleteness],
    ['dispatchEvidence', record.dispatchEvidence],
    ['responseEvidence', record.responseEvidence],
    ['idempotencyEvidence', record.idempotencyEvidence],
    ['providerObjectEvidence', record.providerObjectEvidence],
    ['paymentEvidence', record.paymentEvidence],
    ['eventEvidence', record.eventEvidence],
    ['searchEvidence', record.searchEvidence],
    ['businessTransitionEvidence', record.businessTransitionEvidence],
    ['observedFenceEpoch', String(record.observedFenceEpoch)],
    ['observedLeaseExpiresAtSeconds', String(observedLeaseExpiresAt.seconds)],
    ['observedLeaseExpiresAtNanoseconds', String(observedLeaseExpiresAt.nanoseconds)],
    ['recordedAtSeconds', String(recordedAt.seconds)],
    ['recordedAtNanoseconds', String(recordedAt.nanoseconds)],
  ]);
}

function createTransitionRecordCommitment(commandKeyHash, transitionKind, recordCommitment) {
  return digest(HASH_DOMAINS.transitionRecord, [
    ['version', String(providerAttemptAuthorizationSchemaVersion)],
    ['commandKeyHash', commandKeyHash],
    ['transitionKind', transitionKind],
    ['recordCommitment', recordCommitment],
  ]);
}

function createCompleteProviderAttemptAuthorizationCommitment(record, authorizedAt) {
  if (authorizedAt === null) reject('journal_record_invalid');
  return digest(HASH_DOMAINS.providerAttemptAuthorization, [
    ['version', '1'],
    [
      'providerAttemptAuthorizationSchemaVersion',
      String(record.providerAttemptAuthorizationSchemaVersion),
    ],
    ['providerPlanSchemaVersion', String(record.providerPlanSchemaVersion)],
    ['providerSendEvidenceSchemaVersion', String(record.providerSendEvidenceSchemaVersion)],
    [
      'providerReconciliationEvidenceSchemaVersion',
      String(record.providerReconciliationEvidenceSchemaVersion),
    ],
    ['reconciliationPolicySchemaVersion', String(record.reconciliationPolicySchemaVersion)],
    ['commandIdentityVersion', String(record.commandIdentityVersion)],
    ['commandKeyHash', record.commandKeyHash],
    ['provider', record.provider],
    ['previousProviderAttempt', String(record.previousProviderAttempt)],
    ['authorizedProviderAttempt', String(record.authorizedProviderAttempt)],
    ['authorizationRevision', String(record.authorizationRevision)],
    ['environment', record.environment],
    ['stripeMode', record.stripeMode],
    ['providerOperation', record.providerOperation],
    ['providerPlanCommitment', record.providerPlanCommitment],
    ['providerSendEvidenceCommitment', record.providerSendEvidenceCommitment],
    [
      'providerReconciliationEvidenceCommitment',
      record.providerReconciliationEvidenceCommitment,
    ],
    ['transitionKind', record.transitionKind],
    ['transitionRecordCommitment', record.transitionRecordCommitment],
    ['idempotencyKeyFingerprint', record.idempotencyKeyFingerprint],
    ['authorizedFenceEpoch', String(record.authorizedFenceEpoch)],
    ['authorizedAtSeconds', String(authorizedAt.seconds)],
    ['authorizedAtNanoseconds', String(authorizedAt.nanoseconds)],
  ]);
}

function validStripeAccountId(value) {
  return typeof value === 'string' && SAFE_STRIPE_ACCOUNT_ID.test(value);
}

function validStripeModeForEnvironment(stripeMode, environment) {
  if (typeof stripeMode !== 'string' || !STRIPE_MODES.has(stripeMode)) return false;
  return stripeMode === (environment === 'production' ? 'live' : 'test');
}

function validStripeApiVersion(value) {
  if (typeof value !== 'string' || value.length > 64) return false;
  const match = SAFE_STRIPE_API_VERSION.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysByMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 2011 && year <= 2099 && day <= daysByMonth[month - 1];
}

function validStripeOperationEndpoint(providerOperation, endpointPath) {
  return typeof providerOperation === 'string'
    && Object.prototype.hasOwnProperty.call(
      STRIPE_ENDPOINT_BY_OPERATION,
      providerOperation,
    )
    && endpointPath === STRIPE_ENDPOINT_BY_OPERATION[providerOperation];
}

function validLifecycleNumber(value) {
  return Number.isSafeInteger(value)
    && value >= 1
    && value <= MAXIMUM_LIFECYCLE_NUMBER;
}

function expectedTransitionKindForCandidate(evidence) {
  const common = evidence.reconciliationPolicySchemaVersion
      === reconciliationPolicySchemaVersion
    && evidence.provider === 'stripe'
    && evidence.providerAttempt === INITIAL_PROVIDER_ATTEMPT
    && evidence.planBinding === 'exact'
    && evidence.evidenceCompleteness === 'complete'
    && evidence.idempotencyEvidence === 'not_relied_upon';
  if (!common) return null;

  if (evidence.evidenceSource === 'trusted_dispatch_history'
    && evidence.dispatchEvidence === 'execution_never_began'
    && evidence.responseEvidence === 'none'
    && evidence.providerObjectEvidence === 'none'
    && evidence.paymentEvidence === 'none'
    && evidence.eventEvidence === 'none'
    && evidence.searchEvidence === 'none'
    && evidence.businessTransitionEvidence === 'same_operation_eligible') {
    return 'retry_same_operation';
  }
  if (evidence.evidenceSource === 'verified_provider_and_event'
    && evidence.dispatchEvidence === 'execution_started'
    && evidence.responseEvidence === 'accepted'
    && evidence.providerObjectEvidence === 'exact_expired'
    && evidence.paymentEvidence === 'unpaid'
    && evidence.eventEvidence === 'verified_expiry'
    && evidence.searchEvidence === 'exact_lookup_complete'
    && evidence.businessTransitionEvidence === 'new_generation_eligible') {
    return 'replace_expired_unpaid';
  }
  return null;
}

function validEndpointSchemaVersion(value) {
  return Number.isSafeInteger(value)
    && value >= 1
    && value <= MAXIMUM_ENDPOINT_SCHEMA_VERSION;
}

function validCommandType(value) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 64
    && SAFE_COMMAND_TYPE.test(value);
}

function validStoredCommand(record) {
  return record.journalSchemaVersion === journalSchemaVersion
    && record.commandIdentityVersion === commandIdentityVersion
    && validEndpointSchemaVersion(record.endpointSchemaVersion)
    && typeof record.environment === 'string'
    && ENVIRONMENTS.has(record.environment)
    && typeof record.callerScopeKind === 'string'
    && CALLER_SCOPE_KINDS.has(record.callerScopeKind)
    && validCommandType(record.commandType)
    && typeof record.payloadFingerprint === 'string'
    && LOWERCASE_SHA256.test(record.payloadFingerprint)
    && record.state === COMMAND_STATE
    && record.revision === COMMAND_REVISION;
}

function validStoredAudit(record) {
  return record.auditSchemaVersion === auditSchemaVersion
    && record.aggregateType === 'commerce_command'
    && typeof record.commandKeyHash === 'string'
    && LOWERCASE_SHA256.test(record.commandKeyHash)
    && record.commandRevision === COMMAND_REVISION
    && record.eventType === 'command_registered'
    && record.fromState === null
    && record.toState === COMMAND_STATE
    && typeof record.environment === 'string'
    && ENVIRONMENTS.has(record.environment)
    && typeof record.callerScopeKind === 'string'
    && CALLER_SCOPE_KINDS.has(record.callerScopeKind)
    && validCommandType(record.commandType);
}

function validateExistingPair(commandValue, auditValue, expected) {
  const command = readExactOwnDataObject(
    commandValue,
    COMMAND_FIELDS,
    'journal_record_invalid',
  );
  const audit = readExactOwnDataObject(
    auditValue,
    AUDIT_FIELDS,
    'journal_record_invalid',
  );
  const createdAt = readTimestamp(command.createdAt);
  const updatedAt = readTimestamp(command.updatedAt);
  const occurredAt = readTimestamp(audit.occurredAt);

  if (!validStoredCommand(command)
    || !validStoredAudit(audit)
    || !timestampsEqual(createdAt, updatedAt)
    || !timestampsEqual(createdAt, occurredAt)
    || audit.commandKeyHash !== expected.commandKeyHash
    || audit.commandRevision !== command.revision
    || audit.environment !== command.environment
    || audit.callerScopeKind !== command.callerScopeKind
    || audit.commandType !== command.commandType) {
    reject('journal_record_invalid');
  }

  // Environment and caller scope are part of B1's document identity. A mismatch
  // at this derived document is corruption, not a normal command reuse conflict.
  if (command.environment !== expected.environment
    || command.callerScopeKind !== expected.callerScopeKind) {
    reject('journal_record_invalid');
  }
  if (command.commandType !== expected.commandType
    || command.endpointSchemaVersion !== expected.endpointSchemaVersion
    || command.payloadFingerprint !== expected.payloadFingerprint) {
    reject('command_conflict');
  }
  return Object.freeze({ createdAt });
}

function parseLifecycle(value, expected) {
  const record = readExactOwnDataObject(
    value,
    LIFECYCLE_FIELDS,
    'journal_record_invalid',
  );
  const createdAt = readTimestamp(record.createdAt);
  const updatedAt = readTimestamp(record.updatedAt);
  const leaseAcquiredAt = readTimestamp(record.leaseAcquiredAt);
  const leaseExpiresAt = readTimestamp(record.leaseExpiresAt);

  if (record.lifecycleSchemaVersion !== lifecycleSchemaVersion
    || record.commandKeyHash !== expected.commandKeyHash
    || typeof record.state !== 'string'
    || !LIFECYCLE_STATES.has(record.state)
    || !validLifecycleNumber(record.commandRevision)
    || record.commandRevision < 2
    || !validLifecycleNumber(record.fenceEpoch)
    || typeof record.leaseOwnerFingerprint !== 'string'
    || !LOWERCASE_SHA256.test(record.leaseOwnerFingerprint)
    || createdAt === null
    || updatedAt === null
    || leaseAcquiredAt === null
    || leaseExpiresAt === null
    || compareTimestamps(createdAt, leaseAcquiredAt) > 0
    || !timestampExactlySecondsAfter(
      leaseExpiresAt,
      leaseAcquiredAt,
      LEASE_DURATION_SECONDS,
    )) {
    reject('journal_record_invalid');
  }

  if (record.fenceEpoch === 1) {
    if (!timestampsEqual(createdAt, leaseAcquiredAt)) reject('journal_record_invalid');
  } else if (compareTimestamps(createdAt, leaseAcquiredAt) >= 0) {
    reject('journal_record_invalid');
  }

  if (record.state === 'leased') {
    if (record.commandRevision !== record.fenceEpoch + 1
      || !timestampsEqual(updatedAt, leaseAcquiredAt)
      || record.terminalCommitmentKind !== null
      || record.terminalCommitmentHash !== null) {
      reject('journal_record_invalid');
    }
  } else {
    if (record.commandRevision !== record.fenceEpoch + 2
      || compareTimestamps(updatedAt, leaseAcquiredAt) < 0
      || compareTimestamps(updatedAt, leaseExpiresAt) >= 0) {
      reject('journal_record_invalid');
    }
    if (record.state === 'succeeded') {
      if (record.terminalCommitmentKind !== 'business_record_digest'
        || typeof record.terminalCommitmentHash !== 'string'
        || !LOWERCASE_SHA256.test(record.terminalCommitmentHash)) {
        reject('journal_record_invalid');
      }
    } else if (record.terminalCommitmentKind !== null
      || record.terminalCommitmentHash !== null) {
      reject('journal_record_invalid');
    }
  }

  return Object.freeze({
    record,
    createdAt,
    updatedAt,
    leaseAcquiredAt,
    leaseExpiresAt,
  });
}

function validateLifecycleAudit(value, lifecycle, expected) {
  const audit = readExactOwnDataObject(
    value,
    LIFECYCLE_AUDIT_FIELDS,
    'journal_record_invalid',
  );
  const leaseExpiresAt = readTimestamp(audit.leaseExpiresAt);
  const occurredAt = readTimestamp(audit.occurredAt);

  let expectedEvent;
  let expectedFromState;
  if (lifecycle.record.state === 'leased') {
    expectedEvent = lifecycle.record.fenceEpoch === 1
      ? 'command_lease_acquired'
      : 'command_lease_taken_over';
    expectedFromState = lifecycle.record.fenceEpoch === 1 ? 'registered' : 'leased';
  } else if (lifecycle.record.state === 'succeeded') {
    expectedEvent = 'command_succeeded';
    expectedFromState = 'leased';
  } else {
    expectedEvent = 'command_failed_final';
    expectedFromState = 'leased';
  }

  if (audit.auditSchemaVersion !== lifecycleAuditSchemaVersion
    || audit.aggregateType !== 'commerce_command'
    || audit.commandKeyHash !== expected.commandKeyHash
    || audit.commandRevision !== lifecycle.record.commandRevision
    || audit.eventType !== expectedEvent
    || audit.fromState !== expectedFromState
    || audit.toState !== lifecycle.record.state
    || audit.environment !== expected.environment
    || audit.callerScopeKind !== expected.callerScopeKind
    || audit.commandType !== expected.commandType
    || audit.fenceEpoch !== lifecycle.record.fenceEpoch
    || !timestampsEqual(leaseExpiresAt, lifecycle.leaseExpiresAt)
    || !timestampsEqual(occurredAt, lifecycle.updatedAt)) {
    reject('journal_record_invalid');
  }
}

function auditDocumentId(commandKeyHash, revision) {
  if (!validLifecycleNumber(revision)) reject('journal_record_invalid');
  return `commerce_command_${commandKeyHash}_${String(revision).padStart(10, '0')}`;
}

function providerPlanAuditDocumentId(commandKeyHash) {
  if (typeof commandKeyHash !== 'string' || !LOWERCASE_SHA256.test(commandKeyHash)) {
    reject('journal_record_invalid');
  }
  return `commerce_provider_attempt_${commandKeyHash}_${INITIAL_PROVIDER_ATTEMPT_DOCUMENT}`;
}

function providerSendAuditDocumentId(commandKeyHash) {
  if (typeof commandKeyHash !== 'string' || !LOWERCASE_SHA256.test(commandKeyHash)) {
    reject('journal_record_invalid');
  }
  return `commerce_provider_send_${commandKeyHash}_${INITIAL_PROVIDER_ATTEMPT_DOCUMENT}`;
}

function providerReconciliationAuditDocumentId(commandKeyHash) {
  if (typeof commandKeyHash !== 'string' || !LOWERCASE_SHA256.test(commandKeyHash)) {
    reject('journal_record_invalid');
  }
  return (
    `commerce_provider_reconciliation_${commandKeyHash}`
    + `_${INITIAL_PROVIDER_ATTEMPT_DOCUMENT}_0000000001`
  );
}

function providerAttemptAuthorizationAuditDocumentId(commandKeyHash) {
  if (typeof commandKeyHash !== 'string' || !LOWERCASE_SHA256.test(commandKeyHash)) {
    reject('journal_record_invalid');
  }
  return (
    `commerce_provider_authorization_${commandKeyHash}`
    + `_${INITIAL_PROVIDER_ATTEMPT_DOCUMENT}_0000000001_${NEXT_PROVIDER_ATTEMPT_DOCUMENT}`
  );
}

function prepareIdentity(input, fields) {
  let values;
  let commandKey;
  let fingerprint;
  let callerScopeKind;
  try {
    values = readExactOwnDataObject(input, fields, 'invalid_command_input');
    if (!validEndpointSchemaVersion(values.endpointSchemaVersion)) {
      reject('invalid_command_input');
    }
    commandKey = createCommandKey({
      environment: values.environment,
      callerScope: values.callerScope,
      commandId: values.commandId,
    });
    fingerprint = createPayloadFingerprint({
      commandType: values.commandType,
      payload: values.payload,
    });
    const scope = readExactOwnDataObject(
      values.callerScope,
      CALLER_SCOPE_FIELDS,
      'invalid_command_input',
    );
    callerScopeKind = scope.kind;
  } catch (error) {
    if (error instanceof CommerceCommandJournalError) throw error;
    if (error instanceof CommandIdentityError) reject('invalid_command_input');
    reject('journal_unavailable');
  }

  return Object.freeze({
    values,
    commandKeyHash: commandKey.commandKeyHash,
    callerScopeKind,
    expected: Object.freeze({
      commandKeyHash: commandKey.commandKeyHash,
      endpointSchemaVersion: values.endpointSchemaVersion,
      environment: values.environment,
      callerScopeKind,
      commandType: values.commandType,
      payloadFingerprint: fingerprint.payloadFingerprint,
    }),
  });
}

function prepareLifecycleOperation(input, fields, operation) {
  const identity = prepareIdentity(input, fields);
  const { values } = identity;

  if (typeof values.leaseId !== 'string'
    || !CANONICAL_UUID_V4.test(values.leaseId)
    || values.leaseId === values.commandId) {
    reject('invalid_command_input');
  }
  if (operation !== 'acquire' && !validLifecycleNumber(values.expectedFenceEpoch)) {
    reject('invalid_command_input');
  }
  if (operation === 'complete'
    && (typeof values.terminalReferenceFingerprint !== 'string'
      || !LOWERCASE_SHA256.test(values.terminalReferenceFingerprint))) {
    reject('invalid_command_input');
  }

  let commandRef;
  let registrationAuditRef;
  let lifecycleRef;
  try {
    commandRef = values.db.collection(COMMAND_COLLECTION).doc(identity.commandKeyHash);
    registrationAuditRef = values.db.collection(AUDIT_COLLECTION).doc(
      auditDocumentId(identity.commandKeyHash, COMMAND_REVISION),
    );
    lifecycleRef = commandRef.collection(LIFECYCLE_COLLECTION).doc(LIFECYCLE_DOCUMENT);
  } catch (error) {
    if (error instanceof CommerceCommandJournalError) throw error;
    reject('journal_unavailable');
  }

  const occurredAt = captureTrustedTimestamp();
  const leaseOwnerFingerprint = createLeaseOwnerFingerprint(
    identity.commandKeyHash,
    values.leaseId,
  );
  const terminalCommitmentHash = operation === 'complete'
    ? createTerminalCommitment(
      identity.commandKeyHash,
      values.terminalReferenceFingerprint,
    )
    : null;

  return Object.freeze({
    ...identity,
    commandRef,
    registrationAuditRef,
    lifecycleRef,
    occurredAt,
    occurredAtParts: readTimestamp(occurredAt),
    proposedLeaseExpiresAt: operation === 'acquire' ? addLeaseDuration(occurredAt) : null,
    leaseOwnerFingerprint,
    terminalCommitmentHash,
  });
}

function prepareProviderPlanOperation(input) {
  const identity = prepareIdentity(input, BIND_PROVIDER_PLAN_INPUT_FIELDS);
  const { values } = identity;

  if (typeof values.leaseId !== 'string'
    || !CANONICAL_UUID_V4.test(values.leaseId)
    || values.leaseId === values.commandId
    || !validLifecycleNumber(values.expectedFenceEpoch)
    || !validStripeAccountId(values.stripeAccountId)
    || !validStripeModeForEnvironment(values.stripeMode, values.environment)
    || !validStripeApiVersion(values.stripeApiVersion)
    || !validStripeOperationEndpoint(values.providerOperation, values.endpointPath)) {
    reject('invalid_command_input');
  }

  let canonicalParametersFingerprint;
  let stripeIdempotencyKey;
  try {
    canonicalParametersFingerprint = createPayloadFingerprint({
      commandType: PROVIDER_PARAMETERS_COMMAND_TYPE,
      payload: values.providerParameters,
    }).payloadFingerprint;
    stripeIdempotencyKey = createStripeIdempotencyKey({
      stripeMode: values.stripeMode,
      environment: values.environment,
      providerOperation: values.providerOperation,
      commandKeyHash: identity.commandKeyHash,
      providerAttempt: INITIAL_PROVIDER_ATTEMPT,
    }).stripeIdempotencyKey;
  } catch (error) {
    if (error instanceof CommandIdentityError) reject('invalid_command_input');
    if (error instanceof CommerceCommandJournalError) throw error;
    reject('journal_unavailable');
  }

  let commandRef;
  let registrationAuditRef;
  let lifecycleRef;
  let providerPlanRef;
  let providerPlanAuditRef;
  try {
    commandRef = values.db.collection(COMMAND_COLLECTION).doc(identity.commandKeyHash);
    registrationAuditRef = values.db.collection(AUDIT_COLLECTION).doc(
      auditDocumentId(identity.commandKeyHash, COMMAND_REVISION),
    );
    lifecycleRef = commandRef.collection(LIFECYCLE_COLLECTION).doc(LIFECYCLE_DOCUMENT);
    providerPlanRef = commandRef.collection(PROVIDER_ATTEMPTS_COLLECTION).doc(
      INITIAL_PROVIDER_ATTEMPT_DOCUMENT,
    );
    providerPlanAuditRef = values.db.collection(AUDIT_COLLECTION).doc(
      providerPlanAuditDocumentId(identity.commandKeyHash),
    );
  } catch (error) {
    if (error instanceof CommerceCommandJournalError) throw error;
    reject('journal_unavailable');
  }

  const occurredAt = captureTrustedTimestamp();
  const leaseOwnerFingerprint = createLeaseOwnerFingerprint(
    identity.commandKeyHash,
    values.leaseId,
  );
  const stripeAccountFingerprint = createProviderCommitment(
    HASH_DOMAINS.stripeAccount,
    identity.commandKeyHash,
    'stripeAccountId',
    values.stripeAccountId,
  );
  const parametersFingerprint = createProviderCommitment(
    HASH_DOMAINS.stripeParameters,
    identity.commandKeyHash,
    'canonicalParametersFingerprint',
    canonicalParametersFingerprint,
  );
  const idempotencyKeyFingerprint = createProviderCommitment(
    HASH_DOMAINS.stripeIdempotencyKey,
    identity.commandKeyHash,
    'stripeIdempotencyKey',
    stripeIdempotencyKey,
  );
  const providerPlanRecord = Object.freeze({
    providerPlanSchemaVersion,
    commandIdentityVersion,
    commandKeyHash: identity.commandKeyHash,
    environment: values.environment,
    provider: 'stripe',
    providerAttempt: INITIAL_PROVIDER_ATTEMPT,
    providerOperation: values.providerOperation,
    stripeMode: values.stripeMode,
    stripeAccountFingerprint,
    stripeApiVersion: values.stripeApiVersion,
    httpMethod: 'POST',
    endpointPath: values.endpointPath,
    parametersFingerprint,
    idempotencyKeyFingerprint,
    boundFenceEpoch: values.expectedFenceEpoch,
    boundAt: occurredAt,
  });
  const providerPlanAuditRecord = Object.freeze({
    providerPlanAuditSchemaVersion,
    aggregateType: 'commerce_provider_attempt',
    commandKeyHash: identity.commandKeyHash,
    providerAttempt: INITIAL_PROVIDER_ATTEMPT,
    eventType: 'provider_plan_bound',
    provider: 'stripe',
    environment: values.environment,
    stripeMode: values.stripeMode,
    providerOperation: values.providerOperation,
    boundFenceEpoch: values.expectedFenceEpoch,
    occurredAt,
  });

  return Object.freeze({
    db: values.db,
    expected: identity.expected,
    commandKeyHash: identity.commandKeyHash,
    expectedFenceEpoch: values.expectedFenceEpoch,
    leaseOwnerFingerprint,
    occurredAt,
    occurredAtParts: readTimestamp(occurredAt),
    commandRef,
    registrationAuditRef,
    lifecycleRef,
    providerPlanRef,
    providerPlanAuditRef,
    providerPlanRecord,
    providerPlanAuditRecord,
  });
}

function prepareProviderSendOperation(input) {
  const prepared = prepareProviderPlanOperation(input);

  let providerSendRef;
  let providerSendAuditRef;
  try {
    providerSendRef = prepared.providerPlanRef
      .collection(SEND_EVIDENCE_COLLECTION)
      .doc(INITIAL_SEND_EVIDENCE_DOCUMENT);
    providerSendAuditRef = prepared.db.collection(AUDIT_COLLECTION).doc(
      providerSendAuditDocumentId(prepared.commandKeyHash),
    );
  } catch (error) {
    if (error instanceof CommerceCommandJournalError) throw error;
    reject('journal_unavailable');
  }

  const automaticRetryDeadlineAt = addProviderSendRetryWindow(prepared.occurredAt);

  return Object.freeze({
    ...prepared,
    providerSendRef,
    providerSendAuditRef,
    automaticRetryDeadlineAt,
  });
}

function prepareProviderReconciliationOperation(input) {
  const identity = prepareIdentity(input, RECORD_PROVIDER_RECONCILIATION_INPUT_FIELDS);
  const { values } = identity;

  if (!validStripeAccountId(values.stripeAccountId)
    || !validStripeModeForEnvironment(values.stripeMode, values.environment)
    || !validStripeApiVersion(values.stripeApiVersion)
    || !validStripeOperationEndpoint(values.providerOperation, values.endpointPath)) {
    reject('invalid_command_input');
  }

  let canonicalParametersFingerprint;
  let stripeIdempotencyKey;
  let reconciliationEvidence;
  let reconciliationClassification;
  try {
    canonicalParametersFingerprint = createPayloadFingerprint({
      commandType: PROVIDER_PARAMETERS_COMMAND_TYPE,
      payload: values.providerParameters,
    }).payloadFingerprint;
    stripeIdempotencyKey = createStripeIdempotencyKey({
      stripeMode: values.stripeMode,
      environment: values.environment,
      providerOperation: values.providerOperation,
      commandKeyHash: identity.commandKeyHash,
      providerAttempt: INITIAL_PROVIDER_ATTEMPT,
    }).stripeIdempotencyKey;
    const evidenceValues = readExactOwnDataObject(
      values.reconciliationEvidence,
      RECONCILIATION_EVIDENCE_INPUT_FIELDS,
      'invalid_command_input',
    );
    reconciliationEvidence = Object.freeze(Object.fromEntries(
      RECONCILIATION_EVIDENCE_INPUT_FIELDS.map((field) => [field, evidenceValues[field]]),
    ));
    reconciliationClassification = classifyInitialStripeReconciliation(
      reconciliationEvidence,
    );
  } catch (error) {
    if (error instanceof CommerceCommandJournalError) throw error;
    if (error instanceof CommandIdentityError
      || error instanceof CommerceProviderReconciliationError) {
      reject('invalid_command_input');
    }
    reject('journal_unavailable');
  }

  const stripeAccountFingerprint = createProviderCommitment(
    HASH_DOMAINS.stripeAccount,
    identity.commandKeyHash,
    'stripeAccountId',
    values.stripeAccountId,
  );
  const parametersFingerprint = createProviderCommitment(
    HASH_DOMAINS.stripeParameters,
    identity.commandKeyHash,
    'canonicalParametersFingerprint',
    canonicalParametersFingerprint,
  );
  const idempotencyKeyFingerprint = createProviderCommitment(
    HASH_DOMAINS.stripeIdempotencyKey,
    identity.commandKeyHash,
    'stripeIdempotencyKey',
    stripeIdempotencyKey,
  );
  const providerPlanRecord = Object.freeze({
    environment: values.environment,
    providerOperation: values.providerOperation,
    stripeMode: values.stripeMode,
    stripeAccountFingerprint,
    stripeApiVersion: values.stripeApiVersion,
    endpointPath: values.endpointPath,
    parametersFingerprint,
    idempotencyKeyFingerprint,
  });

  let commandRef;
  let registrationAuditRef;
  let lifecycleRef;
  let providerPlanRef;
  let providerPlanAuditRef;
  let providerSendRef;
  let providerSendAuditRef;
  let providerReconciliationRef;
  let providerReconciliationAuditRef;
  try {
    commandRef = values.db.collection(COMMAND_COLLECTION).doc(identity.commandKeyHash);
    registrationAuditRef = values.db.collection(AUDIT_COLLECTION).doc(
      auditDocumentId(identity.commandKeyHash, COMMAND_REVISION),
    );
    lifecycleRef = commandRef.collection(LIFECYCLE_COLLECTION).doc(LIFECYCLE_DOCUMENT);
    providerPlanRef = commandRef.collection(PROVIDER_ATTEMPTS_COLLECTION).doc(
      INITIAL_PROVIDER_ATTEMPT_DOCUMENT,
    );
    providerPlanAuditRef = values.db.collection(AUDIT_COLLECTION).doc(
      providerPlanAuditDocumentId(identity.commandKeyHash),
    );
    providerSendRef = providerPlanRef
      .collection(SEND_EVIDENCE_COLLECTION)
      .doc(INITIAL_SEND_EVIDENCE_DOCUMENT);
    providerSendAuditRef = values.db.collection(AUDIT_COLLECTION).doc(
      providerSendAuditDocumentId(identity.commandKeyHash),
    );
    providerReconciliationRef = providerPlanRef
      .collection(RECONCILIATION_EVIDENCE_COLLECTION)
      .doc(INITIAL_RECONCILIATION_EVIDENCE_DOCUMENT);
    providerReconciliationAuditRef = values.db.collection(AUDIT_COLLECTION).doc(
      providerReconciliationAuditDocumentId(identity.commandKeyHash),
    );
  } catch (error) {
    if (error instanceof CommerceCommandJournalError) throw error;
    reject('journal_unavailable');
  }

  const occurredAt = captureTrustedTimestamp();
  return Object.freeze({
    ...identity,
    db: values.db,
    occurredAt,
    occurredAtParts: readTimestamp(occurredAt),
    providerPlanRecord,
    reconciliationEvidence,
    reconciliationClassification,
    commandRef,
    registrationAuditRef,
    lifecycleRef,
    providerPlanRef,
    providerPlanAuditRef,
    providerSendRef,
    providerSendAuditRef,
    providerReconciliationRef,
    providerReconciliationAuditRef,
  });
}

function prepareNextProviderAttemptAuthorizationOperation(input) {
  const values = readExactOwnDataObject(
    input,
    AUTHORIZE_NEXT_PROVIDER_ATTEMPT_INPUT_FIELDS,
    'invalid_command_input',
  );
  if (typeof values.leaseId !== 'string'
    || !CANONICAL_UUID_V4.test(values.leaseId)
    || values.leaseId === values.commandId
    || !validLifecycleNumber(values.expectedFenceEpoch)) {
    reject('invalid_command_input');
  }
  const transitionValues = readExactOwnDataObject(
    values.transitionAuthorization,
    TRANSITION_AUTHORIZATION_INPUT_FIELDS,
    'invalid_command_input',
  );
  if ((transitionValues.kind !== 'retry_same_operation'
      && transitionValues.kind !== 'replace_expired_unpaid')
    || typeof transitionValues.recordCommitment !== 'string'
    || !LOWERCASE_SHA256.test(transitionValues.recordCommitment)) {
    reject('invalid_command_input');
  }

  const reconciliationInput = Object.fromEntries(
    RECORD_PROVIDER_RECONCILIATION_INPUT_FIELDS.map((field) => [field, values[field]]),
  );
  const prepared = prepareProviderReconciliationOperation(reconciliationInput);
  const expectedTransitionKind = expectedTransitionKindForCandidate(
    prepared.reconciliationEvidence,
  );
  if (transitionValues.kind !== expectedTransitionKind) reject('invalid_command_input');

  let stripeIdempotencyKey;
  try {
    stripeIdempotencyKey = createStripeIdempotencyKey({
      stripeMode: values.stripeMode,
      environment: values.environment,
      providerOperation: values.providerOperation,
      commandKeyHash: prepared.commandKeyHash,
      providerAttempt: NEXT_PROVIDER_ATTEMPT,
    }).stripeIdempotencyKey;
  } catch (error) {
    if (error instanceof CommandIdentityError) reject('invalid_command_input');
    if (error instanceof CommerceCommandJournalError) throw error;
    reject('journal_unavailable');
  }

  const leaseOwnerFingerprint = createLeaseOwnerFingerprint(
    prepared.commandKeyHash,
    values.leaseId,
  );
  const transitionRecordCommitment = createTransitionRecordCommitment(
    prepared.commandKeyHash,
    transitionValues.kind,
    transitionValues.recordCommitment,
  );
  const idempotencyKeyFingerprint = createProviderCommitment(
    HASH_DOMAINS.stripeIdempotencyKey,
    prepared.commandKeyHash,
    'stripeIdempotencyKey',
    stripeIdempotencyKey,
  );

  let providerAttemptAuthorizationRef;
  let providerAttemptAuthorizationAuditRef;
  try {
    providerAttemptAuthorizationRef = prepared.providerReconciliationRef
      .collection(NEXT_ATTEMPT_AUTHORIZATION_COLLECTION)
      .doc(NEXT_PROVIDER_ATTEMPT_DOCUMENT);
    providerAttemptAuthorizationAuditRef = prepared.db.collection(AUDIT_COLLECTION).doc(
      providerAttemptAuthorizationAuditDocumentId(prepared.commandKeyHash),
    );
  } catch (error) {
    if (error instanceof CommerceCommandJournalError) throw error;
    reject('journal_unavailable');
  }

  return Object.freeze({
    ...prepared,
    expectedFenceEpoch: values.expectedFenceEpoch,
    leaseOwnerFingerprint,
    transitionKind: transitionValues.kind,
    transitionRecordCommitment,
    idempotencyKeyFingerprint,
    providerAttemptAuthorizationRef,
    providerAttemptAuthorizationAuditRef,
  });
}

function createProviderSendPair(prepared, providerPlan) {
  const providerPlanCommitment = createCompleteProviderPlanCommitment(
    providerPlan.record,
    providerPlan.boundAt,
  );
  const record = Object.freeze({
    providerSendEvidenceSchemaVersion,
    providerPlanSchemaVersion,
    commandIdentityVersion,
    commandKeyHash: prepared.commandKeyHash,
    providerAttempt: INITIAL_PROVIDER_ATTEMPT,
    provider: 'stripe',
    providerPlanCommitment,
    prePostFenceEpoch: prepared.expectedFenceEpoch,
    prePostRecordedAt: prepared.occurredAt,
    automaticRetryDeadlineAt: prepared.automaticRetryDeadlineAt,
  });
  const audit = Object.freeze({
    providerSendAuditSchemaVersion,
    aggregateType: 'commerce_provider_send',
    commandKeyHash: prepared.commandKeyHash,
    providerAttempt: INITIAL_PROVIDER_ATTEMPT,
    eventType: 'provider_pre_send_recorded',
    provider: 'stripe',
    environment: prepared.expected.environment,
    stripeMode: prepared.providerPlanRecord.stripeMode,
    providerOperation: prepared.providerPlanRecord.providerOperation,
    providerPlanCommitment,
    prePostFenceEpoch: prepared.expectedFenceEpoch,
    automaticRetryDeadlineAt: prepared.automaticRetryDeadlineAt,
    occurredAt: prepared.occurredAt,
  });

  return Object.freeze({ record, audit });
}

function readSnapshot(snapshot) {
  let exists;
  try {
    exists = snapshot.exists;
  } catch {
    reject('journal_unavailable');
  }
  if (exists === false) return Object.freeze({ exists: false, value: null });
  if (exists !== true) reject('journal_unavailable');

  let value;
  try {
    value = snapshot.data();
  } catch {
    reject('journal_unavailable');
  }
  return Object.freeze({ exists: true, value });
}

const LEASE_BUSY = Object.freeze({
  journalSchemaVersion,
  lifecycleSchemaVersion,
  outcome: 'lease_busy',
  state: 'leased',
});
const TERMINAL_SUCCEEDED = Object.freeze({
  journalSchemaVersion,
  lifecycleSchemaVersion,
  outcome: 'terminal_succeeded',
  state: 'succeeded',
});
const TERMINAL_FAILED_FINAL = Object.freeze({
  journalSchemaVersion,
  lifecycleSchemaVersion,
  outcome: 'terminal_failed_final',
  state: 'failed_final',
});

function createLeaseResult(fenceEpoch, leaseExpiresAt) {
  const expiresAt = readTimestamp(leaseExpiresAt);
  if (!validLifecycleNumber(fenceEpoch) || expiresAt === null) {
    reject('journal_unavailable');
  }
  return Object.freeze({
    journalSchemaVersion,
    lifecycleSchemaVersion,
    outcome: 'lease_acquired',
    state: 'leased',
    fenceEpoch,
    leaseExpiresAt: expiresAt,
  });
}

function validateLifecycleResult(result) {
  if (result === LEASE_BUSY
    || result === TERMINAL_SUCCEEDED
    || result === TERMINAL_FAILED_FINAL) {
    return result;
  }

  const value = readExactOwnDataObject(result, [
    'journalSchemaVersion',
    'lifecycleSchemaVersion',
    'outcome',
    'state',
    'fenceEpoch',
    'leaseExpiresAt',
  ], 'journal_unavailable');
  const expiry = readExactOwnDataObject(
    value.leaseExpiresAt,
    ['seconds', 'nanoseconds'],
    'journal_unavailable',
  );
  if (value.journalSchemaVersion !== journalSchemaVersion
    || value.lifecycleSchemaVersion !== lifecycleSchemaVersion
    || value.outcome !== 'lease_acquired'
    || value.state !== 'leased'
    || !validLifecycleNumber(value.fenceEpoch)
    || !Number.isSafeInteger(expiry.seconds)
    || expiry.seconds < -62135596800
    || expiry.seconds > 253402300799
    || !Number.isSafeInteger(expiry.nanoseconds)
    || expiry.nanoseconds < 0
    || expiry.nanoseconds > 999999999
    || !Object.isFrozen(result)
    || !Object.isFrozen(value.leaseExpiresAt)) {
    reject('journal_unavailable');
  }
  return result;
}

function buildLeasedLifecycle(prepared, previous = null) {
  const fenceEpoch = previous === null ? 1 : previous.record.fenceEpoch + 1;
  const commandRevision = previous === null ? 2 : previous.record.commandRevision + 1;
  if (!validLifecycleNumber(fenceEpoch) || !validLifecycleNumber(commandRevision)) {
    reject('journal_record_invalid');
  }

  return Object.freeze({
    lifecycleSchemaVersion,
    commandKeyHash: prepared.commandKeyHash,
    state: 'leased',
    commandRevision,
    fenceEpoch,
    leaseOwnerFingerprint: prepared.leaseOwnerFingerprint,
    leaseAcquiredAt: prepared.occurredAt,
    leaseExpiresAt: prepared.proposedLeaseExpiresAt,
    createdAt: previous === null
      ? prepared.occurredAt
      : copyTimestamp(previous.createdAt),
    updatedAt: prepared.occurredAt,
    terminalCommitmentKind: null,
    terminalCommitmentHash: null,
  });
}

function buildTerminalLifecycle(prepared, lifecycle, state) {
  const commandRevision = lifecycle.record.commandRevision + 1;
  if (!validLifecycleNumber(commandRevision)) reject('journal_record_invalid');

  return Object.freeze({
    lifecycleSchemaVersion,
    commandKeyHash: prepared.commandKeyHash,
    state,
    commandRevision,
    fenceEpoch: lifecycle.record.fenceEpoch,
    leaseOwnerFingerprint: lifecycle.record.leaseOwnerFingerprint,
    leaseAcquiredAt: copyTimestamp(lifecycle.leaseAcquiredAt),
    leaseExpiresAt: copyTimestamp(lifecycle.leaseExpiresAt),
    createdAt: copyTimestamp(lifecycle.createdAt),
    updatedAt: prepared.occurredAt,
    terminalCommitmentKind: state === 'succeeded' ? 'business_record_digest' : null,
    terminalCommitmentHash: state === 'succeeded'
      ? prepared.terminalCommitmentHash
      : null,
  });
}

function buildLifecycleAudit(prepared, lifecycleRecord, eventType, fromState) {
  return Object.freeze({
    auditSchemaVersion: lifecycleAuditSchemaVersion,
    aggregateType: 'commerce_command',
    commandKeyHash: prepared.commandKeyHash,
    commandRevision: lifecycleRecord.commandRevision,
    eventType,
    fromState,
    toState: lifecycleRecord.state,
    environment: prepared.expected.environment,
    callerScopeKind: prepared.callerScopeKind,
    commandType: prepared.expected.commandType,
    fenceEpoch: lifecycleRecord.fenceEpoch,
    leaseExpiresAt: lifecycleRecord.leaseExpiresAt,
    occurredAt: lifecycleRecord.updatedAt,
  });
}

async function readLifecycleContext(transaction, prepared) {
  const commandSnapshot = await transaction.get(prepared.commandRef);
  const registrationAuditSnapshot = await transaction.get(prepared.registrationAuditRef);
  const lifecycleSnapshot = await transaction.get(prepared.lifecycleRef);
  const command = readSnapshot(commandSnapshot);
  const registrationAudit = readSnapshot(registrationAuditSnapshot);
  const lifecycleDocument = readSnapshot(lifecycleSnapshot);

  if (command.exists !== registrationAudit.exists) reject('journal_record_invalid');
  if (!command.exists) {
    if (lifecycleDocument.exists) reject('journal_record_invalid');
    reject('command_not_registered');
  }
  const registration = validateExistingPair(
    command.value,
    registrationAudit.value,
    prepared.expected,
  );

  if (!lifecycleDocument.exists) {
    if (compareTimestamps(prepared.occurredAtParts, registration.createdAt) < 0) {
      reject('journal_record_invalid');
    }
    const nextAuditRef = prepared.values.db.collection(AUDIT_COLLECTION).doc(
      auditDocumentId(prepared.commandKeyHash, 2),
    );
    const nextAudit = readSnapshot(await transaction.get(nextAuditRef));
    if (nextAudit.exists) reject('journal_record_invalid');
    return Object.freeze({
      lifecycle: null,
      nextAuditRef,
    });
  }

  const lifecycle = parseLifecycle(lifecycleDocument.value, prepared.expected);
  if (compareTimestamps(lifecycle.createdAt, registration.createdAt) < 0) {
    reject('journal_record_invalid');
  }
  const currentAuditRef = prepared.values.db.collection(AUDIT_COLLECTION).doc(
    auditDocumentId(prepared.commandKeyHash, lifecycle.record.commandRevision),
  );
  const currentAudit = readSnapshot(await transaction.get(currentAuditRef));
  if (!currentAudit.exists) reject('journal_record_invalid');
  validateLifecycleAudit(currentAudit.value, lifecycle, prepared.expected);

  let nextAuditRef = null;
  if (lifecycle.record.commandRevision < MAXIMUM_LIFECYCLE_NUMBER) {
    nextAuditRef = prepared.values.db.collection(AUDIT_COLLECTION).doc(
      auditDocumentId(prepared.commandKeyHash, lifecycle.record.commandRevision + 1),
    );
    const nextAudit = readSnapshot(await transaction.get(nextAuditRef));
    if (nextAudit.exists) reject('journal_record_invalid');
  }

  return Object.freeze({
    lifecycle,
    nextAuditRef,
  });
}

function writeLifecycleTransition(transaction, prepared, context, lifecycleRecord, auditRecord) {
  if (context.nextAuditRef === null) reject('journal_record_invalid');
  if (context.lifecycle === null) {
    transaction.create(prepared.lifecycleRef, lifecycleRecord);
  } else {
    transaction.set(prepared.lifecycleRef, lifecycleRecord);
  }
  transaction.create(context.nextAuditRef, auditRecord);
}

function validateProviderLeaseAudit(value, expectedFenceEpoch, prepared) {
  const audit = readExactOwnDataObject(
    value,
    LIFECYCLE_AUDIT_FIELDS,
    'journal_record_invalid',
  );
  const leaseExpiresAt = readTimestamp(audit.leaseExpiresAt);
  const occurredAt = readTimestamp(audit.occurredAt);
  const expectedRevision = expectedFenceEpoch + 1;
  const firstLease = expectedFenceEpoch === 1;

  if (!validLifecycleNumber(expectedFenceEpoch)
    || !validLifecycleNumber(expectedRevision)
    || audit.auditSchemaVersion !== lifecycleAuditSchemaVersion
    || audit.aggregateType !== 'commerce_command'
    || audit.commandKeyHash !== prepared.commandKeyHash
    || audit.commandRevision !== expectedRevision
    || audit.eventType !== (firstLease ? 'command_lease_acquired' : 'command_lease_taken_over')
    || audit.fromState !== (firstLease ? 'registered' : 'leased')
    || audit.toState !== 'leased'
    || audit.environment !== prepared.expected.environment
    || audit.callerScopeKind !== prepared.expected.callerScopeKind
    || audit.commandType !== prepared.expected.commandType
    || audit.fenceEpoch !== expectedFenceEpoch
    || leaseExpiresAt === null
    || occurredAt === null
    || !timestampExactlySecondsAfter(
      leaseExpiresAt,
      occurredAt,
      LEASE_DURATION_SECONDS,
    )) {
    reject('journal_record_invalid');
  }
  return Object.freeze({
    fenceEpoch: expectedFenceEpoch,
    leaseExpiresAt,
    occurredAt,
  });
}

function validateProviderLeaseChronology(leaseAudit, predecessorAudit, lifecycle) {
  if (leaseAudit.fenceEpoch === 1) {
    if (predecessorAudit !== null
      || !timestampsEqual(leaseAudit.occurredAt, lifecycle.createdAt)) {
      reject('journal_record_invalid');
    }
    return;
  }

  if (predecessorAudit === null
    || predecessorAudit.fenceEpoch !== leaseAudit.fenceEpoch - 1
    || (predecessorAudit.fenceEpoch === 1
      ? !timestampsEqual(predecessorAudit.occurredAt, lifecycle.createdAt)
      : compareTimestamps(predecessorAudit.occurredAt, lifecycle.createdAt) <= 0)
    || compareTimestamps(leaseAudit.occurredAt, predecessorAudit.leaseExpiresAt) < 0) {
    reject('journal_record_invalid');
  }
}

function validateProviderLeaseAgainstCurrent(leaseAudit, lifecycle) {
  if (leaseAudit.fenceEpoch > lifecycle.record.fenceEpoch) {
    reject('journal_record_invalid');
  }
  if (leaseAudit.fenceEpoch === lifecycle.record.fenceEpoch) {
    if (!timestampsEqual(leaseAudit.occurredAt, lifecycle.leaseAcquiredAt)
      || !timestampsEqual(leaseAudit.leaseExpiresAt, lifecycle.leaseExpiresAt)) {
      reject('journal_record_invalid');
    }
    return;
  }
  if (compareTimestamps(leaseAudit.leaseExpiresAt, lifecycle.leaseAcquiredAt) > 0) {
    reject('journal_record_invalid');
  }
}

function validateProviderPlanPair(
  plan,
  audit,
  bindingAudit,
  prepared,
  registration,
  lifecycle,
) {
  const boundAt = readTimestamp(plan.boundAt);
  const occurredAt = readTimestamp(audit.occurredAt);

  if (plan.providerPlanSchemaVersion !== providerPlanSchemaVersion
    || plan.commandIdentityVersion !== commandIdentityVersion
    || plan.commandKeyHash !== prepared.commandKeyHash
    || plan.environment !== prepared.expected.environment
    || plan.provider !== 'stripe'
    || plan.providerAttempt !== INITIAL_PROVIDER_ATTEMPT
    || !validStripeOperationEndpoint(plan.providerOperation, plan.endpointPath)
    || !validStripeModeForEnvironment(plan.stripeMode, plan.environment)
    || typeof plan.stripeAccountFingerprint !== 'string'
    || !LOWERCASE_SHA256.test(plan.stripeAccountFingerprint)
    || !validStripeApiVersion(plan.stripeApiVersion)
    || plan.httpMethod !== 'POST'
    || typeof plan.parametersFingerprint !== 'string'
    || !LOWERCASE_SHA256.test(plan.parametersFingerprint)
    || typeof plan.idempotencyKeyFingerprint !== 'string'
    || !LOWERCASE_SHA256.test(plan.idempotencyKeyFingerprint)
    || !validLifecycleNumber(plan.boundFenceEpoch)
    || boundAt === null) {
    reject('journal_record_invalid');
  }

  let storedStripeIdempotencyKey;
  try {
    storedStripeIdempotencyKey = createStripeIdempotencyKey({
      stripeMode: plan.stripeMode,
      environment: plan.environment,
      providerOperation: plan.providerOperation,
      commandKeyHash: plan.commandKeyHash,
      providerAttempt: plan.providerAttempt,
    }).stripeIdempotencyKey;
  } catch {
    reject('journal_record_invalid');
  }
  const storedKeyFingerprint = createProviderCommitment(
    HASH_DOMAINS.stripeIdempotencyKey,
    plan.commandKeyHash,
    'stripeIdempotencyKey',
    storedStripeIdempotencyKey,
  );

  if (plan.idempotencyKeyFingerprint !== storedKeyFingerprint
    || audit.providerPlanAuditSchemaVersion !== providerPlanAuditSchemaVersion
    || audit.aggregateType !== 'commerce_provider_attempt'
    || audit.commandKeyHash !== plan.commandKeyHash
    || audit.providerAttempt !== plan.providerAttempt
    || audit.eventType !== 'provider_plan_bound'
    || audit.provider !== plan.provider
    || audit.environment !== plan.environment
    || audit.stripeMode !== plan.stripeMode
    || audit.providerOperation !== plan.providerOperation
    || audit.boundFenceEpoch !== plan.boundFenceEpoch
    || !timestampsEqual(occurredAt, boundAt)
    || compareTimestamps(bindingAudit.occurredAt, registration.createdAt) < 0
    || compareTimestamps(boundAt, registration.createdAt) < 0
    || plan.boundFenceEpoch > lifecycle.record.fenceEpoch
    || compareTimestamps(boundAt, bindingAudit.occurredAt) < 0
    || compareTimestamps(boundAt, bindingAudit.leaseExpiresAt) >= 0) {
    reject('journal_record_invalid');
  }

  validateProviderLeaseAgainstCurrent(bindingAudit, lifecycle);

  const expected = prepared.providerPlanRecord;
  if (plan.providerOperation !== expected.providerOperation
    || plan.stripeMode !== expected.stripeMode
    || plan.stripeAccountFingerprint !== expected.stripeAccountFingerprint
    || plan.stripeApiVersion !== expected.stripeApiVersion
    || plan.endpointPath !== expected.endpointPath
    || plan.parametersFingerprint !== expected.parametersFingerprint
    || plan.idempotencyKeyFingerprint !== expected.idempotencyKeyFingerprint) {
    reject('command_conflict');
  }

  return Object.freeze({ record: plan, boundAt });
}

async function readProviderPlanContext(transaction, prepared, options = {}) {
  const requireActiveLease = options.requireActiveLease !== false;
  const commandSnapshot = await transaction.get(prepared.commandRef);
  const registrationAuditSnapshot = await transaction.get(prepared.registrationAuditRef);
  const lifecycleSnapshot = await transaction.get(prepared.lifecycleRef);
  const command = readSnapshot(commandSnapshot);
  const registrationAudit = readSnapshot(registrationAuditSnapshot);
  const lifecycleDocument = readSnapshot(lifecycleSnapshot);

  let lifecycle = null;
  let currentAudit = Object.freeze({ exists: false, value: null });
  const lifecycleAuditsByRevision = new Map();
  if (lifecycleDocument.exists) {
    lifecycle = parseLifecycle(lifecycleDocument.value, prepared.expected);
    const currentAuditRef = prepared.db.collection(AUDIT_COLLECTION).doc(
      auditDocumentId(prepared.commandKeyHash, lifecycle.record.commandRevision),
    );
    currentAudit = readSnapshot(await transaction.get(currentAuditRef));
    lifecycleAuditsByRevision.set(lifecycle.record.commandRevision, currentAudit);
  }

  const providerPlanSnapshot = await transaction.get(prepared.providerPlanRef);
  const providerPlanAuditSnapshot = await transaction.get(prepared.providerPlanAuditRef);
  const providerPlanDocument = readSnapshot(providerPlanSnapshot);
  const providerPlanAudit = readSnapshot(providerPlanAuditSnapshot);

  async function readRequiredLifecycleAudit(revision) {
    if (!validLifecycleNumber(revision)) reject('journal_record_invalid');
    let audit = lifecycleAuditsByRevision.get(revision);
    if (audit === undefined) {
      const auditRef = prepared.db.collection(AUDIT_COLLECTION).doc(
        auditDocumentId(prepared.commandKeyHash, revision),
      );
      audit = readSnapshot(await transaction.get(auditRef));
      lifecycleAuditsByRevision.set(revision, audit);
    }
    if (!audit.exists) reject('journal_record_invalid');
    return audit;
  }

  if (command.exists !== registrationAudit.exists) reject('journal_record_invalid');
  if (!command.exists) {
    if (lifecycleDocument.exists || providerPlanDocument.exists || providerPlanAudit.exists) {
      reject('journal_record_invalid');
    }
    reject('command_not_registered');
  }
  const registration = validateExistingPair(
    command.value,
    registrationAudit.value,
    prepared.expected,
  );

  if (lifecycle === null) {
    if (providerPlanDocument.exists || providerPlanAudit.exists) {
      reject('journal_record_invalid');
    }
    reject('lease_stale');
  }
  if (compareTimestamps(lifecycle.createdAt, registration.createdAt) < 0
    || !currentAudit.exists) {
    reject('journal_record_invalid');
  }
  validateLifecycleAudit(currentAudit.value, lifecycle, prepared.expected);
  const mayCreate = requireActiveLease
    ? validateActiveProviderPlanLease(prepared, lifecycle)
    : false;
  const currentLeaseAuditDocument = lifecycle.record.state === 'leased'
    ? currentAudit
    : await readRequiredLifecycleAudit(lifecycle.record.fenceEpoch + 1);
  const currentLeaseAudit = validateProviderLeaseAudit(
    currentLeaseAuditDocument.value,
    lifecycle.record.fenceEpoch,
    prepared,
  );
  let currentPredecessorAudit = null;
  if (lifecycle.record.fenceEpoch > 1) {
    const predecessorDocument = await readRequiredLifecycleAudit(
      lifecycle.record.fenceEpoch,
    );
    currentPredecessorAudit = validateProviderLeaseAudit(
      predecessorDocument.value,
      lifecycle.record.fenceEpoch - 1,
      prepared,
    );
  }
  // The current/binding lease and its immediate predecessor are a fixed read
  // budget. Earlier server-only append history remains a trust boundary; a
  // recursive scan would make transaction reads grow without a bound.
  validateProviderLeaseChronology(currentLeaseAudit, currentPredecessorAudit, lifecycle);
  validateProviderLeaseAgainstCurrent(currentLeaseAudit, lifecycle);

  if (providerPlanDocument.exists !== providerPlanAudit.exists) {
    reject('journal_record_invalid');
  }
  let providerPlan = null;
  if (providerPlanDocument.exists) {
    const plan = readExactOwnDataObject(
      providerPlanDocument.value,
      PROVIDER_PLAN_FIELDS,
      'journal_record_invalid',
    );
    const planAudit = readExactOwnDataObject(
      providerPlanAudit.value,
      PROVIDER_PLAN_AUDIT_FIELDS,
      'journal_record_invalid',
    );
    if (!validLifecycleNumber(plan.boundFenceEpoch)
      || !validLifecycleNumber(plan.boundFenceEpoch + 1)
      || plan.boundFenceEpoch > lifecycle.record.fenceEpoch) {
      reject('journal_record_invalid');
    }
    let bindingAudit = currentLeaseAudit;
    let bindingPredecessorAudit = currentPredecessorAudit;
    if (lifecycle.record.fenceEpoch !== plan.boundFenceEpoch) {
      const bindingAuditDocument = await readRequiredLifecycleAudit(
        plan.boundFenceEpoch + 1,
      );
      bindingAudit = validateProviderLeaseAudit(
        bindingAuditDocument.value,
        plan.boundFenceEpoch,
        prepared,
      );
      bindingPredecessorAudit = null;
      if (plan.boundFenceEpoch > 1) {
        const predecessorDocument = await readRequiredLifecycleAudit(plan.boundFenceEpoch);
        bindingPredecessorAudit = validateProviderLeaseAudit(
          predecessorDocument.value,
          plan.boundFenceEpoch - 1,
          prepared,
        );
      }
    }
    validateProviderLeaseChronology(bindingAudit, bindingPredecessorAudit, lifecycle);
    providerPlan = validateProviderPlanPair(
      plan,
      planAudit,
      bindingAudit,
      prepared,
      registration,
      lifecycle,
    );
  }

  return Object.freeze({
    lifecycle,
    providerPlan,
    mayCreate,
    readRequiredLifecycleAudit,
  });
}

function parseProviderSendPair(recordValue, auditValue, prepared, context) {
  const record = readExactObjectWithOptionalTimeFields(
    recordValue,
    PROVIDER_SEND_FIELDS,
    ['prePostRecordedAt', 'automaticRetryDeadlineAt'],
    'journal_record_invalid',
  );
  const audit = readExactObjectWithOptionalTimeFields(
    auditValue,
    PROVIDER_SEND_AUDIT_FIELDS,
    ['occurredAt', 'automaticRetryDeadlineAt'],
    'journal_record_invalid',
  );

  if (record.providerSendEvidenceSchemaVersion !== providerSendEvidenceSchemaVersion
    || record.providerPlanSchemaVersion !== providerPlanSchemaVersion
    || record.commandIdentityVersion !== commandIdentityVersion
    || record.commandKeyHash !== prepared.commandKeyHash
    || record.providerAttempt !== INITIAL_PROVIDER_ATTEMPT
    || record.provider !== 'stripe'
    || typeof record.providerPlanCommitment !== 'string'
    || !LOWERCASE_SHA256.test(record.providerPlanCommitment)
    || !validLifecycleNumber(record.prePostFenceEpoch)
    || record.prePostFenceEpoch < context.providerPlan.record.boundFenceEpoch
    || record.prePostFenceEpoch > context.lifecycle.record.fenceEpoch
    || audit.providerSendAuditSchemaVersion !== providerSendAuditSchemaVersion
    || audit.aggregateType !== 'commerce_provider_send'
    || audit.commandKeyHash !== record.commandKeyHash
    || audit.providerAttempt !== record.providerAttempt
    || audit.eventType !== 'provider_pre_send_recorded'
    || audit.provider !== record.provider
    || audit.environment !== context.providerPlan.record.environment
    || audit.stripeMode !== context.providerPlan.record.stripeMode
    || audit.providerOperation !== context.providerPlan.record.providerOperation
    || audit.providerPlanCommitment !== record.providerPlanCommitment
    || record.providerPlanCommitment !== createCompleteProviderPlanCommitment(
      context.providerPlan.record,
      context.providerPlan.boundAt,
    )
    || audit.prePostFenceEpoch !== record.prePostFenceEpoch) {
    reject('journal_record_invalid');
  }

  const prePostRecordedAt = readTimestamp(record.prePostRecordedAt);
  const automaticRetryDeadlineAt = readTimestamp(record.automaticRetryDeadlineAt);
  const auditOccurredAt = readTimestamp(audit.occurredAt);
  const auditRetryDeadlineAt = readTimestamp(audit.automaticRetryDeadlineAt);
  const timeUnknown = prePostRecordedAt === null
    || automaticRetryDeadlineAt === null
    || auditOccurredAt === null
    || auditRetryDeadlineAt === null
    || !timestampsEqual(prePostRecordedAt, auditOccurredAt)
    || !timestampsEqual(automaticRetryDeadlineAt, auditRetryDeadlineAt)
    || !timestampExactlySecondsAfter(
      automaticRetryDeadlineAt,
      prePostRecordedAt,
      PROVIDER_SEND_RETRY_WINDOW_SECONDS,
    )
    || compareTimestamps(prePostRecordedAt, context.providerPlan.boundAt) < 0;
  if (timeUnknown) {
    return Object.freeze({
      record,
      audit,
      timeUnknown: true,
      prePostRecordedAt: null,
      automaticRetryDeadlineAt: null,
    });
  }

  return Object.freeze({
    record,
    audit,
    timeUnknown: false,
    prePostRecordedAt,
    automaticRetryDeadlineAt,
  });
}

async function readProviderSendContext(transaction, prepared, options = {}) {
  const context = await readProviderPlanContext(transaction, prepared, options);
  if (context.providerPlan === null) reject('journal_record_invalid');

  const providerSendSnapshot = await transaction.get(prepared.providerSendRef);
  const providerSendAuditSnapshot = await transaction.get(prepared.providerSendAuditRef);
  const providerSendDocument = readSnapshot(providerSendSnapshot);
  const providerSendAudit = readSnapshot(providerSendAuditSnapshot);

  if (providerSendDocument.exists !== providerSendAudit.exists) {
    reject('journal_record_invalid');
  }
  if (!providerSendDocument.exists) {
    return Object.freeze({ ...context, providerSend: null });
  }

  const providerSend = parseProviderSendPair(
    providerSendDocument.value,
    providerSendAudit.value,
    prepared,
    context,
  );
  const bindingAuditDocument = await context.readRequiredLifecycleAudit(
    providerSend.record.prePostFenceEpoch + 1,
  );
  const bindingAudit = validateProviderLeaseAudit(
    bindingAuditDocument.value,
    providerSend.record.prePostFenceEpoch,
    prepared,
  );
  let bindingPredecessorAudit = null;
  if (providerSend.record.prePostFenceEpoch > 1) {
    const predecessorDocument = await context.readRequiredLifecycleAudit(
      providerSend.record.prePostFenceEpoch,
    );
    bindingPredecessorAudit = validateProviderLeaseAudit(
      predecessorDocument.value,
      providerSend.record.prePostFenceEpoch - 1,
      prepared,
    );
  }
  validateProviderLeaseChronology(
    bindingAudit,
    bindingPredecessorAudit,
    context.lifecycle,
  );
  validateProviderLeaseAgainstCurrent(bindingAudit, context.lifecycle);
  if (providerSend.timeUnknown) {
    return Object.freeze({ ...context, providerSend });
  }
  if (compareTimestamps(providerSend.prePostRecordedAt, bindingAudit.occurredAt) < 0
    || compareTimestamps(
      providerSend.prePostRecordedAt,
      bindingAudit.leaseExpiresAt,
    ) >= 0) {
    return Object.freeze({
      ...context,
      providerSend: Object.freeze({
        ...providerSend,
        timeUnknown: true,
        prePostRecordedAt: null,
        automaticRetryDeadlineAt: null,
      }),
    });
  }

  return Object.freeze({ ...context, providerSend });
}

function createProviderReconciliationPair(prepared, context) {
  const observedLeaseExpiresAt = copyTimestamp(context.lifecycle.leaseExpiresAt);
  const providerPlanCommitment = createCompleteProviderPlanCommitment(
    context.providerPlan.record,
    context.providerPlan.boundAt,
  );
  const providerSendEvidenceCommitment = createCompleteProviderSendEvidenceCommitment(
    context.providerSend,
  );
  const evidence = prepared.reconciliationEvidence;
  const classification = prepared.reconciliationClassification;
  const record = Object.freeze({
    providerReconciliationEvidenceSchemaVersion,
    reconciliationPolicySchemaVersion,
    providerPlanSchemaVersion,
    providerSendEvidenceSchemaVersion,
    commandIdentityVersion,
    commandKeyHash: prepared.commandKeyHash,
    providerAttempt: INITIAL_PROVIDER_ATTEMPT,
    provider: 'stripe',
    evidenceRevision: 1,
    providerPlanCommitment,
    providerSendEvidenceCommitment,
    classification: classification.classification,
    state: classification.state,
    planBinding: evidence.planBinding,
    evidenceSource: evidence.evidenceSource,
    evidenceCompleteness: evidence.evidenceCompleteness,
    dispatchEvidence: evidence.dispatchEvidence,
    responseEvidence: evidence.responseEvidence,
    idempotencyEvidence: evidence.idempotencyEvidence,
    providerObjectEvidence: evidence.providerObjectEvidence,
    paymentEvidence: evidence.paymentEvidence,
    eventEvidence: evidence.eventEvidence,
    searchEvidence: evidence.searchEvidence,
    businessTransitionEvidence: evidence.businessTransitionEvidence,
    observedFenceEpoch: context.lifecycle.record.fenceEpoch,
    observedLeaseExpiresAt,
    recordedAt: prepared.occurredAt,
  });
  const reconciliationEvidenceCommitment = (
    createCompleteProviderReconciliationEvidenceCommitment(
      record,
      readTimestamp(observedLeaseExpiresAt),
      prepared.occurredAtParts,
    )
  );
  const audit = Object.freeze({
    providerReconciliationAuditSchemaVersion,
    providerReconciliationEvidenceSchemaVersion,
    aggregateType: 'commerce_provider_reconciliation',
    commandKeyHash: prepared.commandKeyHash,
    providerAttempt: INITIAL_PROVIDER_ATTEMPT,
    evidenceRevision: 1,
    eventType: 'provider_reconciliation_candidate_recorded',
    provider: 'stripe',
    environment: context.providerPlan.record.environment,
    stripeMode: context.providerPlan.record.stripeMode,
    providerOperation: context.providerPlan.record.providerOperation,
    providerPlanCommitment,
    providerSendEvidenceCommitment,
    reconciliationPolicySchemaVersion,
    classification: classification.classification,
    observedFenceEpoch: context.lifecycle.record.fenceEpoch,
    observedLeaseExpiresAt,
    reconciliationEvidenceCommitment,
    occurredAt: prepared.occurredAt,
  });
  return Object.freeze({ record, audit });
}

function classifyStoredProviderReconciliation(record) {
  const evidence = Object.freeze(Object.fromEntries(
    RECONCILIATION_EVIDENCE_INPUT_FIELDS.map((field) => [field, record[field]]),
  ));
  let classification;
  try {
    classification = classifyInitialStripeReconciliation(evidence);
  } catch (error) {
    if (error instanceof CommerceProviderReconciliationError) {
      reject('journal_record_invalid');
    }
    if (error instanceof CommerceCommandJournalError) throw error;
    reject('journal_unavailable');
  }
  if (classification.classification !== 'new_attempt_candidate'
    || classification.state !== 'requires_persistence_and_authorization') {
    reject('journal_record_invalid');
  }
  return classification;
}

async function parseProviderReconciliationPair(
  recordValue,
  auditValue,
  prepared,
  context,
) {
  const record = readExactOwnDataObject(
    recordValue,
    PROVIDER_RECONCILIATION_FIELDS,
    'journal_record_invalid',
  );
  const audit = readExactOwnDataObject(
    auditValue,
    PROVIDER_RECONCILIATION_AUDIT_FIELDS,
    'journal_record_invalid',
  );
  const recordedAt = readTimestamp(record.recordedAt);
  const observedLeaseExpiresAt = readTimestamp(record.observedLeaseExpiresAt);
  const auditOccurredAt = readTimestamp(audit.occurredAt);
  const auditObservedLeaseExpiresAt = readTimestamp(audit.observedLeaseExpiresAt);
  const expectedProviderPlanCommitment = createCompleteProviderPlanCommitment(
    context.providerPlan.record,
    context.providerPlan.boundAt,
  );
  const expectedProviderSendEvidenceCommitment = (
    createCompleteProviderSendEvidenceCommitment(context.providerSend)
  );

  classifyStoredProviderReconciliation(record);
  if (record.providerReconciliationEvidenceSchemaVersion
      !== providerReconciliationEvidenceSchemaVersion
    || record.reconciliationPolicySchemaVersion !== reconciliationPolicySchemaVersion
    || record.providerPlanSchemaVersion !== providerPlanSchemaVersion
    || record.providerSendEvidenceSchemaVersion !== providerSendEvidenceSchemaVersion
    || record.commandIdentityVersion !== commandIdentityVersion
    || record.commandKeyHash !== prepared.commandKeyHash
    || record.providerAttempt !== INITIAL_PROVIDER_ATTEMPT
    || record.provider !== 'stripe'
    || record.evidenceRevision !== 1
    || record.providerPlanCommitment !== expectedProviderPlanCommitment
    || record.providerSendEvidenceCommitment !== expectedProviderSendEvidenceCommitment
    || record.classification !== 'new_attempt_candidate'
    || record.state !== 'requires_persistence_and_authorization'
    || !validLifecycleNumber(record.observedFenceEpoch)
    || record.observedFenceEpoch < context.providerSend.record.prePostFenceEpoch
    || record.observedFenceEpoch > context.lifecycle.record.fenceEpoch
    || recordedAt === null
    || observedLeaseExpiresAt === null
    || auditOccurredAt === null
    || auditObservedLeaseExpiresAt === null
    || !timestampsEqual(recordedAt, auditOccurredAt)
    || !timestampsEqual(observedLeaseExpiresAt, auditObservedLeaseExpiresAt)
    || compareTimestamps(recordedAt, context.providerSend.automaticRetryDeadlineAt) < 0
    || compareTimestamps(recordedAt, observedLeaseExpiresAt) < 0
    || audit.providerReconciliationAuditSchemaVersion
      !== providerReconciliationAuditSchemaVersion
    || audit.providerReconciliationEvidenceSchemaVersion
      !== providerReconciliationEvidenceSchemaVersion
    || audit.aggregateType !== 'commerce_provider_reconciliation'
    || audit.commandKeyHash !== record.commandKeyHash
    || audit.providerAttempt !== record.providerAttempt
    || audit.evidenceRevision !== record.evidenceRevision
    || audit.eventType !== 'provider_reconciliation_candidate_recorded'
    || audit.provider !== record.provider
    || audit.environment !== context.providerPlan.record.environment
    || audit.stripeMode !== context.providerPlan.record.stripeMode
    || audit.providerOperation !== context.providerPlan.record.providerOperation
    || audit.providerPlanCommitment !== record.providerPlanCommitment
    || audit.providerSendEvidenceCommitment !== record.providerSendEvidenceCommitment
    || audit.reconciliationPolicySchemaVersion !== record.reconciliationPolicySchemaVersion
    || audit.classification !== record.classification
    || audit.observedFenceEpoch !== record.observedFenceEpoch
    || typeof audit.reconciliationEvidenceCommitment !== 'string'
    || !LOWERCASE_SHA256.test(audit.reconciliationEvidenceCommitment)
    || audit.reconciliationEvidenceCommitment
      !== createCompleteProviderReconciliationEvidenceCommitment(
        record,
        observedLeaseExpiresAt,
        recordedAt,
      )) {
    reject('journal_record_invalid');
  }

  const observedLeaseAuditDocument = await context.readRequiredLifecycleAudit(
    record.observedFenceEpoch + 1,
  );
  const observedLeaseAudit = validateProviderLeaseAudit(
    observedLeaseAuditDocument.value,
    record.observedFenceEpoch,
    prepared,
  );
  let predecessorLeaseAudit = null;
  if (record.observedFenceEpoch > 1) {
    const predecessorDocument = await context.readRequiredLifecycleAudit(
      record.observedFenceEpoch,
    );
    predecessorLeaseAudit = validateProviderLeaseAudit(
      predecessorDocument.value,
      record.observedFenceEpoch - 1,
      prepared,
    );
  }
  validateProviderLeaseChronology(
    observedLeaseAudit,
    predecessorLeaseAudit,
    context.lifecycle,
  );
  validateProviderLeaseAgainstCurrent(observedLeaseAudit, context.lifecycle);
  if (!timestampsEqual(observedLeaseExpiresAt, observedLeaseAudit.leaseExpiresAt)) {
    reject('journal_record_invalid');
  }

  for (const field of RECONCILIATION_EVIDENCE_INPUT_FIELDS) {
    if (record[field] !== prepared.reconciliationEvidence[field]) {
      reject('command_conflict');
    }
  }
  return Object.freeze({ record, audit, recordedAt, observedLeaseExpiresAt });
}

async function readProviderReconciliationContext(transaction, prepared) {
  const context = await readProviderSendContext(
    transaction,
    prepared,
    { requireActiveLease: false },
  );
  if (context.providerSend === null || context.providerSend.timeUnknown) {
    reject('journal_record_invalid');
  }

  const reconciliationSnapshot = await transaction.get(prepared.providerReconciliationRef);
  const reconciliationAuditSnapshot = await transaction.get(
    prepared.providerReconciliationAuditRef,
  );
  const reconciliationDocument = readSnapshot(reconciliationSnapshot);
  const reconciliationAudit = readSnapshot(reconciliationAuditSnapshot);
  if (reconciliationDocument.exists !== reconciliationAudit.exists) {
    reject('journal_record_invalid');
  }
  if (!reconciliationDocument.exists) {
    return Object.freeze({ ...context, providerReconciliation: null });
  }
  const providerReconciliation = await parseProviderReconciliationPair(
    reconciliationDocument.value,
    reconciliationAudit.value,
    prepared,
    context,
  );
  return Object.freeze({ ...context, providerReconciliation });
}

function createProviderAttemptAuthorizationPair(prepared, context) {
  const reconciliation = context.providerReconciliation;
  const providerReconciliationEvidenceCommitment = (
    createCompleteProviderReconciliationEvidenceCommitment(
      reconciliation.record,
      reconciliation.observedLeaseExpiresAt,
      reconciliation.recordedAt,
    )
  );
  const record = Object.freeze({
    providerAttemptAuthorizationSchemaVersion,
    providerPlanSchemaVersion,
    providerSendEvidenceSchemaVersion,
    providerReconciliationEvidenceSchemaVersion,
    reconciliationPolicySchemaVersion,
    commandIdentityVersion,
    commandKeyHash: prepared.commandKeyHash,
    provider: 'stripe',
    previousProviderAttempt: INITIAL_PROVIDER_ATTEMPT,
    authorizedProviderAttempt: NEXT_PROVIDER_ATTEMPT,
    authorizationRevision: 1,
    environment: context.providerPlan.record.environment,
    stripeMode: context.providerPlan.record.stripeMode,
    providerOperation: context.providerPlan.record.providerOperation,
    providerPlanCommitment: reconciliation.record.providerPlanCommitment,
    providerSendEvidenceCommitment: reconciliation.record.providerSendEvidenceCommitment,
    providerReconciliationEvidenceCommitment,
    transitionKind: prepared.transitionKind,
    transitionRecordCommitment: prepared.transitionRecordCommitment,
    idempotencyKeyFingerprint: prepared.idempotencyKeyFingerprint,
    authorizedFenceEpoch: context.lifecycle.record.fenceEpoch,
    authorizedAt: prepared.occurredAt,
  });
  const providerAttemptAuthorizationCommitment = (
    createCompleteProviderAttemptAuthorizationCommitment(
      record,
      prepared.occurredAtParts,
    )
  );
  const audit = Object.freeze({
    providerAttemptAuthorizationAuditSchemaVersion,
    providerAttemptAuthorizationSchemaVersion,
    providerPlanSchemaVersion,
    providerSendEvidenceSchemaVersion,
    aggregateType: 'commerce_provider_authorization',
    commandKeyHash: prepared.commandKeyHash,
    previousProviderAttempt: INITIAL_PROVIDER_ATTEMPT,
    authorizedProviderAttempt: NEXT_PROVIDER_ATTEMPT,
    authorizationRevision: 1,
    eventType: 'provider_attempt_authorized',
    provider: 'stripe',
    environment: context.providerPlan.record.environment,
    stripeMode: context.providerPlan.record.stripeMode,
    providerOperation: context.providerPlan.record.providerOperation,
    providerPlanCommitment: record.providerPlanCommitment,
    providerSendEvidenceCommitment: record.providerSendEvidenceCommitment,
    providerReconciliationEvidenceCommitment,
    transitionKind: prepared.transitionKind,
    transitionRecordCommitment: prepared.transitionRecordCommitment,
    idempotencyKeyFingerprint: prepared.idempotencyKeyFingerprint,
    authorizedFenceEpoch: context.lifecycle.record.fenceEpoch,
    providerAttemptAuthorizationCommitment,
    occurredAt: prepared.occurredAt,
  });
  return Object.freeze({ record, audit });
}

async function parseProviderAttemptAuthorizationPair(
  recordValue,
  auditValue,
  prepared,
  context,
) {
  const record = readExactOwnDataObject(
    recordValue,
    PROVIDER_ATTEMPT_AUTHORIZATION_FIELDS,
    'journal_record_invalid',
  );
  const audit = readExactOwnDataObject(
    auditValue,
    PROVIDER_ATTEMPT_AUTHORIZATION_AUDIT_FIELDS,
    'journal_record_invalid',
  );
  const authorizedAt = readTimestamp(record.authorizedAt);
  const auditOccurredAt = readTimestamp(audit.occurredAt);
  const reconciliation = context.providerReconciliation;
  const expectedTransitionKind = expectedTransitionKindForCandidate(reconciliation.record);
  const expectedReconciliationCommitment = (
    createCompleteProviderReconciliationEvidenceCommitment(
      reconciliation.record,
      reconciliation.observedLeaseExpiresAt,
      reconciliation.recordedAt,
    )
  );

  if (expectedTransitionKind === null
    || record.providerAttemptAuthorizationSchemaVersion
      !== providerAttemptAuthorizationSchemaVersion
    || record.providerPlanSchemaVersion !== providerPlanSchemaVersion
    || record.providerSendEvidenceSchemaVersion !== providerSendEvidenceSchemaVersion
    || record.providerReconciliationEvidenceSchemaVersion
      !== providerReconciliationEvidenceSchemaVersion
    || record.reconciliationPolicySchemaVersion !== reconciliationPolicySchemaVersion
    || record.commandIdentityVersion !== commandIdentityVersion
    || record.commandKeyHash !== prepared.commandKeyHash
    || record.provider !== 'stripe'
    || record.previousProviderAttempt !== INITIAL_PROVIDER_ATTEMPT
    || record.authorizedProviderAttempt !== NEXT_PROVIDER_ATTEMPT
    || record.authorizationRevision !== 1
    || record.environment !== context.providerPlan.record.environment
    || record.stripeMode !== context.providerPlan.record.stripeMode
    || record.providerOperation !== context.providerPlan.record.providerOperation
    || record.providerPlanCommitment !== reconciliation.record.providerPlanCommitment
    || record.providerSendEvidenceCommitment
      !== reconciliation.record.providerSendEvidenceCommitment
    || record.providerReconciliationEvidenceCommitment
      !== expectedReconciliationCommitment
    || record.transitionKind !== expectedTransitionKind
    || typeof record.transitionRecordCommitment !== 'string'
    || !LOWERCASE_SHA256.test(record.transitionRecordCommitment)
    || typeof record.idempotencyKeyFingerprint !== 'string'
    || !LOWERCASE_SHA256.test(record.idempotencyKeyFingerprint)
    || record.idempotencyKeyFingerprint !== prepared.idempotencyKeyFingerprint
    || !validLifecycleNumber(record.authorizedFenceEpoch)
    || record.authorizedFenceEpoch <= reconciliation.record.observedFenceEpoch
    || record.authorizedFenceEpoch > context.lifecycle.record.fenceEpoch
    || authorizedAt === null
    || auditOccurredAt === null
    || !timestampsEqual(authorizedAt, auditOccurredAt)
    || compareTimestamps(authorizedAt, reconciliation.recordedAt) < 0
    || audit.providerAttemptAuthorizationAuditSchemaVersion
      !== providerAttemptAuthorizationAuditSchemaVersion
    || audit.providerAttemptAuthorizationSchemaVersion
      !== providerAttemptAuthorizationSchemaVersion
    || audit.providerPlanSchemaVersion !== providerPlanSchemaVersion
    || audit.providerSendEvidenceSchemaVersion !== providerSendEvidenceSchemaVersion
    || audit.aggregateType !== 'commerce_provider_authorization'
    || audit.commandKeyHash !== record.commandKeyHash
    || audit.previousProviderAttempt !== record.previousProviderAttempt
    || audit.authorizedProviderAttempt !== record.authorizedProviderAttempt
    || audit.authorizationRevision !== record.authorizationRevision
    || audit.eventType !== 'provider_attempt_authorized'
    || audit.provider !== record.provider
    || audit.environment !== record.environment
    || audit.stripeMode !== record.stripeMode
    || audit.providerOperation !== record.providerOperation
    || audit.providerPlanCommitment !== record.providerPlanCommitment
    || audit.providerSendEvidenceCommitment !== record.providerSendEvidenceCommitment
    || audit.providerReconciliationEvidenceCommitment
      !== record.providerReconciliationEvidenceCommitment
    || audit.transitionKind !== record.transitionKind
    || audit.transitionRecordCommitment !== record.transitionRecordCommitment
    || audit.idempotencyKeyFingerprint !== record.idempotencyKeyFingerprint
    || audit.authorizedFenceEpoch !== record.authorizedFenceEpoch
    || typeof audit.providerAttemptAuthorizationCommitment !== 'string'
    || !LOWERCASE_SHA256.test(audit.providerAttemptAuthorizationCommitment)
    || audit.providerAttemptAuthorizationCommitment
      !== createCompleteProviderAttemptAuthorizationCommitment(record, authorizedAt)) {
    reject('journal_record_invalid');
  }

  const authorizationLeaseAuditDocument = await context.readRequiredLifecycleAudit(
    record.authorizedFenceEpoch + 1,
  );
  const authorizationLeaseAudit = validateProviderLeaseAudit(
    authorizationLeaseAuditDocument.value,
    record.authorizedFenceEpoch,
    prepared,
  );
  let predecessorLeaseAudit = null;
  if (record.authorizedFenceEpoch > 1) {
    const predecessorDocument = await context.readRequiredLifecycleAudit(
      record.authorizedFenceEpoch,
    );
    predecessorLeaseAudit = validateProviderLeaseAudit(
      predecessorDocument.value,
      record.authorizedFenceEpoch - 1,
      prepared,
    );
  }
  validateProviderLeaseChronology(
    authorizationLeaseAudit,
    predecessorLeaseAudit,
    context.lifecycle,
  );
  validateProviderLeaseAgainstCurrent(authorizationLeaseAudit, context.lifecycle);
  if (compareTimestamps(authorizationLeaseAudit.occurredAt, reconciliation.recordedAt) < 0
    || compareTimestamps(authorizedAt, authorizationLeaseAudit.occurredAt) < 0
    || compareTimestamps(authorizedAt, authorizationLeaseAudit.leaseExpiresAt) >= 0) {
    reject('journal_record_invalid');
  }

  if (record.transitionRecordCommitment !== prepared.transitionRecordCommitment) {
    reject('command_conflict');
  }
  return Object.freeze({ record, audit, authorizedAt });
}

async function readProviderAttemptAuthorizationContext(transaction, prepared) {
  const context = await readProviderReconciliationContext(transaction, prepared);
  if (context.providerReconciliation === null) reject('journal_record_invalid');

  const authorizationSnapshot = await transaction.get(
    prepared.providerAttemptAuthorizationRef,
  );
  const authorizationAuditSnapshot = await transaction.get(
    prepared.providerAttemptAuthorizationAuditRef,
  );
  const authorizationDocument = readSnapshot(authorizationSnapshot);
  const authorizationAudit = readSnapshot(authorizationAuditSnapshot);
  if (authorizationDocument.exists !== authorizationAudit.exists) {
    reject('journal_record_invalid');
  }
  if (!authorizationDocument.exists) {
    return Object.freeze({ ...context, providerAttemptAuthorization: null });
  }
  const providerAttemptAuthorization = await parseProviderAttemptAuthorizationPair(
    authorizationDocument.value,
    authorizationAudit.value,
    prepared,
    context,
  );
  return Object.freeze({ ...context, providerAttemptAuthorization });
}

function validateActiveProviderPlanLease(prepared, lifecycle) {
  if (lifecycle.record.state !== 'leased'
    || lifecycle.record.leaseOwnerFingerprint !== prepared.leaseOwnerFingerprint
    || lifecycle.record.fenceEpoch !== prepared.expectedFenceEpoch
    || compareTimestamps(prepared.occurredAtParts, lifecycle.leaseExpiresAt) >= 0) {
    reject('lease_stale');
  }
  return compareTimestamps(prepared.occurredAtParts, lifecycle.leaseAcquiredAt) >= 0;
}

const PROVIDER_PLAN_BOUND = Object.freeze({
  journalSchemaVersion,
  providerPlanSchemaVersion,
  outcome: 'provider_plan_bound',
  state: 'planned',
});
const PROVIDER_PLAN_EXISTING = Object.freeze({
  journalSchemaVersion,
  providerPlanSchemaVersion,
  outcome: 'provider_plan_existing',
  state: 'planned',
});

async function bindInitialStripeProviderPlan(input) {
  const prepared = prepareProviderPlanOperation(input);

  try {
    const result = await prepared.db.runTransaction(async (transaction) => {
      const context = await readProviderPlanContext(transaction, prepared);
      if (context.providerPlan !== null) return PROVIDER_PLAN_EXISTING;
      if (!context.mayCreate) reject('lease_stale');

      transaction.create(prepared.providerPlanRef, prepared.providerPlanRecord);
      transaction.create(prepared.providerPlanAuditRef, prepared.providerPlanAuditRecord);
      return PROVIDER_PLAN_BOUND;
    }, TRANSACTION_OPTIONS);

    if (result !== PROVIDER_PLAN_BOUND && result !== PROVIDER_PLAN_EXISTING) {
      reject('journal_unavailable');
    }
    return result;
  } catch (error) {
    if (error instanceof CommerceCommandJournalError) throw error;
    reject('journal_unavailable');
  }
}

const PROVIDER_SEND_PERMITTED = Object.freeze({
  journalSchemaVersion,
  providerPlanSchemaVersion,
  providerSendEvidenceSchemaVersion,
  outcome: 'send_permitted',
  state: 'pre_send_recorded',
});
const PROVIDER_RECONCILIATION_REQUIRED = Object.freeze({
  journalSchemaVersion,
  providerPlanSchemaVersion,
  providerSendEvidenceSchemaVersion,
  outcome: 'reconciliation_required',
  state: 'provider_outcome_unknown',
});

async function recordInitialStripeSendEvidence(input) {
  const prepared = prepareProviderSendOperation(input);
  const permittedTransactionResults = new Set();

  try {
    const result = await prepared.db.runTransaction(async (transaction) => {
      const context = await readProviderSendContext(transaction, prepared);
      const createPermittedResult = (prePostRecordedAt, automaticRetryDeadlineAt) => {
        const permitted = Object.freeze({
          transactionCheckedAt: prepared.occurredAtParts,
          leaseExpiresAt: context.lifecycle.leaseExpiresAt,
          prePostRecordedAt,
          automaticRetryDeadlineAt,
        });
        permittedTransactionResults.add(permitted);
        return permitted;
      };
      if (context.providerSend === null) {
        if (!context.mayCreate
          || compareTimestamps(
            prepared.occurredAtParts,
            context.providerPlan.boundAt,
          ) < 0) {
          return PROVIDER_RECONCILIATION_REQUIRED;
        }
        const pair = createProviderSendPair(prepared, context.providerPlan);
        const deadline = readTimestamp(pair.record.automaticRetryDeadlineAt);
        if (deadline === null) reject('journal_unavailable');
        transaction.create(prepared.providerSendRef, pair.record);
        transaction.create(
          prepared.providerSendAuditRef,
          pair.audit,
        );
        return createPermittedResult(prepared.occurredAtParts, deadline);
      }

      if (context.providerSend.timeUnknown
        || !context.mayCreate
        || compareTimestamps(
          prepared.occurredAtParts,
          context.providerSend.prePostRecordedAt,
        ) < 0
        || compareTimestamps(
          prepared.occurredAtParts,
          context.providerSend.automaticRetryDeadlineAt,
        ) >= 0) {
        return PROVIDER_RECONCILIATION_REQUIRED;
      }
      return createPermittedResult(
        context.providerSend.prePostRecordedAt,
        context.providerSend.automaticRetryDeadlineAt,
      );
    }, TRANSACTION_OPTIONS);

    if (result === PROVIDER_RECONCILIATION_REQUIRED) return result;
    if (!permittedTransactionResults.has(result)) {
      reject('journal_unavailable');
    }
    const returnedAt = readTimestamp(captureTrustedTimestamp());
    if (returnedAt === null
      || compareTimestamps(returnedAt, result.transactionCheckedAt) < 0
      || compareTimestamps(returnedAt, result.prePostRecordedAt) < 0
      || compareTimestamps(returnedAt, result.leaseExpiresAt) >= 0
      || compareTimestamps(returnedAt, result.automaticRetryDeadlineAt) >= 0) {
      return PROVIDER_RECONCILIATION_REQUIRED;
    }
    return PROVIDER_SEND_PERMITTED;
  } catch (error) {
    if (error instanceof CommerceCommandJournalError) throw error;
    reject('journal_unavailable');
  }
}

const PROVIDER_RECONCILIATION_PERSISTED = Object.freeze({
  journalSchemaVersion,
  providerReconciliationEvidenceSchemaVersion,
  reconciliationPolicySchemaVersion,
  outcome: 'reconciliation_candidate_persisted',
  state: 'requires_separate_authorization',
});

async function recordInitialStripeReconciliationEvidence(input) {
  const prepared = prepareProviderReconciliationOperation(input);
  const permittedTransactionResults = new Set();
  const permitResult = (value, recordedAt = null) => {
    const permitted = Object.freeze({ value, recordedAt });
    permittedTransactionResults.add(permitted);
    return permitted;
  };

  try {
    const result = await prepared.db.runTransaction(async (transaction) => {
      const context = await readProviderReconciliationContext(transaction, prepared);
      if (context.providerReconciliation !== null) {
        return permitResult(
          PROVIDER_RECONCILIATION_PERSISTED,
          context.providerReconciliation.recordedAt,
        );
      }
      if (prepared.reconciliationClassification.classification
          !== 'new_attempt_candidate'
        || prepared.reconciliationClassification.state
          !== 'requires_persistence_and_authorization'
        || compareTimestamps(
          prepared.occurredAtParts,
          context.providerSend.automaticRetryDeadlineAt,
        ) < 0
        || context.lifecycle.record.state !== 'leased'
        || compareTimestamps(
          prepared.occurredAtParts,
          context.lifecycle.leaseExpiresAt,
        ) < 0) {
        return permitResult(prepared.reconciliationClassification);
      }

      const pair = createProviderReconciliationPair(prepared, context);
      transaction.create(prepared.providerReconciliationRef, pair.record);
      transaction.create(prepared.providerReconciliationAuditRef, pair.audit);
      return permitResult(
        PROVIDER_RECONCILIATION_PERSISTED,
        prepared.occurredAtParts,
      );
    }, TRANSACTION_OPTIONS);

    if (!permittedTransactionResults.has(result)
      || (result.value !== PROVIDER_RECONCILIATION_PERSISTED
        && result.value !== prepared.reconciliationClassification)) {
      reject('journal_unavailable');
    }
    if (result.value === PROVIDER_RECONCILIATION_PERSISTED) {
      const returnedAt = readTimestamp(captureTrustedTimestamp());
      if (result.recordedAt === null
        || returnedAt === null
        || compareTimestamps(returnedAt, result.recordedAt) < 0) {
        reject('journal_record_invalid');
      }
    } else if (result.recordedAt !== null) {
      reject('journal_unavailable');
    }
    return result.value;
  } catch (error) {
    if (error instanceof CommerceCommandJournalError) throw error;
    reject('journal_unavailable');
  }
}

const PROVIDER_ATTEMPT_AUTHORIZED = Object.freeze({
  journalSchemaVersion,
  providerAttemptAuthorizationSchemaVersion,
  outcome: 'provider_attempt_authorized',
  state: 'requires_plan_binding',
});

async function authorizeNextStripeProviderAttempt(input) {
  const prepared = prepareNextProviderAttemptAuthorizationOperation(input);
  const permittedTransactionResults = new Set();
  const permitResult = (authorizedAt) => {
    const permitted = Object.freeze({ authorizedAt });
    permittedTransactionResults.add(permitted);
    return permitted;
  };

  try {
    const result = await prepared.db.runTransaction(async (transaction) => {
      const context = await readProviderAttemptAuthorizationContext(transaction, prepared);
      if (!validateActiveProviderPlanLease(prepared, context.lifecycle)
        || context.lifecycle.record.fenceEpoch
          <= context.providerReconciliation.record.observedFenceEpoch
        || compareTimestamps(
          context.lifecycle.leaseAcquiredAt,
          context.providerReconciliation.recordedAt,
        ) < 0) {
        reject('lease_stale');
      }
      if (context.providerAttemptAuthorization !== null) {
        return permitResult(context.providerAttemptAuthorization.authorizedAt);
      }

      const pair = createProviderAttemptAuthorizationPair(prepared, context);
      transaction.create(prepared.providerAttemptAuthorizationRef, pair.record);
      transaction.create(prepared.providerAttemptAuthorizationAuditRef, pair.audit);
      return permitResult(prepared.occurredAtParts);
    }, TRANSACTION_OPTIONS);

    if (!permittedTransactionResults.has(result) || result.authorizedAt === null) {
      reject('journal_unavailable');
    }
    const returnedAt = readTimestamp(captureTrustedTimestamp());
    if (returnedAt === null
      || compareTimestamps(returnedAt, result.authorizedAt) < 0) {
      reject('journal_record_invalid');
    }
    return PROVIDER_ATTEMPT_AUTHORIZED;
  } catch (error) {
    if (error instanceof CommerceCommandJournalError) throw error;
    reject('journal_unavailable');
  }
}

const REGISTERED_NEW = Object.freeze({
  journalSchemaVersion,
  outcome: 'registered_new',
  state: COMMAND_STATE,
});
const REGISTERED_EXISTING = Object.freeze({
  journalSchemaVersion,
  outcome: 'registered_existing',
  state: COMMAND_STATE,
});

async function registerCommerceCommand(input) {
  const prepared = prepareIdentity(input, INPUT_FIELDS);
  const { values, callerScopeKind } = prepared;

  let occurredAt;
  let commandRef;
  let auditRef;
  try {
    occurredAt = captureTrustedTimestamp();
    commandRef = values.db.collection(COMMAND_COLLECTION).doc(prepared.commandKeyHash);
    auditRef = values.db.collection(AUDIT_COLLECTION).doc(
      auditDocumentId(prepared.commandKeyHash, COMMAND_REVISION),
    );
  } catch (error) {
    if (error instanceof CommerceCommandJournalError) throw error;
    reject('journal_unavailable');
  }

  const commandRecord = Object.freeze({
    journalSchemaVersion,
    commandIdentityVersion,
    endpointSchemaVersion: values.endpointSchemaVersion,
    environment: values.environment,
    callerScopeKind,
    commandType: values.commandType,
    payloadFingerprint: prepared.expected.payloadFingerprint,
    state: COMMAND_STATE,
    revision: COMMAND_REVISION,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  });
  const auditRecord = Object.freeze({
    auditSchemaVersion,
    aggregateType: 'commerce_command',
    commandKeyHash: prepared.commandKeyHash,
    commandRevision: COMMAND_REVISION,
    eventType: 'command_registered',
    fromState: null,
    toState: COMMAND_STATE,
    environment: values.environment,
    callerScopeKind,
    commandType: values.commandType,
    occurredAt,
  });

  try {
    const result = await values.db.runTransaction(async (transaction) => {
      const commandSnapshot = await transaction.get(commandRef);
      const auditSnapshot = await transaction.get(auditRef);
      const command = readSnapshot(commandSnapshot);
      const audit = readSnapshot(auditSnapshot);

      if (command.exists !== audit.exists) reject('journal_record_invalid');
      if (command.exists) {
        validateExistingPair(command.value, audit.value, prepared.expected);
        return REGISTERED_EXISTING;
      }

      transaction.create(commandRef, commandRecord);
      transaction.create(auditRef, auditRecord);
      return REGISTERED_NEW;
    }, TRANSACTION_OPTIONS);

    if (result !== REGISTERED_NEW && result !== REGISTERED_EXISTING) {
      reject('journal_unavailable');
    }
    return result;
  } catch (error) {
    if (error instanceof CommerceCommandJournalError) throw error;
    reject('journal_unavailable');
  }
}

async function runLifecycleTransaction(prepared, callback) {
  try {
    const result = await prepared.values.db.runTransaction(callback, TRANSACTION_OPTIONS);
    return validateLifecycleResult(result);
  } catch (error) {
    if (error instanceof CommerceCommandJournalError) throw error;
    reject('journal_unavailable');
  }
}

async function acquireCommerceCommandLease(input) {
  const prepared = prepareLifecycleOperation(input, ACQUIRE_INPUT_FIELDS, 'acquire');

  return runLifecycleTransaction(prepared, async (transaction) => {
    const context = await readLifecycleContext(transaction, prepared);
    if (context.lifecycle === null) {
      const lifecycleRecord = buildLeasedLifecycle(prepared);
      const auditRecord = buildLifecycleAudit(
        prepared,
        lifecycleRecord,
        'command_lease_acquired',
        'registered',
      );
      writeLifecycleTransition(
        transaction,
        prepared,
        context,
        lifecycleRecord,
        auditRecord,
      );
      return createLeaseResult(
        lifecycleRecord.fenceEpoch,
        lifecycleRecord.leaseExpiresAt,
      );
    }

    const { lifecycle } = context;
    if (lifecycle.record.state === 'succeeded') return TERMINAL_SUCCEEDED;
    if (lifecycle.record.state === 'failed_final') return TERMINAL_FAILED_FINAL;
    if (compareTimestamps(prepared.occurredAtParts, lifecycle.leaseExpiresAt) < 0) {
      if (lifecycle.record.leaseOwnerFingerprint !== prepared.leaseOwnerFingerprint) {
        return LEASE_BUSY;
      }
      return createLeaseResult(
        lifecycle.record.fenceEpoch,
        copyTimestamp(lifecycle.leaseExpiresAt),
      );
    }

    const lifecycleRecord = buildLeasedLifecycle(prepared, lifecycle);
    const auditRecord = buildLifecycleAudit(
      prepared,
      lifecycleRecord,
      'command_lease_taken_over',
      'leased',
    );
    writeLifecycleTransition(
      transaction,
      prepared,
      context,
      lifecycleRecord,
      auditRecord,
    );
    return createLeaseResult(
      lifecycleRecord.fenceEpoch,
      lifecycleRecord.leaseExpiresAt,
    );
  });
}

function exactTerminalRetry(prepared, lifecycle, state) {
  if (lifecycle.record.state !== state
    || lifecycle.record.leaseOwnerFingerprint !== prepared.leaseOwnerFingerprint
    || lifecycle.record.fenceEpoch !== prepared.values.expectedFenceEpoch) {
    return false;
  }
  if (state === 'succeeded') {
    return lifecycle.record.terminalCommitmentHash === prepared.terminalCommitmentHash;
  }
  return true;
}

async function finalizeCommerceCommand(input, fields, state) {
  const operation = state === 'succeeded' ? 'complete' : 'fail';
  const prepared = prepareLifecycleOperation(input, fields, operation);

  return runLifecycleTransaction(prepared, async (transaction) => {
    const context = await readLifecycleContext(transaction, prepared);
    const { lifecycle } = context;
    if (lifecycle === null) reject('lease_stale');

    if (lifecycle.record.state !== 'leased') {
      if (!exactTerminalRetry(prepared, lifecycle, state)) reject('terminal_conflict');
      return state === 'succeeded' ? TERMINAL_SUCCEEDED : TERMINAL_FAILED_FINAL;
    }

    if (compareTimestamps(prepared.occurredAtParts, lifecycle.leaseAcquiredAt) < 0
      || compareTimestamps(prepared.occurredAtParts, lifecycle.leaseExpiresAt) >= 0
      || lifecycle.record.leaseOwnerFingerprint !== prepared.leaseOwnerFingerprint
      || lifecycle.record.fenceEpoch !== prepared.values.expectedFenceEpoch) {
      reject('lease_stale');
    }

    const lifecycleRecord = buildTerminalLifecycle(prepared, lifecycle, state);
    const eventType = state === 'succeeded'
      ? 'command_succeeded'
      : 'command_failed_final';
    const auditRecord = buildLifecycleAudit(
      prepared,
      lifecycleRecord,
      eventType,
      'leased',
    );
    writeLifecycleTransition(
      transaction,
      prepared,
      context,
      lifecycleRecord,
      auditRecord,
    );
    return state === 'succeeded' ? TERMINAL_SUCCEEDED : TERMINAL_FAILED_FINAL;
  });
}

async function completeCommerceCommand(input) {
  return finalizeCommerceCommand(input, COMPLETE_INPUT_FIELDS, 'succeeded');
}

async function failCommerceCommand(input) {
  return finalizeCommerceCommand(input, FAIL_INPUT_FIELDS, 'failed_final');
}

Object.freeze(CommerceCommandJournalError.prototype);
Object.freeze(CommerceCommandJournalError);

module.exports = Object.freeze({
  journalSchemaVersion,
  lifecycleSchemaVersion,
  providerAttemptAuthorizationSchemaVersion,
  providerReconciliationEvidenceSchemaVersion,
  providerSendEvidenceSchemaVersion,
  CommerceCommandJournalError,
  acquireCommerceCommandLease,
  authorizeNextStripeProviderAttempt,
  bindInitialStripeProviderPlan,
  completeCommerceCommand,
  failCommerceCommand,
  recordInitialStripeReconciliationEvidence,
  recordInitialStripeSendEvidence,
  registerCommerceCommand,
});
