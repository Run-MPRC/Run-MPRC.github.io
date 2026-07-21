'use strict';

// INSTAGRAM-004A — pure event-reminder-draft generation reconciliation (pure contract).
//
// SOURCE ONLY, UNUSED: this module is imported by nothing (not by
// functions/index.js, no route, no Firestore Rules, no callable, no scheduled
// worker). It has zero runtime behavior. It is the safety-critical decision core for
// the *idempotent generation* line of parent #94 (INSTAGRAM-004) — "Idempotently
// create one draft per configured event/template/lead-time/revision", "Invalidate
// approval or cancel pending posts when an event changes or is cancelled", and
// "Generated drafts never auto-approve" — landed and exhaustively negative-tested
// first so the eventual wiring is a mechanical hookup of already-proven invariants.
// See SYSTEM_DESIGN.md §8.22.
//
// What it decides: for ONE configured reminder slot (one event × one approved
// template × one lead time), given the event's CURRENT public standing (the
// reconciled output of the §8.6 public-event projection, as an opaque source
// revision plus an admission verdict) and the draft ALREADY generated for that exact
// slot (or none), it returns exactly one frozen verdict — `generate` a fresh draft,
// `regenerate` (mint a fresh draft AND supersede a now-stale active draft bound to an
// older revision), `skip` (an idempotent no-op), `cancel_pending` (withdraw an active
// draft because the event was cancelled or is no longer public), or `denied`
// (malformed/incoherent input). It is a non-throwing frozen-verdict reducer (the idiom
// of §8.15/§8.16/§8.17/§8.18/§8.20/§8.21) and NEVER throws: the existing-draft record
// is read back from a forgeable store, so a malformed shape is a NORMAL adversarial
// event that must resolve to a reason-coded verdict, never an exception a batch
// reconciler loop has to catch.
//
// Marquee safety properties, all encoded structurally rather than merely guarded:
//
//  * IDEMPOTENT — a draft already generated for this exact (event, template,
//    lead-time, revision) tuple yields `skip already_current`, never a duplicate. The
//    draft identity is a deterministic, collision-free function of that tuple
//    (`deriveDraftId`), so re-running the reconciler over an unchanged event is a
//    provable no-op. Feeding a `generate` verdict's own draft back in as the existing
//    draft (same revision) closes to `skip` — the idempotency loop, tested directly.
//
//  * REVISION-MONOTONE INVALIDATION — when the event advances to a new source
//    revision, an ACTIVE draft bound to the OLD revision is stale (any approval it
//    carries no longer matches the event) and is SUPERSEDED: the verdict mints a fresh
//    draft for the new revision AND names the prior draft to invalidate. The new and
//    superseded ids provably differ (the id join is injective), so a changed event can
//    never silently keep a stale-approved draft. This is #94's "invalidate approval
//    when an event changes."
//
//  * WITHDRAWAL IS FAIL-SAFE — a `cancelled` OR `withheld` event cancels any ACTIVE
//    draft (`cancel_pending`), regardless of revision. A members-only-turned or
//    cancelled event can therefore never keep a publishable pending reminder — the
//    leak-/staleness-safety path. (`withheld` = the §6 public-event projection no
//    longer admits the event for public view.)
//
//  * NEVER AUTO-APPROVES — the only verdicts that mint a draft (`generate`,
//    `regenerate`) stamp `autoApproved: false`, and the decision vocabulary contains
//    NO approve/publish action at all, so no code path — correct or buggy — can emit an
//    already-approved or published draft. Approval stays a human decision governed by
//    the §8.7 post-lifecycle reducer. This is #94's "Generated drafts never
//    auto-approve," asserted on the enums themselves.
//
// Content-free by construction: it holds only opaque handles (event/template
// references, source-revision tokens), a closed admission enum, a closed lifecycle
// enum, and a bounded integer lead time — never a caption, media reference, alt text,
// URL, timezone, disclosure flag, member/contact datum, or any event content. WHAT a
// public view may contain is decided upstream by the §8.6 `projectPublicEvent`
// projection; WHETHER an operator command may advance/approve/publish a post is decided
// by the §8.7 `classifySocialPostTransition` reducer (via canonical payload-hash
// binding). This slice decides only the SYSTEM-driven generate/regenerate/cancel of
// drafts as an event's public standing changes over time, keyed on opaque revision
// IDENTITY — it reads no content and computes no hash. A source-boundary test enforces
// that absence.
//
// Requires only node:util. Reads no clock, env, network, Firestore, or provider.

const {
  types: { isProxy },
} = require('node:util');

const eventReminderSchemaVersion = 1;

function immutableEnum(values) {
  return Object.freeze(Object.fromEntries(values.map((v) => [v.toUpperCase(), v])));
}

// ---- closed vocabularies -------------------------------------------------

// The event's current public standing for reminder generation — the reconciled
// output of the §8.6 public-event projection, narrowed to what this reducer needs.
// `publishable` = the event is currently admitted for public view and scheduled;
// `cancelled` = the event was cancelled; `withheld` = the projection no longer admits
// it for public view (drafted-back, archived, or turned members-only).
const EVENT_ADMISSIONS = ['publishable', 'cancelled', 'withheld'];

// The coarse lifecycle of an already-generated draft — deliberately two-valued so this
// reducer never duplicates the §8.7 post state machine. `active` = the draft can still
// change or publish (draft/pending_review/approved/scheduled); `terminal` = it is done
// (already published or cancelled) and is left as history.
const DRAFT_LIFECYCLES = ['active', 'terminal'];

const GENERATION_DECISIONS = ['generate', 'regenerate', 'skip', 'cancel_pending', 'denied'];
// `already_current` = a draft for this exact revision already exists (the idempotent
// no-op). `already_absent` = the event is not publishable and there is no active draft
// to cancel.
const SKIP_REASONS = ['already_current', 'already_absent'];
// Why an active draft is being withdrawn.
const CANCEL_REASONS = ['event_cancelled', 'event_withheld'];
// `slot_mismatch` = the supplied existing draft is for a different (event, template,
// lead-time) than the slot — incoherent caller wiring, surfaced loudly (only the bound
// revision may legitimately differ).
const DENIAL_REASONS = ['malformed_slot', 'malformed_existing_draft', 'slot_mismatch'];

const EventAdmission = immutableEnum(EVENT_ADMISSIONS);
const DraftLifecycle = immutableEnum(DRAFT_LIFECYCLES);
const GenerationDecision = immutableEnum(GENERATION_DECISIONS);
const SkipReason = immutableEnum(SKIP_REASONS);
const CancelReason = immutableEnum(CANCEL_REASONS);
const DenialReason = immutableEnum(DENIAL_REASONS);

const EVENT_ADMISSION_SET = new Set(EVENT_ADMISSIONS);
const DRAFT_LIFECYCLE_SET = new Set(DRAFT_LIFECYCLES);

// ---- record shapes -------------------------------------------------------

// One configured reminder slot's current desired state: the event, its current source
// revision and public admission, and the approved template + lead time that identify
// the slot. Carries NO event content — only opaque handles, a closed admission enum,
// and a bounded integer.
const SLOT_FIELDS = [
  'eventReminderSchemaVersion',
  'eventRef',
  'sourceRevision',
  'eventAdmission',
  'templateId',
  'leadTimeMinutes',
];
// The draft already generated for that exact slot (or a literal null for none). It is
// bound to the source revision it was generated FROM (which may now be stale) and
// carries only its coarse lifecycle — never content.
const EXISTING_DRAFT_FIELDS = [
  'eventReminderSchemaVersion',
  'eventRef',
  'sourceRevision',
  'templateId',
  'leadTimeMinutes',
  'lifecycle',
];

// An event/template/revision reference is an opaque, store-minted, url-safe handle. The
// closed charset (which excludes the '|' draft-id delimiter) also keeps a reference
// from carrying a control character, comma, quote, or newline into any downstream line.
const HANDLE_PATTERN = /^[A-Za-z0-9._-]{1,256}$/;

function isHandleString(value) {
  return typeof value === 'string' && HANDLE_PATTERN.test(value);
}

// A lead time in whole minutes before the event. Bounded by a conservative sanity cap
// (30 days) purely to reject absurd/non-finite values and keep the derived id short —
// the set of APPROVED lead times is owner policy that stays with parent #94, not this
// mechanism. typeof 'number' excludes BigInt; Number.isInteger excludes NaN/Infinity
// and non-integers.
const MAX_LEAD_TIME_MINUTES = 43200;

function isLeadTimeMinutes(value) {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
    && value <= MAX_LEAD_TIME_MINUTES;
}

// Read an exact, closed record: an ordinary object whose own string-keyed
// properties are precisely `expectedFields`, each an enumerable data property.
// Returns a null-prototype copy read with no getter ever invoked, or null on any
// deviation (proxy, array, foreign prototype, symbol key, wrong key count,
// missing, extra — enumerable OR non-enumerable — inherited, accessor, or
// non-enumerable field).
function readExact(value, expectedFields) {
  if (value === null || typeof value !== 'object') return null;
  // isProxy before Array.isArray: Array.isArray throws on a revoked proxy, while
  // isProxy safely reports it as a proxy (which this rejects). Order matters for
  // total, never-throwing behavior.
  if (isProxy(value)) return null;
  if (Array.isArray(value)) return null;
  if (Object.getPrototypeOf(value) !== Object.prototype) return null;
  if (Object.getOwnPropertySymbols(value).length !== 0) return null;
  // Own property NAMES, not just enumerable keys: a non-enumerable extra own
  // property must also deny — invisible to Object.keys but still makes the record
  // something other than the exact closed shape. With symbols already rejected,
  // this bounds the total own-key surface to exactly `expectedFields`.
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

// Two distinct private sentinels — never exported, never returned in a verdict — so
// the decision can tell "no draft yet" (a literal null) apart from "a malformed draft
// object" apart from "a validated existing draft" by identity.
const DRAFT_NONE = Object.freeze(Object.create(null));
const DRAFT_INVALID = Object.freeze(Object.create(null));

function readSlot(value) {
  const slot = readExact(value, SLOT_FIELDS);
  if (!slot) return null;
  if (slot.eventReminderSchemaVersion !== eventReminderSchemaVersion) return null;
  if (!isHandleString(slot.eventRef)) return null;
  if (!isHandleString(slot.sourceRevision)) return null;
  if (typeof slot.eventAdmission !== 'string' || !EVENT_ADMISSION_SET.has(slot.eventAdmission)) {
    return null;
  }
  if (!isHandleString(slot.templateId)) return null;
  if (!isLeadTimeMinutes(slot.leadTimeMinutes)) return null;
  return slot;
}

// Read the existing-draft side. A literal null means "no draft yet" (DRAFT_NONE); a
// valid draft object is returned as a null-prototype copy; anything else is
// DRAFT_INVALID (surfaced as a loud denial, never silently treated as no draft).
function readExistingDraft(value) {
  if (value === null) return DRAFT_NONE;
  const draft = readExact(value, EXISTING_DRAFT_FIELDS);
  if (!draft) return DRAFT_INVALID;
  if (draft.eventReminderSchemaVersion !== eventReminderSchemaVersion) return DRAFT_INVALID;
  if (!isHandleString(draft.eventRef)) return DRAFT_INVALID;
  if (!isHandleString(draft.sourceRevision)) return DRAFT_INVALID;
  if (!isHandleString(draft.templateId)) return DRAFT_INVALID;
  if (!isLeadTimeMinutes(draft.leadTimeMinutes)) return DRAFT_INVALID;
  if (typeof draft.lifecycle !== 'string' || !DRAFT_LIFECYCLE_SET.has(draft.lifecycle)) {
    return DRAFT_INVALID;
  }
  return draft;
}

// ---- draft identity ------------------------------------------------------

const DRAFT_ID_PREFIX = 'er1'; // event-reminder draft identity, schema v1

// A stable, deterministic, collision-free draft identity for one
// (event, revision, template, lead-time) tuple. Every component is drawn from a charset
// that excludes the '|' delimiter — the three handles match HANDLE_PATTERN and
// leadTimeMinutes is a non-negative integer rendered as digits — so the join is
// INJECTIVE: distinct tuples never collide and identical tuples always match. That
// injectivity is what makes "one draft per event/template/lead-time/revision" (skip on
// re-run) and "a new revision is a genuinely new draft" (supersede, not reuse) provable.
function deriveDraftId(eventRef, sourceRevision, templateId, leadTimeMinutes) {
  return `${DRAFT_ID_PREFIX}|${eventRef}|${sourceRevision}|${templateId}|${leadTimeMinutes}`;
}

// ---- verdict constructors ------------------------------------------------

// `autoApproved` is stamped `false` on EVERY draft-minting verdict — the
// machine-checkable encoding of the never-auto-approve invariant. No verdict ever
// carries `autoApproved: true`, and no decision names an approve/publish action.

function generate(eventRef, sourceRevision, templateId, leadTimeMinutes) {
  return Object.freeze({
    decision: 'generate',
    draftId: deriveDraftId(eventRef, sourceRevision, templateId, leadTimeMinutes),
    eventRef,
    sourceRevision,
    templateId,
    leadTimeMinutes,
    autoApproved: false,
  });
}

// Mint a fresh draft for the new revision AND name the stale active draft (bound to the
// prior revision) that the caller must invalidate. The two ids provably differ.
function regenerate(eventRef, newRevision, priorRevision, templateId, leadTimeMinutes) {
  return Object.freeze({
    decision: 'regenerate',
    draftId: deriveDraftId(eventRef, newRevision, templateId, leadTimeMinutes),
    supersededDraftId: deriveDraftId(eventRef, priorRevision, templateId, leadTimeMinutes),
    eventRef,
    sourceRevision: newRevision,
    priorRevision,
    templateId,
    leadTimeMinutes,
    supersedesPriorRevision: true,
    autoApproved: false,
  });
}

// Withdraw an active draft because the event was cancelled or is no longer public.
// `sourceRevision` here is the EXISTING draft's revision — the id names what to cancel.
function cancelPending(reason, eventRef, sourceRevision, templateId, leadTimeMinutes) {
  return Object.freeze({
    decision: 'cancel_pending',
    reason,
    draftId: deriveDraftId(eventRef, sourceRevision, templateId, leadTimeMinutes),
    eventRef,
    sourceRevision,
    templateId,
    leadTimeMinutes,
  });
}

const SKIPS = Object.freeze(Object.fromEntries(
  SKIP_REASONS.map((reason) => [reason, Object.freeze({ decision: 'skip', reason })]),
));

function skip(reason) {
  return SKIPS[reason];
}

const DENIALS = Object.freeze(Object.fromEntries(
  DENIAL_REASONS.map((reason) => [reason, Object.freeze({ decision: 'denied', reason })]),
));

function deny(reason) {
  return DENIALS[reason];
}

// ---- the decision --------------------------------------------------------

function classifyEventReminderGeneration(slotEvidence, existingDraftEvidence) {
  const slot = readSlot(slotEvidence);
  if (!slot) return deny('malformed_slot');
  const draft = readExistingDraft(existingDraftEvidence);
  if (draft === DRAFT_INVALID) return deny('malformed_existing_draft');

  const {
    eventRef, sourceRevision, eventAdmission, templateId, leadTimeMinutes,
  } = slot;

  // Coherence: a supplied existing draft MUST be for the same reminder slot — same
  // event, template, and lead time — because the caller looks it up by exactly that
  // slot key. Only the bound sourceRevision may legitimately differ (that IS the
  // event-changed signal). A mismatch on the slot identity is incoherent wiring,
  // surfaced loudly rather than silently misattributing a draft to the wrong slot.
  if (draft !== DRAFT_NONE
    && (draft.eventRef !== eventRef
      || draft.templateId !== templateId
      || draft.leadTimeMinutes !== leadTimeMinutes)) {
    return deny('slot_mismatch');
  }

  if (eventAdmission === 'publishable') {
    if (draft === DRAFT_NONE) {
      return generate(eventRef, sourceRevision, templateId, leadTimeMinutes);
    }
    if (draft.sourceRevision === sourceRevision) {
      // A draft for this exact revision already exists (active or terminal) — the
      // idempotent no-op that makes "one draft per event/template/lead-time/revision"
      // hold under re-runs.
      return skip('already_current');
    }
    // The event advanced to a new revision. An ACTIVE draft bound to the old revision
    // is stale (any approval it holds no longer matches the event) and must be
    // superseded; a TERMINAL one (already published or cancelled) is history and is
    // left intact while a fresh draft is generated for the new revision.
    return draft.lifecycle === 'active'
      ? regenerate(eventRef, sourceRevision, draft.sourceRevision, templateId, leadTimeMinutes)
      : generate(eventRef, sourceRevision, templateId, leadTimeMinutes);
  }

  // eventAdmission is 'cancelled' or 'withheld' — the event must not (any longer)
  // produce a public reminder. Cancel an ACTIVE draft regardless of revision; a
  // NONE/terminal draft is a no-op. This is the leak-/staleness-safety path: a
  // cancelled or no-longer-public event can never keep a publishable pending reminder.
  if (draft !== DRAFT_NONE && draft.lifecycle === 'active') {
    return cancelPending(
      eventAdmission === 'cancelled' ? 'event_cancelled' : 'event_withheld',
      eventRef,
      draft.sourceRevision,
      templateId,
      leadTimeMinutes,
    );
  }
  return skip('already_absent');
}

module.exports = Object.freeze({
  eventReminderSchemaVersion,
  EventAdmission,
  DraftLifecycle,
  GenerationDecision,
  SkipReason,
  CancelReason,
  DenialReason,
  classifyEventReminderGeneration,
});
