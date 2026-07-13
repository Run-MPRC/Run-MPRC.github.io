const admin = require('firebase-admin');

const {
  createCommandKey,
  createPayloadFingerprint,
} = require('./commerceCommandIdentity');
const {
  CommerceCommandJournalError,
  registerCommerceCommand,
} = require('./commerceCommandJournal');

const PROJECT_ID = 'demo-pay002b2-test';
const APP_NAME = 'commerce-command-journal-emulator-test';
const CONCURRENT_CALLS = 24;
const JOURNAL_EMULATOR_OPT_IN = 'REQUIRE_COMMERCE_COMMAND_JOURNAL_EMULATOR';
const describeWithEmulator = process.env[JOURNAL_EMULATOR_OPT_IN] === '1'
  ? describe
  : describe.skip;

jest.setTimeout(30000);

const COMMAND_IDS = Object.freeze({
  identical: '11111111-1111-4111-8111-111111111111',
  conflict: '22222222-2222-4222-8222-222222222222',
  orphanAudit: '33333333-3333-4333-8333-333333333333',
  lostResponse: '44444444-4444-4444-8444-444444444444',
  malformed: '55555555-5555-4555-8555-555555555555',
  future: '66666666-6666-4666-8666-666666666666',
});

function frozenRecord(entries) {
  const record = Object.create(null);
  for (const [key, value] of entries) record[key] = value;
  return Object.freeze(record);
}

function payload(reference) {
  return frozenRecord([
    ['amountCents', 2500],
    ['currency', 'usd'],
    ['syntheticReference', reference],
  ]);
}

function commandArgs(db, commandId, commandPayload) {
  return {
    db,
    environment: 'test',
    callerScope: {
      kind: 'firebase_uid',
      value: 'synthetic_emulator_runner',
    },
    commandId,
    commandType: 'race.checkout.create',
    endpointSchemaVersion: 1,
    payload: commandPayload,
  };
}

function assertExactSafeEmulator() {
  if (process.env[JOURNAL_EMULATOR_OPT_IN] !== '1') {
    throw new Error('The commerce command journal emulator opt-in is required.');
  }
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (typeof emulatorHost !== 'string') {
    throw new Error('The Firestore emulator host is required.');
  }

  let parsed;
  try {
    parsed = new URL(`http://${emulatorHost}`);
  } catch {
    throw new Error('The Firestore emulator host is invalid.');
  }
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  const port = Number(parsed.port);
  if (!loopbackHosts.has(parsed.hostname)
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== ''
    || !Number.isInteger(port)
    || port < 1
    || port > 65535) {
    throw new Error('The Firestore emulator must use a loopback host and explicit port.');
  }

  if (process.env.GCLOUD_PROJECT !== PROJECT_ID) {
    throw new Error(`The emulator project must be exactly ${PROJECT_ID}.`);
  }
  if (process.env.GOOGLE_CLOUD_PROJECT
    && process.env.GOOGLE_CLOUD_PROJECT !== PROJECT_ID) {
    throw new Error(`The Google Cloud project must be exactly ${PROJECT_ID}.`);
  }
}

function commandIdentity(args) {
  return createCommandKey({
    environment: args.environment,
    callerScope: args.callerScope,
    commandId: args.commandId,
  });
}

function fingerprint(args) {
  return createPayloadFingerprint({
    commandType: args.commandType,
    payload: args.payload,
  }).payloadFingerprint;
}

function snapshotEvidence(snapshot) {
  return {
    exists: snapshot.exists,
    data: snapshot.data(),
    createTime: snapshot.createTime && snapshot.createTime.toMillis(),
    updateTime: snapshot.updateTime && snapshot.updateTime.toMillis(),
  };
}

function expectJournalError(error, reason) {
  expect(error).toBeInstanceOf(CommerceCommandJournalError);
  expect(error).toMatchObject({
    code: 'commerce_command_journal_error',
    reason,
  });
  expect(Object.isFrozen(error)).toBe(true);
}

describeWithEmulator('commerce command journal Firestore transaction', () => {
  let app;
  let db;
  let trackedRefs = new Map();

  function pairFor(args) {
    const { commandKeyHash } = commandIdentity(args);
    const commandRef = db.collection('checkoutRequests').doc(commandKeyHash);
    const auditRef = db.collection('auditEvents')
      .doc(`commerce_command_${commandKeyHash}_0000000001`);
    trackedRefs.set(commandRef.path, commandRef);
    trackedRefs.set(auditRef.path, auditRef);
    return { commandKeyHash, commandRef, auditRef };
  }

  async function readPair(pair) {
    const [commandSnapshot, auditSnapshot] = await Promise.all([
      pair.commandRef.get(),
      pair.auditRef.get(),
    ]);
    return { commandSnapshot, auditSnapshot };
  }

  async function cleanupTrackedRefs() {
    if (!trackedRefs) return;
    const refs = [...trackedRefs.values()];
    trackedRefs.clear();
    if (refs.length === 0) return;
    if (!db) throw new Error('The Firestore emulator database is unavailable.');
    const batch = db.batch();
    for (const ref of refs) batch.delete(ref);
    await batch.commit();
  }

  beforeAll(() => {
    assertExactSafeEmulator();
    app = admin.initializeApp({ projectId: PROJECT_ID }, APP_NAME);
    db = app.firestore();
  });

  beforeEach(() => {
    trackedRefs = new Map();
  });

  afterEach(async () => {
    await cleanupTrackedRefs();
  });

  afterAll(async () => {
    if (trackedRefs) await cleanupTrackedRefs();
    if (app) await app.delete();
  });

  test('24 identical concurrent calls create one command and one audit event', async () => {
    const args = commandArgs(db, COMMAND_IDS.identical, payload('identical'));
    const pair = pairFor(args);

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_CALLS }, () => registerCommerceCommand(args)),
    );

    expect(results.filter((result) => result.outcome === 'registered_new')).toHaveLength(1);
    expect(results.filter((result) => result.outcome === 'registered_existing'))
      .toHaveLength(CONCURRENT_CALLS - 1);
    for (const result of results) {
      expect(result).toEqual({
        journalSchemaVersion: 1,
        outcome: expect.stringMatching(/^registered_(?:new|existing)$/),
        state: 'registered',
      });
      expect(Object.isFrozen(result)).toBe(true);
    }

    const stored = await readPair(pair);
    expect(stored.commandSnapshot.exists).toBe(true);
    expect(stored.auditSnapshot.exists).toBe(true);
    expect(stored.auditSnapshot.data().commandKeyHash).toBe(pair.commandKeyHash);
    const matchingAuditEvents = await db.collection('auditEvents')
      .where('commandKeyHash', '==', pair.commandKeyHash)
      .get();
    expect(matchingAuditEvents.size).toBe(1);
  });

  test('a concurrent two-payload race commits one identity and never overwrites it', async () => {
    const firstArgs = commandArgs(db, COMMAND_IDS.conflict, payload('race-a'));
    const secondArgs = commandArgs(db, COMMAND_IDS.conflict, payload('race-b'));
    const pair = pairFor(firstArgs);

    const calls = [
      ...Array.from({ length: 12 }, () => registerCommerceCommand(firstArgs)),
      ...Array.from({ length: 12 }, () => registerCommerceCommand(secondArgs)),
    ];
    const settled = await Promise.allSettled(calls);
    const fulfilled = settled.filter((result) => result.status === 'fulfilled');
    const rejected = settled.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(12);
    expect(rejected).toHaveLength(12);
    expect(fulfilled.filter((result) => result.value.outcome === 'registered_new'))
      .toHaveLength(1);
    expect(fulfilled.filter((result) => result.value.outcome === 'registered_existing'))
      .toHaveLength(11);
    for (const result of rejected) expectJournalError(result.reason, 'command_conflict');

    const firstFingerprint = fingerprint(firstArgs);
    const secondFingerprint = fingerprint(secondArgs);
    const initialPair = await readPair(pair);
    const storedFingerprint = initialPair.commandSnapshot.data().payloadFingerprint;
    expect([firstFingerprint, secondFingerprint]).toContain(storedFingerprint);
    const winningArgs = storedFingerprint === firstFingerprint ? firstArgs : secondArgs;
    const losingArgs = storedFingerprint === firstFingerprint ? secondArgs : firstArgs;

    await expect(Promise.all(
      Array.from({ length: 5 }, () => registerCommerceCommand(winningArgs)),
    )).resolves.toEqual(Array.from({ length: 5 }, () => ({
      journalSchemaVersion: 1,
      outcome: 'registered_existing',
      state: 'registered',
    })));
    await expect(registerCommerceCommand(losingArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'command_conflict',
    });

    const finalPair = await readPair(pair);
    expect(snapshotEvidence(finalPair.commandSnapshot))
      .toEqual(snapshotEvidence(initialPair.commandSnapshot));
    expect(snapshotEvidence(finalPair.auditSnapshot))
      .toEqual(snapshotEvidence(initialPair.auditSnapshot));
  });

  test('a preseeded deterministic audit makes registration fail without an orphan command', async () => {
    const args = commandArgs(db, COMMAND_IDS.orphanAudit, payload('preseed-audit'));
    const pair = pairFor(args);
    const preseed = Object.freeze({ syntheticPreseed: true });
    await pair.auditRef.create(preseed);
    const auditBefore = await pair.auditRef.get();

    await expect(registerCommerceCommand(args)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });

    const stored = await readPair(pair);
    expect(stored.commandSnapshot.exists).toBe(false);
    expect(snapshotEvidence(stored.auditSnapshot)).toEqual(snapshotEvidence(auditBefore));
  });

  test('a retry after a lost response is existing-only and leaves both documents unchanged', async () => {
    const args = commandArgs(db, COMMAND_IDS.lostResponse, payload('lost-response'));
    const pair = pairFor(args);

    await registerCommerceCommand(args);
    const beforeRetry = await readPair(pair);
    const retries = await Promise.all(
      Array.from({ length: 8 }, () => registerCommerceCommand(args)),
    );
    expect(retries).toEqual(Array.from({ length: 8 }, () => ({
      journalSchemaVersion: 1,
      outcome: 'registered_existing',
      state: 'registered',
    })));

    const afterRetry = await readPair(pair);
    expect(snapshotEvidence(afterRetry.commandSnapshot))
      .toEqual(snapshotEvidence(beforeRetry.commandSnapshot));
    expect(snapshotEvidence(afterRetry.auditSnapshot))
      .toEqual(snapshotEvidence(beforeRetry.auditSnapshot));
  });

  test('a malformed timestamp pair rejects without repair', async () => {
    const args = commandArgs(db, COMMAND_IDS.malformed, payload('malformed-pair'));
    const pair = pairFor(args);
    await registerCommerceCommand(args);
    const valid = await readPair(pair);
    const mismatchedTimestamp = admin.firestore.Timestamp.fromMillis(
      valid.auditSnapshot.data().occurredAt.toMillis() + 1,
    );
    await pair.auditRef.set({
      ...valid.auditSnapshot.data(),
      occurredAt: mismatchedTimestamp,
    });
    const malformed = await readPair(pair);

    await expect(registerCommerceCommand(args)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });

    const afterAttempt = await readPair(pair);
    expect(snapshotEvidence(afterAttempt.commandSnapshot))
      .toEqual(snapshotEvidence(malformed.commandSnapshot));
    expect(snapshotEvidence(afterAttempt.auditSnapshot))
      .toEqual(snapshotEvidence(malformed.auditSnapshot));
  });

  test('future-version records reject without repair', async () => {
    const args = commandArgs(db, COMMAND_IDS.future, payload('future-pair'));
    const pair = pairFor(args);
    await registerCommerceCommand(args);
    const valid = await readPair(pair);
    await Promise.all([
      pair.commandRef.set({
        ...valid.commandSnapshot.data(),
        journalSchemaVersion: 2,
      }),
      pair.auditRef.set({
        ...valid.auditSnapshot.data(),
        auditSchemaVersion: 2,
      }),
    ]);
    const future = await readPair(pair);

    await expect(registerCommerceCommand(args)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });

    const afterAttempt = await readPair(pair);
    expect(snapshotEvidence(afterAttempt.commandSnapshot))
      .toEqual(snapshotEvidence(future.commandSnapshot));
    expect(snapshotEvidence(afterAttempt.auditSnapshot))
      .toEqual(snapshotEvidence(future.auditSnapshot));
  });
});
