import React, {
 useEffect, useMemo, useRef, useState
} from 'react';
import { onIdTokenChanged, User } from 'firebase/auth';
import { Link } from 'react-router-dom';
import { useAuth } from '../../services/hooks/useAuth';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import { COMMUNITY_ENABLED } from '../../services/community/communityService';
import {
 RaceCommand, RaceEvent, RaceStatus, RACE_WAIVER, raceId, readFictionalStatus, sendFictionalCommand
} from '../../services/community/fictionalRaceService';
import SEO from '../../components/SEO';
import './Community.css';

type Draft = Omit<RaceCommand, 'accountUid' | 'requestId'>;
const clock = () => performance.now();
const credits = (cents: number) => `${(cents / 100).toFixed(2)} fictional USD credit`;
export default function FictionalRaces() {
  const {
    services
  } = useServiceLocator();
  const {
    user,
    isLoading,
    signOut
  } = useAuth();
  const auth = services?.firebaseResources.auth;
  const functions = services?.firebaseResources.functions;
  const [session, setSession] = useState<{
    user: User;
    epoch: symbol;
  } | null>(null);
  const enabled = COMMUNITY_ENABLED && functions?.app.options.projectId === 'run-mprc-staging' && auth?.app === functions?.app && auth?.tenantId === null;
  const identity = useMemo(() => Symbol('fictional-race-context'), [services, auth, functions, auth?.app, functions?.app, session, user?.uid, enabled]);
  const latestIdentity = useRef(identity);
  latestIdentity.current = identity;
  const generation = useRef(0);
  const inFlight = useRef(false);
  const pending = useRef<RaceCommand | null>(null);
  const focus = useRef<string | null>(null);
  const [snapshot, setSnapshot] = useState<{
    identity: symbol;
    value: RaceStatus;
    began: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [incomingId, setIncomingId] = useState('');
  const [recipientIds, setRecipientIds] = useState<Record<string, string>>({});
  const [waivers, setWaivers] = useState<Record<string, boolean>>({});
  const current = () => enabled && auth && functions && session
    && auth.currentUser === session.user && session.user.uid === user?.uid
    && session.user.emailVerified && raceId(session.user.uid);
  const status = snapshot?.identity === identity && current() ? snapshot.value : null;
  function hide() {
    setSnapshot(null);
    setWaivers({});
    setRecipientIds({});
  }
  async function perform(draft?: Draft, readOnly = false, incoming: string | null = focus.current) {
    if (!current() || !auth || !functions || !session || inFlight.current) return;
    if (draft && typeof globalThis.crypto?.randomUUID !== 'function') {
      setMessage('Use an up-to-date browser to prepare a safe request.');
      return;
    }
    const captured = identity;
    generation.current += 1;
    const serial = generation.current;
    const stillCurrent = () => latestIdentity.current === captured
      && generation.current === serial && current();
    let readFocus = incoming;
    let command = readOnly ? null : pending.current;
    if (draft) {
      try {
        command = { ...draft, accountUid: session.user.uid, requestId: crypto.randomUUID() };
      } catch {
        setMessage('Use an up-to-date browser to prepare a safe request.');
        return;
      }
    }
    if (command) pending.current = command;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    hide();
    try {
      if (command) {
        await sendFictionalCommand(functions, auth, command);
        if (!stillCurrent()) return;
        // The accepted offer is consumed. Reread own entry, never that old offer.
        if (command.action === 'race_accept') readFocus = null;
      }
      const began = clock();
      const value = await readFictionalStatus(functions, auth, session.user.uid, readFocus);
      if (!stillCurrent()) return;
      focus.current = readFocus;
      if (readFocus === null) setIncomingId('');
      setSnapshot({
        identity: captured,
        value,
        began
      });
      pending.current = null;
      setMessage(command ? 'Fictional action confirmed. Current test status is shown below.' : 'Test status refreshed.');
    } catch {
      if (stillCurrent()) {
        hide();
        setMessage(command ? 'We could not confirm this action. Retry saved action, or refresh current status. No real money moves.' : 'Fictional race status is unavailable. Check the test ID or ask the staging owner; refresh or sign in again.');
      }
    } finally {
      if (stillCurrent()) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    if (!enabled || !auth) {
      setSession(null);
      return undefined;
    }
    return onIdTokenChanged(auth, (next) => {
      // Observe session changes without reading/storing a token. An epoch also
      // fences renewed credentials for the same UID / same SDK User object.
      generation.current += 1;
      pending.current = null;
      inFlight.current = false;
      hide();
      setBusy(false);
      setIncomingId('');
      focus.current = null;
      setSession(next ? {
        user: next,
        epoch: Symbol('native-auth-session')
      } : null);
    });
  }, [enabled, auth]);
  useEffect(() => {
    generation.current += 1;
    pending.current = null;
    inFlight.current = false;
    hide();
    setBusy(false);
    setMessage('');
    setIncomingId('');
    focus.current = null;
    if (current()) perform(undefined, true, null);
    return () => {
      generation.current += 1;
    };
    // Captured identity covers actor, native session, resources and provider.
  }, [identity]);
  useEffect(() => {
    if (!status || !snapshot) return undefined;
    const deadlines = [status.accessExpiresAtMs, ...status.events.flatMap((event) => [
      event.opensAtMs, event.closesAtMs, event.startAtMs, event.entry?.offerExpiresAtMs || 0
    ]), status.incoming?.offerExpiresAtMs || 0];
    const next = Math.min(...deadlines.filter((value) => value > status.observedAtMs));
    // Subtract the entire request elapsed time conservatively; no poll or extra
    // read occurs. Server state/clock still decide each submitted action.
    const delay = Math.max(0, next - status.observedAtMs - (clock() - snapshot.began));
    const timer = setTimeout(() => {
      hide();
      setMessage('Test status has expired. Refresh before choosing an action.');
    }, delay);
    return () => clearTimeout(timer);
  }, [status, snapshot]);
  function performEvent(event: RaceEvent, action: Draft['action'], extra: Partial<Draft> = {}) {
    const entryId = action === 'race_join' ? event.joinEntryId : event.entry?.entryId;
    if (!entryId) return;
    perform({
      action,
      eventId: event.eventId,
      entryId,
      expectedEventRevision: event.revision,
      expectedEntryRevision: action === 'race_join' ? 0 : event.entry!.revision,
      ...extra
    });
  }
  if (!enabled) {
    return (
      <div className="community-staging">
        <h1>Fictional races are unavailable here</h1>
        <Link to="/account">My Account</Link>
      </div>
    );
  }
  const note = <p role="note">Staging test only. Made-up accounts and fictional credits, not money. No real race entry, payment or refund. Test rules: one enrollment ever and one transfer.</p>;
  if (isLoading) return <div className="community-staging"><p>Loading account…</p></div>;
  if (!user) {
    return (
      <div className="community-staging">
        <SEO title="Fictional Races — Staging" noindex />
        <h1>Fictional races</h1>
        {note}
        <Link
          to="/login"
          state={{
        from: '/community/races'
      }}
        >
          Sign in to continue
        </Link>
      </div>
    );
  }
  const blocked = busy || pending.current !== null || !current();
  return (
    <div className="community-staging">
      <SEO title="Fictional Races — Staging" noindex />
      <h1>Fictional races</h1>
      {note}
      <p>
        <Link to="/community">Membership and free events</Link>
        {' · '}
        <Link to="/account">My Account</Link>
      </p>
      <button type="button" disabled={busy || !current()} onClick={() => perform(undefined, true)}>
        Refresh test status
      </button>
      <button type="button" disabled={busy || !current()} onClick={() => perform(undefined, true, null)}>
        Show only my entries
      </button>
      {pending.current && (
      <button type="button" disabled={busy || !current()} onClick={() => perform()}>
        Retry saved action
      </button>
)}
      <button type="button" onClick={() => signOut()}>Sign out of test account</button>
      {!current() && (
      <p>
        A verified disposable staging account and current permission are
        required. Sign in again or ask the staging owner.
      </p>
)}
      {message && <p role="status" aria-live="polite">{message}</p>}
      <form onSubmit={(event) => {
      event.preventDefault();
      perform(undefined, true, incomingId);
    }}
      >
        <label htmlFor="incoming-race-id">
          Private incoming test entry ID
          <input id="incoming-race-id" value={incomingId} maxLength={75} disabled={busy || !current()} onChange={(event) => setIncomingId(event.target.value)} />
        </label>
        <button type="submit" disabled={busy || !current() || !raceId(incomingId)}>
          Check named offer
        </button>
        <p>
          No runner search or offer directory. Use only an ID supplied privately
          for this test.
        </p>
      </form>
      {status && (
      <>
        {status.events.length === 0 && <p>No fictional races are configured.</p>}
        {status.events.map((event) => (
          <section key={event.eventId} aria-label={`Test race ${event.eventId}`}>
            <h2>
              Test race
              {' '}
              {event.eventId}
            </h2>
            <p>{new Date(event.startAtMs).toLocaleString()}</p>
            <p>
              Signup:
              {' '}
              {event.signupStatus.replace(/_/g, ' ')}
              . Availability is checked again by the server.
            </p>
            <p>
              Fictional signup credit:
              {' '}
              {credits(event.fictionalAmountCents)}
              .
            </p>
            <p>
              Your enrollment:
              {' '}
              {event.enrollment?.status || 'none'}
              .
            </p>
            {event.canJoin && (
            <>
              <p>SYNTHETIC TEST WAIVER ONLY. Not an approved club waiver or real race.</p>
              <label htmlFor={`race-waiver-${event.eventId}`}>
                <input
                  id={`race-waiver-${event.eventId}`}
                  type="checkbox"
                  disabled={blocked}
                  checked={waivers[event.eventId] || false}
                  onChange={(change) => setWaivers({
              ...waivers,
              [event.eventId]: change.target.checked
            })}
                />
                I accept the fictional test waiver.
              </label>
              <button
                type="button"
                disabled={blocked || !waivers[event.eventId]}
                onClick={() => performEvent(event, 'race_join', {
            waiverAccepted: true,
            waiverVersion: RACE_WAIVER
          })}
              >
                Join fictional race
              </button>
            </>
)}
            {event.entry && (
            <>
              <p>
                Private test entry ID:
                {' '}
                <code>{event.entry.entryId}</code>
                . Bib:
                {' '}
                <code>{event.entry.bibId}</code>
                .
              </p>
              <p>
                Entry:
                {' '}
                {event.entry.status}
                . Returned:
                {' '}
                {credits(event.entry.fictionalReturnedCents)}
                .
              </p>
              <p>
                {event.entry.isOriginalCreditOwner ? 'The original fictional credit belongs to you.' : 'Any fictional credit return stays with the original owner, not the new runner.'}
              </p>
              {event.entry.offerExpiresAtMs !== null && (
              <p>
                Offer deadline:
                  {' '}
                {new Date(event.entry.offerExpiresAtMs).toLocaleString()}
                . Revoke the offer before cancelling.
              </p>
)}
              {event.entry.canCancel && (
              <button type="button" disabled={blocked} onClick={() => performEvent(event, 'race_cancel')}>
                Cancel and simulate full credit return
              </button>
)}
              {event.entry.canRevoke && (
              <button type="button" disabled={blocked} onClick={() => performEvent(event, 'race_revoke')}>
                Revoke fictional offer
              </button>
)}
              {event.entry.canOffer && (
              <form onSubmit={(submit) => {
            submit.preventDefault();
            performEvent(event, 'race_offer', {
              recipientUid: recipientIds[event.eventId]
            });
          }}
              >
                <label htmlFor={`recipient-${event.eventId}`}>
                  Private disposable recipient ID
                  <input
                    id={`recipient-${event.eventId}`}
                    maxLength={75}
                    value={recipientIds[event.eventId] || ''}
                    disabled={blocked}
                    onChange={(change) => setRecipientIds({
                ...recipientIds,
                [event.eventId]: change.target.value
              })}
                  />
                </label>
                <button type="submit" disabled={blocked || !raceId(recipientIds[event.eventId]) || recipientIds[event.eventId] === user.uid}>
                  Offer fictional bib transfer
                </button>
              </form>
)}
            </>
)}
          </section>
))}
        {status.incoming && (
        <section aria-label="Named incoming test offer">
          <h2>Named incoming test offer</h2>
          <p>
            Entry:
            <code>{status.incoming.entryId}</code>
            . Same bib, no new seat or real money.
            Original credit remains with its original owner.
          </p>
          <p>SYNTHETIC TEST WAIVER ONLY. Not an approved club waiver or real race.</p>
          <label htmlFor="recipient-race-waiver">
            <input
              id="recipient-race-waiver"
              type="checkbox"
              disabled={blocked}
              checked={waivers.incoming || false}
              onChange={(event) => setWaivers({
            ...waivers,
            incoming: event.target.checked
          })}
            />
            I accept the recipient&apos;s fictional test waiver.
          </label>
          <button
            type="button"
            disabled={blocked || !waivers.incoming}
            onClick={() => perform({
          action: 'race_accept',
          eventId: status.incoming!.eventId,
          entryId: status.incoming!.entryId,
          expectedEventRevision: status.incoming!.eventRevision,
          expectedEntryRevision: status.incoming!.revision,
          waiverAccepted: true,
          waiverVersion: RACE_WAIVER
        })}
          >
            Accept fictional bib transfer
          </button>
        </section>
)}
      </>
)}
    </div>
  );
}
