'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '../../..');
const starter = fs.readFileSync(path.join(root, 'scripts/run-runner-transport-tests.cjs'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'scripts/runner-transport-cli.cjs'), 'utf8');
const config = '/tmp/mprc-runner-http-config-synthetic';
const args = [
  'emulators:exec', '--non-interactive', '--project', 'demo-runner-http-test',
  '--config', 'runner-transport.firebase.json', '--only', 'auth,firestore,functions',
  'node --test tests/runner-transport.test.cjs',
];

function start(extraArgs = []) {
  const child = Object.assign(new EventEmitter(), { kill: jest.fn() });
  const spawn = jest.fn(() => child);
  const rmSync = jest.fn();
  const output = jest.fn();
  const process = Object.assign(new EventEmitter(), {
    execPath: '/synthetic/node20/bin/node',
    argv: ['node', 'script', ...extraArgs],
    env: {
      PATH: '/usr/bin', JAVA_HOME: '/synthetic/java21', TMPDIR: '/tmp',
      HOME: '/synthetic/user', GOOGLE_APPLICATION_CREDENTIALS: '/synthetic/forbidden',
      FIREBASE_TOKEN: 'synthetic-forbidden', STRIPE_SECRET: 'synthetic-forbidden',
      NODE_OPTIONS: '--require synthetic-forbidden', GCLOUD_PROJECT: 'synthetic-forbidden',
      XDG_CONFIG_HOME: '/synthetic/forbidden',
      RUNNER_HTTP_BROWSER: '1',
    },
  });
  vm.runInNewContext(starter, {
    __dirname: path.join(root, 'scripts'), process, console: { error: output },
    require: (name) => {
      if (name === 'node:fs') return { mkdtempSync: () => config, realpathSync: () => '/tmp', rmSync };
      if (name === 'node:os') return { tmpdir: () => '/tmp' };
      if (name === 'node:path') return path;
      if (name === 'node:child_process') return { spawn };
      throw new Error('Unexpected launcher dependency.');
    },
  });
  return { child, spawn, process, rmSync, output };
}
test('launcher uses fixed demo command and does not inherit credentials or cloud authority', () => {
  const run = start();
  const [node, command, options] = run.spawn.mock.calls[0];
  expect(node).toBe('/synthetic/node20/bin/node');
  expect(command.slice(1)).toEqual(args);
  expect(command[0]).toBe(path.join(root, 'scripts/runner-transport-cli.cjs'));
  expect(options.env).toEqual({
    PATH: '/synthetic/node20/bin:/usr/bin', JAVA_HOME: '/synthetic/java21', TMPDIR: '/tmp',
    CI: 'true', GCLOUD_PROJECT: 'demo-runner-http-test', REQUIRE_RUNNER_HTTP_EMULATOR: '1',
    XDG_CONFIG_HOME: config,
  });
  run.child.emit('exit', 0);
  expect(run.rmSync).toHaveBeenCalledWith(config, { recursive: true, force: true });
  expect(run.process.exitCode).toBe(0);
});
test('launcher propagates failure, forwards interruption and hides caught diagnostics', () => {
  const run = start();
  run.process.emit('SIGINT');
  expect(run.child.kill).toHaveBeenCalledWith('SIGINT');
  run.child.emit('error', new Error('synthetic-private-diagnostic'));
  run.child.emit('exit', 1);
  expect(run.output).toHaveBeenCalledWith('runner_transport_launch_failed');
  expect(run.output).toHaveBeenCalledTimes(1);
  expect(run.process.exitCode).toBe(1);
  expect(run.rmSync).toHaveBeenCalledTimes(1);
});
test('browser rehearsal is one closed alternative, not an arbitrary emulator command', () => {
  const run = start(['--browser']);
  const [, command, options] = run.spawn.mock.calls[0];
  expect(command.slice(1, -1)).toEqual(args.slice(0, -1));
  expect(command.at(-1)).toBe('node tests/runner-browser/server.cjs');
  expect(options.env.RUNNER_HTTP_BROWSER).toBe('1');
  expect(() => start(['deploy'])).toThrow('only the optional --browser');
  expect(() => start(['--browser', '--project', 'production'])).toThrow('only the optional --browser');
});
function adapt({ extraArgs = args, entries = [], environment = {} } = {}) {
  const credentials = { hasDefaultCredentials: jest.fn(), getCredentialPathAsync: jest.fn() };
  const cli = jest.fn();
  vm.runInNewContext(adapter, {
    process: {
      argv: ['node', 'script', ...extraArgs],
      env: { GCLOUD_PROJECT: 'demo-runner-http-test', REQUIRE_RUNNER_HTTP_EMULATOR: '1', XDG_CONFIG_HOME: config, ...environment },
    },
    require: (name) => {
      if (name === 'node:fs') return { realpathSync: () => '/tmp', readdirSync: () => entries };
      if (name === 'node:os') return { tmpdir: () => '/tmp' };
      if (name === 'node:path') return path;
      if (name === 'firebase-tools/lib/defaultCredentials') return credentials;
      if (name === 'firebase-tools/lib/bin/firebase') return cli();
      throw new Error('Unexpected adapter dependency.');
    },
  });
  return { credentials, cli };
}
test('CLI adapter removes credential discovery/export before loading the actual CLI', async () => {
  const { credentials, cli } = adapt();
  expect(cli).toHaveBeenCalledTimes(1);
  await expect(credentials.hasDefaultCredentials()).resolves.toBe(false);
  await expect(credentials.getCredentialPathAsync()).rejects.toThrow('Cloud credentials are forbidden');
});
test('CLI adapter binds browser opt-in to the exact local rehearsal command', () => {
  const browserArgs = [...args.slice(0, -1), 'node tests/runner-browser/server.cjs'];
  expect(adapt({ extraArgs: browserArgs, environment: { RUNNER_HTTP_BROWSER: '1' } }).cli).toHaveBeenCalledTimes(1);
  expect(() => adapt({ extraArgs: browserArgs })).toThrow('new disposable configuration');
  expect(() => adapt({ environment: { RUNNER_HTTP_BROWSER: '1' } })).toThrow('new disposable configuration');
  expect(() => adapt({ environment: { RUNNER_HTTP_BROWSER: 'true' } })).toThrow('new disposable configuration');
});
test.each([
  { extraArgs: ['deploy'] },
  { extraArgs: args.map((arg) => arg === 'demo-runner-http-test' ? 'run-mprc-staging' : arg) },
  { entries: ['configstore'] },
  { environment: { XDG_CONFIG_HOME: '/synthetic/user' } },
  { environment: { REQUIRE_RUNNER_HTTP_EMULATOR: '0' } },
])('CLI adapter rejects widened command or existing config %#', (input) => {
  expect(() => adapt(input)).toThrow('Runner transport CLI requires a new disposable configuration.');
});
