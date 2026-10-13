const { reduceFictionalRace, POLICY, WAIVER } = require('./fictionalRaceTransitions');
const now = 1700000000000;
const owner = 'stage_race_owner';
const recipient = 'stage_race_recipient';
function fixture() {
  return {
    event: { schemaVersion: 1, simulationOnly: true, policyVersion: POLICY, eventId: 'stage_race_event',
      revision: 1, startAtMs: now + 60000, status: 'open', capacity: 1, confirmedCount: 1 },
    entry: { schemaVersion: 1, simulationOnly: true, policyVersion: POLICY,
      eventId: 'stage_race_event', entryId: 'stage_race_entry', revision: 1, bibId: 'stage_race_bib',
      runnerUid: owner, creditOwnerUid: owner, fictionalAmountCents: 1000, fictionalReturnedCents: 0,
      currency: 'USD', status: 'confirmed', transferCount: 0,
      originalWaiver: { uid: owner, version: WAIVER, acceptedAtMs: now - 1000 }, recipientWaiver: null, offer: null },
  };
}
function command(action, extra = {}) {
  return { action, eventId: 'stage_race_event', entryId: 'stage_race_entry',
    expectedEventRevision: 1, expectedEntryRevision: 1, ...extra };
}
const offer = () => command('offer_transfer', { recipientUid: recipient, expiresAtMs: now + 30000 });
function apply(state, cmd, uid = owner, at = now) {
  return reduceFictionalRace(state.event, state.entry, cmd, uid, at);
}
function rejects(state, cmd, uid = owner, at = now) {
  const before = JSON.stringify(state);
  expect(() => apply(state, cmd, uid, at)).toThrow('Fictional race transition unavailable.');
  expect(JSON.stringify(state)).toBe(before);
}

describe('inert fictional race transition foundation', () => {
  test('full fictional return cancels one entry and releases one seat without changing original evidence', () => {
    const state = fixture(); const original = JSON.stringify(state);
    const next = apply(state, command('simulate_refund'));
    expect(next.event).toEqual({ ...state.event, revision: 2, confirmedCount: 0 });
    expect(next.entry).toEqual({ ...state.entry, revision: 2, status: 'cancelled', fictionalReturnedCents: 1000 });
    expect(next.entry.creditOwnerUid).toBe(owner);
    expect(JSON.stringify(state)).toBe(original);
    expect(next.simulationOnly).toBe(true);
    expect(next).not.toHaveProperty('paymentStatus');
    rejects(next, command('simulate_refund'));
    rejects(next, command('simulate_refund', { expectedEventRevision: 2, expectedEntryRevision: 2 }));
  });

  test('cancelled organizer event permits a fictional return, not a transfer', () => {
    const state = fixture(); state.event.status = 'cancelled';
    expect(apply(state, command('simulate_refund')).event.confirmedCount).toBe(0);
    rejects(state, offer());
  });

  test('offer does not change runner, original credit, evidence, bib or capacity', () => {
    const state = fixture(); const next = apply(state, offer());
    expect(next.event).toEqual(state.event);
    expect(next.entry).toEqual({ ...state.entry, revision: 2, offer: { recipientUid: recipient, expiresAtMs: now + 30000 } });
    rejects(next, command('simulate_refund', { expectedEntryRevision: 2 }));
    rejects(next, { ...offer(), expectedEntryRevision: 2 });
  });

  test('only named recipient accepting the exact fictional waiver transfers one bib, with no extra seat', () => {
    const state = apply(fixture(), offer());
    const cmd = command('accept_transfer', { expectedEntryRevision: 2, waiverVersion: WAIVER });
    const next = apply(state, cmd, recipient);
    expect(next.event).toEqual(state.event);
    expect(next.entry).toEqual({ ...state.entry, revision: 3, runnerUid: recipient, transferCount: 1,
      recipientWaiver: { uid: recipient, version: WAIVER, acceptedAtMs: now }, offer: null });
    rejects(state, cmd, owner);
    rejects(state, cmd, 'stage_race_stranger');
    rejects(state, { ...cmd, waiverVersion: 'real-waiver' }, recipient);
    rejects(next, cmd, recipient);
    rejects(next, command('offer_transfer', { expectedEntryRevision: 3, recipientUid: owner, expiresAtMs: now + 30000 }), recipient);
    rejects(next, command('simulate_refund', { expectedEntryRevision: 3 }), owner);
    const cancelled = apply(next, command('simulate_refund', { expectedEntryRevision: 3 }), recipient);
    expect(cancelled.entry.creditOwnerUid).toBe(owner);
    expect(cancelled.entry.originalWaiver).toEqual(fixture().entry.originalWaiver);
    expect(cancelled.entry.recipientWaiver).toEqual(next.entry.recipientWaiver);
    expect(cancelled.entry.fictionalReturnedCents).toBe(1000);
    expect(cancelled.event.confirmedCount).toBe(0);
  });

  test('revocation is owner-only, preserves evidence and makes old acceptance stale', () => {
    const state = apply(fixture(), offer());
    const revoked = apply(state, command('revoke_transfer', { expectedEntryRevision: 2 }));
    expect(revoked.entry.offer).toBeNull();
    expect(revoked.event).toEqual(state.event);
    rejects(state, command('revoke_transfer', { expectedEntryRevision: 2 }), recipient);
    rejects(revoked, command('accept_transfer', { expectedEntryRevision: 2, waiverVersion: WAIVER }), recipient);
  });

  test.each([0, 29999])('accept before exclusive offer end %i', offset => {
    const state = apply(fixture(), offer());
    expect(apply(state, command('accept_transfer', { expectedEntryRevision: 2, waiverVersion: WAIVER }), recipient, now + offset).entry.runnerUid).toBe(recipient);
  });
  test.each([30000, 60000])('expired offer rejects acceptance at %i', offset => {
    const state = apply(fixture(), offer());
    rejects(state, command('accept_transfer', { expectedEntryRevision: 2, waiverVersion: WAIVER }), recipient, now + offset);
  });
  test('expired offer may be explicitly revoked then refunded before race start', () => {
    const state = apply(fixture(), offer());
    const revoked = apply(state, command('revoke_transfer', { expectedEntryRevision: 2 }), owner, now + 30000);
    expect(apply(revoked, command('simulate_refund', { expectedEntryRevision: 3 }), owner, now + 30000).entry.status).toBe('cancelled');
  });

  test.each(['simulate_refund', 'offer_transfer', 'accept_transfer', 'revoke_transfer'])('race start denies %s', action => {
    const state = ['accept_transfer', 'revoke_transfer'].includes(action) ? apply(fixture(), offer()) : fixture();
    const cmd = action === 'offer_transfer' ? offer() : command(action, { expectedEntryRevision: state.entry.revision,
      ...(action === 'accept_transfer' ? { waiverVersion: WAIVER } : {}) });
    rejects(state, cmd, action === 'accept_transfer' ? recipient : owner, now + 60000);
  });

  test.each([-1, 0, 1.5, NaN, Infinity, 10001, Number.MAX_SAFE_INTEGER])('invalid fictional cents %s', amount => {
    const state = fixture(); state.entry.fictionalAmountCents = amount;
    rejects(state, command('simulate_refund'));
  });
  test.each([1, 10000])('inclusive fictional cents %i', amount => {
    const state = fixture(); state.entry.fictionalAmountCents = amount;
    expect(apply(state, command('simulate_refund')).entry.fictionalReturnedCents).toBe(amount);
  });
  test.each([
    ['simulationOnly', false], ['schemaVersion', 2], ['policyVersion', 'real'], ['currency', 'usd'],
    ['runnerUid', 'real-member'], ['creditOwnerUid', recipient], ['status', 'paid'], ['fictionalReturnedCents', 1],
    ['transferCount', 2], ['revision', 1000000], ['paymentStatus', 'paid'], ['stripePaymentIntentId', 'pi_fake'],
  ])('rejects foreign or inconsistent entry %s', (key, value) => {
    const state = fixture(); state.entry[key] = value; rejects(state, command('simulate_refund'));
  });
  test.each([
    ['simulationOnly', false], ['confirmedCount', 0], ['capacity', 0], ['status', 'closed'],
    ['eventId', 'stage_race_wrong'], ['revision', 1000000], ['confirmedCount', 2], ['startAtMs', -1],
  ])('rejects invalid event %s', (key, value) => {
    const state = fixture(); state.event[key] = value; rejects(state, command('simulate_refund'));
  });
  test.each(['amountCents', 'currency', 'admin', 'paid', 'newRunner', 'reason', 'requestId'])('request injection %s', key => {
    rejects(fixture(), { ...command('simulate_refund'), [key]: 'untrusted' });
  });
  test.each([undefined, null, [], 'refund', Object.create({ action: 'simulate_refund' })])('malformed command %s', cmd => {
    rejects(fixture(), cmd);
  });
  test('hostile getters and proxies are never evaluated or echoed', () => {
    const getter = jest.fn(() => { throw Error('private synthetic value'); });
    const cmd = command('simulate_refund'); Object.defineProperty(cmd, 'action', { get: getter, enumerable: true });
    rejects(fixture(), cmd); expect(getter).not.toHaveBeenCalled();
    rejects(fixture(), new Proxy(command('simulate_refund'), { get: getter }));
    expect(getter).not.toHaveBeenCalled();
  });
  test.each([now - 1, now + 60001, now + 300000, now + 1.5])('invalid offer deadline %s', expiresAtMs => {
    rejects(fixture(), { ...offer(), expiresAtMs });
  });
  test('wrong caller, self transfer, stale revisions and mismatched target deny unchanged', () => {
    rejects(fixture(), command('simulate_refund'), recipient);
    rejects(fixture(), { ...offer(), recipientUid: owner });
    rejects(fixture(), command('simulate_refund', { expectedEntryRevision: 0 }));
    rejects(fixture(), command('simulate_refund', { expectedEventRevision: 0 }));
    rejects(fixture(), command('simulate_refund', { entryId: 'stage_race_wrong' }));
    rejects(fixture(), command('unknown'));
  });
  test.each([-1, 1.5, NaN, Infinity, 8640000000000001])('unusable server time %s', at => {
    rejects(fixture(), command('simulate_refund'), owner, at);
  });
  test('revision ceiling cannot produce an unreadable next record', () => {
    const state = fixture(); state.entry.revision = 999999;
    rejects(state, command('simulate_refund', { expectedEntryRevision: 999999 }));
    state.entry.revision = 999998;
    expect(apply(state, command('simulate_refund', { expectedEntryRevision: 999998 })).entry.revision).toBe(999999);
  });
  test('changed event revision or organizer cancellation blocks pending recipient acceptance', () => {
    const offered = apply(fixture(), offer());
    const state = { event: { ...offered.event, revision: 2 }, entry: offered.entry };
    const cmd = command('accept_transfer', { expectedEntryRevision: 2, waiverVersion: WAIVER });
    rejects(state, cmd, recipient);
    state.event.status = 'cancelled';
    rejects(state, { ...cmd, expectedEventRevision: 2 }, recipient);
  });
  test.each([
    ['originalWaiver', { uid: recipient, version: WAIVER, acceptedAtMs: now }],
    ['originalWaiver', { uid: owner, version: WAIVER, acceptedAtMs: now + 1 }],
    ['recipientWaiver', { uid: owner, version: WAIVER, acceptedAtMs: now }],
    ['offer', { recipientUid: owner, expiresAtMs: now + 30000 }],
    ['offer', { recipientUid: recipient, expiresAtMs: now + 60001 }],
    ['offer', { recipientUid: recipient, expiresAtMs: now + 30000, email: 'fictional@example.invalid' }],
  ])('rejects malformed nested evidence %s', (key, value) => {
    const state = fixture(); state.entry[key] = value; rejects(state, command('simulate_refund'));
  });
});
