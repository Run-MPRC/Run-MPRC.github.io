'use strict';

const admin = require('firebase-admin');
const { createRunnerProfileStore, PROFILE_COLLECTION } = require('./runnerConnectionProfiles');
const { ENTRY_COLLECTION, runnerEntryId } = require('./runnerConnectionReferences');
const { profile } = require('./testSupport/runnerConnectionsFixtures');

// Firestore's transaction-conflict backoff can exceed Jest's five-second unit
// default. Keep the one-winner/idempotency assertions unchanged.
jest.setTimeout(30000);

if (process.env.REQUIRE_RUNNER_CONNECTION_PROFILES_EMULATOR === '1'
  && (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')
    || process.env.GCLOUD_PROJECT !== 'demo-functions-test')) {
  throw new Error('Runner profile tests require the isolated demo emulator.');
}

const describeEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const UID = 'synthetic-connection-owner';
const OTHER = 'synthetic-other-owner';
const INITIAL_TIME = 1800000000000;
const consent = { memberDiscovery: true, similarity: true, broadenCircle: false };
const requestId = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const save = (index, expectedRevision = 0, overrides = {}) => ({
  requestId: requestId(index), expectedRevision, profile: profile(), consent,
  consentVersion: 1, adultConfirmed: true, ...overrides,
});

describeEmulator('runner profile persistence against local Firestore', () => {
  let app;
  let db;
  let store;
  let clock;
  let authorize;
  let denyAdmission;

  beforeAll(() => {
    app = admin.initializeApp({ projectId: 'demo-functions-test' }, 'synthetic-runner-profiles');
    db = app.firestore();
  });

  beforeEach(async () => {
    // Only this suite's known synthetic roots are touched; no real project IDs.
    for (const uid of [UID, OTHER]) {
      await db.collection(PROFILE_COLLECTION).doc(uid).delete();
      await db.collection(ENTRY_COLLECTION).doc(runnerEntryId(uid)).delete();
    }
    const audits = await db.collection('auditEvents').where('actorUid', '==', UID).get();
    await Promise.all(audits.docs.map((doc) => doc.ref.delete()));
    clock = INITIAL_TIME;
    denyAdmission = false;
    authorize = jest.fn(async ({ uid, operation }) => !denyAdmission && uid === UID
      && ['read', 'save', 'withdraw'].includes(operation));
    store = createRunnerProfileStore({ db, authorize, now: () => clock });
  });

  afterAll(async () => {
    for (const uid of [UID, OTHER]) {
      await db.collection(PROFILE_COLLECTION).doc(uid).delete();
      await db.collection(ENTRY_COLLECTION).doc(runnerEntryId(uid)).delete();
    }
    const audits = await db.collection('auditEvents').where('actorUid', '==', UID).get();
    await Promise.all(audits.docs.map((doc) => doc.ref.delete()));
    await app.delete();
  });

  async function auditCount() {
    return (await db.collection('auditEvents').where('actorUid', '==', UID).get()).size;
  }

  test('has no implicit authorization policy', () => {
    expect(() => createRunnerProfileStore({ db })).toThrow('Runner connection service is unavailable.');
  });

  test('missing profile defaults to private without creating a document', async () => {
    await expect(store.readOwn(UID)).resolves.toEqual({
      schemaVersion: 1, consentVersion: 1, adultConfirmed: false, revision: 0, profile: null,
      consent: { memberDiscovery: false, similarity: false, broadenCircle: false },
    });
    expect((await db.collection(PROFILE_COLLECTION).doc(UID).get()).exists).toBe(false);
    expect(await auditCount()).toBe(0);
  });

  test('persists a separate canonical card, preserves units and never modifies the member roster', async () => {
    const rosterRef = db.collection('members').doc(UID);
    await rosterRef.set({ marker: 'synthetic-unchanged-roster', role: 'unverified' });
    const original = await rosterRef.get();
    try {
      const input = save(1, 0, { profile: profile({ displayName: '  Synthetic Alias  ', pace: {
        unit: 'min/mile', fastSeconds: 483, slowSeconds: 579,
      } }) });
      const result = await store.saveOwn(UID, input);
      expect(result.revision).toBe(1);
      expect(result.profile.displayName).toBe('Synthetic Alias');
      expect(result.profile.pace).toEqual(input.profile.pace);
      expect(result.consent).toEqual(consent);
      expect(await store.readOwn(UID)).toEqual(result);
      expect((await rosterRef.get()).data()).toEqual(original.data());
      expect(await auditCount()).toBe(1);
      const audits = await db.collection('auditEvents').where('actorUid', '==', UID).get();
      expect(JSON.stringify(audits.docs.map((doc) => doc.data())))
        .not.toMatch(/Synthetic Alias|fastSeconds|first_10k|coffee/);
    } finally {
      await rosterRef.delete();
    }
  });

  test('same-command parallel requests apply once, including audit', async () => {
    const command = save(2);
    const results = await Promise.all(Array.from({ length: 8 }, () => store.saveOwn(UID, command)));
    expect(results.every((result) => result.revision === 1)).toBe(true);
    expect(await auditCount()).toBe(1);
    clock += 1000;
    expect(await store.saveOwn(UID, command)).toEqual(results[0]);
    expect((await db.collection(PROFILE_COLLECTION).doc(UID).get()).data().updatedAtMs).toBe(INITIAL_TIME);
  });

  test('concurrent different commands cannot overwrite one another at the same revision', async () => {
    const results = await Promise.allSettled([
      store.saveOwn(UID, save(3)),
      store.saveOwn(UID, save(4, 0, { profile: profile({ displayName: 'Different Synthetic Alias' }) })),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected').reason.code).toBe('aborted');
    expect((await store.readOwn(UID)).revision).toBe(1);
    expect(await auditCount()).toBe(1);
  });

  test('a changed command payload cannot reuse the same request ID', async () => {
    await store.saveOwn(UID, save(5));
    await expect(store.saveOwn(UID, save(5, 0, { profile: profile({ goals: ['social'] }) })))
      .rejects.toMatchObject({ code: 'aborted' });
    expect((await store.readOwn(UID)).profile.goals).toContain('first_10k');
    expect(await auditCount()).toBe(1);
  });

  test('withdrawal clears the card and consent; stale save/replay cannot resurrect it', async () => {
    await store.saveOwn(UID, save(6));
    expect((await db.collection(ENTRY_COLLECTION).doc(runnerEntryId(UID)).get()).data())
      .toEqual({ schemaVersion: 1, uid: UID });
    const command = { requestId: requestId(7), expectedRevision: 1 };
    const withdrawn = await store.withdrawOwn(UID, command);
    expect(withdrawn).toMatchObject({ revision: 2, adultConfirmed: false, profile: null, consent: {
      memberDiscovery: false, similarity: false, broadenCircle: false,
    } });
    const stored = (await db.collection(PROFILE_COLLECTION).doc(UID).get()).data();
    expect(stored.discoverable).toBe(false);
    expect((await db.collection(ENTRY_COLLECTION).doc(runnerEntryId(UID)).get()).exists).toBe(false);
    expect(JSON.stringify(stored)).not.toMatch(/Synthetic Runner|first_10k|coffee/);
    expect(await store.withdrawOwn(UID, command)).toEqual(withdrawn);
    await expect(store.saveOwn(UID, save(6))).rejects.toMatchObject({ code: 'aborted' });
    await expect(store.saveOwn(UID, save(8, 1))).rejects.toMatchObject({ code: 'aborted' });
    expect(await store.readOwn(UID)).toEqual(withdrawn);
    expect(await auditCount()).toBe(2);
  });

  test('new explicit opt-in can publish after withdrawal using the current revision', async () => {
    await store.withdrawOwn(UID, { requestId: requestId(9), expectedRevision: 0 });
    expect((await store.saveOwn(UID, save(10, 1))).revision).toBe(2);
    expect((await db.collection(PROFILE_COLLECTION).doc(UID).get()).data().discoverable).toBe(true);
  });

  test('a concurrent save and withdrawal have one winner; accepted withdrawal cannot be undone by stale retry', async () => {
    await store.saveOwn(UID, save(20));
    const edit = save(21, 1, { profile: profile({ goals: ['social'] }) });
    const removal = { requestId: requestId(22), expectedRevision: 1 };
    const [saved, withdrawn] = await Promise.allSettled([
      store.saveOwn(UID, edit), store.withdrawOwn(UID, removal),
    ]);
    expect([saved, withdrawn].filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect([saved, withdrawn].find((result) => result.status === 'rejected').reason.code).toBe('aborted');
    // If the edit won, withdrawal must report a conflict, not pretend success.
    // A new withdrawal against the refreshed revision finishes that intent.
    if (withdrawn.status === 'rejected') {
      await store.withdrawOwn(UID, { requestId: requestId(23), expectedRevision: 2 });
    }
    await expect(store.saveOwn(UID, edit)).rejects.toMatchObject({ code: 'aborted' });
    expect(await store.readOwn(UID)).toMatchObject({
      adultConfirmed: false, profile: null, consent: {
        memberDiscovery: false, similarity: false, broadenCircle: false,
      },
    });
    expect(await auditCount()).toBe(withdrawn.status === 'fulfilled' ? 2 : 3);
  });

  test('authorization loss on a forced transaction retry prevents both writes', async () => {
    let attempt = 0;
    const retryingDb = {
      collection: db.collection.bind(db),
      runTransaction: (work) => db.runTransaction(async (transaction) => {
        attempt += 1;
        const result = await work(transaction);
        if (attempt === 1) {
          denyAdmission = true;
          // Simulate the SDK's retryable ABORTED result before its queued
          // writes commit; the second attempt must run admission again.
          const conflict = new Error('synthetic-transaction-conflict');
          conflict.code = 10;
          throw conflict;
        }
        return result;
      }),
    };
    const retryingStore = createRunnerProfileStore({ db: retryingDb, authorize, now: () => clock });
    await expect(retryingStore.saveOwn(UID, save(24))).rejects.toMatchObject({ code: 'permission-denied' });
    expect(attempt).toBe(2);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect((await db.collection(PROFILE_COLLECTION).doc(UID).get()).exists).toBe(false);
    expect(await auditCount()).toBe(0);
  });

  test('a private draft never becomes discoverable', async () => {
    await store.saveOwn(UID, save(11, 0, { consent: {
      memberDiscovery: false, similarity: false, broadenCircle: false,
    } }));
    expect((await db.collection(PROFILE_COLLECTION).doc(UID).get()).data().discoverable).toBe(false);
    expect((await db.collection(ENTRY_COLLECTION).doc(runnerEntryId(UID)).get()).exists).toBe(false);
  });

  test.each([
    { uid: OTHER },
    { memberEligible: true },
    { adultEligible: true },
    { searchableByOfficers: true },
    { expectedRevision: -1 },
    { expectedRevision: '0' },
    { expectedRevision: Number.MAX_SAFE_INTEGER },
    { expectedRevision: Number.MAX_SAFE_INTEGER - 1 },
    { consentVersion: 0 },
    { consentVersion: '1' },
    { consentVersion: undefined },
    { adultConfirmed: false },
    { adultConfirmed: 'true' },
    { adultConfirmed: undefined },
    { requestId: 'not-a-uuid' },
    { consent: { memberDiscovery: false, similarity: true, broadenCircle: false } },
    { profile: profile({ email: 'synthetic@example.test' }) },
  ])('rejects forged or invalid request case %# before admission or writes', async (overrides) => {
    await expect(store.saveOwn(UID, save(12, 0, overrides))).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(authorize).not.toHaveBeenCalled();
    expect((await db.collection(PROFILE_COLLECTION).doc(UID).get()).exists).toBe(false);
    expect(await auditCount()).toBe(0);
  });

  test('requires fresh trusted admission even for an idempotent retry', async () => {
    await store.saveOwn(UID, save(13));
    denyAdmission = true;
    await expect(store.saveOwn(UID, save(13))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(store.readOwn(UID)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await auditCount()).toBe(1);
  });

  test('never treats truthy nonboolean admission as authority', async () => {
    authorize.mockResolvedValue('true');
    await expect(store.saveOwn(UID, save(14))).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await auditCount()).toBe(0);
  });

  test('denies other subjects; a request cannot redirect the server-selected owner', async () => {
    await store.saveOwn(UID, save(15));
    await expect(store.readOwn(OTHER)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(store.saveOwn(OTHER, save(16))).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await db.collection(PROFILE_COLLECTION).doc(OTHER).get()).exists).toBe(false);
  });

  test('validates stored state and clock monotonicity without repairing it', async () => {
    await store.saveOwn(UID, save(17));
    clock -= 1;
    await expect(store.saveOwn(UID, save(18, 1))).rejects.toMatchObject({ code: 'unavailable' });
    clock = INITIAL_TIME;
    await db.collection(PROFILE_COLLECTION).doc(UID).update({ discoverable: false });
    await expect(store.readOwn(UID)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(store.saveOwn(UID, save(18, 1))).rejects.toMatchObject({ code: 'unavailable' });
    expect(await auditCount()).toBe(1);
  });

  test('provider/admission errors are fixed and never echo private data', async () => {
    authorize.mockRejectedValue(new Error('synthetic-private-provider-canary'));
    await expect(store.readOwn(UID)).rejects.toMatchObject({
      code: 'unavailable', message: 'Runner connection service is unavailable.',
    });
  });

  test('audit failure aborts the profile write, rather than persisting an unaudited opt-in', async () => {
    const failingDb = {
      collection: db.collection.bind(db),
      runTransaction: (work) => db.runTransaction((transaction) => work({
        get: transaction.get.bind(transaction),
        set: transaction.set.bind(transaction),
        create: () => { throw new Error('synthetic-audit-failure'); },
      })),
    };
    const failingStore = createRunnerProfileStore({ db: failingDb, authorize, now: () => clock });
    await expect(failingStore.saveOwn(UID, save(19))).rejects.toMatchObject({ code: 'unavailable' });
    expect((await db.collection(PROFILE_COLLECTION).doc(UID).get()).exists).toBe(false);
    expect((await db.collection(ENTRY_COLLECTION).doc(runnerEntryId(UID)).get()).exists).toBe(false);
    expect(await auditCount()).toBe(0);
  });

  test('uncertain post-commit response can be recovered with the identical command', async () => {
    const lostResponseDb = {
      collection: db.collection.bind(db),
      runTransaction: async (work) => {
        await db.runTransaction(work);
        throw new Error('synthetic-response-lost-after-commit');
      },
    };
    const uncertainStore = createRunnerProfileStore({ db: lostResponseDb, authorize, now: () => clock });
    const command = save(20);
    await expect(uncertainStore.saveOwn(UID, command)).rejects.toMatchObject({ code: 'unavailable' });
    expect((await store.saveOwn(UID, command)).revision).toBe(1);
    expect(await auditCount()).toBe(1);
  });
});
