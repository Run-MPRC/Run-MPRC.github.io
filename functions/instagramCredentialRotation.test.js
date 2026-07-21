'use strict';

const fs = require('fs');
const path = require('path');

const mod = require('./instagramCredentialRotation');
const {
  credentialRotationSchemaVersion,
  ValidationOutcome,
  RotationDecision,
  RotationGrantReason,
  RotationKeepReason,
  RotationDenialReason,
  classifyCredentialRotationPromotion,
} = mod;

// ---- fixtures ------------------------------------------------------------

// A provider account id is legitimately all-digits (that is how Instagram
// business accounts are identified); the contract must accept it.
const ACCOUNT = '17841400000000000';
const OTHER_ACCOUNT = '17849999999999999';

const VALIDATED_AT = '2026-07-21T12:00:00Z'; // candidate validation instant
const CURRENT_EXPIRY = '2026-09-01T00:00:00Z';
const LONGER_EXPIRY = '2026-12-01T00:00:00Z'; // strictly after CURRENT_EXPIRY
const SHORTER_EXPIRY = '2026-08-01T00:00:00Z'; // strictly before CURRENT_EXPIRY

function current(overrides = {}) {
  return {
    credentialRotationSchemaVersion: 1,
    credentialRef: 'cred.v1.aaa',
    accountRef: ACCOUNT,
    expiresAt: CURRENT_EXPIRY,
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    credentialRotationSchemaVersion: 1,
    credentialRef: 'cred.v2.bbb',
    accountRef: ACCOUNT,
    expiresAt: LONGER_EXPIRY,
    validationOutcome: 'valid',
    asOf: VALIDATED_AT,
    ...overrides,
  };
}

const codeOnly = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');

const rawSource = fs.readFileSync(path.join(__dirname, 'instagramCredentialRotation.js'), 'utf8');
const sourceCode = codeOnly(rawSource);

// ---- 1. frozen surface & enums ------------------------------------------

describe('frozen surface & enums', () => {
  test('schema version is 1', () => {
    expect(credentialRotationSchemaVersion).toBe(1);
  });

  test('module is frozen', () => {
    expect(Object.isFrozen(mod)).toBe(true);
  });

  test('classifyCredentialRotationPromotion is a function', () => {
    expect(typeof classifyCredentialRotationPromotion).toBe('function');
  });

  test('ValidationOutcome is complete and frozen', () => {
    expect(Object.isFrozen(ValidationOutcome)).toBe(true);
    expect(new Set(Object.values(ValidationOutcome))).toEqual(new Set(['valid', 'invalid', 'unverified']));
  });

  test('RotationDecision is complete and frozen', () => {
    expect(Object.isFrozen(RotationDecision)).toBe(true);
    expect(new Set(Object.values(RotationDecision))).toEqual(new Set(['promote', 'keep_current', 'denied']));
  });

  test('RotationGrantReason is complete and frozen', () => {
    expect(Object.isFrozen(RotationGrantReason)).toBe(true);
    expect(new Set(Object.values(RotationGrantReason))).toEqual(new Set(['promoted']));
  });

  test('RotationKeepReason is complete and frozen', () => {
    expect(Object.isFrozen(RotationKeepReason)).toBe(true);
    expect(new Set(Object.values(RotationKeepReason))).toEqual(new Set([
      'candidate_invalid', 'candidate_unverified', 'account_mismatch',
      'same_credential', 'candidate_expired', 'not_longer_lived',
    ]));
  });

  test('RotationDenialReason is complete and frozen', () => {
    expect(Object.isFrozen(RotationDenialReason)).toBe(true);
    expect(new Set(Object.values(RotationDenialReason))).toEqual(new Set(['malformed_current', 'malformed_candidate']));
  });
});

// ---- 2. happy-path promotion --------------------------------------------

describe('happy-path promotion', () => {
  test('a validated, account-matched, different, unexpired, strictly-longer-lived candidate promotes', () => {
    const verdict = classifyCredentialRotationPromotion(current(), candidate());
    expect(verdict).toEqual({
      decision: 'promote',
      reason: 'promoted',
      next: {
        credentialRef: 'cred.v2.bbb',
        accountRef: ACCOUNT,
        expiresAt: LONGER_EXPIRY,
      },
    });
  });

  test('the grant, and its next block, are frozen', () => {
    const verdict = classifyCredentialRotationPromotion(current(), candidate());
    expect(Object.isFrozen(verdict)).toBe(true);
    expect(Object.isFrozen(verdict.next)).toBe(true);
  });

  test('the next block carries exactly the three non-secret handles — no validation metadata leaks', () => {
    const verdict = classifyCredentialRotationPromotion(current(), candidate());
    expect(Object.keys(verdict.next).sort()).toEqual(['accountRef', 'credentialRef', 'expiresAt']);
    // The candidate's validation outcome and validation instant are decision inputs,
    // not part of what is promoted — they must not appear in the grant.
    expect(verdict.next).not.toHaveProperty('validationOutcome');
    expect(verdict.next).not.toHaveProperty('asOf');
  });

  test('an all-digit provider account (an Instagram business account id) is accepted on both sides', () => {
    // The default fixtures already use an all-digit account; assert it explicitly so a
    // future tightening that requires a letter would fail loudly.
    const verdict = classifyCredentialRotationPromotion(
      current({ accountRef: '17841400000000000' }),
      candidate({ accountRef: '17841400000000000' }),
    );
    expect(verdict.decision).toBe('promote');
    expect(verdict.next.accountRef).toBe('17841400000000000');
  });

  test('a candidate expiring one second after the current credential promotes (strictly-later boundary)', () => {
    const verdict = classifyCredentialRotationPromotion(
      current({ expiresAt: '2026-09-01T00:00:00Z' }),
      candidate({ expiresAt: '2026-09-01T00:00:01Z', asOf: VALIDATED_AT }),
    );
    expect(verdict.decision).toBe('promote');
    expect(verdict.next.expiresAt).toBe('2026-09-01T00:00:01Z');
  });

  test('a candidate whose validation instant is one second before its expiry promotes (not-expired boundary)', () => {
    const verdict = classifyCredentialRotationPromotion(
      current({ expiresAt: '2026-08-31T23:59:59Z' }),
      candidate({ expiresAt: '2026-09-01T00:00:00Z', asOf: '2026-08-31T23:59:59Z' }),
    );
    expect(verdict.decision).toBe('promote');
  });
});

// ---- 3. keep_current: the known-good is never overwritten ----------------

describe('keep_current (known-good retained)', () => {
  test('an invalid candidate keeps the current credential (candidate_invalid)', () => {
    const verdict = classifyCredentialRotationPromotion(current(), candidate({ validationOutcome: 'invalid' }));
    expect(verdict).toEqual({ decision: 'keep_current', reason: 'candidate_invalid' });
  });

  test('an unverified candidate keeps the current credential (candidate_unverified)', () => {
    const verdict = classifyCredentialRotationPromotion(current(), candidate({ validationOutcome: 'unverified' }));
    expect(verdict).toEqual({ decision: 'keep_current', reason: 'candidate_unverified' });
  });

  test('a validated candidate for a different account keeps the current credential (account_mismatch)', () => {
    const verdict = classifyCredentialRotationPromotion(current(), candidate({ accountRef: OTHER_ACCOUNT }));
    expect(verdict).toEqual({ decision: 'keep_current', reason: 'account_mismatch' });
  });

  test('a candidate equal to the current fingerprint is a no-op (same_credential)', () => {
    const verdict = classifyCredentialRotationPromotion(current(), candidate({ credentialRef: 'cred.v1.aaa' }));
    expect(verdict).toEqual({ decision: 'keep_current', reason: 'same_credential' });
  });

  test('a candidate already expired at its validation instant keeps the current credential (candidate_expired)', () => {
    const verdict = classifyCredentialRotationPromotion(
      current(),
      candidate({ expiresAt: LONGER_EXPIRY, asOf: LONGER_EXPIRY }), // asOf == expiresAt -> expired (exclusive)
    );
    expect(verdict).toEqual({ decision: 'keep_current', reason: 'candidate_expired' });
  });

  test('a candidate expiring after its validation instant but not after the current keeps it (not_longer_lived, equal)', () => {
    const verdict = classifyCredentialRotationPromotion(
      current({ expiresAt: CURRENT_EXPIRY }),
      candidate({ expiresAt: CURRENT_EXPIRY, asOf: VALIDATED_AT }), // equal expiry -> not strictly longer
    );
    expect(verdict).toEqual({ decision: 'keep_current', reason: 'not_longer_lived' });
  });

  test('a candidate expiring before the current keeps it (not_longer_lived, earlier)', () => {
    const verdict = classifyCredentialRotationPromotion(
      current({ expiresAt: CURRENT_EXPIRY }),
      candidate({ expiresAt: SHORTER_EXPIRY, asOf: VALIDATED_AT }),
    );
    expect(verdict).toEqual({ decision: 'keep_current', reason: 'not_longer_lived' });
  });

  test('every keep_current carries exactly a decision and a reason and no next block', () => {
    const verdict = classifyCredentialRotationPromotion(current(), candidate({ validationOutcome: 'invalid' }));
    expect(Object.keys(verdict).sort()).toEqual(['decision', 'reason']);
    expect(verdict).not.toHaveProperty('next');
  });
});

// ---- 4. the marquee invariant: a non-improvement never promotes ----------

describe('a failed / unfit refresh never overwrites the known-good', () => {
  // Every candidate here fails at least one promotion gate; NONE may promote. This
  // is the "a failed refresh never overwrites the known-good secret" invariant,
  // enumerated across the whole failure surface.
  test.each([
    ['invalid validation', candidate({ validationOutcome: 'invalid' })],
    ['unverified validation', candidate({ validationOutcome: 'unverified' })],
    ['different account', candidate({ accountRef: OTHER_ACCOUNT })],
    ['same fingerprint', candidate({ credentialRef: 'cred.v1.aaa' })],
    ['already expired (asOf == expiry)', candidate({ expiresAt: LONGER_EXPIRY, asOf: LONGER_EXPIRY })],
    ['already expired (asOf after expiry)', candidate({ expiresAt: SHORTER_EXPIRY, asOf: VALIDATED_AT })],
    ['equal expiry', candidate({ expiresAt: CURRENT_EXPIRY })],
    ['earlier expiry', candidate({ expiresAt: SHORTER_EXPIRY, asOf: '2026-07-01T00:00:00Z' })],
    ['malformed candidate', 42],
    ['null candidate', null],
  ])('%s does not promote (known-good retained)', (_label, cand) => {
    const verdict = classifyCredentialRotationPromotion(current(), cand);
    expect(verdict.decision).not.toBe('promote');
    expect(['keep_current', 'denied']).toContain(verdict.decision);
    expect(verdict).not.toHaveProperty('next');
  });

  test('a malformed CURRENT never promotes even against a perfect candidate (cannot compare against an unknown baseline)', () => {
    const verdict = classifyCredentialRotationPromotion(null, candidate());
    expect(verdict).toEqual({ decision: 'denied', reason: 'malformed_current' });
  });

  test('the sole promoting configuration really does promote (guards against an over-broad keep)', () => {
    // A negative-space check: the one fully-valid candidate must promote, proving the
    // gates are not vacuously rejecting everything.
    expect(classifyCredentialRotationPromotion(current(), candidate()).decision).toBe('promote');
  });
});

// ---- 5. precedence ordering ---------------------------------------------

describe('precedence: validation, then account, then identity, then lifetime', () => {
  test('malformed_current outranks malformed_candidate (baseline is read first)', () => {
    expect(classifyCredentialRotationPromotion(null, null)).toEqual({ decision: 'denied', reason: 'malformed_current' });
  });

  test('malformed_candidate outranks every keep reason', () => {
    expect(classifyCredentialRotationPromotion(current(), 'nope'))
      .toEqual({ decision: 'denied', reason: 'malformed_candidate' });
  });

  test('invalid validation outranks an account mismatch', () => {
    const verdict = classifyCredentialRotationPromotion(
      current(),
      candidate({ validationOutcome: 'invalid', accountRef: OTHER_ACCOUNT }),
    );
    expect(verdict.reason).toBe('candidate_invalid');
  });

  test('unverified validation outranks an account mismatch', () => {
    const verdict = classifyCredentialRotationPromotion(
      current(),
      candidate({ validationOutcome: 'unverified', accountRef: OTHER_ACCOUNT }),
    );
    expect(verdict.reason).toBe('candidate_unverified');
  });

  test('an account mismatch outranks a same-fingerprint no-op', () => {
    // Same fingerprint as current but a different account: the account anomaly wins.
    const verdict = classifyCredentialRotationPromotion(
      current(),
      candidate({ credentialRef: 'cred.v1.aaa', accountRef: OTHER_ACCOUNT }),
    );
    expect(verdict.reason).toBe('account_mismatch');
  });

  test('a same-fingerprint no-op outranks an expiry problem', () => {
    // Same fingerprint AND already expired: reported as the no-op, not as expired.
    const verdict = classifyCredentialRotationPromotion(
      current(),
      candidate({ credentialRef: 'cred.v1.aaa', expiresAt: LONGER_EXPIRY, asOf: LONGER_EXPIRY }),
    );
    expect(verdict.reason).toBe('same_credential');
  });

  test('an expired candidate outranks a not-longer-lived one', () => {
    // Expiry before current (not longer lived) AND already expired: reported expired.
    const verdict = classifyCredentialRotationPromotion(
      current({ expiresAt: CURRENT_EXPIRY }),
      candidate({ expiresAt: SHORTER_EXPIRY, asOf: VALIDATED_AT }), // asOf 07-21 > expiry 08-01? no
    );
    // asOf 2026-07-21 is before 2026-08-01, so this candidate is NOT expired; it is
    // simply not-longer-lived. Use an explicitly expired one to test the ordering.
    expect(verdict.reason).toBe('not_longer_lived');
    const expired = classifyCredentialRotationPromotion(
      current({ expiresAt: CURRENT_EXPIRY }),
      candidate({ expiresAt: SHORTER_EXPIRY, asOf: '2026-08-15T00:00:00Z' }), // asOf after 08-01 expiry
    );
    expect(expired.reason).toBe('candidate_expired');
  });
});

// ---- 6. malformed current -----------------------------------------------

describe('malformed current is denied malformed_current', () => {
  const cand = candidate();

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['a string', 'cred'],
    ['an array', [1, 2, 3]],
    ['a boolean', true],
  ])('%s', (_label, value) => {
    expect(classifyCredentialRotationPromotion(value, cand)).toEqual({ decision: 'denied', reason: 'malformed_current' });
  });

  test('a Proxy over a valid current', () => {
    expect(classifyCredentialRotationPromotion(new Proxy(current(), {}), cand).reason).toBe('malformed_current');
  });

  test('a foreign-prototype current', () => {
    const foreign = Object.assign(Object.create({ inherited: 1 }), current());
    expect(classifyCredentialRotationPromotion(foreign, cand).reason).toBe('malformed_current');
  });

  test('a null-prototype current', () => {
    const nullProto = Object.assign(Object.create(null), current());
    expect(classifyCredentialRotationPromotion(nullProto, cand).reason).toBe('malformed_current');
  });

  test('a current missing a required key', () => {
    const c = current();
    delete c.expiresAt;
    expect(classifyCredentialRotationPromotion(c, cand).reason).toBe('malformed_current');
  });

  test('a current with an extra key', () => {
    expect(classifyCredentialRotationPromotion(current({ extra: 1 }), cand).reason).toBe('malformed_current');
  });

  test('a current with an extra non-enumerable key', () => {
    const c = current();
    Object.defineProperty(c, 'shadow', { enumerable: false, configurable: true, value: 'x' });
    expect(classifyCredentialRotationPromotion(c, cand).reason).toBe('malformed_current');
  });

  test('a current with a symbol key', () => {
    const c = current();
    c[Symbol('x')] = 1;
    expect(classifyCredentialRotationPromotion(c, cand).reason).toBe('malformed_current');
  });

  test('a current whose field is a getter — the getter is never invoked', () => {
    let invoked = false;
    const c = current();
    delete c.accountRef;
    Object.defineProperty(c, 'accountRef', {
      enumerable: true, configurable: true, get() { invoked = true; return ACCOUNT; },
    });
    expect(classifyCredentialRotationPromotion(c, cand).reason).toBe('malformed_current');
    expect(invoked).toBe(false);
  });

  test('a current with a non-enumerable field', () => {
    const c = current();
    delete c.credentialRef;
    Object.defineProperty(c, 'credentialRef', { enumerable: false, value: 'cred.v1.aaa' });
    expect(classifyCredentialRotationPromotion(c, cand).reason).toBe('malformed_current');
  });

  test.each([
    ['wrong schema version 0', { credentialRotationSchemaVersion: 0 }],
    ['wrong schema version 2', { credentialRotationSchemaVersion: 2 }],
    ['string schema version', { credentialRotationSchemaVersion: '1' }],
    ['credentialRef empty', { credentialRef: '' }],
    ['credentialRef with spaces', { credentialRef: 'cred v1' }],
    ['credentialRef too long', { credentialRef: 'c'.repeat(257) }],
    ['credentialRef non-string', { credentialRef: 5 }],
    ['credentialRef null', { credentialRef: null }],
    ['accountRef empty', { accountRef: '' }],
    ['accountRef with spaces', { accountRef: '178 414' }],
    ['accountRef non-string', { accountRef: 178414 }],
    ['expiresAt null', { expiresAt: null }],
    ['expiresAt malformed', { expiresAt: '2026-09-01 00:00:00' }],
    ['expiresAt out-of-range month', { expiresAt: '2026-13-01T00:00:00Z' }],
    ['expiresAt out-of-range hour', { expiresAt: '2026-09-01T24:00:00Z' }],
    ['expiresAt non-string', { expiresAt: 20260901 }],
  ])('%s', (_label, overrides) => {
    expect(classifyCredentialRotationPromotion(current(overrides), cand).reason).toBe('malformed_current');
  });
});

// ---- 7. malformed candidate ---------------------------------------------

describe('malformed candidate is denied malformed_candidate', () => {
  const cur = current();

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['a string', 'cred'],
    ['an array', [1, 2, 3]],
    ['a boolean', true],
  ])('%s', (_label, value) => {
    expect(classifyCredentialRotationPromotion(cur, value))
      .toEqual({ decision: 'denied', reason: 'malformed_candidate' });
  });

  test('a Proxy over a valid candidate', () => {
    expect(classifyCredentialRotationPromotion(cur, new Proxy(candidate(), {})).reason).toBe('malformed_candidate');
  });

  test('a foreign-prototype candidate', () => {
    const foreign = Object.assign(Object.create({ inherited: 1 }), candidate());
    expect(classifyCredentialRotationPromotion(cur, foreign).reason).toBe('malformed_candidate');
  });

  test('a candidate missing a required key', () => {
    const c = candidate();
    delete c.validationOutcome;
    expect(classifyCredentialRotationPromotion(cur, c).reason).toBe('malformed_candidate');
  });

  test('a candidate with an extra key', () => {
    expect(classifyCredentialRotationPromotion(cur, candidate({ extra: 1 })).reason).toBe('malformed_candidate');
  });

  test('a candidate with an extra non-enumerable key', () => {
    const c = candidate();
    Object.defineProperty(c, 'shadow', { enumerable: false, configurable: true, value: 'x' });
    expect(classifyCredentialRotationPromotion(cur, c).reason).toBe('malformed_candidate');
  });

  test('a candidate with an extra non-enumerable throwing accessor — never throws, never invoked', () => {
    let invoked = false;
    const c = candidate();
    Object.defineProperty(c, 'shadow', {
      enumerable: false, configurable: true, get() { invoked = true; throw new Error('trap'); },
    });
    let verdict;
    expect(() => { verdict = classifyCredentialRotationPromotion(cur, c); }).not.toThrow();
    expect(verdict.reason).toBe('malformed_candidate');
    expect(invoked).toBe(false);
  });

  test('a candidate with a symbol key', () => {
    const c = candidate();
    c[Symbol('x')] = 1;
    expect(classifyCredentialRotationPromotion(cur, c).reason).toBe('malformed_candidate');
  });

  test('a candidate whose field is a getter — the getter is never invoked', () => {
    let invoked = false;
    const c = candidate();
    delete c.validationOutcome;
    Object.defineProperty(c, 'validationOutcome', {
      enumerable: true, configurable: true, get() { invoked = true; return 'valid'; },
    });
    expect(classifyCredentialRotationPromotion(cur, c).reason).toBe('malformed_candidate');
    expect(invoked).toBe(false);
  });

  test.each([
    ['wrong schema version', { credentialRotationSchemaVersion: 2 }],
    ['credentialRef empty', { credentialRef: '' }],
    ['credentialRef with spaces', { credentialRef: 'cred v2' }],
    ['credentialRef non-string', { credentialRef: 5 }],
    ['accountRef empty', { accountRef: '' }],
    ['accountRef non-string', { accountRef: 5 }],
    ['expiresAt null', { expiresAt: null }],
    ['expiresAt malformed', { expiresAt: 'soon' }],
    ['expiresAt out-of-range minute', { expiresAt: '2026-12-01T00:60:00Z' }],
    ['validationOutcome off-enum', { validationOutcome: 'maybe' }],
    ['validationOutcome non-string', { validationOutcome: 1 }],
    ['validationOutcome null', { validationOutcome: null }],
    ['asOf null', { asOf: null }],
    ['asOf malformed', { asOf: '2026-07-21' }],
    ['asOf out-of-range second', { asOf: '2026-07-21T12:00:60Z' }],
    ['asOf non-string', { asOf: 12 }],
  ])('%s', (_label, overrides) => {
    expect(classifyCredentialRotationPromotion(cur, candidate(overrides)).reason).toBe('malformed_candidate');
  });
});

// ---- 8. hostile proxy / accessor inputs never throw or invoke getters ----

describe('hostile proxy / accessor inputs never throw and never invoke getters', () => {
  test('a revoked proxy current is denied malformed_current without throwing', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    let verdict;
    expect(() => { verdict = classifyCredentialRotationPromotion(proxy, candidate()); }).not.toThrow();
    expect(verdict).toEqual({ decision: 'denied', reason: 'malformed_current' });
  });

  test('a revoked proxy candidate is denied malformed_candidate without throwing', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    let verdict;
    expect(() => { verdict = classifyCredentialRotationPromotion(current(), proxy); }).not.toThrow();
    expect(verdict).toEqual({ decision: 'denied', reason: 'malformed_candidate' });
  });

  test('a live proxy current never fires a trap', () => {
    const trap = () => { throw new Error('current trap must never fire'); };
    const proxy = new Proxy(current(), { get: trap, has: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
    expect(classifyCredentialRotationPromotion(proxy, candidate()).reason).toBe('malformed_current');
  });

  test('a live proxy candidate never fires a trap', () => {
    const trap = () => { throw new Error('candidate trap must never fire'); };
    const proxy = new Proxy(candidate(), { get: trap, has: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
    expect(classifyCredentialRotationPromotion(current(), proxy).reason).toBe('malformed_candidate');
  });

  test('a throwing accessor on a current field never throws out of the classifier', () => {
    const c = current();
    delete c.accountRef;
    Object.defineProperty(c, 'accountRef', {
      enumerable: true, configurable: true, get() { throw new Error('current getter must never be invoked'); },
    });
    let verdict;
    expect(() => { verdict = classifyCredentialRotationPromotion(c, candidate()); }).not.toThrow();
    expect(verdict.reason).toBe('malformed_current');
  });

  test('a throwing accessor on a candidate field never throws out of the classifier', () => {
    const c = candidate();
    delete c.expiresAt;
    Object.defineProperty(c, 'expiresAt', {
      enumerable: true, configurable: true, get() { throw new Error('candidate getter must never be invoked'); },
    });
    let verdict;
    expect(() => { verdict = classifyCredentialRotationPromotion(current(), c); }).not.toThrow();
    expect(verdict.reason).toBe('malformed_candidate');
  });
});

// ---- 9. determinism, sharing, non-echo ----------------------------------

describe('determinism, sharing, non-echo', () => {
  test('identical inputs yield deep-equal verdicts', () => {
    expect(classifyCredentialRotationPromotion(current(), candidate()))
      .toEqual(classifyCredentialRotationPromotion(current(), candidate()));
  });

  test('denial verdicts are shared frozen singletons across calls', () => {
    const a = classifyCredentialRotationPromotion(null, candidate());
    const b = classifyCredentialRotationPromotion(null, candidate());
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  test('keep_current verdicts are shared frozen singletons across calls', () => {
    const a = classifyCredentialRotationPromotion(current(), candidate({ validationOutcome: 'invalid' }));
    const b = classifyCredentialRotationPromotion(current(), candidate({ validationOutcome: 'invalid' }));
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  test('distinct keep reasons are distinct singletons', () => {
    const invalid = classifyCredentialRotationPromotion(current(), candidate({ validationOutcome: 'invalid' }));
    const mismatch = classifyCredentialRotationPromotion(current(), candidate({ accountRef: OTHER_ACCOUNT }));
    expect(invalid).not.toBe(mismatch);
  });

  test('promote verdicts are fresh (not shared) but deep-equal for equal inputs', () => {
    const a = classifyCredentialRotationPromotion(current(), candidate());
    const b = classifyCredentialRotationPromotion(current(), candidate());
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  test('mutating a returned grant is a no-op under a fresh call', () => {
    const first = classifyCredentialRotationPromotion(current(), candidate());
    try { first.next.credentialRef = 'tampered'; } catch (_e) { /* frozen */ }
    const second = classifyCredentialRotationPromotion(current(), candidate());
    expect(second.next.credentialRef).toBe('cred.v2.bbb');
  });
});

// ---- 10. source boundary (comment-stripped) -----------------------------

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

  // Holds no secret material: the module models credential rotation purely over
  // opaque fingerprints and non-secret metadata, so none of the actual
  // secret-value vocabulary may appear anywhere in the code.
  test.each([
    ['secret', /secret/i],
    ['token', /\btoken\b/i],
    ['password', /password/i],
    ['passwd', /passwd/i],
    ['bearer', /bearer/i],
    ['api key', /api[_-]?key/i],
    ['access_token', /access[_-]?token/i],
    ['refresh_token', /refresh[_-]?token/i],
    ['client_secret', /client[_-]?secret/i],
    ['private key', /private[_-]?key/i],
    ['phone', /phone/i],
    ['address', /address/i],
    ['dob', /\bdob\b/i],
    ['ssn', /\bssn\b/i],
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
    expect(rawSource).toContain('INSTAGRAM-005A');
  });

  test('functions/index.js does not import this module', () => {
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toContain('instagramCredentialRotation');
  });
});
