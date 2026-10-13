const admin = require('firebase-admin');
const { createFictionalRaceService, raceEnvironment } = require('./fictionalRaceService');
const { raceEnrollmentId } = require('./fictionalRaceTransitions');
const f = require('./testSupport/fictionalRaceFixtures');

const describeDemo = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
describeDemo('fictional race native Auth metadata and Firestore transactions — demo only, no callable/attestation proof', () => {
  let app; let db; let auth; let now; let service; let sequence = 0;
  const ownedUids = new Set();
  const assertDemo = () => expect(['demo-mprc-local', 'demo-functions-test']).toContain(raceEnvironment(process.env));
  beforeAll(() => {
    assertDemo();
    app = admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT }, 'fictional-race-729');
    db = app.firestore(); auth = app.auth();
  });
  async function clean() {
    assertDemo();
    for (const root of f.ROOTS) await db.recursiveDelete(db.collection(root));
    for (const uid of ownedUids) {
      expect((await db.collection(`communityRaceCommands/${uid}/requests`).get()).empty).toBe(true);
      await auth.deleteUser(uid);
      await expect(auth.getUser(uid)).rejects.toHaveProperty('code', 'auth/user-not-found');
      ownedUids.delete(uid);
    }
  }
  beforeEach(async () => {
    await clean(); now = Date.now(); service = createFictionalRaceService(app, () => now);
    await db.doc(`communityRaceEvents/${f.eventId}`).create(f.event(now));
    await db.doc(`communityRacePolicies/${f.eventId}`).create(f.policy(now));
  }, 45000);
  afterAll(async () => { if (db) await clean(); if (app) await app.delete(); }, 45000);
  async function member() {
    const uid = `stage_race_729_${sequence++}`;
    // Successful creation, not a name prefix, establishes cleanup ownership.
    await auth.createUser({ uid, email: `${uid}@example.invalid`, emailVerified: true, disabled: false });
    ownedUids.add(uid);
    await db.doc(`communityRaceTargets/${uid}`).create(f.marker(uid, now));
    await db.doc(`communityRacePermissions/${uid}`).create(f.permission(uid, now));
    return uid;
  }
  const run = (uid, request) => service.execute(uid, f.token(now), request); // Synthetic callable context, not native token verification.
  async function joined(uid, eventRevision = 1) {
    const request = f.command(uid, 'join_simulation', { expectedEventRevision: eventRevision });
    return { request, result: await run(uid, request), entryId: request.entryId };
  }
  const change = (uid, entryId, action, revision, extra = {}) => f.command(uid, action, {
    entryId, expectedEntryRevision: revision, expectedEventRevision: 2, ...extra,
  });
  async function snapshots() {
    const result = [];
    for (const root of f.ROOTS) {
      const docs = await db.collection(root).get();
      for (const doc of docs.docs) result.push([doc.ref.path, [doc.updateTime.seconds, doc.updateTime.nanoseconds], doc.data()]);
    }
    for (const uid of ownedUids) {
      const commands = await db.collection(`communityRaceCommands/${uid}/requests`).get();
      for (const doc of commands.docs) result.push([doc.ref.path, [doc.updateTime.seconds, doc.updateTime.nanoseconds], doc.data()]);
    }
    return result.sort(([a], [b]) => a.localeCompare(b));
  }

  test('twenty native final-seat attempts admit one; five duplicate cancellations release exactly once', async () => {
    const members = []; for (let n = 0; n < 20; n++) members.push(await member());
    const results = await Promise.allSettled(members.map(uid => run(uid, f.command(uid))));
    const winners = results.flatMap((result, n) => result.status === 'fulfilled' ? [n] : []);
    expect(winners).toHaveLength(1);
    expect((await db.doc(`communityRaceEvents/${f.eventId}`).get()).data()).toMatchObject({ confirmedCount: 1, revision: 2 });
    expect((await db.collection('communityRaceEntries').get()).size).toBe(1);
    expect((await db.collection('communityRaceEnrollment').get()).size).toBe(1);
    const uid = members[winners[0]]; const entryId = raceEnrollmentId(f.eventId, uid);
    const refund = change(uid, entryId, 'simulate_refund', 1);
    await Promise.all(Array.from({ length: 5 }, () => run(uid, refund)));
    expect((await db.doc(`communityRaceEvents/${f.eventId}`).get()).data()).toMatchObject({ confirmedCount: 0, revision: 3 });
    expect((await db.doc(`communityRaceEntries/${entryId}`).get()).data()).toMatchObject({ status: 'cancelled', fictionalReturnedCents: 1000, revision: 2 });
    expect((await db.collection('communityRaceAudit').get()).size).toBe(2);
    expect((await db.collection(`communityRaceCommands/${uid}/requests`).get()).size).toBe(2);
  }, 45000);

  test('exact replay preserves native update times; changed request and old successful join cannot resurrect cancelled entry', async () => {
    const uid = await member(); const { request, entryId } = await joined(uid);
    const refund = change(uid, entryId, 'simulate_refund', 1); await run(uid, refund);
    const before = await snapshots(); await run(uid, refund); await run(uid, request);
    expect(await snapshots()).toEqual(before);
    await expect(run(uid, { ...refund, expectedEntryRevision: 2 })).rejects.toBeDefined();
    expect(await snapshots()).toEqual(before);
  }, 45000);

  test('competing refund and transfer offer resolve once; no double state or negative seat', async () => {
    const uid = await member(); const recipient = await member(); const { entryId } = await joined(uid);
    const outcomes = await Promise.allSettled([
      run(uid, change(uid, entryId, 'simulate_refund', 1)),
      run(uid, change(uid, entryId, 'offer_transfer', 1, { recipientUid: recipient })),
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const entry = (await db.doc(`communityRaceEntries/${entryId}`).get()).data();
    const event = (await db.doc(`communityRaceEvents/${f.eventId}`).get()).data();
    expect(entry.revision).toBe(2);
    expect(event.confirmedCount).toBe(entry.status === 'cancelled' ? 0 : 1);
    expect(entry.status === 'cancelled' ? entry.offer === null : entry.offer.recipientUid === recipient).toBe(true);
    expect((await db.collection('communityRaceAudit').get()).size).toBe(2);
  }, 45000);

  test('recipient accept races owner revoke; one transition wins and original evidence/count stays correct', async () => {
    const uid = await member(); const recipient = await member(); const { entryId } = await joined(uid);
    const original = (await db.doc(`communityRaceEntries/${entryId}`).get()).data();
    await run(uid, change(uid, entryId, 'offer_transfer', 1, { recipientUid: recipient }));
    const outcomes = await Promise.allSettled([
      run(recipient, change(recipient, entryId, 'accept_transfer', 2)),
      run(uid, change(uid, entryId, 'revoke_transfer', 2)),
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const current = (await db.doc(`communityRaceEntries/${entryId}`).get()).data();
    expect(current).toMatchObject({ revision: 3, offer: null, bibId: original.bibId, creditOwnerUid: uid });
    expect(current.originalWaiver).toEqual(original.originalWaiver);
    expect((await db.doc(`communityRaceEvents/${f.eventId}`).get()).data().confirmedCount).toBe(1);
    expect((await db.collection('communityRaceAudit').get()).size).toBe(3);
  }, 45000);

  test('two offered bibs cannot enroll the same recipient twice', async () => {
    await db.doc(`communityRaceEvents/${f.eventId}`).set(f.event(now, 2));
    const a = await member(); const b = await member(); const recipient = await member();
    const one = await joined(a); const two = await joined(b, 2);
    const offer = (uid, entryId) => change(uid, entryId, 'offer_transfer', 1, { recipientUid: recipient, expectedEventRevision: 3 });
    await run(a, offer(a, one.entryId)); await run(b, offer(b, two.entryId));
    const accepts = await Promise.allSettled([
      run(recipient, change(recipient, one.entryId, 'accept_transfer', 2, { expectedEventRevision: 3 })),
      run(recipient, change(recipient, two.entryId, 'accept_transfer', 2, { expectedEventRevision: 3 })),
    ]);
    expect(accepts.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    const enrollment = (await db.doc(`communityRaceEnrollment/${raceEnrollmentId(f.eventId, recipient)}`).get()).data();
    expect([one.entryId, two.entryId]).toContain(enrollment.entryId);
    const entries = await db.collection('communityRaceEntries').get();
    expect(entries.docs.filter(doc => doc.data().runnerUid === recipient)).toHaveLength(1);
    expect((await db.doc(`communityRaceEvents/${f.eventId}`).get()).data().confirmedCount).toBe(2);
  }, 45000);

  test('native disabled/unverified account or revoked/expired marker denies replay without any document change', async () => {
    const uid = await member(); const { request } = await joined(uid);
    await auth.updateUser(uid, { disabled: true }); let before = await snapshots();
    await expect(run(uid, request)).rejects.toHaveProperty('code', 'permission-denied'); expect(await snapshots()).toEqual(before);
    await auth.updateUser(uid, { disabled: false, emailVerified: false });
    await expect(run(uid, request)).rejects.toHaveProperty('code', 'permission-denied'); expect(await snapshots()).toEqual(before);
    await auth.updateUser(uid, { emailVerified: true });
    await db.doc(`communityRacePermissions/${uid}`).update({ enabled: false }); before = await snapshots();
    await expect(run(uid, request)).rejects.toHaveProperty('code', 'permission-denied'); expect(await snapshots()).toEqual(before);
    await db.doc(`communityRacePermissions/${uid}`).set(f.permission(uid, now));
    await db.doc(`communityRaceTargets/${uid}`).update({ expiresAtMs: now }); before = await snapshots();
    await expect(run(uid, request)).rejects.toHaveProperty('code', 'permission-denied'); expect(await snapshots()).toEqual(before);
  }, 45000);

  test('real commit followed by a synthetic lost acknowledgement recovers only the saved receipt', async () => {
    const uid = await member(); const request = f.command(uid); let lost = true;
    const facade = { options: app.options, auth: () => auth, firestore: () => ({ doc: db.doc.bind(db),
      runTransaction: async fn => { const result = await db.runTransaction(fn); if (lost) { lost = false; throw Error('synthetic lost acknowledgement'); } return result; } }) };
    const guarded = createFictionalRaceService(facade, () => now);
    await expect(guarded.execute(uid, f.token(now), request)).rejects.toHaveProperty('code', 'unavailable');
    const before = await snapshots();
    const result = await guarded.execute(uid, f.token(now), request); expect(result.entryRevision).toBe(1);
    expect(await snapshots()).toEqual(before);
    expect((await db.collection('communityRaceEntries').get()).size).toBe(1);
    expect((await db.collection('communityRaceAudit').get()).size).toBe(1);
  }, 45000);
});
