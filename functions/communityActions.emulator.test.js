const admin = require('firebase-admin');
const { randomUUID } = require('node:crypto');
const { createCommunityService, assertCommunityEnvironment, parseRequest } = require('./communityActions');
const { freeEvent, approvedMember } = require('./testSupport/communityFixtures');

const describeLocal = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
describeLocal('community lifecycle real Firestore transactions (emulator only)', () => {
  let app; let db; let service; let now;
  const roots = ['communityEvents', 'communityMemberships', 'communityConfig', 'communityCommands', 'communityLimits'];
  const command = (action, expectedRevision = 0, extra = {}) => parseRequest({ action, accountUid: 'fixture-member', expectedRevision, requestId: randomUUID(), ...extra });
  const join = (revision = 0) => command('event_join', revision, { eventId: 'fixture-event', waiverAccepted: true, waiverVersion: 'synthetic-only-v1' });
  beforeAll(() => {
    assertCommunityEnvironment(); // All local hosts and a demo project required.
    app = admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT }, 'community-emulator-test');
    db = app.firestore();
    now = Date.now(); service = createCommunityService(db, () => now);
  });
  beforeEach(async () => {
    for (const root of roots) await db.recursiveDelete(db.collection(root));
    await db.doc('communityConfig/events').create({ schemaVersion: 1, eventIds: ['fixture-event'] });
    await db.doc('communityEvents/fixture-event').create(freeEvent(now));
  });
  afterAll(async () => {
    if (db) for (const root of roots) await db.recursiveDelete(db.collection(root));
    if (app) await app.delete();
  });
  test('twenty concurrent final-seat requests confirm one; parallel cancellation releases once', async () => {
    const result = await Promise.allSettled(Array.from({ length: 20 }, (_, n) => service.mutate(`fixture-${n}`, join())));
    const winners = result.flatMap((entry, index) => entry.status === 'fulfilled' ? [index] : []);
    expect(winners).toHaveLength(1);
    expect((await db.doc('communityEvents/fixture-event').get()).data().confirmedCount).toBe(1);
    const uid = `fixture-${winners[0]}`;
    const cancel = command('event_cancel', 1, { eventId: 'fixture-event' });
    await Promise.all(Array.from({ length: 5 }, () => service.mutate(uid, cancel)));
    expect((await db.doc('communityEvents/fixture-event').get()).data().confirmedCount).toBe(0);
    await service.mutate(uid, join(2));
    await service.mutate(uid, cancel);
    expect((await db.doc('communityEvents/fixture-event').get()).data().confirmedCount).toBe(1);
  }, 45000);
  test('membership request retry, withdrawal, paid-term cancellation and exact expiry', async () => {
    const uid = 'fixture-member'; const joining = command('membership_join');
    await Promise.all(Array.from({ length: 5 }, () => service.mutate(uid, joining)));
    expect((await service.status(uid)).membership).toMatchObject({ revision: 1, entitlement: 'not_entitled' });
    await service.mutate(uid, command('membership_cancel', 1));
    expect((await service.status(uid)).membership.applicationStatus).toBe('withdrawn');
    const paid = approvedMember(uid, now);
    await db.doc(`communityMemberships/${uid}`).set(paid);
    await service.mutate(uid, command('membership_cancel', 1));
    expect((await db.doc(`communityMemberships/${uid}`).get()).data().authority).toEqual(paid.authority);
    expect((await service.status(uid)).membership.entitlement).toBe('current_member');
    now = paid.authority.term.endsAtMs;
    expect((await service.status(uid)).membership.entitlement).toBe('not_entitled');
  });
});
