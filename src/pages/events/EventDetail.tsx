import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import SEO from '../../components/SEO';
import {
  getEventBySlug,
  formatPrice,
  formatEventDate,
} from '../../services/events/eventsService';
import { Event } from '../../types/events';
import { useAuth } from '../../services/hooks/useAuth';
import { track, events as analyticsEvents } from '../../services/analytics/analytics';

function PriceRow({ label, cents }: { label: string; cents?: number }) {
  if (typeof cents !== 'number' || cents < 0) return null;
  return (
    <div className="flex justify-between py-1">
      <span>{label}</span>
      <span className="font-semibold">{formatPrice(cents)}</span>
    </div>
  );
}

function EventDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { services, isReady } = useServiceLocator();
  const { isMember, isAuthenticated } = useAuth();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const cancelled = searchParams.get('cancelled') === '1';

  useEffect(() => {
    if (!isReady || !services || !slug) return;
    setLoading(true);
    getEventBySlug(services.firebaseResources.firestore, slug)
      .then((e) => {
        setEvent(e);
        setLoading(false);
        if (!e) setError('Event not found');
        else track(analyticsEvents.eventView, { slug: e.slug, title: e.title });
      })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, [services, isReady, slug]);

  if (loading) return <div className="container mx-auto p-6">Loading...</div>;
  if (error || !event) {
    return (
      <div className="container mx-auto p-6">
        <p className="text-red-500">{error || 'Event not found.'}</p>
        <Link to="/events" className="text-blue-600 hover:underline">
          ← Back to events
        </Link>
      </div>
    );
  }

  const isMembersOnly = event.visibility === 'members_only' || event.member_only === true;
  const isFull = event.capacity != null && event.registeredCount >= event.capacity;
  const canRegister = event.status === 'open'
    && !isFull
    && (!isMembersOnly || isMember);

  const structuredData = (() => {
    const startIso = event.startAt?.toDate?.()?.toISOString();
    const endIso = event.endAt?.toDate?.()?.toISOString();
    const lowestCents = Math.min(
      ...[
        event.pricing?.memberCents,
        event.pricing?.nonMemberCents,
        event.pricing?.earlyBirdCents,
      ].filter((v): v is number => typeof v === 'number' && v > 0),
    );
    const availability = event.status === 'cancelled'
      ? 'https://schema.org/EventCancelled'
      : isFull || event.status === 'closed'
        ? 'https://schema.org/SoldOut'
        : 'https://schema.org/InStock';
    return {
      '@context': 'https://schema.org',
      '@type': 'SportsEvent',
      name: event.title,
      description: event.description?.slice(0, 500),
      startDate: startIso,
      ...(endIso ? { endDate: endIso } : {}),
      eventStatus: event.status === 'cancelled'
        ? 'https://schema.org/EventCancelled'
        : 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: {
        '@type': 'Place',
        name: event.location || 'Mid-Peninsula Running Club',
        address: {
          '@type': 'PostalAddress',
          addressLocality: 'San Mateo',
          addressRegion: 'CA',
          addressCountry: 'US',
        },
      },
      organizer: {
        '@type': 'SportsOrganization',
        name: 'Mid-Peninsula Running Club',
        url: 'https://runmprc.com',
      },
      url: `https://runmprc.com/events/${event.slug}`,
      ...(Number.isFinite(lowestCents) ? {
        offers: {
          '@type': 'Offer',
          price: (lowestCents / 100).toFixed(2),
          priceCurrency: 'USD',
          availability,
          url: `https://runmprc.com/events/${event.slug}/register`,
        },
      } : {}),
    };
  })();

  return (
    <>
      <SEO
        title={event.title}
        description={event.description.slice(0, 160)}
        url={`https://runmprc.com/events/${event.slug}`}
        canonicalUrl={`https://runmprc.com/events/${event.slug}`}
        structuredData={structuredData}
      />
      <div className="container mx-auto p-4 max-w-3xl">
        <Link to="/events" className="text-sm text-blue-600 hover:underline">
          ← All events
        </Link>
        <h1 className="text-3xl font-bold mt-2">{event.title}</h1>
        <p className="text-gray-600 mt-1">
          {formatEventDate(event.startAt)}
          {event.location ? ` · ${event.location}` : ''}
        </p>
        {event.locationDetails && (
          <p className="text-sm text-gray-500 mt-1">{event.locationDetails}</p>
        )}

        {cancelled && (
          <div className="mt-4 p-3 bg-amber-100 border border-amber-300 rounded">
            Your checkout was cancelled. You can try again below.
          </div>
        )}

        {event.resultsUrl && (
          <section className="mt-6 border rounded-lg p-4 bg-yellow-50 border-yellow-200">
            <div className="flex justify-between items-start gap-3">
              <div>
                <h2 className="text-xl font-semibold">Race Results</h2>
                {event.resultsText && (
                  <p className="mt-2 whitespace-pre-wrap text-gray-800 text-sm">
                    {event.resultsText}
                  </p>
                )}
              </div>
              <a
                href={event.resultsUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded text-sm whitespace-nowrap"
              >
                View results →
              </a>
            </div>
          </section>
        )}

        <section className="mt-6">
          <h2 className="text-xl font-semibold mb-2">About</h2>
          <p className="whitespace-pre-wrap text-gray-800">{event.description}</p>
        </section>

        <section className="mt-6 border rounded-lg p-4 bg-gray-50">
          <h2 className="text-xl font-semibold mb-2">Pricing</h2>
          <PriceRow label="Member" cents={event.pricing?.memberCents} />
          <PriceRow label="Non-member" cents={event.pricing?.nonMemberCents} />
          <PriceRow label="Early bird" cents={event.pricing?.earlyBirdCents} />
          {!isAuthenticated && (
            <p className="text-xs text-gray-600 mt-2">
              Members:
              {' '}
              <Link to="/login" className="text-blue-600 hover:underline">
                sign in
              </Link>
              {' '}
              to get the member price.
            </p>
          )}
        </section>

        {event.capacity != null && (
          <p className="text-sm text-gray-600 mt-4">
            {event.registeredCount}
            {' / '}
            {event.capacity}
            {' '}
            registered
          </p>
        )}

        <div className="mt-6">
          {canRegister ? (
            <Link
              to={`/events/${event.slug}/register`}
              onClick={() => track(analyticsEvents.eventRegisterClick, { slug: event.slug })}
              className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded"
            >
              Register
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="inline-block bg-gray-300 text-gray-600 font-semibold py-3 px-6 rounded cursor-not-allowed"
            >
              {isFull
                ? 'Sold out'
                : event.status === 'closed'
                  ? 'Registration closed'
                  : event.status === 'cancelled'
                    ? 'Event cancelled'
                    : isMembersOnly && !isMember
                      ? 'Members only — sign in to register'
                      : 'Registration unavailable'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export default EventDetail;
