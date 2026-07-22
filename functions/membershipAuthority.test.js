'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { inspect } = require('node:util');

const {
  membershipAuthoritySchemaVersion,
  MEMBERSHIP_AUTHORITY_ENUMS,
  MembershipAuthorityError,
  createMembershipAuthority,
  applyMembershipAuthorityCommand,
  deriveMembershipEntitlement,
} = require('./membershipAuthority');

const HOSTILE_CANARY = 'private-member@example.test/+12025550208?token=do-not-copy';
const TERM_START_MS = 1_000_000;
const TERM_END_MS = 2_000_000;

function createInput(overrides = {}) {
  return {
    membershipAuthoritySchemaVersion: 1,
    membershipId: 'mbr_test_001',
    commandId: 'cmd_create_001',
    ...overrides,
  };
}

function associateCommand(overrides = {}) {
  return {
    membershipAuthoritySchemaVersion: 1,
    commandType: 'associate_account',
    commandId: 'cmd_link_001',
    expectedRevision: 1,
    uid: 'uid_test_001',
    ...overrides,
  };
}

function termCommand(overrides = {}) {
  return {
    membershipAuthoritySchemaVersion: 1,
    commandType: 'record_term_decision',
    commandId: 'cmd_term_001',
    expectedRevision: 2,
    termRevision: 1,
    termState: 'approved',
    termId: 'term_test_2026',
    startsAtMs: TERM_START_MS,
    endsAtMs: TERM_END_MS,
    planRef: 'plan_test_001',
    evidenceRef: 'evidence_test_001',
    policyVersion: 'policy_test_001',
    ...overrides,
  };
}

function entitlementInput(record, overrides = {}) {
  return {
    membershipAuthoritySchemaVersion: 1,
    record,
    uid: 'uid_test_001',
    asOfMs: TERM_START_MS,
    ...overrides,
  };
}

function createLinkedRecord() {
  return applyMembershipAuthorityCommand(
    createMembershipAuthority(createInput()),
    associateCommand(),
  );
}

function createUnlinkedTermRecord(overrides = {}) {
  return applyMembershipAuthorityCommand(
    createMembershipAuthority(createInput()),
    termCommand({ expectedRevision: 1, ...overrides }),
  );
}

function createApprovedRecord(overrides = {}) {
  return applyMembershipAuthorityCommand(
    createLinkedRecord(),
    termCommand(overrides),
  );
}

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected callback to throw');
}

function expectSafeError(callback, rawValue = HOSTILE_CANARY) {
  const error = captureError(callback);
  expect(error).toBeInstanceOf(MembershipAuthorityError);
  expect(error).toMatchObject({
    name: 'MembershipAuthorityError',
    code: 'invalid_membership_authority',
    message: 'Membership authority input is invalid.',
  });
  expect(Object.isFrozen(error)).toBe(true);
  const rendered = [
    error.message,
    String(error),
    JSON.stringify(error),
    inspect(error),
    error.stack,
  ].join('\n');
  if (rawValue) expect(rendered).not.toContain(rawValue);
  expect(rendered).not.toContain(HOSTILE_CANARY);
  return error;
}

function expectDeepFrozen(value) {
  expect(Object.isFrozen(value)).toBe(true);
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) expectDeepFrozen(child);
  }
}

describe('provider-neutral membership authority contract', () => {
  test('exports one frozen versioned API and enum catalog', () => {
    const api = require('./membershipAuthority');
    expect(membershipAuthoritySchemaVersion).toBe(1);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(MEMBERSHIP_AUTHORITY_ENUMS)).toBe(true);
    for (const values of Object.values(MEMBERSHIP_AUTHORITY_ENUMS)) {
      expect(Object.isFrozen(values)).toBe(true);
    }
    expect(Object.isFrozen(MembershipAuthorityError)).toBe(true);
    expect(Object.isFrozen(MembershipAuthorityError.prototype)).toBe(true);
  });

  test('creates an account-independent record that grants no website entitlement', () => {
    const input = createInput();
    const before = JSON.stringify(input);
    const record = createMembershipAuthority(input);

    expect(record).toEqual({
      membershipAuthoritySchemaVersion: 1,
      membershipId: 'mbr_test_001',
      revision: 1,
      association: {
        state: 'unlinked',
        uid: null,
        revision: 0,
      },
      term: {
        state: 'decision_pending',
        termId: null,
        startsAtMs: null,
        endsAtMs: null,
        planRef: null,
        evidenceRef: null,
        policyVersion: null,
        revision: 0,
      },
      lastCommand: {
        commandType: 'create_membership',
        commandId: 'cmd_create_001',
        expectedRevision: 0,
      },
    });
    expectDeepFrozen(record);
    expect(JSON.stringify(input)).toBe(before);
    expect(deriveMembershipEntitlement(entitlementInput(record))).toEqual({
      membershipAuthoritySchemaVersion: 1,
      entitlement: 'not_entitled',
      state: 'inactive',
    });
  });

  test('associates one UID explicitly without treating account identity as membership', () => {
    const initial = createMembershipAuthority(createInput());
    const command = associateCommand();
    const before = JSON.stringify({ initial, command });
    const linked = applyMembershipAuthorityCommand(initial, command);

    expect(linked.revision).toBe(2);
    expect(linked.association).toEqual({
      state: 'linked',
      uid: 'uid_test_001',
      revision: 1,
    });
    expect(linked.term.state).toBe('decision_pending');
    expect(linked.lastCommand).toEqual({
      commandType: 'associate_account',
      commandId: 'cmd_link_001',
      expectedRevision: 1,
    });
    expectDeepFrozen(linked);
    expect(JSON.stringify({ initial, command })).toBe(before);
    expect(deriveMembershipEntitlement(entitlementInput(linked))).toEqual({
      membershipAuthoritySchemaVersion: 1,
      entitlement: 'decision_pending',
      state: 'requires_policy_decision',
    });
  });

  test('records a term before association while withholding entitlement until explicit linking', () => {
    const approvedUnlinked = createUnlinkedTermRecord();

    expect(approvedUnlinked.revision).toBe(2);
    expect(approvedUnlinked.association).toEqual({
      state: 'unlinked',
      uid: null,
      revision: 0,
    });
    expect(approvedUnlinked.term).toEqual({
      state: 'approved',
      termId: 'term_test_2026',
      startsAtMs: TERM_START_MS,
      endsAtMs: TERM_END_MS,
      planRef: 'plan_test_001',
      evidenceRef: 'evidence_test_001',
      policyVersion: 'policy_test_001',
      revision: 1,
    });
    expect(deriveMembershipEntitlement(entitlementInput(approvedUnlinked))).toEqual({
      membershipAuthoritySchemaVersion: 1,
      entitlement: 'not_entitled',
      state: 'inactive',
    });

    const linked = applyMembershipAuthorityCommand(approvedUnlinked, associateCommand({
      commandId: 'cmd_link_002',
      expectedRevision: 2,
    }));
    expect(linked.revision).toBe(3);
    expect(linked.term).toEqual(approvedUnlinked.term);
    expectDeepFrozen(linked);
    expect(deriveMembershipEntitlement(entitlementInput(linked))).toEqual({
      membershipAuthoritySchemaVersion: 1,
      entitlement: 'current_member',
      state: 'active',
    });

    const linkedFirst = createApprovedRecord();
    expect(linked.revision).toBe(linkedFirst.revision);
    expect(linked.association).toEqual(linkedFirst.association);
    expect(linked.term).toEqual(linkedFirst.term);
    expect(linked.lastCommand.commandType).toBe('associate_account');
    expect(linkedFirst.lastCommand.commandType).toBe('record_term_decision');
  });

  test.each([
    ['decision_pending', 'decision_pending', TERM_START_MS, 'decision_pending', 'requires_policy_decision'],
    ['suspended', 'suspended', TERM_START_MS, 'not_entitled', 'inactive'],
    ['ended', 'ended', TERM_START_MS, 'not_entitled', 'inactive'],
    ['approved future', 'approved', TERM_START_MS - 1, 'not_entitled', 'inactive'],
    ['approved expired', 'approved', TERM_END_MS, 'not_entitled', 'inactive'],
  ])('term-first %s evidence never becomes current merely because an account is linked', (
    _caseName,
    termState,
    asOfMs,
    entitlement,
    state,
  ) => {
    const unlinked = createUnlinkedTermRecord({ termState });

    expect(deriveMembershipEntitlement(entitlementInput(unlinked, { asOfMs }))).toEqual({
      membershipAuthoritySchemaVersion: 1,
      entitlement: 'not_entitled',
      state: 'inactive',
    });

    const linked = applyMembershipAuthorityCommand(unlinked, associateCommand({
      commandId: 'cmd_link_after_term_001',
      expectedRevision: 2,
    }));
    expect(linked.term).toEqual(unlinked.term);
    expect(deriveMembershipEntitlement(entitlementInput(linked, { asOfMs }))).toEqual({
      membershipAuthoritySchemaVersion: 1,
      entitlement,
      state,
    });
  });

  test('preserves the latest unlinked term across association and keeps retries read-only', () => {
    const approved = createUnlinkedTermRecord();
    expect(applyMembershipAuthorityCommand(approved, termCommand({
      expectedRevision: 1,
    }))).toBe(approved);

    const suspendCommand = termCommand({
      commandId: 'cmd_term_suspend_002',
      expectedRevision: 2,
      termRevision: 2,
      termState: 'suspended',
      evidenceRef: 'evidence_reversal_002',
    });
    const suspended = applyMembershipAuthorityCommand(approved, suspendCommand);
    expect(suspended.association.state).toBe('unlinked');
    expect(suspended.term.state).toBe('suspended');
    expect(suspended.term.revision).toBe(2);
    expect(applyMembershipAuthorityCommand(suspended, suspendCommand)).toBe(suspended);

    const linkCommand = associateCommand({
      commandId: 'cmd_link_after_suspend_001',
      expectedRevision: 3,
    });
    const linked = applyMembershipAuthorityCommand(suspended, linkCommand);
    expect(linked.revision).toBe(4);
    expect(linked.term).toEqual(suspended.term);
    expect(applyMembershipAuthorityCommand(linked, linkCommand)).toBe(linked);
    expect(deriveMembershipEntitlement(entitlementInput(linked))).toEqual({
      membershipAuthoritySchemaVersion: 1,
      entitlement: 'not_entitled',
      state: 'inactive',
    });

    expectSafeError(() => applyMembershipAuthorityCommand(
      linked,
      { ...linkCommand, uid: 'uid_other_001' },
    ));
    expectSafeError(() => applyMembershipAuthorityCommand(linked, termCommand({
      expectedRevision: 1,
    })));
    expectSafeError(() => applyMembershipAuthorityCommand(linked, associateCommand({
      commandId: 'cmd_link_second_002',
      expectedRevision: 4,
      uid: 'uid_other_001',
    })));
  });

  test('rejects stale, skipped, and impossible term-first histories without mutation', () => {
    const initial = createMembershipAuthority(createInput());
    const before = JSON.stringify(initial);

    expectSafeError(() => applyMembershipAuthorityCommand(initial, termCommand({
      expectedRevision: 2,
    })));
    expectSafeError(() => applyMembershipAuthorityCommand(initial, termCommand({
      expectedRevision: 1,
      termRevision: 2,
    })));
    expect(JSON.stringify(initial)).toBe(before);

    const approved = createUnlinkedTermRecord();
    expectSafeError(() => applyMembershipAuthorityCommand(approved, termCommand({
      commandId: 'cmd_term_stale_002',
      expectedRevision: 1,
      termRevision: 2,
    })));
    expectSafeError(() => applyMembershipAuthorityCommand(approved, termCommand({
      commandId: 'cmd_term_repeat_002',
      expectedRevision: 2,
      termRevision: 1,
    })));
    expectSafeError(() => deriveMembershipEntitlement(entitlementInput({
      ...approved,
      lastCommand: {
        commandType: 'associate_account',
        commandId: 'cmd_impossible_001',
        expectedRevision: 1,
      },
    })));
  });

  test('makes an exact command retry read-only and rejects a changed reuse', () => {
    const initial = createMembershipAuthority(createInput());
    const linked = applyMembershipAuthorityCommand(initial, associateCommand());
    expect(applyMembershipAuthorityCommand(linked, associateCommand())).toBe(linked);

    expectSafeError(() => applyMembershipAuthorityCommand(
      linked,
      associateCommand({ uid: 'uid_other_001' }),
    ));
    expectSafeError(() => applyMembershipAuthorityCommand(
      linked,
      associateCommand({ commandType: 'record_term_decision' }),
    ));
  });

  test('records an already-decided term without choosing policy and grants only the fixed result', () => {
    const linked = createLinkedRecord();
    const command = termCommand();
    const record = applyMembershipAuthorityCommand(linked, command);

    expect(record.revision).toBe(3);
    expect(record.term).toEqual({
      state: 'approved',
      termId: 'term_test_2026',
      startsAtMs: TERM_START_MS,
      endsAtMs: TERM_END_MS,
      planRef: 'plan_test_001',
      evidenceRef: 'evidence_test_001',
      policyVersion: 'policy_test_001',
      revision: 1,
    });
    expectDeepFrozen(record);
    const result = deriveMembershipEntitlement(entitlementInput(record));
    expect(result).toEqual({
      membershipAuthoritySchemaVersion: 1,
      entitlement: 'current_member',
      state: 'active',
    });
    expect(Object.keys(result)).toEqual([
      'membershipAuthoritySchemaVersion',
      'entitlement',
      'state',
    ]);
    expect(JSON.stringify(result)).not.toContain('mbr_test_001');
    expect(JSON.stringify(result)).not.toContain('uid_test_001');
    expect(applyMembershipAuthorityCommand(record, command)).toBe(record);
  });

  test('uses explicit half-open term boundaries without choosing a calendar policy', () => {
    const record = createApprovedRecord();
    const notEntitled = {
      membershipAuthoritySchemaVersion: 1,
      entitlement: 'not_entitled',
      state: 'inactive',
    };

    expect(deriveMembershipEntitlement(entitlementInput(record, {
      asOfMs: TERM_START_MS - 1,
    }))).toEqual(notEntitled);
    expect(deriveMembershipEntitlement(entitlementInput(record, {
      asOfMs: TERM_START_MS,
    }))).toEqual({
      membershipAuthoritySchemaVersion: 1,
      entitlement: 'current_member',
      state: 'active',
    });
    expect(deriveMembershipEntitlement(entitlementInput(record, {
      asOfMs: TERM_END_MS - 1,
    }))).toEqual({
      membershipAuthoritySchemaVersion: 1,
      entitlement: 'current_member',
      state: 'active',
    });
    expect(deriveMembershipEntitlement(entitlementInput(record, {
      asOfMs: TERM_END_MS,
    }))).toEqual(notEntitled);
  });

  test.each([
    ['decision_pending', 'decision_pending', 'requires_policy_decision'],
    ['suspended', 'not_entitled', 'inactive'],
    ['ended', 'not_entitled', 'inactive'],
  ])('fails closed for a %s term decision', (termState, entitlement, state) => {
    const record = createApprovedRecord({ termState });
    expect(deriveMembershipEntitlement(entitlementInput(record))).toEqual({
      membershipAuthoritySchemaVersion: 1,
      entitlement,
      state,
    });
  });

  test('a different UID never receives the linked membership entitlement', () => {
    const result = deriveMembershipEntitlement(entitlementInput(createApprovedRecord(), {
      uid: 'uid_other_001',
    }));
    expect(result).toEqual({
      membershipAuthoritySchemaVersion: 1,
      entitlement: 'not_entitled',
      state: 'inactive',
    });
  });

  test('rejects stale, skipped, reordered, and conflicting transitions without mutation', () => {
    const initial = createMembershipAuthority(createInput());
    const linked = applyMembershipAuthorityCommand(initial, associateCommand());
    const before = JSON.stringify(linked);

    expectSafeError(() => applyMembershipAuthorityCommand(
      linked,
      associateCommand({ commandId: 'cmd_link_002', expectedRevision: 1 }),
    ));
    expectSafeError(() => applyMembershipAuthorityCommand(
      linked,
      associateCommand({ commandId: 'cmd_link_002', uid: 'uid_other_001' }),
    ));
    expectSafeError(() => applyMembershipAuthorityCommand(
      linked,
      associateCommand({ commandId: 'cmd_link_002', expectedRevision: 2 }),
    ));
    expectSafeError(() => applyMembershipAuthorityCommand(
      linked,
      associateCommand({
        commandId: 'cmd_link_002',
        expectedRevision: 2,
        uid: 'uid_other_001',
      }),
    ));
    expectSafeError(() => applyMembershipAuthorityCommand(
      linked,
      termCommand({ termRevision: 2 }),
    ));

    const approved = applyMembershipAuthorityCommand(linked, termCommand());
    expectSafeError(() => applyMembershipAuthorityCommand(
      approved,
      termCommand({ commandId: 'cmd_term_002', expectedRevision: 2, termRevision: 2 }),
    ));
    expectSafeError(() => applyMembershipAuthorityCommand(
      approved,
      termCommand({ commandId: 'cmd_term_002', expectedRevision: 3, termRevision: 1 }),
    ));
    expectSafeError(() => applyMembershipAuthorityCommand(
      approved,
      termCommand({ evidenceRef: 'evidence_changed_001' }),
    ));
    expect(JSON.stringify(linked)).toBe(before);
  });

  test('fails closed before a record revision would exceed the safe-integer boundary', () => {
    const approved = createApprovedRecord();
    const maxRecord = {
      ...approved,
      revision: Number.MAX_SAFE_INTEGER,
      term: {
        ...approved.term,
        revision: Number.MAX_SAFE_INTEGER - 2,
      },
      lastCommand: {
        commandType: 'record_term_decision',
        commandId: 'cmd_term_max_001',
        expectedRevision: Number.MAX_SAFE_INTEGER - 1,
      },
    };
    const before = JSON.stringify(maxRecord);

    expectSafeError(() => applyMembershipAuthorityCommand(maxRecord, termCommand({
      commandId: 'cmd_term_max_002',
      expectedRevision: Number.MAX_SAFE_INTEGER,
      termRevision: Number.MAX_SAFE_INTEGER - 1,
    })));
    expect(JSON.stringify(maxRecord)).toBe(before);
  });

  test('accepts a monotonic later term decision while keeping policy facts opaque', () => {
    const approved = createApprovedRecord();
    const suspended = applyMembershipAuthorityCommand(approved, termCommand({
      commandId: 'cmd_term_002',
      expectedRevision: 3,
      termRevision: 2,
      termState: 'suspended',
      evidenceRef: 'evidence_test_002',
      policyVersion: 'policy_test_002',
    }));
    expectSafeError(() => applyMembershipAuthorityCommand(suspended, termCommand()));
    expect(suspended.term.state).toBe('suspended');
    expect(suspended.term.revision).toBe(2);
    expect(deriveMembershipEntitlement(entitlementInput(suspended))).toEqual({
      membershipAuthoritySchemaVersion: 1,
      entitlement: 'not_entitled',
      state: 'inactive',
    });
  });
});

describe('strict and non-identifying input boundary', () => {
  test.each([
    undefined,
    null,
    true,
    1,
    'membership',
    [],
    new Date(0),
    new Number(1),
  ])('rejects non-plain root input case %#', (input) => {
    expectSafeError(() => createMembershipAuthority(input));
  });

  test('rejects missing, extra, symbol, inherited, accessor, and proxy fields', () => {
    for (const field of Object.keys(createInput())) {
      const input = createInput();
      delete input[field];
      expectSafeError(() => createMembershipAuthority(input));
    }
    expectSafeError(() => createMembershipAuthority({
      ...createInput(),
      email: HOSTILE_CANARY,
    }));
    const symbolInput = createInput();
    symbolInput[Symbol(HOSTILE_CANARY)] = true;
    expectSafeError(() => createMembershipAuthority(symbolInput));
    expectSafeError(() => createMembershipAuthority(Object.assign(
      Object.create({ email: HOSTILE_CANARY }),
      createInput(),
    )));
    const getterInput = createInput();
    Object.defineProperty(getterInput, 'membershipId', {
      get() {
        throw new Error(HOSTILE_CANARY);
      },
      enumerable: true,
    });
    expectSafeError(() => createMembershipAuthority(getterInput));
    expectSafeError(() => createMembershipAuthority(new Proxy(createInput(), {})));
    expectSafeError(() => applyMembershipAuthorityCommand(
      createMembershipAuthority(createInput()),
      new Proxy(associateCommand(), {}),
    ));
  });

  test.each([
    'private-member@example.test',
    '+12025550208',
    'https://example.test/member',
    'member with spaces',
    'member/with/path',
    'éxternal',
    '',
    'a'.repeat(129),
  ])('rejects non-opaque identifier %p', (value) => {
    expectSafeError(() => createMembershipAuthority(createInput({ membershipId: value })), value);
    expectSafeError(() => createMembershipAuthority(createInput({ commandId: value })), value);
  });

  test.each([
    ['email', HOSTILE_CANARY],
    ['phoneNumber', '+12025550208'],
    ['provider', 'google.com'],
    ['role', 'admin_canary_208'],
    ['stripePaymentId', 'pi_private'],
    ['priceCents', 2500],
    ['memberName', 'Private Runner'],
  ])('rejects forbidden caller field %s', (field, value) => {
    expectSafeError(() => applyMembershipAuthorityCommand(
      createMembershipAuthority(createInput()),
      { ...associateCommand(), [field]: value },
    ), String(value));
  });

  test.each([
    NaN,
    Infinity,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER,
  ])('rejects invalid term time %p', (startsAtMs) => {
    expectSafeError(() => applyMembershipAuthorityCommand(
      createLinkedRecord(),
      termCommand({ startsAtMs }),
    ));
  });

  test('rejects equal/reversed bounds and invalid entitlement clocks', () => {
    expectSafeError(() => applyMembershipAuthorityCommand(
      createLinkedRecord(),
      termCommand({ startsAtMs: TERM_END_MS }),
    ));
    expectSafeError(() => applyMembershipAuthorityCommand(
      createLinkedRecord(),
      termCommand({ startsAtMs: TERM_END_MS + 1 }),
    ));
    const record = createApprovedRecord();
    for (const asOfMs of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER]) {
      expectSafeError(() => deriveMembershipEntitlement(entitlementInput(record, { asOfMs })));
    }
  });

  test('rejects every unsupported schema, command, and term enum', () => {
    expectSafeError(() => createMembershipAuthority(createInput({
      membershipAuthoritySchemaVersion: 2,
    })));
    expectSafeError(() => applyMembershipAuthorityCommand(
      createMembershipAuthority(createInput()),
      associateCommand({ commandType: 'grant_membership' }),
    ));
    expectSafeError(() => applyMembershipAuthorityCommand(
      createLinkedRecord(),
      termCommand({ termState: 'paid' }),
    ));
  });

  test('validates records again instead of trusting caller-created snapshots', () => {
    const valid = createApprovedRecord();
    const forged = JSON.parse(JSON.stringify(valid));
    forged.association.uid = HOSTILE_CANARY;
    expectSafeError(() => deriveMembershipEntitlement(entitlementInput(forged)));

    const extra = JSON.parse(JSON.stringify(valid));
    extra.term.priceCents = 2500;
    expectSafeError(() => deriveMembershipEntitlement(entitlementInput(extra)));
  });
});

describe('static non-adoption and dependency boundary', () => {
  test('has no runtime edge, external SDK, clock, random, logger, environment, or provider field', () => {
    const source = fs.readFileSync(path.join(__dirname, 'membershipAuthority.js'), 'utf8');
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toContain('membershipAuthority');
    expect(source).not.toMatch(/firebase|firestore|stripe|google|whatsapp|strava/i);
    expect(source).not.toMatch(/process\.env|Date\.now|new Date|Math\.random|console\.|fetch\s*\(|https?:/);
    expect(source).not.toMatch(/email|phone|address|dob|emergency|price|payment/i);
    const requires = [...source.matchAll(/require\(([^)]+)\)/g)].map((match) => match[1]);
    expect(requires).toEqual(["'node:util'"]);
  });
});
