const fs = require('node:fs');
const path = require('node:path');
const { inspect } = require('node:util');
const { Timestamp } = require('firebase-admin/firestore');

const {
  commandIdentityVersion,
  createCommandKey,
  createPayloadFingerprint,
} = require('./commerceCommandIdentity');
const {
  journalSchemaVersion,
  lifecycleSchemaVersion,
  CommerceCommandJournalError,
  acquireCommerceCommandLease,
  completeCommerceCommand,
  failCommerceCommand,
  registerCommerceCommand,
} = require('./commerceCommandJournal');

const COMMAND_ID = '018f1f6a-9d2b-4c3d-8e5f-0123456789ab';
const OTHER_COMMAND_ID = '123e4567-e89b-42d3-a456-426614174000';
const LEASE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_LEASE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TERMINAL_REFERENCE_FINGERPRINT = 'd'.repeat(64);
const OTHER_TERMINAL_REFERENCE_FINGERPRINT = 'e'.repeat(64);
const GOLDEN_LEASE_OWNER_FINGERPRINT = '5d99ad039ee873195d1a765728e5946e87a959bf6765ccc9ea775541b10bccf1';
const GOLDEN_TERMINAL_COMMITMENT = 'abf0fc9f071bb52ec4a0f5500e61f71b14066bf12bf27befca69ef90f7d118ab';
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
  test('exports only the unused registration/lifecycle API and no provider-send permission', () => {
    const api = require('./commerceCommandJournal');
    expect(journalSchemaVersion).toBe(1);
    expect(lifecycleSchemaVersion).toBe(1);
    expect(Object.keys(api).sort()).toEqual([
      'CommerceCommandJournalError',
      'acquireCommerceCommandLease',
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
      /execute|send|renew|release|reconcile|replay|provider/i,
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
