'use strict';

const fs = require('fs');
const path = require('path');

const mod = require('./membershipAssociation');
const {
  membershipAdminSchemaVersion,
  MembershipStatus,
  LinkState,
  Collision,
  AdminCapability,
  CommandType,
  AssociationDecision,
  AssociationGrantReason,
  AssociationReviewReason,
  AssociationDenialReason,
  EntitlementAction,
  classifyMembershipAssociation,
} = mod;
const {
  createMembershipAuthority,
  applyMembershipAuthorityCommand,
  deriveMembershipEntitlement,
} = require('./membershipAuthority');

// ---- fixtures ------------------------------------------------------------

const NOW = '2026-07-21T12:00:00Z';
const FUTURE = '2026-12-31T23:59:59Z'; // a deadline after NOW (fresh command)
const PAST = '2026-01-01T00:00:00Z'; // a deadline at/before NOW (stale command)

function membership(overrides = {}) {
  return {
    membershipId: 'mem.2026.001',
    status: 'active',
    term: '2026',
    duesConfirmed: true,
    linkState: 'unlinked',
    linkedUid: null,
    ...overrides,
  };
}

function account(overrides = {}) {
  return {
    uid: 'uid.alice.001',
    emailVerified: true,
    linkedMembershipId: null,
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    membershipAdminSchemaVersion: 1,
    membership: membership(),
    account: account(),
    collision: 'none',
    ...overrides,
  };
}

function command(overrides = {}) {
  return {
    membershipAdminSchemaVersion: 1,
    type: 'associate_identity',
    commandId: 'cmd.assoc.0001',
    actor: 'officer.jane.001',
    capability: 'membership_associator',
    recentAuthSatisfied: true,
    membershipId: 'mem.2026.001',
    targetUid: 'uid.alice.001',
    expectedTerm: '2026',
    expectedMembershipLinkState: 'unlinked',
    asOf: NOW,
    deadline: FUTURE,
    ...overrides,
  };
}

const codeOnly = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');

const rawSource = fs.readFileSync(path.join(__dirname, 'membershipAssociation.js'), 'utf8');
const sourceCode = codeOnly(rawSource);

// ---- 1. frozen surface & enums ------------------------------------------

describe('frozen surface & enums', () => {
  test('schema version is 1', () => {
    expect(membershipAdminSchemaVersion).toBe(1);
  });

  test('module is frozen', () => {
    expect(Object.isFrozen(mod)).toBe(true);
  });

  test('classifyMembershipAssociation is a function', () => {
    expect(typeof classifyMembershipAssociation).toBe('function');
  });

  test('MembershipStatus is complete and frozen', () => {
    expect(Object.isFrozen(MembershipStatus)).toBe(true);
    expect(new Set(Object.values(MembershipStatus))).toEqual(new Set(['active', 'lapsed', 'suspended']));
  });

  test('LinkState is complete and frozen', () => {
    expect(Object.isFrozen(LinkState)).toBe(true);
    expect(new Set(Object.values(LinkState))).toEqual(new Set(['unlinked', 'linked']));
  });

  test('Collision is complete and frozen', () => {
    expect(Object.isFrozen(Collision)).toBe(true);
    expect(new Set(Object.values(Collision))).toEqual(new Set([
      'none', 'duplicate_account', 'email_changed', 'household_overlap', 'contact_email_conflict',
    ]));
  });

  test('AdminCapability is complete and frozen', () => {
    expect(Object.isFrozen(AdminCapability)).toBe(true);
    expect(new Set(Object.values(AdminCapability)))
      .toEqual(new Set(['membership_associator', 'dues_recorder', 'role_admin']));
  });

  test('CommandType is complete and frozen', () => {
    expect(Object.isFrozen(CommandType)).toBe(true);
    expect(new Set(Object.values(CommandType))).toEqual(new Set(['associate_identity', 'record_dues']));
  });

  test('AssociationDecision is complete and frozen', () => {
    expect(Object.isFrozen(AssociationDecision)).toBe(true);
    expect(new Set(Object.values(AssociationDecision))).toEqual(new Set(['associate', 'review', 'denied']));
  });

  test('AssociationGrantReason is complete and frozen', () => {
    expect(Object.isFrozen(AssociationGrantReason)).toBe(true);
    expect(new Set(Object.values(AssociationGrantReason))).toEqual(new Set(['associated', 'already_associated']));
  });

  test('AssociationReviewReason is exactly the collisions other than none', () => {
    expect(Object.isFrozen(AssociationReviewReason)).toBe(true);
    expect(new Set(Object.values(AssociationReviewReason))).toEqual(new Set([
      'duplicate_account', 'email_changed', 'household_overlap', 'contact_email_conflict',
    ]));
    expect(Object.values(AssociationReviewReason)).not.toContain('none');
  });

  test('AssociationDenialReason is complete and frozen', () => {
    expect(Object.isFrozen(AssociationDenialReason)).toBe(true);
    expect(new Set(Object.values(AssociationDenialReason))).toEqual(new Set([
      'malformed_state', 'malformed_command', 'unsupported_command', 'capability_denied',
      'recent_auth_required', 'command_stale', 'account_missing', 'email_unverified',
      'membership_not_found', 'membership_not_active', 'dues_unconfirmed', 'wrong_term',
      'membership_linked_elsewhere', 'uid_linked_elsewhere', 'state_conflict',
    ]));
  });

  test('EntitlementAction is complete and frozen', () => {
    expect(Object.isFrozen(EntitlementAction)).toBe(true);
    expect(new Set(Object.values(EntitlementAction))).toEqual(new Set(['derive_membership_claim']));
  });
});

// ---- 2. happy-path association ------------------------------------------

describe('happy-path association', () => {
  test('a capable, recently-authed officer associates a verified account to an active dues-confirmed unlinked membership', () => {
    const verdict = classifyMembershipAssociation(state(), command());
    expect(verdict).toEqual({
      decision: 'associate',
      reason: 'associated',
      next: {
        membershipId: 'mem.2026.001',
        linkedUid: 'uid.alice.001',
        linkState: 'linked',
        term: '2026',
        entitlementAction: 'derive_membership_claim',
      },
    });
  });

  test('a future trusted caller can translate an authorized verdict after a term-first decision', () => {
    const unlinked = createMembershipAuthority({
      membershipAuthoritySchemaVersion: 1,
      membershipId: 'mem.2026.001',
      commandId: 'cmd.create.0001',
    });
    const approved = applyMembershipAuthorityCommand(unlinked, {
      membershipAuthoritySchemaVersion: 1,
      commandType: 'record_term_decision',
      commandId: 'cmd.term.0001',
      expectedRevision: 1,
      termRevision: 1,
      termState: 'approved',
      termId: '2026',
      startsAtMs: 1_000_000,
      endsAtMs: 2_000_000,
      planRef: 'plan.annual.001',
      evidenceRef: 'evidence.dues.001',
      policyVersion: 'policy.001',
    });
    const association = command();
    const associationState = state({
      membership: membership({
        membershipId: approved.membershipId,
        term: approved.term.termId,
        // This is separate trusted evidence. The authority term state does not
        // itself verify dues and must never be used to infer this prerequisite.
        duesConfirmed: true,
        linkState: approved.association.state,
        linkedUid: approved.association.uid,
      }),
    });
    const verdict = classifyMembershipAssociation(associationState, association);
    expect(verdict.decision).toBe('associate');

    // The classifier emits no authority command and persists nothing. This models a
    // future trusted caller only after it binds the verdict to the canonical record
    // and reads that record's current revision.
    expect(verdict.next.membershipId).toBe(approved.membershipId);
    const linked = applyMembershipAuthorityCommand(approved, {
      membershipAuthoritySchemaVersion: 1,
      commandType: 'associate_account',
      commandId: association.commandId,
      expectedRevision: approved.revision,
      uid: verdict.next.linkedUid,
    });

    expect(linked.term).toEqual(approved.term);
    expect(deriveMembershipEntitlement({
      membershipAuthoritySchemaVersion: 1,
      record: linked,
      uid: verdict.next.linkedUid,
      asOfMs: 1_000_000,
    }).entitlement).toBe('current_member');
  });

  test('the grant, and its next block, are frozen', () => {
    const verdict = classifyMembershipAssociation(state(), command());
    expect(Object.isFrozen(verdict)).toBe(true);
    expect(Object.isFrozen(verdict.next)).toBe(true);
  });

  test('re-applying the same association to the already-linked holder is idempotent (already_associated)', () => {
    const linked = state({
      membership: membership({ linkState: 'linked', linkedUid: 'uid.alice.001' }),
      account: account({ linkedMembershipId: 'mem.2026.001' }),
    });
    const verdict = classifyMembershipAssociation(linked, command());
    expect(verdict.decision).toBe('associate');
    expect(verdict.reason).toBe('already_associated');
    expect(verdict.next.linkedUid).toBe('uid.alice.001');
  });

  test('the grant next block carries exactly five keys and no payment/amount/role field', () => {
    const verdict = classifyMembershipAssociation(state(), command());
    expect(Object.keys(verdict.next).sort()).toEqual(
      ['entitlementAction', 'linkState', 'linkedUid', 'membershipId', 'term'],
    );
    // The grant carries no payment figure of any kind — association never fabricates
    // payment state; it only signals a claim-derivation for the caller to run later.
    expect(JSON.stringify(verdict.next)).not.toMatch(/amount|payment|price|cents/i);
    expect(verdict.next.entitlementAction).toBe('derive_membership_claim');
  });

  test('a membership expiring exactly at the deadline instant still associates when the command is fresh', () => {
    // asOf strictly before deadline is the freshness rule; the membership term itself
    // is a label, not a timestamp, so only the command deadline gates freshness.
    const verdict = classifyMembershipAssociation(state(), command({ asOf: NOW, deadline: '2026-07-21T12:00:01Z' }));
    expect(verdict.decision).toBe('associate');
  });
});

// ---- 3. ambiguity is routed to explicit review, never auto-associated ----

describe('collision routes to explicit review', () => {
  test.each([
    'duplicate_account',
    'email_changed',
    'household_overlap',
    'contact_email_conflict',
  ])('collision %s on an otherwise-associable command is reviewed, not associated', (collision) => {
    const verdict = classifyMembershipAssociation(state({ collision }), command());
    expect(verdict).toEqual({ decision: 'review', reason: collision });
  });

  test('no collision (none) is the only value that permits an association', () => {
    expect(classifyMembershipAssociation(state({ collision: 'none' }), command()).decision).toBe('associate');
  });

  test('a review verdict carries exactly a decision and a reason and no next block', () => {
    const verdict = classifyMembershipAssociation(state({ collision: 'household_overlap' }), command());
    expect(Object.keys(verdict).sort()).toEqual(['decision', 'reason']);
    expect(verdict).not.toHaveProperty('next');
  });
});

// ---- 4. denials (withhold-by-default) -----------------------------------

describe('denials', () => {
  test('an unsupported (recognized-but-unhandled) command type is denied unsupported_command', () => {
    const verdict = classifyMembershipAssociation(state(), command({ type: 'record_dues' }));
    expect(verdict).toEqual({ decision: 'denied', reason: 'unsupported_command' });
  });

  test.each([
    ['dues_recorder', 'dues_recorder'],
    ['role_admin', 'role_admin'],
  ])('the %s capability may not associate — capability_denied', (_label, capability) => {
    expect(classifyMembershipAssociation(state(), command({ capability })).reason).toBe('capability_denied');
  });

  test('a command without recent auth is denied recent_auth_required', () => {
    expect(classifyMembershipAssociation(state(), command({ recentAuthSatisfied: false })).reason)
      .toBe('recent_auth_required');
  });

  test('a stale command (asOf at/after deadline) is denied command_stale', () => {
    expect(classifyMembershipAssociation(state(), command({ deadline: PAST })).reason).toBe('command_stale');
  });

  test('a command whose deadline equals asOf is stale (exclusive boundary)', () => {
    expect(classifyMembershipAssociation(state(), command({ deadline: NOW })).reason).toBe('command_stale');
  });

  test('a missing account is denied account_missing', () => {
    expect(classifyMembershipAssociation(state({ account: null }), command()).reason).toBe('account_missing');
  });

  test('an unverified account email is denied email_unverified', () => {
    expect(classifyMembershipAssociation(state({ account: account({ emailVerified: false }) }), command()).reason)
      .toBe('email_unverified');
  });

  test('a missing membership is denied membership_not_found', () => {
    expect(classifyMembershipAssociation(state({ membership: null }), command()).reason).toBe('membership_not_found');
  });

  test.each(['lapsed', 'suspended'])('a %s membership is denied membership_not_active', (status) => {
    expect(classifyMembershipAssociation(state({ membership: membership({ status }) }), command()).reason)
      .toBe('membership_not_active');
  });

  test('a membership without confirmed dues is denied dues_unconfirmed (never fabricates payment state)', () => {
    expect(classifyMembershipAssociation(state({ membership: membership({ duesConfirmed: false }) }), command()).reason)
      .toBe('dues_unconfirmed');
  });

  test('a membership whose term differs from the officer-confirmed term is denied wrong_term', () => {
    const verdict = classifyMembershipAssociation(
      state({ membership: membership({ term: '2025' }) }),
      command({ expectedTerm: '2026' }),
    );
    expect(verdict.reason).toBe('wrong_term');
  });

  test('a membership already linked to a different holder is denied membership_linked_elsewhere', () => {
    const verdict = classifyMembershipAssociation(
      state({ membership: membership({ linkState: 'linked', linkedUid: 'uid.bob.999' }) }),
      command({ targetUid: 'uid.alice.001' }),
    );
    expect(verdict.reason).toBe('membership_linked_elsewhere');
  });

  test('the target UID already linked to a membership is denied uid_linked_elsewhere', () => {
    const verdict = classifyMembershipAssociation(
      state({ account: account({ linkedMembershipId: 'mem.other.777' }) }),
      command(),
    );
    expect(verdict.reason).toBe('uid_linked_elsewhere');
  });

  test('an optimistic-concurrency mismatch on the membership link-state is denied state_conflict', () => {
    const verdict = classifyMembershipAssociation(state(), command({ expectedMembershipLinkState: 'linked' }));
    expect(verdict.reason).toBe('state_conflict');
  });

  test('every denial carries exactly a decision and a reason and no next block', () => {
    const verdict = classifyMembershipAssociation(state({ account: null }), command());
    expect(Object.keys(verdict).sort()).toEqual(['decision', 'reason']);
    expect(verdict).not.toHaveProperty('next');
  });
});

// ---- 5. precedence ordering ---------------------------------------------

describe('precedence: type & authorization before any entity is examined', () => {
  test('an unsupported command type outranks an insufficient capability', () => {
    expect(classifyMembershipAssociation(state(), command({ type: 'record_dues', capability: 'role_admin' })).reason)
      .toBe('unsupported_command');
  });

  test('an insufficient capability outranks a missing account', () => {
    expect(classifyMembershipAssociation(state({ account: null }), command({ capability: 'role_admin' })).reason)
      .toBe('capability_denied');
  });

  test('a missing recent auth outranks a missing account', () => {
    expect(classifyMembershipAssociation(state({ account: null }), command({ recentAuthSatisfied: false })).reason)
      .toBe('recent_auth_required');
  });

  test('a stale command outranks a missing account', () => {
    expect(classifyMembershipAssociation(state({ account: null }), command({ deadline: PAST })).reason)
      .toBe('command_stale');
  });

  test('the account gate outranks the membership gate', () => {
    expect(classifyMembershipAssociation(state({ account: null, membership: null }), command()).reason)
      .toBe('account_missing');
  });

  test('an unverified email outranks a lapsed membership', () => {
    const verdict = classifyMembershipAssociation(
      state({ account: account({ emailVerified: false }), membership: membership({ status: 'lapsed' }) }),
      command(),
    );
    expect(verdict.reason).toBe('email_unverified');
  });

  test('a lapsed membership outranks unconfirmed dues', () => {
    const verdict = classifyMembershipAssociation(
      state({ membership: membership({ status: 'lapsed', duesConfirmed: false }) }),
      command(),
    );
    expect(verdict.reason).toBe('membership_not_active');
  });

  test('unconfirmed dues outranks a wrong term', () => {
    const verdict = classifyMembershipAssociation(
      state({ membership: membership({ duesConfirmed: false, term: '2025' }) }),
      command({ expectedTerm: '2026' }),
    );
    expect(verdict.reason).toBe('dues_unconfirmed');
  });

  test('a hard membership stop outranks a detected collision (a lapsed membership is denied, not reviewed)', () => {
    const verdict = classifyMembershipAssociation(
      state({ membership: membership({ status: 'lapsed' }), collision: 'household_overlap' }),
      command(),
    );
    expect(verdict.reason).toBe('membership_not_active');
  });

  test('an already-linked holder is idempotent even when a collision is now present (link precedes review)', () => {
    const verdict = classifyMembershipAssociation(
      state({
        membership: membership({ linkState: 'linked', linkedUid: 'uid.alice.001' }),
        collision: 'duplicate_account',
      }),
      command(),
    );
    expect(verdict.reason).toBe('already_associated');
  });

  test('an already-linked holder with a now-unverified email is denied email_unverified (account gate precedes link)', () => {
    const verdict = classifyMembershipAssociation(
      state({
        membership: membership({ linkState: 'linked', linkedUid: 'uid.alice.001' }),
        account: account({ emailVerified: false }),
      }),
      command(),
    );
    expect(verdict.reason).toBe('email_unverified');
  });

  test('a UID-linked-elsewhere stop outranks a detected collision', () => {
    const verdict = classifyMembershipAssociation(
      state({ account: account({ linkedMembershipId: 'mem.other.777' }), collision: 'duplicate_account' }),
      command(),
    );
    expect(verdict.reason).toBe('uid_linked_elsewhere');
  });

  test('a state-conflict stop outranks a detected collision', () => {
    const verdict = classifyMembershipAssociation(
      state({ collision: 'duplicate_account' }),
      command({ expectedMembershipLinkState: 'linked' }),
    );
    expect(verdict.reason).toBe('state_conflict');
  });
});

// ---- 6. email is never an authorization input ---------------------------

describe('email is never an authorization input', () => {
  test('the command shape carries no email field (an added email key is malformed_command)', () => {
    expect(classifyMembershipAssociation(state(), command({ email: 'alice@example.com' })).reason)
      .toBe('malformed_command');
  });

  test('the account shape carries no email address, only a verification boolean (an added email key is malformed_state)', () => {
    expect(classifyMembershipAssociation(state({ account: account({ email: 'alice@example.com' }) }), command()).reason)
      .toBe('malformed_state');
  });

  test('the decision is unchanged by which account happens to match an email — it turns solely on the explicit targetUid', () => {
    // Two different target UIDs, same everything else: the one the command explicitly
    // selects is the one that must be present in state; no email matching occurs.
    const forAlice = classifyMembershipAssociation(
      state({ account: account({ uid: 'uid.alice.001' }) }),
      command({ targetUid: 'uid.alice.001' }),
    );
    const forBob = classifyMembershipAssociation(
      state({ account: account({ uid: 'uid.bob.002' }) }),
      command({ targetUid: 'uid.bob.002', membershipId: 'mem.2026.001' }),
    );
    expect(forAlice.next.linkedUid).toBe('uid.alice.001');
    expect(forBob.next.linkedUid).toBe('uid.bob.002');
  });
});

// ---- 7. malformed command -----------------------------------------------

describe('malformed command is denied malformed_command', () => {
  const st = state();

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['a string', 'associate_identity'],
    ['an array', [1, 2, 3]],
    ['a boolean', true],
  ])('%s', (_label, value) => {
    expect(classifyMembershipAssociation(st, value)).toEqual({ decision: 'denied', reason: 'malformed_command' });
  });

  test('a Proxy over a valid command', () => {
    expect(classifyMembershipAssociation(st, new Proxy(command(), {})).reason).toBe('malformed_command');
  });

  test('a foreign-prototype command', () => {
    const foreign = Object.assign(Object.create({ inherited: 1 }), command());
    expect(classifyMembershipAssociation(st, foreign).reason).toBe('malformed_command');
  });

  test('a null-prototype command', () => {
    const nullProto = Object.assign(Object.create(null), command());
    expect(classifyMembershipAssociation(st, nullProto).reason).toBe('malformed_command');
  });

  test('a command missing a required key', () => {
    const c = command();
    delete c.targetUid;
    expect(classifyMembershipAssociation(st, c).reason).toBe('malformed_command');
  });

  test('a command with an extra key', () => {
    expect(classifyMembershipAssociation(st, command({ extra: 1 })).reason).toBe('malformed_command');
  });

  test('a command with a symbol key', () => {
    const c = command();
    c[Symbol('x')] = 1;
    expect(classifyMembershipAssociation(st, c).reason).toBe('malformed_command');
  });

  test('a command whose field is a getter — the getter is never invoked', () => {
    let invoked = false;
    const c = command();
    delete c.capability;
    Object.defineProperty(c, 'capability', {
      enumerable: true, configurable: true, get() { invoked = true; return 'membership_associator'; },
    });
    expect(classifyMembershipAssociation(st, c).reason).toBe('malformed_command');
    expect(invoked).toBe(false);
  });

  test('a command with a non-enumerable field', () => {
    const c = command();
    delete c.recentAuthSatisfied;
    Object.defineProperty(c, 'recentAuthSatisfied', { enumerable: false, value: true });
    expect(classifyMembershipAssociation(st, c).reason).toBe('malformed_command');
  });

  // Regression (adversarial review, LOW): an EXTRA non-enumerable own key is
  // invisible to Object.keys, yet the record must still deny — the exact closed
  // shape is bounded by own property NAMES, not just enumerable keys.
  test('a command with an extra non-enumerable key', () => {
    const c = command();
    Object.defineProperty(c, 'shadow', { enumerable: false, configurable: true, value: 'x' });
    expect(classifyMembershipAssociation(st, c).reason).toBe('malformed_command');
  });

  test('a command with an extra non-enumerable throwing accessor — never throws, never invoked', () => {
    let invoked = false;
    const c = command();
    Object.defineProperty(c, 'shadow', {
      enumerable: false, configurable: true, get() { invoked = true; throw new Error('trap'); },
    });
    let verdict;
    expect(() => { verdict = classifyMembershipAssociation(st, c); }).not.toThrow();
    expect(verdict.reason).toBe('malformed_command');
    expect(invoked).toBe(false);
  });

  test.each([
    ['wrong schema version 0', { membershipAdminSchemaVersion: 0 }],
    ['wrong schema version 2', { membershipAdminSchemaVersion: 2 }],
    ['string schema version', { membershipAdminSchemaVersion: '1' }],
    ['type off-enum', { type: 'frobnicate' }],
    ['type non-string', { type: 1 }],
    ['commandId empty', { commandId: '' }],
    ['commandId with spaces', { commandId: 'cmd 1' }],
    ['commandId non-string', { commandId: 5 }],
    ['actor all-digits (no letter)', { actor: '1234567890' }],
    ['actor empty', { actor: '' }],
    ['actor non-string', { actor: 5 }],
    ['capability off-enum', { capability: 'superuser' }],
    ['capability non-string', { capability: 1 }],
    ['recentAuthSatisfied truthy non-boolean', { recentAuthSatisfied: 1 }],
    ['recentAuthSatisfied string', { recentAuthSatisfied: 'true' }],
    ['membershipId all-digits (no letter)', { membershipId: '20260001' }],
    ['membershipId empty', { membershipId: '' }],
    ['membershipId non-string', { membershipId: 5 }],
    ['targetUid all-digits (no letter)', { targetUid: '5551234567' }],
    ['targetUid empty', { targetUid: '' }],
    ['targetUid with spaces', { targetUid: 'uid alice' }],
    ['expectedTerm empty', { expectedTerm: '' }],
    ['expectedTerm too long', { expectedTerm: 'x'.repeat(65) }],
    ['expectedTerm with spaces', { expectedTerm: 'FY 2026' }],
    ['expectedTerm non-string', { expectedTerm: 2026 }],
    ['expectedMembershipLinkState off-enum', { expectedMembershipLinkState: 'partial' }],
    ['expectedMembershipLinkState non-string', { expectedMembershipLinkState: 1 }],
    ['asOf null', { asOf: null }],
    ['asOf malformed', { asOf: '2026-07-21 12:00:00' }],
    ['asOf out-of-range hour', { asOf: '2026-07-21T24:00:00Z' }],
    ['asOf out-of-range month', { asOf: '2026-13-01T00:00:00Z' }],
    ['deadline null', { deadline: null }],
    ['deadline malformed', { deadline: 'tomorrow' }],
    ['deadline number', { deadline: 1 }],
  ])('%s', (_label, overrides) => {
    expect(classifyMembershipAssociation(st, command(overrides)).reason).toBe('malformed_command');
  });
});

// ---- 8. malformed state -------------------------------------------------

describe('malformed state is denied malformed_state', () => {
  const cmd = command();

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['a string', 'state'],
    ['an array', [1, 2, 3]],
    ['a boolean', true],
  ])('%s', (_label, value) => {
    expect(classifyMembershipAssociation(value, cmd)).toEqual({ decision: 'denied', reason: 'malformed_state' });
  });

  test('a Proxy over a valid state', () => {
    expect(classifyMembershipAssociation(new Proxy(state(), {}), cmd).reason).toBe('malformed_state');
  });

  test('a foreign-prototype state', () => {
    const foreign = Object.assign(Object.create({ inherited: 1 }), state());
    expect(classifyMembershipAssociation(foreign, cmd).reason).toBe('malformed_state');
  });

  test('a state missing a required key', () => {
    const s = state();
    delete s.collision;
    expect(classifyMembershipAssociation(s, cmd).reason).toBe('malformed_state');
  });

  test('a state with an extra key', () => {
    expect(classifyMembershipAssociation(state({ extra: 1 }), cmd).reason).toBe('malformed_state');
  });

  // Regression (adversarial review, LOW): extra non-enumerable own key on the
  // state envelope must also deny.
  test('a state with an extra non-enumerable key', () => {
    const s = state();
    Object.defineProperty(s, 'shadow', { enumerable: false, configurable: true, value: 'x' });
    expect(classifyMembershipAssociation(s, cmd).reason).toBe('malformed_state');
  });

  test('a state with a symbol key', () => {
    const s = state();
    s[Symbol('x')] = 1;
    expect(classifyMembershipAssociation(s, cmd).reason).toBe('malformed_state');
  });

  test('a state whose field is a getter — the getter is never invoked', () => {
    let invoked = false;
    const s = state();
    delete s.collision;
    Object.defineProperty(s, 'collision', {
      enumerable: true, configurable: true, get() { invoked = true; return 'none'; },
    });
    expect(classifyMembershipAssociation(s, cmd).reason).toBe('malformed_state');
    expect(invoked).toBe(false);
  });

  test.each([
    ['wrong schema version', { membershipAdminSchemaVersion: 2 }],
    ['collision off-enum', { collision: 'maybe' }],
    ['collision non-string', { collision: 1 }],
    ['membership is a number', { membership: 5 }],
    ['membership is a string', { membership: 'mem' }],
    ['membership is an array', { membership: [] }],
    ['account is a number', { account: 5 }],
    ['account is a string', { account: 'acct' }],
    ['account is an array', { account: [] }],
  ])('%s', (_label, overrides) => {
    expect(classifyMembershipAssociation(state(overrides), cmd).reason).toBe('malformed_state');
  });

  test('a proxy membership sub-record', () => {
    expect(classifyMembershipAssociation(state({ membership: new Proxy(membership(), {}) }), cmd).reason)
      .toBe('malformed_state');
  });

  test('a proxy account sub-record', () => {
    expect(classifyMembershipAssociation(state({ account: new Proxy(account(), {}) }), cmd).reason)
      .toBe('malformed_state');
  });

  test.each([
    ['membership missing key', (() => { const m = membership(); delete m.term; return m; })()],
    ['membership extra key', membership({ surprise: 1 })],
    ['membership extra non-enumerable key', (() => {
      const m = membership();
      Object.defineProperty(m, 'shadow', { enumerable: false, configurable: true, value: 1 });
      return m;
    })()],
    ['membership bad membershipId (all-digits)', membership({ membershipId: '20260001' })],
    ['membership empty membershipId', membership({ membershipId: '' })],
    ['membership bad status enum', membership({ status: 'gold' })],
    ['membership bad term (spaces)', membership({ term: 'FY 2026' })],
    ['membership duesConfirmed non-boolean', membership({ duesConfirmed: 'yes' })],
    ['membership linkState off-enum', membership({ linkState: 'partial' })],
    ['membership linked but linkedUid null (incoherent)', membership({ linkState: 'linked', linkedUid: null })],
    ['membership unlinked but linkedUid set (incoherent)', membership({ linkState: 'unlinked', linkedUid: 'uid.x.1' })],
    ['membership linked with all-digit linkedUid', membership({ linkState: 'linked', linkedUid: '999999' })],
  ])('a bad membership sub-record (%s) makes the whole state malformed', (_label, m) => {
    expect(classifyMembershipAssociation(state({ membership: m }), cmd).reason).toBe('malformed_state');
  });

  test.each([
    ['account missing key', (() => { const a = account(); delete a.uid; return a; })()],
    ['account extra key', account({ surprise: 1 })],
    ['account extra non-enumerable key', (() => {
      const a = account();
      Object.defineProperty(a, 'shadow', { enumerable: false, configurable: true, value: 1 });
      return a;
    })()],
    ['account bad uid (all-digits)', account({ uid: '5551234567' })],
    ['account empty uid', account({ uid: '' })],
    ['account emailVerified non-boolean', account({ emailVerified: 'yes' })],
    ['account linkedMembershipId non-null non-identity (empty)', account({ linkedMembershipId: '' })],
    ['account linkedMembershipId all-digits', account({ linkedMembershipId: '777' })],
  ])('a bad account sub-record (%s) makes the whole state malformed', (_label, a) => {
    expect(classifyMembershipAssociation(state({ account: a }), cmd).reason).toBe('malformed_state');
  });

  test('a membership sub-record whose field is a getter is never invoked', () => {
    let invoked = false;
    const m = membership();
    delete m.status;
    Object.defineProperty(m, 'status', {
      enumerable: true, configurable: true, get() { invoked = true; return 'active'; },
    });
    expect(classifyMembershipAssociation(state({ membership: m }), cmd).reason).toBe('malformed_state');
    expect(invoked).toBe(false);
  });

  test('an account sub-record whose field is a getter is never invoked', () => {
    let invoked = false;
    const a = account();
    delete a.emailVerified;
    Object.defineProperty(a, 'emailVerified', {
      enumerable: true, configurable: true, get() { invoked = true; return true; },
    });
    expect(classifyMembershipAssociation(state({ account: a }), cmd).reason).toBe('malformed_state');
    expect(invoked).toBe(false);
  });
});

// ---- 9. coherence: state must describe the explicitly selected entities --

describe('coherence between the command selection and the state records', () => {
  test('a membership whose id differs from the command selection is malformed_state', () => {
    const verdict = classifyMembershipAssociation(
      state({ membership: membership({ membershipId: 'mem.other.999' }) }),
      command({ membershipId: 'mem.2026.001' }),
    );
    expect(verdict.reason).toBe('malformed_state');
  });

  test('an account whose uid differs from the command target is malformed_state', () => {
    const verdict = classifyMembershipAssociation(
      state({ account: account({ uid: 'uid.other.999' }) }),
      command({ targetUid: 'uid.alice.001' }),
    );
    expect(verdict.reason).toBe('malformed_state');
  });
});

// ---- 10. hostile proxy / accessor inputs never throw or invoke getters ---

describe('hostile proxy / accessor inputs never throw and never invoke getters', () => {
  test('a revoked proxy command is denied malformed_command without throwing', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    let verdict;
    expect(() => { verdict = classifyMembershipAssociation(state(), proxy); }).not.toThrow();
    expect(verdict).toEqual({ decision: 'denied', reason: 'malformed_command' });
  });

  test('a revoked proxy state is denied malformed_state without throwing', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    let verdict;
    expect(() => { verdict = classifyMembershipAssociation(proxy, command()); }).not.toThrow();
    expect(verdict).toEqual({ decision: 'denied', reason: 'malformed_state' });
  });

  test('a revoked proxy membership sub-record is denied malformed_state without throwing', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    let verdict;
    expect(() => { verdict = classifyMembershipAssociation(state({ membership: proxy }), command()); }).not.toThrow();
    expect(verdict).toEqual({ decision: 'denied', reason: 'malformed_state' });
  });

  test('a revoked proxy account sub-record is denied malformed_state without throwing', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    let verdict;
    expect(() => { verdict = classifyMembershipAssociation(state({ account: proxy }), command()); }).not.toThrow();
    expect(verdict).toEqual({ decision: 'denied', reason: 'malformed_state' });
  });

  test('a live proxy state never fires a trap', () => {
    const trap = () => { throw new Error('state trap must never fire'); };
    const proxy = new Proxy(state(), { get: trap, has: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
    expect(classifyMembershipAssociation(proxy, command()).reason).toBe('malformed_state');
  });

  test('a live proxy command never fires a trap', () => {
    const trap = () => { throw new Error('command trap must never fire'); };
    const proxy = new Proxy(command(), { get: trap, has: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
    expect(classifyMembershipAssociation(state(), proxy).reason).toBe('malformed_command');
  });

  test('a live proxy membership sub-record never fires a trap', () => {
    const trap = () => { throw new Error('membership trap must never fire'); };
    const proxy = new Proxy(membership(), { get: trap, has: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
    expect(classifyMembershipAssociation(state({ membership: proxy }), command()).reason).toBe('malformed_state');
  });

  test('a live proxy account sub-record never fires a trap', () => {
    const trap = () => { throw new Error('account trap must never fire'); };
    const proxy = new Proxy(account(), { get: trap, has: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
    expect(classifyMembershipAssociation(state({ account: proxy }), command()).reason).toBe('malformed_state');
  });

  test('a throwing accessor on a command field never throws out of the classifier', () => {
    const c = command();
    delete c.capability;
    Object.defineProperty(c, 'capability', {
      enumerable: true, configurable: true, get() { throw new Error('command getter must never be invoked'); },
    });
    let verdict;
    expect(() => { verdict = classifyMembershipAssociation(state(), c); }).not.toThrow();
    expect(verdict.reason).toBe('malformed_command');
  });

  test('a throwing accessor on a nested membership field never throws out of the classifier', () => {
    const m = membership();
    delete m.status;
    Object.defineProperty(m, 'status', {
      enumerable: true, configurable: true, get() { throw new Error('membership getter must never be invoked'); },
    });
    let verdict;
    expect(() => { verdict = classifyMembershipAssociation(state({ membership: m }), command()); }).not.toThrow();
    expect(verdict.reason).toBe('malformed_state');
  });
});

// ---- 11. determinism, sharing, non-echo ---------------------------------

describe('determinism, sharing, non-echo', () => {
  test('identical inputs yield deep-equal verdicts', () => {
    expect(classifyMembershipAssociation(state(), command()))
      .toEqual(classifyMembershipAssociation(state(), command()));
  });

  test('denial verdicts are shared frozen singletons across calls', () => {
    const a = classifyMembershipAssociation(state({ account: null }), command());
    const b = classifyMembershipAssociation(state({ account: null }), command());
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  test('review verdicts are shared frozen singletons across calls', () => {
    const a = classifyMembershipAssociation(state({ collision: 'household_overlap' }), command());
    const b = classifyMembershipAssociation(state({ collision: 'household_overlap' }), command());
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  test('distinct denial reasons are distinct singletons', () => {
    const missing = classifyMembershipAssociation(state({ account: null }), command());
    const stale = classifyMembershipAssociation(state(), command({ deadline: PAST }));
    expect(missing).not.toBe(stale);
  });

  test('grant verdicts are fresh (not shared) but deep-equal for equal inputs', () => {
    const a = classifyMembershipAssociation(state(), command());
    const b = classifyMembershipAssociation(state(), command());
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  test('mutating a returned grant is a no-op under a fresh call', () => {
    const first = classifyMembershipAssociation(state(), command());
    try { first.next.linkedUid = 'tampered'; } catch (_e) { /* frozen */ }
    const second = classifyMembershipAssociation(state(), command());
    expect(second.next.linkedUid).toBe('uid.alice.001');
  });
});

// ---- 12. source boundary (comment-stripped) -----------------------------

describe('source boundary', () => {
  test.each([
    ['process.env', /process\.env/],
    ['Date.now', /Date\.now/],
    ['new Date', /new Date/],
    ['Math.random', /Math\.random/],
    ['console.', /console\./],
    ['fetch(', /fetch\(/],
    ['url scheme', /https?:/],
    ['firebase', /firebase/i],
    ['firestore', /firestore/i],
    ['stripe', /stripe/i],
  ])('code contains no %s', (_label, pattern) => {
    expect(pattern.test(sourceCode)).toBe(false);
  });

  test.each([
    ['phone', /phone/i],
    ['address', /address/i],
    ['dob', /\bdob\b/i],
    ['ssn', /\bssn\b/i],
    ['secret', /secret/i],
    ['token', /\btoken\b/i],
    ['password', /password/i],
    ['bearer', /bearer/i],
    ['api key', /api[_-]?key/i],
    ['invite', /invite/i],
    ['roster', /roster/i],
  ])('code names no %s', (_label, pattern) => {
    expect(pattern.test(sourceCode)).toBe(false);
  });

  test.each([
    ['innerHTML', /innerHTML/i],
    ['dangerouslySet', /dangerouslySet/i],
  ])('code has no HTML sink %s', (_label, pattern) => {
    expect(pattern.test(sourceCode)).toBe(false);
  });

  test('module requires only node:util', () => {
    expect(rawSource.match(/require\(([^)]*)\)/g)).toEqual(["require('node:util')"]);
  });

  test('header names the issue code', () => {
    expect(rawSource).toContain('MEMBERS-ADMIN-001B');
  });

  test('functions/index.js does not import this module', () => {
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toContain('membershipAssociation');
  });
});
