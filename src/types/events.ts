import { Timestamp } from 'firebase/firestore';

export type EventStatus = 'draft' | 'open' | 'closed' | 'cancelled';
export type EventVisibility = 'public' | 'members_only' | 'draft';
export type PriceTier = 'member' | 'nonMember' | 'earlyBird' | 'comp' | 'free';
export type SignupType = 'participant' | 'volunteer';

export type RegistrationStatus =
  | 'pending'
  | 'paid'
  | 'refunded'
  | 'partially_refunded'
  | 'cancelled'
  | 'transferred'
  | 'comp';

export type CustomFieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'number'
  | 'date'
  | 'select'
  | 'checkbox'
  | 'textarea';

export interface CustomField {
  key: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  options?: string[];
  helpText?: string;
}

export interface EventPricing {
  memberCents: number;
  nonMemberCents: number;
  earlyBirdCents?: number;
  earlyBirdUntil?: Timestamp | null;
}

export interface StripePriceIds {
  member?: string;
  nonMember?: string;
  earlyBird?: string;
}

export interface Event {
  id: string;
  slug: string;
  title: string;
  description: string;
  startAt: Timestamp;
  endAt?: Timestamp | null;
  location: string;
  locationDetails?: string;
  capacity: number | null;
  registeredCount: number;
  status: EventStatus;
  visibility: EventVisibility;

  pricing: EventPricing;
  stripeProductId?: string;
  stripePriceIds: StripePriceIds;

  waiverText: string;
  waiverVersion: string;

  customFields: CustomField[];

  volunteerEnabled?: boolean;
  volunteerFields?: CustomField[];

  resultsUrl?: string | null;
  resultsText?: string | null;
  resultsPublishedAt?: Timestamp | null;

  registrationOpensAt?: Timestamp | null;
  registrationClosesAt?: Timestamp | null;

  heroImageUrl?: string | null;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;

  member_only?: boolean;
}

export interface RegistrationRunner {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  dob?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  shirtSize?: string;
  extras?: Record<string, unknown>;
}

export interface AuditEntry {
  ts: Timestamp;
  actorUid: string | null;
  actorEmail: string | null;
  action: string;
  note?: string;
}

export interface Registration {
  id: string;
  eventId: string;
  runner: RegistrationRunner;
  uid: string | null;
  priceTier: PriceTier;
  signupType?: SignupType;
  amountCents: number;
  currency: string;
  promoCode?: string | null;

  status: RegistrationStatus;

  stripeSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeChargeId?: string | null;
  stripeRefundIds?: string[];
  stripePaymentLinkId?: string | null;

  waiverAcceptedAt: Timestamp | null;
  waiverVersion: string | null;

  confirmationToken: string;

  createdAt: Timestamp;
  updatedAt: Timestamp;
  paidAt?: Timestamp | null;
  refundedAt?: Timestamp | null;
  cancelledAt?: Timestamp | null;

  auditLog: AuditEntry[];
}
