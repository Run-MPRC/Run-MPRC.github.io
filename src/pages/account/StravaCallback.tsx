import React, { useEffect, useRef, useState } from 'react';
import {
  Navigate, useLocation, useNavigate,
} from 'react-router-dom';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import { useAuth } from '../../services/hooks/useAuth';
import SEO from '../../components/SEO';
import { stravaExchangeCode } from '../../services/strava/stravaService';

const STRAVA_CALLBACK_FAILURE = 'We could not connect Strava. Please return to My Account and try again.';

type CallbackStatus = 'exchanging' | 'done' | 'error';

type CallbackSnapshot = Readonly<{
  code: string | null;
  state: string | null;
  error: string | null;
}>;

type AttemptContext = Readonly<{
  uid: string;
  services: object;
  firebaseResources: object;
  app: object;
}>;

function readCallbackSnapshot(search: string): CallbackSnapshot {
  try {
    const params = new URLSearchParams(search);
    return Object.freeze({
      code: params.get('code'),
      state: params.get('state'),
      error: params.get('error'),
    });
  } catch {
    return Object.freeze({ code: null, state: null, error: null });
  }
}

function nativeAddressIsClean(expectedPathname: string): boolean {
  return window.location.pathname === expectedPathname
    && window.location.search === ''
    && window.location.hash === '';
}

function CallbackScreen({
  status,
  message,
}: {
  status: CallbackStatus;
  message: string;
}) {
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
            <p
              className="text-gray-700"
              role="alert"
              aria-live="assertive"
              aria-atomic="true"
            >
              {message}
            </p>
            <a href="/account" className="inline-block mt-4 text-blue-600 hover:underline">
              Back to account
            </a>
          </>
        )}
      </div>
    </>
  );
}

function CallbackAttempt({ snapshot }: { snapshot: CallbackSnapshot }) {
  const { services, isReady } = useServiceLocator();
  const {
    user, isAuthenticated, isLoading,
  } = useAuth();
  const [status, setStatus] = useState<CallbackStatus>('exchanging');
  const [message, setMessage] = useState('');
  const mountedRef = useRef(false);
  const decisionStartedRef = useRef(false);
  const runRef = useRef<symbol | null>(null);
  const attemptContextRef = useRef<AttemptContext | null>(null);
  const attemptInvalidatedRef = useRef(false);

  const firebaseResources = services?.firebaseResources ?? null;
  const app = firebaseResources?.app ?? null;
  const uid = user?.uid ?? null;
  const attemptContext = attemptContextRef.current;
  const contextChanged = attemptContext !== null && (
    !isReady
    || isLoading
    || !isAuthenticated
    || uid !== attemptContext.uid
    || services !== attemptContext.services
    || firebaseResources !== attemptContext.firebaseResources
    || app !== attemptContext.app
  );
  if (contextChanged) {
    attemptInvalidatedRef.current = true;
    runRef.current = null;
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (
      attemptInvalidatedRef.current
      || decisionStartedRef.current
      || isLoading
      || !isReady
    ) return;
    if (!isAuthenticated || uid === null) {
      decisionStartedRef.current = true;
      setStatus('error');
      setMessage('You need to be signed in to connect Strava.');
      return;
    }
    if (snapshot.error) {
      decisionStartedRef.current = true;
      setStatus('error');
      setMessage(STRAVA_CALLBACK_FAILURE);
      return;
    }
    if (!snapshot.code) {
      decisionStartedRef.current = true;
      setStatus('error');
      setMessage('Missing authorization code from Strava.');
      return;
    }
    if (!snapshot.state) {
      decisionStartedRef.current = true;
      setStatus('error');
      setMessage(STRAVA_CALLBACK_FAILURE);
      return;
    }
    if (services === null || firebaseResources === null || app === null) return;

    decisionStartedRef.current = true;

    const run = Symbol('strava-callback-exchange');
    runRef.current = run;
    attemptContextRef.current = {
      uid,
      services,
      firebaseResources,
      app,
    };

    let exchange: ReturnType<typeof stravaExchangeCode>;
    try {
      exchange = stravaExchangeCode(app, snapshot.code, snapshot.state);
    } catch {
      runRef.current = null;
      setStatus('error');
      setMessage(STRAVA_CALLBACK_FAILURE);
      return;
    }

    Promise.resolve(exchange).then(
      () => {
        if (
          !mountedRef.current
          || attemptInvalidatedRef.current
          || runRef.current !== run
        ) return;
        runRef.current = null;
        setStatus('done');
      },
      () => {
        if (
          !mountedRef.current
          || attemptInvalidatedRef.current
          || runRef.current !== run
        ) return;
        runRef.current = null;
        setStatus('error');
        setMessage(STRAVA_CALLBACK_FAILURE);
      },
    );
  }, [
    app,
    firebaseResources,
    isAuthenticated,
    isLoading,
    isReady,
    services,
    snapshot,
    uid,
  ]);

  if (attemptInvalidatedRef.current) {
    return <CallbackScreen status="error" message={STRAVA_CALLBACK_FAILURE} />;
  }
  return <CallbackScreen status={status} message={message} />;
}

function StravaCallback() {
  const location = useLocation();
  const navigate = useNavigate();
  const snapshotRef = useRef<CallbackSnapshot | null>(null);
  const snapshotCapturedRef = useRef(false);
  if (!snapshotCapturedRef.current) {
    snapshotRef.current = readCallbackSnapshot(location.search);
    snapshotCapturedRef.current = true;
  }

  const routerLocationIsClean = location.search === ''
    && location.hash === ''
    && location.state === null;
  const currentLocationIsClean = routerLocationIsClean
    && nativeAddressIsClean(location.pathname);
  const initiallyCleanRef = useRef(currentLocationIsClean);
  const cleanupCompleteRef = useRef(initiallyCleanRef.current);
  const cleanupFailedRef = useRef(false);
  const cleanupRequestedRef = useRef(false);
  const [cleanupState, setCleanupState] = useState<'pending' | 'clean' | 'failed'>(
    initiallyCleanRef.current ? 'clean' : 'pending',
  );

  useEffect(() => {
    if (cleanupFailedRef.current) return undefined;

    if (currentLocationIsClean) {
      cleanupCompleteRef.current = true;
      setCleanupState('clean');
      return undefined;
    }

    if (
      cleanupRequestedRef.current
      && routerLocationIsClean
      && !nativeAddressIsClean(location.pathname)
    ) {
      cleanupFailedRef.current = true;
      snapshotRef.current = null;
      setCleanupState('failed');
      return undefined;
    }

    const cleanLocation = {
      pathname: location.pathname,
      search: '',
      hash: '',
    };

    if (cleanupCompleteRef.current) {
      cleanupFailedRef.current = true;
      snapshotRef.current = null;
      setCleanupState('failed');
      try {
        navigate(cleanLocation, { replace: true, state: null });
      } catch {
        // The fixed failure below is the only public result.
      }
      return undefined;
    }

    if (!cleanupRequestedRef.current) {
      cleanupRequestedRef.current = true;
      try {
        navigate(cleanLocation, { replace: true, state: null });
      } catch {
        cleanupFailedRef.current = true;
        snapshotRef.current = null;
        setCleanupState('failed');
        return undefined;
      }

      if (!nativeAddressIsClean(cleanLocation.pathname)) {
        cleanupFailedRef.current = true;
        snapshotRef.current = null;
        setCleanupState('failed');
        return undefined;
      }
    }

    return undefined;
  }, [
    currentLocationIsClean,
    location.hash,
    location.pathname,
    location.search,
    location.state,
    navigate,
    routerLocationIsClean,
  ]);

  if (cleanupState === 'failed') {
    return <CallbackScreen status="error" message={STRAVA_CALLBACK_FAILURE} />;
  }
  if (cleanupState !== 'clean' || !currentLocationIsClean || snapshotRef.current === null) {
    return <CallbackScreen status="exchanging" message="" />;
  }
  return <CallbackAttempt snapshot={snapshotRef.current} />;
}

export default StravaCallback;
