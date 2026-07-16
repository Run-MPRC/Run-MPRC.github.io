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
const numberIsSafeInteger = Number.isSafeInteger;
const reflectApply = Reflect.apply;
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

function isBoundedVisibleAscii(value, maxLength) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && patternMatches(VISIBLE_ASCII_PATTERN, value);
}

function isPositiveSafeInteger(value) {
  return typeof value === 'number' && numberIsSafeInteger(value) && value > 0;
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

function connectionDocRef(uid) {
  return admin.firestore()
    .collection('members').doc(uid)
    .collection('connections').doc('strava');
}

function secretDocRef(uid) {
  return admin.firestore()
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

    await secretDocRef(uid).set({
      access_token: exchange.accessToken,
      refresh_token: exchange.refreshToken,
      expires_at: exchange.expiresAt,
      scope: exchange.scope,
      updatedAt: Timestamp.now(),
    }, { merge: true });

    await connectionDocRef(uid).set({
      provider: 'strava',
      athleteId: exchange.athlete.id,
      firstName: exchange.athlete.firstName,
      lastName: exchange.athlete.lastName,
      username: exchange.athlete.username,
      profileUrl: exchange.athlete.profileUrl,
      connectedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }, { merge: true });

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
    const conn = connSnap.data();
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
    let activities;
    try {
      activities = await activitiesResp.json();
    } catch (_error) {
      throw stravaDataError('unavailable');
    }
    let stats = null;
    if (statsResp && statsResp.ok) {
      try {
        stats = await statsResp.json();
      } catch (_error) {
        throw stravaDataError('unavailable');
      }
    }

    return {
      connected: true,
      athlete: {
        id: conn.athleteId,
        firstName: conn.firstName,
        lastName: conn.lastName,
        username: conn.username,
        profileUrl: conn.profileUrl,
      },
      recentActivities: (activities || []).slice(0, 5).map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type || a.sport_type,
        distanceMeters: a.distance,
        movingTimeSeconds: a.moving_time,
        startDate: a.start_date_local || a.start_date,
      })),
      yearToDate: stats ? {
        runMeters: stats.ytd_run_totals?.distance || 0,
        runCount: stats.ytd_run_totals?.count || 0,
        rideMeters: stats.ytd_ride_totals?.distance || 0,
        rideCount: stats.ytd_ride_totals?.count || 0,
      } : null,
      allTime: stats ? {
        runMeters: stats.all_run_totals?.distance || 0,
        runCount: stats.all_run_totals?.count || 0,
      } : null,
    };
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
