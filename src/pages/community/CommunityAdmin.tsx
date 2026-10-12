import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
 getMultiFactorResolver, MultiFactorError, MultiFactorResolver,
 signInWithEmailAndPassword, TotpMultiFactorGenerator
} from 'firebase/auth';
import { useAuth } from '../../services/hooks/useAuth';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import {
 AdministrationRequest, AdministrationStatus, callAdministration, COMMUNITY_ENABLED, FreeEventDraft
} from '../../services/community/communityService';
import SEO from '../../components/SEO';
import './Community.css';

function OfficerSignIn() {
  const { services } = useServiceLocator();
  const auth = services?.firebaseResources.auth;
  const [resolver, setResolver] = useState<MultiFactorResolver | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const active = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => {
    active.current += 1; setResolver(null); setBusy(false); setMessage('');
    inFlight.current = false;
    return () => { active.current += 1; };
  }, [auth]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || auth.app.options.projectId !== 'run-mprc-staging' || inFlight.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const generation = active.current;
    inFlight.current = true; setBusy(true); setMessage('');
    form.reset(); // Credentials/codes are never persisted or logged.
    try {
      if (resolver) {
        const hint = resolver.hints.find(
          (factor) => factor.factorId === TotpMultiFactorGenerator.FACTOR_ID,
        );
        if (!hint) throw new Error('Unavailable second factor.');
        const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, String(values.get('code')),);
        await resolver.resolveSignIn(assertion);
      } else {
        await signInWithEmailAndPassword(auth, String(values.get('email')), String(values.get('password')));
      }
    } catch (failure) {
      if (active.current !== generation) return;
      if (!resolver && (failure as MultiFactorError).code === 'auth/multi-factor-auth-required') {
        setResolver(getMultiFactorResolver(auth, failure as MultiFactorError));
      } else setMessage('Sign-in was not completed. Try again or ask the staging owner.');
    } finally {
      if (active.current === generation) { setBusy(false); inFlight.current = false; }
    }
  }
  return (
    <form onSubmit={submit}>
      <h2>Officer sign-in</h2>
      <p>Use only the disposable staging account supplied privately by the specialist.</p>
      {resolver ? (
        <label htmlFor="officer-code">
          Authenticator code
          <input id="officer-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={busy} />
        </label>
) : (
  <>
    <label htmlFor="officer-email">
      Email
      <input id="officer-email" name="email" type="email" autoComplete="username" required disabled={busy} />
    </label>
    <label htmlFor="officer-password">
      Password
      <input id="officer-password" name="password" type="password" autoComplete="current-password" required disabled={busy} />
    </label>
  </>
      )}
      <button type="submit" disabled={busy}>{resolver ? 'Verify authenticator code' : 'Sign in'}</button>
      {resolver && <button type="button" disabled={busy} onClick={() => { setResolver(null); setMessage(''); }}>Start sign-in again</button>}
      {message && <p role="status">{message}</p>}
    </form>
  );
}

export default function CommunityAdmin() {
  const { services } = useServiceLocator();
  const { user, isLoading, signOut } = useAuth();
  const uid = user?.uid;
  const functions = services?.firebaseResources.functions;
  const enabled = COMMUNITY_ENABLED && functions?.app.options.projectId === 'run-mprc-staging';
  const [snapshot, setSnapshot] = useState<{
    uid: string; functions: unknown; value: AdministrationStatus;
  } | null>(null);
  const status = snapshot?.uid === uid && snapshot?.functions === functions
    ? snapshot?.value : null;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<AdministrationStatus['events'][number] | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const pending = useRef<AdministrationRequest | null>(null);
  const cursor = useRef<string | undefined>(undefined);
  const duesCursor = useRef<string | undefined>(undefined);
  useEffect(() => {
    generation.current += 1; const {current} = generation;
    inFlight.current = false; pending.current = null; cursor.current = undefined;
    duesCursor.current = undefined;
    setSnapshot(null); setBusy(false); setMessage(''); setEditing(null);
    if (enabled && uid && functions) {
      callAdministration(functions, { action: 'admin_status', accountUid: uid }).then((value) => {
        if (generation.current === current) setSnapshot({ uid, functions, value });
      }).catch(() => { if (generation.current === current) setMessage('Officer access is unavailable. It requires an assigned permission and a recent authenticator sign-in.'); });
    }
    return () => { generation.current += 1; };
  }, [enabled, uid, functions]);

  async function perform(request?: Omit<AdministrationRequest, 'accountUid' | 'requestId' | 'reason'>, refresh = false, nextCursor?: string, nextDuesCursor?: string) {
    if (!enabled || !uid || !functions || inFlight.current) return;
    if (request && typeof globalThis.crypto?.randomUUID !== 'function') { setMessage('Use an up-to-date browser to prepare a safe request.'); return; }
    generation.current += 1; const {current} = generation;
    inFlight.current = true; setBusy(true); setMessage(''); setEditing(null);
    if (refresh) { cursor.current = nextCursor; duesCursor.current = nextDuesCursor; }
    let command = refresh ? null : pending.current;
    if (request) { command = {
 ...request, accountUid: uid, requestId: crypto.randomUUID(), reason: 'synthetic_staging_review'
}; }
    if (command) pending.current = command;
    try {
      if (command) await callAdministration(functions, command);
      if (generation.current !== current) return;
      const value = await callAdministration(functions, {
 action: 'admin_status',
accountUid: uid,
        ...(cursor.current ? { cursor: cursor.current } : {}),
...(duesCursor.current ? { duesCursor: duesCursor.current } : {})
});
      if (generation.current === current) { setSnapshot({ uid, functions, value }); pending.current = null; setMessage(command ? 'Action confirmed. Current server status is shown.' : 'Status refreshed.'); }
    } catch {
      if (generation.current === current) {
        setSnapshot(null); // Never keep privileged projections after a denial.
        setMessage(command ? 'Action could not be confirmed. Retry the saved request; refresh before preparing a different action.' : 'Officer access is unavailable. Sign out and sign in with your authenticator, or ask the staging owner.');
      }
    } finally { if (generation.current === current) { inFlight.current = false; setBusy(false); } }
  }
  function saveEvent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    const draft: FreeEventDraft = {
      title: String(values.get('title')).trim(),
location: String(values.get('location')).trim(),
capacity: Number(values.get('capacity')),
      startAtMs: Date.parse(String(values.get('start'))),
opensAtMs: Date.parse(String(values.get('opens'))),
closesAtMs: Date.parse(String(values.get('closes'))),
    };
    const valid = [draft.startAtMs, draft.opensAtMs, draft.closesAtMs].every(Number.isSafeInteger)
      && draft.opensAtMs < draft.closesAtMs && draft.closesAtMs <= draft.startAtMs;
    if (!valid) { setMessage('Signup must open before it closes, and close by the event start.'); return; }
    if (!editing && typeof globalThis.crypto?.randomUUID !== 'function') { setMessage('Use an up-to-date browser.'); return; }
    perform({
 action: editing ? 'admin_event_edit' : 'admin_event_create', eventId: editing?.id || `stage-${crypto.randomUUID()}`, expectedRevision: editing?.revision || 0, event: draft
});
  }
  const localTime = (value?: number) => (value ? new Date(value - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
  const blocked = busy || pending.current !== null;
  if (!enabled) return <div className="community-staging"><h1>Officer tools are unavailable here</h1></div>;
  return (
    <div className="community-staging">
      <SEO title="Officer Community Tools — Staging" noindex />
      <h1>Officer community tools</h1>
      <p role="note">
        Staging test only. Made-up members, free events and fictional dues receipts only.
        Approval simulates a test term. Dues recording moves no money,
        links no account and grants no Auth role.
      </p>
      <Link to="/community">Member signup and events</Link>
      {isLoading && <p>Loading account…</p>}
      {!isLoading && !uid && <OfficerSignIn />}
      {uid && (
        <>
          <p>
            Permissions expire and are checked on every request.
            Sign out and sign in again when your authenticator session is over ten minutes old.
          </p>
          <button type="button" disabled={busy} onClick={() => perform(undefined, true)}>Refresh officer status</button>
          {pending.current && <button type="button" disabled={busy} onClick={() => perform()}>Retry saved action</button>}
          <button type="button" disabled={busy} onClick={() => signOut().catch(() => setMessage('Sign-out could not be confirmed. Try again.'))}>Sign out</button>
        </>
      )}
      {message && <p role="status" aria-live="polite">{message}</p>}
      {status?.capabilities.duesRecording && (
        <section>
          <h2>Record fictional external dues</h2>
          <p>
            Test only. No money moves. Receipts remain unlinked and grant no account access.
            Do not enter real payment references or member details.
          </p>
          {status.duesPolicy ? (
            <>
              <p>
                Server test amount:
                {' '}
                {status.duesPolicy.currency}
                {' '}
                {(status.duesPolicy.amountCents / 100).toFixed(2)}
                .
                {' '}
                Fictional external method. Test term:
                {' '}
                {status.duesPolicy.termId}
                ;
                {' '}
                {new Date(status.duesPolicy.startsAtMs).toLocaleString()}
                {' '}
                to
                {' '}
                {new Date(status.duesPolicy.endsAtMs).toLocaleString()}
                .
              </p>
              <form onSubmit={(event) => {
                event.preventDefault();
                const values = new FormData(event.currentTarget);
                if (values.get('externalConfirmed') !== 'on' || !status.duesPolicy) return;
                perform({
 action: 'admin_dues_record',
expectedRevision: 0,
                  confirmationId: String(values.get('confirmationId')),
externalConfirmed: true,
policyRevision: status.duesPolicy.revision
});
              }}
              >
                <label htmlFor="dues-confirmation">
                  Fictional confirmation ID (UUID)
                  <input
                    id="dues-confirmation"
                    name="confirmationId"
                    pattern="[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"
                    maxLength={36}
                    required
                    disabled={blocked || !status.duesRecordingOpen}
                  />
                </label>
                <label htmlFor="dues-confirmed">
                  <input
                    id="dues-confirmed"
                    name="externalConfirmed"
                    type="checkbox"
                    required
                    disabled={blocked || !status.duesRecordingOpen}
                  />
                  I confirm this is a fictional test of an externally received payment,
                  not real money.
                </label>
                <button type="submit" disabled={blocked || !status.duesRecordingOpen}>Record fictional dues</button>
              </form>
              {!status.duesRecordingOpen && (
                <p>
                  The test term is not open.
                  Ask the staging specialist for a new test configuration.
                </p>
              )}
            </>
          ) : <p>No test dues configuration. Ask the staging specialist.</p>}
          {(status.dues || []).length === 0 && <p>No fictional dues receipts.</p>}
          {(status.dues || []).map((receipt) => (
            <article key={receipt.membershipId}>
              <h3>
                Test membership:
                {receipt.membershipId}
              </h3>
              <p>
                {receipt.currency}
                {' '}
                {(receipt.amountCents / 100).toFixed(2)}
                {' '}
                ·
                {' '}
                {receipt.termId}
                {' '}
                · Unlinked; no account access granted.
              </p>
            </article>
          ))}
          {status.nextDuesCursor && <button type="button" disabled={blocked} onClick={() => perform(undefined, true, undefined, status.nextDuesCursor || undefined)}>Next dues receipts</button>}
          <button type="button" disabled={blocked} onClick={() => perform(undefined, true)}>First dues receipts</button>
        </section>
      )}
      {status?.capabilities.membershipApproval && (
        <section>
          <h2>Pending membership requests</h2>
          <p>
            Only synthetic test approval is available. The server supplies the original test term;
            no annual policy or payment is inferred.
          </p>
          {status.pending.length === 0 && <p>No pending requests.</p>}
          {status.pending.map((member) => (
            <article key={member.uid}>
              <h3>
                Test account:
                {' '}
                {member.uid}
              </h3>
              <button type="button" disabled={blocked} onClick={() => perform({ action: 'admin_membership_approve', targetUid: member.uid, expectedRevision: member.revision })}>
                Approve test membership for
                {' '}
                {member.uid}
              </button>
            </article>
          ))}
          {status.nextCursor && <button type="button" disabled={blocked} onClick={() => perform(undefined, true, status.nextCursor || undefined)}>Next requests</button>}
          <button type="button" disabled={blocked} onClick={() => perform(undefined, true)}>First requests</button>
        </section>
      )}
      {status?.capabilities.freeEventManagement && (
        <section>
          <h2>Manage free test events</h2>
          <p>
            Create starts closed. Open signup separately. Close stops new signups.
            Cancel is final, but booked members can still cancel their own signup.
            It sends no messages and issues no refunds.
          </p>
          {status.events.map((event) => (
            <article key={event.id}>
              <h3>{event.title}</h3>
              <p>
                {event.status}
                {' '}
                ·
                {' '}
                {event.confirmedCount}
                {' '}
                of
                {' '}
                {event.capacity}
                {' '}
                booked
              </p>
              <button type="button" disabled={blocked || event.confirmedCount > 0 || event.status === 'cancelled'} onClick={() => setEditing(event)}>
                {`Edit ${event.title}`}
              </button>
              <button type="button" disabled={blocked || event.status !== 'closed'} onClick={() => perform({ action: 'admin_event_open', eventId: event.id, expectedRevision: event.revision })}>
                {`Open signup for ${event.title}`}
              </button>
              <button type="button" disabled={blocked || event.status !== 'open'} onClick={() => perform({ action: 'admin_event_close', eventId: event.id, expectedRevision: event.revision })}>
                {`Close signup for ${event.title}`}
              </button>
              <button type="button" disabled={blocked || event.status === 'cancelled'} onClick={() => perform({ action: 'admin_event_cancel', eventId: event.id, expectedRevision: event.revision })}>
                {`Cancel event ${event.title}`}
              </button>
              <form
                key={`${event.id}-${event.revision}`}
                onSubmit={(e) => { e.preventDefault(); perform({
 action: 'admin_event_capacity', eventId: event.id, expectedRevision: event.revision, capacity: Number(new FormData(e.currentTarget).get('capacity'))
}); }}
              >
                <label htmlFor={`capacity-${event.id}`}>
                  {`Capacity for ${event.title}`}
                  <input id={`capacity-${event.id}`} name="capacity" type="number" min={Math.max(1, event.confirmedCount)} max={10000} defaultValue={event.capacity} required disabled={blocked || event.status === 'cancelled'} />
                </label>
                <button type="submit" disabled={blocked || event.status === 'cancelled'}>
                  {`Save capacity for ${event.title}`}
                </button>
              </form>
            </article>
          ))}
          <form key={editing?.id || 'new-event'} onSubmit={saveEvent}>
            <h3>{editing ? `Edit ${editing.title}` : 'Create free test event'}</h3>
            <label htmlFor="event-title">
              Title
              <input id="event-title" name="title" maxLength={200} defaultValue={editing?.title} required disabled={blocked} />
            </label>
            <label htmlFor="event-location">
              Location
              <input id="event-location" name="location" maxLength={200} defaultValue={editing?.location} required disabled={blocked} />
            </label>
            <label htmlFor="event-start">
              Event start (your local time)
              <input id="event-start" name="start" type="datetime-local" defaultValue={localTime(editing?.startAtMs)} required disabled={blocked} />
            </label>
            <label htmlFor="event-opens">
              Signup opens (your local time)
              <input id="event-opens" name="opens" type="datetime-local" defaultValue={localTime(editing?.opensAtMs)} required disabled={blocked} />
            </label>
            <label htmlFor="event-closes">
              Signup closes (your local time)
              <input id="event-closes" name="closes" type="datetime-local" defaultValue={localTime(editing?.closesAtMs)} required disabled={blocked} />
            </label>
            <label htmlFor="event-capacity">
              Capacity
              <input id="event-capacity" name="capacity" type="number" min={1} max={10000} defaultValue={editing?.capacity || 10} required disabled={blocked} />
            </label>
            <button type="submit" disabled={blocked || (!editing && status.events.length >= 20)}>{editing ? 'Save event changes' : 'Create closed test event'}</button>
            {editing && <button type="button" disabled={blocked} onClick={() => setEditing(null)}>Cancel editing</button>}
          </form>
        </section>
      )}
    </div>
  );
}
