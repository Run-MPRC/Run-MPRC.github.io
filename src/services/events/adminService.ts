import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  Firestore,
  Timestamp,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { FirebaseApp } from 'firebase/app';
import { Event, Registration, CustomField } from '../../types/events';
import { toEvent } from './eventsService';

export interface EventEditorInput {
  slug: string;
  title: string;
  description: string;
  startAt: Date;
  endAt?: Date | null;
  location: string;
  locationDetails?: string;
  capacity?: number | null;
  status: 'draft' | 'open' | 'closed' | 'cancelled';
  visibility: 'public' | 'members_only' | 'draft';
  pricing: {
    memberCents: number;
    nonMemberCents: number;
    earlyBirdCents?: number;
    earlyBirdUntil?: Date | null;
  };
  waiverText: string;
  waiverVersion: string;
  customFields: CustomField[];
  volunteerEnabled?: boolean;
  volunteerFields?: CustomField[];
  resultsUrl?: string | null;
  resultsText?: string | null;
  registrationOpensAt?: Date | null;
  registrationClosesAt?: Date | null;
  heroImageUrl?: string | null;
}

function toTs(d?: Date | null) {
  return d ? Timestamp.fromDate(d) : null;
}

export async function listAllEvents(db: Firestore): Promise<Event[]> {
  const col = collection(db, 'events');
  const q = query(col, orderBy('startAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => toEvent(d.id, d.data()));
}

export async function createEvent(
  db: Firestore,
  input: EventEditorInput,
  createdBy: string,
): Promise<void> {
  const ref = doc(db, 'events', input.slug);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    throw new Error(`Event with slug "${input.slug}" already exists`);
  }
  const now = Timestamp.now();
  await setDoc(ref, {
    slug: input.slug,
    title: input.title,
    description: input.description,
    startAt: Timestamp.fromDate(input.startAt),
    endAt: toTs(input.endAt),
    location: input.location,
    locationDetails: input.locationDetails || '',
    capacity: input.capacity ?? null,
    registeredCount: 0,
    status: input.status,
    visibility: input.visibility,
    pricing: {
      memberCents: input.pricing.memberCents,
      nonMemberCents: input.pricing.nonMemberCents,
      ...(typeof input.pricing.earlyBirdCents === 'number'
        ? { earlyBirdCents: input.pricing.earlyBirdCents }
        : {}),
      ...(input.pricing.earlyBirdUntil
        ? { earlyBirdUntil: Timestamp.fromDate(input.pricing.earlyBirdUntil) }
        : {}),
    },
    stripePriceIds: {},
    waiverText: input.waiverText,
    waiverVersion: input.waiverVersion,
    customFields: input.customFields,
    volunteerEnabled: input.volunteerEnabled === true,
    volunteerFields: input.volunteerFields || [],
    resultsUrl: input.resultsUrl || null,
    resultsText: input.resultsText || null,
    resultsPublishedAt: input.resultsUrl ? Timestamp.now() : null,
    registrationOpensAt: toTs(input.registrationOpensAt),
    registrationClosesAt: toTs(input.registrationClosesAt),
    heroImageUrl: input.heroImageUrl || null,
    createdBy,
    createdAt: now,
    updatedAt: now,
  });
}

export async function updateEvent(
  db: Firestore,
  slug: string,
  input: EventEditorInput,
): Promise<void> {
  const ref = doc(db, 'events', slug);
  await updateDoc(ref, {
    title: input.title,
    description: input.description,
    startAt: Timestamp.fromDate(input.startAt),
    endAt: toTs(input.endAt),
    location: input.location,
    locationDetails: input.locationDetails || '',
    capacity: input.capacity ?? null,
    status: input.status,
    visibility: input.visibility,
    pricing: {
      memberCents: input.pricing.memberCents,
      nonMemberCents: input.pricing.nonMemberCents,
      ...(typeof input.pricing.earlyBirdCents === 'number'
        ? { earlyBirdCents: input.pricing.earlyBirdCents }
        : {}),
      ...(input.pricing.earlyBirdUntil
        ? { earlyBirdUntil: Timestamp.fromDate(input.pricing.earlyBirdUntil) }
        : {}),
    },
    waiverText: input.waiverText,
    waiverVersion: input.waiverVersion,
    customFields: input.customFields,
    volunteerEnabled: input.volunteerEnabled === true,
    volunteerFields: input.volunteerFields || [],
    resultsUrl: input.resultsUrl || null,
    resultsText: input.resultsText || null,
    ...(input.resultsUrl ? { resultsPublishedAt: serverTimestamp() } : {}),
    registrationOpensAt: toTs(input.registrationOpensAt),
    registrationClosesAt: toTs(input.registrationClosesAt),
    heroImageUrl: input.heroImageUrl || null,
    updatedAt: serverTimestamp(),
  });
}

export type AdminAction =
  | 'refund_full'
  | 'refund_partial'
  | 'cancel'
  | 'substitute'
  | 'mark_comp'
  | 'add_note'
  | 'add_late_registration';

export interface AdminActionArgs {
  eventId: string;
  registrationId?: string;
  action: AdminAction;
  payload?: Record<string, unknown>;
}

export async function adminRegistrationAction(
  app: FirebaseApp,
  args: AdminActionArgs,
): Promise<{ ok: boolean; registrationId?: string; refundId?: string; paymentLink?: string }> {
  const functions = getFunctions(app);
  const callable = httpsCallable<AdminActionArgs, any>(
    functions,
    'adminRegistrationAction',
  );
  const result = await callable(args);
  return result.data;
}

export async function listRegistrationsForEvent(
  db: Firestore,
  eventId: string,
): Promise<Registration[]> {
  const col = collection(db, 'events', eventId, 'registrations');
  const q = query(col, orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Registration, 'id'>),
  }));
}
