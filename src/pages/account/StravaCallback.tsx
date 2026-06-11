import React, { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import { useAuth } from '../../services/hooks/useAuth';
import SEO from '../../components/SEO';
import { stravaExchangeCode, verifyStravaState } from '../../services/strava/stravaService';

function StravaCallback() {
  const [params] = useSearchParams();
  const { services, isReady } = useServiceLocator();
  const { isAuthenticated, isLoading } = useAuth();
  const code = params.get('code');
  const state = params.get('state');
  const err = params.get('error');

  const [status, setStatus] = useState<'exchanging' | 'done' | 'error'>('exchanging');
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    if (isLoading || !isReady) return;
    if (!isAuthenticated) {
      setStatus('error');
      setMessage('You need to be signed in to connect Strava.');
      return;
    }
    if (err) {
      setStatus('error');
      setMessage(`Strava returned an error: ${err}`);
      return;
    }
    if (!code) {
      setStatus('error');
      setMessage('Missing authorization code from Strava.');
      return;
    }
    if (!verifyStravaState(state)) {
      setStatus('error');
      setMessage('Security check failed (state mismatch). Please try connecting again.');
      return;
    }
    if (!services) return;

    stravaExchangeCode(services.firebaseResources.app, code)
      .then(() => setStatus('done'))
      .catch((e) => {
        setStatus('error');
        setMessage(e?.message || 'Failed to exchange code with Strava.');
      });
  }, [services, isReady, isAuthenticated, isLoading, code, state, err]);

  if (status === 'done') {
    return <Navigate to="/account" replace />;
  }

  return (
    <>
      <SEO title="Connecting Strava..." noindex />
      <div className="container mx-auto p-6 max-w-lg text-center">
        {status === 'exchanging' && (
          <>
            <h1 className="text-2xl font-bold mb-2">Connecting your Strava...</h1>
            <p className="text-gray-600">Hold on — we&apos;re finishing up.</p>
          </>
        )}
        {status === 'error' && (
          <>
            <h1 className="text-2xl font-bold mb-2 text-red-600">Connection failed</h1>
            <p className="text-gray-700">{message}</p>
            <a href="/account" className="inline-block mt-4 text-blue-600 hover:underline">
              Back to account
            </a>
          </>
        )}
      </div>
    </>
  );
}

export default StravaCallback;
