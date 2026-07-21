'use strict';

// MEMBERS-ADMIN-001B — officer membership-to-account identity-association command
// authorization (pure contract).
//
// SOURCE ONLY, UNUSED: this module is imported by nothing (not by
// functions/index.js, no route, no Firestore Rules, no callable). It has zero
// runtime behavior. It is the safety-critical decision core for the *association*
// half of parent #115 (MEMBERS-ADMIN-001), landed and exhaustively negative-tested
// first so the eventual wiring PR is a mechanical hookup of already-proven
// invariants. See SYSTEM_DESIGN.md §8.14.
//
// This is the sibling of two shipped source-only contracts and deliberately does
// neither's job. §8.0b membershipManualEvidence (MEMBERS-ADMIN-001A, #395) is the
// officer *dues* command — it records off-platform dues and explicitly "does not
// associate a UID"; this contract is that missing UID-association command.
// §8.0e membershipProviderLink (#367) reconciles an *external provider* account
// link's observed-vs-desired state as a derived identity projection that is never
// authority; it has no officer, capability, recent-auth, membership-eligibility,
// review-queue, or entitlement concern. This contract authorizes an OFFICER to bind
// an eligible membership to a verified *canonical Firebase Auth* identity, gates on
// membership eligibility, routes ambiguity to human review, and signals entitlement
// derivation.
//
// What it decides: given already-server-read state about ONE membership record and
// ONE target Firebase account (plus any collision the server detected), and an
// officer's explicit association command, whether that officer may bind the
// membership to the selected account UID right now — returning a frozen verdict to
// associate, to route to explicit human review, or to deny with a reason. It is a
// non-throwing frozen-verdict reducer (the idiom of §8.10/§8.12) and NEVER throws.
//
// Safety model:
//   * Withhold-by-default: the only path to `associate` is a sufficiently-
//     capable, recently-authenticated officer acting on a verified account and an
//     active, dues-confirmed, right-term, unlinked membership with no detected
//     collision. Every other input denies or routes to review.
//   * Email is never an authorization key: the decision is made purely on the
//     officer's EXPLICITLY selected membership id + target UID and the server-read
//     state. There is no email address in the decision path and no email matching;
//     a unique normalized-email match is an upstream suggestion only and is
//     structurally absent here.
//   * Never auto-resolves ambiguity: any detected collision (duplicate account,
//     changed email, household overlap, contact-email conflict) routes to explicit
//     review, never to an association.
//   * Never fabricates payment state: association requires membership dues already
//     confirmed for the term; this contract records no payment and confirms none.
//   * Entitlement is only SIGNALLED, never granted: a grant carries an
//     `entitlementAction` for the caller to derive the membership claim AFTER the
//     canonical link transition persists. This module sets no role and grants no
//     claim.
//   * Least privilege + recent auth first: capability and recent-auth are checked
//     before any entity is examined.
//   * Hostile-input-safe: every field of the (possibly nested) records is read
//     through an own-enumerable data descriptor with no getter ever invoked; a
//     proxy, foreign prototype, inherited/extra/missing/symbol key, or out-of-shape
//     value denies as malformed rather than being partially interpreted.
//
// Requires only node:util. Reads no clock, env, network, Firestore, or provider.

const {
  types: { isProxy },
} = require('node:util');

const membershipAdminSchemaVersion = 1;

function immutableEnum(values) {
  return Object.freeze(Object.fromEntries(values.map((v) => [v.toUpperCase(), v])));
}

// ---- closed vocabularies -------------------------------------------------

const MEMBERSHIP_STATUSES = ['active', 'lapsed', 'suspended'];
const LINK_STATES = ['unlinked', 'linked'];
const COLLISIONS = [
  'none',
  'duplicate_account',
  'email_changed',
  'household_overlap',
  'contact_email_conflict',
];
const ADMIN_CAPABILITIES = ['membership_associator', 'dues_recorder', 'role_admin'];
// This reducer HANDLES only `associate_identity`. `record_dues` is the sibling
// manual-payment command of parent #115 — recognized as a well-formed command
// type here but not handled by this slice (it denies `unsupported_command`), so a
// real future command is distinguished from a malformed one. Manual payment
// recording and identity association are deliberately separate commands.
const COMMAND_TYPES = ['associate_identity', 'record_dues'];
const ASSOCIATION_DECISIONS = ['associate', 'review', 'denied'];
const ASSOCIATION_GRANT_REASONS = ['associated', 'already_associated'];
// The review reasons are exactly the collisions other than 'none'.
const ASSOCIATION_REVIEW_REASONS = COLLISIONS.slice(1);
const ASSOCIATION_DENIAL_REASONS = [
  'malformed_state',
  'malformed_command',
  'unsupported_command',
  'capability_denied',
  'recent_auth_required',
  'command_stale',
  'account_missing',
  'email_unverified',
  'membership_not_found',
  'membership_not_active',
  'dues_unconfirmed',
  'wrong_term',
  'membership_linked_elsewhere',
  'uid_linked_elsewhere',
  'state_conflict',
];
const ENTITLEMENT_ACTIONS = ['derive_membership_claim'];

const MembershipStatus = immutableEnum(MEMBERSHIP_STATUSES);
const LinkState = immutableEnum(LINK_STATES);
const Collision = immutableEnum(COLLISIONS);
const AdminCapability = immutableEnum(ADMIN_CAPABILITIES);
const CommandType = immutableEnum(COMMAND_TYPES);
const AssociationDecision = immutableEnum(ASSOCIATION_DECISIONS);
const AssociationGrantReason = immutableEnum(ASSOCIATION_GRANT_REASONS);
const AssociationReviewReason = immutableEnum(ASSOCIATION_REVIEW_REASONS);
const AssociationDenialReason = immutableEnum(ASSOCIATION_DENIAL_REASONS);
const EntitlementAction = immutableEnum(ENTITLEMENT_ACTIONS);

const MEMBERSHIP_STATUS_SET = new Set(MEMBERSHIP_STATUSES);
const LINK_STATE_SET = new Set(LINK_STATES);
const COLLISION_SET = new Set(COLLISIONS);
const ADMIN_CAPABILITY_SET = new Set(ADMIN_CAPABILITIES);
const COMMAND_TYPE_SET = new Set(COMMAND_TYPES);

// ---- record shapes -------------------------------------------------------

const STATE_FIELDS = ['membershipAdminSchemaVersion', 'membership', 'account', 'collision'];
const MEMBERSHIP_FIELDS = ['membershipId', 'status', 'term', 'duesConfirmed', 'linkState', 'linkedUid'];
const ACCOUNT_FIELDS = ['uid', 'emailVerified', 'linkedMembershipId'];
const COMMAND_FIELDS = [
  'membershipAdminSchemaVersion',
  'type',
  'commandId',
  'actor',
  'capability',
  'recentAuthSatisfied',
  'membershipId',
  'targetUid',
  'expectedTerm',
  'expectedMembershipLinkState',
  'asOf',
  'deadline',
];

// Identity strings (membership ids, account UIDs, officer actor) are opaque,
// url-safe, and MUST bear a letter — so a bare all-digit contact value (a numeric
// export id, a digits-only handle) can never masquerade as an identity key.
const IDENTITY_PATTERN = /^[A-Za-z0-9._-]{1,256}$/;
const IDENTITY_HAS_LETTER = /[A-Za-z]/;
// A command id is a store-minted opaque handle; it need not bear a letter.
const HANDLE_PATTERN = /^[A-Za-z0-9._-]{1,256}$/;
// A term is a short label that may be all digits (e.g. '2026').
const TERM_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
// A fixed-width UTC instant. Fixed-width UTC strings compare lexically as they do
// chronologically, so staleness is decided by string comparison with no clock.
const UTC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

function isIdentityString(value) {
  return typeof value === 'string'
    && IDENTITY_PATTERN.test(value)
    && IDENTITY_HAS_LETTER.test(value);
}

function isHandleString(value) {
  return typeof value === 'string' && HANDLE_PATTERN.test(value);
}

function isTermLabel(value) {
  return typeof value === 'string' && TERM_PATTERN.test(value);
}

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
  // property must also deny — it is invisible to Object.keys but would still make
  // the record something other than the exact closed shape. With symbols already
  // rejected, this bounds the total own-key surface to exactly `expectedFields`.
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

// Validate one membership record. linkState and linkedUid must be coherent: a
// linked membership names the UID it is bound to; an unlinked one names none.
function readMembership(value) {
  const membership = readExact(value, MEMBERSHIP_FIELDS);
  if (!membership) return null;
  if (!isIdentityString(membership.membershipId)) return null;
  if (typeof membership.status !== 'string' || !MEMBERSHIP_STATUS_SET.has(membership.status)) return null;
  if (!isTermLabel(membership.term)) return null;
  if (typeof membership.duesConfirmed !== 'boolean') return null;
  if (typeof membership.linkState !== 'string' || !LINK_STATE_SET.has(membership.linkState)) return null;
  if (membership.linkState === 'linked') {
    if (!isIdentityString(membership.linkedUid)) return null;
  } else if (membership.linkedUid !== null) {
    return null;
  }
  return membership;
}

// Validate one target-account record.
function readAccount(value) {
  const account = readExact(value, ACCOUNT_FIELDS);
  if (!account) return null;
  if (!isIdentityString(account.uid)) return null;
  if (typeof account.emailVerified !== 'boolean') return null;
  if (account.linkedMembershipId !== null && !isIdentityString(account.linkedMembershipId)) return null;
  return account;
}

// Validate the server-read state envelope: version, the (nullable) membership and
// account sub-records, and the detected collision label.
function readState(value) {
  const state = readExact(value, STATE_FIELDS);
  if (!state) return null;
  if (state.membershipAdminSchemaVersion !== membershipAdminSchemaVersion) return null;

  let membership = null;
  if (state.membership !== null) {
    membership = readMembership(state.membership);
    if (!membership) return null;
  }

  let account = null;
  if (state.account !== null) {
    account = readAccount(state.account);
    if (!account) return null;
  }

  if (typeof state.collision !== 'string' || !COLLISION_SET.has(state.collision)) return null;

  return { membership, account, collision: state.collision };
}

// Validate the officer's command envelope. Per-field shapes only; the gate below
// interprets the combination.
function readCommand(value) {
  const command = readExact(value, COMMAND_FIELDS);
  if (!command) return null;
  if (command.membershipAdminSchemaVersion !== membershipAdminSchemaVersion) return null;
  if (typeof command.type !== 'string' || !COMMAND_TYPE_SET.has(command.type)) return null;
  if (!isHandleString(command.commandId)) return null;
  if (!isIdentityString(command.actor)) return null;
  if (typeof command.capability !== 'string' || !ADMIN_CAPABILITY_SET.has(command.capability)) return null;
  if (typeof command.recentAuthSatisfied !== 'boolean') return null;
  if (!isIdentityString(command.membershipId)) return null;
  if (!isIdentityString(command.targetUid)) return null;
  if (!isTermLabel(command.expectedTerm)) return null;
  if (typeof command.expectedMembershipLinkState !== 'string'
    || !LINK_STATE_SET.has(command.expectedMembershipLinkState)) {
    return null;
  }
  if (!isUtcTimestamp(command.asOf)) return null;
  if (!isUtcTimestamp(command.deadline)) return null;
  return command;
}

// ---- verdict constructors ------------------------------------------------

const DENIALS = Object.freeze(Object.fromEntries(
  ASSOCIATION_DENIAL_REASONS.map((reason) => [reason, Object.freeze({ decision: 'denied', reason })]),
));

const REVIEWS = Object.freeze(Object.fromEntries(
  ASSOCIATION_REVIEW_REASONS.map((reason) => [reason, Object.freeze({ decision: 'review', reason })]),
));

function deny(reason) {
  return DENIALS[reason];
}

function review(reason) {
  return REVIEWS[reason];
}

function grantAssociation(reason, membership, command) {
  return Object.freeze({
    decision: 'associate',
    reason,
    next: Object.freeze({
      membershipId: membership.membershipId,
      linkedUid: command.targetUid,
      linkState: 'linked',
      term: membership.term,
      entitlementAction: 'derive_membership_claim',
    }),
  });
}

// ---- the decision --------------------------------------------------------

function classifyMembershipAssociation(stateEvidence, commandEvidence) {
  const command = readCommand(commandEvidence);
  if (!command) return deny('malformed_command');
  const state = readState(stateEvidence);
  if (!state) return deny('malformed_state');

  // Command type and authorization first — least privilege, before any entity is
  // examined. A generic admin role is not sufficient; only the association
  // capability may act, and only with a recent authentication and a fresh command.
  if (command.type !== 'associate_identity') return deny('unsupported_command');
  if (command.capability !== 'membership_associator') return deny('capability_denied');
  if (command.recentAuthSatisfied !== true) return deny('recent_auth_required');
  // Staleness by lexical UTC comparison — exclusive: a command at exactly its
  // deadline is stale.
  if (!(command.asOf < command.deadline)) return deny('command_stale');

  const { membership, account } = state;

  // The server-read state must describe the officer's EXPLICITLY selected entities.
  // A mismatch means the wrong record was read — deny rather than act on it.
  if (membership !== null && membership.membershipId !== command.membershipId) return deny('malformed_state');
  if (account !== null && account.uid !== command.targetUid) return deny('malformed_state');

  // Account gate — a verified target account must exist.
  if (account === null) return deny('account_missing');
  if (account.emailVerified !== true) return deny('email_unverified');

  // Membership gate — an active, dues-confirmed membership for the confirmed term.
  if (membership === null) return deny('membership_not_found');
  if (membership.status !== 'active') return deny('membership_not_active');
  if (membership.duesConfirmed !== true) return deny('dues_unconfirmed');
  if (membership.term !== command.expectedTerm) return deny('wrong_term');

  // Link-state, idempotency, and cross-linking.
  if (membership.linkState === 'linked') {
    // Re-applying the same association is idempotent; a different holder is a stop.
    if (membership.linkedUid === command.targetUid) {
      return grantAssociation('already_associated', membership, command);
    }
    return deny('membership_linked_elsewhere');
  }

  // The membership is unlinked. Enforce the officer's optimistic view of that.
  if (command.expectedMembershipLinkState !== 'unlinked') return deny('state_conflict');
  // The target UID must not already be bound to a membership.
  if (account.linkedMembershipId !== null) return deny('uid_linked_elsewhere');

  // Any detected ambiguity must be resolved by a human, never auto-associated.
  if (state.collision !== 'none') return review(state.collision);

  return grantAssociation('associated', membership, command);
}

module.exports = Object.freeze({
  membershipAdminSchemaVersion,
  MembershipStatus,
  LinkState,
  Collision,
  AdminCapability,
  CommandType,
  AssociationDecision,
  AssociationGrantReason,
  AssociationReviewReason,
  AssociationDenialReason,
  EntitlementAction,
  classifyMembershipAssociation,
});
