'use strict';

// Tests for INSTAGRAM-004A — pure event-reminder-draft generation reconciliation.
// SOURCE ONLY, UNUSED (imported by nothing; see SYSTEM_DESIGN.md §8.22).
//
// Coverage: frozen export surface + a structural "no approve/publish vocabulary"
// enum check; the full eventAdmission × existing-draft-presence decision matrix vs an
// independent hand-authored oracle + a non-vacuous coverage assertion; draft-id
// determinism + four-axis injectivity + the idempotency loop closure (generate →
// feed the draft back → skip); the crown-jewel never-auto-approve battery; the
// revision-monotone supersede semantics (regenerate names a DISTINCT stale draft; only
// an active old-revision draft regenerates, a terminal one generates); the
// withdrawal-fail-safe path (cancelled/withheld + active → cancel_pending regardless of
// revision); slot coherence (slot_mismatch on identity, NOT on revision); malformed
// -slot and malformed-existing-draft batteries; hostile-input never-throws;
// determinism/immutability/singletons incl. a strict-mode write-through tamper; and a
// comment-stripped source boundary.

const fs = require('fs');
const path = require('path');

const mod = require('./instagramReminderGeneration');
const { classifyEventReminderGeneration: classify } = mod;

// ---- fixtures ------------------------------------------------------------

const EVENT_REF = 'evt_2025_summer_kickoff';
const OTHER_EVENT_REF = 'evt_2025_winter_gala';
const REV_A = 'rev_0001';
const REV_B = 'rev_0002';
const TEMPLATE_ID = 'tmpl_event_reminder_default';
const OTHER_TEMPLATE_ID = 'tmpl_event_reminder_terse';
const LEAD = 1440; // one day, in minutes
const OTHER_LEAD = 10080; // one week

function slot(overrides = {}) {
  return {
    eventReminderSchemaVersion: 1,
    eventRef: EVENT_REF,
    sourceRevision: REV_A,
    eventAdmission: 'publishable',
    templateId: TEMPLATE_ID,
    leadTimeMinutes: LEAD,
    ...overrides,
  };
}

function existingDraft(overrides = {}) {
  return {
    eventReminderSchemaVersion: 1,
    eventRef: EVENT_REF,
    sourceRevision: REV_A,
    templateId: TEMPLATE_ID,
    leadTimeMinutes: LEAD,
    lifecycle: 'active',
    ...overrides,
  };
}

// An independent transcription of the draft-id format — hand-written here so a drift in
// the module's join is caught rather than mirrored.
function expectId(eventRef, rev, templateId, lead) {
  return `er1|${eventRef}|${rev}|${templateId}|${lead}`;
}

// The five distinct existing-draft presences the decision turns on. `same`/`diff` are
// relative to the slot's revision (REV_A).
function presence(kind) {
  switch (kind) {
    case 'none': return null;
    case 'same_active': return existingDraft({ sourceRevision: REV_A, lifecycle: 'active' });
    case 'same_terminal': return existingDraft({ sourceRevision: REV_A, lifecycle: 'terminal' });
    case 'diff_active': return existingDraft({ sourceRevision: REV_B, lifecycle: 'active' });
    case 'diff_terminal': return existingDraft({ sourceRevision: REV_B, lifecycle: 'terminal' });
    default: throw new Error(`unknown presence ${kind}`);
  }
}

// Independent hand-authored oracle: a flat table keyed by (admission, presence) that
// shares no control flow with the implementation's branch order.
const ORACLE = [
  { admission: 'publishable', p: 'none', decision: 'generate' },
  { admission: 'publishable', p: 'same_active', decision: 'skip', reason: 'already_current' },
  { admission: 'publishable', p: 'same_terminal', decision: 'skip', reason: 'already_current' },
  { admission: 'publishable', p: 'diff_active', decision: 'regenerate' },
  { admission: 'publishable', p: 'diff_terminal', decision: 'generate' },
  { admission: 'cancelled', p: 'none', decision: 'skip', reason: 'already_absent' },
  { admission: 'cancelled', p: 'same_active', decision: 'cancel_pending', reason: 'event_cancelled' },
  { admission: 'cancelled', p: 'same_terminal', decision: 'skip', reason: 'already_absent' },
  { admission: 'cancelled', p: 'diff_active', decision: 'cancel_pending', reason: 'event_cancelled' },
  { admission: 'cancelled', p: 'diff_terminal', decision: 'skip', reason: 'already_absent' },
  { admission: 'withheld', p: 'none', decision: 'skip', reason: 'already_absent' },
  { admission: 'withheld', p: 'same_active', decision: 'cancel_pending', reason: 'event_withheld' },
  { admission: 'withheld', p: 'same_terminal', decision: 'skip', reason: 'already_absent' },
  { admission: 'withheld', p: 'diff_active', decision: 'cancel_pending', reason: 'event_withheld' },
  { admission: 'withheld', p: 'diff_terminal', decision: 'skip', reason: 'already_absent' },
];

// ---- 1. export surface + no approve/publish vocabulary -------------------

describe('export surface', () => {
  test('exports exactly the documented frozen surface', () => {
    expect(Object.isFrozen(mod)).toBe(true);
    expect(Object.keys(mod).sort()).toEqual([
      'CancelReason',
      'DenialReason',
      'DraftLifecycle',
      'EventAdmission',
      'GenerationDecision',
      'SkipReason',
      'classifyEventReminderGeneration',
      'eventReminderSchemaVersion',
    ].sort());
    expect(mod.eventReminderSchemaVersion).toBe(1);
    expect(typeof classify).toBe('function');
  });

  test('every enum is frozen and non-empty', () => {
    for (const name of ['EventAdmission', 'DraftLifecycle', 'GenerationDecision', 'SkipReason', 'CancelReason', 'DenialReason']) {
      expect(Object.isFrozen(mod[name])).toBe(true);
      expect(Object.values(mod[name]).length).toBeGreaterThan(0);
    }
  });

  test('the decision/reason vocabulary contains NO approve/publish action', () => {
    // Structural encoding of "never auto-approve": if the vocabulary cannot express an
    // approve/publish, no code path can emit one.
    const vocab = [
      ...Object.values(mod.GenerationDecision),
      ...Object.values(mod.SkipReason),
      ...Object.values(mod.CancelReason),
      ...Object.values(mod.DenialReason),
    ];
    for (const term of vocab) {
      expect(term).not.toMatch(/approv/i);
      expect(term).not.toMatch(/publish/i);
    }
  });

  test('enum values match the documented sets', () => {
    expect(Object.values(mod.EventAdmission).sort()).toEqual(['cancelled', 'publishable', 'withheld']);
    expect(Object.values(mod.DraftLifecycle).sort()).toEqual(['active', 'terminal']);
    expect(Object.values(mod.GenerationDecision).sort()).toEqual(['cancel_pending', 'denied', 'generate', 'regenerate', 'skip']);
    expect(Object.values(mod.SkipReason).sort()).toEqual(['already_absent', 'already_current']);
    expect(Object.values(mod.CancelReason).sort()).toEqual(['event_cancelled', 'event_withheld']);
    expect(Object.values(mod.DenialReason).sort()).toEqual(['malformed_existing_draft', 'malformed_slot', 'slot_mismatch']);
  });
});

// ---- 2. core decision matrix vs independent oracle -----------------------

describe('decision matrix vs independent oracle', () => {
  for (const row of ORACLE) {
    test(`${row.admission} × ${row.p} -> ${row.decision}${row.reason ? ` ${row.reason}` : ''}`, () => {
      const v = classify(slot({ eventAdmission: row.admission }), presence(row.p));
      expect(v.decision).toBe(row.decision);
      if (row.reason) expect(v.reason).toBe(row.reason);

      if (row.decision === 'generate') {
        // A fresh draft is always for the SLOT's (current) revision, REV_A.
        expect(v.draftId).toBe(expectId(EVENT_REF, REV_A, TEMPLATE_ID, LEAD));
        expect(v.sourceRevision).toBe(REV_A);
        expect(v.autoApproved).toBe(false);
        expect(v).not.toHaveProperty('supersededDraftId');
      }
      if (row.decision === 'regenerate') {
        expect(v.draftId).toBe(expectId(EVENT_REF, REV_A, TEMPLATE_ID, LEAD)); // new = slot rev
        expect(v.supersededDraftId).toBe(expectId(EVENT_REF, REV_B, TEMPLATE_ID, LEAD)); // old = draft rev
        expect(v.draftId).not.toBe(v.supersededDraftId);
        expect(v.priorRevision).toBe(REV_B);
        expect(v.supersedesPriorRevision).toBe(true);
        expect(v.autoApproved).toBe(false);
      }
      if (row.decision === 'cancel_pending') {
        // The id targets the EXISTING draft's revision (what to cancel).
        const draftRev = row.p.startsWith('same') ? REV_A : REV_B;
        expect(v.draftId).toBe(expectId(EVENT_REF, draftRev, TEMPLATE_ID, LEAD));
        expect(v.sourceRevision).toBe(draftRev);
      }
    });
  }

  test('non-vacuous coverage: every decision and reason is exercised by the matrix', () => {
    const seen = new Set();
    for (const row of ORACLE) {
      const v = classify(slot({ eventAdmission: row.admission }), presence(row.p));
      seen.add(v.decision);
      if (v.reason) seen.add(v.reason);
    }
    for (const term of [
      'generate', 'regenerate', 'skip', 'cancel_pending',
      'already_current', 'already_absent', 'event_cancelled', 'event_withheld',
    ]) {
      expect(seen.has(term)).toBe(true);
    }
  });
});

// ---- 3. draft identity: determinism, injectivity, idempotency loop -------

describe('draft identity and idempotency', () => {
  test('generate is deterministic (same inputs -> byte-identical verdict)', () => {
    const a = classify(slot(), null);
    const b = classify(slot(), null);
    expect(a).toEqual(b);
    expect(a.draftId).toBe(b.draftId);
  });

  test('draftId is injective across each of the four identity axes', () => {
    const base = classify(slot(), null).draftId;
    const byEvent = classify(slot({ eventRef: OTHER_EVENT_REF }), null).draftId;
    const byRev = classify(slot({ sourceRevision: REV_B }), null).draftId;
    const byTemplate = classify(slot({ templateId: OTHER_TEMPLATE_ID }), null).draftId;
    const byLead = classify(slot({ leadTimeMinutes: OTHER_LEAD }), null).draftId;
    const ids = [base, byEvent, byRev, byTemplate, byLead];
    expect(new Set(ids).size).toBe(ids.length); // all distinct
  });

  test('idempotency loop closes: generate, feed the draft back, then skip', () => {
    const gen = classify(slot(), null);
    expect(gen.decision).toBe('generate');
    // The draft the caller would persist from that verdict, at the same revision.
    const persisted = existingDraft({ sourceRevision: gen.sourceRevision, lifecycle: 'active' });
    const again = classify(slot(), persisted);
    expect(again.decision).toBe('skip');
    expect(again.reason).toBe('already_current');
    // And once more (still idempotent).
    expect(classify(slot(), persisted).decision).toBe('skip');
  });

  test('idempotency holds even after the draft goes terminal at the same revision', () => {
    const persisted = existingDraft({ sourceRevision: REV_A, lifecycle: 'terminal' });
    const v = classify(slot({ sourceRevision: REV_A }), persisted);
    expect(v.decision).toBe('skip');
    expect(v.reason).toBe('already_current');
  });

  test('-0 leadTimeMinutes is accepted and identical to 0 (no phantom distinct tuple)', () => {
    const zero = classify(slot({ leadTimeMinutes: 0 }), null);
    const negZero = classify(slot({ leadTimeMinutes: -0 }), null);
    expect(negZero.decision).toBe('generate');
    expect(negZero.draftId).toBe(zero.draftId);
    expect(negZero.draftId).toBe(expectId(EVENT_REF, REV_A, TEMPLATE_ID, 0));
    // A draft persisted at 0 is the SAME tuple as a -0 slot, so it idempotently skips.
    expect(classify(slot({ leadTimeMinutes: -0 }), existingDraft({ leadTimeMinutes: 0 })).decision)
      .toBe('skip');
  });
});

// ---- 4. crown jewel: never auto-approve ----------------------------------

describe('never auto-approve', () => {
  test('every draft-minting verdict stamps autoApproved:false', () => {
    for (const p of ['none', 'diff_active', 'diff_terminal']) {
      const v = classify(slot({ eventAdmission: 'publishable' }), presence(p));
      if (v.decision === 'generate' || v.decision === 'regenerate') {
        expect(v.autoApproved).toBe(false);
      }
    }
  });

  test('NO verdict anywhere in the matrix carries autoApproved:true', () => {
    for (const row of ORACLE) {
      const v = classify(slot({ eventAdmission: row.admission }), presence(row.p));
      expect(v.autoApproved).not.toBe(true);
    }
  });

  test('no verdict exposes an approved/published decision', () => {
    for (const row of ORACLE) {
      const v = classify(slot({ eventAdmission: row.admission }), presence(row.p));
      expect(['generate', 'regenerate', 'skip', 'cancel_pending', 'denied']).toContain(v.decision);
    }
  });
});

// ---- 5. revision-monotone supersede --------------------------------------

describe('revision-monotone supersede', () => {
  test('a new revision over an ACTIVE old-revision draft regenerates and names a distinct stale draft', () => {
    const v = classify(
      slot({ sourceRevision: REV_B }),
      existingDraft({ sourceRevision: REV_A, lifecycle: 'active' }),
    );
    expect(v.decision).toBe('regenerate');
    expect(v.sourceRevision).toBe(REV_B);
    expect(v.priorRevision).toBe(REV_A);
    expect(v.draftId).toBe(expectId(EVENT_REF, REV_B, TEMPLATE_ID, LEAD));
    expect(v.supersededDraftId).toBe(expectId(EVENT_REF, REV_A, TEMPLATE_ID, LEAD));
    expect(v.draftId).not.toBe(v.supersededDraftId);
  });

  test('a new revision over a TERMINAL old-revision draft generates fresh (nothing to supersede)', () => {
    const v = classify(
      slot({ sourceRevision: REV_B }),
      existingDraft({ sourceRevision: REV_A, lifecycle: 'terminal' }),
    );
    expect(v.decision).toBe('generate');
    expect(v.draftId).toBe(expectId(EVENT_REF, REV_B, TEMPLATE_ID, LEAD));
    expect(v).not.toHaveProperty('supersededDraftId');
  });

  test('the superseded id is the OLD draft revision, the new id is the CURRENT slot revision', () => {
    const v = classify(
      slot({ sourceRevision: 'rev_9999' }),
      existingDraft({ sourceRevision: 'rev_0001', lifecycle: 'active' }),
    );
    expect(v.draftId).toContain('rev_9999');
    expect(v.supersededDraftId).toContain('rev_0001');
  });
});

// ---- 6. withdrawal is fail-safe ------------------------------------------

describe('withdrawal fail-safe', () => {
  test('a cancelled event cancels an ACTIVE draft (any revision)', () => {
    for (const rev of [REV_A, REV_B]) {
      const v = classify(
        slot({ eventAdmission: 'cancelled' }),
        existingDraft({ sourceRevision: rev, lifecycle: 'active' }),
      );
      expect(v.decision).toBe('cancel_pending');
      expect(v.reason).toBe('event_cancelled');
      expect(v.draftId).toBe(expectId(EVENT_REF, rev, TEMPLATE_ID, LEAD));
    }
  });

  test('a WITHHELD event (no longer public) cancels an ACTIVE draft — the leak-safety path', () => {
    const v = classify(
      slot({ eventAdmission: 'withheld' }),
      existingDraft({ sourceRevision: REV_A, lifecycle: 'active' }),
    );
    expect(v.decision).toBe('cancel_pending');
    expect(v.reason).toBe('event_withheld');
  });

  test('a not-publishable event with no active draft is a no-op (already_absent)', () => {
    for (const admission of ['cancelled', 'withheld']) {
      expect(classify(slot({ eventAdmission: admission }), null).reason).toBe('already_absent');
      expect(classify(slot({ eventAdmission: admission }), existingDraft({ lifecycle: 'terminal' })).reason)
        .toBe('already_absent');
    }
  });

  test('a withheld/cancelled event never generates or regenerates', () => {
    for (const admission of ['cancelled', 'withheld']) {
      for (const p of ['none', 'same_active', 'same_terminal', 'diff_active', 'diff_terminal']) {
        const v = classify(slot({ eventAdmission: admission }), presence(p));
        expect(['generate', 'regenerate']).not.toContain(v.decision);
      }
    }
  });
});

// ---- 7. slot coherence ---------------------------------------------------

describe('slot coherence', () => {
  test('a draft for a different EVENT denies slot_mismatch', () => {
    const v = classify(slot(), existingDraft({ eventRef: OTHER_EVENT_REF }));
    expect(v.decision).toBe('denied');
    expect(v.reason).toBe('slot_mismatch');
  });

  test('a draft for a different TEMPLATE denies slot_mismatch', () => {
    const v = classify(slot(), existingDraft({ templateId: OTHER_TEMPLATE_ID }));
    expect(v).toEqual({ decision: 'denied', reason: 'slot_mismatch' });
  });

  test('a draft for a different LEAD TIME denies slot_mismatch', () => {
    const v = classify(slot(), existingDraft({ leadTimeMinutes: OTHER_LEAD }));
    expect(v.reason).toBe('slot_mismatch');
  });

  test('a draft for a different REVISION is NOT a mismatch (it is the change signal)', () => {
    const v = classify(
      slot({ sourceRevision: REV_A }),
      existingDraft({ sourceRevision: REV_B, lifecycle: 'active' }),
    );
    expect(v.decision).toBe('regenerate');
  });

  test('slot_mismatch outranks a withdrawal admission (never cancel another slot\'s draft)', () => {
    // A mismatched draft belongs to a DIFFERENT slot; a cancelled/withheld event here must
    // not reach in and cancel it. Coherence is checked before the admission branch, so the
    // fail-safe withdrawal path can never act on the wrong draft.
    for (const admission of ['cancelled', 'withheld']) {
      const v = classify(
        slot({ eventAdmission: admission }),
        existingDraft({ templateId: OTHER_TEMPLATE_ID, lifecycle: 'active' }),
      );
      expect(v).toEqual({ decision: 'denied', reason: 'slot_mismatch' });
    }
  });
});

// ---- 8. malformed-slot battery -------------------------------------------

describe('malformed slot -> denied malformed_slot', () => {
  const good = () => existingDraft();
  const bad = {
    'null': null,
    'undefined': undefined,
    number: 5,
    string: 'nope',
    boolean: true,
    array: [],
    'array with fields': Object.assign([], slot()),
    'foreign prototype': Object.assign(Object.create({ injected: 1 }), slot()),
    'null prototype': Object.assign(Object.create(null), slot()),
    'missing field': (() => { const s = slot(); delete s.templateId; return s; })(),
    'extra field': { ...slot(), sneaky: 1 },
    // Same key COUNT as a valid slot, but one name is wrong — exercises the membership
    // check, not just the length bound.
    'field-name swap (right key count, wrong name)': (() => { const s = slot(); delete s.templateId; s.template_id = TEMPLATE_ID; return s; })(),
    'wrong schema version': slot({ eventReminderSchemaVersion: 2 }),
    'schema version as string': slot({ eventReminderSchemaVersion: '1' }),
    'unknown admission': slot({ eventAdmission: 'maybe' }),
    'admission published (post state, not admission)': slot({ eventAdmission: 'published' }),
    'empty eventRef': slot({ eventRef: '' }),
    'eventRef too long': slot({ eventRef: 'a'.repeat(257) }),
    'eventRef with delimiter': slot({ eventRef: 'evt|x' }),
    'eventRef with space': slot({ eventRef: 'evt x' }),
    // The HANDLE_PATTERN $ anchor carries no `m` flag: JS `$` matches only the absolute
    // end of input, so a trailing line terminator must be rejected (adding `m` would let a
    // handle end in a newline, corrupting draftId structure and audit lines).
    'eventRef trailing newline': slot({ eventRef: 'evt\n' }),
    'eventRef trailing carriage return': slot({ eventRef: 'evt\r' }),
    'eventRef trailing line separator U+2028': slot({ eventRef: 'evt\u2028' }),
    'eventRef trailing paragraph separator U+2029': slot({ eventRef: 'evt\u2029' }),
    'eventRef non-string': slot({ eventRef: 123 }),
    'bad sourceRevision': slot({ sourceRevision: 'rev\n1' }),
    'bad templateId': slot({ templateId: 'tmpl/../x' }),
    'lead negative': slot({ leadTimeMinutes: -1 }),
    'lead non-integer': slot({ leadTimeMinutes: 10.5 }),
    'lead over max': slot({ leadTimeMinutes: 43201 }),
    'lead NaN': slot({ leadTimeMinutes: NaN }),
    'lead Infinity': slot({ leadTimeMinutes: Infinity }),
    'lead string': slot({ leadTimeMinutes: '1440' }),
    'lead bigint': slot({ leadTimeMinutes: 1440n }),
    'lead boolean': slot({ leadTimeMinutes: true }),
  };

  for (const [name, value] of Object.entries(bad)) {
    test(name, () => {
      const v = classify(value, good());
      expect(v).toEqual({ decision: 'denied', reason: 'malformed_slot' });
    });
  }

  test('a symbol-keyed slot denies', () => {
    const s = slot();
    s[Symbol('x')] = 1;
    expect(classify(s, good()).reason).toBe('malformed_slot');
  });

  test('an accessor-backed slot field denies WITHOUT invoking the getter', () => {
    let touched = false;
    const s = slot();
    delete s.eventAdmission;
    Object.defineProperty(s, 'eventAdmission', {
      enumerable: true,
      configurable: true,
      get() { touched = true; return 'publishable'; },
    });
    const v = classify(s, good());
    expect(v.reason).toBe('malformed_slot');
    expect(touched).toBe(false);
  });

  test('malformed slot takes precedence over a malformed draft', () => {
    expect(classify(5, 5)).toEqual({ decision: 'denied', reason: 'malformed_slot' });
  });
});

// ---- 9. malformed-existing-draft battery ---------------------------------

describe('malformed existing draft -> denied malformed_existing_draft', () => {
  const bad = {
    number: 5,
    string: 'nope',
    boolean: true,
    array: [],
    'foreign prototype': Object.assign(Object.create({ injected: 1 }), existingDraft()),
    'missing field': (() => { const d = existingDraft(); delete d.lifecycle; return d; })(),
    'extra field': { ...existingDraft(), sneaky: 1 },
    'wrong schema version': existingDraft({ eventReminderSchemaVersion: 0 }),
    'unknown lifecycle': existingDraft({ lifecycle: 'zombie' }),
    'lifecycle draft (too granular)': existingDraft({ lifecycle: 'pending_review' }),
    'bad eventRef': existingDraft({ eventRef: '' }),
    'bad sourceRevision': existingDraft({ sourceRevision: 'a'.repeat(257) }),
    'bad templateId': existingDraft({ templateId: 'x|y' }),
    'bad lead': existingDraft({ leadTimeMinutes: -5 }),
  };

  for (const [name, value] of Object.entries(bad)) {
    test(name, () => {
      const v = classify(slot(), value);
      expect(v).toEqual({ decision: 'denied', reason: 'malformed_existing_draft' });
    });
  }

  test('a literal null draft is NOT malformed — it means "no draft yet" and generates', () => {
    const v = classify(slot(), null);
    expect(v.decision).toBe('generate');
  });

  test('undefined draft IS malformed (only a literal null signals "none")', () => {
    expect(classify(slot(), undefined).reason).toBe('malformed_existing_draft');
  });

  test('an accessor-backed draft field denies WITHOUT invoking the getter', () => {
    let touched = false;
    const d = existingDraft();
    delete d.lifecycle;
    Object.defineProperty(d, 'lifecycle', {
      enumerable: true,
      configurable: true,
      get() { touched = true; return 'active'; },
    });
    expect(classify(slot(), d).reason).toBe('malformed_existing_draft');
    expect(touched).toBe(false);
  });
});

// ---- 10. hostile input never throws --------------------------------------

describe('hostile input never throws', () => {
  function revokedProxy() {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    return proxy;
  }
  function trapThrowingProxy() {
    return new Proxy({}, { ownKeys() { throw new Error('trap'); }, get() { throw new Error('trap'); } });
  }
  function throwingGetterObject() {
    const o = {};
    Object.defineProperty(o, 'eventAdmission', { enumerable: true, get() { throw new Error('boom'); } });
    return o;
  }

  const hostiles = [
    null, undefined, 0, 1, -1, NaN, Infinity, '', 'x', true, false, Symbol('s'), 1440n,
    [], [1, 2, 3], {}, Object.create(null),
    revokedProxy(), trapThrowingProxy(), throwingGetterObject(),
    new Proxy([], {}), new Date(), () => {}, /re/,
  ];

  test('never throws for any hostile value in either argument position', () => {
    for (const a of hostiles) {
      for (const b of hostiles) {
        expect(() => classify(a, b)).not.toThrow();
        const v = classify(a, b);
        expect(Object.isFrozen(v)).toBe(true);
        expect(['generate', 'regenerate', 'skip', 'cancel_pending', 'denied']).toContain(v.decision);
      }
    }
  });

  test('hostile values against a valid counterpart still deny (never partially interpret)', () => {
    for (const h of hostiles) {
      if (h === null) continue; // null is the legitimate "no draft" signal
      expect(classify(h, existingDraft()).decision).toBe('denied');
    }
    for (const h of hostiles) {
      if (h === null) continue;
      expect(classify(slot(), h).decision).toBe('denied');
    }
  });

  test('a descriptor-forging proxy is rejected by the isProxy guard with NO trap consulted', () => {
    // Even a Proxy whose traps would forge a perfectly valid data descriptor must be
    // rejected structurally — the isProxy check fires before any own-key/descriptor read,
    // so no trap can smuggle a value (or a getter) past readExact.
    let trapCalls = 0;
    const p = new Proxy(slot(), {
      getOwnPropertyDescriptor(t, k) { trapCalls += 1; return Object.getOwnPropertyDescriptor(t, k); },
      ownKeys(t) { trapCalls += 1; return Reflect.ownKeys(t); },
      get(t, k) { trapCalls += 1; return t[k]; },
    });
    expect(classify(p, existingDraft())).toEqual({ decision: 'denied', reason: 'malformed_slot' });
    expect(trapCalls).toBe(0);
  });

  test('a self-referential (cyclic) input never throws and denies', () => {
    const c = slot();
    c.self = c; // a cycle, and an extra key the closed-shape read rejects before any recursion
    expect(() => classify(c, null)).not.toThrow();
    expect(classify(c, null).reason).toBe('malformed_slot');
  });
});

// ---- 11. determinism, immutability, singletons ---------------------------

describe('determinism, immutability, singletons', () => {
  test('returned verdicts are frozen', () => {
    for (const row of ORACLE) {
      expect(Object.isFrozen(classify(slot({ eventAdmission: row.admission }), presence(row.p)))).toBe(true);
    }
  });

  test('skip and denied verdicts are shared singletons (identity-equal across calls)', () => {
    expect(classify(slot(), existingDraft())).toBe(classify(slot(), existingDraft())); // skip already_current
    expect(classify(5, null)).toBe(classify(5, null)); // denied malformed_slot
  });

  test('generate/regenerate/cancel verdicts are fresh but deep-equal for equal inputs', () => {
    const a = classify(slot(), null);
    const b = classify(slot(), null);
    expect(a).not.toBe(b); // fresh (carries data)
    expect(a).toEqual(b);
  });

  test('a returned verdict cannot be mutated (strict-mode write-through throws)', () => {
    'use strict';
    const v = classify(slot(), null);
    expect(() => { v.decision = 'regenerate'; }).toThrow(TypeError);
    expect(() => { v.autoApproved = true; }).toThrow(TypeError);
    expect(() => { v.newField = 1; }).toThrow(TypeError);
    expect(v.decision).toBe('generate');
    expect(v.autoApproved).toBe(false);
  });

  test('mutating an input object after the call does not change the (already-returned) verdict', () => {
    const s = slot();
    const v = classify(s, null);
    s.eventRef = 'mutated';
    expect(v.eventRef).toBe(EVENT_REF);
  });
});

// ---- 12. source boundary -------------------------------------------------

describe('source boundary', () => {
  const src = fs.readFileSync(path.join(__dirname, 'instagramReminderGeneration.js'), 'utf8');
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // strip line comments (leave the :// in node:util)

  test('the CODE carries no post-content or PII vocabulary', () => {
    const forbidden = [
      'caption', 'media', 'alt text', 'secret', 'password', 'bearer',
      'token', 'discount', 'strava', 'whatsapp', 'roster',
      'date of birth', 'emergency contact', 'address', 'phone number', 'payload hash',
    ];
    for (const word of forbidden) {
      const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      expect(re.test(codeOnly)).toBe(false);
    }
  });

  test('the module requires only node:util', () => {
    const requires = [...src.matchAll(/require\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(requires).toEqual(["'node:util'"]);
  });

  test('the header names the §8.22 design section and its parent #94', () => {
    expect(src).toContain('SYSTEM_DESIGN.md §8.22');
    expect(src).toContain('#94');
    expect(src).toContain('SOURCE ONLY, UNUSED');
  });

  test('the module is imported by nothing (not present in index.js)', () => {
    const indexPath = path.join(__dirname, 'index.js');
    if (fs.existsSync(indexPath)) {
      expect(fs.readFileSync(indexPath, 'utf8')).not.toContain('instagramReminderGeneration');
    }
  });
});
