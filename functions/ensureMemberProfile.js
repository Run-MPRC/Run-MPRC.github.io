const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { requireAppCheck } = require('./stripeHelpers');
const {
  ensureMemberProfileDocument,
  memberProfileExists,
} = require('./memberProfile');

function isEmptyRequest(data) {
  if (data == null) return true;
  return typeof data === 'object'
    && !Array.isArray(data)
    && Object.keys(data).length === 0;
}

exports.ensureMemberProfile = functions.https.onCall(async (data, context) => {
  requireAppCheck(context);

  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Sign-in required.',
    );
  }
  if (!isEmptyRequest(data)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Profile setup request is invalid.',
    );
  }

  try {
    // A valid existing profile stays usable during a temporary Auth Admin
    // outage. The transaction below still rechecks existence after this read.
    if (await memberProfileExists(context.auth.uid)) return { ready: true };

    // The callable runtime verifies the ID token. Reading the Auth record here
    // also keeps email, phone, provider, and verification state out of caller
    // controlled request data.
    const user = await admin.auth().getUser(context.auth.uid);
    await ensureMemberProfileDocument(user);
    return { ready: true };
  } catch {
    // A concurrent trigger/callable may have created the record while the
    // Auth lookup failed. Recognize that safe final state before failing.
    try {
      if (await memberProfileExists(context.auth.uid)) return { ready: true };
    } catch {
      // Use the same generic error for Auth and Firestore unavailability.
    }
    // Do not return or log Auth/Firestore details, profile data, or identifiers.
    throw new functions.https.HttpsError(
      'unavailable',
      'Profile setup is temporarily unavailable.',
    );
  }
});

exports.isEmptyRequest = isEmptyRequest;
