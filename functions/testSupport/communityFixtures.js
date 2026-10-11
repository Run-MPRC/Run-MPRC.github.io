const { createHash } = require('node:crypto');
const { createMembershipAuthority, applyMembershipAuthorityCommand } = require('../membershipAuthority');

function freeEvent(now, overrides = {}) {
  const waiverText = 'SYNTHETIC STAGING TEST ONLY. Not an approved club waiver or real event.';
  return {
    schemaVersion: 1, title: 'Disposable staging run', location: 'Synthetic test location',
    startAtMs: now + 3600000, opensAtMs: now - 1000, closesAtMs: now + 1800000,
    status: 'open', amountCents: 0, capacity: 1, confirmedCount: 0,
    waiverVersion: 'synthetic-only-v1', waiverText,
    waiverHash: createHash('sha256').update(waiverText).digest('hex'), ...overrides,
  };
}

function approvedMember(uid, now) {
  let authority = createMembershipAuthority({ membershipAuthoritySchemaVersion: 1, membershipId: 'mbr_synthetic_only', commandId: 'cmd_synthetic_create' });
  authority = applyMembershipAuthorityCommand(authority, {
    membershipAuthoritySchemaVersion: 1, commandType: 'associate_account',
    commandId: 'cmd_synthetic_link', expectedRevision: 1, uid,
  });
  authority = applyMembershipAuthorityCommand(authority, {
    membershipAuthoritySchemaVersion: 1, commandType: 'record_term_decision',
    commandId: 'cmd_synthetic_term', expectedRevision: 2, termRevision: 1,
    termState: 'approved', termId: 'term_synthetic_only', startsAtMs: now - 1000,
    endsAtMs: now + 60000, planRef: 'plan_synthetic_only', evidenceRef: 'evidence_synthetic_only',
    policyVersion: 'synthetic-only-not-payment-evidence',
  });
  return { schemaVersion: 1, revision: 1, applicationStatus: 'approved', authority };
}
module.exports = { freeEvent, approvedMember };
