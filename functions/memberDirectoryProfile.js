'use strict';

const { createHash } = require('node:crypto');
const { types: { isProxy } } = require('node:util');
const admin = require('firebase-admin');
const { Timestamp } = require('firebase-admin/firestore');
const functions = require('firebase-functions');

const { checkRateLimit } = require('./rateLimit');
const { requireAppCheck } = require('./stripeHelpers');
const {
  MEMBER_DIRECTORY_ENTRY_COLLECTION,
  isSafeUid,
  buildDirectoryProjection,
  directoryProjectionsEqual,
} = require('./memberDirectoryProjection');

const schemaVersion = 1;
const PHOTO_SIZE = 256;
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_INPUT_PIXELS = 20_000_000;
const MAX_INPUT_DIMENSION = 8_192;
const MAX_OUTPUT_BYTES = 64 * 1024;
const PHOTO_RATE_LIMIT = 10;
const PHOTO_RATE_WINDOW_MS = 60 * 60 * 1000;

const PREFERENCE_COLLECTION = 'memberDirectoryPreferences';
const PHOTO_COLLECTION = 'memberDirectoryPhotos';
const AUDIT_COLLECTION = 'auditEvents';
const PHOTO_RATE_SCOPE = 'member_directory_photo';

const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const CONTENT_TYPES = Object.freeze({
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
});
const ACTIONS = Object.freeze({
  setVisibility: 'member_directory.visibility_set',
  setPhoto: 'member_directory.photo_set',
  removePhoto: 'member_directory.photo_removed',
});
const ACTION_SET = new Set(Object.values(ACTIONS));
const OUTCOME_APPLIED = 'applied';
const MIN_TIMESTAMP_SECONDS = -62_135_596_800;
const MAX_TIMESTAMP_SECONDS = 253_402_300_799;
const MAX_TIMESTAMP_NANOSECONDS = 999_999_999;
const bufferEquals = Buffer.prototype.equals;
const bufferSubarray = Buffer.prototype.subarray;
const bufferToString = Buffer.prototype.toString;
const bufferPrototype = Buffer.prototype;
const timestampPrototype = Timestamp.prototype;

const EMPTY_FIELDS = Object.freeze([]);
const VISIBILITY_REQUEST_FIELDS = Object.freeze([
  'requestId',
  'expectedRevision',
  'searchableByOfficers',
]);
const PHOTO_REQUEST_FIELDS = Object.freeze([
  'requestId',
  'expectedRevision',
  'contentType',
  'base64Data',
]);
const REMOVE_REQUEST_FIELDS = Object.freeze([
  'requestId',
  'expectedRevision',
]);
const PREFERENCE_FIELDS = Object.freeze([
  'schemaVersion',
  'revision',
  'searchableByOfficers',
  'hasPhoto',
  'lastRequestId',
  'lastAction',
  'lastExpectedRevision',
  'updatedAt',
]);
const PHOTO_FIELDS = Object.freeze([
  'schemaVersion',
  'bytes',
  'contentType',
  'width',
  'height',
  'version',
  'updatedAt',
]);
const AUDIT_FIELDS = Object.freeze([
  'actorUid',
  'action',
  'requestId',
  'revision',
  'hasPhoto',
  'searchableByOfficers',
  'outcome',
  'createdAt',
]);

const INVALID_REQUEST_MESSAGE = 'Profile directory request is invalid.';
const INVALID_PHOTO_MESSAGE = 'Profile photo is invalid.';
const UNAUTHENTICATED_MESSAGE = 'Sign-in required.';
const STALE_MESSAGE = 'Profile directory changed. Reload before trying again.';
const NAME_REQUIRED_MESSAGE =
  'A valid account display name is required before enabling search.';
const STATE_UNAVAILABLE_MESSAGE = 'Profile directory state is unavailable.';
const OPERATION_UNAVAILABLE_MESSAGE =
  'Profile directory update could not be confirmed. Reload before trying again.';
const RESPONSE_UNAVAILABLE_MESSAGE = 'Private profile response is unavailable.';

let sharpModule;

function loadSharp() {
  if (sharpModule === undefined) sharpModule = require('sharp');
  return sharpModule;
}

class MemberDirectoryProfileError extends Error {
  constructor(kind) {
    super('Member directory profile input is invalid.');
    Object.defineProperty(this, 'name', {
      value: 'MemberDirectoryProfileError',
      enumerable: false,
    });
    Object.defineProperty(this, 'kind', {
      value: kind,
      enumerable: false,
    });
    Error.captureStackTrace?.(this, MemberDirectoryProfileError);
  }
}

function fail(kind) {
  throw new MemberDirectoryProfileError(kind);
}

function safeIsProxy(value) {
  try {
    return isProxy(value);
  } catch (_error) {
    return true;
  }
}

function readDataObject(value, expectedFields, kind) {
  if (value === null || typeof value !== 'object' || safeIsProxy(value)) fail(kind);

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (_error) {
    fail(kind);
  }
  if (prototype !== Object.prototype || keys.length !== expectedFields.length) fail(kind);

  const expected = new Set(expectedFields);
  const data = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || !expected.has(key)
      || Object.prototype.hasOwnProperty.call(data, key)) {
      fail(kind);
    }
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (_error) {
      fail(kind);
    }
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined) {
      fail(kind);
    }
    data[key] = descriptor.value;
  }
  if (expectedFields.some((field) => !Object.prototype.hasOwnProperty.call(data, field))) {
    fail(kind);
  }
  return data;
}

function readEmptyRequest(value) {
  if (value === undefined || value === null) return Object.freeze({});
  readDataObject(value, EMPTY_FIELDS, 'request');
  return Object.freeze({});
}

function requireRequestId(value, kind = 'request') {
  if (typeof value !== 'string' || !REQUEST_ID_PATTERN.test(value)) fail(kind);
  return value;
}

function requireRevision(value, kind = 'request') {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) fail(kind);
  return value;
}

function sha256(parts) {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest('hex');
}

function readVisibilityRequest(value) {
  const data = readDataObject(value, VISIBILITY_REQUEST_FIELDS, 'request');
  requireRequestId(data.requestId);
  requireRevision(data.expectedRevision);
  if (typeof data.searchableByOfficers !== 'boolean') fail('request');
  return Object.freeze({
    requestId: data.requestId,
    expectedRevision: data.expectedRevision,
    searchableByOfficers: data.searchableByOfficers,
  });
}

function decodePhotoRequest(value) {
  const data = readDataObject(value, PHOTO_REQUEST_FIELDS, 'request');
  requireRequestId(data.requestId);
  requireRevision(data.expectedRevision);
  if (!Object.prototype.hasOwnProperty.call(CONTENT_TYPES, data.contentType)) fail('request');
  if (typeof data.base64Data !== 'string'
    || data.base64Data.length === 0
    || data.base64Data.length % 4 !== 0
    || data.base64Data.length > Math.ceil(MAX_INPUT_BYTES / 3) * 4
    || !BASE64_PATTERN.test(data.base64Data)) {
    fail('request');
  }

  let bytes;
  try {
    bytes = Buffer.from(data.base64Data, 'base64');
  } catch (_error) {
    fail('request');
  }
  if (bytes.length === 0
    || bytes.length > MAX_INPUT_BYTES
    || bytes.toString('base64') !== data.base64Data) {
    fail('request');
  }

  return Object.freeze({
    requestId: data.requestId,
    expectedRevision: data.expectedRevision,
    contentType: data.contentType,
    bytes,
  });
}

function readRemoveRequest(value) {
  const data = readDataObject(value, REMOVE_REQUEST_FIELDS, 'request');
  requireRequestId(data.requestId);
  requireRevision(data.expectedRevision);
  return Object.freeze({
    requestId: data.requestId,
    expectedRevision: data.expectedRevision,
  });
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
  const leftParts = timestampParts(left);
  const rightParts = timestampParts(right);
  return leftParts !== null
    && rightParts !== null
    && leftParts.seconds === rightParts.seconds
    && leftParts.nanoseconds === rightParts.nanoseconds;
}

function isBuffer(value) {
  if (safeIsProxy(value) || !Buffer.isBuffer(value)) return false;
  try {
    return Object.getPrototypeOf(value) === bufferPrototype;
  } catch (_error) {
    return false;
  }
}

function hasWebpMagic(value) {
  if (!isBuffer(value) || value.length < 12) return false;
  try {
    return bufferToString.call(bufferSubarray.call(value, 0, 4), 'ascii') === 'RIFF'
      && bufferToString.call(bufferSubarray.call(value, 8, 12), 'ascii') === 'WEBP';
  } catch (_error) {
    return false;
  }
}

function processedBuffersEqual(left, right) {
  if (!isBuffer(left) || !isBuffer(right)) return false;
  try {
    return bufferEquals.call(left, right);
  } catch (_error) {
    return false;
  }
}

function readStoredPhoto(value) {
  if (value === null) return null;
  const data = readDataObject(value, PHOTO_FIELDS, 'stored');
  if (data.schemaVersion !== schemaVersion
    || !isBuffer(data.bytes)
    || data.bytes.length === 0
    || data.bytes.length > MAX_OUTPUT_BYTES
    || !hasWebpMagic(data.bytes)
    || data.contentType !== 'image/webp'
    || data.width !== PHOTO_SIZE
    || data.height !== PHOTO_SIZE
    || typeof data.version !== 'string'
    || !REQUEST_ID_PATTERN.test(data.version)
    || !isTimestamp(data.updatedAt)) {
    fail('stored');
  }
  return Object.freeze({
    schemaVersion,
    bytes: data.bytes,
    contentType: 'image/webp',
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    version: data.version,
    updatedAt: data.updatedAt,
  });
}

function readStoredPreference(value) {
  if (value === null) return null;
  const data = readDataObject(value, PREFERENCE_FIELDS, 'stored');
  if (data.schemaVersion !== schemaVersion
    || !Number.isSafeInteger(data.revision)
    || data.revision <= 0
    || typeof data.searchableByOfficers !== 'boolean'
    || typeof data.hasPhoto !== 'boolean'
    || !REQUEST_ID_PATTERN.test(data.lastRequestId)
    || !ACTION_SET.has(data.lastAction)
    || !Number.isSafeInteger(data.lastExpectedRevision)
    || data.lastExpectedRevision < 0
    || Object.is(data.lastExpectedRevision, -0)
    || data.lastExpectedRevision !== data.revision - 1
    || !isTimestamp(data.updatedAt)) {
    fail('stored');
  }
  return Object.freeze({
    schemaVersion,
    revision: data.revision,
    searchableByOfficers: data.searchableByOfficers,
    hasPhoto: data.hasPhoto,
    lastRequestId: data.lastRequestId,
    lastAction: data.lastAction,
    lastExpectedRevision: data.lastExpectedRevision,
    updatedAt: data.updatedAt,
  });
}

function readStoredState(preferenceValue, photoValue) {
  const preference = readStoredPreference(preferenceValue);
  const photo = readStoredPhoto(photoValue);
  if (!preference) {
    if (photo) fail('stored');
    return Object.freeze({
      preference: null,
      photo: null,
      revision: 0,
      searchableByOfficers: false,
      hasPhoto: false,
    });
  }
  if (preference.hasPhoto !== Boolean(photo)) fail('stored');
  if (preference.lastAction === ACTIONS.setPhoto
    && (!photo
      || photo.version !== preference.lastRequestId
      || !timestampsEqual(photo.updatedAt, preference.updatedAt))) {
    fail('stored');
  }
  if (preference.lastAction === ACTIONS.removePhoto && photo) fail('stored');
  return Object.freeze({
    preference,
    photo,
    revision: preference.revision,
    searchableByOfficers: preference.searchableByOfficers,
    hasPhoto: preference.hasPhoto,
  });
}

function requireProcessedPhoto(value) {
  return readStoredPhoto(value);
}

function buildPreference(state, command, nextValues) {
  return Object.freeze({
    schemaVersion,
    revision: state.revision + 1,
    searchableByOfficers: nextValues.searchableByOfficers,
    hasPhoto: nextValues.hasPhoto,
    lastRequestId: command.requestId,
    lastAction: command.action,
    lastExpectedRevision: command.expectedRevision,
    updatedAt: command.occurredAt,
  });
}

function sameLatestCommand(preference, currentPhoto, command) {
  const sameIdentity = preference.lastRequestId === command.requestId
    && preference.lastAction === command.action
    && preference.lastExpectedRevision === command.expectedRevision;
  if (!sameIdentity) return false;
  if (command.action === ACTIONS.setVisibility) {
    return preference.searchableByOfficers === command.searchableByOfficers;
  }
  if (command.action === ACTIONS.removePhoto) return currentPhoto === null;
  return currentPhoto !== null
    && command.photo !== null
    && currentPhoto.contentType === command.photo.contentType
    && currentPhoto.width === command.photo.width
    && currentPhoto.height === command.photo.height
    && currentPhoto.version === command.requestId
    && command.photo.version === command.requestId
    && processedBuffersEqual(currentPhoto.bytes, command.photo.bytes);
}

function readMutationCommand(value) {
  const fields = Object.freeze([
    'action',
    'requestId',
    'expectedRevision',
    'searchableByOfficers',
    'photo',
    'occurredAt',
  ]);
  const data = readDataObject(value, fields, 'request');
  if (!ACTION_SET.has(data.action)) fail('request');
  requireRequestId(data.requestId);
  requireRevision(data.expectedRevision);
  if (!isTimestamp(data.occurredAt)) fail('request');

  if (data.action === ACTIONS.setVisibility) {
    if (typeof data.searchableByOfficers !== 'boolean' || data.photo !== null) fail('request');
  } else if (data.action === ACTIONS.setPhoto) {
    if (data.searchableByOfficers !== null) fail('request');
    const photo = requireProcessedPhoto(data.photo);
    if (photo.version !== data.requestId) fail('request');
  } else if (data.searchableByOfficers !== null || data.photo !== null) {
    fail('request');
  }
  return data;
}

function reduceMemberDirectoryProfile(preferenceValue, photoValue, commandValue) {
  const state = readStoredState(preferenceValue, photoValue);
  const command = readMutationCommand(commandValue);

  if (state.preference && state.preference.lastRequestId === command.requestId) {
    if (!sameLatestCommand(state.preference, state.photo, command)) fail('stale');
    return Object.freeze({
      disposition: 'already_applied',
      preference: state.preference,
      photo: state.photo,
    });
  }
  if (command.expectedRevision !== state.revision
    || state.revision === Number.MAX_SAFE_INTEGER) {
    fail('stale');
  }

  let nextPhoto = state.photo;
  let searchableByOfficers = state.searchableByOfficers;
  if (command.action === ACTIONS.setVisibility) {
    searchableByOfficers = command.searchableByOfficers;
  } else if (command.action === ACTIONS.setPhoto) {
    nextPhoto = requireProcessedPhoto(command.photo);
  } else {
    nextPhoto = null;
  }

  const preference = buildPreference(state, command, {
    searchableByOfficers,
    hasPhoto: Boolean(nextPhoto),
  });
  return Object.freeze({
    disposition: 'applied',
    preference,
    photo: nextPhoto,
  });
}

function buildMutationCommand(action, request, photo = null, occurredAt = Timestamp.now()) {
  return Object.freeze({
    action,
    requestId: request.requestId,
    expectedRevision: request.expectedRevision,
    searchableByOfficers: action === ACTIONS.setVisibility
      ? request.searchableByOfficers
      : null,
    photo,
    occurredAt,
  });
}

function buildAudit(uid, command, preference) {
  return Object.freeze({
    actorUid: uid,
    action: command.action,
    requestId: command.requestId,
    revision: preference.revision,
    hasPhoto: preference.hasPhoto,
    searchableByOfficers: preference.searchableByOfficers,
    outcome: OUTCOME_APPLIED,
    createdAt: preference.updatedAt,
  });
}

function readStoredAudit(value, expected) {
  const data = readDataObject(value, AUDIT_FIELDS, 'stored');
  for (const field of AUDIT_FIELDS) {
    if (field === 'createdAt') {
      if (!timestampsEqual(data[field], expected[field])) fail('stored');
    } else if (data[field] !== expected[field]) {
      fail('stored');
    }
  }
  return expected;
}

function auditDocumentId(uid, requestId) {
  return `member_directory_${sha256([
    'mprc.member-directory.audit.v1\0',
    uid,
    '\0',
    requestId,
  ])}`;
}

function photoRateLimitKey(uid) {
  return sha256([
    'mprc.member-directory.photo-rate.v1\0',
    uid,
  ]);
}

function readMemberName(memberValue) {
  if (memberValue === null || typeof memberValue !== 'object' || safeIsProxy(memberValue)) {
    return null;
  }
  let prototype;
  let descriptor;
  try {
    prototype = Object.getPrototypeOf(memberValue);
    descriptor = Object.getOwnPropertyDescriptor(memberValue, 'fullName');
  } catch (_error) {
    return null;
  }
  if (prototype !== Object.prototype
    || !descriptor
    || descriptor.enumerable !== true
    || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
    return null;
  }
  const name = descriptor.value;
  if (typeof name !== 'string') return null;
  const normalized = name.trim();
  return normalized.length > 0 && normalized.length <= 200 ? normalized : null;
}

function publicState(preference, photo, includePhoto) {
  const state = readStoredState(preference, photo);
  const result = {
    schemaVersion,
    revision: state.revision,
    searchableByOfficers: state.searchableByOfficers,
    hasPhoto: state.hasPhoto,
  };
  if (includePhoto) {
    result.photo = state.photo ? Object.freeze({
      contentType: state.photo.contentType,
      base64Data: bufferToString.call(state.photo.bytes, 'base64'),
      width: state.photo.width,
      height: state.photo.height,
      version: state.photo.version,
    }) : null;
  }
  return Object.freeze(result);
}

function photoMagicMatches(bytes, format) {
  if (format === 'jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (format === 'png') {
    return bytes.length >= 8
      && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  return bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
}

async function processMemberDirectoryPhoto(decodedRequest) {
  const expectedFormat = CONTENT_TYPES[decodedRequest.contentType];
  if (!expectedFormat || !photoMagicMatches(decodedRequest.bytes, expectedFormat)) fail('photo');

  let sharp;
  try {
    sharp = loadSharp();
  } catch (_error) {
    fail('processor');
  }

  let metadata;
  try {
    metadata = await sharp(decodedRequest.bytes, {
      failOn: 'warning',
      limitInputPixels: MAX_INPUT_PIXELS,
      sequentialRead: true,
    }).metadata();
  } catch (_error) {
    fail('photo');
  }

  if (metadata.format !== expectedFormat
    || !Number.isSafeInteger(metadata.width)
    || !Number.isSafeInteger(metadata.height)
    || metadata.width <= 0
    || metadata.height <= 0
    || metadata.width > MAX_INPUT_DIMENSION
    || metadata.height > MAX_INPUT_DIMENSION
    || metadata.width * metadata.height > MAX_INPUT_PIXELS
    || (metadata.pages !== undefined && metadata.pages !== 1)
    || (metadata.pageHeight !== undefined && metadata.pageHeight !== metadata.height)) {
    fail('photo');
  }

  const attempts = Object.freeze([
    Object.freeze({ quality: 76, alphaQuality: 60 }),
    Object.freeze({ quality: 60, alphaQuality: 45 }),
    Object.freeze({ quality: 44, alphaQuality: 30 }),
    Object.freeze({ quality: 32, alphaQuality: 20 }),
  ]);
  let output = null;
  for (const options of attempts) {
    try {
      output = await sharp(decodedRequest.bytes, {
        failOn: 'warning',
        limitInputPixels: MAX_INPUT_PIXELS,
        sequentialRead: true,
      })
        .rotate()
        .resize(PHOTO_SIZE, PHOTO_SIZE, { fit: 'cover', position: 'centre' })
        .webp({
          quality: options.quality,
          alphaQuality: options.alphaQuality,
          effort: 6,
          smartSubsample: true,
        })
        .toBuffer();
    } catch (_error) {
      fail('photo');
    }
    if (output.length > 0 && output.length <= MAX_OUTPUT_BYTES) break;
    output = null;
  }
  if (!output) fail('photo');

  let outputMetadata;
  try {
    outputMetadata = await sharp(output, {
      failOn: 'warning',
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
  } catch (_error) {
    fail('photo');
  }
  if (outputMetadata.format !== 'webp'
    || outputMetadata.width !== PHOTO_SIZE
    || outputMetadata.height !== PHOTO_SIZE
    || (outputMetadata.pages !== undefined && outputMetadata.pages !== 1)
    || outputMetadata.exif !== undefined
    || outputMetadata.icc !== undefined
    || outputMetadata.iptc !== undefined
    || outputMetadata.xmp !== undefined) {
    fail('photo');
  }
  return output;
}

function authenticatedUid(context) {
  const uid = context && context.auth && context.auth.uid;
  if (!isSafeUid(uid)) {
    throw new functions.https.HttpsError('unauthenticated', UNAUTHENTICATED_MESSAGE);
  }
  return uid;
}

function requirePrivateNoStoreResponse(context) {
  const response = context && context.rawRequest && context.rawRequest.res;
  if (!response || typeof response.setHeader !== 'function') {
    throw new functions.https.HttpsError('internal', RESPONSE_UNAVAILABLE_MESSAGE);
  }
  try {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');
  } catch (_error) {
    throw new functions.https.HttpsError('internal', RESPONSE_UNAVAILABLE_MESSAGE);
  }
}

function mapProfileError(error) {
  if (!(error instanceof MemberDirectoryProfileError)) return null;
  if (error.kind === 'request') {
    return new functions.https.HttpsError('invalid-argument', INVALID_REQUEST_MESSAGE);
  }
  if (error.kind === 'photo') {
    return new functions.https.HttpsError('invalid-argument', INVALID_PHOTO_MESSAGE);
  }
  if (error.kind === 'stale') {
    return new functions.https.HttpsError('aborted', STALE_MESSAGE);
  }
  if (error.kind === 'processor') {
    return new functions.https.HttpsError('internal', OPERATION_UNAVAILABLE_MESSAGE);
  }
  return new functions.https.HttpsError('data-loss', STATE_UNAVAILABLE_MESSAGE);
}

function mapProfileErrorOrInternal(error) {
  return mapProfileError(error)
    || new functions.https.HttpsError('internal', OPERATION_UNAVAILABLE_MESSAGE);
}

function isHttpsError(error) {
  return error instanceof functions.https.HttpsError;
}

function snapshotValue(snapshot) {
  return snapshot.exists ? snapshot.data() : null;
}

function refsForUid(db, uid) {
  return Object.freeze({
    preference: db.collection(PREFERENCE_COLLECTION).doc(uid),
    photo: db.collection(PHOTO_COLLECTION).doc(uid),
    member: db.collection('members').doc(uid),
    entry: db.collection(MEMBER_DIRECTORY_ENTRY_COLLECTION).doc(uid),
  });
}

async function readProfile(uid) {
  const db = admin.firestore();
  const refs = refsForUid(db, uid);
  try {
    return await db.runTransaction(async (transaction) => {
      const [preferenceSnapshot, photoSnapshot] = await Promise.all([
        transaction.get(refs.preference),
        transaction.get(refs.photo),
      ]);
      return publicState(
        snapshotValue(preferenceSnapshot),
        snapshotValue(photoSnapshot),
        true,
      );
    }, { readOnly: true });
  } catch (error) {
    const mapped = mapProfileError(error);
    if (mapped) throw mapped;
    throw new functions.https.HttpsError('internal', STATE_UNAVAILABLE_MESSAGE);
  }
}

async function mutateProfile(uid, command) {
  const db = admin.firestore();
  const refs = refsForUid(db, uid);
  const auditRef = db.collection(AUDIT_COLLECTION).doc(
    auditDocumentId(uid, command.requestId),
  );
  try {
    return await db.runTransaction(async (transaction) => {
      const [
        preferenceSnapshot,
        photoSnapshot,
        auditSnapshot,
        entrySnapshot,
      ] = await Promise.all([
        transaction.get(refs.preference),
        transaction.get(refs.photo),
        transaction.get(auditRef),
        transaction.get(refs.entry),
      ]);
      const previousPreference = snapshotValue(preferenceSnapshot);
      const previousPhoto = snapshotValue(photoSnapshot);
      const reduced = reduceMemberDirectoryProfile(
        previousPreference,
        previousPhoto,
        command,
      );
      const expectedAudit = buildAudit(uid, command, reduced.preference);

      if (reduced.disposition === 'already_applied') {
        if (!auditSnapshot.exists) fail('stored');
        readStoredAudit(auditSnapshot.data(), expectedAudit);
        return publicState(reduced.preference, reduced.photo, false);
      }
      if (auditSnapshot.exists) fail('stale');

      let desiredEntry = null;
      if (reduced.preference.searchableByOfficers === true) {
        const memberSnapshot = await transaction.get(refs.member);
        desiredEntry = buildDirectoryProjection({
          uid,
          member: memberSnapshot.exists ? memberSnapshot.data() : null,
          state: {
            preference: reduced.preference,
            photo: reduced.photo,
            revision: reduced.preference.revision,
            searchableByOfficers: reduced.preference.searchableByOfficers,
            hasPhoto: reduced.preference.hasPhoto,
          },
          existingProjection: snapshotValue(entrySnapshot),
          updatedAt: command.occurredAt,
        });
        if (command.action === ACTIONS.setVisibility
          && command.searchableByOfficers === true
          && !desiredEntry) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            NAME_REQUIRED_MESSAGE,
          );
        }
      }

      transaction.set(refs.preference, reduced.preference);
      if (command.action === ACTIONS.setPhoto) {
        transaction.set(refs.photo, reduced.photo);
      } else if (command.action === ACTIONS.removePhoto && previousPhoto !== null) {
        transaction.delete(refs.photo);
      }
      if (desiredEntry) {
        if (!entrySnapshot.exists
          || !directoryProjectionsEqual(entrySnapshot.data(), desiredEntry)) {
          transaction.set(refs.entry, desiredEntry);
        }
      } else if (entrySnapshot.exists) {
        transaction.delete(refs.entry);
      }
      transaction.create(auditRef, expectedAudit);
      return publicState(reduced.preference, reduced.photo, false);
    });
  } catch (error) {
    if (isHttpsError(error)) throw error;
    const mapped = mapProfileError(error);
    if (mapped) throw mapped;
    throw new functions.https.HttpsError('internal', OPERATION_UNAVAILABLE_MESSAGE);
  }
}

const getMyMemberDirectoryProfile = functions
  .runWith({ enforceAppCheck: true })
  .https.onCall(async (data, context) => {
    requireAppCheck(context);
    requirePrivateNoStoreResponse(context);
    const uid = authenticatedUid(context);
    try {
      readEmptyRequest(data);
    } catch (error) {
      throw mapProfileErrorOrInternal(error);
    }
    return readProfile(uid);
  });

const setMyMemberDirectoryVisibility = functions
  .runWith({ enforceAppCheck: true })
  .https.onCall(async (data, context) => {
    requireAppCheck(context);
    requirePrivateNoStoreResponse(context);
    const uid = authenticatedUid(context);
    let request;
    try {
      request = readVisibilityRequest(data);
    } catch (error) {
      throw mapProfileErrorOrInternal(error);
    }
    return mutateProfile(uid, buildMutationCommand(ACTIONS.setVisibility, request));
  });

const setMyMemberDirectoryPhoto = functions
  .runWith({ enforceAppCheck: true, memory: '512MB', timeoutSeconds: 30 })
  .https.onCall(async (data, context) => {
    requireAppCheck(context);
    requirePrivateNoStoreResponse(context);
    const uid = authenticatedUid(context);
    let request;
    try {
      request = decodePhotoRequest(data);
    } catch (error) {
      throw mapProfileErrorOrInternal(error);
    }

    // Meter before Sharp even for an exact retry. With no persisted digest of
    // the original upload, requestId alone cannot prove that bytes are unchanged;
    // skipping this write would let changed payloads bypass the CPU boundary.
    // The preference/photo/audit transaction remains read-only for an exact retry.
    try {
      await checkRateLimit({
        scope: PHOTO_RATE_SCOPE,
        key: photoRateLimitKey(uid),
        limit: PHOTO_RATE_LIMIT,
        windowMs: PHOTO_RATE_WINDOW_MS,
      });
    } catch (error) {
      if (isHttpsError(error)) throw error;
      throw new functions.https.HttpsError('internal', OPERATION_UNAVAILABLE_MESSAGE);
    }

    let processedBytes;
    try {
      processedBytes = await processMemberDirectoryPhoto(request);
    } catch (error) {
      throw mapProfileErrorOrInternal(error);
    }
    const occurredAt = Timestamp.now();
    const photo = Object.freeze({
      schemaVersion,
      bytes: processedBytes,
      contentType: 'image/webp',
      width: PHOTO_SIZE,
      height: PHOTO_SIZE,
      version: request.requestId,
      updatedAt: occurredAt,
    });
    return mutateProfile(
      uid,
      buildMutationCommand(ACTIONS.setPhoto, request, photo, occurredAt),
    );
  });

const removeMyMemberDirectoryPhoto = functions
  .runWith({ enforceAppCheck: true })
  .https.onCall(async (data, context) => {
    requireAppCheck(context);
    requirePrivateNoStoreResponse(context);
    const uid = authenticatedUid(context);
    let request;
    try {
      request = readRemoveRequest(data);
    } catch (error) {
      throw mapProfileErrorOrInternal(error);
    }
    return mutateProfile(uid, buildMutationCommand(ACTIONS.removePhoto, request));
  });

Object.freeze(MemberDirectoryProfileError.prototype);
Object.freeze(MemberDirectoryProfileError);

module.exports = Object.freeze({
  schemaVersion,
  ACTIONS,
  MemberDirectoryProfileError,
  readEmptyRequest,
  readVisibilityRequest,
  decodePhotoRequest,
  readRemoveRequest,
  readStoredState,
  reduceMemberDirectoryProfile,
  buildMutationCommand,
  buildAudit,
  auditDocumentId,
  photoRateLimitKey,
  readMemberName,
  publicState,
  processMemberDirectoryPhoto,
  authenticatedUid,
  requirePrivateNoStoreResponse,
  isHttpsError,
  getMyMemberDirectoryProfile,
  setMyMemberDirectoryVisibility,
  setMyMemberDirectoryPhoto,
  removeMyMemberDirectoryPhoto,
});
