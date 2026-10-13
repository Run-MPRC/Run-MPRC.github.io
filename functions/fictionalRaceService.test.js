const { createFictionalRaceService, raceEnvironment, parseRaceCommand } = require('./fictionalRaceService');
const { memoryDb } = require('./testSupport/communityMemoryDb');
const f = require('./testSupport/fictionalRaceFixtures');
const { WAIVER, raceEnrollmentId } = require('./fictionalRaceTransitions');
const owner = 'stage_race_owner'; const recipient = 'stage_race_recipient';
describe('fictional race transactional service (test double, not native concurrency proof)', () => {
  let docs; let db; let auth; let service; let now; let app;
  beforeEach(() => {
    ({ docs, db } = memoryDb()); now = 1700000000000;
    auth = { getUser: jest.fn(async uid => ({ uid, emailVerified: true, disabled: false })) };
    app = { options: { projectId: f.ENV.GCLOUD_PROJECT }, firestore: () => db, auth: () => auth };
    service = createFictionalRaceService(app, () => now, f.ENV);
    docs.set(`communityRaceEvents/${f.eventId}`, f.event(now));
    docs.set(`communityRacePolicies/${f.eventId}`, f.policy(now));
    for (const uid of [owner, recipient, 'stage_race_other']) {
      docs.set(`communityRaceTargets/${uid}`, f.marker(uid, now));
      docs.set(`communityRacePermissions/${uid}`, f.permission(uid, now));
    }
  });
  const run = (uid, request, atToken = null) => service.execute(uid, atToken || f.token(now), request);
  const snapshot = () => JSON.stringify([...docs].sort(([a], [b]) => a.localeCompare(b)));
  async function deny(uid, request, code, atToken = null) {
    const before = snapshot();
    await expect(run(uid, request, atToken)).rejects.toMatchObject({ message: 'Fictional race action unavailable. Refresh or sign in again.', ...(code ? { code } : {}) });
    expect(snapshot()).toBe(before);
  }
  async function joined() {
    const request = f.command(owner); const result = await run(owner, request);
    return { request, result, entryId: result.entryId };
  }
  const next = (action, entryId, revision = 1, extra = {}) => f.command(owner, action, { entryId, expectedEventRevision: 2, expectedEntryRevision: revision, ...extra });

  test('signup, full simulated return and exact old retry are immutable; no resurrected entry', async () => {
    const { request, result, entryId } = await joined();
    expect(result).toMatchObject({ simulationOnly: true, entryRevision: 1, eventRevision: 2 });
    const original = docs.get(`communityRaceEntries/${entryId}`);
    const refund = next('simulate_refund', entryId); await run(owner, refund);
    const current = docs.get(`communityRaceEntries/${entryId}`);
    expect(current).toMatchObject({ revision: 2, status: 'cancelled', fictionalReturnedCents: 1000 });
    expect(current.originalWaiver).toEqual(original.originalWaiver);
    expect(docs.get(`communityRaceEvents/${f.eventId}`).confirmedCount).toBe(0);
    const before = snapshot();
    expect(await run(owner, request)).toEqual(result); await run(owner, refund);
    expect(snapshot()).toBe(before);
    expect([...docs.keys()].filter(path => path.startsWith(`communityRaceCommands/${owner}/requests/`))).toHaveLength(2);
    expect([...docs.keys()].filter(path => path.startsWith('communityRaceAudit/'))).toHaveLength(2);
    await deny(owner, f.command(owner, 'join_simulation', { expectedEventRevision: 3 }));
  });
  test('recipient accepts one bib; original credit, original waiver and counts preserved', async () => {
    const { entryId } = await joined(); const before = docs.get(`communityRaceEntries/${entryId}`);
    const offered = await run(owner, next('offer_transfer', entryId, 1, { recipientUid: recipient }));
    expect(offered.offerExpiresAtMs).toBe(now + 300000);
    const accept = f.command(recipient, 'accept_transfer', { entryId, expectedEntryRevision: 2, expectedEventRevision: 2 });
    await run(recipient, accept);
    const entry = docs.get(`communityRaceEntries/${entryId}`);
    expect(entry).toMatchObject({ runnerUid: recipient, creditOwnerUid: owner, bibId: before.bibId, transferCount: 1 });
    expect(entry.originalWaiver).toEqual(before.originalWaiver);
    expect(entry.recipientWaiver).toEqual({ uid: recipient, version: WAIVER, acceptedAtMs: now });
    expect(docs.get(`communityRaceEnrollment/${raceEnrollmentId(f.eventId, owner)}`).status).toBe('transferred');
    expect(docs.get(`communityRaceEnrollment/${raceEnrollmentId(f.eventId, recipient)}`).entryId).toBe(entryId);
    expect(docs.get(`communityRaceEvents/${f.eventId}`).confirmedCount).toBe(1);
    const immutable = snapshot(); await run(recipient, accept); expect(snapshot()).toBe(immutable);
    await deny(owner, next('simulate_refund', entryId, 3));
    await run(recipient, f.command(recipient, 'simulate_refund', { entryId, expectedEventRevision: 2, expectedEntryRevision: 3 }));
    expect(docs.get(`communityRaceEntries/${entryId}`)).toMatchObject({ creditOwnerUid: owner, fictionalReturnedCents: 1000, status: 'cancelled' });
  });
  test('revoking an expired offer allows cancellation but never acceptance of old intent', async () => {
    const { entryId } = await joined(); await run(owner, next('offer_transfer', entryId, 1, { recipientUid: recipient }));
    now += 300000;
    await deny(recipient, f.command(recipient, 'accept_transfer', { entryId, expectedEventRevision: 2, expectedEntryRevision: 2 }));
    await run(owner, next('revoke_transfer', entryId, 2)); await run(owner, next('simulate_refund', entryId, 3));
    expect(docs.get(`communityRaceEvents/${f.eventId}`).confirmedCount).toBe(0);
  });
  test('recipient losing access cannot block read-only offer acknowledgement or owner withdrawal', async () => {
    const { entryId } = await joined();
    const offer = next('offer_transfer', entryId, 1, { recipientUid: recipient });
    const result = await run(owner, offer); const before = snapshot();
    docs.delete(`communityRaceTargets/${recipient}`);
    auth.getUser.mockImplementation(async uid => {
      if (uid === recipient) throw Error('synthetic recipient removed');
      return { uid, emailVerified: true, disabled: false };
    });
    const qualified = snapshot();
    expect(await run(owner, offer)).toEqual(result); expect(snapshot()).toBe(qualified);
    await run(owner, next('revoke_transfer', entryId, 2));
    await run(owner, next('simulate_refund', entryId, 3));
    expect(docs.get(`communityRaceEvents/${f.eventId}`).confirmedCount).toBe(0);
    expect(before).not.toBe(qualified);
  });
  test.each(['communityRacePermissions', 'communityRaceTargets'])('revocation or expiry denies saved replay: %s', async root => {
    const { request } = await joined();
    const path = `${root}/${owner}`; const previous = docs.get(path);
    docs.set(path, { ...previous, enabled: false }); await deny(owner, request, 'permission-denied');
    docs.set(path, { ...previous, expiresAtMs: now }); await deny(owner, request, 'permission-denied');
    expect([...docs.keys()].filter(path => path.startsWith('communityRaceAudit/'))).toHaveLength(1);
  });
  test.each(['missing', 'unverified', 'disabled'])('native metadata denies caller before any writes: %s', async state => {
    auth.getUser.mockImplementation(async uid => {
      if (state === 'missing') throw Error('private synthetic provider response');
      return { uid, emailVerified: state !== 'unverified', disabled: state === 'disabled' };
    });
    await deny(owner, f.command(owner));
  });
  test('unmarked targets stop before native Auth lookup, even with browser admin role', async () => {
    docs.delete(`communityRaceTargets/${owner}`);
    await deny(owner, f.command(owner), 'permission-denied', { ...f.token(now), role: 'admin', admin: true });
    expect(auth.getUser).not.toHaveBeenCalled();
  });
  test.each([null, 'stage-tenant'])('unsupported Auth tenant denies before any reads: %s', async tenant => {
    await deny(owner, f.command(owner), 'permission-denied', { ...f.token(now), firebase: { sign_in_provider: 'password', tenant } });
    expect(auth.getUser).not.toHaveBeenCalled();
  });
  test('unqualified or previously enrolled recipient cannot be offered a second place', async () => {
    const { entryId } = await joined(); docs.delete(`communityRaceTargets/${recipient}`); auth.getUser.mockClear();
    await deny(owner, next('offer_transfer', entryId, 1, { recipientUid: recipient }), 'permission-denied');
    expect(auth.getUser).not.toHaveBeenCalled();
    docs.set(`communityRaceTargets/${recipient}`, f.marker(recipient, now));
    docs.set(`communityRaceEnrollment/${raceEnrollmentId(f.eventId, recipient)}`, { unrelated: true });
    await deny(owner, next('offer_transfer', entryId, 1, { recipientUid: recipient }));
  });
  test.each(['policyVersion', 'simulationOnly', 'currency', 'fictionalAmountCents'])('malformed server price fails unchanged: %s', async key => {
    const path = `communityRacePolicies/${f.eventId}`;
    docs.set(path, { ...docs.get(path), [key]: key === 'fictionalAmountCents' ? 1.5 : 'invalid' });
    await deny(owner, f.command(owner));
  });
  test('slow Auth crosses exact permission or window deadline and cannot admit late signup', async () => {
    const target = `communityRacePermissions/${owner}`;
    docs.set(target, { ...docs.get(target), expiresAtMs: now + 1000 });
    auth.getUser.mockImplementation(async uid => { now += 1000; return { uid, emailVerified: true, disabled: false }; });
    await deny(owner, f.command(owner), 'permission-denied');
    docs.set(target, f.permission(owner, now));
    const policyPath = `communityRacePolicies/${f.eventId}`;
    docs.set(policyPath, { ...f.policy(now), closesAtMs: now + 1000 });
    await deny(owner, f.command(owner));
  });
  test('slow last database read uses fresh time before first write', async () => {
    const originalTransaction = db.runTransaction;
    const closesAt = now + 1000;
    docs.set(`communityRacePolicies/${f.eventId}`, { ...f.policy(now), closesAtMs: closesAt });
    db.runTransaction = fn => originalTransaction(tx => fn({ ...tx, get: async ref => { const result = await tx.get(ref);
      if (ref.path.startsWith('communityRacePolicies/')) now = closesAt; return result; } }));
    await deny(owner, f.command(owner));
  });
  test('changed request fingerprint, orphaned receipt or inconsistent projection is refused', async () => {
    const { request, entryId } = await joined();
    const path = `communityRaceCommands/${owner}/requests/${request.requestId}`;
    const original = docs.get(path); docs.set(path, { ...original, fingerprint: 'changed' });
    await deny(owner, request, 'already-exists'); docs.set(path, original);
    docs.set(path, { ...original, result: { ...original.result, entryRevision: 999999 } }); await deny(owner, request);
    docs.set(path, original); docs.delete(`communityRaceEntries/${entryId}`); await deny(owner, request);
  });
  test('rate bound stops new commands, but saved replay is read-only', async () => {
    const { request, entryId } = await joined(); docs.set(`communityRaceLimits/${owner}`, { window: Math.floor(now / 60000), count: 12 });
    const before = snapshot(); await run(owner, request); expect(snapshot()).toBe(before);
    await deny(owner, next('simulate_refund', entryId), 'resource-exhausted');
  });
  test('changed fictional catalog amount cannot change an existing credit return', async () => {
    const { entryId } = await joined();
    docs.set(`communityRacePolicies/${f.eventId}`, { ...f.policy(now), fictionalAmountCents: 9000 });
    await run(owner, next('simulate_refund', entryId));
    expect(docs.get(`communityRaceEntries/${entryId}`).fictionalReturnedCents).toBe(1000);
  });
  test.each(['amountCents', 'expiresAtMs', 'currency', 'admin', 'paymentStatus', 'newRunner'])('request injection %s denies before native reads', async key => {
    await deny(owner, { ...f.command(owner), [key]: 'untrusted' }, 'invalid-argument'); expect(auth.getUser).not.toHaveBeenCalled();
  });
  test.each([false, 'true', 1, null])('waiver acceptance must be exactly true: %s', async waiverAccepted => {
    await deny(owner, { ...f.command(owner), waiverAccepted }, 'invalid-argument');
  });
  test('account spoof, outsider, stale revision, wrong enrollment index and dead token deny', async () => {
    await deny(owner, f.command(recipient), 'permission-denied');
    const { entryId } = await joined();
    await deny('stage_race_other', f.command('stage_race_other', 'simulate_refund', { entryId, expectedEntryRevision: 1, expectedEventRevision: 2 }), 'permission-denied');
    await deny(owner, next('simulate_refund', entryId, 2));
    await deny(owner, next('simulate_refund', entryId), 'permission-denied', { ...f.token(now), email_verified: false });
    docs.delete(`communityRaceEnrollment/${raceEnrollmentId(f.eventId, owner)}`); await deny(owner, next('simulate_refund', entryId));
  });
  test.each([
    { GCLOUD_PROJECT: 'run-mprc-production', COMMERCE_ENABLED: 'false' },
    { GCLOUD_PROJECT: 'run-mprc-staging', COMMERCE_ENABLED: 'true' },
    { GCLOUD_PROJECT: 'demo-mprc-local', FIRESTORE_EMULATOR_HOST: 'remote:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
  ])('invalid environment cannot acquire SDK services', env => {
    const forbidden = { options: {}, firestore: jest.fn(), auth: jest.fn() };
    expect(() => createFictionalRaceService(forbidden, () => now, env)).toThrow('Fictional race action unavailable.');
    expect(forbidden.firestore).not.toHaveBeenCalled(); expect(forbidden.auth).not.toHaveBeenCalled();
  });
  test('mismatched native app and hostile request getters fail fixed and private', async () => {
    expect(() => createFictionalRaceService({ ...app, options: { projectId: 'production' } }, () => now, f.ENV)).toThrow('Fictional race action unavailable.');
    const getter = jest.fn(() => { throw Error('private synthetic exception'); });
    const input = f.command(owner); Object.defineProperty(input, 'action', { get: getter, enumerable: true });
    await deny(owner, input, 'invalid-argument'); expect(getter).not.toHaveBeenCalled();
    expect(raceEnvironment(f.ENV)).toBe('demo-mprc-local');
    expect(parseRaceCommand(f.command(owner), owner).waiverVersion).toBe(WAIVER);
  });
});
