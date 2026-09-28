'use strict';

const { assertSafeTestEnvironment } = require('../testSafety');

const PROJECT = 'demo-runner-http-test';
const HOSTS = Object.freeze({
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9919',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:9819',
});

function assertRunnerEmulators(environment, { runtime = false } = {}) {
  try {
    const checked = { ...environment };
    // Functions CLI adds an Eventarc URL even for HTTP-only exports. This
    // harness never uses it. Accept only our exact loopback value, then remove
    // it before applying the existing stricter host:port-only network guard.
    if (checked.CLOUD_EVENTARC_EMULATOR_HOST !== undefined) {
      if (checked.CLOUD_EVENTARC_EMULATOR_HOST !== 'http://127.0.0.1:9319') throw new Error();
      delete checked.CLOUD_EVENTARC_EMULATOR_HOST;
    }
    assertSafeTestEnvironment(checked);
    if (environment.GCLOUD_PROJECT !== PROJECT
      || Object.entries(HOSTS).some(([key, value]) => environment[key] !== value)
      || (runtime && environment.FUNCTIONS_EMULATOR !== 'true')) throw new Error();
  } catch {
    throw new Error('Runner HTTP tests require the exact isolated demo emulators.');
  }
}

function prepareRunnerEmulators(environment, options) {
  assertRunnerEmulators(environment, options);
  delete environment.CLOUD_EVENTARC_EMULATOR_HOST;
}

module.exports = { PROJECT, HOSTS, assertRunnerEmulators, prepareRunnerEmulators };
