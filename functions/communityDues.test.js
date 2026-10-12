const { randomUUID } = require('node:crypto');
const { memoryDb } = require('./testSupport/communityMemoryDb');
const { memberView, eventView } = require('./communityActions');
const { parseAdminRequest, readCapabilities, createAdministrationService } = require('./communityAdministration');
const { readDuesPolicy, duesId } = require('./communityDues');
const now = 1800000000000;
const policy = { schemaVersion: 1, syntheticOnly: true, policyVersion: 'fictional-external-dues-v1', revision: 1, amountCents: 100, currency: 'USD', method: 'fictional_external', termId: 'fictional-term', startsAtMs: now - 1000, endsAtMs: now + 60000 };
const caps = { schemaVersion: 2, enabled: true, revision: 1, expiresAtMs: now + 3600000, membershipApproval: false, freeEventManagement: false, duesRecording: true };
const token = { email_verified: true, auth_time: now / 1000, firebase: { sign_in_second_factor: 'totp' } };
const command = (extra = {}) => parseAdminRequest({ action: 'admin_dues_record', accountUid: 'officer', requestId: randomUUID(), expectedRevision: 0, reason: 'synthetic_staging_review', confirmationId: randomUUID(), externalConfirmed: true, policyRevision: 1, ...extra });
let db; let docs; let service; let auth;
beforeEach(() => {
  ({ db, docs } = memoryDb());
  auth = { getUser: jest.fn() };
  service = createAdministrationService(db, auth, { memberView, eventView }, () => now);
  docs.set('communityOfficers/officer', caps); docs.set('communityConfig/duesTestTerm', policy);
});
const execute = (request, credentials = token) => service.execute('officer', credentials, request);
test('records one audited unlinked term, retries immutably and changes no account or member state', async () => {
  const request = command(); const first = await execute(request);
  expect(await execute(request)).toEqual(first);
  const receipt = docs.get(`communityDues/${duesId(request.confirmationId)}`);
  expect(receipt.authority.association).toEqual({ state: 'unlinked', uid: null, revision: 0 });
  expect(receipt.audit.provenance).toBe('manual_off_platform');
  expect(first).toMatchObject({ dues: { amountCents: 100, currency: 'USD', linked: false }, syntheticOnly: true });
  expect(docs.get(`communityOfficerCommands/officer/requests/${request.requestId}`)).toMatchObject({ capability: 'duesRecording', actorUid: 'officer', after: { linked: false, recorded: true } });
  expect([...docs.keys()].filter((key) => key.startsWith('communityDues/'))).toHaveLength(1);
  expect([...docs.keys()].some((key) => key.startsWith('communityMemberships/') || key.startsWith('members/'))).toBe(false);
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(JSON.stringify(receipt)).not.toMatch(/stripe|checkout|paymentStatus|email/i);
});
test('different commands and officers cannot record the same confirmation twice', async () => {
  docs.set('communityOfficers/other', caps);
  const first = command(); const second = command({ accountUid: 'other', confirmationId: first.confirmationId });
  const result = await Promise.allSettled([execute(first), service.execute('other', token, second)]);
  expect(result.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
  expect([...docs.keys()].filter((key) => key.startsWith('communityDues/'))).toHaveLength(1);
});
test('conflicting command payload is rejected, policy change cannot alter a saved receipt', async () => {
  const request = command(); const first = await execute(request);
  await expect(execute({ ...request, confirmationId: randomUUID() })).rejects.toHaveProperty('code', 'already-exists');
  docs.set('communityConfig/duesTestTerm', { ...policy, revision: 2, amountCents: 250 });
  expect(await execute(request)).toEqual(first);
  await expect(execute(command())).rejects.toHaveProperty('code', 'failed-precondition');
});
test.each([{ ...caps, enabled: false }, { ...caps, expiresAtMs: now }, { ...caps, duesRecording: false }, { ...caps, schemaVersion: 1 }, { ...caps, forged: true }])('capability denies new commands and replay %#', async (value) => {
  const request = command(); await execute(request); docs.set('communityOfficers/officer', value);
  await expect(execute(request)).rejects.toHaveProperty('code', 'permission-denied');
  await expect(execute(command())).rejects.toHaveProperty('code', 'permission-denied');
});
test('old six-field capability keeps old status shape but never gains dues authority', async () => {
  const old = { ...caps, schemaVersion: 1 }; delete old.duesRecording;
  docs.set('communityOfficers/officer', old);
  expect(readCapabilities(old, now)).toEqual({ membershipApproval: false, freeEventManagement: false });
  expect(await execute(parseAdminRequest({ action: 'admin_status', accountUid: 'officer' }))).toEqual({ capabilities: { membershipApproval: false, freeEventManagement: false }, pending: [], nextCursor: null, events: [] });
  await expect(execute(command())).rejects.toHaveProperty('code', 'permission-denied');
});
test.each([{ ...token, email_verified: false }, { ...token, auth_time: now / 1000 - 601 }, { ...token, firebase: {} }])('native officer token gate still protects dues %#', async (value) => {
  await expect(execute(command(), value)).rejects.toHaveProperty('code', 'permission-denied');
});
test.each([{ amountCents: 0 }, { amountCents: 1.5 }, { amountCents: 10001 }, { currency: 'EUR' }, { syntheticOnly: false }, { method: 'bank_transfer' }, { endsAtMs: now - 2000 }, { endsAtMs: now + 86400000 }, { revision: '1' }, { policyVersion: 'real-club-policy' }, { email: 'fixture@invalid.test' }])('malformed or real policy is rejected %#', async (extra) => {
  docs.set('communityConfig/duesTestTerm', { ...policy, ...extra });
  await expect(execute(command())).rejects.toBeDefined();
});
test.each([{ amountCents: 1 }, { currency: 'USD' }, { targetUid: 'runner' }, { startsAtMs: now }, { externalConfirmed: false }, { confirmationId: 'real-bank-ref' }, { policyRevision: 0 }, { expectedRevision: 1 }])('client forged or unconfirmed request is rejected %#', (extra) => {
  expect(() => command(extra)).toThrow();
});
test('bounded paginated view contains no audit, actor, profile or authority record', async () => {
  for (let n = 0; n < 23; n++) { docs.delete('communityOfficerLimits/officer'); await execute(command()); }
  const status = await execute(parseAdminRequest({ action: 'admin_status', accountUid: 'officer' }));
  expect(status.dues).toHaveLength(20); expect(status.nextDuesCursor).toBeDefined();
  expect(status.duesPolicy.amountCents).toBe(100); expect(status.duesRecordingOpen).toBe(true);
  expect(JSON.stringify(status.dues)).not.toMatch(/audit|actor|authority|confirmationHash|email/i);
  const next = await execute(parseAdminRequest({ action: 'admin_status', accountUid: 'officer', duesCursor: status.nextDuesCursor }));
  expect(next.dues).toHaveLength(3); expect(next.nextDuesCursor).toBeNull();
});
test('missing policy still permits review, no policy creates no receipt', async () => {
  docs.delete('communityConfig/duesTestTerm');
  expect(await execute(parseAdminRequest({ action: 'admin_status', accountUid: 'officer' }))).toMatchObject({ duesPolicy: null, duesRecordingOpen: false, dues: [] });
  await expect(execute(command())).rejects.toBeDefined();
  expect([...docs.keys()].some((key) => key.startsWith('communityDues/'))).toBe(false);
});
test('policy reader rejects accessors without invoking them', () => {
  const getter = jest.fn(); const value = { ...policy }; Object.defineProperty(value, 'amountCents', { enumerable: true, get: getter });
  expect(() => readDuesPolicy(value)).toThrow(); expect(getter).not.toHaveBeenCalled();
});
