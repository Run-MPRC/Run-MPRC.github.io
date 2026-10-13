// Direct handler + synthetic context doubles; genuine hosted verification is
// separate. The native HTTP wrapper tests also cover these exact routes.
jest.mock('firebase-admin', () => ({ app: jest.fn(), firestore: jest.fn(), auth: jest.fn() }));
const admin = require('firebase-admin');
const { communityActions, communityEnvelope } = require('./communityActions');
const { memoryDb } = require('./testSupport/communityMemoryDb');
const { POLICY } = require('./fictionalRaceTransitions');
const f = require('./testSupport/fictionalRaceFixtures');
const uid = 'stage_race_rpc_owner';
describe('same community callable exact fictional race routing', () => {
  let docs; let db; let metadata; let now; let context;
  const keys = Object.keys(f.ENV); const saved = {};
  beforeAll(() => { keys.forEach(key => { saved[key] = process.env[key]; process.env[key] = f.ENV[key]; }); });
  afterAll(() => keys.forEach(key => { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }));
  beforeEach(() => {
    jest.clearAllMocks(); ({ db, docs } = memoryDb()); now = Date.now();
    metadata = { getUser: jest.fn(async target => ({ uid: target, emailVerified: true, disabled: false })) };
    admin.app.mockReturnValue({ options: { projectId: f.ENV.GCLOUD_PROJECT }, firestore: () => db, auth: () => metadata });
    context = { auth: { uid, token: f.token(now) }, app: { appId: 'synthetic-only' } };
    docs.set('communityConfig/fictionalRaces', { schemaVersion: 1, simulationOnly: true, policyVersion: POLICY, eventIds: [f.eventId] });
    docs.set(`communityRaceEvents/${f.eventId}`, f.event(now)); docs.set(`communityRacePolicies/${f.eventId}`, f.policy(now));
    docs.set(`communityRaceTargets/${uid}`, f.marker(uid, now)); docs.set(`communityRacePermissions/${uid}`, f.permission(uid, now));
  });
  const status = () => ({ action: 'race_status', accountUid: uid, incomingEntryId: null });
  const call = (data, ctx = context) => communityActions.run(data, ctx);
  const join = () => ({ ...f.command(uid), action: 'race_join' });
  test('status and join/cancel exact retry share the existing native wrapper without legacy price/state', async () => {
    const before = JSON.stringify([...docs]); expect(await call(status())).toMatchObject({ simulationOnly: true, events: [{ canJoin: true }] });
    expect(JSON.stringify([...docs])).toBe(before);
    const command = join(); const result = await call(command); expect(result.action).toBe('join_simulation');
    const committed = JSON.stringify([...docs]); expect(await call(command)).toEqual(result); expect(JSON.stringify([...docs])).toBe(committed);
    expect((await call(status())).events[0]).toMatchObject({ canJoin: false, entry: { canCancel: true } });
    await call({ ...f.command(uid, 'simulate_refund'), action: 'race_cancel', expectedEventRevision: 2, expectedEntryRevision: 1 });
    expect((await call(status())).events[0].entry).toMatchObject({ status: 'cancelled', fictionalReturnedCents: 1000 });
    expect(admin.firestore).not.toHaveBeenCalled(); expect(admin.auth).not.toHaveBeenCalled();
  });
  test('offer/revoke/offer/recipient acceptance routes preserve the bib/count/original fictional credit', async () => {
    const recipient = 'stage_race_rpc_recipient';
    docs.set(`communityRaceTargets/${recipient}`, f.marker(recipient, now));
    docs.set(`communityRacePermissions/${recipient}`, f.permission(recipient, now));
    const joined = await call(join()); const entryId = joined.entryId;
    const change = (action, revision, extra = {}) => ({ ...f.command(uid), action, entryId,
      expectedEventRevision: 2, expectedEntryRevision: revision, ...extra });
    // Remove the join-only waiver from non-waiver routes; closed parsers reject it.
    const withoutWaiver = data => { const request = { ...data }; delete request.waiverAccepted; delete request.waiverVersion; return request; };
    expect((await call(withoutWaiver(change('race_offer', 1, { recipientUid: recipient })))).action).toBe('offer_transfer');
    expect((await call(withoutWaiver(change('race_revoke', 2)))).action).toBe('revoke_transfer');
    await call(withoutWaiver(change('race_offer', 3, { recipientUid: recipient })));
    const nextContext = { ...context, auth: { uid: recipient, token: f.token(now) } };
    const incoming = await call({ action: 'race_status', accountUid: recipient, incomingEntryId: entryId }, nextContext);
    expect(incoming.incoming).toMatchObject({ entryId, revision: 4, canAccept: true });
    const accepted = await call({ ...f.command(recipient, 'accept_transfer'), action: 'race_accept', entryId,
      expectedEventRevision: 2, expectedEntryRevision: 4 }, nextContext);
    expect(accepted.action).toBe('accept_transfer');
    const entry = docs.get(`communityRaceEntries/${entryId}`);
    expect(entry).toMatchObject({ runnerUid: recipient, creditOwnerUid: uid, transferCount: 1, revision: 5 });
    expect(docs.get(`communityRaceEvents/${f.eventId}`).confirmedCount).toBe(1);
    const view = await call({ action: 'race_status', accountUid: recipient, incomingEntryId: null }, nextContext);
    expect(view.events[0].entry).toMatchObject({ bibId: entry.bibId, canCancel: true, canOffer: false, isOriginalCreditOwner: false });
  });
  test.each(['race_status_extra', 'race_refund', 'race_simulate_refund', 'join_simulation', 'simulate_refund', '', null, 123, {}, []])('only exact prefixed routes are admitted: %p', async action => {
    await expect(call({ ...status(), action })).rejects.toHaveProperty('code', 'invalid-argument'); expect(admin.app).not.toHaveBeenCalled();
  });
  test('native context UID, App Check and verified recent default-tenant password identity cannot be replaced by body', async () => {
    for (const ctx of [{ ...context, app: undefined }, { ...context, auth: undefined },
      { ...context, auth: { uid: 'stage_race_other', token: f.token(now) } },
      { ...context, auth: { uid, token: { ...f.token(now), email_verified: false } } },
      { ...context, auth: { uid, token: { ...f.token(now), auth_time: Math.floor(now / 1000) - 3601 } } },
      { ...context, auth: { uid, token: { ...f.token(now), auth_time: Math.floor(now / 1000) + 31 } } },
      { ...context, auth: { uid, token: { ...f.token(now), firebase: { sign_in_provider: 'custom' } } } },
      { ...context, auth: { uid, token: { ...f.token(now), firebase: { sign_in_provider: 'password', tenant: 'other' } } } }]) {
      await expect(call(status(), ctx)).rejects.toBeDefined();
    }
    expect(admin.app).not.toHaveBeenCalled();
  });
  test('browser admin cannot read without current own-entry permission/marker/native metadata', async () => {
    docs.delete(`communityRacePermissions/${uid}`);
    await expect(call(status(), { ...context, auth: { uid, token: { ...f.token(now), role: 'admin', admin: true } } })).rejects.toHaveProperty('code', 'permission-denied');
    expect(metadata.getUser).not.toHaveBeenCalled();
  });
  test.each(['amountCents', 'expiresAtMs', 'role', 'uid', 'price', 'currency', 'canJoin', 'email_verified', 'capability'])('unknown request field %s rejects before SDK', async key => {
    await expect(call({ ...join(), [key]: 'client-authority' })).rejects.toHaveProperty('code', 'invalid-argument'); expect(admin.app).not.toHaveBeenCalled();
  });
  test('allowed envelope field from another action is still denied by exact child parser', async () => {
    await expect(call({ ...status(), expectedRevision: 0 })).rejects.toHaveProperty('code', 'invalid-argument');
    await expect(call({ ...join(), targetUid: 'stage_race_other' })).rejects.toHaveProperty('code', 'invalid-argument');
    expect(admin.app).not.toHaveBeenCalled();
  });
  test('getters/proxies are rejected before discriminant evaluation or SDK calls', async () => {
    const getter = jest.fn(); const data = status(); Object.defineProperty(data, 'action', { get: getter, enumerable: true });
    await expect(call(data)).rejects.toHaveProperty('code', 'invalid-argument');
    await expect(call(new Proxy(status(), { get: getter }))).rejects.toHaveProperty('code', 'invalid-argument');
    expect(getter).not.toHaveBeenCalled(); expect(admin.app).not.toHaveBeenCalled();
    expect(() => communityEnvelope(data)).toThrow('Request is invalid.');
  });
  test('SDK acquisition fails fixed and project mismatch never falls back to default production', async () => {
    admin.app.mockImplementationOnce(() => { throw Error('private SDK detail'); });
    await expect(call(status())).rejects.toMatchObject({ code: 'unavailable', message: 'Community status is temporarily unavailable.' });
    admin.app.mockReturnValue({ options: { projectId: 'production' }, firestore: jest.fn(), auth: jest.fn() });
    await expect(call(status())).rejects.toThrow('Fictional race action unavailable.'); expect(metadata.getUser).not.toHaveBeenCalled();
  });
});
