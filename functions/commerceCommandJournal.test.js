const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { inspect } = require('node:util');
const { Timestamp } = require('firebase-admin/firestore');

const {
  commandIdentityVersion,
  createCommandKey,
  createPayloadFingerprint,
  createStripeIdempotencyKey,
} = require('./commerceCommandIdentity');
const {
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
} = require('./commerceCommandJournal');

const COMMAND_ID = '018f1f6a-9d2b-4c3d-8e5f-0123456789ab';
const OTHER_COMMAND_ID = '123e4567-e89b-42d3-a456-426614174000';
const LEASE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_LEASE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const THIRD_LEASE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FOURTH_LEASE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TERMINAL_REFERENCE_FINGERPRINT = 'd'.repeat(64);
const OTHER_TERMINAL_REFERENCE_FINGERPRINT = 'e'.repeat(64);
const STRIPE_ACCOUNT_ID = 'acct_1SyntheticTest000000000001';
const OTHER_STRIPE_ACCOUNT_ID = 'acct_1SyntheticTest000000000002';
const STRIPE_API_VERSION = '2025-06-30.basil';
const STRIPE_ENDPOINT_PATH = '/v1/checkout/sessions';
const PROVIDER_OPERATION = 'checkout_session_create';
const GOLDEN_LEASE_OWNER_FINGERPRINT = '5d99ad039ee873195d1a765728e5946e87a959bf6765ccc9ea775541b10bccf1';
const GOLDEN_TERMINAL_COMMITMENT = 'abf0fc9f071bb52ec4a0f5500e61f71b14066bf12bf27befca69ef90f7d118ab';
const GOLDEN_STRIPE_ACCOUNT_FINGERPRINT = '4894d660135b684db293c373e6e31cf0ac3e9754cd15329b339325c539cac3a7';
const GOLDEN_PARAMETERS_FINGERPRINT = '59e1672330d27a526ac0c684262b556187a983e4d09c4a6a089497e44babb6e0';
const GOLDEN_IDEMPOTENCY_KEY_FINGERPRINT = '104e34d2323cce2f25e0d5f391f9ebc3b581fccc4492b5ffa5c811594a380973';
const RAW_CALLER = 'private-runner@example.test';
const HOSTILE_CANARY = 'private-runner@example.test/token?secret=do-not-copy';
const TRANSITION_RECORD_COMMITMENT = 'f'.repeat(64);
const OTHER_TRANSITION_RECORD_COMMITMENT = '1'.repeat(64);
const NOW_MILLIS = 1800000000123;
const PROVIDER_SEND_RETRY_WINDOW_MILLIS = 23 * 60 * 60 * 1000;
const HASH_MAGIC = 'mprc-commerce-command-journal-sha256';

function updateTestDigest(hash, value) {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length, 0);
  hash.update(length);
  hash.update(bytes);
}

function testDigest(domain, fields) {
  const hash = createHash('sha256');
  updateTestDigest(hash, HASH_MAGIC);
  updateTestDigest(hash, domain);
  for (const [name, value] of fields) {
    updateTestDigest(hash, name);
    updateTestDigest(hash, value);
  }
  return hash.digest('hex');
}

function reconciliationEvidenceCommitment(record) {
  return testDigest('mprc.command-provider-reconciliation-evidence-complete.v1', [
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
    ['observedLeaseExpiresAtSeconds', String(record.observedLeaseExpiresAt.seconds)],
    ['observedLeaseExpiresAtNanoseconds', String(record.observedLeaseExpiresAt.nanoseconds)],
    ['recordedAtSeconds', String(record.recordedAt.seconds)],
    ['recordedAtNanoseconds', String(record.recordedAt.nanoseconds)],
  ]);
}

function frozenRecord(entries = []) {
  const value = Object.create(null);
  for (const [key, child] of entries) value[key] = child;
  return Object.freeze(value);
}

function validPayload(quantity = 1) {
  return frozenRecord([
    ['amountCents', 2500],
    ['currency', 'usd'],
    ['line', frozenRecord([['sku', 'shirt_s'], ['quantity', quantity]])],
  ]);
}

function validInput(db, overrides = {}) {
  return {
    db,
    environment: 'test',
    callerScope: { kind: 'firebase_uid', value: RAW_CALLER },
    commandId: COMMAND_ID,
    commandType: 'merch.checkout.create',
    endpointSchemaVersion: 1,
    payload: validPayload(),
    ...overrides,
  };
}

function documentPath(collectionName, documentId) {
  return `${collectionName}/${documentId}`;
}

function referenceFromPath(path_) {
  const parts = path_.split('/');
  return Object.freeze({
    id: parts[parts.length - 1],
    path: path_,
    collection: jest.fn((collectionName) => Object.freeze({
      doc: jest.fn((documentId) => referenceFromPath(`${path_}/${collectionName}/${documentId}`)),
    })),
  });
}

function reference(collectionName, documentId) {
  return referenceFromPath(documentPath(collectionName, documentId));
}

function snapshot(value) {
  return Object.freeze({
    exists: value !== undefined,
    data: jest.fn(() => value),
  });
}

function cloneStore(store) {
  return new Map([...store.entries()]);
}

function createMockDb(seed = [], options = {}) {
  const store = options.sharedStore || new Map(seed);
  const callbackRuns = [];
  const collectionCalls = [];
  let rejectAfterCommit = options.rejectAfterCommit;
  const db = {
    collection: jest.fn((collectionName) => {
      collectionCalls.push(collectionName);
      return {
        doc: jest.fn((documentId) => reference(collectionName, documentId)),
      };
    }),
    runTransaction: jest.fn(async (callback) => {
      if (options.rejectBeforeCallback) throw options.rejectBeforeCallback;
      const numberOfRuns = options.callbackRuns || 1;
      let result;
      let finalWrites = [];

      for (let index = 0; index < numberOfRuns; index += 1) {
        if (options.beforeCallbackRun) await options.beforeCallbackRun(index);
        const readView = cloneStore(store);
        const writes = [];
        const transaction = Object.freeze({
          get: jest.fn(async (ref) => snapshot(readView.get(ref.path))),
          create: jest.fn((ref, value) => {
            writes.push(Object.freeze({ operation: 'create', ref, value }));
          }),
          set: jest.fn((ref, value) => {
            writes.push(Object.freeze({ operation: 'set', ref, value }));
          }),
        });
        callbackRuns.push({ transaction, writes });
        result = await callback(transaction);
        finalWrites = writes;
      }

      if (options.rejectCommit) throw options.rejectCommit;
      for (const write of finalWrites) {
        if (write.operation === 'create' && store.has(write.ref.path)) {
          throw new Error('mock create precondition failed');
        }
      }
      for (const write of finalWrites) store.set(write.ref.path, write.value);
      if (rejectAfterCommit) {
        const error = rejectAfterCommit;
        rejectAfterCommit = null;
        throw error;
      }
      if (Object.prototype.hasOwnProperty.call(options, 'returnedValue')) {
        return options.returnedValue;
      }
      return result;
    }),
  };
  return Object.freeze({ db, store, callbackRuns, collectionCalls });
}

function expectedIdentity(input) {
  const command = createCommandKey({
    environment: input.environment,
    callerScope: input.callerScope,
    commandId: input.commandId,
  });
  const fingerprint = createPayloadFingerprint({
    commandType: input.commandType,
    payload: input.payload,
  });
  const auditId = `commerce_command_${command.commandKeyHash}_0000000001`;
  return Object.freeze({
    commandKeyHash: command.commandKeyHash,
    payloadFingerprint: fingerprint.payloadFingerprint,
    commandPath: documentPath('checkoutRequests', command.commandKeyHash),
    auditPath: documentPath('auditEvents', auditId),
  });
}

function exactPair(input, timestamp = Timestamp.fromMillis(NOW_MILLIS)) {
  const identity = expectedIdentity(input);
  const command = {
    journalSchemaVersion: 1,
    commandIdentityVersion,
    endpointSchemaVersion: input.endpointSchemaVersion,
    environment: input.environment,
    callerScopeKind: input.callerScope.kind,
    commandType: input.commandType,
    payloadFingerprint: identity.payloadFingerprint,
    state: 'registered',
    revision: 1,
    createdAt: timestamp,
    updatedAt: Timestamp.fromMillis(timestamp.toMillis()),
  };
  const audit = {
    auditSchemaVersion: 1,
    aggregateType: 'commerce_command',
    commandKeyHash: identity.commandKeyHash,
    commandRevision: 1,
    eventType: 'command_registered',
    fromState: null,
    toState: 'registered',
    environment: input.environment,
    callerScopeKind: input.callerScope.kind,
    commandType: input.commandType,
    occurredAt: Timestamp.fromMillis(timestamp.toMillis()),
  };
  return Object.freeze({
    identity,
    command,
    audit,
    seed: Object.freeze([
      [identity.commandPath, command],
      [identity.auditPath, audit],
    ]),
  });
}

function leaseInput(db, overrides = {}) {
  return {
    ...validInput(db),
    leaseId: LEASE_ID,
    ...overrides,
  };
}

function completionInput(db, overrides = {}) {
  return {
    ...leaseInput(db),
    expectedFenceEpoch: 1,
    terminalReferenceFingerprint: TERMINAL_REFERENCE_FINGERPRINT,
    ...overrides,
  };
}

function failureInput(db, overrides = {}) {
  return {
    ...leaseInput(db),
    expectedFenceEpoch: 1,
    ...overrides,
  };
}

function validProviderParameters(entries = null) {
  return frozenRecord(entries || [
    ['amount_total', 2500],
    ['currency', 'usd'],
    ['synthetic_reference', HOSTILE_CANARY],
  ]);
}

function providerPlanInput(db, overrides = {}) {
  return {
    ...leaseInput(db),
    expectedFenceEpoch: 1,
    stripeAccountId: STRIPE_ACCOUNT_ID,
    stripeMode: 'test',
    stripeApiVersion: STRIPE_API_VERSION,
    endpointPath: STRIPE_ENDPOINT_PATH,
    providerOperation: PROVIDER_OPERATION,
    providerParameters: validProviderParameters(),
    ...overrides,
  };
}

function candidateReconciliationEvidence(overrides = {}) {
  return {
    reconciliationPolicySchemaVersion: 1,
    provider: 'stripe',
    providerAttempt: 1,
    planBinding: 'exact',
    evidenceSource: 'trusted_dispatch_history',
    evidenceCompleteness: 'complete',
    dispatchEvidence: 'execution_never_began',
    responseEvidence: 'none',
    idempotencyEvidence: 'not_relied_upon',
    providerObjectEvidence: 'none',
    paymentEvidence: 'none',
    eventEvidence: 'none',
    searchEvidence: 'none',
    businessTransitionEvidence: 'same_operation_eligible',
    ...overrides,
  };
}

function expiredReconciliationEvidence(overrides = {}) {
  return candidateReconciliationEvidence({
    evidenceSource: 'verified_provider_and_event',
    dispatchEvidence: 'execution_started',
    responseEvidence: 'accepted',
    providerObjectEvidence: 'exact_expired',
    paymentEvidence: 'unpaid',
    eventEvidence: 'verified_expiry',
    searchEvidence: 'exact_lookup_complete',
    businessTransitionEvidence: 'new_generation_eligible',
    ...overrides,
  });
}

function providerReconciliationInput(db, overrides = {}) {
  return {
    ...validInput(db),
    stripeAccountId: STRIPE_ACCOUNT_ID,
    stripeMode: 'test',
    stripeApiVersion: STRIPE_API_VERSION,
    endpointPath: STRIPE_ENDPOINT_PATH,
    providerOperation: PROVIDER_OPERATION,
    providerParameters: validProviderParameters(),
    reconciliationEvidence: candidateReconciliationEvidence(),
    ...overrides,
  };
}

function providerAuthorizationInput(db, overrides = {}) {
  return {
    ...providerReconciliationInput(db),
    leaseId: OTHER_LEASE_ID,
    expectedFenceEpoch: 2,
    transitionAuthorization: {
      kind: 'retry_same_operation',
      recordCommitment: TRANSITION_RECORD_COMMITMENT,
    },
    ...overrides,
  };
}

function lifecyclePaths(input, revision = 2) {
  const identity = expectedIdentity(input);
  return Object.freeze({
    ...identity,
    lifecyclePath: `${identity.commandPath}/lifecycle/current`,
    lifecycleAuditPath: documentPath(
      'auditEvents',
      `commerce_command_${identity.commandKeyHash}_${String(revision).padStart(10, '0')}`,
    ),
  });
}

function providerPlanPaths(input) {
  const identity = expectedIdentity(input);
  return Object.freeze({
    ...lifecyclePaths(input),
    providerPlanPath: `${identity.commandPath}/providerAttempts/0000000001`,
    providerPlanAuditPath: documentPath(
      'auditEvents',
      `commerce_provider_attempt_${identity.commandKeyHash}_0000000001`,
    ),
  });
}

function providerSendPaths(input) {
  const paths = providerPlanPaths(input);
  return Object.freeze({
    ...paths,
    providerSendPath: `${paths.providerPlanPath}/sendEvidence/first`,
    providerSendAuditPath: documentPath(
      'auditEvents',
      `commerce_provider_send_${paths.commandKeyHash}_0000000001`,
    ),
  });
}

function providerReconciliationPaths(input) {
  const paths = providerSendPaths(input);
  return Object.freeze({
    ...paths,
    providerReconciliationPath: (
      `${paths.providerPlanPath}/reconciliationEvidence/0000000001`
    ),
    providerReconciliationAuditPath: documentPath(
      'auditEvents',
      `commerce_provider_reconciliation_${paths.commandKeyHash}_0000000001_0000000001`,
    ),
  });
}

function providerAuthorizationPaths(input) {
  const paths = providerReconciliationPaths(input);
  return Object.freeze({
    ...paths,
    providerAuthorizationPath: (
      `${paths.providerReconciliationPath}/nextAttemptAuthorizations/0000000002`
    ),
    providerAuthorizationAuditPath: documentPath(
      'auditEvents',
      `commerce_provider_authorization_${paths.commandKeyHash}`
        + '_0000000001_0000000001_0000000002',
    ),
  });
}

function captureError(callback) {
  return Promise.resolve()
    .then(callback)
    .then(() => {
      throw new Error('Expected callback to reject');
    }, (error) => error);
}

async function expectSafeError(callback, reason, forbidden = []) {
  const error = await captureError(callback);
  expect(error).toBeInstanceOf(CommerceCommandJournalError);
  expect(error).toMatchObject({
    name: 'CommerceCommandJournalError',
    code: 'commerce_command_journal_error',
    reason,
  });
  expect(Object.isFrozen(error)).toBe(true);
  expect(Reflect.ownKeys(error).sort()).toEqual([
    'code',
    'message',
    'name',
    'reason',
    'stack',
  ]);
  const rendered = [
    error.message,
    error.stack,
    String(error),
    JSON.stringify(error),
    inspect(error),
  ].join('\n');
  for (const value of [HOSTILE_CANARY, RAW_CALLER, COMMAND_ID, ...forbidden]) {
    expect(rendered).not.toContain(value);
  }
  return error;
}

describe('atomic commerce command registration', () => {
  let timestampNow;

  beforeEach(() => {
    timestampNow = jest.spyOn(Timestamp, 'now')
      .mockImplementation(() => Timestamp.fromMillis(NOW_MILLIS));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('creates the exact command and deterministic audit partner atomically', async () => {
    const mock = createMockDb();
    const input = validInput(mock.db);
    const identity = expectedIdentity(input);

    const result = await registerCommerceCommand(input);

    expect(result).toEqual({
      journalSchemaVersion: 1,
      outcome: 'registered_new',
      state: 'registered',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(timestampNow).toHaveBeenCalledTimes(1);
    expect(mock.collectionCalls).toEqual(['checkoutRequests', 'auditEvents']);
    expect(mock.callbackRuns).toHaveLength(1);
    const [{ transaction, writes }] = mock.callbackRuns;
    expect(transaction.get).toHaveBeenCalledTimes(2);
    expect(transaction.create).toHaveBeenCalledTimes(2);
    expect(transaction.get.mock.invocationCallOrder[1])
      .toBeLessThan(transaction.create.mock.invocationCallOrder[0]);
    expect(writes.map((write) => write.ref.path)).toEqual([
      identity.commandPath,
      identity.auditPath,
    ]);

    const command = mock.store.get(identity.commandPath);
    const audit = mock.store.get(identity.auditPath);
    expect(command).toEqual({
      journalSchemaVersion: 1,
      commandIdentityVersion: 1,
      endpointSchemaVersion: 1,
      environment: 'test',
      callerScopeKind: 'firebase_uid',
      commandType: 'merch.checkout.create',
      payloadFingerprint: identity.payloadFingerprint,
      state: 'registered',
      revision: 1,
      createdAt: expect.any(Timestamp),
      updatedAt: expect.any(Timestamp),
    });
    expect(audit).toEqual({
      auditSchemaVersion: 1,
      aggregateType: 'commerce_command',
      commandKeyHash: identity.commandKeyHash,
      commandRevision: 1,
      eventType: 'command_registered',
      fromState: null,
      toState: 'registered',
      environment: 'test',
      callerScopeKind: 'firebase_uid',
      commandType: 'merch.checkout.create',
      occurredAt: expect.any(Timestamp),
    });
    expect(command.createdAt).toBe(command.updatedAt);
    expect(command.createdAt).toBe(audit.occurredAt);
    expect(Object.isFrozen(command)).toBe(true);
    expect(Object.isFrozen(audit)).toBe(true);
    expect(Object.isFrozen(command.createdAt)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/command|payload|caller|uuid|path|hash|execute/i);
  });

  test('returns a fixed read-only existing outcome for the exact pair', async () => {
    const placeholder = createMockDb();
    const input = validInput(placeholder.db);
    const pair = exactPair(input);
    const mock = createMockDb(pair.seed);
    const beforeCommand = { ...pair.command };
    const beforeAudit = { ...pair.audit };

    const result = await registerCommerceCommand(validInput(mock.db));

    expect(result).toEqual({
      journalSchemaVersion: 1,
      outcome: 'registered_existing',
      state: 'registered',
    });
    expect(mock.callbackRuns[0].transaction.create).not.toHaveBeenCalled();
    expect(mock.store.get(pair.identity.commandPath)).toBe(pair.command);
    expect(mock.store.get(pair.identity.auditPath)).toBe(pair.audit);
    expect(mock.store.get(pair.identity.commandPath)).toEqual(beforeCommand);
    expect(mock.store.get(pair.identity.auditPath)).toEqual(beforeAudit);
  });

  test('repeated transaction callbacks reuse one timestamp and have no callback-local clock', async () => {
    const mock = createMockDb([], { callbackRuns: 4 });
    const result = await registerCommerceCommand(validInput(mock.db));

    expect(result.outcome).toBe('registered_new');
    expect(timestampNow).toHaveBeenCalledTimes(1);
    expect(mock.callbackRuns).toHaveLength(4);
    const timestamps = mock.callbackRuns.flatMap(({ writes }) => [
      writes[0].value.createdAt,
      writes[0].value.updatedAt,
      writes[1].value.occurredAt,
    ]);
    expect(new Set(timestamps).size).toBe(1);
    expect(mock.store.size).toBe(2);
  });

  test('another command ID receives a separate pseudonymous journal path', async () => {
    const mock = createMockDb();
    const first = validInput(mock.db);
    const second = validInput(mock.db, { commandId: OTHER_COMMAND_ID });
    const firstIdentity = expectedIdentity(first);
    const secondIdentity = expectedIdentity(second);

    await registerCommerceCommand(first);
    await registerCommerceCommand(second);

    expect(firstIdentity.commandPath).not.toBe(secondIdentity.commandPath);
    expect(mock.store.size).toBe(4);
  });

  test('stores and returns no raw caller, UUID, or payload canary', async () => {
    const mock = createMockDb();
    const payload = frozenRecord([
      ['note', HOSTILE_CANARY],
      ['quantity', 1],
    ]);

    const result = await registerCommerceCommand(validInput(mock.db, { payload }));
    const rendered = JSON.stringify({
      result,
      documents: [...mock.store.values()],
    });

    expect(rendered).not.toContain(HOSTILE_CANARY);
    expect(rendered).not.toContain(RAW_CALLER);
    expect(rendered).not.toContain(COMMAND_ID);
  });
});

describe('commerce command lease, fence, and terminal lifecycle', () => {
  let nowMillis;
  let timestampNow;

  beforeEach(() => {
    nowMillis = NOW_MILLIS;
    timestampNow = jest.spyOn(Timestamp, 'now')
      .mockImplementation(() => Timestamp.fromMillis(nowMillis));
  });

  afterEach(() => jest.restoreAllMocks());

  async function registerAtBaseAndAcquire(mock, overrides = {}) {
    await registerCommerceCommand(validInput(mock.db));
    nowMillis += 1000;
    return acquireCommerceCommandLease(leaseInput(mock.db, overrides));
  }

  test('creates an exact separate lifecycle and revision-2 audit without mutating B2A', async () => {
    const mock = createMockDb();
    const args = leaseInput(mock.db);
    const paths = lifecyclePaths(args);
    await registerCommerceCommand(validInput(mock.db));
    const commandBefore = mock.store.get(paths.commandPath);
    const auditBefore = mock.store.get(paths.auditPath);
    nowMillis += 1000;

    const result = await acquireCommerceCommandLease(args);

    expect(result).toEqual({
      journalSchemaVersion: 1,
      lifecycleSchemaVersion: 1,
      outcome: 'lease_acquired',
      state: 'leased',
      fenceEpoch: 1,
      leaseExpiresAt: {
        seconds: Math.floor((NOW_MILLIS + 61000) / 1000),
        nanoseconds: ((NOW_MILLIS + 61000) % 1000) * 1000000,
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.leaseExpiresAt)).toBe(true);
    expect(mock.store.get(paths.commandPath)).toBe(commandBefore);
    expect(mock.store.get(paths.auditPath)).toBe(auditBefore);
    expect(mock.store.get(paths.lifecyclePath)).toEqual({
      lifecycleSchemaVersion: 1,
      commandKeyHash: paths.commandKeyHash,
      state: 'leased',
      commandRevision: 2,
      fenceEpoch: 1,
      leaseOwnerFingerprint: GOLDEN_LEASE_OWNER_FINGERPRINT,
      leaseAcquiredAt: expect.any(Timestamp),
      leaseExpiresAt: expect.any(Timestamp),
      createdAt: expect.any(Timestamp),
      updatedAt: expect.any(Timestamp),
      terminalCommitmentKind: null,
      terminalCommitmentHash: null,
    });
    expect(mock.store.get(paths.lifecycleAuditPath)).toEqual({
      auditSchemaVersion: 2,
      aggregateType: 'commerce_command',
      commandKeyHash: paths.commandKeyHash,
      commandRevision: 2,
      eventType: 'command_lease_acquired',
      fromState: 'registered',
      toState: 'leased',
      environment: 'test',
      callerScopeKind: 'firebase_uid',
      commandType: 'merch.checkout.create',
      fenceEpoch: 1,
      leaseExpiresAt: expect.any(Timestamp),
      occurredAt: expect.any(Timestamp),
    });
    const lifecycle = mock.store.get(paths.lifecyclePath);
    const audit = mock.store.get(paths.lifecycleAuditPath);
    expect(lifecycle.createdAt).toBe(lifecycle.leaseAcquiredAt);
    expect(lifecycle.updatedAt).toBe(lifecycle.leaseAcquiredAt);
    expect(lifecycle.leaseExpiresAt).toBe(audit.leaseExpiresAt);
    expect(lifecycle.updatedAt).toBe(audit.occurredAt);
    expect(JSON.stringify({ result, lifecycle, audit })).not.toContain(LEASE_ID);
    expect(JSON.stringify({ result, lifecycle, audit })).not.toContain(RAW_CALLER);
    expect(JSON.stringify({ result, lifecycle, audit })).not.toContain(COMMAND_ID);
  });

  test('same-holder recovery is byte-preserving while another active holder is busy', async () => {
    const mock = createMockDb();
    const first = await registerAtBaseAndAcquire(mock);
    const paths = lifecyclePaths(leaseInput(mock.db));
    const lifecycleBefore = mock.store.get(paths.lifecyclePath);
    const auditBefore = mock.store.get(paths.lifecycleAuditPath);
    const sizeBefore = mock.store.size;
    nowMillis += 5000;

    const recovered = await acquireCommerceCommandLease(leaseInput(mock.db));
    const busy = await acquireCommerceCommandLease(leaseInput(mock.db, {
      leaseId: OTHER_LEASE_ID,
    }));

    expect(recovered).toEqual(first);
    expect(busy).toEqual({
      journalSchemaVersion: 1,
      lifecycleSchemaVersion: 1,
      outcome: 'lease_busy',
      state: 'leased',
    });
    expect(Object.isFrozen(busy)).toBe(true);
    expect(busy).not.toHaveProperty('fenceEpoch');
    expect(busy).not.toHaveProperty('leaseExpiresAt');
    expect(mock.store.size).toBe(sizeBefore);
    expect(mock.store.get(paths.lifecyclePath)).toBe(lifecycleBefore);
    expect(mock.store.get(paths.lifecycleAuditPath)).toBe(auditBefore);
    const lastTwoRuns = mock.callbackRuns.slice(-2);
    for (const { transaction, writes } of lastTwoRuns) {
      expect(transaction.create).not.toHaveBeenCalled();
      expect(transaction.set).not.toHaveBeenCalled();
      expect(writes).toEqual([]);
    }
  });

  test('expiry equality permits one higher-fence takeover and rejects the old worker', async () => {
    const mock = createMockDb();
    await registerAtBaseAndAcquire(mock);
    const args = leaseInput(mock.db);
    const paths = lifecyclePaths(args);
    const rootBefore = mock.store.get(paths.commandPath);
    const firstAuditBefore = mock.store.get(paths.auditPath);
    nowMillis = NOW_MILLIS + 61000;

    const takeover = await acquireCommerceCommandLease(leaseInput(mock.db, {
      leaseId: OTHER_LEASE_ID,
    }));

    expect(takeover).toMatchObject({
      outcome: 'lease_acquired',
      state: 'leased',
      fenceEpoch: 2,
    });
    const lifecycle = mock.store.get(paths.lifecyclePath);
    expect(lifecycle).toMatchObject({
      commandRevision: 3,
      fenceEpoch: 2,
      state: 'leased',
    });
    expect(lifecycle.createdAt.toMillis()).toBe(NOW_MILLIS + 1000);
    expect(lifecycle.leaseAcquiredAt.toMillis()).toBe(NOW_MILLIS + 61000);
    expect(mock.store.get(lifecyclePaths(args, 3).lifecycleAuditPath)).toMatchObject({
      auditSchemaVersion: 2,
      commandRevision: 3,
      eventType: 'command_lease_taken_over',
      fromState: 'leased',
      toState: 'leased',
      fenceEpoch: 2,
    });
    expect(mock.store.get(paths.commandPath)).toBe(rootBefore);
    expect(mock.store.get(paths.auditPath)).toBe(firstAuditBefore);

    nowMillis += 1;
    await expectSafeError(
      () => completeCommerceCommand(completionInput(mock.db)),
      'lease_stale',
    );
    await expectSafeError(
      () => failCommerceCommand(failureInput(mock.db)),
      'lease_stale',
    );
  });

  test('the same holder after expiry receives a new fence and the old fence stays stale', async () => {
    const mock = createMockDb();
    await registerAtBaseAndAcquire(mock);
    const args = leaseInput(mock.db);
    const paths = lifecyclePaths(args);
    nowMillis = NOW_MILLIS + 61000;

    const takeover = await acquireCommerceCommandLease(args);

    expect(takeover).toMatchObject({
      outcome: 'lease_acquired',
      state: 'leased',
      fenceEpoch: 2,
    });
    expect(mock.store.get(paths.lifecyclePath)).toMatchObject({
      commandRevision: 3,
      fenceEpoch: 2,
      leaseOwnerFingerprint: GOLDEN_LEASE_OWNER_FINGERPRINT,
    });
    nowMillis += 1;
    await expectSafeError(
      () => completeCommerceCommand(completionInput(mock.db)),
      'lease_stale',
    );
    await expect(completeCommerceCommand(completionInput(mock.db, {
      expectedFenceEpoch: 2,
    }))).resolves.toMatchObject({
      outcome: 'terminal_succeeded',
      state: 'succeeded',
    });
  });

  test('holder and fence must each match independently before finalization', async () => {
    const mock = createMockDb();
    const attempts = [
      () => completeCommerceCommand(completionInput(mock.db, {
        expectedFenceEpoch: 2,
      })),
      () => failCommerceCommand(failureInput(mock.db, {
        expectedFenceEpoch: 2,
      })),
      () => completeCommerceCommand(completionInput(mock.db, {
        leaseId: OTHER_LEASE_ID,
      })),
      () => failCommerceCommand(failureInput(mock.db, {
        leaseId: OTHER_LEASE_ID,
      })),
    ];
    await registerAtBaseAndAcquire(mock);
    const paths = lifecyclePaths(leaseInput(mock.db));
    const lifecycleBefore = mock.store.get(paths.lifecyclePath);
    const sizeBefore = mock.store.size;
    nowMillis += 1;

    for (const attempt of attempts) {
      await expectSafeError(attempt, 'lease_stale');
    }
    expect(mock.store.size).toBe(sizeBefore);
    expect(mock.store.get(paths.lifecyclePath)).toBe(lifecycleBefore);
  });

  test('success is terminal, commitment-bound, and exact-retry safe after expiry', async () => {
    const mock = createMockDb();
    await registerAtBaseAndAcquire(mock);
    const args = leaseInput(mock.db);
    const paths = lifecyclePaths(args);
    nowMillis += 5000;

    const completed = await completeCommerceCommand(completionInput(mock.db));
    const lifecycleAfter = mock.store.get(paths.lifecyclePath);
    const auditAfter = mock.store.get(lifecyclePaths(args, 3).lifecycleAuditPath);
    const sizeAfter = mock.store.size;

    expect(completed).toEqual({
      journalSchemaVersion: 1,
      lifecycleSchemaVersion: 1,
      outcome: 'terminal_succeeded',
      state: 'succeeded',
    });
    expect(lifecycleAfter).toMatchObject({
      state: 'succeeded',
      commandRevision: 3,
      fenceEpoch: 1,
      leaseOwnerFingerprint: GOLDEN_LEASE_OWNER_FINGERPRINT,
      terminalCommitmentKind: 'business_record_digest',
      terminalCommitmentHash: GOLDEN_TERMINAL_COMMITMENT,
    });
    expect(auditAfter).toMatchObject({
      auditSchemaVersion: 2,
      commandRevision: 3,
      eventType: 'command_succeeded',
      fromState: 'leased',
      toState: 'succeeded',
      fenceEpoch: 1,
    });
    expect(JSON.stringify(auditAfter)).not.toContain(GOLDEN_TERMINAL_COMMITMENT);
    expect(JSON.stringify(completed)).not.toContain(GOLDEN_TERMINAL_COMMITMENT);
    expect(JSON.stringify({ lifecycleAfter, auditAfter, completed }))
      .not.toContain(TERMINAL_REFERENCE_FINGERPRINT);

    nowMillis += 120000;
    await expect(completeCommerceCommand(completionInput(mock.db))).resolves.toBe(completed);
    await expect(acquireCommerceCommandLease(leaseInput(mock.db, {
      leaseId: OTHER_LEASE_ID,
    }))).resolves.toBe(completed);
    expect(mock.store.size).toBe(sizeAfter);
    expect(mock.store.get(paths.lifecyclePath)).toBe(lifecycleAfter);
    expect(mock.store.get(lifecyclePaths(args, 3).lifecycleAuditPath)).toBe(auditAfter);

    await expectSafeError(
      () => completeCommerceCommand(completionInput(mock.db, {
        terminalReferenceFingerprint: OTHER_TERMINAL_REFERENCE_FINGERPRINT,
      })),
      'terminal_conflict',
    );
    await expectSafeError(
      () => failCommerceCommand(failureInput(mock.db)),
      'terminal_conflict',
    );
    await expectSafeError(
      () => completeCommerceCommand(completionInput(mock.db, {
        leaseId: OTHER_LEASE_ID,
      })),
      'terminal_conflict',
    );
  });

  test('fixed final failure is terminal and has no reason or commitment', async () => {
    const mock = createMockDb();
    await registerAtBaseAndAcquire(mock);
    const args = leaseInput(mock.db);
    const paths = lifecyclePaths(args);
    nowMillis += 5000;

    const failed = await failCommerceCommand(failureInput(mock.db));
    const lifecycleAfter = mock.store.get(paths.lifecyclePath);
    const auditAfter = mock.store.get(lifecyclePaths(args, 3).lifecycleAuditPath);

    expect(failed).toEqual({
      journalSchemaVersion: 1,
      lifecycleSchemaVersion: 1,
      outcome: 'terminal_failed_final',
      state: 'failed_final',
    });
    expect(lifecycleAfter).toMatchObject({
      state: 'failed_final',
      commandRevision: 3,
      fenceEpoch: 1,
      terminalCommitmentKind: null,
      terminalCommitmentHash: null,
    });
    expect(auditAfter).toMatchObject({
      eventType: 'command_failed_final',
      toState: 'failed_final',
    });
    expect(JSON.stringify({ lifecycleAfter, auditAfter })).not.toMatch(/reason|error|provider/i);

    nowMillis += 120000;
    await expect(failCommerceCommand(failureInput(mock.db))).resolves.toBe(failed);
    await expect(acquireCommerceCommandLease(leaseInput(mock.db, {
      leaseId: OTHER_LEASE_ID,
    }))).resolves.toBe(failed);
    await expectSafeError(
      () => completeCommerceCommand(completionInput(mock.db)),
      'terminal_conflict',
    );
  });

  test('register remains exact and read-only with active and terminal lifecycle state', async () => {
    for (const terminal of [null, 'succeeded', 'failed_final']) {
      const mock = createMockDb();
      const args = leaseInput(mock.db, {
        commandId: terminal === null
          ? COMMAND_ID
          : terminal === 'succeeded'
            ? OTHER_COMMAND_ID
            : 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      });
      await registerCommerceCommand(validInput(mock.db, { commandId: args.commandId }));
      const paths = lifecyclePaths(args);
      const rootBefore = mock.store.get(paths.commandPath);
      const auditBefore = mock.store.get(paths.auditPath);
      nowMillis += 1000;
      await acquireCommerceCommandLease(args);
      if (terminal === 'succeeded') {
        nowMillis += 1;
        await completeCommerceCommand({
          ...args,
          expectedFenceEpoch: 1,
          terminalReferenceFingerprint: TERMINAL_REFERENCE_FINGERPRINT,
        });
      } else if (terminal === 'failed_final') {
        nowMillis += 1;
        await failCommerceCommand({ ...args, expectedFenceEpoch: 1 });
      }

      const result = await registerCommerceCommand(validInput(mock.db, {
        commandId: args.commandId,
      }));
      expect(result).toEqual({
        journalSchemaVersion: 1,
        outcome: 'registered_existing',
        state: 'registered',
      });
      expect(mock.store.get(paths.commandPath)).toBe(rootBefore);
      expect(mock.store.get(paths.auditPath)).toBe(auditBefore);
    }
  });

  test('transaction callback retries reuse one clock and deterministic transition records', async () => {
    const placeholder = createMockDb();
    const baseInput = validInput(placeholder.db);
    const pair = exactPair(baseInput);
    const mock = createMockDb(pair.seed, { callbackRuns: 4 });
    timestampNow.mockClear();

    const result = await acquireCommerceCommandLease(leaseInput(mock.db));

    expect(result).toMatchObject({ outcome: 'lease_acquired', fenceEpoch: 1 });
    expect(timestampNow).toHaveBeenCalledTimes(1);
    expect(mock.db.runTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      { maxAttempts: 10 },
    );
    expect(mock.callbackRuns).toHaveLength(4);
    const lifecycleWrites = mock.callbackRuns.map(({ writes }) => writes[0].value);
    expect(new Set(lifecycleWrites.map((value) => value.leaseAcquiredAt)).size).toBe(1);
    expect(new Set(lifecycleWrites.map((value) => value.leaseExpiresAt)).size).toBe(1);
    expect(new Set(lifecycleWrites.map((value) => value.leaseOwnerFingerprint))).toEqual(
      new Set([GOLDEN_LEASE_OWNER_FINGERPRINT]),
    );
  });
});

describe('lifecycle fail-closed record and input boundary', () => {
  let nowMillis;

  beforeEach(() => {
    nowMillis = NOW_MILLIS;
    jest.spyOn(Timestamp, 'now')
      .mockImplementation(() => Timestamp.fromMillis(nowMillis));
  });

  afterEach(() => jest.restoreAllMocks());

  async function createActiveLease() {
    const mock = createMockDb();
    await registerCommerceCommand(validInput(mock.db));
    nowMillis += 1000;
    await acquireCommerceCommandLease(leaseInput(mock.db));
    return mock;
  }

  test('requires the exact registration pair and does not repair an orphan lifecycle', async () => {
    let mock = createMockDb();
    await expectSafeError(
      () => acquireCommerceCommandLease(leaseInput(mock.db)),
      'command_not_registered',
    );
    expect(mock.store.size).toBe(0);

    const placeholder = createMockDb();
    const paths = lifecyclePaths(leaseInput(placeholder.db));
    const orphan = Object.freeze({ hostile: HOSTILE_CANARY });
    mock = createMockDb([[paths.lifecyclePath, orphan]]);
    await expectSafeError(
      () => acquireCommerceCommandLease(leaseInput(mock.db)),
      'journal_record_invalid',
      [paths.commandKeyHash],
    );
    expect(mock.store.get(paths.lifecyclePath)).toBe(orphan);
    expect(mock.store.size).toBe(1);
  });

  test.each([
    ['future schema', (record) => ({ ...record, lifecycleSchemaVersion: 2 })],
    ['unknown state', (record) => ({ ...record, state: 'provider_sending' })],
    ['extra field', (record) => ({ ...record, unexpected: HOSTILE_CANARY })],
    ['uppercase owner fingerprint', (record) => ({
      ...record,
      leaseOwnerFingerprint: record.leaseOwnerFingerprint.toUpperCase(),
    })],
    ['bad expiry', (record) => ({
      ...record,
      leaseExpiresAt: Timestamp.fromMillis(record.leaseExpiresAt.toMillis() + 1),
    })],
    ['revision/fence mismatch', (record) => ({ ...record, commandRevision: 4 })],
  ])('rejects malformed lifecycle without repair: %s', async (_label, mutate) => {
    const mock = await createActiveLease();
    const paths = lifecyclePaths(leaseInput(mock.db));
    const malformed = mutate(mock.store.get(paths.lifecyclePath));
    mock.store.set(paths.lifecyclePath, malformed);
    const auditBefore = mock.store.get(paths.lifecycleAuditPath);

    await expectSafeError(
      () => acquireCommerceCommandLease(leaseInput(mock.db)),
      'journal_record_invalid',
      [paths.commandKeyHash],
    );

    expect(mock.store.get(paths.lifecyclePath)).toBe(malformed);
    expect(mock.store.get(paths.lifecycleAuditPath)).toBe(auditBefore);
  });

  test('rejects a missing/malformed current audit or preseeded next audit without mutation', async () => {
    for (const corruption of ['missing-current', 'malformed-current', 'preseed-next']) {
      const mock = await createActiveLease();
      const args = leaseInput(mock.db);
      const paths = lifecyclePaths(args);
      const lifecycleBefore = mock.store.get(paths.lifecyclePath);
      if (corruption === 'missing-current') {
        mock.store.delete(paths.lifecycleAuditPath);
      } else if (corruption === 'malformed-current') {
        mock.store.set(paths.lifecycleAuditPath, Object.freeze({ hostile: HOSTILE_CANARY }));
      } else {
        mock.store.set(
          lifecyclePaths(args, 3).lifecycleAuditPath,
          Object.freeze({ hostile: HOSTILE_CANARY }),
        );
      }
      const before = cloneStore(mock.store);

      await expectSafeError(
        () => acquireCommerceCommandLease(leaseInput(mock.db)),
        'journal_record_invalid',
        [paths.commandKeyHash],
      );

      expect(mock.store).toEqual(before);
      expect(mock.store.get(paths.lifecyclePath)).toBe(lifecycleBefore);
    }
  });

  test('an earlier-captured retry observes active state but cannot finalize it', async () => {
    const mock = await createActiveLease();
    const args = leaseInput(mock.db);
    const paths = lifecyclePaths(args);
    const lifecycleBefore = mock.store.get(paths.lifecyclePath);
    const sizeBefore = mock.store.size;

    nowMillis = NOW_MILLIS;
    await expect(acquireCommerceCommandLease(args)).resolves.toMatchObject({
      outcome: 'lease_acquired',
      state: 'leased',
      fenceEpoch: 1,
    });
    await expect(acquireCommerceCommandLease(leaseInput(mock.db, {
      leaseId: OTHER_LEASE_ID,
    }))).resolves.toEqual({
      journalSchemaVersion: 1,
      lifecycleSchemaVersion: 1,
      outcome: 'lease_busy',
      state: 'leased',
    });
    await expectSafeError(
      () => completeCommerceCommand(completionInput(mock.db)),
      'lease_stale',
    );
    nowMillis = NOW_MILLIS + 61000;
    await expectSafeError(
      () => completeCommerceCommand(completionInput(mock.db)),
      'lease_stale',
    );

    expect(mock.store.size).toBe(sizeBefore);
    expect(mock.store.get(paths.lifecyclePath)).toBe(lifecycleBefore);
  });

  test('registration time orders the first lease and every stored lifecycle', async () => {
    const futureRegistrationMock = createMockDb();
    nowMillis = NOW_MILLIS + 10000;
    await registerCommerceCommand(validInput(futureRegistrationMock.db));
    const futurePaths = lifecyclePaths(leaseInput(futureRegistrationMock.db));
    const rootBefore = futureRegistrationMock.store.get(futurePaths.commandPath);
    const auditBefore = futureRegistrationMock.store.get(futurePaths.auditPath);
    nowMillis = NOW_MILLIS;

    await expectSafeError(
      () => acquireCommerceCommandLease(leaseInput(futureRegistrationMock.db)),
      'journal_record_invalid',
    );
    expect(futureRegistrationMock.store.get(futurePaths.commandPath)).toBe(rootBefore);
    expect(futureRegistrationMock.store.get(futurePaths.auditPath)).toBe(auditBefore);
    expect(futureRegistrationMock.store.has(futurePaths.lifecyclePath)).toBe(false);
    expect(futureRegistrationMock.store.has(futurePaths.lifecycleAuditPath)).toBe(false);

    const earlierMock = createMockDb();
    nowMillis = NOW_MILLIS;
    await registerCommerceCommand(validInput(earlierMock.db));
    nowMillis = NOW_MILLIS + 1000;
    await acquireCommerceCommandLease(leaseInput(earlierMock.db));
    const earlierPaths = lifecyclePaths(leaseInput(earlierMock.db));
    const earlierLifecycle = earlierMock.store.get(earlierPaths.lifecyclePath);
    const earlierLifecycleAudit = earlierMock.store.get(earlierPaths.lifecycleAuditPath);
    const laterPair = exactPair(
      validInput(createMockDb().db),
      Timestamp.fromMillis(NOW_MILLIS + 10000),
    );
    const corruptMock = createMockDb([
      ...laterPair.seed,
      [earlierPaths.lifecyclePath, earlierLifecycle],
      [earlierPaths.lifecycleAuditPath, earlierLifecycleAudit],
    ]);
    const before = cloneStore(corruptMock.store);
    nowMillis = NOW_MILLIS + 20000;

    await expectSafeError(
      () => acquireCommerceCommandLease(leaseInput(corruptMock.db)),
      'journal_record_invalid',
    );
    expect(corruptMock.store).toEqual(before);
  });

  test.each([
    ['succeeded', completeCommerceCommand, completionInput],
    ['failed_final', failCommerceCommand, failureInput],
  ])('terminal %s remains a read-only observation for an earlier-captured retry', async (
    state,
    finalize,
    buildFinalizeInput,
  ) => {
    const mock = await createActiveLease();
    const paths = lifecyclePaths(leaseInput(mock.db));
    nowMillis += 5000;
    const terminalInput = buildFinalizeInput(mock.db);
    const terminalResult = await finalize(terminalInput);
    const terminalBefore = mock.store.get(paths.lifecyclePath);
    const sizeBefore = mock.store.size;
    nowMillis = NOW_MILLIS;

    await expect(acquireCommerceCommandLease(leaseInput(mock.db, {
        leaseId: OTHER_LEASE_ID,
      }))).resolves.toEqual({
      journalSchemaVersion: 1,
      lifecycleSchemaVersion: 1,
      outcome: state === 'succeeded' ? 'terminal_succeeded' : 'terminal_failed_final',
      state,
    });
    await expect(finalize(terminalInput)).resolves.toBe(terminalResult);
    expect(mock.store.size).toBe(sizeBefore);
    expect(mock.store.get(paths.lifecyclePath)).toBe(terminalBefore);
  });

  test('maximum revision/fence state never wraps on takeover or terminal transition', async () => {
    const placeholder = createMockDb();
    const base = validInput(placeholder.db);
    const pair = exactPair(base);
    const args = leaseInput(placeholder.db);
    const paths = lifecyclePaths(args, 9999999999);
    const createdAt = Timestamp.fromMillis(NOW_MILLIS);
    const acquiredAt = Timestamp.fromMillis(NOW_MILLIS + 100000);
    const expiresAt = Timestamp.fromMillis(NOW_MILLIS + 160000);
    const lifecycle = Object.freeze({
      lifecycleSchemaVersion: 1,
      commandKeyHash: paths.commandKeyHash,
      state: 'leased',
      commandRevision: 9999999999,
      fenceEpoch: 9999999998,
      leaseOwnerFingerprint: GOLDEN_LEASE_OWNER_FINGERPRINT,
      leaseAcquiredAt: acquiredAt,
      leaseExpiresAt: expiresAt,
      createdAt,
      updatedAt: acquiredAt,
      terminalCommitmentKind: null,
      terminalCommitmentHash: null,
    });
    const audit = Object.freeze({
      auditSchemaVersion: 2,
      aggregateType: 'commerce_command',
      commandKeyHash: paths.commandKeyHash,
      commandRevision: 9999999999,
      eventType: 'command_lease_taken_over',
      fromState: 'leased',
      toState: 'leased',
      environment: 'test',
      callerScopeKind: 'firebase_uid',
      commandType: 'merch.checkout.create',
      fenceEpoch: 9999999998,
      leaseExpiresAt: expiresAt,
      occurredAt: acquiredAt,
    });
    const mock = createMockDb([
      ...pair.seed,
      [paths.lifecyclePath, lifecycle],
      [paths.lifecycleAuditPath, audit],
    ]);
    const before = cloneStore(mock.store);

    nowMillis = NOW_MILLIS + 100001;
    await expectSafeError(
      () => completeCommerceCommand(completionInput(mock.db, {
        expectedFenceEpoch: 9999999998,
      })),
      'journal_record_invalid',
    );
    nowMillis = NOW_MILLIS + 160000;
    await expectSafeError(
      () => acquireCommerceCommandLease(leaseInput(mock.db, {
        leaseId: OTHER_LEASE_ID,
      })),
      'journal_record_invalid',
    );
    expect(mock.store).toEqual(before);
  });

  test.each([
    ['non-UUID lease', () => leaseInput(createMockDb().db, { leaseId: HOSTILE_CANARY })],
    ['command ID reused as lease', () => leaseInput(createMockDb().db, { leaseId: COMMAND_ID })],
    ['zero fence', () => completionInput(createMockDb().db, { expectedFenceEpoch: 0 })],
    ['huge fence', () => completionInput(createMockDb().db, {
      expectedFenceEpoch: 10000000000,
    })],
    ['bad terminal fingerprint', () => completionInput(createMockDb().db, {
      terminalReferenceFingerprint: HOSTILE_CANARY,
    })],
  ])('rejects lifecycle input before Firestore: %s', async (_label, buildInput) => {
    const input = buildInput();
    await expectSafeError(
      () => (Object.prototype.hasOwnProperty.call(input, 'terminalReferenceFingerprint')
        ? completeCommerceCommand(input)
        : acquireCommerceCommandLease(input)),
      'invalid_command_input',
    );
    expect(input.db.runTransaction).not.toHaveBeenCalled();
  });

  test('rejects extra, missing, accessor, custom-prototype, and proxy lifecycle inputs', async () => {
    const mock = createMockDb();
    const extra = { ...leaseInput(mock.db), unexpected: HOSTILE_CANARY };
    const missing = leaseInput(mock.db);
    delete missing.leaseId;
    const inherited = Object.assign(
      Object.create({ inherited: HOSTILE_CANARY }),
      leaseInput(mock.db),
    );
    let getterCalls = 0;
    const accessor = leaseInput(mock.db);
    Object.defineProperty(accessor, 'leaseId', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return HOSTILE_CANARY;
      },
    });
    let trapCalls = 0;
    const proxy = new Proxy(leaseInput(mock.db), {
      ownKeys() {
        trapCalls += 1;
        return [];
      },
    });

    for (const value of [extra, missing, inherited, accessor, proxy]) {
      await expectSafeError(
        () => acquireCommerceCommandLease(value),
        'invalid_command_input',
      );
    }
    expect(getterCalls).toBe(0);
    expect(trapCalls).toBe(0);
    expect(mock.db.runTransaction).not.toHaveBeenCalled();
  });

  test('redacts Firestore failures and rejects a forged transaction result', async () => {
    for (const options of [
      { rejectBeforeCallback: new Error(`${HOSTILE_CANARY}/private-path`) },
      { rejectCommit: new Error(`${HOSTILE_CANARY}/private-path`) },
      { returnedValue: { outcome: HOSTILE_CANARY } },
    ]) {
      const placeholder = createMockDb();
      const pair = exactPair(validInput(placeholder.db));
      const mock = createMockDb(pair.seed, options);
      await expectSafeError(
        () => acquireCommerceCommandLease(leaseInput(mock.db)),
        'journal_unavailable',
        ['private-path'],
      );
    }
  });
});

describe('immutable initial Stripe provider plan', () => {
  let nowMillis;
  let timestampNow;

  beforeEach(() => {
    nowMillis = NOW_MILLIS;
    timestampNow = jest.spyOn(Timestamp, 'now')
      .mockImplementation(() => Timestamp.fromMillis(nowMillis));
  });

  afterEach(() => jest.restoreAllMocks());

  async function createActiveLease(mock, overrides = {}) {
    const registration = validInput(mock.db, overrides);
    await registerCommerceCommand(registration);
    nowMillis += 1000;
    await acquireCommerceCommandLease(leaseInput(mock.db, overrides));
  }

  async function bindPlan(mock, overrides = {}) {
    nowMillis += 1000;
    return bindInitialStripeProviderPlan(providerPlanInput(mock.db, overrides));
  }

  test('creates the exact plan/audit pair after every read and preserves B2A/B2B bytes', async () => {
    const mock = createMockDb();
    await createActiveLease(mock);
    const input = providerPlanInput(mock.db);
    const paths = providerPlanPaths(input);
    const preserved = new Map([
      [paths.commandPath, mock.store.get(paths.commandPath)],
      [paths.auditPath, mock.store.get(paths.auditPath)],
      [paths.lifecyclePath, mock.store.get(paths.lifecyclePath)],
      [paths.lifecycleAuditPath, mock.store.get(paths.lifecycleAuditPath)],
    ]);
    const callsBefore = timestampNow.mock.calls.length;

    const result = await bindPlan(mock);

    expect(result).toEqual({
      journalSchemaVersion: 1,
      providerPlanSchemaVersion: 1,
      outcome: 'provider_plan_bound',
      state: 'planned',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(timestampNow).toHaveBeenCalledTimes(callsBefore + 1);
    const transactionRun = mock.callbackRuns.at(-1);
    expect(transactionRun.transaction.get).toHaveBeenCalledTimes(6);
    expect(transactionRun.transaction.create).toHaveBeenCalledTimes(2);
    const latestReadOrder = Math.max(...transactionRun.transaction.get.mock.invocationCallOrder);
    const earliestCreateOrder = Math.min(
      ...transactionRun.transaction.create.mock.invocationCallOrder,
    );
    expect(latestReadOrder).toBeLessThan(earliestCreateOrder);
    expect(transactionRun.writes.map((write) => write.ref.path)).toEqual([
      paths.providerPlanPath,
      paths.providerPlanAuditPath,
    ]);

    const plan = mock.store.get(paths.providerPlanPath);
    const audit = mock.store.get(paths.providerPlanAuditPath);
    expect(plan).toEqual({
      providerPlanSchemaVersion: 1,
      commandIdentityVersion: 1,
      commandKeyHash: paths.commandKeyHash,
      environment: 'test',
      provider: 'stripe',
      providerAttempt: 1,
      providerOperation: PROVIDER_OPERATION,
      stripeMode: 'test',
      stripeAccountFingerprint: GOLDEN_STRIPE_ACCOUNT_FINGERPRINT,
      stripeApiVersion: STRIPE_API_VERSION,
      httpMethod: 'POST',
      endpointPath: STRIPE_ENDPOINT_PATH,
      parametersFingerprint: GOLDEN_PARAMETERS_FINGERPRINT,
      idempotencyKeyFingerprint: GOLDEN_IDEMPOTENCY_KEY_FINGERPRINT,
      boundFenceEpoch: 1,
      boundAt: expect.any(Timestamp),
    });
    expect(audit).toEqual({
      providerPlanAuditSchemaVersion: 1,
      aggregateType: 'commerce_provider_attempt',
      commandKeyHash: paths.commandKeyHash,
      providerAttempt: 1,
      eventType: 'provider_plan_bound',
      provider: 'stripe',
      environment: 'test',
      stripeMode: 'test',
      providerOperation: PROVIDER_OPERATION,
      boundFenceEpoch: 1,
      occurredAt: expect.any(Timestamp),
    });
    expect(plan.boundAt).toBe(audit.occurredAt);
    expect(plan.boundAt.toMillis()).toBe(NOW_MILLIS + 2000);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(audit)).toBe(true);
    expect(Object.isFrozen(plan.boundAt)).toBe(true);
    for (const [path_, value] of preserved) expect(mock.store.get(path_)).toBe(value);

    const rawStripeKey = createStripeIdempotencyKey({
      stripeMode: 'test',
      environment: 'test',
      providerOperation: PROVIDER_OPERATION,
      commandKeyHash: paths.commandKeyHash,
      providerAttempt: 1,
    }).stripeIdempotencyKey;
    const rendered = JSON.stringify({ result, plan, audit });
    for (const raw of [
      STRIPE_ACCOUNT_ID,
      HOSTILE_CANARY,
      rawStripeKey,
      LEASE_ID,
      RAW_CALLER,
      COMMAND_ID,
    ]) {
      expect(rendered).not.toContain(raw);
    }
    expect(audit).not.toHaveProperty('stripeAccountFingerprint');
    expect(audit).not.toHaveProperty('parametersFingerprint');
    expect(audit).not.toHaveProperty('idempotencyKeyFingerprint');
    expect(result).not.toHaveProperty('shouldSend');
    expect(result).not.toHaveProperty('shouldExecute');
  });

  test('exact lost-response retry and canonical parameter equivalence are read-only', async () => {
    const mock = createMockDb();
    await createActiveLease(mock);
    await bindPlan(mock);
    const paths = providerPlanPaths(providerPlanInput(mock.db));
    const planBefore = mock.store.get(paths.providerPlanPath);
    const auditBefore = mock.store.get(paths.providerPlanAuditPath);
    const storeSize = mock.store.size;
    nowMillis += 1;
    const equivalentParameters = validProviderParameters([
      ['synthetic_reference', HOSTILE_CANARY],
      ['currency', 'usd'],
      ['amount_total', 2500],
    ]);

    const exact = await bindInitialStripeProviderPlan(providerPlanInput(mock.db));
    const equivalent = await bindInitialStripeProviderPlan(providerPlanInput(mock.db, {
      providerParameters: equivalentParameters,
    }));

    for (const result of [exact, equivalent]) {
      expect(result).toEqual({
        journalSchemaVersion: 1,
        providerPlanSchemaVersion: 1,
        outcome: 'provider_plan_existing',
        state: 'planned',
      });
      expect(Object.isFrozen(result)).toBe(true);
    }
    expect(mock.store.size).toBe(storeSize);
    expect(mock.store.get(paths.providerPlanPath)).toBe(planBefore);
    expect(mock.store.get(paths.providerPlanAuditPath)).toBe(auditBefore);
    for (const { transaction, writes } of mock.callbackRuns.slice(-2)) {
      expect(transaction.create).not.toHaveBeenCalled();
      expect(transaction.set).not.toHaveBeenCalled();
      expect(writes).toEqual([]);
    }
  });

  test.each([
    ['account', { stripeAccountId: OTHER_STRIPE_ACCOUNT_ID }],
    ['API version', { stripeApiVersion: '2024-06-20' }],
    ['parameters', {
      providerParameters: validProviderParameters([
        ['amount_total', 2501],
        ['currency', 'usd'],
        ['synthetic_reference', HOSTILE_CANARY],
      ]),
    }],
  ])('rejects a valid but conflicting immutable %s without overwrite', async (_label, change) => {
    const mock = createMockDb();
    await createActiveLease(mock);
    await bindPlan(mock);
    const paths = providerPlanPaths(providerPlanInput(mock.db));
    const before = cloneStore(mock.store);
    nowMillis += 1;

    await expectSafeError(
      () => bindInitialStripeProviderPlan(providerPlanInput(mock.db, change)),
      'command_conflict',
      [STRIPE_ACCOUNT_ID, OTHER_STRIPE_ACCOUNT_ID],
    );

    expect(mock.store).toEqual(before);
    expect(mock.store.get(paths.providerPlanPath)).toBe(before.get(paths.providerPlanPath));
  });

  test('transaction retries reuse one timestamp and deterministic prepared records', async () => {
    const mock = createMockDb([], { callbackRuns: 4 });
    await createActiveLease(mock);
    timestampNow.mockClear();

    const result = await bindPlan(mock);

    expect(result.outcome).toBe('provider_plan_bound');
    expect(timestampNow).toHaveBeenCalledTimes(1);
    expect(mock.db.runTransaction).toHaveBeenLastCalledWith(
      expect.any(Function),
      { maxAttempts: 10 },
    );
    const callbackRetries = mock.callbackRuns.slice(-4);
    expect(callbackRetries).toHaveLength(4);
    const plans = callbackRetries.map(({ writes }) => writes[0].value);
    const audits = callbackRetries.map(({ writes }) => writes[1].value);
    expect(new Set(plans.map((plan) => plan.boundAt)).size).toBe(1);
    expect(new Set(plans.map((plan) => plan.stripeAccountFingerprint)).size).toBe(1);
    expect(new Set(plans.map((plan) => plan.parametersFingerprint)).size).toBe(1);
    expect(new Set(plans.map((plan) => plan.idempotencyKeyFingerprint)).size).toBe(1);
    expect(new Set(audits.map((audit) => audit.occurredAt)).size).toBe(1);
  });

  test('all three domains are separate and the same raw context is command-bound', async () => {
    const mock = createMockDb();
    await createActiveLease(mock);
    await bindPlan(mock);
    const firstPaths = providerPlanPaths(providerPlanInput(mock.db));
    const first = mock.store.get(firstPaths.providerPlanPath);

    nowMillis += 1;
    await createActiveLease(mock, { commandId: OTHER_COMMAND_ID });
    await bindPlan(mock, { commandId: OTHER_COMMAND_ID });
    const secondPaths = providerPlanPaths(providerPlanInput(mock.db, {
      commandId: OTHER_COMMAND_ID,
    }));
    const second = mock.store.get(secondPaths.providerPlanPath);

    expect(new Set([
      first.stripeAccountFingerprint,
      first.parametersFingerprint,
      first.idempotencyKeyFingerprint,
    ])).toHaveProperty('size', 3);
    expect(second.stripeAccountFingerprint).not.toBe(first.stripeAccountFingerprint);
    expect(second.parametersFingerprint).not.toBe(first.parametersFingerprint);
    expect(second.idempotencyKeyFingerprint).not.toBe(first.idempotencyKeyFingerprint);
  });

  test('wrong holder and fence independently reject before observing an existing plan', async () => {
    const mock = createMockDb();
    await createActiveLease(mock);
    await bindPlan(mock);
    const before = cloneStore(mock.store);
    nowMillis += 1;

    for (const change of [
      { leaseId: OTHER_LEASE_ID },
      { expectedFenceEpoch: 2 },
      { leaseId: OTHER_LEASE_ID, expectedFenceEpoch: 2 },
      { leaseId: OTHER_LEASE_ID, stripeApiVersion: '2024-06-20' },
      { expectedFenceEpoch: 2, stripeAccountId: OTHER_STRIPE_ACCOUNT_ID },
    ]) {
      await expectSafeError(
        () => bindInitialStripeProviderPlan(providerPlanInput(mock.db, change)),
        'lease_stale',
      );
    }
    expect(mock.store).toEqual(before);
  });

  test('expiry equality rejects both first bind and observation of an existing plan', async () => {
    let mock = createMockDb();
    await createActiveLease(mock);
    const paths = providerPlanPaths(providerPlanInput(mock.db));
    const before = cloneStore(mock.store);
    nowMillis = NOW_MILLIS + 61000;

    await expectSafeError(
      () => bindInitialStripeProviderPlan(providerPlanInput(mock.db)),
      'lease_stale',
    );
    expect(mock.store).toEqual(before);
    expect(mock.store.has(paths.providerPlanPath)).toBe(false);

    mock = createMockDb();
    nowMillis = NOW_MILLIS;
    await createActiveLease(mock);
    await bindPlan(mock);
    const withPlan = cloneStore(mock.store);
    nowMillis = NOW_MILLIS + 61000;
    await expectSafeError(
      () => bindInitialStripeProviderPlan(providerPlanInput(mock.db)),
      'lease_stale',
    );
    expect(mock.store).toEqual(withPlan);
  });

  test('a takeover holder observes the original plan without rewriting its fence or time', async () => {
    const mock = createMockDb();
    await createActiveLease(mock);
    await bindPlan(mock);
    const paths = providerPlanPaths(providerPlanInput(mock.db));
    const planBefore = mock.store.get(paths.providerPlanPath);
    const auditBefore = mock.store.get(paths.providerPlanAuditPath);
    nowMillis = NOW_MILLIS + 61000;
    const takeover = await acquireCommerceCommandLease(leaseInput(mock.db, {
      leaseId: OTHER_LEASE_ID,
    }));
    expect(takeover).toMatchObject({ outcome: 'lease_acquired', fenceEpoch: 2 });
    nowMillis += 1;

    const result = await bindInitialStripeProviderPlan(providerPlanInput(mock.db, {
      leaseId: OTHER_LEASE_ID,
      expectedFenceEpoch: 2,
    }));

    expect(result.outcome).toBe('provider_plan_existing');
    expect(mock.store.get(paths.providerPlanPath)).toBe(planBefore);
    expect(mock.store.get(paths.providerPlanAuditPath)).toBe(auditBefore);
    expect(planBefore.boundFenceEpoch).toBe(1);
    expect(planBefore.boundAt.toMillis()).toBe(NOW_MILLIS + 2000);
  });

  test('first binding at fence 2 validates its predecessor before both creates', async () => {
    const mock = createMockDb();
    await createActiveLease(mock);
    nowMillis = NOW_MILLIS + 61000;
    await expect(acquireCommerceCommandLease(leaseInput(mock.db, {
      leaseId: OTHER_LEASE_ID,
    }))).resolves.toMatchObject({ outcome: 'lease_acquired', fenceEpoch: 2 });
    const paths = providerPlanPaths(providerPlanInput(mock.db));
    const preserved = cloneStore(mock.store);
    nowMillis += 1;

    await expect(bindInitialStripeProviderPlan(providerPlanInput(mock.db, {
      leaseId: OTHER_LEASE_ID,
      expectedFenceEpoch: 2,
    }))).resolves.toMatchObject({ outcome: 'provider_plan_bound' });

    const transactionRun = mock.callbackRuns.at(-1);
    expect(transactionRun.transaction.get).toHaveBeenCalledTimes(7);
    const latestReadOrder = Math.max(...transactionRun.transaction.get.mock.invocationCallOrder);
    const earliestCreateOrder = Math.min(
      ...transactionRun.transaction.create.mock.invocationCallOrder,
    );
    expect(latestReadOrder).toBeLessThan(earliestCreateOrder);
    expect(mock.store.get(paths.providerPlanPath)).toMatchObject({
      providerOperation: PROVIDER_OPERATION,
      endpointPath: STRIPE_ENDPOINT_PATH,
      boundFenceEpoch: 2,
    });
    expect(mock.store.get(paths.providerPlanPath).boundAt.toMillis())
      .toBe(NOW_MILLIS + 61001);
    for (const [path_, value] of preserved) expect(mock.store.get(path_)).toBe(value);
  });

  test('an earlier captured time may observe an exact plan but can never create one', async () => {
    let mock = createMockDb();
    await createActiveLease(mock);
    const paths = providerPlanPaths(providerPlanInput(mock.db));
    const before = cloneStore(mock.store);
    nowMillis = NOW_MILLIS;
    await expectSafeError(
      () => bindInitialStripeProviderPlan(providerPlanInput(mock.db)),
      'lease_stale',
    );
    expect(mock.store).toEqual(before);
    expect(mock.store.has(paths.providerPlanPath)).toBe(false);

    mock = createMockDb();
    nowMillis = NOW_MILLIS;
    await createActiveLease(mock);
    await bindPlan(mock);
    const planBefore = mock.store.get(paths.providerPlanPath);
    nowMillis = NOW_MILLIS;

    await expect(bindInitialStripeProviderPlan(providerPlanInput(mock.db)))
      .resolves.toMatchObject({ outcome: 'provider_plan_existing' });
    expect(mock.store.get(paths.providerPlanPath)).toBe(planBefore);
  });

  test.each(['succeeded', 'failed_final'])(
    'terminal lifecycle %s cannot bind or observe a provider plan',
    async (state) => {
      const mock = createMockDb();
      await createActiveLease(mock);
      await bindPlan(mock);
      nowMillis += 1;
      if (state === 'succeeded') {
        await completeCommerceCommand(completionInput(mock.db));
      } else {
        await failCommerceCommand(failureInput(mock.db));
      }
      const before = cloneStore(mock.store);

      await expectSafeError(
        () => bindInitialStripeProviderPlan(providerPlanInput(mock.db)),
        'lease_stale',
      );
      expect(mock.store).toEqual(before);
    },
  );
});

describe('provider plan fail-closed record and input boundary', () => {
  let nowMillis;

  beforeEach(() => {
    nowMillis = NOW_MILLIS;
    jest.spyOn(Timestamp, 'now')
      .mockImplementation(() => Timestamp.fromMillis(nowMillis));
  });

  afterEach(() => jest.restoreAllMocks());

  async function createActiveLease(mock, overrides = {}) {
    await registerCommerceCommand(validInput(mock.db, overrides));
    nowMillis += 1000;
    await acquireCommerceCommandLease(leaseInput(mock.db, overrides));
  }

  async function createBoundPlan() {
    const mock = createMockDb();
    await createActiveLease(mock);
    nowMillis += 1000;
    await bindInitialStripeProviderPlan(providerPlanInput(mock.db));
    return mock;
  }

  async function createTakeoverWithoutPlan() {
    const mock = createMockDb();
    await createActiveLease(mock);
    nowMillis = NOW_MILLIS + 61000;
    await acquireCommerceCommandLease(leaseInput(mock.db, { leaseId: OTHER_LEASE_ID }));
    return mock;
  }

  test.each([
    ['short account', { stripeAccountId: 'acct_123456789012345' }],
    ['long account', { stripeAccountId: `acct_${'a'.repeat(65)}` }],
    ['account punctuation', { stripeAccountId: 'acct_123456789012345!' }],
    ['account prefix', { stripeAccountId: 'ca_1234567890123456' }],
    ['test/live mismatch', { stripeMode: 'live' }],
    ['unknown mode', { stripeMode: 'sandbox' }],
    ['pre-Stripe API year', { stripeApiVersion: '2010-12-31' }],
    ['invalid leap day', { stripeApiVersion: '2025-02-29' }],
    ['invalid month', { stripeApiVersion: '2025-13-01' }],
    ['uppercase API train', { stripeApiVersion: '2025-06-30.Basil' }],
    ['unbounded API train', { stripeApiVersion: `2025-06-30.${'a'.repeat(33)}` }],
    ['endpoint scheme', { endpointPath: 'https://api.stripe.com/v1/refunds' }],
    ['endpoint host', { endpointPath: '//api.stripe.com/v1/refunds' }],
    ['endpoint query', { endpointPath: '/v1/refunds?expand=data' }],
    ['endpoint fragment', { endpointPath: '/v1/refunds#private' }],
    ['endpoint encoded slash', { endpointPath: '/v1/checkout%2fsessions' }],
    ['endpoint encoded dot', { endpointPath: '/v1/%2e%2e/refunds' }],
    ['endpoint traversal', { endpointPath: '/v1/../refunds' }],
    ['endpoint current directory', { endpointPath: '/v1/./refunds' }],
    ['endpoint double slash', { endpointPath: '/v1//refunds' }],
    ['endpoint trailing slash', { endpointPath: '/v1/refunds/' }],
    ['endpoint uppercase', { endpointPath: '/v1/Checkout/Sessions' }],
    ['endpoint backslash', { endpointPath: '/v1/checkout\\sessions' }],
    ['object-ID endpoint', {
      endpointPath: '/v1/payment_intents/pi_synthetic000000000001/confirm',
    }],
    ['capability-shaped endpoint', {
      endpointPath: '/v1/checkout/sessions/cs_test_capability000000000001',
    }],
    ['secret-shaped endpoint', {
      endpointPath: '/v1/checkout/sessions/client_secret_synthetic000000000001',
    }],
    ['test-helper endpoint', { endpointPath: '/v1/test_helpers/refunds' }],
    ['arbitrary refund endpoint', { endpointPath: '/v1/refunds' }],
    ['operation and endpoint mismatch', { endpointPath: '/v1/payment_intents' }],
    ['unmapped operation', { providerOperation: 'refund_create' }],
    ['unmapped operation with fixed endpoint', {
      providerOperation: 'payment_intent_create',
      endpointPath: STRIPE_ENDPOINT_PATH,
    }],
    ['operation uppercase', { providerOperation: 'CheckoutSessionCreate' }],
    ['operation slash', { providerOperation: 'checkout/session/create' }],
    ['zero fence', { expectedFenceEpoch: 0 }],
    ['future fence', { expectedFenceEpoch: 10000000000 }],
    ['invalid lease', { leaseId: HOSTILE_CANARY }],
    ['caller-selected attempt', { providerAttempt: 2 }],
    ['caller-selected provider', { provider: 'stripe' }],
    ['caller-selected method', { httpMethod: 'POST' }],
  ])('rejects invalid provider-plan input before Firestore: %s', async (_label, change) => {
    const mock = createMockDb();
    await expectSafeError(
      () => bindInitialStripeProviderPlan(providerPlanInput(mock.db, change)),
      'invalid_command_input',
      [STRIPE_ACCOUNT_ID],
    );
    expect(mock.db.runTransaction).not.toHaveBeenCalled();
  });

  test.each([
    ['minimum account', { stripeAccountId: `acct_${'a'.repeat(16)}` }],
    ['maximum account', { stripeAccountId: `acct_${'A'.repeat(64)}` }],
    ['first supported API date', { stripeApiVersion: '2011-01-01' }],
    ['valid leap date', { stripeApiVersion: '2024-02-29' }],
    ['bounded train', { stripeApiVersion: '2099-12-31.z9' }],
  ])('accepts conservative boundary input: %s', async (_label, change) => {
    const mock = createMockDb();
    await createActiveLease(mock);
    nowMillis += 1;
    await expect(bindInitialStripeProviderPlan(providerPlanInput(mock.db, change)))
      .resolves.toMatchObject({ outcome: 'provider_plan_bound' });
  });

  test('accepts live mode only for a production-scoped command', async () => {
    const mock = createMockDb();
    await createActiveLease(mock, { environment: 'production' });
    nowMillis += 1;
    await expect(bindInitialStripeProviderPlan(providerPlanInput(mock.db, {
      environment: 'production',
      stripeMode: 'live',
    }))).resolves.toMatchObject({ outcome: 'provider_plan_bound' });

    const invalid = createMockDb();
    await expectSafeError(
      () => bindInitialStripeProviderPlan(providerPlanInput(invalid.db, {
        environment: 'production',
        stripeMode: 'test',
      })),
      'invalid_command_input',
    );
    expect(invalid.db.runTransaction).not.toHaveBeenCalled();
  });

  test('rejects mutable, exotic, cyclic, accessor, proxy, and over-budget parameters', async () => {
    const mutableNested = frozenRecord([['nested', { secret: HOSTILE_CANARY }]]);
    const plainFrozen = Object.freeze({ secret: HOSTILE_CANARY });
    const symbol = Object.create(null);
    symbol.safe = 1;
    symbol[Symbol('hidden')] = HOSTILE_CANARY;
    Object.freeze(symbol);
    let getterCalls = 0;
    const accessor = Object.create(null);
    Object.defineProperty(accessor, 'secret', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return HOSTILE_CANARY;
      },
    });
    Object.freeze(accessor);
    let trapCalls = 0;
    const proxy = new Proxy(validProviderParameters(), {
      ownKeys() {
        trapCalls += 1;
        return [];
      },
    });
    const cyclic = Object.create(null);
    cyclic.self = cyclic;
    Object.freeze(cyclic);
    let tooDeep = 'leaf';
    for (let index = 0; index < 8; index += 1) {
      tooDeep = frozenRecord([['nested', tooDeep]]);
    }
    const tooMany = frozenRecord(Array.from(
      { length: 101 },
      (_value, index) => [`field_${index}`, index],
    ));
    const tooLarge = frozenRecord([['value', 'x'.repeat(8193)]]);

    for (const providerParameters of [
      { secret: HOSTILE_CANARY },
      mutableNested,
      plainFrozen,
      symbol,
      accessor,
      proxy,
      cyclic,
      tooDeep,
      tooMany,
      tooLarge,
    ]) {
      const mock = createMockDb();
      await expectSafeError(
        () => bindInitialStripeProviderPlan(providerPlanInput(mock.db, {
          providerParameters,
        })),
        'invalid_command_input',
      );
      expect(mock.db.runTransaction).not.toHaveBeenCalled();
    }
    expect(getterCalls).toBe(0);
    expect(trapCalls).toBe(0);
  });

  test('rejects extra, missing, inherited, accessor, and proxied input roots', async () => {
    const extraMock = createMockDb();
    const extra = { ...providerPlanInput(extraMock.db), shouldSend: true };
    const missingMock = createMockDb();
    const missing = providerPlanInput(missingMock.db);
    delete missing.endpointPath;
    const inheritedMock = createMockDb();
    const inherited = Object.assign(
      Object.create({ inherited: HOSTILE_CANARY }),
      providerPlanInput(inheritedMock.db),
    );
    const accessorMock = createMockDb();
    const accessor = providerPlanInput(accessorMock.db);
    let getterCalls = 0;
    Object.defineProperty(accessor, 'stripeAccountId', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return HOSTILE_CANARY;
      },
    });
    const proxyMock = createMockDb();
    let trapCalls = 0;
    const proxy = new Proxy(providerPlanInput(proxyMock.db), {
      ownKeys() {
        trapCalls += 1;
        return [];
      },
    });

    for (const [value, mock] of [
      [extra, extraMock],
      [missing, missingMock],
      [inherited, inheritedMock],
      [accessor, accessorMock],
      [proxy, proxyMock],
    ]) {
      await expectSafeError(
        () => bindInitialStripeProviderPlan(value),
        'invalid_command_input',
      );
      expect(mock.db.runTransaction).not.toHaveBeenCalled();
    }
    expect(getterCalls).toBe(0);
    expect(trapCalls).toBe(0);
  });

  test('requires registration and lifecycle partners without repairing orphans', async () => {
    let mock = createMockDb();
    await expectSafeError(
      () => bindInitialStripeProviderPlan(providerPlanInput(mock.db)),
      'command_not_registered',
    );
    expect(mock.store.size).toBe(0);

    const bound = await createBoundPlan();
    const paths = providerPlanPaths(providerPlanInput(bound.db));
    for (const deletion of [
      paths.providerPlanPath,
      paths.providerPlanAuditPath,
      paths.lifecyclePath,
      paths.lifecycleAuditPath,
      paths.commandPath,
      paths.auditPath,
    ]) {
      const seed = cloneStore(bound.store);
      seed.delete(deletion);
      mock = createMockDb([...seed]);
      const before = cloneStore(mock.store);
      await expectSafeError(
        () => bindInitialStripeProviderPlan(providerPlanInput(mock.db)),
        'journal_record_invalid',
        [paths.commandKeyHash],
      );
      expect(mock.store).toEqual(before);
      expect(mock.callbackRuns.at(-1).transaction.create).not.toHaveBeenCalled();
    }
  });

  test.each([
    ['schema', (plan) => ({ ...plan, providerPlanSchemaVersion: 2 })],
    ['identity version', (plan) => ({ ...plan, commandIdentityVersion: 2 })],
    ['command hash', (plan) => ({ ...plan, commandKeyHash: 'a'.repeat(64) })],
    ['provider', (plan) => ({ ...plan, provider: 'other' })],
    ['attempt', (plan) => ({ ...plan, providerAttempt: 2 })],
    ['operation', (plan) => ({ ...plan, providerOperation: 'BadOperation' })],
    ['unmapped lowercase operation', (plan) => ({
      ...plan,
      providerOperation: 'refund_create',
    })],
    ['mode pairing', (plan) => ({ ...plan, stripeMode: 'live' })],
    ['account commitment', (plan) => ({
      ...plan,
      stripeAccountFingerprint: plan.stripeAccountFingerprint.toUpperCase(),
    })],
    ['API version', (plan) => ({ ...plan, stripeApiVersion: '2025-02-29' })],
    ['HTTP method', (plan) => ({ ...plan, httpMethod: 'GET' })],
    ['endpoint', (plan) => ({ ...plan, endpointPath: '/v1/Checkout/Sessions' })],
    ['arbitrary lowercase endpoint', (plan) => ({ ...plan, endpointPath: '/v1/refunds' })],
    ['object-ID endpoint', (plan) => ({
      ...plan,
      endpointPath: '/v1/payment_intents/pi_synthetic000000000001/confirm',
    })],
    ['parameter commitment', (plan) => ({ ...plan, parametersFingerprint: 'bad' })],
    ['key commitment', (plan) => ({ ...plan, idempotencyKeyFingerprint: 'a'.repeat(64) })],
    ['zero fence', (plan) => ({ ...plan, boundFenceEpoch: 0 })],
    ['non-Timestamp', (plan) => ({ ...plan, boundAt: { _seconds: 1, _nanoseconds: 0 } })],
    ['extra field', (plan) => ({ ...plan, unexpected: HOSTILE_CANARY })],
  ])('rejects malformed stored provider plan: %s', async (_label, mutate) => {
    const bound = await createBoundPlan();
    const paths = providerPlanPaths(providerPlanInput(bound.db));
    const mock = createMockDb([...bound.store]);
    mock.store.set(
      paths.providerPlanPath,
      Object.freeze(mutate(mock.store.get(paths.providerPlanPath))),
    );
    const before = cloneStore(mock.store);

    await expectSafeError(
      () => bindInitialStripeProviderPlan(providerPlanInput(mock.db)),
      'journal_record_invalid',
      [paths.commandKeyHash, STRIPE_ACCOUNT_ID],
    );
    expect(mock.store).toEqual(before);
    expect(mock.callbackRuns.at(-1).transaction.create).not.toHaveBeenCalled();
  });

  test.each([
    ['schema', (audit) => ({ ...audit, providerPlanAuditSchemaVersion: 2 })],
    ['aggregate', (audit) => ({ ...audit, aggregateType: 'commerce_command' })],
    ['command hash', (audit) => ({ ...audit, commandKeyHash: 'a'.repeat(64) })],
    ['attempt', (audit) => ({ ...audit, providerAttempt: 2 })],
    ['event', (audit) => ({ ...audit, eventType: 'provider_sent' })],
    ['provider', (audit) => ({ ...audit, provider: 'other' })],
    ['environment', (audit) => ({ ...audit, environment: 'staging' })],
    ['mode', (audit) => ({ ...audit, stripeMode: 'live' })],
    ['operation', (audit) => ({ ...audit, providerOperation: 'refund_create' })],
    ['fence', (audit) => ({ ...audit, boundFenceEpoch: 2 })],
    ['time', (audit) => ({ ...audit, occurredAt: Timestamp.fromMillis(NOW_MILLIS) })],
    ['extra field', (audit) => ({ ...audit, unexpected: HOSTILE_CANARY })],
  ])('rejects malformed stored provider-plan audit: %s', async (_label, mutate) => {
    const bound = await createBoundPlan();
    const paths = providerPlanPaths(providerPlanInput(bound.db));
    const mock = createMockDb([...bound.store]);
    mock.store.set(
      paths.providerPlanAuditPath,
      Object.freeze(mutate(mock.store.get(paths.providerPlanAuditPath))),
    );
    const before = cloneStore(mock.store);

    await expectSafeError(
      () => bindInitialStripeProviderPlan(providerPlanInput(mock.db)),
      'journal_record_invalid',
      [paths.commandKeyHash],
    );
    expect(mock.store).toEqual(before);
  });

  test('rejects stored provider-plan accessors and proxies without invoking traps', async () => {
    const bound = await createBoundPlan();
    const paths = providerPlanPaths(providerPlanInput(bound.db));
    let getterCalls = 0;
    const accessor = { ...bound.store.get(paths.providerPlanPath) };
    Object.defineProperty(accessor, 'endpointPath', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return HOSTILE_CANARY;
      },
    });
    let mock = createMockDb([...bound.store]);
    mock.store.set(paths.providerPlanPath, accessor);
    await expectSafeError(
      () => bindInitialStripeProviderPlan(providerPlanInput(mock.db)),
      'journal_record_invalid',
    );
    expect(getterCalls).toBe(0);

    let trapCalls = 0;
    const proxy = new Proxy(bound.store.get(paths.providerPlanAuditPath), {
      ownKeys() {
        trapCalls += 1;
        return [];
      },
    });
    mock = createMockDb([...bound.store]);
    mock.store.set(paths.providerPlanAuditPath, proxy);
    await expectSafeError(
      () => bindInitialStripeProviderPlan(providerPlanInput(mock.db)),
      'journal_record_invalid',
    );
    expect(trapCalls).toBe(0);
  });

  test.each([
    ['before registration', NOW_MILLIS - 1],
    ['before lease acquisition', NOW_MILLIS + 500],
    ['at lease expiry', NOW_MILLIS + 61000],
    ['after lease expiry', NOW_MILLIS + 61001],
  ])('rejects impossible stored binding time %s', async (_label, boundAtMillis) => {
    const bound = await createBoundPlan();
    const paths = providerPlanPaths(providerPlanInput(bound.db));
    const mock = createMockDb([...bound.store]);
    const boundAt = Timestamp.fromMillis(boundAtMillis);
    mock.store.set(paths.providerPlanPath, Object.freeze({
      ...mock.store.get(paths.providerPlanPath),
      boundAt,
    }));
    mock.store.set(paths.providerPlanAuditPath, Object.freeze({
      ...mock.store.get(paths.providerPlanAuditPath),
      occurredAt: Timestamp.fromMillis(boundAtMillis),
    }));
    const before = cloneStore(mock.store);

    await expectSafeError(
      () => bindInitialStripeProviderPlan(providerPlanInput(mock.db)),
      'journal_record_invalid',
    );
    expect(mock.store).toEqual(before);
  });

  test('validates the original bound-fence audit after a takeover', async () => {
    const bound = await createBoundPlan();
    const paths = providerPlanPaths(providerPlanInput(bound.db));
    nowMillis = NOW_MILLIS + 61000;
    await acquireCommerceCommandLease(leaseInput(bound.db, { leaseId: OTHER_LEASE_ID }));
    const validTakeoverStore = cloneStore(bound.store);
    const originalAudit = validTakeoverStore.get(paths.lifecycleAuditPath);

    const corruptions = [
      ['missing', null],
      ['fence', Object.freeze({ ...originalAudit, fenceEpoch: 2 })],
      ['event', Object.freeze({ ...originalAudit, eventType: 'command_lease_taken_over' })],
      ['shifted fence-1 acquisition', Object.freeze({
        ...originalAudit,
        occurredAt: Timestamp.fromMillis(NOW_MILLIS + 500),
        leaseExpiresAt: Timestamp.fromMillis(NOW_MILLIS + 60500),
      })],
      ['acquisition before registration', Object.freeze({
        ...originalAudit,
        occurredAt: Timestamp.fromMillis(NOW_MILLIS - 1000),
        leaseExpiresAt: Timestamp.fromMillis(NOW_MILLIS + 59000),
      })],
      ['binding before original acquisition', Object.freeze({
        ...originalAudit,
        occurredAt: Timestamp.fromMillis(NOW_MILLIS + 3000),
        leaseExpiresAt: Timestamp.fromMillis(NOW_MILLIS + 63000),
      })],
      ['bad expiry duration', Object.freeze({
        ...originalAudit,
        leaseExpiresAt: Timestamp.fromMillis(NOW_MILLIS + 60000),
      })],
    ];

    for (const [, corruption] of corruptions) {
      const seed = cloneStore(validTakeoverStore);
      if (corruption === null) seed.delete(paths.lifecycleAuditPath);
      else seed.set(paths.lifecycleAuditPath, corruption);
      const mock = createMockDb([...seed]);
      const before = cloneStore(mock.store);
      nowMillis = NOW_MILLIS + 61001;

      await expectSafeError(
        () => bindInitialStripeProviderPlan(providerPlanInput(mock.db, {
          leaseId: OTHER_LEASE_ID,
          expectedFenceEpoch: 2,
        })),
        'journal_record_invalid',
      );
      expect(mock.store).toEqual(before);
      expect(mock.callbackRuns.at(-1).transaction.create).not.toHaveBeenCalled();
    }
  });

  test('first bind after takeover rejects a missing or impossible immediate predecessor', async () => {
    const takeover = await createTakeoverWithoutPlan();
    const input = providerPlanInput(takeover.db);
    const paths = providerPlanPaths(input);
    const predecessorPath = lifecyclePaths(input, 2).lifecycleAuditPath;
    const originalPredecessor = takeover.store.get(predecessorPath);
    const corruptions = [
      ['missing', null],
      ['wrong event', Object.freeze({
        ...originalPredecessor,
        eventType: 'command_lease_taken_over',
      })],
      ['wrong fence', Object.freeze({ ...originalPredecessor, fenceEpoch: 2 })],
      ['shifted fence-1 time', Object.freeze({
        ...originalPredecessor,
        occurredAt: Timestamp.fromMillis(NOW_MILLIS + 500),
        leaseExpiresAt: Timestamp.fromMillis(NOW_MILLIS + 60500),
      })],
      ['wrong lease duration', Object.freeze({
        ...originalPredecessor,
        leaseExpiresAt: Timestamp.fromMillis(NOW_MILLIS + 60999),
      })],
    ];

    for (const [, corruption] of corruptions) {
      const seed = cloneStore(takeover.store);
      if (corruption === null) seed.delete(predecessorPath);
      else seed.set(predecessorPath, corruption);
      const mock = createMockDb([...seed]);
      const before = cloneStore(mock.store);
      nowMillis = NOW_MILLIS + 61001;

      await expectSafeError(
        () => bindInitialStripeProviderPlan(providerPlanInput(mock.db, {
          leaseId: OTHER_LEASE_ID,
          expectedFenceEpoch: 2,
        })),
        'journal_record_invalid',
      );
      expect(mock.store).toEqual(before);
      expect(mock.store.has(paths.providerPlanPath)).toBe(false);
      expect(mock.store.has(paths.providerPlanAuditPath)).toBe(false);
      expect(mock.callbackRuns.at(-1).transaction.create).not.toHaveBeenCalled();
    }
  });

  test('a self-consistent fence-3 record rejects an overlapping fence-2 predecessor', async () => {
    const takeover = await createTakeoverWithoutPlan();
    nowMillis = NOW_MILLIS + 121000;
    await acquireCommerceCommandLease(leaseInput(takeover.db, { leaseId: THIRD_LEASE_ID }));
    const input = providerPlanInput(takeover.db);
    const predecessorPath = lifecyclePaths(input, 3).lifecycleAuditPath;
    const predecessor = takeover.store.get(predecessorPath);
    takeover.store.set(predecessorPath, Object.freeze({
      ...predecessor,
      occurredAt: Timestamp.fromMillis(NOW_MILLIS + 62000),
      leaseExpiresAt: Timestamp.fromMillis(NOW_MILLIS + 122000),
    }));
    const before = cloneStore(takeover.store);
    nowMillis += 1;

    await expectSafeError(
      () => bindInitialStripeProviderPlan(providerPlanInput(takeover.db, {
        leaseId: THIRD_LEASE_ID,
        expectedFenceEpoch: 3,
      })),
      'journal_record_invalid',
    );
    expect(takeover.store).toEqual(before);
    expect(takeover.store.has(providerPlanPaths(input).providerPlanPath)).toBe(false);
    expect(takeover.callbackRuns.at(-1).transaction.create).not.toHaveBeenCalled();
  });

  test('a fence-2 plan observed at fence 3 still requires its predecessor audit', async () => {
    const bound = await createTakeoverWithoutPlan();
    nowMillis += 1;
    await bindInitialStripeProviderPlan(providerPlanInput(bound.db, {
      leaseId: OTHER_LEASE_ID,
      expectedFenceEpoch: 2,
    }));
    nowMillis = NOW_MILLIS + 121000;
    await acquireCommerceCommandLease(leaseInput(bound.db, { leaseId: THIRD_LEASE_ID }));
    const input = providerPlanInput(bound.db);
    const predecessorPath = lifecyclePaths(input, 2).lifecycleAuditPath;
    const seed = cloneStore(bound.store);
    seed.delete(predecessorPath);
    const mock = createMockDb([...seed]);
    const before = cloneStore(mock.store);
    nowMillis += 1;

    await expectSafeError(
      () => bindInitialStripeProviderPlan(providerPlanInput(mock.db, {
        leaseId: THIRD_LEASE_ID,
        expectedFenceEpoch: 3,
      })),
      'journal_record_invalid',
    );
    expect(mock.store).toEqual(before);
    expect(mock.callbackRuns.at(-1).transaction.create).not.toHaveBeenCalled();
  });

  test('commit failure and forged transaction output are fixed and redacted', async () => {
    const active = createMockDb();
    await createActiveLease(active);
    const commitFailure = createMockDb([...active.store], {
      rejectCommit: new Error(`${HOSTILE_CANARY}/${STRIPE_ACCOUNT_ID}`),
    });
    const before = cloneStore(commitFailure.store);
    nowMillis += 1;
    await expectSafeError(
      () => bindInitialStripeProviderPlan(providerPlanInput(commitFailure.db)),
      'journal_unavailable',
      [STRIPE_ACCOUNT_ID],
    );
    expect(commitFailure.store).toEqual(before);

    const forged = createMockDb([...active.store], {
      returnedValue: Object.freeze({
        outcome: HOSTILE_CANARY,
        stripeAccountId: STRIPE_ACCOUNT_ID,
      }),
    });
    await expectSafeError(
      () => bindInitialStripeProviderPlan(providerPlanInput(forged.db)),
      'journal_unavailable',
      [STRIPE_ACCOUNT_ID],
    );
  });

  test('registration and lease recovery remain byte-preserving around plan binding', async () => {
    const mock = await createBoundPlan();
    const input = providerPlanInput(mock.db);
    const paths = providerPlanPaths(input);
    const before = cloneStore(mock.store);
    nowMillis += 1;

    await expect(registerCommerceCommand(validInput(mock.db)))
      .resolves.toMatchObject({ outcome: 'registered_existing' });
    await expect(acquireCommerceCommandLease(leaseInput(mock.db)))
      .resolves.toMatchObject({ outcome: 'lease_acquired', fenceEpoch: 1 });

    expect(mock.store).toEqual(before);
    for (const path_ of [
      paths.commandPath,
      paths.auditPath,
      paths.lifecyclePath,
      paths.lifecycleAuditPath,
      paths.providerPlanPath,
      paths.providerPlanAuditPath,
    ]) {
      expect(mock.store.get(path_)).toBe(before.get(path_));
    }
  });
});

describe('pre-POST Stripe send evidence and retry cutoff', () => {
  let nowMillis;
  let timestampNow;

  beforeEach(() => {
    nowMillis = NOW_MILLIS;
    timestampNow = jest.spyOn(Timestamp, 'now')
      .mockImplementation(() => Timestamp.fromMillis(nowMillis));
  });

  afterEach(() => jest.restoreAllMocks());

  async function createBoundPlan(mock, overrides = {}) {
    await registerCommerceCommand(validInput(mock.db, overrides));
    nowMillis += 1000;
    await acquireCommerceCommandLease(leaseInput(mock.db, overrides));
    nowMillis += 1000;
    await bindInitialStripeProviderPlan(providerPlanInput(mock.db, overrides));
  }

  async function recordEvidence(mock, overrides = {}) {
    nowMillis += 1000;
    return recordInitialStripeSendEvidence(providerPlanInput(mock.db, overrides));
  }

  test('atomically records one pre-send pair after all reads and preserves B2A/B2B/C1 bytes', async () => {
    const mock = createMockDb();
    await createBoundPlan(mock);
    const input = providerPlanInput(mock.db);
    const paths = providerSendPaths(input);
    const preserved = cloneStore(mock.store);
    const callsBefore = timestampNow.mock.calls.length;

    const result = await recordEvidence(mock);

    expect(result).toEqual({
      journalSchemaVersion: 1,
      providerPlanSchemaVersion: 1,
      providerSendEvidenceSchemaVersion: 1,
      outcome: 'send_permitted',
      state: 'pre_send_recorded',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(timestampNow).toHaveBeenCalledTimes(callsBefore + 2);
    const transactionRun = mock.callbackRuns.at(-1);
    expect(transactionRun.transaction.get).toHaveBeenCalledTimes(8);
    expect(transactionRun.transaction.create).toHaveBeenCalledTimes(2);
    expect(Math.max(...transactionRun.transaction.get.mock.invocationCallOrder))
      .toBeLessThan(Math.min(...transactionRun.transaction.create.mock.invocationCallOrder));
    expect(transactionRun.writes.map((write) => write.ref.path)).toEqual([
      paths.providerSendPath,
      paths.providerSendAuditPath,
    ]);

    const evidence = mock.store.get(paths.providerSendPath);
    const audit = mock.store.get(paths.providerSendAuditPath);
    expect(evidence).toEqual({
      providerSendEvidenceSchemaVersion: 1,
      providerPlanSchemaVersion: 1,
      commandIdentityVersion: 1,
      commandKeyHash: paths.commandKeyHash,
      providerAttempt: 1,
      provider: 'stripe',
      providerPlanCommitment: expect.stringMatching(/^[0-9a-f]{64}$/),
      prePostFenceEpoch: 1,
      prePostRecordedAt: expect.any(Timestamp),
      automaticRetryDeadlineAt: expect.any(Timestamp),
    });
    expect(audit).toEqual({
      providerSendAuditSchemaVersion: 1,
      aggregateType: 'commerce_provider_send',
      commandKeyHash: paths.commandKeyHash,
      providerAttempt: 1,
      eventType: 'provider_pre_send_recorded',
      provider: 'stripe',
      environment: 'test',
      stripeMode: 'test',
      providerOperation: PROVIDER_OPERATION,
      providerPlanCommitment: evidence.providerPlanCommitment,
      prePostFenceEpoch: 1,
      automaticRetryDeadlineAt: expect.any(Timestamp),
      occurredAt: expect.any(Timestamp),
    });
    expect(evidence.prePostRecordedAt).toBe(audit.occurredAt);
    expect(evidence.automaticRetryDeadlineAt).toBe(audit.automaticRetryDeadlineAt);
    expect(evidence.prePostRecordedAt.toMillis()).toBe(NOW_MILLIS + 3000);
    expect(evidence.automaticRetryDeadlineAt.toMillis()
      - evidence.prePostRecordedAt.toMillis()).toBe(PROVIDER_SEND_RETRY_WINDOW_MILLIS);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(audit)).toBe(true);
    for (const [path_, value] of preserved) expect(mock.store.get(path_)).toBe(value);

    const rawStripeKey = createStripeIdempotencyKey({
      stripeMode: 'test',
      environment: 'test',
      providerOperation: PROVIDER_OPERATION,
      commandKeyHash: paths.commandKeyHash,
      providerAttempt: 1,
    }).stripeIdempotencyKey;
    const rendered = JSON.stringify({ result, evidence, audit });
    for (const raw of [
      STRIPE_ACCOUNT_ID,
      HOSTILE_CANARY,
      rawStripeKey,
      LEASE_ID,
      RAW_CALLER,
      COMMAND_ID,
    ]) expect(rendered).not.toContain(raw);
  });

  test('transaction retries reuse one trusted timestamp, deadline, and immutable pair', async () => {
    const foundation = createMockDb();
    await createBoundPlan(foundation);
    const mock = createMockDb([...foundation.store], { callbackRuns: 4 });
    timestampNow.mockClear();
    nowMillis += 1000;

    const result = await recordInitialStripeSendEvidence(providerPlanInput(mock.db));

    expect(result.outcome).toBe('send_permitted');
    expect(timestampNow).toHaveBeenCalledTimes(2);
    const retries = mock.callbackRuns.slice(-4);
    expect(retries).toHaveLength(4);
    const evidence = retries.map(({ writes }) => writes[0].value);
    const audits = retries.map(({ writes }) => writes[1].value);
    expect(new Set(evidence.map((value) => value.prePostRecordedAt))).toHaveProperty('size', 1);
    expect(new Set(evidence.map((value) => value.automaticRetryDeadlineAt)))
      .toHaveProperty('size', 1);
    expect(new Set(audits.map((value) => value.occurredAt))).toHaveProperty('size', 1);
    expect(new Set(audits.map((value) => value.automaticRetryDeadlineAt)))
      .toHaveProperty('size', 1);
  });

  test('exact and canonically equivalent retries are read-only while plan changes conflict', async () => {
    const mock = createMockDb();
    await createBoundPlan(mock);
    await recordEvidence(mock);
    const paths = providerSendPaths(providerPlanInput(mock.db));
    const before = cloneStore(mock.store);
    nowMillis += 1;
    const equivalentParameters = validProviderParameters([
      ['synthetic_reference', HOSTILE_CANARY],
      ['currency', 'usd'],
      ['amount_total', 2500],
    ]);

    await expect(recordInitialStripeSendEvidence(providerPlanInput(mock.db)))
      .resolves.toMatchObject({ outcome: 'send_permitted' });
    await expect(recordInitialStripeSendEvidence(providerPlanInput(mock.db, {
      providerParameters: equivalentParameters,
    }))).resolves.toMatchObject({ outcome: 'send_permitted' });
    await expectSafeError(
      () => recordInitialStripeSendEvidence(providerPlanInput(mock.db, {
        stripeAccountId: OTHER_STRIPE_ACCOUNT_ID,
      })),
      'command_conflict',
      [STRIPE_ACCOUNT_ID, OTHER_STRIPE_ACCOUNT_ID],
    );
    expect(mock.store).toEqual(before);
    expect(mock.store.get(paths.providerSendPath)).toBe(before.get(paths.providerSendPath));
    expect(mock.store.get(paths.providerSendAuditPath))
      .toBe(before.get(paths.providerSendAuditPath));
    for (const { writes } of mock.callbackRuns.slice(-3)) expect(writes).toEqual([]);
  });

  test('a self-consistent C1 replacement cannot reuse earlier send evidence', async () => {
    const original = createMockDb();
    await createBoundPlan(original);
    await recordEvidence(original);
    const originalPaths = providerSendPaths(providerPlanInput(original.db));

    nowMillis = NOW_MILLIS;
    const replacement = createMockDb();
    const replacementParameters = validProviderParameters([
      ['amount_total', 5100],
      ['currency', 'usd'],
      ['synthetic_reference', 'replacement-plan'],
    ]);
    const replacementOverrides = {
      stripeAccountId: OTHER_STRIPE_ACCOUNT_ID,
      stripeApiVersion: '2024-06-20',
      providerParameters: replacementParameters,
    };
    await registerCommerceCommand(validInput(replacement.db));
    nowMillis += 1000;
    await acquireCommerceCommandLease(leaseInput(replacement.db));
    nowMillis += 1000;
    await bindInitialStripeProviderPlan(providerPlanInput(
      replacement.db,
      replacementOverrides,
    ));
    const replacementPaths = providerPlanPaths(providerPlanInput(
      replacement.db,
      replacementOverrides,
    ));

    const replacedStore = cloneStore(original.store);
    replacedStore.set(
      originalPaths.providerPlanPath,
      replacement.store.get(replacementPaths.providerPlanPath),
    );
    replacedStore.set(
      originalPaths.providerPlanAuditPath,
      replacement.store.get(replacementPaths.providerPlanAuditPath),
    );
    const mock = createMockDb([...replacedStore]);
    const before = cloneStore(mock.store);
    nowMillis = NOW_MILLIS + 3001;

    await expectSafeError(
      () => recordInitialStripeSendEvidence(providerPlanInput(mock.db, replacementOverrides)),
      'journal_record_invalid',
      [STRIPE_ACCOUNT_ID, OTHER_STRIPE_ACCOUNT_ID],
    );
    expect(mock.store).toEqual(before);
    expect(mock.callbackRuns.at(-1).writes).toEqual([]);
  });

  test('post-transaction lease expiry downgrades a committed marker before send', async () => {
    const mock = createMockDb();
    await createBoundPlan(mock);
    const paths = providerSendPaths(providerPlanInput(mock.db));
    const checkedAt = Timestamp.fromMillis(NOW_MILLIS + 3000);
    const leaseExpiry = Timestamp.fromMillis(NOW_MILLIS + 61000);
    timestampNow
      .mockImplementationOnce(() => checkedAt)
      .mockImplementationOnce(() => leaseExpiry);

    await expect(recordInitialStripeSendEvidence(providerPlanInput(mock.db)))
      .resolves.toMatchObject({ outcome: 'reconciliation_required' });
    expect(mock.store.has(paths.providerSendPath)).toBe(true);
    expect(mock.store.has(paths.providerSendAuditPath)).toBe(true);
  });

  test('post-transaction deadline equality and clock rollback downgrade read-only retries', async () => {
    const mock = createMockDb();
    await createBoundPlan(mock);
    await recordEvidence(mock);
    const paths = providerSendPaths(providerPlanInput(mock.db));
    const evidence = mock.store.get(paths.providerSendPath);
    const deadline = evidence.automaticRetryDeadlineAt;
    const immediatelyBeforeDeadline = new Timestamp(
      deadline._seconds,
      deadline._nanoseconds - 1,
    );
    const beforeMarker = new Timestamp(
      evidence.prePostRecordedAt._seconds,
      evidence.prePostRecordedAt._nanoseconds - 1,
    );

    nowMillis = deadline.toMillis() - 1000;
    await acquireCommerceCommandLease(leaseInput(mock.db, { leaseId: OTHER_LEASE_ID }));
    const before = cloneStore(mock.store);
    const takeoverInput = providerPlanInput(mock.db, {
      leaseId: OTHER_LEASE_ID,
      expectedFenceEpoch: 2,
    });

    timestampNow
      .mockImplementationOnce(() => immediatelyBeforeDeadline)
      .mockImplementationOnce(() => deadline);
    await expect(recordInitialStripeSendEvidence(takeoverInput))
      .resolves.toMatchObject({ outcome: 'reconciliation_required' });

    timestampNow
      .mockImplementationOnce(() => immediatelyBeforeDeadline)
      .mockImplementationOnce(() => beforeMarker);
    await expect(recordInitialStripeSendEvidence(takeoverInput))
      .resolves.toMatchObject({ outcome: 'reconciliation_required' });
    expect(mock.store).toEqual(before);
  });

  test('permits only strictly before the persisted 23-hour deadline at nanosecond precision', async () => {
    const mock = createMockDb();
    await createBoundPlan(mock);
    await recordEvidence(mock);
    const paths = providerSendPaths(providerPlanInput(mock.db));
    const evidence = mock.store.get(paths.providerSendPath);
    const deadline = evidence.automaticRetryDeadlineAt;
    const first = evidence.prePostRecordedAt;

    timestampNow.mockImplementationOnce(() => new Timestamp(
      first._seconds,
      first._nanoseconds - 1,
    ));
    await expect(recordInitialStripeSendEvidence(providerPlanInput(mock.db)))
      .resolves.toEqual({
        journalSchemaVersion: 1,
        providerPlanSchemaVersion: 1,
        providerSendEvidenceSchemaVersion: 1,
        outcome: 'reconciliation_required',
        state: 'provider_outcome_unknown',
      });

    nowMillis = deadline.toMillis() - 1000;
    await acquireCommerceCommandLease(leaseInput(mock.db, { leaseId: OTHER_LEASE_ID }));
    const takeoverInput = providerPlanInput(mock.db, {
      leaseId: OTHER_LEASE_ID,
      expectedFenceEpoch: 2,
    });
    const immediatelyBeforeDeadline = new Timestamp(
      deadline._seconds,
      deadline._nanoseconds - 1,
    );
    timestampNow
      .mockImplementationOnce(() => immediatelyBeforeDeadline)
      .mockImplementationOnce(() => immediatelyBeforeDeadline);
    await expect(recordInitialStripeSendEvidence(takeoverInput))
      .resolves.toMatchObject({ outcome: 'send_permitted' });
    timestampNow.mockImplementationOnce(() => new Timestamp(
      deadline._seconds,
      deadline._nanoseconds,
    ));
    await expect(recordInitialStripeSendEvidence(takeoverInput))
      .resolves.toMatchObject({ outcome: 'reconciliation_required' });
    timestampNow.mockImplementationOnce(() => new Timestamp(
      deadline._seconds,
      deadline._nanoseconds + 1,
    ));
    await expect(recordInitialStripeSendEvidence(takeoverInput))
      .resolves.toMatchObject({ outcome: 'reconciliation_required' });
    expect(mock.store.get(paths.providerSendPath)).toBe(evidence);
  });

  test('missing or unreadable paired times require reconciliation without mutation', async () => {
    const foundation = createMockDb();
    await createBoundPlan(foundation);
    await recordEvidence(foundation);
    const paths = providerSendPaths(providerPlanInput(foundation.db));

    for (const mutate of [
      (record, audit) => {
        const nextRecord = { ...record };
        const nextAudit = { ...audit };
        delete nextRecord.prePostRecordedAt;
        delete nextAudit.occurredAt;
        return [Object.freeze(nextRecord), Object.freeze(nextAudit)];
      },
      (record, audit) => [Object.freeze({
        ...record,
        automaticRetryDeadlineAt: { _seconds: 1, _nanoseconds: 0 },
      }), audit],
      (record, audit) => [record, Object.freeze({
        ...audit,
        occurredAt: Timestamp.fromMillis(record.prePostRecordedAt.toMillis() + 1),
      })],
    ]) {
      const seed = cloneStore(foundation.store);
      const [record, audit] = mutate(
        seed.get(paths.providerSendPath),
        seed.get(paths.providerSendAuditPath),
      );
      seed.set(paths.providerSendPath, record);
      seed.set(paths.providerSendAuditPath, audit);
      const mock = createMockDb([...seed]);
      const before = cloneStore(mock.store);
      nowMillis += 1;

      await expect(recordInitialStripeSendEvidence(providerPlanInput(mock.db)))
        .resolves.toMatchObject({ outcome: 'reconciliation_required' });
      expect(mock.store).toEqual(before);
      expect(mock.callbackRuns.at(-1).writes).toEqual([]);
    }
  });

  test('orphan, future, extra, and missing C1 partners fail closed without repair', async () => {
    const active = createMockDb();
    await registerCommerceCommand(validInput(active.db));
    nowMillis += 1000;
    await acquireCommerceCommandLease(leaseInput(active.db));
    await expectSafeError(
      () => recordInitialStripeSendEvidence(providerPlanInput(active.db)),
      'journal_record_invalid',
    );

    const foundation = createMockDb();
    await createBoundPlan(foundation);
    await recordEvidence(foundation);
    const paths = providerSendPaths(providerPlanInput(foundation.db));
    const corruptions = [
      (seed) => seed.delete(paths.providerSendAuditPath),
      (seed) => seed.set(paths.providerSendPath, Object.freeze({
        ...seed.get(paths.providerSendPath),
        providerSendEvidenceSchemaVersion: 2,
      })),
      (seed) => seed.set(paths.providerSendAuditPath, Object.freeze({
        ...seed.get(paths.providerSendAuditPath),
        unexpected: HOSTILE_CANARY,
      })),
      (seed) => seed.delete(paths.providerPlanAuditPath),
    ];

    for (const corrupt of corruptions) {
      const seed = cloneStore(foundation.store);
      corrupt(seed);
      const mock = createMockDb([...seed]);
      const before = cloneStore(mock.store);
      nowMillis += 1;
      await expectSafeError(
        () => recordInitialStripeSendEvidence(providerPlanInput(mock.db)),
        'journal_record_invalid',
      );
      expect(mock.store).toEqual(before);
      expect(mock.callbackRuns.at(-1).transaction.create).not.toHaveBeenCalled();
    }
  });

  test('accessors, proxies, and a missing originating lease audit fail without traps or repair', async () => {
    const foundation = createMockDb();
    await createBoundPlan(foundation);
    await recordEvidence(foundation);
    const paths = providerSendPaths(providerPlanInput(foundation.db));

    let getterCalls = 0;
    const accessor = { ...foundation.store.get(paths.providerSendPath) };
    Object.defineProperty(accessor, 'provider', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return HOSTILE_CANARY;
      },
    });
    let mock = createMockDb([...foundation.store]);
    mock.store.set(paths.providerSendPath, accessor);
    await expectSafeError(
      () => recordInitialStripeSendEvidence(providerPlanInput(mock.db)),
      'journal_record_invalid',
    );
    expect(getterCalls).toBe(0);

    let trapCalls = 0;
    const proxy = new Proxy(foundation.store.get(paths.providerSendAuditPath), {
      ownKeys() {
        trapCalls += 1;
        return [];
      },
    });
    mock = createMockDb([...foundation.store]);
    mock.store.set(paths.providerSendAuditPath, proxy);
    await expectSafeError(
      () => recordInitialStripeSendEvidence(providerPlanInput(mock.db)),
      'journal_record_invalid',
    );
    expect(trapCalls).toBe(0);

    nowMillis = NOW_MILLIS + 61000;
    await acquireCommerceCommandLease(leaseInput(foundation.db, { leaseId: OTHER_LEASE_ID }));
    const missingHistory = cloneStore(foundation.store);
    missingHistory.delete(paths.lifecycleAuditPath);
    mock = createMockDb([...missingHistory]);
    const before = cloneStore(mock.store);
    nowMillis += 1;
    await expectSafeError(
      () => recordInitialStripeSendEvidence(providerPlanInput(mock.db, {
        leaseId: OTHER_LEASE_ID,
        expectedFenceEpoch: 2,
      })),
      'journal_record_invalid',
    );
    expect(mock.store).toEqual(before);
  });

  test('wrong holder, wrong fence, expired lease, and terminal state never reveal the marker', async () => {
    const mock = createMockDb();
    await createBoundPlan(mock);
    await recordEvidence(mock);
    const before = cloneStore(mock.store);
    nowMillis += 1;

    for (const change of [
      { leaseId: OTHER_LEASE_ID },
      { expectedFenceEpoch: 2 },
      { leaseId: OTHER_LEASE_ID, expectedFenceEpoch: 2 },
    ]) {
      await expectSafeError(
        () => recordInitialStripeSendEvidence(providerPlanInput(mock.db, change)),
        'lease_stale',
      );
    }
    nowMillis = NOW_MILLIS + 61000;
    await expectSafeError(
      () => recordInitialStripeSendEvidence(providerPlanInput(mock.db)),
      'lease_stale',
    );
    expect(mock.store).toEqual(before);

    const terminal = createMockDb();
    nowMillis = NOW_MILLIS;
    await createBoundPlan(terminal);
    nowMillis += 1000;
    await completeCommerceCommand(completionInput(terminal.db));
    await expectSafeError(
      () => recordInitialStripeSendEvidence(providerPlanInput(terminal.db)),
      'lease_stale',
    );
  });

  test('rejects ambiguous outcomes and caller-selected send controls without advancing', async () => {
    const mock = createMockDb();
    await createBoundPlan(mock);
    await recordEvidence(mock);
    const before = cloneStore(mock.store);
    const paths = providerSendPaths(providerPlanInput(mock.db));
    const transactionCount = mock.db.runTransaction.mock.calls.length;
    for (const extra of [
      { providerOutcome: 'timeout' },
      { providerOutcome: 'connection_loss' },
      { providerOutcome: 'stripe_5xx' },
      { providerHttpStatus: 500 },
      { providerAttempt: 2 },
      { httpMethod: 'POST' },
      { stripeIdempotencyKey: HOSTILE_CANARY },
      { retryWindowSeconds: 86400 },
      { automaticRetryDeadlineAt: Timestamp.fromMillis(NOW_MILLIS) },
    ]) {
      await expectSafeError(
        () => recordInitialStripeSendEvidence({ ...providerPlanInput(mock.db), ...extra }),
        'invalid_command_input',
      );
    }
    expect(mock.db.runTransaction).toHaveBeenCalledTimes(transactionCount);
    expect(mock.store).toEqual(before);
    expect(mock.store.has(`${paths.commandPath}/providerAttempts/0000000002`)).toBe(false);
  });

  test('commit failure leaves no half-pair and forged transaction output is redacted', async () => {
    const foundation = createMockDb();
    await createBoundPlan(foundation);
    const paths = providerSendPaths(providerPlanInput(foundation.db));
    const commitFailure = createMockDb([...foundation.store], {
      rejectCommit: new Error(`${HOSTILE_CANARY}/${STRIPE_ACCOUNT_ID}`),
    });
    const before = cloneStore(commitFailure.store);
    nowMillis += 1;
    await expectSafeError(
      () => recordInitialStripeSendEvidence(providerPlanInput(commitFailure.db)),
      'journal_unavailable',
      [STRIPE_ACCOUNT_ID],
    );
    expect(commitFailure.store).toEqual(before);
    expect(commitFailure.store.has(paths.providerSendPath)).toBe(false);
    expect(commitFailure.store.has(paths.providerSendAuditPath)).toBe(false);

    const forged = createMockDb([...foundation.store], {
      returnedValue: Object.freeze({ outcome: HOSTILE_CANARY }),
    });
    await expectSafeError(
      () => recordInitialStripeSendEvidence(providerPlanInput(forged.db)),
      'journal_unavailable',
    );
  });

  test('a retry-window timestamp overflow fails before Firestore', async () => {
    const mock = createMockDb();
    timestampNow.mockImplementationOnce(() => new Timestamp(253402300790, 0));
    await expectSafeError(
      () => recordInitialStripeSendEvidence(providerPlanInput(mock.db)),
      'journal_unavailable',
    );
    expect(mock.db.runTransaction).not.toHaveBeenCalled();
  });
});

describe('immutable initial Stripe reconciliation evidence', () => {
  let nowMillis;

  beforeEach(() => {
    nowMillis = NOW_MILLIS;
    jest.spyOn(Timestamp, 'now')
      .mockImplementation(() => Timestamp.fromMillis(nowMillis));
  });

  afterEach(() => jest.restoreAllMocks());

  async function createSendFoundation(mock) {
    await registerCommerceCommand(validInput(mock.db));
    nowMillis += 1000;
    await acquireCommerceCommandLease(leaseInput(mock.db));
    nowMillis += 1000;
    await bindInitialStripeProviderPlan(providerPlanInput(mock.db));
    nowMillis += 1000;
    await recordInitialStripeSendEvidence(providerPlanInput(mock.db));
  }

  function moveToSendCutoff(mock, input = providerReconciliationInput(mock.db)) {
    const paths = providerReconciliationPaths(input);
    nowMillis = mock.store.get(paths.providerSendPath).automaticRetryDeadlineAt.toMillis();
    return paths;
  }

  test('creates one candidate pair at the C2 cutoff with no active lease and preserves prior bytes', async () => {
    const mock = createMockDb();
    await createSendFoundation(mock);
    const input = providerReconciliationInput(mock.db);
    const paths = providerReconciliationPaths(input);
    const before = cloneStore(mock.store);
    nowMillis = mock.store.get(paths.providerSendPath).automaticRetryDeadlineAt.toMillis();

    const result = await recordInitialStripeReconciliationEvidence(input);

    expect(providerReconciliationEvidenceSchemaVersion).toBe(1);
    expect(result).toEqual({
      journalSchemaVersion: 1,
      providerReconciliationEvidenceSchemaVersion: 1,
      reconciliationPolicySchemaVersion: 1,
      outcome: 'reconciliation_candidate_persisted',
      state: 'requires_separate_authorization',
    });
    expect(Object.isFrozen(result)).toBe(true);
    const transactionRun = mock.callbackRuns.at(-1);
    expect(transactionRun.transaction.get).toHaveBeenCalledTimes(10);
    expect(transactionRun.transaction.create).toHaveBeenCalledTimes(2);
    expect(Math.max(...transactionRun.transaction.get.mock.invocationCallOrder))
      .toBeLessThan(Math.min(...transactionRun.transaction.create.mock.invocationCallOrder));
    expect(transactionRun.writes.map((write) => write.ref.path)).toEqual([
      paths.providerReconciliationPath,
      paths.providerReconciliationAuditPath,
    ]);

    const record = mock.store.get(paths.providerReconciliationPath);
    const audit = mock.store.get(paths.providerReconciliationAuditPath);
    expect(record).toEqual({
      providerReconciliationEvidenceSchemaVersion: 1,
      reconciliationPolicySchemaVersion: 1,
      providerPlanSchemaVersion: 1,
      providerSendEvidenceSchemaVersion: 1,
      commandIdentityVersion: 1,
      commandKeyHash: paths.commandKeyHash,
      providerAttempt: 1,
      provider: 'stripe',
      evidenceRevision: 1,
      providerPlanCommitment: expect.stringMatching(/^[0-9a-f]{64}$/),
      providerSendEvidenceCommitment: expect.stringMatching(/^[0-9a-f]{64}$/),
      classification: 'new_attempt_candidate',
      state: 'requires_persistence_and_authorization',
      planBinding: 'exact',
      evidenceSource: 'trusted_dispatch_history',
      evidenceCompleteness: 'complete',
      dispatchEvidence: 'execution_never_began',
      responseEvidence: 'none',
      idempotencyEvidence: 'not_relied_upon',
      providerObjectEvidence: 'none',
      paymentEvidence: 'none',
      eventEvidence: 'none',
      searchEvidence: 'none',
      businessTransitionEvidence: 'same_operation_eligible',
      observedFenceEpoch: 1,
      observedLeaseExpiresAt: expect.any(Timestamp),
      recordedAt: expect.any(Timestamp),
    });
    expect(audit).toEqual({
      providerReconciliationAuditSchemaVersion: 1,
      providerReconciliationEvidenceSchemaVersion: 1,
      aggregateType: 'commerce_provider_reconciliation',
      commandKeyHash: paths.commandKeyHash,
      providerAttempt: 1,
      evidenceRevision: 1,
      eventType: 'provider_reconciliation_candidate_recorded',
      provider: 'stripe',
      environment: 'test',
      stripeMode: 'test',
      providerOperation: PROVIDER_OPERATION,
      providerPlanCommitment: record.providerPlanCommitment,
      providerSendEvidenceCommitment: record.providerSendEvidenceCommitment,
      reconciliationPolicySchemaVersion: 1,
      classification: 'new_attempt_candidate',
      observedFenceEpoch: 1,
      observedLeaseExpiresAt: record.observedLeaseExpiresAt,
      reconciliationEvidenceCommitment: expect.stringMatching(/^[0-9a-f]{64}$/),
      occurredAt: expect.any(Timestamp),
    });
    expect(record.recordedAt).toBe(audit.occurredAt);
    expect(record.observedLeaseExpiresAt).toBe(audit.observedLeaseExpiresAt);
    expect(record.recordedAt.toMillis()).toBe(
      before.get(paths.providerSendPath).automaticRetryDeadlineAt.toMillis(),
    );
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(audit)).toBe(true);
    for (const [path_, value] of before) expect(mock.store.get(path_)).toBe(value);
  });

  test('transaction retries snapshot evidence once and create the same pair after every read', async () => {
    const foundation = createMockDb();
    await createSendFoundation(foundation);
    moveToSendCutoff(foundation);
    const evidence = candidateReconciliationEvidence();
    const mock = createMockDb([...foundation.store], {
      callbackRuns: 4,
      beforeCallbackRun: async (index) => {
        if (index === 1) evidence.dispatchEvidence = 'timeout';
      },
    });
    const input = providerReconciliationInput(mock.db, {
      reconciliationEvidence: evidence,
    });
    Timestamp.now.mockClear();

    const result = await recordInitialStripeReconciliationEvidence(input);

    expect(result.outcome).toBe('reconciliation_candidate_persisted');
    expect(Timestamp.now).toHaveBeenCalledTimes(2);
    expect(mock.callbackRuns).toHaveLength(4);
    for (const { transaction, writes } of mock.callbackRuns) {
      expect(transaction.get).toHaveBeenCalledTimes(10);
      expect(transaction.create).toHaveBeenCalledTimes(2);
      expect(writes).toHaveLength(2);
      expect(writes[0].value.dispatchEvidence).toBe('execution_never_began');
    }
    const recordWrites = mock.callbackRuns.map(({ writes }) => writes[0].value);
    const auditWrites = mock.callbackRuns.map(({ writes }) => writes[1].value);
    expect(recordWrites.every((value) => JSON.stringify(value) === JSON.stringify(recordWrites[0])))
      .toBe(true);
    expect(auditWrites.every((value) => JSON.stringify(value) === JSON.stringify(auditWrites[0])))
      .toBe(true);
  });

  test('an earlier-started call accepts the exact pair committed by a later-started call', async () => {
    const foundation = createMockDb();
    await createSendFoundation(foundation);
    const paths = moveToSendCutoff(foundation);
    const cutoff = foundation.store.get(
      paths.providerSendPath,
    ).automaticRetryDeadlineAt.toMillis();
    let releaseEarlier;
    let markEarlierStarted;
    const earlierBlocked = new Promise((resolve) => { releaseEarlier = resolve; });
    const earlierStarted = new Promise((resolve) => { markEarlierStarted = resolve; });
    const earlier = createMockDb([], {
      sharedStore: foundation.store,
      beforeCallbackRun: async () => {
        markEarlierStarted();
        await earlierBlocked;
      },
    });
    const later = createMockDb([], { sharedStore: foundation.store });
    for (const offset of [0, 1, 2, 3]) {
      Timestamp.now.mockImplementationOnce(() => Timestamp.fromMillis(cutoff + offset));
    }
    Timestamp.now.mockClear();

    const earlierPromise = recordInitialStripeReconciliationEvidence(
      providerReconciliationInput(earlier.db),
    );
    await earlierStarted;
    let laterResult;
    try {
      laterResult = await recordInitialStripeReconciliationEvidence(
        providerReconciliationInput(later.db),
      );
    } finally {
      releaseEarlier();
    }
    const earlierResult = await earlierPromise;

    expect(laterResult).toMatchObject({ outcome: 'reconciliation_candidate_persisted' });
    expect(earlierResult).toEqual(laterResult);
    expect(Timestamp.now).toHaveBeenCalledTimes(4);
    expect(later.callbackRuns[0].writes).toHaveLength(2);
    expect(earlier.callbackRuns[0].writes).toEqual([]);
    expect(foundation.store.get(paths.providerReconciliationPath).recordedAt.toMillis())
      .toBe(cutoff + 1);
  });

  test('waits for both the C2 cutoff and current lease expiry without persisting', async () => {
    const mock = createMockDb();
    await createSendFoundation(mock);
    const input = providerReconciliationInput(mock.db);
    const paths = providerReconciliationPaths(input);
    const cutoff = mock.store.get(paths.providerSendPath).automaticRetryDeadlineAt.toMillis();

    nowMillis += 1;
    await expect(recordInitialStripeReconciliationEvidence(input)).resolves.toEqual({
      reconciliationPolicySchemaVersion: 1,
      classification: 'new_attempt_candidate',
      state: 'requires_persistence_and_authorization',
    });
    expect(mock.store.has(paths.providerReconciliationPath)).toBe(false);

    nowMillis = cutoff - 30000;
    await acquireCommerceCommandLease(leaseInput(mock.db, { leaseId: OTHER_LEASE_ID }));
    nowMillis = cutoff;
    const activeResult = await recordInitialStripeReconciliationEvidence(input);
    expect(activeResult.classification).toBe('new_attempt_candidate');
    expect(mock.store.has(paths.providerReconciliationPath)).toBe(false);
    expect(mock.store.get(paths.lifecyclePath).fenceEpoch).toBe(2);

    nowMillis = cutoff + 30000;
    const persisted = await recordInitialStripeReconciliationEvidence(input);
    expect(persisted.outcome).toBe('reconciliation_candidate_persisted');
    expect(mock.store.get(paths.providerReconciliationPath)).toMatchObject({
      observedFenceEpoch: 2,
      observedLeaseExpiresAt: Timestamp.fromMillis(cutoff + 30000),
    });
  });

  test('uses nanosecond precision at the C2 deadline and lease-expiry boundaries', async () => {
    const mock = createMockDb();
    await createSendFoundation(mock);
    const input = providerReconciliationInput(mock.db);
    const paths = providerReconciliationPaths(input);
    const deadline = mock.store.get(paths.providerSendPath).automaticRetryDeadlineAt;
    const oneNanosecondBefore = deadline.nanoseconds === 0
      ? new Timestamp(deadline.seconds - 1, 999999999)
      : new Timestamp(deadline.seconds, deadline.nanoseconds - 1);
    Timestamp.now.mockImplementationOnce(() => oneNanosecondBefore);

    expect(await recordInitialStripeReconciliationEvidence(input)).toEqual({
      reconciliationPolicySchemaVersion: 1,
      classification: 'new_attempt_candidate',
      state: 'requires_persistence_and_authorization',
    });
    expect(mock.store.has(paths.providerReconciliationPath)).toBe(false);

    Timestamp.now.mockImplementationOnce(() => new Timestamp(
      deadline.seconds,
      deadline.nanoseconds,
    ));
    Timestamp.now.mockImplementationOnce(() => new Timestamp(
      deadline.seconds,
      deadline.nanoseconds,
    ));
    expect(await recordInitialStripeReconciliationEvidence(input)).toMatchObject({
      outcome: 'reconciliation_candidate_persisted',
    });
    expect(mock.store.get(paths.providerReconciliationPath).recordedAt).toEqual(deadline);

    nowMillis = NOW_MILLIS;
    const leaseMock = createMockDb();
    await createSendFoundation(leaseMock);
    const leaseReconciliationInput = providerReconciliationInput(leaseMock.db);
    const leasePaths = providerReconciliationPaths(leaseReconciliationInput);
    const leaseDeadline = leaseMock.store.get(
      leasePaths.providerSendPath,
    ).automaticRetryDeadlineAt;
    nowMillis = leaseDeadline.toMillis();
    await acquireCommerceCommandLease(leaseInput(leaseMock.db, {
      leaseId: OTHER_LEASE_ID,
    }));
    const leaseExpiry = leaseMock.store.get(leasePaths.lifecyclePath).leaseExpiresAt;
    const oneNanosecondBeforeExpiry = leaseExpiry.nanoseconds === 0
      ? new Timestamp(leaseExpiry.seconds - 1, 999999999)
      : new Timestamp(leaseExpiry.seconds, leaseExpiry.nanoseconds - 1);
    Timestamp.now.mockImplementationOnce(() => oneNanosecondBeforeExpiry);
    expect(await recordInitialStripeReconciliationEvidence(
      leaseReconciliationInput,
    )).toEqual({
      reconciliationPolicySchemaVersion: 1,
      classification: 'new_attempt_candidate',
      state: 'requires_persistence_and_authorization',
    });
    expect(leaseMock.store.has(leasePaths.providerReconciliationPath)).toBe(false);

    Timestamp.now.mockImplementationOnce(() => new Timestamp(
      leaseExpiry.seconds,
      leaseExpiry.nanoseconds,
    ));
    Timestamp.now.mockImplementationOnce(() => new Timestamp(
      leaseExpiry.seconds,
      leaseExpiry.nanoseconds,
    ));
    expect(await recordInitialStripeReconciliationEvidence(
      leaseReconciliationInput,
    )).toMatchObject({
      outcome: 'reconciliation_candidate_persisted',
    });
    expect(leaseMock.store.get(leasePaths.providerReconciliationPath)).toMatchObject({
      observedFenceEpoch: 2,
      observedLeaseExpiresAt: leaseExpiry,
    });
  });

  test('terminal lifecycle without a C3B pair returns the unchanged candidate and writes nothing', async () => {
    const mock = createMockDb();
    await createSendFoundation(mock);
    const input = providerReconciliationInput(mock.db);
    const paths = providerReconciliationPaths(input);
    nowMillis += 1;
    await completeCommerceCommand(completionInput(mock.db));
    moveToSendCutoff(mock, input);
    const runsBefore = mock.callbackRuns.length;

    const result = await recordInitialStripeReconciliationEvidence(input);

    expect(result).toEqual({
      reconciliationPolicySchemaVersion: 1,
      classification: 'new_attempt_candidate',
      state: 'requires_persistence_and_authorization',
    });
    expect(mock.store.has(paths.providerReconciliationPath)).toBe(false);
    expect(mock.store.has(paths.providerReconciliationAuditPath)).toBe(false);
    expect(mock.callbackRuns.slice(runsBefore).at(-1).writes).toEqual([]);
  });

  test('an exact C3B pair remains read-only after a takeover reaches terminal state', async () => {
    const mock = createMockDb();
    await createSendFoundation(mock);
    const input = providerReconciliationInput(mock.db);
    const paths = moveToSendCutoff(mock, input);
    await recordInitialStripeReconciliationEvidence(input);
    const recordBefore = mock.store.get(paths.providerReconciliationPath);
    const auditBefore = mock.store.get(paths.providerReconciliationAuditPath);

    await acquireCommerceCommandLease(leaseInput(mock.db, { leaseId: OTHER_LEASE_ID }));
    nowMillis += 1;
    await completeCommerceCommand(completionInput(mock.db, {
      leaseId: OTHER_LEASE_ID,
      expectedFenceEpoch: 2,
    }));
    nowMillis += 1;

    expect(await recordInitialStripeReconciliationEvidence(input)).toMatchObject({
      outcome: 'reconciliation_candidate_persisted',
      state: 'requires_separate_authorization',
    });
    expect(mock.callbackRuns.at(-1).writes).toEqual([]);
    expect(mock.store.get(paths.providerReconciliationPath)).toBe(recordBefore);
    expect(mock.store.get(paths.providerReconciliationAuditPath)).toBe(auditBefore);

    const terminalLeaseAuditPath = lifecyclePaths(input, 3).lifecycleAuditPath;
    const terminalLeaseAudit = mock.store.get(terminalLeaseAuditPath);
    mock.store.set(terminalLeaseAuditPath, {
      ...terminalLeaseAudit,
      occurredAt: Timestamp.fromMillis(terminalLeaseAudit.occurredAt.toMillis() + 1),
      leaseExpiresAt: Timestamp.fromMillis(terminalLeaseAudit.leaseExpiresAt.toMillis() + 1),
    });
    const beforeMalformedRetry = cloneStore(mock.store);
    nowMillis += 1;
    await expectSafeError(
      () => recordInitialStripeReconciliationEvidence(input),
      'journal_record_invalid',
    );
    expect(mock.store).toEqual(beforeMalformedRetry);
  });

  test.each([
    [
      'existing attempt',
      candidateReconciliationEvidence({
        evidenceSource: 'verified_provider_object',
        dispatchEvidence: 'execution_started',
        responseEvidence: 'accepted',
        providerObjectEvidence: 'exact_open',
        paymentEvidence: 'unpaid',
        searchEvidence: 'exact_lookup_complete',
        businessTransitionEvidence: 'ineligible',
      }),
      'existing_attempt_found',
      'do_not_advance',
    ],
    [
      'unsafe evidence',
      candidateReconciliationEvidence({ dispatchEvidence: 'timeout' }),
      'reconciliation_required',
      'requires_reconciliation',
    ],
  ])('returns unchanged C3A %s classification and writes nothing', async (
    _label,
    reconciliationEvidence,
    classification,
    state,
  ) => {
    const mock = createMockDb();
    await createSendFoundation(mock);
    const paths = moveToSendCutoff(mock);
    const runsBefore = mock.callbackRuns.length;

    const result = await recordInitialStripeReconciliationEvidence(
      providerReconciliationInput(mock.db, { reconciliationEvidence }),
    );

    expect(result).toEqual({
      reconciliationPolicySchemaVersion: 1,
      classification,
      state,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(mock.store.has(paths.providerReconciliationPath)).toBe(false);
    const [{ transaction, writes }] = mock.callbackRuns.slice(runsBefore);
    expect(transaction.create).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  test('exact and canonical retries are read-only while any valid change conflicts', async () => {
    const mock = createMockDb();
    await createSendFoundation(mock);
    const input = providerReconciliationInput(mock.db);
    const paths = moveToSendCutoff(mock, input);
    await recordInitialStripeReconciliationEvidence(input);
    const recordBefore = mock.store.get(paths.providerReconciliationPath);
    const auditBefore = mock.store.get(paths.providerReconciliationAuditPath);
    const storeSize = mock.store.size;

    nowMillis += 1;
    const exact = await recordInitialStripeReconciliationEvidence(input);
    const canonical = await recordInitialStripeReconciliationEvidence(
      providerReconciliationInput(mock.db, {
        providerParameters: validProviderParameters([
          ['synthetic_reference', HOSTILE_CANARY],
          ['currency', 'usd'],
          ['amount_total', 2500],
        ]),
      }),
    );
    expect(exact).toBe(canonical);
    expect(exact.outcome).toBe('reconciliation_candidate_persisted');
    for (const { transaction, writes } of mock.callbackRuns.slice(-2)) {
      expect(transaction.create).not.toHaveBeenCalled();
      expect(writes).toEqual([]);
    }

    await expectSafeError(
      () => recordInitialStripeReconciliationEvidence(providerReconciliationInput(mock.db, {
        reconciliationEvidence: candidateReconciliationEvidence({
          dispatchEvidence: 'timeout',
        }),
      })),
      'command_conflict',
    );
    await expectSafeError(
      () => recordInitialStripeReconciliationEvidence(providerReconciliationInput(mock.db, {
        providerParameters: validProviderParameters([
          ['amount_total', 2600],
          ['currency', 'usd'],
          ['synthetic_reference', HOSTILE_CANARY],
        ]),
      })),
      'command_conflict',
    );
    expect(mock.store.size).toBe(storeSize);
    expect(mock.store.get(paths.providerReconciliationPath)).toBe(recordBefore);
    expect(mock.store.get(paths.providerReconciliationAuditPath)).toBe(auditBefore);
  });

  test('rejects C2 and C3B orphans or malformed partners without repair', async () => {
    const foundation = createMockDb();
    await createSendFoundation(foundation);
    const baseInput = providerReconciliationInput(foundation.db);
    const paths = moveToSendCutoff(foundation, baseInput);
    const foundationSeed = [...foundation.store];

    const missingSendAudit = new Map(foundationSeed);
    missingSendAudit.delete(paths.providerSendAuditPath);
    const unreadableSendTime = new Map(foundationSeed);
    unreadableSendTime.set(paths.providerSendPath, {
      ...unreadableSendTime.get(paths.providerSendPath),
      automaticRetryDeadlineAt: null,
    });
    for (const seed of [missingSendAudit, unreadableSendTime]) {
      const mock = createMockDb([...seed]);
      await expectSafeError(
        () => recordInitialStripeReconciliationEvidence(providerReconciliationInput(mock.db)),
        'journal_record_invalid',
      );
      expect(mock.store.has(paths.providerReconciliationPath)).toBe(false);
      expect(mock.store.has(paths.providerReconciliationAuditPath)).toBe(false);
    }

    await recordInitialStripeReconciliationEvidence(baseInput);
    const complete = cloneStore(foundation.store);
    const record = complete.get(paths.providerReconciliationPath);
    const audit = complete.get(paths.providerReconciliationAuditPath);
    const variants = [];
    const missingAudit = cloneStore(complete);
    missingAudit.delete(paths.providerReconciliationAuditPath);
    variants.push(missingAudit);
    const missingRecord = cloneStore(complete);
    missingRecord.delete(paths.providerReconciliationPath);
    variants.push(missingRecord);
    const extraRecord = cloneStore(complete);
    extraRecord.set(paths.providerReconciliationPath, { ...record, extra: HOSTILE_CANARY });
    variants.push(extraRecord);
    const badAudit = cloneStore(complete);
    badAudit.set(paths.providerReconciliationAuditPath, {
      ...audit,
      reconciliationEvidenceCommitment: 'a'.repeat(64),
    });
    variants.push(badAudit);
    const futureRecord = cloneStore(complete);
    futureRecord.set(paths.providerReconciliationPath, {
      ...record,
      providerReconciliationEvidenceSchemaVersion: 2,
    });
    variants.push(futureRecord);
    const futureAudit = cloneStore(complete);
    futureAudit.set(paths.providerReconciliationAuditPath, {
      ...audit,
      providerReconciliationAuditSchemaVersion: 2,
    });
    variants.push(futureAudit);

    for (const seed of variants) {
      const mock = createMockDb([...seed]);
      const before = cloneStore(mock.store);
      await expectSafeError(
        () => recordInitialStripeReconciliationEvidence(providerReconciliationInput(mock.db)),
        'journal_record_invalid',
      );
      expect(mock.store).toEqual(before);
    }
  });

  test('rejects a recommitted C3B pair whose observed fence predates C2', async () => {
    const mock = createMockDb();
    await registerCommerceCommand(validInput(mock.db));
    nowMillis += 1000;
    await acquireCommerceCommandLease(leaseInput(mock.db));
    nowMillis = NOW_MILLIS + 61000;
    await acquireCommerceCommandLease(leaseInput(mock.db, { leaseId: OTHER_LEASE_ID }));
    nowMillis += 1000;
    const secondFencePlan = providerPlanInput(mock.db, {
      leaseId: OTHER_LEASE_ID,
      expectedFenceEpoch: 2,
    });
    await bindInitialStripeProviderPlan(secondFencePlan);
    nowMillis += 1000;
    await recordInitialStripeSendEvidence(secondFencePlan);
    const input = providerReconciliationInput(mock.db);
    const paths = moveToSendCutoff(mock, input);
    await recordInitialStripeReconciliationEvidence(input);

    const firstLeaseAudit = mock.store.get(lifecyclePaths(input, 2).lifecycleAuditPath);
    const originalRecord = mock.store.get(paths.providerReconciliationPath);
    const originalAudit = mock.store.get(paths.providerReconciliationAuditPath);
    expect(mock.store.get(paths.providerSendPath).prePostFenceEpoch).toBe(2);
    expect(originalRecord.observedFenceEpoch).toBe(2);
    const forgedRecord = {
      ...originalRecord,
      observedFenceEpoch: 1,
      observedLeaseExpiresAt: firstLeaseAudit.leaseExpiresAt,
    };
    const forgedAudit = {
      ...originalAudit,
      observedFenceEpoch: 1,
      observedLeaseExpiresAt: firstLeaseAudit.leaseExpiresAt,
      reconciliationEvidenceCommitment: reconciliationEvidenceCommitment(forgedRecord),
    };
    mock.store.set(paths.providerReconciliationPath, forgedRecord);
    mock.store.set(paths.providerReconciliationAuditPath, forgedAudit);
    nowMillis += 1;
    const before = cloneStore(mock.store);

    await expectSafeError(
      () => recordInitialStripeReconciliationEvidence(input),
      'journal_record_invalid',
    );
    expect(mock.store).toEqual(before);
  });

  test('rejects historical C2 lease evidence that overlaps a newer current fence', async () => {
    const mock = createMockDb();
    await registerCommerceCommand(validInput(mock.db));
    nowMillis += 1000;
    await acquireCommerceCommandLease(leaseInput(mock.db));
    nowMillis += 1000;
    await bindInitialStripeProviderPlan(providerPlanInput(mock.db));
    const input = providerReconciliationInput(mock.db);
    const paths = providerReconciliationPaths(input);

    nowMillis = mock.store.get(paths.lifecyclePath).leaseExpiresAt.toMillis();
    await acquireCommerceCommandLease(leaseInput(mock.db, { leaseId: OTHER_LEASE_ID }));
    nowMillis += 1000;
    await recordInitialStripeSendEvidence(providerPlanInput(mock.db, {
      leaseId: OTHER_LEASE_ID,
      expectedFenceEpoch: 2,
    }));
    nowMillis = mock.store.get(paths.lifecyclePath).leaseExpiresAt.toMillis();
    await acquireCommerceCommandLease(leaseInput(mock.db, { leaseId: THIRD_LEASE_ID }));
    nowMillis = mock.store.get(paths.lifecyclePath).leaseExpiresAt.toMillis();
    await acquireCommerceCommandLease(leaseInput(mock.db, { leaseId: FOURTH_LEASE_ID }));
    const currentLeaseAcquiredAt = mock.store.get(paths.lifecyclePath).leaseAcquiredAt;
    const impossibleFenceTwoAcquiredAt = Timestamp.fromMillis(
      currentLeaseAcquiredAt.toMillis() + 1000,
    );
    const impossibleFenceTwoExpiresAt = Timestamp.fromMillis(
      impossibleFenceTwoAcquiredAt.toMillis() + 60000,
    );
    const impossibleSendAt = Timestamp.fromMillis(
      impossibleFenceTwoAcquiredAt.toMillis() + 1,
    );
    const impossibleDeadline = Timestamp.fromMillis(
      impossibleSendAt.toMillis() + PROVIDER_SEND_RETRY_WINDOW_MILLIS,
    );
    const fenceTwoAuditPath = lifecyclePaths(input, 3).lifecycleAuditPath;
    mock.store.set(fenceTwoAuditPath, {
      ...mock.store.get(fenceTwoAuditPath),
      leaseExpiresAt: impossibleFenceTwoExpiresAt,
      occurredAt: impossibleFenceTwoAcquiredAt,
    });
    mock.store.set(paths.providerSendPath, {
      ...mock.store.get(paths.providerSendPath),
      prePostRecordedAt: impossibleSendAt,
      automaticRetryDeadlineAt: impossibleDeadline,
    });
    mock.store.set(paths.providerSendAuditPath, {
      ...mock.store.get(paths.providerSendAuditPath),
      automaticRetryDeadlineAt: impossibleDeadline,
      occurredAt: impossibleSendAt,
    });
    nowMillis = impossibleDeadline.toMillis();
    const before = cloneStore(mock.store);

    await expectSafeError(
      () => recordInitialStripeReconciliationEvidence(input),
      'journal_record_invalid',
    );
    expect(mock.store).toEqual(before);
    expect(mock.store.has(paths.providerReconciliationPath)).toBe(false);
  });

  test('rejects historical C3B lease evidence that overlaps a newer current fence', async () => {
    const mock = createMockDb();
    await createSendFoundation(mock);
    const input = providerReconciliationInput(mock.db);
    const paths = moveToSendCutoff(mock, input);
    await acquireCommerceCommandLease(leaseInput(mock.db, { leaseId: OTHER_LEASE_ID }));
    nowMillis = mock.store.get(paths.lifecyclePath).leaseExpiresAt.toMillis();
    await recordInitialStripeReconciliationEvidence(input);
    await acquireCommerceCommandLease(leaseInput(mock.db, { leaseId: THIRD_LEASE_ID }));
    nowMillis = mock.store.get(paths.lifecyclePath).leaseExpiresAt.toMillis();
    await acquireCommerceCommandLease(leaseInput(mock.db, { leaseId: FOURTH_LEASE_ID }));
    const currentLeaseAcquiredAt = mock.store.get(paths.lifecyclePath).leaseAcquiredAt;
    const impossibleFenceTwoAcquiredAt = Timestamp.fromMillis(
      currentLeaseAcquiredAt.toMillis() + 1000,
    );
    const impossibleFenceTwoExpiresAt = Timestamp.fromMillis(
      impossibleFenceTwoAcquiredAt.toMillis() + 60000,
    );
    const impossibleRecordedAt = Timestamp.fromMillis(
      impossibleFenceTwoExpiresAt.toMillis() + 1,
    );
    const fenceTwoAuditPath = lifecyclePaths(input, 3).lifecycleAuditPath;
    mock.store.set(fenceTwoAuditPath, {
      ...mock.store.get(fenceTwoAuditPath),
      leaseExpiresAt: impossibleFenceTwoExpiresAt,
      occurredAt: impossibleFenceTwoAcquiredAt,
    });
    const forgedRecord = {
      ...mock.store.get(paths.providerReconciliationPath),
      observedLeaseExpiresAt: impossibleFenceTwoExpiresAt,
      recordedAt: impossibleRecordedAt,
    };
    const forgedAudit = {
      ...mock.store.get(paths.providerReconciliationAuditPath),
      observedLeaseExpiresAt: impossibleFenceTwoExpiresAt,
      occurredAt: impossibleRecordedAt,
      reconciliationEvidenceCommitment: reconciliationEvidenceCommitment(forgedRecord),
    };
    mock.store.set(paths.providerReconciliationPath, forgedRecord);
    mock.store.set(paths.providerReconciliationAuditPath, forgedAudit);
    nowMillis = impossibleRecordedAt.toMillis();
    const before = cloneStore(mock.store);

    await expectSafeError(
      () => recordInitialStripeReconciliationEvidence(input),
      'journal_record_invalid',
    );
    expect(mock.store).toEqual(before);
  });

  test('rejects hostile roots and evidence descriptors before Firestore', async () => {
    const mock = createMockDb();
    const getter = jest.fn(() => HOSTILE_CANARY);
    const accessorEvidence = candidateReconciliationEvidence();
    Object.defineProperty(accessorEvidence, 'dispatchEvidence', {
      enumerable: true,
      get: getter,
    });
    const callsBefore = mock.db.runTransaction.mock.calls.length;
    const badInputs = [
      { ...providerReconciliationInput(mock.db), providerAttempt: 2 },
      { ...providerReconciliationInput(mock.db), shouldAdvance: true },
      providerReconciliationInput(mock.db, { reconciliationEvidence: accessorEvidence }),
      providerReconciliationInput(mock.db, {
        reconciliationEvidence: new Proxy(candidateReconciliationEvidence(), {}),
      }),
      providerReconciliationInput(mock.db, {
        reconciliationEvidence: candidateReconciliationEvidence({ providerAttempt: 2 }),
      }),
    ];
    for (const badInput of badInputs) {
      await expectSafeError(
        () => recordInitialStripeReconciliationEvidence(badInput),
        'invalid_command_input',
      );
    }
    expect(getter).not.toHaveBeenCalled();
    expect(mock.db.runTransaction).toHaveBeenCalledTimes(callsBefore);
    expect(mock.store.size).toBe(0);
  });

  test('pre-commit failure is atomic and lost acknowledgement recovers read-only', async () => {
    const foundation = createMockDb();
    await createSendFoundation(foundation);
    const paths = moveToSendCutoff(foundation);
    const commitFailure = createMockDb([...foundation.store], {
      rejectCommit: new Error(`${HOSTILE_CANARY}/${STRIPE_ACCOUNT_ID}`),
    });
    const before = cloneStore(commitFailure.store);
    await expectSafeError(
      () => recordInitialStripeReconciliationEvidence(
        providerReconciliationInput(commitFailure.db),
      ),
      'journal_unavailable',
      [STRIPE_ACCOUNT_ID],
    );
    expect(commitFailure.store).toEqual(before);

    const lostAcknowledgement = createMockDb([...foundation.store], {
      rejectAfterCommit: new Error(`${HOSTILE_CANARY}/${STRIPE_ACCOUNT_ID}`),
    });
    await expectSafeError(
      () => recordInitialStripeReconciliationEvidence(
        providerReconciliationInput(lostAcknowledgement.db),
      ),
      'journal_unavailable',
      [STRIPE_ACCOUNT_ID],
    );
    expect(lostAcknowledgement.store.has(paths.providerReconciliationPath)).toBe(true);
    expect(lostAcknowledgement.store.has(paths.providerReconciliationAuditPath)).toBe(true);
    nowMillis += 1;
    await expect(recordInitialStripeReconciliationEvidence(
      providerReconciliationInput(lostAcknowledgement.db),
    )).resolves.toMatchObject({ outcome: 'reconciliation_candidate_persisted' });
    expect(lostAcknowledgement.callbackRuns.at(-1).writes).toEqual([]);
  });

  test('future persisted evidence and forged transaction output fail closed', async () => {
    const mock = createMockDb();
    await createSendFoundation(mock);
    const input = providerReconciliationInput(mock.db);
    const paths = moveToSendCutoff(mock, input);
    await recordInitialStripeReconciliationEvidence(input);
    const recordedAt = mock.store.get(paths.providerReconciliationPath).recordedAt.toMillis();
    nowMillis = recordedAt - 1;
    await expectSafeError(
      () => recordInitialStripeReconciliationEvidence(input),
      'journal_record_invalid',
    );

    nowMillis = recordedAt + 1;
    const forged = createMockDb([...mock.store], {
      returnedValue: Object.freeze({ value: HOSTILE_CANARY }),
    });
    await expectSafeError(
      () => recordInitialStripeReconciliationEvidence(
        providerReconciliationInput(forged.db),
      ),
      'journal_unavailable',
    );
  });

  test('stores and returns no raw identifiers, parameters, keys, or attempt-2 control', async () => {
    const mock = createMockDb();
    await createSendFoundation(mock);
    const input = providerReconciliationInput(mock.db);
    const paths = moveToSendCutoff(mock, input);

    const result = await recordInitialStripeReconciliationEvidence(input);
    const rendered = JSON.stringify({
      result,
      record: mock.store.get(paths.providerReconciliationPath),
      audit: mock.store.get(paths.providerReconciliationAuditPath),
    });

    for (const forbidden of [
      HOSTILE_CANARY,
      RAW_CALLER,
      COMMAND_ID,
      STRIPE_ACCOUNT_ID,
      '0000000002',
      'shouldAdvance',
      'shouldExecute',
    ]) expect(rendered).not.toContain(forbidden);
  });
});

describe('fresh-lease authorization for one later Stripe provider attempt', () => {
  let nowMillis;

  beforeEach(() => {
    nowMillis = NOW_MILLIS;
    jest.spyOn(Timestamp, 'now')
      .mockImplementation(() => Timestamp.fromMillis(nowMillis));
  });

  afterEach(() => jest.restoreAllMocks());

  async function createAuthorizationFoundation(mock, options = {}) {
    const identityOverrides = options.identityOverrides || {};
    const reconciliationEvidence = options.reconciliationEvidence
      || candidateReconciliationEvidence();
    const transitionKind = options.transitionKind
      || (reconciliationEvidence.businessTransitionEvidence === 'new_generation_eligible'
        ? 'replace_expired_unpaid'
        : 'retry_same_operation');
    const freshLeaseId = options.freshLeaseId || OTHER_LEASE_ID;

    await registerCommerceCommand(validInput(mock.db, identityOverrides));
    nowMillis += 1000;
    await acquireCommerceCommandLease(leaseInput(mock.db, identityOverrides));
    nowMillis += 1000;
    await bindInitialStripeProviderPlan(providerPlanInput(mock.db, identityOverrides));
    nowMillis += 1000;
    await recordInitialStripeSendEvidence(providerPlanInput(mock.db, identityOverrides));

    const reconciliationInput = providerReconciliationInput(mock.db, {
      ...identityOverrides,
      reconciliationEvidence,
    });
    const paths = providerAuthorizationPaths(reconciliationInput);
    nowMillis = mock.store.get(paths.providerSendPath).automaticRetryDeadlineAt.toMillis();
    await recordInitialStripeReconciliationEvidence(reconciliationInput);

    if (options.acquireFreshLease !== false) {
      await acquireCommerceCommandLease(leaseInput(mock.db, {
        ...identityOverrides,
        leaseId: freshLeaseId,
      }));
    }

    const input = providerAuthorizationInput(mock.db, {
      ...identityOverrides,
      reconciliationEvidence,
      leaseId: freshLeaseId,
      expectedFenceEpoch: 2,
      transitionAuthorization: {
        kind: transitionKind,
        recordCommitment: options.recordCommitment || TRANSITION_RECORD_COMMITMENT,
      },
    });
    return Object.freeze({ input, paths: providerAuthorizationPaths(input) });
  }

  test.each([
    [
      'never-began retry',
      candidateReconciliationEvidence(),
      'retry_same_operation',
    ],
    [
      'verified expired/unpaid replacement',
      expiredReconciliationEvidence(),
      'replace_expired_unpaid',
    ],
  ])('creates the exact immutable pair for the closed %s mapping', async (
    _label,
    reconciliationEvidence,
    transitionKind,
  ) => {
    const mock = createMockDb();
    const { input, paths } = await createAuthorizationFoundation(mock, {
      reconciliationEvidence,
      transitionKind,
    });
    const preserved = cloneStore(mock.store);
    const c3b = preserved.get(paths.providerReconciliationPath);
    const c3bAudit = preserved.get(paths.providerReconciliationAuditPath);
    const lifecycle = preserved.get(paths.lifecyclePath);

    const result = await authorizeNextStripeProviderAttempt(input);

    expect(result).toEqual({
      journalSchemaVersion: 1,
      providerAttemptAuthorizationSchemaVersion: 1,
      outcome: 'provider_attempt_authorized',
      state: 'requires_plan_binding',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Reflect.ownKeys(result).sort()).toEqual([
      'journalSchemaVersion',
      'outcome',
      'providerAttemptAuthorizationSchemaVersion',
      'state',
    ]);

    const transactionRun = mock.callbackRuns.at(-1);
    expect(transactionRun.transaction.get).toHaveBeenCalledTimes(13);
    expect(transactionRun.transaction.create).toHaveBeenCalledTimes(2);
    expect(Math.max(...transactionRun.transaction.get.mock.invocationCallOrder))
      .toBeLessThan(Math.min(...transactionRun.transaction.create.mock.invocationCallOrder));
    expect(transactionRun.writes.map((write) => write.ref.path)).toEqual([
      paths.providerAuthorizationPath,
      paths.providerAuthorizationAuditPath,
    ]);

    const record = mock.store.get(paths.providerAuthorizationPath);
    const audit = mock.store.get(paths.providerAuthorizationAuditPath);
    expect(record).toEqual({
      providerAttemptAuthorizationSchemaVersion: 1,
      providerReconciliationEvidenceSchemaVersion: 1,
      reconciliationPolicySchemaVersion: 1,
      providerPlanSchemaVersion: 1,
      providerSendEvidenceSchemaVersion: 1,
      commandIdentityVersion: 1,
      commandKeyHash: paths.commandKeyHash,
      provider: 'stripe',
      previousProviderAttempt: 1,
      authorizedProviderAttempt: 2,
      authorizationRevision: 1,
      environment: 'test',
      stripeMode: 'test',
      providerOperation: PROVIDER_OPERATION,
      providerPlanCommitment: c3b.providerPlanCommitment,
      providerSendEvidenceCommitment: c3b.providerSendEvidenceCommitment,
      providerReconciliationEvidenceCommitment: c3bAudit.reconciliationEvidenceCommitment,
      transitionKind,
      transitionRecordCommitment: expect.stringMatching(/^[0-9a-f]{64}$/),
      idempotencyKeyFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      authorizedFenceEpoch: 2,
      authorizedAt: expect.any(Timestamp),
    });
    expect(audit).toEqual({
      providerAttemptAuthorizationAuditSchemaVersion: 1,
      providerAttemptAuthorizationSchemaVersion: 1,
      providerPlanSchemaVersion: 1,
      providerSendEvidenceSchemaVersion: 1,
      aggregateType: 'commerce_provider_authorization',
      commandKeyHash: paths.commandKeyHash,
      previousProviderAttempt: 1,
      authorizedProviderAttempt: 2,
      authorizationRevision: 1,
      eventType: 'provider_attempt_authorized',
      provider: 'stripe',
      environment: 'test',
      stripeMode: 'test',
      providerOperation: PROVIDER_OPERATION,
      providerPlanCommitment: record.providerPlanCommitment,
      providerSendEvidenceCommitment: record.providerSendEvidenceCommitment,
      providerReconciliationEvidenceCommitment: (
        record.providerReconciliationEvidenceCommitment
      ),
      transitionKind,
      transitionRecordCommitment: record.transitionRecordCommitment,
      idempotencyKeyFingerprint: record.idempotencyKeyFingerprint,
      authorizedFenceEpoch: 2,
      providerAttemptAuthorizationCommitment: expect.stringMatching(/^[0-9a-f]{64}$/),
      occurredAt: expect.any(Timestamp),
    });
    expect(record.authorizedAt).toBe(audit.occurredAt);
    expect(record.authorizedAt.toMillis()).toBe(nowMillis);
    expect(record.authorizedAt.toMillis()).toBeGreaterThanOrEqual(c3b.recordedAt.toMillis());
    expect(record.authorizedAt.toMillis()).toBeGreaterThanOrEqual(
      lifecycle.leaseAcquiredAt.toMillis(),
    );
    expect(record.authorizedAt.toMillis()).toBeLessThan(lifecycle.leaseExpiresAt.toMillis());
    expect(record.transitionRecordCommitment).not.toBe(TRANSITION_RECORD_COMMITMENT);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(audit)).toBe(true);
    for (const [path_, value] of preserved) expect(mock.store.get(path_)).toBe(value);

    const rawAttemptTwoKey = createStripeIdempotencyKey({
      stripeMode: 'test',
      environment: 'test',
      providerOperation: PROVIDER_OPERATION,
      commandKeyHash: paths.commandKeyHash,
      providerAttempt: 2,
    }).stripeIdempotencyKey;
    const rendered = JSON.stringify({ result, record, audit });
    for (const forbidden of [
      TRANSITION_RECORD_COMMITMENT,
      rawAttemptTwoKey,
      STRIPE_ACCOUNT_ID,
      HOSTILE_CANARY,
      RAW_CALLER,
      COMMAND_ID,
      OTHER_LEASE_ID,
    ]) expect(rendered).not.toContain(forbidden);
    for (const value of [result, record, audit]) {
      expect(value).not.toHaveProperty('shouldSend');
      expect(value).not.toHaveProperty('shouldExecute');
      expect(value).not.toHaveProperty('sendAuthorized');
      expect(value).not.toHaveProperty('executeProvider');
      expect(value).not.toHaveProperty('response');
    }
  });

  test('binds the opaque transition commitment to the command identity', async () => {
    const first = createMockDb();
    const firstFoundation = await createAuthorizationFoundation(first);
    await authorizeNextStripeProviderAttempt(firstFoundation.input);
    const firstCommitment = first.store.get(
      firstFoundation.paths.providerAuthorizationPath,
    ).transitionRecordCommitment;

    nowMillis += 1000;
    const second = createMockDb();
    const secondFoundation = await createAuthorizationFoundation(second, {
      identityOverrides: { commandId: OTHER_COMMAND_ID },
    });
    await authorizeNextStripeProviderAttempt(secondFoundation.input);
    const secondCommitment = second.store.get(
      secondFoundation.paths.providerAuthorizationPath,
    ).transitionRecordCommitment;

    expect(firstCommitment).toMatch(/^[0-9a-f]{64}$/);
    expect(secondCommitment).toMatch(/^[0-9a-f]{64}$/);
    expect(firstCommitment).not.toBe(TRANSITION_RECORD_COMMITMENT);
    expect(secondCommitment).not.toBe(TRANSITION_RECORD_COMMITMENT);
    expect(secondCommitment).not.toBe(firstCommitment);
  });

  test('transaction retries reuse one prepared time and deterministic pair', async () => {
    const foundation = createMockDb();
    const ready = await createAuthorizationFoundation(foundation);
    const mock = createMockDb([...foundation.store], { callbackRuns: 4 });
    const input = { ...ready.input, db: mock.db };
    Timestamp.now.mockClear();

    const result = await authorizeNextStripeProviderAttempt(input);

    expect(result).toMatchObject({ outcome: 'provider_attempt_authorized' });
    expect(mock.callbackRuns).toHaveLength(4);
    for (const { transaction, writes } of mock.callbackRuns) {
      expect(transaction.get).toHaveBeenCalledTimes(13);
      expect(transaction.create).toHaveBeenCalledTimes(2);
      expect(writes).toHaveLength(2);
      expect(writes[0].value.authorizedAt).toEqual(Timestamp.fromMillis(nowMillis));
      expect(writes[1].value.occurredAt).toBe(writes[0].value.authorizedAt);
    }
    const records = mock.callbackRuns.map(({ writes }) => writes[0].value);
    const audits = mock.callbackRuns.map(({ writes }) => writes[1].value);
    expect(records.every((value) => JSON.stringify(value) === JSON.stringify(records[0])))
      .toBe(true);
    expect(audits.every((value) => JSON.stringify(value) === JSON.stringify(audits[0])))
      .toBe(true);
    expect(Timestamp.now).toHaveBeenCalled();
  });

  test('exact retry and a later valid lease observation are read-only; a changed commitment conflicts', async () => {
    const mock = createMockDb();
    const { input, paths } = await createAuthorizationFoundation(mock);
    const first = await authorizeNextStripeProviderAttempt(input);
    const recordBefore = mock.store.get(paths.providerAuthorizationPath);
    const auditBefore = mock.store.get(paths.providerAuthorizationAuditPath);
    const sizeBefore = mock.store.size;

    nowMillis += 1;
    const exact = await authorizeNextStripeProviderAttempt(input);
    expect(exact).toBe(first);
    expect(mock.callbackRuns.at(-1).writes).toEqual([]);

    nowMillis = mock.store.get(paths.lifecyclePath).leaseExpiresAt.toMillis();
    await acquireCommerceCommandLease(leaseInput(mock.db, { leaseId: THIRD_LEASE_ID }));
    nowMillis += 1;
    const laterLeaseInput = {
      ...input,
      leaseId: THIRD_LEASE_ID,
      expectedFenceEpoch: 3,
    };
    const observed = await authorizeNextStripeProviderAttempt(laterLeaseInput);
    expect(observed).toBe(first);
    expect(mock.callbackRuns.at(-1).writes).toEqual([]);
    const sizeAfterLaterLease = mock.store.size;

    await expectSafeError(
      () => authorizeNextStripeProviderAttempt({
        ...laterLeaseInput,
        transitionAuthorization: {
          ...laterLeaseInput.transitionAuthorization,
          recordCommitment: OTHER_TRANSITION_RECORD_COMMITMENT,
        },
      }),
      'command_conflict',
    );
    expect(sizeAfterLaterLease).toBe(sizeBefore + 1);
    expect(mock.store.size).toBe(sizeAfterLaterLease);
    expect(mock.store.get(paths.providerAuthorizationPath)).toBe(recordBefore);
    expect(mock.store.get(paths.providerAuthorizationAuditPath)).toBe(auditBefore);
  });

  test.each([
    [candidateReconciliationEvidence(), 'replace_expired_unpaid'],
    [expiredReconciliationEvidence(), 'retry_same_operation'],
  ])('rejects a closed transition kind that does not match the persisted candidate', async (
    reconciliationEvidence,
    transitionKind,
  ) => {
    const mock = createMockDb();
    const { input, paths } = await createAuthorizationFoundation(mock, {
      reconciliationEvidence,
      transitionKind,
    });
    const before = cloneStore(mock.store);

    await expectSafeError(
      () => authorizeNextStripeProviderAttempt(input),
      'invalid_command_input',
    );
    expect(mock.store).toEqual(before);
    expect(mock.store.has(paths.providerAuthorizationPath)).toBe(false);
    expect(mock.store.has(paths.providerAuthorizationAuditPath)).toBe(false);
  });

  test('self-consistent unsafe C3B evidence cannot authorize', async () => {
    const foundation = createMockDb();
    const { input, paths } = await createAuthorizationFoundation(foundation);
    const safeRecord = foundation.store.get(paths.providerReconciliationPath);
    const safeAudit = foundation.store.get(paths.providerReconciliationAuditPath);
    const unsafeChanges = [
      { dispatchEvidence: 'timeout' },
      { dispatchEvidence: 'connection_lost' },
      { responseEvidence: 'server_failure' },
      { idempotencyEvidence: 'old_or_pruned' },
      { providerObjectEvidence: 'missing_reference' },
      { providerObjectEvidence: 'not_found' },
      { searchEvidence: 'partial' },
      { paymentEvidence: 'processing' },
      { paymentEvidence: 'unknown' },
    ];

    for (const change of unsafeChanges) {
      const mock = createMockDb([...foundation.store]);
      const record = Object.freeze({ ...safeRecord, ...change });
      const audit = Object.freeze({
        ...safeAudit,
        reconciliationEvidenceCommitment: reconciliationEvidenceCommitment(record),
      });
      mock.store.set(paths.providerReconciliationPath, record);
      mock.store.set(paths.providerReconciliationAuditPath, audit);
      const before = cloneStore(mock.store);
      await expectSafeError(
        () => authorizeNextStripeProviderAttempt({ ...input, db: mock.db }),
        'journal_record_invalid',
      );
      expect(mock.store).toEqual(before);
      expect(mock.store.has(paths.providerAuthorizationPath)).toBe(false);
    }
  });

  test('no fresh, wrong, rolled-back, expired, or terminal lease can authorize', async () => {
    const noFresh = createMockDb();
    const noFreshFoundation = await createAuthorizationFoundation(noFresh, {
      acquireFreshLease: false,
    });
    const noFreshBefore = cloneStore(noFresh.store);
    await expectSafeError(
      () => authorizeNextStripeProviderAttempt(noFreshFoundation.input),
      'lease_stale',
    );
    expect(noFresh.store).toEqual(noFreshBefore);

    nowMillis = NOW_MILLIS;
    const mock = createMockDb();
    const { input, paths } = await createAuthorizationFoundation(mock);
    const readyBefore = cloneStore(mock.store);
    for (const change of [
      { leaseId: THIRD_LEASE_ID },
      { expectedFenceEpoch: 1 },
      { expectedFenceEpoch: 3 },
      { leaseId: THIRD_LEASE_ID, expectedFenceEpoch: 3 },
    ]) {
      await expectSafeError(
        () => authorizeNextStripeProviderAttempt({ ...input, ...change }),
        'lease_stale',
      );
      expect(mock.store).toEqual(readyBefore);
    }

    const lease = mock.store.get(paths.lifecyclePath);
    nowMillis = lease.leaseAcquiredAt.toMillis() - 1;
    await expectSafeError(
      () => authorizeNextStripeProviderAttempt(input),
      'lease_stale',
    );
    nowMillis = lease.leaseExpiresAt.toMillis();
    await expectSafeError(
      () => authorizeNextStripeProviderAttempt(input),
      'lease_stale',
    );
    expect(mock.store).toEqual(readyBefore);

    nowMillis = NOW_MILLIS;
    const terminal = createMockDb();
    const terminalFoundation = await createAuthorizationFoundation(terminal);
    nowMillis += 1;
    await completeCommerceCommand(completionInput(terminal.db, {
      leaseId: OTHER_LEASE_ID,
      expectedFenceEpoch: 2,
    }));
    const terminalBefore = cloneStore(terminal.store);
    await expectSafeError(
      () => authorizeNextStripeProviderAttempt(terminalFoundation.input),
      'lease_stale',
    );
    expect(terminal.store).toEqual(terminalBefore);
  });

  test('fresh lease acquisition must be at or after C3B persistence with a later fence', async () => {
    const mock = createMockDb();
    const { input, paths } = await createAuthorizationFoundation(mock);
    const c3b = mock.store.get(paths.providerReconciliationPath);
    const lifecycle = mock.store.get(paths.lifecyclePath);
    const freshAuditPath = lifecyclePaths(input, 3).lifecycleAuditPath;
    const freshAudit = mock.store.get(freshAuditPath);
    const impossibleAcquiredAt = new Timestamp(
      c3b.recordedAt.nanoseconds === 0 ? c3b.recordedAt.seconds - 1 : c3b.recordedAt.seconds,
      c3b.recordedAt.nanoseconds === 0 ? 999999999 : c3b.recordedAt.nanoseconds - 1,
    );
    const impossibleExpiresAt = Timestamp.fromMillis(c3b.recordedAt.toMillis() + 60000);
    mock.store.set(paths.lifecyclePath, Object.freeze({
      ...lifecycle,
      leaseAcquiredAt: impossibleAcquiredAt,
      leaseExpiresAt: impossibleExpiresAt,
      updatedAt: impossibleAcquiredAt,
    }));
    mock.store.set(freshAuditPath, Object.freeze({
      ...freshAudit,
      leaseExpiresAt: impossibleExpiresAt,
      occurredAt: impossibleAcquiredAt,
    }));
    const before = cloneStore(mock.store);
    nowMillis = c3b.recordedAt.toMillis();

    await expectSafeError(
      () => authorizeNextStripeProviderAttempt(input),
      'journal_record_invalid',
    );
    expect(mock.store).toEqual(before);
    expect(mock.store.has(paths.providerAuthorizationPath)).toBe(false);
  });

  test('missing or malformed C3B/foundation partners fail closed even when authorization exists', async () => {
    const foundation = createMockDb();
    const { input, paths } = await createAuthorizationFoundation(foundation);
    await authorizeNextStripeProviderAttempt(input);
    const complete = cloneStore(foundation.store);
    const variants = [];
    for (const path_ of [
      paths.commandPath,
      paths.auditPath,
      paths.providerPlanPath,
      paths.providerPlanAuditPath,
      paths.providerSendPath,
      paths.providerSendAuditPath,
      paths.providerReconciliationPath,
      paths.providerReconciliationAuditPath,
      lifecyclePaths(input, 3).lifecycleAuditPath,
    ]) {
      const missing = cloneStore(complete);
      missing.delete(path_);
      variants.push(missing);
    }
    const futureC3b = cloneStore(complete);
    futureC3b.set(paths.providerReconciliationPath, Object.freeze({
      ...futureC3b.get(paths.providerReconciliationPath),
      providerReconciliationEvidenceSchemaVersion: 2,
    }));
    variants.push(futureC3b);

    for (const seed of variants) {
      const mock = createMockDb([...seed]);
      const before = cloneStore(mock.store);
      await expectSafeError(
        () => authorizeNextStripeProviderAttempt({ ...input, db: mock.db }),
        'journal_record_invalid',
      );
      expect(mock.store).toEqual(before);
    }
  });

  test('authorization orphans, future versions, extras, and bad commitments are never repaired', async () => {
    const foundation = createMockDb();
    const { input, paths } = await createAuthorizationFoundation(foundation);
    await authorizeNextStripeProviderAttempt(input);
    const complete = cloneStore(foundation.store);
    const record = complete.get(paths.providerAuthorizationPath);
    const audit = complete.get(paths.providerAuthorizationAuditPath);
    const variants = [];

    const missingRecord = cloneStore(complete);
    missingRecord.delete(paths.providerAuthorizationPath);
    variants.push(missingRecord);
    const missingAudit = cloneStore(complete);
    missingAudit.delete(paths.providerAuthorizationAuditPath);
    variants.push(missingAudit);
    const extraRecord = cloneStore(complete);
    extraRecord.set(paths.providerAuthorizationPath, Object.freeze({
      ...record,
      extra: HOSTILE_CANARY,
    }));
    variants.push(extraRecord);
    const futureRecord = cloneStore(complete);
    futureRecord.set(paths.providerAuthorizationPath, Object.freeze({
      ...record,
      providerAttemptAuthorizationSchemaVersion: 2,
    }));
    variants.push(futureRecord);
    const futureAudit = cloneStore(complete);
    futureAudit.set(paths.providerAuthorizationAuditPath, Object.freeze({
      ...audit,
      providerAttemptAuthorizationAuditSchemaVersion: 2,
    }));
    variants.push(futureAudit);
    const badCommitment = cloneStore(complete);
    badCommitment.set(paths.providerAuthorizationAuditPath, Object.freeze({
      ...audit,
      providerAttemptAuthorizationCommitment: 'a'.repeat(64),
    }));
    variants.push(badCommitment);

    for (const seed of variants) {
      const mock = createMockDb([...seed]);
      const before = cloneStore(mock.store);
      nowMillis += 1;
      await expectSafeError(
        () => authorizeNextStripeProviderAttempt({ ...input, db: mock.db }),
        'journal_record_invalid',
      );
      expect(mock.store).toEqual(before);
    }
  });

  test('pre-commit failure is atomic, lost acknowledgement recovers, and forged output fails', async () => {
    const foundation = createMockDb();
    const { input, paths } = await createAuthorizationFoundation(foundation);

    const commitFailure = createMockDb([...foundation.store], {
      rejectCommit: new Error(`${HOSTILE_CANARY}/${STRIPE_ACCOUNT_ID}`),
    });
    const commitBefore = cloneStore(commitFailure.store);
    await expectSafeError(
      () => authorizeNextStripeProviderAttempt({ ...input, db: commitFailure.db }),
      'journal_unavailable',
      [STRIPE_ACCOUNT_ID],
    );
    expect(commitFailure.store).toEqual(commitBefore);
    expect(commitFailure.store.has(paths.providerAuthorizationPath)).toBe(false);
    expect(commitFailure.store.has(paths.providerAuthorizationAuditPath)).toBe(false);

    const lostAcknowledgement = createMockDb([...foundation.store], {
      rejectAfterCommit: new Error(`${HOSTILE_CANARY}/${STRIPE_ACCOUNT_ID}`),
    });
    await expectSafeError(
      () => authorizeNextStripeProviderAttempt({ ...input, db: lostAcknowledgement.db }),
      'journal_unavailable',
      [STRIPE_ACCOUNT_ID],
    );
    expect(lostAcknowledgement.store.has(paths.providerAuthorizationPath)).toBe(true);
    expect(lostAcknowledgement.store.has(paths.providerAuthorizationAuditPath)).toBe(true);
    nowMillis += 1;
    await expect(authorizeNextStripeProviderAttempt({
      ...input,
      db: lostAcknowledgement.db,
    })).resolves.toMatchObject({ outcome: 'provider_attempt_authorized' });
    expect(lostAcknowledgement.callbackRuns.at(-1).writes).toEqual([]);

    const forged = createMockDb([...foundation.store], {
      returnedValue: Object.freeze({
        outcome: HOSTILE_CANARY,
        shouldSend: true,
      }),
    });
    await expectSafeError(
      () => authorizeNextStripeProviderAttempt({ ...input, db: forged.db }),
      'journal_unavailable',
    );
  });

  test('rejects extra, missing, accessor, custom-prototype, and proxied input before Firestore', async () => {
    const mock = createMockDb();
    const base = providerAuthorizationInput(mock.db);
    const accessorAuthorization = {
      kind: 'retry_same_operation',
      recordCommitment: TRANSITION_RECORD_COMMITMENT,
    };
    const getter = jest.fn(() => HOSTILE_CANARY);
    Object.defineProperty(accessorAuthorization, 'recordCommitment', {
      enumerable: true,
      get: getter,
    });
    const customAuthorization = Object.create({ inherited: true });
    customAuthorization.kind = 'retry_same_operation';
    customAuthorization.recordCommitment = TRANSITION_RECORD_COMMITMENT;
    const missingTransition = { ...base };
    delete missingTransition.transitionAuthorization;
    const badInputs = [
      { ...base, shouldSend: true },
      { ...base, providerAttempt: 2 },
      missingTransition,
      { ...base, transitionAuthorization: { ...base.transitionAuthorization, extra: true } },
      { ...base, transitionAuthorization: { kind: 'retry_same_operation' } },
      { ...base, transitionAuthorization: accessorAuthorization },
      { ...base, transitionAuthorization: customAuthorization },
      { ...base, transitionAuthorization: new Proxy(base.transitionAuthorization, {}) },
      { ...base, transitionAuthorization: {
        kind: 'retry_same_operation',
        recordCommitment: TRANSITION_RECORD_COMMITMENT.toUpperCase(),
      } },
      { ...base, transitionAuthorization: {
        kind: 'retry_same_operation',
        recordCommitment: 'f'.repeat(63),
      } },
      new Proxy(base, {}),
    ];

    for (const badInput of badInputs) {
      await expectSafeError(
        () => authorizeNextStripeProviderAttempt(badInput),
        'invalid_command_input',
      );
    }
    expect(getter).not.toHaveBeenCalled();
    expect(mock.db.runTransaction).not.toHaveBeenCalled();
    expect(mock.store.size).toBe(0);
  });
});

describe('exact existing identity and partner validation', () => {
  beforeEach(() => {
    jest.spyOn(Timestamp, 'now').mockImplementation(() => Timestamp.fromMillis(NOW_MILLIS + 5000));
  });

  afterEach(() => jest.restoreAllMocks());

  async function expectPairFailure(mutatePair, reason) {
    const base = validInput(createMockDb().db);
    const pair = exactPair(base);
    mutatePair(pair.command, pair.audit, pair.identity);
    const mock = createMockDb(pair.seed);
    await expectSafeError(
      () => registerCommerceCommand(validInput(mock.db)),
      reason,
      [pair.identity.commandKeyHash, pair.identity.payloadFingerprint],
    );
    expect(mock.store.get(pair.identity.commandPath)).toBe(pair.command);
    expect(mock.store.get(pair.identity.auditPath)).toBe(pair.audit);
    expect(mock.callbackRuns[0].transaction.create).not.toHaveBeenCalled();
  }

  test.each([
    ['command type', (command, audit) => {
      command.commandType = 'race.checkout.create';
      audit.commandType = 'race.checkout.create';
    }],
    ['endpoint schema version', (command) => { command.endpointSchemaVersion = 2; }],
    ['payload fingerprint', (command) => { command.payloadFingerprint = 'a'.repeat(64); }],
  ])('rejects immutable %s reuse as a fixed conflict', async (_label, mutate) => {
    await expectPairFailure(mutate, 'command_conflict');
  });

  test.each([
    ['environment', (command, audit) => {
      command.environment = 'staging';
      audit.environment = 'staging';
    }],
    ['caller scope kind', (command, audit) => {
      command.callerScopeKind = 'anonymous_principal';
      audit.callerScopeKind = 'anonymous_principal';
    }],
  ])('treats a stored %s mismatch at a B1-derived path as corruption', async (_label, mutate) => {
    await expectPairFailure(mutate, 'journal_record_invalid');
  });

  test.each([
    ['journal schema version', (command) => { command.journalSchemaVersion = 2; }],
    ['command identity version', (command) => { command.commandIdentityVersion = 2; }],
    ['audit schema version', (_command, audit) => { audit.auditSchemaVersion = 2; }],
    ['unexpected state', (command) => { command.state = 'executing'; }],
    ['unexpected revision', (command) => { command.revision = 2; }],
    ['unexpected event', (_command, audit) => { audit.eventType = 'provider_sent'; }],
    ['uppercase hash', (_command, audit) => {
      audit.commandKeyHash = audit.commandKeyHash.toUpperCase();
    }],
    ['command/audit environment mismatch', (_command, audit) => { audit.environment = 'local'; }],
    ['command/audit type mismatch', (_command, audit) => {
      audit.commandType = 'race.checkout.create';
    }],
    ['command/audit timestamp mismatch', (_command, audit) => {
      audit.occurredAt = Timestamp.fromMillis(NOW_MILLIS + 1);
    }],
    ['created/updated timestamp mismatch', (command) => {
      command.updatedAt = Timestamp.fromMillis(NOW_MILLIS + 1);
    }],
    ['non-Timestamp time', (command) => { command.createdAt = { _seconds: 1, _nanoseconds: 0 }; }],
  ])('rejects malformed pair: %s', async (_label, mutate) => {
    await expectPairFailure(mutate, 'journal_record_invalid');
  });

  test('rejects either orphan direction and writes no automatic repair', async () => {
    const base = validInput(createMockDb().db);
    const pair = exactPair(base);
    for (const seed of [
      [[pair.identity.commandPath, pair.command]],
      [[pair.identity.auditPath, pair.audit]],
    ]) {
      const mock = createMockDb(seed);
      await expectSafeError(
        () => registerCommerceCommand(validInput(mock.db)),
        'journal_record_invalid',
        [pair.identity.commandKeyHash],
      );
      expect(mock.store.size).toBe(1);
      expect(mock.callbackRuns[0].transaction.create).not.toHaveBeenCalled();
    }
  });

  test.each([
    ['extra field', (value) => { value.unexpected = true; }],
    ['symbol field', (value) => { value[Symbol('hidden')] = true; }],
    ['custom prototype', (value) => Object.setPrototypeOf(value, { inherited: true })],
  ])('rejects hostile command root shape: %s', async (_label, mutate) => {
    await expectPairFailure((command) => mutate(command), 'journal_record_invalid');
  });

  test('rejects accessors and proxies without invoking their traps', async () => {
    const base = validInput(createMockDb().db);
    const pair = exactPair(base);
    let getterCalls = 0;
    Object.defineProperty(pair.command, 'state', {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error(HOSTILE_CANARY);
      },
    });
    let mock = createMockDb(pair.seed);
    await expectSafeError(
      () => registerCommerceCommand(validInput(mock.db)),
      'journal_record_invalid',
      [pair.identity.commandKeyHash],
    );
    expect(getterCalls).toBe(0);

    const proxyPair = exactPair(base);
    let trapCalls = 0;
    const proxy = new Proxy(proxyPair.command, {
      ownKeys() {
        trapCalls += 1;
        throw new Error(HOSTILE_CANARY);
      },
    });
    mock = createMockDb([
      [proxyPair.identity.commandPath, proxy],
      [proxyPair.identity.auditPath, proxyPair.audit],
    ]);
    await expectSafeError(
      () => registerCommerceCommand(validInput(mock.db)),
      'journal_record_invalid',
      [proxyPair.identity.commandKeyHash],
    );
    expect(trapCalls).toBe(0);
  });

  test('rejects a revoked stored proxy with the same fixed record error', async () => {
    const base = validInput(createMockDb().db);
    const pair = exactPair(base);
    const { proxy, revoke } = Proxy.revocable(pair.audit, {});
    revoke();
    const mock = createMockDb([
      [pair.identity.commandPath, pair.command],
      [pair.identity.auditPath, proxy],
    ]);
    await expectSafeError(
      () => registerCommerceCommand(validInput(mock.db)),
      'journal_record_invalid',
      [pair.identity.commandKeyHash],
    );
  });
});

describe('fixed input and infrastructure failure boundary', () => {
  beforeEach(() => {
    jest.spyOn(Timestamp, 'now').mockImplementation(() => Timestamp.fromMillis(NOW_MILLIS));
  });

  afterEach(() => jest.restoreAllMocks());

  test.each([
    ['bad UUID', { commandId: HOSTILE_CANARY }],
    ['bad environment', { environment: HOSTILE_CANARY }],
    ['bad command type', { commandType: HOSTILE_CANARY }],
    ['zero endpoint schema', { endpointSchemaVersion: 0 }],
    ['huge endpoint schema', { endpointSchemaVersion: 1000001 }],
    ['mutable payload', { payload: { canary: HOSTILE_CANARY } }],
    ['bad caller', { callerScope: { kind: 'firebase_uid', value: `uid\u0000${HOSTILE_CANARY}` } }],
  ])('maps B1/input failure to one safe error: %s', async (_label, overrides) => {
    const mock = createMockDb();
    await expectSafeError(
      () => registerCommerceCommand(validInput(mock.db, overrides)),
      'invalid_command_input',
    );
    expect(mock.db.runTransaction).not.toHaveBeenCalled();
  });

  test('rejects extra, missing, accessor, custom-prototype, and proxied input roots', async () => {
    const mock = createMockDb();
    const extra = { ...validInput(mock.db), unexpected: HOSTILE_CANARY };
    const missing = validInput(mock.db);
    delete missing.payload;
    const inherited = Object.assign(Object.create({ inherited: HOSTILE_CANARY }), validInput(mock.db));
    let getterCalls = 0;
    const accessor = validInput(mock.db);
    Object.defineProperty(accessor, 'commandId', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return HOSTILE_CANARY;
      },
    });
    let trapCalls = 0;
    const proxy = new Proxy(validInput(mock.db), {
      ownKeys() {
        trapCalls += 1;
        return [];
      },
    });
    for (const value of [extra, missing, inherited, accessor, proxy]) {
      await expectSafeError(() => registerCommerceCommand(value), 'invalid_command_input');
    }
    expect(getterCalls).toBe(0);
    expect(trapCalls).toBe(0);
  });

  test.each(['before callback', 'at commit'])('redacts unknown Firestore failure %s', async (phase) => {
    const providerFailure = new Error(`${HOSTILE_CANARY}/checkoutRequests/private-hash`);
    const options = phase === 'before callback'
      ? { rejectBeforeCallback: providerFailure }
      : { rejectCommit: providerFailure };
    const mock = createMockDb([], options);
    await expectSafeError(
      () => registerCommerceCommand(validInput(mock.db)),
      'journal_unavailable',
      ['checkoutRequests/private-hash'],
    );
    expect(mock.store.size).toBe(0);
  });

  test('rejects an unexpected transaction return instead of reflecting it', async () => {
    const mock = createMockDb([], { returnedValue: HOSTILE_CANARY });
    await expectSafeError(
      () => registerCommerceCommand(validInput(mock.db)),
      'journal_unavailable',
    );
  });

  test('maps malformed db and timestamp provider behavior to unavailable', async () => {
    const malformedDb = { runTransaction: jest.fn() };
    await expectSafeError(
      () => registerCommerceCommand(validInput(malformedDb)),
      'journal_unavailable',
    );

    Timestamp.now.mockImplementationOnce(() => ({
      _seconds: 1,
      _nanoseconds: 0,
      canary: HOSTILE_CANARY,
    }));
    const mock = createMockDb();
    await expectSafeError(
      () => registerCommerceCommand(validInput(mock.db)),
      'journal_unavailable',
    );
    expect(mock.db.runTransaction).not.toHaveBeenCalled();
  });
});

describe('closed source and export boundary', () => {
  test('exports only the unused journal APIs and narrow evidence gates', () => {
    const api = require('./commerceCommandJournal');
    expect(journalSchemaVersion).toBe(1);
    expect(lifecycleSchemaVersion).toBe(1);
    expect(providerAttemptAuthorizationSchemaVersion).toBe(1);
    expect(providerSendEvidenceSchemaVersion).toBe(1);
    expect(Object.keys(api).sort()).toEqual([
      'CommerceCommandJournalError',
      'acquireCommerceCommandLease',
      'authorizeNextStripeProviderAttempt',
      'bindInitialStripeProviderPlan',
      'completeCommerceCommand',
      'failCommerceCommand',
      'journalSchemaVersion',
      'lifecycleSchemaVersion',
      'providerAttemptAuthorizationSchemaVersion',
      'providerReconciliationEvidenceSchemaVersion',
      'providerSendEvidenceSchemaVersion',
      'recordInitialStripeReconciliationEvidence',
      'recordInitialStripeSendEvidence',
      'registerCommerceCommand',
    ]);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(CommerceCommandJournalError)).toBe(true);
    expect(Object.isFrozen(CommerceCommandJournalError.prototype)).toBe(true);
    expect(Object.keys(api).join(' ')).not.toMatch(
      /execute|renew|release|replay|advance|result|outcome/i,
    );
  });

  test('has only the approved local, Firestore, and Node utility dependencies', () => {
    const source = fs.readFileSync(path.join(__dirname, 'commerceCommandJournal.js'), 'utf8');
    const dynamicImportPattern = /\bimport\b/;
    const ambientSideEffectPattern = /\b(?:fetch|XMLHttpRequest|console|logger|process)\b/;
    const importMatches = [...source.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g)];
    const imports = importMatches.map((match) => match[2]);
    expect(imports.sort()).toEqual([
      './commerceCommandIdentity',
      './commerceProviderReconciliation',
      'firebase-admin/firestore',
      'node:crypto',
      'node:util',
    ]);
    expect((source.match(/\brequire\b/g) || [])).toHaveLength(importMatches.length);
    expect(source).not.toMatch(dynamicImportPattern);
    for (const probe of ['import("stripe")', "import ('axios')"]) {
      expect(probe).toMatch(dynamicImportPattern);
    }
    expect(source).toMatch(
      /^const \{ createHash \} = require\((?:'|")node:crypto(?:'|")\);$/m,
    );
    expect(source).not.toMatch(/require\(['"]\.\/index|createCheckout|stripeWebhook/);
    expect(source).not.toMatch(ambientSideEffectPattern);
    for (const probe of [
      'console?.log("unsafe")',
      'console["log"]("unsafe")',
      'process["env"]',
      'globalThis["fetch"]("unsafe")',
    ]) expect(probe).toMatch(ambientSideEffectPattern);
    expect(source).not.toMatch(
      /Math\.random|randomBytes|randomFill|randomInt|randomUUID|getRandomValues|process\.env|node:fs|node:http|node:https|child_process/,
    );
    for (const forbidden of [
      'providerAttempts/0000000002',
      'providerAttempt: 2',
      'providerAttempt = 2',
      'shouldAdvance',
      'shouldExecute',
    ]) expect(source).not.toContain(forbidden);
    expect(source).toContain('maxAttempts: 10');
    expect((source.match(/Timestamp\.now\(\)/g) || [])).toHaveLength(1);
    expect(source.indexOf('Timestamp.now()')).toBeLessThan(source.indexOf('.runTransaction('));
  });

  test('is not imported by the Functions index or any runtime module', () => {
    const runtimeFiles = fs.readdirSync(__dirname)
      .filter((fileName) => fileName.endsWith('.js'))
      .filter((fileName) => !fileName.endsWith('.test.js'))
      .filter((fileName) => fileName !== 'commerceCommandJournal.js');

    expect(runtimeFiles).toContain('index.js');
    for (const fileName of runtimeFiles) {
      const source = fs.readFileSync(path.join(__dirname, fileName), 'utf8');
      expect({ fileName, importsJournal: source.includes('commerceCommandJournal') })
        .toEqual({ fileName, importsJournal: false });
    }
  });
});
