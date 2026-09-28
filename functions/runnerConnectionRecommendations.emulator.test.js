'use strict';

const admin = require('firebase-admin');
const { createRunnerConnectionCallables, MEMBERSHIP_COLLECTION, accountRateKey } = require('./runnerConnectionService');
const { createRunnerProfileStore, PROFILE_COLLECTION } = require('./runnerConnectionProfiles');
const { createRunnerRecommendationStore, readExclusionRequest } = require('./runnerConnectionRecommendations');
const { createMembershipAuthority, applyMembershipAuthorityCommand } = require('./membershipAuthority');
const { profile } = require('./testSupport/runnerConnectionsFixtures');
const {
  ENTRY_COLLECTION, WINDOW_COLLECTION, EXCLUSION_COLLECTION, DAY_MS,
  runnerEntryId, suggestionRef, exclusionId, digest,
} = require('./runnerConnectionReferences');

jest.setTimeout(30000);
const isolated = /^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')
  && /^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')
  && process.env.GCLOUD_PROJECT === 'demo-functions-test';
if (process.env.REQUIRE_RUNNER_CONNECTION_RECOMMENDATIONS_EMULATOR === '1' && !isolated) {
  throw new Error('Runner recommendations require isolated demo Auth and Firestore emulators.');
}
const describeEmulator = isolated ? describe : describe.skip;
const UIDS = Array.from({ length: 52 }, (_, index) => `synthetic-suggestions-${index}`);
const UID = UIDS[0];
const OTHER = UIDS[1];
const requestId = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const cards = (result) => [...result.similar, ...result.broaden];
const consent = { memberDiscovery: true, similarity: true, broadenCircle: true };

// Context is synthetic and trusted, not HTTP middleware/token verification.
// Profile fixtures use storage-only admission; recommendations/exclusions use
// the real service's current Auth and canonical membership checks below.
describeEmulator('bounded recommendations and directed exclusions', () => {
  let app;
  let db;
  let auth;
  let clock;
  let service;
  let profiles;
  const touchedPairs = new Set();
  const touchedUsers = new Set();
  const context = (uid = UID) => ({
    app: { appId: 'synthetic-app' },
    auth: { uid, token: { email_verified: true, auth_time: Math.floor(clock / 1000) } },
    rawRequest: { res: { setHeader: jest.fn() } },
  });
  const memberRef = (uid) => db.collection(MEMBERSHIP_COLLECTION).doc(`member-${uid}`);
  const windowRef = (uid = UID) => db.collection(WINDOW_COLLECTION).doc(uid);
  const pairRef = (actor, target) => {
    const id = exclusionId(actor, target);
    touchedPairs.add(id);
    return db.collection(EXCLUSION_COLLECTION).doc(id);
  };

  async function cleanup() {
    for (const uid of touchedUsers) {
      try { await auth.deleteUser(uid); } catch (failure) {
        if (failure.code !== 'auth/user-not-found') throw failure;
      }
      const seen = await windowRef(uid).collection('seen').get();
      const audits = await db.collection('auditEvents').where('actorUid', '==', uid).get();
      await Promise.all([...seen.docs, ...audits.docs].map((doc) => doc.ref.delete()));
      await Promise.all([
        db.collection(PROFILE_COLLECTION).doc(uid).delete(), memberRef(uid).delete(),
        db.collection(ENTRY_COLLECTION).doc(runnerEntryId(uid)).delete(), windowRef(uid).delete(),
        ...['read', 'save', 'withdraw', 'recommend', 'exclude', 'exclusionRead'].map((operation) =>
          db.collection('ratelimits').doc(`runner_connection_${operation}__${accountRateKey(uid)}`).delete()),
      ]);
    }
    await Promise.all([...touchedPairs].map((id) => db.collection(EXCLUSION_COLLECTION).doc(id).delete()));
    touchedPairs.clear();
    touchedUsers.clear();
  }

  beforeAll(() => {
    app = admin.initializeApp({ projectId: 'demo-functions-test' });
    db = app.firestore();
    auth = app.auth();
  });
  beforeEach(() => {
    clock = Date.now();
    profiles = createRunnerProfileStore({ db, now: () => clock, authorize: async () => true });
    service = createRunnerConnectionCallables({ enabled: true, db, auth, now: () => clock });
  });
  afterEach(async () => { jest.restoreAllMocks(); await cleanup(); });
  afterAll(async () => { await app.delete(); });

  async function seed(count = 2) {
    for (let index = 0; index < count; index += 1) {
      const uid = UIDS[index];
      touchedUsers.add(uid);
      await auth.createUser({ uid, email: `suggestion-${index}@example.test`, emailVerified: true });
      const created = createMembershipAuthority({
        membershipAuthoritySchemaVersion: 1, membershipId: `member-${uid}`, commandId: 'synthetic-create',
      });
      const linked = applyMembershipAuthorityCommand(created, {
        membershipAuthoritySchemaVersion: 1, commandType: 'associate_account',
        commandId: 'synthetic-link', expectedRevision: 1, uid,
      });
      await memberRef(uid).set(applyMembershipAuthorityCommand(linked, {
        membershipAuthoritySchemaVersion: 1, commandType: 'record_term_decision',
        commandId: 'synthetic-term', expectedRevision: 2, termRevision: 1, termState: 'approved',
        termId: 'synthetic-term-id', startsAtMs: clock - 60000, endsAtMs: clock + 3 * DAY_MS,
        planRef: 'synthetic-plan', evidenceRef: 'synthetic-evidence', policyVersion: 'synthetic-policy',
      }));
      await profiles.saveOwn(uid, {
        requestId: requestId(1), expectedRevision: 0, adultConfirmed: true, consentVersion: 1,
        consent, profile: profile({ displayName: `Synthetic Runner ${index}`, experience: index === 7 ? 'experienced' : 'beginner' }),
      });
    }
  }
  const recommend = (uid = UID, chosenService = service) => chosenService.getMyRunnerConnectionRecommendations.run({}, context(uid));
  async function exclude(actor, target, index = 2, expectedRevision = 0, overrides = {}) {
    pairRef(actor, target);
    return service.setMyRunnerConnectionExclusion.run({
      requestId: requestId(index), entryRef: suggestionRef(actor, target), expectedRevision,
      hidden: true, blocked: false, ...overrides,
    }, context(actor));
  }
  async function expire(uid) {
    const record = (await memberRef(uid).get()).data();
    await memberRef(uid).set({ ...record, term: { ...record.term, endsAtMs: clock } });
  }

  test('closed output gives four ordinary and one mutually opted-in broadening card without identifiers or contacts', async () => {
    await seed(8);
    const result = await recommend();
    expect(result).toMatchObject({ rankerVersion: 1, status: 'ready' });
    expect(result.similar).toHaveLength(4);
    expect(result.broaden).toHaveLength(1);
    expect(result.broaden[0].experience).toBe('experienced');
    expect(result.windowEndsAtMs).toBe((Math.floor(clock / DAY_MS) + 1) * DAY_MS);
    expect(JSON.stringify(result)).not.toMatch(/synthetic-suggestions|@example|memberEligible|experiencePreferences|adultConfirmed|similarity|schemaVersion/);
    const stored = (await windowRef().get()).data();
    expect(Object.keys(stored).sort()).toEqual(['createdAtMs', 'day', 'schemaVersion', 'uids']);
    expect(stored.uids).toHaveLength(5);
    const audits = await db.collection('auditEvents').where('actorUid', '==', UID).where('action', '==', 'runner_connection.window_selected').get();
    expect(audits.size).toBe(1);
    expect(JSON.stringify(audits.docs[0].data())).not.toMatch(/displayName|entryRef|pace|uids/);
  });

  test('no profile and sparse pool are honest, with no default enrollment', async () => {
    await seed(1);
    expect(cards(await recommend())).toEqual([]);
    await profiles.withdrawOwn(UID, { requestId: requestId(2), expectedRevision: 1 });
    expect(await recommend()).toMatchObject({ status: 'profile_required', similar: [], broaden: [] });
  });

  test.each(['withdrawn', 'disabled', 'deleted', 'unverified', 'expired', 'missing-membership', 'malformed-profile', 'invalid-index', 'reverse-block'])('%s candidate is withheld even when a locator exists', async (state) => {
    await seed();
    if (state === 'withdrawn') {
      await profiles.withdrawOwn(OTHER, { requestId: requestId(2), expectedRevision: 1 });
      await db.collection(ENTRY_COLLECTION).doc(runnerEntryId(OTHER)).set({ schemaVersion: 1, uid: OTHER });
    }
    if (state === 'disabled') await auth.updateUser(OTHER, { disabled: true });
    if (state === 'deleted') await auth.deleteUser(OTHER);
    if (state === 'unverified') await auth.updateUser(OTHER, { emailVerified: false });
    if (state === 'expired') await expire(OTHER);
    if (state === 'missing-membership') await memberRef(OTHER).delete();
    if (state === 'malformed-profile') await db.collection(PROFILE_COLLECTION).doc(OTHER).update({ adultConfirmed: false });
    if (state === 'invalid-index') await db.collection(ENTRY_COLLECTION).doc(runnerEntryId(OTHER)).update({ uid: 'synthetic-forged' });
    if (state === 'reverse-block') {
      await recommend(OTHER);
      await exclude(OTHER, UID, 2, 0, { blocked: true });
    }
    expect(cards(await recommend())).toEqual([]);
  });

  test.each(['expired', 'missing-membership', 'disabled', 'revoked'])('%s actor cannot retrieve cached suggestions', async (state) => {
    await seed();
    await recommend();
    const ctx = context();
    if (state === 'expired') await expire(UID);
    if (state === 'missing-membership') await memberRef(UID).delete();
    if (state === 'disabled') await auth.updateUser(UID, { disabled: true });
    if (state === 'revoked') {
      await auth.revokeRefreshTokens(UID);
      ctx.auth.token.auth_time = Math.floor(Date.parse((await auth.getUser(UID)).tokensValidAfterTime) / 1000) - 1;
    }
    await expect(service.getMyRunnerConnectionRecommendations.run({}, ctx)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  test('refreshes and profile edits reuse the same references; hiding never fills freed slots', async () => {
    await seed(8);
    const initial = cards(await recommend()).map((card) => card.entryRef);
    const selected = (await windowRef().get()).data().uids;
    await exclude(UID, selected[0]);
    await profiles.saveOwn(UID, {
      requestId: requestId(3), expectedRevision: 1, adultConfirmed: true, consentVersion: 1,
      consent, profile: profile({ interests: ['coffee'], goals: ['social'] }),
    });
    for (let index = 0; index < 3; index += 1) {
      const refs = cards(await recommend()).map((card) => card.entryRef);
      expect(refs).toHaveLength(4);
      expect(refs.every((ref) => initial.includes(ref))).toBe(true);
      expect(refs).not.toContain(suggestionRef(UID, selected[0]));
    }
    expect((await windowRef().get()).data().uids).toEqual(selected);
  });

  test('concurrent first requests commit one window and the same card set', async () => {
    await seed(8);
    const results = await Promise.all([recommend(), recommend()]);
    expect(results[0]).toEqual(results[1]);
    expect((await db.collection('auditEvents').where('actorUid', '==', UID).where('action', '==', 'runner_connection.window_selected').get()).size).toBe(1);
  });

  test('missing window cannot be silently rebuilt after its daily receipt committed', async () => {
    await seed();
    await recommend();
    await windowRef().delete();
    await expect(recommend()).rejects.toMatchObject({ code: 'unavailable' });
  });

  test('hide is one-way, block is mutual, and undo never removes the other person’s block', async () => {
    await seed();
    await recommend();
    await recommend(OTHER);
    await exclude(UID, OTHER);
    expect(cards(await recommend())).toHaveLength(0);
    expect(cards(await recommend(OTHER))).toHaveLength(1);
    await exclude(UID, OTHER, 3, 1, { hidden: false, blocked: true });
    expect(cards(await recommend(OTHER))).toHaveLength(0);
    await exclude(OTHER, UID, 2, 0, { hidden: false, blocked: true });
    await exclude(UID, OTHER, 4, 2, { hidden: false, blocked: false });
    expect(cards(await recommend())).toHaveLength(0);
    const own = await service.getMyRunnerConnectionExclusion.run({ entryRef: suggestionRef(UID, OTHER) }, context());
    expect(own).toEqual({ revision: 3, hidden: false, blocked: false });
  });

  test('exclusion retries are idempotent and conflicting commands/reused IDs cannot overwrite newer intent', async () => {
    await seed();
    await recommend();
    const first = await exclude(UID, OTHER);
    expect(await exclude(UID, OTHER)).toEqual(first);
    await expect(exclude(UID, OTHER, 2, 0, { blocked: true })).rejects.toMatchObject({ code: 'aborted' });
    const results = await Promise.allSettled([
      exclude(UID, OTHER, 3, 1, { hidden: false }), exclude(UID, OTHER, 4, 1, { blocked: true }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected').reason.code).toBe('aborted');
    await expect(exclude(UID, OTHER)).rejects.toMatchObject({ code: 'aborted' });
    expect((await db.collection('auditEvents').where('actorUid', '==', UID).where('action', '==', 'runner_connection.exclusion_set').get()).size).toBe(2);
  });

  test('privacy controls remain usable after membership expiry, target withdrawal and day rotation', async () => {
    await seed();
    await recommend();
    await expire(UID);
    await profiles.withdrawOwn(OTHER, { requestId: requestId(2), expectedRevision: 1 });
    clock += DAY_MS;
    expect(await exclude(UID, OTHER)).toEqual({ revision: 1, hidden: true, blocked: false });
    expect(await service.getMyRunnerConnectionExclusion.run({ entryRef: suggestionRef(UID, OTHER) }, context()))
      .toEqual({ revision: 1, hidden: true, blocked: false });
  });

  test('exclusions require this requester’s issued receipt, never an arbitrary or another viewer’s target', async () => {
    await seed();
    await expect(exclude(UID, OTHER)).rejects.toMatchObject({ code: 'permission-denied' });
    await recommend(OTHER);
    await expect(service.getMyRunnerConnectionExclusion.run({ entryRef: suggestionRef(OTHER, UID) }, context()))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  test.each(['withdraw', 'expire', 'disable', 'block', 'actor-withdraw', 'actor-expire'])('%s between selection and delivery is rechecked', async (change) => {
    await seed();
    if (change === 'block') await recommend(OTHER);
    let transactions = 0;
    const wrappedDb = {
      collection: db.collection.bind(db),
      runTransaction: async (work) => {
        const result = await db.runTransaction(work);
        transactions += 1;
        if (transactions === 1) {
          if (change === 'withdraw') await profiles.withdrawOwn(OTHER, { requestId: requestId(2), expectedRevision: 1 });
          if (change === 'expire') await expire(OTHER);
          if (change === 'disable') await auth.updateUser(OTHER, { disabled: true });
          if (change === 'block') await exclude(OTHER, UID, 2, 0, { blocked: true });
          if (change === 'actor-withdraw') await profiles.withdrawOwn(UID, { requestId: requestId(2), expectedRevision: 1 });
          if (change === 'actor-expire') await expire(UID);
        }
        return result;
      },
    };
    const fresh = createRunnerConnectionCallables({ enabled: true, db: wrappedDb, auth, now: () => clock });
    if (change === 'actor-expire') await expect(recommend(UID, fresh)).rejects.toMatchObject({ code: 'permission-denied' });
    else expect(cards(await recommend(UID, fresh))).toEqual([]);
  });

  test('recommendation budget is six per hour and cannot exhaust hide/block or withdrawal', async () => {
    await seed();
    for (let attempt = 0; attempt < 6; attempt += 1) await recommend();
    const lookup = jest.spyOn(auth, 'getUser');
    await expect(recommend()).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(lookup).not.toHaveBeenCalled();
    await exclude(UID, OTHER);
    await expect(service.withdrawMyRunnerConnectionProfile.run({ requestId: requestId(3), expectedRevision: 1 }, context()))
      .resolves.toMatchObject({ profile: null });
  });

  test('a new UTC day creates a new bounded window; old receipts still permit exclusion', async () => {
    await seed(8);
    await recommend();
    const old = (await windowRef().get()).data();
    clock += DAY_MS;
    expect(cards(await recommend()).length).toBeLessThanOrEqual(5);
    expect((await windowRef().get()).data().day).toBe(old.day + 1);
    await exclude(UID, old.uids[0]);
    expect((await db.collection('auditEvents').where('actorUid', '==', UID).where('action', '==', 'runner_connection.window_selected').get()).size).toBe(2);
  });

  test('index selection inspects at most 48 entries and final delivery joins at most five candidates', async () => {
    await seed(52);
    const indexSizes = [];
    const joinedSizes = [];
    const measuredDb = {
      collection: db.collection.bind(db),
      runTransaction: (work) => db.runTransaction((transaction) => work({
        get: async (ref) => {
          const snapshot = await transaction.get(ref);
          if (snapshot.docs && snapshot.docs[0]?.ref.parent.id === ENTRY_COLLECTION) indexSizes.push(snapshot.size);
          return snapshot;
        },
        getAll: (...refs) => { joinedSizes.push(refs.length); return transaction.getAll(...refs); },
        set: transaction.set.bind(transaction), create: transaction.create.bind(transaction),
      })),
    };
    const measured = createRunnerConnectionCallables({ enabled: true, db: measuredDb, auth, now: () => clock });
    expect(cards(await recommend(UID, measured)).length).toBeLessThanOrEqual(5);
    expect(indexSizes.reduce((sum, size) => sum + size, 0)).toBe(48);
    expect(joinedSizes).toHaveLength(2);
    expect(joinedSizes[0]).toBeLessThanOrEqual(48 * 3);
    expect(joinedSizes[1]).toBeLessThanOrEqual(5 * 3);
  });

  test('provider failure returns fixed unavailability, never partial cards or private error detail', async () => {
    await seed();
    await recommend();
    const original = auth.getUser.bind(auth);
    jest.spyOn(auth, 'getUser').mockImplementation((uid) => uid === OTHER
      ? Promise.reject(new Error('synthetic-private-provider-canary')) : original(uid));
    await expect(recommend()).rejects.toMatchObject({ code: 'unavailable', message: 'Runner connection service is unavailable.' });
  });

  test('closed requests cannot set UID, cursors, bounds, age, or source enablement', async () => {
    const lookup = jest.spyOn(auth, 'getUser');
    for (const input of [{ uid: OTHER }, { cursor: 'synthetic' }, { limit: 500 }, { adultConfirmed: true }, { enabled: true }]) {
      await expect(service.getMyRunnerConnectionRecommendations.run(input, context())).rejects.toMatchObject({ code: 'invalid-argument' });
    }
    expect(lookup).not.toHaveBeenCalled();
    const input = { requestId: requestId(1), entryRef: suggestionRef(UID, OTHER), expectedRevision: 0, hidden: true, blocked: false };
    const frozen = readExclusionRequest(input);
    input.blocked = true;
    expect(frozen.blocked).toBe(false);
    expect(Object.isFrozen(frozen)).toBe(true);
    for (const extra of [{ expectedRevision: -0 }, { expectedRevision: Number.MAX_SAFE_INTEGER }, { uid: OTHER }, { blocked: 'true' }]) {
      expect(() => readExclusionRequest({ ...input, ...extra })).toThrow();
    }
    expect(() => createRunnerRecommendationStore({ db })).toThrow();
  });

  test('a corrupted exclusion receipt fails closed and does not overwrite the saved choice', async () => {
    await seed();
    await recommend();
    await exclude(UID, OTHER);
    const receipt = db.collection('auditEvents').doc(`runner_exclusion_${digest(UID, requestId(2))}`);
    await receipt.update({ expectedRevision: 10 });
    await expect(exclude(UID, OTHER)).rejects.toMatchObject({ code: 'unavailable' });
    expect((await pairRef(UID, OTHER).get()).data().revision).toBe(1);
  });

  test('private save atomically removes a previously published locator', async () => {
    await seed();
    await profiles.saveOwn(OTHER, {
      requestId: requestId(2), expectedRevision: 1, adultConfirmed: true, consentVersion: 1,
      consent: { memberDiscovery: false, similarity: false, broadenCircle: false }, profile: profile(),
    });
    expect((await db.collection(ENTRY_COLLECTION).doc(runnerEntryId(OTHER)).get()).exists).toBe(false);
    expect(cards(await recommend())).toEqual([]);
  });

  test('audit failure rolls back exclusion; uncertain committed response is recovered with the same command', async () => {
    await seed();
    await recommend();
    const input = { requestId: requestId(2), entryRef: suggestionRef(UID, OTHER), expectedRevision: 0, hidden: true, blocked: false };
    const failingDb = {
      collection: db.collection.bind(db),
      runTransaction: (work) => db.runTransaction((transaction) => work({
        get: transaction.get.bind(transaction), set: transaction.set.bind(transaction),
        create: () => { throw new Error('synthetic-audit-failure'); },
      })),
    };
    const failing = createRunnerConnectionCallables({ enabled: true, db: failingDb, auth, now: () => clock });
    await expect(failing.setMyRunnerConnectionExclusion.run(input, context())).rejects.toMatchObject({ code: 'unavailable' });
    expect((await pairRef(UID, OTHER).get()).exists).toBe(false);
    const uncertainDb = {
      collection: db.collection.bind(db),
      runTransaction: async (work) => { await db.runTransaction(work); throw new Error('synthetic-response-lost'); },
    };
    const uncertain = createRunnerConnectionCallables({ enabled: true, db: uncertainDb, auth, now: () => clock });
    await expect(uncertain.setMyRunnerConnectionExclusion.run(input, context())).rejects.toMatchObject({ code: 'unavailable' });
    expect(await service.setMyRunnerConnectionExclusion.run(input, context())).toEqual({ revision: 1, hidden: true, blocked: false });
  });

  test('authorization is rerun on retry and a disabled actor cannot commit a queued exclusion', async () => {
    await seed();
    await recommend();
    let attempts = 0;
    const retryDb = {
      collection: db.collection.bind(db),
      runTransaction: (work) => db.runTransaction(async (transaction) => {
        attempts += 1;
        const result = await work(transaction);
        if (attempts === 1) {
          await auth.updateUser(UID, { disabled: true });
          const conflict = new Error('synthetic-transaction-conflict');
          conflict.code = 10;
          throw conflict;
        }
        return result;
      }),
    };
    const retry = createRunnerConnectionCallables({ enabled: true, db: retryDb, auth, now: () => clock });
    const input = { requestId: requestId(2), entryRef: suggestionRef(UID, OTHER), expectedRevision: 0, hidden: true, blocked: false };
    await expect(retry.setMyRunnerConnectionExclusion.run(input, context())).rejects.toMatchObject({ code: 'permission-denied' });
    expect(attempts).toBe(2);
    expect((await pairRef(UID, OTHER).get()).exists).toBe(false);
  });

  test('crossing UTC midnight between selection and delivery aborts instead of widening the window', async () => {
    await seed();
    let transactions = 0;
    const rolloverDb = {
      collection: db.collection.bind(db),
      runTransaction: async (work) => {
        const result = await db.runTransaction(work);
        transactions += 1;
        if (transactions === 1) clock = (Math.floor(clock / DAY_MS) + 1) * DAY_MS;
        return result;
      },
    };
    const rollover = createRunnerConnectionCallables({ enabled: true, db: rolloverDb, auth, now: () => clock });
    await expect(recommend(UID, rollover)).rejects.toMatchObject({ code: 'aborted' });
    expect(cards(await recommend())).toHaveLength(1);
  });
});
