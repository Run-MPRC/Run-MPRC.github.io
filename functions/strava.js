const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { Timestamp } = require('firebase-admin/firestore');
const { URL: NodeURL } = require('node:url');
const { types: { isProxy } } = require('node:util');
const { requireAppCheck } = require('./stripeHelpers');

const STRAVA_TOKEN_URL = 'https://www.strava.com/api/v3/oauth/token';
const STRAVA_DEAUTH_URL = 'https://www.strava.com/oauth/deauthorize';
const STRAVA_ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities';
const STRAVA_STATS_URL = (id) => `https://www.strava.com/api/v3/athletes/${id}/stats`;
const STRAVA_AUTHORIZATION_ERROR_MESSAGE = 'Strava authorization could not be completed.';
const STRAVA_AUTHORIZATION_CODE_MAX_LENGTH = 1_024;
const STRAVA_TOKEN_MAX_LENGTH = 2_048;
const STRAVA_SCOPE_MAX_LENGTH = 1_024;
const STRAVA_PROFILE_TEXT_MAX_LENGTH = 1_024;
const STRAVA_PROFILE_URL_MAX_LENGTH = 2_048;
const STRAVA_RECENT_ACTIVITY_LIMIT = 5;
const STRAVA_ACTIVITY_NAME_MAX_LENGTH = 1_024;
const STRAVA_ACTIVITY_TYPE_MAX_LENGTH = 128;
const STRAVA_ACTIVITY_DATE_MAX_LENGTH = 64;
const STRAVA_LONG_MAX_AS_NUMBER = 9_223_372_036_854_776_000;
const STRAVA_REFRESH_ERROR_MESSAGE = 'Strava connection could not be refreshed.';
const STRAVA_DATA_ERROR_MESSAGE = 'Strava activity data could not be loaded.';
const VISIBLE_ASCII_PATTERN = /^[\x21-\x7e]+$/;
const OAUTH_SCOPE_PATTERN = /^[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*$/;
const PROFILE_WHITESPACE_OR_BACKSLASH_PATTERN = /[\s\\]/u;
const HTTPS_PREFIX_PATTERN = /^https:\/\//iu;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const objectPrototype = Object.prototype;
const arrayIsArray = Array.isArray;
const arrayPrototype = Array.prototype;
const arrayPush = Array.prototype.push;
const numberIsFinite = Number.isFinite;
const numberIsInteger = Number.isInteger;
const numberIsSafeInteger = Number.isSafeInteger;
const reflectApply = Reflect.apply;
const reflectHas = Reflect.has;
const regexpTest = RegExp.prototype.test;
const stringCharCodeAt = String.prototype.charCodeAt;
const INVALID_SELECTED_VALUE = Symbol('invalid-selected-value');
const MISSING_SELECTED_VALUE = Symbol('missing-selected-value');

function stravaAuthorizationError(code) {
  return new functions.https.HttpsError(code, STRAVA_AUTHORIZATION_ERROR_MESSAGE);
}

function stravaRefreshError(code) {
  return new functions.https.HttpsError(code, STRAVA_REFRESH_ERROR_MESSAGE);
}

function stravaDataError(code) {
  return new functions.https.HttpsError(code, STRAVA_DATA_ERROR_MESSAGE);
}

function patternMatches(pattern, value) {
  return reflectApply(regexpTest, pattern, [value]);
}

function isPlainJsonRecord(value) {
  if (value === null || typeof value !== 'object' || isProxy(value)) return false;
  try {
    return objectGetPrototypeOf(value) === objectPrototype;
  } catch (_error) {
    return false;
  }
}

function selectedOwnDataValue(record, key, required) {
  let descriptor;
  try {
    descriptor = objectGetOwnPropertyDescriptor(record, key);
  } catch (_error) {
    return INVALID_SELECTED_VALUE;
  }
  if (!descriptor) return required ? INVALID_SELECTED_VALUE : MISSING_SELECTED_VALUE;
  if (!reflectApply(objectHasOwnProperty, descriptor, ['value'])) {
    return INVALID_SELECTED_VALUE;
  }
  return descriptor.value;
}

function selectedProviderDataValue(record, key, required) {
  const selected = selectedOwnDataValue(record, key, required);
  if (selected !== MISSING_SELECTED_VALUE) return selected;
  try {
    return reflectApply(reflectHas, Reflect, [record, key])
      ? INVALID_SELECTED_VALUE
      : MISSING_SELECTED_VALUE;
  } catch (_error) {
    return INVALID_SELECTED_VALUE;
  }
}

function isBoundedVisibleAscii(value, maxLength) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && patternMatches(VISIBLE_ASCII_PATTERN, value);
}

function isPositiveSafeInteger(value) {
  return typeof value === 'number' && numberIsSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value) {
  return typeof value === 'number' && numberIsSafeInteger(value) && value >= 0;
}

function isFiniteNumberInRange(value, maximum) {
  return typeof value === 'number'
    && numberIsFinite(value)
    && value >= 0
    && value <= maximum;
}

function isPositiveIntegerInRange(value, maximum) {
  return typeof value === 'number'
    && numberIsFinite(value)
    && numberIsInteger(value)
    && value > 0
    && value <= maximum;
}

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = reflectApply(stringCharCodeAt, value, [index]);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return true;
      const nextCodeUnit = reflectApply(stringCharCodeAt, value, [index + 1]);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function hasControlCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = reflectApply(stringCharCodeAt, value, [index]);
    if (codeUnit <= 0x1f || (codeUnit >= 0x7f && codeUnit <= 0x9f)) return true;
  }
  return false;
}

function isBoundedProfileText(value, maxLength) {
  return typeof value === 'string'
    && value.length <= maxLength
    && !hasLoneSurrogate(value)
    && !hasControlCharacter(value);
}

function optionalProfileText(record, key) {
  const value = selectedOwnDataValue(record, key, false);
  if (value === MISSING_SELECTED_VALUE || value === null || value === '') return null;
  if (!isBoundedProfileText(value, STRAVA_PROFILE_TEXT_MAX_LENGTH)) {
    return INVALID_SELECTED_VALUE;
  }
  return value;
}

function optionalScope(record) {
  const value = selectedOwnDataValue(record, 'scope', false);
  if (value === MISSING_SELECTED_VALUE || value === null || value === '') return null;
  if (
    typeof value !== 'string'
    || value.length > STRAVA_SCOPE_MAX_LENGTH
    || !patternMatches(OAUTH_SCOPE_PATTERN, value)
  ) {
    return INVALID_SELECTED_VALUE;
  }
  return value;
}

function isCredentialFreeHttpsUrl(value) {
  if (
    !isBoundedProfileText(value, STRAVA_PROFILE_URL_MAX_LENGTH)
    || value.length === 0
    || patternMatches(PROFILE_WHITESPACE_OR_BACKSLASH_PATTERN, value)
    || !patternMatches(HTTPS_PREFIX_PATTERN, value)
  ) {
    return false;
  }

  let parsed;
  try {
    parsed = new NodeURL(value);
  } catch (_error) {
    return false;
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname.length === 0
    || parsed.username.length !== 0
    || parsed.password.length !== 0
  ) {
    return false;
  }

  const authorityStart = 'https://'.length;
  const authorityEndCandidate = value.slice(authorityStart).search(/[/?#]/u);
  const authorityEnd = authorityEndCandidate === -1
    ? value.length
    : authorityStart + authorityEndCandidate;
  return !value.slice(authorityStart, authorityEnd).includes('@');
}

function optionalProfileUrl(record) {
  const value = selectedOwnDataValue(record, 'profile', false);
  if (value === MISSING_SELECTED_VALUE || value === null || value === '') return null;
  return isCredentialFreeHttpsUrl(value) ? value : INVALID_SELECTED_VALUE;
}

function optionalStoredProfileUrl(record) {
  const value = selectedOwnDataValue(record, 'profileUrl', false);
  if (value === MISSING_SELECTED_VALUE || value === null || value === '') return null;
  return isCredentialFreeHttpsUrl(value) ? value : INVALID_SELECTED_VALUE;
}

function isPlainActivityArray(value) {
  if (value === null || typeof value !== 'object' || isProxy(value)) return false;
  try {
    return arrayIsArray(value) && objectGetPrototypeOf(value) === arrayPrototype;
  } catch (_error) {
    return false;
  }
}

function isMissingFallbackValue(value) {
  return value === MISSING_SELECTED_VALUE
    || value === undefined
    || value === null
    || value === '';
}

function selectActivityFallbackText(record, preferredKey, fallbackKey, validator) {
  const preferred = selectedProviderDataValue(record, preferredKey, false);
  if (preferred === INVALID_SELECTED_VALUE) return INVALID_SELECTED_VALUE;
  if (!isMissingFallbackValue(preferred)) {
    return validator(preferred) ? preferred : INVALID_SELECTED_VALUE;
  }

  const fallback = selectedProviderDataValue(record, fallbackKey, false);
  if (
    fallback === INVALID_SELECTED_VALUE
    || isMissingFallbackValue(fallback)
    || !validator(fallback)
  ) {
    return INVALID_SELECTED_VALUE;
  }
  return fallback;
}

function isBoundedActivityName(value) {
  return typeof value === 'string'
    && value.length > 0
    && isBoundedProfileText(value, STRAVA_ACTIVITY_NAME_MAX_LENGTH);
}

function isBoundedActivityType(value) {
  return typeof value === 'string'
    && value.length > 0
    && isBoundedProfileText(value, STRAVA_ACTIVITY_TYPE_MAX_LENGTH);
}

function snapshotProviderActivity(record) {
  if (!isPlainJsonRecord(record)) return null;

  const id = selectedOwnDataValue(record, 'id', true);
  const name = selectedOwnDataValue(record, 'name', true);
  const type = selectActivityFallbackText(
    record,
    'type',
    'sport_type',
    isBoundedActivityType,
  );
  const distance = selectedOwnDataValue(record, 'distance', true);
  const movingTime = selectedOwnDataValue(record, 'moving_time', true);
  const startDate = selectActivityFallbackText(
    record,
    'start_date_local',
    'start_date',
    (value) => isBoundedVisibleAscii(value, STRAVA_ACTIVITY_DATE_MAX_LENGTH),
  );
  if (
    !isPositiveIntegerInRange(id, STRAVA_LONG_MAX_AS_NUMBER)
    || !isBoundedActivityName(name)
    || type === INVALID_SELECTED_VALUE
    || !isFiniteNumberInRange(distance, Number.MAX_SAFE_INTEGER)
    || !isNonNegativeSafeInteger(movingTime)
    || startDate === INVALID_SELECTED_VALUE
  ) {
    return null;
  }

  return objectFreeze({
    id,
    name,
    type,
    distanceMeters: distance,
    movingTimeSeconds: movingTime,
    startDate,
  });
}

function snapshotProviderActivities(response) {
  if (!isPlainActivityArray(response)) return null;

  const length = selectedOwnDataValue(response, 'length', true);
  if (
    !isNonNegativeSafeInteger(length)
    || length > STRAVA_RECENT_ACTIVITY_LIMIT
  ) {
    return null;
  }

  const activities = [];
  for (let index = 0; index < length; index += 1) {
    const record = selectedOwnDataValue(response, String(index), true);
    if (record === INVALID_SELECTED_VALUE) return null;
    const activity = snapshotProviderActivity(record);
    if (!activity) return null;
    reflectApply(arrayPush, activities, [activity]);
  }
  return objectFreeze(activities);
}

function snapshotProviderTotal(root, key) {
  const selected = selectedProviderDataValue(root, key, false);
  if (selected === INVALID_SELECTED_VALUE) return null;
  if (selected === MISSING_SELECTED_VALUE || selected === null) {
    return objectFreeze({ distance: 0, count: 0 });
  }
  if (selected === root || !isPlainJsonRecord(selected)) return null;

  const rawDistance = selectedProviderDataValue(selected, 'distance', false);
  const rawCount = selectedProviderDataValue(selected, 'count', false);
  if (
    rawDistance === INVALID_SELECTED_VALUE
    || rawCount === INVALID_SELECTED_VALUE
  ) {
    return null;
  }
  const distance = rawDistance === MISSING_SELECTED_VALUE || rawDistance === null
    ? 0
    : rawDistance;
  const count = rawCount === MISSING_SELECTED_VALUE || rawCount === null
    ? 0
    : rawCount;
  if (
    !isFiniteNumberInRange(distance, Number.MAX_SAFE_INTEGER)
    || !isNonNegativeSafeInteger(count)
  ) {
    return null;
  }
  return objectFreeze({ distance, count });
}

function snapshotProviderStats(response) {
  if (!isPlainJsonRecord(response)) return null;

  const yearRun = snapshotProviderTotal(response, 'ytd_run_totals');
  const yearRide = snapshotProviderTotal(response, 'ytd_ride_totals');
  const allRun = snapshotProviderTotal(response, 'all_run_totals');
  if (!yearRun || !yearRide || !allRun) return null;

  return objectFreeze({
    yearToDate: objectFreeze({
      runMeters: yearRun.distance,
      runCount: yearRun.count,
      rideMeters: yearRide.distance,
      rideCount: yearRide.count,
    }),
    allTime: objectFreeze({
      runMeters: allRun.distance,
      runCount: allRun.count,
    }),
  });
}

function snapshotStoredConnection(record) {
  if (!isPlainJsonRecord(record)) return null;

  const provider = selectedOwnDataValue(record, 'provider', true);
  const athleteId = selectedOwnDataValue(record, 'athleteId', true);
  const firstName = optionalProfileText(record, 'firstName');
  const lastName = optionalProfileText(record, 'lastName');
  const username = optionalProfileText(record, 'username');
  const profileUrl = optionalStoredProfileUrl(record);
  if (
    provider !== 'strava'
    || !isPositiveSafeInteger(athleteId)
    || firstName === INVALID_SELECTED_VALUE
    || lastName === INVALID_SELECTED_VALUE
    || username === INVALID_SELECTED_VALUE
    || profileUrl === INVALID_SELECTED_VALUE
  ) {
    return null;
  }

  return objectFreeze({
    provider,
    athleteId,
    firstName,
    lastName,
    username,
    profileUrl,
  });
}

function snapshotAuthorizationExchangeResponse(response) {
  if (!isPlainJsonRecord(response)) return null;

  const accessToken = selectedOwnDataValue(response, 'access_token', true);
  const refreshToken = selectedOwnDataValue(response, 'refresh_token', true);
  const expiresAt = selectedOwnDataValue(response, 'expires_at', true);
  const scope = optionalScope(response);
  const athleteRecord = selectedOwnDataValue(response, 'athlete', true);
  if (
    !isBoundedVisibleAscii(accessToken, STRAVA_TOKEN_MAX_LENGTH)
    || !isBoundedVisibleAscii(refreshToken, STRAVA_TOKEN_MAX_LENGTH)
    || !isPositiveSafeInteger(expiresAt)
    || scope === INVALID_SELECTED_VALUE
    || !isPlainJsonRecord(athleteRecord)
  ) {
    return null;
  }

  const athleteId = selectedOwnDataValue(athleteRecord, 'id', true);
  const firstName = optionalProfileText(athleteRecord, 'firstname');
  const lastName = optionalProfileText(athleteRecord, 'lastname');
  const username = optionalProfileText(athleteRecord, 'username');
  const profileUrl = optionalProfileUrl(athleteRecord);
  if (
    !isPositiveSafeInteger(athleteId)
    || firstName === INVALID_SELECTED_VALUE
    || lastName === INVALID_SELECTED_VALUE
    || username === INVALID_SELECTED_VALUE
    || profileUrl === INVALID_SELECTED_VALUE
  ) {
    return null;
  }

  return objectFreeze({
    accessToken,
    refreshToken,
    expiresAt,
    scope,
    athlete: objectFreeze({
      id: athleteId,
      firstName,
      lastName,
      username,
      profileUrl,
    }),
  });
}

function snapshotRefreshTokenResponse(response) {
  if (!isPlainJsonRecord(response)) return null;

  const accessToken = selectedOwnDataValue(response, 'access_token', true);
  const refreshToken = selectedOwnDataValue(response, 'refresh_token', true);
  const expiresAt = selectedOwnDataValue(response, 'expires_at', true);
  if (
    !isBoundedVisibleAscii(accessToken, STRAVA_TOKEN_MAX_LENGTH)
    || !isBoundedVisibleAscii(refreshToken, STRAVA_TOKEN_MAX_LENGTH)
    || !isPositiveSafeInteger(expiresAt)
  ) {
    return null;
  }

  return objectFreeze({ accessToken, refreshToken, expiresAt });
}

function snapshotStoredTokenSecret(record) {
  if (!isPlainJsonRecord(record)) return null;

  const accessToken = selectedOwnDataValue(record, 'access_token', true);
  const refreshToken = selectedOwnDataValue(record, 'refresh_token', true);
  const expiresAt = selectedOwnDataValue(record, 'expires_at', true);
  if (
    !isBoundedVisibleAscii(accessToken, STRAVA_TOKEN_MAX_LENGTH)
    || !isBoundedVisibleAscii(refreshToken, STRAVA_TOKEN_MAX_LENGTH)
    || !isPositiveSafeInteger(expiresAt)
  ) {
    return null;
  }

  return objectFreeze({ accessToken, refreshToken, expiresAt });
}

function snapshotStoredDisconnectAccessToken(record) {
  if (!isPlainJsonRecord(record)) return null;

  const accessToken = selectedOwnDataValue(record, 'access_token', false);
  return isBoundedVisibleAscii(accessToken, STRAVA_TOKEN_MAX_LENGTH)
    ? accessToken
    : null;
}

function getStravaCreds() {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Strava credentials not configured',
    );
  }
  return { clientId, clientSecret };
}

function connectionDocRef(uid, db = admin.firestore()) {
  return db
    .collection('members').doc(uid)
    .collection('connections').doc('strava');
}

function secretDocRef(uid, db = admin.firestore()) {
  return db
    .collection('members').doc(uid)
    .collection('secrets').doc('strava');
}

async function exchangeCode(code) {
  const { clientId, clientSecret } = getStravaCreds();
  let resp;
  try {
    resp = await fetch(STRAVA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      }),
    });
  } catch (_error) {
    throw stravaAuthorizationError('unavailable');
  }
  if (!resp || resp.ok !== true) {
    throw stravaAuthorizationError('invalid-argument');
  }
  let response;
  try {
    response = await resp.json();
  } catch (_error) {
    throw stravaAuthorizationError('unavailable');
  }
  const exchange = snapshotAuthorizationExchangeResponse(response);
  if (!exchange) {
    throw stravaAuthorizationError('internal');
  }
  return exchange;
}

async function refreshToken(refresh) {
  const { clientId, clientSecret } = getStravaCreds();
  let resp;
  try {
    resp = await fetch(STRAVA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refresh,
        grant_type: 'refresh_token',
      }),
    });
  } catch (_error) {
    throw stravaRefreshError('unavailable');
  }
  if (!resp || resp.ok !== true) {
    throw stravaRefreshError('failed-precondition');
  }
  let response;
  try {
    response = await resp.json();
  } catch (_error) {
    throw stravaRefreshError('unavailable');
  }
  const refreshed = snapshotRefreshTokenResponse(response);
  if (!refreshed) {
    throw stravaRefreshError('internal');
  }
  return refreshed;
}

async function getFreshAccessToken(uid) {
  const snap = await secretDocRef(uid).get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('failed-precondition', 'Strava not connected');
  }
  const stored = snapshotStoredTokenSecret(snap.data());
  if (!stored) {
    throw stravaRefreshError('internal');
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (stored.expiresAt - nowSec > 60) {
    return stored.accessToken;
  }
  const refreshed = await refreshToken(stored.refreshToken);
  await secretDocRef(uid).set({
    access_token: refreshed.accessToken,
    refresh_token: refreshed.refreshToken,
    expires_at: refreshed.expiresAt,
    updatedAt: Timestamp.now(),
  }, { merge: true });
  return refreshed.accessToken;
}

exports.stravaExchangeCode = functions
  .runWith({ secrets: ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET'] })
  .https.onCall(async (data, context) => {
    requireAppCheck(context);
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }
    const { code } = data || {};
    if (
      typeof code !== 'string'
      || code.length === 0
      || code.length > STRAVA_AUTHORIZATION_CODE_MAX_LENGTH
    ) {
      throw stravaAuthorizationError('invalid-argument');
    }
    const { uid } = context.auth;

    const exchange = await exchangeCode(code);

    try {
      const db = admin.firestore();
      const batch = db.batch();
      batch.set(secretDocRef(uid, db), {
        access_token: exchange.accessToken,
        refresh_token: exchange.refreshToken,
        expires_at: exchange.expiresAt,
        scope: exchange.scope,
        updatedAt: Timestamp.now(),
      }, { merge: true });
      batch.set(connectionDocRef(uid, db), {
        provider: 'strava',
        athleteId: exchange.athlete.id,
        firstName: exchange.athlete.firstName,
        lastName: exchange.athlete.lastName,
        username: exchange.athlete.username,
        profileUrl: exchange.athlete.profileUrl,
        connectedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }, { merge: true });
      await batch.commit();
    } catch (_error) {
      throw stravaAuthorizationError('internal');
    }

    return { ok: true, athleteId: exchange.athlete.id };
  });

exports.stravaFetchStats = functions
  .runWith({ secrets: ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET'] })
  .https.onCall(async (data, context) => {
    requireAppCheck(context);
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }
    const { uid } = context.auth;

    const connSnap = await connectionDocRef(uid).get();
    if (!connSnap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'Strava not connected');
    }
    const conn = snapshotStoredConnection(connSnap.data());
    if (!conn) {
      throw stravaDataError('internal');
    }
    const token = await getFreshAccessToken(uid);

    const headers = { Authorization: `Bearer ${token}` };

    let activitiesResp;
    let statsResp;
    try {
      [activitiesResp, statsResp] = await Promise.all([
        fetch(`${STRAVA_ACTIVITIES_URL}?per_page=5`, { headers }),
        conn.athleteId ? fetch(STRAVA_STATS_URL(conn.athleteId), { headers }) : null,
      ]);
    } catch (_error) {
      throw stravaDataError('unavailable');
    }

    if (!activitiesResp || !activitiesResp.ok) {
      throw stravaDataError('internal');
    }
    let rawActivities;
    try {
      rawActivities = await activitiesResp.json();
    } catch (_error) {
      throw stravaDataError('unavailable');
    }
    const recentActivities = snapshotProviderActivities(rawActivities);
    if (!recentActivities) {
      throw stravaDataError('internal');
    }

    let projectedStats = null;
    if (statsResp && statsResp.ok) {
      let rawStats;
      try {
        rawStats = await statsResp.json();
      } catch (_error) {
        throw stravaDataError('unavailable');
      }
      projectedStats = snapshotProviderStats(rawStats);
      if (!projectedStats) {
        throw stravaDataError('internal');
      }
    }

    return objectFreeze({
      connected: true,
      athlete: objectFreeze({
        id: conn.athleteId,
        firstName: conn.firstName,
        lastName: conn.lastName,
        username: conn.username,
        profileUrl: conn.profileUrl,
      }),
      recentActivities,
      yearToDate: projectedStats ? projectedStats.yearToDate : null,
      allTime: projectedStats ? projectedStats.allTime : null,
    });
  });

exports.stravaDisconnect = functions
  .runWith({ secrets: ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET'] })
  .https.onCall(async (data, context) => {
    requireAppCheck(context);
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }
    const { uid } = context.auth;
    const secretSnap = await secretDocRef(uid).get();
    if (secretSnap.exists) {
      const accessToken = snapshotStoredDisconnectAccessToken(secretSnap.data());
      if (accessToken) {
        try {
          await fetch(STRAVA_DEAUTH_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
          });
        } catch (_error) {
          console.warn('strava_disconnect_revoke_failed');
        }
      }
    }
    await Promise.all([
      secretDocRef(uid).delete().catch(() => {}),
      connectionDocRef(uid).delete().catch(() => {}),
    ]);
    return { ok: true };
  });
