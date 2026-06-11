import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  Query,
  Timestamp,
  where,
  Firestore,
  DocumentData,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { FirebaseApp } from 'firebase/app';
import { Event, Registration } from '../../types/events';

// ---------------------------------------------------------------------------
// Dev-only placeholder events so the Events UI renders meaningfully before
// real events exist in Firestore. Tree-shaken out in production because
// NODE_ENV==='production'. Recompute dates on module load so demos don't rot.
// ---------------------------------------------------------------------------
const IS_DEV = process.env.NODE_ENV === 'development';

function atHour(d: Date, hour: number, minute = 0): Date {
  const copy = new Date(d);
  copy.setHours(hour, minute, 0, 0);
  return copy;
}

function lastSaturdayOfMonth(year: number, monthZeroBased: number): Date {
  const lastDay = new Date(year, monthZeroBased + 1, 0);
  const daysBack = (lastDay.getDay() - 6 + 7) % 7;
  lastDay.setDate(lastDay.getDate() - daysBack);
  return lastDay;
}

function upcomingWeekday(weekday: number, n: number, from: Date = new Date()): Date[] {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  while (d.getDay() !== weekday) {
    d.setDate(d.getDate() + 1);
  }
  const out: Date[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return out;
}

function isSameDayLocal(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function placeholderEvent(params: {
  slug: string;
  title: string;
  description: string;
  start: Date;
  end: Date;
  location: string;
  locationDetails?: string;
}): Event {
  return {
    id: params.slug,
    slug: params.slug,
    title: params.title,
    description: params.description,
    startAt: Timestamp.fromDate(params.start),
    endAt: Timestamp.fromDate(params.end),
    location: params.location,
    locationDetails: params.locationDetails || '',
    capacity: null,
    registeredCount: 0,
    status: 'open',
    visibility: 'public',
    pricing: { memberCents: 0, nonMemberCents: 0 },
    stripePriceIds: {},
    waiverText: 'I acknowledge running involves risk and participate at my own risk.',
    waiverVersion: '1',
    customFields: [],
    volunteerEnabled: false,
    volunteerFields: [],
    resultsUrl: null,
    resultsText: null,
    resultsPublishedAt: null,
    registrationOpensAt: null,
    registrationClosesAt: null,
    heroImageUrl: null,
    createdBy: 'placeholder',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
}

function buildPlaceholderEvents(): Event[] {
  if (!IS_DEV) return [];
  const now = new Date();
  const events: Event[] = [];

  // Saturday morning runs — every Saturday for 6 weeks
  // 8:45–10:10 run, 10:10–10:30 stretch + announcements
  const socialDates: Date[] = [];
  for (let i = 0; i < 4; i += 1) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const lastSat = lastSaturdayOfMonth(monthStart.getFullYear(), monthStart.getMonth());
    if (lastSat >= now || i > 0) socialDates.push(lastSat);
  }

  const saturdays = upcomingWeekday(6, 6, now);
  saturdays.forEach((sat) => {
    const isSocialDay = socialDates.some((s) => isSameDayLocal(s, sat));
    const start = atHour(sat, 8, 45);
    const end = atHour(sat, isSocialDay ? 12 : 10, isSocialDay ? 30 : 30);
    const baseDesc = '8:45–10:10 AM group run, followed by stretch and announcements 10:10–10:30 AM. All paces welcome; groups form on the fly.';
    events.push(placeholderEvent({
      slug: `saturday-run-${start.toISOString().slice(0, 10)}`,
      title: isSocialDay
        ? 'Saturday Morning Run + Club Social'
        : 'Saturday Morning Run',
      description: isSocialDay
        ? `${baseDesc}\n\nAfter announcements, stick around for our monthly club social — 11 AM to 12:30 PM at Ryder Park. Snacks, chatter, non-members welcome.`
        : baseDesc,
      start,
      end,
      location: 'Ryder Park',
      locationDetails: 'Meet at the pavilion. Look for the MPRC banner.',
    }));
  });

  // Monthly Club Social — last Saturday, 11 AM–12:30 PM (separate event so it
  // shows up on its own on the calendar too)
  socialDates.forEach((sat) => {
    const start = atHour(sat, 11, 0);
    const end = atHour(sat, 12, 30);
    const monthLabel = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    events.push(placeholderEvent({
      slug: `club-social-${start.toISOString().slice(0, 10)}`,
      title: `Club Social — ${monthLabel}`,
      description: 'Casual monthly club social at Ryder Park, right after the morning run and stretch. Snacks, chatter, low-key hangout. Non-members welcome — bring friends.',
      start,
      end,
      location: 'Ryder Park',
      locationDetails: 'Meet at the pavilion. Look for the MPRC banner.',
    }));
  });

  // Thursday runs at Sawyer Camp Trail — next 5 weeks, 5:30 PM PT
  const thursdays = upcomingWeekday(4, 5, now);
  thursdays.forEach((t) => {
    const start = atHour(t, 17, 30);
    const end = atHour(t, 18, 30);
    events.push(placeholderEvent({
      slug: `thursday-run-${start.toISOString().slice(0, 10)}`,
      title: 'Thursday Run — Sawyer Camp Trail',
      description: 'Weekly Thursday evening run on Sawyer Camp Trail. Paces from easy to moderate — groups form on the fly. All levels welcome.',
      start,
      end,
      location: 'South Trailhead, Sawyer Camp Trail',
      locationDetails: 'Parking near the trailhead gate. Bring a headlamp if it\'s getting dark out.',
    }));
  });

  return events.sort((a, b) => a.startAt.toMillis() - b.startAt.toMillis());
}

const PLACEHOLDER_EVENTS = buildPlaceholderEvents();

export function toEvent(id: string, data: DocumentData): Event {
  return {
    id,
    slug: data.slug || id,
    title: data.title || '',
    description: data.description || '',
    startAt: data.startAt,
    endAt: data.endAt || null,
    location: data.location || '',
    locationDetails: data.locationDetails || '',
    capacity: data.capacity ?? null,
    registeredCount: data.registeredCount ?? 0,
    status: data.status || 'draft',
    visibility: data.visibility || (data.member_only ? 'members_only' : 'public'),
    pricing: data.pricing || { memberCents: 0, nonMemberCents: 0 },
    stripeProductId: data.stripeProductId,
    stripePriceIds: data.stripePriceIds || {},
    waiverText: data.waiverText || '',
    waiverVersion: data.waiverVersion || '1',
    customFields: data.customFields || [],
    volunteerEnabled: data.volunteerEnabled === true,
    volunteerFields: data.volunteerFields || [],
    resultsUrl: data.resultsUrl || null,
    resultsText: data.resultsText || null,
    resultsPublishedAt: data.resultsPublishedAt || null,
    registrationOpensAt: data.registrationOpensAt || null,
    registrationClosesAt: data.registrationClosesAt || null,
    heroImageUrl: data.heroImageUrl || null,
    createdBy: data.createdBy || '',
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    member_only: data.member_only,
  };
}

function withPlaceholderFallback(real: Event[]): Event[] {
  if (!IS_DEV) return real;
  return real.length > 0 ? real : PLACEHOLDER_EVENTS;
}

export function listPublicEvents(
  db: Firestore,
  onChange: (events: Event[]) => void,
  onError?: (err: Error) => void,
) {
  const eventsCol = collection(db, 'events');
  const q: Query = query(
    eventsCol,
    where('visibility', '==', 'public'),
    where('status', 'in', ['open', 'closed']),
    orderBy('startAt', 'asc'),
  );
  return onSnapshot(
    q,
    (snap) => onChange(withPlaceholderFallback(snap.docs.map((d) => toEvent(d.id, d.data())))),
    (err) => {
      if (IS_DEV) {
        onChange(PLACEHOLDER_EVENTS);
        return;
      }
      onError?.(err);
    },
  );
}

export function listMemberEvents(
  db: Firestore,
  onChange: (events: Event[]) => void,
  onError?: (err: Error) => void,
) {
  const eventsCol = collection(db, 'events');
  // Members may read both public and members-only (non-draft) events, but a
  // single `where('status','in',[...])` query is REJECTED by security rules:
  // "rules are not filters", and a draft-visibility event could match the
  // query yet be unreadable, so Firestore denies the whole list. Instead we
  // run one rules-safe query per visibility bucket and merge the streams.
  const publicQ: Query = query(
    eventsCol,
    where('visibility', '==', 'public'),
    where('status', 'in', ['open', 'closed']),
    orderBy('startAt', 'asc'),
  );
  const membersQ: Query = query(
    eventsCol,
    where('visibility', '==', 'members_only'),
    where('status', 'in', ['open', 'closed']),
    orderBy('startAt', 'asc'),
  );

  let publicEvents: Event[] = [];
  let memberEvents: Event[] = [];
  let publicReady = false;
  let membersReady = false;

  const emit = () => {
    // Hold the first emit until both initial snapshots arrive, so members
    // don't see the public-only list flash in before members-only events.
    if (!publicReady || !membersReady) return;
    const merged = [...publicEvents, ...memberEvents].sort(
      (a, b) => (a.startAt?.toMillis?.() ?? 0) - (b.startAt?.toMillis?.() ?? 0),
    );
    onChange(withPlaceholderFallback(merged));
  };

  const handleError = (err: Error) => {
    if (IS_DEV) {
      onChange(PLACEHOLDER_EVENTS);
      return;
    }
    onError?.(err);
  };

  const unsubPublic = onSnapshot(
    publicQ,
    (snap) => {
      publicEvents = snap.docs.map((d) => toEvent(d.id, d.data()));
      publicReady = true;
      emit();
    },
    handleError,
  );
  const unsubMembers = onSnapshot(
    membersQ,
    (snap) => {
      memberEvents = snap.docs.map((d) => toEvent(d.id, d.data()));
      membersReady = true;
      emit();
    },
    handleError,
  );

  return () => {
    unsubPublic();
    unsubMembers();
  };
}

export async function getEventBySlug(
  db: Firestore,
  slug: string,
): Promise<Event | null> {
  const ref = doc(db, 'events', slug);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) return toEvent(snap.id, snap.data());
  } catch (err) {
    if (!IS_DEV) throw err;
  }
  return PLACEHOLDER_EVENTS.find((e) => e.slug === slug) || null;
}

export interface CheckoutArgs {
  eventId: string;
  runner: Registration['runner'];
  customFields?: Record<string, unknown>;
  priceTier?: 'member' | 'nonMember' | 'earlyBird';
  signupType?: 'participant' | 'volunteer';
  acceptedWaiver: boolean;
}

export interface CheckoutResult {
  url?: string;
  sessionId?: string;
  registrationId: string;
  free?: boolean;
  confirmationToken?: string;
}

export async function createCheckoutSession(
  app: FirebaseApp,
  args: CheckoutArgs,
): Promise<CheckoutResult> {
  const functions = getFunctions(app);
  const callable = httpsCallable<CheckoutArgs, CheckoutResult>(
    functions,
    'createCheckoutSession',
  );
  const result = await callable(args);
  return result.data;
}

export interface LookupResult {
  id: string;
  status: string;
  priceTier: string;
  amountCents: number;
  currency: string;
  runner: { firstName: string; lastName: string; email: string; shirtSize: string | null };
  eventId: string;
  paidAt: Timestamp | null;
  createdAt: Timestamp | null;
}

export async function lookupRegistration(
  app: FirebaseApp,
  args: { eventId: string; registrationId: string; token: string },
): Promise<LookupResult> {
  const functions = getFunctions(app);
  const callable = httpsCallable<typeof args, LookupResult>(functions, 'lookupRegistration');
  const result = await callable(args);
  return result.data;
}

export async function listEventRegistrations(
  db: Firestore,
  eventId: string,
): Promise<Registration[]> {
  // Only admins can read this collection per Firestore rules.
  const col = collection(db, 'events', eventId, 'registrations');
  const q = query(col, orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Registration, 'id'>),
  }));
}

export function formatPrice(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export function formatEventDate(ts?: Timestamp | null): string {
  if (!ts) return '';
  const d = ts.toDate();
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}
