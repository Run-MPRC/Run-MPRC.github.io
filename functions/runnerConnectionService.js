'use strict';

const { createHash } = require('node:crypto');
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { checkRateLimit } = require('./rateLimit');
const { readExactDataObject, isSafeUid } = require('./memberDirectoryProjection');
const { deriveMembershipEntitlement } = require('./membershipAuthority');
const { createRunnerProfileStore, readRunnerProfileRequest } = require('./runnerConnectionProfiles');

// Additive consumer contract, NOT an enrollment/payment writer. Before enabling
// a service, #81/#114/#115 must establish approved canonical records and unique
// account association here. Missing, duplicate or invalid records deny saves.
const MEMBERSHIP_COLLECTION = 'memberships';
const RUNTIME = Object.freeze({
  enforceAppCheck: true, minInstances: 0, maxInstances: 2, memory: '256MB', timeoutSeconds: 30,
});
const LIMITS = Object.freeze({ read: 30, save: 12, withdraw: 12 });
const MESSAGES = Object.freeze({
  'failed-precondition': 'Runner connections are not available yet.',
  unauthenticated: 'Sign in again to use runner connections.',
  'permission-denied': 'Runner connection access is unavailable.',
  'invalid-argument': 'Runner connection request is invalid.',
  'resource-exhausted': 'Too many requests. Please wait before trying again.',
  aborted: 'Runner connection profile changed. Reload before trying again.',
  unavailable: 'Runner connection service is unavailable.',
});

function error(code) { return new functions.https.HttpsError(code, MESSAGES[code]); }

function accountRateKey(uid) {
  return createHash('sha256').update(JSON.stringify(['runner_connections_v1', uid])).digest('hex');
}

function requireContext(context, timestamp) {
  // context.app/auth are supplied by the callable runtime, never request data.
  // Native App Check enforcement is unconditional; no ENFORCE_APP_CHECK switch.
  if (typeof context?.app?.appId !== 'string' || !context.app.appId.length) {
    throw error('permission-denied');
  }
  const uid = context.auth?.uid;
  const authTime = context.auth?.token?.auth_time;
  if (!isSafeUid(uid) || context.auth.token?.email_verified !== true
    || !Number.isSafeInteger(authTime) || authTime <= 0
    || authTime > Math.floor(timestamp / 1000)) throw error('unauthenticated');
  return Object.freeze({ uid, authTime });
}

async function currentAccount(auth, subject) {
  let user;
  try { user = await auth.getUser(subject.uid); } catch (failure) {
    if (failure?.code === 'auth/user-not-found') return false;
    throw error('unavailable');
  }
  // Admin SDK represents a never-revoked account with undefined. Match that
  // documented SDK meaning only for absence; malformed present values deny.
  const validAfter = user.tokensValidAfterTime === undefined ? 0
    : (typeof user.tokensValidAfterTime === 'string' ? Date.parse(user.tokensValidAfterTime) : NaN);
  return user.uid === subject.uid && user.disabled === false && user.emailVerified === true
    && Number.isSafeInteger(validAfter) && validAfter >= 0
    && subject.authTime * 1000 >= validAfter;
}

async function currentMembership(db, transaction, uid, now) {
  // A two-record bound detects ambiguity without reading the roster. Association
  // is explicit, never inferred from email, account role or a browser profile.
  const matches = await transaction.get(db.collection(MEMBERSHIP_COLLECTION)
    .where('association.uid', '==', uid).limit(2));
  if (matches.size !== 1) return false;
  const record = matches.docs[0].data();
  if (record.membershipId !== matches.docs[0].id) return false;
  try {
    return deriveMembershipEntitlement({
      membershipAuthoritySchemaVersion: 1, record, uid, asOfMs: now(),
    }).entitlement === 'current_member';
  } catch { return false; }
}

/**
 * Disabled-by-default callable factory. Not imported/exported by index.js.
 * Enabling requires reviewed membership population, App Check and staged proof;
 * neither caller input nor environment variables can flip the source gate.
 */
function createRunnerConnectionCallables({
  enabled = false, db, auth, rateLimit = checkRateLimit, now = Date.now,
} = {}) {
  function callable(operation) {
    return functions.runWith(RUNTIME).https.onCall(async (data, context) => {
      try {
        const response = context?.rawRequest?.res;
        if (typeof response?.setHeader !== 'function') throw error('unavailable');
        response.setHeader('Cache-Control', 'private, no-store, max-age=0');
        response.setHeader('Pragma', 'no-cache');
        if (enabled !== true) throw error('failed-precondition');
        const timestamp = now();
        if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw error('unavailable');
        const subject = requireContext(context, timestamp);
        let request;
        try {
          request = operation === 'read'
            ? readExactDataObject(data, []) : readRunnerProfileRequest(data, operation);
        } catch { throw error('invalid-argument'); }
        // Meter each network attempt, even retries and denied members. Withdrawal
        // has its own bucket so exhausted browsing/save limits cannot strand it.
        await rateLimit({
          scope: `runner_connection_${operation}`, key: accountRateKey(subject.uid),
          limit: LIMITS[operation], windowMs: 60 * 60 * 1000,
        });
        const database = db || admin.firestore();
        const authentication = auth || admin.auth();
        const store = createRunnerProfileStore({
          db: database, now,
          authorize: async ({ uid, operation: attemptedOperation, transaction }) => {
            if (uid !== subject.uid || attemptedOperation !== operation
              || !await currentAccount(authentication, subject)) return false;
            // Ownership, current account and a non-revoked session suffice to
            // read/remove one's own card after membership expires. No other
            // profiles, recommendations or renewed discovery are granted.
            return operation !== 'save'
              || currentMembership(database, transaction, uid, now);
          },
        });
        if (operation === 'read') return await store.readOwn(subject.uid);
        if (operation === 'save') return await store.saveOwn(subject.uid, request);
        return await store.withdrawOwn(subject.uid, request);
      } catch (failure) {
        const code = typeof failure?.code === 'string' && Object.hasOwn(MESSAGES, failure.code)
          ? failure.code : 'unavailable';
        // Never forward an SDK error's message, details, request or identifiers.
        throw error(code);
      }
    });
  }
  return Object.freeze({
    getMyRunnerConnectionProfile: callable('read'),
    saveMyRunnerConnectionProfile: callable('save'),
    withdrawMyRunnerConnectionProfile: callable('withdraw'),
  });
}

module.exports = { MEMBERSHIP_COLLECTION, RUNTIME, accountRateKey, createRunnerConnectionCallables };
