import { httpsCallable, Functions } from 'firebase/functions';

export const COMMUNITY_ENABLED = process.env.REACT_APP_FIREBASE_ENVIRONMENT === 'staging'
  && process.env.REACT_APP_COMMUNITY_STAGING === 'true';

export interface CommunityStatus {
  membership: {
    revision: number; applicationStatus: string;
    entitlement: string; accessThroughMs: number | null;
  };
  events: Array<{
    id: string; title: string; location: string; startAtMs: number; status: string;
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
export async function callCommunity(functions: Functions, request: CommunityRequest) {
  if (!COMMUNITY_ENABLED || functions.app.options.projectId !== 'run-mprc-staging') {
    throw new Error('Community staging is unavailable.');
  }
  return (await httpsCallable<CommunityRequest, CommunityStatus>(functions, 'communityActions')(request)).data;
}

export interface FreeEventDraft {
  title: string; location: string; startAtMs: number; opensAtMs: number;
  closesAtMs: number; capacity: number;
}
export interface AdministrationStatus {
  capabilities: { membershipApproval: boolean; freeEventManagement: boolean };
  pending: Array<{ uid: string; revision: number; applicationStatus: string }>;
  nextCursor: string | null;
  events: Array<FreeEventDraft & {
    id: string; revision: number; status: string; confirmedCount: number;
  }>;
}
export interface AdministrationRequest {
  action: 'admin_status' | 'admin_membership_approve' | 'admin_event_create' | 'admin_event_edit'
    | 'admin_event_capacity' | 'admin_event_open' | 'admin_event_close' | 'admin_event_cancel';
  accountUid: string; requestId?: string; expectedRevision?: number;
  reason?: 'synthetic_staging_review'; targetUid?: string; eventId?: string;
  event?: FreeEventDraft; capacity?: number; cursor?: string;
}
export async function callAdministration(functions: Functions, request: AdministrationRequest) {
  if (!COMMUNITY_ENABLED || functions.app.options.projectId !== 'run-mprc-staging') {
    throw new Error('Community staging is unavailable.');
  }
  return (await httpsCallable<AdministrationRequest, AdministrationStatus>(functions, 'communityActions')(request)).data;
}
