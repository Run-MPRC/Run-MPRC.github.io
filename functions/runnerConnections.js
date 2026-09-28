'use strict';

// Domain logic only: this module cannot authenticate a caller or authorize a
// response. The future server adapter must load and recheck current membership,
// adult eligibility, consent and reciprocal exclusions before delivering cards.
// Nothing here reads the roster, writes Firestore or exports a Cloud Function.
const { types: { isProxy } } = require('node:util');

const RANKER_VERSION = 1;
const MAX_CANDIDATES = 48;
const EXPERIENCES = Object.freeze(['beginner', 'returning', 'regular', 'experienced']);
const PROFILE_FIELDS = Object.freeze([
  'displayName', 'pace', 'distance', 'availability', 'areas', 'terrains',
  'styles', 'goals', 'experience', 'experiencePreferences', 'interests',
]);
const OPTIONS = Object.freeze({
  areas: Object.freeze(['bay_trail', 'san_mateo', 'foster_city', 'belmont', 'redwood_city']),
  terrains: Object.freeze(['road', 'trail']),
  styles: Object.freeze(['continuous', 'run_walk', 'walk']),
  goals: Object.freeze([
    'consistency', 'first_5k', 'first_10k', 'half_marathon', 'marathon',
    'trails', 'social', 'return_gradually', 'volunteer', 'mentor',
  ]),
  interests: Object.freeze(['coffee', 'food', 'books', 'music', 'outdoors', 'volunteering']),
});

function invalid() {
  throw new Error('Runner connection input is invalid.');
}

function exactObject(value, fields) {
  if (value === null || typeof value !== 'object' || isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) invalid();
  const result = Object.create(null);
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    result[key] = descriptor.value;
  }
  return result;
}

function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < min || value > max) invalid();
  return value;
}

function boundedArray(value, min, max) {
  if (isProxy(value) || !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const size = integer(value.length, min, max);
  if (Reflect.ownKeys(value).length !== size + 1) invalid();
  const result = [];
  for (let index = 0; index < size; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    result.push(descriptor.value);
  }
  return result;
}

function enumList(value, options, min = 1, max = options.length) {
  const values = boundedArray(value, min, max);
  if (values.some((item) => !options.includes(item)) || new Set(values).size !== values.length) invalid();
  return Object.freeze(values.sort());
}

function normalizePace(input) {
  const pace = exactObject(input, ['unit', 'fastSeconds', 'slowSeconds']);
  if (!['min/km', 'min/mile'].includes(pace.unit)) invalid();
  integer(pace.fastSeconds, 120, 3000);
  integer(pace.slowSeconds, pace.fastSeconds, 3000);
  // One international mile is exactly 1.609344 km. Inputs are whole seconds in
  // the stated unit; canonical values round to the nearest second per km.
  const convert = (value) => (pace.unit === 'min/km'
    ? value : Math.round(value * 1_000_000 / 1_609_344));
  const fastSecondsPerKm = integer(convert(pace.fastSeconds), 120, 1800);
  const slowSecondsPerKm = integer(convert(pace.slowSeconds), fastSecondsPerKm, 1800);
  return Object.freeze({ fastSecondsPerKm, slowSecondsPerKm, preferredUnit: pace.unit });
}

function readRunnerProfile(input) {
  const data = exactObject(input, PROFILE_FIELDS);
  if (typeof data.displayName !== 'string' || data.displayName.length > 60
    || !data.displayName.trim() || /[\p{Cc}\p{Cf}\uD800-\uDFFF]/u.test(data.displayName)) invalid();
  const distance = exactObject(data.distance, ['minMetres', 'maxMetres']);
  integer(distance.minMetres, 500, 50000);
  integer(distance.maxMetres, distance.minMetres, 50000);
  const availability = boundedArray(data.availability, 1, 7).map((value) => {
    const window = exactObject(value, ['day', 'startMinute', 'endMinute']);
    integer(window.day, 0, 6);
    integer(window.startMinute, 0, 1439);
    integer(window.endMinute, window.startMinute + 1, 1440);
    return Object.freeze({ day: window.day, startMinute: window.startMinute, endMinute: window.endMinute });
  }).sort((a, b) => a.day - b.day || a.startMinute - b.startMinute || a.endMinute - b.endMinute);
  if (availability.some((window, index) => index > 0
    && window.day === availability[index - 1].day
    && window.startMinute < availability[index - 1].endMinute)) invalid();
  if (!EXPERIENCES.includes(data.experience)) invalid();
  return Object.freeze({
    displayName: data.displayName.trim(),
    pace: normalizePace(data.pace),
    distance: Object.freeze({ minMetres: distance.minMetres, maxMetres: distance.maxMetres }),
    availability: Object.freeze(availability),
    areas: enumList(data.areas, OPTIONS.areas, 1, 3),
    terrains: enumList(data.terrains, OPTIONS.terrains),
    styles: enumList(data.styles, OPTIONS.styles),
    goals: enumList(data.goals, OPTIONS.goals, 1, 5),
    experience: data.experience,
    experiencePreferences: enumList(data.experiencePreferences, EXPERIENCES),
    interests: enumList(data.interests, OPTIONS.interests, 0, 4),
  });
}

function readRunner(input) {
  const data = exactObject(input, [
    'entryRef', 'memberEligible', 'adultEligible', 'pairExcluded', 'consent', 'profile',
  ]);
  if (typeof data.entryRef !== 'string' || !/^runner_[0-9a-f]{64}$/.test(data.entryRef)) invalid();
  const consent = readConnectionConsent(data.consent);
  for (const value of [data.memberEligible, data.adultEligible, data.pairExcluded]) {
    if (typeof value !== 'boolean') invalid();
  }
  return Object.freeze({
    entryRef: data.entryRef,
    eligible: data.memberEligible && data.adultEligible && !data.pairExcluded && consent.memberDiscovery,
    consent: Object.freeze(consent),
    profile: readRunnerProfile(data.profile),
  });
}

function readConnectionConsent(input) {
  const consent = exactObject(input, ['memberDiscovery', 'similarity', 'broadenCircle']);
  if (Object.values(consent).some((value) => typeof value !== 'boolean')) invalid();
  if (!consent.memberDiscovery && (consent.similarity || consent.broadenCircle)) invalid();
  return Object.freeze({
    memberDiscovery: consent.memberDiscovery,
    similarity: consent.similarity,
    broadenCircle: consent.broadenCircle,
  });
}

function readRunnerProfileInput(input) {
  const canonical = readRunnerProfile(input);
  const pace = exactObject(exactObject(input, PROFILE_FIELDS).pace, ['unit', 'fastSeconds', 'slowSeconds']);
  // Preserve the entered unit/seconds for an exact edit round trip. All other
  // fields come from the closed, freshly allocated canonical projection.
  return Object.freeze({
    ...canonical,
    pace: Object.freeze({ unit: pace.unit, fastSeconds: pace.fastSeconds, slowSeconds: pace.slowSeconds }),
  });
}

function shared(left, right) {
  return left.filter((value) => right.includes(value));
}

function compatibility(left, right) {
  const fast = Math.max(left.pace.fastSecondsPerKm, right.pace.fastSecondsPerKm);
  const slow = Math.min(left.pace.slowSecondsPerKm, right.pace.slowSecondsPerKm);
  const distance = Math.max(left.distance.minMetres, right.distance.minMetres);
  if (fast > slow || distance > Math.min(left.distance.maxMetres, right.distance.maxMetres)
    || !left.experiencePreferences.includes(right.experience)
    || !right.experiencePreferences.includes(left.experience)) return null;
  const categories = ['areas', 'terrains', 'styles'];
  if (categories.some((key) => shared(left[key], right[key]).length === 0)) return null;
  const minimumMinutes = Math.ceil(distance * fast / 60000);
  const timeFits = left.availability.some((a) => right.availability.some((b) => a.day === b.day
    && Math.min(a.endMinute, b.endMinute) - Math.max(a.startMinute, b.startMinute) >= minimumMinutes));
  if (!timeFits) return null;
  const goals = shared(left.goals, right.goals);
  const interests = shared(left.interests, right.interests);
  const reasons = ['pace_overlap', 'shared_availability', 'shared_area', 'shared_distance', 'shared_terrain', 'shared_run_style'];
  if (goals.length) reasons.push('shared_goals');
  if (interests.length) reasons.push('shared_interests');
  const differences = [];
  if (left.experience !== right.experience) differences.push('different_experience');
  if (!goals.length) differences.push('different_goals');
  if (left.interests.length && right.interests.length && !interests.length) differences.push('different_interests');
  // Optional interests add explanations, not a score penalty when absent.
  return { score: goals.length * 4 + (left.experience === right.experience ? 2 : 0), reasons, differences };
}

function card(candidate, reasons) {
  const p = candidate.profile;
  return Object.freeze({
    entryRef: candidate.entryRef,
    displayName: p.displayName,
    pace: p.pace,
    distance: p.distance,
    availability: p.availability,
    areas: p.areas,
    terrains: p.terrains,
    styles: p.styles,
    goals: p.goals,
    experience: p.experience,
    interests: p.interests,
    reasons: Object.freeze([...reasons]),
  });
}

function rankRunnerConnections(viewerInput, candidateInputs) {
  const viewer = readRunner(viewerInput);
  const inputs = boundedArray(candidateInputs, 0, MAX_CANDIDATES);
  const response = (similar, broaden) => Object.freeze({
    rankerVersion: RANKER_VERSION,
    similar: Object.freeze(similar),
    broaden: Object.freeze(broaden),
  });
  if (!viewer.eligible) return response([], []);
  const seen = new Set();
  const matches = [];
  for (const input of inputs) {
    let candidate;
    try { candidate = readRunner(input); } catch { continue; }
    if (seen.has(candidate.entryRef)) invalid();
    seen.add(candidate.entryRef);
    if (!candidate.eligible || candidate.entryRef === viewer.entryRef) continue;
    const match = compatibility(viewer.profile, candidate.profile);
    if (match) matches.push({ candidate, ...match });
  }
  const compare = (a, b) => b.score - a.score
    || (a.candidate.entryRef < b.candidate.entryRef ? -1 : 1);
  matches.sort(compare);
  const broadening = viewer.consent.broadenCircle
    ? matches.filter((match) => match.candidate.consent.broadenCircle && match.differences.length)
      .sort((a, b) => b.differences.length - a.differences.length || compare(a, b))[0]
    : undefined;
  const similar = viewer.consent.similarity
    ? matches.filter((match) => match !== broadening && match.candidate.consent.similarity)
      .slice(0, 4).map((match) => card(match.candidate, match.reasons))
    : [];
  return response(similar, broadening
    ? [card(broadening.candidate, [...broadening.reasons, ...broadening.differences])]
    : []);
}

module.exports = {
  RANKER_VERSION, MAX_CANDIDATES, normalizePace, readRunnerProfile,
  readRunnerProfileInput, readConnectionConsent, rankRunnerConnections,
};
