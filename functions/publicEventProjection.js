const { types: { isProxy } } = require('node:util');

// EVENTS-001A conservative safe-by-default public event projection.
//
// Pure, source-only, unused. Given one exact revision-1 evidence record that
// carries ONLY public-candidate event fields, produce a frozen, validated,
// minimized public event view -- or withhold it -- or throw.
//
// Safety model (allowlist, never denylist):
//   * The evidence key set is closed and exact. A field that is not on the
//     public allowlist -- which is how a protected value (discount code,
//     registration/guest list, payment state, provider identifier, waiver
//     evidence, emergency contact, internal note, audit record, provider
//     credential, unreviewed markup) would arrive -- makes the key count or
//     key set wrong and throws. No protected value can ride into the output,
//     and no protected-field name appears in this source.
//   * The projection is false-negative-safe: a borderline record is withheld
//     or rejected, never leaked. It never emits a public view it is unsure of.
//   * Every text field is validated to safe plain text (no control tricks, no
//     `<`/`>` markup, no line/paragraph separators); the one URL field is
//     validated against a strict https allowlist (no other scheme, no
//     userinfo, port, query, or fragment); tim/zone fields must be explicit.
//   * Lifecycle status alone gates public visibility. A draft, reviewed, or
//     archived record validates but is withheld; only published/updated (as a
//     scheduled event) or cancelled (as a cancelled event) produce a view.
//   * Malformed, hostile, proxy, accessor-backed, inherited, extra-key,
//     missing-key, wrong-version, wrong-enum, or invariant-violating evidence
//     throws one fixed PublicEventProjectionError that never echoes the input.
//
// No runtime path imports this module. It reads no clock, randomness, network,
// environment, or provider; it logs nothing and persists nothing.

const publicEventSchemaVersion = 1;
const PROJECTION_ERROR_MESSAGE = 'Public event projection evidence is invalid.';

// The closed public-candidate allowlist. Exactly these keys, no more, no less.
const EXPECTED_FIELDS = Object.freeze([
  'publicEventSchemaVersion',
  'eventId',
  'sourceRevision',
  'lifecycleStatus',
  'eventType',
  'title',
  'summary',
  'startsAt',
  'endsAt',
  'timezone',
  'locationText',
  'publicUrl',
  'accessibilityText',
  'publishedAt',
  'updatedAt',
]);

const PROJECTION_ENUMS = Object.freeze({
  // Source lifecycle state. Only published/updated/cancelled ever reach the
  // public; draft/reviewed are pre-publication and archived is post-public.
  lifecycleStatus: Object.freeze([
    'draft',
    'reviewed',
    'published',
    'updated',
    'cancelled',
    'archived',
  ]),
  // Coarse, publicly safe event categories. A member-only discount offer, a
  // registration/waiver record, or any protected item is deliberately NOT a
  // public event type and has no representation here.
  eventType: Object.freeze([
    'mprc_hosted_race',
    'club_run',
    'social_event',
    'third_party_listing',
  ]),
  // Output-only public status. Derived from lifecycle; never read from input.
  publicStatus: Object.freeze([
    'scheduled',
    'cancelled',
  ]),
});

const LIFECYCLE_SET = new Set(PROJECTION_ENUMS.lifecycleStatus);
const EVENT_TYPE_SET = new Set(PROJECTION_ENUMS.eventType);

// Conservative bounds. Generous enough for real event copy, tight enough that
// a runaway or binary payload is rejected rather than projected.
const LIMITS = Object.freeze({
  eventId: Object.freeze({ min: 1, max: 128 }),
  sourceRevision: Object.freeze({ min: 1, max: 128 }),
  title: Object.freeze({ min: 1, max: 200 }),
  summary: Object.freeze({ min: 1, max: 2000 }),
  locationText: Object.freeze({ min: 1, max: 400 }),
  accessibilityText: Object.freeze({ min: 1, max: 600 }),
  timezone: Object.freeze({ min: 3, max: 64 }),
  url: Object.freeze({ min: 12, max: 2048 }),
});

// Opaque identifier: unreserved characters only. No whitespace, no markup, no
// path separators -- so an id can never smuggle a URL or markup.
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

// Explicit IANA-style zone (Area/Location, or exactly UTC). An offset such as
// +05:00 is rejected as daylight-saving-ambiguous.
const TIMEZONE_PATTERN = /^(UTC|[A-Za-z][A-Za-z0-9_+-]*\/[A-Za-z0-9_+/-]+)$/;

// A UTC instant with second precision and a mandatory Z. Display zone is the
// separate `timezone` field, so the instant itself is never ambiguous. Fixed
// width means lexical order equals chronological order.
const UTC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

// Strict https allowlist: https scheme only, lowercase dotted host, optional
// conservative path from the unreserved set. No other scheme (so no
// javascript:, data:, http:, mailto:), no userinfo, no port, no query, no
// fragment -- a tracker cannot hide in a rejected component.
const HTTPS_URL_PATTERN =
  /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(\/[A-Za-z0-9\-._~%/]*)?$/;

class PublicEventProjectionError extends Error {
  constructor() {
    super(PROJECTION_ERROR_MESSAGE);
    Object.defineProperty(this, 'name', {
      value: 'PublicEventProjectionError',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'message', {
      value: PROJECTION_ERROR_MESSAGE,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'code', {
      value: 'invalid_public_event_evidence',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Error.captureStackTrace?.(this, PublicEventProjectionError);
    Object.freeze(this);
  }
}

function fail() {
  throw new PublicEventProjectionError();
}

// Reject any character that could break out of plain text: C0 and C1 control
// ranges, the Unicode line and paragraph separators, and the `<`/`>` markup
// delimiters. Ordinary international letters, digits, punctuation, and emoji
// are allowed.
function hasUnsafeTextCharacter(text) {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
    if (code === 0x2028 || code === 0x2029) return true;
    if (code === 0x3c || code === 0x3e) return true; // < or >
  }
  return false;
}

function isSafePlainText(value, limit) {
  return typeof value === 'string'
    && value.length >= limit.min
    && value.length <= limit.max
    && !hasUnsafeTextCharacter(value);
}

function isOpaqueId(value, limit) {
  return typeof value === 'string'
    && value.length >= limit.min
    && value.length <= limit.max
    && OPAQUE_ID_PATTERN.test(value);
}

function isTimezone(value) {
  return typeof value === 'string'
    && value.length >= LIMITS.timezone.min
    && value.length <= LIMITS.timezone.max
    && TIMEZONE_PATTERN.test(value);
}

// Shape plus component-range validation without constructing a Date (no clock
// or calendar dependency). Exact per-month day validity is intentionally not
// checked here; the authoritative source supplies real calendar dates.
function isUtcTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  return month >= 1 && month <= 12
    && day >= 1 && day <= 31
    && hour <= 23
    && minute <= 59
    && second <= 59;
}

function isHttpsUrl(value) {
  return typeof value === 'string'
    && value.length >= LIMITS.url.min
    && value.length <= LIMITS.url.max
    && HTTPS_URL_PATTERN.test(value);
}

// A nullable field is either exactly null or a valid value of its kind.
function isNullableSafePlainText(value, limit) {
  return value === null || isSafePlainText(value, limit);
}

function readExactEvidence(value) {
  if (value === null || typeof value !== 'object' || isProxy(value)) fail();

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail();
  }

  if (prototype !== Object.prototype || keys.length !== EXPECTED_FIELDS.length) fail();

  const keySet = new Set();
  for (const key of keys) {
    if (typeof key !== 'string' || keySet.has(key)) fail();
    keySet.add(key);
  }
  if (EXPECTED_FIELDS.some((field) => !keySet.has(field))) fail();

  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail();
  }

  const evidence = Object.create(null);
  for (const field of EXPECTED_FIELDS) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, field);
    } catch {
      fail();
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined) {
      fail();
    }
    evidence[field] = descriptor.value;
  }

  validateEvidence(evidence);
  return evidence;
}

function validateEvidence(evidence) {
  if (evidence.publicEventSchemaVersion !== publicEventSchemaVersion) fail();
  if (!LIFECYCLE_SET.has(evidence.lifecycleStatus)) fail();
  if (!EVENT_TYPE_SET.has(evidence.eventType)) fail();

  if (!isOpaqueId(evidence.eventId, LIMITS.eventId)) fail();
  if (!isOpaqueId(evidence.sourceRevision, LIMITS.sourceRevision)) fail();

  if (!isSafePlainText(evidence.title, LIMITS.title)) fail();
  if (!isSafePlainText(evidence.summary, LIMITS.summary)) fail();
  if (!isNullableSafePlainText(evidence.locationText, LIMITS.locationText)) fail();
  if (!isNullableSafePlainText(evidence.accessibilityText, LIMITS.accessibilityText)) fail();

  if (!isTimezone(evidence.timezone)) fail();

  if (!isUtcTimestamp(evidence.startsAt)) fail();
  if (evidence.endsAt !== null && !isUtcTimestamp(evidence.endsAt)) fail();
  if (!isUtcTimestamp(evidence.publishedAt)) fail();
  if (!isUtcTimestamp(evidence.updatedAt)) fail();

  if (evidence.publicUrl !== null && !isHttpsUrl(evidence.publicUrl)) fail();

  // Ordering invariants. Fixed-width UTC instants compare correctly as strings,
  // so no Date is needed. An event that ends before it starts, or whose update
  // predates its publish, is incoherent -- fail closed.
  if (evidence.endsAt !== null && evidence.endsAt < evidence.startsAt) fail();
  if (evidence.updatedAt < evidence.publishedAt) fail();
}

// Lifecycle states that are safe to show publicly, mapped to the public status
// the viewer sees. Every other lifecycle state withholds the view entirely.
const PUBLIC_STATUS_BY_LIFECYCLE = Object.freeze({
  published: 'scheduled',
  updated: 'scheduled',
  cancelled: 'cancelled',
});

// A single shared, frozen withheld verdict. It carries no field from the input,
// so a withheld draft or archived record leaks nothing at all.
const WITHHELD = Object.freeze({
  publicEventSchemaVersion,
  visibility: 'withheld',
  publicEvent: null,
});

function projectPublicEvent(input) {
  const evidence = readExactEvidence(input);

  const publicStatus = PUBLIC_STATUS_BY_LIFECYCLE[evidence.lifecycleStatus];
  if (publicStatus === undefined) {
    return WITHHELD;
  }

  const publicEvent = Object.freeze({
    publicEventSchemaVersion,
    eventId: evidence.eventId,
    title: evidence.title,
    summary: evidence.summary,
    startsAt: evidence.startsAt,
    endsAt: evidence.endsAt,
    timezone: evidence.timezone,
    locationText: evidence.locationText,
    eventType: evidence.eventType,
    publicStatus,
    publicUrl: evidence.publicUrl,
    accessibilityText: evidence.accessibilityText,
    sourceRevision: evidence.sourceRevision,
    publishedAt: evidence.publishedAt,
    updatedAt: evidence.updatedAt,
  });

  return Object.freeze({
    publicEventSchemaVersion,
    visibility: 'public',
    publicEvent,
  });
}

Object.freeze(PublicEventProjectionError.prototype);
Object.freeze(PublicEventProjectionError);

module.exports = Object.freeze({
  publicEventSchemaVersion,
  PROJECTION_ENUMS,
  PublicEventProjectionError,
  projectPublicEvent,
});
