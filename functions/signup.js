const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { Timestamp } = require('firebase-admin/firestore');

exports.onSignUp = functions.auth.user().onCreate((user) => {
  const membersRef = admin.firestore().collection('members');

  // Create a member document in Firestore
  const memberCreation = membersRef.doc(user.uid).set({
    fullName: null,
    email: user.email || '',
    createdAt: Timestamp.now(),
    lastLogin: Timestamp.now(),
    phoneNumber: user.phoneNumber || '',
  });

  // Set the custom claim for user's role
  const setCustomClaim = admin
    .auth()
    .setCustomUserClaims(user.uid, { role: 'unverified' });

  // Return a promise to handle both operations
  return Promise.all([memberCreation, setCustomClaim]);
});
