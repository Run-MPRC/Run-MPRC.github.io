import React, {
  useEffect, useMemo, useRef, useState,
} from 'react';
import { Link } from 'react-router-dom';
import SEO from '../../../components/SEO';
import AdminGuard from '../AdminGuard';
import { useServiceLocator } from '../../../services/ServiceLocatorContext';
import { Order } from '../../../types/shop';
import {
  adminOrderAction,
  AdminOrderAction,
  formatPrice,
  listAllOrders,
} from '../../../services/shop/shopService';

interface OrdersLoadOutcome {
  firestore: unknown;
  status: 'loading' | 'resolved' | 'unavailable';
  orders: Order[];
}

const LOAD_FAILURE = 'We could not load orders right now. Stop and contact the treasurer and platform owner before taking any order action.';

function StatusPill({ status }: { status: string }) {
  const m: Record<string, string> = {
    pending: 'bg-gray-200 text-gray-700',
    paid: 'bg-green-100 text-green-800',
    fulfilled: 'bg-blue-100 text-blue-800',
    cancelled: 'bg-gray-300 text-gray-600',
    refunded: 'bg-red-100 text-red-800',
    partially_refunded: 'bg-amber-100 text-amber-800',
  };
  return <span className={`text-xs px-2 py-0.5 rounded ${m[status] || 'bg-gray-100'}`}>{status}</span>;
}

function fmtDate(ts: any) {
  if (!ts?.toDate) return '';
  return ts.toDate().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function Inner() {
  const { services, isReady } = useServiceLocator();
  const firestore = isReady && services
    ? services.firebaseResources.firestore
    : null;
  const currentFirestoreRef = useRef(firestore);
  currentFirestoreRef.current = firestore;
  const requestSequence = useRef(0);
  const [loadOutcome, setLoadOutcome] = useState<OrdersLoadOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const currentOutcome = loadOutcome?.firestore === firestore ? loadOutcome : null;
  const currentStatus = currentOutcome?.status ?? 'loading';
  const orders = currentOutcome?.status === 'resolved' ? currentOutcome.orders : [];

  async function reload() {
    if (!firestore || currentFirestoreRef.current !== firestore) return;
    requestSequence.current += 1;
    const requestId = requestSequence.current;
    const outcomeKey = { firestore };
    setLoadOutcome({ ...outcomeKey, status: 'loading', orders: [] });
    setError(null);
    try {
      const all = await listAllOrders(firestore);
      if (requestId !== requestSequence.current
        || currentFirestoreRef.current !== firestore) return;
      setLoadOutcome({ ...outcomeKey, status: 'resolved', orders: all });
    } catch {
      if (requestId !== requestSequence.current
        || currentFirestoreRef.current !== firestore) return;
      setLoadOutcome({ ...outcomeKey, status: 'unavailable', orders: [] });
    }
  }

  useEffect(() => {
    if (!firestore) {
      requestSequence.current += 1;
      return () => undefined;
    }
    reload();
    return () => { requestSequence.current += 1; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore]);

  async function run(orderId: string, action: AdminOrderAction, payload?: Record<string, unknown>) {
    if (!services) return;
    setBusy(orderId);
    try {
      await adminOrderAction(services.firebaseResources.app, { orderId, action, payload });
      await reload();
    } catch (err: any) {
      setError(err?.message || 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  function promptFulfill(orderId: string) {
    const tracking = window.prompt('Tracking number (optional):') || '';
    const note = window.prompt('Note (optional):') || '';
    run(orderId, 'mark_fulfilled', { trackingNumber: tracking, note });
  }
  function promptRefund(orderId: string, amountCents: number) {
    const ans = window.prompt(
      `Refund amount in USD (blank for full ${formatPrice(amountCents)}):`,
      '',
    );
    if (ans === null) return;
    if (!ans.trim()) {
      if (window.confirm(`Issue full refund of ${formatPrice(amountCents)}?`)) {
        run(orderId, 'refund_full');
      }
      return;
    }
    const dollars = parseFloat(ans);
    if (!Number.isFinite(dollars) || dollars <= 0) return;
    run(orderId, 'refund_partial', { amountCents: Math.round(dollars * 100) });
  }
  function promptCancel(orderId: string) {
    const note = window.prompt('Reason for cancellation:') || '';
    if (window.confirm('Cancel this order? (does not refund — use Refund separately if needed)')) {
      run(orderId, 'cancel', { note });
    }
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (!q) return true;
      return o.buyer?.email?.toLowerCase().includes(q)
        || o.buyer?.lastName?.toLowerCase().includes(q)
        || o.productTitle?.toLowerCase().includes(q);
    });
  }, [orders, filter, statusFilter]);

  const totals = useMemo(() => {
    const paid = orders.filter((o) => o.status === 'paid' || o.status === 'fulfilled');
    const grossCents = paid.reduce((s, o) => s + (o.amountCents || 0), 0);
    return { paid: paid.length, grossCents };
  }, [orders]);

  return (
    <>
      <SEO title="Admin — Orders" noindex />
      <div className="container mx-auto p-4 max-w-6xl">
        <div className="flex justify-between items-center mb-3">
          <h1 className="text-2xl font-bold">Orders</h1>
          <Link to="/admin/products" className="border px-3 py-1 rounded hover:bg-gray-50 text-sm">
            Products →
          </Link>
        </div>

        {currentStatus === 'resolved' && (
          <>
            <div className="grid grid-cols-2 gap-3 my-3">
              <div className="border rounded p-3 bg-green-50">
                <div className="text-xs text-gray-600">Paid</div>
                <div className="text-xl font-bold">{totals.paid}</div>
              </div>
              <div className="border rounded p-3 bg-blue-50">
                <div className="text-xs text-gray-600">Gross revenue</div>
                <div className="text-xl font-bold">{formatPrice(totals.grossCents)}</div>
              </div>
            </div>

            <div className="flex gap-2 flex-wrap items-center my-3">
              <input
                className="border rounded px-3 py-2 flex-1 min-w-[200px]"
                placeholder="Search by buyer or product..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <select
                className="border rounded px-3 py-2"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="paid">Paid</option>
                <option value="fulfilled">Fulfilled</option>
                <option value="pending">Pending</option>
                <option value="refunded">Refunded</option>
                <option value="partially_refunded">Partial refund</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </>
        )}

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
        {currentStatus === 'resolved' && error && (
          <p className="text-red-500 text-sm">{error}</p>
        )}

        {currentStatus === 'resolved' && (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left p-2">Date</th>
                <th className="text-left p-2">Buyer</th>
                <th className="text-left p-2">Product</th>
                <th className="text-left p-2">Size/Color</th>
                <th className="text-right p-2">Amount</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Tracking</th>
                <th className="text-right p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="p-4 text-center text-gray-500">No orders</td></tr>
              )}
              {filtered.map((o) => {
                const canRefund = o.status === 'paid' || o.status === 'fulfilled' || o.status === 'partially_refunded';
                const isBusy = busy === o.id;
                const address = o.shipping ? (
                  <div className="text-xs text-gray-600 mt-1">
                    {o.shipping.line1}
                    {o.shipping.line2 ? `, ${o.shipping.line2}` : ''}
                    <br />
                    {o.shipping.city}
                    ,
                    {' '}
                    {o.shipping.state}
                    {' '}
                    {o.shipping.postalCode}
                  </div>
                ) : null;
                return (
                  <tr key={o.id} className="border-b hover:bg-gray-50 align-top">
                    <td className="p-2 whitespace-nowrap">{fmtDate(o.createdAt)}</td>
                    <td className="p-2">
                      {o.buyer?.firstName}
                      {' '}
                      {o.buyer?.lastName}
                      <div className="text-xs text-gray-500">{o.buyer?.email}</div>
                      {address}
                    </td>
                    <td className="p-2">{o.productTitle}</td>
                    <td className="p-2">
                      {o.size || '—'}
                      {o.color ? ` · ${o.color}` : ''}
                    </td>
                    <td className="p-2 text-right">{formatPrice(o.amountCents || 0)}</td>
                    <td className="p-2"><StatusPill status={o.status} /></td>
                    <td className="p-2 text-xs">{o.trackingNumber || '—'}</td>
                    <td className="p-2 text-right whitespace-nowrap">
                      {(o.status === 'paid') && (
                        <button
                          type="button"
                          onClick={() => promptFulfill(o.id)}
                          disabled={isBusy}
                          className="text-blue-600 hover:underline mr-2 text-xs"
                        >
                          Fulfill
                        </button>
                      )}
                      {canRefund && (
                        <button
                          type="button"
                          onClick={() => promptRefund(o.id, o.amountCents || 0)}
                          disabled={isBusy}
                          className="text-red-600 hover:underline mr-2 text-xs"
                        >
                          Refund
                        </button>
                      )}
                      {o.status !== 'cancelled' && (
                        <button
                          type="button"
                          onClick={() => promptCancel(o.id)}
                          disabled={isBusy}
                          className="text-amber-700 hover:underline text-xs"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function AdminOrders() {
  return <AdminGuard><Inner /></AdminGuard>;
}

export default AdminOrders;
