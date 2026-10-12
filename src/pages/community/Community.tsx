import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../services/hooks/useAuth';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import {
 callCommunity, COMMUNITY_ENABLED, CommunityRequest, CommunityStatus
} from '../../services/community/communityService';
import SEO from '../../components/SEO';
import './Community.css';

export default function Community() {
  const { services } = useServiceLocator();
  const { user, isLoading } = useAuth();
  const uid = user?.uid;
  const functions = services?.firebaseResources.functions;
  const [snapshot, setSnapshot] = useState<{
    uid: string; functions: unknown; value: CommunityStatus;
  } | null>(null);
  const status = snapshot && snapshot.uid === uid && snapshot.functions === functions
    ? snapshot.value : null;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [waivers, setWaivers] = useState<Record<string, boolean>>({});
  const generation = useRef(0);
  const inFlight = useRef(false);
  const pending = useRef<CommunityRequest | null>(null);
  const enabled = COMMUNITY_ENABLED && functions?.app.options.projectId === 'run-mprc-staging';

  useEffect(() => {
    generation.current += 1;
    const {current} = generation;
    pending.current = null; inFlight.current = false;
    setSnapshot(null); setBusy(false); setMessage(''); setWaivers({});
    if (enabled && uid && functions) {
      callCommunity(functions, { action: 'status', accountUid: uid }).then((value) => {
        if (generation.current === current) setSnapshot({ uid, functions, value });
      }).catch(() => {
        if (generation.current === current) setMessage('Status could not be loaded. Try Refresh status.');
      });
    }
    return () => { generation.current += 1; };
  }, [enabled, uid, functions]);

  async function perform(request?: Omit<CommunityRequest, 'accountUid' | 'requestId'>, statusOnly = false) {
    if (!enabled || !uid || !functions || inFlight.current) return;
    if (request && typeof globalThis.crypto?.randomUUID !== 'function') {
      setMessage('This browser cannot prepare a safe request. Use an up-to-date browser.');
      return;
    }
    generation.current += 1;
    const {current} = generation;
    inFlight.current = true; setBusy(true); setMessage('');
    let command = statusOnly ? null : pending.current;
    if (!statusOnly && request) {
      command = { ...request, accountUid: uid, requestId: crypto.randomUUID() };
    }
    if (command) pending.current = command;
    try {
      if (command) await callCommunity(functions, command);
      if (generation.current !== current) return;
      // Always reread current status: a saved retry result may predate rejoining
      // or term expiry. It must never overwrite authoritative current state.
      const value = await callCommunity(functions, { action: 'status', accountUid: uid });
      if (generation.current === current) {
        setSnapshot({ uid, functions, value }); pending.current = null; setWaivers({});
        setMessage(command ? 'Request confirmed. Your status is shown below.' : 'Status refreshed.');
      }
    } catch {
      if (generation.current === current) { setMessage(command
        ? 'We could not confirm this request. Use Retry request; it will not create a second signup.'
        : 'Status could not be loaded. Try Refresh status.'); }
    } finally {
      if (generation.current === current) { inFlight.current = false; setBusy(false); }
    }
  }

  if (!enabled) { return (
    <div className="community-staging">
      <h1>Community signup is not available here</h1>
      <Link to="/account">My Account</Link>
    </div>
  ); }
  if (isLoading) return <div className="community-staging"><p>Loading account…</p></div>;
  if (!uid) { return (
    <div className="community-staging">
      <SEO title="Membership and Free Events — Staging" noindex />
      <h1>Membership and free events</h1>
      <p role="note">Staging test only. Use made-up accounts. No real membership, race entry or payment is created.</p>
      <Link to="/login" state={{ from: '/community' }}>Sign in to continue</Link>
    </div>
  ); }
  const verified = services?.firebaseResources.auth.currentUser?.emailVerified === true;
  const blocked = busy || pending.current !== null || !verified;
  return (
    <div className="community-staging">
      <SEO title="Membership and Free Events — Staging" noindex />
      <h1>Membership and free events</h1>
      <p role="note">
        Staging test only. Use made-up accounts.
        No real membership, race entry or payment is created.
      </p>
      <p>
        <Link to="/account">My Account</Link>
        {' '}
        ·
        {' '}
        <Link to="/events">Events</Link>
      </p>
      <button type="button" disabled={busy} onClick={() => perform(undefined, true)}>Refresh status</button>
      {' '}
      {pending.current && <button type="button" disabled={busy} onClick={() => perform()}>Retry request</button>}
      {!verified && (
        <p>Verify your email in My Account before requesting membership or signing up.</p>
      )}
      {message && <p role="status" aria-live="polite">{message}</p>}
      {status && (
      <>
        <section aria-labelledby="membership-title">
          <h2 id="membership-title">Club membership</h2>
          <p>
            Request status:
            {' '}
            {status.membership.applicationStatus.replace(/_/g, ' ')}
            .
          </p>
          <p>
            Signup requests await officer confirmation of dues. They do not grant paid membership.
          </p>
          {status.membership.entitlement === 'current_member' && status.membership.accessThroughMs
            && (
            <p>
              Access continues through the paid term ending
              {new Date(status.membership.accessThroughMs).toLocaleString()}
              .
            </p>
)}
          <p>
            Cancelling withdraws a pending request, or keeps approved access through the paid term.
            No refund is issued.
          </p>
          <button type="button" disabled={blocked || status.membership.applicationStatus === 'pending' || status.membership.entitlement === 'current_member'} onClick={() => perform({ action: 'membership_join', expectedRevision: status.membership.revision })}>Request membership</button>
          {' '}
          <button type="button" disabled={blocked || !['pending', 'approved'].includes(status.membership.applicationStatus)} onClick={() => perform({ action: 'membership_cancel', expectedRevision: status.membership.revision })}>{status.membership.entitlement === 'current_member' ? 'Cancel membership' : 'Withdraw membership request'}</button>
        </section>
        <section aria-labelledby="free-events-title">
          <h2 id="free-events-title">Free events</h2>
          {status.events.length === 0 && <p>No free events are available.</p>}
          {status.events.map((event) => (
            <article key={event.id} style={{ marginTop: 24 }}>
              <h3>{event.title}</h3>
              <p>
                {new Date(event.startAtMs).toLocaleString()}
                {' '}
                ·
                {' '}
                {event.location}
              </p>
              <p>
                {event.confirmedCount}
                {' '}
                of
                {' '}
                {event.capacity}
                {' '}
                places booked. Your signup:
                {' '}
                {event.registration.status}
                .
              </p>
              {event.registration.status !== 'confirmed' && (
              <>
                <p>{event.waiverText}</p>
                <label htmlFor={`waiver-${event.id}`}>
                  <input id={`waiver-${event.id}`} type="checkbox" checked={waivers[event.id] || false} disabled={blocked} onChange={(e) => setWaivers({ ...waivers, [event.id]: e.target.checked })} />
                  {' '}
                  I accept the displayed test waiver.
                </label>
                <br />
                <button
                  type="button"
                  disabled={blocked || !waivers[event.id] || event.status !== 'open'}
                  onClick={() => perform({
 action: 'event_join', eventId: event.id, expectedRevision: event.registration.revision, waiverVersion: event.waiverVersion, waiverAccepted: true
})}
                >
                  Sign up for
                  {' '}
                  {event.title}
                </button>
              </>
)}
              {event.registration.status === 'confirmed' && (
              <button type="button" disabled={blocked} onClick={() => perform({ action: 'event_cancel', eventId: event.id, expectedRevision: event.registration.revision })}>
                Cancel signup for
                {' '}
                {event.title}
              </button>
)}
            </article>
))}
        </section>
      </>
)}
    </div>
  );
}
