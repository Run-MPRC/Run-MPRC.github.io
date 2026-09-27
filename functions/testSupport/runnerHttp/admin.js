'use strict';

const { generateKeyPairSync } = require('node:crypto');
const admin = require('firebase-admin');
const { PROJECT, assertRunnerEmulators } = require('./environment');

function initializeRunnerAdmin() {
  assertRunnerEmulators(process.env);
  // Admin Firestore requires its concrete certificate credential type. Generate
  // a throwaway key in memory: never discover/read a developer's ADC file and
  // never persist/print this test-only key. The loopback emulators use 'owner'.
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const credential = admin.credential.cert({
    projectId: PROJECT,
    clientEmail: `synthetic@${PROJECT}.iam.gserviceaccount.com`,
    privateKey,
  });
  credential.getAccessToken = async () => ({ access_token: 'owner', expires_in: 3600 });
  return admin.initializeApp({ projectId: PROJECT, credential });
}

module.exports = { initializeRunnerAdmin };
