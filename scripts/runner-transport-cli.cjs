'use strict';

// Test-only CLI adapter: disable discovery/export of actual Google credentials.
// An empty CLI config alone is insufficient: Google Auth also checks the OS
// home directory. This replaces no service auth, runtime, or enforcement code.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const expectedArgs = [
  'emulators:exec', '--non-interactive', '--project', 'demo-runner-http-test',
  '--config', 'runner-transport.firebase.json', '--only', 'auth,firestore,functions',
  'node --test tests/runner-transport.test.cjs',
];
if (process.env.GCLOUD_PROJECT !== 'demo-runner-http-test'
  || process.env.REQUIRE_RUNNER_HTTP_EMULATOR !== '1'
  || !process.env.XDG_CONFIG_HOME
  || path.dirname(process.env.XDG_CONFIG_HOME) !== fs.realpathSync(os.tmpdir())
  || !path.basename(process.env.XDG_CONFIG_HOME).startsWith('mprc-runner-http-config-')
  || fs.readdirSync(process.env.XDG_CONFIG_HOME).length !== 0
  || JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expectedArgs)) {
  throw new Error('Runner transport CLI requires a new disposable configuration.');
}
const credentials = require('firebase-tools/lib/defaultCredentials');
credentials.hasDefaultCredentials = async () => false;
credentials.getCredentialPathAsync = async () => {
  throw new Error('Cloud credentials are forbidden in runner transport tests.');
};
require('firebase-tools/lib/bin/firebase');
