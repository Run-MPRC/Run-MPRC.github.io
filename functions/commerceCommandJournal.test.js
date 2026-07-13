const fs = require('node:fs');
const path = require('node:path');
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
  CommerceCommandJournalError,
  acquireCommerceCommandLease,
  bindInitialStripeProviderPlan,
  completeCommerceCommand,
  failCommerceCommand,
  registerCommerceCommand,
} = require('./commerceCommandJournal');

const COMMAND_ID = '018f1f6a-9d2b-4c3d-8e5f-0123456789ab';
const OTHER_COMMAND_ID = '123e4567-e89b-42d3-a456-426614174000';
const LEASE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_LEASE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const THIRD_LEASE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
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
const NOW_MILLIS = 1800000000123;

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
  const store = new Map(seed);
  const callbackRuns = [];
  const collectionCalls = [];
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
  test('exports only the unused journal APIs and no provider-send permission', () => {
    const api = require('./commerceCommandJournal');
    expect(journalSchemaVersion).toBe(1);
    expect(lifecycleSchemaVersion).toBe(1);
    expect(Object.keys(api).sort()).toEqual([
      'CommerceCommandJournalError',
      'acquireCommerceCommandLease',
      'bindInitialStripeProviderPlan',
      'completeCommerceCommand',
      'failCommerceCommand',
      'journalSchemaVersion',
      'lifecycleSchemaVersion',
      'registerCommerceCommand',
    ]);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(CommerceCommandJournalError)).toBe(true);
    expect(Object.isFrozen(CommerceCommandJournalError.prototype)).toBe(true);
    expect(Object.keys(api).join(' ')).not.toMatch(
      /execute|send|renew|release|reconcile|replay|advance|result/i,
    );
  });

  test('has only the approved local, Firestore, and Node utility dependencies', () => {
    const source = fs.readFileSync(path.join(__dirname, 'commerceCommandJournal.js'), 'utf8');
    const imports = [...source.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]);
    expect(imports.sort()).toEqual([
      './commerceCommandIdentity',
      'firebase-admin/firestore',
      'node:crypto',
      'node:util',
    ]);
    expect(source).not.toMatch(/require\(['"]\.\/index|createCheckout|stripeWebhook/);
    expect(source).not.toMatch(/\b(?:fetch|XMLHttpRequest|console|logger)\s*[.(]/);
    expect(source).not.toMatch(/Math\.random|randomUUID|process\.env|node:fs|node:http|node:https|child_process/);
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
