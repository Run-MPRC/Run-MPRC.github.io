const functions = require('firebase-functions');
const profileRuntime = require('./profileRuntime');
const { ensureMemberProfileDocument } = require('./memberProfile');

/**
 * Creates a new member document in Firestore when a user signs up
 */
async function createMemberDocument(user) {
  return ensureMemberProfileDocument(user);
}

exports.onSignUp = functions.runWith(profileRuntime).auth.user().onCreate(async (user) => {
  try {
    // Missing claims already fail closed. Only the reviewed role-grant path may
    // change them; a delayed signup trigger must never replace a claim map.
    return await createMemberDocument(user);
  } catch {
    console.error('Member profile setup failed during account creation.');
    throw new functions.https.HttpsError(
      'internal',
      'Failed to create member record',
    );
  }
});
