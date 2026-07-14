const admin = require('firebase-admin');
const { Timestamp } = require('firebase-admin/firestore');

const DEFAULT_ROLE = 'unverified';
const FULL_NAME_MAX_CHARACTERS = 200;

function boundedIdentityString(value, maxCharacters, fallback) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxCharacters) return fallback;
  return normalized;
}

function buildPendingMemberProfile(user, now = Timestamp.now()) {
  return {
    fullName: boundedIdentityString(
      user.displayName,
      FULL_NAME_MAX_CHARACTERS,
      null,
    ),
    email: typeof user.email === 'string' ? user.email.trim().toLowerCase() : '',
    createdAt: now,
    lastLogin: now,
    // Keep the existing schema shape without copying optional phone data from
    // Firebase Auth while profile phone collection is paused under #197.
    phoneNumber: '',
    role: DEFAULT_ROLE,
    emailVerified: user.emailVerified === true,
    provider: user.providerData?.[0]?.providerId || 'unknown',
  };
}

function memberProfileRef(uid) {
  return admin.firestore().collection('members').doc(uid);
}

async function memberProfileExists(uid) {
  const existing = await memberProfileRef(uid).get();
  return existing.exists;
}

async function ensureMemberProfileDocument(user) {
  if (!user || typeof user.uid !== 'string' || !user.uid) {
    throw new Error('Authenticated Firebase user is unavailable.');
  }

  const db = admin.firestore();
  const ref = memberProfileRef(user.uid);

  const created = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists) return false;

    // `create` and the preceding transactional read make this safe when the
    // Auth trigger, account page, or a retry all arrive at the same time.
    transaction.create(ref, buildPendingMemberProfile(user));
    return true;
  });

  return { created };
}

module.exports = {
  DEFAULT_ROLE,
  FULL_NAME_MAX_CHARACTERS,
  buildPendingMemberProfile,
  memberProfileExists,
  ensureMemberProfileDocument,
};
