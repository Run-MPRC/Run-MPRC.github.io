const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { Timestamp } = require('firebase-admin/firestore');
const { requireAppCheck } = require('./stripeHelpers');

const STRAVA_TOKEN_URL = 'https://www.strava.com/api/v3/oauth/token';
const STRAVA_DEAUTH_URL = 'https://www.strava.com/oauth/deauthorize';
const STRAVA_ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities';
const STRAVA_STATS_URL = (id) => `https://www.strava.com/api/v3/athletes/${id}/stats`;

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
  const resp = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Strava token exchange failed: ${resp.status} ${text.slice(0, 200)}`,
    );
  }
  return resp.json();
}

async function refreshToken(refresh) {
  const { clientId, clientSecret } = getStravaCreds();
  const resp = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Strava token refresh failed: ${resp.status} ${text.slice(0, 200)}`,
    );
  }
  return resp.json();
}

async function getFreshAccessToken(uid) {
  const snap = await secretDocRef(uid).get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('failed-precondition', 'Strava not connected');
  }
  const tokens = snap.data();
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = tokens.expires_at || 0;
  if (expiresAt - nowSec > 60) {
    return tokens.access_token;
  }
  const refreshed = await refreshToken(tokens.refresh_token);
  await secretDocRef(uid).set({
    ...tokens,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token,
    expires_at: refreshed.expires_at,
    updatedAt: Timestamp.now(),
  }, { merge: true });
  return refreshed.access_token;
}

exports.stravaExchangeCode = functions
  .runWith({ secrets: ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET'] })
  .https.onCall(async (data, context) => {
    requireAppCheck(context);
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }
    const { code } = data || {};
    if (!code || typeof code !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'code required');
    }
    const { uid } = context.auth;

    const tokenResp = await exchangeCode(code);
    const athlete = tokenResp.athlete || {};

    await secretDocRef(uid).set({
      access_token: tokenResp.access_token,
      refresh_token: tokenResp.refresh_token,
      expires_at: tokenResp.expires_at,
      scope: tokenResp.scope || null,
      updatedAt: Timestamp.now(),
    }, { merge: true });

    await connectionDocRef(uid).set({
      provider: 'strava',
      athleteId: athlete.id || null,
      firstName: athlete.firstname || null,
      lastName: athlete.lastname || null,
      username: athlete.username || null,
      profileUrl: athlete.profile || null,
      connectedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }, { merge: true });

    return { ok: true, athleteId: athlete.id || null };
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

    const [activitiesResp, statsResp] = await Promise.all([
      fetch(`${STRAVA_ACTIVITIES_URL}?per_page=5`, { headers }),
      conn.athleteId ? fetch(STRAVA_STATS_URL(conn.athleteId), { headers }) : null,
    ]);

    if (!activitiesResp.ok) {
      throw new functions.https.HttpsError('internal', `Strava activities: ${activitiesResp.status}`);
    }
    const activities = await activitiesResp.json();
    const stats = statsResp && statsResp.ok ? await statsResp.json() : null;

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
      const { access_token: accessToken } = secretSnap.data();
      if (accessToken) {
        try {
          await fetch(STRAVA_DEAUTH_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
          });
        } catch (err) {
          console.warn('Strava deauth failed (continuing):', err.message);
        }
      }
    }
    await Promise.all([
      secretDocRef(uid).delete().catch(() => {}),
      connectionDocRef(uid).delete().catch(() => {}),
    ]);
    return { ok: true };
  });
