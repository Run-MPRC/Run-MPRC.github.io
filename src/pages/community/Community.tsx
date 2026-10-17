import React, {
 useEffect, useMemo, useRef, useState
} from 'react';
import { onIdTokenChanged, User } from 'firebase/auth';
import { Link } from 'react-router-dom';
import { useAuth } from '../../services/hooks/useAuth';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import {
 callCommunity, COMMUNITY_ENABLED, CommunityRequest, CommunityStatus
} from '../../services/community/communityService';
import SEO from '../../components/SEO';
import { TEST_DUES_ENABLED } from '../../services/community/testDuesService';
import { communityFreshFor, parseCommunityResult, parseCommunityStatus } from '../../services/community/communityMemberStatus';
import './Community.css';

function signupMessage(event: CommunityStatus['events'][number]) {
  if (event.status === 'cancelled') return 'Event cancelled.';
  if (event.status === 'closed') return 'Signup is closed.';
  switch (event.signupStatus) {
    case 'open': return 'Signup is open. Availability is checked again when you submit.';
    case 'not_open_yet': return 'Signup has not opened yet.';
    case 'closed': return 'Signup is closed.';
    case 'ended': return 'The signup window has ended.';
    case 'full': return 'No places are available for new signups.';
    case 'cancelled': return 'Event cancelled.';
    default: return 'Signup availability could not be confirmed. Refresh status.';
  }
}

const pacificDate = (value: number) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short'
}).format(value);
type Snapshot = {
  identity: symbol; value: CommunityStatus; began: number; wallBegan: number; budget: number;
};
const fresh = (value: Snapshot) => Math.max(
  performance.now() - value.began,
  Date.now() - value.wallBegan,
) < value.budget;

export default function Community() {
  const { services } = useServiceLocator();
  const { user, isLoading } = useAuth();
  const auth = services?.firebaseResources.auth;
  const functions = services?.firebaseResources.functions;
  const [session, setSession] = useState<{ user: User; epoch: symbol } | null>(null);
  const enabled = COMMUNITY_ENABLED && functions?.app.options.projectId === 'run-mprc-staging'
    && auth?.app === functions?.app && auth?.tenantId === null;
  const identity = useMemo(() => Symbol('community-session'), [services, auth, functions, session, user?.uid, isLoading, enabled]);
  const latestIdentity = useRef(identity); latestIdentity.current = identity;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [waivers, setWaivers] = useState<Record<string, boolean>>({});
  const generation = useRef(0);
  const inFlight = useRef(false);
  const pending = useRef<{ identity: symbol; request: CommunityRequest } | null>(null);
  const current = () => enabled && !isLoading && session && auth?.currentUser === session.user
    && session.user.uid === user?.uid;
  const status = snapshot?.identity === identity && current() && fresh(snapshot)
    ? snapshot.value : null;
  const saved = pending.current?.identity === identity ? pending.current.request : null;
  const verified = current() && session?.user.emailVerified === true;

  async function perform(request?: Omit<CommunityRequest, 'accountUid' | 'requestId'>, statusOnly = false) {
    if (!current() || !auth || !functions || !session
      || inFlight.current || (request && !verified)) return;
    // Recheck at click time too, including after a suspended background tab.
    if (request && (!snapshot || snapshot.identity !== identity || !fresh(snapshot))) {
      setSnapshot(null); setWaivers({}); setMessage('Status needs refreshing. Refresh status before continuing.'); return;
    }
    const captured = identity;
    generation.current += 1;
    const serial = generation.current;
    const stillCurrent = () => latestIdentity.current === captured
      && generation.current === serial && current();
    let command = statusOnly ? null : saved;
    if (request) {
      try {
        command = { ...request, accountUid: session.user.uid, requestId: crypto.randomUUID() };
      } catch { setMessage('This browser cannot prepare a safe request. Use an up-to-date browser.'); return; }
    }
    if (command) pending.current = { identity, request: command };
    inFlight.current = true; setBusy(true); setMessage('');
    setSnapshot(null); setWaivers({});
    try {
      if (command) {
        parseCommunityResult(await callCommunity(functions, command, auth), command);
        if (!stillCurrent()) return;
      }
      const began = performance.now(); const wallBegan = Date.now();
      const value = parseCommunityStatus(await callCommunity(functions, { action: 'status', accountUid: session.user.uid }, auth));
      if (!stillCurrent()) return;
      const next = {
 identity, value, began, wallBegan, budget: communityFreshFor(value)
};
      if (!fresh(next)) throw new Error('Expired status');
      setSnapshot(next); pending.current = null; setWaivers({});
      setMessage(command ? 'Request confirmed. Your status is shown below.' : 'Status refreshed.');
    } catch {
      if (stillCurrent()) { setSnapshot(null); setWaivers({}); setMessage(command
        ? 'We could not confirm this request. Use Retry request; it will not create a second signup.'
        : 'Status could not be loaded. Try Refresh status.'); }
    } finally {
      if (stillCurrent()) { inFlight.current = false; setBusy(false); }
    }
  }
  useEffect(() => {
    if (!enabled || !auth) { setSession(null); return undefined; }
    return onIdTokenChanged(auth, (next) => {
      generation.current += 1; pending.current = null; inFlight.current = false;
      setSnapshot(null); setWaivers({}); setBusy(false); setMessage('');
      setSession(next ? { user: next, epoch: Symbol('native-community-session') } : null);
    });
  }, [enabled, auth]);
  useEffect(() => {
    generation.current += 1; pending.current = null; inFlight.current = false;
    setSnapshot(null); setBusy(false); setMessage(''); setWaivers({});
    if (current()) perform(undefined, true);
    return () => { generation.current += 1; };
    // The identity represents all observed account, provider and session changes.
  }, [identity]);
  useEffect(() => {
    if (!snapshot || snapshot.identity !== identity) return undefined;
    let timer: number;
    function invalidate() {
      window.clearTimeout(timer);
      if (snapshot && !fresh(snapshot)) {
        setSnapshot(null); setWaivers({});
        setMessage('Status needs refreshing. Refresh status before continuing.');
      } else if (snapshot) {
        const elapsed = Math.max(
          performance.now() - snapshot.began,
          Date.now() - snapshot.wallBegan,
        );
        timer = window.setTimeout(invalidate, Math.max(1, Math.ceil(snapshot.budget - elapsed)));
      }
    }
    invalidate();
    document.addEventListener('visibilitychange', invalidate);
    window.addEventListener('focus', invalidate);
    return () => {
      window.clearTimeout(timer); document.removeEventListener('visibilitychange', invalidate);
      window.removeEventListener('focus', invalidate);
    };
  }, [snapshot, identity]);

  if (!enabled) { return (
    <div className="community-staging member-community">
      <h1>Community signup is not available here</h1>
      <Link to="/account">My Account</Link>
    </div>
  ); }
  if (isLoading) return <div className="community-staging member-community"><p>Loading account…</p></div>;
  if (!user?.uid) { return (
    <div className="community-staging member-community">
      <SEO title="Membership and Free Events — Staging" noindex />
      <p className="member-community__eyebrow">MID-PENINSULA RUNNING CLUB</p>
      <h1>Membership and free events</h1>
      <p className="member-community__intro">Your membership, upcoming runs and signups in one place.</p>
      <p role="note">Staging test only. Use made-up accounts. No real membership, race entry or payment is created.</p>
      <Link to="/login" state={{ from: '/community' }}>Sign in to continue</Link>
    </div>
  ); }
  const blocked = busy || saved !== null || !verified;
  const currentMember = status?.membership.entitlement === 'current_member';
  return (
    <div className="community-staging member-community">
      <SEO title="Membership and Free Events — Staging" noindex />
      <p className="member-community__eyebrow">MID-PENINSULA RUNNING CLUB</p>
      <h1>Membership and free events</h1>
      <p className="member-community__intro">Your membership, upcoming runs and signups in one place.</p>
      <p role="note">
        Staging test only. Use made-up accounts.
        No real membership, race entry or payment is created.
      </p>
      <div className="member-community__nav" role="navigation" aria-label="Member pages">
        {TEST_DUES_ENABLED && (
          <Link to="/community/dues">Test annual dues</Link>
        )}
        <Link to="/account">My Account</Link>
        {' '}
        ·
        {' '}
        <Link to="/events">Events</Link>
        {' · '}
        <Link to="/community/admin">Officer tools (staging)</Link>
        {' · '}
        <Link to="/community/races">Fictional races (staging)</Link>
      </div>
      <button type="button" disabled={busy} onClick={() => perform(undefined, true)}>Refresh status</button>
      {' '}
      {saved && <button type="button" disabled={busy} onClick={() => perform()}>Retry request</button>}
      {busy && <p role="status">Loading your current status…</p>}
      {!current() && !isLoading && <p role="status">Confirming your signed-in account. If this continues, return to My Account and sign in again.</p>}
      {current() && !verified && (
        <p>Verify your email in My Account before requesting membership or signing up.</p>
      )}
      {message && <p role="status" aria-live="polite">{message}</p>}
      {status && (
      <div className="member-community__content">
        <section className="member-community__membership" aria-labelledby="membership-title">
          <h2 id="membership-title">Club membership</h2>
          <p>
            Request status:
            {' '}
            {status.membership.applicationStatus.replace(/_/g, ' ')}
            .
          </p>
          <p className="member-community__muted">{TEST_DUES_ENABLED ? 'Use Test annual dues to pay in the Stripe sandbox. Verified test payment activates your test membership automatically. Family invitations are not available yet.' : 'This test screen records a membership request only. Online dues and family invitations are not available here yet.'}</p>
          <p className={`member-community__badge ${currentMember ? 'member-community__badge--active' : ''}`}>{status.membership.entitlement === 'current_member' ? 'Test membership active.' : 'Test membership is not active.'}</p>
          {status.membership.entitlement === 'current_member' && status.membership.accessThroughMs
            && (
            <p>
              Access continues through the paid term ending
              {' '}
              {pacificDate(status.membership.accessThroughMs)}
              {' Pacific time'}
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
          {!currentMember && (
          <p>
            Current membership is required for a new free-event signup.
            {' '}
            You can still cancel an existing signup.
          </p>
)}
          <p className="member-community__muted">Event times are shown in Pacific time. A place is confirmed only after the server accepts your signup.</p>
          {status.events.length === 0 && <p className="member-community__empty">No free events are available. Check back for the next club run.</p>}
          {status.events.map((event) => (
            <article key={event.id} className="member-community__event">
              <h3>{event.title}</h3>
              <p>
                <time dateTime={new Date(event.startAtMs).toISOString()}>
                  {pacificDate(event.startAtMs)}
                  {' '}
                  Pacific time
                </time>
                {' '}
                ·
                {' '}
                {event.location}
              </p>
              <p>{signupMessage(event)}</p>
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
                <details className="member-community__waiver" open>
                  <summary>Read the test event waiver</summary>
                  <p>{event.waiverText}</p>
                </details>
                <label htmlFor={`waiver-${event.id}`}>
                  <input id={`waiver-${event.id}`} type="checkbox" checked={waivers[event.id] || false} disabled={blocked || !currentMember || event.status !== 'open' || event.signupStatus !== 'open'} onChange={(e) => setWaivers({ ...waivers, [event.id]: e.target.checked })} />
                  {' '}
                  I accept the displayed test waiver.
                </label>
                <br />
                <button
                  type="button"
                  disabled={blocked || !currentMember || !waivers[event.id] || event.status !== 'open' || event.signupStatus !== 'open'}
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
      </div>
)}
    </div>
  );
}
