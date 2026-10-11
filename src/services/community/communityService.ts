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
