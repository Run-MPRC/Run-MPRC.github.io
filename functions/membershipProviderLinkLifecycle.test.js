'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { inspect } = require('node:util');
const { createHash } = require('node:crypto');

const {
  providerLinkSchemaVersion,
  classifyProviderLinkReconciliation,
} = require('./membershipProviderLink');
const {
  providerLinkLifecycleSchemaVersion,
  MEMBERSHIP_PROVIDER_LINK_LIFECYCLE_ENUMS,
  MembershipProviderLinkLifecycleError,
  createProviderLinkLifecycle,
  applyProviderLinkLifecycleCommand,
  deriveProviderLinkLifecycleVerdict,
} = require('./membershipProviderLinkLifecycle');

const HOSTILE_CANARY = 'private-member@example.test/+12025550445?token=do-not-copy';
const MEMBERSHIP_ID = 'mbr_test_001';
const OTHER_MEMBERSHIP_ID = 'mbr_test_other';
const ACCOUNT_REF = 'provider.account.001';
const NEW_ACCOUNT_REF = 'provider.account.002';

const RECORD_KEYS = [
  'providerLinkLifecycleSchemaVersion',
  'provider',
  'membershipId',
  'providerAccountRef',
  'effectiveConsentDisposition',
  'desiredState',
  'observedState',
  'boundMembershipId',
  'revision',
  'lastReconciliation',
  'lastCommand',
  'grantsAuthority',
];

function digest(values) {
  return createHash('sha256').update(JSON.stringify(values), 'utf8').digest('hex');
}

function computedCreateHash(input) {
  return digest([
    1,
    'create_provider_link',
    input.provider,
    input.membershipId,
    input.providerAccountRef,
    input.effectiveConsentDisposition,
  ]);
}

function computedCommandHash(command) {
  if (command.commandType === 'set_consent') {
    return digest([1, command.commandType, command.effectiveConsentDisposition]);
  }
  if (command.commandType === 'request_state') {
    return digest([1, command.commandType, command.desiredState]);
  }
  if (command.commandType === 'replace_provider_account') {
    return digest([1, command.commandType, command.providerAccountRef]);
  }
  return digest([
    1,
    command.commandType,
    command.providerAccountRef,
    command.reconciledDesiredState,
    command.reconciliationSequence,
    command.outcome,
    command.attemptRef,
    command.observedState,
    command.boundMembershipId,
    command.errorCode,
  ]);
}

function withComputedHash(input, compute) {
  if (typeof input.commandPayloadHash === 'string'
    && input.commandPayloadHash.startsWith('sha256.')) {
    return { ...input, commandPayloadHash: compute(input) };
  }
  return input;
}

function createInput(overrides = {}) {
  return withComputedHash({
    providerLinkLifecycleSchemaVersion: 1,
    provider: 'google',
    membershipId: MEMBERSHIP_ID,
    providerAccountRef: ACCOUNT_REF,
    effectiveConsentDisposition: 'active',
    commandId: 'cmd_create_001',
    commandPayloadHash: 'sha256.create.001',
    ...overrides,
  }, computedCreateHash);
}

function setConsent(overrides = {}) {
  return withComputedHash({
    providerLinkLifecycleSchemaVersion: 1,
    commandType: 'set_consent',
    commandId: 'cmd_consent_001',
    commandPayloadHash: 'sha256.consent.001',
    expectedRevision: 1,
    effectiveConsentDisposition: 'withdrawn',
    ...overrides,
  }, computedCommandHash);
}

function requestState(overrides = {}) {
  return withComputedHash({
    providerLinkLifecycleSchemaVersion: 1,
    commandType: 'request_state',
    commandId: 'cmd_request_001',
    commandPayloadHash: 'sha256.request.001',
    expectedRevision: 1,
    desiredState: 'linked',
    ...overrides,
  }, computedCommandHash);
}

function reconciliation(overrides = {}) {
  return withComputedHash({
    providerLinkLifecycleSchemaVersion: 1,
    commandType: 'record_reconciliation',
    commandId: 'cmd_reconcile_001',
    commandPayloadHash: 'sha256.reconcile.001',
    expectedRevision: 2,
    providerAccountRef: ACCOUNT_REF,
    reconciledDesiredState: 'linked',
    reconciliationSequence: 1,
    outcome: 'succeeded',
    attemptRef: 'attempt.001',
    observedState: 'linked',
    boundMembershipId: MEMBERSHIP_ID,
    errorCode: 'none',
    ...overrides,
  }, computedCommandHash);
}

function replaceAccount(overrides = {}) {
  return withComputedHash({
    providerLinkLifecycleSchemaVersion: 1,
    commandType: 'replace_provider_account',
    commandId: 'cmd_replace_001',
    commandPayloadHash: 'sha256.replace.001',
    expectedRevision: 2,
    providerAccountRef: NEW_ACCOUNT_REF,
    ...overrides,
  }, computedCommandHash);
}

function createRecord(overrides = {}) {
  return createProviderLinkLifecycle(createInput(overrides));
}

function linkedRecord() {
  const requested = applyProviderLinkLifecycleCommand(createRecord(), requestState());
  return applyProviderLinkLifecycleCommand(requested, reconciliation());
}

function observedUnlinkedRecord() {
  return applyProviderLinkLifecycleCommand(createRecord(), reconciliation({
    commandId: 'cmd_observe_unlinked_001',
    commandPayloadHash: 'sha256.observe.unlinked.001',
    expectedRevision: 1,
    reconciledDesiredState: 'unlinked',
    observedState: 'unlinked',
    boundMembershipId: null,
  }));
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
  expect(error).toBeInstanceOf(MembershipProviderLinkLifecycleError);
  expect(error).toMatchObject({
    name: 'MembershipProviderLinkLifecycleError',
    code: 'invalid_membership_provider_link_lifecycle',
    message: 'Membership provider link lifecycle input is invalid.',
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

function matrixRecord({
  provider,
  effectiveConsentDisposition,
  desiredState,
  observedState,
  boundMembershipId,
}) {
  const known = observedState !== 'unknown';
  const revision = known && desiredState !== observedState ? 3 : 2;
  return {
    providerLinkLifecycleSchemaVersion: 1,
    provider,
    membershipId: MEMBERSHIP_ID,
    providerAccountRef: ACCOUNT_REF,
    effectiveConsentDisposition,
    desiredState,
    observedState,
    boundMembershipId,
    revision,
    lastReconciliation: {
      sequence: 1,
      outcome: known ? 'succeeded' : 'outcome_unknown',
      attemptRef: 'attempt.matrix.001',
      errorCode: known ? 'none' : 'provider_outcome_unknown',
    },
    lastCommand: {
      commandId: 'cmd_matrix_001',
      commandPayloadHash: 'a'.repeat(64),
      expectedRevision: revision - 1,
    },
    grantsAuthority: false,
  };
}

describe('versioned provider-link lifecycle record', () => {
  test.each(['email_password', 'google', 'whatsapp', 'strava'])(
    'creates a frozen, non-authoritative %s record without inventing provider truth',
    (provider) => {
      const input = createInput({ provider });
      const before = JSON.stringify(input);
      const record = createProviderLinkLifecycle(input);

      expect(Object.keys(record)).toEqual(RECORD_KEYS);
      expect(record).toEqual({
        providerLinkLifecycleSchemaVersion: 1,
        provider,
        membershipId: MEMBERSHIP_ID,
        providerAccountRef: ACCOUNT_REF,
        effectiveConsentDisposition: 'active',
        desiredState: 'unlinked',
        observedState: 'unknown',
        boundMembershipId: null,
        revision: 1,
        lastReconciliation: {
          sequence: 0,
          outcome: 'not_attempted',
          attemptRef: null,
          errorCode: 'none',
        },
        lastCommand: {
          commandId: 'cmd_create_001',
          commandPayloadHash: createInput({ provider }).commandPayloadHash,
          expectedRevision: 0,
        },
        grantsAuthority: false,
      });
      expectDeepFrozen(record);
      expect(JSON.stringify(input)).toBe(before);
      expect(deriveProviderLinkLifecycleVerdict(record)).toMatchObject({
        disposition: 'observation_pending',
        grantsAuthority: false,
      });
    },
  );

  test('exports one frozen versioned surface and exact closed vocabularies', () => {
    const api = require('./membershipProviderLinkLifecycle');
    expect(providerLinkLifecycleSchemaVersion).toBe(1);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(MEMBERSHIP_PROVIDER_LINK_LIFECYCLE_ENUMS)).toBe(true);
    for (const values of Object.values(MEMBERSHIP_PROVIDER_LINK_LIFECYCLE_ENUMS)) {
      expect(Object.isFrozen(values)).toBe(true);
    }
    expect(MEMBERSHIP_PROVIDER_LINK_LIFECYCLE_ENUMS.provider).toEqual([
      'email_password', 'google', 'whatsapp', 'strava',
    ]);
    expect(MEMBERSHIP_PROVIDER_LINK_LIFECYCLE_ENUMS.reconciliationErrorCode).toEqual([
      'none', 'provider_definitive_failure', 'provider_outcome_unknown',
    ]);
    expect(Object.isFrozen(MembershipProviderLinkLifecycleError)).toBe(true);
    expect(Object.isFrozen(MembershipProviderLinkLifecycleError.prototype)).toBe(true);
  });
});

describe('composition with the reviewed reconciliation classifier', () => {
  test('matches #367 for every provider, consent, desired, observation, and binding shape', () => {
    const consentMap = {
      active: 'granted',
      reaffirmation_required: 'unknown',
      withdrawn: 'withdrawn',
      not_consented: 'unknown',
    };
    let count = 0;

    for (const provider of MEMBERSHIP_PROVIDER_LINK_LIFECYCLE_ENUMS.provider) {
      for (const effectiveConsentDisposition of
        MEMBERSHIP_PROVIDER_LINK_LIFECYCLE_ENUMS.effectiveConsentDisposition) {
        for (const desiredState of ['linked', 'unlinked']) {
          for (const observedState of ['linked', 'unlinked', 'unknown']) {
            const bounds = observedState === 'linked'
              ? [null, MEMBERSHIP_ID, OTHER_MEMBERSHIP_ID]
              : [null];
            for (const boundMembershipId of bounds) {
              const record = matrixRecord({
                provider,
                effectiveConsentDisposition,
                desiredState,
                observedState,
                boundMembershipId,
              });
              const expected = classifyProviderLinkReconciliation({
                providerLinkSchemaVersion,
                provider,
                membershipId: MEMBERSHIP_ID,
                providerAccountRef: ACCOUNT_REF,
                consent: consentMap[effectiveConsentDisposition],
                desiredState,
                observedState,
                boundMembershipId,
              });
              const actual = deriveProviderLinkLifecycleVerdict(record);

              expect(Object.keys(actual)).toEqual([
                'providerLinkLifecycleSchemaVersion',
                'disposition',
                'reason',
                'grantsAuthority',
              ]);
              expect(actual).toEqual({
                providerLinkLifecycleSchemaVersion: 1,
                disposition: expected.disposition,
                reason: expected.reason,
                grantsAuthority: false,
              });
              expect(Object.isFrozen(actual)).toBe(true);
              count += 1;
            }
          }
        }
      }
    }
    expect(count).toBe(160);
  });

  test.each(['reaffirmation_required', 'withdrawn', 'not_consented'])(
    'blocks a link intent with %s consent without changing provider truth',
    (effectiveConsentDisposition) => {
      const initial = createRecord({ effectiveConsentDisposition });
      const requested = applyProviderLinkLifecycleCommand(initial, requestState());
      expect(requested.desiredState).toBe('linked');
      expect(requested.observedState).toBe('unknown');
      expect(deriveProviderLinkLifecycleVerdict(requested)).toMatchObject({
        disposition: 'blocked',
        reason: 'consent_required',
        grantsAuthority: false,
      });
    },
  );

  test('consent withdrawal does not invent an unlink command or authority', () => {
    const requested = applyProviderLinkLifecycleCommand(createRecord(), requestState());
    const withdrawn = applyProviderLinkLifecycleCommand(requested, setConsent({
      expectedRevision: 2,
    }));
    expect(withdrawn.desiredState).toBe('linked');
    expect(withdrawn.observedState).toBe('unknown');
    expect(deriveProviderLinkLifecycleVerdict(withdrawn)).toEqual({
      providerLinkLifecycleSchemaVersion: 1,
      disposition: 'blocked',
      reason: 'consent_required',
      grantsAuthority: false,
    });
  });
});

describe('ordered link, unlink, relink, and replacement transitions', () => {
  test('links, unlinks, and relinks the same account deterministically', () => {
    const initial = createRecord();
    const linkRequested = applyProviderLinkLifecycleCommand(initial, requestState());
    expect(linkRequested.revision).toBe(2);
    expect(deriveProviderLinkLifecycleVerdict(linkRequested).disposition)
      .toBe('observation_pending');

    const linked = applyProviderLinkLifecycleCommand(linkRequested, reconciliation());
    expect(linked.revision).toBe(3);
    expect(linked.lastReconciliation.sequence).toBe(1);
    expect(deriveProviderLinkLifecycleVerdict(linked).disposition).toBe('aligned');

    const unlinkRequested = applyProviderLinkLifecycleCommand(linked, requestState({
      commandId: 'cmd_unlink_001',
      commandPayloadHash: 'sha256.unlink.001',
      expectedRevision: 3,
      desiredState: 'unlinked',
    }));
    expect(unlinkRequested.revision).toBe(4);
    expect(deriveProviderLinkLifecycleVerdict(unlinkRequested).disposition)
      .toBe('reconcile_unlink');

    const unlinked = applyProviderLinkLifecycleCommand(unlinkRequested, reconciliation({
      commandId: 'cmd_reconcile_unlink_001',
      commandPayloadHash: 'sha256.reconcile.unlink.001',
      expectedRevision: 4,
      reconciledDesiredState: 'unlinked',
      reconciliationSequence: 2,
      attemptRef: 'attempt.002',
      observedState: 'unlinked',
      boundMembershipId: null,
    }));
    expect(unlinked.revision).toBe(5);
    expect(deriveProviderLinkLifecycleVerdict(unlinked).disposition).toBe('aligned');

    const relinkRequested = applyProviderLinkLifecycleCommand(unlinked, requestState({
      commandId: 'cmd_relink_001',
      commandPayloadHash: 'sha256.relink.001',
      expectedRevision: 5,
    }));
    expect(relinkRequested.revision).toBe(6);
    expect(deriveProviderLinkLifecycleVerdict(relinkRequested).disposition)
      .toBe('reconcile_link');

    const relinked = applyProviderLinkLifecycleCommand(relinkRequested, reconciliation({
      commandId: 'cmd_reconcile_relink_001',
      commandPayloadHash: 'sha256.reconcile.relink.001',
      expectedRevision: 6,
      reconciliationSequence: 3,
      attemptRef: 'attempt.003',
    }));
    expect(relinked.revision).toBe(7);
    expect(relinked.lastReconciliation.sequence).toBe(3);
    expect(deriveProviderLinkLifecycleVerdict(relinked).disposition).toBe('aligned');
    expectDeepFrozen(relinked);
  });

  test('retains a foreign binding as collision evidence without granting authority', () => {
    const requested = applyProviderLinkLifecycleCommand(createRecord(), requestState());
    const collision = applyProviderLinkLifecycleCommand(requested, reconciliation({
      boundMembershipId: OTHER_MEMBERSHIP_ID,
    }));
    expect(collision.boundMembershipId).toBe(OTHER_MEMBERSHIP_ID);
    expect(deriveProviderLinkLifecycleVerdict(collision)).toEqual({
      providerLinkLifecycleSchemaVersion: 1,
      disposition: 'collision',
      reason: 'provider_account_linked_elsewhere',
      grantsAuthority: false,
    });
  });

  test('replaces an account only after confirmed unlink and resets provider observation', () => {
    const unlinked = observedUnlinkedRecord();
    const replacement = applyProviderLinkLifecycleCommand(unlinked, replaceAccount());

    expect(replacement).toMatchObject({
      provider: 'google',
      membershipId: MEMBERSHIP_ID,
      providerAccountRef: NEW_ACCOUNT_REF,
      effectiveConsentDisposition: 'active',
      desiredState: 'unlinked',
      observedState: 'unknown',
      boundMembershipId: null,
      revision: 3,
      lastReconciliation: {
        sequence: 0,
        outcome: 'not_attempted',
        attemptRef: null,
        errorCode: 'none',
      },
      grantsAuthority: false,
    });
    expectDeepFrozen(replacement);

    expectSafeError(() => applyProviderLinkLifecycleCommand(replacement, reconciliation({
      commandId: 'cmd_old_account_result_001',
      commandPayloadHash: 'sha256.old.account.result.001',
      expectedRevision: 3,
      reconciledDesiredState: 'unlinked',
      providerAccountRef: ACCOUNT_REF,
      observedState: 'unlinked',
      boundMembershipId: null,
    })));
  });

  test('rejects replacement while unknown, linked, desired-linked, or unchanged', () => {
    expectSafeError(() => applyProviderLinkLifecycleCommand(createRecord(), replaceAccount({
      expectedRevision: 1,
    })));
    expectSafeError(() => applyProviderLinkLifecycleCommand(linkedRecord(), replaceAccount({
      expectedRevision: 3,
    })));
    const unlinked = observedUnlinkedRecord();
    const desiredLinked = applyProviderLinkLifecycleCommand(unlinked, requestState({
      expectedRevision: 2,
    }));
    expectSafeError(() => applyProviderLinkLifecycleCommand(desiredLinked, replaceAccount({
      expectedRevision: 3,
    })));
    expectSafeError(() => applyProviderLinkLifecycleCommand(unlinked, replaceAccount({
      providerAccountRef: ACCOUNT_REF,
    })));
  });

  test('invalidates a confirmed-unlinked observation when unresolved link intent is reversed', () => {
    const unlinked = observedUnlinkedRecord();
    const linkRequested = applyProviderLinkLifecycleCommand(unlinked, requestState({
      expectedRevision: 2,
    }));
    expect(deriveProviderLinkLifecycleVerdict(linkRequested).disposition).toBe('reconcile_link');

    const cancelled = applyProviderLinkLifecycleCommand(linkRequested, requestState({
      commandId: 'cmd_cancel_link_001',
      expectedRevision: 3,
      desiredState: 'unlinked',
    }));
    expect(cancelled.desiredState).toBe('unlinked');
    expect(cancelled.observedState).toBe('unknown');
    expect(cancelled.boundMembershipId).toBeNull();
    expect(deriveProviderLinkLifecycleVerdict(cancelled).disposition)
      .toBe('observation_pending');
    expectSafeError(() => applyProviderLinkLifecycleCommand(cancelled, replaceAccount({
      expectedRevision: 4,
    })));

    const reconfirmed = applyProviderLinkLifecycleCommand(cancelled, reconciliation({
      commandId: 'cmd_reconcile_cancelled_link_001',
      expectedRevision: 4,
      reconciledDesiredState: 'unlinked',
      reconciliationSequence: 2,
      attemptRef: 'attempt.cancelled.link.002',
      observedState: 'unlinked',
      boundMembershipId: null,
    }));
    expect(applyProviderLinkLifecycleCommand(reconfirmed, replaceAccount({
      expectedRevision: 5,
    })).providerAccountRef).toBe(NEW_ACCOUNT_REF);
  });

  test('invalidates a confirmed-linked observation when unresolved unlink intent is reversed', () => {
    const unlinkRequested = applyProviderLinkLifecycleCommand(linkedRecord(), requestState({
      commandId: 'cmd_unlink_then_reverse_001',
      expectedRevision: 3,
      desiredState: 'unlinked',
    }));
    const relinkRequested = applyProviderLinkLifecycleCommand(unlinkRequested, requestState({
      commandId: 'cmd_reverse_unlink_001',
      expectedRevision: 4,
      desiredState: 'linked',
    }));

    expect(relinkRequested.desiredState).toBe('linked');
    expect(relinkRequested.observedState).toBe('unknown');
    expect(relinkRequested.boundMembershipId).toBeNull();
    expect(deriveProviderLinkLifecycleVerdict(relinkRequested).disposition)
      .toBe('observation_pending');
    expectSafeError(() => applyProviderLinkLifecycleCommand(relinkRequested, reconciliation({
      commandId: 'cmd_late_unlink_result_001',
      expectedRevision: 5,
      reconciledDesiredState: 'unlinked',
      reconciliationSequence: 2,
      attemptRef: 'attempt.late.unlink.002',
      observedState: 'unlinked',
      boundMembershipId: null,
    })));
  });
});

describe('partial and uncertain reconciliation outcomes', () => {
  function unlinkRequestedRecord() {
    return applyProviderLinkLifecycleCommand(linkedRecord(), requestState({
      commandId: 'cmd_unlink_partial_001',
      commandPayloadHash: 'sha256.unlink.partial.001',
      expectedRevision: 3,
      desiredState: 'unlinked',
    }));
  }

  test('a definitive failure records a fixed code and preserves known truth', () => {
    const requested = unlinkRequestedRecord();
    const beforeObservation = {
      observedState: requested.observedState,
      boundMembershipId: requested.boundMembershipId,
    };
    const failed = applyProviderLinkLifecycleCommand(requested, reconciliation({
      commandId: 'cmd_failure_001',
      commandPayloadHash: 'sha256.failure.001',
      expectedRevision: 4,
      reconciledDesiredState: 'unlinked',
      reconciliationSequence: 2,
      outcome: 'definitive_failure',
      attemptRef: 'attempt.failure.002',
      observedState: null,
      boundMembershipId: null,
      errorCode: 'provider_definitive_failure',
    }));

    expect(failed.desiredState).toBe('unlinked');
    expect({
      observedState: failed.observedState,
      boundMembershipId: failed.boundMembershipId,
    }).toEqual(beforeObservation);
    expect(failed.lastReconciliation).toEqual({
      sequence: 2,
      outcome: 'definitive_failure',
      attemptRef: 'attempt.failure.002',
      errorCode: 'provider_definitive_failure',
    });
    expect(deriveProviderLinkLifecycleVerdict(failed).disposition).toBe('reconcile_unlink');
  });

  test('an unknown outcome preserves intent but invalidates provider observation', () => {
    const requested = unlinkRequestedRecord();
    const unknown = applyProviderLinkLifecycleCommand(requested, reconciliation({
      commandId: 'cmd_unknown_001',
      commandPayloadHash: 'sha256.unknown.001',
      expectedRevision: 4,
      reconciledDesiredState: 'unlinked',
      reconciliationSequence: 2,
      outcome: 'outcome_unknown',
      attemptRef: 'attempt.unknown.002',
      observedState: null,
      boundMembershipId: null,
      errorCode: 'provider_outcome_unknown',
    }));

    expect(unknown.desiredState).toBe('unlinked');
    expect(unknown.observedState).toBe('unknown');
    expect(unknown.boundMembershipId).toBeNull();
    expect(deriveProviderLinkLifecycleVerdict(unknown).disposition)
      .toBe('observation_pending');
    expectSafeError(() => applyProviderLinkLifecycleCommand(unknown, replaceAccount({
      expectedRevision: 5,
    })));

    const confirmed = applyProviderLinkLifecycleCommand(unknown, reconciliation({
      commandId: 'cmd_confirm_after_unknown_001',
      commandPayloadHash: 'sha256.confirm.after.unknown.001',
      expectedRevision: 5,
      reconciledDesiredState: 'unlinked',
      reconciliationSequence: 3,
      attemptRef: 'attempt.confirm.003',
      observedState: 'unlinked',
      boundMembershipId: null,
    }));
    expect(confirmed.observedState).toBe('unlinked');
    expect(applyProviderLinkLifecycleCommand(confirmed, replaceAccount({
      expectedRevision: 6,
    })).providerAccountRef).toBe(NEW_ACCOUNT_REF);
  });

  test.each([
    ['success with an error', { errorCode: 'provider_definitive_failure' }],
    ['success with unknown observation', { observedState: 'unknown' }],
    ['unlinked success with a binding', {
      reconciledDesiredState: 'unlinked', observedState: 'unlinked',
      boundMembershipId: MEMBERSHIP_ID,
    }],
    ['failure with observation data', {
      outcome: 'definitive_failure', observedState: 'linked',
      errorCode: 'provider_definitive_failure',
    }],
    ['failure with the wrong fixed code', {
      outcome: 'definitive_failure', observedState: null,
      boundMembershipId: null, errorCode: 'provider_outcome_unknown',
    }],
    ['unknown with the wrong fixed code', {
      outcome: 'outcome_unknown', observedState: null,
      boundMembershipId: null, errorCode: 'provider_definitive_failure',
    }],
    ['not attempted as a command outcome', {
      outcome: 'not_attempted', observedState: null, boundMembershipId: null,
    }],
  ])('rejects %s', (_name, overrides) => {
    const requested = applyProviderLinkLifecycleCommand(createRecord(), requestState());
    expectSafeError(() => applyProviderLinkLifecycleCommand(
      requested,
      reconciliation(overrides),
    ));
  });
});

describe('idempotency, optimistic revision, and ordering', () => {
  test('makes an exact latest retry read-only and canonicalizes a mutable clone', () => {
    const initial = createRecord();
    const command = requestState();
    const requested = applyProviderLinkLifecycleCommand(initial, command);
    const before = JSON.stringify(requested);

    expect(applyProviderLinkLifecycleCommand(requested, command)).toBe(requested);
    expect(requested.revision).toBe(2);
    expect(JSON.stringify(requested)).toBe(before);

    const mutableClone = JSON.parse(JSON.stringify(requested));
    const retried = applyProviderLinkLifecycleCommand(mutableClone, command);
    expect(retried).not.toBe(mutableClone);
    expect(retried).toEqual(requested);
    expectDeepFrozen(retried);
  });

  test('rejects changed command reuse, stale/future revisions, and no-op commands', () => {
    const initial = createRecord();
    const command = requestState();
    const requested = applyProviderLinkLifecycleCommand(initial, command);

    expectSafeError(() => applyProviderLinkLifecycleCommand(requested, requestState({
      commandPayloadHash: '0'.repeat(64),
    })));
    expectSafeError(() => applyProviderLinkLifecycleCommand(requested, requestState({
      desiredState: 'unlinked',
    })));
    expectSafeError(() => applyProviderLinkLifecycleCommand(requested, setConsent({
      commandId: command.commandId,
      expectedRevision: command.expectedRevision,
    })));
    expectSafeError(() => applyProviderLinkLifecycleCommand(requested, requestState({
      expectedRevision: 2,
    })));
    expectSafeError(() => applyProviderLinkLifecycleCommand(initial, requestState({
      commandId: 'cmd_stale_001', expectedRevision: 0,
    })));
    expectSafeError(() => applyProviderLinkLifecycleCommand(initial, requestState({
      commandId: 'cmd_future_001', expectedRevision: 2,
    })));
    expectSafeError(() => applyProviderLinkLifecycleCommand(initial, requestState({
      commandId: 'cmd_noop_state_001', desiredState: 'unlinked',
    })));
    expectSafeError(() => applyProviderLinkLifecycleCommand(initial, setConsent({
      commandId: 'cmd_noop_consent_001',
      effectiveConsentDisposition: 'active',
    })));
  });

  test('rejects repeated, skipped, stale, wrong-account, and out-of-order results', () => {
    const requested = applyProviderLinkLifecycleCommand(createRecord(), requestState());
    const linked = applyProviderLinkLifecycleCommand(requested, reconciliation());

    expectSafeError(() => applyProviderLinkLifecycleCommand(linked, reconciliation({
      commandId: 'cmd_repeat_sequence_001',
      commandPayloadHash: 'sha256.repeat.sequence.001',
      expectedRevision: 3,
    })));
    expectSafeError(() => applyProviderLinkLifecycleCommand(linked, reconciliation({
      commandId: 'cmd_skip_sequence_001',
      commandPayloadHash: 'sha256.skip.sequence.001',
      expectedRevision: 3,
      reconciliationSequence: 3,
    })));
    expectSafeError(() => applyProviderLinkLifecycleCommand(linked, reconciliation({
      commandId: 'cmd_wrong_account_001',
      commandPayloadHash: 'sha256.wrong.account.001',
      expectedRevision: 3,
      reconciliationSequence: 2,
      providerAccountRef: NEW_ACCOUNT_REF,
    })));

    const unlinkRequested = applyProviderLinkLifecycleCommand(linked, requestState({
      commandId: 'cmd_unlink_order_001',
      commandPayloadHash: 'sha256.unlink.order.001',
      expectedRevision: 3,
      desiredState: 'unlinked',
    }));
    expectSafeError(() => applyProviderLinkLifecycleCommand(unlinkRequested, reconciliation({
      commandId: 'cmd_stale_link_result_001',
      commandPayloadHash: 'sha256.stale.link.result.001',
      expectedRevision: 4,
      reconciliationSequence: 2,
      reconciledDesiredState: 'linked',
    })));
    expectSafeError(() => applyProviderLinkLifecycleCommand(unlinkRequested, reconciliation({
      commandId: 'cmd_opposite_success_001',
      commandPayloadHash: 'sha256.opposite.success.001',
      expectedRevision: 4,
      reconciliationSequence: 2,
      reconciledDesiredState: 'unlinked',
      observedState: 'linked',
    })));
    expectSafeError(() => applyProviderLinkLifecycleCommand(unlinkRequested, reconciliation({
      commandId: 'cmd_old_revision_result_001',
      commandPayloadHash: 'sha256.old.revision.result.001',
      expectedRevision: 3,
      reconciliationSequence: 2,
      reconciledDesiredState: 'unlinked',
      observedState: 'unlinked',
      boundMembershipId: null,
    })));
  });

  test('fails before a safe-integer record revision can overflow', () => {
    const maxRecord = {
      ...createRecord(),
      revision: Number.MAX_SAFE_INTEGER,
      lastCommand: {
        commandId: 'cmd_before_max_001',
        commandPayloadHash: 'b'.repeat(64),
        expectedRevision: Number.MAX_SAFE_INTEGER - 1,
      },
    };
    expectSafeError(() => applyProviderLinkLifecycleCommand(maxRecord, requestState({
      commandId: 'cmd_at_max_001',
      commandPayloadHash: 'sha256.at.max.001',
      expectedRevision: Number.MAX_SAFE_INTEGER,
    })));
  });
});

describe('strict non-identifying boundary', () => {
  test.each([undefined, null, true, 1, 'link', [], new Date(0), new Number(1)])(
    'rejects non-plain creation input case %#',
    (input) => {
      expectSafeError(() => createProviderLinkLifecycle(input));
    },
  );

  test('rejects missing, extra, symbol, inherited, non-enumerable, accessor, and proxy fields', () => {
    for (const field of Object.keys(createInput())) {
      const input = createInput();
      delete input[field];
      expectSafeError(() => createProviderLinkLifecycle(input));
    }
    expectSafeError(() => createProviderLinkLifecycle({
      ...createInput(), rawProviderError: HOSTILE_CANARY,
    }));
    const symbolInput = createInput();
    symbolInput[Symbol(HOSTILE_CANARY)] = true;
    expectSafeError(() => createProviderLinkLifecycle(symbolInput));
    expectSafeError(() => createProviderLinkLifecycle(Object.assign(
      Object.create({ email: HOSTILE_CANARY }),
      createInput(),
    )));

    const nonEnumerable = createInput();
    Object.defineProperty(nonEnumerable, 'providerAccountRef', {
      value: ACCOUNT_REF,
      enumerable: false,
    });
    expectSafeError(() => createProviderLinkLifecycle(nonEnumerable));

    let invoked = false;
    const accessor = createInput();
    Object.defineProperty(accessor, 'providerAccountRef', {
      enumerable: true,
      get() {
        invoked = true;
        return HOSTILE_CANARY;
      },
    });
    expectSafeError(() => createProviderLinkLifecycle(accessor));
    expect(invoked).toBe(false);
    expectSafeError(() => createProviderLinkLifecycle(new Proxy(createInput(), {})));
    expectSafeError(() => applyProviderLinkLifecycleCommand(
      createRecord(),
      new Proxy(requestState(), {}),
    ));
  });

  test.each([
    'private-member@example.test',
    '+12025550445',
    '12025550445',
    'ya29.a0AfH6SMBprivateToken',
    'PrivateRunner',
    'provider_definitive_failure',
    'https://example.test/account',
    'account/with/path',
    'account with spaces',
    'éxternal',
    '',
    '.leading',
    'a'.repeat(129),
  ])('rejects non-opaque identifier %p', (value) => {
    expectSafeError(() => createProviderLinkLifecycle(createInput({
      providerAccountRef: value,
    })), value);
    expectSafeError(() => createProviderLinkLifecycle(createInput({
      membershipId: value,
    })), value);
    expectSafeError(() => createProviderLinkLifecycle(createInput({
      commandId: value,
    })), value);
    expectSafeError(() => createProviderLinkLifecycle(createInput({
      commandPayloadHash: value,
    })), value);
  });

  test('rejects a well-shaped but incorrect caller-supplied payload hash', () => {
    expectSafeError(() => createProviderLinkLifecycle(createInput({
      commandPayloadHash: '0'.repeat(64),
    })));
    const initial = createRecord();
    expectSafeError(() => applyProviderLinkLifecycleCommand(initial, requestState({
      commandPayloadHash: 'f'.repeat(64),
    })));
  });

  test('rejects raw phone, token, and error values as reconciliation attempt references', () => {
    const requested = applyProviderLinkLifecycleCommand(createRecord(), requestState());
    for (const attemptRef of [
      '12025550445',
      'ya29.a0AfH6SMBprivateToken',
      'provider_definitive_failure',
    ]) {
      expectSafeError(() => applyProviderLinkLifecycleCommand(
        requested,
        reconciliation({ attemptRef }),
      ), attemptRef);
    }
  });

  test('rejects malformed enums, numbers, outcome fields, and forged snapshots', () => {
    expectSafeError(() => createProviderLinkLifecycle(createInput({
      providerLinkLifecycleSchemaVersion: 2,
    })));
    expectSafeError(() => createProviderLinkLifecycle(createInput({ provider: 'facebook' })));
    expectSafeError(() => createProviderLinkLifecycle(createInput({
      effectiveConsentDisposition: 'maybe',
    })));
    for (const expectedRevision of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expectSafeError(() => applyProviderLinkLifecycleCommand(createRecord(), requestState({
        expectedRevision,
      })));
    }

    const valid = JSON.parse(JSON.stringify(linkedRecord()));
    const forgedAuthority = { ...valid, grantsAuthority: true };
    expectSafeError(() => deriveProviderLinkLifecycleVerdict(forgedAuthority));
    const forgedRevision = {
      ...valid,
      lastCommand: { ...valid.lastCommand, expectedRevision: valid.revision },
    };
    expectSafeError(() => deriveProviderLinkLifecycleVerdict(forgedRevision));
    const forgedUnknownBinding = {
      ...createRecord(),
      boundMembershipId: OTHER_MEMBERSHIP_ID,
    };
    expectSafeError(() => deriveProviderLinkLifecycleVerdict(forgedUnknownBinding));
    const forgedSequence = {
      ...valid,
      lastReconciliation: { ...valid.lastReconciliation, sequence: valid.revision },
    };
    expectSafeError(() => deriveProviderLinkLifecycleVerdict(forgedSequence));
    const forgedCreation = {
      ...createRecord(),
      desiredState: 'linked',
    };
    expectSafeError(() => deriveProviderLinkLifecycleVerdict(forgedCreation));
  });

  test('rejects hostile nested record shapes without invoking or echoing them', () => {
    const valid = JSON.parse(JSON.stringify(linkedRecord()));
    const extra = {
      ...valid,
      lastReconciliation: {
        ...valid.lastReconciliation,
        responseBody: HOSTILE_CANARY,
      },
    };
    expectSafeError(() => deriveProviderLinkLifecycleVerdict(extra));

    let invoked = false;
    const accessor = { ...valid.lastCommand };
    Object.defineProperty(accessor, 'commandPayloadHash', {
      enumerable: true,
      get() {
        invoked = true;
        return HOSTILE_CANARY;
      },
    });
    expectSafeError(() => deriveProviderLinkLifecycleVerdict({
      ...valid,
      lastCommand: accessor,
    }));
    expect(invoked).toBe(false);
    expectSafeError(() => deriveProviderLinkLifecycleVerdict({
      ...valid,
      lastReconciliation: new Proxy(valid.lastReconciliation, {}),
    }));
  });

  test('does not mutate caller records or commands on success or failure', () => {
    const record = JSON.parse(JSON.stringify(createRecord()));
    const command = requestState();
    const before = JSON.stringify({ record, command });
    applyProviderLinkLifecycleCommand(record, command);
    expect(JSON.stringify({ record, command })).toBe(before);

    const bad = requestState({ desiredState: HOSTILE_CANARY });
    const badBefore = JSON.stringify({ record, bad });
    expectSafeError(() => applyProviderLinkLifecycleCommand(record, bad));
    expect(JSON.stringify({ record, bad })).toBe(badBefore);
  });

  test('the fixed frozen error carries no enumerable caller data', () => {
    const error = new MembershipProviderLinkLifecycleError();
    expect(Object.keys(error)).toEqual([]);
    expect(JSON.stringify(error)).toBe('{}');
    expect(String(error)).not.toContain(HOSTILE_CANARY);
  });
});

describe('source isolation', () => {
  const filename = path.join(__dirname, 'membershipProviderLinkLifecycle.js');
  const source = fs.readFileSync(filename, 'utf8');

  test('requires only deterministic built-ins and the approved pure local classifier', () => {
    const requires = [...source.matchAll(/require\(([^)]+)\)/g)].map((match) => match[1]);
    expect(requires).toEqual([
      "'node:util'",
      "'node:crypto'",
      "'./membershipProviderLink'",
    ]);
    expect(source).toContain('classifyProviderLinkReconciliation({');
    expect(source).toContain("createHash('sha256')");
  });

  test('is imported by no runtime or Functions entrypoint', () => {
    const imports = fs.readdirSync(__dirname)
      .filter((entry) => entry.endsWith('.js'))
      .filter((entry) => !entry.endsWith('.test.js'))
      .filter((entry) => entry !== 'membershipProviderLinkLifecycle.js')
      .filter((entry) => fs.readFileSync(path.join(__dirname, entry), 'utf8')
        .includes("require('./membershipProviderLinkLifecycle')"));
    expect(imports).toEqual([]);
  });

  test('reads no clock, environment, randomness, network, service SDK, or logger', () => {
    for (const forbidden of [
      'process.env', 'Date.now', 'new Date', 'Math.random', 'randomBytes',
      'console.', 'logger', 'fetch(', 'https:', 'http:', 'firebase',
      'firestore', 'stripe', 'axios',
    ]) {
      expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  test('models no personal-data, raw-error, secret, role, price, or payment fields', () => {
    expect(source).not.toMatch(
      /phoneNumber|emailAddress|streetAddress|dateOfBirth|emergencyContact|rawError|responseBody/i,
    );
    expect(source).not.toMatch(
      /accessToken|refreshToken|clientSecret|apiKey|bearer|passwordHash|roleName|priceCents|paymentId/i,
    );
  });

  test('hard-codes the no-authority invariant in every public result', () => {
    expect(source.match(/grantsAuthority: false/g)).toHaveLength(2);
    expect(source).not.toContain('grantsAuthority: true');
  });
});
