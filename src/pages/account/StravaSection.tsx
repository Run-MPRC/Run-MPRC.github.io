import React, { useEffect, useState } from 'react';
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

function StravaSection({ uid }: { uid: string }) {
  const { services } = useServiceLocator();
  const [conn, setConn] = useState<StravaConnection | null>(null);
  const [stats, setStats] = useState<StravaStatsResult | null>(null);
  const [loadingConn, setLoadingConn] = useState(true);
  const [loadingStats, setLoadingStats] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    if (!services) return;
    getStravaConnection(services.firebaseResources.firestore, uid)
      .then((c) => { setConn(c); setLoadingConn(false); })
      .catch(() => setLoadingConn(false));
  }, [services, uid]);

  useEffect(() => {
    if (!services || !conn) return;
    setLoadingStats(true);
    stravaFetchStats(services.firebaseResources.app)
      .then((s) => { setStats(s); setLoadingStats(false); })
      .catch(() => { setError('We could not load your Strava activity right now. Please try again later.'); setLoadingStats(false); });
  }, [services, conn]);

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
    if (!services) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm('Disconnect your Strava account?')) return;
    setDisconnecting(true);
    try {
      await stravaDisconnect(services.firebaseResources.app);
      setConn(null);
      setStats(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  }

  if (loadingConn) return null;

  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold mb-3">Strava</h2>
      {conn ? (
        <Connected
          conn={conn}
          stats={stats}
          loading={loadingStats}
          error={error}
          onDisconnect={handleDisconnect}
          disconnecting={disconnecting}
        />
      ) : (
        <Disconnected onConnect={handleConnect} />
      )}
    </section>
  );
}

export default StravaSection;
