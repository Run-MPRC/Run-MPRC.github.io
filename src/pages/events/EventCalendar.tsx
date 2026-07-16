import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import SEO from '../../components/SEO';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import { useAuth } from '../../services/hooks/useAuth';
import {
  listMemberEvents,
  listPublicEvents,
  formatPrice,
} from '../../services/events/eventsService';
import { Event } from '../../types/events';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function addMonths(d: Date, delta: number) {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function buildMonthGrid(ref: Date) {
  const first = startOfMonth(ref);
  const last = endOfMonth(ref);
  const startWeekday = first.getDay();
  const daysInMonth = last.getDate();
  const cells: Array<{ date: Date | null; inMonth: boolean }> = [];

  for (let i = 0; i < startWeekday; i += 1) {
    cells.push({ date: null, inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push({ date: new Date(ref.getFullYear(), ref.getMonth(), d), inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ date: null, inMonth: false });
  }
  return cells;
}

function EventChip({ event }: { event: Event }) {
  const isFull = event.capacity != null && event.registeredCount >= event.capacity;
  const mutedClass = event.status === 'closed' || isFull || event.status === 'cancelled'
    ? 'bg-gray-200 text-gray-600 line-through'
    : event.visibility === 'members_only'
      ? 'bg-purple-100 text-purple-800'
      : 'bg-blue-100 text-blue-800';
  const lowest = Math.min(
    ...[
      event.pricing?.memberCents,
      event.pricing?.nonMemberCents,
      event.pricing?.earlyBirdCents,
    ].filter((v): v is number => typeof v === 'number' && v > 0),
  );
  return (
    <Link
      to={`/events/${event.slug}`}
      className={`block text-xs px-1 py-0.5 rounded mb-0.5 truncate ${mutedClass} hover:underline`}
      title={`${event.title}${Number.isFinite(lowest) ? ` · from ${formatPrice(lowest)}` : ''}`}
    >
      {event.title}
    </Link>
  );
}

function EventCalendar() {
  const { services, isReady } = useServiceLocator();
  const { isMember } = useAuth();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(new Date()));

  useEffect(() => {
    if (!isReady || !services) return undefined;
    const db = services.firebaseResources.firestore;
    const lister = isMember ? listMemberEvents : listPublicEvents;
    const unsub = lister(
      db,
      (evs) => { setEvents(evs); setLoading(false); },
      () => { setError('We could not load events right now. Please try again later.'); setLoading(false); },
    );
    return unsub;
  }, [services, isReady, isMember]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, Event[]>();
    events.forEach((e) => {
      const ts = e.startAt as Timestamp | undefined;
      if (!ts?.toDate) return;
      const d = ts.toDate();
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const arr = map.get(key) || [];
      arr.push(e);
      map.set(key, arr);
    });
    return map;
  }, [events]);

  const cells = useMemo(() => buildMonthGrid(cursor), [cursor]);
  const monthLabel = cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const today = new Date();

  return (
    <>
      <SEO
        title="Events Calendar"
        description="Month-view calendar of MPRC events and runs"
        url="https://runmprc.com/events/calendar"
        canonicalUrl="https://runmprc.com/events/calendar"
      />
      <div className="container mx-auto p-4 max-w-4xl">
        <div className="flex justify-between items-center flex-wrap gap-2 mb-3">
          <h1 className="text-2xl font-bold">Events calendar</h1>
          <Link to="/events" className="text-sm text-blue-600 hover:underline">
            List view →
          </Link>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <button
            type="button"
            onClick={() => setCursor(addMonths(cursor, -1))}
            className="border rounded px-3 py-1 hover:bg-gray-50"
            aria-label="Previous month"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => setCursor(startOfMonth(new Date()))}
            className="border rounded px-3 py-1 hover:bg-gray-50 text-sm"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setCursor(addMonths(cursor, 1))}
            className="border rounded px-3 py-1 hover:bg-gray-50"
            aria-label="Next month"
          >
            →
          </button>
          <div className="text-lg font-semibold ml-2">{monthLabel}</div>
        </div>

        {loading && <p className="text-gray-500">Loading...</p>}
        {error && <p className="text-red-500" role="alert" aria-live="assertive" aria-atomic="true">{error}</p>}

        {!loading && !error && (
          <div className="grid grid-cols-7 gap-px bg-gray-200 border border-gray-200 rounded overflow-hidden">
            {WEEKDAYS.map((d) => (
              <div key={d} className="bg-gray-50 p-2 text-xs font-semibold text-center">
                {d}
              </div>
            ))}
            {cells.map((cell, i) => {
              const key = cell.date
                ? `${cell.date.getFullYear()}-${cell.date.getMonth()}-${cell.date.getDate()}`
                : null;
              const dayEvents = (key && eventsByDay.get(key)) || [];
              const isToday = cell.date ? isSameDay(cell.date, today) : false;
              return (
                <div
                  key={i}
                  className={`bg-white min-h-[100px] p-1 ${cell.inMonth ? '' : 'bg-gray-50 opacity-60'} ${isToday ? 'ring-2 ring-blue-400 ring-inset' : ''}`}
                >
                  {cell.date && (
                    <>
                      <div className={`text-xs ${isToday ? 'font-bold text-blue-700' : 'text-gray-600'}`}>
                        {cell.date.getDate()}
                      </div>
                      {dayEvents.slice(0, 4).map((e) => (
                        <EventChip key={e.id} event={e} />
                      ))}
                      {dayEvents.length > 4 && (
                        <div className="text-xs text-gray-500">
                          +
                          {dayEvents.length - 4}
                          {' '}
                          more
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

export default EventCalendar;
