'use strict';
const { randomBytes } = require('node:crypto');
const { check, hash, offers, WAIVER } = require('./testDuesPolicy');
const { deriveDuesCheckoutOrder } = require('./membershipDuesCheckout');
const { classifyVerifiedDuesPayment } = require('./membershipDuesPayment');
const { createMembershipAuthority, applyMembershipAuthorityCommand, deriveMembershipEntitlement } = require('./membershipAuthority');
const EMPTY = { schemaVersion: 1, revision: 0, applicationStatus: 'none', authority: null };
const integer = n => Number.isSafeInteger(n) && n >= 0 && n < 1_000_000;
function authorityFor(member, uid) {
  check(member.schemaVersion === 1 && integer(member.revision)
    && ['none', 'pending', 'approved', 'withdrawn', 'cancellation_requested'].includes(member.applicationStatus));
  if (member.authority) {
    check(member.authority.association.uid === uid);
    deriveMembershipEntitlement({ membershipAuthoritySchemaVersion: 1, record: member.authority, uid, asOfMs: 0 });
    return member.authority;
  }
  let record = createMembershipAuthority({ membershipAuthoritySchemaVersion: 1, membershipId: `test-${hash(uid).slice(0, 48)}`, commandId: 'test-dues-create' });
  record = applyMembershipAuthorityCommand(record, { membershipAuthoritySchemaVersion: 1, commandType: 'associate_account', commandId: 'test-dues-associate', expectedRevision: 1, uid });
  return record;
}
function view(order) {
  return order ? { id: order.id, state: order.state, offerId: order.expectation.planRef,
    amountMinor: order.expectation.expectedAmountMinor, currency: order.expectation.currency,
    endsAtMs: order.expectation.endsAtMs, familyId: order.state === 'active' ? order.familyId : null } : null;
}
function createTestDuesService({ db, auth, provider, account, clock = Date.now }) {
  check(/^acct_[A-Za-z0-9]{1,120}$/.test(account));
  const memberRef = uid => db.doc(`communityMemberships/${uid}`);
  const accountRef = uid => db.doc(`membershipTestAccounts/${uid}`);
  const orderRef = id => db.doc(`membershipTestOrders/${id}`);
  const participantRef = uid => db.doc(`membershipTestParticipants/${uid}`);
  const marked = (p, now) => p?.schemaVersion === 1 && p.synthetic === true && Number.isSafeInteger(p.expiresAtMs) && p.expiresAtMs > now;
  async function actor(uid) {
    const user = await auth.getUser(uid);
    check(user.uid === uid && user.disabled === false && user.emailVerified === true && !user.tenantId, 'permission-denied');
  }
  async function status(uid) {
    await actor(uid);
    return db.runTransaction(async tx => {
      const [a, p, m] = await tx.getAll(accountRef(uid), participantRef(uid), memberRef(uid));
      const o = a.exists ? await tx.get(orderRef(a.data().orderId)) : null;
      const now = clock(); check(marked(p.data(), now), 'permission-denied');
      const member = m.exists ? m.data() : EMPTY; const authority = authorityFor(member, uid);
      const active = deriveMembershipEntitlement({ membershipAuthoritySchemaVersion: 1, record: authority, uid, asOfMs: now }).entitlement === 'current_member';
      return { schemaVersion: 1, observedAtMs: now, offers: offers(now), waiver: WAIVER, active, accessThroughMs: active ? authority.term.endsAtMs : null, order: view(o?.data() || null) };
    });
  }
  async function rate(uid) {
    await db.runTransaction(async tx => {
      const ref = db.doc(`membershipTestLimits/${uid}`); const snap = await tx.get(ref); const window = Math.floor(clock() / 3600000);
      const count = snap.data()?.window === window ? snap.data().count : 0;
      check(integer(count) && count < 30, 'resource-exhausted'); tx.set(ref, { window, count: count + 1 });
    });
  }
  async function prepare(uid, request) {
    await actor(uid);
    const id = hash(`${uid}:${request.requestId}`); const nonce = randomBytes(16).toString('hex');
    const order = await db.runTransaction(async tx => {
      const [old, lock, m, p] = await tx.getAll(orderRef(id), accountRef(uid), memberRef(uid), participantRef(uid));
      const previous = lock.exists && lock.data().orderId !== id ? await tx.get(orderRef(lock.data().orderId)) : null;
      const now = clock(); check(marked(p.data(), now), 'permission-denied');
      if (old.exists) {
        check(old.data().uid === uid && old.data().expectation.planRef === request.offerId && old.data().waiver.version === request.waiverVersion, 'already-exists');
        return old.data();
      }
      check(!previous || (previous.exists && ['active', 'expired'].includes(previous.data().state)), 'already-exists');
      const member = m.exists ? m.data() : EMPTY; const authority = authorityFor(member, uid);
      check(authority.term.state !== 'suspended');
      const plan = offers(now).find(o => o.planRef === request.offerId); check(plan?.offerable);
      // Buying another plan in the same paid year is not a renewal or an upgrade.
      check(authority.term.termId !== plan.termId && (authority.term.endsAtMs === null || authority.term.endsAtMs <= now));
      const prepared = deriveDuesCheckoutOrder(plan, { membershipDuesCheckoutSchemaVersion: 1, membershipId: authority.membershipId,
        recordRevision: authority.revision, termRevision: authority.term.revision, activeTermId: null },
      { membershipDuesCheckoutSchemaVersion: 1, membershipId: authority.membershipId, planRef: plan.planRef, providerAccountRef: account, livemode: false, idempotencyKey: id });
      check(prepared.decision === 'prepared');
      const result = { schemaVersion: 1, id, uid, nonce, kind: plan.amountMinor === 2500 ? 'individual' : 'family', state: 'prepared',
        expectation: prepared.expectation, createdAtMs: now, retryUntilMs: now + 5 * 60_000,
        expiresAtMs: Math.floor(Math.min(now + 3600000, plan.endsAtMs) / 1000) * 1000,
        waiver: { version: WAIVER.version, hash: hash(WAIVER.text), acceptedAtMs: now },
        memberRevision: member.revision, checkoutRef: null, paymentRef: null, familyId: null };
      tx.create(orderRef(id), result); tx.set(accountRef(uid), { schemaVersion: 1, orderId: id }); return result;
    });
    return open(uid, order);
  }
  async function latest(uid) {
    return db.runTransaction(async tx => {
      const a = await tx.get(accountRef(uid)); check(a.exists); const o = await tx.get(orderRef(a.data().orderId)); check(o.exists && o.data().uid === uid); return o.data();
    });
  }
  function matches(o, observation) {
    check(observation.orderId === o.id && observation.nonce === o.nonce && observation.providerAccountRef === account
      && observation.livemode === false && observation.amountMinor === o.expectation.expectedAmountMinor && observation.currency === o.expectation.currency
      && (!o.checkoutRef || o.checkoutRef === observation.checkoutRef));
  }
  async function observe(observation) {
    const initial = await db.runTransaction(async tx => (await tx.get(orderRef(observation.orderId))).data()); check(initial);
    matches(initial, observation);
    // Authentication metadata cannot be atomically locked with Firestore. Recheck
    // immediately before the entitlement transaction, retain paid evidence on loss.
    let enabled = false; try { await actor(initial.uid); enabled = true; } catch { /* hold, never invent Auth */ }
    return db.runTransaction(async tx => {
      const ref = orderRef(initial.id); const [s, m, p, receipt] = await tx.getAll(ref, memberRef(initial.uid), participantRef(initial.uid), db.doc(`membershipTestTerms/${initial.id}`));
      const o = s.data(); check(o && o.uid === initial.uid); matches(o, observation);
      const member = m.exists ? m.data() : EMPTY; const now = clock();
      const next = { ...o, checkoutRef: observation.checkoutRef };
      const authority = authorityFor(member, o.uid);
      if (observation.reversal) {
        next.state = 'held';
        // Test-only defensive hold, not a club refund or dispute policy.
        if (o.state === 'active' && authority.term.evidenceRef === o.paymentRef && authority.term.state === 'approved') {
          const suspended = applyMembershipAuthorityCommand(authority, { membershipAuthoritySchemaVersion: 1,
            commandType: 'record_term_decision', commandId: `hold-${o.id}`, expectedRevision: authority.revision,
            termRevision: authority.term.revision + 1, termState: 'suspended', termId: authority.term.termId,
            startsAtMs: authority.term.startsAtMs, endsAtMs: authority.term.endsAtMs, planRef: authority.term.planRef,
            evidenceRef: authority.term.evidenceRef, policyVersion: authority.term.policyVersion });
          tx.set(memberRef(o.uid), { ...member, authority: suspended, revision: member.revision + 1 });
        }
      } else if (observation.paid && !['held', 'active'].includes(o.state)) {
        check(typeof observation.paymentRef === 'string');
        next.paymentRef = observation.paymentRef; next.state = 'paid_pending_activation';
        const expectation = { ...o.expectation, checkoutRef: observation.checkoutRef };
        const verdict = classifyVerifiedDuesPayment(expectation, { membershipDuesPaymentSchemaVersion: 1, checkoutRef: observation.checkoutRef,
          providerAccountRef: account, livemode: false, paymentRef: observation.paymentRef, paymentStatus: 'paid',
          paidAmountMinor: observation.amountMinor, currency: observation.currency, observedAtMs: now });
        check(verdict.decision === 'accepted');
        if (!receipt.exists) tx.create(db.doc(`membershipTestTerms/${o.id}`), { ...verdict.auditRecord, waiver: o.waiver });
        // Preserve any intervening withdrawal, suspension, association, or term decision.
        // Non-authority revision drift is surfaced rather than silently overwriting it.
        if (enabled && marked(p.data(), now) && now < expectation.endsAtMs && now >= expectation.startsAtMs
          && member.revision === o.memberRevision && authority.revision === expectation.expectedRevision
          && authority.term.revision + 1 === expectation.termRevision && authority.term.state !== 'suspended') {
          const approved = applyMembershipAuthorityCommand(authority, verdict.reducerCommand);
          next.state = 'active'; next.familyId = o.kind === 'family' ? `family-${o.id.slice(0, 32)}` : null;
          tx.set(memberRef(o.uid), { ...member, schemaVersion: 1, applicationStatus: 'approved', revision: member.revision + 1, authority: approved });
          if (next.familyId) tx.create(db.doc(`membershipTestFamilies/${next.familyId}`), { schemaVersion: 1, payerUid: o.uid, orderId: o.id, termId: expectation.termId });
        }
      } else if (!['held', 'active', 'paid_pending_activation', 'expired'].includes(o.state)) next.state = observation.expired ? 'expired' : 'open';
      if (JSON.stringify(next) !== JSON.stringify(o)) {
        tx.set(ref, next);
        tx.create(db.doc(`membershipTestAudit/${hash(`${o.id}:${next.state}:${next.checkoutRef}:${next.paymentRef}`)}`),
          { schemaVersion: 1, orderId: o.id, from: o.state, to: next.state, observedAtMs: now });
      }
      return view(next);
    });
  }
  async function open(uid, order) {
    check(order.uid === uid);
    const p = await db.runTransaction(async tx => (await tx.get(participantRef(uid))).data());
    check(marked(p, clock()), 'permission-denied'); await rate(uid);
    if (['active', 'held', 'paid_pending_activation', 'expired'].includes(order.state)) return { order: view(order) };
    check(order.checkoutRef || clock() < order.retryUntilMs);
    const observation = order.checkoutRef ? await provider.retrieve(order.checkoutRef, true) : await provider.create(order);
    const result = await observe(observation);
    return { order: result, ...(result.state === 'open' && observation.url ? { checkoutUrl: observation.url } : {}) };
  }
  async function resume(uid) { await actor(uid); return open(uid, await latest(uid)); }
  async function reconcile(uid) {
    await actor(uid); await rate(uid); const o = await latest(uid); check(o.checkoutRef);
    return { order: await observe(await provider.retrieve(o.checkoutRef)) };
  }
  async function webhook(event) {
    if (!event) return;
    const fingerprint = hash(JSON.stringify(event)); const ref = db.doc(`membershipTestEvents/${event.id}`);
    await db.runTransaction(async tx => {
      const existing = await tx.get(ref);
      if (existing.exists) { check(existing.data().fingerprint === fingerprint); return; }
      tx.create(ref, { schemaVersion: 1, fingerprint, reference: event.reference, type: event.type, state: 'pending' });
    });
    // Retrieve current provider state on every retry; old events never regress paid.
    await observe(await provider.resolve(event.reference));
    await db.runTransaction(async tx => { const s = await tx.get(ref); check(s.data().fingerprint === fingerprint); tx.set(ref, { ...s.data(), state: 'processed' }); });
  }
  return { status, prepare, resume, reconcile, webhook };
}
module.exports = { createTestDuesService, authorityFor };
