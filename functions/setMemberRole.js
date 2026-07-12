const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { requireAdmin, requireAppCheck } = require('./stripeHelpers');
const {
  assertVerifiedEmailForRole,
  EMAIL_UNVERIFIED_GRANT_CODE,
} = require('./roleGrantPolicy');

const VALID_ROLES = ['admin', 'member', 'unverified'];

exports.setMemberRole = functions.https.onCall(async (data, context) => {
  requireAppCheck(context);
  await requireAdmin(context);

  const { email, role } = data || {};
  if (typeof email !== 'string' || !email.trim()) {
    throw new functions.https.HttpsError('invalid-argument', 'email required');
  }
  if (!VALID_ROLES.includes(role)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `role must be one of: ${VALID_ROLES.join(', ')}`,
    );
  }
  const normalizedEmail = email.trim().toLowerCase();

  let userRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(normalizedEmail);
  } catch {
    throw new functions.https.HttpsError('not-found', 'No auth account for that email');
  }

  // Guard: don't let an admin demote themselves (avoid lockout)
  if (userRecord.uid === context.auth.uid && role !== 'admin') {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'You cannot remove your own admin role',
    );
  }

  try {
    assertVerifiedEmailForRole(userRecord, role);
  } catch (error) {
    if (error.code !== EMAIL_UNVERIFIED_GRANT_CODE) throw error;
    throw new functions.https.HttpsError('failed-precondition', error.message);
  }

  await admin.auth().setCustomUserClaims(userRecord.uid, { role });

  const membersRef = admin.firestore().collection('members');
  const snapshot = await membersRef.where('email', '==', normalizedEmail).limit(1).get();
  const updates = snapshot.docs.map((doc) => doc.ref.update({
    role,
    updatedAt: admin.firestore.Timestamp.now(),
  }));
  await Promise.all(updates);

  return { ok: true, uid: userRecord.uid, role };
});
