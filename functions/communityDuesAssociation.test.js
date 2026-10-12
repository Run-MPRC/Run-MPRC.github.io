const { randomUUID } = require('node:crypto');
const { memoryDb } = require('./testSupport/communityMemoryDb');
const { createCommunityService, parseRequest, memberView, eventView } = require('./communityActions');
const { createAdministrationService, parseAdminRequest, readCapabilities } = require('./communityAdministration');
const { createDuesReceipt, duesId } = require('./communityDues');
const { readDisposableTarget, linkedReceipt } = require('./communityDuesAssociation');
const now = 1800000000000;
const token = { email_verified: true, auth_time: now / 1000, firebase: { sign_in_second_factor: 'totp' } };
const caps = { schemaVersion: 3, enabled: true, revision: 1, expiresAtMs: now + 3600000,
  membershipApproval: false, freeEventManagement: false, duesRecording: false, membershipAssociation: true };
const policy = { schemaVersion: 1, syntheticOnly: true, policyVersion: 'fictional-external-dues-v1', revision: 1,
  amountCents: 100, currency: 'USD', method: 'fictional_external', termId: 'fictional-term', startsAtMs: now - 1000, endsAtMs: now + 60000 };
const marker = (uid = 'runner') => ({ schemaVersion: 1, syntheticOnly: true, enabled: true, uid, revision: 1, expiresAtMs: now + 3600000 });
const pending = () => ({ schemaVersion: 1, revision: 1, applicationStatus: 'pending', authority: null });
const receipt = () => {
  const confirmationId = randomUUID();
  return createDuesReceipt('officer', caps, token, { requestId: randomUUID(), confirmationId, policyRevision: 1 }, policy, now);
};
let docs; let db; let service; let members; let auth; let original; let membershipId;
beforeEach(() => {
  ({ docs, db } = memoryDb()); original = receipt(); membershipId = original.membershipId;
  docs.set(`communityDues/${membershipId}`, original);
  docs.set('communityOfficers/officer', caps);
  docs.set('communityMemberships/runner', pending());
  docs.set('communityAssociationTargets/runner', marker());
  auth = { getUser: jest.fn(async uid => ({ uid, emailVerified: true, disabled: false })) };
  service = createAdministrationService(db, auth, { memberView, eventView }, () => now);
  members = createCommunityService(db, () => now);
});
const command = (extra = {}) => parseAdminRequest({ action: 'admin_dues_link', accountUid: 'officer',
  requestId: randomUUID(), expectedRevision: 1, reason: 'synthetic_staging_review', membershipId,
  targetUid: 'runner', associationConfirmed: true, ...extra });
const execute = (request = command(), credentials = token) => service.execute('officer', credentials, request);
const status = () => execute(parseAdminRequest({ action: 'admin_status', accountUid: 'officer' }));

test('atomic link/activation preserves immutable evidence, term, profile and claims; replay never rewrites', async () => {
  const request = command(); const result = await execute(request);
  const after = JSON.stringify([...docs]);
  expect(await execute(request)).toEqual(result); expect(JSON.stringify([...docs])).toBe(after);
  expect(docs.get(`communityDues/${membershipId}`)).toEqual(original);
  expect(docs.get('communityMemberships/runner').authority.term).toEqual(original.authority.term);
  expect((await members.status('runner')).membership).toEqual({ revision: 2, applicationStatus: 'approved', entitlement: 'current_member', accessThroughMs: policy.endsAtMs });
  expect((await members.status('wrong-account')).membership.entitlement).toBe('not_entitled');
  expect(docs.get(`communityDuesLinks/${membershipId}`)).toMatchObject({ uid: 'runner', membershipId, revision: 1, syntheticOnly: true });
  expect(docs.get(`communityOfficerCommands/officer/requests/${request.requestId}`)).toMatchObject({ capability: 'membershipAssociation', targetUid: 'runner', targetId: membershipId, before: { linked: false }, after: { linked: true } });
  expect(auth.getUser).toHaveBeenCalledTimes(1);
  expect([...docs.keys()].some(key => key.startsWith('members/'))).toBe(false);
  expect(JSON.stringify(result)).not.toMatch(/email|stripe|claim|targetUid|runner/i);
});
test('member cancellation preserves the original term; expiry and replay never renew or relink', async () => {
  const request = command(); await execute(request);
  const authority = docs.get('communityMemberships/runner').authority;
  await members.mutate('runner', parseRequest({ action: 'membership_cancel', accountUid: 'runner', requestId: randomUUID(), expectedRevision: 2 }));
  expect(docs.get('communityMemberships/runner').authority).toEqual(authority);
  expect((await members.status('runner')).membership).toMatchObject({ applicationStatus: 'cancellation_requested', entitlement: 'current_member', accessThroughMs: policy.endsAtMs });
  const expired = createCommunityService(db, () => policy.endsAtMs);
  expect((await expired.status('runner')).membership).toMatchObject({ entitlement: 'not_entitled', accessThroughMs: null });
  await execute(request); expect(docs.get('communityMemberships/runner').authority).toEqual(authority);
  await expect(execute(command())).rejects.toBeDefined();
});
test.each([1, 2])('old capability v%s keeps old permissions without acquiring association', async (version) => {
  const old = { ...caps, schemaVersion: version }; delete old.membershipAssociation;
  if (version === 1) delete old.duesRecording;
  docs.set('communityOfficers/officer', old);
  expect(readCapabilities(old, now).membershipAssociation).toBeUndefined();
  await expect(execute()).rejects.toHaveProperty('code', 'permission-denied');
  expect((await status()).dues).toBeUndefined();
});
test.each([null, { ...caps, enabled: false }, { ...caps, membershipAssociation: false }, { ...caps, expiresAtMs: now }, { ...caps, forged: true }, { ...caps, membershipAssociation: 'true' }])('live permission gate denies new links and old successful replay %#', async value => {
  const request = command(); await execute(request); docs.set('communityOfficers/officer', value);
  await expect(execute(request)).rejects.toHaveProperty('code', 'permission-denied');
  await expect(execute(command())).rejects.toHaveProperty('code', 'permission-denied');
});
test.each([{ ...token, email_verified: false }, { ...token, auth_time: now / 1000 - 601 }, { ...token, firebase: {} }])('requires verified recent native TOTP %#', async credentials => {
  await expect(execute(command(), credentials)).rejects.toHaveProperty('code', 'permission-denied');
});
test.each([{ amountCents: 100 }, { email: 'fictional@invalid.test' }, { role: 'member' }, { startsAtMs: now }, { associationConfirmed: false }, { targetUid: 'officer' }, { membershipId: 'email@example.invalid' }, { membershipId: [] }, { membershipId: 42 }, { expectedRevision: '1' }, { expectedRevision: 0 }])('strict link request rejects forged/coerced/unconfirmed data %#', extra => {
  expect(() => command(extra)).toThrow();
});
test.each([undefined, null, { ...marker(), syntheticOnly: false }, { ...marker(), enabled: false }, { ...marker(), uid: 'other' }, { ...marker(), expiresAtMs: now }, { ...marker(), expiresAtMs: now + 86400001 }, { ...marker(), extra: true }, { ...marker(), revision: 0 }])('only a current exact owner-marked disposable target can link %#', async value => {
  if (value === undefined) docs.delete('communityAssociationTargets/runner'); else docs.set('communityAssociationTargets/runner', value);
  await expect(execute()).rejects.toBeDefined();
  expect(auth.getUser).not.toHaveBeenCalled(); expect(docs.get('communityMemberships/runner')).toEqual(pending());
  expect(docs.has(`communityDuesLinks/${membershipId}`)).toBe(false);
});
test.each([{ uid: 'different', emailVerified: true, disabled: false }, { uid: 'runner', emailVerified: false, disabled: false }, { uid: 'runner', emailVerified: true, disabled: true }])('authoritative Auth state must match verified enabled target %#', async value => {
  auth.getUser.mockResolvedValue(value); await expect(execute()).rejects.toBeDefined();
  expect(docs.get('communityMemberships/runner')).toEqual(pending());
});
test('missing Auth account creates no partial membership/link/command/rate', async () => {
  auth.getUser.mockRejectedValue(new Error('synthetic-not-found'));
  await expect(execute()).rejects.toBeDefined();
  expect(docs.has(`communityDuesLinks/${membershipId}`)).toBe(false);
  expect(docs.has('communityOfficerLimits/officer')).toBe(false);
});
test.each(['none', 'withdrawn', 'approved', 'cancellation_requested'])('nonpending member %s cannot be restored or replaced', async applicationStatus => {
  docs.set('communityMemberships/runner', { ...pending(), applicationStatus }); await expect(execute()).rejects.toBeDefined();
});
test('absent/stale/already linked member rejects without consuming receipt', async () => {
  docs.delete('communityMemberships/runner'); await expect(execute()).rejects.toBeDefined();
  docs.set('communityMemberships/runner', pending()); await expect(execute(command({ expectedRevision: 2 }))).rejects.toBeDefined();
  docs.set('communityMemberships/runner', { ...pending(), authority: original.authority }); await expect(execute()).rejects.toBeDefined();
  expect(docs.has(`communityDuesLinks/${membershipId}`)).toBe(false);
});
test.each([false, true])('missing/nonfictional evidence never links %#', async nonfictional => {
  docs.set(`communityDues/${membershipId}`, nonfictional ? { ...original, syntheticOnly: false } : null);
  await expect(execute()).rejects.toBeDefined();
});
test.each(['suspended', 'ended', 'decision_pending'])('term state %s never activates', async state => {
  docs.set(`communityDues/${membershipId}`, { ...original, authority: { ...original.authority, term: { ...original.authority.term, state } } });
  await expect(execute()).rejects.toBeDefined();
});
test.each([now - 2000, now + 86400001])('tampered term bounds fail closed %#', async endsAtMs => {
  docs.set(`communityDues/${membershipId}`, { ...original, policy: { ...policy, endsAtMs } }); await expect(execute()).rejects.toBeDefined();
});
test('future/expired term and target marker crossing the final write fence never activate', async () => {
  for (const end of [policy.startsAtMs - 1, policy.endsAtMs]) {
    const scoped = createAdministrationService(db, auth, { memberView, eventView }, () => end);
    await expect(scoped.execute('officer', { ...token, auth_time: Math.floor(end / 1000) }, command())).rejects.toBeDefined();
  }
  const times = [now, now, now, policy.endsAtMs];
  const late = createAdministrationService(db, auth, { memberView, eventView }, () => times.shift() ?? policy.endsAtMs);
  await expect(late.execute('officer', token, command())).rejects.toBeDefined();
  expect(docs.has(`communityDuesLinks/${membershipId}`)).toBe(false);
});
test('same-command conflicting target or receipt rejects without rewriting', async () => {
  const request = command(); await execute(request);
  await expect(execute({ ...request, targetUid: 'other' })).rejects.toHaveProperty('code', 'already-exists');
  await expect(execute({ ...request, membershipId: duesId(randomUUID()) })).rejects.toHaveProperty('code', 'already-exists');
});
test('target admission expiry during authoritative Auth lookup leaves no partial activation', async () => {
  let time = now;
  docs.set('communityAssociationTargets/runner', { ...marker(), expiresAtMs: now + 100 });
  auth.getUser.mockImplementation(async uid => { time += 100; return { uid, emailVerified: true, disabled: false }; });
  const scoped = createAdministrationService(db, auth, { memberView, eventView }, () => time);
  await expect(scoped.execute('officer', token, command())).rejects.toBeDefined();
  expect(docs.has(`communityDuesLinks/${membershipId}`)).toBe(false);
  expect(docs.get('communityMemberships/runner')).toEqual(pending());
});
test('two officers cannot use one receipt for two member accounts', async () => {
  docs.set('communityOfficers/second-officer', caps); docs.set('communityMemberships/second', pending()); docs.set('communityAssociationTargets/second', marker('second'));
  const requests = [command(), command({ accountUid: 'second-officer', targetUid: 'second' })];
  const outcomes = await Promise.allSettled(requests.map(request => service.execute(request.accountUid, token, request)));
  expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1);
  expect([...docs.keys()].filter(key => key.startsWith('communityDuesLinks/'))).toHaveLength(1);
  expect([...docs].filter(([key, value]) => key.startsWith('communityMemberships/') && value.authority !== null)).toHaveLength(1);
});
test('two receipts cannot activate or replace one member account', async () => {
  const other = receipt(); docs.set(`communityDues/${other.membershipId}`, other);
  const outcomes = await Promise.allSettled([execute(), execute(command({ membershipId: other.membershipId }))]);
  expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1);
  expect([...docs.keys()].filter(key => key.startsWith('communityDuesLinks/'))).toHaveLength(1);
});
test('withdrawal and association share the same member revision fence', async () => {
  const outcomes = await Promise.allSettled([execute(), members.mutate('runner', parseRequest({ action: 'membership_cancel', accountUid: 'runner', requestId: randomUUID(), expectedRevision: 1 }))]);
  expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1);
});
test('association-only permission sees bounded link flags, no target or policy/profile/audit data', async () => {
  await execute(); const view = await status();
  expect(view.dues).toHaveLength(1); expect(view.dues[0].linked).toBe(true);
  expect(view.duesPolicy).toBeNull(); expect(view.pending).toEqual([]); expect(view.events).toEqual([]);
  expect(JSON.stringify(view.dues)).not.toMatch(/uid|runner|authority|audit|email|profile/i);
});
test('invalid stored link/marker fail closed without invoking accessor', () => {
  expect(() => linkedReceipt({}, membershipId)).toThrow(); expect(linkedReceipt(undefined, membershipId)).toBe(false);
  const getter = jest.fn(); const target = marker(); Object.defineProperty(target, 'enabled', { enumerable: true, get: getter });
  expect(() => readDisposableTarget(target, 'runner', now)).toThrow(); expect(getter).not.toHaveBeenCalled();
});
