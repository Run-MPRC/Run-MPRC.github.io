import { httpsCallable, Functions } from 'firebase/functions';
import { Auth } from 'firebase/auth';

export const COMMUNITY_ENABLED = process.env.REACT_APP_FIREBASE_ENVIRONMENT === 'staging'
  && process.env.REACT_APP_COMMUNITY_STAGING === 'true';

export interface CommunityStatus {
  schemaVersion: 1; observedAtMs: number;
  membership: {
    revision: number; applicationStatus: string;
    entitlement: string; accessThroughMs: number | null;
  };
  events: Array<{
    id: string; title: string; location: string; startAtMs: number; status: string;
    signupStatus?: 'open' | 'not_open_yet' | 'closed' | 'ended' | 'full' | 'cancelled';
    opensAtMs: number; closesAtMs: number; capacity: number; confirmedCount: number;
    waiverText: string; waiverVersion: string;
    registration: { revision: number; status: string };
  }>;
}
export interface CommunityRequest {
  action: 'status' | 'membership_join' | 'membership_cancel' | 'event_join' | 'event_cancel';
  accountUid: string;
  requestId?: string;
  expectedRevision?: number;
  eventId?: string;
  waiverVersion?: string;
  waiverAccepted?: boolean;
}
export async function callCommunity(
  functions: Functions,
  request: CommunityRequest,
  auth: Auth,
): Promise<unknown> {
  const identity = auth?.currentUser;
  const bound = () => identity && auth.currentUser === identity
    && auth.app === functions.app && auth.tenantId === null
    && identity.uid === request.accountUid
    && (request.action === 'status' || identity.emailVerified);
  if (!COMMUNITY_ENABLED || functions.app.options.projectId !== 'run-mprc-staging' || !bound()) {
    throw new Error('Community staging is unavailable.');
  }
  const result = await httpsCallable<CommunityRequest, unknown>(functions, 'communityActions')(request);
  if (!bound()) throw new Error('Community staging is unavailable.');
  return result.data;
}

export interface FreeEventDraft {
  title: string; location: string; startAtMs: number; opensAtMs: number;
  closesAtMs: number; capacity: number;
}
export interface AdministrationStatus {
  capabilities: {
    membershipApproval: boolean; freeEventManagement: boolean; duesRecording?: boolean;
    membershipAssociation?: boolean;
  };
  pending: Array<{ uid: string; revision: number; applicationStatus: string }>;
  nextCursor: string | null;
  events: Array<FreeEventDraft & {
    id: string; revision: number; status: string; confirmedCount: number;
  }>;
  dues?: Array<{ membershipId: string; amountCents: number; currency: string; method: string;
    termId: string; startsAtMs: number; endsAtMs: number; linked: boolean }>;
  duesPolicy?: { revision: number; amountCents: number; currency: string; method: string;
    termId: string; startsAtMs: number; endsAtMs: number } | null;
  duesRecordingOpen?: boolean;
  nextDuesCursor?: string | null;
}
export interface AdministrationRequest {
  action: 'admin_status' | 'admin_membership_approve' | 'admin_event_create' | 'admin_event_edit'
    | 'admin_event_capacity' | 'admin_event_open' | 'admin_event_close' | 'admin_event_cancel'
    | 'admin_dues_record' | 'admin_dues_link';
  accountUid: string; requestId?: string; expectedRevision?: number;
  reason?: 'synthetic_staging_review'; targetUid?: string; eventId?: string;
  event?: FreeEventDraft; capacity?: number; cursor?: string;
  confirmationId?: string; externalConfirmed?: true; policyRevision?: number; duesCursor?: string;
  membershipId?: string; associationConfirmed?: true;
}
export async function callAdministration(functions: Functions, request: AdministrationRequest) {
  if (!COMMUNITY_ENABLED || functions.app.options.projectId !== 'run-mprc-staging') {
    throw new Error('Community staging is unavailable.');
  }
  return (await httpsCallable<AdministrationRequest, AdministrationStatus>(functions, 'communityActions')(request)).data;
}
