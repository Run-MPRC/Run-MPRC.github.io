const admin = require('firebase-admin');
const { randomUUID } = require('node:crypto');
const { createCommunityService, assertCommunityEnvironment, parseRequest, memberView, eventView } = require('./communityActions');
const { createAdministrationService, parseAdminRequest } = require('./communityAdministration');
const { freeEvent, approvedMember } = require('./testSupport/communityFixtures');

const describeLocal = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
describeLocal('community lifecycle real Firestore transactions (emulator only)', () => {
  let app; let db; let service; let now;
  const roots = ['communityEvents', 'communityMemberships', 'communityConfig', 'communityCommands', 'communityLimits', 'communityOfficers', 'communityOfficerCommands', 'communityOfficerLimits', 'communityDues', 'communityDuesLinks', 'communityAssociationTargets'];
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
  test('cancelled-event availability is a read-only projection and preserves own confirmed signup evidence', async () => {
    const uid = 'fixture-status-member';
    await service.mutate(uid, join());
    const event = db.doc('communityEvents/fixture-event');
    const registration = event.collection('registrations').doc(uid);
    await event.update({ status: 'cancelled' });
    const before = await db.getAll(event, registration);
    const view = await service.status(uid);
    expect(view.events[0]).toMatchObject({ status: 'cancelled', signupStatus: 'cancelled', confirmedCount: 1, registration: { status: 'confirmed', revision: 1 } });
    expect((await service.status('fixture-other')).events[0].registration.status).toBe('none');
    const after = await db.getAll(event, registration);
    expect(after.map(doc => doc.data())).toEqual(before.map(doc => doc.data()));
    expect(after.map(doc => doc.updateTime.toMillis())).toEqual(before.map(doc => doc.updateTime.toMillis()));
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
  test('cross-officer dues uniqueness, immutable retry and revocation use real Firestore transactions', async () => {
    const policy = { schemaVersion: 1, syntheticOnly: true, policyVersion: 'fictional-external-dues-v1', revision: 1, amountCents: 100, currency: 'USD', method: 'fictional_external', termId: 'fictional-term', startsAtMs: now - 1000, endsAtMs: now + 3600000 };
    await db.doc('communityConfig/duesTestTerm').create(policy);
    const auth = { getUser: jest.fn() };
    const officer = createAdministrationService(db, auth, { memberView, eventView }, () => now);
    const token = { email_verified: true, auth_time: Math.floor(now / 1000), firebase: { sign_in_second_factor: 'totp' } };
    const confirmationId = randomUUID(); const requests = [];
    for (let n = 0; n < 6; n++) {
      const uid = `dues-officer-${n}`;
      await db.doc(`communityOfficers/${uid}`).create({ schemaVersion: 2, enabled: true, revision: 1, expiresAtMs: now + 3600000, membershipApproval: false, freeEventManagement: false, duesRecording: true });
      requests.push(parseAdminRequest({ action: 'admin_dues_record', accountUid: uid, requestId: randomUUID(), expectedRevision: 0, reason: 'synthetic_staging_review', confirmationId, externalConfirmed: true, policyRevision: 1 }));
    }
    const result = await Promise.allSettled(requests.map((request) => officer.execute(request.accountUid, token, request)));
    const winners = result.flatMap((value, index) => value.status === 'fulfilled' ? [index] : []);
    expect(winners).toHaveLength(1);
    const request = requests[winners[0]]; const uid = request.accountUid;
    const first = result[winners[0]].value;
    expect(await officer.execute(uid, token, request)).toEqual(first);
    const receipts = await db.collection('communityDues').get(); expect(receipts.size).toBe(1);
    expect(receipts.docs[0].data().authority.association).toEqual({ state: 'unlinked', uid: null, revision: 0 });
    expect((await db.collection('communityMemberships').get()).empty).toBe(true);
    expect(auth.getUser).not.toHaveBeenCalled();
    await db.doc(`communityOfficers/${uid}`).update({ enabled: false, revision: 2 });
    await expect(officer.execute(uid, token, request)).rejects.toHaveProperty('code', 'permission-denied');
  }, 45000);
  test('two officers linking one receipt and two receipts linking one UID have one winner; term/cancel/expiry remain canonical', async () => {
    const { createDuesReceipt } = require('./communityDues');
    const policy = { schemaVersion: 1, syntheticOnly: true, policyVersion: 'fictional-external-dues-v1', revision: 1, amountCents: 100, currency: 'USD', method: 'fictional_external', termId: 'fictional-link-term', startsAtMs: now - 1000, endsAtMs: now + 60000 };
    const token = { email_verified: true, auth_time: Math.floor(now / 1000), firebase: { sign_in_second_factor: 'totp' } };
    const caps = { schemaVersion: 3, enabled: true, revision: 1, expiresAtMs: now + 3600000, membershipApproval: false, freeEventManagement: false, duesRecording: false, membershipAssociation: true };
    const freshReceipt = async () => {
      const value = createDuesReceipt('link-officer-0', caps, token, { requestId: randomUUID(), confirmationId: randomUUID(), policyRevision: 1 }, policy, now);
      await db.doc(`communityDues/${value.membershipId}`).create(value); return value;
    };
    const officer = createAdministrationService(db, { getUser: async uid => ({ uid, emailVerified: true, disabled: false }) }, { memberView, eventView }, () => now);
    const commands = [];
    const receipt = await freshReceipt();
    for (let n = 0; n < 4; n++) {
      const uid = `link-officer-${n}`; const member = `link-member-${n}`;
      await db.doc(`communityOfficers/${uid}`).create(caps);
      await service.mutate(member, command('membership_join'));
      await db.doc(`communityAssociationTargets/${member}`).create({ schemaVersion: 1, syntheticOnly: true, enabled: true, uid: member, revision: 1, expiresAtMs: now + 3600000 });
      commands.push(parseAdminRequest({ action: 'admin_dues_link', accountUid: uid, targetUid: member, expectedRevision: 1, requestId: randomUUID(), membershipId: receipt.membershipId, associationConfirmed: true, reason: 'synthetic_staging_review' }));
    }
    const raced = await Promise.allSettled(commands.map(request => officer.execute(request.accountUid, token, request)));
    const winners = raced.flatMap((value, n) => value.status === 'fulfilled' ? [n] : []); expect(winners).toHaveLength(1);
    const winner = commands[winners[0]];
    expect((await db.collection('communityDuesLinks').get()).size).toBe(1);
    expect((await db.doc(`communityDues/${receipt.membershipId}`).get()).data()).toEqual(receipt);
    const authority = (await db.doc(`communityMemberships/${winner.targetUid}`).get()).data().authority;
    expect(authority.term).toEqual(receipt.authority.term);
    await officer.execute(winner.accountUid, token, winner);
    await service.mutate(winner.targetUid, command('membership_cancel', 2));
    expect((await service.status(winner.targetUid)).membership.entitlement).toBe('current_member');
    expect((await db.doc(`communityMemberships/${winner.targetUid}`).get()).data().authority).toEqual(authority);
    const loser = commands[(winners[0] + 1) % 4]; const a = await freshReceipt(); const b = await freshReceipt();
    const both = await Promise.allSettled([a, b].map(value => officer.execute(loser.accountUid, token, { ...loser, requestId: randomUUID(), membershipId: value.membershipId })));
    expect(both.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect((await db.collection('communityDuesLinks').get()).size).toBe(2);
    await db.doc(`communityOfficers/${winner.accountUid}`).update({ enabled: false, revision: 2 });
    await expect(officer.execute(winner.accountUid, token, winner)).rejects.toHaveProperty('code', 'permission-denied');
    now = policy.endsAtMs;
    expect((await service.status(winner.targetUid)).membership.entitlement).toBe('not_entitled');
  }, 45000);
});
