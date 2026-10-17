'use strict';
const { randomUUID } = require('node:crypto');
const { memoryDb } = require('./testSupport/communityMemoryDb');
const { createTestDuesService } = require('./testMembershipDues');
const { offers, WAIVER, yearStart, parseDuesRequest, assertTestDuesEnvironment } = require('./testDuesPolicy');
const { deriveMembershipEntitlement } = require('./membershipAuthority');
const UID = 'fictional-dues-user'; const ACCOUNT = 'acct_fictional';
function fixture(database) {
  const memory = database || memoryDb(); const { db, docs } = memory;
  let now = Date.parse('2026-10-16T12:00:00Z'); let enabled = true;
  docs?.set(`membershipTestParticipants/${UID}`, { schemaVersion: 1, synthetic: true, expiresAtMs: now + 86400000 });
  const auth = { getUser: jest.fn(async uid => ({ uid, disabled: !enabled, emailVerified: true })) };
  let providerOrder; let observation;
  const provider = {
    create: jest.fn(async order => { providerOrder = order; observation = observation || { orderId: order.id, nonce: order.nonce, checkoutRef: 'cs_test_fictional', providerAccountRef: ACCOUNT, livemode: false, amountMinor: order.expectation.expectedAmountMinor, currency: 'usd', paymentRef: null, paid: false, reversal: false, expired: false, url: 'https://checkout.stripe.com/c/pay/cs_test_fictional' }; return { ...observation }; }),
    retrieve: jest.fn(async () => ({ ...observation })), resolve: jest.fn(async () => ({ ...observation })),
  };
  const service = createTestDuesService({ db, auth, provider, account: ACCOUNT, clock: () => now });
  const request = (kind = 'individual', id = randomUUID()) => parseDuesRequest({ action: 'prepare', accountUid: UID, requestId: id, offerId: offers(now).find(o => o.planRef.includes(kind)).planRef, waiverVersion: WAIVER.version, waiverAccepted: true });
  const paid = () => { observation = { ...observation, paid: true, paymentRef: 'pi_fictional', url: undefined }; };
  const event = (id = 'evt_fictional') => ({ id, type: 'checkout.session.completed', reference: { kind: 'session', id: 'cs_test_fictional' } });
  return { ...memory, service, provider, request, paid, event, auth, getOrder: () => providerOrder,
    setObservation: patch => { observation = { ...observation, ...patch }; }, disable: () => { enabled = false; },
    advance: ms => { now += ms; }, setNow: value => { now = value; }, now: () => now };
}
test('calendar prices, LA rollover, leap year and minimum Stripe expiration window', () => {
  const date = Date.parse('2027-01-01T07:59:59Z');
  expect(offers(date).map(o => [o.amountMinor, o.currency, o.termId, o.offerable])).toEqual([[2500, 'usd', 'calendar-2026', false], [3000, 'usd', 'calendar-2026', false]]);
  expect(offers(date + 1000)[0]).toMatchObject({ termId: 'calendar-2027', startsAtMs: date + 1000 });
  expect(yearStart(2025) - yearStart(2024)).toBe(366 * 86400000);
});
test.each([{ amount: 1 }, { accountUid: 'foreign' }, { waiverAccepted: false }, { action: 'pay' }, { requestId: 'bad' }])('closed input rejects forged %j', patch => {
  const f = fixture(); const r = { ...f.request(), ...patch };
  if (patch.accountUid) expect(parseDuesRequest(r).accountUid).toBe('foreign'); // Native wrapper owns caller binding.
  else expect(() => parseDuesRequest(r)).toThrow();
});
test('environment rejects production, missing explicit flags and partial emulators', () => {
  const env = { GCLOUD_PROJECT: 'run-mprc-staging', COMMERCE_ENABLED: 'false', MPRC_TEST_DUES_ENABLED: 'true' };
  expect(() => assertTestDuesEnvironment(env)).not.toThrow();
  for (const patch of [{ GCLOUD_PROJECT: 'run-mprc' }, { COMMERCE_ENABLED: 'true' }, { MPRC_TEST_DUES_ENABLED: undefined }, { GCLOUD_PROJECT: 'demo-test', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }]) expect(() => assertTestDuesEnvironment({ ...env, ...patch })).toThrow();
});
test('persist-first exact retry, concurrent IDs and plan changes use one saved order', async () => {
  const f = fixture(); const r = f.request();
  f.provider.create.mockImplementationOnce(async order => { expect(f.docs.get(`membershipTestOrders/${order.id}`)).toEqual(order); throw new Error('lost response'); });
  await expect(f.service.prepare(UID, r)).rejects.toThrow();
  await expect(f.service.prepare(UID, f.request('family'))).rejects.toThrow();
  const results = await Promise.all([f.service.prepare(UID, r), f.service.prepare(UID, r)]);
  expect(results[0]).toEqual(results[1]); expect([...f.docs.keys()].filter(k => k.startsWith('membershipTestOrders/'))).toHaveLength(1);
  const creates = f.provider.create.mock.calls.map(c => c[0]); expect(creates.every(o => o.id === creates[0].id && o.nonce === creates[0].nonce && o.expiresAtMs === creates[0].expiresAtMs)).toBe(true);
});
test('failed database commit never contacts Stripe', async () => {
  const f = fixture(); f.db.runTransaction = jest.fn(async () => { throw new Error('write failure'); });
  await expect(f.service.prepare(UID, f.request())).rejects.toThrow(); expect(f.provider.create).not.toHaveBeenCalled();
});
test('uncertain unbound create cannot be recreated after bounded retry horizon', async () => {
  const f = fixture(); f.provider.create.mockRejectedValue(new Error('timeout')); const r = f.request();
  await expect(f.service.prepare(UID, r)).rejects.toThrow(); f.advance(300001);
  await expect(f.service.prepare(UID, r)).rejects.toThrow(); expect(f.provider.create).toHaveBeenCalledTimes(1);
});
test('paid family activates automatically once in canonical event membership, records one private Family ID', async () => {
  const f = fixture(); const first = await f.service.prepare(UID, f.request('family')); expect(first.order.state).toBe('open');
  f.paid(); await Promise.all([f.service.webhook(f.event()), f.service.reconcile(UID), f.service.webhook(f.event())]);
  const member = f.docs.get(`communityMemberships/${UID}`);
  expect(member.applicationStatus).toBe('approved');
  expect(deriveMembershipEntitlement({ membershipAuthoritySchemaVersion: 1, record: member.authority, uid: UID, asOfMs: f.now() }).entitlement).toBe('current_member');
  expect((await f.service.status(UID)).order.familyId).toMatch(/^family-/);
  expect([...f.docs.keys()].filter(k => k.startsWith('membershipTestFamilies/'))).toHaveLength(1);
  expect([...f.docs.keys()].filter(k => k.startsWith('membershipTestTerms/'))).toHaveLength(1);
  expect(member.revision).toBe(1); expect(f.auth.getUser).toHaveBeenCalled();
  await expect(f.service.prepare(UID, f.request())).rejects.toThrow();
  expect(JSON.stringify([...f.docs.values()])).not.toContain('checkout.stripe.com');
  f.setObservation({ paid: false, expired: true }); await f.service.webhook(f.event('evt_older'));
  expect((await f.service.status(UID)).order.state).toBe('active'); expect(f.docs.get(`communityMemberships/${UID}`)).toEqual(member);
});
test('unpaid/async failure/return without provider payment never activates; async success does', async () => {
  const f = fixture(); await f.service.prepare(UID, f.request()); await f.service.webhook(f.event());
  await f.service.reconcile(UID); expect(f.docs.has(`communityMemberships/${UID}`)).toBe(false);
  f.paid(); await f.service.webhook({ ...f.event('evt_async'), type: 'checkout.session.async_payment_succeeded' });
  expect((await f.service.status(UID)).active).toBe(true);
});
test.each([{ amountMinor: 2499 }, { amountMinor: 2501 }, { currency: 'eur' }, { livemode: true }, { providerAccountRef: 'acct_other' }, { nonce: 'foreign' }, { checkoutRef: 'cs_test_other' }])('mismatched provider observation cannot activate: %j', async patch => {
  const f = fixture(); await f.service.prepare(UID, f.request()); f.paid(); f.setObservation(patch);
  await expect(f.service.reconcile(UID)).rejects.toThrow(); expect(f.docs.has(`communityMemberships/${UID}`)).toBe(false);
});
test('verified webhook can bind before create returns; committed lost response resumes same order', async () => {
  const f = fixture(); const normal = f.provider.create.getMockImplementation();
  f.provider.create.mockImplementationOnce(async o => { await normal(o); f.paid(); await f.service.webhook(f.event()); throw new Error('lost committed response'); });
  const r = f.request(); await expect(f.service.prepare(UID, r)).rejects.toThrow();
  expect((await f.service.resume(UID)).order.state).toBe('active'); expect(f.provider.create).toHaveBeenCalledTimes(1);
});
test('receipt survives account loss and safely activates after current verification returns', async () => {
  const f = fixture(); await f.service.prepare(UID, f.request()); f.paid(); f.auth.getUser.mockResolvedValueOnce({ uid: UID, disabled: true, emailVerified: true });
  await f.service.webhook(f.event()); expect(f.docs.get(`membershipTestOrders/${f.getOrder().id}`).state).toBe('paid_pending_activation');
  expect(f.docs.has(`communityMemberships/${UID}`)).toBe(false); await f.service.reconcile(UID); expect((await f.service.status(UID)).active).toBe(true);
});
test('intervening member revision/withdrawal is retained with paid evidence; no automatic override', async () => {
  const f = fixture(); await f.service.prepare(UID, f.request());
  f.docs.set(`communityMemberships/${UID}`, { schemaVersion: 1, revision: 1, applicationStatus: 'withdrawn', authority: null });
  f.paid(); await f.service.webhook(f.event()); expect(f.docs.get(`communityMemberships/${UID}`).applicationStatus).toBe('withdrawn');
  expect(f.docs.get(`membershipTestOrders/${f.getOrder().id}`).state).toBe('paid_pending_activation');
  expect(f.docs.has(`membershipTestTerms/${f.getOrder().id}`)).toBe(true);
});
test('current reversal holds active test term once; duplicate and old paid events cannot reactivate', async () => {
  const f = fixture(); await f.service.prepare(UID, f.request()); f.paid(); await f.service.reconcile(UID);
  f.setObservation({ reversal: true, paid: false }); await f.service.webhook(f.event('evt_refund')); const m = f.docs.get(`communityMemberships/${UID}`);
  await f.service.webhook(f.event('evt_refund')); expect(f.docs.get(`communityMemberships/${UID}`)).toEqual(m);
  expect((await f.service.status(UID)).active).toBe(false); f.setObservation({ reversal: false, paid: true }); await f.service.reconcile(UID);
  expect((await f.service.status(UID)).order.state).toBe('held');
});
test('expired unpaid order allows one fresh purchase, expired state does not regress on old unpaid event', async () => {
  const f = fixture(); await f.service.prepare(UID, f.request()); f.setObservation({ expired: true }); await f.service.reconcile(UID);
  f.setObservation({ expired: false }); await f.service.reconcile(UID); expect((await f.service.status(UID)).order.state).toBe('expired');
  f.provider.create.mockRejectedValue(new Error('test stop')); await expect(f.service.prepare(UID, f.request())).rejects.toThrow();
  expect([...f.docs.keys()].filter(k => k.startsWith('membershipTestOrders/'))).toHaveLength(2);
});
test('year rollover retains original paid term; never extends an old payment into new year', async () => {
  const f = fixture(); await f.service.prepare(UID, f.request()); f.paid(); f.setNow(yearStart(2027));
  f.docs.set(`membershipTestParticipants/${UID}`, { schemaVersion: 1, synthetic: true, expiresAtMs: f.now() + 86400000 });
  await f.service.webhook(f.event()); expect((await f.service.status(UID)).active).toBe(false);
  expect(f.docs.get(`membershipTestTerms/${f.getOrder().id}`).endsAtMs).toBe(yearStart(2027));
});
test('revoked marker/current disabled account blocks resume and no extra provider create', async () => {
  const f = fixture(); f.provider.create.mockRejectedValue(new Error('timeout')); await expect(f.service.prepare(UID, f.request())).rejects.toThrow();
  f.docs.delete(`membershipTestParticipants/${UID}`); await expect(f.service.resume(UID)).rejects.toThrow(); expect(f.provider.create).toHaveBeenCalledTimes(1);
  f.disable(); await expect(f.service.status(UID)).rejects.toThrow();
});

test('revoked synthetic participant cannot reconcile or consume provider/rate resources', async () => {
  const f = fixture(); await f.service.prepare(UID, f.request());
  f.docs.delete(`membershipTestParticipants/${UID}`);
  const before = JSON.stringify([...f.docs]);
  await expect(f.service.reconcile(UID)).rejects.toThrow();
  expect(f.provider.retrieve).not.toHaveBeenCalled();
  expect(JSON.stringify([...f.docs])).toBe(before);
});

test('old-year reversal cannot suspend a later paid membership term', async () => {
  const f = fixture(); await f.service.prepare(UID, f.request()); f.paid(); await f.service.reconcile(UID);
  const old = f.getOrder();
  f.setNow(yearStart(2027)); f.docs.set(`membershipTestParticipants/${UID}`, { schemaVersion: 1, synthetic: true, expiresAtMs: f.now() + 86400000 });
  f.provider.create.mockImplementationOnce(async next => {
    f.setObservation({ orderId: next.id, nonce: next.nonce, checkoutRef: 'cs_test_newyear', paymentRef: null, paid: false, reversal: false });
    return f.provider.retrieve();
  });
  await f.service.prepare(UID, f.request());
  f.setObservation({ paid: true, paymentRef: 'pi_newyear' }); await f.service.reconcile(UID);
  const before = f.docs.get(`communityMemberships/${UID}`); expect(before.authority.term.termId).toBe('calendar-2027');
  f.setObservation({ orderId: old.id, nonce: old.nonce, checkoutRef: 'cs_test_fictional', paymentRef: 'pi_fictional', paid: false, reversal: true });
  await f.service.webhook(f.event('evt_oldyear_reversal'));
  expect(f.docs.get(`communityMemberships/${UID}`)).toEqual(before); expect((await f.service.status(UID)).active).toBe(true);
});
