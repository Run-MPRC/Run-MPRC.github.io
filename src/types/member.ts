import { Timestamp } from 'firebase/firestore';

export type MemberRole = 'admin' | 'member' | 'unverified';

export interface Member {
  uid: string;
  email: string;
  fullName: string | null;
  role: MemberRole;
  phoneNumber: string;
  emailVerified: boolean;
  provider: string;
  createdAt: Timestamp | null;
  lastLogin: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface MemberEditableFields {
  fullName: string;
}

export interface PersonalRecord {
  id: string;
  distance: string;
  time: string;
  achievedOn: Timestamp | null;
  eventId?: string | null;
  note?: string;
}
