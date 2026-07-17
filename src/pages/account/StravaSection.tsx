import React, { useEffect, useRef, useState } from 'react';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import {
  buildStravaAuthorizeUrl,
  formatDuration,
  getStravaConnection,
  metersToMiles,
  stravaDisconnect,
  stravaFetchStats,
  StravaConnection,
  StravaStatsResult,
} from '../../services/strava/stravaService';

const STRAVA_CONNECTION_FAILURE = 'We could not check your Strava connection right now. Please refresh this page and try again.';
const STRAVA_ACTIVITY_FAILURE = 'We could not load your Strava activity right now. Please try again later.';
const STRAVA_DISCONNECT_FAILURE = 'We could not confirm the Strava disconnect. Please refresh this page before trying again.';
const objectIdentities = new WeakMap<object, number>();
let nextObjectIdentity = 1;

function getObjectIdentity(value: object): number {
  const existing = objectIdentities.get(value);
  if (existing !== undefined) return existing;
  const identity = nextObjectIdentity;
  nextObjectIdentity += 1;
  objectIdentities.set(value, identity);
  return identity;
}

function Connected({
  conn, stats, loading, error, onDisconnect, disconnecting,
}: {
  conn: StravaConnection;
  stats: StravaStatsResult | null;
  loading: boolean;
  error: string | null;
  onDisconnect: () => void;
  disconnecting: boolean;
}) {
  return (
    <div className="border rounded-lg p-4 bg-orange-50">
      <div className="flex justify-between items-start gap-3">
        <div>
          <div className="text-xs uppercase text-orange-800 font-semibold">Strava connected</div>
          <div className="font-semibold">
            {conn.firstName || ''}
            {' '}
            {conn.lastName || ''}
            {conn.username ? ` (@${conn.username})` : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={onDisconnect}
          disabled={disconnecting}
          className="text-xs text-red-700 hover:underline disabled:opacity-50"
        >
          {disconnecting ? 'Disconnecting...' : 'Disconnect'}
        </button>
      </div>

      {loading && <p className="text-sm text-gray-600 mt-3">Loading recent activity...</p>}
      {error && <p role="alert" aria-live="assertive" aria-atomic="true" className="text-sm text-red-600 mt-3">{error}</p>}

      {stats?.yearToDate && (
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div className="bg-white rounded p-3">
            <div className="text-xs text-gray-500">Runs this year</div>
            <div className="text-xl font-bold">{stats.yearToDate.runCount}</div>
            <div className="text-xs text-gray-500">
              {metersToMiles(stats.yearToDate.runMeters)}
              {' '}
              mi
            </div>
          </div>
          <div className="bg-white rounded p-3">
            <div className="text-xs text-gray-500">All-time runs</div>
            <div className="text-xl font-bold">{stats.allTime?.runCount || 0}</div>
            <div className="text-xs text-gray-500">
              {metersToMiles(stats.allTime?.runMeters || 0)}
              {' '}
              mi
            </div>
          </div>
        </div>
      )}

      {stats?.recentActivities && stats.recentActivities.length > 0 && (
        <div className="mt-4">
          <div className="text-xs uppercase text-gray-600 font-semibold mb-2">
            Recent activity
          </div>
          <ul className="text-sm">
            {stats.recentActivities.map((a) => (
              <li key={a.id} className="flex justify-between border-b py-1 last:border-b-0">
                <span className="truncate pr-2">
                  <strong>{a.name}</strong>
                  {' '}
                  <span className="text-gray-500 text-xs">
                    ·
                    {' '}
                    {a.type}
                  </span>
                </span>
                <span className="text-xs text-gray-600 whitespace-nowrap">
                  {metersToMiles(a.distanceMeters)}
                  {' mi · '}
                  {formatDuration(a.movingTimeSeconds)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Disconnected({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="border rounded-lg p-4 bg-gray-50">
      <div className="flex justify-between items-center">
        <div>
          <div className="font-semibold">Connect your Strava</div>
          <div className="text-sm text-gray-600">
            Show your recent runs and yearly mileage here.
          </div>
        </div>
        <button
          type="button"
          onClick={onConnect}
          className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded text-sm"
        >
          Connect Strava
        </button>
      </div>
    </div>
  );
}

type StravaFirestore = Parameters<typeof getStravaConnection>[0];
type StravaApp = Parameters<typeof stravaFetchStats>[0];

type ConnectionState =
  | { phase: 'loading' }
  | { phase: 'unavailable' }
  | { phase: 'disconnected' }
  | { phase: 'connected'; connection: StravaConnection };

type ActivityState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'unavailable' }
  | { phase: 'resolved'; stats: StravaStatsResult };

type DisconnectState = 'idle' | 'pending' | 'failed';

function StravaAttempt({
  uid,
  firestore,
  app,
}: {
  uid: string;
  firestore: StravaFirestore;
  app: StravaApp;
}) {
  const [connectionState, setConnectionState] = useState<ConnectionState>({ phase: 'loading' });
  const [activityState, setActivityState] = useState<ActivityState>({ phase: 'idle' });
  const [disconnectState, setDisconnectState] = useState<DisconnectState>('idle');
  const lifetimeRunRef = useRef<symbol | null>(null);
  const connectionRunRef = useRef<symbol | null>(null);
  const activityRunRef = useRef<symbol | null>(null);
  const disconnectRunRef = useRef<symbol | null>(null);

  useEffect(() => {
    const run = Symbol('strava-lifetime');
    lifetimeRunRef.current = run;
    return () => {
      if (lifetimeRunRef.current === run) lifetimeRunRef.current = null;
      connectionRunRef.current = null;
      activityRunRef.current = null;
      disconnectRunRef.current = null;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const run = Symbol('strava-connection');
    connectionRunRef.current = run;

    async function loadConnection() {
      try {
        const nextConnection = await getStravaConnection(firestore, uid);
        if (!active || connectionRunRef.current !== run) return;
        setConnectionState(nextConnection === null
          ? { phase: 'disconnected' }
          : { phase: 'connected', connection: nextConnection });
      } catch {
        if (!active || connectionRunRef.current !== run) return;
        setConnectionState({ phase: 'unavailable' });
      }
    }

    loadConnection().catch(() => {
      if (!active || connectionRunRef.current !== run) return;
      setConnectionState({ phase: 'unavailable' });
    });

    return () => {
      active = false;
      if (connectionRunRef.current === run) connectionRunRef.current = null;
    };
  }, [firestore, uid]);

  useEffect(() => {
    let active = true;
    const run = Symbol('strava-activity');
    activityRunRef.current = run;

    if (connectionState.phase !== 'connected') {
      setActivityState({ phase: 'idle' });
      return () => {
        active = false;
        if (activityRunRef.current === run) activityRunRef.current = null;
      };
    }

    setActivityState({ phase: 'loading' });
    async function loadActivity() {
      try {
        const nextStats = await stravaFetchStats(app);
        if (!active || activityRunRef.current !== run) return;
        setActivityState({ phase: 'resolved', stats: nextStats });
      } catch {
        if (!active || activityRunRef.current !== run) return;
        setActivityState({ phase: 'unavailable' });
      }
    }

    loadActivity().catch(() => {
      if (!active || activityRunRef.current !== run) return;
      setActivityState({ phase: 'unavailable' });
    });

    return () => {
      active = false;
      if (activityRunRef.current === run) activityRunRef.current = null;
    };
  }, [app, connectionState]);

  function handleConnect() {
    const clientId = process.env.REACT_APP_STRAVA_CLIENT_ID;
    if (!clientId) {
      // eslint-disable-next-line no-alert
      alert('Strava is not configured yet. Please contact a club admin.');
      return;
    }
    const redirectUri = `${window.location.origin}/account/strava/callback`;
    window.location.href = buildStravaAuthorizeUrl(clientId, redirectUri);
  }

  async function handleDisconnect() {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Disconnect your Strava account?')) return;
    const lifetimeRun = lifetimeRunRef.current;
    if (lifetimeRun === null) return;
    const disconnectRun = Symbol('strava-disconnect');
    disconnectRunRef.current = disconnectRun;
    setDisconnectState('pending');
    try {
      await stravaDisconnect(app);
      if (
        lifetimeRunRef.current !== lifetimeRun
        || disconnectRunRef.current !== disconnectRun
      ) return;
      activityRunRef.current = null;
      setConnectionState({ phase: 'disconnected' });
      setActivityState({ phase: 'idle' });
      setDisconnectState('idle');
    } catch {
      if (
        lifetimeRunRef.current !== lifetimeRun
        || disconnectRunRef.current !== disconnectRun
      ) return;
      setDisconnectState('failed');
    }
  }

  if (connectionState.phase === 'loading') return null;
  let connectedError: string | null = null;
  if (disconnectState === 'failed') {
    connectedError = STRAVA_DISCONNECT_FAILURE;
  } else if (activityState.phase === 'unavailable') {
    connectedError = STRAVA_ACTIVITY_FAILURE;
  }

  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold mb-3">Strava</h2>
      {connectionState.phase === 'connected' && (
        <Connected
          conn={connectionState.connection}
          stats={activityState.phase === 'resolved' ? activityState.stats : null}
          loading={activityState.phase === 'loading'}
          error={connectedError}
          onDisconnect={handleDisconnect}
          disconnecting={disconnectState === 'pending'}
        />
      )}
      {connectionState.phase === 'disconnected' && (
        <Disconnected onConnect={handleConnect} />
      )}
      {connectionState.phase === 'unavailable' && (
        <p role="alert" aria-live="assertive" aria-atomic="true" className="text-sm text-red-600">
          {STRAVA_CONNECTION_FAILURE}
        </p>
      )}
    </section>
  );
}

function StravaSection({ uid }: { uid: string }) {
  const { services, isReady } = useServiceLocator();
  if (!isReady || !services) return null;

  const { firebaseResources } = services;
  const { firestore, app } = firebaseResources;
  const attemptKey = JSON.stringify([
    uid,
    getObjectIdentity(services),
    getObjectIdentity(firebaseResources),
    getObjectIdentity(firestore),
    getObjectIdentity(app),
  ]);

  return (
    <StravaAttempt
      key={attemptKey}
      uid={uid}
      firestore={firestore}
      app={app}
    />
  );
}

export default StravaSection;
