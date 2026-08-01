'use strict';

const { createHash } = require('node:crypto');
const { types: { isProxy } } = require('node:util');
const { Timestamp } = require('firebase-admin/firestore');

const memberDirectoryProjectionSchemaVersion = 1;
const memberDirectoryNormalizationVersion = 1;
const MEMBER_DIRECTORY_ENTRY_COLLECTION = 'memberDirectoryEntries';
const MAX_DISPLAY_NAME_CODE_UNITS = 200;
const MAX_QUERY_RAW_CODE_UNITS = 512;
const MIN_QUERY_CODE_UNITS = 2;
const MAX_QUERY_CODE_UNITS = 80;
// With a canonical name capped at 200 UTF-16 code units, the full-name prefix
// contributes at most 79 unique digests. The first token overlaps those
// prefixes. Later tokens contribute at most 193 more digests (three tokens
// using the remaining 196 code units, including separators), for a total of
// 272. Keeping the bound explicit makes every accepted name projectable.
const MAX_PREFIX_DIGESTS = 272;

const ENTRY_REFERENCE_PATTERN = /^entry_[0-9a-f]{64}$/;
const LOWERCASE_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UID_PATTERN = /^[^/]{1,128}$/;
const CONTROL_OR_FORMAT_PATTERN = /[\p{Cc}\p{Cf}]/u;
const TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu;

const MIN_TIMESTAMP_SECONDS = -62_135_596_800;
const MAX_TIMESTAMP_SECONDS = 253_402_300_799;
const MAX_TIMESTAMP_NANOSECONDS = 999_999_999;
const timestampPrototype = Timestamp.prototype;
const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
const stringNormalize = String.prototype.normalize;
const stringToLowerCase = String.prototype.toLowerCase;
const stringTrim = String.prototype.trim;
const stringMatch = String.prototype.match;

const PROJECTION_FIELDS = Object.freeze([
  'schemaVersion',
  'normalizationVersion',
  'entryRef',
  'displayName',
  'prefixDigests',
  'photoVersion',
  'preferenceRevision',
  'createdAt',
  'updatedAt',
]);

class MemberDirectoryProjectionError extends Error {
  constructor(kind = 'invalid') {
    super('Member directory projection input is invalid.');
    Object.defineProperty(this, 'name', {
      value: 'MemberDirectoryProjectionError',
      enumerable: false,
    });
    Object.defineProperty(this, 'kind', {
      value: kind,
      enumerable: false,
    });
    Error.captureStackTrace?.(this, MemberDirectoryProjectionError);
  }
}

function fail(kind) {
  throw new MemberDirectoryProjectionError(kind);
}

function safeIsProxy(value) {
  try {
    return isProxy(value);
  } catch (_error) {
    return true;
  }
}

function readExactDataObject(value, expectedFields, kind = 'invalid') {
  if (value === null || typeof value !== 'object' || safeIsProxy(value)) fail(kind);
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (_error) {
    fail(kind);
  }
  if (prototype !== objectPrototype || keys.length !== expectedFields.length) fail(kind);

  const expected = new Set(expectedFields);
  const data = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string'
      || !expected.has(key)
      || Object.prototype.hasOwnProperty.call(data, key)) fail(kind);
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (_error) {
      fail(kind);
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail(kind);
    data[key] = descriptor.value;
  }
  if (expectedFields.some((field) => !Object.prototype.hasOwnProperty.call(data, field))) {
    fail(kind);
  }
  return data;
}

function selectedOwnDataValue(value, field) {
  if (value === null || typeof value !== 'object' || safeIsProxy(value)) return undefined;
  let prototype;
  let descriptor;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptor = Object.getOwnPropertyDescriptor(value, field);
  } catch (_error) {
    return undefined;
  }
  if (prototype !== objectPrototype
    || !descriptor
    || descriptor.enumerable !== true
    || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return undefined;
  return descriptor.value;
}

function timestampParts(value) {
  if (value === null || typeof value !== 'object' || safeIsProxy(value)) return null;
  let prototype;
  let keys;
  let secondsDescriptor;
  let nanosecondsDescriptor;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    secondsDescriptor = Object.getOwnPropertyDescriptor(value, '_seconds');
    nanosecondsDescriptor = Object.getOwnPropertyDescriptor(value, '_nanoseconds');
  } catch (_error) {
    return null;
  }
  if (prototype !== timestampPrototype
    || keys.length !== 2
    || !keys.includes('_seconds')
    || !keys.includes('_nanoseconds')) return null;
  for (const descriptor of [secondsDescriptor, nanosecondsDescriptor]) {
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
  }
  const seconds = secondsDescriptor.value;
  const nanoseconds = nanosecondsDescriptor.value;
  if (!Number.isSafeInteger(seconds)
    || seconds < MIN_TIMESTAMP_SECONDS
    || seconds > MAX_TIMESTAMP_SECONDS
    || !Number.isSafeInteger(nanoseconds)
    || nanoseconds < 0
    || nanoseconds > MAX_TIMESTAMP_NANOSECONDS) return null;
  return Object.freeze({ seconds, nanoseconds });
}

function isTimestamp(value) {
  return timestampParts(value) !== null;
}

function timestampsEqual(left, right) {
  const a = timestampParts(left);
  const b = timestampParts(right);
  return a !== null && b !== null
    && a.seconds === b.seconds
    && a.nanoseconds === b.nanoseconds;
}

function sha256(parts) {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest('hex');
}

function hasForbiddenUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return CONTROL_OR_FORMAT_PATTERN.test(value);
}

function canonicalTokens(value) {
  let normalized;
  let lowered;
  let tokens;
  try {
    normalized = stringNormalize.call(value, 'NFKC');
    lowered = stringToLowerCase.call(normalized);
    tokens = stringMatch.call(lowered, TOKEN_PATTERN) || [];
  } catch (_error) {
    return null;
  }
  if (tokens.length === 0) return null;
  return Object.freeze({
    canonical: tokens.join(' '),
    tokens: Object.freeze([...tokens]),
  });
}

function readDirectoryDisplayName(memberValue) {
  const fullName = selectedOwnDataValue(memberValue, 'fullName');
  if (typeof fullName !== 'string'
    || fullName.length === 0
    || fullName.length > MAX_DISPLAY_NAME_CODE_UNITS
    || hasForbiddenUnicode(fullName)) return null;
  let displayName;
  try {
    displayName = stringTrim.call(fullName);
  } catch (_error) {
    return null;
  }
  if (displayName.length === 0
    || displayName.length > MAX_DISPLAY_NAME_CODE_UNITS) return null;
  const normalized = canonicalTokens(displayName);
  if (!normalized
    || normalized.canonical.length < MIN_QUERY_CODE_UNITS
    || normalized.canonical.length > MAX_DISPLAY_NAME_CODE_UNITS) return null;
  return displayName;
}

function normalizeDirectoryQuery(value) {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_QUERY_RAW_CODE_UNITS
    || hasForbiddenUnicode(value)) fail('query');
  const normalized = canonicalTokens(value);
  if (!normalized
    || normalized.canonical.length < MIN_QUERY_CODE_UNITS
    || normalized.canonical.length > MAX_QUERY_CODE_UNITS) fail('query');
  return Object.freeze({
    normalized: normalized.canonical,
    digest: prefixDigest(normalized.canonical),
    lengthBucket: queryLengthBucket(normalized.canonical.length),
  });
}

function prefixDigest(normalizedPrefix) {
  return sha256([
    'mprc.member-directory.prefix.v1\0',
    normalizedPrefix,
  ]);
}

function addCodePointPrefixes(value, target) {
  let prefix = '';
  for (const character of value) {
    prefix += character;
    if (prefix.length > MAX_QUERY_CODE_UNITS) break;
    if (prefix.length >= MIN_QUERY_CODE_UNITS) target.add(prefixDigest(prefix));
  }
}

function derivePrefixDigests(displayName) {
  const normalized = canonicalTokens(displayName);
  if (!normalized) fail('name');
  const digests = new Set();
  addCodePointPrefixes(normalized.canonical, digests);
  for (const token of normalized.tokens) addCodePointPrefixes(token, digests);
  const result = [...digests].sort();
  if (result.length === 0 || result.length > MAX_PREFIX_DIGESTS) fail('name');
  return Object.freeze(result);
}

function queryLengthBucket(length) {
  if (length <= 4) return '2-4';
  if (length <= 8) return '5-8';
  if (length <= 16) return '9-16';
  if (length <= 32) return '17-32';
  return '33-80';
}

function isSafeUid(uid) {
  if (typeof uid !== 'string' || !UID_PATTERN.test(uid)) return false;
  return !hasForbiddenUnicode(uid);
}

function directoryEntryReference(uid) {
  if (!isSafeUid(uid)) fail('uid');
  return `entry_${sha256(['mprc.member-directory.entry.v1\0', uid])}`;
}

function readDigestArray(value, expectedDisplayName) {
  if (safeIsProxy(value) || !Array.isArray(value)) fail('stored');
  let prototype;
  let keys;
  let lengthDescriptor;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  } catch (_error) {
    fail('stored');
  }
  if (prototype !== arrayPrototype
    || !lengthDescriptor
    || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value <= 0
    || lengthDescriptor.value > MAX_PREFIX_DIGESTS
    || keys.length !== lengthDescriptor.value + 1) fail('stored');

  const output = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const key = String(index);
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (_error) {
      fail('stored');
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || typeof descriptor.value !== 'string'
      || !LOWERCASE_SHA256_PATTERN.test(descriptor.value)) fail('stored');
    output.push(descriptor.value);
  }
  const expected = derivePrefixDigests(expectedDisplayName);
  if (output.length !== expected.length
    || output.some((digest, index) => digest !== expected[index])) fail('stored');
  return Object.freeze(output);
}

function readStoredDirectoryProjection(value) {
  const data = readExactDataObject(value, PROJECTION_FIELDS, 'stored');
  if (data.schemaVersion !== memberDirectoryProjectionSchemaVersion
    || data.normalizationVersion !== memberDirectoryNormalizationVersion
    || typeof data.entryRef !== 'string'
    || !ENTRY_REFERENCE_PATTERN.test(data.entryRef)
    || !Number.isSafeInteger(data.preferenceRevision)
    || data.preferenceRevision <= 0
    || (data.photoVersion !== null
      && (typeof data.photoVersion !== 'string'
        || !REQUEST_ID_PATTERN.test(data.photoVersion)))
    || !isTimestamp(data.createdAt)
    || !isTimestamp(data.updatedAt)) fail('stored');

  const member = { fullName: data.displayName };
  const displayName = readDirectoryDisplayName(member);
  if (displayName === null || displayName !== data.displayName) fail('stored');
  const prefixDigests = readDigestArray(data.prefixDigests, displayName);
  return Object.freeze({
    schemaVersion: memberDirectoryProjectionSchemaVersion,
    normalizationVersion: memberDirectoryNormalizationVersion,
    entryRef: data.entryRef,
    displayName,
    prefixDigests,
    photoVersion: data.photoVersion,
    preferenceRevision: data.preferenceRevision,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  });
}

function buildDirectoryProjection({
  uid,
  member,
  state,
  existingProjection = null,
  updatedAt = null,
}) {
  if (!state
    || !state.preference
    || state.searchableByOfficers !== true) return null;
  const displayName = readDirectoryDisplayName(member);
  if (!displayName) return null;
  const entryRef = directoryEntryReference(uid);
  // Member timestamps are browser-writable legacy fields and therefore never
  // determine projection freshness. Callers may supply a trusted server time;
  // otherwise the server-owned preference timestamp is deterministic.
  const sourceUpdatedAt = updatedAt || state.preference.updatedAt;
  if (!isTimestamp(sourceUpdatedAt)) fail('stored');

  let createdAt = sourceUpdatedAt;
  if (existingProjection !== null) {
    try {
      const existing = readStoredDirectoryProjection(existingProjection);
      if (existing.entryRef === entryRef) createdAt = existing.createdAt;
    } catch (_error) {
      // A malformed server-only projection never contributes state. Rebuild it
      // solely from current trusted source documents.
    }
  }
  return Object.freeze({
    schemaVersion: memberDirectoryProjectionSchemaVersion,
    normalizationVersion: memberDirectoryNormalizationVersion,
    entryRef,
    displayName,
    prefixDigests: derivePrefixDigests(displayName),
    photoVersion: state.photo ? state.photo.version : null,
    preferenceRevision: state.revision,
    createdAt,
    updatedAt: sourceUpdatedAt,
  });
}

function directoryProjectionsEqual(leftValue, rightValue) {
  let left;
  let right;
  try {
    left = readStoredDirectoryProjection(leftValue);
    right = readStoredDirectoryProjection(rightValue);
  } catch (_error) {
    return false;
  }
  return left.schemaVersion === right.schemaVersion
    && left.normalizationVersion === right.normalizationVersion
    && left.entryRef === right.entryRef
    && left.displayName === right.displayName
    && left.photoVersion === right.photoVersion
    && left.preferenceRevision === right.preferenceRevision
    && timestampsEqual(left.createdAt, right.createdAt)
    && timestampsEqual(left.updatedAt, right.updatedAt)
    && left.prefixDigests.length === right.prefixDigests.length
    && left.prefixDigests.every((digest, index) => digest === right.prefixDigests[index]);
}

function directoryProjectionContentEqual(leftValue, rightValue) {
  let left;
  let right;
  try {
    left = readStoredDirectoryProjection(leftValue);
    right = readStoredDirectoryProjection(rightValue);
  } catch (_error) {
    return false;
  }
  return left.schemaVersion === right.schemaVersion
    && left.normalizationVersion === right.normalizationVersion
    && left.entryRef === right.entryRef
    && left.displayName === right.displayName
    && left.photoVersion === right.photoVersion
    && left.preferenceRevision === right.preferenceRevision
    && left.prefixDigests.length === right.prefixDigests.length
    && left.prefixDigests.every((digest, index) => digest === right.prefixDigests[index]);
}

Object.freeze(MemberDirectoryProjectionError.prototype);
Object.freeze(MemberDirectoryProjectionError);

module.exports = Object.freeze({
  memberDirectoryProjectionSchemaVersion,
  memberDirectoryNormalizationVersion,
  MEMBER_DIRECTORY_ENTRY_COLLECTION,
  MAX_DISPLAY_NAME_CODE_UNITS,
  MAX_PREFIX_DIGESTS,
  MIN_QUERY_CODE_UNITS,
  MAX_QUERY_CODE_UNITS,
  ENTRY_REFERENCE_PATTERN,
  REQUEST_ID_PATTERN,
  PROJECTION_FIELDS,
  MemberDirectoryProjectionError,
  readExactDataObject,
  isTimestamp,
  timestampsEqual,
  isSafeUid,
  readDirectoryDisplayName,
  normalizeDirectoryQuery,
  prefixDigest,
  derivePrefixDigests,
  queryLengthBucket,
  directoryEntryReference,
  readStoredDirectoryProjection,
  buildDirectoryProjection,
  directoryProjectionsEqual,
  directoryProjectionContentEqual,
});
