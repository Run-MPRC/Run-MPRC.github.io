const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { Timestamp } = require('firebase-admin/firestore');

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
  const now = Date.now();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const windowStartMs = data?.windowStart?.toMillis?.() ?? 0;
    const inWindow = data && (now - windowStartMs) < windowMs;
    const nextCount = inWindow ? (data.count || 0) + 1 : 1;
    const nextWindowStart = inWindow ? data.windowStart : Timestamp.fromMillis(now);

    if (inWindow && nextCount > limit) {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        'Too many requests. Please wait a few minutes and try again.',
      );
    }

    tx.set(ref, {
      scope,
      key,
      count: nextCount,
      windowStart: nextWindowStart,
      windowMs,
      expiresAt: Timestamp.fromMillis(
        (inWindow ? windowStartMs : now) + windowMs + 60_000,
      ),
      updatedAt: Timestamp.fromMillis(now),
    });
  });
}

module.exports = { checkRateLimit, extractIp };
