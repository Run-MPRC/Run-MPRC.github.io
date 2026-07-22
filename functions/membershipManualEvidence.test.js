'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { inspect } = require('node:util');

const {
  membershipManualEvidenceSchemaVersion,
  MEMBERSHIP_MANUAL_EVIDENCE_ENUMS,
  MembershipManualEvidenceError,
  projectManualDuesEvidence,
} = require('./membershipManualEvidence');

const {
  membershipAuthoritySchemaVersion,
  createMembershipAuthority,
  applyMembershipAuthorityCommand,
  deriveMembershipEntitlement,
} = require('./membershipAuthority');

const HOSTILE_CANARY = 'private-member@example.test/+12025550208?token=do-not-copy';
const TERM_START_MS = 1_000_000;
const TERM_END_MS = 2_000_000;

const OPAQUE_FIELDS = [
  'commandId',
  'actorRef',
  'capabilityRef',
  'recentAuthRef',
  'membershipId',
  'evidenceCategoryRef',
  'evidenceRef',
  'reasonRef',
  'correlationRef',
  'termId',
  'planRef',
  'policyVersion',
];

function officerCommand(overrides = {}) {
  return {
    membershipManualEvidenceSchemaVersion: 1,
    commandId: 'cmd_manual_001',
    actorRef: 'officer_001',
    capabilityRef: 'cap_record_dues_001',
    recentAuthRef: 'reauth_001',
    membershipId: 'mbr_test_001',
    evidenceCategoryRef: 'evcat_check_001',
    evidenceRef: 'evidence_test_001',
    reasonRef: 'reason_manual_001',
    correlationRef: 'corr_001',
    expectedRevision: 2,
    termRevision: 1,
    termId: 'term_test_2026',
    startsAtMs: TERM_START_MS,
    endsAtMs: TERM_END_MS,
    planRef: 'plan_test_001',
    policyVersion: 'policy_test_001',
    ...overrides,
  };
}

function createLinkedRecord() {
  return applyMembershipAuthorityCommand(
    createMembershipAuthority({
      membershipAuthoritySchemaVersion: 1,
      membershipId: 'mbr_test_001',
      commandId: 'cmd_create_001',
    }),
    {
      membershipAuthoritySchemaVersion: 1,
      commandType: 'associate_account',
      commandId: 'cmd_link_001',
      expectedRevision: 1,
      uid: 'uid_test_001',
    },
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
  expect(error).toBeInstanceOf(MembershipManualEvidenceError);
  expect(error).toMatchObject({
    name: 'MembershipManualEvidenceError',
    code: 'invalid_membership_manual_evidence',
    message: 'Membership manual evidence input is invalid.',
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

describe('officer manual off-platform dues-evidence projection', () => {
  test('exports one frozen versioned API and enum catalog', () => {
    const api = require('./membershipManualEvidence');
    expect(membershipManualEvidenceSchemaVersion).toBe(1);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(MEMBERSHIP_MANUAL_EVIDENCE_ENUMS)).toBe(true);
    for (const values of Object.values(MEMBERSHIP_MANUAL_EVIDENCE_ENUMS)) {
      expect(Object.isFrozen(values)).toBe(true);
    }
    expect(MEMBERSHIP_MANUAL_EVIDENCE_ENUMS).toEqual({
      provenance: ['manual_off_platform'],
      termState: ['approved'],
    });
    expect(Object.isFrozen(MembershipManualEvidenceError)).toBe(true);
    expect(Object.isFrozen(MembershipManualEvidenceError.prototype)).toBe(true);
  });

  test('projects the exact record_term_decision command and a paired manual audit record', () => {
    const input = officerCommand();
    const before = JSON.stringify(input);
    const result = projectManualDuesEvidence(input);

    expect(Object.keys(result)).toEqual(['reducerCommand', 'auditRecord']);
    expect(result.reducerCommand).toEqual({
      membershipAuthoritySchemaVersion: 1,
      commandType: 'record_term_decision',
      commandId: 'cmd_manual_001',
      expectedRevision: 2,
      termRevision: 1,
      termState: 'approved',
      termId: 'term_test_2026',
      startsAtMs: TERM_START_MS,
      endsAtMs: TERM_END_MS,
      planRef: 'plan_test_001',
      evidenceRef: 'evidence_test_001',
      policyVersion: 'policy_test_001',
    });
    expect(result.auditRecord).toEqual({
      membershipManualEvidenceSchemaVersion: 1,
      provenance: 'manual_off_platform',
      membershipId: 'mbr_test_001',
      commandId: 'cmd_manual_001',
      actorRef: 'officer_001',
      capabilityRef: 'cap_record_dues_001',
      recentAuthRef: 'reauth_001',
      evidenceCategoryRef: 'evcat_check_001',
      evidenceRef: 'evidence_test_001',
      reasonRef: 'reason_manual_001',
      correlationRef: 'corr_001',
      termId: 'term_test_2026',
      termState: 'approved',
      startsAtMs: TERM_START_MS,
      endsAtMs: TERM_END_MS,
      planRef: 'plan_test_001',
      policyVersion: 'policy_test_001',
    });

    expectDeepFrozen(result);
    // Never mutates caller input.
    expect(JSON.stringify(input)).toBe(before);
  });

  test('returns distinct frozen records on each call so results cannot alias', () => {
    const first = projectManualDuesEvidence(officerCommand());
    const second = projectManualDuesEvidence(officerCommand());
    expect(first).not.toBe(second);
    expect(first.reducerCommand).not.toBe(second.reducerCommand);
    expect(first.auditRecord).not.toBe(second.auditRecord);
    expect(first).toEqual(second);
  });

  test('carries owner-meaningful values through verbatim, inventing none', () => {
    const result = projectManualDuesEvidence(officerCommand({
      termId: 'term_other_2027',
      planRef: 'plan_other_002',
      policyVersion: 'policy_other_002',
      evidenceRef: 'evidence_other_002',
      startsAtMs: 5,
      endsAtMs: 6,
    }));
    expect(result.reducerCommand.termId).toBe('term_other_2027');
    expect(result.reducerCommand.planRef).toBe('plan_other_002');
    expect(result.reducerCommand.policyVersion).toBe('policy_other_002');
    expect(result.reducerCommand.evidenceRef).toBe('evidence_other_002');
    expect(result.reducerCommand.startsAtMs).toBe(5);
    expect(result.reducerCommand.endsAtMs).toBe(6);
    expect(result.auditRecord.termId).toBe('term_other_2027');
    expect(result.auditRecord.planRef).toBe('plan_other_002');
  });

  test('emitted values carry no external charge or contact identifier', () => {
    const result = projectManualDuesEvidence(officerCommand());
    const rendered = JSON.stringify(result);
    expect(rendered).not.toMatch(/stripe|session|payment|intent|charge|refund/i);
    for (const key of [
      ...Object.keys(result.reducerCommand),
      ...Object.keys(result.auditRecord),
    ]) {
      expect(key).not.toMatch(/stripe|session|payment|intent|charge|refund|email|phone|price/i);
    }
    expect(result.auditRecord.provenance).toBe('manual_off_platform');
  });
});

describe('acceptance by the shipped membership authority reducer', () => {
  test('the projected command is accepted and approves the linked term', () => {
    const linked = createLinkedRecord();
    expect(linked.revision).toBe(2);

    const { reducerCommand } = projectManualDuesEvidence(officerCommand());
    // Re-declared version constant matches the shipped reducer's own version.
    expect(reducerCommand.membershipAuthoritySchemaVersion)
      .toBe(membershipAuthoritySchemaVersion);

    const approved = applyMembershipAuthorityCommand(linked, reducerCommand);
    expect(approved.revision).toBe(3);
    expect(approved.term).toEqual({
      state: 'approved',
      termId: 'term_test_2026',
      startsAtMs: TERM_START_MS,
      endsAtMs: TERM_END_MS,
      planRef: 'plan_test_001',
      evidenceRef: 'evidence_test_001',
      policyVersion: 'policy_test_001',
      revision: 1,
    });

    const entitlement = deriveMembershipEntitlement({
      membershipAuthoritySchemaVersion: 1,
      record: approved,
      uid: 'uid_test_001',
      asOfMs: TERM_START_MS,
    });
    expect(entitlement).toEqual({
      membershipAuthoritySchemaVersion: 1,
      entitlement: 'current_member',
      state: 'active',
    });
  });

  test('the projected command can approve an unlinked term before later association', () => {
    const unlinked = createMembershipAuthority({
      membershipAuthoritySchemaVersion: 1,
      membershipId: 'mbr_test_001',
      commandId: 'cmd_create_001',
    });
    const { reducerCommand } = projectManualDuesEvidence(officerCommand({
      expectedRevision: 1,
    }));

    const approved = applyMembershipAuthorityCommand(unlinked, reducerCommand);
    expect(approved.association.state).toBe('unlinked');
    expect(deriveMembershipEntitlement({
      membershipAuthoritySchemaVersion: 1,
      record: approved,
      uid: 'uid_test_001',
      asOfMs: TERM_START_MS,
    }).entitlement).toBe('not_entitled');

    const linked = applyMembershipAuthorityCommand(approved, {
      membershipAuthoritySchemaVersion: 1,
      commandType: 'associate_account',
      commandId: 'cmd_link_after_manual_001',
      expectedRevision: 2,
      uid: 'uid_test_001',
    });
    expect(linked.term).toEqual(approved.term);
    expect(deriveMembershipEntitlement({
      membershipAuthoritySchemaVersion: 1,
      record: linked,
      uid: 'uid_test_001',
      asOfMs: TERM_START_MS,
    }).entitlement).toBe('current_member');
  });

  test('the projected command stays an idempotent, replay-safe reducer command', () => {
    const linked = createLinkedRecord();
    const { reducerCommand } = projectManualDuesEvidence(officerCommand());
    const approved = applyMembershipAuthorityCommand(linked, reducerCommand);
    // Same command id + shape applied again is read-only, not a second write.
    expect(applyMembershipAuthorityCommand(approved, reducerCommand)).toBe(approved);
  });
});

describe('hostile input is rejected without leaking the raw value', () => {
  test.each([
    null,
    undefined,
    true,
    false,
    0,
    1,
    'string',
    Symbol('s'),
    [],
    [officerCommand()],
    () => officerCommand(),
    Object.create(null),
    Object.create({ email: HOSTILE_CANARY }),
    new Date(0),
    // eslint-disable-next-line no-new-wrappers
    new Number(1),
  ])('rejects non-plain root input case %#', (input) => {
    expectSafeError(() => projectManualDuesEvidence(input));
  });

  test('rejects missing, extra, symbol, inherited, accessor, and proxy fields', () => {
    for (const field of Object.keys(officerCommand())) {
      const input = officerCommand();
      delete input[field];
      expectSafeError(() => projectManualDuesEvidence(input));
    }
    expectSafeError(() => projectManualDuesEvidence({
      ...officerCommand(),
      email: HOSTILE_CANARY,
    }));
    const symbolInput = officerCommand();
    symbolInput[Symbol(HOSTILE_CANARY)] = true;
    expectSafeError(() => projectManualDuesEvidence(symbolInput));
    expectSafeError(() => projectManualDuesEvidence(Object.assign(
      Object.create({ email: HOSTILE_CANARY }),
      officerCommand(),
    )));
    const getterInput = officerCommand();
    Object.defineProperty(getterInput, 'evidenceRef', {
      get() {
        throw new Error(HOSTILE_CANARY);
      },
      enumerable: true,
    });
    expectSafeError(() => projectManualDuesEvidence(getterInput));
    expectSafeError(() => projectManualDuesEvidence(new Proxy(officerCommand(), {})));
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
  ])('rejects non-opaque identifier %p in every opaque field', (value) => {
    for (const field of OPAQUE_FIELDS) {
      expectSafeError(
        () => projectManualDuesEvidence(officerCommand({ [field]: value })),
        value,
      );
    }
  });

  test.each([
    NaN,
    Infinity,
    -Infinity,
    -1,
    0,
    1.5,
    -0,
    '1',
    2n,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid revision %p', (bad) => {
    expectSafeError(() => projectManualDuesEvidence(officerCommand({ expectedRevision: bad })));
    expectSafeError(() => projectManualDuesEvidence(officerCommand({ termRevision: bad })));
  });

  test.each([
    NaN,
    Infinity,
    -1,
    1.5,
    '1000',
    2n,
    8_640_000_000_000_001,
  ])('rejects invalid term time %p', (bad) => {
    expectSafeError(() => projectManualDuesEvidence(officerCommand({ startsAtMs: bad })));
    expectSafeError(() => projectManualDuesEvidence(officerCommand({ endsAtMs: bad })));
  });

  test('rejects equal and reversed term bounds', () => {
    expectSafeError(() => projectManualDuesEvidence(officerCommand({ startsAtMs: TERM_END_MS })));
    expectSafeError(
      () => projectManualDuesEvidence(officerCommand({ startsAtMs: TERM_END_MS + 1 })),
    );
  });

  test('rejects an unsupported schema version', () => {
    expectSafeError(() => projectManualDuesEvidence(officerCommand({
      membershipManualEvidenceSchemaVersion: 2,
    })));
    expectSafeError(() => projectManualDuesEvidence(officerCommand({
      membershipManualEvidenceSchemaVersion: '1',
    })));
  });
});

describe('static non-adoption and dependency boundary', () => {
  test('has no runtime edge, external SDK, clock, random, logger, environment, or provider field', () => {
    const source = fs.readFileSync(path.join(__dirname, 'membershipManualEvidence.js'), 'utf8');
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toContain('membershipManualEvidence');
    expect(source).not.toMatch(/firebase|firestore|stripe|google|whatsapp|strava/i);
    expect(source).not.toMatch(/process\.env|Date\.now|new Date|Math\.random|console\.|fetch\s*\(|https?:/);
    expect(source).not.toMatch(/email|phone|address|dob|emergency|price|payment/i);
    const requires = [...source.matchAll(/require\(([^)]+)\)/g)].map((match) => match[1]);
    expect(requires).toEqual(["'node:util'"]);
  });
});
