// Test-only browser entry. Never imported by src or a hosted build.
import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  initializeAuth, inMemoryPersistence, connectAuthEmulator,
  signInWithEmailAndPassword, signOut,
} from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { initializeAppCheck, CustomProvider } from 'firebase/app-check';
import { RunnerWorkspace } from '../../src/pages/account/RunnerConnections';
import { createRunnerClient } from '../../src/services/account/runnerConnectionService';

if (window.location.origin !== 'http://127.0.0.1:9619') {
  throw new Error('Synthetic rehearsal requires the exact loopback origin.');
}
const app = initializeApp({
  projectId: 'demo-runner-http-test', apiKey: 'synthetic-local-api-key', appId: 'synthetic-browser-app',
}, 'synthetic-runner-browser');
const auth = initializeAuth(app, { persistence: inMemoryPersistence });
connectAuthEmulator(auth, 'http://127.0.0.1:9919', { disableWarnings: true });
connectFunctionsEmulator(getFunctions(app), '127.0.0.1', 9519);
initializeAppCheck(app, {
  provider: new CustomProvider({ getToken: async () => {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, '')
      .replace(/\+/g, '-').replace(/\//g, '_');
    // Emulator decoder only: deliberately not signed, attested or hosted proof.
    return {
      token: `${encode({ alg: 'none' })}.${encode({ sub: 'synthetic-browser-app', iat: now, exp: now + 3600 })}.`,
      expireTimeMillis: Date.now() + 3600000,
    };
  } }),
  isTokenAutoRefreshEnabled: false,
});

type Fixture = { actors: { owner: string; partner: string; outsider: string }; password: string };
function Workspace({ uid }: { uid: string }) {
  const client = useMemo(() => createRunnerClient(app, uid), [uid]);
  return <RunnerWorkspace client={client} />;
}
function Rehearsal({ fixture }: { fixture: Fixture }) {
  const [uid, setUid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('No synthetic account selected.');
  async function select(actor: keyof Fixture['actors']) {
    setBusy(true);
    setUid(null);
    try {
      await signOut(auth);
      const result = await signInWithEmailAndPassword(
        auth, `${fixture.actors[actor]}@example.test`, fixture.password,
      );
      setUid(result.user.uid);
      setMessage(`Synthetic ${actor} signed in through local Auth.`);
    } catch { setMessage('Synthetic sign-in failed.'); }
    finally { setBusy(false); }
  }
  async function finish() {
    setBusy(true);
    setUid(null);
    try {
      await signOut(auth);
      await deleteApp(app);
      const response = await fetch('/finish', { method: 'POST' });
      if (!response.ok) throw new Error();
      setMessage('Rehearsal finished; synthetic records and accounts removed. Close this tab.');
    } catch { setMessage('Cleanup not confirmed. Ask the maintainer to inspect the local process.'); }
  }
  return <main className="runner-connections">
    <h1>Synthetic runner backend rehearsal</h1>
    <p>LOCAL TEST ONLY. Made-up accounts and records. Real member UI and callable client;
      loopback Auth, Functions and Firestore. No hosted token-signature proof.</p>
    <div className="runner-actions">
      {(['owner', 'partner', 'outsider'] as const).map((actor) => <button key={actor}
        type="button" disabled={busy} onClick={() => select(actor)}>Use synthetic {actor}</button>)}
      <button type="button" disabled={busy} onClick={finish}>End rehearsal and clean up</button>
    </div>
    <p role="status">{message}</p>
    {uid && <Workspace key={uid} uid={uid} />}
  </main>;
}
fetch('/fixture.json', { cache: 'no-store' }).then(async (response) => {
  if (!response.ok) throw new Error();
  const fixture = await response.json() as Fixture;
  createRoot(document.getElementById('root')!).render(<Rehearsal fixture={fixture} />);
}).catch(() => {
  document.getElementById('root')!.textContent = 'Synthetic fixture unavailable.';
});
