import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import { useServiceLocator } from '../services/ServiceLocatorContext';
import { useAuth } from '../services/hooks/useAuth';
import {
  listMemberEvents,
  listPublicEvents,
  formatEventDate,
  formatPrice,
} from '../services/events/eventsService';
import { Event } from '../types/events';

const MAX_EVENTS = 4;

function isUpcoming(e: Event): boolean {
  const ts = e.startAt as Timestamp | undefined;
  if (!ts?.toMillis) return false;
  return ts.toMillis() > Date.now();
}

function priceLabel(e: Event): string {
  const candidates = [
    e.pricing?.memberCents,
    e.pricing?.nonMemberCents,
    e.pricing?.earlyBirdCents,
  ].filter((v): v is number => typeof v === 'number');
  if (candidates.length === 0) return 'Free';
  const min = Math.min(...candidates);
  if (min <= 0) return 'Free';
  return `From ${formatPrice(min)}`;
}

function UpcomingEventsPreview() {
  const { services, isReady } = useServiceLocator();
  const { isMember } = useAuth();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isReady || !services) return undefined;
    const db = services.firebaseResources.firestore;
    const lister = isMember ? listMemberEvents : listPublicEvents;
    const unsub = lister(
      db,
      (evs) => {
        setEvents(evs.filter(isUpcoming).slice(0, MAX_EVENTS));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [services, isReady, isMember]);

  if (loading) return null;
  if (events.length === 0) return null;

  return (
    <section className="container mx-auto px-4 py-10 max-w-5xl">
      <div className="flex justify-between items-end mb-4 flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold">What&apos;s coming up</h2>
          <p className="text-gray-600 text-sm mt-1">
            The next few runs and events on the calendar.
          </p>
        </div>
        <Link
          to="/events"
          className="text-sm text-blue-600 hover:underline whitespace-nowrap"
        >
          See all events →
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {events.map((e) => (
          <Link
            key={e.id}
            to={`/events/${e.slug}`}
            className="block border rounded-lg p-4 hover:shadow-md transition bg-white"
          >
            <div className="flex justify-between items-start gap-3">
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold truncate">{e.title}</h3>
                <p className="text-sm text-gray-600 mt-1">
                  {formatEventDate(e.startAt)}
                </p>
                {e.location && (
                  <p className="text-sm text-gray-500 truncate">{e.location}</p>
                )}
              </div>
              <div className="text-right text-sm whitespace-nowrap">
                <span className="text-gray-700 font-medium">{priceLabel(e)}</span>
                {e.visibility === 'members_only' && (
                  <div className="text-xs text-red-500 mt-1">Members only</div>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default UpcomingEventsPreview;
