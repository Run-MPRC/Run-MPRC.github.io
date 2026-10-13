import {
 RaceCommand, RaceStatus, RACE_POLICY, RACE_WAIVER
} from '../fictionalRaceService';

export const uid = 'stage_race_test_owner';
export const recipient = 'stage_race_test_recipient';
export const entryId = 'stage_race_test_entry';
export const now = 1800000000000;
export function state(kind: 'none' | 'confirmed' | 'offered' | 'cancelled' | 'incoming' | 'transferred' = 'none'): RaceStatus {
  const own = kind !== 'none' && kind !== 'incoming';
  const offered = kind === 'offered' || kind === 'incoming';
  const cancelled = kind === 'cancelled';
  let enrollmentStatus: 'transferred' | 'cancelled' | 'confirmed' = 'confirmed';
  if (kind === 'transferred') enrollmentStatus = 'transferred'; else if (cancelled) enrollmentStatus = 'cancelled';
  const entry = {
    entryId,
    revision: offered || cancelled ? 2 : 1,
    bibId: 'stage_race_test_bib',
    status: cancelled ? 'cancelled' as const : 'confirmed' as const,
    fictionalAmountCents: 1000,
    fictionalReturnedCents: cancelled ? 1000 : 0,
    isCurrentRunner: kind !== 'incoming' && kind !== 'transferred',
    isOriginalCreditOwner: kind !== 'incoming',
    transferCount: kind === 'transferred' ? 1 as const : 0 as const,
    offerExpiresAtMs: offered ? now + 5000 : null,
    canCancel: !offered && !cancelled && kind !== 'transferred',
    canOffer: !offered && !cancelled && kind !== 'transferred',
    canRevoke: kind === 'offered'
  };
  return {
    schemaVersion: 1,
    simulationOnly: true,
    policyVersion: RACE_POLICY,
    observedAtMs: now,
    accessExpiresAtMs: now + 10000,
    events: [{
      eventId: 'stage_race_test_race',
      revision: own || offered ? 2 : 1,
      startAtMs: now + 20000,
      opensAtMs: now - 1000,
      closesAtMs: now + 10000,
      signupStatus: kind === 'incoming' ? 'full' : 'open',
      fictionalAmountCents: 1000,
      currency: 'USD',
      waiverVersion: RACE_WAIVER,
      joinEntryId: own ? null : 'stage_race_new_entry',
      canJoin: kind === 'none',
      enrollment: own ? {
        status: enrollmentStatus,
        revision: 1
      } : null,
      entry: own ? entry : null
    }],
    incoming: kind === 'incoming' ? {
      ...entry,
      eventId: 'stage_race_test_race',
      eventRevision: 2,
      canAccept: true
    } : null
  };
}
export function command(action: RaceCommand['action'] = 'race_join'): RaceCommand {
  return {
    action,
    accountUid: uid,
    eventId: 'stage_race_test_race',
    entryId,
    requestId: '123e4567-e89b-42d3-a456-426614174000',
    expectedEventRevision: 1,
    expectedEntryRevision: action === 'race_join' ? 0 : 1,
    ...(action === 'race_join' || action === 'race_accept' ? {
      waiverAccepted: true,
      waiverVersion: RACE_WAIVER
    } : {}),
    ...(action === 'race_offer' ? {
      recipientUid: recipient
    } : {})
  };
}
export function result(request: RaceCommand) {
  const mapping = {
    race_join: 'join_simulation',
    race_cancel: 'simulate_refund',
    race_offer: 'offer_transfer',
    race_accept: 'accept_transfer',
    race_revoke: 'revoke_transfer'
  };
  return {
    schemaVersion: 1,
    simulationOnly: true,
    action: mapping[request.action],
    eventId: request.eventId,
    entryId: request.entryId,
    entryRevision: request.expectedEntryRevision + 1,
    eventRevision: request.expectedEventRevision + (['race_join', 'race_cancel'].includes(request.action) ? 1 : 0),
    offerExpiresAtMs: request.action === 'race_offer' ? now + 5000 : null
  };
}
