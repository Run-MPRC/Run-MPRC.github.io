import React, { useEffect, useState } from 'react';
import {
  collection, onSnapshot, query, where,
} from 'firebase/firestore';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import SEO from '../../components/SEO';

type Event = {
  id: number;
  title: string;
  member_only: boolean;
};

const SEO_CONFIG = {
  title: 'Running Club Events Calendar',
  description: 'Stay updated with Mid-Peninsula Running Club events, races, social gatherings, and special activities for Bay Area runners. Check our calendar for upcoming running events.',
  keywords: 'MPRC events, running club calendar, Bay Area running events, San Mateo running club events, running club activities, MPRC calendar',
  url: 'https://run-mprc.github.io/events',
};

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: 'MPRC Events Calendar',
  description: SEO_CONFIG.description,
  url: SEO_CONFIG.url,
  mainEntity: {
    '@type': 'Organization',
    name: 'Mid-Peninsula Running Club',
    event: {
      '@type': 'SportsEvent',
      name: 'MPRC Events',
      description: 'Various running events, social gatherings, and club activities',
    },
  },
};

function EventsContent({ loading, error, events }: {
  loading: boolean;
  error: string | null;
  events: Event[];
}) {
  if (loading) {
    return <div className="text-center p-4">Loading events...</div>;
  }

  if (error) {
    return <div className="text-center p-4 text-red-500">Error: {error}</div>;
  }

  if (events.length === 0) {
    return <p className="text-gray-500">No events scheduled at this time.</p>;
  }

  return (
    <ul className="list-disc pl-5">
      {events.map((event) => (
        <li key={event.title} className="mb-3">
          <h3 className="text-xl font-semibold">{event.title}</h3>
          {event.member_only && (
            <p className="text-red-500 text-xs">
              This event is for members only.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function Events() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const { services, isReady } = useServiceLocator();

  useEffect(() => {
    if (!isReady || !services) {
      return;
    }

    const { identityService, firebaseResources } = services;
    const db = firebaseResources.firestore;
    const eventsCollection = collection(db, 'events');

    let unsubscribeFn: (() => void) | null = null;

    const subscribeToEvents = (isMember: boolean) => {
      const eventsQuery = isMember
        ? eventsCollection
        : query(eventsCollection, where('member_only', '==', false));

      return onSnapshot(eventsQuery, (snapshot) => {
        const eventsData: Event[] = snapshot.docs.map((doc) => ({
          ...(doc.data() as Event),
        }));
        setEvents(eventsData);
        setLoading(false);
      }, (snapshotError) => {
        setError('Failed to load events');
        setLoading(false);
        console.error('Error loading events:', snapshotError);
      });
    };

    identityService.checkMembership()
      .then((isMember: boolean) => {
        unsubscribeFn = subscribeToEvents(isMember);
      })
      .catch(() => {
        // User not authenticated - show public events only
        unsubscribeFn = subscribeToEvents(false);
      });

    return () => {
      if (unsubscribeFn) {
        unsubscribeFn();
      }
    };
  }, [services, isReady]);

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
      <div className="container mx-auto p-4">
        <h2 className="text-2xl font-bold mb-4">Events</h2>
        <EventsContent loading={loading} error={error} events={events} />
      </div>
    </>
  );
}

export default Events;
