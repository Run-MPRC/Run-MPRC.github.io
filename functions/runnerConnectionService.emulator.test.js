'use strict';

const admin = require('firebase-admin');
const { createRunnerConnectionCallables, MEMBERSHIP_COLLECTION, accountRateKey } = require('./runnerConnectionService');
const { PROFILE_COLLECTION } = require('./runnerConnectionProfiles');
const { ENTRY_COLLECTION, runnerEntryId } = require('./runnerConnectionReferences');
const { createMembershipAuthority, applyMembershipAuthorityCommand } = require('./membershipAuthority');
const { profile } = require('./testSupport/runnerConnectionsFixtures');

jest.setTimeout(30000);
const isolatedEmulators = /^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')
  && /^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')
  && process.env.GCLOUD_PROJECT === 'demo-functions-test';
if (process.env.REQUIRE_RUNNER_CONNECTION_SERVICE_EMULATOR === '1' && !isolatedEmulators) {
  throw new Error('Runner service tests require isolated Auth and Firestore demo emulators.');
}
const describeEmulator = isolatedEmulators ? describe : describe.skip;
const UID = 'synthetic-connection-service-owner';
const OTHER = 'synthetic-connection-service-other';
const MEMBERSHIP_IDS = ['synthetic-connection-member-one', 'synthetic-connection-member-two'];
const requestId = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const command = (index = 1, expectedRevision = 0) => ({
  requestId: requestId(index), expectedRevision, adultConfirmed: true, consentVersion: 1,
  profile: profile(), consent: { memberDiscovery: true, similarity: true, broadenCircle: false },
});

function membership(uid, id, now) {
  const created = createMembershipAuthority({
    membershipAuthoritySchemaVersion: 1, membershipId: id, commandId: 'synthetic-create',
  });
  const linked = applyMembershipAuthorityCommand(created, {
    membershipAuthoritySchemaVersion: 1, commandType: 'associate_account',
    commandId: 'synthetic-link', expectedRevision: 1, uid,
  });
  return applyMembershipAuthorityCommand(linked, {
    membershipAuthoritySchemaVersion: 1, commandType: 'record_term_decision',
    commandId: 'synthetic-term', expectedRevision: 2, termRevision: 1, termState: 'approved',
    termId: 'synthetic-term-id', startsAtMs: now - 60000, endsAtMs: now + 3600000,
    planRef: 'synthetic-plan', evidenceRef: 'synthetic-approved-evidence', policyVersion: 'synthetic-policy',
  });
}

// The real callable callback is exercised against real local Auth/Firestore.
// The supplied context stands in for SDK-verified token/App Check claims; this
// is not an HTTP token-verification or hosted App Check rehearsal.
describeEmulator('runner profile callable integration with local Auth and Firestore', () => {
  let app;
  let db;
  let auth;
  let clock;
  let service;
  let context;
  let getUser;

  async function cleanup() {
    for (const uid of [UID, OTHER]) {
      try { await auth.deleteUser(uid); } catch (failure) {
        if (failure.code !== 'auth/user-not-found') throw failure;
      }
      await db.collection(PROFILE_COLLECTION).doc(uid).delete();
      await db.collection(ENTRY_COLLECTION).doc(runnerEntryId(uid)).delete();
      await db.collection('members').doc(uid).delete();
      for (const operation of ['read', 'save', 'withdraw']) {
        await db.collection('ratelimits').doc(`runner_connection_${operation}__${accountRateKey(uid)}`).delete();
      }
      const audits = await db.collection('auditEvents').where('actorUid', '==', uid).get();
      await Promise.all(audits.docs.map((doc) => doc.ref.delete()));
    }
    for (const id of MEMBERSHIP_IDS) await db.collection(MEMBERSHIP_COLLECTION).doc(id).delete();
  }

  beforeAll(() => {
    app = admin.initializeApp({ projectId: 'demo-functions-test' });
    db = app.firestore();
    auth = app.auth();
  });
  beforeEach(async () => {
    await cleanup();
    await auth.createUser({ uid: UID, email: 'synthetic-connections@example.test', emailVerified: true });
    clock = Date.now();
    context = {
      app: { appId: 'synthetic-app' },
      auth: { uid: UID, token: { email_verified: true, auth_time: Math.floor(clock / 1000) } },
      rawRequest: { res: { setHeader: jest.fn() } },
    };
    getUser = jest.spyOn(auth, 'getUser');
    service = createRunnerConnectionCallables({ enabled: true, db, auth, now: () => clock });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await cleanup(); await app.delete(); });

  async function admit(uid = UID, id = MEMBERSHIP_IDS[0]) {
    const record = membership(uid, id, clock);
    await db.collection(MEMBERSHIP_COLLECTION).doc(id).set(record);
    return record;
  }
  async function auditCount() {
    return (await db.collection('auditEvents').where('actorUid', '==', UID).get()).size;
  }

  test('a current canonical member can save/read/withdraw without altering membership or claims', async () => {
    const record = await admit();
    const originalAccount = await auth.getUser(UID);
    expect(originalAccount.disabled).toBe(false);
    expect(originalAccount.emailVerified).toBe(true);
    // A newly created, never-revoked emulator account has no revocation time;
    // this is valid SDK state, not grounds for denying every new account.
    expect(originalAccount.tokensValidAfterTime).toBeUndefined();
    const originalClaims = originalAccount.customClaims;
    const saved = await service.saveMyRunnerConnectionProfile.run(command(), context);
    expect(saved).toMatchObject({ adultConfirmed: true, revision: 1, profile: { displayName: 'Synthetic Runner' } });
    expect(await service.getMyRunnerConnectionProfile.run({}, context)).toEqual(saved);
    const withdrawn = await service.withdrawMyRunnerConnectionProfile.run({ requestId: requestId(2), expectedRevision: 1 }, context);
    expect(withdrawn).toMatchObject({ adultConfirmed: false, revision: 2, profile: null });
    expect((await db.collection(MEMBERSHIP_COLLECTION).doc(MEMBERSHIP_IDS[0]).get()).data()).toEqual(record);
    expect((await auth.getUser(UID)).customClaims).toEqual(originalClaims);
    expect(context.rawRequest.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store, max-age=0');
    expect(await auditCount()).toBe(2);
  });

  test.each(['member', 'admin'])('a %s claim and mirrored profile do not replace canonical membership', async (role) => {
    await auth.setCustomUserClaims(UID, { role });
    context.auth.token.role = role;
    await db.collection('members').doc(UID).set({ role, emailVerified: true, membershipActive: true });
    await expect(service.saveMyRunnerConnectionProfile.run(command(), context)).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await db.collection(PROFILE_COLLECTION).doc(UID).get()).exists).toBe(false);
    expect(await auditCount()).toBe(0);
  });

  test('another account association cannot admit the caller', async () => {
    await admit(OTHER);
    await expect(service.saveMyRunnerConnectionProfile.run(command(), context)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  test.each(['future', 'expired', 'suspended', 'ended', 'pending', 'malformed', 'id-mismatch', 'duplicate'])('%s membership fails closed', async (state) => {
    const record = await admit();
    let replacement = record;
    if (state === 'future') replacement = { ...record, term: { ...record.term, startsAtMs: clock + 1 } };
    if (state === 'expired') replacement = { ...record, term: { ...record.term, endsAtMs: clock } };
    if (state === 'suspended' || state === 'ended') replacement = { ...record, term: { ...record.term, state } };
    if (state === 'pending') replacement = applyMembershipAuthorityCommand(createMembershipAuthority({
      membershipAuthoritySchemaVersion: 1, membershipId: MEMBERSHIP_IDS[0], commandId: 'synthetic-create',
    }), { membershipAuthoritySchemaVersion: 1, commandType: 'associate_account', commandId: 'synthetic-link', expectedRevision: 1, uid: UID });
    if (state === 'malformed') replacement = { ...record, approvedByBrowser: true };
    if (state === 'id-mismatch') replacement = { ...record, membershipId: MEMBERSHIP_IDS[1] };
    if (state === 'duplicate') await admit(UID, MEMBERSHIP_IDS[1]);
    await db.collection(MEMBERSHIP_COLLECTION).doc(MEMBERSHIP_IDS[0]).set(replacement);
    await expect(service.saveMyRunnerConnectionProfile.run(command(), context)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await auditCount()).toBe(0);
  });

  test('term expiry rejects exact save replay but retains owner read and withdrawal', async () => {
    const record = await admit();
    await service.saveMyRunnerConnectionProfile.run(command(), context);
    clock = record.term.endsAtMs;
    await expect(service.saveMyRunnerConnectionProfile.run(command(), context)).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await service.getMyRunnerConnectionProfile.run({}, context)).revision).toBe(1);
    expect(await service.withdrawMyRunnerConnectionProfile.run({ requestId: requestId(2), expectedRevision: 1 }, context))
      .toMatchObject({ adultConfirmed: false, profile: null, revision: 2 });
  });

  test('membership time is checked after the bounded transaction query returns', async () => {
    const record = await admit();
    const delayedDb = {
      collection: db.collection.bind(db),
      runTransaction: (work) => db.runTransaction((transaction) => work({
        get: async (ref) => {
          const result = await transaction.get(ref);
          if (typeof ref.where === 'function') clock = record.term.endsAtMs;
          return result;
        },
        set: transaction.set.bind(transaction), create: transaction.create.bind(transaction),
      })),
    };
    const delayedService = createRunnerConnectionCallables({ enabled: true, db: delayedDb, auth, now: () => clock });
    await expect(delayedService.saveMyRunnerConnectionProfile.run(command(), context)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await auditCount()).toBe(0);
  });

  test.each([null, '', 'not-a-time', 123])('malformed present revocation metadata %p denies access', async (tokensValidAfterTime) => {
    const user = await auth.getUser(UID);
    getUser.mockResolvedValue({ uid: user.uid, disabled: false, emailVerified: true, tokensValidAfterTime });
    await expect(service.getMyRunnerConnectionProfile.run({}, context)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  test.each(['disabled', 'deleted', 'unverified', 'revoked'])('fresh %s Auth state denies saved-profile access', async (state) => {
    await admit();
    await service.saveMyRunnerConnectionProfile.run(command(), context);
    if (state === 'disabled') await auth.updateUser(UID, { disabled: true });
    if (state === 'deleted') await auth.deleteUser(UID);
    if (state === 'unverified') await auth.updateUser(UID, { emailVerified: false });
    if (state === 'revoked') {
      await auth.revokeRefreshTokens(UID);
      const fresh = await auth.getUser(UID);
      context.auth.token.auth_time = Math.floor(Date.parse(fresh.tokensValidAfterTime) / 1000) - 1;
    }
    await expect(service.getMyRunnerConnectionProfile.run({}, context)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(service.saveMyRunnerConnectionProfile.run(command(), context)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await auditCount()).toBe(1);
  });

  test.each(['missing-app', 'missing-auth', 'unverified-token', 'future-auth-time', 'bad-uid', 'missing-no-store-response'])('%s fails before Auth or profile access', async (state) => {
    if (state === 'missing-app') delete context.app;
    if (state === 'missing-auth') delete context.auth;
    if (state === 'unverified-token') context.auth.token.email_verified = false;
    if (state === 'future-auth-time') context.auth.token.auth_time += 100;
    if (state === 'bad-uid') context.auth.uid = '../synthetic-other';
    if (state === 'missing-no-store-response') delete context.rawRequest;
    await expect(service.getMyRunnerConnectionProfile.run({}, context)).rejects.toBeDefined();
    expect(getUser).not.toHaveBeenCalled();
    expect((await db.collection('ratelimits').doc(`runner_connection_read__${accountRateKey(UID)}`).get()).exists).toBe(false);
  });

  test('a request cannot specify a target; invalid input consumes no meter or Auth read', async () => {
    await expect(service.saveMyRunnerConnectionProfile.run({ ...command(), uid: OTHER }, context)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(service.getMyRunnerConnectionProfile.run({ uid: OTHER }, context)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(getUser).not.toHaveBeenCalled();
    expect((await db.collection('ratelimits').doc(`runner_connection_save__${accountRateKey(UID)}`).get()).exists).toBe(false);
  });

  test('missing/false adult confirmation never reaches membership checks', async () => {
    await admit();
    await expect(service.saveMyRunnerConnectionProfile.run({ ...command(), adultConfirmed: false }, context)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(getUser).not.toHaveBeenCalled();
    expect(await auditCount()).toBe(0);
  });

  test('owner-only lookup cannot read another saved profile', async () => {
    await admit();
    await service.saveMyRunnerConnectionProfile.run(command(), context);
    await auth.createUser({ uid: OTHER, email: 'synthetic-connections-other@example.test', emailVerified: true });
    const otherContext = { ...context, auth: { uid: OTHER, token: { email_verified: true, auth_time: Math.floor(Date.now() / 1000) } } };
    clock = Date.now();
    expect(await service.getMyRunnerConnectionProfile.run({}, otherContext)).toMatchObject({ revision: 0, profile: null });
  });

  test('retries consume a bounded rate budget without blocking the separate withdrawal bucket', async () => {
    await admit();
    for (let attempt = 0; attempt < 12; attempt += 1) await service.saveMyRunnerConnectionProfile.run(command(), context);
    await expect(service.saveMyRunnerConnectionProfile.run(command(), context)).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(await auditCount()).toBe(1);
    expect(await service.withdrawMyRunnerConnectionProfile.run({ requestId: requestId(2), expectedRevision: 1 }, context))
      .toMatchObject({ profile: null, adultConfirmed: false });
    const bucket = (await db.collection('ratelimits').doc(`runner_connection_save__${accountRateKey(UID)}`).get()).data();
    expect(bucket.count).toBe(12);
    expect(JSON.stringify(bucket)).not.toContain(UID);
  });

  test('Auth outage reports fixed unavailability without changing a profile', async () => {
    await admit();
    getUser.mockRejectedValue(new Error('synthetic-private-provider-canary'));
    await expect(service.saveMyRunnerConnectionProfile.run(command(), context)).rejects.toMatchObject({ code: 'unavailable', message: 'Runner connection service is unavailable.' });
    expect(await auditCount()).toBe(0);
  });

  test('reads stop at their per-account budget before another Auth lookup', async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) await service.getMyRunnerConnectionProfile.run({}, context);
    const reads = getUser.mock.calls.length;
    await expect(service.getMyRunnerConnectionProfile.run({}, context)).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(getUser).toHaveBeenCalledTimes(reads);
    expect(await auditCount()).toBe(0);
  });
});
