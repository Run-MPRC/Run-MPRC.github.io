// Display/input hygiene only. The server independently validates and authorizes
// every operation. Do not derive membership from any browser value here.
export const OPTIONS = {
  areas: ['bay_trail', 'san_mateo', 'foster_city', 'belmont', 'redwood_city'],
  terrains: ['road', 'trail'],
  styles: ['continuous', 'run_walk', 'walk'],
  goals: [
    'consistency',
    'first_5k',
    'first_10k',
    'half_marathon',
    'marathon',
    'trails',
    'social',
    'return_gradually',
    'volunteer',
    'mentor',
  ],
  experience: ['beginner', 'returning', 'regular', 'experienced'],
  interests: ['coffee', 'food', 'books', 'music', 'outdoors', 'volunteering'],
} as const;
export const REASONS = [
  'pace_overlap',
  'shared_availability',
  'shared_area',
  'shared_distance',
  'shared_terrain',
  'shared_run_style',
  'shared_goals',
  'shared_interests',
  'different_experience',
  'different_goals',
  'different_interests',
] as const;
export interface RunnerProfile {
  displayName: string;
  pace: { unit: 'min/km' | 'min/mile'; fastSeconds: number; slowSeconds: number };
  distance: { minMetres: number; maxMetres: number };
  availability: { day: number; startMinute: number; endMinute: number }[];
  areas: string[];
  terrains: string[];
  styles: string[];
  goals: string[];
  experience: string;
  experiencePreferences: string[];
  interests: string[];
}
export interface Consent {
  memberDiscovery: boolean;
  similarity: boolean;
  broadenCircle: boolean;
}
export interface ProfileState {
  schemaVersion: 1;
  consentVersion: 1;
  revision: number;
  adultConfirmed: boolean;
  profile: RunnerProfile | null;
  consent: Consent;
}
export interface RunnerCard extends Omit<RunnerProfile, 'pace' | 'experiencePreferences'> {
  entryRef: string;
  pace: {
    fastSecondsPerKm: number;
    slowSecondsPerKm: number;
    preferredUnit: 'min/km' | 'min/mile';
  };
  reasons: string[];
}
export interface Recommendations {
  rankerVersion: 1;
  status: 'ready' | 'profile_required';
  windowEndsAtMs: number;
  similar: RunnerCard[];
  broaden: RunnerCard[];
}
export interface Exclusion {
  revision: number;
  hidden: boolean;
  blocked: boolean;
}
export interface Mutation {
  requestId: string;
  expectedRevision: number;
}
export interface SaveRequest extends Mutation {
  profile: RunnerProfile;
  consent: Consent;
  adultConfirmed: true;
  consentVersion: 1;
}
export interface ExclusionRequest extends Mutation {
  entryRef: string;
  hidden: boolean;
  blocked: boolean;
}
const FIELDS = [
  'displayName',
  'pace',
  'distance',
  'availability',
  'areas',
  'terrains',
  'styles',
  'goals',
  'experience',
  'experiencePreferences',
  'interests',
];
export function invalid(): never {
  throw new Error('Runner connection data is unavailable.');
}
export function exact(value: unknown, fields: string[]): Record<string, unknown> {
  try {
    if (
      value === null
      || typeof value !== 'object'
      || Object.getPrototypeOf(value) !== Object.prototype
    ) return invalid();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== fields.length
      || keys.some((key) => typeof key !== 'string' || !fields.includes(key))
    ) return invalid();
    const result: Record<string, unknown> = {};
    fields.forEach((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor
        || !descriptor.enumerable
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ) invalid();
      result[key] = descriptor.value;
    });
    return result;
  } catch {
    return invalid();
  }
}
function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || Object.is(value, -0)
    || value < min
    || value > max
  ) return invalid();
  return value;
}
function array(value: unknown, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return invalid();
  integer(value.length, min, max);
  if (Reflect.ownKeys(value).length !== value.length + 1) return invalid();
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor
      || !descriptor.enumerable
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) return invalid();
    return descriptor.value;
  });
}
function choices(
  value: unknown,
  options: readonly string[],
  min = 1,
  max = options.length,
): string[] {
  const values = array(value, min, max);
  if (
    values.some((item) => typeof item !== 'string' || !options.includes(item))
    || new Set(values).size !== values.length
  ) return invalid();
  return (values as string[]).sort();
}
export function readProfile(value: unknown): RunnerProfile {
  const data = exact(value, FIELDS);
  if (
    typeof data.displayName !== 'string'
    || !data.displayName.trim()
    || data.displayName.length > 60
    || /[\p{Cc}\p{Cf}\uD800-\uDFFF]/u.test(data.displayName)
  ) return invalid();
  const pace = exact(data.pace, ['unit', 'fastSeconds', 'slowSeconds']);
  if (pace.unit !== 'min/km' && pace.unit !== 'min/mile') return invalid();
  const fastSeconds = integer(pace.fastSeconds, 120, 3000);
  const slowSeconds = integer(pace.slowSeconds, fastSeconds, 3000);
  const convert = (seconds: number) => Math.round(seconds * (pace.unit === 'min/mile' ? 1000000 / 1609344 : 1));
  integer(convert(fastSeconds), 120, 1800);
  integer(convert(slowSeconds), convert(fastSeconds), 1800);
  const distance = exact(data.distance, ['minMetres', 'maxMetres']);
  const minMetres = integer(distance.minMetres, 500, 50000);
  const maxMetres = integer(distance.maxMetres, minMetres, 50000);
  const availability = array(data.availability, 1, 7)
    .map((input) => {
      const window = exact(input, ['day', 'startMinute', 'endMinute']);
      const day = integer(window.day, 0, 6);
      const startMinute = integer(window.startMinute, 0, 1439);
      return { day, startMinute, endMinute: integer(window.endMinute, startMinute + 1, 1440) };
    })
    .sort((a, b) => a.day - b.day || a.startMinute - b.startMinute);
  if (
    availability.some(
      (window, index) => index > 0
        && window.day === availability[index - 1].day
        && window.startMinute < availability[index - 1].endMinute,
    )
  ) return invalid();
  if (!OPTIONS.experience.some((item) => item === data.experience)) return invalid();
  return {
    displayName: data.displayName.trim(),
    pace: { unit: pace.unit, fastSeconds, slowSeconds },
    distance: { minMetres, maxMetres },
    availability,
    areas: choices(data.areas, OPTIONS.areas, 1, 3),
    terrains: choices(data.terrains, OPTIONS.terrains),
    styles: choices(data.styles, OPTIONS.styles),
    goals: choices(data.goals, OPTIONS.goals, 1, 5),
    experience: data.experience as string,
    experiencePreferences: choices(data.experiencePreferences, OPTIONS.experience),
    interests: choices(data.interests, OPTIONS.interests, 0, 4),
  };
}
export function readConsent(value: unknown): Consent {
  const data = exact(value, ['memberDiscovery', 'similarity', 'broadenCircle']);
  if (
    Object.values(data).some((item) => typeof item !== 'boolean')
    || (!data.memberDiscovery && (data.similarity || data.broadenCircle))
  ) return invalid();
  return {
    memberDiscovery: data.memberDiscovery as boolean,
    similarity: data.similarity as boolean,
    broadenCircle: data.broadenCircle as boolean,
  };
}
export function readProfileState(value: unknown): ProfileState {
  const data = exact(value, [
    'schemaVersion',
    'consentVersion',
    'revision',
    'adultConfirmed',
    'profile',
    'consent',
  ]);
  if (data.schemaVersion !== 1 || data.consentVersion !== 1) return invalid();
  const revision = integer(data.revision, 0, Number.MAX_SAFE_INTEGER - 1);
  const profile = data.profile === null ? null : readProfile(data.profile);
  const consent = readConsent(data.consent);
  if (
    data.adultConfirmed !== (profile !== null)
    || (!profile && consent.memberDiscovery)
    || (revision === 0 && profile !== null)
  ) return invalid();
  return {
    schemaVersion: 1,
    consentVersion: 1,
    revision,
    adultConfirmed: data.adultConfirmed as boolean,
    profile,
    consent,
  };
}
export function previewCard(profile: RunnerProfile): Omit<RunnerCard, 'entryRef' | 'reasons'> {
  const { experiencePreferences, pace, ...shared } = readProfile(profile);
  const convert = (seconds: number) => Math.round(seconds * (pace.unit === 'min/mile' ? 1000000 / 1609344 : 1));
  return {
    ...shared,
    pace: {
      fastSecondsPerKm: convert(pace.fastSeconds),
      slowSecondsPerKm: convert(pace.slowSeconds),
      preferredUnit: pace.unit,
    },
  };
}
export function readReference(value: unknown): string {
  if (typeof value !== 'string' || !/^runner_[0-9a-f]{64}$/.test(value)) return invalid();
  return value;
}
function readCard(value: unknown): RunnerCard {
  const data = exact(value, [
    ...FIELDS.filter((field) => field !== 'experiencePreferences'),
    'entryRef',
    'reasons',
  ]);
  const pace = exact(data.pace, ['fastSecondsPerKm', 'slowSecondsPerKm', 'preferredUnit']);
  const fast = integer(pace.fastSecondsPerKm, 120, 1800);
  const slow = integer(pace.slowSecondsPerKm, fast, 1800);
  if (pace.preferredUnit !== 'min/km' && pace.preferredUnit !== 'min/mile') return invalid();
  const { entryRef, reasons, ...fields } = data;
  const validated = previewCard(
    readProfile({
      ...fields,
      pace: { unit: 'min/km', fastSeconds: fast, slowSeconds: slow },
      experiencePreferences: [...OPTIONS.experience],
    }),
  );
  return {
    ...validated,
    pace: {
      fastSecondsPerKm: fast,
      slowSecondsPerKm: slow,
      preferredUnit: pace.preferredUnit,
    },
    entryRef: readReference(entryRef),
    reasons: choices(reasons, REASONS, 1),
  };
}
export function readRecommendations(value: unknown): Recommendations {
  const data = exact(value, [
    'rankerVersion',
    'status',
    'windowEndsAtMs',
    'similar',
    'broaden',
  ]);
  if (
    data.rankerVersion !== 1
    || (data.status !== 'ready' && data.status !== 'profile_required')
  ) return invalid();
  const similar = array(data.similar, 0, 4).map(readCard);
  const broaden = array(data.broaden, 0, 1).map(readCard);
  const refs = [...similar, ...broaden].map((card) => card.entryRef);
  if (
    new Set(refs).size !== refs.length
    || (data.status === 'profile_required' && refs.length > 0)
  ) return invalid();
  return {
    rankerVersion: 1,
    status: data.status,
    windowEndsAtMs: integer(data.windowEndsAtMs, 1, Number.MAX_SAFE_INTEGER),
    similar,
    broaden,
  };
}
export function readExclusion(value: unknown): Exclusion {
  const data = exact(value, ['revision', 'hidden', 'blocked']);
  if (typeof data.hidden !== 'boolean' || typeof data.blocked !== 'boolean') return invalid();
  return {
    revision: integer(data.revision, 0, Number.MAX_SAFE_INTEGER - 1),
    hidden: data.hidden,
    blocked: data.blocked,
  };
}
