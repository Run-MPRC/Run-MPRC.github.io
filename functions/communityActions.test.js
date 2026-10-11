const { randomUUID } = require('node:crypto');
const { createCommunityService, parseRequest, assertCommunityEnvironment, communityActions } = require('./communityActions');
const { freeEvent, approvedMember } = require('./testSupport/communityFixtures');

function memoryDb() {
  const docs = new Map();
  let tail = Promise.resolve();
  const doc = (path) => ({ path, collection: (name) => ({ doc: (id) => doc(`${path}/${name}/${id}`) }) });
  const get = async (ref) => ({ exists: docs.has(ref.path), data: () => docs.get(ref.path) });
  const db = {
    doc, getAll: (...refs) => Promise.all(refs.map(get)),
    runTransaction: (fn) => {
      const result = tail.then(async () => {
        const writes = [];
        const output = await fn({ get, getAll: (...refs) => Promise.all(refs.map(get)),
          set: (ref, value) => writes.push([ref.path, value]),
          create: (ref, value) => { if (docs.has(ref.path)) throw new Error('exists'); writes.push([ref.path, value]); },
        });
        writes.forEach(([path, value]) => docs.set(path, JSON.parse(JSON.stringify(value))));
        return output;
      });
      tail = result.catch(() => undefined);
      return result;
    },
  };
  return { db, docs };
}
const request = (action, expectedRevision = 0, extra = {}) => parseRequest({ action, accountUid: 'runner-a', requestId: randomUUID(), expectedRevision, ...extra });
const joining = (revision = 0) => request('event_join', revision, { eventId: 'one-seat', waiverVersion: 'synthetic-only-v1', waiverAccepted: true });

describe('staging-only community boundary', () => {
  test('native App Check and bounded cold-start settings are mandatory', () => {
    expect(communityActions.__endpoint).toMatchObject({ minInstances: 0, maxInstances: 2, availableMemoryMb: 256, timeoutSeconds: 30 });
    expect(communityActions.__endpoint.callableTrigger).toMatchObject({});
  });
  test.each(['mid-peninsula-running-club', '', 'demo-test'])('rejects non-staging or incomplete emulator project %s', (project) => {
    expect(() => assertCommunityEnvironment({ GCLOUD_PROJECT: project, COMMERCE_ENABLED: 'false' })).toThrow();
  });
  test('accepts only staging with commerce disabled, or all local emulator hosts', () => {
    expect(() => assertCommunityEnvironment({ GCLOUD_PROJECT: 'run-mprc-staging', COMMERCE_ENABLED: 'false' })).not.toThrow();
    expect(() => assertCommunityEnvironment({ GCLOUD_PROJECT: 'run-mprc-staging', COMMERCE_ENABLED: 'true' })).toThrow();
    expect(() => assertCommunityEnvironment({ GCLOUD_PROJECT: 'demo-test', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' })).not.toThrow();
  });
  test.each([null, [], { action: 'status', uid: 'other' }, { action: 'membership_join' }, { action: 'event_join', requestId: randomUUID(), expectedRevision: 0, eventId: 'one-seat', waiverAccepted: false }])('rejects malformed or forged input %#', (input) => {
    expect(() => parseRequest(input)).toThrow('Request is invalid.');
  });
  test('rejects getters without executing them', () => {
    const getter = jest.fn();
    expect(() => parseRequest(Object.defineProperty({}, 'action', { get: getter, enumerable: true }))).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});

describe('transactional membership and free-event lifecycle', () => {
  let docs; let service; let now;
  beforeEach(() => {
    const memory = memoryDb(); docs = memory.docs; now = 1_800_000_000_000;
    service = createCommunityService(memory.db, () => now);
    docs.set('communityConfig/events', { schemaVersion: 1, eventIds: ['one-seat'] });
    docs.set('communityEvents/one-seat', freeEvent(now));
  });
  test('membership signup is pending, retry-safe, and grants no entitlement', async () => {
    const command = request('membership_join');
    await expect(service.mutate('runner-a', command)).resolves.toEqual({ membership: { revision: 1, applicationStatus: 'pending' } });
    await expect(service.mutate('runner-a', command)).resolves.toEqual({ membership: { revision: 1, applicationStatus: 'pending' } });
    expect((await service.status('runner-a')).membership.entitlement).toBe('not_entitled');
    expect(docs.get('communityMemberships/runner-a').authority).toBeNull();
  });
  test('withdrawal and rejoining fence stale cancellation and old replay', async () => {
    await service.mutate('runner-a', request('membership_join'));
    const cancel = request('membership_cancel', 1);
    await service.mutate('runner-a', cancel);
    await service.mutate('runner-a', request('membership_join', 2));
    await service.mutate('runner-a', cancel); // Original result, no new mutation.
    expect(docs.get('communityMemberships/runner-a')).toMatchObject({ revision: 3, applicationStatus: 'pending' });
    await expect(service.mutate('runner-a', request('membership_cancel', 1))).rejects.toHaveProperty('code', 'failed-precondition');
  });
  test('paid-term cancellation preserves evidence and access until the exact end', async () => {
    const member = approvedMember('runner-a', now);
    docs.set('communityMemberships/runner-a', member);
    await service.mutate('runner-a', request('membership_cancel', 1));
    expect(docs.get('communityMemberships/runner-a').authority).toEqual(member.authority);
    expect((await service.status('runner-a')).membership).toMatchObject({ applicationStatus: 'cancellation_requested', entitlement: 'current_member', accessThroughMs: now + 60000 });
    now += 60000;
    expect((await service.status('runner-a')).membership.entitlement).toBe('not_entitled');
  });
  test('changed payload under a request ID conflicts; field order does not', async () => {
    const command = request('membership_join');
    await service.mutate('runner-a', command);
    await expect(service.mutate('runner-a', { expectedRevision: 0, accountUid: command.accountUid, requestId: command.requestId, action: command.action })).resolves.toHaveProperty('membership.revision', 1);
    await expect(service.mutate('runner-a', { ...command, action: 'membership_cancel' })).rejects.toHaveProperty('code', 'already-exists');
  });
  test('20 concurrent final-seat attempts confirm exactly one', async () => {
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, n) => service.mutate(`runner-${n}`, joining())));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(docs.get('communityEvents/one-seat').confirmedCount).toBe(1);
  });
  test('cancel releases once, even when closed, and cannot undo a later rejoin', async () => {
    await service.mutate('runner-a', joining());
    const cancel = request('event_cancel', 1, { eventId: 'one-seat' });
    docs.get('communityEvents/one-seat').status = 'closed';
    await service.mutate('runner-a', cancel);
    await service.mutate('runner-a', cancel);
    expect(docs.get('communityEvents/one-seat').confirmedCount).toBe(0);
    docs.get('communityEvents/one-seat').status = 'open';
    await service.mutate('runner-a', joining(2));
    await service.mutate('runner-a', cancel);
    expect(docs.get('communityEvents/one-seat').confirmedCount).toBe(1);
    expect(docs.get('communityEvents/one-seat/registrations/runner-a').status).toBe('confirmed');
    await expect(service.mutate('runner-a', request('event_cancel', 1, { eventId: 'one-seat' }))).rejects.toHaveProperty('code', 'failed-precondition');
  });
  test.each([{ amountCents: 1 }, { status: 'closed' }, { closesAtMs: 1_800_000_000_000 }, { waiverHash: 'forged' }, { confirmedCount: -1 }])('denies paid/closed/expired/corrupt events without writes %#', async (extra) => {
    docs.set('communityEvents/one-seat', freeEvent(now, extra));
    await expect(service.mutate('runner-a', joining())).rejects.toBeDefined();
    expect(docs.has('communityEvents/one-seat/registrations/runner-a')).toBe(false);
    expect(docs.has('communityLimits/runner-a')).toBe(false);
  });
  test('requires exact server waiver version and never creates paid state', async () => {
    await expect(service.mutate('runner-a', { ...joining(), waiverVersion: 'old-version' })).rejects.toHaveProperty('code', 'failed-precondition');
    await service.mutate('runner-a', joining());
    expect(docs.get('communityEvents/one-seat/registrations/runner-a')).toMatchObject({ paymentStatus: 'not_required', waiverVersion: 'synthetic-only-v1' });
  });
  test('status includes only the caller registration, not another runner', async () => {
    await service.mutate('runner-a', joining());
    expect((await service.status('runner-b')).events[0].registration.status).toBe('none');
  });
  test('write failure rolls back all effects and a retry remains safe', async () => {
    const memory = memoryDb(); const command = request('membership_join');
    const original = memory.db.runTransaction;
    memory.db.runTransaction = () => Promise.reject(new Error('synthetic outage'));
    const failing = createCommunityService(memory.db, () => now);
    await expect(failing.mutate('runner-a', command)).rejects.toThrow();
    expect(memory.docs.size).toBe(0);
    memory.db.runTransaction = original;
    await expect(failing.mutate('runner-a', command)).resolves.toHaveProperty('membership.revision', 1);
  });
});
