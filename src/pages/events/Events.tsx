import React, { useContext, useEffect, useState } from 'react';
import {
  collection, onSnapshot, query, where,
} from 'firebase/firestore';
import ServiceLocatorContext from '../../services/ServiceLocatorContext';

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

  if (loading) {
    return <div className="text-center p-4">Loading events...</div>;
  }

  return (
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
  );
}
export default Events;
