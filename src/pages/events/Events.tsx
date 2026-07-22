import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import SEO from '../../components/SEO';
import Header from '../../components/Header';
import HeaderImage from '../../images/activities/header_bg_1.jpg';
import {
  listPublicEvents,
  listMemberEvents,
  formatPrice,
  formatEventDate,
} from '../../services/events/eventsService';
import { Event } from '../../types/events';
import { useAuth } from '../../services/hooks/useAuth';

const SEO_CONFIG = {
  title: 'Running Club Events Calendar',
  description: 'Stay updated with Mid-Peninsula Running Club events, races, social gatherings, and special activities for Bay Area runners. Check our calendar for upcoming running events.',
  keywords: 'MPRC events, running club calendar, Bay Area running events, San Mateo running club events, running club activities, MPRC calendar',
  url: 'https://runmprc.com/events',
};

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: 'MPRC Events Calendar',
  description: SEO_CONFIG.description,
  url: SEO_CONFIG.url,
};

function PriceBadge({ event }: { event: Event }) {
  const { memberCents, nonMemberCents, earlyBirdCents } = event.pricing || {};
  if (!memberCents && !nonMemberCents && !earlyBirdCents) {
    return <span className="text-green-700 font-semibold">Free</span>;
  }
  const lowest = Math.min(
    ...[memberCents, nonMemberCents, earlyBirdCents].filter(
      (v): v is number => typeof v === 'number' && v > 0,
    ),
  );
  return (
    <span className="text-gray-800">
      From
      {' '}
      <span className="font-semibold">{formatPrice(lowest)}</span>
    </span>
  );
}

function EventListItem({ event }: { event: Event }) {
  const isFull = event.capacity != null
    && event.registeredCount >= event.capacity;
  const closed = event.status === 'closed' || isFull;

  return (
    <Link
      to={`/events/${event.slug}`}
      className="block border rounded-lg p-4 hover:shadow-md transition mb-4"
    >
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1">
          <h3 className="text-xl font-semibold">{event.title}</h3>
          <p className="text-sm text-gray-600 mt-1">
            {formatEventDate(event.startAt)}
            {event.location ? ` · ${event.location}` : ''}
          </p>
          {event.visibility === 'members_only' && (
            <p className="text-red-500 text-xs mt-1">Members only</p>
          )}
          {closed && (
            <p className="text-amber-700 text-xs mt-1 font-semibold">
              {isFull ? 'Sold out' : 'Registration closed'}
            </p>
          )}
          {event.resultsUrl && (
            <p className="text-yellow-700 text-xs mt-1 font-semibold">
              Results posted
            </p>
          )}
        </div>
        <div className="text-right">
          <PriceBadge event={event} />
        </div>
      </div>
    </Link>
  );
}

function Events() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const { services, isReady } = useServiceLocator();
  const { isMember } = useAuth();

  useEffect(() => {
    if (!isReady || !services) return undefined;
    const db = services.firebaseResources.firestore;
    const lister = isMember ? listMemberEvents : listPublicEvents;
    const unsub = lister(
      db,
      (evs) => { setEvents(evs); setLoading(false); },
      (err) => { setError(err.message); setLoading(false); },
    );
    return unsub;
  }, [services, isReady, isMember]);

  return (
    <>
      <SEO
        title={SEO_CONFIG.title}
        description={SEO_CONFIG.description}
        keywords={SEO_CONFIG.keywords}
        url={SEO_CONFIG.url}
        canonicalUrl={SEO_CONFIG.url}
        structuredData={structuredData}
      />
      <Header title="Events" image={HeaderImage}>
        Runs, races, and social gatherings with the MPRC community.
      </Header>
      <div className="container mx-auto p-4 max-w-3xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Upcoming Events</h2>
          <Link to="/events/calendar" className="text-sm text-blue-600 hover:underline">
            Calendar view →
          </Link>
        </div>
        {loading && <p className="text-gray-500">Loading events...</p>}
        {error && (
          <p className="text-red-500">
            Error:
            {' '}
            {error}
          </p>
        )}
        {!loading && !error && events.length === 0 && (
          <p className="text-gray-500">No events scheduled at this time.</p>
        )}
        {!loading && !error && events.map((e) => (
          <EventListItem key={e.id} event={e} />
        ))}
      </div>
    </>
  );
}

export default Events;
