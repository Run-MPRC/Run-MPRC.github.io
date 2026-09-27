'use strict';

const { PROJECT, HOSTS, assertRunnerEmulators, prepareRunnerEmulators } = require('./environment');
const safe = () => ({ GCLOUD_PROJECT: PROJECT, ...HOSTS, FUNCTIONS_EMULATOR: 'true' });

test('runner HTTP harness accepts only the exact emulator project and hosts', () => {
  expect(() => assertRunnerEmulators(safe(), { runtime: true })).not.toThrow();
});
test.each([
  { GCLOUD_PROJECT: 'run-mprc-staging' },
  { GCLOUD_PROJECT: 'demo-other-test' },
  { FIRESTORE_EMULATOR_HOST: undefined },
  { FIRESTORE_EMULATOR_HOST: 'remote.example.test:9819' },
  { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
  { FUNCTIONS_EMULATOR: 'false' },
  { FIREBASE_CONFIG: JSON.stringify({ projectId: 'run-mprc-staging' }) },
  { GOOGLE_APPLICATION_CREDENTIALS: 'synthetic-forbidden-path' },
  { CLOUD_EVENTARC_EMULATOR_HOST: 'http://remote.example.test:9319' },
])('runner HTTP harness rejects unsafe environment %#', (override) => {
  expect(() => assertRunnerEmulators({ ...safe(), ...override }, { runtime: true }))
    .toThrow('Runner HTTP tests require the exact isolated demo emulators.');
});
test('only our unused loopback Eventarc URL is removed before the network guard', () => {
  const environment = { ...safe(), CLOUD_EVENTARC_EMULATOR_HOST: 'http://127.0.0.1:9319' };
  prepareRunnerEmulators(environment, { runtime: true });
  expect(environment).toEqual(safe());
});
test('harness SDK declarations resolve from the existing committed Functions installation', () => {
  const harness = require('./package.json');
  const parent = require('../../package.json');
  expect(harness.dependencies).toEqual({
    'firebase-admin': parent.dependencies['firebase-admin'],
    'firebase-functions': parent.dependencies['firebase-functions'],
  });
  const path = require('node:path');
  for (const name of Object.keys(harness.dependencies)) {
    expect(require.resolve(name, { paths: [__dirname] }))
      .toBe(require.resolve(name, { paths: [path.resolve(__dirname, '../..')] }));
  }
});
