const admin = require('firebase-admin');
const { randomUUID } = require('node:crypto');
const { createCommunityService, assertCommunityEnvironment, parseRequest, memberView, eventView } = require('./communityActions');
const { createAdministrationService, parseAdminRequest } = require('./communityAdministration');
const { freeEvent, approvedMember } = require('./testSupport/communityFixtures');

const describeLocal = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
describeLocal('community lifecycle real Firestore transactions (emulator only)', () => {
  let app; let db; let service; let now;
  const roots = ['communityEvents', 'communityMemberships', 'communityConfig', 'communityCommands', 'communityLimits', 'communityOfficers', 'communityOfficerCommands', 'communityOfficerLimits'];
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
  test('officer approval/withdrawal, capacity/closure concurrency and live revocation use real transactions', async () => {
    const uid = 'fixture-officer'; const runner = 'fixture-member';
    const caps = { schemaVersion: 1, enabled: true, revision: 1, expiresAtMs: now + 3600000, membershipApproval: true, freeEventManagement: true };
    await db.doc(`communityOfficers/${uid}`).create(caps);
    await db.doc('communityConfig/approvalTestTerm').create({ schemaVersion: 1, syntheticOnly: true, policyVersion: 'synthetic-only-not-payment-evidence', termId: 'stage-test', startsAtMs: now - 1000, endsAtMs: now + 60000 });
    const officer = createAdministrationService(db, { getUser: async (targetUid) => ({ uid: targetUid, emailVerified: true, disabled: false }) }, { memberView, eventView }, () => now);
    const token = { email_verified: true, auth_time: Math.floor(now / 1000), firebase: { sign_in_second_factor: 'totp' } };
    const adminCommand = (action, revision, extra) => parseAdminRequest({ action, accountUid: uid, requestId: randomUUID(), expectedRevision: revision, reason: 'synthetic_staging_review', ...extra });
    await service.mutate(runner, command('membership_join'));
    const review = await officer.execute(uid, token, parseAdminRequest({ action: 'admin_status', accountUid: uid }));
    expect(review.pending.map((member) => member.uid)).toEqual([runner]);
    const approval = adminCommand('admin_membership_approve', 1, { targetUid: runner });
    const result = await Promise.allSettled([officer.execute(uid, token, approval), service.mutate(runner, command('membership_cancel', 1))]);
    expect(result.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    const close = adminCommand('admin_event_close', 0, { eventId: 'fixture-event' });
    await Promise.allSettled([officer.execute(uid, token, close), service.mutate(runner, join())]);
    const event = (await db.doc('communityEvents/fixture-event').get()).data();
    expect(event.status).toBe('closed'); expect([0, 1]).toContain(event.confirmedCount);
    await expect(service.mutate('other', join())).rejects.toBeDefined();
    await officer.execute(uid, token, close);
    await db.doc(`communityOfficers/${uid}`).update({ enabled: false, revision: 2 });
    await expect(officer.execute(uid, token, close)).rejects.toHaveProperty('code', 'permission-denied');
  }, 45000);
});
