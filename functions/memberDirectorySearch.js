'use strict';

const { createHash } = require('node:crypto');
const admin = require('firebase-admin');
const { Timestamp } = require('firebase-admin/firestore');
const functions = require('firebase-functions');

const { checkRateLimit } = require('./rateLimit');
const {
  requireAdmin,
  requireAppCheck,
} = require('./stripeHelpers');
const {
  readStoredState,
  publicState,
  authenticatedUid,
  requirePrivateNoStoreResponse,
  isHttpsError,
} = require('./memberDirectoryProfile');
const {
  memberDirectoryProjectionSchemaVersion,
  memberDirectoryNormalizationVersion,
  MEMBER_DIRECTORY_ENTRY_COLLECTION,
  REQUEST_ID_PATTERN,
  readExactDataObject,
  isSafeUid,
  normalizeDirectoryQuery,
  directoryEntryReference,
  readStoredDirectoryProjection,
  buildDirectoryProjection,
  directoryProjectionContentEqual,
} = require('./memberDirectoryProjection');

const SEARCH_RESULT_LIMIT = 24;
const SEARCH_CANDIDATE_LIMIT = 48;
// Searches are explicit form submissions, not typeahead requests. Thirty per
// officer per hour supports normal lookup work while bounding bulk enumeration
// to at most 720 returned rows per hour.
const SEARCH_RATE_LIMIT = 30;
const SEARCH_RATE_WINDOW_MS = 60 * 60 * 1000;
const SEARCH_RATE_SCOPE = 'member_directory_search';
const AUDIT_COLLECTION = 'auditEvents';
const SEARCH_ACTION = 'member_directory.search';
const SEARCH_PURPOSE = 'officer_people_finder';
const SEARCH_OUTCOME = 'succeeded';
const SEARCH_REQUEST_FIELDS = Object.freeze(['requestId', 'query']);
const MEMBER_SEARCH_FIELD_MASK = Object.freeze(['fullName']);
const SEARCH_AUDIT_FIELDS = Object.freeze([
  'actorUid',
  'action',
  'purpose',
  'requestId',
  'queryLengthBucket',
  'resultCount',
  'outcome',
  'createdAt',
]);

const INVALID_REQUEST_MESSAGE = 'Directory search request is invalid.';
const DUPLICATE_REQUEST_MESSAGE = 'Directory search could not be completed.';
const SEARCH_UNAVAILABLE_MESSAGE = 'Directory search is unavailable.';

class MemberDirectorySearchError extends Error {
  constructor(kind) {
    super('Member directory search input is invalid.');
    Object.defineProperty(this, 'name', {
      value: 'MemberDirectorySearchError',
      enumerable: false,
    });
    Object.defineProperty(this, 'kind', {
      value: kind,
      enumerable: false,
    });
    Error.captureStackTrace?.(this, MemberDirectorySearchError);
  }
}

function fail(kind) {
  throw new MemberDirectorySearchError(kind);
}

function sha256(parts) {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest('hex');
}

function readSearchRequest(value) {
  let data;
  try {
    data = readExactDataObject(value, SEARCH_REQUEST_FIELDS, 'request');
  } catch (_error) {
    fail('request');
  }
  if (typeof data.requestId !== 'string' || !REQUEST_ID_PATTERN.test(data.requestId)) {
    fail('request');
  }
  let query;
  try {
    query = normalizeDirectoryQuery(data.query);
  } catch (_error) {
    fail('request');
  }
  return Object.freeze({
    requestId: data.requestId,
    queryDigest: query.digest,
    queryLengthBucket: query.lengthBucket,
  });
}

function searchRateLimitKey(uid) {
  return sha256(['mprc.member-directory.search-rate.v1\0', uid]);
}

function searchAuditDocumentId(uid, requestId) {
  return `member_directory_search_${sha256([
    'mprc.member-directory.search-audit.v1\0',
    uid,
    '\0',
    requestId,
  ])}`;
}

function buildSearchAudit(actorUid, request, resultCount, createdAt) {
  if (!Number.isSafeInteger(resultCount)
    || resultCount < 0
    || resultCount > SEARCH_RESULT_LIMIT) fail('stored');
  return Object.freeze({
    actorUid,
    action: SEARCH_ACTION,
    purpose: SEARCH_PURPOSE,
    requestId: request.requestId,
    queryLengthBucket: request.queryLengthBucket,
    resultCount,
    outcome: SEARCH_OUTCOME,
    createdAt,
  });
}

function resultFromCurrentState(projection, state) {
  const ownPhoto = publicState(state.preference, state.photo, true).photo;
  return Object.freeze({
    entryRef: projection.entryRef,
    displayName: projection.displayName,
    photo: ownPhoto,
  });
}

function compareResults(left, right) {
  if (left.displayName < right.displayName) return -1;
  if (left.displayName > right.displayName) return 1;
  if (left.entryRef < right.entryRef) return -1;
  if (left.entryRef > right.entryRef) return 1;
  return 0;
}

function currentCandidateResult({
  uid,
  entryValue,
  preferenceValue,
  memberValue,
  photoValue,
  queryDigest,
}) {
  let projection;
  let state;
  let desired;
  try {
    projection = readStoredDirectoryProjection(entryValue);
    if (projection.entryRef !== directoryEntryReference(uid)) return null;
    state = readStoredState(preferenceValue, photoValue);
    desired = buildDirectoryProjection({
      uid,
      member: memberValue,
      state,
      existingProjection: projection,
      updatedAt: projection.updatedAt,
    });
  } catch (_error) {
    return null;
  }
  if (!desired
    || !directoryProjectionContentEqual(projection, desired)
    || !desired.prefixDigests.includes(queryDigest)) return null;
  return resultFromCurrentState(desired, state);
}

function snapshotValue(snapshot) {
  return snapshot.exists ? snapshot.data() : null;
}

function refsForCandidate(db, uid) {
  return Object.freeze({
    entry: db.collection(MEMBER_DIRECTORY_ENTRY_COLLECTION).doc(uid),
    preference: db.collection('memberDirectoryPreferences').doc(uid),
    member: db.collection('members').doc(uid),
    photo: db.collection('memberDirectoryPhotos').doc(uid),
  });
}

async function executeDirectorySearch(db, actorUid, request, occurredAt = Timestamp.now()) {
  const auditRef = db.collection(AUDIT_COLLECTION).doc(
    searchAuditDocumentId(actorUid, request.requestId),
  );
  const candidateQuery = db.collection(MEMBER_DIRECTORY_ENTRY_COLLECTION)
    .where('prefixDigests', 'array-contains', request.queryDigest)
    .limit(SEARCH_CANDIDATE_LIMIT);

  try {
    return await db.runTransaction(async (transaction) => {
      // Duplicate command denial happens before candidate enumeration. Concurrent
      // duplicates conflict on the deterministic create and retry into this check.
      const auditSnapshot = await transaction.get(auditRef);
      if (auditSnapshot.exists) fail('duplicate');

      const candidateSnapshot = await transaction.get(candidateQuery);
      const candidateDocuments = Array.isArray(candidateSnapshot.docs)
        ? candidateSnapshot.docs.slice(0, SEARCH_CANDIDATE_LIMIT)
        : [];
      const readableCandidates = candidateDocuments.filter((document) => (
        document
        && typeof document.id === 'string'
        && isSafeUid(document.id)
      ));

      const candidateRefs = readableCandidates.map((candidate) => (
        refsForCandidate(db, candidate.id)
      ));
      let preferenceSnapshots = [];
      let memberSnapshots = [];
      let photoSnapshots = [];
      if (candidateRefs.length > 0) {
        [preferenceSnapshots, memberSnapshots, photoSnapshots] = await Promise.all([
          transaction.getAll(...candidateRefs.map((refs) => refs.preference)),
          transaction.getAll(
            ...candidateRefs.map((refs) => refs.member),
            { fieldMask: [...MEMBER_SEARCH_FIELD_MASK] },
          ),
          transaction.getAll(...candidateRefs.map((refs) => refs.photo)),
        ]);
      }
      const currentSnapshots = readableCandidates.map((candidate, index) => Object.freeze({
        uid: candidate.id,
        entry: candidate,
        preference: preferenceSnapshots[index],
        member: memberSnapshots[index],
        photo: photoSnapshots[index],
      }));

      const results = [];
      for (const current of currentSnapshots) {
        const result = currentCandidateResult({
          uid: current.uid,
          entryValue: snapshotValue(current.entry),
          preferenceValue: snapshotValue(current.preference),
          memberValue: snapshotValue(current.member),
          photoValue: snapshotValue(current.photo),
          queryDigest: request.queryDigest,
        });
        if (result) results.push(result);
      }
      results.sort(compareResults);
      const boundedResults = Object.freeze(results.slice(0, SEARCH_RESULT_LIMIT));
      transaction.create(
        auditRef,
        buildSearchAudit(actorUid, request, boundedResults.length, occurredAt),
      );
      return Object.freeze({
        schemaVersion: memberDirectoryProjectionSchemaVersion,
        results: boundedResults,
      });
    });
  } catch (error) {
    if (error instanceof MemberDirectorySearchError && error.kind === 'duplicate') {
      throw new functions.https.HttpsError('aborted', DUPLICATE_REQUEST_MESSAGE);
    }
    if (isHttpsError(error)) throw error;
    throw new functions.https.HttpsError('internal', SEARCH_UNAVAILABLE_MESSAGE);
  }
}

async function reconcileMemberDirectoryEntry(uid) {
  if (!isSafeUid(uid)) return Object.freeze({ disposition: 'ignored' });
  const db = admin.firestore();
  const refs = refsForCandidate(db, uid);
  return db.runTransaction(async (transaction) => {
    const [memberSnapshot, preferenceSnapshot, photoSnapshot, entrySnapshot] = await Promise.all([
      transaction.get(refs.member),
      transaction.get(refs.preference),
      transaction.get(refs.photo),
      transaction.get(refs.entry),
    ]);

    let state;
    try {
      state = readStoredState(
        snapshotValue(preferenceSnapshot),
        snapshotValue(photoSnapshot),
      );
    } catch (_error) {
      if (entrySnapshot.exists) transaction.delete(refs.entry);
      return Object.freeze({ disposition: 'hidden' });
    }

    let desired;
    try {
      desired = buildDirectoryProjection({
        uid,
        member: snapshotValue(memberSnapshot),
        state,
        existingProjection: snapshotValue(entrySnapshot),
        updatedAt: Timestamp.now(),
      });
    } catch (_error) {
      // Permanently malformed source data is not retryable. Fail closed by
      // removing any discoverable entry; transient Firestore failures still
      // escape the transaction and are retried by the trigger policy.
      if (entrySnapshot.exists) transaction.delete(refs.entry);
      return Object.freeze({ disposition: 'hidden' });
    }
    if (!desired) {
      if (entrySnapshot.exists) transaction.delete(refs.entry);
      return Object.freeze({ disposition: 'hidden' });
    }
    if (entrySnapshot.exists
      && directoryProjectionContentEqual(entrySnapshot.data(), desired)) {
      return Object.freeze({ disposition: 'unchanged' });
    }
    transaction.set(refs.entry, desired);
    return Object.freeze({ disposition: 'synchronized' });
  });
}

const searchMemberDirectory = functions
  .runWith({ enforceAppCheck: true })
  .https.onCall(async (data, context) => {
    requireAppCheck(context);
    requirePrivateNoStoreResponse(context);
    const actorUid = authenticatedUid(context);
    await requireAdmin(context);

    let request;
    try {
      request = readSearchRequest(data);
    } catch (_error) {
      throw new functions.https.HttpsError('invalid-argument', INVALID_REQUEST_MESSAGE);
    }

    try {
      await checkRateLimit({
        scope: SEARCH_RATE_SCOPE,
        key: searchRateLimitKey(actorUid),
        limit: SEARCH_RATE_LIMIT,
        windowMs: SEARCH_RATE_WINDOW_MS,
      });
    } catch (error) {
      if (isHttpsError(error)) throw error;
      throw new functions.https.HttpsError('internal', SEARCH_UNAVAILABLE_MESSAGE);
    }

    return executeDirectorySearch(admin.firestore(), actorUid, request);
  });

const syncMemberDirectoryEntryOnMemberWrite = functions
  .runWith({ failurePolicy: true })
  .firestore
  .document('members/{uid}')
  .onWrite(async (_change, context) => reconcileMemberDirectoryEntry(context.params.uid));

Object.freeze(MemberDirectorySearchError.prototype);
Object.freeze(MemberDirectorySearchError);

module.exports = Object.freeze({
  memberDirectoryProjectionSchemaVersion,
  memberDirectoryNormalizationVersion,
  MEMBER_DIRECTORY_ENTRY_COLLECTION,
  SEARCH_RESULT_LIMIT,
  SEARCH_CANDIDATE_LIMIT,
  MEMBER_SEARCH_FIELD_MASK,
  SEARCH_AUDIT_FIELDS,
  MemberDirectorySearchError,
  readSearchRequest,
  searchRateLimitKey,
  searchAuditDocumentId,
  buildSearchAudit,
  currentCandidateResult,
  executeDirectorySearch,
  reconcileMemberDirectoryEntry,
  searchMemberDirectory,
  syncMemberDirectoryEntryOnMemberWrite,
});
