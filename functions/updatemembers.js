const functions = require('firebase-functions');
const admin = require('firebase-admin');

const YOUR_API_KEY = 'your_secret_api_key';

exports.updateMemberRole = functions.https.onRequest(
  async (request, response) => {
    // Check for API key
    if (request.query.apiKey !== YOUR_API_KEY) {
      response.status(403).send('API key is not correct');
      return;
    }

    // Check if the request body has the 'emails' array
    const { emails } = request.body;
    if (!emails || !Array.isArray(emails)) {
      response.status(400).send('Invalid request: No emails array provided');
      return;
    }

    try {
      // Process each email
      const updates = emails.map(async (email) => {
        try {
          // Get user by email and set custom claim
          const userRecord = await admin.auth().getUserByEmail(email);
          await admin
            .auth()
            .setCustomUserClaims(userRecord.uid, { role: 'member' });

          // Optionally update Firestore document
          const membersRef = admin.firestore().collection('members');
          await membersRef
            .where('email', '==', email)
            .where('role', 'in', ['new', 'unverified'])
            .get()
            .then((snapshot) => {
              const docUpdates = snapshot.docs.map((doc) => doc.ref.update({ role: 'member' }));
              return Promise.all(docUpdates);
            });
        } catch (error) {
          console.error(`Error updating role for email ${email}:`, error);
        }
      });

      // Wait for all updates to complete
      await Promise.all(updates);

      response.send('Updated members successfully');
    } catch (error) {
      console.error('Error updating members:', error);
      response.status(500).send('Error updating members');
    }
  },
);
