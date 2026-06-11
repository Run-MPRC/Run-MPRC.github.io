import { FirebaseApp } from 'firebase/app';
import {
  doc, getDoc, onSnapshot, Firestore, Timestamp,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

const STRAVA_AUTHORIZE = 'https://www.strava.com/oauth/authorize';
const STATE_STORAGE_KEY = 'mprc_strava_oauth_state';

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

function randomState() {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildStravaAuthorizeUrl(clientId: string, redirectUri: string): string {
  const state = randomState();
  sessionStorage.setItem(STATE_STORAGE_KEY, state);
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

export function verifyStravaState(received: string | null): boolean {
  const expected = sessionStorage.getItem(STATE_STORAGE_KEY);
  sessionStorage.removeItem(STATE_STORAGE_KEY);
  return !!expected && expected === received;
}

export async function stravaExchangeCode(
  app: FirebaseApp,
  code: string,
): Promise<{ ok: boolean; athleteId: number | null }> {
  const functions = getFunctions(app);
  const callable = httpsCallable<{ code: string }, any>(functions, 'stravaExchangeCode');
  const result = await callable({ code });
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
