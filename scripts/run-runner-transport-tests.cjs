'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Deliberately do not inherit HOME, cloud credentials, provider keys, project
// selection, NODE_OPTIONS or Firebase CLI login state. Do not change user's
// settings. The CLI receives an empty, disposable config directory.
const root = path.resolve(__dirname, '..');
const configDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mprc-runner-http-config-'));
const environment = {
  PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}`,
  CI: 'true',
  GCLOUD_PROJECT: 'demo-runner-http-test',
  REQUIRE_RUNNER_HTTP_EMULATOR: '1',
  XDG_CONFIG_HOME: configDir,
};
if (process.env.JAVA_HOME) environment.JAVA_HOME = process.env.JAVA_HOME;
for (const key of ['TMPDIR', 'TMP', 'TEMP']) {
  if (process.env[key]) environment[key] = process.env[key];
}
const child = spawn(process.execPath, [
  path.join(root, 'scripts/runner-transport-cli.cjs'),
  'emulators:exec', '--non-interactive', '--project', 'demo-runner-http-test',
  '--config', 'runner-transport.firebase.json', '--only', 'auth,firestore,functions',
  'node --test tests/runner-transport.test.cjs',
], { cwd: root, env: environment, stdio: 'inherit' });
let finished = false;
function cleanup(code) {
  if (finished) return;
  finished = true;
  // Exact directory created by this process; never a user/workspace directory.
  fs.rmSync(configDir, { recursive: true, force: true });
  process.exitCode = code;
}
child.once('error', () => { console.error('runner_transport_launch_failed'); cleanup(1); });
child.once('exit', (code) => cleanup(code === 0 ? 0 : 1));
process.once('SIGINT', () => child.kill('SIGINT'));
process.once('SIGTERM', () => child.kill('SIGTERM'));
