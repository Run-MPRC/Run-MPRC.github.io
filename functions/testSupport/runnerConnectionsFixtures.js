'use strict';

// Fictional structured profiles only. Never replace these with member records.
function profile(overrides = {}) {
  return {
    displayName: 'Synthetic Runner',
    pace: { unit: 'min/km', fastSeconds: 300, slowSeconds: 420 },
    distance: { minMetres: 4000, maxMetres: 10000 },
    availability: [{ day: 6, startMinute: 480, endMinute: 660 }],
    areas: ['bay_trail'],
    terrains: ['road'],
    styles: ['continuous', 'run_walk'],
    goals: ['consistency', 'first_10k'],
    experience: 'beginner',
    experiencePreferences: ['beginner', 'returning', 'regular', 'experienced'],
    interests: ['coffee'],
    ...overrides,
  };
}

function runner(index, overrides = {}) {
  return {
    entryRef: `runner_${index.toString(16).padStart(64, '0')}`,
    memberEligible: true,
    adultEligible: true,
    pairExcluded: false,
    consent: { memberDiscovery: true, similarity: true, broadenCircle: false },
    profile: profile(),
    ...overrides,
  };
}

module.exports = { profile, runner };
