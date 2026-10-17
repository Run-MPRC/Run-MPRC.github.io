import { communityFreshFor, parseCommunityResult, parseCommunityStatus } from './communityMemberStatus';

const now = 1_800_000_000_000;
const event = () => ({
 id: 'fixture-event',
schemaVersion: 1,
title: 'Synthetic event',
location: 'Synthetic place',
  startAtMs: now + 3600000,
opensAtMs: now - 1000,
closesAtMs: now + 1800000,
  status: 'open',
amountCents: 0,
capacity: 2,
confirmedCount: 0,
waiverVersion: 'synthetic-v1',
  waiverText: 'Synthetic waiver only',
waiverHash: 'a'.repeat(64),
signupStatus: 'open',
registration: { revision: 0, status: 'none' }
});
const state = () => ({
 schemaVersion: 1,
observedAtMs: now,
  membership: {
 revision: 2, applicationStatus: 'approved', entitlement: 'current_member', accessThroughMs: now + 120000
},
events: [event()]
});
test('valid server status is copied/frozen and freshness is bounded without choosing eligibility', () => {
  const input = state(); const parsed = parseCommunityStatus(input);
  expect(parsed).toEqual(input); expect(Object.isFrozen(parsed.events[0].registration)).toBe(true);
  input.membership.accessThroughMs = now + 1;
  expect(parsed.membership.accessThroughMs).toBe(now + 120000);
  expect(communityFreshFor(parsed)).toBe(60000);
});
test.each(['membership', 'opening', 'closing'])('earlier %s deadline bounds display', (deadline) => {
  const input = state();
  if (deadline === 'membership') input.membership.accessThroughMs = now + 1000;
  if (deadline === 'opening') { input.events[0].opensAtMs = now + 1000; input.events[0].signupStatus = 'not_open_yet'; }
  if (deadline === 'closing') input.events[0].closesAtMs = now + 1000;
  expect(communityFreshFor(parseCommunityStatus(input))).toBe(1000);
});
test.each([
  (value: any) => { const v = value; v.schemaVersion = 2; },
  (value: any) => { const v = value; delete v.observedAtMs; },
  (value: any) => { const v = value; v.observedAtMs = Infinity; },
  (value: any) => { const v = value; v.membership.accessThroughMs = now; },
  (value: any) => { const v = value; v.membership.entitlement = 'admin'; },
  (value: any) => { const v = value; v.membership.applicationStatus = 'pending'; },
  (value: any) => { const v = value; v.events[0].amountCents = 1; },
  (value: any) => { const v = value; v.events[0].signupStatus = 'full'; },
  (value: any) => { const v = value; v.events.push(v.events[0]); },
  (value: any) => { const v = value; v.events[0].confirmedCount = 3; },
  (value: any) => { const v = value; v.events[0].registration.status = 'paid'; },
  (value: any) => { const v = value; v.events[0].waiverHash = 'wrong'; },
  (value: any) => { const v = value; v.events[0].extra = 'private-canary'; },
  (value: any) => { const v = value; v.extra = 'private-canary'; },
  (value: any) => { const v = value; v.events[0].waiverVersion = 'x'.repeat(81); },
  (value: any) => { const v = value; v.events = Array(21).fill(event()); },
  (value: any) => { const v = value; v.events = new Array(1); },
])('rejects corrupt/foreign/bounded response without echoing it %#', (change) => {
  const input = state(); change(input);
  expect(() => parseCommunityStatus(input)).toThrow('Community status is unavailable. Refresh or sign in again.');
});
test('response getters are rejected without invocation', () => {
  const getter = jest.fn(() => 'private-canary'); const input = state();
  Object.defineProperty(input.membership, 'entitlement', { enumerable: true, get: getter });
  expect(() => parseCommunityStatus(input)).toThrow(); expect(getter).not.toHaveBeenCalled();
});
test('cancel remains representable after a term lapses or an event closes', () => {
  const input: any = state(); input.membership.entitlement = 'not_entitled'; input.membership.accessThroughMs = null;
  input.events[0].status = 'cancelled'; input.events[0].signupStatus = 'cancelled';
  input.events[0].registration = { revision: 1, status: 'confirmed' };
  expect(parseCommunityStatus(input).events[0].registration.status).toBe('confirmed');
});
test('only matching action and revision acknowledgements allow a status reread', () => {
  const request: any = { action: 'event_join', expectedRevision: 0 };
  expect(() => parseCommunityResult({ registration: { revision: 1, status: 'confirmed' } }, request)).not.toThrow();
  [{}, { registration: { revision: 99, status: 'confirmed' } },
    { registration: { revision: 1, status: 'cancelled' } }, { membership: { revision: 1, applicationStatus: 'pending' } }].forEach((result) => {
    expect(() => parseCommunityResult(result, request)).toThrow();
  });
});
