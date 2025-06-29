import React, { useContext, useEffect, useState } from 'react';
import {
  collection, onSnapshot, query, where,
} from 'firebase/firestore';
import ServiceLocatorContext from '../../services/ServiceLocatorContext';
import SEO from '../../components/SEO';

type Event = {
  id: number;
  title: string;
  member_only: boolean;
};

function Events() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const { identityService, firebaseResources } = useContext(
    ServiceLocatorContext,
  ) as any;

  useEffect(() => {
    if (!identityService || !firebaseResources.firestore) {
      // console.log('Firebase resources not available yet.');
      return;
    }

    const db = firebaseResources.firestore;
    const eventsCollection = collection(db, 'events');

    // Check if the user is a member
    identityService.isMember.then((isMember: boolean) => {
      const eventsQuery = isMember
        ? eventsCollection
        : query(eventsCollection, where('member_only', '==', false));
      const unsubscribe = onSnapshot(eventsQuery, (snapshot) => {
        const eventsData: Event[] = snapshot.docs.map((doc) => ({
          ...(doc.data() as Event),
        }));
        setEvents(eventsData);
        setLoading(false);
      });

      return () => unsubscribe();
    });
  }, [identityService]);

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "MPRC Events Calendar",
    "description": "Stay updated with Mid-Peninsula Running Club events, races, social gatherings, and special activities for Bay Area runners. Check our calendar for upcoming running events.",
    "url": "https://run-mprc.github.io/events",
    "mainEntity": {
      "@type": "Organization",
      "name": "Mid-Peninsula Running Club",
      "event": {
        "@type": "SportsEvent",
        "name": "MPRC Events",
        "description": "Various running events, social gatherings, and club activities"
      }
    }
  };

  if (loading) {
    return (
      <>
        <SEO 
          title="Running Club Events Calendar"
          description="Stay updated with Mid-Peninsula Running Club events, races, social gatherings, and special activities for Bay Area runners."
          keywords="MPRC events, running club calendar, Bay Area running events, San Mateo running club events, running club activities, MPRC calendar"
          url="https://run-mprc.github.io/events"
          canonicalUrl="https://run-mprc.github.io/events"
          structuredData={structuredData}
        />
        <div className="text-center p-4">Loading events...</div>
      </>
    );
  }

  return (
    <>
      <SEO 
        title="Running Club Events Calendar"
        description="Stay updated with Mid-Peninsula Running Club events, races, social gatherings, and special activities for Bay Area runners. Check our calendar for upcoming running events."
        keywords="MPRC events, running club calendar, Bay Area running events, San Mateo running club events, running club activities, MPRC calendar"
        url="https://run-mprc.github.io/events"
        canonicalUrl="https://run-mprc.github.io/events"
        structuredData={structuredData}
      />
      <div className="container mx-auto p-4">
        <h2 className="text-2xl font-bold mb-4">Events</h2>
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
      </div>
    </>
  );
}
export default Events;
