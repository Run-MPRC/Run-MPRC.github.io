import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import SEO from '../../components/SEO';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import AdminGuard from './AdminGuard';
import { Event } from '../../types/events';
import { listAllEvents } from '../../services/events/adminService';
import {
  formatEventDate, formatPrice, listEventRegistrations,
} from '../../services/events/eventsService';

interface EventSummary {
  event: Event;
  paidCount: number;
  pendingCount: number;
  refundedCount: number;
  grossCents: number;
}

interface DashboardLoadOutcome {
  firestore: unknown;
  status: 'loading' | 'resolved' | 'unavailable';
  allEvents: Event[];
  nextEvent: EventSummary | null;
}

const LOAD_FAILURE = 'We could not load the admin summary right now. Please try again later.';

function Tile({
  label, value, subtitle,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
}) {
  return (
    <div className="border rounded-lg p-4 bg-white">
      <div className="text-xs text-gray-600 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {subtitle && <div className="text-xs text-gray-500 mt-1">{subtitle}</div>}
    </div>
  );
}

function isUpcoming(e: Event): boolean {
  const ts = e.startAt as Timestamp | undefined;
  if (!ts?.toMillis) return false;
  return ts.toMillis() > Date.now();
}

function Inner() {
  const { services, isReady } = useServiceLocator();
  const firestore = isReady && services
    ? services.firebaseResources.firestore
    : null;
  const [loadOutcome, setLoadOutcome] = useState<DashboardLoadOutcome | null>(null);

  const currentOutcome = loadOutcome?.firestore === firestore ? loadOutcome : null;
  const currentStatus = currentOutcome?.status ?? 'loading';
  const allEvents = currentOutcome?.status === 'resolved' ? currentOutcome.allEvents : [];
  const nextEvent = currentOutcome?.status === 'resolved' ? currentOutcome.nextEvent : null;

  useEffect(() => {
    if (!firestore) return () => undefined;
    let active = true;
    const outcomeKey = { firestore };

    setLoadOutcome({
      ...outcomeKey,
      status: 'loading',
      allEvents: [],
      nextEvent: null,
    });

    (async () => {
      try {
        const all = await listAllEvents(firestore);
        if (!active) return;

        const upcoming = all
          .filter((e) => isUpcoming(e) && (e.status === 'open' || e.status === 'closed'))
          .sort((a, b) => {
            const ams = (a.startAt as Timestamp)?.toMillis?.() ?? 0;
            const bms = (b.startAt as Timestamp)?.toMillis?.() ?? 0;
            return ams - bms;
          });
        const next = upcoming[0];
        let nextSummary: EventSummary | null = null;
        if (next) {
          const regs = await listEventRegistrations(firestore, next.id);
          if (!active) return;
          const paid = regs.filter((r) => r.status === 'paid');
          const pending = regs.filter((r) => r.status === 'pending');
          const refunded = regs.filter(
            (r) => r.status === 'refunded' || r.status === 'partially_refunded',
          );
          nextSummary = {
            event: next,
            paidCount: paid.length,
            pendingCount: pending.length,
            refundedCount: refunded.length,
            grossCents: paid.reduce((s, r) => s + (r.amountCents || 0), 0),
          };
        }

        if (!active) return;
        setLoadOutcome({
          ...outcomeKey,
          status: 'resolved',
          allEvents: all,
          nextEvent: nextSummary,
        });
      } catch {
        if (!active) return;
        setLoadOutcome({
          ...outcomeKey,
          status: 'unavailable',
          allEvents: [],
          nextEvent: null,
        });
      }
    })();

    return () => { active = false; };
  }, [firestore]);

  const totalEvents = allEvents.length;
  const upcomingCount = allEvents.filter(isUpcoming).length;
  const draftCount = allEvents.filter((e) => e.status === 'draft').length;

  return (
    <>
      <SEO title="Admin Panel" noindex />
      <div className="container mx-auto p-4 max-w-5xl">
        <h1 className="text-2xl font-bold mb-4">Admin</h1>

        {currentStatus === 'loading' && <p>Loading...</p>}
        {currentStatus === 'unavailable' && (
          <p
            className="text-red-500 text-sm"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >
            {LOAD_FAILURE}
          </p>
        )}

        {currentStatus === 'resolved' && nextEvent && (
          <section className="mb-6">
            <div className="text-xs uppercase tracking-wide text-gray-600 mb-2">
              Next event
            </div>
            <div className="border rounded-lg p-4 bg-blue-50">
              <div className="flex justify-between items-start">
                <div>
                  <Link
                    to={`/admin/events/${nextEvent.event.slug}/registrations`}
                    className="text-xl font-bold text-blue-800 hover:underline"
                  >
                    {nextEvent.event.title}
                  </Link>
                  <p className="text-sm text-gray-700 mt-1">
                    {formatEventDate(nextEvent.event.startAt)}
                    {nextEvent.event.location ? ` · ${nextEvent.event.location}` : ''}
                  </p>
                </div>
                <Link
                  to={`/admin/events/${nextEvent.event.slug}/registrations`}
                  className="text-sm text-blue-700 hover:underline"
                >
                  View signups →
                </Link>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                <Tile label="Paid" value={nextEvent.paidCount} />
                <Tile label="Pending" value={nextEvent.pendingCount} />
                <Tile label="Refunded" value={nextEvent.refundedCount} />
                <Tile
                  label="Gross"
                  value={formatPrice(nextEvent.grossCents)}
                />
              </div>
              {nextEvent.event.capacity != null && (
                <p className="text-sm text-gray-700 mt-3">
                  Capacity:
                  {' '}
                  <strong>
                    {nextEvent.paidCount + nextEvent.pendingCount}
                    {' / '}
                    {nextEvent.event.capacity}
                  </strong>
                  {' '}
                  (
                  {Math.round(((nextEvent.paidCount + nextEvent.pendingCount) / nextEvent.event.capacity) * 100)}
                  %)
                </p>
              )}
            </div>
          </section>
        )}

        {currentStatus === 'resolved' && (
          <section className="mb-6">
            <div className="text-xs uppercase tracking-wide text-gray-600 mb-2">
              Overall
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Tile label="Total events" value={totalEvents} />
              <Tile label="Upcoming" value={upcomingCount} />
              <Tile label="Drafts" value={draftCount} />
            </div>
          </section>
        )}

        <section>
          <div className="text-xs uppercase tracking-wide text-gray-600 mb-2">
            Manage
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Link
              to="/admin/events"
              className="block border rounded-lg p-4 hover:bg-gray-50"
            >
              <div className="font-semibold">Events</div>
              <div className="text-sm text-gray-600">Create, edit, view signups</div>
            </Link>
            <Link
              to="/admin/events/new"
              className="block border rounded-lg p-4 hover:bg-gray-50"
            >
              <div className="font-semibold">New event</div>
              <div className="text-sm text-gray-600">Create a race or social run</div>
            </Link>
            <Link
              to="/admin/members"
              className="block border rounded-lg p-4 hover:bg-gray-50"
            >
              <div className="font-semibold">Members</div>
              <div className="text-sm text-gray-600">Promote, demote, search</div>
            </Link>
            <Link
              to="/admin/products"
              className="block border rounded-lg p-4 hover:bg-gray-50"
            >
              <div className="font-semibold">Shop products</div>
              <div className="text-sm text-gray-600">Manage merch</div>
            </Link>
            <Link
              to="/admin/orders"
              className="block border rounded-lg p-4 hover:bg-gray-50"
            >
              <div className="font-semibold">Orders</div>
              <div className="text-sm text-gray-600">Fulfill, refund, ship</div>
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}

function AdminHome() {
  return (
    <AdminGuard>
      <Inner />
    </AdminGuard>
  );
}

export default AdminHome;
