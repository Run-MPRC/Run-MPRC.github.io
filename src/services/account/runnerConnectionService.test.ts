import { getAuth } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  createRunnerClient,
  definitiveRejection,
  RUNNER_CONNECTIONS_AVAILABLE,
} from './runnerConnectionService';
import {
  previewCard,
  readConsent,
  readExclusion,
  readProfile,
  readProfileState,
  readRecommendations,
} from './runnerConnectionContract';

// Test-only server imports bind the browser contract to the actual pure ranker.
// Nothing from functions/ is included in the browser's runtime import graph.
const {
  profile,
  runner,
} = require('../../../functions/testSupport/runnerConnectionsFixtures');
const {
  normalizePace,
  readRunnerProfileInput,
  rankRunnerConnections,
} = require('../../../functions/runnerConnections');

jest.mock('firebase/auth', () => ({ getAuth: jest.fn() }));
jest.mock('firebase/functions', () => ({ getFunctions: jest.fn(), httpsCallable: jest.fn() }));
const UID = 'synthetic-browser-runner';
const app = { name: 'synthetic-app' } as any;
const authState = { currentUser: { uid: UID } as { uid: string } | null };
const invoke = jest.fn();
const consent = { memberDiscovery: true, similarity: true, broadenCircle: true };
const input = () => ({
  requestId: '00000000-0000-4000-8000-000000000001',
  expectedRevision: 0,
  profile: profile(),
  consent,
  adultConfirmed: true as const,
  consentVersion: 1 as const,
});
const state = () => ({
  schemaVersion: 1,
  consentVersion: 1,
  revision: 1,
  adultConfirmed: true,
  profile: readProfile(profile()),
  consent,
});
const result = () => ({
  ...rankRunnerConnections(runner(1, { consent }), [runner(2, { consent })]),
  status: 'ready',
  windowEndsAtMs: Date.now() + 3600000,
});

beforeEach(() => {
  jest.clearAllMocks();
  authState.currentUser = { uid: UID };
  (getAuth as jest.Mock).mockReturnValue(authState);
  (getFunctions as jest.Mock).mockReturnValue({ synthetic: true });
  (httpsCallable as jest.Mock).mockReturnValue(invoke);
});

test('capability is literally disabled, not enabled from a caller or environment value', () => {
  expect(RUNNER_CONNECTIONS_AVAILABLE).toBe(false);
});
test('browser profile normalization and preview match the actual server projection', () => {
  ['min/km', 'min/mile'].forEach((unit) => {
    for (let seconds = 120; seconds <= 3000; seconds += 1) {
      const value = profile({ pace: { unit, fastSeconds: seconds, slowSeconds: seconds } });
      let canonical;
      try {
        canonical = readRunnerProfileInput(value);
      } catch {
        canonical = null;
      }
      if (canonical) {
        expect(readProfile(value)).toEqual(canonical);
        expect(previewCard(value).pace).toEqual(normalizePace(value.pace));
      } else {
        expect(() => readProfile(value)).toThrow();
      }
    }
  });
  const wire = result();
  expect(readRecommendations(wire).similar[0]).toEqual({
    ...wire.similar[0],
    reasons: [...wire.similar[0].reasons].sort(),
  });
  const { entryRef, reasons, ...publicCard } = wire.similar[0];
  expect(previewCard(profile())).toEqual(publicCard);
  expect(previewCard(profile())).not.toHaveProperty('experiencePreferences');
});
test.each([
  { displayName: '' },
  { displayName: 'x'.repeat(61) },
  { displayName: 'Synthetic\u200b' },
  { email: 'synthetic@example.test' },
  { experience: 'coach' },
  { areas: [] },
  { areas: ['bay_trail', 'bay_trail'] },
  { interests: ['unknown'] },
  { distance: { minMetres: 500, maxMetres: 499 } },
  {
    availability: [
      { day: 6, startMinute: 480, endMinute: 660 },
      { day: 6, startMinute: 500, endMinute: 700 },
    ],
  },
  { pace: { unit: 'min/mile', fastSeconds: NaN, slowSeconds: 600 } },
])('malformed profile case %# is rejected on both boundaries', (overrides) => {
  expect(() => readProfile(profile(overrides))).toThrow();
  expect(() => readRunnerProfileInput(profile(overrides))).toThrow();
});
test('consent, age and missing-profile invariants fail closed', () => {
  expect(() => readConsent({ ...consent, memberDiscovery: false })).toThrow();
  expect(() => readProfileState({ ...state(), adultConfirmed: false })).toThrow();
  expect(() => readProfileState({ ...state(), profile: null })).toThrow();
  expect(() => readProfileState({ ...state(), revision: -0 })).toThrow();
  expect(() => readExclusion({ revision: 1, hidden: 'true', blocked: false })).toThrow();
});
test('oversized, duplicate or private recommendation data never reaches rendering', () => {
  const valid = result();
  [
    { ...valid, uid: UID },
    { ...valid, similar: Array(5).fill(valid.similar[0]) },
    { ...valid, broaden: [valid.similar[0]] },
    { ...valid, status: 'profile_required' },
    { ...valid, similar: [{ ...valid.similar[0], email: 'synthetic@example.test' }] },
    { ...valid, similar: [{ ...valid.similar[0], reasons: ['verified_identity'] }] },
  ].forEach((bad) => expect(() => readRecommendations(bad)).toThrow());
});
test('hostile response getters are not invoked or forwarded', () => {
  const getter = jest.fn(() => 'synthetic-private');
  const bad = state();
  Object.defineProperty(bad, 'profile', { enumerable: true, get: getter });
  expect(() => readProfileState(bad)).toThrow('Runner connection data is unavailable.');
  expect(getter).not.toHaveBeenCalled();
});
test('service calls the exact scoped endpoint and snapshots a save before awaiting', async () => {
  const request = input();
  let resolve!: (data: unknown) => void;
  invoke.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const pending = createRunnerClient(app, UID).save(request);
  request.profile.displayName = 'Later synthetic name';
  expect(httpsCallable).toHaveBeenCalledWith(
    { synthetic: true },
    'saveMyRunnerConnectionProfile',
  );
  expect(invoke.mock.calls[0][0]).toEqual({ ...input(), profile: readProfile(profile()) });
  resolve({ data: state() });
  await expect(pending).resolves.toEqual(state());
});
test('missing 18+ or forged authority/target is rejected before SDK work', () => {
  const client = createRunnerClient(app, UID);
  expect(() => client.save({ ...input(), adultConfirmed: false } as any)).toThrow();
  expect(() => client.save({ ...input(), uid: 'other' } as any)).toThrow();
  expect(() => client.withdraw({ requestId: input().requestId, expectedRevision: -1 }),).toThrow();
  expect(httpsCallable).not.toHaveBeenCalled();
});
test('account changes reject before sending and discard a result after await', async () => {
  const client = createRunnerClient(app, UID);
  authState.currentUser = null;
  await expect(client.read()).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
  authState.currentUser = { uid: UID };
  invoke.mockImplementation(async () => {
    authState.currentUser = { uid: 'synthetic-other' };
    return { data: state() };
  });
  await expect(client.read()).rejects.toThrow();
});
test('mismatched mutation responses are unknown outcomes, not successful saves', async () => {
  const client = createRunnerClient(app, UID);
  invoke.mockResolvedValue({ data: { ...state(), revision: 9 } });
  await expect(client.save(input())).rejects.toThrow();
  invoke.mockResolvedValue({ data: state() });
  await expect(
    client.withdraw({ requestId: input().requestId, expectedRevision: 0 }),
  ).rejects.toThrow();
  invoke.mockResolvedValue({ data: { revision: 1, hidden: false, blocked: false } });
  await expect(
    client.exclude({
      requestId: input().requestId,
      expectedRevision: 0,
      entryRef: `runner_${'a'.repeat(64)}`,
      hidden: true,
      blocked: false,
    }),
  ).rejects.toThrow();
});
test('all six client operations use their existing exact callable contracts', async () => {
  const client = createRunnerClient(app, UID);
  invoke.mockResolvedValueOnce({ data: state() });
  await client.read();
  invoke.mockResolvedValueOnce({ data: result() });
  await client.recommend();
  invoke.mockResolvedValueOnce({ data: state() });
  await client.save(input());
  invoke.mockResolvedValueOnce({
    data: {
      ...state(),
      profile: null,
      adultConfirmed: false,
      consent: { memberDiscovery: false, similarity: false, broadenCircle: false },
    },
  });
  await client.withdraw({ requestId: input().requestId, expectedRevision: 0 });
  const ref = `runner_${'a'.repeat(64)}`;
  invoke.mockResolvedValueOnce({ data: { revision: 0, hidden: false, blocked: false } });
  await client.exclusion(ref);
  invoke.mockResolvedValueOnce({ data: { revision: 1, hidden: true, blocked: false } });
  await client.exclude({
    requestId: input().requestId,
    expectedRevision: 0,
    entryRef: ref,
    hidden: true,
    blocked: false,
  });
  expect((httpsCallable as jest.Mock).mock.calls.map((call) => call[1])).toEqual([
    'getMyRunnerConnectionProfile',
    'getMyRunnerConnectionRecommendations',
    'saveMyRunnerConnectionProfile',
    'withdrawMyRunnerConnectionProfile',
    'getMyRunnerConnectionExclusion',
    'setMyRunnerConnectionExclusion',
  ]);
});
test('error classification reads only a safe code, never raw messages or hostile getters', () => {
  expect(definitiveRejection({ code: 'functions/aborted' })).toBe(true);
  expect(definitiveRejection({ code: 'functions/unavailable' })).toBe(false);
  const getter = jest.fn();
  expect(definitiveRejection(Object.defineProperty({}, 'code', { get: getter }))).toBe(false);
  expect(getter).not.toHaveBeenCalled();
});
