'use strict';
const admin = require('firebase-admin');
const { randomUUID } = require('node:crypto');
const { createTestDuesService } = require('./testMembershipDues');
const { offers, WAIVER } = require('./testDuesPolicy');
const { createCommunityService, parseRequest } = require('./communityActions');
const { freeEvent } = require('./testSupport/communityFixtures');
const native = process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST ? describe : describe.skip;
native('test dues native Firestore concurrency (synthetic provider)', () => {
  let app; let db; let service; let provider; let now; let order; let paid;
  const uid = 'fixture-dues-native'; const roots = ['membershipTestOrders', 'membershipTestAccounts', 'membershipTestParticipants', 'membershipTestTerms', 'membershipTestFamilies', 'membershipTestEvents', 'membershipTestAudit', 'membershipTestLimits'];
  beforeAll(() => { app = admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT }, 'dues-native'); db = app.firestore(); });
  beforeEach(async () => {
    now = Date.parse('2026-10-16T12:00:00Z'); order = null; paid = false;
    for (const root of roots) await db.recursiveDelete(db.collection(root));
    await db.doc(`communityMemberships/${uid}`).delete();
    await db.doc(`membershipTestParticipants/${uid}`).create({ schemaVersion: 1, synthetic: true, expiresAtMs: now + 86400000 });
    const project = o => ({ orderId: o.id, nonce: o.nonce, checkoutRef: 'cs_test_native', providerAccountRef: 'acct_native', livemode: false, amountMinor: o.expectation.expectedAmountMinor, currency: 'usd', paymentRef: paid ? 'pi_native' : null, paid, reversal: false, expired: false });
    provider = { create: jest.fn(async o => { expect((await db.doc(`membershipTestOrders/${o.id}`).get()).exists).toBe(true); order = o; return project(o); }), retrieve: jest.fn(async () => project(order)), resolve: jest.fn(async () => project(order)) };
    service = createTestDuesService({ db, auth: { getUser: async id => ({ uid: id, disabled: false, emailVerified: true }) }, provider, account: 'acct_native', clock: () => now });
  });
  afterAll(async () => {
    for (const root of roots) await db.recursiveDelete(db.collection(root));
    await db.doc(`communityMemberships/${uid}`).delete();
    await db.recursiveDelete(db.doc('communityEvents/fixture-dues-free'));
    await db.recursiveDelete(db.doc(`communityCommands/${uid}`)); await db.doc(`communityLimits/${uid}`).delete(); await app.delete();
  });
  const request = (kind = 'individual', id = randomUUID()) => ({ action: 'prepare', accountUid: uid, requestId: id, offerId: offers(now).find(o => o.planRef.includes(kind)).planRef, waiverAccepted: true, waiverVersion: WAIVER.version });
  test('concurrent different plans/commands create one purchase; concurrent paid callbacks activate once and admit free event', async () => {
    const results = await Promise.allSettled(Array.from({ length: 16 }, (_, n) => service.prepare(uid, request(n % 2 ? 'family' : 'individual'))));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(provider.create).toHaveBeenCalledTimes(1);
    expect((await db.collection('membershipTestOrders').get()).size).toBe(1);
    paid = true;
    const event = { id: 'evt_native', type: 'checkout.session.completed', reference: { kind: 'session', id: 'cs_test_native' } };
    await Promise.all(Array.from({ length: 5 }, (_, n) => n % 2 ? service.reconcile(uid) : service.webhook(event)));
    expect((await service.status(uid)).active).toBe(true); expect((await db.doc(`communityMemberships/${uid}`).get()).data().revision).toBe(1);
    expect((await db.collection('membershipTestTerms').get()).size).toBe(1);
    await db.doc('communityEvents/fixture-dues-free').set(freeEvent(now));
    const community = createCommunityService(db, () => now);
    await community.mutate(uid, parseRequest({ action: 'event_join', accountUid: uid, requestId: randomUUID(), expectedRevision: 0, eventId: 'fixture-dues-free', waiverVersion: 'synthetic-only-v1', waiverAccepted: true }));
    expect((await db.doc(`communityEvents/fixture-dues-free/registrations/${uid}`).get()).data().status).toBe('confirmed');
  }, 60000);
  test('native same-command race shares original nonce, price and expiry; retry after paid is read-only', async () => {
    const r = request(); const results = await Promise.all(Array.from({ length: 5 }, () => service.prepare(uid, r)));
    expect(new Set(results.map(x => x.order.id)).size).toBe(1);
    const calls = provider.create.mock.calls.map(c => JSON.stringify(c[0])); expect(new Set(calls).size).toBe(1);
    paid = true; await service.reconcile(uid);
    const before = await db.doc(`communityMemberships/${uid}`).get(); await service.reconcile(uid);
    expect((await db.doc(`communityMemberships/${uid}`).get()).updateTime.isEqual(before.updateTime)).toBe(true);
  }, 60000);
});
