'use strict';

// INSTAGRAM-005C — pure publisher-alert disposition decision (pure contract).
//
// SOURCE ONLY, UNUSED: this module is imported by nothing (not by
// functions/index.js, no route, no Firestore Rules, no callable, no scheduled
// worker). It has zero runtime behavior. It is the safety-critical decision core
// for the *alerts* line of parent #95 (INSTAGRAM-005) — "Alert on expiry/refresh
// failure, schedule lag, stuck container, unknown outcome, quota pressure, provider
// restriction, and kill-switch activation" — landed and exhaustively negative-tested
// first so the eventual wiring is a mechanical hookup of already-proven invariants.
// See SYSTEM_DESIGN.md §8.21.
//
// What it decides: given the currently-open alert (if any) for one exact
// (condition, subject) and a fresh monitored reading of that same condition
// (`faulting` or `healthy`), it returns exactly one frozen verdict — `raise` a new
// alert, `suppress` a duplicate/no-op, `resolve` an open alert on an explicit clear,
// or `denied` (malformed/incoherent input). It is a non-throwing frozen-verdict
// reducer (the idiom of §8.15/§8.16/§8.17/§8.18/§8.20) and NEVER throws.
//
// The marquee safety property — it can NEVER silently swallow a genuine new alert,
// AND it never spams duplicates. Missing a real fault is the P0 failure of any
// monitor, so this contract is fail-LOUD by construction: the ONLY verdict that does
// not notify is `suppress`, and `suppress` is emitted in exactly two provably-safe
// cases — a `faulting` reading whose alert is ALREADY OPEN for the identical
// (condition, subject) (debounce a duplicate page), or a `healthy` reading with
// nothing open (a genuine no-op). Every other outcome — a `faulting` reading with
// nothing open (a NEW fault), an explicit clear (`resolve`), and any malformed or
// incoherent input (`denied`) — carries `notify: true`. So a new fault for ANY of
// the seven monitored conditions ALWAYS pages, and only an exact duplicate of an
// already-open alert is ever debounced. No input, however hostile, can turn a new
// fault into silence: to reach `suppress duplicate_open` an adversary would have to
// forge our OWN durable open-alert record for the identical condition+subject (which
// means a human is already paged for exactly that), and forging `healthy` can at
// most prematurely resolve an open alert that a human already saw — the next
// `faulting` reading re-raises it (nothing open again), so a persisting fault can
// flap but can never be permanently hidden.
//
// Severity is REDUCER-OWNED, never caller-supplied: the observation carries only
// (condition, subject, health); the severity a verdict reports is looked up from
// this module's own frozen condition→severity table, so a malformed observation can
// never forge a fault down to a quieter level. Severity is a pure classification of
// the already-detected condition (detecting whether a condition is faulting is the
// monitor's job; classifying and de-duplicating it is this reducer's) — so there is
// deliberately no intra-condition "escalate": a given condition has one severity, a
// repeat is always a pure duplicate. Cross-condition escalation/routing belongs to a
// higher layer, not this per-condition dedup core.
//
// Resolve requires an EXPLICIT healthy reading of a currently-open alert. It never
// auto-resolves on absence of signal, and a healthy reading with nothing open is a
// no-op (`already_clear`) — never a fabricated `resolve`.
//
// Holds no post content. It carries only opaque handles (a `subjectRef` drawn from a
// closed url-safe shape) and closed enums — never a caption, media bytes, URL, alt
// text, token, member/contact datum, or any post payload. A source-boundary test
// enforces that absence.
//
// Requires only node:util. Reads no clock, env, network, Firestore, or provider.

const {
  types: { isProxy },
} = require('node:util');

const publisherAlertSchemaVersion = 1;

function immutableEnum(values) {
  return Object.freeze(Object.fromEntries(values.map((v) => [v.toUpperCase(), v])));
}

// ---- closed vocabularies -------------------------------------------------

// The seven monitored conditions of parent #95's alerts line. Each is a distinct
// publisher-health fault the operator must learn about; none carries post content.
const ALERT_CONDITIONS = [
  'refresh_failure', // credential expiry / refresh failure — publishing is down
  'provider_restriction', // account restricted by the provider — publishing blocked
  'kill_switch_activated', // the emergency stop was engaged — confirm it was intended
  'schedule_lag', // the publish schedule has fallen behind
  'stuck_container', // a media container was created but never resolved
  'unknown_outcome', // a publish outcome could not be determined
  'quota_pressure', // approaching a provider rate/volume limit
];
// A fresh monitored reading of one condition: it is currently a fault, or it
// currently reads clear. `healthy` is the only signal that resolves an open alert.
const HEALTH_STATES = ['faulting', 'healthy'];
// Severity is a closed classification the reducer OWNS (never a caller input).
const ALERT_SEVERITIES = ['critical', 'warning', 'info'];

const ALERT_DECISIONS = ['raise', 'suppress', 'resolve', 'denied'];
// `duplicate_open` = a fault already open for this exact (condition, subject) — a
// debounced re-page. `already_clear` = a healthy reading with nothing open — a no-op.
// Both are the only non-notifying outcomes and neither can hide a NEW fault.
const SUPPRESS_REASONS = ['duplicate_open', 'already_clear'];
// `subject_mismatch` = the supplied open alert is for a different (condition,
// subject) than the observation — incoherent caller wiring, surfaced loudly.
const DENIAL_REASONS = ['malformed_open_state', 'malformed_observation', 'subject_mismatch'];

const AlertCondition = immutableEnum(ALERT_CONDITIONS);
const HealthState = immutableEnum(HEALTH_STATES);
const AlertSeverity = immutableEnum(ALERT_SEVERITIES);
const AlertDecision = immutableEnum(ALERT_DECISIONS);
const SuppressReason = immutableEnum(SUPPRESS_REASONS);
const DenialReason = immutableEnum(DENIAL_REASONS);

const CONDITION_SET = new Set(ALERT_CONDITIONS);
const HEALTH_STATE_SET = new Set(HEALTH_STATES);

// Reducer-owned severity table: every condition maps to exactly one severity, and
// all three severity levels are used. `critical` = the publishing pipeline is down
// or a safety control fired; `warning` = degraded and needs attention; `info` = an
// advisory heads-up. Built from the closed enum so it is total over ALERT_CONDITIONS.
const SEVERITY_BY_CONDITION = Object.freeze(Object.assign(Object.create(null), {
  refresh_failure: 'critical',
  provider_restriction: 'critical',
  kill_switch_activated: 'critical',
  schedule_lag: 'warning',
  stuck_container: 'warning',
  unknown_outcome: 'warning',
  quota_pressure: 'info',
}));

// ---- record shapes -------------------------------------------------------

// The currently-open alert for ONE exact (condition, subject). Identity only — it
// carries NO severity, because severity is always derived fresh from the condition
// and can never be read back from a (possibly stale/forged) stored field. "Nothing
// open" is represented by a literal `null`, not by any object shape.
const OPEN_ALERT_FIELDS = [
  'publisherAlertSchemaVersion',
  'condition',
  'subjectRef',
];
// A fresh monitored reading. `subjectRef` names what the condition is about (an
// account/post/container handle); `health` is the current reading.
const OBSERVATION_FIELDS = [
  'publisherAlertSchemaVersion',
  'condition',
  'subjectRef',
  'health',
];

// A subject reference is an opaque, provider-/store-minted, url-safe handle (a
// provider media/account id is commonly all digits, so no letter is required — only
// the closed url-safe shape). The closed charset also keeps a reference from carrying
// a control character, comma, quote, or newline into any downstream audit line.
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

// Two distinct private sentinels — never exported, never returned in a verdict — so
// the decision can tell "nothing open" (a literal null) apart from "a malformed
// open-state object" apart from "a validated open alert" by identity.
const OPEN_NONE = Object.freeze(Object.create(null));
const OPEN_INVALID = Object.freeze(Object.create(null));

// Read the open-alert side. A literal null means "nothing open" (OPEN_NONE); a
// valid open-alert object is returned as a null-prototype copy; anything else is
// OPEN_INVALID (surfaced as a loud denial, never silently treated as nothing open).
function readOpenState(value) {
  if (value === null) return OPEN_NONE;
  const open = readExact(value, OPEN_ALERT_FIELDS);
  if (!open) return OPEN_INVALID;
  if (open.publisherAlertSchemaVersion !== publisherAlertSchemaVersion) return OPEN_INVALID;
  if (typeof open.condition !== 'string' || !CONDITION_SET.has(open.condition)) return OPEN_INVALID;
  if (!isHandleString(open.subjectRef)) return OPEN_INVALID;
  return open;
}

// Read the fresh monitored reading.
function readObservation(value) {
  const observation = readExact(value, OBSERVATION_FIELDS);
  if (!observation) return null;
  if (observation.publisherAlertSchemaVersion !== publisherAlertSchemaVersion) return null;
  if (typeof observation.condition !== 'string' || !CONDITION_SET.has(observation.condition)) {
    return null;
  }
  if (!isHandleString(observation.subjectRef)) return null;
  if (typeof observation.health !== 'string' || !HEALTH_STATE_SET.has(observation.health)) {
    return null;
  }
  return observation;
}

// ---- verdict constructors ------------------------------------------------

// `notify` is stamped on EVERY verdict — the machine-checkable encoding of the
// crown-jewel invariant. It is `true` on raise/resolve/denied and `false` ONLY on
// suppress, so a genuine new fault (or any malformed input) can never be silent.

const DENIALS = Object.freeze(Object.fromEntries(
  DENIAL_REASONS.map((reason) => [
    reason,
    Object.freeze({ decision: 'denied', reason, notify: true }),
  ]),
));

function deny(reason) {
  return DENIALS[reason];
}

// A new fault that is not already open — page it, at the condition's owned severity.
function raise(condition, subjectRef, severity) {
  return Object.freeze({
    decision: 'raise',
    condition,
    subjectRef,
    severity,
    notify: true,
  });
}

// An explicit clear of a currently-open alert — close it and notify the state change.
function resolve(condition, subjectRef, severity) {
  return Object.freeze({
    decision: 'resolve',
    condition,
    subjectRef,
    severity,
    notify: true,
  });
}

// The only non-notifying verdict: an exact duplicate of an already-open alert
// (`duplicate_open`) or a healthy reading with nothing open (`already_clear`).
function suppress(reason, condition, subjectRef, severity) {
  return Object.freeze({
    decision: 'suppress',
    reason,
    condition,
    subjectRef,
    severity,
    notify: false,
  });
}

// ---- the decision --------------------------------------------------------

function classifyPublisherAlert(openStateEvidence, observationEvidence) {
  const open = readOpenState(openStateEvidence);
  if (open === OPEN_INVALID) return deny('malformed_open_state');
  const observation = readObservation(observationEvidence);
  if (!observation) return deny('malformed_observation');

  const { condition, subjectRef, health } = observation;

  // Coherence: a supplied open alert MUST be about the same (condition, subject) this
  // observation concerns — the caller looks it up by exactly that key. A mismatched
  // pairing is incoherent wiring; surface it loudly rather than silently dropping the
  // real open alert or misattributing the reading.
  if (open !== OPEN_NONE
    && (open.condition !== condition || open.subjectRef !== subjectRef)) {
    return deny('subject_mismatch');
  }

  // Severity is looked up from the reducer's own table (condition is already an
  // enum member, so this is always defined) — never taken from the observation.
  const severity = SEVERITY_BY_CONDITION[condition];

  if (health === 'faulting') {
    // Fail-loud: a fault that is NOT already open must ALWAYS raise. Only an exact
    // duplicate of an already-open same-(condition, subject) alert is debounced.
    return open === OPEN_NONE
      ? raise(condition, subjectRef, severity)
      : suppress('duplicate_open', condition, subjectRef, severity);
  }

  // health === 'healthy': resolve ONLY an explicitly-cleared open alert. A healthy
  // reading with nothing open is a genuine no-op — never a fabricated resolve.
  return open === OPEN_NONE
    ? suppress('already_clear', condition, subjectRef, severity)
    : resolve(condition, subjectRef, severity);
}

module.exports = Object.freeze({
  publisherAlertSchemaVersion,
  AlertCondition,
  HealthState,
  AlertSeverity,
  AlertDecision,
  SuppressReason,
  DenialReason,
  classifyPublisherAlert,
});
