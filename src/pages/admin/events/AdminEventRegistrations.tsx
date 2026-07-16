import React, {
  useEffect, useMemo, useRef, useState,
} from 'react';
import { Link, useParams } from 'react-router-dom';
import SEO from '../../../components/SEO';
import {
  ServiceLocatorContextValue,
  useServiceLocator,
} from '../../../services/ServiceLocatorContext';
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

interface RegistrationsLoadOutcome {
  firestore: unknown;
  slug: string;
  status: 'loading' | 'resolved' | 'missing' | 'unavailable';
  event: Event | null;
  registrations: Registration[];
}

const LOAD_FAILURE = 'We could not load registrations right now. Stop and contact the event lead, treasurer, and platform owner before taking any registration action.';

function Inner({
  routeSlug,
  services,
  isReady,
}: {
  routeSlug?: string;
  services: ServiceLocatorContextValue['services'];
  isReady: boolean;
}) {
  const slug = routeSlug;
  const firestore = isReady && services
    ? services.firebaseResources.firestore
    : null;
  const [loadOutcome, setLoadOutcome] = useState<RegistrationsLoadOutcome | null>(null);
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
  const requestSequence = useRef(0);
  const mounted = useRef(true);
  const currentFirestore = useRef(firestore);
  const currentSlug = useRef(slug);
  currentFirestore.current = firestore;
  currentSlug.current = slug;

  const currentOutcome = loadOutcome?.firestore === firestore
    && loadOutcome.slug === slug
    ? loadOutcome
    : null;
  const currentLoadStatus = currentOutcome?.status || 'loading';
  const event = currentLoadStatus === 'resolved' ? currentOutcome?.event || null : null;
  const regs = currentLoadStatus === 'resolved'
    ? currentOutcome?.registrations || []
    : [];

  function isCurrentRequest(requestId: number, db: unknown, eventSlug: string) {
    return mounted.current
      && requestSequence.current === requestId
      && currentFirestore.current === db
      && currentSlug.current === eventSlug;
  }

  async function reload(resetContext = false) {
    const db = firestore;
    if (!db || !slug) return;
    if (!mounted.current || currentFirestore.current !== db || currentSlug.current !== slug) {
      return;
    }

    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    const outcomeKey = { firestore: db, slug };
    setLoadOutcome({
      ...outcomeKey,
      status: 'loading',
      event: null,
      registrations: [],
    });
    setError(null);
    if (resetContext) {
      setModal(null);
      setFilter('');
      setStatusFilter('all');
      setTypeFilter('all');
      setRefundAmount('');
      setNoteText('');
      setRunnerDraft({ firstName: '', lastName: '', email: '' });
      setPriceDraft({ priceTier: 'nonMember', amountDollars: '' });
    }

    try {
      const nextEvent = await getEventBySlug(db, slug);
      if (!isCurrentRequest(requestId, db, slug)) return;
      if (!nextEvent) {
        setLoadOutcome({
          ...outcomeKey,
          status: 'missing',
          event: null,
          registrations: [],
        });
        return;
      }

      const nextRegistrations = await listRegistrationsForEvent(db, slug);
      if (!isCurrentRequest(requestId, db, slug)) return;
      setLoadOutcome({
        ...outcomeKey,
        status: 'resolved',
        event: nextEvent,
        registrations: nextRegistrations,
      });
    } catch {
      if (!isCurrentRequest(requestId, db, slug)) return;
      setLoadOutcome({
        ...outcomeKey,
        status: 'unavailable',
        event: null,
        registrations: [],
      });
    }
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestSequence.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!firestore || !slug) return () => undefined;
    reload(true);
    return () => { requestSequence.current += 1; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, slug]);

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

        {currentLoadStatus === 'resolved' && (
          <>
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
          </>
        )}

        {currentLoadStatus === 'loading' && <p>Loading...</p>}
        {currentLoadStatus === 'unavailable' && (
          <p
            className="text-red-500 text-sm"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >
            {LOAD_FAILURE}
          </p>
        )}
        {currentLoadStatus === 'missing' && <p>Event not found</p>}
        {currentLoadStatus === 'resolved' && error && (
          <p className="text-red-500 text-sm">{error}</p>
        )}

        {currentLoadStatus === 'resolved' && (
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

      {currentLoadStatus === 'resolved' && modal?.kind === 'refund_full' && (
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

      {currentLoadStatus === 'resolved' && modal?.kind === 'refund_partial' && (
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

      {currentLoadStatus === 'resolved' && modal?.kind === 'cancel' && (
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

      {currentLoadStatus === 'resolved' && modal?.kind === 'substitute' && (
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

      {currentLoadStatus === 'resolved' && modal?.kind === 'add_note' && (
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

      {currentLoadStatus === 'resolved' && modal?.kind === 'mark_comp' && (
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

      {currentLoadStatus === 'resolved' && modal?.kind === 'late_add' && (
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

function RegistrationsRoute() {
  const { slug: routeSlug } = useParams<{ slug: string }>();
  const locator = useServiceLocator();
  const readinessKey = locator.isReady && locator.services ? 'ready' : 'not-ready';

  return (
    <Inner
      key={`${routeSlug || 'missing'}:${readinessKey}`}
      routeSlug={routeSlug}
      services={locator.services}
      isReady={locator.isReady}
    />
  );
}

function AdminEventRegistrations() {
  return (
    <AdminGuard>
      <RegistrationsRoute />
    </AdminGuard>
  );
}

export default AdminEventRegistrations;
