'use strict';

// EVENTS-001B — pure approved-event-source admission contract (pure contract).
//
// SOURCE ONLY, UNUSED: this module is imported by nothing (not by
// functions/index.js, no route, no Firestore Rules, no callable, no scheduled
// importer). It has zero runtime behavior. It is the safety-critical decision core for
// the *approved source contract* half of parent #121 (EVENTS-001A) — "Approve one
// canonical public event projection AND the contract that an eventual structured source
// must satisfy" — landed and exhaustively negative-tested first so the eventual importer
// is a mechanical hookup of already-proven invariants. See SYSTEM_DESIGN.md §8.6a.
//
// It is the INGEST side of the same public-event pipeline whose PUBLISH side is the
// §8.6 `projectPublicEvent` projection (#399). #121's flowchart is
//   Approved structured source -> Validate and minimize -> PRIVATE DRAFT
//     -> Officer review -> Audited publish -> [§8.6] Public event view
// §8.6 owns the last arrow (a private, reviewed public-candidate record -> a minimized
// public VIEW). This owns the first arrow — whether ONE raw structured source delivery
// may be admitted as a PRIVATE DRAFT — and nothing between: it issues no review/publish
// transition and grants no public visibility.
//
// What it decides: given the owner-approved descriptor for a source (the caller's lookup
// result, or a literal null for "no approved source") and one raw source delivery, it
// returns exactly one frozen verdict — `admit` (the delivery may become a private draft),
// `refused` (a policy boundary/authorization refusal — the source is not approved, not
// active, not a public-eligible kind, names a different source, or the delivery carries a
// key outside the public-candidate allowlist), or `denied` (malformed shape). It is a
// non-throwing frozen-verdict reducer (the idiom of §8.20/§8.21/§8.22): the delivery is
// read back from an external, forgeable source, so a malformed shape is a NORMAL
// adversarial event that must resolve to a reason-coded verdict, never an exception a
// batch importer loop has to catch. §8.6, by contrast, is a THROWING projector because it
// reads an already-reviewed, server-trusted record.
//
// Marquee safety properties, all encoded structurally rather than merely guarded:
//
//  * SOURCE-AUTHORIZED — a delivery is admitted only when the caller supplied an
//    APPROVED, ACTIVE, PUBLIC-ELIGIBLE source descriptor whose `sourceId` MATCHES the
//    delivery's. A null descriptor (no approved source) is refused `source_not_approved`
//    WITHOUT the untrusted payload ever being parsed; an inactive source is
//    `source_inactive`; a member-only-discount / registration-response / historical
//    source kind is `source_kind_not_public`; a delivery claiming a different `sourceId`
//    than the approved descriptor authorizes is `source_mismatch`. §8.6 has no concept
//    of a source; this is the authorization gate in front of the pipeline.
//
//  * PUBLIC/PROTECTED BOUNDARY (ALLOWLIST, NEVER DENYLIST) — the delivery's key set must
//    be EXACTLY the closed public-candidate allowlist (which includes the single opaque
//    `protectedOfferRef` linkage). A key outside that set — which is exactly how an
//    inlined discount or promotion code, a registration or guest list, a form response,
//    a payment state, a Stripe id, waiver evidence, an emergency contact, a private
//    location, a door/access instruction, a member contact, an internal note, an audit
//    record, a provider token, or a source credential would arrive — makes the key set
//    wrong and is refused `unexpected_field`, never admitted. Because the guard is a
//    closed allowlist and NOT a denylist, no protected-field NAME appears anywhere in
//    this source, and an unforeseen protected field is refused just the same. The only
//    channel by which a protected offer may be referenced is the opaque `protectedOfferRef`
//    id — never the code or terms themselves — implementing #121's "reference a separate
//    protected discount offer ONLY through a stable opaque ID."
//
//  * NEVER AUTO-PUBLISHES — the sole success verdict stamps `lifecycle: 'draft'` and
//    `published: false`, and the decision/reason vocabulary contains NO publish, approve,
//    or public verb at all, so no code path — correct or buggy — can admit a delivery
//    straight to public visibility. An admitted delivery is a PRIVATE draft that must
//    still pass officer review and the §8.6 projection before any public exposure. This
//    is #121's "becomes a private draft only after validation ... an authorized officer
//    reviews it before an audited publish," asserted on the enums themselves.
//
//  * INJECTIVE IDEMPOTENCY KEY — the emitted `draftId` is a deterministic, collision-free
//    join of (sourceId, sourceEventId, sourceRevision) over a reserved '|' delimiter that
//    none of the three opaque components can contain, so it is INJECTIVE: a re-delivery of
//    the same source revision yields the SAME draftId (the caller dedupes on it — one
//    draft per source event revision) and a new revision a provably DISTINCT one. This is
//    #121's "Stable source ID and revision/idempotency key."
//
// Content-light and defense-in-depth by construction: this contract carries only opaque
// handles (source/event/revision refs, the opaque offer ref), a closed source-kind enum,
// and the draft disposition — never a title, summary, location, URL, timestamp, or any
// event content, and a source-boundary test enforces the absence of protected/secret
// vocabulary. It validates the delivery's SHAPE and BOUNDARY (each public-candidate field
// present, string-typed, and length-bounded for ingestion sanity; each id opaque), but
// DELIBERATELY defers all public-CONTENT validation — control characters, `<`/`>` markup,
// the strict https URL allowlist, UTC-timestamp component ranges, IANA timezone,
// endsAt>=startsAt, the event-type vocabulary, and the tighter per-field public bounds —
// to the §8.6 `projectPublicEvent` projection, which is the public gate every admitted
// draft must still pass. Re-implementing §8.6's field validators here would duplicate a
// sibling; a draft this admits is never public until §8.6 clears it.
//
// Requires only node:util. Reads no clock, env, network, Firestore, or provider.

const {
  types: { isProxy },
} = require('node:util');

const eventSourceAdmissionSchemaVersion = 1;

function immutableEnum(values) {
  return Object.freeze(Object.fromEntries(values.map((v) => [v.toUpperCase(), v])));
}

// ---- closed vocabularies -------------------------------------------------

// The owner-classified kind of an approved source (#121 "Owner decisions required").
// The first three are PUBLIC-ELIGIBLE — an event feed whose items may become a public
// event view. The last three are approved source categories that are deliberately NOT
// public events (a member-only discount offer, a registration/form response, or a
// historical private item); a well-formed descriptor of such a kind is refused
// `source_kind_not_public`, never admitted. Modelling them explicitly (rather than as
// "unknown") lets the reducer fail closed on a real, approved-but-non-public source.
const SOURCE_KINDS = [
  'mprc_hosted_event',
  'club_run_or_social',
  'third_party_race_listing',
  'member_only_discount_offer',
  'registration_or_form_response',
  'historical_private_item',
];
const PUBLIC_ELIGIBLE_KINDS = [
  'mprc_hosted_event',
  'club_run_or_social',
  'third_party_race_listing',
];

const ADMISSION_DECISIONS = ['admit', 'refused', 'denied'];
// Policy/authorization/boundary refusals — the source may not (yet) produce a draft, but
// the input is well-formed. `unexpected_field` is the public/protected boundary refusal.
const REFUSAL_REASONS = [
  'source_not_approved',
  'source_inactive',
  'source_kind_not_public',
  'source_mismatch',
  'unexpected_field',
];
// Malformed shape — a caller/source bug or a hostile payload.
const DENIAL_REASONS = ['malformed_approved_source', 'malformed_delivery'];

const SourceKind = immutableEnum(SOURCE_KINDS);
const AdmissionDecision = immutableEnum(ADMISSION_DECISIONS);
const RefusalReason = immutableEnum(REFUSAL_REASONS);
const DenialReason = immutableEnum(DENIAL_REASONS);

const SOURCE_KIND_SET = new Set(SOURCE_KINDS);
const PUBLIC_ELIGIBLE_SET = new Set(PUBLIC_ELIGIBLE_KINDS);

// ---- record shapes -------------------------------------------------------

// The owner-approved source descriptor: the caller's lookup result for the delivery's
// source. TRUSTED configuration (contrast the untrusted `delivery`), kept minimal — this
// reducer holds no registry and reads no index; the caller supplies the descriptor it
// found (or a literal null for "no approved source"), exactly as §8.0e consumes
// caller-supplied binding evidence rather than reading any index.
const APPROVED_SOURCE_FIELDS = [
  'eventSourceAdmissionSchemaVersion',
  'sourceId',
  'sourceKind',
  'active',
];

// One raw structured source delivery — UNTRUSTED. Its key set is the closed
// public-candidate allowlist: the source identity (sourceId/sourceEventId/sourceRevision),
// the public-candidate content fields (validated for public display by §8.6, not here),
// and the single opaque `protectedOfferRef` (an opaque id or null — the ONLY permitted
// protected linkage). Any key outside this exact set is the public/protected boundary
// violation `unexpected_field`.
const DELIVERY_FIELDS = [
  'eventSourceAdmissionSchemaVersion',
  'sourceId',
  'sourceEventId',
  'sourceRevision',
  'eventType',
  'title',
  'summary',
  'startsAt',
  'endsAt',
  'timezone',
  'locationText',
  'publicUrl',
  'accessibilityText',
  'protectedOfferRef',
];
const DELIVERY_FIELD_SET = new Set(DELIVERY_FIELDS);

// The public-candidate CONTENT fields — present, string-typed, and length-bounded here;
// validated for public display (control chars, markup, URL scheme, timestamp ranges,
// timezone, ordering, vocabulary) downstream by §8.6. NOT echoed in the verdict.
const CONTENT_FIELDS = [
  'eventType',
  'title',
  'summary',
  'startsAt',
  'endsAt',
  'timezone',
  'locationText',
  'publicUrl',
  'accessibilityText',
];

// An opaque, store-minted, url-safe handle. The closed charset excludes the '|'
// draft-id delimiter (so the derived id join stays injective) and every whitespace,
// comma, quote, control, and markup character (so a handle can never smuggle a URL,
// markup, or a delimiter into any downstream line). Bounded to reject runaway values.
const HANDLE_PATTERN = /^[A-Za-z0-9._-]{1,256}$/;

function isHandleString(value) {
  return typeof value === 'string' && HANDLE_PATTERN.test(value);
}

// A generous ingestion-sanity ceiling for public-candidate content strings: large enough
// for real event copy, small enough to reject a runaway or binary payload at ingest. This
// is NOT the public-display bound — §8.6 applies the tighter per-field public limits when
// the draft is later projected. A content field must be a non-empty string within it.
const MAX_CONTENT_LENGTH = 8192;

function isBoundedContentString(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_CONTENT_LENGTH;
}

// Read an exact, closed record: an ordinary object whose own string-keyed properties are
// precisely `expectedFields`, each an enumerable data property. Returns a null-prototype
// copy read with no getter ever invoked, or null on any deviation (proxy, array, foreign
// prototype, symbol key, wrong key count, missing, extra — enumerable OR non-enumerable —
// inherited, accessor, or non-enumerable field).
function readExact(value, expectedFields) {
  if (value === null || typeof value !== 'object') return null;
  // isProxy before Array.isArray: Array.isArray throws on a revoked proxy, while isProxy
  // safely reports it as a proxy (which this rejects). Order matters for total,
  // never-throwing behavior.
  if (isProxy(value)) return null;
  if (Array.isArray(value)) return null;
  if (Object.getPrototypeOf(value) !== Object.prototype) return null;
  if (Object.getOwnPropertySymbols(value).length !== 0) return null;
  if (Object.getOwnPropertyNames(value).length !== expectedFields.length) return null;
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

function readApprovedSource(value) {
  const src = readExact(value, APPROVED_SOURCE_FIELDS);
  if (!src) return null;
  if (src.eventSourceAdmissionSchemaVersion !== eventSourceAdmissionSchemaVersion) return null;
  if (!isHandleString(src.sourceId)) return null;
  if (typeof src.sourceKind !== 'string' || !SOURCE_KIND_SET.has(src.sourceKind)) return null;
  if (typeof src.active !== 'boolean') return null;
  return src;
}

// Two distinct private sentinels — never exported, never returned in a verdict — so the
// delivery read can tell "malformed shape" (a caller/source bug or hostile payload) apart
// from "a well-formed record that violates the public/protected boundary" (an extra key)
// by identity, and give each its own verdict.
const DELIVERY_MALFORMED = Object.freeze(Object.create(null));
const DELIVERY_BOUNDARY = Object.freeze(Object.create(null));

// Read the untrusted delivery. Distinguishes, in this order:
//   * a hostile/ill-typed container (proxy, array, foreign prototype, symbol key) or a
//     MISSING required field or an ill-typed/out-of-grammar field  -> DELIVERY_MALFORMED
//   * a well-formed container carrying an EXTRA key outside the allowlist -> DELIVERY_BOUNDARY
//     (the public/protected boundary refusal `unexpected_field`)
//   * an exact, well-typed delivery -> a null-prototype copy
// The extra-key (boundary) check is separated from readExact so an inlined protected
// field surfaces as a policy refusal, while a genuinely malformed shape stays a denial.
function readDelivery(value) {
  if (value === null || typeof value !== 'object') return DELIVERY_MALFORMED;
  if (isProxy(value)) return DELIVERY_MALFORMED;
  if (Array.isArray(value)) return DELIVERY_MALFORMED;
  if (Object.getPrototypeOf(value) !== Object.prototype) return DELIVERY_MALFORMED;
  if (Object.getOwnPropertySymbols(value).length !== 0) return DELIVERY_MALFORMED;

  const names = Object.getOwnPropertyNames(value);
  // Any own property (enumerable or not) outside the allowlist is the boundary violation
  // — this is how an inlined protected value would arrive. Checked before missing-field
  // and value validation so the boundary refusal is not masked by an unrelated defect.
  for (const name of names) {
    if (!DELIVERY_FIELD_SET.has(name)) return DELIVERY_BOUNDARY;
  }
  // No extra keys. Now require the exact shape: every allowlisted field present as an
  // own enumerable data property (no getter invoked).
  if (names.length !== DELIVERY_FIELDS.length) return DELIVERY_MALFORMED;
  const keys = Object.keys(value);
  if (keys.length !== DELIVERY_FIELDS.length) return DELIVERY_MALFORMED;

  const out = Object.create(null);
  for (const field of DELIVERY_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor) return DELIVERY_MALFORMED;
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) return DELIVERY_MALFORMED;
    if (!descriptor.enumerable) return DELIVERY_MALFORMED;
    out[field] = descriptor.value;
  }

  if (out.eventSourceAdmissionSchemaVersion !== eventSourceAdmissionSchemaVersion) {
    return DELIVERY_MALFORMED;
  }
  if (!isHandleString(out.sourceId)) return DELIVERY_MALFORMED;
  if (!isHandleString(out.sourceEventId)) return DELIVERY_MALFORMED;
  if (!isHandleString(out.sourceRevision)) return DELIVERY_MALFORMED;
  // protectedOfferRef is the single optional protected linkage: an opaque id or an
  // explicit null (no offer). It is NOT permitted to be absent — the key must be present
  // (readExact-style exact shape) — only its value may be null.
  if (out.protectedOfferRef !== null && !isHandleString(out.protectedOfferRef)) {
    return DELIVERY_MALFORMED;
  }
  // Public-candidate content fields: present, string, length-bounded (ingestion sanity).
  // Public-display validation is §8.6's, deliberately not duplicated here.
  for (const field of CONTENT_FIELDS) {
    if (!isBoundedContentString(out[field])) return DELIVERY_MALFORMED;
  }
  return out;
}

// ---- draft identity ------------------------------------------------------

const DRAFT_ID_PREFIX = 'esa1'; // event-source-admission draft identity, schema v1

// A stable, deterministic, collision-free draft identity for one
// (sourceId, sourceEventId, sourceRevision) tuple. Every component matches HANDLE_PATTERN,
// whose charset excludes the '|' delimiter, so the join is INJECTIVE: distinct tuples
// never collide and identical tuples always match. That injectivity is what makes "one
// draft per source event revision" (dedupe on re-delivery) and "a new revision is a
// genuinely new draft" provable.
function deriveDraftId(sourceId, sourceEventId, sourceRevision) {
  return `${DRAFT_ID_PREFIX}|${sourceId}|${sourceEventId}|${sourceRevision}`;
}

// ---- verdict constructors ------------------------------------------------

// `published` is stamped `false` on the admit verdict — the machine-checkable encoding of
// the never-auto-publish invariant. No verdict ever carries `published: true` or names an
// approve/publish/public action; an admitted delivery is always a PRIVATE draft.
function admit(src, del) {
  return Object.freeze({
    decision: 'admit',
    reason: 'admitted',
    draftId: deriveDraftId(del.sourceId, del.sourceEventId, del.sourceRevision),
    sourceId: del.sourceId,
    sourceEventId: del.sourceEventId,
    sourceRevision: del.sourceRevision,
    sourceKind: src.sourceKind,
    protectedOfferRef: del.protectedOfferRef,
    lifecycle: 'draft',
    published: false,
  });
}

const REFUSALS = Object.freeze(Object.fromEntries(
  REFUSAL_REASONS.map((reason) => [reason, Object.freeze({ decision: 'refused', reason })]),
));

function refuse(reason) {
  return REFUSALS[reason];
}

const DENIALS = Object.freeze(Object.fromEntries(
  DENIAL_REASONS.map((reason) => [reason, Object.freeze({ decision: 'denied', reason })]),
));

function deny(reason) {
  return DENIALS[reason];
}

// ---- the decision --------------------------------------------------------

function classifyEventSourceAdmission(approvedSourceEvidence, deliveryEvidence) {
  // A null approved-source descriptor means the caller found no approved source for this
  // delivery. Refuse WITHOUT parsing the untrusted payload — minimal trust, fail closed:
  // an unapproved source's delivery is never examined.
  if (approvedSourceEvidence === null) return refuse('source_not_approved');

  const src = readApprovedSource(approvedSourceEvidence);
  if (!src) return deny('malformed_approved_source');
  if (src.active !== true) return refuse('source_inactive');
  if (!PUBLIC_ELIGIBLE_SET.has(src.sourceKind)) return refuse('source_kind_not_public');

  const del = readDelivery(deliveryEvidence);
  if (del === DELIVERY_MALFORMED) return deny('malformed_delivery');
  if (del === DELIVERY_BOUNDARY) return refuse('unexpected_field');

  // The approved descriptor authorizes exactly ONE sourceId; a delivery claiming any other
  // source is refused before it can borrow this source's authorization.
  if (del.sourceId !== src.sourceId) return refuse('source_mismatch');

  return admit(src, del);
}

module.exports = Object.freeze({
  eventSourceAdmissionSchemaVersion,
  SourceKind,
  AdmissionDecision,
  RefusalReason,
  DenialReason,
  classifyEventSourceAdmission,
});
