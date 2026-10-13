'use strict';

// Server-only source; no callable/client/runtime-bundle integration yet.
// Only read-only Auth metadata is external to the Firestore transaction.
const functions = require('firebase-functions');
const { createHash } = require('node:crypto');
const { parseStrictObject } = require('./requestValidation');
const { POLICY, WAIVER, reduceFictionalRace, readFictionalRaceRecords, raceEnrollmentId, createFictionalEntry } = require('./fictionalRaceTransitions');
const MESSAGE = 'Fictional race action unavailable. Refresh or sign in again.';
const ID = /^stage_race_[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ACTIONS = new Set(['join_simulation', 'simulate_refund', 'offer_transfer', 'accept_transfer', 'revoke_transfer']);
const safeErrors = new WeakSet();
const hash = value => createHash('sha256').update(value).digest('hex');
const strict = (value, keys) => parseStrictObject(value, { requiredKeys: keys, optionalKeys: [] });
const integer = (value, max = 8640000000000000) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const identifier = value => typeof value === 'string' && ID.test(value);
function fail(code = 'failed-precondition') {
  const error = new functions.https.HttpsError(code, MESSAGE); safeErrors.add(error); throw error;
}
const check = (value, code) => { if (!value) fail(code); };

function raceEnvironment(env) {
  const project = env.GCLOUD_PROJECT;
  const demo = /^demo-[a-z0-9-]+$/.test(project || '')
    && /^127\.0\.0\.1:\d+$/.test(env.FIRESTORE_EMULATOR_HOST || '')
    && /^127\.0\.0\.1:\d+$/.test(env.FIREBASE_AUTH_EMULATOR_HOST || '');
  check((project === 'run-mprc-staging' && env.COMMERCE_ENABLED === 'false'
    && !env.FIRESTORE_EMULATOR_HOST && !env.FIREBASE_AUTH_EMULATOR_HOST) || demo);
  return project;
}

function parseRaceCommand(input, uid) {
  try {
    const parsed = parseStrictObject(input, { requiredKeys: ['action', 'accountUid', 'requestId', 'eventId',
      'entryId', 'expectedEventRevision', 'expectedEntryRevision'], optionalKeys: ['recipientUid', 'waiverAccepted', 'waiverVersion'] });
    const extra = parsed.action === 'offer_transfer' ? ['recipientUid']
      : ['join_simulation', 'accept_transfer'].includes(parsed.action) ? ['waiverAccepted', 'waiverVersion'] : [];
    strict(parsed, ['action', 'accountUid', 'requestId', 'eventId', 'entryId', 'expectedEventRevision', 'expectedEntryRevision', ...extra]);
    check(identifier(uid) && parsed.accountUid === uid, 'permission-denied');
    check(ACTIONS.has(parsed.action) && identifier(parsed.eventId) && identifier(parsed.entryId)
      && typeof parsed.requestId === 'string' && UUID.test(parsed.requestId)
      && integer(parsed.expectedEventRevision, 999999) && parsed.expectedEventRevision > 0
      && integer(parsed.expectedEntryRevision, 999999)
      && (parsed.action === 'join_simulation' ? parsed.expectedEntryRevision === 0 : parsed.expectedEntryRevision > 0)
      && (!extra.includes('recipientUid') || (identifier(parsed.recipientUid) && parsed.recipientUid !== uid))
      && (!extra.includes('waiverAccepted') || (parsed.waiverAccepted === true && parsed.waiverVersion === WAIVER)), 'invalid-argument');
    if (parsed.action === 'join_simulation') check(parsed.entryId === raceEnrollmentId(parsed.eventId, uid), 'invalid-argument');
    return parsed;
  } catch (error) { if (safeErrors.has(error)) throw error; fail('invalid-argument'); }
}

function actor(token, now) {
  check(token?.email_verified === true && token.firebase?.sign_in_provider === 'password' && token.firebase.tenant === undefined
    && integer(token.auth_time, Number.MAX_SAFE_INTEGER) && token.auth_time * 1000 <= now + 30000
    && now - token.auth_time * 1000 <= 3600000, 'permission-denied');
}
function grant(input, uid, now, permission = false) {
  try {
    const value = strict(input, ['schemaVersion', 'simulationOnly', 'enabled', 'uid', 'revision', 'expiresAtMs', ...(permission ? ['manageOwnEntry'] : [])]);
    check(value.schemaVersion === 1 && value.simulationOnly === true && value.enabled === true
      && value.uid === uid && integer(value.revision, 999999) && value.revision > 0
      && integer(value.expiresAtMs) && value.expiresAtMs > now && value.expiresAtMs - now <= 86400000
      && (!permission || value.manageOwnEntry === true), 'permission-denied');
    return value;
  } catch { fail('permission-denied'); }
}
function enrollment(input, eventId, uid, entryId, status) {
  const value = strict(input, ['schemaVersion', 'simulationOnly', 'policyVersion', 'eventId', 'uid', 'entryId', 'status', 'revision']);
  check(value.schemaVersion === 1 && value.simulationOnly === true && value.policyVersion === POLICY
    && value.eventId === eventId && value.uid === uid && value.entryId === entryId && value.status === status
    && integer(value.revision, 999999) && value.revision > 0);
  return value;
}
const enrollmentValue = (eventId, uid, entryId) => ({ schemaVersion: 1, simulationOnly: true, policyVersion: POLICY,
  eventId, uid, entryId, status: 'confirmed', revision: 1 });
function resultView(input, request) {
  const value = strict(input, ['schemaVersion', 'simulationOnly', 'action', 'eventId', 'entryId', 'entryRevision', 'eventRevision', 'offerExpiresAtMs']);
  check(value.schemaVersion === 1 && value.simulationOnly === true && value.action === request.action
    && value.eventId === request.eventId && value.entryId === request.entryId
    && integer(value.entryRevision, 999999) && value.entryRevision === request.expectedEntryRevision + 1
    && integer(value.eventRevision, 999999) && value.eventRevision === request.expectedEventRevision + (['join_simulation', 'simulate_refund'].includes(request.action) ? 1 : 0)
    && (request.action === 'offer_transfer' ? integer(value.offerExpiresAtMs) : value.offerExpiresAtMs === null));
  return value;
}
function replay(input, uid, request, fingerprint, now) {
  const value = strict(input, ['schemaVersion', 'simulationOnly', 'policyVersion', 'actorUid', 'requestId',
    'eventId', 'entryId', 'action', 'fingerprint', 'createdAtMs', 'result']);
  check(value.schemaVersion === 1 && value.simulationOnly === true && value.policyVersion === POLICY
    && value.actorUid === uid && value.requestId === request.requestId && value.action === request.action
    && value.eventId === request.eventId && value.entryId === request.entryId
    && integer(value.createdAtMs) && value.createdAtMs <= now);
  check(value.fingerprint === fingerprint, 'already-exists');
  const result = resultView(value.result, request);
  if (request.action === 'offer_transfer') check(result.offerExpiresAtMs > value.createdAtMs && result.offerExpiresAtMs - value.createdAtMs <= 300000);
  return result;
}

function createFictionalRaceService(app, clock = Date.now, env = process.env) {
  let db; let auth;
  try {
    const project = raceEnvironment(env);
    check(app.options.projectId === project); // Native SDK instances must use the same explicitly selected app.
    db = app.firestore(); auth = app.auth();
  } catch (error) { if (safeErrors.has(error)) throw error; fail(); }
  const indexRef = (eventId, uid) => db.doc(`communityRaceEnrollment/${raceEnrollmentId(eventId, uid)}`);
  async function execute(uid, token, input) {
    try {
      raceEnvironment(env); const request = parseRaceCommand(input, uid);
      const fingerprint = hash(JSON.stringify(Object.fromEntries(Object.keys(request).sort().map(key => [key, request[key]]))));
      return await db.runTransaction(async tx => {
        const began = clock(); check(integer(began)); actor(token, began);
        const permissionRef = db.doc(`communityRacePermissions/${uid}`);
        const callerMarkerRef = db.doc(`communityRaceTargets/${uid}`);
        const eventRef = db.doc(`communityRaceEvents/${request.eventId}`);
        const entryRef = db.doc(`communityRaceEntries/${request.entryId}`);
        const commandRef = db.doc(`communityRaceCommands/${uid}/requests/${request.requestId}`);
        const [permissionDoc, callerMarkerDoc, eventDoc, entryDoc, commandDoc] = await tx.getAll(permissionRef, callerMarkerRef, eventRef, entryRef, commandRef);
        const permission = grant(permissionDoc.data(), uid, began, true);
        const callerMarker = grant(callerMarkerDoc.data(), uid, began);
        const joining = request.action === 'join_simulation';
        const readAt = clock(); check(integer(readAt));
        const before = entryDoc.exists ? readFictionalRaceRecords(eventDoc.data(), entryDoc.data(), readAt) : null;
        check(joining || before !== null);
        check(!commandDoc.exists || before !== null); // Never acknowledge an orphaned successful receipt.
        if (before) check([before.entry.runnerUid, before.entry.creditOwnerUid, before.entry.offer?.recipientUid].includes(uid), 'permission-denied');
        // Read-only confirmation needs current caller authority, never renewed
        // recipient access. Withdrawing one's own offer must also survive a lost
        // recipient account. Current entry/index state is still checked below.
        const targets = commandDoc.exists ? [uid] : [...new Set([uid, before?.entry.runnerUid, before?.entry.creditOwnerUid,
          ...(request.action === 'revoke_transfer' ? [] : [before?.entry.offer?.recipientUid]), request.recipientUid].filter(Boolean))];
        const indexUids = [...new Set([uid, before?.entry.runnerUid, before?.entry.creditOwnerUid, request.recipientUid].filter(Boolean))];
        check(targets.length <= 3 && indexUids.length <= 3);
        const markers = await tx.getAll(...targets.map(target => db.doc(`communityRaceTargets/${target}`)));
        markers.forEach((doc, n) => grant(doc.data(), targets[n], began));
        const users = await Promise.all(targets.map(target => auth.getUser(target)));
        users.forEach((user, n) => check(user.uid === targets[n] && user.emailVerified === true && user.disabled === false, 'permission-denied'));
        const indexDocs = await tx.getAll(...indexUids.map(target => indexRef(request.eventId, target)));
        const indexByUid = new Map(indexUids.map((target, n) => [target, indexDocs[n]]));
        if (before) {
          const entry = before.entry;
          enrollment(indexByUid.get(entry.runnerUid).data(), request.eventId, entry.runnerUid, entry.entryId, entry.status);
          if (entry.transferCount === 1) enrollment(indexByUid.get(entry.creditOwnerUid).data(), request.eventId, entry.creditOwnerUid, entry.entryId, 'transferred');
        }
        // Sampling after reads prevents a slow Auth/read from extending a permission, offer or signup window.
        const now = clock(); check(integer(now)); actor(token, now);
        grant(permission, uid, now, true); grant(callerMarker, uid, now);
        markers.forEach((doc, n) => grant(doc.data(), targets[n], now));
        if (commandDoc.exists) return replay(commandDoc.data(), uid, request, fingerprint, now);
        const rateRef = db.doc(`communityRaceLimits/${uid}`);
        const rateDoc = await tx.get(rateRef);
        const rate = rateDoc.exists ? strict(rateDoc.data(), ['window', 'count']) : { window: Math.floor(now / 60000), count: 0 };
        check(integer(rate.window, Number.MAX_SAFE_INTEGER) && integer(rate.count, 12));
        const writes = []; let policyInput;
        if (joining) {
          check(!entryDoc.exists && !indexByUid.get(uid).exists && eventDoc.data()?.revision === request.expectedEventRevision);
          const policyDoc = await tx.get(db.doc(`communityRacePolicies/${request.eventId}`));
          policyInput = policyDoc.data();
          writes.push([indexRef(request.eventId, uid), enrollmentValue(request.eventId, uid, request.entryId), false]);
        } else {
          if (request.action === 'offer_transfer' || request.action === 'accept_transfer') {
            const recipient = request.action === 'offer_transfer' ? request.recipientUid : uid;
            check(!indexByUid.get(recipient).exists);
          }
          if (request.action === 'simulate_refund' || request.action === 'accept_transfer') {
            const previousUid = before.entry.runnerUid;
            const previousIndex = enrollment(indexByUid.get(previousUid).data(), request.eventId, previousUid, request.entryId, 'confirmed');
            check(previousIndex.revision < 999999);
            writes.push([indexRef(request.eventId, previousUid), { ...previousIndex, revision: previousIndex.revision + 1,
              status: request.action === 'simulate_refund' ? 'cancelled' : 'transferred' }, true]);
            if (request.action === 'accept_transfer') writes.push([indexRef(request.eventId, uid), enrollmentValue(request.eventId, uid, request.entryId), false]);
          }
        }
        // Recheck expiry after all reads, before first write. Firestore conflicts rerun the whole boundary.
        const admitted = clock(); check(integer(admitted)); actor(token, admitted);
        grant(permission, uid, admitted, true); markers.forEach((doc, n) => grant(doc.data(), targets[n], admitted));
        const window = Math.floor(admitted / 60000); check(rate.window <= window);
        const count = rate.window === window ? rate.count : 0; check(count < 12, 'resource-exhausted');
        const reducedRequest = { action: request.action, eventId: request.eventId, entryId: request.entryId,
          expectedEventRevision: request.expectedEventRevision, expectedEntryRevision: request.expectedEntryRevision,
          ...(request.action === 'offer_transfer' ? { recipientUid: request.recipientUid, expiresAtMs: Math.min(admitted + 300000, before.event.startAtMs) } : {}),
          ...(request.action === 'accept_transfer' ? { waiverVersion: request.waiverVersion } : {}) };
        const changed = joining ? createFictionalEntry(eventDoc.data(), policyInput, uid, request.waiverVersion, admitted)
          : reduceFictionalRace(before.event, before.entry, reducedRequest, uid, admitted);
        const result = resultView({ schemaVersion: 1, simulationOnly: true, action: request.action,
          eventId: request.eventId, entryId: request.entryId, entryRevision: changed.entry.revision,
          eventRevision: changed.event.revision, offerExpiresAtMs: changed.entry.offer?.expiresAtMs ?? null }, request);
        if (changed.event.revision !== eventDoc.data().revision) writes.push([eventRef, changed.event, true]);
        writes.push([entryRef, changed.entry, entryDoc.exists]);
        for (const [ref, value, exists] of writes) { if (exists) tx.set(ref, value); else tx.create(ref, value); }
        tx.set(rateRef, { window, count: count + 1 });
        tx.create(commandRef, { schemaVersion: 1, simulationOnly: true, policyVersion: POLICY, actorUid: uid,
          requestId: request.requestId, eventId: request.eventId, entryId: request.entryId, action: request.action,
          fingerprint, createdAtMs: admitted, result });
        tx.create(db.doc(`communityRaceAudit/${hash(`${uid}:${request.requestId}`)}`), {
          schemaVersion: 1, simulationOnly: true, policyVersion: POLICY, action: request.action,
          actorRef: hash(uid), eventId: request.eventId, entryId: request.entryId, createdAtMs: admitted,
          permissionRevision: permission.revision, markerRevision: callerMarker.revision,
          fromEntryRevision: before?.entry.revision ?? 0, toEntryRevision: changed.entry.revision,
          fromCount: eventDoc.data().confirmedCount, toCount: changed.event.confirmedCount,
          fromRunnerRef: before ? hash(before.entry.runnerUid) : null, toRunnerRef: hash(changed.entry.runnerUid),
        });
        return result;
      });
    } catch (error) { if (safeErrors.has(error)) throw error; fail('unavailable'); }
  }
  return { execute };
}

module.exports = { createFictionalRaceService, raceEnvironment, parseRaceCommand };
