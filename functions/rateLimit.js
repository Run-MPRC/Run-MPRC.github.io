const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { types: { isProxy } } = require('node:util');
const { Timestamp } = require('firebase-admin/firestore');

const INVALID_BUCKET_VALUE = Symbol('invalid-bucket-value');
const MIN_TIMESTAMP_SECONDS = -62_135_596_800;
const MAX_TIMESTAMP_SECONDS = 253_402_300_799;
const MAX_TIMESTAMP_NANOSECONDS = 999_999_999;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwn = Object.hasOwn;
const objectPrototype = Object.prototype;
const reflectOwnKeys = Reflect.ownKeys;
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const mathFloor = Math.floor;
const timestampPrototype = Timestamp.prototype;

/**
 * Simple fixed-window rate limiter backed by Firestore.
 *
 * Docs live at `ratelimits/{scope}__{sanitizedKey}`. Configure a Firestore
 * TTL policy on the `ratelimits` collection (field: `expiresAt`) to auto-
 * prune old buckets — otherwise the collection grows unbounded.
 */

function sanitizeKey(s) {
  return String(s).replace(/[^A-Za-z0-9_.@-]/g, '_').slice(0, 128);
}

function extractIp(context) {
  const req = context.rawRequest || {};
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || 'unknown';
}

function corruptBucketError() {
  return new functions.https.HttpsError(
    'internal',
    'Rate limit state is unavailable.',
  );
}

function limitExceededError() {
  return new functions.https.HttpsError(
    'resource-exhausted',
    'Too many requests. Please wait a few minutes and try again.',
  );
}

function isProxyValue(value) {
  try {
    return isProxy(value);
  } catch (_error) {
    return true;
  }
}

function isPlainBucketRecord(value) {
  if (value === null || typeof value !== 'object' || isProxyValue(value)) return false;
  try {
    return objectGetPrototypeOf(value) === objectPrototype;
  } catch (_error) {
    return false;
  }
}

function selectedOwnDataValue(record, key) {
  let descriptor;
  try {
    descriptor = objectGetOwnPropertyDescriptor(record, key);
  } catch (_error) {
    return INVALID_BUCKET_VALUE;
  }
  if (!descriptor
    || descriptor.enumerable !== true
    || !objectHasOwn(descriptor, 'value')) {
    return INVALID_BUCKET_VALUE;
  }
  return descriptor.value;
}

function projectTimestamp(value) {
  if (value === null || typeof value !== 'object' || isProxyValue(value)) {
    return null;
  }

  let prototype;
  let keys;
  try {
    prototype = objectGetPrototypeOf(value);
    keys = reflectOwnKeys(value);
  } catch (_error) {
    return null;
  }
  if (prototype !== timestampPrototype || keys.length !== 2) return null;
  const hasExactKeys = (keys[0] === '_seconds' && keys[1] === '_nanoseconds')
    || (keys[0] === '_nanoseconds' && keys[1] === '_seconds');
  if (!hasExactKeys) return null;

  const seconds = selectedOwnDataValue(value, '_seconds');
  const nanoseconds = selectedOwnDataValue(value, '_nanoseconds');
  if (!numberIsSafeInteger(seconds)
    || seconds < MIN_TIMESTAMP_SECONDS
    || seconds > MAX_TIMESTAMP_SECONDS
    || !numberIsSafeInteger(nanoseconds)
    || nanoseconds < 0
    || nanoseconds > MAX_TIMESTAMP_NANOSECONDS) {
    return null;
  }

  const milliseconds = seconds * 1_000 + mathFloor(nanoseconds / 1_000_000);
  if (!numberIsFinite(milliseconds)) return null;

  try {
    return {
      milliseconds,
      nanoseconds,
      seconds,
      value: new Timestamp(seconds, nanoseconds),
    };
  } catch (_error) {
    return null;
  }
}

function timestampPartsFromMillis(milliseconds) {
  const seconds = mathFloor(milliseconds / 1_000);
  return {
    nanoseconds: (milliseconds - seconds * 1_000) * 1_000_000,
    seconds,
  };
}

function compareTimestampParts(left, right) {
  if (left.seconds !== right.seconds) return left.seconds < right.seconds ? -1 : 1;
  if (left.nanoseconds === right.nanoseconds) return 0;
  return left.nanoseconds < right.nanoseconds ? -1 : 1;
}

function projectStoredBucket(data, {
  scope, key, windowMs, now,
}) {
  if (!isPlainBucketRecord(data)) throw corruptBucketError();

  const storedScope = selectedOwnDataValue(data, 'scope');
  if (storedScope !== scope) throw corruptBucketError();

  const storedKey = selectedOwnDataValue(data, 'key');
  if (storedKey !== key) throw corruptBucketError();

  const storedWindowMs = selectedOwnDataValue(data, 'windowMs');
  if (storedWindowMs !== windowMs) throw corruptBucketError();

  const count = selectedOwnDataValue(data, 'count');
  if (!numberIsSafeInteger(count) || count <= 0) throw corruptBucketError();

  const windowStart = projectTimestamp(selectedOwnDataValue(data, 'windowStart'));
  if (!windowStart
    || compareTimestampParts(windowStart, timestampPartsFromMillis(now)) > 0) {
    throw corruptBucketError();
  }

  return {
    count,
    windowStart: windowStart.value,
    windowStartMs: windowStart.milliseconds,
    windowStartNanoseconds: windowStart.nanoseconds,
    windowStartSeconds: windowStart.seconds,
  };
}

/**
 * Throws HttpsError('resource-exhausted') if the caller exceeded the limit.
 * @param {{ scope: string, key: string, limit: number, windowMs: number }} opts
 */
async function checkRateLimit({
  scope, key, limit, windowMs,
}) {
  if (!scope || !key) return;
  const db = admin.firestore();
  const docId = `${scope}__${sanitizeKey(key)}`;
  const ref = db.collection('ratelimits').doc(docId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const attemptNow = Date.now();
    const stored = snap.exists
      ? projectStoredBucket(snap.data(), {
        scope,
        key,
        windowMs,
        now: attemptNow,
      })
      : null;
    const inWindow = stored
      ? compareTimestampParts({
        nanoseconds: stored.windowStartNanoseconds,
        seconds: stored.windowStartSeconds,
      }, timestampPartsFromMillis(attemptNow - windowMs)) > 0
      : false;

    if (inWindow && stored.count >= limit) throw limitExceededError();

    const nextCount = inWindow ? stored.count + 1 : 1;
    const nextWindowStart = inWindow
      ? stored.windowStart
      : Timestamp.fromMillis(attemptNow);
    const nextWindowStartMs = inWindow ? stored.windowStartMs : attemptNow;

    tx.set(ref, {
      scope,
      key,
      count: nextCount,
      windowStart: nextWindowStart,
      windowMs,
      expiresAt: Timestamp.fromMillis(
        nextWindowStartMs + windowMs + 60_000,
      ),
      updatedAt: Timestamp.fromMillis(attemptNow),
    });
  });
}

module.exports = { checkRateLimit, extractIp };
