const admin = require('firebase-admin');
// Test-only pinned SDK boundary: fail visibly on an SDK upgrade rather than
// silently replacing the real post-callback Firestore commit proof.
const {
  Transaction: FirestoreTransaction,
} = require('@google-cloud/firestore/build/src/transaction');

const {
  createCommandKey,
  createPayloadFingerprint,
} = require('./commerceCommandIdentity');
const {
  CommerceCommandJournalError,
  acquireCommerceCommandLease,
  authorizeNextStripeProviderAttempt,
  bindInitialStripeProviderPlan,
  completeCommerceCommand,
  failCommerceCommand,
  recordInitialStripeReconciliationEvidence,
  recordInitialStripeSendEvidence,
  registerCommerceCommand,
} = require('./commerceCommandJournal');

const PROJECT_ID = 'demo-pay002b2-test';
const APP_NAME = 'commerce-command-journal-emulator-test';
const CONCURRENT_CALLS = 24;
const MAXIMUM_WHOLE_OPERATION_CALLS = 3;
const JOURNAL_EMULATOR_OPT_IN = 'REQUIRE_COMMERCE_COMMAND_JOURNAL_EMULATOR';
const describeWithEmulator = process.env[JOURNAL_EMULATOR_OPT_IN] === '1'
  ? describe
  : describe.skip;

jest.setTimeout(60000);

const COMMAND_IDS = Object.freeze({
  identical: '11111111-1111-4111-8111-111111111111',
  conflict: '22222222-2222-4222-8222-222222222222',
  orphanAudit: '33333333-3333-4333-8333-333333333333',
  lostResponse: '44444444-4444-4444-8444-444444444444',
  malformed: '55555555-5555-4555-8555-555555555555',
  future: '66666666-6666-4666-8666-666666666666',
  distinctLeaseRace: '77777777-7777-4777-8777-777777777777',
  sameLeaseRace: '88888888-8888-4888-8888-888888888888',
  takeoverRace: '99999999-9999-4999-8999-999999999999',
  terminalRace: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  commitmentRace: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  terminalReplay: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  finalFailureReplay: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  preseedLifecycleAudit: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  malformedLifecycle: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  orphanLifecycle: '01234567-89ab-4cde-8fab-0123456789ab',
  preseedTerminalAudit: '12345678-9abc-4def-8abc-123456789abc',
  missingCurrentAudit: '23456789-abcd-4efa-8bcd-23456789abcd',
  malformedLifecycleShape: '3456789a-bcde-4fab-8cde-3456789abcde',
  malformedCurrentAudit: '456789ab-cdef-4abc-8def-456789abcdef',
  providerSamePlan: '56789abc-def0-4bcd-8ef0-56789abcdef0',
  providerConflict: '6789abcd-ef01-4cde-8f01-6789abcdef01',
  providerLostResponse: '789abcde-f012-4def-8012-789abcdef012',
  providerTakeover: '89abcdef-0123-4efa-8123-89abcdef0123',
  providerWrongHolder: '9abcdef0-1234-4fab-8234-9abcdef01234',
  providerTerminal: 'abcdef01-2345-4abc-8345-abcdef012345',
  providerPreseedAudit: 'bcdef012-3456-4bcd-8456-bcdef0123456',
  providerOrphanPlan: 'cdef0123-4567-4cde-8567-cdef01234567',
  providerMalformedPlan: 'def01234-5678-4def-8678-def012345678',
  providerFutureAudit: 'ef012345-6789-4efa-8789-ef0123456789',
  providerMalformedRoot: 'f0123456-789a-4fab-889a-f0123456789a',
  providerMalformedLifecycle: '13579bdf-2468-4ace-8bdf-13579bdf2468',
  providerEarlierClock: '2468ace0-1357-4bdf-8ace-2468ace01357',
  providerOrphanAudit: '3579bdf1-4680-4ace-8bdf-3579bdf14680',
  providerExpiredBeforeBind: '468ace02-5791-4bdf-8ace-468ace025791',
  providerTerminalNoPlan: '579bdf13-6802-4ace-8bdf-579bdf136802',
  providerCommitFailure: '68ace024-7913-4bdf-8ace-68ace0247913',
  providerSendConcurrent: '71ace024-7913-4bdf-8ace-68ace0247913',
  providerSendBoundary: '72ace024-7913-4bdf-8ace-68ace0247913',
  providerSendConflict: '73ace024-7913-4bdf-8ace-68ace0247913',
  providerSendReplacement: '76ace024-7913-4bdf-8ace-68ace0247913',
  providerSendCommitFailure: '74ace024-7913-4bdf-8ace-68ace0247913',
  providerSendOrphan: '75ace024-7913-4bdf-8ace-68ace0247913',
  providerReconciliationConcurrent: '81ace024-7913-4bdf-8ace-68ace0247913',
  providerReconciliationConflict: '82ace024-7913-4bdf-8ace-68ace0247913',
  providerReconciliationLostResponse: '83ace024-7913-4bdf-8ace-68ace0247913',
  providerReconciliationTakeover: '84ace024-7913-4bdf-8ace-68ace0247913',
  providerReconciliationCommitFailure: '85ace024-7913-4bdf-8ace-68ace0247913',
  providerReconciliationOrphan: '86ace024-7913-4bdf-8ace-68ace0247913',
  providerReconciliationMalformedSend: '87ace024-7913-4bdf-8ace-68ace0247913',
  providerAuthorizationNeverBegan: '91ace024-7913-4bdf-8ace-68ace0247913',
  providerAuthorizationExpired: '92ace024-7913-4bdf-8ace-68ace0247913',
  providerAuthorizationConcurrent: '93ace024-7913-4bdf-8ace-68ace0247913',
  providerAuthorizationConflict: '94ace024-7913-4bdf-8ace-68ace0247913',
  providerAuthorizationLostResponse: '95ace024-7913-4bdf-8ace-68ace0247913',
  providerAuthorizationCommitFailure: '96ace024-7913-4bdf-8ace-68ace0247913',
  providerAuthorizationOrphan: '97ace024-7913-4bdf-8ace-68ace0247913',
  providerAuthorizationMalformed: '98ace024-7913-4bdf-8ace-68ace0247913',
});
const BASE_NOW_MILLIS = 1800000000123;
const LEASE_DURATION_MILLIS = 60000;
const TERMINAL_REFERENCE_FINGERPRINT = 'd'.repeat(64);
const OTHER_TERMINAL_REFERENCE_FINGERPRINT = 'e'.repeat(64);
const STRIPE_ACCOUNT_ID = 'acct_1SyntheticTest000000000001';
const OTHER_STRIPE_ACCOUNT_ID = 'acct_1SyntheticTest000000000002';
const STRIPE_API_VERSION = '2025-06-30.basil';
const STRIPE_ENDPOINT_PATH = '/v1/checkout/sessions';
const STRIPE_OPERATION = 'checkout_session_create';
const PROVIDER_SEND_RETRY_WINDOW_MILLIS = 23 * 60 * 60 * 1000;
const TRANSITION_RECORD_COMMITMENT = 'f'.repeat(64);
const OTHER_TRANSITION_RECORD_COMMITMENT = '0'.repeat(64);

function frozenRecord(entries) {
  const record = Object.create(null);
  for (const [key, value] of entries) record[key] = value;
  return Object.freeze(record);
}

function payload(reference) {
  return frozenRecord([
    ['amountCents', 2500],
    ['currency', 'usd'],
    ['syntheticReference', reference],
  ]);
}

function providerParameters(reference) {
  return frozenRecord([
    ['amount_total', 2500],
    ['currency', 'usd'],
    ['synthetic_reference', reference],
  ]);
}

function commandArgs(db, commandId, commandPayload) {
  return {
    db,
    environment: 'test',
    callerScope: {
      kind: 'firebase_uid',
      value: 'synthetic_emulator_runner',
    },
    commandId,
    commandType: 'race.checkout.create',
    endpointSchemaVersion: 1,
    payload: commandPayload,
  };
}

function deterministicLeaseId(index) {
  return `10000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function acquireArgs(db, commandId, commandPayload, leaseId) {
  return {
    ...commandArgs(db, commandId, commandPayload),
    leaseId,
  };
}

function completeArgs(db, commandId, commandPayload, leaseId, expectedFenceEpoch,
  terminalReferenceFingerprint = TERMINAL_REFERENCE_FINGERPRINT) {
  return {
    ...acquireArgs(db, commandId, commandPayload, leaseId),
    expectedFenceEpoch,
    terminalReferenceFingerprint,
  };
}

function failArgs(db, commandId, commandPayload, leaseId, expectedFenceEpoch) {
  return {
    ...acquireArgs(db, commandId, commandPayload, leaseId),
    expectedFenceEpoch,
  };
}

function providerPlanArgs(
  db,
  commandId,
  commandPayload,
  leaseId,
  expectedFenceEpoch,
  parameters,
  overrides = {},
) {
  return {
    ...acquireArgs(db, commandId, commandPayload, leaseId),
    expectedFenceEpoch,
    stripeAccountId: STRIPE_ACCOUNT_ID,
    stripeMode: 'test',
    stripeApiVersion: STRIPE_API_VERSION,
    endpointPath: STRIPE_ENDPOINT_PATH,
    providerOperation: STRIPE_OPERATION,
    providerParameters: parameters,
    ...overrides,
  };
}

function reconciliationArgs(providerArgs, reconciliationEvidence) {
  return {
    db: providerArgs.db,
    environment: providerArgs.environment,
    callerScope: providerArgs.callerScope,
    commandId: providerArgs.commandId,
    commandType: providerArgs.commandType,
    endpointSchemaVersion: providerArgs.endpointSchemaVersion,
    payload: providerArgs.payload,
    stripeAccountId: providerArgs.stripeAccountId,
    stripeMode: providerArgs.stripeMode,
    stripeApiVersion: providerArgs.stripeApiVersion,
    endpointPath: providerArgs.endpointPath,
    providerOperation: providerArgs.providerOperation,
    providerParameters: providerArgs.providerParameters,
    reconciliationEvidence,
  };
}

function providerAuthorizationArgs(
  providerArgs,
  leaseId,
  expectedFenceEpoch,
  reconciliationEvidence,
  transitionKind,
  recordCommitment = TRANSITION_RECORD_COMMITMENT,
) {
  return {
    ...reconciliationArgs(providerArgs, reconciliationEvidence),
    leaseId,
    expectedFenceEpoch,
    transitionAuthorization: Object.freeze({
      kind: transitionKind,
      recordCommitment,
    }),
  };
}

function dispatchNeverBeganCandidate() {
  return Object.freeze({
    reconciliationPolicySchemaVersion: 1,
    provider: 'stripe',
    providerAttempt: 1,
    planBinding: 'exact',
    evidenceSource: 'trusted_dispatch_history',
    evidenceCompleteness: 'complete',
    dispatchEvidence: 'execution_never_began',
    responseEvidence: 'none',
    idempotencyEvidence: 'not_relied_upon',
    providerObjectEvidence: 'none',
    paymentEvidence: 'none',
    eventEvidence: 'none',
    searchEvidence: 'none',
    businessTransitionEvidence: 'same_operation_eligible',
  });
}

function expiredAttemptCandidate() {
  return Object.freeze({
    reconciliationPolicySchemaVersion: 1,
    provider: 'stripe',
    providerAttempt: 1,
    planBinding: 'exact',
    evidenceSource: 'verified_provider_and_event',
    evidenceCompleteness: 'complete',
    dispatchEvidence: 'execution_started',
    responseEvidence: 'accepted',
    idempotencyEvidence: 'not_relied_upon',
    providerObjectEvidence: 'exact_expired',
    paymentEvidence: 'unpaid',
    eventEvidence: 'verified_expiry',
    searchEvidence: 'exact_lookup_complete',
    businessTransitionEvidence: 'new_generation_eligible',
  });
}

function assertExactSafeEmulator() {
  if (process.env[JOURNAL_EMULATOR_OPT_IN] !== '1') {
    throw new Error('The commerce command journal emulator opt-in is required.');
  }
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (typeof emulatorHost !== 'string') {
    throw new Error('The Firestore emulator host is required.');
  }

  let parsed;
  try {
    parsed = new URL(`http://${emulatorHost}`);
  } catch {
    throw new Error('The Firestore emulator host is invalid.');
  }
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  const port = Number(parsed.port);
  if (!loopbackHosts.has(parsed.hostname)
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== ''
    || !Number.isInteger(port)
    || port < 1
    || port > 65535) {
    throw new Error('The Firestore emulator must use a loopback host and explicit port.');
  }

  if (process.env.GCLOUD_PROJECT !== PROJECT_ID) {
    throw new Error(`The emulator project must be exactly ${PROJECT_ID}.`);
  }
  if (process.env.GOOGLE_CLOUD_PROJECT
    && process.env.GOOGLE_CLOUD_PROJECT !== PROJECT_ID) {
    throw new Error(`The Google Cloud project must be exactly ${PROJECT_ID}.`);
  }
}

function commandIdentity(args) {
  return createCommandKey({
    environment: args.environment,
    callerScope: args.callerScope,
    commandId: args.commandId,
  });
}

function fingerprint(args) {
  return createPayloadFingerprint({
    commandType: args.commandType,
    payload: args.payload,
  }).payloadFingerprint;
}

function snapshotEvidence(snapshot) {
  return {
    exists: snapshot.exists,
    data: snapshot.data(),
    createTime: snapshot.createTime && snapshot.createTime.toMillis(),
    updateTime: snapshot.updateTime && snapshot.updateTime.toMillis(),
  };
}

function expectJournalError(error, reason) {
  expect(error).toBeInstanceOf(CommerceCommandJournalError);
  expect(error).toMatchObject({
    code: 'commerce_command_journal_error',
    reason,
  });
  expect(Object.isFrozen(error)).toBe(true);
}

// The emulator can exhaust Firestore's fixed internal retry budget under an
// intentional same-document race. Retry only the exact caller operation, with
// the same closed-over immutable input and no delay or regenerated identity.
async function retryWholeOperationAfterUnavailable(operation, retryEvidence) {
  retryEvidence.operations += 1;
  for (let call = 1; call <= MAXIMUM_WHOLE_OPERATION_CALLS; call += 1) {
    try {
      return await operation();
    } catch (error) {
      const mayRetry = error instanceof CommerceCommandJournalError
        && error.reason === 'journal_unavailable'
        && call < MAXIMUM_WHOLE_OPERATION_CALLS;
      if (!mayRetry) throw error;
      retryEvidence.unavailableRetries += 1;
    }
  }
  throw new Error('The bounded whole-operation retry loop did not return or throw.');
}

describeWithEmulator('commerce command journal Firestore transaction', () => {
  let app;
  let db;
  let trackedRefs = new Map();
  let nowMillis;
  let timestampNow;
  let retryEvidence;

  function trackRef(ref) {
    trackedRefs.set(ref.path, ref);
    return ref;
  }

  function auditRefFor(commandKeyHash, revision) {
    return trackRef(db.collection('auditEvents')
      .doc(`commerce_command_${commandKeyHash}_${String(revision).padStart(10, '0')}`));
  }

  function pairFor(args) {
    const { commandKeyHash } = commandIdentity(args);
    const commandRef = trackRef(db.collection('checkoutRequests').doc(commandKeyHash));
    const lifecycleRef = trackRef(commandRef.collection('lifecycle').doc('current'));
    const providerPlanRef = trackRef(commandRef.collection('providerAttempts')
      .doc('0000000001'));
    const nextProviderPlanRef = trackRef(commandRef.collection('providerAttempts')
      .doc('0000000002'));
    const providerAuditRef = trackRef(db.collection('auditEvents')
      .doc(`commerce_provider_attempt_${commandKeyHash}_0000000001`));
    const providerSendRef = trackRef(providerPlanRef.collection('sendEvidence').doc('first'));
    const nextProviderSendRef = trackRef(nextProviderPlanRef
      .collection('sendEvidence').doc('first'));
    const providerSendAuditRef = trackRef(db.collection('auditEvents')
      .doc(`commerce_provider_send_${commandKeyHash}_0000000001`));
    const providerReconciliationRef = trackRef(providerPlanRef
      .collection('reconciliationEvidence').doc('0000000001'));
    const providerReconciliationAuditRef = trackRef(db.collection('auditEvents')
      .doc(`commerce_provider_reconciliation_${commandKeyHash}_0000000001_0000000001`));
    const providerAuthorizationRef = trackRef(providerReconciliationRef
      .collection('nextAttemptAuthorizations').doc('0000000002'));
    const providerAuthorizationAuditRef = trackRef(db.collection('auditEvents')
      .doc(
        `commerce_provider_authorization_${commandKeyHash}`
        + '_0000000001_0000000001_0000000002',
      ));
    const auditRef = auditRefFor(commandKeyHash, 1);
    // Track every revision this focused suite can create before a concurrent
    // assertion runs, so even an early failure cannot leak synthetic audits.
    for (const revision of [2, 3, 4]) auditRefFor(commandKeyHash, revision);
    return {
      commandKeyHash,
      commandRef,
      lifecycleRef,
      auditRef,
      providerPlanRef,
      nextProviderPlanRef,
      providerAuditRef,
      providerSendRef,
      nextProviderSendRef,
      providerSendAuditRef,
      providerReconciliationRef,
      providerReconciliationAuditRef,
      providerAuthorizationRef,
      providerAuthorizationAuditRef,
    };
  }

  async function readPair(pair) {
    const [commandSnapshot, auditSnapshot] = await Promise.all([
      pair.commandRef.get(),
      pair.auditRef.get(),
    ]);
    return { commandSnapshot, auditSnapshot };
  }

  async function readLifecycle(pair) {
    return pair.lifecycleRef.get();
  }

  async function readAudit(pair, revision) {
    return auditRefFor(pair.commandKeyHash, revision).get();
  }

  async function readLifecycleEvidence(pair, revision) {
    const [lifecycleSnapshot, auditSnapshot] = await Promise.all([
      readLifecycle(pair),
      readAudit(pair, revision),
    ]);
    return {
      lifecycle: snapshotEvidence(lifecycleSnapshot),
      audit: snapshotEvidence(auditSnapshot),
    };
  }

  async function readProviderEvidence(pair) {
    const [planSnapshot, auditSnapshot] = await Promise.all([
      pair.providerPlanRef.get(),
      pair.providerAuditRef.get(),
    ]);
    return {
      plan: snapshotEvidence(planSnapshot),
      audit: snapshotEvidence(auditSnapshot),
    };
  }

  async function readProviderSendEvidence(pair) {
    const [evidenceSnapshot, auditSnapshot] = await Promise.all([
      pair.providerSendRef.get(),
      pair.providerSendAuditRef.get(),
    ]);
    return {
      evidence: snapshotEvidence(evidenceSnapshot),
      audit: snapshotEvidence(auditSnapshot),
    };
  }

  async function readProviderReconciliationEvidence(pair) {
    const [evidenceSnapshot, auditSnapshot] = await Promise.all([
      pair.providerReconciliationRef.get(),
      pair.providerReconciliationAuditRef.get(),
    ]);
    return {
      evidence: snapshotEvidence(evidenceSnapshot),
      audit: snapshotEvidence(auditSnapshot),
    };
  }

  async function readProviderAuthorizationEvidence(pair) {
    const [authorizationSnapshot, auditSnapshot] = await Promise.all([
      pair.providerAuthorizationRef.get(),
      pair.providerAuthorizationAuditRef.get(),
    ]);
    return {
      authorization: snapshotEvidence(authorizationSnapshot),
      audit: snapshotEvidence(auditSnapshot),
    };
  }

  async function readFoundationEvidence(pair, lifecycleRevision) {
    const [registration, lifecycle] = await Promise.all([
      readPair(pair),
      readLifecycleEvidence(pair, lifecycleRevision),
    ]);
    return {
      command: snapshotEvidence(registration.commandSnapshot),
      registrationAudit: snapshotEvidence(registration.auditSnapshot),
      lifecycle,
    };
  }

  async function matchingAudits(pair) {
    return db.collection('auditEvents')
      .where('commandKeyHash', '==', pair.commandKeyHash)
      .get();
  }

  function setTrustedNow(millis) {
    nowMillis = millis;
  }

  function expectLeaseResult(result, fenceEpoch) {
    expect(result).toEqual({
      journalSchemaVersion: 1,
      lifecycleSchemaVersion: 1,
      outcome: 'lease_acquired',
      state: 'leased',
      fenceEpoch,
      leaseExpiresAt: {
        seconds: expect.any(Number),
        nanoseconds: expect.any(Number),
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.leaseExpiresAt)).toBe(true);
  }

  function expectBusyResult(result) {
    expect(result).toEqual({
      journalSchemaVersion: 1,
      lifecycleSchemaVersion: 1,
      outcome: 'lease_busy',
      state: 'leased',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).not.toHaveProperty('fenceEpoch');
    expect(result).not.toHaveProperty('leaseExpiresAt');
  }

  function expectTerminalResult(result, state) {
    expect(result).toEqual({
      journalSchemaVersion: 1,
      lifecycleSchemaVersion: 1,
      outcome: state === 'succeeded' ? 'terminal_succeeded' : 'terminal_failed_final',
      state,
    });
    expect(Object.isFrozen(result)).toBe(true);
  }

  function expectProviderPlanResult(result, outcome) {
    expect(result).toEqual({
      journalSchemaVersion: 1,
      providerPlanSchemaVersion: 1,
      outcome,
      state: 'planned',
    });
    expect(Object.isFrozen(result)).toBe(true);
  }

  function expectProviderSendResult(result, outcome) {
    expect(result).toEqual({
      journalSchemaVersion: 1,
      providerPlanSchemaVersion: 1,
      providerSendEvidenceSchemaVersion: 1,
      outcome,
      state: outcome === 'send_permitted'
        ? 'pre_send_recorded'
        : 'provider_outcome_unknown',
    });
    expect(Object.isFrozen(result)).toBe(true);
  }

  function expectProviderReconciliationResult(result) {
    expect(result).toEqual({
      journalSchemaVersion: 1,
      providerReconciliationEvidenceSchemaVersion: 1,
      reconciliationPolicySchemaVersion: 1,
      outcome: 'reconciliation_candidate_persisted',
      state: 'requires_separate_authorization',
    });
    expect(Object.isFrozen(result)).toBe(true);
  }

  function expectProviderAuthorizationResult(result) {
    expect(result).toEqual({
      journalSchemaVersion: 1,
      providerAttemptAuthorizationSchemaVersion: 1,
      outcome: 'provider_attempt_authorized',
      state: 'requires_plan_binding',
    });
    expect(Object.isFrozen(result)).toBe(true);
  }

  function expectNewAttemptCandidate(result) {
    expect(result).toEqual({
      reconciliationPolicySchemaVersion: 1,
      classification: 'new_attempt_candidate',
      state: 'requires_persistence_and_authorization',
    });
    expect(Object.isFrozen(result)).toBe(true);
  }

  async function setupLeasedCommand(commandId, reference, leaseIndex) {
    const commandPayload = payload(reference);
    const leaseId = deterministicLeaseId(leaseIndex);
    const registrationArgs = commandArgs(db, commandId, commandPayload);
    const leaseArgs = acquireArgs(db, commandId, commandPayload, leaseId);
    const pair = pairFor(leaseArgs);
    await registerCommerceCommand(registrationArgs);
    expectLeaseResult(await acquireCommerceCommandLease(leaseArgs), 1);
    return {
      commandPayload,
      leaseId,
      registrationArgs,
      leaseArgs,
      pair,
    };
  }

  async function setupBoundProviderPlan(commandId, reference, leaseIndex) {
    const setup = await setupLeasedCommand(commandId, reference, leaseIndex);
    const args = providerPlanArgs(
      db,
      commandId,
      setup.commandPayload,
      setup.leaseId,
      1,
      providerParameters(reference),
    );
    expectProviderPlanResult(
      await bindInitialStripeProviderPlan(args),
      'provider_plan_bound',
    );
    return { ...setup, args };
  }

  async function setupProviderReconciliationFoundation(
    commandId,
    reference,
    leaseIndex,
  ) {
    const setup = await setupBoundProviderPlan(commandId, reference, leaseIndex);
    expectProviderSendResult(
      await recordInitialStripeSendEvidence(setup.args),
      'send_permitted',
    );
    const send = await readProviderSendEvidence(setup.pair);
    const automaticRetryDeadlineAt = send.evidence.data.automaticRetryDeadlineAt;
    return { ...setup, send, automaticRetryDeadlineAt };
  }

  async function setupPersistedProviderCandidate(
    commandId,
    reference,
    leaseIndex,
    reconciliationEvidence,
  ) {
    const setup = await setupProviderReconciliationFoundation(
      commandId,
      reference,
      leaseIndex,
    );
    const persistedArgs = reconciliationArgs(setup.args, reconciliationEvidence);
    setTrustedNow(setup.automaticRetryDeadlineAt.toMillis());
    expectProviderReconciliationResult(
      await recordInitialStripeReconciliationEvidence(persistedArgs),
    );

    const freshLeaseId = deterministicLeaseId(leaseIndex + 1);
    expectLeaseResult(await acquireCommerceCommandLease(acquireArgs(
      db,
      commandId,
      setup.commandPayload,
      freshLeaseId,
    )), 2);
    const transitionKind = reconciliationEvidence.businessTransitionEvidence
      === 'same_operation_eligible'
      ? 'retry_same_operation'
      : 'replace_expired_unpaid';
    const authorizationArgs = providerAuthorizationArgs(
      setup.args,
      freshLeaseId,
      2,
      reconciliationEvidence,
      transitionKind,
    );
    return {
      ...setup,
      persistedArgs,
      freshLeaseId,
      transitionKind,
      authorizationArgs,
    };
  }

  async function cleanupTrackedRefs() {
    if (!trackedRefs) return;
    const refs = [...trackedRefs.values()];
    trackedRefs.clear();
    if (refs.length === 0) return;
    if (!db) throw new Error('The Firestore emulator database is unavailable.');
    const batch = db.batch();
    for (const ref of refs) batch.delete(ref);
    await batch.commit();
  }

  beforeAll(() => {
    assertExactSafeEmulator();
    app = admin.initializeApp({ projectId: PROJECT_ID }, APP_NAME);
    db = app.firestore();
  });

  beforeEach(() => {
    trackedRefs = new Map();
    retryEvidence = { operations: 0, unavailableRetries: 0 };
    nowMillis = BASE_NOW_MILLIS;
    timestampNow = jest.spyOn(admin.firestore.Timestamp, 'now')
      .mockImplementation(() => admin.firestore.Timestamp.fromMillis(nowMillis));
  });

  afterEach(async () => {
    timestampNow.mockRestore();
    expect(retryEvidence.unavailableRetries)
      .toBeLessThanOrEqual(retryEvidence.operations * (MAXIMUM_WHOLE_OPERATION_CALLS - 1));
    await cleanupTrackedRefs();
  });

  afterAll(async () => {
    if (trackedRefs) await cleanupTrackedRefs();
    if (app) await app.delete();
  });

  test('24 identical concurrent calls create one command and one audit event', async () => {
    const args = commandArgs(db, COMMAND_IDS.identical, payload('identical'));
    const pair = pairFor(args);

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_CALLS }, () => retryWholeOperationAfterUnavailable(
        () => registerCommerceCommand(args),
        retryEvidence,
      )),
    );

    expect(results.filter((result) => result.outcome === 'registered_new')).toHaveLength(1);
    expect(results.filter((result) => result.outcome === 'registered_existing'))
      .toHaveLength(CONCURRENT_CALLS - 1);
    for (const result of results) {
      expect(result).toEqual({
        journalSchemaVersion: 1,
        outcome: expect.stringMatching(/^registered_(?:new|existing)$/),
        state: 'registered',
      });
      expect(Object.isFrozen(result)).toBe(true);
    }

    const stored = await readPair(pair);
    expect(stored.commandSnapshot.exists).toBe(true);
    expect(stored.auditSnapshot.exists).toBe(true);
    expect(stored.auditSnapshot.data().commandKeyHash).toBe(pair.commandKeyHash);
    const matchingAuditEvents = await db.collection('auditEvents')
      .where('commandKeyHash', '==', pair.commandKeyHash)
      .get();
    expect(matchingAuditEvents.size).toBe(1);
  });

  test('a concurrent two-payload race commits one identity and never overwrites it', async () => {
    const firstArgs = commandArgs(db, COMMAND_IDS.conflict, payload('race-a'));
    const secondArgs = commandArgs(db, COMMAND_IDS.conflict, payload('race-b'));
    const pair = pairFor(firstArgs);

    const calls = [
      ...Array.from({ length: 12 }, () => retryWholeOperationAfterUnavailable(
        () => registerCommerceCommand(firstArgs),
        retryEvidence,
      )),
      ...Array.from({ length: 12 }, () => retryWholeOperationAfterUnavailable(
        () => registerCommerceCommand(secondArgs),
        retryEvidence,
      )),
    ];
    const settled = await Promise.allSettled(calls);
    const fulfilled = settled.filter((result) => result.status === 'fulfilled');
    const rejected = settled.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(12);
    expect(rejected).toHaveLength(12);
    expect(fulfilled.filter((result) => result.value.outcome === 'registered_new'))
      .toHaveLength(1);
    expect(fulfilled.filter((result) => result.value.outcome === 'registered_existing'))
      .toHaveLength(11);
    for (const result of rejected) expectJournalError(result.reason, 'command_conflict');

    const firstFingerprint = fingerprint(firstArgs);
    const secondFingerprint = fingerprint(secondArgs);
    const initialPair = await readPair(pair);
    const storedFingerprint = initialPair.commandSnapshot.data().payloadFingerprint;
    expect([firstFingerprint, secondFingerprint]).toContain(storedFingerprint);
    const winningArgs = storedFingerprint === firstFingerprint ? firstArgs : secondArgs;
    const losingArgs = storedFingerprint === firstFingerprint ? secondArgs : firstArgs;

    await expect(Promise.all(
      Array.from({ length: 5 }, () => registerCommerceCommand(winningArgs)),
    )).resolves.toEqual(Array.from({ length: 5 }, () => ({
      journalSchemaVersion: 1,
      outcome: 'registered_existing',
      state: 'registered',
    })));
    await expect(registerCommerceCommand(losingArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'command_conflict',
    });

    const finalPair = await readPair(pair);
    expect(snapshotEvidence(finalPair.commandSnapshot))
      .toEqual(snapshotEvidence(initialPair.commandSnapshot));
    expect(snapshotEvidence(finalPair.auditSnapshot))
      .toEqual(snapshotEvidence(initialPair.auditSnapshot));
  });

  test('a preseeded deterministic audit makes registration fail without an orphan command', async () => {
    const args = commandArgs(db, COMMAND_IDS.orphanAudit, payload('preseed-audit'));
    const pair = pairFor(args);
    const preseed = Object.freeze({ syntheticPreseed: true });
    await pair.auditRef.create(preseed);
    const auditBefore = await pair.auditRef.get();

    await expect(registerCommerceCommand(args)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });

    const stored = await readPair(pair);
    expect(stored.commandSnapshot.exists).toBe(false);
    expect(snapshotEvidence(stored.auditSnapshot)).toEqual(snapshotEvidence(auditBefore));
  });

  test('a retry after a lost response is existing-only and leaves both documents unchanged', async () => {
    const args = commandArgs(db, COMMAND_IDS.lostResponse, payload('lost-response'));
    const pair = pairFor(args);

    await registerCommerceCommand(args);
    const beforeRetry = await readPair(pair);
    const retries = await Promise.all(
      Array.from({ length: 8 }, () => registerCommerceCommand(args)),
    );
    expect(retries).toEqual(Array.from({ length: 8 }, () => ({
      journalSchemaVersion: 1,
      outcome: 'registered_existing',
      state: 'registered',
    })));

    const afterRetry = await readPair(pair);
    expect(snapshotEvidence(afterRetry.commandSnapshot))
      .toEqual(snapshotEvidence(beforeRetry.commandSnapshot));
    expect(snapshotEvidence(afterRetry.auditSnapshot))
      .toEqual(snapshotEvidence(beforeRetry.auditSnapshot));
  });

  test('a malformed timestamp pair rejects without repair', async () => {
    const args = commandArgs(db, COMMAND_IDS.malformed, payload('malformed-pair'));
    const pair = pairFor(args);
    await registerCommerceCommand(args);
    const valid = await readPair(pair);
    const mismatchedTimestamp = admin.firestore.Timestamp.fromMillis(
      valid.auditSnapshot.data().occurredAt.toMillis() + 1,
    );
    await pair.auditRef.set({
      ...valid.auditSnapshot.data(),
      occurredAt: mismatchedTimestamp,
    });
    const malformed = await readPair(pair);

    await expect(registerCommerceCommand(args)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });

    const afterAttempt = await readPair(pair);
    expect(snapshotEvidence(afterAttempt.commandSnapshot))
      .toEqual(snapshotEvidence(malformed.commandSnapshot));
    expect(snapshotEvidence(afterAttempt.auditSnapshot))
      .toEqual(snapshotEvidence(malformed.auditSnapshot));
  });

  test('future-version records reject without repair', async () => {
    const args = commandArgs(db, COMMAND_IDS.future, payload('future-pair'));
    const pair = pairFor(args);
    await registerCommerceCommand(args);
    const valid = await readPair(pair);
    await Promise.all([
      pair.commandRef.set({
        ...valid.commandSnapshot.data(),
        journalSchemaVersion: 2,
      }),
      pair.auditRef.set({
        ...valid.auditSnapshot.data(),
        auditSchemaVersion: 2,
      }),
    ]);
    const future = await readPair(pair);

    await expect(registerCommerceCommand(args)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });

    const afterAttempt = await readPair(pair);
    expect(snapshotEvidence(afterAttempt.commandSnapshot))
      .toEqual(snapshotEvidence(future.commandSnapshot));
    expect(snapshotEvidence(afterAttempt.auditSnapshot))
      .toEqual(snapshotEvidence(future.auditSnapshot));
  });

  test('24 distinct holders race to one first lease and preserve registration bytes', async () => {
    const commandPayload = payload('distinct-lease-race');
    const registrationArgs = commandArgs(
      db,
      COMMAND_IDS.distinctLeaseRace,
      commandPayload,
    );
    const pair = pairFor(registrationArgs);
    await registerCommerceCommand(registrationArgs);
    const registrationBefore = await readPair(pair);

    const leaseArgs = Array.from({ length: CONCURRENT_CALLS }, (_, index) => acquireArgs(
      db,
      COMMAND_IDS.distinctLeaseRace,
      commandPayload,
      deterministicLeaseId(index + 1),
    ));
    const results = await Promise.all(leaseArgs.map((args) => retryWholeOperationAfterUnavailable(
      () => acquireCommerceCommandLease(args),
      retryEvidence,
    )));
    const acquired = results.filter((result) => result.outcome === 'lease_acquired');
    const busy = results.filter((result) => result.outcome === 'lease_busy');

    expect(acquired).toHaveLength(1);
    expect(busy).toHaveLength(CONCURRENT_CALLS - 1);
    expectLeaseResult(acquired[0], 1);
    for (const result of busy) expectBusyResult(result);

    const lifecycle = await readLifecycle(pair);
    const lifecycleAudit = await readAudit(pair, 2);
    expect(lifecycle.data()).toMatchObject({
      lifecycleSchemaVersion: 1,
      commandKeyHash: pair.commandKeyHash,
      state: 'leased',
      commandRevision: 2,
      fenceEpoch: 1,
      terminalCommitmentKind: null,
      terminalCommitmentHash: null,
    });
    expect(lifecycle.data().leaseAcquiredAt.toMillis()).toBe(BASE_NOW_MILLIS);
    expect(lifecycle.data().leaseExpiresAt.toMillis())
      .toBe(BASE_NOW_MILLIS + LEASE_DURATION_MILLIS);
    expect(lifecycleAudit.data()).toMatchObject({
      auditSchemaVersion: 2,
      commandKeyHash: pair.commandKeyHash,
      commandRevision: 2,
      eventType: 'command_lease_acquired',
      fromState: 'registered',
      toState: 'leased',
      fenceEpoch: 1,
    });
    expect((await matchingAudits(pair)).size).toBe(2);

    const registrationAfter = await readPair(pair);
    expect(snapshotEvidence(registrationAfter.commandSnapshot))
      .toEqual(snapshotEvidence(registrationBefore.commandSnapshot));
    expect(snapshotEvidence(registrationAfter.auditSnapshot))
      .toEqual(snapshotEvidence(registrationBefore.auditSnapshot));
    await expect(registerCommerceCommand(registrationArgs)).resolves.toEqual({
      journalSchemaVersion: 1,
      outcome: 'registered_existing',
      state: 'registered',
    });
  });

  test('24 same-holder lost-response calls recover one identical lease without another write', async () => {
    const commandPayload = payload('same-holder-recovery');
    const registrationArgs = commandArgs(db, COMMAND_IDS.sameLeaseRace, commandPayload);
    const args = acquireArgs(
      db,
      COMMAND_IDS.sameLeaseRace,
      commandPayload,
      deterministicLeaseId(50),
    );
    const pair = pairFor(args);
    await registerCommerceCommand(registrationArgs);

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_CALLS }, () => retryWholeOperationAfterUnavailable(
        () => acquireCommerceCommandLease(args),
        retryEvidence,
      )),
    );
    for (const result of results) {
      expectLeaseResult(result, 1);
      expect(result).toEqual(results[0]);
    }

    const beforeRecovery = await readLifecycleEvidence(pair, 2);
    const recovered = await Promise.all(
      Array.from({ length: 8 }, () => acquireCommerceCommandLease(args)),
    );
    expect(recovered).toEqual(Array.from({ length: 8 }, () => results[0]));
    const afterRecovery = await readLifecycleEvidence(pair, 2);
    expect(afterRecovery).toEqual(beforeRecovery);
    expect((await matchingAudits(pair)).size).toBe(2);
  });

  test('an expired 24-holder race advances one fence and rejects the old holder and fence', async () => {
    const commandPayload = payload('expired-takeover');
    const registrationArgs = commandArgs(db, COMMAND_IDS.takeoverRace, commandPayload);
    const oldLeaseId = deterministicLeaseId(60);
    const oldLeaseArgs = acquireArgs(
      db,
      COMMAND_IDS.takeoverRace,
      commandPayload,
      oldLeaseId,
    );
    const pair = pairFor(oldLeaseArgs);
    await registerCommerceCommand(registrationArgs);
    const firstLease = await acquireCommerceCommandLease(oldLeaseArgs);
    expectLeaseResult(firstLease, 1);

    setTrustedNow(BASE_NOW_MILLIS + LEASE_DURATION_MILLIS);
    const contenders = Array.from({ length: CONCURRENT_CALLS }, (_, index) => ({
      leaseId: deterministicLeaseId(index + 100),
      args: acquireArgs(
        db,
        COMMAND_IDS.takeoverRace,
        commandPayload,
        deterministicLeaseId(index + 100),
      ),
    }));
    const results = await Promise.all(
      contenders.map(({ args }) => retryWholeOperationAfterUnavailable(
        () => acquireCommerceCommandLease(args),
        retryEvidence,
      )),
    );
    const winningIndexes = results
      .map((result, index) => ({ result, index }))
      .filter(({ result }) => result.outcome === 'lease_acquired');
    expect(winningIndexes).toHaveLength(1);
    expectLeaseResult(winningIndexes[0].result, 2);
    for (const result of results.filter((value) => value.outcome === 'lease_busy')) {
      expectBusyResult(result);
    }
    expect(results.filter((result) => result.outcome === 'lease_busy'))
      .toHaveLength(CONCURRENT_CALLS - 1);

    const lifecycle = await readLifecycle(pair);
    expect(lifecycle.data()).toMatchObject({
      state: 'leased',
      commandRevision: 3,
      fenceEpoch: 2,
    });
    const takeoverAudit = await readAudit(pair, 3);
    expect(takeoverAudit.data()).toMatchObject({
      commandRevision: 3,
      eventType: 'command_lease_taken_over',
      fromState: 'leased',
      toState: 'leased',
      fenceEpoch: 2,
    });
    expect((await matchingAudits(pair)).size).toBe(3);

    const beforeStaleFinish = await readLifecycleEvidence(pair, 3);
    const staleAttempts = await Promise.allSettled([
      completeCommerceCommand(completeArgs(
        db,
        COMMAND_IDS.takeoverRace,
        commandPayload,
        oldLeaseId,
        1,
      )),
      failCommerceCommand(failArgs(
        db,
        COMMAND_IDS.takeoverRace,
        commandPayload,
        oldLeaseId,
        1,
      )),
    ]);
    expect(staleAttempts).toHaveLength(2);
    for (const result of staleAttempts) {
      expect(result.status).toBe('rejected');
      expectJournalError(result.reason, 'lease_stale');
    }
    expect(await readLifecycleEvidence(pair, 3)).toEqual(beforeStaleFinish);
    expect((await matchingAudits(pair)).size).toBe(3);
  });

  test('concurrent complete-versus-final-fail commits exactly one terminal outcome', async () => {
    const commandPayload = payload('terminal-outcome-race');
    const leaseId = deterministicLeaseId(200);
    const registrationArgs = commandArgs(db, COMMAND_IDS.terminalRace, commandPayload);
    const leaseArgs = acquireArgs(
      db,
      COMMAND_IDS.terminalRace,
      commandPayload,
      leaseId,
    );
    const pair = pairFor(leaseArgs);
    await registerCommerceCommand(registrationArgs);
    await acquireCommerceCommandLease(leaseArgs);
    setTrustedNow(BASE_NOW_MILLIS + 1);

    const settled = await Promise.allSettled([
      retryWholeOperationAfterUnavailable(
        () => completeCommerceCommand(completeArgs(
          db,
          COMMAND_IDS.terminalRace,
          commandPayload,
          leaseId,
          1,
        )),
        retryEvidence,
      ),
      retryWholeOperationAfterUnavailable(
        () => failCommerceCommand(failArgs(
          db,
          COMMAND_IDS.terminalRace,
          commandPayload,
          leaseId,
          1,
        )),
        retryEvidence,
      ),
    ]);
    const fulfilled = settled.filter((result) => result.status === 'fulfilled');
    const rejected = settled.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(['succeeded', 'failed_final']).toContain(fulfilled[0].value.state);
    expectTerminalResult(fulfilled[0].value, fulfilled[0].value.state);
    expectJournalError(rejected[0].reason, 'terminal_conflict');

    const lifecycle = await readLifecycle(pair);
    const terminalAudit = await readAudit(pair, 3);
    expect(lifecycle.data()).toMatchObject({
      state: fulfilled[0].value.state,
      commandRevision: 3,
      fenceEpoch: 1,
    });
    expect(terminalAudit.data()).toMatchObject({
      commandRevision: 3,
      eventType: fulfilled[0].value.state === 'succeeded'
        ? 'command_succeeded'
        : 'command_failed_final',
      fromState: 'leased',
      toState: fulfilled[0].value.state,
      fenceEpoch: 1,
    });
    expect((await matchingAudits(pair)).size).toBe(3);
    expect((await readAudit(pair, 4)).exists).toBe(false);
  });

  test('distinct success commitments race to one immutable terminal commitment', async () => {
    const commandPayload = payload('terminal-commitment-race');
    const leaseId = deterministicLeaseId(210);
    const registrationArgs = commandArgs(db, COMMAND_IDS.commitmentRace, commandPayload);
    const leaseArgs = acquireArgs(
      db,
      COMMAND_IDS.commitmentRace,
      commandPayload,
      leaseId,
    );
    const pair = pairFor(leaseArgs);
    await registerCommerceCommand(registrationArgs);
    await acquireCommerceCommandLease(leaseArgs);
    setTrustedNow(BASE_NOW_MILLIS + 1);

    const settled = await Promise.allSettled([
      retryWholeOperationAfterUnavailable(
        () => completeCommerceCommand(completeArgs(
          db,
          COMMAND_IDS.commitmentRace,
          commandPayload,
          leaseId,
          1,
          TERMINAL_REFERENCE_FINGERPRINT,
        )),
        retryEvidence,
      ),
      retryWholeOperationAfterUnavailable(
        () => completeCommerceCommand(completeArgs(
          db,
          COMMAND_IDS.commitmentRace,
          commandPayload,
          leaseId,
          1,
          OTHER_TERMINAL_REFERENCE_FINGERPRINT,
        )),
        retryEvidence,
      ),
    ]);
    const fulfilled = settled.filter((result) => result.status === 'fulfilled');
    const rejected = settled.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expectTerminalResult(fulfilled[0].value, 'succeeded');
    expectJournalError(rejected[0].reason, 'terminal_conflict');

    const lifecycle = await readLifecycle(pair);
    const terminalAudit = await readAudit(pair, 3);
    expect(lifecycle.data()).toMatchObject({
      state: 'succeeded',
      commandRevision: 3,
      fenceEpoch: 1,
      terminalCommitmentKind: 'business_record_digest',
      terminalCommitmentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(lifecycle.data().terminalCommitmentHash)
      .not.toBe(TERMINAL_REFERENCE_FINGERPRINT);
    expect(lifecycle.data().terminalCommitmentHash)
      .not.toBe(OTHER_TERMINAL_REFERENCE_FINGERPRINT);
    expect(terminalAudit.data()).not.toHaveProperty('terminalCommitmentKind');
    expect(terminalAudit.data()).not.toHaveProperty('terminalCommitmentHash');
    expect(JSON.stringify(terminalAudit.data())).not.toContain(TERMINAL_REFERENCE_FINGERPRINT);
    expect(JSON.stringify(terminalAudit.data()))
      .not.toContain(OTHER_TERMINAL_REFERENCE_FINGERPRINT);
    expect((await matchingAudits(pair)).size).toBe(3);
  });

  test.each([
    {
      name: 'successful',
      commandId: COMMAND_IDS.terminalReplay,
      state: 'succeeded',
      finalize: completeCommerceCommand,
      finalizeArgs: completeArgs,
    },
    {
      name: 'final-failure',
      commandId: COMMAND_IDS.finalFailureReplay,
      state: 'failed_final',
      finalize: failCommerceCommand,
      finalizeArgs: failArgs,
    },
  ])('$name terminal retry, later acquire, and registration are read-only', async ({
    commandId,
    state,
    finalize,
    finalizeArgs,
  }) => {
    setTrustedNow(BASE_NOW_MILLIS);
    const commandPayload = payload(`terminal-replay-${state}`);
    const leaseId = deterministicLeaseId(state === 'succeeded' ? 220 : 221);
    const registrationArgs = commandArgs(db, commandId, commandPayload);
    const leaseArgs = acquireArgs(db, commandId, commandPayload, leaseId);
    const pair = pairFor(leaseArgs);
    await registerCommerceCommand(registrationArgs);
    const registrationBefore = await readPair(pair);
    await acquireCommerceCommandLease(leaseArgs);
    setTrustedNow(BASE_NOW_MILLIS + 1);

    const terminalInput = finalizeArgs(
      db,
      commandId,
      commandPayload,
      leaseId,
      1,
    );
    expectTerminalResult(await finalize(terminalInput), state);
    const terminalBeforeReplay = await readLifecycleEvidence(pair, 3);
    const registrationAtTerminal = await readPair(pair);
    expect(snapshotEvidence(registrationAtTerminal.commandSnapshot))
      .toEqual(snapshotEvidence(registrationBefore.commandSnapshot));
    expect(snapshotEvidence(registrationAtTerminal.auditSnapshot))
      .toEqual(snapshotEvidence(registrationBefore.auditSnapshot));

    setTrustedNow(BASE_NOW_MILLIS + (LEASE_DURATION_MILLIS * 2));
    expectTerminalResult(await finalize(terminalInput), state);
    expectTerminalResult(await acquireCommerceCommandLease(acquireArgs(
      db,
      commandId,
      commandPayload,
      deterministicLeaseId(state === 'succeeded' ? 222 : 223),
    )), state);
    await expect(registerCommerceCommand(registrationArgs)).resolves.toEqual({
      journalSchemaVersion: 1,
      outcome: 'registered_existing',
      state: 'registered',
    });

    expect(await readLifecycleEvidence(pair, 3)).toEqual(terminalBeforeReplay);
    expect((await matchingAudits(pair)).size).toBe(3);
    expect((await readAudit(pair, 4)).exists).toBe(false);
    const registrationAfterReplay = await readPair(pair);
    expect(snapshotEvidence(registrationAfterReplay.commandSnapshot))
      .toEqual(snapshotEvidence(registrationBefore.commandSnapshot));
    expect(snapshotEvidence(registrationAfterReplay.auditSnapshot))
      .toEqual(snapshotEvidence(registrationBefore.auditSnapshot));
  });

  test('preseeded next audits block first lease and terminal completion atomically', async () => {
    const firstPayload = payload('preseed-first-lifecycle-audit');
    const firstRegistration = commandArgs(
      db,
      COMMAND_IDS.preseedLifecycleAudit,
      firstPayload,
    );
    const firstLease = acquireArgs(
      db,
      COMMAND_IDS.preseedLifecycleAudit,
      firstPayload,
      deterministicLeaseId(230),
    );
    const firstPair = pairFor(firstLease);
    await registerCommerceCommand(firstRegistration);
    const firstRegistrationBefore = await readPair(firstPair);
    const preseededRevisionTwo = auditRefFor(firstPair.commandKeyHash, 2);
    await preseededRevisionTwo.create({ syntheticPreseed: 'revision-two' });
    const revisionTwoBefore = await preseededRevisionTwo.get();

    await expect(acquireCommerceCommandLease(firstLease)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect((await readLifecycle(firstPair)).exists).toBe(false);
    expect(snapshotEvidence(await preseededRevisionTwo.get()))
      .toEqual(snapshotEvidence(revisionTwoBefore));
    const firstRegistrationAfter = await readPair(firstPair);
    expect(snapshotEvidence(firstRegistrationAfter.commandSnapshot))
      .toEqual(snapshotEvidence(firstRegistrationBefore.commandSnapshot));
    expect(snapshotEvidence(firstRegistrationAfter.auditSnapshot))
      .toEqual(snapshotEvidence(firstRegistrationBefore.auditSnapshot));

    const terminalPayload = payload('preseed-terminal-audit');
    const terminalRegistration = commandArgs(
      db,
      COMMAND_IDS.preseedTerminalAudit,
      terminalPayload,
    );
    const terminalLeaseId = deterministicLeaseId(231);
    const terminalLease = acquireArgs(
      db,
      COMMAND_IDS.preseedTerminalAudit,
      terminalPayload,
      terminalLeaseId,
    );
    const terminalPair = pairFor(terminalLease);
    await registerCommerceCommand(terminalRegistration);
    await acquireCommerceCommandLease(terminalLease);
    const lifecycleBefore = await readLifecycleEvidence(terminalPair, 2);
    const preseededRevisionThree = auditRefFor(terminalPair.commandKeyHash, 3);
    await preseededRevisionThree.create({ syntheticPreseed: 'revision-three' });
    const revisionThreeBefore = await preseededRevisionThree.get();
    setTrustedNow(BASE_NOW_MILLIS + 1);

    await expect(completeCommerceCommand(completeArgs(
      db,
      COMMAND_IDS.preseedTerminalAudit,
      terminalPayload,
      terminalLeaseId,
      1,
    ))).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(await readLifecycleEvidence(terminalPair, 2)).toEqual(lifecycleBefore);
    expect(snapshotEvidence(await preseededRevisionThree.get()))
      .toEqual(snapshotEvidence(revisionThreeBefore));
  });

  test('orphan, future, malformed, and unpaired lifecycle states reject without repair', async () => {
    const orphanPayload = payload('orphan-lifecycle');
    const orphanArgs = acquireArgs(
      db,
      COMMAND_IDS.orphanLifecycle,
      orphanPayload,
      deterministicLeaseId(240),
    );
    const orphanPair = pairFor(orphanArgs);
    await orphanPair.lifecycleRef.create({ syntheticOrphan: true });
    const orphanBefore = await orphanPair.lifecycleRef.get();
    await expect(acquireCommerceCommandLease(orphanArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(snapshotEvidence(await orphanPair.lifecycleRef.get()))
      .toEqual(snapshotEvidence(orphanBefore));
    expect((await readPair(orphanPair)).commandSnapshot.exists).toBe(false);
    expect((await readPair(orphanPair)).auditSnapshot.exists).toBe(false);

    const futurePayload = payload('future-lifecycle');
    const futureRegistration = commandArgs(
      db,
      COMMAND_IDS.malformedLifecycle,
      futurePayload,
    );
    const futureArgs = acquireArgs(
      db,
      COMMAND_IDS.malformedLifecycle,
      futurePayload,
      deterministicLeaseId(241),
    );
    const futurePair = pairFor(futureArgs);
    await registerCommerceCommand(futureRegistration);
    await futurePair.lifecycleRef.create({
      lifecycleSchemaVersion: 2,
      syntheticFuture: true,
    });
    const futureBefore = await futurePair.lifecycleRef.get();
    await expect(acquireCommerceCommandLease(futureArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(snapshotEvidence(await futurePair.lifecycleRef.get()))
      .toEqual(snapshotEvidence(futureBefore));
    expect((await readAudit(futurePair, 2)).exists).toBe(false);

    const malformedPayload = payload('malformed-lifecycle-shape');
    const malformedRegistration = commandArgs(
      db,
      COMMAND_IDS.malformedLifecycleShape,
      malformedPayload,
    );
    const malformedArgs = acquireArgs(
      db,
      COMMAND_IDS.malformedLifecycleShape,
      malformedPayload,
      deterministicLeaseId(243),
    );
    const malformedPair = pairFor(malformedArgs);
    await registerCommerceCommand(malformedRegistration);
    await acquireCommerceCommandLease(malformedArgs);
    const validMalformedLifecycle = await readLifecycle(malformedPair);
    const malformedAuditBefore = await readAudit(malformedPair, 2);
    await malformedPair.lifecycleRef.set({
      ...validMalformedLifecycle.data(),
      commandRevision: 4,
    });
    const malformedLifecycleBefore = await readLifecycle(malformedPair);

    await expect(acquireCommerceCommandLease(malformedArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(snapshotEvidence(await readLifecycle(malformedPair)))
      .toEqual(snapshotEvidence(malformedLifecycleBefore));
    expect(snapshotEvidence(await readAudit(malformedPair, 2)))
      .toEqual(snapshotEvidence(malformedAuditBefore));
    expect((await readAudit(malformedPair, 3)).exists).toBe(false);

    const malformedAuditPayload = payload('malformed-current-audit');
    const malformedAuditRegistration = commandArgs(
      db,
      COMMAND_IDS.malformedCurrentAudit,
      malformedAuditPayload,
    );
    const malformedAuditArgs = acquireArgs(
      db,
      COMMAND_IDS.malformedCurrentAudit,
      malformedAuditPayload,
      deterministicLeaseId(244),
    );
    const malformedAuditPair = pairFor(malformedAuditArgs);
    await registerCommerceCommand(malformedAuditRegistration);
    await acquireCommerceCommandLease(malformedAuditArgs);
    const lifecycleBeforeMalformedAudit = await readLifecycle(malformedAuditPair);
    const currentMalformedAuditRef = auditRefFor(malformedAuditPair.commandKeyHash, 2);
    const validCurrentAudit = await currentMalformedAuditRef.get();
    await currentMalformedAuditRef.set({
      ...validCurrentAudit.data(),
      eventType: 'command_succeeded',
    });
    const currentMalformedAuditBefore = await currentMalformedAuditRef.get();

    await expect(acquireCommerceCommandLease(malformedAuditArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(snapshotEvidence(await readLifecycle(malformedAuditPair)))
      .toEqual(snapshotEvidence(lifecycleBeforeMalformedAudit));
    expect(snapshotEvidence(await currentMalformedAuditRef.get()))
      .toEqual(snapshotEvidence(currentMalformedAuditBefore));
    expect((await readAudit(malformedAuditPair, 3)).exists).toBe(false);

    const missingAuditPayload = payload('missing-current-audit');
    const missingAuditRegistration = commandArgs(
      db,
      COMMAND_IDS.missingCurrentAudit,
      missingAuditPayload,
    );
    const missingAuditArgs = acquireArgs(
      db,
      COMMAND_IDS.missingCurrentAudit,
      missingAuditPayload,
      deterministicLeaseId(242),
    );
    const missingAuditPair = pairFor(missingAuditArgs);
    await registerCommerceCommand(missingAuditRegistration);
    await acquireCommerceCommandLease(missingAuditArgs);
    const lifecycleWithPartner = await readLifecycle(missingAuditPair);
    const currentAuditRef = auditRefFor(missingAuditPair.commandKeyHash, 2);
    await currentAuditRef.delete();
    const lifecycleWithoutPartner = await readLifecycle(missingAuditPair);
    expect(snapshotEvidence(lifecycleWithoutPartner))
      .toEqual(snapshotEvidence(lifecycleWithPartner));

    await expect(acquireCommerceCommandLease(missingAuditArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(snapshotEvidence(await readLifecycle(missingAuditPair)))
      .toEqual(snapshotEvidence(lifecycleWithoutPartner));
    expect((await currentAuditRef.get()).exists).toBe(false);
    expect((await readAudit(missingAuditPair, 3)).exists).toBe(false);
  });

  test('24 same-plan current-holder calls create one immutable provider pair', async () => {
    const setup = await setupLeasedCommand(
      COMMAND_IDS.providerSamePlan,
      'provider-same-plan',
      300,
    );
    const args = providerPlanArgs(
      db,
      COMMAND_IDS.providerSamePlan,
      setup.commandPayload,
      setup.leaseId,
      1,
      providerParameters('provider-same-plan'),
    );
    const foundationBefore = await readFoundationEvidence(setup.pair, 2);

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_CALLS }, () => retryWholeOperationAfterUnavailable(
        () => bindInitialStripeProviderPlan(args),
        retryEvidence,
      )),
    );
    expect(results.filter(({ outcome }) => outcome === 'provider_plan_bound'))
      .toHaveLength(1);
    expect(results.filter(({ outcome }) => outcome === 'provider_plan_existing'))
      .toHaveLength(CONCURRENT_CALLS - 1);
    for (const result of results) {
      expectProviderPlanResult(result, result.outcome);
    }

    const provider = await readProviderEvidence(setup.pair);
    expect(provider.plan.exists).toBe(true);
    expect(provider.audit.exists).toBe(true);
    expect(Object.keys(provider.plan.data).sort()).toEqual([
      'boundAt',
      'boundFenceEpoch',
      'commandIdentityVersion',
      'commandKeyHash',
      'endpointPath',
      'environment',
      'httpMethod',
      'idempotencyKeyFingerprint',
      'parametersFingerprint',
      'provider',
      'providerAttempt',
      'providerOperation',
      'providerPlanSchemaVersion',
      'stripeAccountFingerprint',
      'stripeApiVersion',
      'stripeMode',
    ].sort());
    expect(provider.plan.data).toMatchObject({
      providerPlanSchemaVersion: 1,
      commandIdentityVersion: 1,
      commandKeyHash: setup.pair.commandKeyHash,
      environment: 'test',
      provider: 'stripe',
      providerAttempt: 1,
      providerOperation: STRIPE_OPERATION,
      stripeMode: 'test',
      stripeApiVersion: STRIPE_API_VERSION,
      httpMethod: 'POST',
      endpointPath: STRIPE_ENDPOINT_PATH,
      stripeAccountFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      parametersFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      idempotencyKeyFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      boundFenceEpoch: 1,
    });
    expect(provider.plan.data.boundAt.toMillis()).toBe(BASE_NOW_MILLIS);
    expect(Object.keys(provider.audit.data).sort()).toEqual([
      'aggregateType',
      'boundFenceEpoch',
      'commandKeyHash',
      'environment',
      'eventType',
      'occurredAt',
      'provider',
      'providerAttempt',
      'providerOperation',
      'providerPlanAuditSchemaVersion',
      'stripeMode',
    ].sort());
    expect(provider.audit.data).toMatchObject({
      providerPlanAuditSchemaVersion: 1,
      aggregateType: 'commerce_provider_attempt',
      commandKeyHash: setup.pair.commandKeyHash,
      providerAttempt: 1,
      eventType: 'provider_plan_bound',
      provider: 'stripe',
      environment: 'test',
      stripeMode: 'test',
      providerOperation: STRIPE_OPERATION,
      boundFenceEpoch: 1,
    });
    expect(provider.audit.data.occurredAt.toMillis()).toBe(BASE_NOW_MILLIS);
    const serialized = JSON.stringify(provider);
    expect(serialized).not.toContain(STRIPE_ACCOUNT_ID);
    expect(serialized).not.toContain('provider-same-plan');
    expect(await readFoundationEvidence(setup.pair, 2)).toEqual(foundationBefore);
    expect((await matchingAudits(setup.pair)).size).toBe(3);
  });

  test('conflicting provider plans race to one immutable winner', async () => {
    const setup = await setupLeasedCommand(
      COMMAND_IDS.providerConflict,
      'provider-plan-conflict',
      301,
    );
    const firstArgs = providerPlanArgs(
      db,
      COMMAND_IDS.providerConflict,
      setup.commandPayload,
      setup.leaseId,
      1,
      providerParameters('provider-plan-a'),
    );
    const secondArgs = providerPlanArgs(
      db,
      COMMAND_IDS.providerConflict,
      setup.commandPayload,
      setup.leaseId,
      1,
      providerParameters('provider-plan-b'),
    );
    const foundationBefore = await readFoundationEvidence(setup.pair, 2);
    const settled = await Promise.allSettled([
      ...Array.from({ length: 12 }, () => retryWholeOperationAfterUnavailable(
        () => bindInitialStripeProviderPlan(firstArgs),
        retryEvidence,
      )),
      ...Array.from({ length: 12 }, () => retryWholeOperationAfterUnavailable(
        () => bindInitialStripeProviderPlan(secondArgs),
        retryEvidence,
      )),
    ]);
    const fulfilled = settled.filter(({ status }) => status === 'fulfilled');
    const rejected = settled.filter(({ status }) => status === 'rejected');
    expect(fulfilled).toHaveLength(12);
    expect(fulfilled.filter(({ value }) => value.outcome === 'provider_plan_bound'))
      .toHaveLength(1);
    expect(fulfilled.filter(({ value }) => value.outcome === 'provider_plan_existing'))
      .toHaveLength(11);
    for (const result of fulfilled) expectProviderPlanResult(result.value, result.value.outcome);
    expect(rejected).toHaveLength(12);
    for (const result of rejected) expectJournalError(result.reason, 'command_conflict');

    const firstHalfWon = settled.slice(0, 12).every(({ status }) => status === 'fulfilled');
    const secondHalfWon = settled.slice(12).every(({ status }) => status === 'fulfilled');
    expect([firstHalfWon, secondHalfWon]).toEqual(expect.arrayContaining([true, false]));
    const winningArgs = firstHalfWon ? firstArgs : secondArgs;
    const losingArgs = firstHalfWon ? secondArgs : firstArgs;
    const providerBeforeProbes = await readProviderEvidence(setup.pair);
    expectProviderPlanResult(
      await bindInitialStripeProviderPlan(winningArgs),
      'provider_plan_existing',
    );
    await expect(bindInitialStripeProviderPlan(losingArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'command_conflict',
    });
    expect(await readProviderEvidence(setup.pair)).toEqual(providerBeforeProbes);
    expect(await readFoundationEvidence(setup.pair, 2)).toEqual(foundationBefore);
    expect(JSON.stringify(providerBeforeProbes)).not.toContain('provider-plan-a');
    expect(JSON.stringify(providerBeforeProbes)).not.toContain('provider-plan-b');
    expect((await matchingAudits(setup.pair)).size).toBe(3);
  });

  test('a provider-plan retry after a lost response is byte-preserving', async () => {
    const setup = await setupLeasedCommand(
      COMMAND_IDS.providerLostResponse,
      'provider-lost-response',
      302,
    );
    const args = providerPlanArgs(
      db,
      COMMAND_IDS.providerLostResponse,
      setup.commandPayload,
      setup.leaseId,
      1,
      providerParameters('provider-lost-response'),
    );
    expectProviderPlanResult(
      await bindInitialStripeProviderPlan(args),
      'provider_plan_bound',
    );
    const providerBeforeRetry = await readProviderEvidence(setup.pair);
    const foundationBeforeRetry = await readFoundationEvidence(setup.pair, 2);

    const retries = await Promise.all(
      Array.from({ length: 8 }, () => bindInitialStripeProviderPlan(args)),
    );
    for (const result of retries) {
      expectProviderPlanResult(result, 'provider_plan_existing');
    }
    expect(await readProviderEvidence(setup.pair)).toEqual(providerBeforeRetry);
    expect(await readFoundationEvidence(setup.pair, 2)).toEqual(foundationBeforeRetry);
    expect((await matchingAudits(setup.pair)).size).toBe(3);
  });

  test('an injected real-emulator commit failure leaves every record unchanged', async () => {
    const setup = await setupLeasedCommand(
      COMMAND_IDS.providerCommitFailure,
      'provider-commit-failure',
      318,
    );
    const args = providerPlanArgs(
      db,
      COMMAND_IDS.providerCommitFailure,
      setup.commandPayload,
      setup.leaseId,
      1,
      providerParameters('provider-commit-failure'),
    );
    const foundationBefore = await readFoundationEvidence(setup.pair, 2);
    const providerBefore = await readProviderEvidence(setup.pair);
    const auditsBefore = await matchingAudits(setup.pair);
    const commitFailure = jest.spyOn(FirestoreTransaction.prototype, 'commit')
      .mockRejectedValueOnce(new Error('synthetic commit failure'));
    let commitCalls = 0;

    try {
      const error = await bindInitialStripeProviderPlan(args).then(
        () => null,
        (reason) => reason,
      );
      expectJournalError(error, 'journal_unavailable');
      commitCalls = commitFailure.mock.calls.length;
    } finally {
      commitFailure.mockRestore();
    }

    expect(commitCalls).toBe(1);
    expect(await readProviderEvidence(setup.pair)).toEqual(providerBefore);
    expect(await readFoundationEvidence(setup.pair, 2)).toEqual(foundationBefore);
    expect((await matchingAudits(setup.pair)).size).toBe(auditsBefore.size);
    expect(providerBefore.plan.exists).toBe(false);
    expect(providerBefore.audit.exists).toBe(false);
  });

  test('an expired holder cannot bind or observe, while takeover reads without rewrite', async () => {
    const setup = await setupLeasedCommand(
      COMMAND_IDS.providerTakeover,
      'provider-takeover',
      303,
    );
    const oldArgs = providerPlanArgs(
      db,
      COMMAND_IDS.providerTakeover,
      setup.commandPayload,
      setup.leaseId,
      1,
      providerParameters('provider-takeover'),
    );
    expectProviderPlanResult(
      await bindInitialStripeProviderPlan(oldArgs),
      'provider_plan_bound',
    );
    const providerBeforeExpiry = await readProviderEvidence(setup.pair);
    const foundationBeforeExpiry = await readFoundationEvidence(setup.pair, 2);

    setTrustedNow(BASE_NOW_MILLIS + LEASE_DURATION_MILLIS);
    await expect(bindInitialStripeProviderPlan(oldArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'lease_stale',
    });
    expect(await readProviderEvidence(setup.pair)).toEqual(providerBeforeExpiry);
    expect(await readFoundationEvidence(setup.pair, 2)).toEqual(foundationBeforeExpiry);

    const nextLeaseId = deterministicLeaseId(304);
    const nextLeaseArgs = acquireArgs(
      db,
      COMMAND_IDS.providerTakeover,
      setup.commandPayload,
      nextLeaseId,
    );
    expectLeaseResult(await acquireCommerceCommandLease(nextLeaseArgs), 2);
    const providerBeforeTakeoverRead = await readProviderEvidence(setup.pair);
    const foundationBeforeTakeoverRead = await readFoundationEvidence(setup.pair, 3);
    const nextArgs = providerPlanArgs(
      db,
      COMMAND_IDS.providerTakeover,
      setup.commandPayload,
      nextLeaseId,
      2,
      providerParameters('provider-takeover'),
    );
    await expect(bindInitialStripeProviderPlan(oldArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'lease_stale',
    });
    expectProviderPlanResult(
      await bindInitialStripeProviderPlan(nextArgs),
      'provider_plan_existing',
    );
    expect(await readProviderEvidence(setup.pair)).toEqual(providerBeforeTakeoverRead);
    expect(await readFoundationEvidence(setup.pair, 3)).toEqual(foundationBeforeTakeoverRead);
    expect(providerBeforeTakeoverRead.plan.data.boundFenceEpoch).toBe(1);
    expect(providerBeforeTakeoverRead.plan.data.boundAt.toMillis()).toBe(BASE_NOW_MILLIS);
    expect((await matchingAudits(setup.pair)).size).toBe(4);

    setTrustedNow(BASE_NOW_MILLIS + (LEASE_DURATION_MILLIS * 2));
    const expired = await setupLeasedCommand(
      COMMAND_IDS.providerExpiredBeforeBind,
      'provider-expired-before-bind',
      316,
    );
    const expiredArgs = providerPlanArgs(
      db,
      COMMAND_IDS.providerExpiredBeforeBind,
      expired.commandPayload,
      expired.leaseId,
      1,
      providerParameters('provider-expired-before-bind'),
    );
    const expiredFoundationBefore = await readFoundationEvidence(expired.pair, 2);
    const expiredProviderBefore = await readProviderEvidence(expired.pair);
    setTrustedNow(BASE_NOW_MILLIS + (LEASE_DURATION_MILLIS * 3));
    await expect(bindInitialStripeProviderPlan(expiredArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'lease_stale',
    });
    expect(await readProviderEvidence(expired.pair)).toEqual(expiredProviderBefore);
    expect(await readFoundationEvidence(expired.pair, 2)).toEqual(expiredFoundationBefore);
    expect(expiredProviderBefore.plan.exists).toBe(false);
    expect(expiredProviderBefore.audit.exists).toBe(false);
  });

  test('wrong holder, wrong fence, and earlier captured time reject without a plan', async () => {
    const setup = await setupLeasedCommand(
      COMMAND_IDS.providerWrongHolder,
      'provider-wrong-holder',
      305,
    );
    const validParameters = providerParameters('provider-wrong-holder');
    const wrongHolderArgs = providerPlanArgs(
      db,
      COMMAND_IDS.providerWrongHolder,
      setup.commandPayload,
      deterministicLeaseId(306),
      1,
      validParameters,
    );
    const wrongFenceArgs = providerPlanArgs(
      db,
      COMMAND_IDS.providerWrongHolder,
      setup.commandPayload,
      setup.leaseId,
      2,
      validParameters,
    );
    const foundationBefore = await readFoundationEvidence(setup.pair, 2);
    const providerBefore = await readProviderEvidence(setup.pair);
    const settled = await Promise.allSettled([
      bindInitialStripeProviderPlan(wrongHolderArgs),
      bindInitialStripeProviderPlan(wrongFenceArgs),
    ]);
    for (const result of settled) {
      expect(result.status).toBe('rejected');
      expectJournalError(result.reason, 'lease_stale');
    }
    expect(await readProviderEvidence(setup.pair)).toEqual(providerBefore);
    expect(await readFoundationEvidence(setup.pair, 2)).toEqual(foundationBefore);
    expect(providerBefore.plan.exists).toBe(false);
    expect(providerBefore.audit.exists).toBe(false);

    setTrustedNow(BASE_NOW_MILLIS + 1000);
    const clockSetup = await setupLeasedCommand(
      COMMAND_IDS.providerEarlierClock,
      'provider-earlier-clock',
      307,
    );
    const clockArgs = providerPlanArgs(
      db,
      COMMAND_IDS.providerEarlierClock,
      clockSetup.commandPayload,
      clockSetup.leaseId,
      1,
      providerParameters('provider-earlier-clock'),
    );
    const clockFoundationBefore = await readFoundationEvidence(clockSetup.pair, 2);
    const clockProviderBefore = await readProviderEvidence(clockSetup.pair);
    setTrustedNow(BASE_NOW_MILLIS);
    await expect(bindInitialStripeProviderPlan(clockArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'lease_stale',
    });
    expect(await readProviderEvidence(clockSetup.pair)).toEqual(clockProviderBefore);
    expect(await readFoundationEvidence(clockSetup.pair, 2))
      .toEqual(clockFoundationBefore);
  });

  test('a terminal lifecycle cannot create or observe a provider plan', async () => {
    const setup = await setupLeasedCommand(
      COMMAND_IDS.providerTerminal,
      'provider-terminal',
      308,
    );
    const args = providerPlanArgs(
      db,
      COMMAND_IDS.providerTerminal,
      setup.commandPayload,
      setup.leaseId,
      1,
      providerParameters('provider-terminal'),
    );
    expectProviderPlanResult(
      await bindInitialStripeProviderPlan(args),
      'provider_plan_bound',
    );
    setTrustedNow(BASE_NOW_MILLIS + 1);
    expectTerminalResult(await completeCommerceCommand(completeArgs(
      db,
      COMMAND_IDS.providerTerminal,
      setup.commandPayload,
      setup.leaseId,
      1,
    )), 'succeeded');
    const foundationBefore = await readFoundationEvidence(setup.pair, 3);
    const providerBefore = await readProviderEvidence(setup.pair);
    await expect(bindInitialStripeProviderPlan(args)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'lease_stale',
    });
    expect(await readProviderEvidence(setup.pair)).toEqual(providerBefore);
    expect(await readFoundationEvidence(setup.pair, 3)).toEqual(foundationBefore);
    expect(providerBefore.plan.exists).toBe(true);
    expect(providerBefore.audit.exists).toBe(true);
    expect((await matchingAudits(setup.pair)).size).toBe(4);

    const noPlan = await setupLeasedCommand(
      COMMAND_IDS.providerTerminalNoPlan,
      'provider-terminal-no-plan',
      317,
    );
    setTrustedNow(BASE_NOW_MILLIS + 2);
    expectTerminalResult(await completeCommerceCommand(completeArgs(
      db,
      COMMAND_IDS.providerTerminalNoPlan,
      noPlan.commandPayload,
      noPlan.leaseId,
      1,
    )), 'succeeded');
    const noPlanArgs = providerPlanArgs(
      db,
      COMMAND_IDS.providerTerminalNoPlan,
      noPlan.commandPayload,
      noPlan.leaseId,
      1,
      providerParameters('provider-terminal-no-plan'),
    );
    const noPlanFoundationBefore = await readFoundationEvidence(noPlan.pair, 3);
    const noPlanProviderBefore = await readProviderEvidence(noPlan.pair);
    await expect(bindInitialStripeProviderPlan(noPlanArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'lease_stale',
    });
    expect(await readProviderEvidence(noPlan.pair)).toEqual(noPlanProviderBefore);
    expect(await readFoundationEvidence(noPlan.pair, 3)).toEqual(noPlanFoundationBefore);
    expect(noPlanProviderBefore.plan.exists).toBe(false);
    expect(noPlanProviderBefore.audit.exists).toBe(false);
  });

  test('preseeded or orphan provider partners reject without repair', async () => {
    const preseed = await setupLeasedCommand(
      COMMAND_IDS.providerPreseedAudit,
      'provider-preseed-audit',
      309,
    );
    const preseedArgs = providerPlanArgs(
      db,
      COMMAND_IDS.providerPreseedAudit,
      preseed.commandPayload,
      preseed.leaseId,
      1,
      providerParameters('provider-preseed-audit'),
    );
    await preseed.pair.providerAuditRef.create({ syntheticPreseed: true });
    const preseedFoundationBefore = await readFoundationEvidence(preseed.pair, 2);
    const preseedProviderBefore = await readProviderEvidence(preseed.pair);
    await expect(bindInitialStripeProviderPlan(preseedArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(await readProviderEvidence(preseed.pair)).toEqual(preseedProviderBefore);
    expect(await readFoundationEvidence(preseed.pair, 2)).toEqual(preseedFoundationBefore);
    expect(preseedProviderBefore.plan.exists).toBe(false);
    expect(preseedProviderBefore.audit.exists).toBe(true);

    const orphan = await setupLeasedCommand(
      COMMAND_IDS.providerOrphanPlan,
      'provider-orphan-plan',
      310,
    );
    const orphanArgs = providerPlanArgs(
      db,
      COMMAND_IDS.providerOrphanPlan,
      orphan.commandPayload,
      orphan.leaseId,
      1,
      providerParameters('provider-orphan-plan'),
    );
    expectProviderPlanResult(
      await bindInitialStripeProviderPlan(orphanArgs),
      'provider_plan_bound',
    );
    await orphan.pair.providerAuditRef.delete();
    const orphanFoundationBefore = await readFoundationEvidence(orphan.pair, 2);
    const orphanProviderBefore = await readProviderEvidence(orphan.pair);
    await expect(bindInitialStripeProviderPlan(orphanArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(await readProviderEvidence(orphan.pair)).toEqual(orphanProviderBefore);
    expect(await readFoundationEvidence(orphan.pair, 2)).toEqual(orphanFoundationBefore);
    expect(orphanProviderBefore.plan.exists).toBe(true);
    expect(orphanProviderBefore.audit.exists).toBe(false);

    const orphanAudit = await setupLeasedCommand(
      COMMAND_IDS.providerOrphanAudit,
      'provider-orphan-audit',
      315,
    );
    const orphanAuditArgs = providerPlanArgs(
      db,
      COMMAND_IDS.providerOrphanAudit,
      orphanAudit.commandPayload,
      orphanAudit.leaseId,
      1,
      providerParameters('provider-orphan-audit'),
    );
    expectProviderPlanResult(
      await bindInitialStripeProviderPlan(orphanAuditArgs),
      'provider_plan_bound',
    );
    await orphanAudit.pair.providerPlanRef.delete();
    const orphanAuditFoundationBefore = await readFoundationEvidence(orphanAudit.pair, 2);
    const orphanAuditProviderBefore = await readProviderEvidence(orphanAudit.pair);
    await expect(bindInitialStripeProviderPlan(orphanAuditArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(await readProviderEvidence(orphanAudit.pair)).toEqual(orphanAuditProviderBefore);
    expect(await readFoundationEvidence(orphanAudit.pair, 2))
      .toEqual(orphanAuditFoundationBefore);
    expect(orphanAuditProviderBefore.plan.exists).toBe(false);
    expect(orphanAuditProviderBefore.audit.exists).toBe(true);
  });

  test('malformed and future provider records reject without rewrite', async () => {
    const malformed = await setupLeasedCommand(
      COMMAND_IDS.providerMalformedPlan,
      'provider-malformed-plan',
      311,
    );
    const malformedArgs = providerPlanArgs(
      db,
      COMMAND_IDS.providerMalformedPlan,
      malformed.commandPayload,
      malformed.leaseId,
      1,
      providerParameters('provider-malformed-plan'),
    );
    expectProviderPlanResult(
      await bindInitialStripeProviderPlan(malformedArgs),
      'provider_plan_bound',
    );
    const validPlan = await malformed.pair.providerPlanRef.get();
    await malformed.pair.providerPlanRef.set({
      ...validPlan.data(),
      providerAttempt: 2,
    });
    const malformedFoundationBefore = await readFoundationEvidence(malformed.pair, 2);
    const malformedProviderBefore = await readProviderEvidence(malformed.pair);
    await expect(bindInitialStripeProviderPlan(malformedArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(await readProviderEvidence(malformed.pair)).toEqual(malformedProviderBefore);
    expect(await readFoundationEvidence(malformed.pair, 2))
      .toEqual(malformedFoundationBefore);

    const future = await setupLeasedCommand(
      COMMAND_IDS.providerFutureAudit,
      'provider-future-audit',
      312,
    );
    const futureArgs = providerPlanArgs(
      db,
      COMMAND_IDS.providerFutureAudit,
      future.commandPayload,
      future.leaseId,
      1,
      providerParameters('provider-future-audit'),
    );
    expectProviderPlanResult(
      await bindInitialStripeProviderPlan(futureArgs),
      'provider_plan_bound',
    );
    const validAudit = await future.pair.providerAuditRef.get();
    await future.pair.providerAuditRef.set({
      ...validAudit.data(),
      providerPlanAuditSchemaVersion: 2,
    });
    const futureFoundationBefore = await readFoundationEvidence(future.pair, 2);
    const futureProviderBefore = await readProviderEvidence(future.pair);
    await expect(bindInitialStripeProviderPlan(futureArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(await readProviderEvidence(future.pair)).toEqual(futureProviderBefore);
    expect(await readFoundationEvidence(future.pair, 2)).toEqual(futureFoundationBefore);

    await future.pair.providerAuditRef.set({
      ...validAudit.data(),
      eventType: 'provider_request_sent',
    });
    const malformedAuditFoundationBefore = await readFoundationEvidence(future.pair, 2);
    const malformedAuditProviderBefore = await readProviderEvidence(future.pair);
    await expect(bindInitialStripeProviderPlan(futureArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(await readProviderEvidence(future.pair)).toEqual(malformedAuditProviderBefore);
    expect(await readFoundationEvidence(future.pair, 2))
      .toEqual(malformedAuditFoundationBefore);
  });

  test('malformed B2A and B2B partners block plan creation without repair', async () => {
    const root = await setupLeasedCommand(
      COMMAND_IDS.providerMalformedRoot,
      'provider-malformed-root',
      313,
    );
    const rootArgs = providerPlanArgs(
      db,
      COMMAND_IDS.providerMalformedRoot,
      root.commandPayload,
      root.leaseId,
      1,
      providerParameters('provider-malformed-root'),
    );
    const validRoot = await root.pair.commandRef.get();
    await root.pair.commandRef.set({
      ...validRoot.data(),
      journalSchemaVersion: 2,
    });
    const rootFoundationBefore = await readFoundationEvidence(root.pair, 2);
    const rootProviderBefore = await readProviderEvidence(root.pair);
    await expect(bindInitialStripeProviderPlan(rootArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(await readProviderEvidence(root.pair)).toEqual(rootProviderBefore);
    expect(await readFoundationEvidence(root.pair, 2)).toEqual(rootFoundationBefore);

    const lifecycle = await setupLeasedCommand(
      COMMAND_IDS.providerMalformedLifecycle,
      'provider-malformed-lifecycle',
      314,
    );
    const lifecycleArgs = providerPlanArgs(
      db,
      COMMAND_IDS.providerMalformedLifecycle,
      lifecycle.commandPayload,
      lifecycle.leaseId,
      1,
      providerParameters('provider-malformed-lifecycle'),
    );
    const validLifecycle = await lifecycle.pair.lifecycleRef.get();
    await lifecycle.pair.lifecycleRef.set({
      ...validLifecycle.data(),
      commandRevision: 4,
    });
    const lifecycleFoundationBefore = await readFoundationEvidence(lifecycle.pair, 2);
    const lifecycleProviderBefore = await readProviderEvidence(lifecycle.pair);
    await expect(bindInitialStripeProviderPlan(lifecycleArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(await readProviderEvidence(lifecycle.pair)).toEqual(lifecycleProviderBefore);
    expect(await readFoundationEvidence(lifecycle.pair, 2))
      .toEqual(lifecycleFoundationBefore);
  });

  test('24 identical pre-send calls create one pair and preserve every foundation byte', async () => {
    const setup = await setupBoundProviderPlan(
      COMMAND_IDS.providerSendConcurrent,
      'provider-send-concurrent',
      320,
    );
    const foundationBefore = await readFoundationEvidence(setup.pair, 2);
    const providerBefore = await readProviderEvidence(setup.pair);

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_CALLS }, () => retryWholeOperationAfterUnavailable(
        () => recordInitialStripeSendEvidence(setup.args),
        retryEvidence,
      )),
    );
    for (const result of results) expectProviderSendResult(result, 'send_permitted');

    const send = await readProviderSendEvidence(setup.pair);
    expect(send.evidence.exists).toBe(true);
    expect(send.audit.exists).toBe(true);
    expect(Object.keys(send.evidence.data).sort()).toEqual([
      'automaticRetryDeadlineAt',
      'commandIdentityVersion',
      'commandKeyHash',
      'prePostFenceEpoch',
      'prePostRecordedAt',
      'provider',
      'providerAttempt',
      'providerPlanCommitment',
      'providerPlanSchemaVersion',
      'providerSendEvidenceSchemaVersion',
    ].sort());
    expect(send.evidence.data).toMatchObject({
      providerSendEvidenceSchemaVersion: 1,
      providerPlanSchemaVersion: 1,
      commandIdentityVersion: 1,
      commandKeyHash: setup.pair.commandKeyHash,
      providerAttempt: 1,
      provider: 'stripe',
      providerPlanCommitment: expect.stringMatching(/^[0-9a-f]{64}$/),
      prePostFenceEpoch: 1,
    });
    expect(send.evidence.data.prePostRecordedAt.toMillis()).toBe(BASE_NOW_MILLIS);
    expect(send.evidence.data.automaticRetryDeadlineAt.toMillis()
      - send.evidence.data.prePostRecordedAt.toMillis())
      .toBe(PROVIDER_SEND_RETRY_WINDOW_MILLIS);
    expect(send.audit.data).toMatchObject({
      providerSendAuditSchemaVersion: 1,
      aggregateType: 'commerce_provider_send',
      commandKeyHash: setup.pair.commandKeyHash,
      providerAttempt: 1,
      eventType: 'provider_pre_send_recorded',
      provider: 'stripe',
      environment: 'test',
      stripeMode: 'test',
      providerOperation: STRIPE_OPERATION,
      providerPlanCommitment: send.evidence.data.providerPlanCommitment,
      prePostFenceEpoch: 1,
    });
    expect(send.audit.data.occurredAt.toMillis()).toBe(BASE_NOW_MILLIS);
    expect(send.audit.data.automaticRetryDeadlineAt.toMillis())
      .toBe(send.evidence.data.automaticRetryDeadlineAt.toMillis());
    expect(await readFoundationEvidence(setup.pair, 2)).toEqual(foundationBefore);
    expect(await readProviderEvidence(setup.pair)).toEqual(providerBefore);
    expect((await matchingAudits(setup.pair)).size).toBe(4);
    const rendered = JSON.stringify({ results, send });
    expect(rendered).not.toContain(STRIPE_ACCOUNT_ID);
    expect(rendered).not.toContain('provider-send-concurrent');
    expect(rendered).not.toContain(setup.leaseId);
  });

  test('lost response retries stay read-only and a conflicting plan cannot reuse evidence', async () => {
    const setup = await setupBoundProviderPlan(
      COMMAND_IDS.providerSendConflict,
      'provider-send-conflict',
      321,
    );
    expectProviderSendResult(
      await recordInitialStripeSendEvidence(setup.args),
      'send_permitted',
    );
    const sendBefore = await readProviderSendEvidence(setup.pair);
    const providerBefore = await readProviderEvidence(setup.pair);
    const foundationBefore = await readFoundationEvidence(setup.pair, 2);

    const retries = await Promise.all(Array.from(
      { length: 8 },
      () => recordInitialStripeSendEvidence(setup.args),
    ));
    for (const result of retries) expectProviderSendResult(result, 'send_permitted');
    const conflictingArgs = providerPlanArgs(
      db,
      COMMAND_IDS.providerSendConflict,
      setup.commandPayload,
      setup.leaseId,
      1,
      providerParameters('different-provider-send-parameters'),
    );
    await expect(recordInitialStripeSendEvidence(conflictingArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'command_conflict',
    });
    expect(await readProviderSendEvidence(setup.pair)).toEqual(sendBefore);
    expect(await readProviderEvidence(setup.pair)).toEqual(providerBefore);
    expect(await readFoundationEvidence(setup.pair, 2)).toEqual(foundationBefore);
    expect((await matchingAudits(setup.pair)).size).toBe(4);
  });

  test('a valid replacement parent plan cannot reuse the surviving child marker', async () => {
    const setup = await setupBoundProviderPlan(
      COMMAND_IDS.providerSendReplacement,
      'provider-send-replacement',
      326,
    );
    expectProviderSendResult(
      await recordInitialStripeSendEvidence(setup.args),
      'send_permitted',
    );
    const sendBefore = await readProviderSendEvidence(setup.pair);

    await Promise.all([
      setup.pair.providerPlanRef.delete(),
      setup.pair.providerAuditRef.delete(),
    ]);
    const replacementArgs = providerPlanArgs(
      db,
      COMMAND_IDS.providerSendReplacement,
      setup.commandPayload,
      setup.leaseId,
      1,
      providerParameters('provider-send-replacement-plan-b'),
      {
        stripeAccountId: OTHER_STRIPE_ACCOUNT_ID,
        stripeApiVersion: '2024-06-20',
      },
    );
    expectProviderPlanResult(
      await bindInitialStripeProviderPlan(replacementArgs),
      'provider_plan_bound',
    );

    await expect(recordInitialStripeSendEvidence(replacementArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(await readProviderSendEvidence(setup.pair)).toEqual(sendBefore);
  });

  test('a fresh takeover permits deadline-minus-1ns and reconciles at equality and later', async () => {
    const setup = await setupBoundProviderPlan(
      COMMAND_IDS.providerSendBoundary,
      'provider-send-boundary',
      322,
    );
    expectProviderSendResult(
      await recordInitialStripeSendEvidence(setup.args),
      'send_permitted',
    );
    const sendBefore = await readProviderSendEvidence(setup.pair);
    const deadline = sendBefore.evidence.data.automaticRetryDeadlineAt;
    const takeoverLeaseId = deterministicLeaseId(323);
    setTrustedNow(deadline.toMillis() - 1000);
    expectLeaseResult(await acquireCommerceCommandLease(acquireArgs(
      db,
      COMMAND_IDS.providerSendBoundary,
      setup.commandPayload,
      takeoverLeaseId,
    )), 2);
    const takeoverArgs = providerPlanArgs(
      db,
      COMMAND_IDS.providerSendBoundary,
      setup.commandPayload,
      takeoverLeaseId,
      2,
      providerParameters('provider-send-boundary'),
    );

    const immediatelyBeforeDeadline = new admin.firestore.Timestamp(
      deadline._seconds,
      deadline._nanoseconds - 1,
    );
    timestampNow
      .mockImplementationOnce(() => immediatelyBeforeDeadline)
      .mockImplementationOnce(() => immediatelyBeforeDeadline);
    expectProviderSendResult(
      await recordInitialStripeSendEvidence(takeoverArgs),
      'send_permitted',
    );
    timestampNow.mockImplementationOnce(() => new admin.firestore.Timestamp(
      deadline._seconds,
      deadline._nanoseconds,
    ));
    expectProviderSendResult(
      await recordInitialStripeSendEvidence(takeoverArgs),
      'reconciliation_required',
    );
    timestampNow.mockImplementationOnce(() => new admin.firestore.Timestamp(
      deadline._seconds,
      deadline._nanoseconds + 1,
    ));
    expectProviderSendResult(
      await recordInitialStripeSendEvidence(takeoverArgs),
      'reconciliation_required',
    );
    expect(await readProviderSendEvidence(setup.pair)).toEqual(sendBefore);
    expect((await matchingAudits(setup.pair)).size).toBe(5);
  });

  test('an injected commit failure leaves neither send partner', async () => {
    const setup = await setupBoundProviderPlan(
      COMMAND_IDS.providerSendCommitFailure,
      'provider-send-commit-failure',
      324,
    );
    const foundationBefore = await readFoundationEvidence(setup.pair, 2);
    const providerBefore = await readProviderEvidence(setup.pair);
    const sendBefore = await readProviderSendEvidence(setup.pair);
    const auditsBefore = await matchingAudits(setup.pair);
    const commitFailure = jest.spyOn(FirestoreTransaction.prototype, 'commit')
      .mockRejectedValueOnce(new Error('synthetic commit failure'));
    let commitCalls = 0;

    try {
      const error = await recordInitialStripeSendEvidence(setup.args).then(
        () => null,
        (reason) => reason,
      );
      expectJournalError(error, 'journal_unavailable');
      commitCalls = commitFailure.mock.calls.length;
    } finally {
      commitFailure.mockRestore();
    }
    expect(commitCalls).toBe(1);
    expect(await readProviderSendEvidence(setup.pair)).toEqual(sendBefore);
    expect(await readProviderEvidence(setup.pair)).toEqual(providerBefore);
    expect(await readFoundationEvidence(setup.pair, 2)).toEqual(foundationBefore);
    expect((await matchingAudits(setup.pair)).size).toBe(auditsBefore.size);
    expect(sendBefore.evidence.exists).toBe(false);
    expect(sendBefore.audit.exists).toBe(false);
  });

  test('orphan identity evidence errors while paired missing time requires reconciliation', async () => {
    const setup = await setupBoundProviderPlan(
      COMMAND_IDS.providerSendOrphan,
      'provider-send-orphan',
      325,
    );
    await setup.pair.providerSendAuditRef.create({
      providerSendAuditSchemaVersion: 1,
      syntheticOrphan: true,
    });
    const orphanBefore = await readProviderSendEvidence(setup.pair);
    await expect(recordInitialStripeSendEvidence(setup.args)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(await readProviderSendEvidence(setup.pair)).toEqual(orphanBefore);

    await setup.pair.providerSendAuditRef.delete();
    expectProviderSendResult(
      await recordInitialStripeSendEvidence(setup.args),
      'send_permitted',
    );
    const validEvidence = await setup.pair.providerSendRef.get();
    const validAudit = await setup.pair.providerSendAuditRef.get();
    const evidenceWithoutTime = { ...validEvidence.data() };
    const auditWithoutTime = { ...validAudit.data() };
    delete evidenceWithoutTime.prePostRecordedAt;
    delete auditWithoutTime.occurredAt;
    await setup.pair.providerSendRef.set(evidenceWithoutTime);
    await setup.pair.providerSendAuditRef.set(auditWithoutTime);
    const unknownBefore = await readProviderSendEvidence(setup.pair);
    expectProviderSendResult(
      await recordInitialStripeSendEvidence(setup.args),
      'reconciliation_required',
    );
    expect(await readProviderSendEvidence(setup.pair)).toEqual(unknownBefore);
  });

  test('cutoff blocks early persistence and 24 identical calls create one immutable pair', async () => {
    const setup = await setupProviderReconciliationFoundation(
      COMMAND_IDS.providerReconciliationConcurrent,
      'provider-reconciliation-concurrent',
      330,
    );
    const args = reconciliationArgs(setup.args, dispatchNeverBeganCandidate());
    const deadlineMillis = setup.automaticRetryDeadlineAt.toMillis();
    const foundationBefore = await readFoundationEvidence(setup.pair, 2);
    const providerBefore = await readProviderEvidence(setup.pair);
    const sendBefore = await readProviderSendEvidence(setup.pair);

    setTrustedNow(deadlineMillis - 1);
    expectNewAttemptCandidate(
      await recordInitialStripeReconciliationEvidence(args),
    );
    expect(await readProviderReconciliationEvidence(setup.pair)).toEqual({
      evidence: {
        exists: false,
        data: undefined,
        createTime: undefined,
        updateTime: undefined,
      },
      audit: {
        exists: false,
        data: undefined,
        createTime: undefined,
        updateTime: undefined,
      },
    });

    setTrustedNow(deadlineMillis);
    const results = await Promise.all(
      Array.from({ length: CONCURRENT_CALLS }, () => retryWholeOperationAfterUnavailable(
        () => recordInitialStripeReconciliationEvidence(args),
        retryEvidence,
      )),
    );
    for (const result of results) expectProviderReconciliationResult(result);

    const reconciliation = await readProviderReconciliationEvidence(setup.pair);
    expect(setup.pair.providerReconciliationRef.path).toBe(
      `checkoutRequests/${setup.pair.commandKeyHash}`
      + '/providerAttempts/0000000001/reconciliationEvidence/0000000001',
    );
    expect(setup.pair.providerReconciliationAuditRef.path).toBe(
      `auditEvents/commerce_provider_reconciliation_${setup.pair.commandKeyHash}`
      + '_0000000001_0000000001',
    );
    expect(reconciliation.evidence.exists).toBe(true);
    expect(reconciliation.audit.exists).toBe(true);
    expect(Object.keys(reconciliation.evidence.data).sort()).toEqual([
      'businessTransitionEvidence',
      'classification',
      'commandIdentityVersion',
      'commandKeyHash',
      'dispatchEvidence',
      'eventEvidence',
      'evidenceCompleteness',
      'evidenceRevision',
      'evidenceSource',
      'idempotencyEvidence',
      'observedFenceEpoch',
      'observedLeaseExpiresAt',
      'paymentEvidence',
      'planBinding',
      'provider',
      'providerAttempt',
      'providerObjectEvidence',
      'providerPlanCommitment',
      'providerPlanSchemaVersion',
      'providerReconciliationEvidenceSchemaVersion',
      'providerSendEvidenceCommitment',
      'providerSendEvidenceSchemaVersion',
      'reconciliationPolicySchemaVersion',
      'recordedAt',
      'responseEvidence',
      'searchEvidence',
      'state',
    ].sort());
    expect(reconciliation.evidence.data).toMatchObject({
      providerReconciliationEvidenceSchemaVersion: 1,
      reconciliationPolicySchemaVersion: 1,
      providerPlanSchemaVersion: 1,
      providerSendEvidenceSchemaVersion: 1,
      commandIdentityVersion: 1,
      commandKeyHash: setup.pair.commandKeyHash,
      providerAttempt: 1,
      provider: 'stripe',
      evidenceRevision: 1,
      providerPlanCommitment: expect.stringMatching(/^[0-9a-f]{64}$/),
      providerSendEvidenceCommitment: expect.stringMatching(/^[0-9a-f]{64}$/),
      classification: 'new_attempt_candidate',
      state: 'requires_persistence_and_authorization',
      ...dispatchNeverBeganCandidate(),
      observedFenceEpoch: 1,
    });
    expect(reconciliation.evidence.data.recordedAt.toMillis()).toBe(deadlineMillis);
    expect(reconciliation.evidence.data.observedLeaseExpiresAt.toMillis())
      .toBe(BASE_NOW_MILLIS + LEASE_DURATION_MILLIS);
    expect(reconciliation.audit.data).toMatchObject({
      providerReconciliationAuditSchemaVersion: 1,
      providerReconciliationEvidenceSchemaVersion: 1,
      aggregateType: 'commerce_provider_reconciliation',
      commandKeyHash: setup.pair.commandKeyHash,
      providerAttempt: 1,
      evidenceRevision: 1,
      eventType: 'provider_reconciliation_candidate_recorded',
      provider: 'stripe',
      environment: 'test',
      stripeMode: 'test',
      providerOperation: STRIPE_OPERATION,
      providerPlanCommitment: reconciliation.evidence.data.providerPlanCommitment,
      providerSendEvidenceCommitment: (
        reconciliation.evidence.data.providerSendEvidenceCommitment
      ),
      reconciliationPolicySchemaVersion: 1,
      classification: 'new_attempt_candidate',
      observedFenceEpoch: 1,
      reconciliationEvidenceCommitment: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(reconciliation.audit.data.occurredAt.toMillis()).toBe(deadlineMillis);
    expect(reconciliation.audit.data.observedLeaseExpiresAt.toMillis())
      .toBe(BASE_NOW_MILLIS + LEASE_DURATION_MILLIS);
    expect(await readFoundationEvidence(setup.pair, 2)).toEqual(foundationBefore);
    expect(await readProviderEvidence(setup.pair)).toEqual(providerBefore);
    expect(await readProviderSendEvidence(setup.pair)).toEqual(sendBefore);
    expect((await matchingAudits(setup.pair)).size).toBe(5);
    const rendered = JSON.stringify({ results, reconciliation });
    expect(rendered).not.toContain(STRIPE_ACCOUNT_ID);
    expect(rendered).not.toContain('provider-reconciliation-concurrent');
    expect(rendered).not.toContain(setup.leaseId);
  });

  test('12-v-12 valid candidates persist one winner and conflict without overwrite', async () => {
    const setup = await setupProviderReconciliationFoundation(
      COMMAND_IDS.providerReconciliationConflict,
      'provider-reconciliation-conflict',
      331,
    );
    const firstArgs = reconciliationArgs(setup.args, dispatchNeverBeganCandidate());
    const secondArgs = reconciliationArgs(setup.args, expiredAttemptCandidate());
    setTrustedNow(setup.automaticRetryDeadlineAt.toMillis());

    const settled = await Promise.allSettled([
      ...Array.from({ length: 12 }, () => retryWholeOperationAfterUnavailable(
        () => recordInitialStripeReconciliationEvidence(firstArgs),
        retryEvidence,
      )),
      ...Array.from({ length: 12 }, () => retryWholeOperationAfterUnavailable(
        () => recordInitialStripeReconciliationEvidence(secondArgs),
        retryEvidence,
      )),
    ]);
    const fulfilled = settled.filter(({ status }) => status === 'fulfilled');
    const rejected = settled.filter(({ status }) => status === 'rejected');
    expect(fulfilled).toHaveLength(12);
    for (const result of fulfilled) expectProviderReconciliationResult(result.value);
    expect(rejected).toHaveLength(12);
    for (const result of rejected) expectJournalError(result.reason, 'command_conflict');

    const firstHalfWon = settled.slice(0, 12)
      .every(({ status }) => status === 'fulfilled');
    const secondHalfWon = settled.slice(12)
      .every(({ status }) => status === 'fulfilled');
    expect(firstHalfWon).not.toBe(secondHalfWon);
    const winningArgs = firstHalfWon ? firstArgs : secondArgs;
    const losingArgs = firstHalfWon ? secondArgs : firstArgs;
    const winnerBeforeProbes = await readProviderReconciliationEvidence(setup.pair);
    expectProviderReconciliationResult(
      await recordInitialStripeReconciliationEvidence(winningArgs),
    );
    await expect(recordInitialStripeReconciliationEvidence(losingArgs))
      .rejects.toMatchObject({
        code: 'commerce_command_journal_error',
        reason: 'command_conflict',
      });
    expect(await readProviderReconciliationEvidence(setup.pair))
      .toEqual(winnerBeforeProbes);
    expect((await matchingAudits(setup.pair)).size).toBe(5);
  });

  test('a retry after a lost reconciliation response is exact and read-only', async () => {
    const setup = await setupProviderReconciliationFoundation(
      COMMAND_IDS.providerReconciliationLostResponse,
      'provider-reconciliation-lost-response',
      332,
    );
    const args = reconciliationArgs(setup.args, expiredAttemptCandidate());
    setTrustedNow(setup.automaticRetryDeadlineAt.toMillis());
    expectProviderReconciliationResult(
      await recordInitialStripeReconciliationEvidence(args),
    );
    const reconciliationBefore = await readProviderReconciliationEvidence(setup.pair);
    const foundationBefore = await readFoundationEvidence(setup.pair, 2);
    const providerBefore = await readProviderEvidence(setup.pair);
    const sendBefore = await readProviderSendEvidence(setup.pair);

    const retries = await Promise.all(Array.from(
      { length: 8 },
      () => recordInitialStripeReconciliationEvidence(args),
    ));
    for (const result of retries) expectProviderReconciliationResult(result);
    expect(await readProviderReconciliationEvidence(setup.pair))
      .toEqual(reconciliationBefore);
    expect(await readFoundationEvidence(setup.pair, 2)).toEqual(foundationBefore);
    expect(await readProviderEvidence(setup.pair)).toEqual(providerBefore);
    expect(await readProviderSendEvidence(setup.pair)).toEqual(sendBefore);
    expect((await matchingAudits(setup.pair)).size).toBe(5);
  });

  test('a takeover stays blocked while active and persists at its expiry equality', async () => {
    const setup = await setupProviderReconciliationFoundation(
      COMMAND_IDS.providerReconciliationTakeover,
      'provider-reconciliation-takeover',
      333,
    );
    const deadlineMillis = setup.automaticRetryDeadlineAt.toMillis();
    const takeoverLeaseId = deterministicLeaseId(334);
    setTrustedNow(deadlineMillis);
    expectLeaseResult(await acquireCommerceCommandLease(acquireArgs(
      db,
      COMMAND_IDS.providerReconciliationTakeover,
      setup.commandPayload,
      takeoverLeaseId,
    )), 2);
    const args = reconciliationArgs(setup.args, dispatchNeverBeganCandidate());
    const takeoverExpiryMillis = deadlineMillis + LEASE_DURATION_MILLIS;

    setTrustedNow(takeoverExpiryMillis - 1);
    expectNewAttemptCandidate(
      await recordInitialStripeReconciliationEvidence(args),
    );
    expect((await readProviderReconciliationEvidence(setup.pair)).evidence.exists)
      .toBe(false);

    setTrustedNow(takeoverExpiryMillis);
    expectProviderReconciliationResult(
      await recordInitialStripeReconciliationEvidence(args),
    );
    const reconciliation = await readProviderReconciliationEvidence(setup.pair);
    expect(reconciliation.evidence.data.observedFenceEpoch).toBe(2);
    expect(reconciliation.evidence.data.observedLeaseExpiresAt.toMillis())
      .toBe(takeoverExpiryMillis);
    expect(reconciliation.evidence.data.recordedAt.toMillis()).toBe(takeoverExpiryMillis);
    expect(reconciliation.audit.data.observedFenceEpoch).toBe(2);
    expect(reconciliation.audit.data.observedLeaseExpiresAt.toMillis())
      .toBe(takeoverExpiryMillis);
    expect((await matchingAudits(setup.pair)).size).toBe(6);
  });

  test('an injected commit failure leaves neither reconciliation partner', async () => {
    const setup = await setupProviderReconciliationFoundation(
      COMMAND_IDS.providerReconciliationCommitFailure,
      'provider-reconciliation-commit-failure',
      335,
    );
    const args = reconciliationArgs(setup.args, dispatchNeverBeganCandidate());
    setTrustedNow(setup.automaticRetryDeadlineAt.toMillis());
    const reconciliationBefore = await readProviderReconciliationEvidence(setup.pair);
    const foundationBefore = await readFoundationEvidence(setup.pair, 2);
    const providerBefore = await readProviderEvidence(setup.pair);
    const sendBefore = await readProviderSendEvidence(setup.pair);
    const auditsBefore = await matchingAudits(setup.pair);
    const commitFailure = jest.spyOn(FirestoreTransaction.prototype, 'commit')
      .mockRejectedValueOnce(new Error('synthetic reconciliation commit failure'));
    let commitCalls = 0;

    try {
      const error = await recordInitialStripeReconciliationEvidence(args).then(
        () => null,
        (reason) => reason,
      );
      expectJournalError(error, 'journal_unavailable');
      commitCalls = commitFailure.mock.calls.length;
    } finally {
      commitFailure.mockRestore();
    }
    expect(commitCalls).toBe(1);
    expect(await readProviderReconciliationEvidence(setup.pair))
      .toEqual(reconciliationBefore);
    expect(await readFoundationEvidence(setup.pair, 2)).toEqual(foundationBefore);
    expect(await readProviderEvidence(setup.pair)).toEqual(providerBefore);
    expect(await readProviderSendEvidence(setup.pair)).toEqual(sendBefore);
    expect((await matchingAudits(setup.pair)).size).toBe(auditsBefore.size);
    expect(reconciliationBefore.evidence.exists).toBe(false);
    expect(reconciliationBefore.audit.exists).toBe(false);
  });

  test('both reconciliation orphan directions fail closed without repair', async () => {
    const setup = await setupProviderReconciliationFoundation(
      COMMAND_IDS.providerReconciliationOrphan,
      'provider-reconciliation-orphan',
      336,
    );
    const args = reconciliationArgs(setup.args, dispatchNeverBeganCandidate());
    setTrustedNow(setup.automaticRetryDeadlineAt.toMillis());
    await setup.pair.providerReconciliationAuditRef.create({
      providerReconciliationAuditSchemaVersion: 1,
      syntheticOrphan: true,
    });
    const auditOrphanBefore = await readProviderReconciliationEvidence(setup.pair);
    await expect(recordInitialStripeReconciliationEvidence(args)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(await readProviderReconciliationEvidence(setup.pair))
      .toEqual(auditOrphanBefore);

    await setup.pair.providerReconciliationAuditRef.delete();
    expectProviderReconciliationResult(
      await recordInitialStripeReconciliationEvidence(args),
    );
    await setup.pair.providerReconciliationAuditRef.delete();
    const recordOrphanBefore = await readProviderReconciliationEvidence(setup.pair);
    await expect(recordInitialStripeReconciliationEvidence(args)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(await readProviderReconciliationEvidence(setup.pair))
      .toEqual(recordOrphanBefore);
    expect(recordOrphanBefore.evidence.exists).toBe(true);
    expect(recordOrphanBefore.audit.exists).toBe(false);
  });

  test('a malformed C2 foundation blocks reconciliation without creating a pair', async () => {
    const setup = await setupProviderReconciliationFoundation(
      COMMAND_IDS.providerReconciliationMalformedSend,
      'provider-reconciliation-malformed-send',
      337,
    );
    const args = reconciliationArgs(setup.args, expiredAttemptCandidate());
    const validSend = await setup.pair.providerSendRef.get();
    await setup.pair.providerSendRef.set({
      ...validSend.data(),
      providerSendEvidenceSchemaVersion: 2,
    });
    setTrustedNow(setup.automaticRetryDeadlineAt.toMillis());
    const malformedSendBefore = await readProviderSendEvidence(setup.pair);
    const reconciliationBefore = await readProviderReconciliationEvidence(setup.pair);
    const auditsBefore = await matchingAudits(setup.pair);

    await expect(recordInitialStripeReconciliationEvidence(args)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'journal_record_invalid',
    });
    expect(await readProviderSendEvidence(setup.pair)).toEqual(malformedSendBefore);
    expect(await readProviderReconciliationEvidence(setup.pair))
      .toEqual(reconciliationBefore);
    expect((await matchingAudits(setup.pair)).size).toBe(auditsBefore.size);
    expect(reconciliationBefore.evidence.exists).toBe(false);
    expect(reconciliationBefore.audit.exists).toBe(false);
  });

  test.each([
    [
      'trusted execution-never-began evidence',
      COMMAND_IDS.providerAuthorizationNeverBegan,
      'provider-authorization-never-began',
      340,
      dispatchNeverBeganCandidate,
      'retry_same_operation',
    ],
    [
      'verified expired-and-unpaid evidence',
      COMMAND_IDS.providerAuthorizationExpired,
      'provider-authorization-expired',
      342,
      expiredAttemptCandidate,
      'replace_expired_unpaid',
    ],
  ])('a fresh later lease authorizes attempt 2 from %s', async (
    _label,
    commandId,
    reference,
    leaseIndex,
    evidenceFactory,
    expectedTransitionKind,
  ) => {
    const setup = await setupPersistedProviderCandidate(
      commandId,
      reference,
      leaseIndex,
      evidenceFactory(),
    );
    const foundationBefore = await readFoundationEvidence(setup.pair, 3);
    const providerBefore = await readProviderEvidence(setup.pair);
    const sendBefore = await readProviderSendEvidence(setup.pair);
    const reconciliationBefore = await readProviderReconciliationEvidence(setup.pair);

    expectProviderAuthorizationResult(
      await authorizeNextStripeProviderAttempt(setup.authorizationArgs),
    );

    const authorization = await readProviderAuthorizationEvidence(setup.pair);
    expect(setup.pair.providerAuthorizationRef.path).toBe(
      `checkoutRequests/${setup.pair.commandKeyHash}`
      + '/providerAttempts/0000000001/reconciliationEvidence/0000000001/'
      + 'nextAttemptAuthorizations/0000000002',
    );
    expect(setup.pair.providerAuthorizationAuditRef.path).toBe(
      `auditEvents/commerce_provider_authorization_${setup.pair.commandKeyHash}`
      + '_0000000001_0000000001_0000000002',
    );
    expect(authorization.authorization.exists).toBe(true);
    expect(authorization.audit.exists).toBe(true);
    expect(authorization.authorization.data).toMatchObject({
      providerAttemptAuthorizationSchemaVersion: 1,
      providerReconciliationEvidenceSchemaVersion: 1,
      reconciliationPolicySchemaVersion: 1,
      commandIdentityVersion: 1,
      commandKeyHash: setup.pair.commandKeyHash,
      provider: 'stripe',
      previousProviderAttempt: 1,
      authorizedProviderAttempt: 2,
      authorizationRevision: 1,
      environment: 'test',
      stripeMode: 'test',
      providerOperation: STRIPE_OPERATION,
      providerPlanCommitment: reconciliationBefore.evidence.data.providerPlanCommitment,
      providerSendEvidenceCommitment: (
        reconciliationBefore.evidence.data.providerSendEvidenceCommitment
      ),
      providerReconciliationEvidenceCommitment: (
        reconciliationBefore.audit.data.reconciliationEvidenceCommitment
      ),
      transitionKind: expectedTransitionKind,
      transitionRecordCommitment: expect.stringMatching(/^[0-9a-f]{64}$/),
      idempotencyKeyFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      authorizedFenceEpoch: 2,
    });
    expect(authorization.authorization.data.transitionRecordCommitment)
      .not.toBe(TRANSITION_RECORD_COMMITMENT);
    expect(authorization.authorization.data.idempotencyKeyFingerprint)
      .not.toBe(providerBefore.plan.data.idempotencyKeyFingerprint);
    expect(authorization.authorization.data.authorizedAt.toMillis())
      .toBe(setup.automaticRetryDeadlineAt.toMillis());
    expect(authorization.audit.data).toMatchObject({
      providerAttemptAuthorizationAuditSchemaVersion: 1,
      providerAttemptAuthorizationSchemaVersion: 1,
      aggregateType: 'commerce_provider_authorization',
      commandKeyHash: setup.pair.commandKeyHash,
      previousProviderAttempt: 1,
      authorizedProviderAttempt: 2,
      authorizationRevision: 1,
      eventType: 'provider_attempt_authorized',
      provider: 'stripe',
      environment: 'test',
      stripeMode: 'test',
      providerOperation: STRIPE_OPERATION,
      providerReconciliationEvidenceCommitment: (
        authorization.authorization.data.providerReconciliationEvidenceCommitment
      ),
      transitionKind: expectedTransitionKind,
      transitionRecordCommitment: authorization.authorization.data.transitionRecordCommitment,
      idempotencyKeyFingerprint: authorization.authorization.data.idempotencyKeyFingerprint,
      authorizedFenceEpoch: 2,
      providerAttemptAuthorizationCommitment: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(authorization.audit.data.occurredAt.toMillis())
      .toBe(setup.automaticRetryDeadlineAt.toMillis());
    expect(await readFoundationEvidence(setup.pair, 3)).toEqual(foundationBefore);
    expect(await readProviderEvidence(setup.pair)).toEqual(providerBefore);
    expect(await readProviderSendEvidence(setup.pair)).toEqual(sendBefore);
    expect(await readProviderReconciliationEvidence(setup.pair))
      .toEqual(reconciliationBefore);
    expect((await setup.pair.nextProviderPlanRef.get()).exists).toBe(false);
    expect((await setup.pair.nextProviderSendRef.get()).exists).toBe(false);
    expect((await matchingAudits(setup.pair)).size).toBe(7);

    const rendered = JSON.stringify({ authorization });
    expect(rendered).not.toContain(STRIPE_ACCOUNT_ID);
    expect(rendered).not.toContain(reference);
    expect(rendered).not.toContain(setup.freshLeaseId);
    expect(rendered).not.toContain(TRANSITION_RECORD_COMMITMENT);
  });

  test('24 concurrent exact authorizations create one immutable pair', async () => {
    const setup = await setupPersistedProviderCandidate(
      COMMAND_IDS.providerAuthorizationConcurrent,
      'provider-authorization-concurrent',
      344,
      dispatchNeverBeganCandidate(),
    );
    const foundationBefore = await readFoundationEvidence(setup.pair, 3);
    const providerBefore = await readProviderEvidence(setup.pair);
    const sendBefore = await readProviderSendEvidence(setup.pair);
    const reconciliationBefore = await readProviderReconciliationEvidence(setup.pair);

    const results = await Promise.all(Array.from(
      { length: CONCURRENT_CALLS },
      () => retryWholeOperationAfterUnavailable(
        () => authorizeNextStripeProviderAttempt(setup.authorizationArgs),
        retryEvidence,
      ),
    ));
    for (const result of results) expectProviderAuthorizationResult(result);

    const authorization = await readProviderAuthorizationEvidence(setup.pair);
    expect(authorization.authorization.exists).toBe(true);
    expect(authorization.audit.exists).toBe(true);
    expect(authorization.authorization.createTime)
      .toBe(authorization.authorization.updateTime);
    expect(authorization.audit.createTime).toBe(authorization.audit.updateTime);
    expect(await readFoundationEvidence(setup.pair, 3)).toEqual(foundationBefore);
    expect(await readProviderEvidence(setup.pair)).toEqual(providerBefore);
    expect(await readProviderSendEvidence(setup.pair)).toEqual(sendBefore);
    expect(await readProviderReconciliationEvidence(setup.pair))
      .toEqual(reconciliationBefore);
    expect((await matchingAudits(setup.pair)).size).toBe(7);
  });

  test('12-v-12 valid transition commitments produce one winner without overwrite', async () => {
    const setup = await setupPersistedProviderCandidate(
      COMMAND_IDS.providerAuthorizationConflict,
      'provider-authorization-conflict',
      346,
      expiredAttemptCandidate(),
    );
    const firstArgs = setup.authorizationArgs;
    const secondArgs = providerAuthorizationArgs(
      setup.args,
      setup.freshLeaseId,
      2,
      expiredAttemptCandidate(),
      'replace_expired_unpaid',
      OTHER_TRANSITION_RECORD_COMMITMENT,
    );

    const settled = await Promise.allSettled([
      ...Array.from({ length: 12 }, () => retryWholeOperationAfterUnavailable(
        () => authorizeNextStripeProviderAttempt(firstArgs),
        retryEvidence,
      )),
      ...Array.from({ length: 12 }, () => retryWholeOperationAfterUnavailable(
        () => authorizeNextStripeProviderAttempt(secondArgs),
        retryEvidence,
      )),
    ]);
    const fulfilled = settled.filter(({ status }) => status === 'fulfilled');
    const rejected = settled.filter(({ status }) => status === 'rejected');
    expect(fulfilled).toHaveLength(12);
    for (const result of fulfilled) expectProviderAuthorizationResult(result.value);
    expect(rejected).toHaveLength(12);
    for (const result of rejected) expectJournalError(result.reason, 'command_conflict');

    const firstHalfWon = settled.slice(0, 12)
      .every(({ status }) => status === 'fulfilled');
    const secondHalfWon = settled.slice(12)
      .every(({ status }) => status === 'fulfilled');
    expect(firstHalfWon).not.toBe(secondHalfWon);
    const winningArgs = firstHalfWon ? firstArgs : secondArgs;
    const losingArgs = firstHalfWon ? secondArgs : firstArgs;
    const winnerBeforeProbes = await readProviderAuthorizationEvidence(setup.pair);
    expectProviderAuthorizationResult(
      await authorizeNextStripeProviderAttempt(winningArgs),
    );
    await expect(authorizeNextStripeProviderAttempt(losingArgs)).rejects.toMatchObject({
      code: 'commerce_command_journal_error',
      reason: 'command_conflict',
    });
    expect(await readProviderAuthorizationEvidence(setup.pair))
      .toEqual(winnerBeforeProbes);
    expect((await matchingAudits(setup.pair)).size).toBe(7);
  });

  test('lost acknowledgement retries are exact and byte-preserving', async () => {
    const setup = await setupPersistedProviderCandidate(
      COMMAND_IDS.providerAuthorizationLostResponse,
      'provider-authorization-lost-response',
      348,
      dispatchNeverBeganCandidate(),
    );
    expectProviderAuthorizationResult(
      await authorizeNextStripeProviderAttempt(setup.authorizationArgs),
    );
    const authorizationBefore = await readProviderAuthorizationEvidence(setup.pair);
    const foundationBefore = await readFoundationEvidence(setup.pair, 3);
    const providerBefore = await readProviderEvidence(setup.pair);
    const sendBefore = await readProviderSendEvidence(setup.pair);
    const reconciliationBefore = await readProviderReconciliationEvidence(setup.pair);

    const retries = await Promise.all(Array.from(
      { length: 8 },
      () => authorizeNextStripeProviderAttempt(setup.authorizationArgs),
    ));
    for (const result of retries) expectProviderAuthorizationResult(result);
    expect(await readProviderAuthorizationEvidence(setup.pair))
      .toEqual(authorizationBefore);
    expect(await readFoundationEvidence(setup.pair, 3)).toEqual(foundationBefore);
    expect(await readProviderEvidence(setup.pair)).toEqual(providerBefore);
    expect(await readProviderSendEvidence(setup.pair)).toEqual(sendBefore);
    expect(await readProviderReconciliationEvidence(setup.pair))
      .toEqual(reconciliationBefore);
    expect((await matchingAudits(setup.pair)).size).toBe(7);
  });

  test('an injected commit failure leaves neither authorization partner', async () => {
    const setup = await setupPersistedProviderCandidate(
      COMMAND_IDS.providerAuthorizationCommitFailure,
      'provider-authorization-commit-failure',
      350,
      dispatchNeverBeganCandidate(),
    );
    const authorizationBefore = await readProviderAuthorizationEvidence(setup.pair);
    const auditsBefore = await matchingAudits(setup.pair);
    const commitFailure = jest.spyOn(FirestoreTransaction.prototype, 'commit')
      .mockRejectedValueOnce(new Error('synthetic authorization commit failure'));
    let commitCalls = 0;

    try {
      const error = await authorizeNextStripeProviderAttempt(setup.authorizationArgs).then(
        () => null,
        (reason) => reason,
      );
      expectJournalError(error, 'journal_unavailable');
      commitCalls = commitFailure.mock.calls.length;
    } finally {
      commitFailure.mockRestore();
    }
    expect(commitCalls).toBe(1);
    expect(await readProviderAuthorizationEvidence(setup.pair))
      .toEqual(authorizationBefore);
    expect((await matchingAudits(setup.pair)).size).toBe(auditsBefore.size);
    expect(authorizationBefore.authorization.exists).toBe(false);
    expect(authorizationBefore.audit.exists).toBe(false);
  });

  test('both authorization orphan directions fail closed without repair', async () => {
    const setup = await setupPersistedProviderCandidate(
      COMMAND_IDS.providerAuthorizationOrphan,
      'provider-authorization-orphan',
      352,
      expiredAttemptCandidate(),
    );
    await setup.pair.providerAuthorizationAuditRef.create({
      providerAttemptAuthorizationAuditSchemaVersion: 1,
      syntheticOrphan: true,
    });
    const auditOrphanBefore = await readProviderAuthorizationEvidence(setup.pair);
    await expect(authorizeNextStripeProviderAttempt(setup.authorizationArgs))
      .rejects.toMatchObject({
        code: 'commerce_command_journal_error',
        reason: 'journal_record_invalid',
      });
    expect(await readProviderAuthorizationEvidence(setup.pair))
      .toEqual(auditOrphanBefore);

    await setup.pair.providerAuthorizationAuditRef.delete();
    expectProviderAuthorizationResult(
      await authorizeNextStripeProviderAttempt(setup.authorizationArgs),
    );
    await setup.pair.providerAuthorizationAuditRef.delete();
    const recordOrphanBefore = await readProviderAuthorizationEvidence(setup.pair);
    await expect(authorizeNextStripeProviderAttempt(setup.authorizationArgs))
      .rejects.toMatchObject({
        code: 'commerce_command_journal_error',
        reason: 'journal_record_invalid',
      });
    expect(await readProviderAuthorizationEvidence(setup.pair))
      .toEqual(recordOrphanBefore);
    expect(recordOrphanBefore.authorization.exists).toBe(true);
    expect(recordOrphanBefore.audit.exists).toBe(false);
  });

  test('malformed authorization and C3B commitment fail closed without repair', async () => {
    const setup = await setupPersistedProviderCandidate(
      COMMAND_IDS.providerAuthorizationMalformed,
      'provider-authorization-malformed',
      354,
      dispatchNeverBeganCandidate(),
    );
    expectProviderAuthorizationResult(
      await authorizeNextStripeProviderAttempt(setup.authorizationArgs),
    );
    const validAuthorization = await setup.pair.providerAuthorizationRef.get();
    await setup.pair.providerAuthorizationRef.set({
      ...validAuthorization.data(),
      providerAttemptAuthorizationSchemaVersion: 2,
    });
    const malformedBefore = await readProviderAuthorizationEvidence(setup.pair);
    await expect(authorizeNextStripeProviderAttempt(setup.authorizationArgs))
      .rejects.toMatchObject({
        code: 'commerce_command_journal_error',
        reason: 'journal_record_invalid',
      });
    expect(await readProviderAuthorizationEvidence(setup.pair))
      .toEqual(malformedBefore);

    await setup.pair.providerAuthorizationRef.set(validAuthorization.data());
    const validReconciliationAudit = await setup.pair.providerReconciliationAuditRef.get();
    await setup.pair.providerReconciliationAuditRef.set({
      ...validReconciliationAudit.data(),
      reconciliationEvidenceCommitment: OTHER_TRANSITION_RECORD_COMMITMENT,
    });
    const changedFoundationBefore = await readProviderReconciliationEvidence(setup.pair);
    const authorizationBefore = await readProviderAuthorizationEvidence(setup.pair);
    await expect(authorizeNextStripeProviderAttempt(setup.authorizationArgs))
      .rejects.toMatchObject({
        code: 'commerce_command_journal_error',
        reason: 'journal_record_invalid',
      });
    expect(await readProviderReconciliationEvidence(setup.pair))
      .toEqual(changedFoundationBefore);
    expect(await readProviderAuthorizationEvidence(setup.pair))
      .toEqual(authorizationBefore);
  });
});
