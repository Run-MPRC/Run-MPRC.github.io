const { createFictionalRaceService, parseRaceStatus } = require('./fictionalRaceService');
const { POLICY, raceEnrollmentId } = require('./fictionalRaceTransitions');
const { memoryDb } = require('./testSupport/communityMemoryDb');
const f = require('./testSupport/fictionalRaceFixtures');
const owner = 'stage_race_status_owner'; const recipient = 'stage_race_status_recipient';
const outsider = 'stage_race_status_other';
describe('fictional race bounded read-only status (source double, not hosted proof)', () => {
  let db; let docs; let service; let auth; let now;
  const request = (uid, incomingEntryId = null) => ({ action: 'race_status', accountUid: uid, incomingEntryId });
  const snapshot = () => JSON.stringify([...docs]);
  const read = (uid = owner, incoming = null) => service.status(uid, f.token(now), request(uid, incoming));
  beforeEach(() => {
    ({ db, docs } = memoryDb()); now = 1700000000000;
    auth = { getUser: jest.fn(async uid => ({ uid, emailVerified: true, disabled: false })) };
    service = createFictionalRaceService({ options: { projectId: f.ENV.GCLOUD_PROJECT }, firestore: () => db, auth: () => auth }, () => now, f.ENV);
    docs.set('communityConfig/fictionalRaces', { schemaVersion: 1, simulationOnly: true, policyVersion: POLICY, eventIds: [f.eventId] });
    docs.set(`communityRaceEvents/${f.eventId}`, f.event(now));
    docs.set(`communityRacePolicies/${f.eventId}`, f.policy(now));
    for (const uid of [owner, recipient, outsider]) {
      docs.set(`communityRaceTargets/${uid}`, f.marker(uid, now));
      docs.set(`communityRacePermissions/${uid}`, f.permission(uid, now));
    }
  });
  const execute = (uid, command) => service.execute(uid, f.token(now), command);
  async function joined() {
    const result = await execute(owner, f.command(owner)); return result.entryId;
  }
  const change = (entryId, action, revision = 1, extra = {}) => f.command(owner, action,
    { entryId, expectedEntryRevision: revision, expectedEventRevision: 2, ...extra });
  async function denied(uid = owner, incoming = null) {
    const before = snapshot(); await expect(read(uid, incoming)).rejects.toThrow('Fictional race action unavailable.');
    expect(snapshot()).toBe(before);
  }
  test('empty own status has exact minimal shape and no writes, roster, totals or SDK enumeration', async () => {
    const transaction = jest.spyOn(db, 'runTransaction');
    const before = snapshot(); const view = await read();
    expect(view).toEqual({ schemaVersion: 1, simulationOnly: true, policyVersion: POLICY,
      observedAtMs: now, accessExpiresAtMs: now + 3600000, incoming: null,
      events: [{ eventId: f.eventId, revision: 1, startAtMs: now + 3600000,
        opensAtMs: now - 1000, closesAtMs: now + 1800000, signupStatus: 'open',
        fictionalAmountCents: 1000, currency: 'USD', waiverVersion: f.policy(now).waiverVersion,
        joinEntryId: raceEnrollmentId(f.eventId, owner),
        canJoin: true, enrollment: null, entry: null }] });
    expect(snapshot()).toBe(before); expect(auth.getUser.mock.calls).toEqual([[owner]]);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { readOnly: true });
    expect(JSON.stringify(view)).not.toMatch(/runnerUid|creditOwnerUid|recipientUid|confirmedCount|capacity|email|originalWaiver|recipientWaiver/);
  });
  test.each([
    [{ status: 'cancelled' }, {}, 'cancelled'], [{}, { opensAtMs: 1700000000001 }, 'not_open_yet'],
    [{}, { closesAtMs: 1700000000000 }, 'ended'], [{ confirmedCount: 1 }, {}, 'full'],
  ])('server signup availability closes new joins without changing history %#', async (event, policy, expected) => {
    docs.set(`communityRaceEvents/${f.eventId}`, { ...f.event(now), ...event });
    docs.set(`communityRacePolicies/${f.eventId}`, { ...f.policy(now), ...policy });
    const before = snapshot(); expect((await read()).events[0]).toMatchObject({ signupStatus: expected, canJoin: false });
    expect(snapshot()).toBe(before);
  });
  test('only own signup projects; cancellation exposes fictional credits and never restores enrollment', async () => {
    const entryId = await joined(); const before = snapshot();
    expect((await read()).events[0]).toMatchObject({ canJoin: false, enrollment: { status: 'confirmed', revision: 1 },
      entry: { entryId, isCurrentRunner: true, isOriginalCreditOwner: true, canCancel: true, canOffer: true, canRevoke: false } });
    expect((await read(outsider)).events[0]).toMatchObject({ enrollment: null, entry: null });
    expect(snapshot()).toBe(before);
    await execute(owner, change(entryId, 'simulate_refund'));
    expect((await read()).events[0]).toMatchObject({ canJoin: false, signupStatus: 'open', enrollment: { status: 'cancelled' },
      entry: { status: 'cancelled', fictionalReturnedCents: 1000, canCancel: false, canOffer: false, canRevoke: false } });
  });
  test('incoming is exact named offer only, original owner sees no recipient details; transferred history remains private', async () => {
    const entryId = await joined(); await execute(owner, change(entryId, 'offer_transfer', 1, { recipientUid: recipient }));
    const before = snapshot(); const own = await read(); const incoming = await read(recipient, entryId);
    expect(own.events[0].entry).toMatchObject({ canCancel: false, canOffer: false, canRevoke: true, offerExpiresAtMs: now + 300000 });
    expect((await read(recipient)).incoming).toBeNull();
    expect(incoming.events[0].entry).toBeNull();
    expect(incoming.incoming).toMatchObject({ eventId: f.eventId, eventRevision: 2, entryId, revision: 2, canAccept: true,
      isCurrentRunner: false, isOriginalCreditOwner: false, canCancel: false, canOffer: false, canRevoke: false });
    expect(JSON.stringify([own, incoming])).not.toContain(owner); expect(JSON.stringify([own, incoming])).not.toContain(recipient);
    expect(snapshot()).toBe(before);
    await execute(recipient, f.command(recipient, 'accept_transfer', { entryId, expectedEventRevision: 2, expectedEntryRevision: 2 }));
    expect((await read()).events[0]).toMatchObject({ canJoin: false, enrollment: { status: 'transferred' },
      entry: { isCurrentRunner: false, isOriginalCreditOwner: true, canCancel: false, canOffer: false } });
    expect((await read(recipient)).events[0]).toMatchObject({ canJoin: false, enrollment: { status: 'confirmed' },
      entry: { isCurrentRunner: true, isOriginalCreditOwner: false, transferCount: 1, canCancel: true, canOffer: false } });
    await denied(recipient, entryId);
  });
  test('missing and existing unrelated incoming IDs have indistinguishable fixed denial', async () => {
    const entryId = await joined(); await execute(owner, change(entryId, 'offer_transfer', 1, { recipientUid: recipient }));
    const missing = await read(outsider, 'stage_race_missing').catch(error => error);
    const unrelated = await read(outsider, entryId).catch(error => error);
    expect([missing.code, missing.message]).toEqual([unrelated.code, unrelated.message]);
    expect(missing.code).toBe('permission-denied');
  });
  test('expired offer cannot be accepted; owner status/revoke survives removed recipient', async () => {
    const entryId = await joined(); await execute(owner, change(entryId, 'offer_transfer', 1, { recipientUid: recipient }));
    now += 300000; await denied(recipient, entryId);
    docs.delete(`communityRaceTargets/${recipient}`); auth.getUser.mockClear();
    const before = snapshot(); expect((await read()).events[0].entry.canRevoke).toBe(true);
    expect(auth.getUser.mock.calls).toEqual([[owner]]); expect(snapshot()).toBe(before);
    await execute(owner, change(entryId, 'revoke_transfer', 2));
    expect((await read()).events[0].entry.canCancel).toBe(true);
  });
  test('cancelled event still permits own simulated cancellation, not transfer or joining', async () => {
    const entryId = await joined(); docs.get(`communityRaceEvents/${f.eventId}`).status = 'cancelled';
    expect((await read()).events[0]).toMatchObject({ signupStatus: 'cancelled', canJoin: false,
      entry: { canCancel: true, canOffer: false } });
    await execute(owner, change(entryId, 'simulate_refund'));
  });
  test.each(['communityRacePermissions', 'communityRaceTargets'])('revoked/expired authority fails before lookup and leaves everything unchanged: %s', async root => {
    for (const invalid of [{ enabled: false }, { expiresAtMs: now }, { manageOwnEntry: false }, { extra: true }]) {
      docs.set(`${root}/${owner}`, { ...(root === 'communityRacePermissions' ? f.permission(owner, now) : f.marker(owner, now)), ...invalid });
      await denied(); expect(auth.getUser).not.toHaveBeenCalled();
    }
  });
  test.each(['unverified', 'disabled', 'missing', 'mismatched'])('current native caller metadata denies status: %s', async state => {
    auth.getUser.mockImplementation(async uid => {
      if (state === 'missing') throw Error('private synthetic provider response');
      return { uid: state === 'mismatched' ? recipient : uid, emailVerified: state !== 'unverified', disabled: state === 'disabled' };
    }); await denied();
  });
  test('slow final read fences exact permission expiry and uses fresh availability time', async () => {
    const original = db.runTransaction; let delay = true;
    db.runTransaction = fn => original(tx => fn({ ...tx, getAll: async (...refs) => {
      const value = await tx.getAll(...refs); if (delay && refs.some(ref => ref.path.startsWith('communityRaceEvents/'))) now += 1000;
      return value;
    } }));
    docs.get(`communityRacePermissions/${owner}`).expiresAtMs = now + 1000; await denied();
    docs.set(`communityRacePermissions/${owner}`, f.permission(owner, now));
    docs.get(`communityRacePolicies/${f.eventId}`).closesAtMs = now + 1000;
    expect((await read()).events[0]).toMatchObject({ signupStatus: 'ended', canJoin: false }); delay = false;
  });
  test.each([null, [], {}, { schemaVersion: 1, simulationOnly: true, policyVersion: POLICY, eventIds: [f.eventId, f.eventId] },
    { schemaVersion: 1, simulationOnly: true, policyVersion: POLICY, eventIds: Array.from({ length: 21 }, (_, n) => `stage_race_${n}`) },
    { schemaVersion: 1, simulationOnly: true, policyVersion: POLICY, eventIds: ['production-race'] }])('malformed/missing/oversized manifest denies without enumeration %#', async config => {
    docs.set('communityConfig/fictionalRaces', config); await denied(); expect(auth.getUser).not.toHaveBeenCalled();
  });
  test('empty configured list returns empty, never discovers existing hidden races', async () => {
    docs.get('communityConfig/fictionalRaces').eventIds = []; const before = snapshot();
    expect(await read()).toMatchObject({ events: [], incoming: null }); expect(snapshot()).toBe(before);
  });
  test('twenty exact configured events are bounded point reads and one Auth lookup, never a query', async () => {
    const ids = Array.from({ length: 20 }, (_, n) => `stage_race_catalog_${n}`);
    docs.get('communityConfig/fictionalRaces').eventIds = ids;
    for (const eventId of ids) {
      docs.set(`communityRaceEvents/${eventId}`, { ...f.event(now), eventId });
      docs.set(`communityRacePolicies/${eventId}`, { ...f.policy(now), eventId });
    }
    db.collection = jest.fn(() => { throw Error('unexpected enumeration'); });
    const before = snapshot(); const view = await read();
    expect(view.events.map(event => event.eventId)).toEqual(ids); expect(view.events).toHaveLength(20);
    expect(new Set(view.events.map(event => event.joinEntryId)).size).toBe(20);
    expect(db.collection).not.toHaveBeenCalled(); expect(auth.getUser.mock.calls).toEqual([[owner]]);
    expect(snapshot()).toBe(before);
  });
  test.each(['event', 'policy', 'entry', 'index', 'orphan'])('bad stored binding/state fails closed: %s', async state => {
    const entryId = await joined();
    if (state === 'event') docs.get(`communityRaceEvents/${f.eventId}`).eventId = 'stage_race_other';
    if (state === 'policy') docs.get(`communityRacePolicies/${f.eventId}`).currency = 'EUR';
    if (state === 'entry') docs.get(`communityRaceEntries/${entryId}`).runnerUid = recipient;
    if (state === 'index') docs.get(`communityRaceEnrollment/${raceEnrollmentId(f.eventId, owner)}`).status = 'transferred';
    if (state === 'orphan') docs.delete(`communityRaceEntries/${entryId}`);
    await denied();
  });
  test('server read rejection is fixed and never echoes record/SDK details', async () => {
    db.runTransaction = async () => { throw Error('private record and token'); };
    await denied();
  });
  test('status parser rejects spoof/getter/extra/injection/coercion without evaluating a getter', () => {
    const getter = jest.fn(); const hostile = request(owner); Object.defineProperty(hostile, 'action', { get: getter, enumerable: true });
    for (const invalid of [hostile, request(recipient), { ...request(owner), incomingEntryId: 1 }, { ...request(owner), role: 'admin' },
      { ...request(owner), eventIds: [f.eventId] }, { ...request(owner), incomingEntryId: 'member-id' }]) {
      expect(() => parseRaceStatus(invalid, owner)).toThrow('Fictional race action unavailable.');
    }
    expect(getter).not.toHaveBeenCalled();
  });
});
