const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { Timestamp } = require('firebase-admin/firestore');

const DEFAULT_ROLE = 'unverified';

/**
 * Creates a new member document in Firestore when a user signs up
 */
async function createMemberDocument(user) {
  const membersRef = admin.firestore().collection('members');

  const memberData = {
    fullName: user.displayName || null,
    email: user.email || '',
    createdAt: Timestamp.now(),
    lastLogin: Timestamp.now(),
    phoneNumber: user.phoneNumber || '',
    role: DEFAULT_ROLE,
    emailVerified: user.emailVerified || false,
    provider: user.providerData?.[0]?.providerId || 'unknown',
  };

  await membersRef.doc(user.uid).set(memberData);

  return memberData;
}

/**
 * Sets the default role claim for a new user
 */
async function setDefaultRoleClaim(uid) {
  await admin.auth().setCustomUserClaims(uid, { role: DEFAULT_ROLE });
}

exports.onSignUp = functions.auth.user().onCreate(async (user) => {
  try {
    const [memberData] = await Promise.all([
      createMemberDocument(user),
      setDefaultRoleClaim(user.uid),
    ]);

    console.log(`Created member for user ${user.uid}:`, {
      email: user.email,
      role: DEFAULT_ROLE,
    });

    return memberData;
  } catch (error) {
    console.error(`Failed to create member for user ${user.uid}:`, error);
    throw new functions.https.HttpsError(
      'internal',
      'Failed to create member record',
    );
  }
});
