const admin = require('firebase-admin');

const {
  createCommandKey,
  createPayloadFingerprint,
} = require('./commerceCommandIdentity');
const {
  CommerceCommandJournalError,
  acquireCommerceCommandLease,
  completeCommerceCommand,
  failCommerceCommand,
  registerCommerceCommand,
} = require('./commerceCommandJournal');

const PROJECT_ID = 'demo-pay002b2-test';
const APP_NAME = 'commerce-command-journal-emulator-test';
const CONCURRENT_CALLS = 24;
const JOURNAL_EMULATOR_OPT_IN = 'REQUIRE_COMMERCE_COMMAND_JOURNAL_EMULATOR';
const describeWithEmulator = process.env[JOURNAL_EMULATOR_OPT_IN] === '1'
  ? describe
  : describe.skip;

jest.setTimeout(60000);

const COMMAND_IDS = Object.freeze({
  identical: '11111111-1111-4111-8111-111111111111',
  conflict: '22222222-2222-4222-8222-222222222222',
  orphanAudit: '33333333-3333-4333-8333-333333333333',
  lostResponse: '44444444-4444-4444-8444-444444444444',
  malformed: '55555555-5555-4555-8555-555555555555',
  future: '66666666-6666-4666-8666-666666666666',
  distinctLeaseRace: '77777777-7777-4777-8777-777777777777',
  sameLeaseRace: '88888888-8888-4888-8888-888888888888',
  takeoverRace: '99999999-9999-4999-8999-999999999999',
  terminalRace: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  commitmentRace: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  terminalReplay: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  finalFailureReplay: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  preseedLifecycleAudit: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  malformedLifecycle: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  orphanLifecycle: '01234567-89ab-4cde-8fab-0123456789ab',
  preseedTerminalAudit: '12345678-9abc-4def-8abc-123456789abc',
  missingCurrentAudit: '23456789-abcd-4efa-8bcd-23456789abcd',
  malformedLifecycleShape: '3456789a-bcde-4fab-8cde-3456789abcde',
  malformedCurrentAudit: '456789ab-cdef-4abc-8def-456789abcdef',
});
const BASE_NOW_MILLIS = 1800000000123;
const LEASE_DURATION_MILLIS = 60000;
const TERMINAL_REFERENCE_FINGERPRINT = 'd'.repeat(64);
const OTHER_TERMINAL_REFERENCE_FINGERPRINT = 'e'.repeat(64);

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

function deterministicLeaseId(index) {
  return `10000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function acquireArgs(db, commandId, commandPayload, leaseId) {
  return {
    ...commandArgs(db, commandId, commandPayload),
    leaseId,
  };
}

function completeArgs(db, commandId, commandPayload, leaseId, expectedFenceEpoch,
  terminalReferenceFingerprint = TERMINAL_REFERENCE_FINGERPRINT) {
  return {
    ...acquireArgs(db, commandId, commandPayload, leaseId),
    expectedFenceEpoch,
    terminalReferenceFingerprint,
  };
}

function failArgs(db, commandId, commandPayload, leaseId, expectedFenceEpoch) {
  return {
    ...acquireArgs(db, commandId, commandPayload, leaseId),
    expectedFenceEpoch,
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
  let nowMillis;
  let timestampNow;

  function trackRef(ref) {
    trackedRefs.set(ref.path, ref);
    return ref;
  }

  function auditRefFor(commandKeyHash, revision) {
    return trackRef(db.collection('auditEvents')
      .doc(`commerce_command_${commandKeyHash}_${String(revision).padStart(10, '0')}`));
  }

  function pairFor(args) {
    const { commandKeyHash } = commandIdentity(args);
    const commandRef = trackRef(db.collection('checkoutRequests').doc(commandKeyHash));
    const lifecycleRef = trackRef(commandRef.collection('lifecycle').doc('current'));
    const auditRef = auditRefFor(commandKeyHash, 1);
    // Track every revision this focused suite can create before a concurrent
    // assertion runs, so even an early failure cannot leak synthetic audits.
    for (const revision of [2, 3, 4]) auditRefFor(commandKeyHash, revision);
    return { commandKeyHash, commandRef, lifecycleRef, auditRef };
  }

  async function readPair(pair) {
    const [commandSnapshot, auditSnapshot] = await Promise.all([
      pair.commandRef.get(),
      pair.auditRef.get(),
    ]);
    return { commandSnapshot, auditSnapshot };
  }

  async function readLifecycle(pair) {
    return pair.lifecycleRef.get();
  }

  async function readAudit(pair, revision) {
    return auditRefFor(pair.commandKeyHash, revision).get();
  }

  async function readLifecycleEvidence(pair, revision) {
    const [lifecycleSnapshot, auditSnapshot] = await Promise.all([
      readLifecycle(pair),
      readAudit(pair, revision),
    ]);
    return {
      lifecycle: snapshotEvidence(lifecycleSnapshot),
      audit: snapshotEvidence(auditSnapshot),
    };
  }

  async function matchingAudits(pair) {
    return db.collection('auditEvents')
      .where('commandKeyHash', '==', pair.commandKeyHash)
      .get();
  }

  function setTrustedNow(millis) {
    nowMillis = millis;
  }

  function expectLeaseResult(result, fenceEpoch) {
    expect(result).toEqual({
      journalSchemaVersion: 1,
      lifecycleSchemaVersion: 1,
      outcome: 'lease_acquired',
      state: 'leased',
      fenceEpoch,
      leaseExpiresAt: {
        seconds: expect.any(Number),
        nanoseconds: expect.any(Number),
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.leaseExpiresAt)).toBe(true);
  }

  function expectBusyResult(result) {
    expect(result).toEqual({
      journalSchemaVersion: 1,
      lifecycleSchemaVersion: 1,
      outcome: 'lease_busy',
      state: 'leased',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).not.toHaveProperty('fenceEpoch');
    expect(result).not.toHaveProperty('leaseExpiresAt');
  }

  function expectTerminalResult(result, state) {
    expect(result).toEqual({
      journalSchemaVersion: 1,
      lifecycleSchemaVersion: 1,
      outcome: state === 'succeeded' ? 'terminal_succeeded' : 'terminal_failed_final',
      state,
    });
    expect(Object.isFrozen(result)).toBe(true);
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
    nowMillis = BASE_NOW_MILLIS;
    timestampNow = jest.spyOn(admin.firestore.Timestamp, 'now')
      .mockImplementation(() => admin.firestore.Timestamp.fromMillis(nowMillis));
  });

  afterEach(async () => {
    timestampNow.mockRestore();
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

  test('24 distinct holders race to one first lease and preserve registration bytes', async () => {
    const commandPayload = payload('distinct-lease-race');
    const registrationArgs = commandArgs(
      db,
      COMMAND_IDS.distinctLeaseRace,
      commandPayload,
    );
    const pair = pairFor(registrationArgs);
    await registerCommerceCommand(registrationArgs);
    const registrationBefore = await readPair(pair);

    const leaseArgs = Array.from({ length: CONCURRENT_CALLS }, (_, index) => acquireArgs(
      db,
      COMMAND_IDS.distinctLeaseRace,
      commandPayload,
      deterministicLeaseId(index + 1),
    ));
    const results = await Promise.all(leaseArgs.map(acquireCommerceCommandLease));
    const acquired = results.filter((result) => result.outcome === 'lease_acquired');
    const busy = results.filter((result) => result.outcome === 'lease_busy');

    expect(acquired).toHaveLength(1);
    expect(busy).toHaveLength(CONCURRENT_CALLS - 1);
    expectLeaseResult(acquired[0], 1);
    for (const result of busy) expectBusyResult(result);

    const lifecycle = await readLifecycle(pair);
    const lifecycleAudit = await readAudit(pair, 2);
    expect(lifecycle.data()).toMatchObject({
      lifecycleSchemaVersion: 1,
      commandKeyHash: pair.commandKeyHash,
      state: 'leased',
      commandRevision: 2,
      fenceEpoch: 1,
      terminalCommitmentKind: null,
      terminalCommitmentHash: null,
    });
    expect(lifecycle.data().leaseAcquiredAt.toMillis()).toBe(BASE_NOW_MILLIS);
    expect(lifecycle.data().leaseExpiresAt.toMillis())
      .toBe(BASE_NOW_MILLIS + LEASE_DURATION_MILLIS);
    expect(lifecycleAudit.data()).toMatchObject({
      auditSchemaVersion: 2,
      commandKeyHash: pair.commandKeyHash,
      commandRevision: 2,
      eventType: 'command_lease_acquired',
      fromState: 'registered',
      toState: 'leased',
      fenceEpoch: 1,
    });
    expect((await matchingAudits(pair)).size).toBe(2);

    const registrationAfter = await readPair(pair);
    expect(snapshotEvidence(registrationAfter.commandSnapshot))
      .toEqual(snapshotEvidence(registrationBefore.commandSnapshot));
    expect(snapshotEvidence(registrationAfter.auditSnapshot))
      .toEqual(snapshotEvidence(registrationBefore.auditSnapshot));
    await expect(registerCommerceCommand(registrationArgs)).resolves.toEqual({
      journalSchemaVersion: 1,
      outcome: 'registered_existing',
      state: 'registered',
    });
  });

  test('24 same-holder lost-response calls recover one identical lease without another write', async () => {
    const commandPayload = payload('same-holder-recovery');
    const registrationArgs = commandArgs(db, COMMAND_IDS.sameLeaseRace, commandPayload);
    const args = acquireArgs(
      db,
      COMMAND_IDS.sameLeaseRace,
      commandPayload,
      deterministicLeaseId(50),
    );
    const pair = pairFor(args);
    await registerCommerceCommand(registrationArgs);

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_CALLS }, () => acquireCommerceCommandLease(args)),
    );
    for (const result of results) {
      expectLeaseResult(result, 1);
      expect(result).toEqual(results[0]);
    }

    const beforeRecovery = await readLifecycleEvidence(pair, 2);
    const recovered = await Promise.all(
      Array.from({ length: 8 }, () => acquireCommerceCommandLease(args)),
    );
    expect(recovered).toEqual(Array.from({ length: 8 }, () => results[0]));
    const afterRecovery = await readLifecycleEvidence(pair, 2);
    expect(afterRecovery).toEqual(beforeRecovery);
    expect((await matchingAudits(pair)).size).toBe(2);
  });

  test('an expired 24-holder race advances one fence and rejects the old holder and fence', async () => {
    const commandPayload = payload('expired-takeover');
    const registrationArgs = commandArgs(db, COMMAND_IDS.takeoverRace, commandPayload);
    const oldLeaseId = deterministicLeaseId(60);
    const oldLeaseArgs = acquireArgs(
      db,
      COMMAND_IDS.takeoverRace,
      commandPayload,
      oldLeaseId,
    );
    const pair = pairFor(oldLeaseArgs);
    await registerCommerceCommand(registrationArgs);
    const firstLease = await acquireCommerceCommandLease(oldLeaseArgs);
    expectLeaseResult(firstLease, 1);

    setTrustedNow(BASE_NOW_MILLIS + LEASE_DURATION_MILLIS);
    const contenders = Array.from({ length: CONCURRENT_CALLS }, (_, index) => ({
      leaseId: deterministicLeaseId(index + 100),
      args: acquireArgs(
        db,
        COMMAND_IDS.takeoverRace,
        commandPayload,
        deterministicLeaseId(index + 100),
      ),
    }));
    const results = await Promise.all(
      contenders.map(({ args }) => acquireCommerceCommandLease(args)),
    );
    const winningIndexes = results
      .map((result, index) => ({ result, index }))
      .filter(({ result }) => result.outcome === 'lease_acquired');
    expect(winningIndexes).toHaveLength(1);
    expectLeaseResult(winningIndexes[0].result, 2);
    for (const result of results.filter((value) => value.outcome === 'lease_busy')) {
      expectBusyResult(result);
    }
    expect(results.filter((result) => result.outcome === 'lease_busy'))
      .toHaveLength(CONCURRENT_CALLS - 1);

    const lifecycle = await readLifecycle(pair);
    expect(lifecycle.data()).toMatchObject({
      state: 'leased',
      commandRevision: 3,
      fenceEpoch: 2,
    });
    const takeoverAudit = await readAudit(pair, 3);
    expect(takeoverAudit.data()).toMatchObject({
      commandRevision: 3,
      eventType: 'command_lease_taken_over',
      fromState: 'leased',
      toState: 'leased',
      fenceEpoch: 2,
    });
    expect((await matchingAudits(pair)).size).toBe(3);

    const beforeStaleFinish = await readLifecycleEvidence(pair, 3);
    const staleAttempts = await Promise.allSettled([
      completeCommerceCommand(completeArgs(
        db,
        COMMAND_IDS.takeoverRace,
        commandPayload,
        oldLeaseId,
        1,
      )),
      failCommerceCommand(failArgs(
        db,
        COMMAND_IDS.takeoverRace,
        commandPayload,
        oldLeaseId,
        1,
      )),
    ]);
    expect(staleAttempts).toHaveLength(2);
    for (const result of staleAttempts) {
      expect(result.status).toBe('rejected');
      expectJournalError(result.reason, 'lease_stale');
    }
    expect(await readLifecycleEvidence(pair, 3)).toEqual(beforeStaleFinish);
    expect((await matchingAudits(pair)).size).toBe(3);
  });

  test('concurrent complete-versus-final-fail commits exactly one terminal outcome', async () => {
    const commandPayload = payload('terminal-outcome-race');
    const leaseId = deterministicLeaseId(200);
    const registrationArgs = commandArgs(db, COMMAND_IDS.terminalRace, commandPayload);
    const leaseArgs = acquireArgs(
      db,
      COMMAND_IDS.terminalRace,
      commandPayload,
      leaseId,
    );
    const pair = pairFor(leaseArgs);
    await registerCommerceCommand(registrationArgs);
    await acquireCommerceCommandLease(leaseArgs);
    setTrustedNow(BASE_NOW_MILLIS + 1);

    const settled = await Promise.allSettled([
      completeCommerceCommand(completeArgs(
        db,
        COMMAND_IDS.terminalRace,
        commandPayload,
        leaseId,
        1,
      )),
      failCommerceCommand(failArgs(
        db,
        COMMAND_IDS.terminalRace,
        commandPayload,
        leaseId,
        1,
      )),
    ]);
    const fulfilled = settled.filter((result) => result.status === 'fulfilled');
    const rejected = settled.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(['succeeded', 'failed_final']).toContain(fulfilled[0].value.state);
    expectTerminalResult(fulfilled[0].value, fulfilled[0].value.state);
    expectJournalError(rejected[0].reason, 'terminal_conflict');

    const lifecycle = await readLifecycle(pair);
    const terminalAudit = await readAudit(pair, 3);
    expect(lifecycle.data()).toMatchObject({
      state: fulfilled[0].value.state,
      commandRevision: 3,
      fenceEpoch: 1,
    });
    expect(terminalAudit.data()).toMatchObject({
      commandRevision: 3,
      eventType: fulfilled[0].value.state === 'succeeded'
        ? 'command_succeeded'
        : 'command_failed_final',
      fromState: 'leased',
      toState: fulfilled[0].value.state,
      fenceEpoch: 1,
    });
    expect((await matchingAudits(pair)).size).toBe(3);
    expect((await readAudit(pair, 4)).exists).toBe(false);
  });

  test('distinct success commitments race to one immutable terminal commitment', async () => {
    const commandPayload = payload('terminal-commitment-race');
    const leaseId = deterministicLeaseId(210);
    const registrationArgs = commandArgs(db, COMMAND_IDS.commitmentRace, commandPayload);
    const leaseArgs = acquireArgs(
      db,
      COMMAND_IDS.commitmentRace,
      commandPayload,
      leaseId,
    );
    const pair = pairFor(leaseArgs);
    await registerCommerceCommand(registrationArgs);
    await acquireCommerceCommandLease(leaseArgs);
    setTrustedNow(BASE_NOW_MILLIS + 1);

    const settled = await Promise.allSettled([
      completeCommerceCommand(completeArgs(
        db,
        COMMAND_IDS.commitmentRace,
        commandPayload,
        leaseId,
        1,
        TERMINAL_REFERENCE_FINGERPRINT,
      )),
      completeCommerceCommand(completeArgs(
        db,
        COMMAND_IDS.commitmentRace,
        commandPayload,
        leaseId,
        1,
        OTHER_TERMINAL_REFERENCE_FINGERPRINT,
      )),
    ]);
    const fulfilled = settled.filter((result) => result.status === 'fulfilled');
    const rejected = settled.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expectTerminalResult(fulfilled[0].value, 'succeeded');
    expectJournalError(rejected[0].reason, 'terminal_conflict');

    const lifecycle = await readLifecycle(pair);
    const terminalAudit = await readAudit(pair, 3);
    expect(lifecycle.data()).toMatchObject({
      state: 'succeeded',
      commandRevision: 3,
      fenceEpoch: 1,
      terminalCommitmentKind: 'business_record_digest',
      terminalCommitmentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(lifecycle.data().terminalCommitmentHash)
      .not.toBe(TERMINAL_REFERENCE_FINGERPRINT);
    expect(lifecycle.data().terminalCommitmentHash)
      .not.toBe(OTHER_TERMINAL_REFERENCE_FINGERPRINT);
    expect(terminalAudit.data()).not.toHaveProperty('terminalCommitmentKind');
    expect(terminalAudit.data()).not.toHaveProperty('terminalCommitmentHash');
    expect(JSON.stringify(terminalAudit.data())).not.toContain(TERMINAL_REFERENCE_FINGERPRINT);
    expect(JSON.stringify(terminalAudit.data()))
      .not.toContain(OTHER_TERMINAL_REFERENCE_FINGERPRINT);
    expect((await matchingAudits(pair)).size).toBe(3);
  });

  test.each([
    {
      name: 'successful',
      commandId: COMMAND_IDS.terminalReplay,
      state: 'succeeded',
      finalize: completeCommerceCommand,
      finalizeArgs: completeArgs,
    },
    {
      name: 'final-failure',
      commandId: COMMAND_IDS.finalFailureReplay,
      state: 'failed_final',
      finalize: failCommerceCommand,
      finalizeArgs: failArgs,
    },
  ])('$name terminal retry, later acquire, and registration are read-only', async ({
    commandId,
    state,
    finalize,
    finalizeArgs,
  }) => {
    setTrustedNow(BASE_NOW_MILLIS);
    const commandPayload = payload(`terminal-replay-${state}`);
    const leaseId = deterministicLeaseId(state === 'succeeded' ? 220 : 221);
    const registrationArgs = commandArgs(db, commandId, commandPayload);
    const leaseArgs = acquireArgs(db, commandId, commandPayload, leaseId);
    const pair = pairFor(leaseArgs);
    await registerCommerceCommand(registrationArgs);
    const registrationBefore = await readPair(pair);
    await acquireCommerceCommandLease(leaseArgs);
    setTrustedNow(BASE_NOW_MILLIS + 1);

    const terminalInput = finalizeArgs(
      db,
      commandId,
      commandPayload,
      leaseId,
      1,
    );
    expectTerminalResult(await finalize(terminalInput), state);
    const terminalBeforeReplay = await readLifecycleEvidence(pair, 3);
    const registrationAtTerminal = await readPair(pair);
    expect(snapshotEvidence(registrationAtTerminal.commandSnapshot))
      .toEqual(snapshotEvidence(registrationBefore.commandSnapshot));
    expect(snapshotEvidence(registrationAtTerminal.auditSnapshot))
      .toEqual(snapshotEvidence(registrationBefore.auditSnapshot));

    setTrustedNow(BASE_NOW_MILLIS + (LEASE_DURATION_MILLIS * 2));
    expectTerminalResult(await finalize(terminalInput), state);
    expectTerminalResult(await acquireCommerceCommandLease(acquireArgs(
      db,
      commandId,
      commandPayload,
      deterministicLeaseId(state === 'succeeded' ? 222 : 223),
    )), state);
    await expect(registerCommerceCommand(registrationArgs)).resolves.toEqual({
      journalSchemaVersion: 1,
      outcome: 'registered_existing',
      state: 'registered',
    });

    expect(await readLifecycleEvidence(pair, 3)).toEqual(terminalBeforeReplay);
    expect((await matchingAudits(pair)).size).toBe(3);
    expect((await readAudit(pair, 4)).exists).toBe(false);
    const registrationAfterReplay = await readPair(pair);
    expect(snapshotEvidence(registrationAfterReplay.commandSnapshot))
      .toEqual(snapshotEvidence(registrationBefore.commandSnapshot));
    expect(snapshotEvidence(registrationAfterReplay.auditSnapshot))
      .toEqual(snapshotEvidence(registrationBefore.auditSnapshot));
  });

  test('preseeded next audits block first lease and terminal completion atomically', async () => {
    const firstPayload = payload('preseed-first-lifecycle-audit');
    const firstRegistration = commandArgs(
      db,
      COMMAND_IDS.preseedLifecycleAudit,
      firstPayload,
    );
    const firstLease = acquireArgs(
      db,
      COMMAND_IDS.preseedLifecycleAudit,
      firstPayload,
      deterministicLeaseId(230),
    );
    const firstPair = pairFor(firstLease);
    await registerCommerceCommand(firstRegistration);
    const firstRegistrationBefore = await readPair(firstPair);
    const preseededRevisionTwo = auditRefFor(firstPair.commandKeyHash, 2);
    await preseededRevisionTwo.create({ syntheticPreseed: 'revision-two' });
    const revisionTwoBefore = await preseededRevisionTwo.get();

    await expect(acquireCommerceCommandLease(firstLease)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect((await readLifecycle(firstPair)).exists).toBe(false);
    expect(snapshotEvidence(await preseededRevisionTwo.get()))
      .toEqual(snapshotEvidence(revisionTwoBefore));
    const firstRegistrationAfter = await readPair(firstPair);
    expect(snapshotEvidence(firstRegistrationAfter.commandSnapshot))
      .toEqual(snapshotEvidence(firstRegistrationBefore.commandSnapshot));
    expect(snapshotEvidence(firstRegistrationAfter.auditSnapshot))
      .toEqual(snapshotEvidence(firstRegistrationBefore.auditSnapshot));

    const terminalPayload = payload('preseed-terminal-audit');
    const terminalRegistration = commandArgs(
      db,
      COMMAND_IDS.preseedTerminalAudit,
      terminalPayload,
    );
    const terminalLeaseId = deterministicLeaseId(231);
    const terminalLease = acquireArgs(
      db,
      COMMAND_IDS.preseedTerminalAudit,
      terminalPayload,
      terminalLeaseId,
    );
    const terminalPair = pairFor(terminalLease);
    await registerCommerceCommand(terminalRegistration);
    await acquireCommerceCommandLease(terminalLease);
    const lifecycleBefore = await readLifecycleEvidence(terminalPair, 2);
    const preseededRevisionThree = auditRefFor(terminalPair.commandKeyHash, 3);
    await preseededRevisionThree.create({ syntheticPreseed: 'revision-three' });
    const revisionThreeBefore = await preseededRevisionThree.get();
    setTrustedNow(BASE_NOW_MILLIS + 1);

    await expect(completeCommerceCommand(completeArgs(
      db,
      COMMAND_IDS.preseedTerminalAudit,
      terminalPayload,
      terminalLeaseId,
      1,
    ))).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(await readLifecycleEvidence(terminalPair, 2)).toEqual(lifecycleBefore);
    expect(snapshotEvidence(await preseededRevisionThree.get()))
      .toEqual(snapshotEvidence(revisionThreeBefore));
  });

  test('orphan, future, malformed, and unpaired lifecycle states reject without repair', async () => {
    const orphanPayload = payload('orphan-lifecycle');
    const orphanArgs = acquireArgs(
      db,
      COMMAND_IDS.orphanLifecycle,
      orphanPayload,
      deterministicLeaseId(240),
    );
    const orphanPair = pairFor(orphanArgs);
    await orphanPair.lifecycleRef.create({ syntheticOrphan: true });
    const orphanBefore = await orphanPair.lifecycleRef.get();
    await expect(acquireCommerceCommandLease(orphanArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(snapshotEvidence(await orphanPair.lifecycleRef.get()))
      .toEqual(snapshotEvidence(orphanBefore));
    expect((await readPair(orphanPair)).commandSnapshot.exists).toBe(false);
    expect((await readPair(orphanPair)).auditSnapshot.exists).toBe(false);

    const futurePayload = payload('future-lifecycle');
    const futureRegistration = commandArgs(
      db,
      COMMAND_IDS.malformedLifecycle,
      futurePayload,
    );
    const futureArgs = acquireArgs(
      db,
      COMMAND_IDS.malformedLifecycle,
      futurePayload,
      deterministicLeaseId(241),
    );
    const futurePair = pairFor(futureArgs);
    await registerCommerceCommand(futureRegistration);
    await futurePair.lifecycleRef.create({
      lifecycleSchemaVersion: 2,
      syntheticFuture: true,
    });
    const futureBefore = await futurePair.lifecycleRef.get();
    await expect(acquireCommerceCommandLease(futureArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(snapshotEvidence(await futurePair.lifecycleRef.get()))
      .toEqual(snapshotEvidence(futureBefore));
    expect((await readAudit(futurePair, 2)).exists).toBe(false);

    const malformedPayload = payload('malformed-lifecycle-shape');
    const malformedRegistration = commandArgs(
      db,
      COMMAND_IDS.malformedLifecycleShape,
      malformedPayload,
    );
    const malformedArgs = acquireArgs(
      db,
      COMMAND_IDS.malformedLifecycleShape,
      malformedPayload,
      deterministicLeaseId(243),
    );
    const malformedPair = pairFor(malformedArgs);
    await registerCommerceCommand(malformedRegistration);
    await acquireCommerceCommandLease(malformedArgs);
    const validMalformedLifecycle = await readLifecycle(malformedPair);
    const malformedAuditBefore = await readAudit(malformedPair, 2);
    await malformedPair.lifecycleRef.set({
      ...validMalformedLifecycle.data(),
      commandRevision: 4,
    });
    const malformedLifecycleBefore = await readLifecycle(malformedPair);

    await expect(acquireCommerceCommandLease(malformedArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(snapshotEvidence(await readLifecycle(malformedPair)))
      .toEqual(snapshotEvidence(malformedLifecycleBefore));
    expect(snapshotEvidence(await readAudit(malformedPair, 2)))
      .toEqual(snapshotEvidence(malformedAuditBefore));
    expect((await readAudit(malformedPair, 3)).exists).toBe(false);

    const malformedAuditPayload = payload('malformed-current-audit');
    const malformedAuditRegistration = commandArgs(
      db,
      COMMAND_IDS.malformedCurrentAudit,
      malformedAuditPayload,
    );
    const malformedAuditArgs = acquireArgs(
      db,
      COMMAND_IDS.malformedCurrentAudit,
      malformedAuditPayload,
      deterministicLeaseId(244),
    );
    const malformedAuditPair = pairFor(malformedAuditArgs);
    await registerCommerceCommand(malformedAuditRegistration);
    await acquireCommerceCommandLease(malformedAuditArgs);
    const lifecycleBeforeMalformedAudit = await readLifecycle(malformedAuditPair);
    const currentMalformedAuditRef = auditRefFor(malformedAuditPair.commandKeyHash, 2);
    const validCurrentAudit = await currentMalformedAuditRef.get();
    await currentMalformedAuditRef.set({
      ...validCurrentAudit.data(),
      eventType: 'command_succeeded',
    });
    const currentMalformedAuditBefore = await currentMalformedAuditRef.get();

    await expect(acquireCommerceCommandLease(malformedAuditArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(snapshotEvidence(await readLifecycle(malformedAuditPair)))
      .toEqual(snapshotEvidence(lifecycleBeforeMalformedAudit));
    expect(snapshotEvidence(await currentMalformedAuditRef.get()))
      .toEqual(snapshotEvidence(currentMalformedAuditBefore));
    expect((await readAudit(malformedAuditPair, 3)).exists).toBe(false);

    const missingAuditPayload = payload('missing-current-audit');
    const missingAuditRegistration = commandArgs(
      db,
      COMMAND_IDS.missingCurrentAudit,
      missingAuditPayload,
    );
    const missingAuditArgs = acquireArgs(
      db,
      COMMAND_IDS.missingCurrentAudit,
      missingAuditPayload,
      deterministicLeaseId(242),
    );
    const missingAuditPair = pairFor(missingAuditArgs);
    await registerCommerceCommand(missingAuditRegistration);
    await acquireCommerceCommandLease(missingAuditArgs);
    const lifecycleWithPartner = await readLifecycle(missingAuditPair);
    const currentAuditRef = auditRefFor(missingAuditPair.commandKeyHash, 2);
    await currentAuditRef.delete();
    const lifecycleWithoutPartner = await readLifecycle(missingAuditPair);
    expect(snapshotEvidence(lifecycleWithoutPartner))
      .toEqual(snapshotEvidence(lifecycleWithPartner));

    await expect(acquireCommerceCommandLease(missingAuditArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(snapshotEvidence(await readLifecycle(missingAuditPair)))
      .toEqual(snapshotEvidence(lifecycleWithoutPartner));
    expect((await currentAuditRef.get()).exists).toBe(false);
    expect((await readAudit(missingAuditPair, 3)).exists).toBe(false);
  });
});
