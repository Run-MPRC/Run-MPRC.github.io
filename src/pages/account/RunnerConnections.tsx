import React, {
  useCallback, useEffect, useMemo, useRef, useState
} from 'react';
import { FirebaseApp } from 'firebase/app';
import { Link, Navigate } from 'react-router-dom';
import SEO from '../../components/SEO';
import { useAuth } from '../../services/hooks/useAuth';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import {
  createRunnerClient,
  createRunnerRequestId,
  definitiveRejection,
  RUNNER_CONNECTIONS_AVAILABLE,
  RunnerClient,
} from '../../services/account/runnerConnectionService';
import {
  Consent,
  Exclusion,
  ProfileState,
  Recommendations,
  RunnerProfile,
} from '../../services/account/runnerConnectionContract';
import RunnerCard from './RunnerCard';
import RunnerProfileForm from './RunnerProfileForm';
import './RunnerConnections.css';

type Change = {
  run: () => Promise<ProfileState | Exclusion>;
  accept: (result: ProfileState | Exclusion) => void;
};
type RecentChoice = { entryRef: string; name: string; state: Exclusion };
function choiceLabel(state: Exclusion): string {
  if (state.blocked) return 'blocked';
  return state.hidden ? 'hidden' : 'your choice cleared';
}

// Exported for synthetic UI tests only; the application always uses the
// source-gated route below. No query-string, local-storage or environment switch.
export function RunnerWorkspace({ client }: { client: RunnerClient }) {
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [results, setResults] = useState<Recommendations | null>(null);
  const [recent, setRecent] = useState<RecentChoice[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'busy' | 'unavailable' | 'unknown'>(
    'loading',
  );
  const [message, setMessage] = useState('');
  const [unknown, setUnknown] = useState<Change | null>(null);
  const generation = useRef(0);
  const recommendationGeneration = useRef(0);
  const locked = useRef(false);
  const status = useRef<HTMLParagraphElement>(null);

  const load = useCallback(async () => {
    generation.current += 1;
    const attempt = generation.current;
    locked.current = true;
    setProfile(null);
    setResults(null);
    setRecent([]);
    setMessage('');
    setPhase('loading');
    try {
      const state = await client.read();
      if (generation.current !== attempt) return;
      setProfile(state);
      setPhase('ready');
    } catch {
      if (generation.current === attempt) setPhase('unavailable');
    } finally {
      if (generation.current === attempt) locked.current = false;
    }
  }, [client]);

  useEffect(() => {
    load();
    return () => {
      generation.current += 1;
      locked.current = true;
    };
  }, [load]);
  useEffect(() => {
    if (message) status.current?.focus();
  }, [message]);
  useEffect(() => {
    const clear = () => {
      recommendationGeneration.current += 1;
      setResults(null);
    };
    const hide = () => {
      if (document.visibilityState === 'hidden') clear();
    };
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', hide);
    const timer = results
      ? window.setTimeout(
        clear,
        Math.max(0, Math.min(results.windowEndsAtMs - Date.now(), 86400000)),
      )
      : undefined;
    return () => {
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', hide);
      window.clearTimeout(timer);
    };
  }, [results]);

  async function apply(change: Change) {
    if (locked.current) return;
    locked.current = true;
    const attempt = generation.current;
    setResults(null);
    setMessage('');
    setPhase('busy');
    try {
      const result = await change.run();
      if (generation.current !== attempt) return;
      change.accept(result);
      setUnknown(null);
      setPhase('ready');
    } catch (failure) {
      if (generation.current !== attempt) return;
      if (definitiveRejection(failure)) {
        setUnknown(null);
        setProfile(null);
        setRecent([]);
        setPhase('unavailable');
        setMessage(
          'That change could not be applied or confirmed. Reload the current settings before trying another change.',
        );
      } else {
        setUnknown(change);
        setPhase('unknown');
        setMessage(
          'We could not confirm whether that change was saved. Do not submit a different change. Retry the same request to recover its result.',
        );
      }
    } finally {
      if (generation.current === attempt) locked.current = false;
    }
  }
  const save = (card: RunnerProfile, consent: Consent) => {
    if (!profile || locked.current) return;
    try {
      const request = {
        requestId: createRunnerRequestId(),
        expectedRevision: profile.revision,
        profile: card,
        consent,
        adultConfirmed: true as const,
        consentVersion: 1 as const,
      };
      apply({
        run: () => client.save(request),
        accept: (result) => {
          const saved = result as ProfileState;
          setProfile(saved);
          setMessage(
            saved.consent.memberDiscovery
              ? 'Your runner card was saved with discovery on.'
              : 'Your runner card was saved privately. Discovery is off.',
          );
        },
      });
    } catch {
      setMessage('This browser could not safely start a change. Nothing was sent.');
    }
  };
  function withdraw() {
    if (!profile || locked.current) return;
    try {
      const request = {
        requestId: createRunnerRequestId(),
        expectedRevision: profile.revision,
      };
      apply({
        run: () => client.withdraw(request),
        accept: (result) => {
          setProfile(result as ProfileState);
          setRecent([]);
          setMessage(
            'Your card and sharing choices were removed. Returning requires a new 18+ confirmation. Private safety receipts are retained pending the approved retention process; this is not account deletion.',
          );
        },
      });
    } catch {
      setMessage('This browser could not safely start a change. Nothing was sent.');
    }
  }
  async function recommendations() {
    if (locked.current) return;
    locked.current = true;
    const attempt = generation.current;
    recommendationGeneration.current += 1;
    const recommendationAttempt = recommendationGeneration.current;
    setResults(null);
    setMessage('');
    setPhase('busy');
    try {
      const response = await client.recommend();
      if (generation.current !== attempt) return;
      if (recommendationGeneration.current === recommendationAttempt) setResults(response);
      setPhase('ready');
    } catch {
      if (generation.current === attempt) {
        setPhase('ready');
        setMessage(
          'Suggestions are unavailable. Current membership, a verified account and request limits are checked by the server. No cached or example runners are shown.',
        );
      }
    } finally {
      if (generation.current === attempt) locked.current = false;
    }
  }
  async function exclusion(entryRef: string, name: string, action: 'hide' | 'block' | 'undo') {
    if (locked.current) return;
    locked.current = true;
    const attempt = generation.current;
    setResults(null);
    setMessage('');
    setPhase('busy');
    let state: Exclusion;
    let requestId: string;
    try {
      state = await client.exclusion(entryRef);
      requestId = createRunnerRequestId();
    } catch {
      if (generation.current === attempt) {
        locked.current = false;
        setPhase('ready');
        setMessage(
          'The privacy change could not be started. No change was submitted. Try again later.',
        );
      }
      return;
    }
    if (generation.current !== attempt) return;
    locked.current = false;
    const request = {
      requestId,
      expectedRevision: state.revision,
      entryRef,
      hidden: action === 'hide' || (action === 'block' && state.hidden),
      blocked: action === 'block' || (action === 'hide' && state.blocked),
    };
    await apply({
      run: () => client.exclude(request),
      accept: (result) => {
        setRecent((previous) => [
          { entryRef, name, state: result as Exclusion },
          ...previous.filter((item) => item.entryRef !== entryRef),
        ].slice(0, 5),);
        setMessage(
          action === 'undo'
            ? 'Your own privacy choice was cleared. Another person’s block, if any, is unchanged.'
            : 'Your privacy choice was saved. Refreshing will not replace removed suggestions today.',
        );
      },
    });
  }

  return (
    <>
      {message && (
        <p className="runner-notice" ref={status} tabIndex={-1} role="status">
          {message}
        </p>
      )}
      {phase === 'loading' && <p role="status">Loading your runner settings…</p>}
      {phase === 'busy' && <p role="status">Checking with the server…</p>}
      {phase === 'unavailable' && (
        <div role="alert">
          <p>
            Runner settings are unavailable. Nothing here establishes current club membership.
            You can still find public club runs.
          </p>
          <button type="button" onClick={load}>
            Reload runner settings
          </button>
        </div>
      )}
      {phase === 'unknown' && unknown && (
        <button type="button" onClick={() => apply(unknown)}>
          Retry the same change
        </button>
      )}
      {profile && (
        <>
          <RunnerProfileForm
            key={profile.revision}
            initial={profile}
            disabled={phase !== 'ready'}
            onSave={save}
          />
          {profile.profile && (
            <section>
              <h2>Leave runner discovery</h2>
              <p>
                Remove your card, sharing choices and age confirmation. This does not delete
                your account or change dues.
              </p>
              <button type="button" disabled={phase !== 'ready'} onClick={withdraw}>
                Remove my runner card
              </button>
            </section>
          )}
          <section aria-labelledby="runner-suggestions-heading">
            <h2 id="runner-suggestions-heading">Today’s running suggestions</h2>
            <p>
              At most four ordinary suggestions and one opted-in broadening suggestion each
              day. Refreshing, editing or hiding will not reveal more people that day. A
              suggestion does not confirm attendance. Meet at a public club run; private
              introductions and messaging are not available here.
            </p>
            <button
              type="button"
              disabled={phase !== 'ready' || !profile.consent.memberDiscovery}
              onClick={recommendations}
            >
              Check today’s suggestions
            </button>
            {!profile.consent.memberDiscovery && (
              <p>Save your card with discovery on to request suggestions.</p>
            )}
            {results?.status === 'profile_required' && (
              <p>Your shared profile is no longer available. Reload settings to check it.</p>
            )}
            {results?.status === 'ready'
              && results.similar.length + results.broaden.length === 0 && (
                <p role="status">
                  No matches in today’s selection. This is a limited sample, not a search of
                  every club member. Try another day or join a public club run.
                </p>
              )}
            {results
              && [
                { title: 'Similar runners', items: results.similar },
                { title: 'Broaden your circle', items: results.broaden },
              ].map(
                (group) => group.items.length > 0 && (
                  <section key={group.title}>
                    <h3>{group.title}</h3>
                    {group.items.map((card) => (
                      <article key={card.entryRef}>
                        <RunnerCard card={card} />
                        <div className="runner-actions">
                          <button
                            type="button"
                            onClick={() => exclusion(card.entryRef, card.displayName, 'hide')}
                          >
                            {`Hide ${card.displayName}`}
                          </button>
                          <button
                            type="button"
                            onClick={() => exclusion(card.entryRef, card.displayName, 'block')}
                          >
                            {`Block ${card.displayName}`}
                          </button>
                        </div>
                      </article>
                    ))}
                  </section>
                ),
              )}
          </section>
          {recent.length > 0 && (
            <section>
              <h2>Privacy choices from this visit</h2>
              <p>
                Hide affects your results. Block excludes the pair in both directions. Undo
                changes only your choice. Full history management is not available yet.
              </p>
              {recent.map((item) => (
                <div key={item.entryRef}>
                  <p>
                    {item.name}
                    :
                    {' '}
                    {choiceLabel(item.state)}
                  </p>
                  {(item.state.hidden || item.state.blocked) && (
                    <button
                      type="button"
                      disabled={phase !== 'ready'}
                      onClick={() => exclusion(item.entryRef, item.name, 'undo')}
                    >
                      {`Undo my choice for ${item.name}`}
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </>
  );
}
const appIds = new WeakMap<FirebaseApp, number>();
let nextAppId = 1;
function appKey(app: FirebaseApp): number {
  if (!appIds.has(app)) {
    appIds.set(app, nextAppId);
    nextAppId += 1;
  }
  return appIds.get(app) as number;
}
function Session({ app, uid }: { app: FirebaseApp; uid: string }) {
  const client = useMemo(() => createRunnerClient(app, uid), [app, uid]);
  return <RunnerWorkspace client={client} />;
}
function ConnectedRoute() {
  const { user, isLoading } = useAuth();
  const { services, isReady } = useServiceLocator();
  if (isLoading) return <p role="status">Checking your account…</p>;
  if (!user) return <Navigate to="/login" state={{ from: '/account/running-partners' }} replace />;
  if (!isReady || !services) return <p role="alert">Runner connections are unavailable.</p>;
  const { app } = services.firebaseResources;
  return <Session key={`${appKey(app)}:${user.uid}`} app={app} uid={user.uid} />;
}
export default function RunnerConnections() {
  return (
    <div className="runner-connections">
      <SEO title="Find running partners" noindex />
      <h1>Find running partners</h1>
      <p>
        Choose a separate runner card to meet compatible adult club members. Nothing is copied
        from your account or the officer finder.
      </p>
      <nav aria-label="Runner connection links">
        <Link to="/account">My account</Link>
        <Link to="/activities">Public club runs</Link>
        <Link to="/contact">Contact the club</Link>
      </nav>
      {RUNNER_CONNECTIONS_AVAILABLE ? (
        <ConnectedRoute />
      ) : (
        <p role="status">
          Not available yet. Runner cards, suggestions and privacy controls are not connected
          on this website. No runner information is loaded or saved from this page.
        </p>
      )}
    </div>
  );
}
