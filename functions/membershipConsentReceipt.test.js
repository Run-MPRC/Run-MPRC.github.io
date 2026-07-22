'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  consentStateSchemaVersion,
  MEMBERSHIP_CONSENT_STATE_ENUMS,
  classifyConsentState,
} = require('./membershipConsentState');
const {
  membershipConsentReceiptSchemaVersion,
  MEMBERSHIP_CONSENT_RECEIPT_ENUMS,
  MembershipConsentReceiptError,
  createConsentReceiptTrack,
  appendConsentDecisionReceipt,
  deriveConsentStateFromReceiptTrack,
} = require('./membershipConsentReceipt');

const HOSTILE_CANARY = 'private-member@example.test/+12025550170?token=do-not-copy';

const IDS = Object.freeze({
  track: 'ctrk_11111111111111111111111111111111',
  otherTrack: 'ctrk_12121212121212121212121212121212',
  subject: 'subject.22222222222222222222222222222222',
  otherSubject: 'subject.23232323232323232323232323232323',
  scope: 'scope.33333333333333333333333333333333',
  otherScope: 'scope.34343434343434343434343434343434',
  command1: 'cmd_44444444444444444444444444444444',
  command2: 'cmd_55555555555555555555555555555555',
  command3: 'cmd_66666666666666666666666666666666',
  receipt1: 'crpt_77777777777777777777777777777777',
  receipt2: 'crpt_88888888888888888888888888888888',
  receipt3: 'crpt_99999999999999999999999999999999',
  policy1: 'policy.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  policy2: 'policy.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
});

const TRACK_KEYS = Object.freeze([
  'membershipConsentReceiptSchemaVersion',
  'trackId',
  'provider',
  'subjectRef',
  'scopeRef',
  'receiptRevision',
  'latestReceipt',
  'grantsAuthority',
]);

const RECEIPT_KEYS = Object.freeze([
  'membershipConsentReceiptSchemaVersion',
  'trackId',
  'provider',
  'subjectRef',
  'scopeRef',
  'receiptId',
  'priorReceiptId',
  'receiptRevision',
  'commandId',
  'decision',
  'policyVersion',
  'grantsAuthority',
]);

const RESULT_KEYS = Object.freeze([
  'membershipConsentReceiptSchemaVersion',
  'disposition',
  'track',
  'receipt',
  'grantsAuthority',
]);

function trackInput(overrides = {}) {
  return {
    membershipConsentReceiptSchemaVersion: 1,
    trackId: IDS.track,
    provider: 'google',
    subjectRef: IDS.subject,
    scopeRef: IDS.scope,
    ...overrides,
  };
}

function command(overrides = {}) {
  return {
    membershipConsentReceiptSchemaVersion: 1,
    commandType: 'record_consent_decision',
    trackId: IDS.track,
    provider: 'google',
    subjectRef: IDS.subject,
    scopeRef: IDS.scope,
    commandId: IDS.command1,
    receiptId: IDS.receipt1,
    expectedRevision: 0,
    expectedLatestReceiptId: null,
    decision: 'granted',
    policyVersion: IDS.policy1,
    ...overrides,
  };
}

function nextCommand(overrides = {}) {
  return command({
    commandId: IDS.command2,
    receiptId: IDS.receipt2,
    expectedRevision: 1,
    expectedLatestReceiptId: IDS.receipt1,
    decision: 'withdrawn',
    ...overrides,
  });
}

function requiredPolicy(overrides = {}) {
  return {
    membershipConsentReceiptSchemaVersion: 1,
    requiredPolicyVersion: IDS.policy1,
    ...overrides,
  };
}

function captureError(callback) {
  try {
    callback();
  } catch (err) {
    return err;
  }
  return null;
}

function expectRejected(callback) {
  const err = captureError(callback);
  expect(err).toBeInstanceOf(MembershipConsentReceiptError);
  expect(err.message).toBe('Membership consent receipt input is invalid.');
  expect(err.code).toBe('invalid_membership_consent_receipt');
  expect(Object.keys(err)).toEqual([]);
  expect(JSON.stringify(err)).toBe('{}');
  expect(String(err)).not.toContain(HOSTILE_CANARY);
  expect(err.stack).not.toContain(HOSTILE_CANARY);
  return err;
}

function expectFrozenRecord(value, keys) {
  expect(Object.isFrozen(value)).toBe(true);
  expect(Object.keys(value)).toEqual(keys);
  expect(value.grantsAuthority).toBe(false);
}

function appendSequence(provider = 'google') {
  const binding = { provider };
  const empty = createConsentReceiptTrack(trackInput(binding));
  const grant = appendConsentDecisionReceipt(empty, command(binding));
  const withdraw = appendConsentDecisionReceipt(grant.track, nextCommand(binding));
  const regrant = appendConsentDecisionReceipt(withdraw.track, command({
    ...binding,
    commandId: IDS.command3,
    receiptId: IDS.receipt3,
    expectedRevision: 2,
    expectedLatestReceiptId: IDS.receipt2,
    decision: 'granted',
    policyVersion: IDS.policy2,
  }));
  return { empty, grant, withdraw, regrant };
}

describe('append-oriented provider-neutral consent receipts', () => {
  test.each(MEMBERSHIP_CONSENT_STATE_ENUMS.provider)(
    'creates an empty %s track and appends the first grant',
    (provider) => {
      const empty = createConsentReceiptTrack(trackInput({ provider }));
      expectFrozenRecord(empty, TRACK_KEYS);
      expect(empty).toEqual({
        membershipConsentReceiptSchemaVersion: 1,
        trackId: IDS.track,
        provider,
        subjectRef: IDS.subject,
        scopeRef: IDS.scope,
        receiptRevision: 0,
        latestReceipt: null,
        grantsAuthority: false,
      });

      const result = appendConsentDecisionReceipt(empty, command({ provider }));
      expectFrozenRecord(result, RESULT_KEYS);
      expectFrozenRecord(result.track, TRACK_KEYS);
      expectFrozenRecord(result.receipt, RECEIPT_KEYS);
      expect(result.disposition).toBe('appended');
      expect(result.track.latestReceipt).toBe(result.receipt);
      expect(result.receipt).toEqual({
        membershipConsentReceiptSchemaVersion: 1,
        trackId: IDS.track,
        provider,
        subjectRef: IDS.subject,
        scopeRef: IDS.scope,
        receiptId: IDS.receipt1,
        priorReceiptId: null,
        receiptRevision: 1,
        commandId: IDS.command1,
        decision: 'granted',
        policyVersion: IDS.policy1,
        grantsAuthority: false,
      });
      expect(empty.receiptRevision).toBe(0);
      expect(empty.latestReceipt).toBeNull();
    },
  );

  test.each(MEMBERSHIP_CONSENT_STATE_ENUMS.provider)(
    'creates the first %s withdrawal without fabricating a grant',
    (provider) => {
      const empty = createConsentReceiptTrack(trackInput({ provider }));
      const result = appendConsentDecisionReceipt(empty, command({ provider, decision: 'withdrawn' }));
      expect(result.receipt.decision).toBe('withdrawn');
      expect(result.receipt.priorReceiptId).toBeNull();
      expect(result.track.latestReceipt).toBe(result.receipt);
      expect(result.grantsAuthority).toBe(false);
    },
  );

  test('appends grant, withdrawal, and re-grant without mutating prior values', () => {
    const { empty, grant, withdraw, regrant } = appendSequence();
    const before = JSON.stringify({ empty, grant, withdraw });

    expect(grant.receipt.receiptRevision).toBe(1);
    expect(grant.receipt.priorReceiptId).toBeNull();
    expect(withdraw.receipt.receiptRevision).toBe(2);
    expect(withdraw.receipt.priorReceiptId).toBe(IDS.receipt1);
    expect(regrant.receipt.receiptRevision).toBe(3);
    expect(regrant.receipt.priorReceiptId).toBe(IDS.receipt2);
    expect(grant.receipt.decision).toBe('granted');
    expect(withdraw.receipt.decision).toBe('withdrawn');
    expect(regrant.receipt.decision).toBe('granted');
    expect(regrant.receipt.policyVersion).toBe(IDS.policy2);
    expect(JSON.stringify({ empty, grant, withdraw })).toBe(before);

    for (const value of [empty, grant, grant.track, grant.receipt,
      withdraw, withdraw.track, withdraw.receipt, regrant, regrant.track, regrant.receipt]) {
      expect(Object.isFrozen(value)).toBe(true);
      expect(value.grantsAuthority).toBe(false);
    }
  });

  test('repeated decisions are fresh receipts rather than an invented policy no-op', () => {
    const empty = createConsentReceiptTrack(trackInput());
    const first = appendConsentDecisionReceipt(empty, command());
    const second = appendConsentDecisionReceipt(first.track, nextCommand({ decision: 'granted' }));
    expect(second.disposition).toBe('appended');
    expect(second.receipt.decision).toBe('granted');
    expect(second.receipt.receiptRevision).toBe(2);
  });
});

describe('composition with the real #370 consent-state classifier', () => {
  test('derives all four effective dispositions from the bounded latest head', () => {
    const empty = createConsentReceiptTrack(trackInput());
    const grant = appendConsentDecisionReceipt(empty, command());
    const withdraw = appendConsentDecisionReceipt(grant.track, nextCommand());
    const cases = [
      [empty, requiredPolicy(), 'not_consented', 'no_decision_recorded'],
      [grant.track, requiredPolicy(), 'active', 'consent_current'],
      [grant.track, requiredPolicy({ requiredPolicyVersion: IDS.policy2 }),
        'reaffirmation_required', 'policy_version_superseded'],
      [withdraw.track, requiredPolicy({ requiredPolicyVersion: IDS.policy2 }),
        'withdrawn', 'consent_withdrawn'],
    ];

    for (const [track, policy, disposition, reason] of cases) {
      const derived = deriveConsentStateFromReceiptTrack(track, policy);
      expect(Object.isFrozen(derived)).toBe(true);
      expect(derived).toEqual(expect.objectContaining({
        consentStateSchemaVersion,
        disposition,
        reason,
        grantsAuthority: false,
      }));

      const direct = classifyConsentState({
        consentStateSchemaVersion,
        provider: track.provider,
        subjectRef: track.subjectRef,
        scopeRef: track.scopeRef,
        latestDecision: track.latestReceipt ? track.latestReceipt.decision : 'none',
        latestPolicyVersion: track.latestReceipt ? track.latestReceipt.policyVersion : null,
        requiredPolicyVersion: policy.requiredPolicyVersion,
      });
      expect(derived).toBe(direct);
    }
  });

  test.each(MEMBERSHIP_CONSENT_STATE_ENUMS.provider)(
    'uses one provider-neutral oracle for %s',
    (provider) => {
      const { grant, withdraw } = appendSequence(provider);
      expect(deriveConsentStateFromReceiptTrack(grant.track, requiredPolicy()).disposition)
        .toBe('active');
      expect(deriveConsentStateFromReceiptTrack(withdraw.track, requiredPolicy()).disposition)
        .toBe('withdrawn');
    },
  );

  test('policy versions are equality-only in both lexical directions', () => {
    const { grant, regrant } = appendSequence();
    expect(deriveConsentStateFromReceiptTrack(
      grant.track,
      requiredPolicy({ requiredPolicyVersion: IDS.policy2 }),
    ).disposition).toBe('reaffirmation_required');
    expect(deriveConsentStateFromReceiptTrack(
      regrant.track,
      requiredPolicy({ requiredPolicyVersion: IDS.policy1 }),
    ).disposition).toBe('reaffirmation_required');
    expect(deriveConsentStateFromReceiptTrack(
      regrant.track,
      requiredPolicy({ requiredPolicyVersion: IDS.policy2 }),
    ).disposition).toBe('active');
  });
});

describe('latest retry, exact track binding, and monotonic sequencing', () => {
  test('an exact latest retry is read-only and returns the original canonical identities', () => {
    const first = appendConsentDecisionReceipt(
      createConsentReceiptTrack(trackInput()),
      command(),
    );
    const retry = appendConsentDecisionReceipt(first.track, command());

    expect(retry.disposition).toBe('already_applied');
    expect(retry.track).toBe(first.track);
    expect(retry.receipt).toBe(first.receipt);
    expect(retry.track.receiptRevision).toBe(1);
    expectFrozenRecord(retry, RESULT_KEYS);
  });

  test('an unfrozen valid clone is canonicalized before retry identity is retained', () => {
    const first = appendConsentDecisionReceipt(
      createConsentReceiptTrack(trackInput()),
      command(),
    );
    const clone = JSON.parse(JSON.stringify(first.track));
    const retry = appendConsentDecisionReceipt(clone, command());

    expect(retry.disposition).toBe('already_applied');
    expect(retry.track).not.toBe(clone);
    expect(retry.track).toEqual(first.track);
    expect(retry.track.latestReceipt).toBe(retry.receipt);
    expect(Object.isFrozen(retry.track)).toBe(true);
    expect(Object.isFrozen(retry.receipt)).toBe(true);

    const secondRetry = appendConsentDecisionReceipt(retry.track, command());
    expect(secondRetry.track).toBe(retry.track);
    expect(secondRetry.receipt).toBe(retry.receipt);
  });

  test.each([
    ['track id', { trackId: IDS.otherTrack }],
    ['provider', { provider: 'strava' }],
    ['subject', { subjectRef: IDS.otherSubject }],
    ['scope', { scopeRef: IDS.otherScope }],
    ['receipt id', { receiptId: IDS.receipt2 }],
    ['expected revision', { expectedRevision: 1 }],
    ['negative-zero expected revision', { expectedRevision: -0 }],
    ['expected receipt', { expectedLatestReceiptId: IDS.receipt2 }],
    ['decision', { decision: 'withdrawn' }],
    ['policy version', { policyVersion: IDS.policy2 }],
  ])('rejects changed latest-command reuse: %s', (_label, patch) => {
    const first = appendConsentDecisionReceipt(
      createConsentReceiptTrack(trackInput()),
      command(),
    );
    expectRejected(() => appendConsentDecisionReceipt(first.track, command(patch)));
  });

  test.each([
    ['track id', { trackId: IDS.otherTrack }],
    ['provider', { provider: 'strava' }],
    ['subject', { subjectRef: IDS.otherSubject }],
    ['scope', { scopeRef: IDS.otherScope }],
  ])('rejects a new command copied onto another track: %s', (_label, patch) => {
    const empty = createConsentReceiptTrack(trackInput());
    expectRejected(() => appendConsentDecisionReceipt(empty, command(patch)));
  });

  test.each([
    ['stale', 0],
    ['future/skipped', 2],
    ['negative', -1],
    ['negative zero', -0],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects a %s revision for a new command', (_label, expectedRevision) => {
    const first = appendConsentDecisionReceipt(
      createConsentReceiptTrack(trackInput()),
      command(),
    );
    expectRejected(() => appendConsentDecisionReceipt(first.track, nextCommand({ expectedRevision })));
  });

  test('rejects a wrong expected latest receipt and current receipt-id reuse', () => {
    const first = appendConsentDecisionReceipt(
      createConsentReceiptTrack(trackInput()),
      command(),
    );
    expectRejected(() => appendConsentDecisionReceipt(first.track, nextCommand({
      expectedLatestReceiptId: null,
    })));
    expectRejected(() => appendConsentDecisionReceipt(first.track, nextCommand({
      receiptId: IDS.receipt1,
    })));
  });

  test('allows an exact latest retry at MAX_SAFE_INTEGER but rejects a new append', () => {
    const first = appendConsentDecisionReceipt(
      createConsentReceiptTrack(trackInput()),
      command(),
    );
    const latestReceipt = Object.freeze({
      ...first.receipt,
      priorReceiptId: IDS.receipt2,
      receiptRevision: Number.MAX_SAFE_INTEGER,
    });
    const exhausted = Object.freeze({
      ...first.track,
      receiptRevision: Number.MAX_SAFE_INTEGER,
      latestReceipt,
    });
    const exactLatest = command({
      expectedRevision: Number.MAX_SAFE_INTEGER - 1,
      expectedLatestReceiptId: IDS.receipt2,
    });
    expect(appendConsentDecisionReceipt(exhausted, exactLatest).disposition)
      .toBe('already_applied');
    expectRejected(() => appendConsentDecisionReceipt(exhausted, nextCommand({
      expectedRevision: Number.MAX_SAFE_INTEGER,
    })));
  });

  test('allows the exact final append from MAX_SAFE_INTEGER minus one', () => {
    const first = appendConsentDecisionReceipt(
      createConsentReceiptTrack(trackInput()),
      command(),
    );
    const latestReceipt = Object.freeze({
      ...first.receipt,
      priorReceiptId: IDS.receipt2,
      receiptRevision: Number.MAX_SAFE_INTEGER - 1,
    });
    const penultimate = Object.freeze({
      ...first.track,
      receiptRevision: Number.MAX_SAFE_INTEGER - 1,
      latestReceipt,
    });
    const result = appendConsentDecisionReceipt(penultimate, nextCommand({
      receiptId: IDS.receipt3,
      expectedRevision: Number.MAX_SAFE_INTEGER - 1,
    }));
    expect(result.disposition).toBe('appended');
    expect(result.track.receiptRevision).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.receipt.receiptRevision).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.receipt.priorReceiptId).toBe(IDS.receipt1);
  });
});

describe('malformed, incoherent, and hostile values fail closed without echo', () => {
  test.each([
    ['null', null], ['undefined', undefined], ['string', 'consent'],
    ['number', 1], ['array', []], ['date', new Date(0)],
    ['boxed string', new String('consent')], ['null-prototype', Object.create(null)],
  ])('rejects a %s create input', (_label, input) => {
    expectRejected(() => createConsentReceiptTrack(input));
  });

  test.each([
    ['trackId', HOSTILE_CANARY], ['trackId', 'ctrk_DaveLiu'],
    ['subjectRef', 'private-member@example.test'], ['subjectRef', 'subject.DaveLiu'],
    ['scopeRef', '+12025550170'], ['scopeRef', 'scope.whatsapp-messaging'],
    ['provider', 'facebook'],
  ])('rejects a malformed or identifying create field: %s', (field, value) => {
    expectRejected(() => createConsentReceiptTrack(trackInput({ [field]: value })));
  });

  test.each([
    ['commandType', 'capture_legal_consent'],
    ['commandId', HOSTILE_CANARY], ['commandId', 'cmd_DaveLiu'],
    ['receiptId', 'https://example.test/receipt'], ['receiptId', 'crpt_private_member'],
    ['decision', 'none'], ['decision', 'accepted'],
    ['policyVersion', 'I agree to receive club messages'], ['policyVersion', 'policy.DaveLiu'],
  ])('rejects a malformed or raw command field: %s', (field, value) => {
    const empty = createConsentReceiptTrack(trackInput());
    expectRejected(() => appendConsentDecisionReceipt(empty, command({ [field]: value })));
  });

  test('rejects wrong versions on every public input', () => {
    expectRejected(() => createConsentReceiptTrack(trackInput({
      membershipConsentReceiptSchemaVersion: 2,
    })));
    const empty = createConsentReceiptTrack(trackInput());
    expectRejected(() => appendConsentDecisionReceipt(empty, command({
      membershipConsentReceiptSchemaVersion: 2,
    })));
    expectRejected(() => deriveConsentStateFromReceiptTrack(empty, requiredPolicy({
      membershipConsentReceiptSchemaVersion: 2,
    })));
  });

  test.each([
    'policy.DaveLiu',
    'policy.short',
    'private-member@example.test',
    '+12025550170',
    'https://example.test/policy',
  ])('rejects a malformed required policy version: %s', (requiredPolicyVersion) => {
    const empty = createConsentReceiptTrack(trackInput());
    expectRejected(() => deriveConsentStateFromReceiptTrack(empty, requiredPolicy({
      requiredPolicyVersion,
    })));
  });

  test.each([
    ['authority flag', (track) => ({ ...track, grantsAuthority: true })],
    ['empty negative-zero revision', (track) => ({ ...track, receiptRevision: -0 })],
    ['empty nonzero revision', (track) => ({ ...track, receiptRevision: 1 })],
    ['empty fabricated latest', (track) => ({ ...track, latestReceipt: {} })],
    ['nonempty zero revision', (track) => ({ ...track, receiptRevision: 0 })],
    ['nested authority flag', (track) => ({
      ...track, latestReceipt: { ...track.latestReceipt, grantsAuthority: true },
    })],
    ['nested revision', (track) => ({
      ...track, latestReceipt: { ...track.latestReceipt, receiptRevision: 2 },
    })],
    ['nested provider', (track) => ({
      ...track, latestReceipt: { ...track.latestReceipt, provider: 'strava' },
    })],
    ['nested subject', (track) => ({
      ...track, latestReceipt: { ...track.latestReceipt, subjectRef: IDS.otherSubject },
    })],
    ['nested scope', (track) => ({
      ...track, latestReceipt: { ...track.latestReceipt, scopeRef: IDS.otherScope },
    })],
    ['first prior receipt', (track) => ({
      ...track, latestReceipt: { ...track.latestReceipt, priorReceiptId: IDS.receipt2 },
    })],
  ])('rejects an internally incoherent head: %s', (_label, mutate) => {
    const first = appendConsentDecisionReceipt(
      createConsentReceiptTrack(trackInput()),
      command(),
    );
    const base = _label.startsWith('empty') ? createConsentReceiptTrack(trackInput()) : first.track;
    expectRejected(() => deriveConsentStateFromReceiptTrack(mutate(base), requiredPolicy()));
  });

  test('rejects a later receipt with a missing or self-referential prior id', () => {
    const { withdraw } = appendSequence();
    for (const priorReceiptId of [null, IDS.receipt2]) {
      expectRejected(() => deriveConsentStateFromReceiptTrack({
        ...withdraw.track,
        latestReceipt: { ...withdraw.receipt, priorReceiptId },
      }, requiredPolicy()));
    }
  });

  test('rejects missing, extra, inherited, symbol, and non-enumerable fields', () => {
    const missing = trackInput();
    delete missing.scopeRef;
    expectRejected(() => createConsentReceiptTrack(missing));
    expectRejected(() => createConsentReceiptTrack({ ...trackInput(), extra: HOSTILE_CANARY }));
    expectRejected(() => createConsentReceiptTrack(Object.create(trackInput())));

    const symbol = trackInput();
    symbol[Symbol('private')] = HOSTILE_CANARY;
    expectRejected(() => createConsentReceiptTrack(symbol));

    const hidden = trackInput();
    Object.defineProperty(hidden, 'hidden', { value: HOSTILE_CANARY, enumerable: false });
    expectRejected(() => createConsentReceiptTrack(hidden));
  });

  test('rejects accessors and proxies without invoking their traps', () => {
    let getterCalls = 0;
    const accessor = trackInput();
    delete accessor.scopeRef;
    Object.defineProperty(accessor, 'scopeRef', {
      enumerable: true,
      get() { getterCalls += 1; return HOSTILE_CANARY; },
    });
    expectRejected(() => createConsentReceiptTrack(accessor));
    expect(getterCalls).toBe(0);

    let trapCalls = 0;
    const proxy = new Proxy(trackInput(), {
      get() { trapCalls += 1; return HOSTILE_CANARY; },
      ownKeys() { trapCalls += 1; return []; },
      getPrototypeOf() { trapCalls += 1; return Object.prototype; },
    });
    expectRejected(() => createConsentReceiptTrack(proxy));
    expect(trapCalls).toBe(0);

    const revocable = Proxy.revocable(trackInput(), {});
    revocable.revoke();
    expectRejected(() => createConsentReceiptTrack(revocable.proxy));
  });

  test('applies strict-object checks to commands, policy inputs, and nested receipts', () => {
    const empty = createConsentReceiptTrack(trackInput());
    expectRejected(() => appendConsentDecisionReceipt(empty, new Proxy(command(), {})));
    expectRejected(() => deriveConsentStateFromReceiptTrack(empty, Object.create(requiredPolicy())));

    const first = appendConsentDecisionReceipt(empty, command());
    expectRejected(() => deriveConsentStateFromReceiptTrack({
      ...first.track,
      latestReceipt: new Proxy(first.receipt, {}),
    }, requiredPolicy()));
  });

  test('never logs an offending value', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    expectRejected(() => createConsentReceiptTrack(trackInput({ trackId: HOSTILE_CANARY })));
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });
});

describe('frozen versioned surface and source boundary', () => {
  const sourcePath = path.join(__dirname, 'membershipConsentReceipt.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  test('exports one frozen provider-neutral versioned vocabulary', () => {
    expect(membershipConsentReceiptSchemaVersion).toBe(1);
    expect(Object.isFrozen(MEMBERSHIP_CONSENT_RECEIPT_ENUMS)).toBe(true);
    for (const values of Object.values(MEMBERSHIP_CONSENT_RECEIPT_ENUMS)) {
      expect(Object.isFrozen(values)).toBe(true);
    }
    expect(MEMBERSHIP_CONSENT_RECEIPT_ENUMS.provider)
      .toBe(MEMBERSHIP_CONSENT_STATE_ENUMS.provider);
    expect(MEMBERSHIP_CONSENT_RECEIPT_ENUMS.decision).toEqual(['granted', 'withdrawn']);
    expect(MEMBERSHIP_CONSENT_RECEIPT_ENUMS.disposition)
      .toEqual(['appended', 'already_applied']);
  });

  test('freezes its fixed non-echoing error type', () => {
    const err = new MembershipConsentReceiptError();
    expect(Object.isFrozen(err)).toBe(true);
    expect(Object.isFrozen(MembershipConsentReceiptError)).toBe(true);
    expect(Object.isFrozen(MembershipConsentReceiptError.prototype)).toBe(true);
  });

  test('is imported by no runtime entrypoint', () => {
    const visited = new Set();
    const pending = [path.join(__dirname, 'index.js')];

    while (pending.length > 0) {
      const file = pending.pop();
      if (visited.has(file)) continue;
      visited.add(file);
      const runtimeSource = fs.readFileSync(file, 'utf8');
      for (const match of runtimeSource.matchAll(
        /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
      )) {
        const requested = path.resolve(path.dirname(file), match[1]);
        const candidates = [requested, `${requested}.js`, path.join(requested, 'index.js')];
        const candidate = candidates.find((value) => fs.existsSync(value)
          && fs.statSync(value).isFile());
        if (candidate) pending.push(candidate);
      }
    }

    expect([...visited]).not.toContain(sourcePath);
    expect(visited.size).toBeGreaterThan(1);
  });

  test('requires only node:util and the shipped #370 classifier', () => {
    const requires = [...source.matchAll(/require\(([^)]+)\)/g)].map((match) => match[1]);
    expect(requires).toEqual(["'node:util'", "'./membershipConsentState'"]);
    expect(source).toContain('classifyConsentState');
  });

  test('has no clock, environment, randomness, network, Firebase, provider SDK, or logger edge', () => {
    for (const forbidden of [
      'process.env', 'Date.now', 'new Date', 'Math.random', 'randomUUID',
      'console.', 'fetch(', 'https:', 'http:', 'firebase', 'stripe', 'whatsapp',
      'receipts:', 'receipts =', 'receipts.push',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  test('models no personal-data, actor, notice, capture, or secret field', () => {
    expect(source).not.toMatch(
      /phoneNumber|emailAddress|streetAddress|dateOfBirth|emergencyContact|actorId/i,
    );
    expect(source).not.toMatch(
      /noticeText|policyText|capturedAt|recordedAt|captureMethod|legalBasis|retention/i,
    );
    expect(source).not.toMatch(/passwordHash|accessToken|refreshToken|clientSecret|apiKey|bearer/i);
  });

  test('hard-codes the no-authority invariant', () => {
    expect(source).toContain('grantsAuthority: false');
    expect(source).not.toContain('grantsAuthority: true');
  });
});
