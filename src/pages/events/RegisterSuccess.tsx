import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import SEO from '../../components/SEO';
import { lookupRegistration, LookupResult } from '../../services/events/eventsService';
import { track, events as analyticsEvents } from '../../services/analytics/analytics';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;

function RegisterSuccess() {
  const [params] = useSearchParams();
  const { services, isReady } = useServiceLocator();
  const eventId = params.get('event');
  const regId = params.get('reg');
  const token = params.get('token');

  const [reg, setReg] = useState<LookupResult | null>(null);
  const [state, setState] = useState<'waiting' | 'confirmed' | 'timeout' | 'error' | 'denied'>(
    'waiting',
  );
  const stopRef = useRef(false);

  useEffect(() => {
    if (!isReady || !services || !regId || !token || !eventId) {
      if (isReady && (!regId || !token || !eventId)) setState('error');
      return undefined;
    }
    stopRef.current = false;
    const started = Date.now();

    async function tick() {
      if (stopRef.current) return;
      try {
        const result = await lookupRegistration(
          services!.firebaseResources.app,
          { eventId: eventId!, registrationId: regId!, token: token! },
        );
        setReg(result);
        if (result.status === 'paid' || result.status === 'comp') {
          setState('confirmed');
          track(analyticsEvents.registrationConfirmed, {
            eventId, status: result.status, amount_cents: result.amountCents,
          });
          return;
        }
        if (Date.now() - started > POLL_TIMEOUT_MS) {
          setState('timeout');
          return;
        }
        setTimeout(tick, POLL_INTERVAL_MS);
      } catch (err: any) {
        const code = err?.code || err?.details?.code || '';
        if (code === 'permission-denied') {
          setState('denied');
        } else {
          setState('error');
        }
      }
    }

    tick();

    return () => {
      stopRef.current = true;
    };
  }, [isReady, services, eventId, regId, token]);

  return (
    <>
      <SEO title="Registration complete" noindex />
      <div className="container mx-auto p-6 max-w-xl text-center">
        {state === 'waiting' && (
          <>
            <h1 className="text-2xl font-bold mb-2">Processing your registration...</h1>
            <p className="text-gray-600">
              Hang tight — we&apos;re confirming your payment with Stripe.
            </p>
          </>
        )}
        {state === 'confirmed' && reg && (
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
        {state === 'timeout' && (
          <>
            <h1 className="text-2xl font-bold mb-2">Still processing...</h1>
            <p className="text-gray-700">
              Stripe sometimes takes a minute to finalize. You&apos;ll get an email once it&apos;s
              confirmed. If nothing arrives within an hour, contact us.
            </p>
          </>
        )}
        {state === 'denied' && (
          <>
            <h1 className="text-2xl font-bold mb-2">Can&apos;t confirm this registration</h1>
            <p className="text-gray-700">
              This confirmation link doesn&apos;t match our records. Contact us if you think
              this is a mistake.
            </p>
          </>
        )}
        {state === 'error' && (
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

export default RegisterSuccess;
