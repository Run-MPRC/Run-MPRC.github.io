'use strict';

// INSTAGRAM-005B — pure publish-outcome reconciliation decision (pure contract).
//
// SOURCE ONLY, UNUSED: this module is imported by nothing (not by
// functions/index.js, no route, no Firestore Rules, no callable, no scheduled
// worker). It has zero runtime behavior. It is the safety-critical decision core
// for the *publishing reconciliation* line of parent #95 (INSTAGRAM-005), landed
// and exhaustively negative-tested first so the eventual wiring is a mechanical
// hookup of already-proven invariants. See SYSTEM_DESIGN.md §8.20.
//
// What it decides: a post can get STUCK — a media container was created, or a
// publish was attempted, and the process died or the provider became unreachable
// before the true outcome was durably recorded (`outcome_unknown`). Given our
// durable record of how far that stuck post got (`intent`) and a later provider
// read-back of the account's actual media/container state (`observation`), it
// decides the post's ALREADY-TRUE terminal outcome: converge it to `published`
// (on positive media evidence), converge it to `failed` (only on definitive
// negative evidence), or route it to a human. It is a non-throwing frozen-verdict
// reducer (the idiom of §8.15/§8.16/§8.17/§8.18) and NEVER throws.
//
// The marquee safety property — it can NEVER cause a duplicate post. #95 exists to
// make the publisher maintainable "without creating duplicate posts during
// token/provider failures," and requires that an uncertain publish outcome "requires
// manual resolution and never automatic republish." This contract encodes that
// STRUCTURALLY, not merely by policy: its output vocabulary contains NO republish,
// retry, or publish action of any kind. Its decisions are `resolved` (record the
// already-true terminal state), `manual_review` (a human decides), or `denied`
// (malformed) — and every verdict carries `causesPublish: false`. So for ANY input,
// however hostile, this reducer cannot instruct a (re)publish. A `resolved`
// `published` verdict RECORDS a publish that already happened (it does not cause
// one); a `resolved` `failed` verdict records a non-publish. Because no output ever
// causes a publish, BOTH ways an adversary could forge the observation are
// duplicate-safe: forging `media_present` makes the reducer stop reconciling
// (no republish); hiding real media at worst marks the post `failed` (still no
// republish). The only thing an attacker with full control of the observation can
// never do is manufacture a duplicate post.
//
// Convergence is fail-safe:
//   * `published` requires POSITIVE evidence — account-owned media bound to this
//     post, with a media handle — and is checked FIRST, so a post that really
//     published is always caught as published regardless of anything else. (If our
//     own `intent` record were stale/wrong about how far we got, this positive
//     check still wins, so a real publish is never mislabeled failed.)
//   * `failed` requires DEFINITIVE negative evidence — no media AND the container is
//     gone AND our record says publish was never even attempted
//     (`container_created`) — the one combination in which a publish provably never
//     happened and cannot retroactively appear. Every other no-media / ambiguous /
//     indeterminate / attempted-but-unconfirmed / mismatched shape routes to
//     `manual_review`, never to a silent `failed` and never to a republish.
//
// Clockless BY CONSTRUCTION: this decision is purely structural over closed enums
// and opaque handles — it carries no timestamps at all, so there is no clock, no
// Date, and no date comparison anywhere (foreclosing the whole impossible-date
// class the §8.15 sibling had to defend by calendar-validating its instants).
//
// Holds no post content. It carries only opaque handles (post/account/container/
// media references drawn from a closed url-safe shape) and closed enums — never a
// caption, media bytes, URL, alt text, member/contact datum, or any post payload.
// A source-boundary test enforces that absence.
//
// Requires only node:util. Reads no clock, env, network, Firestore, or provider.

const {
  types: { isProxy },
} = require('node:util');

const publishReconciliationSchemaVersion = 1;

function immutableEnum(values) {
  return Object.freeze(Object.fromEntries(values.map((v) => [v.toUpperCase(), v])));
}

// ---- closed vocabularies -------------------------------------------------

// How far our durable record says the stuck post got. Both are non-terminal
// "stuck" states that carry a container; a post with no container is not a
// reconciliation input. `container_created` = a media container exists but publish
// was never attempted; `publish_attempted` = the publish step was called but its
// outcome was never durably confirmed.
const INTENDED_STATES = ['container_created', 'publish_attempted'];
// The provider read-back of whether account-owned media bound to this post exists.
// `media_present` = found; `no_media` = definitively absent; `indeterminate` = the
// read could not conclude (provider error / partial page / rate limit).
const MEDIA_STATES = ['media_present', 'no_media', 'indeterminate'];
// The provider read-back of the media container's current state.
const CONTAINER_STATES = ['container_live', 'container_absent', 'indeterminate'];

const RECONCILIATION_DECISIONS = ['resolved', 'manual_review', 'denied'];
// The already-true terminal state a `resolved` verdict records. Neither value is
// an action: `published` records a publish that already occurred; `failed` records
// that no publish occurred. There is deliberately NO republish/retry/publish value.
const TERMINAL_STATES = ['published', 'failed'];
const RESOLVED_REASONS = ['published_media_confirmed', 'no_publish_no_media'];
const MANUAL_REVIEW_REASONS = [
  'post_mismatch',
  'account_mismatch',
  'outcome_indeterminate',
  'container_orphan_unverified',
];
const DENIAL_REASONS = ['malformed_intent', 'malformed_observation'];

const IntendedState = immutableEnum(INTENDED_STATES);
const MediaState = immutableEnum(MEDIA_STATES);
const ContainerState = immutableEnum(CONTAINER_STATES);
const ReconciliationDecision = immutableEnum(RECONCILIATION_DECISIONS);
const TerminalState = immutableEnum(TERMINAL_STATES);
const ResolvedReason = immutableEnum(RESOLVED_REASONS);
const ManualReviewReason = immutableEnum(MANUAL_REVIEW_REASONS);
const DenialReason = immutableEnum(DENIAL_REASONS);

const INTENDED_STATE_SET = new Set(INTENDED_STATES);
const MEDIA_STATE_SET = new Set(MEDIA_STATES);
const CONTAINER_STATE_SET = new Set(CONTAINER_STATES);

// ---- record shapes -------------------------------------------------------

// Our durable record of the stuck post. `containerRef` is required (both stuck
// states carry a container). No caption/media/URL/alt-text — only handles + enum.
const INTENT_FIELDS = [
  'publishReconciliationSchemaVersion',
  'postRef',
  'accountRef',
  'containerRef',
  'intendedState',
];
// The provider read-back. `mediaRef` names the found media on `media_present` and
// is exactly null otherwise (coherence-checked).
const OBSERVATION_FIELDS = [
  'publishReconciliationSchemaVersion',
  'postRef',
  'accountRef',
  'mediaState',
  'mediaRef',
  'containerState',
];

// Post / account / container / media references are opaque, provider-/store-minted,
// url-safe handles (a provider media id is commonly all digits, so no letter is
// required — only the closed url-safe shape). The closed charset also keeps a
// reference from carrying a control character, comma, quote, or newline into any
// downstream audit line.
const HANDLE_PATTERN = /^[A-Za-z0-9._-]{1,256}$/;

function isHandleString(value) {
  return typeof value === 'string' && HANDLE_PATTERN.test(value);
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

// Validate our durable stuck-post record.
function readIntent(value) {
  const intent = readExact(value, INTENT_FIELDS);
  if (!intent) return null;
  if (intent.publishReconciliationSchemaVersion !== publishReconciliationSchemaVersion) return null;
  if (!isHandleString(intent.postRef)) return null;
  if (!isHandleString(intent.accountRef)) return null;
  if (!isHandleString(intent.containerRef)) return null;
  if (typeof intent.intendedState !== 'string' || !INTENDED_STATE_SET.has(intent.intendedState)) {
    return null;
  }
  return intent;
}

// Validate the provider read-back, including the coherence rule that a media handle
// is present exactly when media is present.
function readObservation(value) {
  const observation = readExact(value, OBSERVATION_FIELDS);
  if (!observation) return null;
  if (observation.publishReconciliationSchemaVersion !== publishReconciliationSchemaVersion) {
    return null;
  }
  if (!isHandleString(observation.postRef)) return null;
  if (!isHandleString(observation.accountRef)) return null;
  if (typeof observation.mediaState !== 'string' || !MEDIA_STATE_SET.has(observation.mediaState)) {
    return null;
  }
  if (typeof observation.containerState !== 'string'
    || !CONTAINER_STATE_SET.has(observation.containerState)) {
    return null;
  }
  // Coherence: a media handle exists exactly when, and only when, media is present.
  if (observation.mediaState === 'media_present') {
    if (!isHandleString(observation.mediaRef)) return null;
  } else if (observation.mediaRef !== null) {
    return null;
  }
  return observation;
}

// ---- verdict constructors ------------------------------------------------

// `causesPublish: false` is stamped on EVERY verdict — the machine-checkable
// encoding of the crown-jewel invariant that no reconciliation outcome can ever
// instruct a (re)publish.

const DENIALS = Object.freeze(Object.fromEntries(
  DENIAL_REASONS.map((reason) => [
    reason,
    Object.freeze({ decision: 'denied', reason, causesPublish: false }),
  ]),
));

const MANUAL_REVIEWS = Object.freeze(Object.fromEntries(
  MANUAL_REVIEW_REASONS.map((reason) => [
    reason,
    Object.freeze({ decision: 'manual_review', reason, causesPublish: false }),
  ]),
));

function deny(reason) {
  return DENIALS[reason];
}

function manualReview(reason) {
  return MANUAL_REVIEWS[reason];
}

// A `resolved` verdict records an already-true terminal state. `published` carries
// the found media handle; `failed` carries none. Neither causes a publish.
function resolvedPublished(postRef, mediaRef) {
  return Object.freeze({
    decision: 'resolved',
    reason: 'published_media_confirmed',
    next: Object.freeze({ postRef, terminalState: 'published', mediaRef }),
    causesPublish: false,
  });
}

function resolvedFailed(postRef) {
  return Object.freeze({
    decision: 'resolved',
    reason: 'no_publish_no_media',
    next: Object.freeze({ postRef, terminalState: 'failed' }),
    causesPublish: false,
  });
}

// ---- the decision --------------------------------------------------------

function classifyPublishReconciliation(intentEvidence, observationEvidence) {
  const intent = readIntent(intentEvidence);
  if (!intent) return deny('malformed_intent');
  const observation = readObservation(observationEvidence);
  if (!observation) return deny('malformed_observation');

  // Binding: the read-back must be about THIS post and account. An unbound
  // observation never resolves anything — it routes to a human to re-correlate.
  if (observation.postRef !== intent.postRef) return manualReview('post_mismatch');
  if (observation.accountRef !== intent.accountRef) return manualReview('account_mismatch');

  // Positive evidence wins first and unconditionally: account-owned media bound to
  // this post means the publish already succeeded. Record `published` and stop —
  // this is what prevents a duplicate even if our own intent record was stale.
  if (observation.mediaState === 'media_present') {
    return resolvedPublished(intent.postRef, observation.mediaRef);
  }

  // Indeterminate media: we cannot tell whether a post exists. Never resolve on an
  // inconclusive read (resolving `failed` here could let a later flow double-post;
  // resolving `published` could hide a genuinely failed post) — route to a human.
  if (observation.mediaState === 'indeterminate') {
    return manualReview('outcome_indeterminate');
  }

  // no_media: media is definitively absent. Only ONE shape is a definitive failure —
  // the container is also gone AND our record says publish was never attempted, so a
  // publish provably never happened and cannot retroactively appear.
  if (observation.containerState === 'container_absent'
    && intent.intendedState === 'container_created') {
    return resolvedFailed(intent.postRef);
  }

  // no_media + a still-live container that was never published-to: recoverable, but
  // deciding whether to publish or discard it is a human/other-flow job — this
  // reducer never auto-publishes an orphaned container.
  if (observation.containerState === 'container_live'
    && intent.intendedState === 'container_created') {
    return manualReview('container_orphan_unverified');
  }

  // Everything else under no_media is ambiguous: a publish was attempted but no media
  // is visible (failed, or published-then-deleted — indistinguishable), or the
  // container state itself is indeterminate. Route to a human; never a silent
  // `failed`, never a republish.
  return manualReview('outcome_indeterminate');
}

module.exports = Object.freeze({
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
});
