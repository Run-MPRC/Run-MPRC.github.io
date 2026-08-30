const { createHash } = require('node:crypto');
const { types: { isProxy } } = require('node:util');

// INSTAGRAM-002E approval-gated social-post canonical content and payload hash.
//
// Pure, source-only, unused. The INSTAGRAM-002A lifecycle reducer (§8.7) and
// the INSTAGRAM-002B plan builder treat `payloadHash` as opaque -- "the caller
// computes it". This contract IS that caller-side computation: it defines the
// officer-editable content of a social post (caption, media reference, alt
// text, UTC schedule + display time zone, disclosure flag), validates it, and
// derives one deterministic canonical hash that binds it.
//
// Safety model:
//   * The hash binds content by value without the reducer ever holding it.
//     Approving records `approvedHash := payloadHash`; ANY content edit yields
//     a different hash, so the reducer's "no publish without a current
//     approval" invariant does the rest.
//   * Deterministic and unambiguous. Fields are hashed in a fixed order with
//     length-framed encoding, so no two distinct records can collide by
//     shifting a delimiter, and the same record always yields byte-identical
//     output. The digest is a lowercase SHA-256 hex string -- a valid opaque
//     identifier for the reducer and plan builder.
//   * Content-safe by construction elsewhere. This is the ONE contract in the
//     INSTAGRAM-002 set that legitimately holds caption and alt text; every
//     sibling holds only its hash. It still carries no URL, recipient, member,
//     or provider vocabulary -- a media reference is an opaque server handle,
//     not a link.
//   * False-negative-safe. A malformed or hostile record fails validation and
//     `computeSocialPostPayloadHash` throws rather than hashing junk, so a bad
//     record can never mint a hash the reducer would treat as real.
//
// No runtime path imports this module. It reads no clock, randomness, network,
// environment, or provider; it logs nothing and persists nothing.

const socialPostContentSchemaVersion = 1;

// A media reference is an opaque, bounded, url-safe server handle by which the
// caller looks up the real media bytes in its own store. Never a URL.
const MEDIA_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

// IANA-style zone name (Area/Location, optionally with a third segment), or the
// literal UTC. Presentational only; the canonical instant is the epoch second.
const TIME_ZONE_PATTERN = /^(?:UTC|[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){1,2})$/;

// C0 controls, DEL, and C1 controls are disallowed in text fields. The caption
// keeps TAB (9) and LF (10); alt text is one line and keeps neither.
function hasDisallowedControlChar(value, allowTabAndNewline) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    if (!isControl) continue;
    if (allowTabAndNewline && (code === 0x09 || code === 0x0a)) continue;
    return true;
  }
  return false;
}

// Conservative bounds. Caption allows newlines and tabs; alt text is one line.
const LIMITS = Object.freeze({
  maxCaptionLength: 2200,
  maxAltTextLength: 1000,
  maxTimeZoneLength: 64,
  minScheduledAtEpochSeconds: 0,
  maxScheduledAtEpochSeconds: 4102444800, // 2100-01-01T00:00:00Z
});

const EXPECTED_CONTENT_KEYS = Object.freeze([
  'contentSchemaVersion',
  'caption',
  'mediaReference',
  'altText',
  'scheduledAtEpochSeconds',
  'displayTimeZone',
  'disclosureRequired',
]);

const FIXED_REASON = 'invalid_content';
const CONTENT_ERROR_MESSAGE = 'Social post content is invalid.';

const HASH_MAGIC = 'mprc-social-post-payload-sha256';
const HASH_DOMAIN = 'mprc.social-post-payload.v1';

class SocialPostContentError extends Error {
  constructor() {
    super(CONTENT_ERROR_MESSAGE);
    this.name = 'SocialPostContentError';
    this.reason = FIXED_REASON;
    Object.freeze(this);
  }
}

function frozenReasons(reasons) {
  return Object.freeze([...new Set(reasons)].sort());
}

// Strict own-data reader: rejects a proxy, a non-plain prototype, an accessor,
// a non-enumerable own field, an inherited field, and any extra key. Never
// invokes a getter. Mirrors the reader in socialPostState.js.
function safeOwnData(value, maximumEntries) {
  if (value === null || typeof value !== 'object' || isProxy(value)) return null;

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (prototype !== Object.prototype || keys.length > maximumEntries) return null;

  const entries = new Map();
  for (const key of keys) {
    if (typeof key !== 'string') return null;
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return null;
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined) {
      return null;
    }
    entries.set(key, descriptor.value);
  }

  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return null;
  }
  return entries;
}

function readExactContent(candidate) {
  const entries = safeOwnData(candidate, EXPECTED_CONTENT_KEYS.length);
  if (!entries
    || entries.size !== EXPECTED_CONTENT_KEYS.length
    || !EXPECTED_CONTENT_KEYS.every((key) => entries.has(key))) {
    return null;
  }
  return {
    contentSchemaVersion: entries.get('contentSchemaVersion'),
    caption: entries.get('caption'),
    mediaReference: entries.get('mediaReference'),
    altText: entries.get('altText'),
    scheduledAtEpochSeconds: entries.get('scheduledAtEpochSeconds'),
    displayTimeZone: entries.get('displayTimeZone'),
    disclosureRequired: entries.get('disclosureRequired'),
  };
}

function isBoundedText(value, maxLength, allowTabAndNewline) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= maxLength
    && !hasDisallowedControlChar(value, allowTabAndNewline);
}

function validationResult(accepted, status, reasons, projection) {
  return Object.freeze({
    accepted,
    status,
    reasons: frozenReasons(reasons),
    projection,
  });
}

// Validate the officer-editable content record. Non-throwing: returns a frozen
// canonical projection or a fixed rejection reason.
function validateSocialPostContent(candidate) {
  const record = readExactContent(candidate);
  if (!record) {
    return validationResult(false, 'rejected', [FIXED_REASON], null);
  }

  if (record.contentSchemaVersion !== socialPostContentSchemaVersion
    || !isBoundedText(record.caption, LIMITS.maxCaptionLength, true)
    || typeof record.mediaReference !== 'string'
    || !MEDIA_REFERENCE_PATTERN.test(record.mediaReference)
    || !isBoundedText(record.altText, LIMITS.maxAltTextLength, false)
    || !Number.isSafeInteger(record.scheduledAtEpochSeconds)
    || Object.is(record.scheduledAtEpochSeconds, -0)
    || record.scheduledAtEpochSeconds < LIMITS.minScheduledAtEpochSeconds
    || record.scheduledAtEpochSeconds > LIMITS.maxScheduledAtEpochSeconds
    || typeof record.displayTimeZone !== 'string'
    || record.displayTimeZone.length > LIMITS.maxTimeZoneLength
    || !TIME_ZONE_PATTERN.test(record.displayTimeZone)
    || typeof record.disclosureRequired !== 'boolean') {
    return validationResult(false, 'rejected', [FIXED_REASON], null);
  }

  return validationResult(true, 'valid', [], Object.freeze({ ...record }));
}

function unsignedLength(length) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32BE(length, 0);
  return buffer;
}

function updateLengthFramed(hash, value) {
  const bytes = Buffer.from(value, 'utf8');
  hash.update(unsignedLength(bytes.length));
  hash.update(bytes);
}

// Derive the canonical payload hash. Throws SocialPostContentError on an
// invalid record so a bad record can never mint a hash. The digest is a
// lowercase SHA-256 hex string: a valid opaque identifier for the §8.7 reducer.
function computeSocialPostPayloadHash(candidate) {
  const validation = validateSocialPostContent(candidate);
  if (!validation.accepted) throw new SocialPostContentError();
  const record = validation.projection;

  const hash = createHash('sha256');
  updateLengthFramed(hash, HASH_MAGIC);
  updateLengthFramed(hash, HASH_DOMAIN);
  for (const [name, value] of [
    ['contentSchemaVersion', String(record.contentSchemaVersion)],
    ['caption', record.caption],
    ['mediaReference', record.mediaReference],
    ['altText', record.altText],
    ['scheduledAtEpochSeconds', String(record.scheduledAtEpochSeconds)],
    ['displayTimeZone', record.displayTimeZone],
    ['disclosureRequired', record.disclosureRequired ? '1' : '0'],
  ]) {
    updateLengthFramed(hash, name);
    updateLengthFramed(hash, value);
  }
  return hash.digest('hex');
}

module.exports = Object.freeze({
  socialPostContentSchemaVersion,
  SocialPostContentError,
  validateSocialPostContent,
  computeSocialPostPayloadHash,
});
