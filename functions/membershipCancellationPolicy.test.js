'use strict';

const policy = require('./membershipCancellationPolicy.json');
const {
  createMembershipAuthority,
  applyMembershipAuthorityCommand,
  deriveMembershipEntitlement,
} = require('./membershipAuthority');

// These regressions pin the approved policy and the existing authority seam.
// They do NOT execute a cancellation command or prove persistence or deployment.
const START = 1_000_000;
const END = 2_000_000;
const UID = 'uid_cancellation_fixture';

function membership(termState = 'approved', linked = true) {
  let record = createMembershipAuthority({
    membershipAuthoritySchemaVersion: 1,
    membershipId: 'mbr_cancellation_fixture',
    commandId: 'cmd_create_fixture',
  });
  record = applyMembershipAuthorityCommand(record, {
    membershipAuthoritySchemaVersion: 1,
    commandType: 'record_term_decision',
    commandId: 'cmd_term_fixture',
    expectedRevision: 1,
    termRevision: 1,
    termState,
    termId: 'term_cancellation_fixture',
    startsAtMs: START,
    endsAtMs: END,
    planRef: 'plan_fixture',
    evidenceRef: 'evidence_fixture',
    policyVersion: policy.policyVersion,
  });
  if (linked) {
    record = applyMembershipAuthorityCommand(record, {
      membershipAuthoritySchemaVersion: 1,
      commandType: 'associate_account',
      commandId: 'cmd_link_fixture',
      expectedRevision: 2,
      uid: UID,
    });
  }
  return record;
}

function entitlement(record, asOfMs, uid = UID) {
  return deriveMembershipEntitlement({
    membershipAuthoritySchemaVersion: 1, record, uid, asOfMs,
  }).entitlement;
}

describe('owner-approved membership cancellation policy (source only)', () => {
  test('pins a versioned paid-term-end rule with no automatic refund', () => {
    expect(policy).toEqual({
      schemaVersion: 1,
      policyVersion: 'mprc-membership-cancellation-2026-10-11-v1',
      accessEndsAt: 'paid_term_end',
      automaticRefund: false,
    });
  });

  test.each([
    [START - 1, 'not_entitled'],
    [START, 'current_member'],
    [END - 1, 'current_member'],
    [END, 'not_entitled'],
    [END + 1, 'not_entitled'],
  ])('existing paid term at %i returns %s without rewriting it', (instant, expected) => {
    const record = membership();
    expect(entitlement(record, instant)).toBe(expected);
    expect(record.term.state).toBe('approved');
    expect(record.term.endsAtMs).toBe(END);
    expect(record.revision).toBe(3);
  });

  test('repeated evaluation never extends the paid term or changes evidence', () => {
    const record = membership();
    const before = JSON.stringify(record);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(entitlement(record, END - 1)).toBe('current_member');
      expect(entitlement(record, END)).toBe('not_entitled');
    }
    expect(JSON.stringify(record)).toBe(before);
  });

  test.each(['suspended', 'ended'])('does not revive a %s term', (state) => {
    expect(entitlement(membership(state), END - 1)).toBe('not_entitled');
  });

  test('does not confer access to a different account', () => {
    expect(entitlement(membership(), END - 1, 'uid_other_fixture')).toBe('not_entitled');
  });

  test('does not confer access to an unlinked membership', () => {
    expect(entitlement(membership('approved', false), END - 1)).toBe('not_entitled');
  });

  test('does not convert a pending decision into a paid membership', () => {
    expect(entitlement(membership('decision_pending'), END - 1)).toBe('decision_pending');
  });

  test.each([START, Number.NaN, Number.MAX_SAFE_INTEGER])(
    'rejects a malformed term end instead of granting access (%s)', (endsAtMs) => {
      const record = membership();
      const malformed = { ...record, term: { ...record.term, endsAtMs } };
      expect(() => entitlement(malformed, END - 1)).toThrow();
    },
  );
});
