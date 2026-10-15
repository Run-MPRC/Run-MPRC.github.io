const { randomUUID } = require('node:crypto');
const { createCommunityService, parseRequest } = require('./communityActions');
const { memoryDb } = require('./testSupport/communityMemoryDb');
const { approvedMember, freeEvent } = require('./testSupport/communityFixtures');

const began = 1_800_000_000_000;
const command = (action = 'event_join', revision = 0) => parseRequest({
  action, accountUid: 'runner', requestId: randomUUID(), expectedRevision: revision,
  eventId: 'event', ...(action === 'event_join' ? { waiverVersion: 'synthetic-only-v1', waiverAccepted: true } : {}),
});
let memory; let now; let service;
beforeEach(() => {
  memory = memoryDb(); now = began;
  memory.docs.set('communityEvents/event', freeEvent(now));
  service = createCommunityService(memory.db, () => now);
});

test.each(['missing', 'pending', 'expired', 'future', 'suspended', 'ended', 'wrong_uid', 'malformed'])('new signup denies %s membership without writes', async state => {
  const record = JSON.parse(JSON.stringify(approvedMember('runner', now)));
  if (state === 'pending') { record.applicationStatus = 'pending'; record.authority = null; }
  if (state === 'expired') record.authority.term.endsAtMs = now;
  if (state === 'future') record.authority.term.startsAtMs = now + 1;
  if (['suspended', 'ended'].includes(state)) record.authority.term.state = state;
  if (state === 'wrong_uid') record.authority.association.uid = 'someone-else';
  if (state === 'malformed') record.authority.term.endsAtMs = 'invalid';
  if (state !== 'missing') memory.docs.set('communityMemberships/runner', record);
  const before = JSON.stringify([...memory.docs]);
  await expect(service.mutate('runner', command())).rejects.toBeDefined();
  expect(JSON.stringify([...memory.docs])).toBe(before);
});

test.each(['approved', 'cancellation_requested'])('current %s term permits signup without another approval', async applicationStatus => {
  memory.docs.set('communityMemberships/runner', { ...approvedMember('runner', now), applicationStatus });
  await expect(service.mutate('runner', command())).resolves.toHaveProperty('registration.status', 'confirmed');
  expect(memory.docs.get('communityEvents/event').confirmedCount).toBe(1);
});

test('expiry blocks fresh commands but preserves saved success and permits cancellation', async () => {
  memory.docs.set('communityMemberships/runner', approvedMember('runner', now));
  const join = command(); const result = await service.mutate('runner', join);
  now += 60000;
  const before = JSON.stringify([...memory.docs]);
  await expect(service.mutate('runner', join)).resolves.toEqual(result);
  await expect(service.mutate('runner', command('event_join', 1))).rejects.toBeDefined();
  expect(JSON.stringify([...memory.docs])).toBe(before);
  const cancel = command('event_cancel', 1);
  await service.mutate('runner', cancel); await service.mutate('runner', cancel);
  expect(memory.docs.get('communityEvents/event').confirmedCount).toBe(0);
  expect(memory.docs.get('communityEvents/event/registrations/runner')).toMatchObject({ status: 'cancelled', revision: 2 });
});

test('suspension does not trap an existing registration', async () => {
  const member = JSON.parse(JSON.stringify(approvedMember('runner', now)));
  memory.docs.set('communityMemberships/runner', member);
  await service.mutate('runner', command());
  member.authority.term.state = 'suspended';
  await expect(service.mutate('runner', command('event_cancel', 1))).resolves.toHaveProperty('registration.status', 'cancelled');
});

test('term expiry while transactional reads complete denies signup', async () => {
  memory.docs.set('communityMemberships/runner', approvedMember('runner', now));
  const transaction = memory.db.runTransaction;
  memory.db.runTransaction = fn => transaction(tx => fn({ ...tx, getAll: async (...refs) => {
    const result = await tx.getAll(...refs); now = began + 60000; return result;
  } }));
  const before = JSON.stringify([...memory.docs]);
  await expect(service.mutate('runner', command())).rejects.toBeDefined();
  expect(JSON.stringify([...memory.docs])).toBe(before);
});

test('forged client membership and payment fields never enter the request', () => {
  for (const field of ['entitlement', 'paid', 'role', 'membership']) {
    expect(() => parseRequest({ ...command(), [field]: 'current_member' })).toThrow();
  }
});
