'use strict';
// Separate, default-disabled entrypoint. Never imported by index.js/communityOnly.js.
// Provider/IAM/secret configuration and deployment require a separate release receipt.
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { assertTestDuesEnvironment } = require('./testDuesPolicy');
const { createTestStripe } = require('./testDuesStripe');
const { createTestDuesService } = require('./testMembershipDues');
const { createTestDuesHandlers } = require('./testDuesHandlers');
let handlers;
function configured() {
  assertTestDuesEnvironment();
  if (!handlers) {
    const provider = createTestStripe({ key: process.env.MPRC_TEST_STRIPE_KEY,
      webhookSecret: process.env.MPRC_TEST_STRIPE_WEBHOOK_SECRET, account: process.env.MPRC_TEST_STRIPE_ACCOUNT });
    let app; try { app = admin.app('test-dues'); } catch { app = admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT }, 'test-dues'); }
    handlers = createTestDuesHandlers({ provider, service: createTestDuesService({ db: app.firestore(), auth: app.auth(), provider, account: process.env.MPRC_TEST_STRIPE_ACCOUNT }) });
  }
  return handlers;
}
const runtime = { minInstances: 0, maxInstances: 2, memory: '256MB', timeoutSeconds: 30,
  secrets: ['MPRC_TEST_STRIPE_KEY', 'MPRC_TEST_STRIPE_WEBHOOK_SECRET'] };
exports.membershipTestDues = functions.runWith({ ...runtime, enforceAppCheck: true }).https.onCall(async (data, context) => {
  try { return await configured().callable(data, context); }
  catch (e) { throw new functions.https.HttpsError(['unauthenticated', 'permission-denied', 'invalid-argument', 'failed-precondition', 'already-exists', 'resource-exhausted'].includes(e?.code) ? e.code : 'unavailable', 'Test dues are unavailable. Refresh status or ask the test owner.'); }
});
exports.membershipTestDuesWebhook = functions.runWith(runtime).https.onRequest(async (req, res) => {
  try { await configured().webhook(req, res); } catch { res.status(503).send('unavailable'); }
});
