const fs = require('node:fs');
const path = require('node:path');

const {
  publicEventSchemaVersion,
  PROJECTION_ENUMS,
  PublicEventProjectionError,
  projectPublicEvent,
} = require('./publicEventProjection');

// A value that must never be echoed by a rejection. It stands in for the kind
// of protected content that could try to ride in on an extra or malformed
// field: a discount code, a registrant identity, a contact number.
const HOSTILE_CANARY = 'discount-PROMO50; registrant=jane@example.test; +12025550123';

const RESULT_KEYS = ['publicEventSchemaVersion', 'visibility', 'publicEvent'];

const PUBLIC_VIEW_KEYS = [
  'publicEventSchemaVersion',
  'eventId',
  'title',
  'summary',
  'startsAt',
  'endsAt',
  'timezone',
  'locationText',
  'eventType',
  'publicStatus',
  'publicUrl',
  'accessibilityText',
  'sourceRevision',
  'publishedAt',
  'updatedAt',
];

// A complete, valid, publicly-visible record. Every negative test starts from
// this and breaks exactly one thing.
function validEvidence(overrides = {}) {
  return {
    publicEventSchemaVersion: 1,
    eventId: 'evt_2026_spring_10k',
    sourceRevision: 'rev-42',
    lifecycleStatus: 'published',
    eventType: 'mprc_hosted_race',
    title: 'Spring 10K',
    summary: 'A friendly spring 10K along the river path. All paces welcome.',
    startsAt: '2026-04-11T14:00:00Z',
    endsAt: '2026-04-11T17:00:00Z',
    timezone: 'America/New_York',
    locationText: 'Riverside Park, main pavilion',
    publicUrl: 'https://runmprc.com/events/spring-10k',
    accessibilityText: 'Wheelchair accessible route. Ask the race director for accommodations.',
    publishedAt: '2026-03-01T09:00:00Z',
    updatedAt: '2026-03-15T12:30:00Z',
    ...overrides,
  };
}

function projectError(input) {
  try {
    projectPublicEvent(input);
  } catch (err) {
    return err;
  }
  throw new Error('expected projectPublicEvent to throw');
}

function expectRejected(input) {
  const err = projectError(input);
  expect(err).toBeInstanceOf(PublicEventProjectionError);
  expect(err.code).toBe('invalid_public_event_evidence');
  expect(err.message).toBe('Public event projection evidence is invalid.');
  // A rejection must never echo the input back in any serialization.
  expect(JSON.stringify(err) || '').not.toContain(HOSTILE_CANARY);
  expect(String(err)).not.toContain(HOSTILE_CANARY);
  expect(err.stack || '').not.toContain(HOSTILE_CANARY);
}

describe('public projection for publicly-visible lifecycle states', () => {
  test('a published event projects a frozen, exactly-shaped scheduled public view', () => {
    const result = projectPublicEvent(validEvidence({ lifecycleStatus: 'published' }));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result)).toEqual(RESULT_KEYS);
    expect(result.publicEventSchemaVersion).toBe(1);
    expect(result.visibility).toBe('public');

    const view = result.publicEvent;
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.keys(view)).toEqual(PUBLIC_VIEW_KEYS);
    expect(view.publicStatus).toBe('scheduled');
    expect(view.eventId).toBe('evt_2026_spring_10k');
    expect(view.title).toBe('Spring 10K');
    expect(view.eventType).toBe('mprc_hosted_race');
    expect(view.sourceRevision).toBe('rev-42');
    expect(view.publicUrl).toBe('https://runmprc.com/events/spring-10k');
  });

  test('an updated event is publicly a scheduled event (the edit is not surfaced)', () => {
    const result = projectPublicEvent(validEvidence({ lifecycleStatus: 'updated' }));
    expect(result.visibility).toBe('public');
    expect(result.publicEvent.publicStatus).toBe('scheduled');
  });

  test('a cancelled event projects a public cancelled view', () => {
    const result = projectPublicEvent(validEvidence({ lifecycleStatus: 'cancelled' }));
    expect(result.visibility).toBe('public');
    expect(result.publicEvent.publicStatus).toBe('cancelled');
  });

  test('the public view carries every allowlisted field and nothing else', () => {
    const view = projectPublicEvent(validEvidence()).publicEvent;
    // Exactly the allowlist — no key beyond the minimized public schema exists.
    expect(new Set(Object.keys(view))).toEqual(new Set(PUBLIC_VIEW_KEYS));
    expect(Object.values(view).every((v) =>
      v === null || typeof v === 'string' || typeof v === 'number')).toBe(true);
  });

  test('projection is a pure function — equal input yields an equal (frozen) view', () => {
    const a = projectPublicEvent(validEvidence());
    const b = projectPublicEvent(validEvidence());
    expect(a).toEqual(b);
    expect(Object.isFrozen(a.publicEvent)).toBe(true);
  });

  test('each public event type is accepted', () => {
    for (const eventType of PROJECTION_ENUMS.eventType) {
      const result = projectPublicEvent(validEvidence({ eventType }));
      expect(result.publicEvent.eventType).toBe(eventType);
    }
  });
});

describe('withheld for non-public lifecycle states', () => {
  test.each(['draft', 'reviewed', 'archived'])(
    'a %s record is withheld with a null public view',
    (lifecycleStatus) => {
      const result = projectPublicEvent(validEvidence({ lifecycleStatus }));
      expect(Object.isFrozen(result)).toBe(true);
      expect(result.visibility).toBe('withheld');
      expect(result.publicEvent).toBeNull();
      expect(result.publicEventSchemaVersion).toBe(1);
    },
  );

  test('all withheld verdicts are the same frozen singleton carrying no input data', () => {
    const draft = projectPublicEvent(validEvidence({ lifecycleStatus: 'draft' }));
    const archived = projectPublicEvent(validEvidence({ lifecycleStatus: 'archived' }));
    expect(draft).toBe(archived);
    // The withheld verdict has no field sourced from the record, so it can
    // leak nothing even if the record held protected values.
    expect(Object.keys(draft)).toEqual(RESULT_KEYS);
    expect(draft.publicEvent).toBeNull();
  });

  test('a withheld record is still fully validated — a malformed draft is rejected, not withheld', () => {
    expectRejected(validEvidence({ lifecycleStatus: 'draft', publicUrl: 'http://insecure.example/x' }));
    expectRejected(validEvidence({ lifecycleStatus: 'archived', title: 'bad<script>' }));
  });
});

describe('nullable optional fields', () => {
  test('endsAt, locationText, publicUrl, and accessibilityText may each be null', () => {
    const result = projectPublicEvent(validEvidence({
      endsAt: null,
      locationText: null,
      publicUrl: null,
      accessibilityText: null,
    }));
    const view = result.publicEvent;
    expect(view.endsAt).toBeNull();
    expect(view.locationText).toBeNull();
    expect(view.publicUrl).toBeNull();
    expect(view.accessibilityText).toBeNull();
    // Required fields are unaffected.
    expect(view.title).toBe('Spring 10K');
    expect(view.startsAt).toBe('2026-04-11T14:00:00Z');
  });

  test('required fields may NOT be null', () => {
    for (const field of ['title', 'summary', 'startsAt', 'timezone', 'eventId',
      'sourceRevision', 'publishedAt', 'updatedAt', 'lifecycleStatus', 'eventType']) {
      expectRejected(validEvidence({ [field]: null }));
    }
  });
});

describe('the allowlist is exact — protected fields cannot ride in', () => {
  test('an extra (unexpected) field is rejected without echo, even when known fields are valid', () => {
    expectRejected(validEvidence({ discountCode: HOSTILE_CANARY }));
    expectRejected(validEvidence({ registrations: [HOSTILE_CANARY] }));
    expectRejected(validEvidence({ emergencyContact: HOSTILE_CANARY }));
  });

  test('a missing required field is rejected', () => {
    for (const field of PUBLIC_VIEW_KEYS.filter((k) => k !== 'publicStatus')) {
      const e = validEvidence();
      delete e[field];
      expectRejected(e);
    }
    // lifecycleStatus is input-only (not a public-view key) and also required.
    const e = validEvidence();
    delete e.lifecycleStatus;
    expectRejected(e);
  });

  test('a renamed field (unknown key in place of a known one) is rejected', () => {
    const e = validEvidence();
    delete e.title;
    e.headline = 'Spring 10K';
    expectRejected(e);
  });
});

describe('text fields reject markup and control characters', () => {
  test.each([
    ['angle-open', 'Spring <10K'],
    ['angle-close', 'Spring 10K>'],
    ['script tag', '<script>alert(1)</script>'],
    ['null char', 'Spring 10K'],
    ['unit separator', 'Spring10K'],
    ['delete char', 'Spring10K'],
    ['line separator', 'Spring 10K'],
    ['paragraph separator', 'Spring 10K'],
    ['newline', 'Spring\n10K'],
    ['tab', 'Spring\t10K'],
  ])('rejects a title containing %s', (_label, title) => {
    expectRejected(validEvidence({ title }));
  });

  test('rejects an empty required text field and an over-long summary', () => {
    expectRejected(validEvidence({ title: '' }));
    expectRejected(validEvidence({ summary: 'x'.repeat(2001) }));
  });

  test('rejects markup in the optional location and accessibility text', () => {
    expectRejected(validEvidence({ locationText: 'Park <b>pavilion</b>' }));
    expectRejected(validEvidence({ accessibilityText: 'See <a href=x>here</a>' }));
  });

  test('accepts ordinary international text, punctuation, and emoji', () => {
    const view = projectPublicEvent(validEvidence({
      title: 'Café 5K 🏃 — Été',
      summary: 'Rejoignez-nous! 10:00, pointe de départ près du café.',
    })).publicEvent;
    expect(view.title).toBe('Café 5K 🏃 — Été');
  });
});

describe('opaque identifier fields', () => {
  test.each([
    ['a space', 'evt spring'],
    ['a slash', 'evt/spring'],
    ['angle markup', 'evt<spring>'],
    ['empty', ''],
    ['too long', 'e'.repeat(129)],
  ])('rejects an eventId with %s', (_label, eventId) => {
    expectRejected(validEvidence({ eventId }));
  });

  test('rejects markup in sourceRevision and accepts unreserved token characters', () => {
    expectRejected(validEvidence({ sourceRevision: 'rev 1' }));
    const view = projectPublicEvent(validEvidence({
      eventId: 'evt.2026-spring:10k',
      sourceRevision: 'v1.2.3-rc.4',
    })).publicEvent;
    expect(view.eventId).toBe('evt.2026-spring:10k');
    expect(view.sourceRevision).toBe('v1.2.3-rc.4');
  });
});

describe('timezone must be explicit', () => {
  test.each([
    ['a numeric offset', '+05:00'],
    ['a negative offset', '-08:00'],
    ['empty', ''],
    ['a spaced phrase', 'Eastern Time'],
    ['markup', 'America/<New_York>'],
  ])('rejects timezone %s', (_label, timezone) => {
    expectRejected(validEvidence({ timezone }));
  });

  test.each(['UTC', 'America/New_York', 'Europe/Paris', 'America/Argentina/Buenos_Aires'])(
    'accepts explicit IANA zone %s',
    (timezone) => {
      expect(projectPublicEvent(validEvidence({ timezone })).publicEvent.timezone).toBe(timezone);
    },
  );
});

describe('timestamps are UTC instants with second precision', () => {
  test.each([
    ['no trailing Z', '2026-04-11T14:00:00'],
    ['an offset instead of Z', '2026-04-11T14:00:00+00:00'],
    ['fractional seconds', '2026-04-11T14:00:00.000Z'],
    ['date only', '2026-04-11'],
    ['month 13', '2026-13-11T14:00:00Z'],
    ['day 32', '2026-04-32T14:00:00Z'],
    ['hour 24', '2026-04-11T24:00:00Z'],
    ['minute 60', '2026-04-11T14:60:00Z'],
    ['a space separator', '2026-04-11 14:00:00Z'],
    ['non-string', 20260411],
  ])('rejects startsAt that is %s', (_label, startsAt) => {
    expectRejected(validEvidence({ startsAt, endsAt: null }));
  });

  test('accepts a well-formed UTC instant and preserves it verbatim', () => {
    const view = projectPublicEvent(
      validEvidence({ startsAt: '2026-12-31T23:59:59Z', endsAt: null }),
    ).publicEvent;
    expect(view.startsAt).toBe('2026-12-31T23:59:59Z');
  });
});

describe('ordering invariants', () => {
  test('rejects an event that ends before it starts', () => {
    expectRejected(validEvidence({
      startsAt: '2026-04-11T17:00:00Z',
      endsAt: '2026-04-11T14:00:00Z',
    }));
  });

  test('accepts an event whose end equals its start (instantaneous)', () => {
    const view = projectPublicEvent(validEvidence({
      startsAt: '2026-04-11T14:00:00Z',
      endsAt: '2026-04-11T14:00:00Z',
    })).publicEvent;
    expect(view.endsAt).toBe('2026-04-11T14:00:00Z');
  });

  test('rejects an update timestamp that precedes the publish timestamp', () => {
    expectRejected(validEvidence({
      publishedAt: '2026-03-15T12:30:00Z',
      updatedAt: '2026-03-01T09:00:00Z',
    }));
  });

  test('accepts equal publish and update timestamps', () => {
    const view = projectPublicEvent(validEvidence({
      publishedAt: '2026-03-01T09:00:00Z',
      updatedAt: '2026-03-01T09:00:00Z',
    })).publicEvent;
    expect(view.updatedAt).toBe('2026-03-01T09:00:00Z');
  });
});

describe('the public URL is a strict https allowlist', () => {
  test.each([
    ['plain http', 'http://runmprc.com/x'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,<h1>x</h1>'],
    ['mailto scheme', 'mailto:info@runmprc.com'],
    ['embedded userinfo', 'https://user:pass@runmprc.com/x'],
    ['an explicit port', 'https://runmprc.com:8080/x'],
    ['a query string', 'https://runmprc.com/x?ref=abc'],
    ['a fragment', 'https://runmprc.com/x#section'],
    ['a space', 'https://runmprc.com/a b'],
    ['angle markup', 'https://runmprc.com/<x>'],
    ['a backslash', 'https://runmprc.com\\x'],
    ['an uppercase host', 'https://RunMPRC.com/x'],
    ['no dot in host', 'https://localhost/x'],
    ['scheme only', 'https://'],
  ])('rejects a publicUrl with %s', (_label, publicUrl) => {
    expectRejected(validEvidence({ publicUrl }));
  });

  test.each([
    'https://runmprc.com',
    'https://runmprc.com/events/spring-10k',
    'https://www.run-mprc.com/e/2026/spring',
  ])('accepts the safe https URL %s', (publicUrl) => {
    expect(projectPublicEvent(validEvidence({ publicUrl })).publicEvent.publicUrl).toBe(publicUrl);
  });

  test('a null publicUrl is allowed and preserved', () => {
    expect(projectPublicEvent(validEvidence({ publicUrl: null })).publicEvent.publicUrl).toBeNull();
  });
});

describe('malformed and hostile input is rejected without echo', () => {
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['string', HOSTILE_CANARY],
    ['number', 7],
    ['boolean', true],
    ['array', [HOSTILE_CANARY]],
  ])('rejects a non-object (%s)', (_label, value) => {
    expectRejected(value);
  });

  test('rejects the wrong schema version', () => {
    expectRejected(validEvidence({ publicEventSchemaVersion: 2 }));
    expectRejected(validEvidence({ publicEventSchemaVersion: '1' }));
    expectRejected(validEvidence({ publicEventSchemaVersion: 0 }));
  });

  test('rejects an unknown lifecycleStatus or eventType enum value', () => {
    expectRejected(validEvidence({ lifecycleStatus: 'deleted' }));
    expectRejected(validEvidence({ eventType: 'members_only_offer' }));
  });

  test('rejects an output-only publicStatus smuggled into the lifecycleStatus field', () => {
    expectRejected(validEvidence({ lifecycleStatus: 'scheduled' }));
    expectRejected(validEvidence({ lifecycleStatus: 'withheld' }));
  });

  test('rejects a Proxy without tripping its traps', () => {
    const proxy = new Proxy(validEvidence(), {
      get() { throw new Error('proxy get trap must not run'); },
    });
    expectRejected(proxy);
  });

  test('rejects an accessor field without invoking the getter', () => {
    let invoked = false;
    const hostile = validEvidence();
    delete hostile.publicUrl;
    Object.defineProperty(hostile, 'publicUrl', {
      enumerable: true,
      configurable: true,
      get() { invoked = true; return HOSTILE_CANARY; },
    });
    expectRejected(hostile);
    expect(invoked).toBe(false);
  });

  test('rejects a non-enumerable own field', () => {
    const hostile = validEvidence();
    const value = hostile.summary;
    delete hostile.summary;
    Object.defineProperty(hostile, 'summary', {
      value,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    expectRejected(hostile);
  });

  test('rejects inherited (non-own) fields', () => {
    expectRejected(Object.create(validEvidence()));
  });

  test('rejects an object whose prototype is not Object.prototype', () => {
    expectRejected(Object.assign(Object.create(null), validEvidence()));
  });
});

describe('frozen versioned surface', () => {
  test('publishes revision 1 and deeply frozen enums', () => {
    expect(publicEventSchemaVersion).toBe(1);
    expect(Object.isFrozen(PROJECTION_ENUMS)).toBe(true);
    for (const values of Object.values(PROJECTION_ENUMS)) {
      expect(Object.isFrozen(values)).toBe(true);
    }
  });

  test('publishes the closed input and output vocabularies', () => {
    expect(PROJECTION_ENUMS.lifecycleStatus).toEqual([
      'draft',
      'reviewed',
      'published',
      'updated',
      'cancelled',
      'archived',
    ]);
    expect(PROJECTION_ENUMS.eventType).toEqual([
      'mprc_hosted_race',
      'club_run',
      'social_event',
      'third_party_listing',
    ]);
    expect(PROJECTION_ENUMS.publicStatus).toEqual(['scheduled', 'cancelled']);
  });

  test('the module export is frozen', () => {
    const mod = require('./publicEventProjection');
    expect(Object.isFrozen(mod)).toBe(true);
  });

  test('the error is frozen, carries no own enumerable state, and serializes empty', () => {
    const err = new PublicEventProjectionError();
    expect(Object.isFrozen(err)).toBe(true);
    expect(Object.keys(err)).toEqual([]);
    expect(JSON.stringify(err)).toBe('{}');
    expect(err.name).toBe('PublicEventProjectionError');
    expect(err.code).toBe('invalid_public_event_evidence');
  });
});

describe('source boundary — pure, unused, provider-agnostic', () => {
  const modulePath = path.join(__dirname, 'publicEventProjection.js');
  const source = fs.readFileSync(modulePath, 'utf8');

  test('is not imported by the functions runtime entry point', () => {
    const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(index).not.toContain('publicEventProjection');
  });

  test('requires only node:util', () => {
    const requires = [...source.matchAll(/require\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(requires).toEqual(["'node:util'"]);
  });

  test('reads no clock, randomness, environment, network, or provider surface', () => {
    // NOTE: unlike the sibling commerce contracts this module intentionally
    // references the `https` scheme — allowlisting it is the module's job — so
    // the /https?:/ guard is replaced by the explicit scheme guards below.
    for (const forbidden of [
      /process\.env/,
      /Date\.now/,
      /new Date/,
      /Math\.random/,
      /console\./,
      /fetch\(/,
      /firebase/i,
      /firestore/i,
      /stripe/i,
    ]) {
      expect(source).not.toMatch(forbidden);
    }
  });

  test('allowlists only the https scheme — never plain http', () => {
    // The URL allowlist regex anchors on the https scheme, written `https:\/\/`
    // in source (escaped slashes). Assert that exact byte sequence is present
    // and that no plain-http branch or literal exists anywhere.
    expect(source).toContain('https:\\/\\/');
    expect(source).not.toContain('http:\\/\\/');
    expect(source).not.toContain('http://');
  });

  test('carries no PII, credential, or provider-identifier field vocabulary', () => {
    for (const forbidden of [
      /phone/i,
      /address/i,
      /\bdob\b/i,
      /\bssn\b/i,
      /secret/i,
      /\btoken\b/i,
      /password/i,
      /bearer/i,
      /api[_-]?key/i,
    ]) {
      expect(source).not.toMatch(forbidden);
    }
  });

  test('hard-codes the closed allowlist and the withheld-by-default posture', () => {
    expect(source).toContain('EXPECTED_FIELDS');
    expect(source).toContain("visibility: 'withheld'");
    expect(source).toContain("visibility: 'public'");
    // The output status vocabulary is derived, never read from input.
    expect(source).toContain('PUBLIC_STATUS_BY_LIFECYCLE');
  });
});
