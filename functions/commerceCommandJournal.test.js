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
  CommerceCommandJournalError,
  registerCommerceCommand,
} = require('./commerceCommandJournal');

const COMMAND_ID = '018f1f6a-9d2b-4c3d-8e5f-0123456789ab';
const OTHER_COMMAND_ID = '123e4567-e89b-42d3-a456-426614174000';
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

function reference(collectionName, documentId) {
  return Object.freeze({
    id: documentId,
    path: documentPath(collectionName, documentId),
  });
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
            writes.push(Object.freeze({ ref, value }));
          }),
        });
        callbackRuns.push({ transaction, writes });
        result = await callback(transaction);
        finalWrites = writes;
      }

      if (options.rejectCommit) throw options.rejectCommit;
      for (const write of finalWrites) {
        if (store.has(write.ref.path)) throw new Error('mock create precondition failed');
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
  test('exports only registration primitives and grants no execute/send/lease/result permission', () => {
    const api = require('./commerceCommandJournal');
    expect(journalSchemaVersion).toBe(1);
    expect(Object.keys(api).sort()).toEqual([
      'CommerceCommandJournalError',
      'journalSchemaVersion',
      'registerCommerceCommand',
    ]);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(CommerceCommandJournalError)).toBe(true);
    expect(Object.isFrozen(CommerceCommandJournalError.prototype)).toBe(true);
    expect(Object.keys(api).join(' ')).not.toMatch(/execute|send|lease|fence|result|replay|provider/i);
  });

  test('has only the approved local, Firestore, and Node utility dependencies', () => {
    const source = fs.readFileSync(path.join(__dirname, 'commerceCommandJournal.js'), 'utf8');
    const imports = [...source.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]);
    expect(imports.sort()).toEqual([
      './commerceCommandIdentity',
      'firebase-admin/firestore',
      'node:util',
    ]);
    expect(source).not.toMatch(/require\(['"]\.\/index|createCheckout|stripeWebhook/);
    expect(source).not.toMatch(/\b(?:fetch|XMLHttpRequest|console|logger)\s*[.(]/);
    expect(source).not.toMatch(/Math\.random|randomUUID|process\.env|node:fs|node:http|node:https|child_process/);
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
