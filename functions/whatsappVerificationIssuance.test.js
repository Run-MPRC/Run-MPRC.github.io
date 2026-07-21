'use strict';

// Tests for the pure WhatsApp verification-code ISSUANCE decision (§8.23,
// WHATSAPP-002B). Negative-heavy: the module is a safety-critical anti-abuse gate
// read from forgeable stored state, so malformed and hostile inputs are normal
// events that must resolve to reason-coded verdicts, never throw. Runs with no
// secrets, no clock, no network, no Firestore.

const fs = require('fs');
const path = require('path');

const issuance = require('./whatsappVerificationIssuance');
const {
  classifyWhatsappVerificationIssuance: classify,
  verificationIssuanceSchemaVersion: SCHEMA,
  IssuanceStatus,
  IssuanceDecision,
  IssueReason,
  RefuseReason,
  DenialReason,
} = issuance;

// ---- fixtures ------------------------------------------------------------

const MEMBER = 'member_abc';
const OTHER_MEMBER = 'member_xyz';
// A phone/WhatsApp handle is legitimately all-digit — it is a channel handle, never
// an identity.
const PHONE = '15551234567';
const OTHER_PHONE = '15559998888';
const CHALLENGE_REF = 'chal_0001';

// Fixed-width UTC instants. Chronological order is REISSUE_PAST < EXPIRES_PAST < ASOF
// < EXPIRES_FUTURE < REISSUE_FUTURE, which (over real calendar dates) is exactly
// their lexical order — the property the reducer relies on.
const REISSUE_PAST = '2026-07-21T11:00:00Z';
const EXPIRES_PAST = '2026-07-21T11:55:00Z';
const ASOF = '2026-07-21T12:00:00Z';
const EXPIRES_FUTURE = '2026-07-21T12:05:00Z';
const REISSUE_FUTURE = '2026-07-21T13:00:00Z';

function request(over = {}) {
  return {
    verificationIssuanceSchemaVersion: SCHEMA,
    memberRef: MEMBER,
    phoneRef: PHONE,
    actor: MEMBER,
    asOf: ASOF,
    ...over,
  };
}

// Default challenge: pending, live (expires in the future), cooldown elapsed
// (reissueAfter in the past) → the "issue superseding" happy path.
function challenge(over = {}) {
  return {
    verificationIssuanceSchemaVersion: SCHEMA,
    challengeRef: CHALLENGE_REF,
    memberRef: MEMBER,
    phoneRef: PHONE,
    status: 'pending',
    expiresAt: EXPIRES_FUTURE,
    reissueAfter: REISSUE_PAST,
    ...over,
  };
}

// An independent, hand-authored oracle of the SEMANTIC decision (assumes
// well-formed inputs). Structured differently from the module so agreement is
// meaningful. Produces the FULL expected verdict.
function oracle(req, chal) {
  if (req.actor !== req.memberRef) return { decision: 'refuse', reason: 'actor_not_owner' };
  if (chal !== null) {
    if (chal.memberRef !== req.memberRef || chal.phoneRef !== req.phoneRef) {
      return { decision: 'refuse', reason: 'subject_mismatch' };
    }
    if (chal.status === 'verified') return { decision: 'refuse', reason: 'already_verified' };
    if (req.asOf < chal.reissueAfter) return { decision: 'refuse', reason: 'cooldown_active' };
    if (chal.status === 'pending' && req.asOf < chal.expiresAt) {
      return {
        decision: 'issue',
        reason: 'superseding',
        subject: { memberRef: req.memberRef, phoneRef: req.phoneRef },
        supersededChallengeRef: chal.challengeRef,
      };
    }
  }
  return {
    decision: 'issue',
    reason: 'fresh',
    subject: { memberRef: req.memberRef, phoneRef: req.phoneRef },
  };
}

// ---- module surface ------------------------------------------------------

describe('module surface', () => {
  test('exports a frozen namespace with the expected members', () => {
    expect(Object.isFrozen(issuance)).toBe(true);
    expect(typeof classify).toBe('function');
    expect(SCHEMA).toBe(1);
    expect(Object.isFrozen(IssuanceStatus)).toBe(true);
    expect(Object.isFrozen(IssuanceDecision)).toBe(true);
    expect(Object.isFrozen(IssueReason)).toBe(true);
    expect(Object.isFrozen(RefuseReason)).toBe(true);
    expect(Object.isFrozen(DenialReason)).toBe(true);
  });

  test('enums expose the exact closed vocabularies', () => {
    expect(new Set(Object.values(IssuanceStatus))).toEqual(new Set(['pending', 'verified', 'voided']));
    expect(new Set(Object.values(IssuanceDecision))).toEqual(new Set(['issue', 'refuse', 'denied']));
    expect(new Set(Object.values(IssueReason))).toEqual(new Set(['fresh', 'superseding']));
    expect(new Set(Object.values(RefuseReason))).toEqual(new Set([
      'actor_not_owner', 'subject_mismatch', 'already_verified', 'cooldown_active',
    ]));
    expect(new Set(Object.values(DenialReason))).toEqual(new Set([
      'malformed_request', 'malformed_current_challenge',
    ]));
  });

  test('the decision/reason vocabulary contains no code, mint, grant, or auth verb', () => {
    // Structural guarantee that an issue verdict authorizes a send and nothing more:
    // no reason implies minting a code/hash here, nor granting auth/membership/role.
    const vocab = [
      ...Object.values(IssuanceDecision),
      ...Object.values(IssueReason),
      ...Object.values(RefuseReason),
      ...Object.values(DenialReason),
    ].join(' ').toLowerCase();
    for (const forbidden of ['code', 'hash', 'secret', 'token', 'grant', 'auth', 'member ', 'role', 'verified_now']) {
      expect(vocab.includes(forbidden)).toBe(false);
    }
    // (`already_verified` legitimately contains "verified" — a lifecycle state, not
    // an act of granting; the forbidden list avoids that substring deliberately.)
  });
});

// ---- decision matrix vs the oracle --------------------------------------

describe('decision matrix agrees with an independent oracle', () => {
  const cases = [
    ['actor not owner, no challenge', request({ actor: OTHER_MEMBER }), null],
    ['actor not owner outranks a present challenge', request({ actor: OTHER_MEMBER }), challenge()],
    ['subject mismatch on member', request(), challenge({ memberRef: OTHER_MEMBER })],
    ['subject mismatch on phone', request(), challenge({ phoneRef: OTHER_PHONE })],
    ['verified pair (cooldown elapsed)', request(), challenge({ status: 'verified' })],
    ['verified outranks an active cooldown', request(), challenge({ status: 'verified', reissueAfter: REISSUE_FUTURE })],
    ['cooldown active, pending prior', request(), challenge({ status: 'pending', reissueAfter: REISSUE_FUTURE })],
    ['cooldown active, voided prior (void->reissue loop)', request(), challenge({ status: 'voided', reissueAfter: REISSUE_FUTURE })],
    ['issue fresh, no challenge', request(), null],
    ['issue fresh, voided prior cooled', request(), challenge({ status: 'voided', reissueAfter: REISSUE_PAST })],
    ['issue fresh, pending-but-expired prior cooled', request(), challenge({ status: 'pending', expiresAt: EXPIRES_PAST, reissueAfter: REISSUE_PAST })],
    ['issue superseding, pending live prior cooled', request(), challenge()],
  ];

  for (const [name, req, chal] of cases) {
    test(name, () => {
      expect(classify(req, chal)).toEqual(oracle(req, chal));
    });
  }

  test('the curated matrix exercises every decision:reason pair', () => {
    const seen = new Set(
      cases.map(([, req, chal]) => {
        const v = classify(req, chal);
        return `${v.decision}:${v.reason}`;
      }),
    );
    expect(seen).toEqual(new Set([
      'refuse:actor_not_owner',
      'refuse:subject_mismatch',
      'refuse:already_verified',
      'refuse:cooldown_active',
      'issue:fresh',
      'issue:superseding',
    ]));
  });
});

// ---- owner-bound ---------------------------------------------------------

describe('owner-bound: only the member may request their own code', () => {
  test('an actor other than the member refuses and issues nothing', () => {
    const v = classify(request({ actor: OTHER_MEMBER }), null);
    expect(v).toEqual({ decision: 'refuse', reason: 'actor_not_owner' });
  });

  test('actor_not_owner is checked before any challenge state is consulted', () => {
    // Even with a verified pair and an active cooldown present, an unauthorized actor
    // gets actor_not_owner — leaking nothing about the challenge.
    for (const chal of [
      challenge({ status: 'verified' }),
      challenge({ status: 'pending', reissueAfter: REISSUE_FUTURE }),
      challenge({ memberRef: OTHER_MEMBER }),
    ]) {
      expect(classify(request({ actor: OTHER_MEMBER }), chal))
        .toEqual({ decision: 'refuse', reason: 'actor_not_owner' });
    }
  });

  test('the owning member is permitted (baseline)', () => {
    expect(classify(request({ actor: MEMBER }), null).decision).toBe('issue');
  });
});

// ---- idempotent on verified ----------------------------------------------

describe('idempotent on verified: a proven pair never gets another code', () => {
  test('a verified challenge refuses already_verified', () => {
    expect(classify(request(), challenge({ status: 'verified' })))
      .toEqual({ decision: 'refuse', reason: 'already_verified' });
  });

  test('already_verified holds regardless of expiry or cooldown', () => {
    for (const over of [
      { status: 'verified', expiresAt: EXPIRES_PAST },
      { status: 'verified', reissueAfter: REISSUE_FUTURE },
      { status: 'verified', reissueAfter: REISSUE_PAST, expiresAt: EXPIRES_FUTURE },
    ]) {
      expect(classify(request(), challenge(over)).reason).toBe('already_verified');
    }
  });
});

// ---- cooldown-bounded ----------------------------------------------------

describe('cooldown-bounded: no reissue before reissueAfter', () => {
  test('a pending prior inside its cooldown refuses cooldown_active', () => {
    expect(classify(request(), challenge({ status: 'pending', reissueAfter: REISSUE_FUTURE })))
      .toEqual({ decision: 'refuse', reason: 'cooldown_active' });
  });

  test('a VOIDED prior inside its cooldown also refuses (exhaust->void->reissue is blocked)', () => {
    // This is the composition with §8.16: exhausting the attempt budget voids the
    // challenge, but a fresh budget cannot be minted until the cooldown elapses.
    expect(classify(request(), challenge({ status: 'voided', reissueAfter: REISSUE_FUTURE })))
      .toEqual({ decision: 'refuse', reason: 'cooldown_active' });
  });

  test('asOf exactly at reissueAfter is allowed (inclusive lower bound — cooldown elapsed)', () => {
    const at = classify(request({ asOf: ASOF }), challenge({ reissueAfter: ASOF }));
    expect(at.decision).toBe('issue');
  });

  test('asOf one instant before reissueAfter is refused', () => {
    const before = classify(
      request({ asOf: '2026-07-21T12:59:59Z' }),
      challenge({ reissueAfter: REISSUE_FUTURE }),
    );
    expect(before).toEqual({ decision: 'refuse', reason: 'cooldown_active' });
  });
});

// ---- at-most-one-live via supersession -----------------------------------

describe('at-most-one-live: supersession keeps a single live challenge per pair', () => {
  test('a live pending prior is superseded and named for the caller to void', () => {
    const v = classify(request(), challenge({ challengeRef: CHALLENGE_REF }));
    expect(v.decision).toBe('issue');
    expect(v.reason).toBe('superseding');
    // The named ref is the EXISTING prior challenge — not a minted value.
    expect(v.supersededChallengeRef).toBe(CHALLENGE_REF);
  });

  test('a fresh issue names no superseded challenge', () => {
    for (const chal of [
      null,
      challenge({ status: 'voided', reissueAfter: REISSUE_PAST }),
      challenge({ status: 'pending', expiresAt: EXPIRES_PAST, reissueAfter: REISSUE_PAST }),
    ]) {
      const v = classify(request(), chal);
      expect(v.reason).toBe('fresh');
      expect('supersededChallengeRef' in v).toBe(false);
    }
  });

  test('asOf exactly at expiresAt is expired — issue is fresh, not superseding', () => {
    const v = classify(request({ asOf: ASOF }), challenge({ status: 'pending', expiresAt: ASOF, reissueAfter: REISSUE_PAST }));
    expect(v.reason).toBe('fresh');
    expect('supersededChallengeRef' in v).toBe(false);
  });

  test('a live pending prior one instant from expiry still supersedes', () => {
    const v = classify(
      request({ asOf: ASOF }),
      challenge({ status: 'pending', expiresAt: '2026-07-21T12:00:01Z', reissueAfter: REISSUE_PAST }),
    );
    expect(v.reason).toBe('superseding');
  });
});

// ---- subject-bound -------------------------------------------------------

describe('subject-bound: never decide from another pair\'s challenge', () => {
  test('a challenge for a different member refuses subject_mismatch', () => {
    expect(classify(request(), challenge({ memberRef: OTHER_MEMBER })))
      .toEqual({ decision: 'refuse', reason: 'subject_mismatch' });
  });

  test('a challenge for a different phone refuses subject_mismatch', () => {
    expect(classify(request(), challenge({ phoneRef: OTHER_PHONE })))
      .toEqual({ decision: 'refuse', reason: 'subject_mismatch' });
  });

  test('subject_mismatch outranks a would-be verified/cooldown on the wrong pair', () => {
    // A verified/cooling challenge for the WRONG pair must not shortcut this request.
    expect(classify(request(), challenge({ memberRef: OTHER_MEMBER, status: 'verified' })).reason)
      .toBe('subject_mismatch');
    expect(classify(request(), challenge({ phoneRef: OTHER_PHONE, reissueAfter: REISSUE_FUTURE })).reason)
      .toBe('subject_mismatch');
  });
});

// ---- mints nothing / content-free ---------------------------------------

describe('mints nothing / content-free', () => {
  test('an issue:fresh verdict has exactly {decision, reason, subject}', () => {
    const v = classify(request(), null);
    expect(Object.keys(v).sort()).toEqual(['decision', 'reason', 'subject']);
    expect(Object.keys(v.subject).sort()).toEqual(['memberRef', 'phoneRef']);
    expect(v.subject).toEqual({ memberRef: MEMBER, phoneRef: PHONE });
  });

  test('an issue:superseding verdict adds only supersededChallengeRef', () => {
    const v = classify(request(), challenge());
    expect(Object.keys(v).sort()).toEqual(['decision', 'reason', 'subject', 'supersededChallengeRef']);
  });

  test('no verdict ever carries a code, hash, secret, token, or minted challenge id', () => {
    const verdicts = [
      classify(request(), null),
      classify(request(), challenge()),
      classify(request(), challenge({ status: 'verified' })),
      classify(request({ actor: OTHER_MEMBER }), null),
      classify(request(), challenge({ reissueAfter: REISSUE_FUTURE })),
      classify({}, null),
    ];
    const forbidden = /code|hash|secret|token|otp|pin|digest|password|bearer|newchallenge/i;
    for (const v of verdicts) {
      const json = JSON.stringify(v);
      expect(forbidden.test(json)).toBe(false);
      // The only ref a verdict may carry is a superseded (existing) one — never a
      // freshly-minted challenge id.
      if ('supersededChallengeRef' in v) {
        expect(v.supersededChallengeRef).toBe(CHALLENGE_REF);
      }
    }
  });
});

// ---- precedence ----------------------------------------------------------

describe('precedence', () => {
  test('malformed_request outranks malformed_current_challenge', () => {
    expect(classify({}, {})).toEqual({ decision: 'denied', reason: 'malformed_request' });
  });

  test('a valid request with a malformed challenge denies malformed_current_challenge', () => {
    expect(classify(request(), {})).toEqual({ decision: 'denied', reason: 'malformed_current_challenge' });
  });

  test('actor_not_owner outranks subject/verified/cooldown', () => {
    expect(classify(request({ actor: OTHER_MEMBER }), challenge({ memberRef: OTHER_MEMBER, status: 'verified', reissueAfter: REISSUE_FUTURE })).reason)
      .toBe('actor_not_owner');
  });

  // Structural validation of BOTH inputs precedes the actor gate (the actor gate is
  // the first *semantic* gate, not the first check). So a non-owner actor paired with
  // a structurally malformed currentChallenge reports the structural denial, not
  // actor_not_owner. This is by design and safe: the only returns reachable before the
  // actor gate are the two malformed *denials*, so actor != memberRef can never reach
  // an issue path, and a denial reveals nothing about stored challenge state (it only
  // reflects the shape of the object the caller itself assembled).
  test('structural malformed_current_challenge outranks actor_not_owner (by design, safe)', () => {
    expect(classify(request({ actor: OTHER_MEMBER }), {}))
      .toEqual({ decision: 'denied', reason: 'malformed_current_challenge' });
    // ...and malformed_request still outranks both, even with a bad actor + bad challenge.
    expect(classify({ actor: OTHER_MEMBER }, {}))
      .toEqual({ decision: 'denied', reason: 'malformed_request' });
  });

  // The safety consequence of the ordering above, stated directly: across the full
  // matrix of well-formed challenge shapes (null / every status / matching+mismatching
  // subject / past+future cooldown), a request whose actor is not the member NEVER
  // yields an issue — it is always refused (or, for malformed challenge input, denied),
  // never granted.
  test('no actor != memberRef input ever reaches an issue decision', () => {
    const challenges = [
      null,
      challenge({ status: 'pending', expiresAt: EXPIRES_FUTURE, reissueAfter: REISSUE_PAST }),
      challenge({ status: 'pending', expiresAt: EXPIRES_PAST, reissueAfter: REISSUE_PAST }),
      challenge({ status: 'voided', reissueAfter: REISSUE_PAST }),
      challenge({ status: 'verified', reissueAfter: REISSUE_PAST }),
      challenge({ memberRef: OTHER_MEMBER, status: 'pending', expiresAt: EXPIRES_FUTURE, reissueAfter: REISSUE_PAST }),
      challenge({ phoneRef: OTHER_PHONE, status: 'pending', expiresAt: EXPIRES_FUTURE, reissueAfter: REISSUE_PAST }),
    ];
    for (const chal of challenges) {
      const verdict = classify(request({ actor: OTHER_MEMBER }), chal);
      expect(verdict.decision).not.toBe('issue');
    }
  });

  test('subject_mismatch outranks already_verified and cooldown_active', () => {
    expect(classify(request(), challenge({ memberRef: OTHER_MEMBER, status: 'verified', reissueAfter: REISSUE_FUTURE })).reason)
      .toBe('subject_mismatch');
  });

  test('already_verified outranks cooldown_active', () => {
    expect(classify(request(), challenge({ status: 'verified', reissueAfter: REISSUE_FUTURE })).reason)
      .toBe('already_verified');
  });
});

// ---- null is the sole "no challenge" signal ------------------------------

describe('null is the sole no-challenge signal', () => {
  test('literal null means no prior challenge and issues fresh', () => {
    expect(classify(request(), null)).toEqual({
      decision: 'issue', reason: 'fresh', subject: { memberRef: MEMBER, phoneRef: PHONE },
    });
  });

  test('undefined is NOT the no-challenge signal — it denies malformed', () => {
    expect(classify(request(), undefined)).toEqual({ decision: 'denied', reason: 'malformed_current_challenge' });
  });

  test('other falsy non-nulls deny malformed', () => {
    for (const v of [0, '', false, NaN]) {
      expect(classify(request(), v)).toEqual({ decision: 'denied', reason: 'malformed_current_challenge' });
    }
  });
});

// ---- malformed request battery -------------------------------------------

describe('malformed request denies malformed_request', () => {
  const bad = {
    'wrong schema version (0)': request({ verificationIssuanceSchemaVersion: 0 }),
    'wrong schema version (2)': request({ verificationIssuanceSchemaVersion: 2 }),
    'string schema version': request({ verificationIssuanceSchemaVersion: '1' }),
    'empty memberRef': request({ memberRef: '' }),
    'all-digit memberRef (phone masquerade)': request({ memberRef: '15551234567' }),
    'over-long memberRef': request({ memberRef: `m${'a'.repeat(256)}` }),
    'memberRef with space': request({ memberRef: 'mem ber' }),
    'memberRef trailing newline': request({ memberRef: 'member_abc\n' }),
    'memberRef trailing CR': request({ memberRef: 'member_abc\r' }),
    'memberRef trailing LS': request({ memberRef: 'member_abc\u2028' }),
    'memberRef trailing PS': request({ memberRef: 'member_abc\u2029' }),
    'numeric memberRef': request({ memberRef: 123 }),
    'null memberRef': request({ memberRef: null }),
    'empty phoneRef': request({ phoneRef: '' }),
    'phoneRef with space': request({ phoneRef: '1555 1234' }),
    'phoneRef trailing newline': request({ phoneRef: '15551234567\n' }),
    'over-long phoneRef': request({ phoneRef: '1'.repeat(257) }),
    'numeric phoneRef': request({ phoneRef: 15551234567 }),
    'empty actor': request({ actor: '' }),
    'all-digit actor': request({ actor: '15551234567' }),
    'actor trailing newline': request({ actor: 'member_abc\n' }),
    'null actor': request({ actor: null }),
    'asOf not a date': request({ asOf: 'yesterday' }),
    'asOf month 13': request({ asOf: '2026-13-01T00:00:00Z' }),
    'asOf Feb 30': request({ asOf: '2026-02-30T00:00:00Z' }),
    'asOf hour 24': request({ asOf: '2026-07-21T24:00:00Z' }),
    'asOf minute 60': request({ asOf: '2026-07-21T12:60:00Z' }),
    'asOf second 60': request({ asOf: '2026-07-21T12:00:60Z' }),
    'asOf missing Z': request({ asOf: '2026-07-21T12:00:00' }),
    'asOf with millis': request({ asOf: '2026-07-21T12:00:00.000Z' }),
    'asOf trailing newline': request({ asOf: '2026-07-21T12:00:00Z\n' }),
    'numeric asOf': request({ asOf: 1700000000 }),
  };

  for (const [name, value] of Object.entries(bad)) {
    test(name, () => {
      expect(classify(value, null)).toEqual({ decision: 'denied', reason: 'malformed_request' });
    });
  }

  test('non-leap Feb 29 denies but leap Feb 29 is accepted', () => {
    expect(classify(request({ asOf: '2026-02-29T00:00:00Z' }), null).decision).toBe('denied');
    expect(classify(request({ asOf: '2024-02-29T00:00:00Z' }), null).decision).toBe('issue');
  });
});

// ---- malformed current-challenge battery ---------------------------------

describe('malformed current challenge denies malformed_current_challenge', () => {
  const bad = {
    'wrong schema version': challenge({ verificationIssuanceSchemaVersion: 2 }),
    'empty challengeRef': challenge({ challengeRef: '' }),
    'challengeRef with space': challenge({ challengeRef: 'chal 1' }),
    'challengeRef trailing newline': challenge({ challengeRef: 'chal_0001\n' }),
    'numeric challengeRef': challenge({ challengeRef: 1 }),
    'all-digit memberRef': challenge({ memberRef: '15551234567' }),
    'empty memberRef': challenge({ memberRef: '' }),
    'empty phoneRef': challenge({ phoneRef: '' }),
    'phoneRef with space': challenge({ phoneRef: '1 2' }),
    'unknown status': challenge({ status: 'expired' }),
    'numeric status': challenge({ status: 1 }),
    'status pending mixed-case': challenge({ status: 'Pending' }),
    'expiresAt not a date': challenge({ expiresAt: 'soon' }),
    'expiresAt Feb 30': challenge({ expiresAt: '2026-02-30T00:00:00Z' }),
    'expiresAt with millis': challenge({ expiresAt: '2026-07-21T12:05:00.000Z' }),
    'reissueAfter not a date': challenge({ reissueAfter: 'later' }),
    'reissueAfter hour 24': challenge({ reissueAfter: '2026-07-21T24:00:00Z' }),
    'reissueAfter trailing newline': challenge({ reissueAfter: '2026-07-21T11:00:00Z\n' }),
  };

  for (const [name, value] of Object.entries(bad)) {
    test(name, () => {
      expect(classify(request(), value)).toEqual({ decision: 'denied', reason: 'malformed_current_challenge' });
    });
  }
});

// ---- structural hostile-input safety (both positions) --------------------

describe('structural hostile-input safety', () => {
  function structuralCases(base) {
    const missing = base();
    delete missing.asOf; // request path; harmless label for challenge path too
    const extra = base();
    extra.extra = 'x';
    const inherited = Object.create({ injected: 'x' });
    Object.assign(inherited, base());
    const nonEnumExtra = base();
    Object.defineProperty(nonEnumExtra, 'hidden', { value: 1, enumerable: false });
    const symbolKey = base();
    symbolKey[Symbol('s')] = 1;
    return { missing, extra, inherited, nonEnumExtra, symbolKey };
  }

  test('request: proxy, revoked proxy, array, foreign prototype, and shape deviations deny', () => {
    const p = new Proxy(request(), {});
    const { proxy: revoked, revoke } = Proxy.revocable(request(), {});
    revoke();
    const foreign = Object.assign(Object.create({ x: 1 }), request());
    const s = structuralCases(request);
    for (const value of [p, revoked, [], request.call, foreign, s.extra, s.inherited, s.nonEnumExtra, s.symbolKey, 'str', 42, true]) {
      expect(classify(value, null)).toEqual({ decision: 'denied', reason: 'malformed_request' });
    }
    // Array specifically.
    expect(classify([SCHEMA, MEMBER, PHONE, MEMBER, ASOF], null).reason).toBe('malformed_request');
  });

  test('current challenge: proxy, revoked proxy, array, foreign prototype, and shape deviations deny', () => {
    const p = new Proxy(challenge(), {});
    const { proxy: revoked, revoke } = Proxy.revocable(challenge(), {});
    revoke();
    const foreign = Object.assign(Object.create({ x: 1 }), challenge());
    const s = structuralCases(challenge);
    for (const value of [p, revoked, [], foreign, s.extra, s.inherited, s.nonEnumExtra, s.symbolKey, 'str', 42, true]) {
      expect(classify(request(), value)).toEqual({ decision: 'denied', reason: 'malformed_current_challenge' });
    }
  });

  test('an accessor property is never invoked (getter side effect does not fire)', () => {
    let invoked = 0;
    const hostile = request();
    Object.defineProperty(hostile, 'memberRef', {
      get() { invoked += 1; return MEMBER; },
      enumerable: true,
      configurable: true,
    });
    expect(classify(hostile, null)).toEqual({ decision: 'denied', reason: 'malformed_request' });
    expect(invoked).toBe(0);
  });

  test('a descriptor-forging / trap-counting proxy denies with zero traps fired', () => {
    let traps = 0;
    const target = request();
    const handler = {
      get(t, k, r) { traps += 1; return Reflect.get(t, k, r); },
      getOwnPropertyDescriptor(t, k) { traps += 1; return Reflect.getOwnPropertyDescriptor(t, k); },
      ownKeys(t) { traps += 1; return Reflect.ownKeys(t); },
      has(t, k) { traps += 1; return Reflect.has(t, k); },
      getPrototypeOf(t) { traps += 1; return Reflect.getPrototypeOf(t); },
    };
    const p = new Proxy(target, handler);
    expect(classify(p, null)).toEqual({ decision: 'denied', reason: 'malformed_request' });
    expect(traps).toBe(0); // isProxy rejects before any trap can fire
  });
});

// ---- never throws --------------------------------------------------------

describe('never throws on any input', () => {
  const weird = [
    undefined, null, NaN, Infinity, -Infinity, 0, -0, '', 'x', 42, true, false,
    Symbol('s'), () => {}, [], [1, 2, 3], {}, new Map(), new Set(),
    Object.create(null), new Date(0), /re/, BigInt(1),
  ];

  test('first argument: any weird value resolves to a frozen denial, never a throw', () => {
    for (const value of weird) {
      let out;
      expect(() => { out = classify(value, null); }).not.toThrow();
      expect(out.decision === 'denied' || out.decision === 'issue' || out.decision === 'refuse').toBe(true);
      expect(Object.isFrozen(out)).toBe(true);
    }
  });

  test('second argument: any weird value resolves without throwing', () => {
    for (const value of weird) {
      let out;
      expect(() => { out = classify(request(), value); }).not.toThrow();
      expect(Object.isFrozen(out)).toBe(true);
    }
  });

  test('a cyclic input never throws', () => {
    const c = request();
    c.self = c;
    expect(() => classify(c, null)).not.toThrow();
    expect(classify(c, null).reason).toBe('malformed_request');
    const d = challenge();
    d.self = d;
    expect(classify(request(), d).reason).toBe('malformed_current_challenge');
  });
});

// ---- determinism / immutability / singletons -----------------------------

describe('determinism, immutability, singletons', () => {
  test('same inputs yield deeply equal, frozen verdicts', () => {
    const a = classify(request(), challenge());
    const b = classify(request(), challenge());
    expect(a).toEqual(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.subject)).toBe(true);
  });

  test('denial and refusal verdicts are shared frozen singletons', () => {
    expect(classify({}, null)).toBe(classify({}, null));
    expect(classify(request({ actor: OTHER_MEMBER }), null)).toBe(classify(request({ actor: OTHER_MEMBER }), null));
    expect(classify(request(), challenge({ status: 'verified' }))).toBe(classify(request(), challenge({ status: 'verified' })));
  });

  test('a strict-mode write to a frozen verdict throws and does not mutate', () => {
    'use strict';
    const v = classify(request(), null);
    expect(() => { v.decision = 'hacked'; }).toThrow();
    expect(v.decision).toBe('issue');
    expect(() => { v.subject.memberRef = 'x'; }).toThrow();
    expect(v.subject.memberRef).toBe(MEMBER);
  });

  test('mutating an input record after the call does not affect the returned verdict', () => {
    const chal = challenge();
    const v = classify(request(), chal);
    chal.challengeRef = 'mutated';
    expect(v.supersededChallengeRef).toBe(CHALLENGE_REF);
  });
});

// ---- clockless / lexical UTC = chronological -----------------------------

describe('clockless: lexical UTC comparison equals chronological order', () => {
  test('fixed-width real-date instants compare lexically as chronologically', () => {
    // reissueAfter strictly after asOf → refuse; strictly before/equal → issue.
    const later = '2026-12-31T23:59:59Z';
    const earlier = '2020-01-01T00:00:00Z';
    expect(classify(request({ asOf: ASOF }), challenge({ reissueAfter: later })).reason).toBe('cooldown_active');
    expect(classify(request({ asOf: ASOF }), challenge({ reissueAfter: earlier })).decision).toBe('issue');
  });

  test('year-boundary ordering is respected', () => {
    expect(classify(
      request({ asOf: '2026-12-31T23:59:59Z' }),
      challenge({ reissueAfter: '2027-01-01T00:00:00Z' }),
    ).reason).toBe('cooldown_active');
  });
});

// ---- phone can never masquerade as an identity ---------------------------

describe('phone can never masquerade as the member or actor', () => {
  test('an all-digit value is a valid phone handle but never a valid member/actor', () => {
    // Valid as phoneRef (handle).
    expect(classify(request({ phoneRef: '441234567890' }), null).decision).toBe('issue');
    // Invalid as memberRef or actor (identity requires a letter).
    expect(classify(request({ memberRef: '441234567890' }), null).reason).toBe('malformed_request');
    expect(classify(request({ actor: '441234567890' }), null).reason).toBe('malformed_request');
  });
});

// ---- source-boundary checks ----------------------------------------------

describe('source boundary', () => {
  const src = fs.readFileSync(path.join(__dirname, 'whatsappVerificationIssuance.js'), 'utf8');
  // Strip line and block comments so the checks see only executable source.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  test('holds no code / hash / secret / token / PII vocabulary in executable source', () => {
    for (const forbidden of [
      /\bcode\b/i, /\bhash\b/i, /\bsecret\b/i, /\btoken\b/i, /\bbearer\b/i,
      /\bpassword\b/i, /\botp\b/i, /\bpin\b/i, /\bdigest\b/i, /\bcredential\b/i,
      /\bplaintext\b/i, /\bemail\b/i, /\baddress\b/i, /\bdob\b/i,
    ]) {
      expect(forbidden.test(code)).toBe(false);
    }
  });

  test('requires only node:util and nothing else', () => {
    const requires = [...code.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    expect(requires).toEqual(['node:util']);
  });

  test('is imported by nothing in the functions tree (source only, unused)', () => {
    const files = fs.readdirSync(__dirname)
      .filter((f) => f.endsWith('.js') && f !== 'whatsappVerificationIssuance.js' && f !== 'whatsappVerificationIssuance.test.js');
    for (const f of files) {
      const body = fs.readFileSync(path.join(__dirname, f), 'utf8');
      expect(body.includes('whatsappVerificationIssuance')).toBe(false);
    }
  });

  test('carries its SYSTEM_DESIGN §8.23 / WHATSAPP-002B provenance header', () => {
    expect(src.includes('WHATSAPP-002B')).toBe(true);
    expect(src.includes('§8.23')).toBe(true);
    expect(src.includes('SOURCE ONLY, UNUSED')).toBe(true);
  });
});
