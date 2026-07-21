const { types: { isProxy } } = require('node:util');

// MEMBERS-CONTENT-001A — Members-only discount-view access resolution (pure contract).
//
// A conservative, safe-by-default slice of parent MEMBERS-CONTENT-001 (#83): the
// first-party members-only discounts page that replaces URL secrecy with access
// gated on verified current membership. This module owns exactly one decision —
// *what discount view, if any, a given already-verified principal may read right
// now* — and nothing else. It is a pure, deterministic, non-throwing reducer that
// combines an access gate with a field-minimizing projection.
//
// It does NOT authenticate anyone, read any session, or decide who is a member:
// the caller supplies the principal's already-server-verified standing as evidence
// (auth state, email-verification, membership status/expiry, content-admin flag)
// and the current instant. This contract only turns that evidence, plus a raw
// discount catalog, into the exact view the principal is entitled to see.
//
// Safety model (maps to #83's acceptance criteria):
//   - Withhold-by-default (false-negative-safe). Any principal not *proven* to be
//     a verified, signed-in current member — or a verified, signed-in authorized
//     content admin — is denied, with NO content in the verdict. Malformed or
//     hostile evidence is denied, never granted. A denial carries only a decision
//     and a reason, so it can leak no discount content.
//   - Field minimization (allowlist-never-denylist). A granted view carries only
//     the member-visible allowlisted fields of each discount; internal fields
//     (source owner, last-reviewed time, raw status) are dropped, never emitted.
//     A source key outside the allowlist is dropped, not carried.
//   - Status/expiry filtering. Only currently published, not-yet-expired discounts
//     appear; draft, archived, and expired discounts disappear from the view.
//   - Point-in-time. Membership expiry and discount expiry are both evaluated
//     against the one caller-supplied instant, so a demoted, revoked, or expired
//     principal is denied as soon as the evidence reflects it — the verdict is a
//     snapshot, bounding stale access to the evidence's own freshness.
//   - Clockless. Fixed-width UTC timestamps compare lexically, which equals
//     chronological order, so the contract reads no clock and constructs no Date.
//   - Opaque text only. Every content field is treated as bounded plain text with
//     control characters rejected; no field is interpreted as markup, and the
//     contract neither parses nor emits HTML — the raw arbitrary-HTML pattern has
//     no place in this path.
//   - Hostile-input-safe. Every field is read through an own-enumerable data
//     descriptor with no getter ever invoked; a proxy, a foreign prototype, an
//     inherited, extra, missing, or symbol key, or an out-of-shape value is
//     rejected — a malformed principal is denied, a malformed discount row is
//     withheld from the view rather than partially rendered or leaked.
//
// SOURCE ONLY, UNUSED: imported by no runtime or Functions index; see
// SYSTEM_DESIGN.md §8.13. Requires only node:util.

const membersContentSchemaVersion = 1;

function immutableEnum(values) {
  return Object.freeze(Object.fromEntries(values.map((value) => [value.toUpperCase(), value])));
}

const AUTH_STATES = ['anonymous', 'signed_in'];
const MEMBERSHIP_STATUSES = ['none', 'pending', 'active', 'expired', 'revoked'];
const DISCOUNT_STATUSES = ['draft', 'published', 'archived'];
const ACCESS_DECISIONS = ['granted', 'denied'];
const GRANT_REASONS = ['member', 'content_admin'];
const DENIAL_REASONS = [
  'malformed_principal',
  'malformed_catalog',
  'not_signed_in',
  'not_verified',
  'membership_inactive',
  'membership_expired',
];

const AuthState = immutableEnum(AUTH_STATES);
const MembershipStatus = immutableEnum(MEMBERSHIP_STATUSES);
const DiscountStatus = immutableEnum(DISCOUNT_STATUSES);
const AccessDecision = immutableEnum(ACCESS_DECISIONS);
const AccessGrantReason = immutableEnum(GRANT_REASONS);
const AccessDenialReason = immutableEnum(DENIAL_REASONS);

const AUTH_STATE_SET = new Set(AUTH_STATES);
const MEMBERSHIP_STATUS_SET = new Set(MEMBERSHIP_STATUSES);
const DISCOUNT_STATUS_SET = new Set(DISCOUNT_STATUSES);

// The exact, closed key sets each evidence record must present — no more, no less.
const PRINCIPAL_FIELDS = [
  'membersContentSchemaVersion',
  'authState',
  'emailVerified',
  'membershipStatus',
  'membershipExpiresAt',
  'contentAdmin',
  'asOf',
];
const CATALOG_FIELDS = ['membersContentSchemaVersion', 'rows'];
const DISCOUNT_FIELDS = [
  'discountId',
  'status',
  'title',
  'terms',
  'redemption',
  'expiresAt',
  'sourceOwner',
  'lastReviewedAt',
];
// The only discount fields a granted member view ever carries. Everything else on
// a stored discount record (its status, source owner, and last-reviewed time) is
// internal and never projected.
const MEMBER_VISIBLE_FIELDS = ['discountId', 'title', 'terms', 'redemption', 'expiresAt'];

const DISCOUNT_ID_PATTERN = /^[A-Za-z0-9._-]{1,256}$/;
const UTC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
const TEXT_MAX = 4096;
const SOURCE_OWNER_MAX = 256;
const ROW_LIMIT = 4096;

function isUtcTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (hour > 23) return false;
  if (minute > 59) return false;
  if (second > 59) return false;
  return true;
}

function isDiscountId(value) {
  return typeof value === 'string' && DISCOUNT_ID_PATTERN.test(value);
}

// Reject any control character or invisible separator from a content field:
// all C0 controls (including tab, LF, and CR — these are single-line plain-text
// fields), DEL, the C1 range, and the Unicode line/paragraph separators.
// Ordinary international letters, digits, punctuation, and emoji are allowed. A
// charCodeAt scan avoids embedding a control character in a regular expression.
function hasForbiddenTextChar(text) {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x1f) return true;
    if (code >= 0x7f && code <= 0x9f) return true;
    if (code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

function isPlainText(value, max) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= max
    && !hasForbiddenTextChar(value);
}

// Read an exact, closed envelope: an ordinary object whose own enumerable string
// keys are precisely `expectedFields`, each a plain data property. Returns a
// null-prototype copy read with no getter ever invoked, or null on any deviation
// (proxy, array, foreign prototype, symbol key, wrong key count, missing, extra,
// inherited, accessor, or non-enumerable field).
function readExact(value, expectedFields) {
  if (value === null || typeof value !== 'object') return null;
  // isProxy is checked before Array.isArray: Array.isArray throws on a revoked
  // proxy (it unwraps the target), whereas isProxy safely reports it as a proxy,
  // which this rejects. Order matters for total, never-throwing behavior.
  if (isProxy(value)) return null;
  if (Array.isArray(value)) return null;
  if (Object.getPrototypeOf(value) !== Object.prototype) return null;
  if (Object.getOwnPropertySymbols(value).length !== 0) return null;
  const keys = Object.keys(value);
  if (keys.length !== expectedFields.length) return null;
  for (const key of keys) {
    if (!expectedFields.includes(key)) return null;
  }
  const out = Object.create(null);
  for (const field of expectedFields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor) return null;
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
    if (!descriptor.enumerable) return null;
    out[field] = descriptor.value;
  }
  return out;
}

// Validate a principal's already-server-verified standing. Per-field shapes only;
// the access gate below interprets the combination. Cross-field membership/expiry
// coherence is deliberately not enforced here — an active membership may be
// evergreen (null expiry), and the gate treats a non-active status as unentitled
// regardless of any expiry value.
function readPrincipal(value) {
  const principal = readExact(value, PRINCIPAL_FIELDS);
  if (!principal) return null;
  if (principal.membersContentSchemaVersion !== membersContentSchemaVersion) return null;
  if (typeof principal.authState !== 'string' || !AUTH_STATE_SET.has(principal.authState)) return null;
  if (typeof principal.emailVerified !== 'boolean') return null;
  if (typeof principal.membershipStatus !== 'string'
    || !MEMBERSHIP_STATUS_SET.has(principal.membershipStatus)) {
    return null;
  }
  if (principal.membershipExpiresAt !== null && !isUtcTimestamp(principal.membershipExpiresAt)) return null;
  if (typeof principal.contentAdmin !== 'boolean') return null;
  if (!isUtcTimestamp(principal.asOf)) return null;
  return principal;
}

function readCatalogEnvelope(value) {
  const catalog = readExact(value, CATALOG_FIELDS);
  if (!catalog) return null;
  if (catalog.membersContentSchemaVersion !== membersContentSchemaVersion) return null;
  // Harden the rows container itself (readExact hardens the envelope and each row,
  // but not the array between them). Reject a proxy container before Array.isArray
  // — a revoked proxy would throw there — so the loop below reads a genuine array.
  if (isProxy(catalog.rows)) return null;
  if (!Array.isArray(catalog.rows)) return null;
  if (catalog.rows.length > ROW_LIMIT) return null;
  return catalog;
}

function readDiscount(value) {
  const row = readExact(value, DISCOUNT_FIELDS);
  if (!row) return null;
  if (!isDiscountId(row.discountId)) return null;
  if (typeof row.status !== 'string' || !DISCOUNT_STATUS_SET.has(row.status)) return null;
  if (!isPlainText(row.title, TEXT_MAX)) return null;
  if (!isPlainText(row.terms, TEXT_MAX)) return null;
  if (!isPlainText(row.redemption, TEXT_MAX)) return null;
  if (row.expiresAt !== null && !isUtcTimestamp(row.expiresAt)) return null;
  if (!isPlainText(row.sourceOwner, SOURCE_OWNER_MAX)) return null;
  if (!isUtcTimestamp(row.lastReviewedAt)) return null;
  return row;
}

// Project a validated discount onto exactly the member-visible allowlist. Internal
// fields are structurally absent from the result — dropped, not blanked.
function projectDiscount(row) {
  return Object.freeze({
    discountId: row.discountId,
    title: row.title,
    terms: row.terms,
    redemption: row.redemption,
    expiresAt: row.expiresAt,
  });
}

const DENIALS = Object.freeze(Object.fromEntries(
  DENIAL_REASONS.map((reason) => [reason, Object.freeze({ decision: 'denied', reason })]),
));

function deny(reason) {
  return DENIALS[reason];
}

function projectMemberDiscounts(principalEvidence, catalog) {
  const principal = readPrincipal(principalEvidence);
  if (!principal) return deny('malformed_principal');

  // Access gate — withhold-by-default. Both a member and a content admin must be
  // signed in and email-verified before any discount is considered.
  if (principal.authState !== 'signed_in') return deny('not_signed_in');
  if (principal.emailVerified !== true) return deny('not_verified');

  const membershipLive = principal.membershipStatus === 'active'
    && (principal.membershipExpiresAt === null || principal.asOf < principal.membershipExpiresAt);
  const isContentAdmin = principal.contentAdmin === true;

  if (!membershipLive && !isContentAdmin) {
    // An 'active' status that failed the live check can only have failed on date.
    if (principal.membershipStatus === 'active') return deny('membership_expired');
    return deny('membership_inactive');
  }

  // Entitled. Read and project the catalog, withholding every row that is not a
  // well-formed, currently published, not-yet-expired discount.
  const catalogEnvelope = readCatalogEnvelope(catalog);
  if (!catalogEnvelope) return deny('malformed_catalog');

  const { asOf } = principal;
  const { rows } = catalogEnvelope;
  const discounts = [];
  for (let index = 0; index < rows.length; index += 1) {
    // Read each element through its own data descriptor: a hole yields no
    // descriptor and an accessor index yields one with no `value`, both skipped
    // without ever invoking a getter (the rows container passed the proxy guard
    // above, so no trap can fire either).
    const descriptor = Object.getOwnPropertyDescriptor(rows, index);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) continue;
    const row = readDiscount(descriptor.value);
    if (!row) continue;
    if (row.status !== 'published') continue;
    if (row.expiresAt !== null && !(asOf < row.expiresAt)) continue;
    discounts.push(projectDiscount(row));
  }

  return Object.freeze({
    decision: 'granted',
    reason: membershipLive ? 'member' : 'content_admin',
    asOf,
    discountCount: discounts.length,
    discounts: Object.freeze(discounts),
  });
}

module.exports = Object.freeze({
  membersContentSchemaVersion,
  AuthState,
  MembershipStatus,
  DiscountStatus,
  AccessDecision,
  AccessGrantReason,
  AccessDenialReason,
  MEMBER_VISIBLE_FIELDS: Object.freeze([...MEMBER_VISIBLE_FIELDS]),
  projectMemberDiscounts,
});
