import React, {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { Link, useParams } from 'react-router-dom';
import SEO from '../../../components/SEO';
import {
  ServiceLocatorContextValue,
  useServiceLocator,
} from '../../../services/ServiceLocatorContext';
import { useAuth } from '../../../services/hooks/useAuth';
import type { AuthUser } from '../../../services/identity/Identity';
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
  app: unknown;
  firestore: unknown;
  slug: string;
  status: 'loading' | 'resolved' | 'missing' | 'unavailable';
  event: Event | null;
  registrations: Registration[];
}

interface RegistrationActionOutcome {
  app: unknown;
  firestore: unknown;
  slug: string;
  actionId: number;
  status: 'pending' | 'unknown';
}

const LOAD_FAILURE = 'We could not load registrations right now. Stop and contact the event lead, treasurer, and platform owner before taking any registration action.';
const LATE_REGISTRATION_OUTCOME_UNKNOWN = 'We could not confirm this $0 late registration. Do not try again on this page. Stop and contact the event lead, treasurer, and platform owner.';
const REGISTRATION_ACTION_OUTCOME_UNKNOWN = 'We could not confirm that registration action. Do not repeat it. Stop and contact the event lead, treasurer, and platform owner.';
const EXPORT_PENDING = 'Registration export in progress. Do not start another registration action or export.';
const EXPORT_OUTCOME_UNKNOWN = 'We could not confirm that registration export. Do not try again on this page. Stop and contact the event lead, privacy lead, treasurer, and platform owner.';

function Inner({
  routeSlug,
  services,
  isReady,
  adminUid,
  adminUser,
}: {
  routeSlug?: string;
  services: ServiceLocatorContextValue['services'];
  isReady: boolean;
  adminUid: string | null;
  adminUser: AuthUser | null;
}) {
  const slug = routeSlug;
  const firebaseResources = isReady && services
    ? services.firebaseResources
    : null;
  const firestore = firebaseResources?.firestore || null;
  const firebaseApp = firebaseResources?.app || null;
  const firebaseAuthUser = firebaseResources?.auth?.currentUser || null;
  const [loadOutcome, setLoadOutcome] = useState<RegistrationsLoadOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lateRegistrationOutcomeUnknown, setLateRegistrationOutcomeUnknown] = useState(false);
  const [registrationActionOutcome, setRegistrationActionOutcome] = useState<
    RegistrationActionOutcome | null
  >(null);
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
  const requestSequence = useRef(0);
  const registrationActionSequence = useRef(0);
  const registrationActionRequestBlocked = useRef(false);
  const lateRegistrationRequestBlocked = useRef(false);
  const exportSequence = useRef(0);
  const exportRequestBlocked = useRef(false);
  const exportAbortController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const currentServices = useRef(services);
  const currentFirebaseResources = useRef(firebaseResources);
  const currentFirebaseApp = useRef(firebaseApp);
  const currentFirestore = useRef(firestore);
  const currentSlug = useRef(slug);
  const currentIsReady = useRef(isReady);
  const currentAdminUid = useRef(adminUid);
  const currentAdminUser = useRef(adminUser);
  const currentFirebaseAuthUser = useRef(firebaseAuthUser);
  currentServices.current = services;
  currentFirebaseResources.current = firebaseResources;
  currentFirebaseApp.current = firebaseApp;
  currentFirestore.current = firestore;
  currentSlug.current = slug;
  currentIsReady.current = isReady;
  currentAdminUid.current = adminUid;
  currentAdminUser.current = adminUser;
  currentFirebaseAuthUser.current = firebaseAuthUser;

  function detachAndAbortExport() {
    const controller = exportAbortController.current;
    exportAbortController.current = null;
    try {
      controller?.abort();
    } catch {
      // Sequence and exact-context checks remain the fail-closed authority.
    }
  }

  const currentRegistrationActionOutcome = registrationActionOutcome?.app === firebaseApp
    && registrationActionOutcome.firestore === firestore
    && registrationActionOutcome.slug === slug
    && registrationActionOutcome.actionId === registrationActionSequence.current
    ? registrationActionOutcome
    : null;
  const registrationActionPending = currentRegistrationActionOutcome?.status === 'pending';
  const registrationActionOutcomeUnknown = currentRegistrationActionOutcome?.status === 'unknown';
  const currentOutcome = loadOutcome?.app === firebaseApp
    && loadOutcome.firestore === firestore
    && loadOutcome.slug === slug
    ? loadOutcome
    : null;
  const currentLoadStatus = currentOutcome?.status || 'loading';
  const canShowResolved = currentLoadStatus === 'resolved'
    && !lateRegistrationOutcomeUnknown
    && !registrationActionOutcomeUnknown
    && !error;
  const event = canShowResolved ? currentOutcome?.event || null : null;
  const regs = canShowResolved
    ? currentOutcome?.registrations || []
    : [];

  function isCurrentRequest(
    requestId: number,
    app: unknown,
    db: unknown,
    eventSlug: string,
  ) {
    return mounted.current
      && requestSequence.current === requestId
      && currentFirebaseApp.current === app
      && currentFirestore.current === db
      && currentSlug.current === eventSlug;
  }

  function isCurrentExport(
    exportId: number,
    serviceContext: NonNullable<typeof services>,
    resources: NonNullable<typeof firebaseResources>,
    app: unknown,
    db: unknown,
    eventSlug: string,
    uid: string,
    renderedUser: AuthUser,
    authUser: NonNullable<typeof resources.auth.currentUser>,
  ) {
    try {
      return mounted.current
        && exportSequence.current === exportId
        && currentServices.current === serviceContext
        && currentFirebaseResources.current === resources
        && currentFirebaseApp.current === app
        && currentFirestore.current === db
        && currentSlug.current === eventSlug
        && currentIsReady.current
        && currentAdminUid.current === uid
        && currentAdminUser.current === renderedUser
        && currentFirebaseAuthUser.current === authUser
        && resources.auth.currentUser === authUser
        && renderedUser.uid === uid
        && authUser.uid === uid;
    } catch {
      return false;
    }
  }

  async function reload(resetContext = false) {
    const app = firebaseApp;
    const db = firestore;
    if (!db || !slug) return false;
    if (
      !mounted.current
      || currentFirebaseApp.current !== app
      || currentFirestore.current !== db
      || currentSlug.current !== slug
    ) {
      return false;
    }

    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    const outcomeKey = { app, firestore: db, slug };
    setLoadOutcome({
      ...outcomeKey,
      status: 'loading',
      event: null,
      registrations: [],
    });
    setError(null);
    if (resetContext) {
      registrationActionSequence.current += 1;
      registrationActionRequestBlocked.current = false;
      lateRegistrationRequestBlocked.current = false;
      setRegistrationActionOutcome(null);
      setLateRegistrationOutcomeUnknown(false);
      setModal(null);
      setSubmitting(false);
      setFilter('');
      setStatusFilter('all');
      setTypeFilter('all');
      setRefundAmount('');
      setNoteText('');
      setRunnerDraft({ firstName: '', lastName: '', email: '' });
    }

    try {
      const nextEvent = await getEventBySlug(db, slug);
      if (!isCurrentRequest(requestId, app, db, slug)) return false;
      if (!nextEvent) {
        setLoadOutcome({
          ...outcomeKey,
          status: 'missing',
          event: null,
          registrations: [],
        });
        return false;
      }

      const nextRegistrations = await listRegistrationsForEvent(db, slug);
      if (!isCurrentRequest(requestId, app, db, slug)) return false;
      setLoadOutcome({
        ...outcomeKey,
        status: 'resolved',
        event: nextEvent,
        registrations: nextRegistrations,
      });
      return true;
    } catch {
      if (!isCurrentRequest(requestId, app, db, slug)) return false;
      setLoadOutcome({
        ...outcomeKey,
        status: 'unavailable',
        event: null,
        registrations: [],
      });
      return false;
    }
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestSequence.current += 1;
      exportSequence.current += 1;
      exportRequestBlocked.current = true;
      detachAndAbortExport();
    };
  }, []);

  useLayoutEffect(() => {
    exportSequence.current += 1;
    exportRequestBlocked.current = false;
    detachAndAbortExport();
    setExporting(false);
    setError(null);
    return () => {
      exportSequence.current += 1;
      exportRequestBlocked.current = true;
      detachAndAbortExport();
    };
  }, [
    adminUid,
    adminUser,
    firebaseApp,
    firebaseAuthUser,
    firebaseResources,
    firestore,
    isReady,
    services,
    slug,
  ]);

  useLayoutEffect(() => {
    registrationActionSequence.current += 1;
    registrationActionRequestBlocked.current = false;
    setRegistrationActionOutcome(null);
    return () => {
      registrationActionSequence.current += 1;
      registrationActionRequestBlocked.current = false;
    };
  }, [firebaseApp, firestore, slug]);

  useEffect(() => {
    if (!firestore || !slug) return () => undefined;
    reload(true);
    return () => { requestSequence.current += 1; };
  // Firebase app, Firestore, and slug changes are the deliberate reload boundary.
  }, [firebaseApp, firestore, slug]);

  async function downloadCsv() {
    const serviceContext = services;
    const resources = firebaseResources;
    const app = firebaseApp;
    const db = firestore;
    const eventSlug = slug;
    const uid = adminUid;
    const renderedUser = adminUser;
    if (
      !serviceContext
      || !resources
      || !app
      || !db
      || !eventSlug
      || !uid
      || !renderedUser
      || renderedUser.uid !== uid
      || currentLoadStatus !== 'resolved'
      || error
      || modal
      || exportRequestBlocked.current
      || registrationActionRequestBlocked.current
      || lateRegistrationRequestBlocked.current
    ) {
      return;
    }
    const authUser = firebaseAuthUser;
    if (
      !authUser
      || resources.auth?.currentUser !== authUser
      || authUser.uid !== uid
    ) return;

    const exportId = exportSequence.current + 1;
    exportSequence.current = exportId;
    const controller = new AbortController();
    detachAndAbortExport();
    exportAbortController.current = controller;
    exportRequestBlocked.current = true;
    setExporting(true);
    setError(null);
    setModal(null);
    const isCurrent = () => isCurrentExport(
      exportId,
      serviceContext,
      resources,
      app,
      db,
      eventSlug,
      uid,
      renderedUser,
      authUser,
    );
    let completed = false;
    try {
      const token = await authUser.getIdToken();
      if (!isCurrent()) return;
      if (!token) throw new Error('Export unavailable');
      const endpoint = firebaseResources.getHttpFunctionUrl('exportRegistrationsCsv');
      const url = `${endpoint}?eventId=${encodeURIComponent(eventSlug)}`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      if (!resp.ok) throw new Error('Export unavailable');
      const blob = await resp.blob();
      if (!isCurrent()) return;

      let blobUrl: string | null = null;
      let anchor: HTMLAnchorElement | null = null;
      let clicked = false;
      let cleanupFailed = false;
      try {
        blobUrl = URL.createObjectURL(blob);
        if (!isCurrent()) return;
        anchor = document.createElement('a');
        anchor.href = blobUrl;
        anchor.download = `registrations-${eventSlug}-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(anchor);
        if (!isCurrent()) return;
        anchor.click();
        clicked = true;
      } finally {
        if (anchor) {
          try {
            anchor.removeAttribute('href');
            anchor.removeAttribute('download');
          } catch {
            cleanupFailed = true;
          }
          try {
            anchor.remove();
          } catch {
            cleanupFailed = true;
            try {
              anchor.parentNode?.removeChild(anchor);
            } catch {
              // The fixed terminal outcome below is the only safe recovery.
            }
          }
        }
        if (blobUrl !== null) {
          try {
            URL.revokeObjectURL(blobUrl);
          } catch {
            cleanupFailed = true;
          }
        }
      }
      if (cleanupFailed) throw new Error('Export cleanup unavailable');
      completed = clicked;
    } catch {
      if (!isCurrent()) return;
      setError(EXPORT_OUTCOME_UNKNOWN);
    } finally {
      try {
        controller.abort();
      } catch {
        // Sequence and exact-context checks remain the fail-closed authority.
      }
      if (exportAbortController.current === controller) {
        exportAbortController.current = null;
      }
      if (isCurrent()) {
        setExporting(false);
        if (completed) {
          exportRequestBlocked.current = false;
        }
      }
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
    if (
      !firebaseApp
      || !firestore
      || !slug
      || !mounted.current
      || currentFirebaseApp.current !== firebaseApp
      || currentFirestore.current !== firestore
      || currentSlug.current !== slug
      || registrationActionRequestBlocked.current
      || lateRegistrationRequestBlocked.current
      || exportRequestBlocked.current
    ) {
      return;
    }
    const actionApp = firebaseApp;
    const actionFirestore = firestore;
    const actionSlug = slug;
    const isLateRegistration = action === 'add_late_registration';
    let actionId: number | null = null;
    if (isLateRegistration) {
      lateRegistrationRequestBlocked.current = true;
    } else {
      registrationActionSequence.current += 1;
      actionId = registrationActionSequence.current;
      registrationActionRequestBlocked.current = true;
      setRegistrationActionOutcome({
        app: actionApp,
        firestore: actionFirestore,
        slug: actionSlug,
        actionId,
        status: 'pending',
      });
    }
    setSubmitting(true);
    setError(null);

    function isCurrentAction() {
      return mounted.current
        && currentFirebaseApp.current === actionApp
        && currentFirestore.current === actionFirestore
        && currentSlug.current === actionSlug
        && (
          isLateRegistration
          || (
            actionId !== null
            && registrationActionSequence.current === actionId
          )
        );
    }

    try {
      await adminRegistrationAction(actionApp, {
        eventId: slug,
        registrationId,
        action,
        payload,
      });
      if (!isCurrentAction()) return;
      setModal(null);
      const reloadSucceeded = await reload();
      if (!isCurrentAction()) return;
      if (isLateRegistration && reloadSucceeded) {
        lateRegistrationRequestBlocked.current = false;
      } else if (!isLateRegistration) {
        registrationActionRequestBlocked.current = false;
        setRegistrationActionOutcome(null);
      }
    } catch {
      if (!isCurrentAction()) return;
      if (isLateRegistration) {
        setModal(null);
        setError(null);
        setLateRegistrationOutcomeUnknown(true);
        return;
      }
      if (actionId === null) return;
      setModal(null);
      setError(null);
      setRegistrationActionOutcome({
        app: actionApp,
        firestore: actionFirestore,
        slug: actionSlug,
        actionId,
        status: 'unknown',
      });
    } finally {
      if (isCurrentAction()) {
        setSubmitting(false);
      }
    }
  }

  function openModal(m: ModalKind) {
    if (
      registrationActionRequestBlocked.current
      || lateRegistrationRequestBlocked.current
      || exportRequestBlocked.current
    ) {
      return;
    }
    setModal(m);
    setRefundAmount('');
    setNoteText('');
    setRunnerDraft({ firstName: '', lastName: '', email: '' });
  }

  return (
    <>
      <SEO title={`Admin — ${event?.title || 'Registrations'}`} noindex />
      <div className="container mx-auto p-4 max-w-6xl">
        <Link to="/admin/events" className="text-sm text-blue-600 hover:underline">
          ← All events
        </Link>
        {canShowResolved && event && (
          <div className="mt-2">
            <h1 className="text-2xl font-bold">{event.title}</h1>
            <p className="text-sm text-gray-600">
              {formatEventDate(event.startAt)}
              {event.location ? ` · ${event.location}` : ''}
            </p>
          </div>
        )}

        {canShowResolved && (
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
                disabled={registrationActionPending || exporting}
                className="bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400 text-sm"
              >
                + Late registration — $0 only
              </button>
              <button
                type="button"
                onClick={() => openModal({ kind: 'mark_comp' })}
                disabled={registrationActionPending || exporting}
                className="bg-purple-600 text-white px-3 py-2 rounded hover:bg-purple-700 disabled:bg-gray-400 text-sm"
              >
                + Comp registration
              </button>
              <button
                type="button"
                onClick={downloadCsv}
                disabled={exporting || submitting || registrationActionPending}
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
        {registrationActionPending && (
          <p
            className="text-sm mt-4"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            Registration action in progress. Do not start another action.
          </p>
        )}
        {exporting && (
          <p
            className="text-sm mt-4"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {EXPORT_PENDING}
          </p>
        )}
        {registrationActionOutcomeUnknown && (
          <p
            className="text-red-500 text-sm mt-4"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >
            {REGISTRATION_ACTION_OUTCOME_UNKNOWN}
          </p>
        )}
        {lateRegistrationOutcomeUnknown && (
          <p
            className="text-red-500 text-sm mt-4"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >
            {LATE_REGISTRATION_OUTCOME_UNKNOWN}
          </p>
        )}
        {error && (
          <p
            className="text-red-500 text-sm mt-4"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >
            {error}
          </p>
        )}

        {canShowResolved && (
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
                            disabled={registrationActionPending || exporting}
                            className="text-red-600 hover:underline mr-2 text-xs"
                          >
                            Refund
                          </button>
                          <button
                            type="button"
                            onClick={() => openModal({ kind: 'refund_partial', reg: r })}
                            disabled={registrationActionPending || exporting}
                            className="text-red-600 hover:underline mr-2 text-xs"
                          >
                            Partial
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => openModal({ kind: 'substitute', reg: r })}
                        disabled={registrationActionPending || exporting}
                        className="text-blue-600 hover:underline mr-2 text-xs"
                      >
                        Sub
                      </button>
                      {r.status !== 'cancelled' && (
                        <button
                          type="button"
                          onClick={() => openModal({ kind: 'cancel', reg: r })}
                          disabled={registrationActionPending || exporting}
                          className="text-amber-700 hover:underline mr-2 text-xs"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openModal({ kind: 'add_note', reg: r })}
                        disabled={registrationActionPending || exporting}
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

      {canShowResolved && modal?.kind === 'refund_full' && (
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

      {canShowResolved && modal?.kind === 'refund_partial' && (
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

      {canShowResolved && modal?.kind === 'cancel' && (
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

      {canShowResolved && modal?.kind === 'substitute' && (
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

      {canShowResolved && modal?.kind === 'add_note' && (
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

      {canShowResolved && modal?.kind === 'mark_comp' && (
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

      {canShowResolved && modal?.kind === 'late_add' && (
        <ActionModal
          title="Late registration — $0 only"
          submitLabel="Create $0 registration"
          submitting={submitting}
          onClose={() => setModal(null)}
          onSubmit={() => runAction('add_late_registration', {
            registration: {
              runner: runnerDraft,
              priceTier: 'nonMember',
              amountCents: 0,
            },
          })}
        >
          <p className="text-sm text-gray-600">
            Creates a $0 local registration. Paid late registration is NOT AVAILABLE YET.
            The legacy system labels this record paid, but it does not prove payment or make
            the entry free, comp, or member-authorized. Do not create or send a Stripe Payment
            Link as a workaround.
          </p>
          <RunnerFields value={runnerDraft} onChange={setRunnerDraft} />
        </ActionModal>
      )}
    </>
  );
}

function RegistrationsRoute() {
  const { slug: routeSlug } = useParams<{ slug: string }>();
  const locator = useServiceLocator();
  const { user } = useAuth();
  const adminUid = typeof user?.uid === 'string' && user.uid ? user.uid : null;
  const readinessKey = locator.isReady && locator.services ? 'ready' : 'not-ready';

  return (
    <Inner
      key={`${routeSlug || 'missing'}:${readinessKey}:${adminUid || 'no-user'}`}
      routeSlug={routeSlug}
      services={locator.services}
      isReady={locator.isReady}
      adminUid={adminUid}
      adminUser={user}
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
