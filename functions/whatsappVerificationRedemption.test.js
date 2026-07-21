'use strict';

const fs = require('fs');
const path = require('path');

const mod = require('./whatsappVerificationRedemption');
const {
  verificationSchemaVersion,
  RedemptionStatus,
  RedemptionDecision,
  AcceptReason,
  RejectReason,
  DenialReason,
  classifyWhatsappVerificationRedemption,
} = mod;

// ---- fixtures ------------------------------------------------------------

const MEMBER = 'member.alice.uid'; // an identity (contains letters)
const OTHER_MEMBER = 'member.bob.uid';
// A normalized phone / WhatsApp channel identifier is legitimately all digits; the
// contract must accept it as a channel handle (never as an identity).
const PHONE = '15551234567';
const CHALLENGE = 'chal.abc123';

// Fixed-width 64-char lowercase-hex digests (the shape of a SHA-256 hex string).
const GOOD_HASH = 'a3f1c0de'.repeat(8);
const WRONG_HASH = 'b4e2d1cf'.repeat(8);

const ISSUED_AT = '2026-07-21T12:00:00Z';
const EXPIRES_AT = '2026-07-21T12:10:00Z';
const BEFORE_EXPIRY = '2026-07-21T12:09:59Z'; // one second before expiry -> valid
const AT_EXPIRY = '2026-07-21T12:10:00Z'; // exactly at expiry -> expired (exclusive)
const AFTER_EXPIRY = '2026-07-21T12:10:01Z';

function challenge(overrides = {}) {
  return {
    verificationSchemaVersion: 1,
    challengeRef: CHALLENGE,
    memberRef: MEMBER,
    phoneRef: PHONE,
    codeHash: GOOD_HASH,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    maxAttempts: 3,
    attemptsMade: 0,
    status: 'pending',
    ...overrides,
  };
}

function attempt(overrides = {}) {
  return {
    verificationSchemaVersion: 1,
    challengeRef: CHALLENGE,
    actor: MEMBER,
    providedCodeHash: GOOD_HASH,
    asOf: BEFORE_EXPIRY,
    ...overrides,
  };
}

const codeOnly = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');

const rawSource = fs.readFileSync(path.join(__dirname, 'whatsappVerificationRedemption.js'), 'utf8');
const sourceCode = codeOnly(rawSource);

// ---- 1. frozen surface & enums ------------------------------------------

describe('frozen surface & enums', () => {
  test('schema version is 1', () => {
    expect(verificationSchemaVersion).toBe(1);
  });

  test('module is frozen', () => {
    expect(Object.isFrozen(mod)).toBe(true);
  });

  test('classifyWhatsappVerificationRedemption is a function', () => {
    expect(typeof classifyWhatsappVerificationRedemption).toBe('function');
  });

  test('RedemptionStatus is complete and frozen', () => {
    expect(Object.isFrozen(RedemptionStatus)).toBe(true);
    expect(new Set(Object.values(RedemptionStatus))).toEqual(new Set(['pending', 'verified', 'voided']));
  });

  test('RedemptionDecision is complete and frozen', () => {
    expect(Object.isFrozen(RedemptionDecision)).toBe(true);
    expect(new Set(Object.values(RedemptionDecision))).toEqual(new Set(['accepted', 'rejected', 'denied']));
  });

  test('AcceptReason is complete and frozen', () => {
    expect(Object.isFrozen(AcceptReason)).toBe(true);
    expect(new Set(Object.values(AcceptReason))).toEqual(new Set(['verified']));
  });

  test('RejectReason is complete and frozen', () => {
    expect(Object.isFrozen(RejectReason)).toBe(true);
    expect(new Set(Object.values(RejectReason))).toEqual(new Set([
      'challenge_mismatch',
      'already_verified',
      'challenge_voided',
      'actor_mismatch',
      'expired',
      'too_many_attempts',
      'code_mismatch',
    ]));
  });

  test('DenialReason is complete and frozen', () => {
    expect(Object.isFrozen(DenialReason)).toBe(true);
    expect(new Set(Object.values(DenialReason))).toEqual(new Set(['malformed_challenge', 'malformed_attempt']));
  });
});

// ---- 2. happy-path accept ------------------------------------------------

describe('accept', () => {
  test('a correct, current, in-budget redemption by the owning member is accepted', () => {
    const result = classifyWhatsappVerificationRedemption(challenge(), attempt());
    expect(result).toEqual({
      decision: 'accepted',
      reason: 'verified',
      next: { challengeRef: CHALLENGE, status: 'verified', attemptsMade: 0 },
      proof: { memberRef: MEMBER, phoneRef: PHONE },
    });
  });

  test('accept works with an all-digit phone channel identifier', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ phoneRef: '447700900123' }),
      attempt(),
    );
    expect(result.decision).toBe('accepted');
    expect(result.proof.phoneRef).toBe('447700900123');
  });

  test('accept at the last remaining attempt (attemptsMade = maxAttempts - 1)', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ attemptsMade: 2, maxAttempts: 3 }),
      attempt(),
    );
    expect(result.decision).toBe('accepted');
    expect(result.next.attemptsMade).toBe(2);
  });

  test('accept one second before expiry (not-expired boundary)', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge(),
      attempt({ asOf: BEFORE_EXPIRY }),
    );
    expect(result.decision).toBe('accepted');
  });

  test('accept with a single-attempt budget and the correct code', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ maxAttempts: 1, attemptsMade: 0 }),
      attempt(),
    );
    expect(result.decision).toBe('accepted');
  });

  test('the accept verdict, next, and proof are all frozen', () => {
    const result = classifyWhatsappVerificationRedemption(challenge(), attempt());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.next)).toBe(true);
    expect(Object.isFrozen(result.proof)).toBe(true);
  });

  test('the proof carries exactly memberRef and phoneRef — nothing else', () => {
    const { proof } = classifyWhatsappVerificationRedemption(challenge(), attempt());
    expect(Object.keys(proof).sort()).toEqual(['memberRef', 'phoneRef']);
  });

  test('the next carries exactly challengeRef, status, attemptsMade — nothing else', () => {
    const { next } = classifyWhatsappVerificationRedemption(challenge(), attempt());
    expect(Object.keys(next).sort()).toEqual(['attemptsMade', 'challengeRef', 'status']);
  });
});

// ---- 3. one-use: terminal challenge states ------------------------------

describe('one-use terminal states', () => {
  test('an already-verified challenge is rejected as already_verified even with the correct code', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ status: 'verified' }),
      attempt(),
    );
    expect(result).toEqual({ decision: 'rejected', reason: 'already_verified' });
  });

  test('a voided challenge is rejected as challenge_voided even with the correct code', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ status: 'voided' }),
      attempt(),
    );
    expect(result).toEqual({ decision: 'rejected', reason: 'challenge_voided' });
  });

  test('a terminal-state rejection changes no state (no next field)', () => {
    const verified = classifyWhatsappVerificationRedemption(challenge({ status: 'verified' }), attempt());
    const voided = classifyWhatsappVerificationRedemption(challenge({ status: 'voided' }), attempt());
    expect(verified).not.toHaveProperty('next');
    expect(voided).not.toHaveProperty('next');
  });
});

// ---- 4. challenge-bound --------------------------------------------------

describe('challenge-bound', () => {
  test('an attempt naming a different challenge is challenge_mismatch', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge(),
      attempt({ challengeRef: 'chal.other' }),
    );
    expect(result).toEqual({ decision: 'rejected', reason: 'challenge_mismatch' });
  });

  test('challenge_mismatch is decided before terminal state and before the code', () => {
    // Even against a verified challenge with the correct code, a mismatched
    // challengeRef reports the mismatch, not already_verified.
    const result = classifyWhatsappVerificationRedemption(
      challenge({ status: 'verified' }),
      attempt({ challengeRef: 'chal.other' }),
    );
    expect(result.reason).toBe('challenge_mismatch');
  });

  test('challenge_mismatch changes no state', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge(),
      attempt({ challengeRef: 'chal.other' }),
    );
    expect(result).not.toHaveProperty('next');
  });
});

// ---- 5. owner-bound ------------------------------------------------------

describe('owner-bound', () => {
  test('a redemption by a different member is actor_mismatch even with the correct code', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge(),
      attempt({ actor: OTHER_MEMBER }),
    );
    expect(result).toEqual({ decision: 'rejected', reason: 'actor_mismatch' });
  });

  test('actor_mismatch changes NO state — a stranger cannot burn the owner attempt budget', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ attemptsMade: 1 }),
      attempt({ actor: OTHER_MEMBER, providedCodeHash: WRONG_HASH }),
    );
    expect(result).not.toHaveProperty('next');
    expect(result.reason).toBe('actor_mismatch');
  });

  test('actor_mismatch is decided before expiry and before the code', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge(),
      attempt({ actor: OTHER_MEMBER, asOf: AFTER_EXPIRY, providedCodeHash: WRONG_HASH }),
    );
    expect(result.reason).toBe('actor_mismatch');
  });
});

// ---- 6. short-lived: expiry ---------------------------------------------

describe('short-lived expiry', () => {
  test('asOf exactly at expiry is expired (exclusive)', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge(),
      attempt({ asOf: AT_EXPIRY }),
    );
    expect(result.decision).toBe('rejected');
    expect(result.reason).toBe('expired');
  });

  test('asOf after expiry is expired', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge(),
      attempt({ asOf: AFTER_EXPIRY }),
    );
    expect(result.reason).toBe('expired');
  });

  test('a correct code that arrives late does NOT verify — expiry is checked before the code', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge(),
      attempt({ asOf: AFTER_EXPIRY, providedCodeHash: GOOD_HASH }),
    );
    expect(result.reason).toBe('expired');
    expect(result.decision).not.toBe('accepted');
  });

  test('expiry voids the challenge (terminal) without consuming an attempt', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ attemptsMade: 1 }),
      attempt({ asOf: AFTER_EXPIRY }),
    );
    expect(result.next).toEqual({ challengeRef: CHALLENGE, status: 'voided', attemptsMade: 1 });
  });
});

// ---- 7. attempt-bounded: too_many_attempts ------------------------------

describe('attempt-bounded exhaustion', () => {
  test('a pending challenge with attemptsMade === maxAttempts is too_many_attempts', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ attemptsMade: 3, maxAttempts: 3 }),
      attempt(),
    );
    expect(result.decision).toBe('rejected');
    expect(result.reason).toBe('too_many_attempts');
  });

  test('exhaustion refuses even a correct code and voids the challenge', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ attemptsMade: 3, maxAttempts: 3, status: 'pending' }),
      attempt({ providedCodeHash: GOOD_HASH }),
    );
    expect(result.reason).toBe('too_many_attempts');
    expect(result.next).toEqual({ challengeRef: CHALLENGE, status: 'voided', attemptsMade: 3 });
  });

  test('attemptsMade beyond maxAttempts (inconsistent record) is still too_many_attempts', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ attemptsMade: 5, maxAttempts: 3 }),
      attempt(),
    );
    expect(result.reason).toBe('too_many_attempts');
  });
});

// ---- 8. code_mismatch and the brute-force bound -------------------------

describe('code_mismatch consumes attempts and the brute-force bound holds', () => {
  test('a wrong code consumes exactly one attempt and keeps the challenge pending', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ attemptsMade: 0, maxAttempts: 3 }),
      attempt({ providedCodeHash: WRONG_HASH }),
    );
    expect(result).toEqual({
      decision: 'rejected',
      reason: 'code_mismatch',
      next: { challengeRef: CHALLENGE, status: 'pending', attemptsMade: 1 },
    });
  });

  test('the wrong-code miss that reaches maxAttempts voids the challenge', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ attemptsMade: 2, maxAttempts: 3 }),
      attempt({ providedCodeHash: WRONG_HASH }),
    );
    expect(result.reason).toBe('code_mismatch');
    expect(result.next).toEqual({ challengeRef: CHALLENGE, status: 'voided', attemptsMade: 3 });
  });

  test('a single-attempt budget voids on the first wrong code', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ attemptsMade: 0, maxAttempts: 1 }),
      attempt({ providedCodeHash: WRONG_HASH }),
    );
    expect(result.next).toEqual({ challengeRef: CHALLENGE, status: 'voided', attemptsMade: 1 });
  });

  test('driving a challenge to lockout with repeated wrong codes permits zero accepts', () => {
    // Simulate the caller persisting `next` between attempts.
    let state = challenge({ attemptsMade: 0, maxAttempts: 3 });
    let accepts = 0;
    const reasons = [];
    for (let i = 0; i < 5; i += 1) {
      const result = classifyWhatsappVerificationRedemption(state, attempt({ providedCodeHash: WRONG_HASH }));
      reasons.push(result.reason);
      if (result.decision === 'accepted') accepts += 1;
      if (result.next) {
        state = challenge({
          attemptsMade: result.next.attemptsMade,
          maxAttempts: 3,
          status: result.next.status,
        });
      }
    }
    expect(accepts).toBe(0);
    // three code_mismatch guesses, then the challenge is voided for good.
    expect(reasons).toEqual([
      'code_mismatch',
      'code_mismatch',
      'code_mismatch',
      'challenge_voided',
      'challenge_voided',
    ]);
  });

  test('the correct code still verifies on the final permitted attempt', () => {
    let state = challenge({ attemptsMade: 0, maxAttempts: 3 });
    // two misses...
    for (let i = 0; i < 2; i += 1) {
      const miss = classifyWhatsappVerificationRedemption(state, attempt({ providedCodeHash: WRONG_HASH }));
      state = challenge({ attemptsMade: miss.next.attemptsMade, maxAttempts: 3, status: miss.next.status });
    }
    // ...then the correct code on the last attempt.
    const hit = classifyWhatsappVerificationRedemption(state, attempt({ providedCodeHash: GOOD_HASH }));
    expect(hit.decision).toBe('accepted');
  });
});

// ---- 9. precedence -------------------------------------------------------

describe('precedence ordering', () => {
  test('malformed_challenge precedes malformed_attempt', () => {
    const result = classifyWhatsappVerificationRedemption(null, null);
    expect(result.reason).toBe('malformed_challenge');
  });

  test('malformed_attempt precedes challenge_mismatch', () => {
    const result = classifyWhatsappVerificationRedemption(challenge(), null);
    expect(result.reason).toBe('malformed_attempt');
  });

  test('challenge_mismatch precedes terminal-state checks', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ status: 'voided' }),
      attempt({ challengeRef: 'chal.other' }),
    );
    expect(result.reason).toBe('challenge_mismatch');
  });

  test('terminal state precedes actor_mismatch', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ status: 'verified' }),
      attempt({ actor: OTHER_MEMBER }),
    );
    expect(result.reason).toBe('already_verified');
  });

  test('actor_mismatch precedes expiry', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge(),
      attempt({ actor: OTHER_MEMBER, asOf: AFTER_EXPIRY }),
    );
    expect(result.reason).toBe('actor_mismatch');
  });

  test('expiry precedes exhaustion', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ attemptsMade: 3, maxAttempts: 3 }),
      attempt({ asOf: AFTER_EXPIRY }),
    );
    expect(result.reason).toBe('expired');
  });

  test('exhaustion precedes the code comparison', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ attemptsMade: 3, maxAttempts: 3 }),
      attempt({ providedCodeHash: WRONG_HASH }),
    );
    expect(result.reason).toBe('too_many_attempts');
  });

  test('a valid code on a pending, in-budget, current, owned challenge accepts (all gates pass)', () => {
    const result = classifyWhatsappVerificationRedemption(challenge(), attempt());
    expect(result.decision).toBe('accepted');
  });
});

// ---- 10. structural: holds no plaintext code ----------------------------

describe('holds no plaintext code (structural)', () => {
  test('a short numeric one-time code as codeHash is rejected as malformed', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ codeHash: '123456' }),
      attempt(),
    );
    expect(result.reason).toBe('malformed_challenge');
  });

  test('a short numeric one-time code as providedCodeHash is rejected as malformed', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge(),
      attempt({ providedCodeHash: '123456' }),
    );
    expect(result.reason).toBe('malformed_attempt');
  });

  test('an uppercase-hex digest is rejected (lowercase hex only)', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ codeHash: GOOD_HASH.toUpperCase() }),
      attempt(),
    );
    expect(result.reason).toBe('malformed_challenge');
  });

  test('a 63-char digest is rejected (too short)', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ codeHash: 'a'.repeat(63) }),
      attempt(),
    );
    expect(result.reason).toBe('malformed_challenge');
  });

  test('a 65-char digest is rejected (too long)', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ codeHash: 'a'.repeat(65) }),
      attempt(),
    );
    expect(result.reason).toBe('malformed_challenge');
  });

  test('a non-hex 64-char digest is rejected', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ codeHash: 'g'.repeat(64) }),
      attempt(),
    );
    expect(result.reason).toBe('malformed_challenge');
  });
});

// ---- 11. malformed challenge battery ------------------------------------

describe('malformed challenge', () => {
  test('non-object challenge values are malformed_challenge', () => {
    for (const value of [null, undefined, 0, 1, '', 'x', true, false, Symbol('s'), 42n, () => {}, []]) {
      const result = classifyWhatsappVerificationRedemption(value, attempt());
      expect(result).toEqual({ decision: 'denied', reason: 'malformed_challenge' });
    }
  });

  test('a missing field is malformed_challenge', () => {
    for (const field of [
      'verificationSchemaVersion', 'challengeRef', 'memberRef', 'phoneRef', 'codeHash',
      'issuedAt', 'expiresAt', 'maxAttempts', 'attemptsMade', 'status',
    ]) {
      const c = challenge();
      delete c[field];
      const result = classifyWhatsappVerificationRedemption(c, attempt());
      expect(result.reason).toBe('malformed_challenge');
    }
  });

  test('an extra enumerable field is malformed_challenge', () => {
    const result = classifyWhatsappVerificationRedemption(challenge({ extra: 1 }), attempt());
    expect(result.reason).toBe('malformed_challenge');
  });

  test('an extra NON-enumerable field is malformed_challenge', () => {
    const c = challenge();
    Object.defineProperty(c, 'hidden', { value: 1, enumerable: false });
    const result = classifyWhatsappVerificationRedemption(c, attempt());
    expect(result.reason).toBe('malformed_challenge');
  });

  test('a symbol-keyed field is malformed_challenge', () => {
    const c = challenge();
    c[Symbol('s')] = 1;
    const result = classifyWhatsappVerificationRedemption(c, attempt());
    expect(result.reason).toBe('malformed_challenge');
  });

  test('a foreign prototype is malformed_challenge', () => {
    const c = Object.assign(Object.create({ injected: true }), challenge());
    const result = classifyWhatsappVerificationRedemption(c, attempt());
    expect(result.reason).toBe('malformed_challenge');
  });

  test('an array is malformed_challenge', () => {
    const result = classifyWhatsappVerificationRedemption([], attempt());
    expect(result.reason).toBe('malformed_challenge');
  });

  test('a wrong schema version is malformed_challenge', () => {
    for (const v of [0, 2, '1', 1.5, null, true]) {
      const result = classifyWhatsappVerificationRedemption(challenge({ verificationSchemaVersion: v }), attempt());
      expect(result.reason).toBe('malformed_challenge');
    }
  });

  test('a bad challengeRef is malformed_challenge', () => {
    for (const v of ['', 'has space', 'a/b', 'a'.repeat(257), 123, null, true]) {
      const result = classifyWhatsappVerificationRedemption(challenge({ challengeRef: v }), attempt({ challengeRef: v }));
      expect(result.reason).toBe('malformed_challenge');
    }
  });

  test('an all-digit memberRef (phone shape) is malformed_challenge — identity requires a letter', () => {
    const result = classifyWhatsappVerificationRedemption(challenge({ memberRef: '15551234567' }), attempt());
    expect(result.reason).toBe('malformed_challenge');
  });

  test('other bad memberRef values are malformed_challenge', () => {
    for (const v of ['', 'has space', 'a'.repeat(257), 123, null, true]) {
      const result = classifyWhatsappVerificationRedemption(challenge({ memberRef: v }), attempt());
      expect(result.reason).toBe('malformed_challenge');
    }
  });

  test('a bad phoneRef is malformed_challenge (but all-digit is fine)', () => {
    for (const v of ['', 'has space', 'a/b', 'a'.repeat(257), 123, null, true]) {
      const result = classifyWhatsappVerificationRedemption(challenge({ phoneRef: v }), attempt());
      expect(result.reason).toBe('malformed_challenge');
    }
  });

  test('a bad issuedAt or expiresAt is malformed_challenge', () => {
    for (const field of ['issuedAt', 'expiresAt']) {
      for (const v of ['', 'not-a-date', '2026-13-01T00:00:00Z', '2026-02-30T00:00:00Z', '2026-07-21T12:00:00', 123, null]) {
        const result = classifyWhatsappVerificationRedemption(challenge({ [field]: v }), attempt());
        expect(result.reason).toBe('malformed_challenge');
      }
    }
  });

  test('a bad maxAttempts is malformed_challenge', () => {
    for (const v of [0, -1, 1.5, NaN, Infinity, -Infinity, 1001, '3', null, true]) {
      const result = classifyWhatsappVerificationRedemption(challenge({ maxAttempts: v }), attempt());
      expect(result.reason).toBe('malformed_challenge');
    }
  });

  test('a bad attemptsMade is malformed_challenge', () => {
    for (const v of [-1, 1.5, NaN, Infinity, -Infinity, 1001, '0', null, true]) {
      const result = classifyWhatsappVerificationRedemption(challenge({ attemptsMade: v }), attempt());
      expect(result.reason).toBe('malformed_challenge');
    }
  });

  test('a bad status is malformed_challenge', () => {
    for (const v of ['PENDING', 'unknown', '', null, 123, true]) {
      const result = classifyWhatsappVerificationRedemption(challenge({ status: v }), attempt());
      expect(result.reason).toBe('malformed_challenge');
    }
  });

  test('an accessor (getter) field is malformed_challenge and the getter is never invoked', () => {
    const c = challenge();
    let invoked = false;
    Object.defineProperty(c, 'status', {
      configurable: true,
      enumerable: true,
      get() { invoked = true; return 'pending'; },
    });
    const result = classifyWhatsappVerificationRedemption(c, attempt());
    expect(result.reason).toBe('malformed_challenge');
    expect(invoked).toBe(false);
  });
});

// ---- 12. malformed attempt battery --------------------------------------

describe('malformed attempt', () => {
  test('non-object attempt values are malformed_attempt', () => {
    for (const value of [null, undefined, 0, 1, '', 'x', true, false, Symbol('s'), 42n, () => {}, []]) {
      const result = classifyWhatsappVerificationRedemption(challenge(), value);
      expect(result).toEqual({ decision: 'denied', reason: 'malformed_attempt' });
    }
  });

  test('a missing field is malformed_attempt', () => {
    for (const field of ['verificationSchemaVersion', 'challengeRef', 'actor', 'providedCodeHash', 'asOf']) {
      const a = attempt();
      delete a[field];
      const result = classifyWhatsappVerificationRedemption(challenge(), a);
      expect(result.reason).toBe('malformed_attempt');
    }
  });

  test('an extra enumerable field is malformed_attempt', () => {
    const result = classifyWhatsappVerificationRedemption(challenge(), attempt({ extra: 1 }));
    expect(result.reason).toBe('malformed_attempt');
  });

  test('an extra NON-enumerable field is malformed_attempt', () => {
    const a = attempt();
    Object.defineProperty(a, 'hidden', { value: 1, enumerable: false });
    const result = classifyWhatsappVerificationRedemption(challenge(), a);
    expect(result.reason).toBe('malformed_attempt');
  });

  test('a symbol-keyed field is malformed_attempt', () => {
    const a = attempt();
    a[Symbol('s')] = 1;
    const result = classifyWhatsappVerificationRedemption(challenge(), a);
    expect(result.reason).toBe('malformed_attempt');
  });

  test('a foreign prototype is malformed_attempt', () => {
    const a = Object.assign(Object.create({ injected: true }), attempt());
    const result = classifyWhatsappVerificationRedemption(challenge(), a);
    expect(result.reason).toBe('malformed_attempt');
  });

  test('a wrong schema version is malformed_attempt', () => {
    for (const v of [0, 2, '1', 1.5, null, true]) {
      const result = classifyWhatsappVerificationRedemption(challenge(), attempt({ verificationSchemaVersion: v }));
      expect(result.reason).toBe('malformed_attempt');
    }
  });

  test('an all-digit actor (phone shape) is malformed_attempt — a phone can never be the redeeming identity', () => {
    const result = classifyWhatsappVerificationRedemption(challenge(), attempt({ actor: '15551234567' }));
    expect(result.reason).toBe('malformed_attempt');
  });

  test('other bad actor values are malformed_attempt', () => {
    for (const v of ['', 'has space', 'a'.repeat(257), 123, null, true]) {
      const result = classifyWhatsappVerificationRedemption(challenge(), attempt({ actor: v }));
      expect(result.reason).toBe('malformed_attempt');
    }
  });

  test('a bad providedCodeHash is malformed_attempt', () => {
    for (const v of ['', '123456', GOOD_HASH.toUpperCase(), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), 123, null]) {
      const result = classifyWhatsappVerificationRedemption(challenge(), attempt({ providedCodeHash: v }));
      expect(result.reason).toBe('malformed_attempt');
    }
  });

  test('a bad asOf is malformed_attempt', () => {
    for (const v of ['', 'not-a-date', '2026-13-01T00:00:00Z', '2026-04-31T00:00:00Z', 123, null]) {
      const result = classifyWhatsappVerificationRedemption(challenge(), attempt({ asOf: v }));
      expect(result.reason).toBe('malformed_attempt');
    }
  });

  test('an accessor (getter) field is malformed_attempt and the getter is never invoked', () => {
    const a = attempt();
    let invoked = false;
    Object.defineProperty(a, 'providedCodeHash', {
      configurable: true,
      enumerable: true,
      get() { invoked = true; return GOOD_HASH; },
    });
    const result = classifyWhatsappVerificationRedemption(challenge(), a);
    expect(result.reason).toBe('malformed_attempt');
    expect(invoked).toBe(false);
  });
});

// ---- 13. hostile inputs never throw / never invoke getters --------------

describe('hostile inputs are total and getter-free', () => {
  test('a revoked proxy as challenge denies as malformed and never throws', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    let result;
    expect(() => { result = classifyWhatsappVerificationRedemption(proxy, attempt()); }).not.toThrow();
    expect(result.reason).toBe('malformed_challenge');
  });

  test('a revoked proxy as attempt denies as malformed and never throws', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    let result;
    expect(() => { result = classifyWhatsappVerificationRedemption(challenge(), proxy); }).not.toThrow();
    expect(result.reason).toBe('malformed_attempt');
  });

  test('a live proxy whose traps throw denies as malformed and never throws', () => {
    const trap = () => { throw new Error('trap'); };
    const proxy = new Proxy({}, {
      get: trap, has: trap, ownKeys: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap,
    });
    let result;
    expect(() => { result = classifyWhatsappVerificationRedemption(proxy, attempt()); }).not.toThrow();
    expect(result.reason).toBe('malformed_challenge');
  });

  test('a challenge with a throwing getter on every field never throws and never invokes them', () => {
    const c = {};
    let invoked = 0;
    for (const field of [
      'verificationSchemaVersion', 'challengeRef', 'memberRef', 'phoneRef', 'codeHash',
      'issuedAt', 'expiresAt', 'maxAttempts', 'attemptsMade', 'status',
    ]) {
      Object.defineProperty(c, field, {
        configurable: true,
        enumerable: true,
        get() { invoked += 1; throw new Error('boom'); },
      });
    }
    let result;
    expect(() => { result = classifyWhatsappVerificationRedemption(c, attempt()); }).not.toThrow();
    expect(result.reason).toBe('malformed_challenge');
    expect(invoked).toBe(0);
  });
});

// ---- 14. calendar-aware timestamp regression ----------------------------

describe('impossible calendar dates are rejected so lexical order equals chronological order', () => {
  const IMPOSSIBLE = [
    '2026-02-29T00:00:00Z', // 2026 is not a leap year
    '2026-02-30T00:00:00Z',
    '2026-02-31T00:00:00Z',
    '2026-04-31T00:00:00Z',
    '2026-06-31T00:00:00Z',
    '2026-09-31T00:00:00Z',
    '2026-11-31T00:00:00Z',
    '2026-00-10T00:00:00Z',
    '2026-13-10T00:00:00Z',
    '2026-07-00T00:00:00Z',
    '2026-07-32T00:00:00Z',
    '2026-07-21T24:00:00Z',
    '2026-07-21T12:60:00Z',
    '2026-07-21T12:00:60Z',
  ];

  test('impossible expiresAt is malformed_challenge', () => {
    for (const ts of IMPOSSIBLE) {
      const result = classifyWhatsappVerificationRedemption(challenge({ expiresAt: ts }), attempt());
      expect(result.reason).toBe('malformed_challenge');
    }
  });

  test('impossible asOf is malformed_attempt', () => {
    for (const ts of IMPOSSIBLE) {
      const result = classifyWhatsappVerificationRedemption(challenge(), attempt({ asOf: ts }));
      expect(result.reason).toBe('malformed_attempt');
    }
  });

  test('a real leap day (2024-02-29) is accepted as a valid instant', () => {
    const result = classifyWhatsappVerificationRedemption(
      challenge({ issuedAt: '2024-02-29T00:00:00Z', expiresAt: '2024-02-29T00:10:00Z' }),
      attempt({ asOf: '2024-02-29T00:05:00Z' }),
    );
    expect(result.decision).toBe('accepted');
  });

  test('month-end boundaries are valid', () => {
    for (const ts of ['2026-01-31T23:59:59Z', '2026-04-30T00:00:00Z', '2026-12-31T23:59:59Z']) {
      const result = classifyWhatsappVerificationRedemption(
        challenge({ expiresAt: ts }),
        attempt({ asOf: '2026-01-01T00:00:00Z' }),
      );
      expect(result.decision).toBe('accepted');
    }
  });
});

// ---- 15. determinism, singletons, immutability --------------------------

describe('determinism and singletons', () => {
  test('the same inputs yield a deeply-equal verdict', () => {
    const a = classifyWhatsappVerificationRedemption(challenge(), attempt());
    const b = classifyWhatsappVerificationRedemption(challenge(), attempt());
    expect(a).toEqual(b);
  });

  test('no-change rejections return the identical frozen singleton', () => {
    const a = classifyWhatsappVerificationRedemption(challenge({ status: 'verified' }), attempt());
    const b = classifyWhatsappVerificationRedemption(challenge({ status: 'verified' }), attempt());
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  test('denials return the identical frozen singleton', () => {
    const a = classifyWhatsappVerificationRedemption(null, attempt());
    const b = classifyWhatsappVerificationRedemption(undefined, attempt());
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  test('every state-changing verdict and its next are frozen', () => {
    const mismatch = classifyWhatsappVerificationRedemption(challenge({ attemptsMade: 0 }), attempt({ providedCodeHash: WRONG_HASH }));
    expect(Object.isFrozen(mismatch)).toBe(true);
    expect(Object.isFrozen(mismatch.next)).toBe(true);
    const voided = classifyWhatsappVerificationRedemption(challenge(), attempt({ asOf: AFTER_EXPIRY }));
    expect(Object.isFrozen(voided)).toBe(true);
    expect(Object.isFrozen(voided.next)).toBe(true);
  });

  test('the classifier does not mutate its inputs', () => {
    const c = challenge({ attemptsMade: 1 });
    const a = attempt({ providedCodeHash: WRONG_HASH });
    const cBefore = JSON.stringify(c);
    const aBefore = JSON.stringify(a);
    classifyWhatsappVerificationRedemption(c, a);
    expect(JSON.stringify(c)).toBe(cBefore);
    expect(JSON.stringify(a)).toBe(aBefore);
  });
});

// ---- 16. confers nothing -------------------------------------------------

describe('confers nothing beyond a channel-control proof', () => {
  test('no verdict ever carries an auth / entitlement / role field', () => {
    const forbidden = /"(role|roles|grant|grants|entitlement|entitlements|auth|token|claim|claims|discount|membership|uid|price|access)"/i;
    const verdicts = [
      classifyWhatsappVerificationRedemption(challenge(), attempt()), // accepted
      classifyWhatsappVerificationRedemption(challenge(), attempt({ providedCodeHash: WRONG_HASH })), // code_mismatch
      classifyWhatsappVerificationRedemption(challenge(), attempt({ asOf: AFTER_EXPIRY })), // expired
      classifyWhatsappVerificationRedemption(challenge({ status: 'verified' }), attempt()), // already_verified
      classifyWhatsappVerificationRedemption(null, attempt()), // denied
    ];
    for (const v of verdicts) {
      expect(forbidden.test(JSON.stringify(v))).toBe(false);
    }
  });

  test('the accept proof is exactly the channel-control assertion — memberRef controls phoneRef', () => {
    const { proof } = classifyWhatsappVerificationRedemption(challenge(), attempt());
    expect(proof).toEqual({ memberRef: MEMBER, phoneRef: PHONE });
  });

  test('rejections and denials carry no proof', () => {
    const reject = classifyWhatsappVerificationRedemption(challenge(), attempt({ providedCodeHash: WRONG_HASH }));
    const deny = classifyWhatsappVerificationRedemption(null, attempt());
    expect(reject).not.toHaveProperty('proof');
    expect(deny).not.toHaveProperty('proof');
  });
});

// ---- 17. source boundary (comment-stripped) -----------------------------

describe('source boundary', () => {
  test('no clock / randomness / network / env / persistence / provider access', () => {
    const patterns = [
      /process\.env/,
      /\bDate\b/,
      /Math\.random/,
      /\bfetch\b/,
      /\brequire\(\s*['"](?!node:util)/, // the only require is node:util
      /firebase/i,
      /firestore/i,
      /stripe/i,
      /\bURL\b/,
    ];
    for (const pattern of patterns) {
      expect(pattern.test(sourceCode)).toBe(false);
    }
  });

  // Holds no code / secret material: the module models redemption purely over
  // opaque handles and a fixed-width digest, so none of the actual secret-value
  // vocabulary may appear anywhere in the code.
  test.each([
    ['secret', /secret/i],
    ['token', /\btoken\b/i],
    ['bearer', /bearer/i],
    ['password', /password/i],
    ['api_key', /api[_-]?key/i],
    ['access_token', /access[_-]?token/i],
    ['refresh_token', /refresh[_-]?token/i],
    ['client_secret', /client[_-]?secret/i],
  ])('no %s vocabulary appears in the code', (_label, pattern) => {
    expect(pattern.test(sourceCode)).toBe(false);
  });

  test('no HTML sink vocabulary appears in the code', () => {
    for (const pattern of [/innerHTML/i, /dangerouslySetInnerHTML/i, /document\./, /<script/i]) {
      expect(pattern.test(sourceCode)).toBe(false);
    }
  });

  test('the module requires only node:util', () => {
    const requires = [...rawSource.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    expect(requires).toEqual(['node:util']);
  });

  test('the header names the issue code', () => {
    expect(rawSource).toMatch(/WHATSAPP-002A/);
  });

  test('functions/index.js does not import this module', () => {
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toMatch(/whatsappVerificationRedemption/);
  });
});
