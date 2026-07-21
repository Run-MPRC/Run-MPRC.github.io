const { types: { isProxy } } = require('node:util');

// MEMBERS-ROSTER-001A conservative safe-by-default membership-roster CSV
// projection.
//
// Pure, source-only, unused. Given one exact revision-1 export request that
// names an owner-approved column profile and carries the candidate roster
// rows, produce a frozen, validated, minimized, spreadsheet-compatible CSV
// artifact -- or throw. It decides the SHAPE and SAFETY of a roster export,
// never who may run one, which rows the term/status query returns, or where
// the file is delivered.
//
// Safety model (allowlist, never denylist):
//   * The export request key set is closed and exact. Each row is projected to
//     ONLY the columns named by the selected profile; every other key on a row
//     -- which is exactly how a protected value (an account identifier, a
//     government or membership identifier, a home mailing location, a birth
//     date, an emergency contact, a waiver record, a payment credential, a
//     provider identifier, a session credential, an access key, an arbitrary
//     note, an invite link, or a discount code) would arrive -- is dropped, not
//     serialized. No protected value can ride into the output even if a source
//     record later gains that field, and no protected-field name appears in
//     this source.
//   * The projection is false-negative-safe: a malformed or hostile request or
//     row throws and produces no file, rather than emitting a partial or
//     mislabeled roster.
//   * Every cell is spreadsheet-injection-safe: a value that begins with a
//     formula or command trigger is neutralized with a leading apostrophe
//     (CWE-1236), every field is RFC 4180 quoted so a comma, quote, or newline
//     cannot break the row structure, control characters other than tab and
//     newline are rejected, and cell length, row count, and total size are
//     bounded.
//   * The selected column profile is chosen from a closed registry of
//     owner-approved profiles; an unknown or custom profile throws.
//
// The seed profiles below are a conservative minimum. The owner-approved
// field/column profile (issue #110) replaces or extends this registry; this
// contract owns the MECHANISM (allowlist projection + injection-safe
// serialization + bounds), never the policy of which fields are approved.
//
// No runtime path imports this module. It reads no clock, randomness, network,
// environment, or provider; it logs nothing and persists nothing.

const membershipRosterSchemaVersion = 1;
const PROJECTION_ERROR_MESSAGE = 'Membership roster projection evidence is invalid.';

// The closed export-request allowlist. Exactly these keys, no more, no less.
const EXPECTED_FIELDS = Object.freeze([
  'membershipRosterSchemaVersion',
  'columnProfile',
  'asOf',
  'rows',
]);

function immutableEnum(values) {
  return Object.freeze(Object.fromEntries(values.map((value) => [
    value.toUpperCase(),
    value,
  ])));
}

// Owner-approved column profiles. Each is a frozen, ordered allowlist of the
// only columns that profile may emit. Deliberately the least-sensitive roster
// columns; membershipStatus/planName/term dates carry no account identifier,
// contact detail, birth date, payment, or credential.
const MEMBERSHIP_ROSTER_COLUMN_PROFILES = Object.freeze({
  officer_minimal: Object.freeze([
    'memberRef',
    'displayName',
    'membershipStatus',
  ]),
  officer_standard: Object.freeze([
    'memberRef',
    'displayName',
    'membershipStatus',
    'planName',
    'termStartsOn',
    'termEndsOn',
  ]),
});

const MembershipRosterColumnProfile = immutableEnum(
  Object.keys(MEMBERSHIP_ROSTER_COLUMN_PROFILES),
);

const COLUMN_PROFILE_SET = new Set(Object.keys(MEMBERSHIP_ROSTER_COLUMN_PROFILES));

// Conservative bounds. Generous enough for a real club roster, tight enough
// that a runaway or binary payload is rejected rather than serialized.
const LIMITS = Object.freeze({
  maxRows: 20000,
  maxRowKeys: 256,
  maxCellLength: 4096,
  maxTotalLength: 8000000,
});

// A UTC instant with second precision and a mandatory Z. Fixed width means
// lexical order equals chronological order; no clock or Date dependency.
const UTC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

// Leading characters a spreadsheet may interpret as a formula or command.
// A cell starting with one of these is neutralized with a leading apostrophe.
const FORMULA_LEAD = new Set(['=', '+', '-', '@', '\t', '\r']);

class MembershipRosterProjectionError extends Error {
  constructor() {
    super(PROJECTION_ERROR_MESSAGE);
    Object.defineProperty(this, 'name', {
      value: 'MembershipRosterProjectionError',
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
      value: 'invalid_membership_roster_evidence',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Error.captureStackTrace?.(this, MembershipRosterProjectionError);
    Object.freeze(this);
  }
}

function fail() {
  throw new MembershipRosterProjectionError();
}

// Shape plus component-range validation without constructing a Date.
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

// Reject any character that could corrupt a cell or smuggle a control trick:
// NUL and the other C0 controls except tab/LF/CR (which are legal inside a
// quoted field), DEL, the C1 range, and the Unicode line/paragraph separators.
// Ordinary international letters, digits, punctuation, and emoji are allowed.
function hasUnsafeCellCharacter(text) {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0x09 || code === 0x0a || code === 0x0d) continue;
    if (code <= 0x1f) return true;
    if (code >= 0x7f && code <= 0x9f) return true;
    if (code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

// A clean own-data reader that never invokes a getter: rejects proxies, a
// non-Object.prototype prototype, more than the bound, non-string keys,
// accessor or non-enumerable or non-data properties, and inherited keys.
// Returns a Map of own string data properties or null.
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
  return evidence;
}

// Read the rows array without invoking any element getter. Rejects a proxy, a
// non-array, a length over the bound, a hole, an accessor or non-data index, or
// any own key that is not a plain index or `length`. Returns an array of the
// raw element values.
function readRowValues(rows) {
  if (!Array.isArray(rows) || isProxy(rows)) fail();
  const length = rows.length;
  if (!Number.isSafeInteger(length) || length > LIMITS.maxRows) fail();

  let ownKeys;
  try {
    ownKeys = Reflect.ownKeys(rows);
  } catch {
    fail();
  }
  for (const key of ownKeys) {
    if (key === 'length') continue;
    if (typeof key !== 'string') fail();
    if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length) fail();
  }

  const values = [];
  for (let index = 0; index < length; index += 1) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(rows, String(index));
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
    values.push(descriptor.value);
  }
  return values;
}

// Encode one cell value: absent/null becomes an empty cell; a present value
// must be a bounded, control-safe string; a formula/command lead is neutralized
// with a leading apostrophe; the result is always RFC 4180 quoted.
function encodeCell(value) {
  let text;
  if (value === null || value === undefined) {
    text = '';
  } else if (typeof value === 'string') {
    text = value;
  } else {
    fail();
  }

  if (text.length > LIMITS.maxCellLength || hasUnsafeCellCharacter(text)) fail();

  if (text.length > 0 && FORMULA_LEAD.has(text[0])) {
    text = `'${text}`;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function encodeRecord(fields) {
  return fields.join(',');
}

function projectMembershipRosterCsv(input) {
  const evidence = readExactEvidence(input);

  if (evidence.membershipRosterSchemaVersion !== membershipRosterSchemaVersion) fail();
  if (typeof evidence.columnProfile !== 'string'
    || !COLUMN_PROFILE_SET.has(evidence.columnProfile)) fail();
  if (!isUtcTimestamp(evidence.asOf)) fail();

  const columns = MEMBERSHIP_ROSTER_COLUMN_PROFILES[evidence.columnProfile];
  const rowValues = readRowValues(evidence.rows);

  const headerLine = encodeRecord(columns.map((column) => encodeCell(column)));
  const lines = [headerLine];

  for (const rowValue of rowValues) {
    const cells = safeOwnData(rowValue, LIMITS.maxRowKeys);
    if (!cells) fail();
    // Project to ONLY the profile columns, in order. Every other key on the row
    // is dropped here -- this is the allowlist that keeps a protected field out
    // of the output even if the source record carries it.
    const fields = columns.map((column) => encodeCell(
      cells.has(column) ? cells.get(column) : null,
    ));
    lines.push(encodeRecord(fields));
  }

  const csv = lines.join('\r\n');
  if (csv.length > LIMITS.maxTotalLength) fail();

  return Object.freeze({
    membershipRosterSchemaVersion,
    columnProfile: evidence.columnProfile,
    columns: Object.freeze([...columns]),
    asOf: evidence.asOf,
    rowCount: rowValues.length,
    csv,
    characterLength: csv.length,
  });
}

Object.freeze(MembershipRosterProjectionError.prototype);
Object.freeze(MembershipRosterProjectionError);

module.exports = Object.freeze({
  membershipRosterSchemaVersion,
  MembershipRosterColumnProfile,
  MEMBERSHIP_ROSTER_COLUMN_PROFILES,
  MembershipRosterProjectionError,
  projectMembershipRosterCsv,
});
