'use strict';

const { createHash } = require('node:crypto');
const { readRunnerProfileInput, readConnectionConsent } = require('./runnerConnections');
// Reuse the strict shape/UID primitives, never officer consent or directory data.
const { readExactDataObject, isSafeUid, REQUEST_ID_PATTERN } = require('./memberDirectoryProjection');

const PROFILE_COLLECTION = 'runnerConnectionProfiles';
// Version of this source contract, not evidence that a consent notice is approved.
const CONSENT_VERSION = 1;
const PRIVATE_CONSENT = Object.freeze({ memberDiscovery: false, similarity: false, broadenCircle: false });
const MESSAGES = Object.freeze({
  'invalid-argument': 'Runner connection request is invalid.',
  'permission-denied': 'Runner connection access is unavailable.',
  aborted: 'Runner connection profile changed. Reload before trying again.',
  unavailable: 'Runner connection service is unavailable.',
});
const ACTIONS = Object.freeze({
  save: 'runner_connection.profile_saved',
  withdraw: 'runner_connection.profile_withdrawn',
});

class RunnerProfileError extends Error {
  constructor(code) {
    super(MESSAGES[code]);
    this.code = code;
  }
}

function fail(code = 'unavailable') { throw new RunnerProfileError(code); }

function revision(value) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < 0
    || value >= Number.MAX_SAFE_INTEGER) fail('invalid-argument');
  return value;
}

function digest(value) { return createHash('sha256').update(value).digest('hex'); }

function readCommand(input, operation) {
  try {
    const fields = ['requestId', 'expectedRevision'];
    if (operation === 'save') fields.push('profile', 'consent', 'consentVersion', 'adultConfirmed');
    const data = readExactDataObject(input, fields);
    if (typeof data.requestId !== 'string' || !REQUEST_ID_PATTERN.test(data.requestId)) fail('invalid-argument');
    if (revision(data.expectedRevision) >= Number.MAX_SAFE_INTEGER - 1
      || (operation === 'save' && (data.consentVersion !== CONSENT_VERSION
        || data.adultConfirmed !== true))) fail('invalid-argument');
    const command = {
      requestId: data.requestId,
      expectedRevision: revision(data.expectedRevision),
      consentVersion: CONSENT_VERSION,
      adultConfirmed: operation === 'save',
      profile: operation === 'save' ? readRunnerProfileInput(data.profile) : null,
      consent: operation === 'save' ? readConnectionConsent(data.consent) : PRIVATE_CONSENT,
    };
    return Object.freeze({ ...command, requestDigest: digest(JSON.stringify([operation, command])) });
  } catch { return fail('invalid-argument'); }
}

// Snapshot a closed wire request before any asynchronous service work. The
// store validates again so its direct callers cannot bypass the same contract.
function readRunnerProfileRequest(input, operation) {
  if (!['save', 'withdraw'].includes(operation)) fail('invalid-argument');
  const command = readCommand(input, operation);
  const request = { requestId: command.requestId, expectedRevision: command.expectedRevision };
  if (operation === 'save') Object.assign(request, {
    profile: command.profile,
    consent: command.consent,
    consentVersion: command.consentVersion,
    adultConfirmed: command.adultConfirmed,
  });
  return Object.freeze(request);
}

function publicState(state) {
  return Object.freeze({
    schemaVersion: 1,
    consentVersion: CONSENT_VERSION,
    adultConfirmed: state?.adultConfirmed === true,
    revision: state?.revision || 0,
    profile: state?.profile || null,
    consent: state?.consent || PRIVATE_CONSENT,
  });
}

function readStoredProfile(value, now) {
  if (value === null) return null;
  const data = readExactDataObject(value, [
    'schemaVersion', 'consentVersion', 'adultConfirmed', 'revision', 'profile', 'consent', 'discoverable',
    'updatedAtMs', 'lastRequestId',
  ]);
  if (data.schemaVersion !== 1 || data.consentVersion !== CONSENT_VERSION || revision(data.revision) < 1
    || typeof data.lastRequestId !== 'string' || !REQUEST_ID_PATTERN.test(data.lastRequestId)
    || !Number.isSafeInteger(data.updatedAtMs) || data.updatedAtMs < 0 || data.updatedAtMs > now) fail();
  const consent = readConnectionConsent(data.consent);
  const profile = data.profile === null ? null : readRunnerProfileInput(data.profile);
  if (data.adultConfirmed !== (profile !== null)
    || data.discoverable !== consent.memberDiscovery || (profile === null
    && (consent.memberDiscovery || consent.similarity || consent.broadenCircle))) fail();
  return { ...data, profile, consent };
}

function readAudit(value) {
  const data = readExactDataObject(value, [
    'schemaVersion', 'actorUid', 'action', 'requestId', 'requestDigest',
    'expectedRevision', 'revision', 'createdAtMs',
  ]);
  if (data.schemaVersion !== 1 || !isSafeUid(data.actorUid)
    || !Object.values(ACTIONS).includes(data.action)
    || typeof data.requestId !== 'string' || !REQUEST_ID_PATTERN.test(data.requestId)
    || typeof data.requestDigest !== 'string' || !/^[0-9a-f]{64}$/.test(data.requestDigest)
    || revision(data.revision) !== revision(data.expectedRevision) + 1
    || !Number.isSafeInteger(data.createdAtMs) || data.createdAtMs < 0) fail();
  return data;
}

/**
 * Unexported-by-Firebase persistence primitive. The required trusted authorize
 * callback must check the current actor for each operation/transaction attempt.
 * No default grants access. It must NOT be supplied by a browser or replaced
 * by the ranker's booleans. runnerConnectionService supplies the disabled,
 * emulator-tested Auth/membership/App Check adapter; live release still needs
 * approved canonical membership population and hosted enforcement evidence.
 */
function createRunnerProfileStore({ db, authorize, now = Date.now } = {}) {
  if (!db || typeof db.runTransaction !== 'function' || typeof db.collection !== 'function'
    || typeof authorize !== 'function' || typeof now !== 'function') fail();

  async function transact(uid, operation, work) {
    if (!isSafeUid(uid)) fail('invalid-argument');
    try {
      return await db.runTransaction(async (transaction) => {
        if (await authorize({ uid, operation, transaction }) !== true) fail('permission-denied');
        const timestamp = now();
        if (!Number.isSafeInteger(timestamp) || timestamp < 0) fail();
        const ref = db.collection(PROFILE_COLLECTION).doc(uid);
        const snapshot = await transaction.get(ref);
        let state;
        try { state = readStoredProfile(snapshot.exists ? snapshot.data() : null, timestamp); } catch { fail(); }
        return work({ transaction, ref, state, timestamp });
      });
    } catch (error) {
      if (error instanceof RunnerProfileError) throw error;
      return fail();
    }
  }

  async function mutate(uid, input, operation) {
    // Close the request before any read or authorization callback. UID is a
    // server-selected argument, never a permitted field of the request body.
    const command = readCommand(input, operation);
    return transact(uid, operation, async ({ transaction, ref, state, timestamp }) => {
      const auditRef = db.collection('auditEvents').doc(`runner_profile_${digest(JSON.stringify([uid, command.requestId]))}`);
      const auditSnapshot = await transaction.get(auditRef);
      if (auditSnapshot.exists) {
        let audit;
        try { audit = readAudit(auditSnapshot.data()); } catch { fail(); }
        if (!state || audit.actorUid !== uid || audit.createdAtMs > timestamp) fail();
        if (audit.action !== ACTIONS[operation] || audit.requestId !== command.requestId
          || audit.requestDigest !== command.requestDigest || audit.expectedRevision !== command.expectedRevision
          || state.revision !== audit.revision || state.lastRequestId !== command.requestId) fail('aborted');
        return publicState(state);
      }
      if (state?.lastRequestId === command.requestId) fail();
      if ((state?.revision || 0) !== command.expectedRevision) fail('aborted');
      const next = {
        schemaVersion: 1,
        consentVersion: CONSENT_VERSION,
        adultConfirmed: command.adultConfirmed,
        revision: command.expectedRevision + 1,
        profile: command.profile,
        consent: command.consent,
        discoverable: command.consent.memberDiscovery,
        updatedAtMs: timestamp,
        lastRequestId: command.requestId,
      };
      // Audit contains operation metadata only, never the card/pace/goals or raw
      // request. The fingerprint is server-only, not anonymous public data.
      transaction.set(ref, next);
      transaction.create(auditRef, {
        schemaVersion: 1,
        actorUid: uid,
        action: ACTIONS[operation],
        requestId: command.requestId,
        requestDigest: command.requestDigest,
        expectedRevision: command.expectedRevision,
        revision: next.revision,
        createdAtMs: timestamp,
      });
      return publicState(next);
    });
  }

  return Object.freeze({
    readOwn: (uid) => transact(uid, 'read', ({ state }) => publicState(state)),
    saveOwn: (uid, request) => mutate(uid, request, 'save'),
    withdrawOwn: (uid, request) => mutate(uid, request, 'withdraw'),
  });
}

module.exports = {
  PROFILE_COLLECTION, CONSENT_VERSION, createRunnerProfileStore, readRunnerProfileRequest,
};
