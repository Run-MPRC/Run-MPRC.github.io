'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { inspect } = require('node:util');

const {
  membershipTermReceiptSchemaVersion,
  MEMBERSHIP_TERM_RECEIPT_ENUMS,
  MembershipTermReceiptError,
  createTermEvidenceReceipt,
  createMembershipTermLedger,
  appendTermEvidenceReceipt,
  projectTermDecisionCommand,
} = require('./membershipTermReceipt');

const {
  createMembershipAuthority,
  applyMembershipAuthorityCommand,
  deriveMembershipEntitlement,
} = require('./membershipAuthority');

const HOSTILE_CANARY = 'private-member@example.test/+12025550208?token=do-not-copy';
const TERM_START_MS = 1_000_000;
const TERM_END_MS = 2_000_000;

function receiptInput(overrides = {}) {
  return {
    membershipTermReceiptSchemaVersion: 1,
    receiptId: 'rcpt_test_001',
    commandId: 'cmd_term_001',
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

function renewalReceiptInput(overrides = {}) {
  return receiptInput({
    receiptId: 'rcpt_test_002',
    commandId: 'cmd_term_002',
    termRevision: 2,
    termState: 'suspended',
    evidenceRef: 'evidence_test_002',
    policyVersion: 'policy_test_002',
    ...overrides,
  });
}

function ledgerInput(overrides = {}) {
  return {
    membershipTermReceiptSchemaVersion: 1,
    ledgerId: 'ldgr_test_001',
    ...overrides,
  };
}

function envelopeInput(overrides = {}) {
  return {
    membershipAuthoritySchemaVersion: 1,
    expectedRevision: 2,
    ...overrides,
  };
}

function emptyLedger() {
  return createMembershipTermLedger(ledgerInput());
}

function oneReceiptLedger() {
  return appendTermEvidenceReceipt(emptyLedger(), receiptInput());
}

function createLinkedAuthorityRecord() {
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
  expect(error).toBeInstanceOf(MembershipTermReceiptError);
  expect(error).toMatchObject({
    name: 'MembershipTermReceiptError',
    code: 'invalid_membership_term_receipt',
    message: 'Membership term receipt input is invalid.',
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

describe('immutable membership term/evidence receipt ledger contract', () => {
  test('exports one frozen versioned API and enum catalog', () => {
    const api = require('./membershipTermReceipt');
    expect(membershipTermReceiptSchemaVersion).toBe(1);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(MEMBERSHIP_TERM_RECEIPT_ENUMS)).toBe(true);
    for (const values of Object.values(MEMBERSHIP_TERM_RECEIPT_ENUMS)) {
      expect(Object.isFrozen(values)).toBe(true);
    }
    expect(MEMBERSHIP_TERM_RECEIPT_ENUMS.termState).toEqual([
      'decision_pending',
      'approved',
      'suspended',
      'ended',
    ]);
    expect(Object.isFrozen(MembershipTermReceiptError)).toBe(true);
    expect(Object.isFrozen(MembershipTermReceiptError.prototype)).toBe(true);
  });

  test('creates an empty ledger that holds no receipts', () => {
    const input = ledgerInput();
    const before = JSON.stringify(input);
    const ledger = createMembershipTermLedger(input);

    expect(ledger).toEqual({
      membershipTermReceiptSchemaVersion: 1,
      ledgerId: 'ldgr_test_001',
      receiptRevision: 0,
      receipts: [],
    });
    expectDeepFrozen(ledger);
    expect(Object.isFrozen(ledger.receipts)).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });

  test('creates a frozen receipt from an opaque evidence bundle without choosing policy', () => {
    const input = receiptInput();
    const before = JSON.stringify(input);
    const receipt = createTermEvidenceReceipt(input);

    expect(receipt).toEqual({
      membershipTermReceiptSchemaVersion: 1,
      receiptId: 'rcpt_test_001',
      commandId: 'cmd_term_001',
      termRevision: 1,
      termState: 'approved',
      termId: 'term_test_2026',
      startsAtMs: TERM_START_MS,
      endsAtMs: TERM_END_MS,
      planRef: 'plan_test_001',
      evidenceRef: 'evidence_test_001',
      policyVersion: 'policy_test_001',
    });
    expectDeepFrozen(receipt);
    expect(JSON.stringify(input)).toBe(before);
  });

  test('appends renewals as an immutable ordered history that preserves earlier terms', () => {
    const ledger1 = oneReceiptLedger();
    expect(ledger1.receiptRevision).toBe(1);
    expect(ledger1.receipts.map((receipt) => receipt.termRevision)).toEqual([1]);

    const before = JSON.stringify(ledger1);
    const ledger2 = appendTermEvidenceReceipt(ledger1, renewalReceiptInput());

    expect(ledger2.receiptRevision).toBe(2);
    expect(ledger2.receipts.map((receipt) => receipt.termRevision)).toEqual([1, 2]);
    expect(ledger2.receipts[0]).toEqual(createTermEvidenceReceipt(receiptInput()));
    expect(ledger2.receipts[1].termState).toBe('suspended');
    expect(ledger2.receipts[1].evidenceRef).toBe('evidence_test_002');
    expectDeepFrozen(ledger2);
    expect(JSON.stringify(ledger1)).toBe(before);
  });

  test('makes an exact re-append read-only and rejects a changed reuse of the same command', () => {
    const ledger1 = oneReceiptLedger();
    expect(appendTermEvidenceReceipt(ledger1, receiptInput())).toBe(ledger1);

    expectSafeError(() => appendTermEvidenceReceipt(
      ledger1,
      receiptInput({ evidenceRef: 'evidence_changed_001' }),
    ));
    expectSafeError(() => appendTermEvidenceReceipt(
      ledger1,
      receiptInput({ termState: 'suspended' }),
    ));
    expectSafeError(() => appendTermEvidenceReceipt(
      ledger1,
      receiptInput({ receiptId: 'rcpt_test_009' }),
    ));
  });

  test('rejects reused command and receipt identifiers across the whole history', () => {
    const ledger2 = appendTermEvidenceReceipt(oneReceiptLedger(), renewalReceiptInput());

    expectSafeError(() => appendTermEvidenceReceipt(ledger2, receiptInput({
      receiptId: 'rcpt_test_003',
      commandId: 'cmd_term_001',
      termRevision: 3,
    })));
    expectSafeError(() => appendTermEvidenceReceipt(ledger2, receiptInput({
      receiptId: 'rcpt_test_001',
      commandId: 'cmd_term_003',
      termRevision: 3,
    })));
  });

  test('rejects skipped, stale, and out-of-order term revisions', () => {
    expectSafeError(() => appendTermEvidenceReceipt(emptyLedger(), receiptInput({ termRevision: 2 })));

    const ledger1 = oneReceiptLedger();
    expectSafeError(() => appendTermEvidenceReceipt(ledger1, receiptInput({
      receiptId: 'rcpt_test_003',
      commandId: 'cmd_term_003',
      termRevision: 1,
    })));
    expectSafeError(() => appendTermEvidenceReceipt(ledger1, receiptInput({
      receiptId: 'rcpt_test_003',
      commandId: 'cmd_term_003',
      termRevision: 3,
    })));
  });

  test('projects a receipt into the exact record_term_decision command the shipped authority accepts', () => {
    const linked = createLinkedAuthorityRecord();
    const receipt = createTermEvidenceReceipt(receiptInput());
    const command = projectTermDecisionCommand(receipt, envelopeInput());

    expect(command).toEqual({
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
    });
    expect(Object.isFrozen(command)).toBe(true);

    const approved = applyMembershipAuthorityCommand(linked, command);
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
    expect(deriveMembershipEntitlement({
      membershipAuthoritySchemaVersion: 1,
      record: approved,
      uid: 'uid_test_001',
      asOfMs: TERM_START_MS,
    })).toEqual({
      membershipAuthoritySchemaVersion: 1,
      entitlement: 'current_member',
      state: 'active',
    });
  });

  test('ledger term revisions align with the authority renewal grammar end to end', () => {
    const linked = createLinkedAuthorityRecord();
    const firstReceipt = createTermEvidenceReceipt(receiptInput());
    const renewalReceipt = createTermEvidenceReceipt(renewalReceiptInput());

    const ledger = appendTermEvidenceReceipt(
      appendTermEvidenceReceipt(emptyLedger(), firstReceipt),
      renewalReceipt,
    );
    expect(ledger.receipts.map((receipt) => receipt.termRevision)).toEqual([1, 2]);

    const approved = applyMembershipAuthorityCommand(
      linked,
      projectTermDecisionCommand(ledger.receipts[0], envelopeInput()),
    );
    const renewed = applyMembershipAuthorityCommand(
      approved,
      projectTermDecisionCommand(ledger.receipts[1], envelopeInput({ expectedRevision: 3 })),
    );

    expect(approved.term.revision).toBe(1);
    expect(renewed.term.revision).toBe(2);
    expect(renewed.revision).toBe(4);
    expect(renewed.term.state).toBe('suspended');
  });
});

describe('strict and non-identifying input boundary', () => {
  test.each([
    undefined,
    null,
    true,
    1,
    'ledger',
    [],
    new Date(0),
    new Number(1),
  ])('rejects non-plain root input case %#', (input) => {
    expectSafeError(() => createMembershipTermLedger(input));
    expectSafeError(() => createTermEvidenceReceipt(input));
    expectSafeError(() => appendTermEvidenceReceipt(input, receiptInput()));
    expectSafeError(() => appendTermEvidenceReceipt(emptyLedger(), input));
    expectSafeError(() => projectTermDecisionCommand(input, envelopeInput()));
    expectSafeError(() => projectTermDecisionCommand(receiptInput(), input));
  });

  test('rejects missing, extra, symbol, inherited, accessor, and proxy fields', () => {
    for (const field of Object.keys(receiptInput())) {
      const input = receiptInput();
      delete input[field];
      expectSafeError(() => createTermEvidenceReceipt(input));
    }
    for (const field of Object.keys(ledgerInput())) {
      const input = ledgerInput();
      delete input[field];
      expectSafeError(() => createMembershipTermLedger(input));
    }
    expectSafeError(() => createTermEvidenceReceipt({ ...receiptInput(), email: HOSTILE_CANARY }));
    const symbolInput = receiptInput();
    symbolInput[Symbol(HOSTILE_CANARY)] = true;
    expectSafeError(() => createTermEvidenceReceipt(symbolInput));
    expectSafeError(() => createTermEvidenceReceipt(Object.assign(
      Object.create({ email: HOSTILE_CANARY }),
      receiptInput(),
    )));
    const getterInput = receiptInput();
    Object.defineProperty(getterInput, 'termId', {
      get() {
        throw new Error(HOSTILE_CANARY);
      },
      enumerable: true,
    });
    expectSafeError(() => createTermEvidenceReceipt(getterInput));
    expectSafeError(() => createTermEvidenceReceipt(new Proxy(receiptInput(), {})));
    expectSafeError(() => createMembershipTermLedger(new Proxy(ledgerInput(), {})));
    expectSafeError(() => appendTermEvidenceReceipt(
      new Proxy(emptyLedger(), {}),
      receiptInput(),
    ));
    expectSafeError(() => appendTermEvidenceReceipt(
      emptyLedger(),
      new Proxy(receiptInput(), {}),
    ));
    expectSafeError(() => projectTermDecisionCommand(new Proxy(receiptInput(), {}), envelopeInput()));
    expectSafeError(() => projectTermDecisionCommand(receiptInput(), new Proxy(envelopeInput(), {})));
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
    expectSafeError(() => createTermEvidenceReceipt(receiptInput({ receiptId: value })), value);
    expectSafeError(() => createTermEvidenceReceipt(receiptInput({ commandId: value })), value);
    expectSafeError(() => createTermEvidenceReceipt(receiptInput({ termId: value })), value);
    expectSafeError(() => createTermEvidenceReceipt(receiptInput({ planRef: value })), value);
    expectSafeError(() => createTermEvidenceReceipt(receiptInput({ evidenceRef: value })), value);
    expectSafeError(() => createTermEvidenceReceipt(receiptInput({ policyVersion: value })), value);
    expectSafeError(() => createMembershipTermLedger(ledgerInput({ ledgerId: value })), value);
  });

  test.each([
    ['email', HOSTILE_CANARY],
    ['phoneNumber', '+12025550208'],
    ['provider', 'google.com'],
    ['role', 'admin_canary_345'],
    ['stripePaymentId', 'pi_private'],
    ['priceCents', 2500],
    ['memberName', 'Private Runner'],
  ])('rejects forbidden caller field %s', (field, value) => {
    expectSafeError(() => createTermEvidenceReceipt({ ...receiptInput(), [field]: value }), String(value));
  });

  test.each([
    NaN,
    Infinity,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER,
  ])('rejects invalid term time %p', (startsAtMs) => {
    expectSafeError(() => createTermEvidenceReceipt(receiptInput({ startsAtMs })));
  });

  test('rejects equal and reversed term bounds', () => {
    expectSafeError(() => createTermEvidenceReceipt(receiptInput({ startsAtMs: TERM_END_MS })));
    expectSafeError(() => createTermEvidenceReceipt(receiptInput({ startsAtMs: TERM_END_MS + 1 })));
  });

  test('rejects unsupported schema versions, term states, and non-recorded revisions', () => {
    expectSafeError(() => createTermEvidenceReceipt(receiptInput({
      membershipTermReceiptSchemaVersion: 2,
    })));
    expectSafeError(() => createMembershipTermLedger(ledgerInput({
      membershipTermReceiptSchemaVersion: 2,
    })));
    expectSafeError(() => createTermEvidenceReceipt(receiptInput({ termState: 'paid' })));
    expectSafeError(() => createTermEvidenceReceipt(receiptInput({ termRevision: 0 })));
  });

  test('validates ledger snapshots again instead of trusting caller-created arrays', () => {
    const valid = oneReceiptLedger();
    const clone = () => JSON.parse(JSON.stringify(valid));
    const nextReceipt = renewalReceiptInput();

    const badCount = clone();
    badCount.receiptRevision = 2;
    expectSafeError(() => appendTermEvidenceReceipt(badCount, nextReceipt));

    const extraField = clone();
    extraField.receipts[0].priceCents = 2500;
    expectSafeError(() => appendTermEvidenceReceipt(extraField, nextReceipt));

    const nonMonotonic = clone();
    nonMonotonic.receipts[0].termRevision = 2;
    expectSafeError(() => appendTermEvidenceReceipt(nonMonotonic, nextReceipt));

    const notArray = clone();
    notArray.receipts = { 0: createTermEvidenceReceipt(receiptInput()), length: 1 };
    expectSafeError(() => appendTermEvidenceReceipt(notArray, nextReceipt));

    const sparse = clone();
    const holed = [];
    holed[1] = createTermEvidenceReceipt(receiptInput());
    sparse.receipts = holed;
    sparse.receiptRevision = 2;
    expectSafeError(() => appendTermEvidenceReceipt(sparse, renewalReceiptInput({ termRevision: 3 })));

    const proxied = clone();
    proxied.receipts = new Proxy(valid.receipts.map((receipt) => ({ ...receipt })), {});
    expectSafeError(() => appendTermEvidenceReceipt(proxied, nextReceipt));

    const duplicated = clone();
    duplicated.receipts = [duplicated.receipts[0], { ...duplicated.receipts[0], termRevision: 2 }];
    duplicated.receiptRevision = 2;
    expectSafeError(() => appendTermEvidenceReceipt(duplicated, renewalReceiptInput({ termRevision: 3 })));
  });

  test('rejects malformed projection envelopes', () => {
    expectSafeError(() => projectTermDecisionCommand(
      receiptInput(),
      envelopeInput({ membershipAuthoritySchemaVersion: 2 }),
    ));
    expectSafeError(() => projectTermDecisionCommand(receiptInput(), envelopeInput({ expectedRevision: 0 })));
    expectSafeError(() => projectTermDecisionCommand(receiptInput(), envelopeInput({ expectedRevision: 1.5 })));
    expectSafeError(() => projectTermDecisionCommand(
      receiptInput(),
      { ...envelopeInput(), commandId: 'cmd_extra_001' },
    ));
    for (const field of Object.keys(envelopeInput())) {
      const input = envelopeInput();
      delete input[field];
      expectSafeError(() => projectTermDecisionCommand(receiptInput(), input));
    }
  });
});

describe('static non-adoption and dependency boundary', () => {
  test('has no runtime edge, external SDK, clock, random, logger, environment, or provider field', () => {
    const source = fs.readFileSync(path.join(__dirname, 'membershipTermReceipt.js'), 'utf8');
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toContain('membershipTermReceipt');
    expect(source).not.toMatch(/firebase|firestore|stripe|google|whatsapp|strava/i);
    expect(source).not.toMatch(/process\.env|Date\.now|new Date|Math\.random|console\.|fetch\s*\(|https?:/);
    expect(source).not.toMatch(/email|phone|address|dob|emergency|price|payment/i);
    const requires = [...source.matchAll(/require\(([^)]+)\)/g)].map((match) => match[1]);
    expect(requires).toEqual(["'node:util'"]);
  });
});
