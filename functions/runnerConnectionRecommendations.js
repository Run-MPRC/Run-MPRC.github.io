'use strict';

const { FieldPath } = require('firebase-admin/firestore');
const { readExactDataObject, isSafeUid, REQUEST_ID_PATTERN } = require('./memberDirectoryProjection');
const { PROFILE_COLLECTION, readStoredProfile } = require('./runnerConnectionProfiles');
const { MAX_CANDIDATES, rankRunnerConnections } = require('./runnerConnections');
const {
  ENTRY_COLLECTION, WINDOW_COLLECTION, EXCLUSION_COLLECTION, DAY_MS,
  digest, runnerEntryId, suggestionRef, exclusionId, windowPivot,
} = require('./runnerConnectionReferences');

class RecommendationError extends Error {
  constructor(code = 'unavailable') { super('Runner connection request could not be completed.'); this.code = code; }
}
function fail(code) { throw new RecommendationError(code); }
function natural(value, max = Number.MAX_SAFE_INTEGER - 1) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < 0 || value > max) fail();
  return value;
}
function profile(snapshot, now) {
  return readStoredProfile(snapshot.exists ? snapshot.data() : null, now);
}
function visible(state) { return state?.adultConfirmed === true && state.discoverable && state.profile !== null; }
function runner(viewerUid, uid, state) {
  return {
    entryRef: suggestionRef(viewerUid, uid), memberEligible: true, adultEligible: true,
    pairExcluded: false, consent: state.consent, profile: state.profile,
  };
}
function readWindow(value, now) {
  if (value === null) return null;
  const data = readExactDataObject(value, ['schemaVersion', 'day', 'uids', 'createdAtMs']);
  if (data.schemaVersion !== 1 || natural(data.createdAtMs) > now
    || natural(data.day) !== Math.floor(data.createdAtMs / DAY_MS)
    || !Array.isArray(data.uids) || data.uids.length > 5
    || Reflect.ownKeys(data.uids).length !== data.uids.length + 1
    || data.uids.some((uid) => !isSafeUid(uid)) || new Set(data.uids).size !== data.uids.length) fail();
  return data;
}
function readExclusion(value, now) {
  if (value === null) return { revision: 0, hidden: false, blocked: false };
  const data = readExactDataObject(value, ['schemaVersion', 'revision', 'hidden', 'blocked', 'lastRequestId', 'updatedAtMs']);
  if (data.schemaVersion !== 1 || natural(data.revision) < 1 || natural(data.updatedAtMs) > now
    || typeof data.hidden !== 'boolean' || typeof data.blocked !== 'boolean'
    || typeof data.lastRequestId !== 'string' || !REQUEST_ID_PATTERN.test(data.lastRequestId)) fail();
  return data;
}
function readExclusionRequest(input) {
  try {
    const data = readExactDataObject(input, ['requestId', 'entryRef', 'expectedRevision', 'hidden', 'blocked']);
    if (typeof data.requestId !== 'string' || !REQUEST_ID_PATTERN.test(data.requestId)
      || typeof data.entryRef !== 'string' || !/^runner_[0-9a-f]{64}$/.test(data.entryRef)
      || typeof data.hidden !== 'boolean' || typeof data.blocked !== 'boolean') fail();
    natural(data.expectedRevision, Number.MAX_SAFE_INTEGER - 2);
    return Object.freeze({
      requestId: data.requestId, entryRef: data.entryRef, expectedRevision: data.expectedRevision,
      hidden: data.hidden, blocked: data.blocked,
    });
  } catch { return fail('invalid-argument'); }
}
function readExclusionLookup(input) {
  try {
    const data = readExactDataObject(input, ['entryRef']);
    if (typeof data.entryRef !== 'string' || !/^runner_[0-9a-f]{64}$/.test(data.entryRef)) fail();
    return Object.freeze({ entryRef: data.entryRef });
  } catch { return fail('invalid-argument'); }
}

/** Candidate cache never authorizes disclosure. Every response has a second,
 * fresh transaction after window selection, rechecking only its bounded IDs.
 * A committed snapshot cannot recall data already sent over the network.
 */
function createRunnerRecommendationStore({ db, authorize, candidateEligible, now = Date.now } = {}) {
  if (!db || typeof db.runTransaction !== 'function' || typeof authorize !== 'function'
    || typeof candidateEligible !== 'function' || typeof now !== 'function') fail();
  const windowRef = (uid) => db.collection(WINDOW_COLLECTION).doc(uid);
  const pairRef = (viewer, target) => db.collection(EXCLUSION_COLLECTION).doc(exclusionId(viewer, target));
  const exclusionResult = (value) => ({ revision: value.revision, hidden: value.hidden, blocked: value.blocked });

  async function transact(uid, operation, work) {
    if (!isSafeUid(uid)) fail('invalid-argument');
    try {
      return await db.runTransaction(async (transaction) => {
        if (await authorize({ uid, operation, transaction }) !== true) fail('permission-denied');
        natural(now());
        return work(transaction);
      });
    } catch (failure) {
      if (failure instanceof RecommendationError) throw failure;
      return fail();
    }
  }

  async function readViewer(uid, transaction) {
    return profile(await transaction.get(db.collection(PROFILE_COLLECTION).doc(uid)), now());
  }

  async function candidateUids(uid, day, transaction) {
    const pivot = windowPivot(uid, day);
    const query = db.collection(ENTRY_COLLECTION).orderBy(FieldPath.documentId());
    const after = await transaction.get(query.startAt(pivot).limit(MAX_CANDIDATES));
    const before = after.size < MAX_CANDIDATES
      ? await transaction.get(query.endBefore(pivot).limit(MAX_CANDIDATES - after.size)) : null;
    const uids = [];
    for (const entry of [...after.docs, ...(before?.docs || [])]) {
      try {
        const data = readExactDataObject(entry.data(), ['schemaVersion', 'uid']);
        if (data.schemaVersion === 1 && isSafeUid(data.uid) && data.uid !== uid
          && entry.id === runnerEntryId(data.uid) && !uids.includes(data.uid)) uids.push(data.uid);
      } catch { /* Malformed index entries cannot authorize a card. */ }
    }
    return uids;
  }

  async function currentMatches(uid, viewer, uids, transaction) {
    if (!uids.length) return rankRunnerConnections(runner(uid, uid, viewer), []);
    // At most 48 source cards and two directed pair records each; final delivery
    // handles at most five. No roster scan, browser cursor or arbitrary target.
    const refs = uids.flatMap((target) => [
      db.collection(PROFILE_COLLECTION).doc(target), pairRef(uid, target), pairRef(target, uid),
    ]);
    const snapshots = await transaction.getAll(...refs);
    const candidates = await Promise.all(uids.map(async (target, index) => {
      let state;
      let own;
      let reverse;
      try {
        state = profile(snapshots[index * 3], now());
        own = readExclusion(snapshots[index * 3 + 1].exists ? snapshots[index * 3 + 1].data() : null, now());
        reverse = readExclusion(snapshots[index * 3 + 2].exists ? snapshots[index * 3 + 2].data() : null, now());
      } catch { return null; }
      if (!visible(state) || own.hidden || own.blocked || reverse.blocked) return null;
      const candidate = runner(uid, target, state);
      const feasible = rankRunnerConnections(runner(uid, uid, viewer), [candidate]);
      if (!feasible.similar.length && !feasible.broaden.length) return null;
      if (await candidateEligible({ uid: target, transaction }) !== true) return null;
      return candidate;
    }));
    return rankRunnerConnections(runner(uid, uid, viewer), candidates.filter(Boolean));
  }

  async function selectWindow(uid) {
    return transact(uid, 'recommend', async (transaction) => {
      const viewer = await readViewer(uid, transaction);
      if (!visible(viewer)) return null;
      const timestamp = natural(now());
      const day = Math.floor(timestamp / DAY_MS);
      const ref = windowRef(uid);
      const snapshot = await transaction.get(ref);
      const current = readWindow(snapshot.exists ? snapshot.data() : null, timestamp);
      if (current?.day === day) return current;
      const auditRef = db.collection('auditEvents').doc(`runner_window_${digest(uid, day)}`);
      // A missing/corrupt cache must not allow an already issued window to be
      // rebuilt into a fresh set of identities. Recovery is reviewed, not silent.
      if ((await transaction.get(auditRef)).exists) fail();
      const uids = await candidateUids(uid, day, transaction);
      const result = await currentMatches(uid, viewer, uids, transaction);
      const selected = [...result.similar, ...result.broaden].map((card) =>
        uids.find((target) => suggestionRef(uid, target) === card.entryRef));
      const next = { schemaVersion: 1, day, uids: selected, createdAtMs: timestamp };
      transaction.set(ref, next);
      for (const target of selected) {
        // A requester-scoped receipt permits future hide/block/undo of a shown
        // reference, even after the day changes or that person withdraws.
        transaction.set(ref.collection('seen').doc(suggestionRef(uid, target)), { schemaVersion: 1, uid: target });
      }
      transaction.create(auditRef, {
        schemaVersion: 1, actorUid: uid, action: 'runner_connection.window_selected',
        day, resultCount: selected.length, createdAtMs: timestamp,
      });
      return next;
    });
  }

  async function recommend(uid) {
    const selection = await selectWindow(uid);
    return transact(uid, 'recommend', async (transaction) => {
      const viewer = await readViewer(uid, transaction);
      const timestamp = natural(now());
      const windowEndsAtMs = (Math.floor(timestamp / DAY_MS) + 1) * DAY_MS;
      if (!visible(viewer)) return { rankerVersion: 1, similar: [], broaden: [], status: 'profile_required', windowEndsAtMs };
      // If midnight passed during selection, retry the whole request. Do not
      // silently widen one request into two different recommendation windows.
      if (selection && selection.day !== Math.floor(timestamp / DAY_MS)) fail('aborted');
      const result = await currentMatches(uid, viewer, selection?.uids || [], transaction);
      // Firestore supplies a consistent final snapshot. Recheck the external
      // account boundary after candidate work as well, before releasing cards.
      if (await authorize({ uid, operation: 'recommend', transaction }) !== true) fail('permission-denied');
      return { ...result, status: 'ready', windowEndsAtMs };
    });
  }

  async function exclusionTarget(uid, entryRef, transaction) {
    const seen = await transaction.get(windowRef(uid).collection('seen').doc(entryRef));
    if (!seen.exists) fail('permission-denied');
    const receipt = readExactDataObject(seen.data(), ['schemaVersion', 'uid']);
    if (receipt.schemaVersion !== 1 || !isSafeUid(receipt.uid) || receipt.uid === uid
      || suggestionRef(uid, receipt.uid) !== entryRef) fail();
    return receipt.uid;
  }

  async function lookupExclusion(uid, input) {
    const request = readExclusionLookup(input);
    return transact(uid, 'exclusionRead', async (transaction) => {
      const target = await exclusionTarget(uid, request.entryRef, transaction);
      const snapshot = await transaction.get(pairRef(uid, target));
      return exclusionResult(readExclusion(snapshot.exists ? snapshot.data() : null, natural(now())));
    });
  }

  async function setExclusion(uid, input) {
    const request = readExclusionRequest(input);
    return transact(uid, 'exclude', async (transaction) => {
      const target = await exclusionTarget(uid, request.entryRef, transaction);
      const ref = pairRef(uid, target);
      const snapshot = await transaction.get(ref);
      const timestamp = natural(now());
      const state = readExclusion(snapshot.exists ? snapshot.data() : null, timestamp);
      const auditRef = db.collection('auditEvents').doc(`runner_exclusion_${digest(uid, request.requestId)}`);
      const auditSnapshot = await transaction.get(auditRef);
      const requestDigest = digest(request, target);
      if (auditSnapshot.exists) {
        const audit = readExactDataObject(auditSnapshot.data(), [
          'schemaVersion', 'actorUid', 'action', 'requestId', 'requestDigest', 'expectedRevision', 'revision', 'createdAtMs',
        ]);
        if (audit.schemaVersion !== 1 || audit.actorUid !== uid || audit.action !== 'runner_connection.exclusion_set'
          || natural(audit.createdAtMs) > timestamp
          || natural(audit.revision) !== natural(audit.expectedRevision) + 1) fail();
        if (audit.requestId !== request.requestId || audit.requestDigest !== requestDigest
          || audit.expectedRevision !== request.expectedRevision || audit.revision !== state.revision
          || state.lastRequestId !== request.requestId) fail('aborted');
        if (state.hidden !== request.hidden || state.blocked !== request.blocked) fail();
        return exclusionResult(state);
      }
      if (state.lastRequestId === request.requestId) fail();
      if (state.revision !== request.expectedRevision) fail('aborted');
      const next = {
        schemaVersion: 1, revision: request.expectedRevision + 1,
        hidden: request.hidden, blocked: request.blocked, lastRequestId: request.requestId, updatedAtMs: timestamp,
      };
      transaction.set(ref, next);
      transaction.create(auditRef, {
        schemaVersion: 1, actorUid: uid, action: 'runner_connection.exclusion_set',
        requestId: request.requestId, requestDigest, expectedRevision: request.expectedRevision,
        revision: next.revision, createdAtMs: timestamp,
      });
      return exclusionResult(next);
    });
  }

  return Object.freeze({ recommend, setExclusion, readExclusion: lookupExclusion });
}

module.exports = { createRunnerRecommendationStore, readExclusionRequest, readExclusionLookup };
