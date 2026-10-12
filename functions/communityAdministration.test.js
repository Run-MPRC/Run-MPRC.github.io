const { randomUUID } = require('node:crypto');
const { memoryDb } = require('./testSupport/communityMemoryDb');
const { freeEvent, approvedMember } = require('./testSupport/communityFixtures');
const { createCommunityService, eventView, memberView, parseRequest } = require('./communityActions');
const { parseAdminRequest, assertOfficerToken, readCapabilities, createAdministrationService } = require('./communityAdministration');
const now = 1_800_000_000_000;
const token = { email_verified: true, auth_time: now / 1000, firebase: { sign_in_second_factor: 'totp' } };
const capabilities = (extra = {}) => ({ schemaVersion: 1, enabled: true, revision: 1, expiresAtMs: now + 3600000, membershipApproval: true, freeEventManagement: true, ...extra });
const term = { schemaVersion: 1, syntheticOnly: true, policyVersion: 'synthetic-only-not-payment-evidence', termId: 'stage-term', startsAtMs: now - 1000, endsAtMs: now + 60000 };
const draft = { title: 'Synthetic event', location: 'Synthetic location', startAtMs: now + 3600000, opensAtMs: now - 1000, closesAtMs: now + 1800000, capacity: 1 };
const request = (action, extra = {}) => parseAdminRequest({ action, accountUid: 'officer', requestId: randomUUID(), expectedRevision: 0, reason: 'synthetic_staging_review', ...extra });
const approve = (extra = {}) => request('admin_membership_approve', { targetUid: 'runner', expectedRevision: 1, ...extra });
const join = (extra = {}) => parseRequest({ action: 'event_join', accountUid: 'runner', requestId: randomUUID(), expectedRevision: 0, eventId: 'event', waiverVersion: 'synthetic-only-v1', waiverAccepted: true, ...extra });
let docs; let service; let members; let auth;
beforeEach(() => {
  const memory = memoryDb(); docs = memory.docs;
  auth = { getUser: jest.fn(async (uid) => ({ uid, emailVerified: true, disabled: false })) };
  service = createAdministrationService(memory.db, auth, { memberView, eventView }, () => now);
  members = createCommunityService(memory.db, () => now);
  docs.set('communityOfficers/officer', capabilities());
  docs.set('communityConfig/approvalTestTerm', term);
  docs.set('communityConfig/events', { schemaVersion: 1, eventIds: ['event'] });
  docs.set('communityEvents/event', freeEvent(now));
  docs.set('communityMemberships/runner', { schemaVersion: 1, revision: 1, applicationStatus: 'pending', authority: null });
});
const execute = (command, credentials = token) => service.execute('officer', credentials, command);
test.each([null, {}, { ...token, email_verified: false }, { ...token, auth_time: now / 1000 - 601 }, { ...token, auth_time: now / 1000 + 31 }, { ...token, auth_time: '1800000000' }, { ...token, firebase: {} }, { ...token, firebase: { sign_in_second_factor: 'sms' } }])('denies unverified/non-TOTP/stale/malformed officer token %#', (input) => {
  expect(() => assertOfficerToken(input, now)).toThrow();
});
test.each([null, capabilities({ enabled: false }), capabilities({ expiresAtMs: now }), capabilities({ membershipApproval: 'true' }), { ...capabilities(), forged: true }])('denies missing/revoked/expired/malformed capability %#', (input) => { expect(() => readCapabilities(input, now)).toThrow(); });
test.each([
  { action: 'admin_status', accountUid: 'officer', role: 'admin' },
  { ...approve(), targetUid: {} }, { ...approve(), reason: 'real payment received' },
  { ...request('admin_event_create', { eventId: 'event', event: draft }), event: { ...draft, amountCents: 0 } },
  { ...request('admin_event_create', { eventId: 'event', event: draft }), event: { ...draft, title: '\u202eInjected' } },
  { ...request('admin_event_capacity', { eventId: 'event', capacity: 1 }), capacity: 1.5 },
])('strict request rejects forged/financial/coerced/unsafe fields %#', (value) => { expect(() => parseAdminRequest(value)).toThrow(); });
test.each([null, false, 0, 'event', []])('create/edit requires a typed event object %#', (event) => {
  for (const action of ['admin_event_create', 'admin_event_edit']) {
    expect(() => parseAdminRequest({ action, accountUid: 'officer', requestId: randomUUID(), expectedRevision: 0, reason: 'synthetic_staging_review', eventId: 'event', event })).toThrow();
  }
});
test('synthetic approval is atomic/repeat-safe, supplies no payment or Auth claims', async () => {
  const command = approve(); await execute(command); await execute(command);
  expect((await members.status('runner')).membership).toMatchObject({ revision: 2, applicationStatus: 'approved', entitlement: 'current_member', accessThroughMs: term.endsAtMs });
  const receipt = docs.get(`communityOfficerCommands/officer/requests/${command.requestId}`);
  expect(receipt).toMatchObject({ actorUid: 'officer', capability: 'membershipApproval', targetId: 'runner', before: { revision: 1 }, after: { revision: 2 }, reason: 'synthetic_staging_review' });
  expect(auth.getUser).toHaveBeenCalledTimes(1);
  expect(docs.get('communityMemberships/runner').authority.term.evidenceRef).toMatch(/^synthetic_/);
  const authority = docs.get('communityMemberships/runner').authority;
  await members.mutate('runner', parseRequest({ action: 'membership_cancel', accountUid: 'runner', requestId: randomUUID(), expectedRevision: 2 }));
  expect(docs.get('communityMemberships/runner').authority).toEqual(authority);
});
test('live capability is checked before an old successful receipt is replayed', async () => {
  const command = approve(); await execute(command);
  docs.set('communityOfficers/officer', capabilities({ enabled: false }));
  await expect(execute(command)).rejects.toHaveProperty('code', 'permission-denied');
});
test.each(['membershipApproval', 'freeEventManagement'])('other capability cannot authorize %s or expose its projection', async (missing) => {
  docs.set('communityOfficers/officer', capabilities({ [missing]: false }));
  const command = missing === 'membershipApproval' ? approve() : request('admin_event_close', { eventId: 'event' });
  await expect(execute(command)).rejects.toHaveProperty('code', 'permission-denied');
  const state = await execute(parseAdminRequest({ action: 'admin_status', accountUid: 'officer' }));
  expect(missing === 'membershipApproval' ? state.pending : state.events).toEqual([]);
  expect(auth.getUser).not.toHaveBeenCalled();
});
test.each([{ emailVerified: false, disabled: false }, { emailVerified: true, disabled: true }, { uid: 'other', emailVerified: true, disabled: false }])('target must be authoritative verified enabled Auth UID %#', async (target) => {
  auth.getUser.mockResolvedValue({ uid: 'runner', ...target });
  await expect(execute(approve())).rejects.toHaveProperty('code', 'failed-precondition');
  expect(docs.get('communityMemberships/runner').revision).toBe(1);
  expect(docs.has('communityOfficerLimits/officer')).toBe(false);
});
test.each([null, { ...term, syntheticOnly: false }, { ...term, endsAtMs: now }, { ...term, policyVersion: 'real-dues' }, { ...term, endsAtMs: now + 86400001 }])('missing/wrong/expired/real policy never activates %#', async (config) => {
  docs.set('communityConfig/approvalTestTerm', config);
  await expect(execute(approve())).rejects.toBeDefined();
  expect(docs.get('communityMemberships/runner').authority).toBeNull();
});
test('withdrawal and approval cannot both mutate one pending revision', async () => {
  const result = await Promise.allSettled([execute(approve()), members.mutate('runner', parseRequest({ action: 'membership_cancel', accountUid: 'runner', requestId: randomUUID(), expectedRevision: 1 }))]);
  expect(result.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
});
test.each(['withdrawn', 'approved', 'cancellation_requested'])('approval cannot restore non-pending/suspended existing authority %s', async (status) => {
  docs.set('communityMemberships/runner', { ...approvedMember('runner', now), applicationStatus: status });
  await expect(execute(approve())).rejects.toBeDefined();
});
test('bounded pending queue cursor projects no profiles, emails or evidence', async () => {
  for (let n = 0; n < 22; n += 1) docs.set(`communityMemberships/test-${String(n).padStart(2, '0')}`, { schemaVersion: 1, revision: 1, applicationStatus: 'pending', authority: null, email: 'synthetic-private.invalid' });
  const first = await execute(parseAdminRequest({ action: 'admin_status', accountUid: 'officer' }));
  expect(first.pending).toHaveLength(20); expect(first.nextCursor).toBeTruthy();
  expect(JSON.stringify(first.pending)).not.toContain('email');
  const next = await execute(parseAdminRequest({ action: 'admin_status', accountUid: 'officer', cursor: first.nextCursor }));
  expect(next.pending).toHaveLength(3); expect(next.nextCursor).toBeNull();
});
test('create starts closed, edit/open/close/cancel are revision-fenced and free only', async () => {
  const command = request('admin_event_create', { eventId: 'new', event: draft });
  await execute(command); await execute(command);
  expect(docs.get('communityEvents/new')).toMatchObject({ revision: 1, status: 'closed', amountCents: 0, confirmedCount: 0 });
  expect(docs.get('communityConfig/events').eventIds).toEqual(['event', 'new']);
  await execute(request('admin_event_edit', { eventId: 'new', expectedRevision: 1, event: { ...draft, title: 'Updated synthetic title' } }));
  await execute(request('admin_event_open', { eventId: 'new', expectedRevision: 2 }));
  await execute(request('admin_event_close', { eventId: 'new', expectedRevision: 3 }));
  await execute(request('admin_event_cancel', { eventId: 'new', expectedRevision: 4 }));
  await expect(execute(request('admin_event_open', { eventId: 'new', expectedRevision: 5 }))).rejects.toBeDefined();
  await expect(execute(request('admin_event_close', { eventId: 'new', expectedRevision: 1 }))).rejects.toBeDefined();
  expect(docs.get('communityEvents/new')).toMatchObject({ revision: 5, status: 'cancelled', amountCents: 0 });
});
test('changing same UUID nested event payload is a conflict', async () => {
  const command = request('admin_event_create', { eventId: 'new', event: draft });
  await execute(command);
  await expect(execute({ ...command, event: { ...draft, capacity: 2 } })).rejects.toHaveProperty('code', 'already-exists');
});
test('capacity changes preserve participant updates and cannot undercut bookings', async () => {
  await members.mutate('runner', join());
  await expect(execute(request('admin_event_edit', { eventId: 'event', event: draft }))).rejects.toBeDefined();
  await execute(request('admin_event_capacity', { eventId: 'event', capacity: 2 }));
  await members.mutate('second', join());
  await expect(execute(request('admin_event_capacity', { eventId: 'event', expectedRevision: 1, capacity: 1 }))).rejects.toBeDefined();
  expect(docs.get('communityEvents/event').confirmedCount).toBe(2);
});
test('close prevents entry but member cancellation remains possible after final event cancellation', async () => {
  await members.mutate('runner', join());
  await execute(request('admin_event_cancel', { eventId: 'event' }));
  expect(docs.get('communityEvents/event').confirmedCount).toBe(1);
  await expect(members.mutate('other', join())).rejects.toBeDefined();
  await members.mutate('runner', parseRequest({ action: 'event_cancel', accountUid: 'runner', requestId: randomUUID(), expectedRevision: 1, eventId: 'event' }));
  expect(docs.get('communityEvents/event').confirmedCount).toBe(0);
});
test('more than twenty events never creates an unlisted event', async () => {
  docs.set('communityConfig/events', { eventIds: Array.from({ length: 20 }, (_, n) => `event-${n}`) });
  await expect(execute(request('admin_event_create', { eventId: 'new', event: draft }))).rejects.toBeDefined();
  expect(docs.has('communityEvents/new')).toBe(false);
});
