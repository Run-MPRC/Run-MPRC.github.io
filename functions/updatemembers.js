const functions = require('firebase-functions');
const admin = require('firebase-admin');

const VALID_ROLES = ['member', 'admin', 'unverified'];
const MAX_EMAILS_PER_REQUEST = 100;

/**
 * Validates an email address format
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return typeof email === 'string' && emailRegex.test(email);
}

/**
 * Updates a single member's role
 */
async function updateSingleMemberRole(email, role) {
  const userRecord = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(userRecord.uid, { role });

  const membersRef = admin.firestore().collection('members');
  const snapshot = await membersRef
    .where('email', '==', email)
    .limit(1)
    .get();

  const updates = snapshot.docs.map((doc) => doc.ref.update({
    role,
    updatedAt: admin.firestore.Timestamp.now(),
  }));

  await Promise.all(updates);

  return { email, success: true };
}

exports.updateMemberRole = functions.https.onRequest(
  async (request, response) => {
    // Only allow POST requests
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Validate API key from Firebase config
    const configApiKey = functions.config().api?.key;
    const requestApiKey = request.get('X-API-Key') || request.query.apiKey;

    if (!configApiKey) {
      console.error('API key not configured. Set with: firebase functions:config:set api.key="your-key"');
      response.status(500).json({ error: 'Server configuration error' });
      return;
    }

    if (requestApiKey !== configApiKey) {
      response.status(403).json({ error: 'Invalid API key' });
      return;
    }

    // Validate request body
    const { emails, role = 'member' } = request.body;

    if (!emails || !Array.isArray(emails)) {
      response.status(400).json({ error: 'Invalid request: emails array required' });
      return;
    }

    if (emails.length === 0) {
      response.status(400).json({ error: 'Invalid request: emails array is empty' });
      return;
    }

    if (emails.length > MAX_EMAILS_PER_REQUEST) {
      response.status(400).json({
        error: `Too many emails. Maximum ${MAX_EMAILS_PER_REQUEST} per request`,
      });
      return;
    }

    if (!VALID_ROLES.includes(role)) {
      response.status(400).json({
        error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`,
      });
      return;
    }

    // Validate all emails
    const invalidEmails = emails.filter((email) => !isValidEmail(email));
    if (invalidEmails.length > 0) {
      response.status(400).json({
        error: 'Invalid email format',
        invalidEmails,
      });
      return;
    }

    try {
      const results = await Promise.allSettled(
        emails.map((email) => updateSingleMemberRole(email, role)),
      );

      const succeeded = [];
      const failed = [];

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          succeeded.push(emails[index]);
        } else {
          failed.push({
            email: emails[index],
            error: result.reason?.message || 'Unknown error',
          });
        }
      });

      const statusCode = failed.length === emails.length ? 500 : 200;

      response.status(statusCode).json({
        message: `Processed ${emails.length} email(s)`,
        succeeded,
        failed,
        role,
      });
    } catch (error) {
      console.error('Error updating members:', error);
      response.status(500).json({ error: 'Internal server error' });
    }
  },
);
