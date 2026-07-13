import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SEO from '../../../components/SEO';
import { useServiceLocator } from '../../../services/ServiceLocatorContext';
import AdminGuard from '../AdminGuard';
import { Event, Registration } from '../../../types/events';
import { getEventBySlug, formatPrice, formatEventDate } from '../../../services/events/eventsService';
import {
  adminRegistrationAction,
  AdminAction,
  listRegistrationsForEvent,
} from '../../../services/events/adminService';

interface RunnerDraft {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  shirtSize?: string;
  dob?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-gray-200 text-gray-700',
    paid: 'bg-green-100 text-green-800',
    refunded: 'bg-red-100 text-red-800',
    partially_refunded: 'bg-amber-100 text-amber-800',
    cancelled: 'bg-gray-300 text-gray-600',
    transferred: 'bg-blue-100 text-blue-800',
    comp: 'bg-purple-100 text-purple-800',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${map[status] || 'bg-gray-100'}`}>
      {status}
    </span>
  );
}

function ActionModal({
  title, children, onClose, onSubmit, submitLabel = 'Submit', submitting,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  submitting?: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-5">
        <h3 className="text-lg font-semibold mb-3">{title}</h3>
        <div className="space-y-3">{children}</div>
        <div className="flex gap-2 justify-end mt-4">
          <button
            type="button"
            onClick={onClose}
            className="border px-4 py-2 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded"
          >
            {submitting ? 'Working...' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function RunnerFields({
  value, onChange,
}: {
  value: RunnerDraft;
  onChange: (v: RunnerDraft) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <input
          className="border rounded px-2 py-1 text-sm"
          placeholder="First name"
          value={value.firstName}
          onChange={(e) => onChange({ ...value, firstName: e.target.value })}
        />
        <input
          className="border rounded px-2 py-1 text-sm"
          placeholder="Last name"
          value={value.lastName}
          onChange={(e) => onChange({ ...value, lastName: e.target.value })}
        />
      </div>
      <input
        className="border rounded px-2 py-1 text-sm w-full"
        placeholder="Email"
        type="email"
        value={value.email}
        onChange={(e) => onChange({ ...value, email: e.target.value })}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          className="border rounded px-2 py-1 text-sm"
          placeholder="Phone"
          value={value.phone || ''}
          onChange={(e) => onChange({ ...value, phone: e.target.value })}
        />
        <input
          className="border rounded px-2 py-1 text-sm"
          placeholder="Shirt size"
          value={value.shirtSize || ''}
          onChange={(e) => onChange({ ...value, shirtSize: e.target.value })}
        />
      </div>
    </>
  );
}

type ModalKind =
  | null
  | { kind: 'refund_full'; reg: Registration }
  | { kind: 'refund_partial'; reg: Registration }
  | { kind: 'cancel'; reg: Registration }
  | { kind: 'substitute'; reg: Registration }
  | { kind: 'add_note'; reg: Registration }
  | { kind: 'mark_comp' }
  | { kind: 'late_add' };

function Inner() {
  const { slug } = useParams<{ slug: string }>();
  const { services, isReady } = useServiceLocator();
  const [event, setEvent] = useState<Event | null>(null);
  const [regs, setRegs] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [exporting, setExporting] = useState(false);

  // Action-specific form state
  const [refundAmount, setRefundAmount] = useState('');
  const [noteText, setNoteText] = useState('');
  const [runnerDraft, setRunnerDraft] = useState<RunnerDraft>({
    firstName: '', lastName: '', email: '',
  });
  const [priceDraft, setPriceDraft] = useState({
    priceTier: 'nonMember' as 'member' | 'nonMember' | 'earlyBird',
    amountDollars: '',
  });

  async function reload() {
    if (!services || !slug) return;
    const db = services.firebaseResources.firestore;
    setLoading(true);
    try {
      const [ev, rs] = await Promise.all([
        getEventBySlug(db, slug),
        listRegistrationsForEvent(db, slug),
      ]);
      setEvent(ev);
      setRegs(rs);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isReady || !services || !slug) return;
    reload();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, isReady, slug]);

  async function downloadCsv() {
    if (!services || !slug) return;
    setExporting(true);
    try {
      const token = await services.firebaseResources.auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not signed in');
      const endpoint = services.firebaseResources.getHttpFunctionUrl('exportRegistrationsCsv');
      const url = `${endpoint}?eventId=${encodeURIComponent(slug)}`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error(`Export failed: ${resp.status}`);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `registrations-${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return regs.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (typeFilter !== 'all' && (r.signupType || 'participant') !== typeFilter) return false;
      if (!f) return true;
      const runner = r.runner || ({} as Registration['runner']);
      return (
        runner.email?.toLowerCase().includes(f)
        || runner.firstName?.toLowerCase().includes(f)
        || runner.lastName?.toLowerCase().includes(f)
      );
    });
  }, [regs, filter, statusFilter, typeFilter]);

  const totals = useMemo(() => {
    const paid = regs.filter((r) => r.status === 'paid');
    const refunded = regs.filter((r) => r.status === 'refunded' || r.status === 'partially_refunded');
    const grossCents = paid.reduce((s, r) => s + (r.amountCents || 0), 0);
    const refundedCents = refunded.reduce((s, r) => s + (r.amountCents || 0), 0);
    return { paid: paid.length, refunded: refunded.length, grossCents, refundedCents };
  }, [regs]);

  async function runAction(action: AdminAction, payload: Record<string, unknown>, registrationId?: string) {
    if (!services || !slug) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await adminRegistrationAction(services.firebaseResources.app, {
        eventId: slug,
        registrationId,
        action,
        payload,
      });
      if (result.paymentLink) {
        // Show late-add payment link to admin for copying/emailing
        window.prompt(
          'Payment link generated. Copy and send to the registrant:',
          result.paymentLink,
        );
      }
      setModal(null);
      await reload();
    } catch (err: any) {
      setError(err?.message || 'Action failed');
    } finally {
      setSubmitting(false);
    }
  }

  function openModal(m: ModalKind) {
    setModal(m);
    setRefundAmount('');
    setNoteText('');
    setRunnerDraft({ firstName: '', lastName: '', email: '' });
    setPriceDraft({ priceTier: 'nonMember', amountDollars: '' });
  }

  return (
    <>
      <SEO title={`Admin — ${event?.title || 'Registrations'}`} noindex />
      <div className="container mx-auto p-4 max-w-6xl">
        <Link to="/admin/events" className="text-sm text-blue-600 hover:underline">
          ← All events
        </Link>
        {event && (
          <div className="mt-2">
            <h1 className="text-2xl font-bold">{event.title}</h1>
            <p className="text-sm text-gray-600">
              {formatEventDate(event.startAt)}
              {event.location ? ` · ${event.location}` : ''}
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
          <div className="border rounded p-3 bg-green-50">
            <div className="text-xs text-gray-600">Paid registrations</div>
            <div className="text-xl font-bold">{totals.paid}</div>
          </div>
          <div className="border rounded p-3 bg-gray-50">
            <div className="text-xs text-gray-600">Refunds</div>
            <div className="text-xl font-bold">{totals.refunded}</div>
          </div>
          <div className="border rounded p-3 bg-blue-50">
            <div className="text-xs text-gray-600">Gross revenue</div>
            <div className="text-xl font-bold">{formatPrice(totals.grossCents)}</div>
          </div>
          <div className="border rounded p-3 bg-amber-50">
            <div className="text-xs text-gray-600">Refunded amount</div>
            <div className="text-xl font-bold">{formatPrice(totals.refundedCents)}</div>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap items-center my-3">
          <input
            className="border rounded px-3 py-2 flex-1 min-w-[200px]"
            placeholder="Search by name or email..."
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
            <option value="pending">Pending</option>
            <option value="refunded">Refunded</option>
            <option value="partially_refunded">Partial refund</option>
            <option value="cancelled">Cancelled</option>
            <option value="comp">Comp</option>
          </select>
          <select
            className="border rounded px-3 py-2"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="all">Everyone</option>
            <option value="participant">Participants</option>
            <option value="volunteer">Volunteers</option>
          </select>
          <button
            type="button"
            onClick={() => openModal({ kind: 'late_add' })}
            className="bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700 text-sm"
          >
            + Late add
          </button>
          <button
            type="button"
            onClick={() => openModal({ kind: 'mark_comp' })}
            className="bg-purple-600 text-white px-3 py-2 rounded hover:bg-purple-700 text-sm"
          >
            + Comp registration
          </button>
          <button
            type="button"
            onClick={downloadCsv}
            disabled={exporting}
            className="border px-3 py-2 rounded hover:bg-gray-50 disabled:opacity-50 text-sm"
          >
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>

        {loading && <p>Loading...</p>}
        {error && <p className="text-red-500 text-sm">{error}</p>}

        {!loading && (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left p-2">Runner</th>
                <th className="text-left p-2">Email</th>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">Tier</th>
                <th className="text-right p-2">Amount</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Shirt</th>
                <th className="text-right p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="p-4 text-center text-gray-500">No registrations</td></tr>
              )}
              {filtered.map((r) => {
                const canRefund = r.status === 'paid' || r.status === 'partially_refunded';
                const signupType = r.signupType || 'participant';
                return (
                  <tr key={r.id} className="border-b hover:bg-gray-50 align-top">
                    <td className="p-2">
                      {r.runner?.firstName}
                      {' '}
                      {r.runner?.lastName}
                    </td>
                    <td className="p-2">{r.runner?.email}</td>
                    <td className="p-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${signupType === 'volunteer' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
                        {signupType}
                      </span>
                    </td>
                    <td className="p-2">{r.priceTier}</td>
                    <td className="p-2 text-right">{formatPrice(r.amountCents || 0)}</td>
                    <td className="p-2"><StatusPill status={r.status} /></td>
                    <td className="p-2">{r.runner?.shirtSize || '—'}</td>
                    <td className="p-2 text-right whitespace-nowrap">
                      {canRefund && (
                        <>
                          <button
                            type="button"
                            onClick={() => openModal({ kind: 'refund_full', reg: r })}
                            className="text-red-600 hover:underline mr-2 text-xs"
                          >
                            Refund
                          </button>
                          <button
                            type="button"
                            onClick={() => openModal({ kind: 'refund_partial', reg: r })}
                            className="text-red-600 hover:underline mr-2 text-xs"
                          >
                            Partial
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => openModal({ kind: 'substitute', reg: r })}
                        className="text-blue-600 hover:underline mr-2 text-xs"
                      >
                        Sub
                      </button>
                      {r.status !== 'cancelled' && (
                        <button
                          type="button"
                          onClick={() => openModal({ kind: 'cancel', reg: r })}
                          className="text-amber-700 hover:underline mr-2 text-xs"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openModal({ kind: 'add_note', reg: r })}
                        className="text-gray-600 hover:underline text-xs"
                      >
                        Note
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {modal?.kind === 'refund_full' && (
        <ActionModal
          title={`Refund full — ${modal.reg.runner?.email}`}
          submitLabel="Issue full refund"
          submitting={submitting}
          onClose={() => setModal(null)}
          onSubmit={() => runAction('refund_full', {}, modal.reg.id)}
        >
          <p>
            Full refund of
            {' '}
            <strong>{formatPrice(modal.reg.amountCents || 0)}</strong>
            {' '}
            will be issued via Stripe. Stripe keeps its processing fee.
          </p>
        </ActionModal>
      )}

      {modal?.kind === 'refund_partial' && (
        <ActionModal
          title={`Partial refund — ${modal.reg.runner?.email}`}
          submitLabel="Issue partial refund"
          submitting={submitting}
          onClose={() => setModal(null)}
          onSubmit={() => {
            const dollars = parseFloat(refundAmount);
            if (!dollars || dollars <= 0) return;
            runAction(
              'refund_partial',
              { amountCents: Math.round(dollars * 100) },
              modal.reg.id,
            );
          }}
        >
          <p>
            Original amount:
            {' '}
            <strong>{formatPrice(modal.reg.amountCents || 0)}</strong>
          </p>
          <label className="block">
            <span className="text-sm">Refund amount (USD)</span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              className="border rounded px-2 py-1 w-full"
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
            />
          </label>
        </ActionModal>
      )}

      {modal?.kind === 'cancel' && (
        <ActionModal
          title={`Cancel — ${modal.reg.runner?.email}`}
          submitLabel="Cancel registration"
          submitting={submitting}
          onClose={() => setModal(null)}
          onSubmit={() => runAction('cancel', { note: noteText }, modal.reg.id)}
        >
          <p className="text-sm text-gray-600">
            Marks the registration cancelled. Does NOT issue a refund — do that separately if needed.
          </p>
          <label className="block">
            <span className="text-sm">Note (optional)</span>
            <input
              className="border rounded px-2 py-1 w-full"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
          </label>
        </ActionModal>
      )}

      {modal?.kind === 'substitute' && (
        <ActionModal
          title={`Substitute runner — was ${modal.reg.runner?.email}`}
          submitLabel="Substitute"
          submitting={submitting}
          onClose={() => setModal(null)}
          onSubmit={() => runAction('substitute', { newRunner: runnerDraft }, modal.reg.id)}
        >
          <RunnerFields value={runnerDraft} onChange={setRunnerDraft} />
        </ActionModal>
      )}

      {modal?.kind === 'add_note' && (
        <ActionModal
          title="Add note"
          submitLabel="Add note"
          submitting={submitting}
          onClose={() => setModal(null)}
          onSubmit={() => runAction('add_note', { note: noteText }, modal.reg.id)}
        >
          <input
            className="border rounded px-2 py-1 w-full"
            placeholder="Note..."
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
          />
        </ActionModal>
      )}

      {modal?.kind === 'mark_comp' && (
        <ActionModal
          title="Comp registration"
          submitLabel="Create comp"
          submitting={submitting}
          onClose={() => setModal(null)}
          onSubmit={() => runAction('mark_comp', { registration: { runner: runnerDraft } })}
        >
          <p className="text-sm text-gray-600">
            Creates a $0 registration for this runner. Use for VIPs, staff, volunteers.
          </p>
          <RunnerFields value={runnerDraft} onChange={setRunnerDraft} />
        </ActionModal>
      )}

      {modal?.kind === 'late_add' && (
        <ActionModal
          title="Late add (with Stripe Payment Link)"
          submitLabel="Create late registration"
          submitting={submitting}
          onClose={() => setModal(null)}
          onSubmit={() => {
            const amt = parseFloat(priceDraft.amountDollars || '0');
            runAction('add_late_registration', {
              registration: {
                runner: runnerDraft,
                priceTier: priceDraft.priceTier,
                amountCents: Math.round(amt * 100),
              },
            });
          }}
        >
          <p className="text-sm text-gray-600">
            Creates a pending registration and a Stripe Payment Link you can send to the runner.
          </p>
          <RunnerFields value={runnerDraft} onChange={setRunnerDraft} />
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-sm">Tier</span>
              <select
                className="border rounded px-2 py-1 w-full text-sm"
                value={priceDraft.priceTier}
                onChange={(e) => setPriceDraft({
                  ...priceDraft, priceTier: e.target.value as any,
                })}
              >
                <option value="member">member</option>
                <option value="nonMember">nonMember</option>
                <option value="earlyBird">earlyBird</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm">Amount (USD)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                className="border rounded px-2 py-1 w-full text-sm"
                value={priceDraft.amountDollars}
                onChange={(e) => setPriceDraft({
                  ...priceDraft, amountDollars: e.target.value,
                })}
              />
            </label>
          </div>
        </ActionModal>
      )}
    </>
  );
}

function AdminEventRegistrations() {
  return (
    <AdminGuard>
      <Inner />
    </AdminGuard>
  );
}

export default AdminEventRegistrations;
