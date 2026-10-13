const { randomUUID } = require('node:crypto');
const { POLICY, WAIVER, raceEnrollmentId } = require('../fictionalRaceTransitions');
const ROOTS = ['communityRaceEvents', 'communityRacePolicies', 'communityRaceEntries', 'communityRaceEnrollment',
  'communityRaceTargets', 'communityRacePermissions', 'communityRaceCommands', 'communityRaceAudit', 'communityRaceLimits'];
const ENV = { GCLOUD_PROJECT: 'demo-mprc-local', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' };
const eventId = 'stage_race_fixture';
function event(now, capacity = 1) {
  return { schemaVersion: 1, simulationOnly: true, policyVersion: POLICY, eventId, revision: 1,
    startAtMs: now + 3600000, status: 'open', capacity, confirmedCount: 0 };
}
function policy(now) {
  return { schemaVersion: 1, simulationOnly: true, policyVersion: POLICY, eventId, revision: 1,
    fictionalAmountCents: 1000, currency: 'USD', waiverVersion: WAIVER, opensAtMs: now - 1000, closesAtMs: now + 1800000 };
}
function marker(uid, now) {
  return { schemaVersion: 1, simulationOnly: true, enabled: true, uid, revision: 1, expiresAtMs: now + 7200000 };
}
const permission = (uid, now) => ({ ...marker(uid, now), manageOwnEntry: true });
const token = now => ({ email_verified: true, auth_time: Math.floor(now / 1000), firebase: { sign_in_provider: 'password' } });
function command(uid, action = 'join_simulation', extra = {}) {
  return { accountUid: uid, action, eventId, entryId: raceEnrollmentId(eventId, uid),
    requestId: randomUUID(), expectedEventRevision: 1, expectedEntryRevision: 0,
    ...(action === 'join_simulation' || action === 'accept_transfer' ? { waiverAccepted: true, waiverVersion: WAIVER } : {}), ...extra };
}
module.exports = { ROOTS, ENV, eventId, event, policy, marker, permission, token, command };
