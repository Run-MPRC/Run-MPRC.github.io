'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { createHash } = require('node:crypto');
const { parseStrictObject } = require('./requestValidation');
const { deriveMembershipEntitlement } = require('./membershipAuthority');
const policy = require('./membershipCancellationPolicy.json');
const limits = require('./profileRuntime');
const { parseAdminRequest, assertOfficerToken, createAdministrationService } = require('./communityAdministration');
const { createFictionalRaceService, parseRaceCommand, parseRaceStatus, assertRaceActor } = require('./fictionalRaceService');

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const COMMAND = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ACTIONS = new Set(['membership_join', 'membership_cancel', 'event_join', 'event_cancel']);
const RACE_ACTIONS = Object.freeze({ race_join: 'join_simulation', race_cancel: 'simulate_refund',
  race_offer: 'offer_transfer', race_accept: 'accept_transfer', race_revoke: 'revoke_transfer' });
const error = (code) => new functions.https.HttpsError(code, {
  'invalid-argument': 'Request is invalid.',
  'permission-denied': 'Verify your account before making this request.',
  'failed-precondition': 'This action is unavailable. Refresh your status.',
  'already-exists': 'This request conflicts with an earlier request.',
  'resource-exhausted': 'No place is available, or too many requests were made. Try later.',
  unavailable: 'Community status is temporarily unavailable.',
  unauthenticated: 'Sign in to continue.',
}[code]);
const check = (value, code = 'unavailable') => { if (!value) throw error(code); };
const integer = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max;

function communityEnvelope(input) {
  try {
    // Clone before inspecting any discriminant; getters/proxies never run.
    return parseStrictObject(input, { requiredKeys: ['action', 'accountUid'], optionalKeys: [
      'requestId', 'expectedRevision', 'eventId', 'waiverVersion', 'waiverAccepted', 'targetUid', 'event',
      'capacity', 'reason', 'cursor', 'duesCursor', 'confirmationId', 'externalConfirmed', 'policyRevision',
      'membershipId', 'associationConfirmed', 'entryId', 'expectedEventRevision', 'expectedEntryRevision',
      'recipientUid', 'incomingEntryId',
    ] });
  } catch { throw error('invalid-argument'); }
}

function assertCommunityEnvironment(env = process.env) {
  const project = env.GCLOUD_PROJECT;
  const emulator = /^demo-[a-z0-9-]+$/.test(project || '')
    && /^127\.0\.0\.1:\d+$/.test(env.FIRESTORE_EMULATOR_HOST || '')
    && /^127\.0\.0\.1:\d+$/.test(env.FIREBASE_AUTH_EMULATOR_HOST || '');
  check(project === 'run-mprc-staging' || emulator, 'failed-precondition');
  check(env.COMMERCE_ENABLED === 'false' || emulator, 'failed-precondition');
}

function parseRequest(input) {
  try {
    const bounded = parseStrictObject(input, {
      requiredKeys: ['action', 'accountUid'], optionalKeys: ['requestId', 'expectedRevision', 'eventId', 'waiverVersion', 'waiverAccepted'],
    });
    const status = bounded.action === 'status';
    const event = bounded.action === 'event_join' || bounded.action === 'event_cancel';
    const value = parseStrictObject(bounded, {
      requiredKeys: status ? ['action', 'accountUid'] : ['action', 'accountUid', 'requestId', 'expectedRevision', ...(event ? ['eventId'] : [])],
      optionalKeys: event && bounded.action === 'event_join' ? ['waiverVersion', 'waiverAccepted'] : [],
    });
    check(typeof value.accountUid === 'string' && ID.test(value.accountUid), 'invalid-argument');
    if (status) return value;
    check(ACTIONS.has(value.action) && COMMAND.test(value.requestId)
      && integer(value.expectedRevision, 1_000_000), 'invalid-argument');
    if (event) check(typeof value.eventId === 'string' && ID.test(value.eventId), 'invalid-argument');
    if (value.action === 'event_join') check(typeof value.waiverVersion === 'string'
      && value.waiverVersion.length <= 80 && value.waiverAccepted === true, 'invalid-argument');
    return value;
  } catch { throw error('invalid-argument'); }
}

function memberView(record, uid, now) {
  check(record?.schemaVersion === 1 && integer(record.revision, 1_000_000)
    && ['none', 'pending', 'approved', 'withdrawn', 'cancellation_requested'].includes(record.applicationStatus));
  let entitlement = 'not_entitled';
  let accessThroughMs = null;
  if (record.authority !== null) {
    try {
      check(record.authority.association.uid === uid);
      entitlement = deriveMembershipEntitlement({ membershipAuthoritySchemaVersion: 1, record: record.authority, uid, asOfMs: now }).entitlement;
      if (entitlement === 'current_member') accessThroughMs = record.authority.term.endsAtMs;
    } catch { throw error('unavailable'); }
  }
  return { revision: record.revision, applicationStatus: record.applicationStatus, entitlement, accessThroughMs };
}

function eventView(value, id) {
  const keys = ['schemaVersion', 'title', 'location', 'startAtMs', 'opensAtMs', 'closesAtMs', 'status', 'amountCents', 'capacity', 'confirmedCount', 'waiverVersion', 'waiverText', 'waiverHash'];
  check(value && [keys.length, keys.length + 1].includes(Object.keys(value).length)
    && keys.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => keys.includes(key) || key === 'revision')
    && (!Object.hasOwn(value, 'revision') || integer(value.revision, 1_000_000)));
  check(value.schemaVersion === 1 && value.amountCents === 0
    && ['open', 'closed', 'cancelled'].includes(value.status)
    && integer(value.capacity, 10000) && value.capacity > 0
    && integer(value.confirmedCount, value.capacity)
    && [value.startAtMs, value.opensAtMs, value.closesAtMs].every((time) => integer(time, 8_640_000_000_000_000))
    && value.opensAtMs < value.closesAtMs && value.closesAtMs <= value.startAtMs);
  check(['title', 'location', 'waiverVersion', 'waiverText'].every((key) => typeof value[key] === 'string' && value[key].length > 0 && value[key].length <= (key === 'waiverText' ? 2000 : 200)));
  check(value.waiverHash === createHash('sha256').update(value.waiverText).digest('hex'));
  return { id, ...value };
}

function registrationView(value) {
  if (!value) return { revision: 0, status: 'none' };
  check(value.schemaVersion === 1 && integer(value.revision, 1_000_000)
    && ['confirmed', 'cancelled'].includes(value.status)
    && value.paymentStatus === 'not_required');
  return { revision: value.revision, status: value.status };
}

function createCommunityService(db, clock = Date.now) {
  const memberRef = (uid) => db.doc(`communityMemberships/${uid}`);
  const emptyMember = { schemaVersion: 1, revision: 0, applicationStatus: 'none', authority: null };
  async function status(uid) {
    const [member, manifest] = await db.getAll(memberRef(uid), db.doc('communityConfig/events'));
    const ids = manifest.exists ? manifest.data().eventIds : [];
    check(Array.isArray(ids) && ids.length <= 20 && new Set(ids).size === ids.length && ids.every((id) => typeof id === 'string' && ID.test(id)));
    const refs = ids.flatMap((id) => [db.doc(`communityEvents/${id}`), db.doc(`communityEvents/${id}/registrations/${uid}`)]);
    const docs = refs.length ? await db.getAll(...refs) : [];
    // Read completion, not request start, determines time-based presentation.
    // Mutations still independently enforce their transactional constraints.
    const now = clock(); check(integer(now, 8_640_000_000_000_000));
    const events = ids.map((id, index) => {
      const event = eventView(docs[index * 2].data(), id);
      const signupStatus = event.status === 'cancelled' ? 'cancelled'
        : event.status === 'closed' ? 'closed'
          : now < event.opensAtMs ? 'not_open_yet'
            : now >= event.closesAtMs ? 'ended'
              : event.confirmedCount >= event.capacity ? 'full' : 'open';
      return { ...event, signupStatus, registration: registrationView(docs[index * 2 + 1].data()) };
    });
    return { membership: memberView(member.exists ? member.data() : emptyMember, uid, now), events };
  }

  async function mutate(uid, request) {
    const fingerprint = createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.keys(request).sort().map((key) => [key, request[key]])))).digest('hex');
    const commandRef = db.doc(`communityCommands/${uid}/requests/${request.requestId}`);
    const rateRef = db.doc(`communityLimits/${uid}`);
    return db.runTransaction(async (tx) => {
      const now = clock();
      const command = await tx.get(commandRef);
      if (command.exists) {
        check(command.data().fingerprint === fingerprint, 'already-exists');
        return command.data().result;
      }
      const rate = await tx.get(rateRef);
      const window = Math.floor(now / 60000);
      const previous = rate.exists ? rate.data() : { window, count: 0 };
      check(integer(previous.window) && integer(previous.count, 12));
      const count = previous.window === window ? previous.count : 0;
      check(count < 12, 'resource-exhausted');
      let result;
      const writes = [];
      if (request.action.startsWith('membership_')) {
        const ref = memberRef(uid);
        const snapshot = await tx.get(ref);
        const record = snapshot.exists ? snapshot.data() : emptyMember;
        const view = memberView(record, uid, now);
        check(view.revision === request.expectedRevision, 'failed-precondition');
        let applicationStatus;
        if (request.action === 'membership_join') {
          check(view.entitlement !== 'current_member', 'failed-precondition');
          applicationStatus = 'pending';
        } else {
          check(view.applicationStatus !== 'none', 'failed-precondition');
          applicationStatus = view.entitlement === 'current_member' ? 'cancellation_requested' : 'withdrawn';
        }
        const changed = applicationStatus !== record.applicationStatus;
        check(!changed || record.revision < 1_000_000);
        const next = { ...record, applicationStatus, revision: record.revision + (changed ? 1 : 0), policyVersion: policy.policyVersion, updatedAtMs: now };
        if (changed) writes.push([ref, next, snapshot.exists]);
        result = { membership: { revision: next.revision, applicationStatus: next.applicationStatus } };
      } else {
        const ref = db.doc(`communityEvents/${request.eventId}`);
        const regRef = ref.collection('registrations').doc(uid);
        const [eventSnap, regSnap] = await tx.getAll(ref, regRef);
        const event = eventView(eventSnap.data(), request.eventId);
        const record = regSnap.exists ? regSnap.data() : null;
        const registration = registrationView(record);
        check(registration.revision === request.expectedRevision, 'failed-precondition');
        const joining = request.action === 'event_join';
        const target = joining ? 'confirmed' : 'cancelled';
        check(joining || registration.status !== 'none', 'failed-precondition');
        if (registration.status !== target) {
          check(registration.revision < 1_000_000);
          if (joining) {
            check(event.status === 'open' && now >= event.opensAtMs && now < event.closesAtMs
              && request.waiverVersion === event.waiverVersion, 'failed-precondition');
            check(event.confirmedCount < event.capacity, 'resource-exhausted');
          } else check(event.confirmedCount > 0);
          const next = {
            schemaVersion: 1, revision: registration.revision + 1, status: target,
            paymentStatus: 'not_required', updatedAtMs: now,
            ...(joining ? { waiverVersion: event.waiverVersion, waiverHash: event.waiverHash, waiverAcceptedAtMs: now } : {
              waiverVersion: record.waiverVersion, waiverHash: record.waiverHash, waiverAcceptedAtMs: record.waiverAcceptedAtMs,
            }),
          };
          writes.push([ref, { ...eventSnap.data(), confirmedCount: event.confirmedCount + (joining ? 1 : -1) }, true], [regRef, next, regSnap.exists]);
          result = { registration: registrationView(next) };
        } else result = { registration };
      }
      for (const [ref, value, exists] of writes) {
        if (exists) tx.set(ref, value); else tx.create(ref, value);
      }
      tx.set(rateRef, { window, count: count + 1 });
      tx.create(commandRef, { schemaVersion: 1, fingerprint, action: request.action, result, createdAtMs: now });
      return result;
    });
  }
  return { status, mutate };
}

exports.communityActions = functions.runWith({ ...limits, enforceAppCheck: true }).https.onCall(async (data, context) => {
  assertCommunityEnvironment();
  check(context.app, 'permission-denied');
  check(context.auth?.uid && typeof context.auth.uid === 'string' && ID.test(context.auth.uid), 'unauthenticated');
  const envelope = communityEnvelope(data);
  check(typeof envelope.action === 'string', 'invalid-argument');
  if (envelope.action === 'race_status' || Object.hasOwn(RACE_ACTIONS, envelope.action)) {
    // UID and claims come exclusively from Firebase's verified callable context.
    // A browser admin role cannot replace the live own-entry permission/marker.
    const status = envelope.action === 'race_status';
    const request = status ? parseRaceStatus(envelope, context.auth.uid)
      : parseRaceCommand({ ...envelope, action: RACE_ACTIONS[envelope.action] }, context.auth.uid);
    assertRaceActor(context.auth.token, Date.now());
    let app;
    try { app = admin.app(); } catch { throw error('unavailable'); }
    const service = createFictionalRaceService(app);
    return status ? service.status(context.auth.uid, context.auth.token, request)
      : service.execute(context.auth.uid, context.auth.token, request);
  }
  const administrative = typeof envelope.action === 'string' && envelope.action.startsWith('admin_');
  const request = administrative ? parseAdminRequest(envelope) : parseRequest(envelope);
  check(request.accountUid === context.auth.uid, 'permission-denied');
  if (request.action !== 'status') check(context.auth.token.email_verified === true, 'permission-denied');
  if (administrative) assertOfficerToken(context.auth.token, Date.now());
  try {
    if (administrative) {
      const service = createAdministrationService(admin.firestore(), admin.auth(), { memberView, eventView });
      return await service.execute(context.auth.uid, context.auth.token, request);
    }
    const service = createCommunityService(admin.firestore());
    return await (request.action === 'status' ? service.status(context.auth.uid) : service.mutate(context.auth.uid, request));
  } catch (failure) {
    if (failure instanceof functions.https.HttpsError) throw failure;
    throw error('unavailable'); // No raw errors, IDs, request bodies or record logging.
  }
});
exports.createCommunityService = createCommunityService;
exports.assertCommunityEnvironment = assertCommunityEnvironment;
exports.parseRequest = parseRequest;
exports.memberView = memberView;
exports.eventView = eventView;
exports.communityEnvelope = communityEnvelope;
