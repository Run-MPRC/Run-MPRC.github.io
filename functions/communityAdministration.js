'use strict';

// Only the isolated staging entrypoint imports this service. No financial or
// role administration, email, roster/profile projection or production fallback.
const functions = require('firebase-functions');
const { createHash } = require('node:crypto');
const { parseStrictObject } = require('./requestValidation');
const { createMembershipAuthority, applyMembershipAuthorityCommand } = require('./membershipAuthority');
const { readDuesPolicy, createDuesReceipt, duesView, duesId } = require('./communityDues');
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const EVENTS = new Set(['admin_event_create', 'admin_event_edit', 'admin_event_capacity', 'admin_event_open', 'admin_event_close', 'admin_event_cancel']);
const TEST_WAIVER = 'SYNTHETIC STAGING TEST ONLY. Not an approved club waiver or real event.';
const fail = (code = 'failed-precondition') => { throw new functions.https.HttpsError(code, 'Staging officer action unavailable. Refresh or sign in again.'); };
const check = (condition, code) => { if (!condition) fail(code); };
const integer = (value, max = 1_000_000) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const identifier = (value) => typeof value === 'string' && ID.test(value);
const text = (value) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 200 && !/[\p{Cc}\p{Cf}]/u.test(value);

function parseAdminRequest(input) {
  try {
    const value = parseStrictObject(input, { requiredKeys: ['action', 'accountUid'], optionalKeys: ['requestId', 'expectedRevision', 'targetUid', 'eventId', 'event', 'capacity', 'reason', 'cursor', 'duesCursor', 'confirmationId', 'externalConfirmed', 'policyRevision'] });
    check(identifier(value.accountUid), 'invalid-argument');
    if (value.action === 'admin_status') {
      parseStrictObject(value, { requiredKeys: ['action', 'accountUid'], optionalKeys: ['cursor', 'duesCursor'] });
      check((value.cursor === undefined || identifier(value.cursor)) && (value.duesCursor === undefined || identifier(value.duesCursor)), 'invalid-argument');
      return value;
    }
    const dues = value.action === 'admin_dues_record';
    check(dues || value.action === 'admin_membership_approve' || EVENTS.has(value.action), 'invalid-argument');
    const target = dues ? 'confirmationId' : value.action === 'admin_membership_approve' ? 'targetUid' : 'eventId';
    const extra = dues ? ['externalConfirmed', 'policyRevision'] : ['admin_event_create', 'admin_event_edit'].includes(value.action) ? ['event'] : value.action === 'admin_event_capacity' ? ['capacity'] : [];
    parseStrictObject(value, { requiredKeys: ['action', 'accountUid', 'requestId', 'expectedRevision', 'reason', target, ...extra], optionalKeys: [] });
    check(typeof value.requestId === 'string' && UUID.test(value.requestId) && integer(value.expectedRevision) && identifier(value[target]) && value.reason === 'synthetic_staging_review', 'invalid-argument');
    if (dues) check(UUID.test(value.confirmationId) && value.externalConfirmed === true
      && value.expectedRevision === 0 && integer(value.policyRevision) && value.policyRevision > 0, 'invalid-argument');
    if (extra.includes('event')) {
      parseStrictObject(value.event, { requiredKeys: ['title', 'location', 'startAtMs', 'opensAtMs', 'closesAtMs', 'capacity'], optionalKeys: [] });
      check(text(value.event.title) && text(value.event.location)
        && [value.event.startAtMs, value.event.opensAtMs, value.event.closesAtMs].every((time) => integer(time, 8_640_000_000_000_000))
        && value.event.opensAtMs < value.event.closesAtMs && value.event.closesAtMs <= value.event.startAtMs
        && integer(value.event.capacity, 10000) && value.event.capacity > 0, 'invalid-argument');
    }
    if (value.action === 'admin_event_capacity') check(integer(value.capacity, 10000) && value.capacity > 0, 'invalid-argument');
    return value;
  } catch { fail('invalid-argument'); }
}

function assertOfficerToken(token, now) {
  check(token?.email_verified === true && token.firebase?.sign_in_second_factor === 'totp'
    && integer(token.auth_time, Number.MAX_SAFE_INTEGER)
    && token.auth_time * 1000 <= now + 30000 && now - token.auth_time * 1000 <= 600000, 'permission-denied');
}
function readCapabilities(record, now) {
  const v2 = record?.schemaVersion === 2;
  check((record?.schemaVersion === 1 || v2) && record.enabled === true && integer(record.revision)
    && integer(record.expiresAtMs, 8_640_000_000_000_000) && record.expiresAtMs > now
    && typeof record.membershipApproval === 'boolean' && typeof record.freeEventManagement === 'boolean'
    && Object.keys(record).length === (v2 ? 7 : 6)
    && (!v2 || typeof record.duesRecording === 'boolean'), 'permission-denied');
  return { membershipApproval: record.membershipApproval, freeEventManagement: record.freeEventManagement,
    ...(v2 ? { duesRecording: record.duesRecording } : {}) };
}
function manifestIds(record) {
  const ids = record ? record.eventIds : [];
  check(Array.isArray(ids) && ids.length <= 20 && new Set(ids).size === ids.length && ids.every(identifier));
  return ids;
}
function syntheticAuthority(uid, commandId, config, now) {
  check(config?.schemaVersion === 1 && config.syntheticOnly === true
    && config.policyVersion === 'synthetic-only-not-payment-evidence'
    && identifier(config.termId) && integer(config.startsAtMs, 8_640_000_000_000_000)
    && integer(config.endsAtMs, 8_640_000_000_000_000)
    && config.startsAtMs <= now && config.endsAtMs > now
    && config.endsAtMs - config.startsAtMs <= 86400000 && Object.keys(config).length === 6);
  let authority = createMembershipAuthority({ membershipAuthoritySchemaVersion: 1, membershipId: `stage_${uid}`, commandId: `create_${commandId}` });
  authority = applyMembershipAuthorityCommand(authority, { membershipAuthoritySchemaVersion: 1, commandType: 'associate_account', commandId: `link_${commandId}`, expectedRevision: 1, uid });
  return applyMembershipAuthorityCommand(authority, {
    membershipAuthoritySchemaVersion: 1, commandType: 'record_term_decision', commandId,
    expectedRevision: 2, termRevision: 1, termState: 'approved', termId: config.termId,
    startsAtMs: config.startsAtMs, endsAtMs: config.endsAtMs,
    planRef: 'plan_synthetic_only', evidenceRef: `synthetic_${commandId}`, policyVersion: config.policyVersion,
  });
}

function createAdministrationService(db, auth, views, clock = Date.now) {
  async function execute(uid, token, request) {
    // Recheck inside every retry as well as the native boundary. Revocation
    // precedes receipt replay, so an old successful command grants no access.
    return db.runTransaction(async (tx) => {
      const now = clock(); assertOfficerToken(token, now);
      const capability = await tx.get(db.doc(`communityOfficers/${uid}`));
      const caps = readCapabilities(capability.data(), now);
      if (request.action === 'admin_status') {
        let pending = []; let nextCursor = null; let events = [];
        if (caps.membershipApproval) {
          let query = db.collection('communityMemberships').where('applicationStatus', '==', 'pending').orderBy('__name__').limit(21);
          if (request.cursor) query = query.startAfter(request.cursor);
          const records = await tx.get(query);
          pending = records.docs.slice(0, 20).map((snapshot) => ({ uid: snapshot.id, ...views.memberView(snapshot.data(), snapshot.id, now) }));
          if (records.docs.length > 20) nextCursor = pending[pending.length - 1].uid;
        }
        if (caps.freeEventManagement) {
          const manifest = await tx.get(db.doc('communityConfig/events'));
          const ids = manifestIds(manifest.data());
          const records = ids.length ? await tx.getAll(...ids.map((id) => db.doc(`communityEvents/${id}`))) : [];
          events = records.map((snapshot, n) => ({ ...views.eventView(snapshot.data(), ids[n]), revision: snapshot.data().revision ?? 0 }));
        }
        if (caps.duesRecording) {
          const policy = await tx.get(db.doc('communityConfig/duesTestTerm'));
          let query = db.collection('communityDues').orderBy('__name__').limit(21);
          if (request.duesCursor) query = query.startAfter(request.duesCursor);
          const records = await tx.get(query);
          const dues = records.docs.slice(0, 20).map((snapshot) => duesView(snapshot.data(), snapshot.id));
          const duesPolicy = policy.exists ? readDuesPolicy(policy.data()) : null;
          return { capabilities: caps, pending, nextCursor, events, dues, duesPolicy,
            duesRecordingOpen: !!duesPolicy && duesPolicy.startsAtMs <= now && duesPolicy.endsAtMs > now,
            nextDuesCursor: records.docs.length > 20 ? dues[dues.length - 1].membershipId : null };
        }
        return { capabilities: caps, pending, nextCursor, events };
      }
      const required = request.action === 'admin_dues_record' ? 'duesRecording' : request.action === 'admin_membership_approve' ? 'membershipApproval' : 'freeEventManagement';
      check(caps[required], 'permission-denied');
      const fingerprint = createHash('sha256').update(JSON.stringify(request, Object.keys(request).sort().concat(['title', 'location', 'startAtMs', 'opensAtMs', 'closesAtMs', 'capacity']))).digest('hex');
      const commandRef = db.doc(`communityOfficerCommands/${uid}/requests/${request.requestId}`);
      const command = await tx.get(commandRef);
      if (command.exists) { check(command.data().fingerprint === fingerprint, 'already-exists'); return command.data().result; }
      const rateRef = db.doc(`communityOfficerLimits/${uid}`);
      const rate = await tx.get(rateRef); const window = Math.floor(now / 60000);
      const previous = rate.exists ? rate.data() : { window, count: 0 };
      check(integer(previous.window, Number.MAX_SAFE_INTEGER) && integer(previous.count, 12));
      const count = previous.window === window ? previous.count : 0; check(count < 12, 'resource-exhausted');
      let result; let before; let after; const writes = [];
      if (required === 'duesRecording') {
        const ref = db.doc(`communityDues/${duesId(request.confirmationId)}`);
        const [snapshot, policy] = await tx.getAll(ref, db.doc('communityConfig/duesTestTerm'));
        check(!snapshot.exists); // Global confirmation uniqueness, including other officers.
        const receipt = createDuesReceipt(uid, capability.data(), token, request, policy.data(), now);
        const dues = duesView(receipt, ref.id);
        before = { recorded: false }; after = { recorded: true, membershipId: receipt.membershipId, linked: false };
        writes.push([ref, receipt, false]); result = { dues, syntheticOnly: true };
      } else if (required === 'membershipApproval') {
        const ref = db.doc(`communityMemberships/${request.targetUid}`);
        const [snapshot, policy] = await tx.getAll(ref, db.doc('communityConfig/approvalTestTerm'));
        const member = snapshot.data(); const view = views.memberView(member, request.targetUid, now);
        check(view.revision === request.expectedRevision && view.applicationStatus === 'pending' && member.authority === null && view.revision < 1_000_000);
        // Read-only Auth permission, not email matching/role administration.
        const target = await auth.getUser(request.targetUid);
        check(target.uid === request.targetUid && target.emailVerified === true && target.disabled === false);
        const authority = syntheticAuthority(request.targetUid, request.requestId, policy.data(), now);
        const next = { ...member, revision: member.revision + 1, applicationStatus: 'approved', authority, updatedAtMs: now };
        before = { revision: member.revision, applicationStatus: member.applicationStatus };
        after = { revision: next.revision, applicationStatus: next.applicationStatus };
        writes.push([ref, next, true]); result = { membership: after, syntheticOnly: true };
      } else {
        const ref = db.doc(`communityEvents/${request.eventId}`);
        const [snapshot, manifest] = await tx.getAll(ref, db.doc('communityConfig/events'));
        const ids = manifestIds(manifest.data()); const creating = request.action === 'admin_event_create';
        let event;
        if (creating) {
          check(!snapshot.exists && request.expectedRevision === 0 && ids.length < 20 && !ids.includes(request.eventId));
          event = { schemaVersion: 1, ...request.event, status: 'closed', amountCents: 0, confirmedCount: 0, waiverVersion: 'synthetic-only-v1', waiverText: TEST_WAIVER, waiverHash: createHash('sha256').update(TEST_WAIVER).digest('hex'), revision: 1 };
          check(event.startAtMs > now && event.closesAtMs > now);
          writes.push([db.doc('communityConfig/events'), { schemaVersion: 1, eventIds: [...ids, request.eventId] }, manifest.exists]);
          before = { revision: 0, status: 'none', capacity: 0 };
        } else {
          check(ids.includes(request.eventId));
          event = views.eventView(snapshot.data(), request.eventId);
          const revision = event.revision ?? 0;
          check(revision === request.expectedRevision && revision < 1_000_000 && event.status !== 'cancelled');
          delete event.id;
          before = { revision, status: event.status, capacity: event.capacity };
          if (request.action === 'admin_event_edit') {
            check(event.confirmedCount === 0 && request.event.startAtMs > now && request.event.closesAtMs > now);
            event = { ...event, ...request.event };
          } else if (request.action === 'admin_event_capacity') {
            check(request.capacity >= event.confirmedCount); event.capacity = request.capacity;
          } else if (request.action === 'admin_event_open') {
            check(now < event.closesAtMs && now < event.startAtMs); event.status = 'open';
          } else event.status = request.action === 'admin_event_cancel' ? 'cancelled' : 'closed';
          event.revision = revision + 1;
        }
        views.eventView(event, request.eventId);
        after = { revision: event.revision, status: event.status, capacity: event.capacity };
        writes.push([ref, event, snapshot.exists]); result = { event: { id: request.eventId, ...after } };
      }
      assertOfficerToken(token, clock()); readCapabilities(capability.data(), clock());
      if (required === 'duesRecording') {
        const policy = writes[0][1].policy;
        check(policy.startsAtMs <= clock() && policy.endsAtMs > clock());
      }
      for (const [ref, value, exists] of writes) { if (exists) tx.set(ref, value); else tx.create(ref, value); }
      tx.set(rateRef, { window, count: count + 1 });
      tx.create(commandRef, { schemaVersion: 1, fingerprint, actorUid: uid, capability: required, capabilityRevision: capability.data().revision, action: request.action, targetId: request.action === 'admin_dues_record' ? after.membershipId : request.targetUid || request.eventId, reason: request.reason, before, after, result, createdAtMs: now });
      return result;
    });
  }
  return { execute };
}
module.exports = { parseAdminRequest, assertOfficerToken, readCapabilities, createAdministrationService, TEST_WAIVER };
