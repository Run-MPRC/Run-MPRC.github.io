'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  publishReconciliationSchemaVersion,
  IntendedState,
  MediaState,
  ContainerState,
  ReconciliationDecision,
  TerminalState,
  ResolvedReason,
  ManualReviewReason,
  DenialReason,
  classifyPublishReconciliation,
} = require('./instagramPublishReconciliation');

// Opaque url-safe handles. There is no PII/secret in this module's domain at all;
// these exist so the source-boundary battery is non-vacuous, mirroring the siblings.
const POST_REF = 'post_9a8b7c6d';
const ACCOUNT_REF = 'acct_17205550143';
const CONTAINER_REF = 'container_552301';
const MEDIA_REF = '17895695668004550';

// Closed-space iteration lists (distinct from the handle constants above).
const ALL_INTENDED = ['container_created', 'publish_attempted'];
const ALL_MEDIA = ['media_present', 'no_media', 'indeterminate'];
const ALL_CONTAINER = ['container_live', 'container_absent', 'indeterminate'];

function intent(overrides = {}) {
  return {
    publishReconciliationSchemaVersion: 1,
    postRef: POST_REF,
    accountRef: ACCOUNT_REF,
    containerRef: CONTAINER_REF,
    intendedState: 'publish_attempted',
    ...overrides,
  };
}

function observation(overrides = {}) {
  return {
    publishReconciliationSchemaVersion: 1,
    postRef: POST_REF,
    accountRef: ACCOUNT_REF,
    mediaState: 'no_media',
    mediaRef: null,
    containerState: 'container_absent',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Frozen versioned surface & enums
// ---------------------------------------------------------------------------

describe('frozen versioned surface', () => {
  test('schema version is 1', () => {
    expect(publishReconciliationSchemaVersion).toBe(1);
  });

  test('module export is frozen and exposes exactly the intended surface', () => {
    const surface = require('./instagramPublishReconciliation');
    expect(Object.isFrozen(surface)).toBe(true);
    expect(new Set(Object.keys(surface))).toEqual(new Set([
      'publishReconciliationSchemaVersion',
      'IntendedState',
      'MediaState',
      'ContainerState',
      'ReconciliationDecision',
      'TerminalState',
      'ResolvedReason',
      'ManualReviewReason',
      'DenialReason',
      'classifyPublishReconciliation',
    ]));
  });

  test('enums are frozen with the exact expected members', () => {
    expect(Object.isFrozen(IntendedState)).toBe(true);
    expect(new Set(Object.values(IntendedState))).toEqual(new Set(ALL_INTENDED));
    expect(new Set(Object.values(MediaState))).toEqual(new Set(ALL_MEDIA));
    expect(new Set(Object.values(ContainerState))).toEqual(new Set(ALL_CONTAINER));
    expect(new Set(Object.values(ReconciliationDecision))).toEqual(new Set(['resolved', 'manual_review', 'denied']));
    expect(new Set(Object.values(TerminalState))).toEqual(new Set(['published', 'failed']));
    expect(new Set(Object.values(ResolvedReason))).toEqual(new Set(['published_media_confirmed', 'no_publish_no_media']));
    expect(new Set(Object.values(ManualReviewReason))).toEqual(new Set([
      'post_mismatch', 'account_mismatch', 'outcome_indeterminate', 'container_orphan_unverified',
    ]));
    expect(new Set(Object.values(DenialReason))).toEqual(new Set(['malformed_intent', 'malformed_observation']));
  });

  test('the output vocabulary contains NO republish/retry/publish action (crown jewel, structural)', () => {
    // The entire terminal/decision vocabulary must not name any action that would
    // (re)publish. This is the structural guarantee that reconciliation cannot cause
    // a duplicate post — enforced on the enums themselves, not just on outputs.
    const everyOutputToken = [
      ...Object.values(ReconciliationDecision),
      ...Object.values(TerminalState),
      ...Object.values(ResolvedReason),
      ...Object.values(ManualReviewReason),
      ...Object.values(DenialReason),
    ].join(' ');
    expect(everyOutputToken).not.toMatch(/republish|re-publish|retry|publish_now|post_now|resend|repost/i);
  });
});

// ---------------------------------------------------------------------------
// 2. Independent lookup-table oracle over the full 2×3×3 well-formed space
// ---------------------------------------------------------------------------

// An 18-row hand-authored truth table keyed by (intendedState, mediaState,
// containerState). It is a flat lookup with NO shared control-flow structure with
// the implementation's branch order, so it cannot share a branching bug with it.
const ORACLE = {
  // media_present -> published regardless of container/intended
  'container_created|media_present|container_live': ['resolved', 'published_media_confirmed', 'published'],
  'container_created|media_present|container_absent': ['resolved', 'published_media_confirmed', 'published'],
  'container_created|media_present|indeterminate': ['resolved', 'published_media_confirmed', 'published'],
  'publish_attempted|media_present|container_live': ['resolved', 'published_media_confirmed', 'published'],
  'publish_attempted|media_present|container_absent': ['resolved', 'published_media_confirmed', 'published'],
  'publish_attempted|media_present|indeterminate': ['resolved', 'published_media_confirmed', 'published'],
  // indeterminate media -> always manual/outcome_indeterminate
  'container_created|indeterminate|container_live': ['manual_review', 'outcome_indeterminate', null],
  'container_created|indeterminate|container_absent': ['manual_review', 'outcome_indeterminate', null],
  'container_created|indeterminate|indeterminate': ['manual_review', 'outcome_indeterminate', null],
  'publish_attempted|indeterminate|container_live': ['manual_review', 'outcome_indeterminate', null],
  'publish_attempted|indeterminate|container_absent': ['manual_review', 'outcome_indeterminate', null],
  'publish_attempted|indeterminate|indeterminate': ['manual_review', 'outcome_indeterminate', null],
  // no_media -> only container_created + container_absent is a definitive failure
  'container_created|no_media|container_live': ['manual_review', 'container_orphan_unverified', null],
  'container_created|no_media|container_absent': ['resolved', 'no_publish_no_media', 'failed'],
  'container_created|no_media|indeterminate': ['manual_review', 'outcome_indeterminate', null],
  'publish_attempted|no_media|container_live': ['manual_review', 'outcome_indeterminate', null],
  'publish_attempted|no_media|container_absent': ['manual_review', 'outcome_indeterminate', null],
  'publish_attempted|no_media|indeterminate': ['manual_review', 'outcome_indeterminate', null],
};

function fullSpace() {
  const rows = [];
  for (const intendedState of ALL_INTENDED) {
    for (const mediaState of ALL_MEDIA) {
      for (const containerState of ALL_CONTAINER) {
        rows.push({ intendedState, mediaState, containerState });
      }
    }
  }
  return rows;
}

describe('full decision matrix vs independent lookup-table oracle', () => {
  test('the space is exactly 18 combinations and the oracle covers all of them', () => {
    expect(fullSpace()).toHaveLength(18);
    expect(Object.keys(ORACLE)).toHaveLength(18);
  });

  test.each(fullSpace())(
    'intended=$intendedState media=$mediaState container=$containerState matches the oracle',
    ({ intendedState, mediaState, containerState }) => {
      const mediaRef = mediaState === 'media_present' ? MEDIA_REF : null;
      const verdict = classifyPublishReconciliation(
        intent({ intendedState }),
        observation({ mediaState, mediaRef, containerState }),
      );
      const [decision, reason, terminalState] = ORACLE[`${intendedState}|${mediaState}|${containerState}`];
      expect(verdict.decision).toBe(decision);
      expect(verdict.reason).toBe(reason);
      if (terminalState === null) {
        expect(verdict).not.toHaveProperty('next');
      } else {
        expect(verdict.next.terminalState).toBe(terminalState);
        expect(verdict.next.postRef).toBe(POST_REF);
        if (terminalState === 'published') {
          expect(verdict.next.mediaRef).toBe(MEDIA_REF);
        }
      }
    },
  );

  test('the matrix actually exercises every decision + reason (non-vacuous)', () => {
    const seen = new Set();
    for (const { intendedState, mediaState, containerState } of fullSpace()) {
      const mediaRef = mediaState === 'media_present' ? MEDIA_REF : null;
      const v = classifyPublishReconciliation(
        intent({ intendedState }),
        observation({ mediaState, mediaRef, containerState }),
      );
      seen.add(`${v.decision}:${v.reason}`);
    }
    expect(seen).toEqual(new Set([
      'resolved:published_media_confirmed',
      'resolved:no_publish_no_media',
      'manual_review:outcome_indeterminate',
      'manual_review:container_orphan_unverified',
    ]));
  });
});

// ---------------------------------------------------------------------------
// 3. Crown jewel — causesPublish:false everywhere; never a (re)publish action
// ---------------------------------------------------------------------------

describe('crown jewel: no input can cause a (re)publish', () => {
  test('every verdict across the entire well-formed space carries causesPublish:false and no publish action', () => {
    let checked = 0;
    for (const { intendedState, mediaState, containerState } of fullSpace()) {
      const mediaRef = mediaState === 'media_present' ? MEDIA_REF : null;
      const v = classifyPublishReconciliation(
        intent({ intendedState }),
        observation({ mediaState, mediaRef, containerState }),
      );
      expect(v.causesPublish).toBe(false);
      // No verdict may name a republish/retry action anywhere in its serialization.
      expect(JSON.stringify(v)).not.toMatch(/republish|re-publish|retry|resend|repost|publish_now/i);
      // A resolved verdict records a terminal STATE, never an action.
      if (v.decision === 'resolved') {
        expect(['published', 'failed']).toContain(v.next.terminalState);
      }
      checked += 1;
    }
    expect(checked).toBe(18);
  });

  test('malformed and mismatch verdicts also carry causesPublish:false', () => {
    expect(classifyPublishReconciliation(null, observation()).causesPublish).toBe(false);
    expect(classifyPublishReconciliation(intent(), null).causesPublish).toBe(false);
    expect(classifyPublishReconciliation(intent(), observation({ postRef: 'post_other' })).causesPublish).toBe(false);
    expect(classifyPublishReconciliation(intent(), observation({ accountRef: 'acct_other' })).causesPublish).toBe(false);
  });

  test('BOTH observation-forgery directions are duplicate-safe (neither causes a publish)', () => {
    // Forge "media present" where there is none: the reducer stops reconciling
    // (records published) — no republish.
    const forgedPresent = classifyPublishReconciliation(
      intent({ intendedState: 'container_created' }),
      observation({ mediaState: 'media_present', mediaRef: MEDIA_REF, containerState: 'container_live' }),
    );
    expect(forgedPresent.decision).toBe('resolved');
    expect(forgedPresent.next.terminalState).toBe('published');
    expect(forgedPresent.causesPublish).toBe(false);

    // Hide real media as "no_media": the worst outcome is a post marked failed —
    // still no republish.
    const hiddenMedia = classifyPublishReconciliation(
      intent({ intendedState: 'container_created' }),
      observation({ mediaState: 'no_media', mediaRef: null, containerState: 'container_absent' }),
    );
    expect(hiddenMedia.decision).toBe('resolved');
    expect(hiddenMedia.next.terminalState).toBe('failed');
    expect(hiddenMedia.causesPublish).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Positive evidence wins first (a real publish is never mislabeled)
// ---------------------------------------------------------------------------

describe('published requires positive evidence and wins over stale intent', () => {
  test('media_present resolves published even when our record says publish was never attempted', () => {
    const v = classifyPublishReconciliation(
      intent({ intendedState: 'container_created' }),
      observation({ mediaState: 'media_present', mediaRef: MEDIA_REF, containerState: 'container_absent' }),
    );
    expect(v).toEqual({
      decision: 'resolved',
      reason: 'published_media_confirmed',
      next: { postRef: POST_REF, terminalState: 'published', mediaRef: MEDIA_REF },
      causesPublish: false,
    });
  });

  test('published carries the exact observed media handle', () => {
    const v = classifyPublishReconciliation(
      intent(),
      observation({ mediaState: 'media_present', mediaRef: 'other_media_42', containerState: 'container_live' }),
    );
    expect(v.next.mediaRef).toBe('other_media_42');
  });
});

// ---------------------------------------------------------------------------
// 5. failed requires the single definitive negative shape
// ---------------------------------------------------------------------------

describe('failed requires no_media + container_absent + never-attempted', () => {
  test('the definitive-failure shape resolves failed with no media handle', () => {
    const v = classifyPublishReconciliation(
      intent({ intendedState: 'container_created' }),
      observation({ mediaState: 'no_media', mediaRef: null, containerState: 'container_absent' }),
    );
    expect(v).toEqual({
      decision: 'resolved',
      reason: 'no_publish_no_media',
      next: { postRef: POST_REF, terminalState: 'failed' },
      causesPublish: false,
    });
    expect(v.next).not.toHaveProperty('mediaRef');
  });

  test('a publish_attempted post with no media never resolves failed (ambiguous -> manual)', () => {
    for (const containerState of ALL_CONTAINER) {
      const v = classifyPublishReconciliation(
        intent({ intendedState: 'publish_attempted' }),
        observation({ mediaState: 'no_media', mediaRef: null, containerState }),
      );
      expect(v.decision).toBe('manual_review');
      expect(v.reason).toBe('outcome_indeterminate');
    }
  });

  test('never-attempted with a still-live container is an unverified orphan, not a failure', () => {
    const v = classifyPublishReconciliation(
      intent({ intendedState: 'container_created' }),
      observation({ mediaState: 'no_media', mediaRef: null, containerState: 'container_live' }),
    );
    expect(v.decision).toBe('manual_review');
    expect(v.reason).toBe('container_orphan_unverified');
  });
});

// ---------------------------------------------------------------------------
// 6. Binding: unbound observations never resolve
// ---------------------------------------------------------------------------

describe('post/account binding routes unbound evidence to manual review', () => {
  test('a post mismatch never resolves, even with strong positive media evidence', () => {
    const v = classifyPublishReconciliation(
      intent(),
      observation({ postRef: 'post_someone_else', mediaState: 'media_present', mediaRef: MEDIA_REF, containerState: 'container_live' }),
    );
    expect(v.decision).toBe('manual_review');
    expect(v.reason).toBe('post_mismatch');
  });

  test('an account mismatch never resolves, even with a definitive-failure shape', () => {
    const v = classifyPublishReconciliation(
      intent({ intendedState: 'container_created' }),
      observation({ accountRef: 'acct_wrong', mediaState: 'no_media', mediaRef: null, containerState: 'container_absent' }),
    );
    expect(v.decision).toBe('manual_review');
    expect(v.reason).toBe('account_mismatch');
  });

  test('post binding is checked before account binding (deterministic precedence)', () => {
    const v = classifyPublishReconciliation(
      intent(),
      observation({ postRef: 'post_x', accountRef: 'acct_y' }),
    );
    expect(v.reason).toBe('post_mismatch');
  });
});

// ---------------------------------------------------------------------------
// 7. Malformed intent battery -> denied malformed_intent
// ---------------------------------------------------------------------------

describe('malformed intent denies without evaluating the observation', () => {
  const good = observation({ mediaState: 'media_present', mediaRef: MEDIA_REF, containerState: 'container_live' });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['number', 7],
    ['string', 'intent'],
    ['array', [1, 2, 3]],
    ['empty object', {}],
    ['wrong schema version', intent({ publishReconciliationSchemaVersion: 2 })],
    ['string schema version', intent({ publishReconciliationSchemaVersion: '1' })],
    ['unknown intendedState', intent({ intendedState: 'draft' })],
    ['terminal intendedState (not a stuck state)', intent({ intendedState: 'published' })],
    ['non-string intendedState', intent({ intendedState: 1 })],
    ['empty postRef', intent({ postRef: '' })],
    ['postRef with a newline', intent({ postRef: 'post_1\n=cmd' })],
    // A BARE trailing newline is the sharp edge: JS `$` (no `m` flag) anchors at true
    // end-of-string, so this must deny. It locks the anchor semantics — a future
    // refactor that added the `m` flag to HANDLE_PATTERN would let a trailing newline
    // slip into an audit line, and this row would catch it.
    ['postRef with a bare trailing newline', intent({ postRef: 'post_1\n' })],
    ['postRef with a trailing carriage return', intent({ postRef: 'post_1\r' })],
    ['postRef with a line separator U+2028', intent({ postRef: 'post_1\u2028' })],
    ['postRef with a paragraph separator U+2029', intent({ postRef: 'post_1\u2029' })],
    ['postRef with an embedded NUL', intent({ postRef: 'post_1\0' })],
    ['postRef with a tab', intent({ postRef: 'post_1\t' })],
    ['postRef with a comma', intent({ postRef: 'post,1' })],
    ['postRef non-string', intent({ postRef: 12345 })],
    ['null containerRef (both stuck states require a container)', intent({ containerRef: null })],
    ['empty containerRef', intent({ containerRef: '' })],
    ['missing containerRef', (() => { const i = intent(); delete i.containerRef; return i; })()],
    ['extra key', intent({ extra: true })],
    ['over-long ref', intent({ postRef: 'p'.repeat(257) })],
  ])('%s -> denied malformed_intent', (_label, badIntent) => {
    const v = classifyPublishReconciliation(badIntent, good);
    expect(v).toEqual({ decision: 'denied', reason: 'malformed_intent', causesPublish: false });
  });

  test('a non-enumerable extra own property is rejected', () => {
    const i = intent();
    Object.defineProperty(i, 'hidden', { value: 1, enumerable: false });
    expect(classifyPublishReconciliation(i, good).reason).toBe('malformed_intent');
  });

  test('an inherited intendedState does not satisfy the shape', () => {
    const i = intent();
    delete i.intendedState;
    const child = Object.create(i);
    child.intendedState = 'publish_attempted';
    expect(classifyPublishReconciliation(child, good).reason).toBe('malformed_intent');
  });

  test('a symbol-keyed extra property is rejected', () => {
    const i = intent();
    i[Symbol('x')] = 1;
    expect(classifyPublishReconciliation(i, good).reason).toBe('malformed_intent');
  });

  test('an accessor field is never invoked and denies', () => {
    let invoked = 0;
    const i = intent();
    delete i.intendedState;
    Object.defineProperty(i, 'intendedState', {
      enumerable: true,
      get() { invoked += 1; return 'publish_attempted'; },
    });
    expect(classifyPublishReconciliation(i, good).reason).toBe('malformed_intent');
    expect(invoked).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Malformed observation battery -> denied malformed_observation
// ---------------------------------------------------------------------------

describe('malformed observation denies (well-formed intent)', () => {
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['array', []],
    ['empty object', {}],
    ['wrong schema version', observation({ publishReconciliationSchemaVersion: 9 })],
    ['unknown mediaState', observation({ mediaState: 'maybe' })],
    ['unknown containerState', observation({ containerState: 'gone-ish' })],
    ['non-string mediaState', observation({ mediaState: 2 })],
    ['extra key', observation({ extra: 1 })],
    ['missing containerState', (() => { const o = observation(); delete o.containerState; return o; })()],
    ['bad postRef', observation({ postRef: 'post 1' })],
    ['postRef with a bare trailing newline', observation({ postRef: 'post_9a8b7c6d\n' })],
  ])('%s -> denied malformed_observation', (_label, badObs) => {
    const v = classifyPublishReconciliation(intent(), badObs);
    expect(v).toEqual({ decision: 'denied', reason: 'malformed_observation', causesPublish: false });
  });

  describe('mediaRef coherence (present iff media_present)', () => {
    test('media_present without a mediaRef is incoherent -> malformed', () => {
      const v = classifyPublishReconciliation(
        intent(),
        observation({ mediaState: 'media_present', mediaRef: null, containerState: 'container_live' }),
      );
      expect(v.reason).toBe('malformed_observation');
    });

    test('media_present with a non-handle mediaRef -> malformed', () => {
      const v = classifyPublishReconciliation(
        intent(),
        observation({ mediaState: 'media_present', mediaRef: 42, containerState: 'container_live' }),
      );
      expect(v.reason).toBe('malformed_observation');
    });

    test('media_present with a bare trailing-newline mediaRef -> malformed (locks the $ anchor)', () => {
      // A published verdict carries the mediaRef into an audit line; a trailing
      // newline must never reach it. JS `$` (no `m` flag) rejects this.
      const v = classifyPublishReconciliation(
        intent(),
        observation({ mediaState: 'media_present', mediaRef: '17895695668004550\n', containerState: 'container_live' }),
      );
      expect(v.reason).toBe('malformed_observation');
    });

    test('no_media carrying a mediaRef is incoherent -> malformed', () => {
      const v = classifyPublishReconciliation(
        intent(),
        observation({ mediaState: 'no_media', mediaRef: MEDIA_REF, containerState: 'container_absent' }),
      );
      expect(v.reason).toBe('malformed_observation');
    });

    test('indeterminate media carrying a mediaRef is incoherent -> malformed', () => {
      const v = classifyPublishReconciliation(
        intent(),
        observation({ mediaState: 'indeterminate', mediaRef: MEDIA_REF, containerState: 'indeterminate' }),
      );
      expect(v.reason).toBe('malformed_observation');
    });
  });

  test('intent is validated before observation (denied malformed_intent when both are bad)', () => {
    const v = classifyPublishReconciliation({}, {});
    expect(v.reason).toBe('malformed_intent');
  });
});

// ---------------------------------------------------------------------------
// 9. Hostile-input safety: never throw, never invoke getters, reject proxies
// ---------------------------------------------------------------------------

describe('hostile inputs never throw and never invoke accessors', () => {
  test('a revoked proxy as intent denies (isProxy checked before any array/proto op)', () => {
    const { proxy, revoke } = Proxy.revocable({ ...intent() }, {});
    revoke();
    expect(() => classifyPublishReconciliation(proxy, observation())).not.toThrow();
    expect(classifyPublishReconciliation(proxy, observation()).reason).toBe('malformed_intent');
  });

  test('a live proxy as observation denies', () => {
    const p = new Proxy({ ...observation() }, {});
    expect(classifyPublishReconciliation(intent(), p).reason).toBe('malformed_observation');
  });

  test('a throwing accessor on the observation is never invoked', () => {
    let invoked = 0;
    const o = observation();
    delete o.mediaState;
    Object.defineProperty(o, 'mediaState', {
      enumerable: true,
      get() { invoked += 1; throw new Error('should never run'); },
    });
    expect(() => classifyPublishReconciliation(intent(), o)).not.toThrow();
    expect(classifyPublishReconciliation(intent(), o).reason).toBe('malformed_observation');
    expect(invoked).toBe(0);
  });

  test('a proxy whose traps throw is safely rejected, not propagated', () => {
    const hostile = new Proxy({}, {
      ownKeys() { throw new Error('trap'); },
      get() { throw new Error('trap'); },
      getOwnPropertyDescriptor() { throw new Error('trap'); },
    });
    expect(() => classifyPublishReconciliation(hostile, observation())).not.toThrow();
    expect(classifyPublishReconciliation(hostile, observation()).reason).toBe('malformed_intent');
  });
});

// ---------------------------------------------------------------------------
// 10. Determinism, immutability, singletons
// ---------------------------------------------------------------------------

describe('determinism and immutability', () => {
  test('same inputs yield a deeply-frozen verdict', () => {
    const v = classifyPublishReconciliation(
      intent({ intendedState: 'container_created' }),
      observation({ mediaState: 'media_present', mediaRef: MEDIA_REF, containerState: 'container_live' }),
    );
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.next)).toBe(true);
  });

  test('same inputs are deterministic across shuffled key order', () => {
    const a = classifyPublishReconciliation(
      { intendedState: 'container_created', containerRef: CONTAINER_REF, accountRef: ACCOUNT_REF, postRef: POST_REF, publishReconciliationSchemaVersion: 1 },
      { containerState: 'container_absent', mediaRef: null, mediaState: 'no_media', accountRef: ACCOUNT_REF, postRef: POST_REF, publishReconciliationSchemaVersion: 1 },
    );
    const b = classifyPublishReconciliation(intent({ intendedState: 'container_created' }), observation());
    expect(a).toEqual(b);
  });

  test('manual_review and denied verdicts are shared frozen singletons', () => {
    const a = classifyPublishReconciliation(intent(), observation({ postRef: 'post_z' }));
    const b = classifyPublishReconciliation(intent(), observation({ postRef: 'post_z' }));
    expect(a).toBe(b);
    const d1 = classifyPublishReconciliation(null, observation());
    const d2 = classifyPublishReconciliation(5, observation());
    expect(d1).toBe(d2);
  });

  test('inputs are never mutated', () => {
    const i = intent({ intendedState: 'container_created' });
    const o = observation({ mediaState: 'media_present', mediaRef: MEDIA_REF, containerState: 'container_live' });
    const iSnap = JSON.stringify(i);
    const oSnap = JSON.stringify(o);
    classifyPublishReconciliation(i, o);
    expect(JSON.stringify(i)).toBe(iSnap);
    expect(JSON.stringify(o)).toBe(oSnap);
  });

  test('a frozen verdict cannot be tampered by write-through (strict mode)', () => {
    // Object.isFrozen is necessary but not sufficient — prove an actual
    // write-through-and-re-read is a no-op (it throws in this strict-mode file),
    // so a caller cannot flip causesPublish or rewrite the terminal state/mediaRef.
    const v = classifyPublishReconciliation(
      intent({ intendedState: 'container_created' }),
      observation({ mediaState: 'media_present', mediaRef: MEDIA_REF, containerState: 'container_live' }),
    );
    expect(() => { v.causesPublish = true; }).toThrow(TypeError);
    expect(() => { v.decision = 'republish'; }).toThrow(TypeError);
    expect(() => { v.next.terminalState = 'republished'; }).toThrow(TypeError);
    expect(() => { v.next.mediaRef = 'tampered'; }).toThrow(TypeError);
    expect(() => { v.injected = 'x'; }).toThrow(TypeError);
    expect(v.causesPublish).toBe(false);
    expect(v.decision).toBe('resolved');
    expect(v.next.terminalState).toBe('published');
    expect(v.next.mediaRef).toBe(MEDIA_REF);
    expect(v).not.toHaveProperty('injected');
  });
});

// ---------------------------------------------------------------------------
// 11. Source boundary — no post content in the source; imported by nothing
// ---------------------------------------------------------------------------

describe('source boundary', () => {
  const source = fs.readFileSync(path.join(__dirname, 'instagramPublishReconciliation.js'), 'utf8');
  // Strip block and line comments so the checks apply to CODE, not narration.
  const codeOnly = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');

  test('code carries no post-content or member-data vocabulary', () => {
    expect(codeOnly).not.toMatch(/caption|altText|alt_text|mediaBytes|imageBytes|imageData|\bhtml\b|payloadBody|contactEmail|phoneNumber|discountCode|memberRef|rosterRow/i);
  });

  test('code carries no secret/credential vocabulary', () => {
    expect(codeOnly).not.toMatch(/accessToken|refreshToken|clientSecret|bearer|passwordHash|api[_]?key/i);
  });

  test('header names the issue code, section, and SOURCE ONLY UNUSED', () => {
    expect(source).toMatch(/INSTAGRAM-005B/);
    expect(source).toMatch(/§8\.20/);
    expect(source).toMatch(/SOURCE ONLY, UNUSED/);
  });

  test('the module is imported by nothing (no index/route/rules require it)', () => {
    const indexPath = path.join(__dirname, 'index.js');
    if (fs.existsSync(indexPath)) {
      expect(fs.readFileSync(indexPath, 'utf8')).not.toMatch(/instagramPublishReconciliation/);
    }
  });

  test('the module requires only node:util', () => {
    const requires = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    expect(new Set(requires)).toEqual(new Set(['node:util']));
  });
});
