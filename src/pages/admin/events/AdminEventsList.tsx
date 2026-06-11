import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '../../../components/SEO';
import { useServiceLocator } from '../../../services/ServiceLocatorContext';
import AdminGuard from '../AdminGuard';
import { Event } from '../../../types/events';
import { listAllEvents } from '../../../services/events/adminService';
import { formatEventDate, formatPrice } from '../../../services/events/eventsService';

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: 'bg-gray-200 text-gray-700',
    open: 'bg-green-100 text-green-800',
    closed: 'bg-amber-100 text-amber-800',
    cancelled: 'bg-red-100 text-red-800',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${colors[status] || 'bg-gray-100'}`}>
      {status}
    </span>
  );
}

function Inner() {
  const { services, isReady } = useServiceLocator();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady || !services) return;
    listAllEvents(services.firebaseResources.firestore)
      .then((evs) => { setEvents(evs); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, [services, isReady]);

  return (
    <>
      <SEO title="Admin — Events" noindex />
      <div className="container mx-auto p-4 max-w-5xl">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Events</h1>
          <Link
            to="/admin/events/new"
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
          >
            + New event
          </Link>
        </div>
        {loading && <p>Loading...</p>}
        {error && <p className="text-red-500">{error}</p>}
        {!loading && !error && events.length === 0 && (
          <p className="text-gray-600">
            No events yet.
            {' '}
            <Link to="/admin/events/new" className="text-blue-600 underline">
              Create the first one
            </Link>
            .
          </p>
        )}
        {!loading && events.length > 0 && (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left p-2">Title</th>
                <th className="text-left p-2">Date</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Visibility</th>
                <th className="text-right p-2">Member / Non-member</th>
                <th className="text-right p-2">Signups</th>
                <th className="text-right p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b hover:bg-gray-50">
                  <td className="p-2">
                    <Link
                      to={`/admin/events/${e.slug}/edit`}
                      className="font-semibold text-blue-700 hover:underline"
                    >
                      {e.title || <em>Untitled</em>}
                    </Link>
                    <div className="text-xs text-gray-500">{e.slug}</div>
                  </td>
                  <td className="p-2 text-sm">{formatEventDate(e.startAt)}</td>
                  <td className="p-2"><StatusBadge status={e.status} /></td>
                  <td className="p-2 text-xs text-gray-600">{e.visibility}</td>
                  <td className="p-2 text-right text-sm">
                    {formatPrice(e.pricing?.memberCents || 0)}
                    {' / '}
                    {formatPrice(e.pricing?.nonMemberCents || 0)}
                  </td>
                  <td className="p-2 text-right text-sm">
                    {e.registeredCount}
                    {e.capacity != null ? ` / ${e.capacity}` : ''}
                  </td>
                  <td className="p-2 text-right text-sm">
                    <Link
                      to={`/admin/events/${e.slug}/registrations`}
                      className="text-blue-600 hover:underline mr-3"
                    >
                      Signups
                    </Link>
                    <Link
                      to={`/admin/events/${e.slug}/edit`}
                      className="text-blue-600 hover:underline"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function AdminEventsList() {
  return (
    <AdminGuard>
      <Inner />
    </AdminGuard>
  );
}

export default AdminEventsList;
