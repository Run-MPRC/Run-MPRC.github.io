import { FirebaseApp } from 'firebase/app';
import {
  doc, getDoc, onSnapshot, Firestore, Timestamp,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

const STRAVA_AUTHORIZE = 'https://www.strava.com/oauth/authorize';
const STRAVA_STATE_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const STRAVA_AUTHORIZATION_LIFETIME_SECONDS = 600;

export type StravaAuthorizationChallenge = Readonly<{
  state: string;
  expiresInSeconds: 600;
}>;

export interface StravaConnection {
  provider: 'strava';
  athleteId: number | null;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  profileUrl: string | null;
  connectedAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface StravaStatsResult {
  connected: true;
  athlete: {
    id: number | null;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    profileUrl: string | null;
  };
  recentActivities: Array<{
    id: number;
    name: string;
    type: string;
    distanceMeters: number;
    movingTimeSeconds: number;
    startDate: string;
  }>;
  yearToDate: {
    runMeters: number;
    runCount: number;
    rideMeters: number;
    rideCount: number;
  } | null;
  allTime: {
    runMeters: number;
    runCount: number;
  } | null;
}

function readStravaAuthorizationChallenge(value: unknown): StravaAuthorizationChallenge {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('invalid');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype) {
      throw new Error('invalid');
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== 2
      || !keys.includes('state')
      || !keys.includes('expiresInSeconds')
    ) {
      throw new Error('invalid');
    }
    const stateDescriptor = Object.getOwnPropertyDescriptor(value, 'state');
    const expiryDescriptor = Object.getOwnPropertyDescriptor(value, 'expiresInSeconds');
    if (
      stateDescriptor === undefined
      || expiryDescriptor === undefined
      || !Object.prototype.hasOwnProperty.call(stateDescriptor, 'value')
      || !Object.prototype.hasOwnProperty.call(expiryDescriptor, 'value')
      || typeof stateDescriptor.value !== 'string'
      || !STRAVA_STATE_PATTERN.test(stateDescriptor.value)
      || expiryDescriptor.value !== STRAVA_AUTHORIZATION_LIFETIME_SECONDS
    ) {
      throw new Error('invalid');
    }
    return Object.freeze({
      state: stateDescriptor.value,
      expiresInSeconds: STRAVA_AUTHORIZATION_LIFETIME_SECONDS,
    });
  } catch {
    throw new Error('Invalid Strava authorization response.');
  }
}

export function buildStravaAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  challenge: unknown,
): string {
  const { state } = readStravaAuthorizationChallenge(challenge);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read',
    state,
  });
  return `${STRAVA_AUTHORIZE}?${params.toString()}`;
}

export async function stravaBeginAuthorization(
  app: FirebaseApp,
): Promise<StravaAuthorizationChallenge> {
  const functions = getFunctions(app);
  const callable = httpsCallable<Record<string, never>, unknown>(
    functions,
    'stravaBeginAuthorization',
  );
  const result = await callable({});
  return readStravaAuthorizationChallenge(result.data);
}

export async function stravaExchangeCode(
  app: FirebaseApp,
  code: string,
  state: string,
): Promise<{ ok: boolean; athleteId: number | null }> {
  const functions = getFunctions(app);
  const callable = httpsCallable<{ code: string; state: string }, any>(
    functions,
    'stravaExchangeCode',
  );
  const result = await callable({ code, state });
  return result.data;
}

export async function stravaFetchStats(app: FirebaseApp): Promise<StravaStatsResult> {
  const functions = getFunctions(app);
  const callable = httpsCallable<void, StravaStatsResult>(functions, 'stravaFetchStats');
  const result = await callable();
  return result.data;
}

export async function stravaDisconnect(app: FirebaseApp): Promise<{ ok: boolean }> {
  const functions = getFunctions(app);
  const callable = httpsCallable<void, { ok: boolean }>(functions, 'stravaDisconnect');
  const result = await callable();
  return result.data;
}

export async function getStravaConnection(
  db: Firestore,
  uid: string,
): Promise<StravaConnection | null> {
  const ref = doc(db, 'members', uid, 'connections', 'strava');
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() as StravaConnection;
}

export function subscribeStravaConnection(
  db: Firestore,
  uid: string,
  onChange: (conn: StravaConnection | null) => void,
): () => void {
  const ref = doc(db, 'members', uid, 'connections', 'strava');
  return onSnapshot(ref, (snap) => {
    onChange(snap.exists() ? (snap.data() as StravaConnection) : null);
  });
}

export function metersToMiles(m: number): string {
  return (m / 1609.344).toFixed(1);
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
