import React, {
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import SEO from '../../components/SEO';
import { lookupRegistration, LookupResult } from '../../services/events/eventsService';
import { track, events as analyticsEvents } from '../../services/analytics/analytics';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;
const objectIdentities = new WeakMap<object, number>();
let nextObjectIdentity = 1;

function getObjectIdentity(value: object | null): number {
  if (value === null) return 0;
  const existing = objectIdentities.get(value);
  if (existing !== undefined) return existing;
  const identity = nextObjectIdentity;
  nextObjectIdentity += 1;
  objectIdentities.set(value, identity);
  return identity;
}

function getOwnDataValue(value: unknown, key: string): unknown {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function getLookupErrorCode(error: unknown): string {
  const directCode = getOwnDataValue(error, 'code');
  if (directCode) return typeof directCode === 'string' ? directCode : '';
  const details = getOwnDataValue(error, 'details');
  const nestedCode = getOwnDataValue(details, 'code');
  return typeof nestedCode === 'string' ? nestedCode : '';
}

type LookupApp = Parameters<typeof lookupRegistration>[0];
type ViewPhase = 'waiting' | 'confirmed' | 'timeout' | 'error' | 'denied';

type RegisterSuccessAttemptProps = {
  app: LookupApp | null;
  isReady: boolean;
  eventId: string | null;
  regId: string | null;
  token: string | null;
};

type CommittedRoute = {
  eventId: string | null;
  regId: string | null;
  token: string | null;
  epoch: number;
};

function isSameRoute(
  committed: CommittedRoute,
  eventId: string | null,
  regId: string | null,
  token: string | null,
): boolean {
  return committed.eventId === eventId
    && committed.regId === regId
    && committed.token === token;
}

function RegisterSuccessAttempt({
  app,
  isReady,
  eventId,
  regId,
  token,
}: RegisterSuccessAttemptProps) {
  const hasRequiredParams = Boolean(eventId && regId && token);
  const [view, setView] = useState<{
    phase: ViewPhase;
    registration: LookupResult | null;
  }>(() => ({
    phase: isReady && !hasRequiredParams ? 'error' : 'waiting',
    registration: null,
  }));
  const { phase, registration: reg } = view;

  useLayoutEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const activeApp = app;

    function settle(
      nextPhase: ViewPhase,
      registration: LookupResult | null = null,
    ) {
      if (!active) return;
      setView({ phase: nextPhase, registration });
    }

    function stop() {
      active = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    }

    if (!isReady || !activeApp || !hasRequiredParams) {
      settle(isReady && !hasRequiredParams ? 'error' : 'waiting');
      return stop;
    }

    settle('waiting');
    const lookupApp = activeApp;
    const started = Date.now();

    async function tick() {
      if (!active) return;
      timer = null;
      try {
        const result = await lookupRegistration(
          lookupApp,
          { eventId: eventId!, registrationId: regId!, token: token! },
        );
        if (!active) return;
        if (result.status === 'paid' || result.status === 'comp') {
          settle('confirmed', result);
          track(analyticsEvents.registrationConfirmed, {
            eventId, status: result.status, amount_cents: result.amountCents,
          });
          return;
        }
        if (Date.now() - started > POLL_TIMEOUT_MS) {
          settle('timeout');
          return;
        }
        settle('waiting');
        if (!active) return;
        timer = setTimeout(() => {
          tick().catch(() => {
            settle('error');
          });
        }, POLL_INTERVAL_MS);
      } catch (err: unknown) {
        if (!active) return;
        const code = getLookupErrorCode(err);
        if (code === 'permission-denied') {
          settle('denied');
        } else {
          settle('error');
        }
      }
    }

    tick().catch(() => {
      settle('error');
    });
    return stop;
  }, [app, eventId, hasRequiredParams, isReady, regId, token]);

  return (
    <>
      <SEO title="Registration complete" noindex />
      <div className="container mx-auto p-6 max-w-xl text-center">
        {phase === 'waiting' && (
          <>
            <h1 className="text-2xl font-bold mb-2">Processing your registration...</h1>
            <p className="text-gray-600">
              Hang tight — we&apos;re confirming your payment with Stripe.
            </p>
          </>
        )}
        {phase === 'confirmed' && reg && (
          <>
            <h1 className="text-3xl font-bold mb-2">You&apos;re in!</h1>
            <p className="text-gray-800">
              Thanks,
              {' '}
              {reg.runner.firstName}
              . A confirmation email is on its way to
              {' '}
              <strong>{reg.runner.email}</strong>
              .
            </p>
            <p className="text-sm text-gray-500 mt-4">
              Registration ID:
              {' '}
              <code>{reg.id}</code>
            </p>
          </>
        )}
        {phase === 'timeout' && (
          <>
            <h1 className="text-2xl font-bold mb-2">Still processing...</h1>
            <p className="text-gray-700">
              Stripe sometimes takes a minute to finalize. You&apos;ll get an email once it&apos;s
              confirmed. If nothing arrives within an hour, contact us.
            </p>
          </>
        )}
        {phase === 'denied' && (
          <>
            <h1 className="text-2xl font-bold mb-2">Can&apos;t confirm this registration</h1>
            <p className="text-gray-700">
              This confirmation link doesn&apos;t match our records. Contact us if you think
              this is a mistake.
            </p>
          </>
        )}
        {phase === 'error' && (
          <>
            <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
            <p className="text-gray-700">
              We couldn&apos;t load your registration. Please contact us with your email and
              event name.
            </p>
          </>
        )}
        <Link to="/events" className="inline-block mt-6 text-blue-600 hover:underline">
          ← Back to events
        </Link>
      </div>
    </>
  );
}

function RegisterSuccess() {
  const [params] = useSearchParams();
  const location = useLocation();
  const { services, isReady } = useServiceLocator();
  const eventId = params.get('event');
  const regId = params.get('reg');
  const token = params.get('token');
  const app = services?.firebaseResources.app ?? null;
  const committedRouteRef = useRef<CommittedRoute | null>(null);
  const [, setRouteCommitVersion] = useState(0);

  if (committedRouteRef.current === null) {
    committedRouteRef.current = {
      eventId,
      regId,
      token,
      epoch: 1,
    };
  }

  const committedRoute = committedRouteRef.current;
  const routeIsCommitted = isSameRoute(committedRoute, eventId, regId, token);

  useLayoutEffect(() => {
    const { current } = committedRouteRef;
    if (current && isSameRoute(current, eventId, regId, token)) return;
    committedRouteRef.current = {
      eventId,
      regId,
      token,
      epoch: (current?.epoch ?? 0) + 1,
    };
    setRouteCommitVersion((version) => version + 1);
  }, [eventId, regId, token]);

  if (!routeIsCommitted) {
    const hasRequiredParams = Boolean(eventId && regId && token);
    return (
      <>
        <SEO title="Registration complete" noindex />
        <div className="container mx-auto p-6 max-w-xl text-center">
          {isReady && !hasRequiredParams ? (
            <>
              <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
              <p className="text-gray-700">
                We couldn&apos;t load your registration. Please contact us with your email and
                event name.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold mb-2">Processing your registration...</h1>
              <p className="text-gray-600">
                Hang tight — we&apos;re confirming your payment with Stripe.
              </p>
            </>
          )}
          <Link to="/events" className="inline-block mt-6 text-blue-600 hover:underline">
            ← Back to events
          </Link>
        </div>
      </>
    );
  }

  const attemptKey = JSON.stringify([
    location.key,
    committedRoute.epoch,
    getObjectIdentity(services),
    getObjectIdentity(app),
    isReady ? 1 : 0,
  ]);

  return (
    <RegisterSuccessAttempt
      key={attemptKey}
      app={app}
      isReady={isReady}
      eventId={eventId}
      regId={regId}
      token={token}
    />
  );
}

export default RegisterSuccess;
