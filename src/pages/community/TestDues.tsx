import React, {
 useEffect, useMemo, useRef, useState
} from 'react';
import { onIdTokenChanged, User } from 'firebase/auth';
import { Link } from 'react-router-dom';
import { useAuth } from '../../services/hooks/useAuth';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import {
 callTestDues, DuesRequest, DuesStatus, openTestCheckout,
 parseDuesResult, parseDuesStatus, TEST_DUES_ENABLED
} from '../../services/community/testDuesService';
import SEO from '../../components/SEO';
import './Community.css';

const date = (ms: number) => new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'medium'
}).format(ms - 1);
export default function TestDues() {
    const { services } = useServiceLocator();
    const { user, isLoading } = useAuth();
    const auth = services?.firebaseResources.auth;
    const functions = services?.firebaseResources.functions;
    const [session, setSession] = useState<{
        user: User;
        epoch: symbol;
    } | null>(null);
    const enabled = TEST_DUES_ENABLED
        && functions?.app.options.projectId === 'run-mprc-staging'
        && auth?.app === functions?.app
        && auth?.tenantId === null;
    const identity = useMemo(() => Symbol('test-dues'), [enabled,
        services,
        auth,
        functions,
        session,
        user?.uid,
        isLoading]);
    const currentIdentity = useRef(identity);
    currentIdentity.current = identity;
    const serial = useRef(0);
    const inFlight = useRef(false);
    const pending = useRef<{
        identity: symbol;
        request: DuesRequest;
    } | null>(null);
    const [snapshot, setSnapshot] = useState<{
        identity: symbol;
        value: DuesStatus;
        began: number;
        wall: number;
        budget: number;
    } | null>(null);
    const [busy, setBusy] = useState(false);
    const [accepted, setAccepted] = useState(false);
    const [message, setMessage] = useState('');
    const current = () => enabled
        && !isLoading
        && session
        && auth?.currentUser === session.user
        && session.user.uid === user?.uid
        && session.user.emailVerified;
    const fresh = () => snapshot
        && snapshot.identity === identity
        && Math.max(
          performance.now() - snapshot.began,
          Date.now() - snapshot.wall,
        ) < snapshot.budget;
    const status = current() && fresh() ? snapshot?.value : null;
    const saved = pending.current?.identity === identity ? pending.current.request : null;
    async function perform(action: DuesRequest['action'] = 'status', offerId?: string, retry = false) {
        if (!current() || !auth || !functions || !session || inFlight.current) return;
        if (action === 'prepare' && !retry && (!status || !fresh() || !accepted)) return;
        const capture = identity;
        serial.current += 1;
        const generation = serial.current;
        const valid = () => currentIdentity.current === capture
            && serial.current === generation
            && current();
        let request = retry ? saved : { action, accountUid: session.user.uid } as DuesRequest;
        if (action === 'prepare' && !retry) {
            try {
                request = {
                    action: 'prepare',
                    accountUid: session.user.uid,
                    requestId: crypto.randomUUID(),
                    offerId,
                    waiverVersion: status?.waiver.version,
                    waiverAccepted: true
                };
            }
            catch {
                setMessage('Use an up-to-date browser to prepare checkout.');
                return;
            }
        }
        if (!request) return;
        if (request.action === 'prepare') pending.current = { identity: capture, request };
        inFlight.current = true;
        setBusy(true);
        setSnapshot(null);
        setAccepted(false);
        setMessage('');
        try {
            if (request.action !== 'status') {
                const result = parseDuesResult(await callTestDues(functions, auth, request));
                if (!valid()) return;
                pending.current = null;
                if (result.checkoutUrl) {
                    openTestCheckout(result.checkoutUrl);
                    return;
                }
            }
            const began = performance.now();
            const wall = Date.now();
            const value = parseDuesStatus(await callTestDues(functions, auth, {
                action: 'status',
                accountUid: session.user.uid
            }));
            if (!valid()) return;
            const budget = Math.min(
                60000,
                ...value.offers.map((o) => o.endsAtMs - value.observedAtMs),
                ...(value.accessThroughMs ? [value.accessThroughMs - value.observedAtMs] : []),
            );
            if (Math.max(performance.now() - began, Date.now() - wall) >= budget) throw new Error('stale');
            setSnapshot({
                identity: capture, value, began, wall, budget
            });
            setMessage('Current test status loaded.');
        }
        catch {
            if (valid()) {
                setSnapshot(null);
                setMessage('We could not confirm this request. Refresh status or resume the saved purchase. Do not start another payment.');
            }
        }
        finally {
            if (valid()) {
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
            serial.current += 1;
            pending.current = null;
            inFlight.current = false;
            setSnapshot(null);
            setAccepted(false);
            setBusy(false);
            setSession(next ? {
                user: next,
                epoch: Symbol('native-dues')
            } : null);
        });
    }, [enabled, auth]);
    useEffect(() => {
        serial.current += 1;
        pending.current = null;
        inFlight.current = false;
        setSnapshot(null);
        setAccepted(false);
        setBusy(false);
        setMessage('');
        if (current()) perform();
        return () => { serial.current += 1; };
    }, [identity]);
    useEffect(() => {
        if (!snapshot) return undefined;
        let timer: number;
        const expire = () => {
            window.clearTimeout(timer);
            const remaining = snapshot.budget - Math.max(
                performance.now() - snapshot.began,
          Date.now() - snapshot.wall,
            );
            if (remaining <= 0) {
                setSnapshot(null);
                setAccepted(false);
                setMessage('Refresh status before continuing.');
            }
            else timer = window.setTimeout(expire, Math.ceil(remaining));
        };
        expire();
        window.addEventListener('focus', expire);
        document.addEventListener('visibilitychange', expire);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener('focus', expire);
            document.removeEventListener('visibilitychange', expire);
        };
    }, [snapshot]);
    const canBuy = status && !status.active && (!status.order || status.order.state === 'expired');
    let accountMessage = '';
    if (!enabled) accountMessage = 'Test checkout is not connected here yet.';
    else if (isLoading) accountMessage = 'Loading account…';
    else if (user?.uid && !current()) accountMessage = 'Verify your email and sign in again to continue.';
    return (
      <div className="community-staging member-community">
        <SEO title="Test annual dues" noindex />
        <p className="member-community__eyebrow">MID-PENINSULA RUNNING CLUB</p>
        <h1>Test annual dues</h1>
        <p role="note">
          Staging only. Use a fictional account and Stripe test details.
          No real payment or club membership is created.
        </p>
        <div className="member-community__nav" role="navigation" aria-label="Member pages">
          <Link to="/community">Membership and free events</Link>
          {' · '}
          <Link to="/account">My Account</Link>
        </div>
        {accountMessage && <p>{accountMessage}</p>}
        {enabled && !isLoading && !user?.uid && (<Link to="/login" state={{ from: '/community/dues' }}>Sign in to continue</Link>)}
        {current() && (
        <>
          <button type="button" disabled={busy} onClick={() => perform()}>Refresh status</button>
          {saved && (
          <button type="button" disabled={busy} onClick={() => perform('prepare', undefined, true)}>
            Retry saved request
          </button>
)}
          <p role="status" aria-live="polite">{busy ? 'Checking test membership…' : message}</p>
          {status?.active && <p className="member-community__badge">Your test membership is active.</p>}
          {status?.order && (
          <section className="member-community__card">
            <h2>Your saved purchase</h2>
            <p>{`Status: ${status.order.state.replace(/_/g, ' ')}.`}</p>
            <p>{`$${(status.order.amountMinor / 100).toFixed(2)} USD test dues.`}</p>
            <p>{`Calendar-year term ends ${date(status.order.endsAtMs)}, Pacific time.`}</p>
            {status.order.familyId && (
            <p>
              {`Family ID: ${status.order.familyId}. `}
              Invitations for other accounts are not available yet.
              An ID alone does not grant membership.
            </p>
)}
            {['prepared', 'open'].includes(status.order.state) && (
            <button type="button" disabled={busy} onClick={() => perform('resume')}>
              Resume saved checkout
            </button>
)}
            {['open', 'prepared', 'paid_pending_activation'].includes(status.order.state) && (
            <button type="button" disabled={busy} onClick={() => perform('reconcile')}>
              Check payment status
            </button>
)}
            {['held', 'paid_pending_activation'].includes(status.order.state) && (
            <p>
              Ask the test owner to reconcile this purchase.
              Keep the saved order; do not pay again.
            </p>
)}
          </section>
)}
          {canBuy && status && (
          <>
            <details open>
              <summary>Read the test waiver</summary>
              <p>{status.waiver.text}</p>
            </details>
            <label htmlFor="test-dues-consent">
              <input id="test-dues-consent" type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              {' I accept the displayed synthetic test waiver.'}
            </label>
            <div className="member-community__grid">
              {status.offers.map((o) => {
                    const kind = o.planRef.includes('-family-') ? 'family' : 'individual';
                    return (
                      <section className="member-community__card" key={o.planRef}>
                        <h2>{kind === 'family' ? 'Family' : 'Individual'}</h2>
                        <p>{`$${(o.amountMinor / 100).toFixed(2)} USD per calendar year.`}</p>
                        <p>{`Ends ${date(o.endsAtMs)}, Pacific time. No automatic renewal.`}</p>
                        <button type="button" disabled={busy || !!saved || !accepted || !o.offerable} onClick={() => perform('prepare', o.planRef)}>
                          {`Continue to ${kind} test checkout`}
                        </button>
                      </section>
                    );
                })}
            </div>
          </>
)}
        </>
)}
      </div>
    );
}
