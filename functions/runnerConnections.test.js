'use strict';

const {
  normalizePace,
  readRunnerProfile,
  rankRunnerConnections,
} = require('./runnerConnections');

const { profile, runner } = require('./testSupport/runnerConnectionsFixtures');

describe('runner profile boundary', () => {
  test('normalizes equivalent metric and imperial easy pace', () => {
    expect(normalizePace({ unit: 'min/km', fastSeconds: 300, slowSeconds: 360 }))
      .toEqual({ fastSecondsPerKm: 300, slowSecondsPerKm: 360, preferredUnit: 'min/km' });
    expect(normalizePace({ unit: 'min/mile', fastSeconds: 483, slowSeconds: 579 }))
      .toEqual({ fastSecondsPerKm: 300, slowSecondsPerKm: 360, preferredUnit: 'min/mile' });
  });

  test.each([
    { unit: 'mph', fastSeconds: 300, slowSeconds: 400 },
    { unit: 'min/km', fastSeconds: NaN, slowSeconds: 400 },
    { unit: 'min/km', fastSeconds: 300, slowSeconds: Infinity },
    { unit: 'min/km', fastSeconds: '300', slowSeconds: 400 },
    { unit: 'min/km', fastSeconds: 300.5, slowSeconds: 400 },
    { unit: 'min/km', fastSeconds: 420, slowSeconds: 300 },
    { unit: 'min/km', fastSeconds: 0, slowSeconds: 400 },
    { unit: 'min/km', fastSeconds: 300, slowSeconds: 1801 },
    { unit: 'min/mile', fastSeconds: 60, slowSeconds: 100 },
    { unit: 'min/km', fastSeconds: 300, slowSeconds: 400, extra: true },
  ])('rejects invalid pace case %# with a fixed message', (pace) => {
    expect(() => normalizePace(pace)).toThrow('Runner connection input is invalid.');
  });

  test.each([
    { displayName: '' },
    { displayName: 'a'.repeat(61) },
    { displayName: 'Synthetic\nRunner' },
    { goals: [] },
    { goals: ['unknown_goal'] },
    { goals: ['consistency', 'consistency'] },
    { areas: [] },
    { distance: { minMetres: 10000, maxMetres: 4000 } },
    { availability: [{ day: 7, startMinute: 480, endMinute: 600 }] },
    { availability: [{ day: 6, startMinute: 600, endMinute: 480 }] },
    { availability: Array(8).fill({ day: 6, startMinute: 480, endMinute: 600 }) },
    { experiencePreferences: [] },
    { email: 'synthetic@example.test' },
    { demographics: { ageBand: 'synthetic' } },
    { searchableByOfficers: true },
  ])('rejects invalid or unapproved profile field case %#', (overrides) => {
    expect(() => readRunnerProfile(profile(overrides))).toThrow('Runner connection input is invalid.');
  });

  test('does not execute accessors or proxies', () => {
    const getter = jest.fn(() => 'Synthetic');
    const input = profile();
    Object.defineProperty(input, 'displayName', { enumerable: true, get: getter });
    expect(() => readRunnerProfile(input)).toThrow('Runner connection input is invalid.');
    expect(getter).not.toHaveBeenCalled();
    const trap = jest.fn(() => { throw new Error('private canary'); });
    expect(() => readRunnerProfile(new Proxy({}, { ownKeys: trap }))).toThrow('Runner connection input is invalid.');
    expect(trap).not.toHaveBeenCalled();
  });
});

describe('bounded deterministic runner recommendations (not authorization)', () => {
  test('ranks compatible goals first, preserves inputs and returns only card fields', () => {
    const viewer = runner(0);
    const candidates = [runner(2, { profile: profile({ goals: ['social'] }) }), runner(1)];
    const before = JSON.stringify(candidates);
    const result = rankRunnerConnections(viewer, candidates);
    expect(result.rankerVersion).toBe(1);
    expect(result.similar.map((card) => card.entryRef)).toEqual([runner(1).entryRef, runner(2).entryRef]);
    expect(result.similar[0].reasons).toContain('shared_goals');
    expect(Object.keys(result.similar[0]).sort()).toEqual([
      'entryRef', 'displayName', 'pace', 'distance', 'availability', 'areas',
      'terrains', 'styles', 'goals', 'experience', 'interests', 'reasons',
    ].sort());
    expect(JSON.stringify(result)).not.toMatch(/memberEligible|adultEligible|pairExcluded|experiencePreferences|consent/);
    expect(JSON.stringify(candidates)).toBe(before);
    expect(Object.isFrozen(result.similar[0].pace)).toBe(true);
  });

  test.each([
    { pace: { unit: 'min/km', fastSeconds: 421, slowSeconds: 500 } },
    { distance: { minMetres: 11000, maxMetres: 15000 } },
    { availability: [{ day: 6, startMinute: 660, endMinute: 700 }] },
    { availability: [{ day: 5, startMinute: 480, endMinute: 660 }] },
    { areas: ['redwood_city'] },
    { terrains: ['trail'] },
    { styles: ['walk'] },
    { experiencePreferences: ['experienced'] },
  ])('excludes hard incompatibility case %# even with broadening', (overrides) => {
    const consent = { memberDiscovery: true, similarity: true, broadenCircle: true };
    const result = rankRunnerConnections(runner(0, { consent }), [runner(1, { consent, profile: profile(overrides) })]);
    expect(result.similar).toEqual([]);
    expect(result.broaden).toEqual([]);
  });

  test('excludes a shared time window too short for the shared run distance', () => {
    const candidate = runner(1, { profile: profile({ availability: [{ day: 6, startMinute: 480, endMinute: 490 }] }) });
    expect(rankRunnerConnections(runner(0), [candidate]).similar).toEqual([]);
  });

  test('requires reciprocal experience preference', () => {
    const viewer = runner(0, { profile: profile({ experiencePreferences: ['beginner'] }) });
    const candidate = runner(1, { profile: profile({ experience: 'experienced' }) });
    expect(rankRunnerConnections(viewer, [candidate]).similar).toEqual([]);
  });

  test.each([
    { memberEligible: false },
    { adultEligible: false },
    { pairExcluded: true },
    { consent: { memberDiscovery: false, similarity: false, broadenCircle: false } },
    { consent: { searchableByOfficers: true } },
    { consent: { memberDiscovery: true, similarity: false, broadenCircle: false } },
  ])('does not deliver excluded/withdrawn candidate case %#', (overrides) => {
    expect(rankRunnerConnections(runner(0), [runner(1, overrides)]).similar).toEqual([]);
  });

  test('loss of viewer eligibility also clears all results', () => {
    const result = rankRunnerConnections(runner(0, { memberEligible: false }), [runner(1)]);
    expect(result.similar).toEqual([]);
    expect(result.broaden).toEqual([]);
  });

  test('both parties must opt into broadening; one different card never duplicates an ordinary card', () => {
    const consent = { memberDiscovery: true, similarity: true, broadenCircle: true };
    const candidates = [runner(1), runner(2, { consent, profile: profile({ experience: 'experienced', goals: ['marathon'] }) })];
    const result = rankRunnerConnections(runner(0, { consent }), candidates);
    expect(result.broaden.map((card) => card.entryRef)).toEqual([runner(2).entryRef]);
    expect(result.broaden[0].reasons).toContain('different_experience');
    expect(result.similar.map((card) => card.entryRef)).toEqual([runner(1).entryRef]);
    expect(rankRunnerConnections(runner(0), candidates).broaden).toEqual([]);
    expect(rankRunnerConnections(runner(0, { consent }), [runner(2)]).broaden).toEqual([]);
  });

  test('empty optional interests do not create an inferred difference', () => {
    const consent = { memberDiscovery: true, similarity: true, broadenCircle: true };
    const candidate = runner(1, { consent, profile: profile({ interests: [] }) });
    const result = rankRunnerConnections(runner(0, { consent }), [candidate]);
    expect(result.broaden).toEqual([]);
    expect(result.similar).toHaveLength(1);
    expect(result.similar[0].reasons).not.toContain('different_interests');
  });

  test('stable order, bounded output and no manufactured sparse-pool cards', () => {
    const candidates = Array.from({ length: 20 }, (_, index) => runner(index + 1));
    const first = rankRunnerConnections(runner(0), candidates);
    expect(rankRunnerConnections(runner(0), [...candidates].reverse())).toEqual(first);
    expect(first.similar).toHaveLength(4);
    expect(first.broaden).toHaveLength(0);
    expect(rankRunnerConnections(runner(0), [runner(1)]).similar).toHaveLength(1);
    expect(rankRunnerConnections(runner(0), []).similar).toEqual([]);
  });

  test('duplicate candidate identities fail closed rather than filling multiple slots', () => {
    expect(() => rankRunnerConnections(runner(0), [runner(1), runner(1)])).toThrow('Runner connection input is invalid.');
  });

  test('rejects oversized candidate windows; excludes self and malformed stored profiles', () => {
    expect(() => rankRunnerConnections(runner(0), Array.from({ length: 49 }, (_, index) => runner(index + 1))))
      .toThrow('Runner connection input is invalid.');
    expect(rankRunnerConnections(runner(0), [runner(0), runner(1, { profile: profile({ email: 'synthetic@example.test' }) })]).similar).toEqual([]);
  });
});
