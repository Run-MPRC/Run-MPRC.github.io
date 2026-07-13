import {
  doc, getDoc, updateDoc, serverTimestamp, Firestore, Timestamp,
} from 'firebase/firestore';
import { FirebaseApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Member, MemberEditableFields } from '../../types/member';

export type MyMemberProfile = Omit<Member, 'phoneNumber'>;

export const MEMBER_PROFILE_LIMITS = {
  fullName: 200,
} as const;

export interface ValidatedMemberProfileFields {
  fullName: string;
}

export type MemberProfileValidation =
  | { valid: true; fields: ValidatedMemberProfileFields }
  | { valid: false; message: string };

export function validateMemberProfileFields(
  fields: MemberEditableFields,
): MemberProfileValidation {
  const fullName = fields.fullName.trim();
  if (fullName.length > MEMBER_PROFILE_LIMITS.fullName) {
    return { valid: false, message: 'Full name must be 200 characters or fewer.' };
  }
  return { valid: true, fields: { fullName } };
}

export async function ensureMyProfile(
  app: FirebaseApp,
): Promise<{ ready: true }> {
  const functions = getFunctions(app);
  const callable = httpsCallable<Record<string, never>, { ready: true }>(
    functions,
    'ensureMemberProfile',
  );
  const result = await callable({});
  return result.data;
}

export async function getMyProfile(
  db: Firestore,
  uid: string,
): Promise<MyMemberProfile | null> {
  const ref = doc(db, 'members', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    uid,
    email: d.email || '',
    fullName: d.fullName || null,
    role: d.role || 'unverified',
    emailVerified: d.emailVerified || false,
    provider: d.provider || 'unknown',
    createdAt: d.createdAt || null,
    lastLogin: d.lastLogin || null,
    updatedAt: d.updatedAt || null,
  };
}

export async function updateMyProfile(
  db: Firestore,
  uid: string,
  fields: MemberEditableFields,
): Promise<void> {
  const validation = validateMemberProfileFields(fields);
  if (!validation.valid) throw new Error(validation.message);
  const { fullName } = validation.fields;

  const ref = doc(db, 'members', uid);
  await updateDoc(ref, {
    fullName: fullName || null,
    updatedAt: serverTimestamp(),
  });
}

export interface MyRegistrationSummary {
  id: string;
  eventId: string;
  status: string;
  priceTier: string;
  amountCents: number;
  currency: string;
  runner: {
    firstName: string;
    lastName: string;
    email: string;
    shirtSize: string | null;
  };
  createdAt: Timestamp | null;
  paidAt: Timestamp | null;
  refundedAt: Timestamp | null;
  cancelledAt: Timestamp | null;
}

export interface MyEventSummary {
  id: string;
  slug: string;
  title: string;
  startAt: Timestamp | null;
  location: string;
}

export interface MyRegistrationsResponse {
  registrations: MyRegistrationSummary[];
  events: Record<string, MyEventSummary>;
}

export async function listMyRegistrations(
  app: FirebaseApp,
): Promise<MyRegistrationsResponse> {
  const functions = getFunctions(app);
  const callable = httpsCallable<void, MyRegistrationsResponse>(
    functions,
    'listMyRegistrations',
  );
  const result = await callable();
  return result.data;
}
