'use strict';

// Tests for EVENTS-001B / §8.6a — pure approved-event-source admission contract.
//
// Coverage: the admit happy path and identity; the source-authorization battery
// (not-approved / inactive / non-public-kind / source-mismatch); the public/protected
// boundary (allowlist, never denylist) crown jewel; the injective idempotency key; the
// never-auto-publish invariant asserted structurally; malformed-approved-source and
// malformed-delivery batteries; check-ordering (fail-closed precedence); a never-throws
// hostile-input sweep in both argument positions; determinism/immutability/frozen
// singletons; and comment-stripped source-boundary checks (require set = {node:util},
// header markers, no protected/secret vocabulary in code, imported by nothing).

const fs = require('fs');
const path = require('path');

const mod = require('./eventSourceAdmission');
const {
  eventSourceAdmissionSchemaVersion,
  SourceKind,
  AdmissionDecision,
  RefusalReason,
  DenialReason,
  classifyEventSourceAdmission,
} = mod;

// ---- fixtures ------------------------------------------------------------

function approvedSource(overrides = {}) {
  return {
    eventSourceAdmissionSchemaVersion: 1,
    sourceId: 'src-mprc-cal',
    sourceKind: 'mprc_hosted_event',
    active: true,
    ...overrides,
  };
}

function delivery(overrides = {}) {
  return {
    eventSourceAdmissionSchemaVersion: 1,
    sourceId: 'src-mprc-cal',
    sourceEventId: 'evt-2026-summer-5k',
    sourceRevision: 'rev-3',
    eventType: 'mprc_hosted_race',
    title: 'Summer 5K',
    summary: 'A friendly neighborhood 5K.',
    startsAt: '2026-08-01T15:00:00Z',
    endsAt: '2026-08-01T17:00:00Z',
    timezone: 'America/New_York',
    locationText: 'City Park, North Lawn',
    publicUrl: 'https://example.org/summer-5k',
    accessibilityText: 'Wheelchair accessible route.',
    protectedOfferRef: null,
    ...overrides,
  };
}

const ADMIT_KEYS = [
  'decision', 'reason', 'draftId', 'sourceId', 'sourceEventId', 'sourceRevision',
  'sourceKind', 'protectedOfferRef', 'lifecycle', 'published',
];

// A battery of hostile / exotic values used across never-throws and malformed suites.
function hostileValues() {
  const values = [
    undefined, null, true, false, 0, 1, -1, NaN, Infinity, -Infinity, 42, 'str', '',
    Symbol('s'), 10n, [], [1, 2, 3], {}, Object.create(null),
    Object.create({ inherited: 1 }), new Map(), new Set(), new Date(),
    function named() {}, () => {}, /regex/,
  ];
  // trap-throwing proxy
  values.push(new Proxy({}, {
    get() { throw new Error('get trap'); },
    ownKeys() { throw new Error('ownKeys trap'); },
    getOwnPropertyDescriptor() { throw new Error('descriptor trap'); },
    getPrototypeOf() { throw new Error('proto trap'); },
  }));
  // revoked proxy
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  values.push(proxy);
  // cyclic
  const cyclic = {};
  cyclic.self = cyclic;
  values.push(cyclic);
  // enumerable getter that throws
  const boom = {};
  Object.defineProperty(boom, 'title', { get() { throw new Error('boom'); }, enumerable: true, configurable: true });
  values.push(boom);
  return values;
}

// ---- admit happy path ----------------------------------------------------

describe('admit — the happy path', () => {
  test('an approved, active, public-eligible source with a well-formed delivery is admitted', () => {
    const v = classifyEventSourceAdmission(approvedSource(), delivery());
    expect(v).toEqual({
      decision: 'admit',
      reason: 'admitted',
      draftId: 'esa1|src-mprc-cal|evt-2026-summer-5k|rev-3',
      sourceId: 'src-mprc-cal',
      sourceEventId: 'evt-2026-summer-5k',
      sourceRevision: 'rev-3',
      sourceKind: 'mprc_hosted_event',
      protectedOfferRef: null,
      lifecycle: 'draft',
      published: false,
    });
  });

  test('admit carries only opaque identity + disposition — no event content is echoed', () => {
    const v = classifyEventSourceAdmission(approvedSource(), delivery());
    expect(Object.keys(v).sort()).toEqual([...ADMIT_KEYS].sort());
    // none of the public-candidate CONTENT fields ride into the verdict
    for (const field of ['title', 'summary', 'startsAt', 'endsAt', 'timezone',
      'locationText', 'publicUrl', 'accessibilityText', 'eventType']) {
      expect(Object.prototype.hasOwnProperty.call(v, field)).toBe(false);
    }
  });

  test('each public-eligible source kind admits', () => {
    for (const kind of ['mprc_hosted_event', 'club_run_or_social', 'third_party_race_listing']) {
      const v = classifyEventSourceAdmission(approvedSource({ sourceKind: kind }), delivery());
      expect(v.decision).toBe('admit');
      expect(v.sourceKind).toBe(kind);
    }
  });

  test('a protected offer may be referenced only by an opaque id, echoed verbatim', () => {
    const v = classifyEventSourceAdmission(
      approvedSource({ sourceKind: 'third_party_race_listing' }),
      delivery({ protectedOfferRef: 'offer-member-15pct' }),
    );
    expect(v.decision).toBe('admit');
    expect(v.protectedOfferRef).toBe('offer-member-15pct');
  });

  test('admit is always a PRIVATE draft — never auto-published', () => {
    const v = classifyEventSourceAdmission(approvedSource(), delivery());
    expect(v.lifecycle).toBe('draft');
    expect(v.published).toBe(false);
  });
});

// ---- source authorization ------------------------------------------------

describe('source authorization', () => {
  test('a null approved-source descriptor is refused source_not_approved', () => {
    const v = classifyEventSourceAdmission(null, delivery());
    expect(v).toEqual({ decision: 'refused', reason: 'source_not_approved' });
  });

  test('source_not_approved refuses WITHOUT parsing the untrusted delivery', () => {
    // Garbage / hostile deliveries must not change the verdict or throw when the source
    // is unapproved — the payload is never examined.
    for (const bad of hostileValues()) {
      expect(classifyEventSourceAdmission(null, bad))
        .toEqual({ decision: 'refused', reason: 'source_not_approved' });
    }
  });

  test('an inactive source is refused source_inactive', () => {
    const v = classifyEventSourceAdmission(approvedSource({ active: false }), delivery());
    expect(v).toEqual({ decision: 'refused', reason: 'source_inactive' });
  });

  test('source_inactive refuses without parsing the delivery', () => {
    for (const bad of hostileValues()) {
      expect(classifyEventSourceAdmission(approvedSource({ active: false }), bad))
        .toEqual({ decision: 'refused', reason: 'source_inactive' });
    }
  });

  test('a well-formed but non-public source kind is refused source_kind_not_public', () => {
    for (const kind of ['member_only_discount_offer', 'registration_or_form_response', 'historical_private_item']) {
      const v = classifyEventSourceAdmission(approvedSource({ sourceKind: kind }), delivery());
      expect(v).toEqual({ decision: 'refused', reason: 'source_kind_not_public' });
    }
  });

  test('source_kind_not_public refuses without parsing the delivery', () => {
    for (const bad of hostileValues()) {
      expect(classifyEventSourceAdmission(approvedSource({ sourceKind: 'member_only_discount_offer' }), bad))
        .toEqual({ decision: 'refused', reason: 'source_kind_not_public' });
    }
  });

  test('a delivery claiming a different sourceId than the descriptor is refused source_mismatch', () => {
    const v = classifyEventSourceAdmission(
      approvedSource({ sourceId: 'src-mprc-cal' }),
      delivery({ sourceId: 'src-other-feed' }),
    );
    expect(v).toEqual({ decision: 'refused', reason: 'source_mismatch' });
  });
});

// ---- public/protected boundary (crown jewel) -----------------------------

describe('public/protected boundary — allowlist, never denylist', () => {
  // Every one of these is an INLINED protected value that must never ride into an event
  // record (#121 "Never public in an event record"). None is a delivery allowlist key,
  // so each makes the key set wrong and is refused unexpected_field — regardless of its
  // (here harmless-looking) value, and without the module ever naming the field.
  const protectedInlines = [
    'discountCode', 'promotionCode', 'offerTerms', 'registrationList', 'guestList',
    'formResponses', 'paymentState', 'stripeId', 'waiverEvidence', 'emergencyContact',
    'privateLocation', 'doorInstructions', 'accessInstructions', 'memberContact',
    'internalNotes', 'auditRecord', 'providerToken', 'sourceCredential', 'rawHtml',
    'isMember', 'anythingElse',
  ];

  test.each(protectedInlines)('an inlined "%s" field is refused unexpected_field, never admitted', (field) => {
    const v = classifyEventSourceAdmission(approvedSource(), delivery({ [field]: 'x' }));
    expect(v).toEqual({ decision: 'refused', reason: 'unexpected_field' });
  });

  test('a NON-enumerable inlined protected field is still caught as a boundary refusal', () => {
    const d = delivery();
    Object.defineProperty(d, 'discountCode', { value: 'SECRET50', enumerable: false, configurable: true });
    const v = classifyEventSourceAdmission(approvedSource(), d);
    expect(v).toEqual({ decision: 'refused', reason: 'unexpected_field' });
  });

  test('the only permitted protected linkage is the opaque protectedOfferRef', () => {
    // present as opaque id -> admit; explicit null -> admit; both keep the boundary intact
    expect(classifyEventSourceAdmission(approvedSource(), delivery({ protectedOfferRef: 'offer-x' })).decision).toBe('admit');
    expect(classifyEventSourceAdmission(approvedSource(), delivery({ protectedOfferRef: null })).decision).toBe('admit');
  });

  test('the admitted verdict can never carry a protected value — it echoes no content at all', () => {
    // Even a delivery whose (allowlisted) content fields contain scary-looking text is
    // admitted only as opaque identity; §8.6 is the content gate downstream.
    const v = classifyEventSourceAdmission(approvedSource(), delivery({ summary: '<script>alert(1)</script>' }));
    expect(v.decision).toBe('admit');
    expect(JSON.stringify(v)).not.toContain('<script>');
  });
});

// ---- injective idempotency key -------------------------------------------

describe('injective idempotency key (draftId)', () => {
  test('draftId is a deterministic join of (sourceId, sourceEventId, sourceRevision)', () => {
    const v = classifyEventSourceAdmission(approvedSource(), delivery());
    expect(v.draftId).toBe('esa1|src-mprc-cal|evt-2026-summer-5k|rev-3');
  });

  test('a re-delivery of the same source event revision yields the SAME draftId', () => {
    const a = classifyEventSourceAdmission(approvedSource(), delivery());
    const b = classifyEventSourceAdmission(approvedSource(), delivery({ title: 'renamed', locationText: 'moved' }));
    expect(a.draftId).toBe(b.draftId); // identity is (source,event,revision), not content
  });

  test('a new revision yields a provably DISTINCT draftId', () => {
    const a = classifyEventSourceAdmission(approvedSource(), delivery({ sourceRevision: 'rev-3' }));
    const b = classifyEventSourceAdmission(approvedSource(), delivery({ sourceRevision: 'rev-4' }));
    expect(a.draftId).not.toBe(b.draftId);
  });

  test('a different source event yields a distinct draftId', () => {
    const a = classifyEventSourceAdmission(approvedSource(), delivery({ sourceEventId: 'evt-a' }));
    const b = classifyEventSourceAdmission(approvedSource(), delivery({ sourceEventId: 'evt-b' }));
    expect(a.draftId).not.toBe(b.draftId);
  });

  test('protectedOfferRef is NOT part of the identity (same revision -> same draftId)', () => {
    const a = classifyEventSourceAdmission(approvedSource({ sourceKind: 'third_party_race_listing' }), delivery({ protectedOfferRef: 'offer-a' }));
    const b = classifyEventSourceAdmission(approvedSource({ sourceKind: 'third_party_race_listing' }), delivery({ protectedOfferRef: 'offer-b' }));
    expect(a.draftId).toBe(b.draftId);
  });

  test('injectivity sweep — distinct tuples never collide; identical tuples always match', () => {
    const ids = new Map();
    for (const sid of ['s1', 's2', 's-three']) {
      for (const eid of ['e1', 'e2', 'e.3']) {
        for (const rev of ['r1', 'r2', 'r-10']) {
          const src = approvedSource({ sourceId: sid });
          const del = delivery({ sourceId: sid, sourceEventId: eid, sourceRevision: rev });
          const id = classifyEventSourceAdmission(src, del).draftId;
          const key = `${sid} ${eid} ${rev}`;
          if (ids.has(id)) expect(ids.get(id)).toBe(key); // no two distinct tuples share an id
          ids.set(id, key);
        }
      }
    }
    expect(ids.size).toBe(27);
  });
});

// ---- never auto-publishes (structural) -----------------------------------

describe('never auto-publishes — structural encoding', () => {
  test('the decision vocabulary is exactly {admit, refused, denied} — no publish/approve verb', () => {
    expect(Object.values(AdmissionDecision).sort()).toEqual(['admit', 'denied', 'refused']);
  });

  test('the sole content-bearing verdict stamps lifecycle:draft, published:false', () => {
    const v = classifyEventSourceAdmission(approvedSource(), delivery());
    expect(v.lifecycle).toBe('draft');
    expect(v.published).toBe(false);
  });

  test('no verdict across the matrix ever reports published:true or a non-draft lifecycle', () => {
    const inputs = [
      [approvedSource(), delivery()],
      [null, delivery()],
      [approvedSource({ active: false }), delivery()],
      [approvedSource({ sourceKind: 'historical_private_item' }), delivery()],
      [approvedSource(), delivery({ sourceId: 'nope' })],
      [approvedSource(), delivery({ discountCode: 'x' })],
      [approvedSource(), delivery({ title: 5 })],
      [{ bad: 1 }, delivery()],
    ];
    for (const [s, d] of inputs) {
      const v = classifyEventSourceAdmission(s, d);
      expect(v.published === undefined || v.published === false).toBe(true);
      expect(v.lifecycle === undefined || v.lifecycle === 'draft').toBe(true);
    }
  });
});

// ---- malformed approved source -------------------------------------------

describe('malformed approved source -> denied malformed_approved_source', () => {
  test('a non-null non-record descriptor is malformed (null is the distinct not_approved case)', () => {
    for (const bad of hostileValues()) {
      if (bad === null) continue; // null is refuse:source_not_approved, asserted elsewhere
      const v = classifyEventSourceAdmission(bad, delivery());
      expect(v).toEqual({ decision: 'denied', reason: 'malformed_approved_source' });
    }
  });

  test.each([
    ['wrong schema version', { eventSourceAdmissionSchemaVersion: 2 }],
    ['missing a field', (() => { const s = approvedSource(); delete s.active; return s; })()],
    ['extra field', { ...approvedSource(), extra: 1 }],
    ['non-opaque sourceId (space)', approvedSource({ sourceId: 'has space' })],
    ['pipe in sourceId', approvedSource({ sourceId: 'a|b' })],
    ['unknown sourceKind', approvedSource({ sourceKind: 'martian' })],
    ['non-boolean active (string)', approvedSource({ active: 'true' })],
    ['non-boolean active (1)', approvedSource({ active: 1 })],
  ])('%s', (_label, bad) => {
    const v = classifyEventSourceAdmission(bad, delivery());
    expect(v).toEqual({ decision: 'denied', reason: 'malformed_approved_source' });
  });

  test('an accessor-backed sourceId is malformed and its getter is never invoked', () => {
    let invoked = 0;
    const s = { eventSourceAdmissionSchemaVersion: 1, sourceKind: 'mprc_hosted_event', active: true };
    Object.defineProperty(s, 'sourceId', { get() { invoked += 1; return 'src-mprc-cal'; }, enumerable: true, configurable: true });
    const v = classifyEventSourceAdmission(s, delivery());
    expect(v).toEqual({ decision: 'denied', reason: 'malformed_approved_source' });
    expect(invoked).toBe(0);
  });

  test('a symbol-keyed descriptor is malformed', () => {
    const s = approvedSource();
    s[Symbol('x')] = 1;
    expect(classifyEventSourceAdmission(s, delivery()))
      .toEqual({ decision: 'denied', reason: 'malformed_approved_source' });
  });
});

// ---- malformed delivery --------------------------------------------------

describe('malformed delivery -> denied malformed_delivery', () => {
  test('non-record deliveries (from a valid source) are denied malformed_delivery', () => {
    // Non-records and wrong-prototype containers have no stray allowlist-external key, so
    // they take the malformed path (not the boundary path, which needs an extra own key).
    const nonRecords = [
      undefined, null, true, false, 0, 1, -1, NaN, Infinity, 42, 'str', '', Symbol('s'), 10n,
      [], [1, 2, 3], {}, Object.create(null), Object.create({ inherited: 1 }),
      new Map(), new Set(), new Date(), /regex/, function f() {}, () => {},
    ];
    for (const bad of nonRecords) {
      expect(classifyEventSourceAdmission(approvedSource(), bad))
        .toEqual({ decision: 'denied', reason: 'malformed_delivery' });
    }
    // trap-throwing and revoked proxies are rejected as malformed too (isProxy short-circuits
    // before any trap can fire).
    const trap = new Proxy({}, { get() { throw new Error('x'); }, ownKeys() { throw new Error('x'); } });
    expect(classifyEventSourceAdmission(approvedSource(), trap))
      .toEqual({ decision: 'denied', reason: 'malformed_delivery' });
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(classifyEventSourceAdmission(approvedSource(), proxy))
      .toEqual({ decision: 'denied', reason: 'malformed_delivery' });
  });

  test('no hostile / exotic delivery is ever admitted', () => {
    // Whatever the shape, a non-conforming delivery is a safe refuse/deny, never an admit.
    for (const bad of hostileValues()) {
      expect(classifyEventSourceAdmission(approvedSource(), bad).decision).not.toBe('admit');
    }
  });

  test.each([
    ['wrong schema version', delivery({ eventSourceAdmissionSchemaVersion: 9 })],
    ['missing a required field', (() => { const d = delivery(); delete d.summary; return d; })()],
    ['non-opaque sourceEventId (space)', delivery({ sourceEventId: 'has space' })],
    ['pipe in sourceRevision', delivery({ sourceRevision: 'r|2' })],
    ['empty sourceId', delivery({ sourceId: '' })],
    ['content field not a string (number)', delivery({ title: 42 })],
    ['content field not a string (null)', delivery({ summary: null })],
    ['content field not a string (object)', delivery({ locationText: {} })],
    ['empty content field', delivery({ title: '' })],
    ['over-long content field', delivery({ summary: 'x'.repeat(8193) })],
    ['protectedOfferRef non-opaque non-null (number)', delivery({ protectedOfferRef: 7 })],
    ['protectedOfferRef with pipe', delivery({ protectedOfferRef: 'a|b' })],
  ])('%s', (_label, bad) => {
    const v = classifyEventSourceAdmission(approvedSource(), bad);
    expect(v).toEqual({ decision: 'denied', reason: 'malformed_delivery' });
  });

  test('a content field just at the ceiling (8192) is accepted', () => {
    const v = classifyEventSourceAdmission(approvedSource(), delivery({ summary: 'x'.repeat(8192) }));
    expect(v.decision).toBe('admit');
  });

  test('a required field present but NON-enumerable is malformed (not a boundary case)', () => {
    const d = delivery();
    const val = d.title;
    delete d.title;
    Object.defineProperty(d, 'title', { value: val, enumerable: false, configurable: true });
    const v = classifyEventSourceAdmission(approvedSource(), d);
    expect(v).toEqual({ decision: 'denied', reason: 'malformed_delivery' });
  });

  test('an accessor-backed content field is malformed and its getter is never invoked', () => {
    let invoked = 0;
    const d = delivery();
    delete d.title;
    Object.defineProperty(d, 'title', { get() { invoked += 1; return 'Summer 5K'; }, enumerable: true, configurable: true });
    const v = classifyEventSourceAdmission(approvedSource(), d);
    expect(v).toEqual({ decision: 'denied', reason: 'malformed_delivery' });
    expect(invoked).toBe(0);
  });
});

// ---- check ordering (fail-closed precedence) -----------------------------

describe('check ordering — fail closed', () => {
  test('an unapproved source outranks any delivery defect', () => {
    expect(classifyEventSourceAdmission(null, delivery({ discountCode: 'x', title: 5 })))
      .toEqual({ decision: 'refused', reason: 'source_not_approved' });
  });

  test('a malformed source outranks a delivery defect (delivery not parsed)', () => {
    expect(classifyEventSourceAdmission({ bad: 1 }, delivery({ discountCode: 'x' })))
      .toEqual({ decision: 'denied', reason: 'malformed_approved_source' });
  });

  test('inactive/non-public source outranks a delivery defect', () => {
    expect(classifyEventSourceAdmission(approvedSource({ active: false }), delivery({ discountCode: 'x' })))
      .toEqual({ decision: 'refused', reason: 'source_inactive' });
    expect(classifyEventSourceAdmission(approvedSource({ sourceKind: 'historical_private_item' }), delivery({ title: 9 })))
      .toEqual({ decision: 'refused', reason: 'source_kind_not_public' });
  });

  test('the boundary (unexpected_field) outranks a source_mismatch', () => {
    // delivery has BOTH an extra protected key AND a wrong sourceId: boundary is decided
    // inside readDelivery, before the sourceId cross-check, so the boundary wins.
    const v = classifyEventSourceAdmission(approvedSource(), delivery({ sourceId: 'other', discountCode: 'x' }));
    expect(v).toEqual({ decision: 'refused', reason: 'unexpected_field' });
  });

  test('the boundary (unexpected_field) outranks an unrelated malformed field', () => {
    const v = classifyEventSourceAdmission(approvedSource(), delivery({ discountCode: 'x', title: 42 }));
    expect(v).toEqual({ decision: 'refused', reason: 'unexpected_field' });
  });

  test('a valid delivery with the wrong sourceId (no extra keys) is a source_mismatch', () => {
    const v = classifyEventSourceAdmission(approvedSource(), delivery({ sourceId: 'other' }));
    expect(v).toEqual({ decision: 'refused', reason: 'source_mismatch' });
  });
});

// ---- never throws --------------------------------------------------------

describe('never throws for any input in either position', () => {
  const values = hostileValues();
  values.push(approvedSource(), delivery());

  test('every (approvedSource, delivery) hostile pairing returns a frozen verdict', () => {
    for (const a of values) {
      for (const b of values) {
        let v;
        expect(() => { v = classifyEventSourceAdmission(a, b); }).not.toThrow();
        expect(Object.isFrozen(v)).toBe(true);
        expect(['admit', 'refused', 'denied']).toContain(v.decision);
      }
    }
  });
});

// ---- determinism / immutability ------------------------------------------

describe('determinism and immutability', () => {
  test('same inputs -> deeply equal verdict', () => {
    const a = classifyEventSourceAdmission(approvedSource(), delivery());
    const b = classifyEventSourceAdmission(approvedSource(), delivery());
    expect(a).toEqual(b);
  });

  test('every verdict is frozen', () => {
    for (const [s, d] of [
      [approvedSource(), delivery()],
      [null, delivery()],
      [approvedSource(), delivery({ discountCode: 'x' })],
      [approvedSource(), delivery({ title: 1 })],
      [{ bad: 1 }, delivery()],
    ]) {
      expect(Object.isFrozen(classifyEventSourceAdmission(s, d))).toBe(true);
    }
  });

  test('mutating the input object after the call does not change the verdict', () => {
    const s = approvedSource();
    const d = delivery();
    const v = classifyEventSourceAdmission(s, d);
    const snapshot = JSON.stringify(v);
    d.sourceRevision = 'rev-999';
    d.title = 'changed';
    s.sourceKind = 'historical_private_item';
    expect(JSON.stringify(v)).toBe(snapshot);
  });

  test('refuse/deny singletons are returned by reference (frozen, shared)', () => {
    const a = classifyEventSourceAdmission(null, delivery());
    const b = classifyEventSourceAdmission(null, delivery({ title: 'x' }));
    expect(a).toBe(b);
    const c = classifyEventSourceAdmission({ bad: 1 }, delivery());
    const e = classifyEventSourceAdmission({ nope: 2 }, delivery());
    expect(c).toBe(e);
  });
});

// ---- frozen surface ------------------------------------------------------

describe('frozen module surface', () => {
  test('exports and enums are frozen', () => {
    expect(Object.isFrozen(mod)).toBe(true);
    expect(Object.isFrozen(SourceKind)).toBe(true);
    expect(Object.isFrozen(AdmissionDecision)).toBe(true);
    expect(Object.isFrozen(RefusalReason)).toBe(true);
    expect(Object.isFrozen(DenialReason)).toBe(true);
  });

  test('schema version is the frozen constant 1', () => {
    expect(eventSourceAdmissionSchemaVersion).toBe(1);
  });

  test('enums expose exactly the intended vocabularies', () => {
    expect(Object.values(SourceKind).sort()).toEqual([
      'club_run_or_social', 'historical_private_item', 'member_only_discount_offer',
      'mprc_hosted_event', 'registration_or_form_response', 'third_party_race_listing',
    ]);
    expect(Object.values(RefusalReason).sort()).toEqual([
      'source_inactive', 'source_kind_not_public', 'source_mismatch',
      'source_not_approved', 'unexpected_field',
    ]);
    expect(Object.values(DenialReason).sort()).toEqual([
      'malformed_approved_source', 'malformed_delivery',
    ]);
  });
});

// ---- source boundary -----------------------------------------------------

describe('source boundary — pure, self-contained, imported by nothing', () => {
  const src = fs.readFileSync(path.join(__dirname, 'eventSourceAdmission.js'), 'utf8');
  // strip block and line comments so narration (which legitimately mentions protected
  // values) is not mistaken for code.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  test('requires only node:util', () => {
    const requires = [...code.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    expect([...new Set(requires)].sort()).toEqual(['node:util']);
  });

  test('header names the section and issue code', () => {
    expect(src).toContain('§8.6a');
    expect(src).toContain('EVENTS-001B');
  });

  test('the CODE contains no protected/secret field vocabulary (allowlist, never denylist)', () => {
    // Because the boundary is a closed allowlist, no protected-field NAME appears in the
    // executable source. (These strings DO appear in the header narration, which is why
    // comments are stripped above.)
    for (const banned of [
      'discountCode', 'promotionCode', 'paymentState', 'stripeId', 'waiverEvidence',
      'emergencyContact', 'providerToken', 'sourceCredential', 'password', 'bearer',
      'guestList', 'registrationList',
    ]) {
      expect(code).not.toContain(banned);
    }
  });

  test('reads no clock or randomness', () => {
    expect(code).not.toMatch(/Date\s*\.\s*now/);
    expect(code).not.toMatch(/new\s+Date/);
    expect(code).not.toMatch(/Math\s*\.\s*random/);
  });

  test('no functions/ runtime module imports this contract', () => {
    const dir = fs.readdirSync(__dirname);
    for (const file of dir) {
      if (!file.endsWith('.js') || file.endsWith('.test.js')) continue;
      if (file === 'eventSourceAdmission.js') continue;
      const full = path.join(__dirname, file);
      if (!fs.statSync(full).isFile()) continue;
      const other = fs.readFileSync(full, 'utf8');
      expect(other).not.toMatch(/require\(\s*['"]\.\/eventSourceAdmission['"]\s*\)/);
    }
  });
});
