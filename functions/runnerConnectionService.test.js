'use strict';

jest.mock('firebase-functions', () => {
  const sdk = jest.requireActual('firebase-functions');
  // Observe configuration while retaining the installed SDK's real builder,
  // callable wrapper and deployment metadata (the export is a readonly getter).
  return { ...sdk, runWith: jest.fn((options) => sdk.runWith(options)) };
});

const fs = require('node:fs');
const path = require('node:path');
const functions = require('firebase-functions');
const { createRunnerConnectionCallables, RUNTIME, accountRateKey } = require('./runnerConnectionService');
const { readRunnerProfileRequest } = require('./runnerConnectionProfiles');
const { profile } = require('./testSupport/runnerConnectionsFixtures');

test('native callable builder requires App Check and bounded resources for every operation', () => {
  functions.runWith.mockClear();
  const callables = createRunnerConnectionCallables();
  expect(Object.keys(callables)).toHaveLength(3);
  expect(functions.runWith).toHaveBeenCalledTimes(3);
  for (const [options] of functions.runWith.mock.calls) expect(options).toEqual(RUNTIME);
  expect(RUNTIME.enforceAppCheck).toBe(true);
  for (const callable of Object.values(callables)) {
    expect(callable.__endpoint).toMatchObject({ platform: 'gcfv1', minInstances: 0, maxInstances: 2, availableMemoryMb: 256, timeoutSeconds: 30 });
    expect(callable.__endpoint.callableTrigger).toBeDefined();
  }
});

test.each([undefined, false, 'true', 1])('the source gate %p grants no service work', async (enabled) => {
  const rateLimit = jest.fn();
  const db = { runTransaction: jest.fn() };
  const auth = { getUser: jest.fn() };
  const callables = createRunnerConnectionCallables({ enabled, db, auth, rateLimit });
  for (const callable of Object.values(callables)) {
    await expect(callable.run({}, { rawRequest: { res: { setHeader: jest.fn() } } })).rejects.toMatchObject({ code: 'failed-precondition' });
  }
  expect(rateLimit).not.toHaveBeenCalled();
  expect(db.runTransaction).not.toHaveBeenCalled();
  expect(auth.getUser).not.toHaveBeenCalled();
});

test('wire request snapshot cannot change while asynchronous authorization is in progress', () => {
  const input = {
    requestId: '00000000-0000-4000-8000-000000000001', expectedRevision: 0,
    profile: profile(), consent: { memberDiscovery: true, similarity: true, broadenCircle: false },
    consentVersion: 1, adultConfirmed: true,
  };
  const request = readRunnerProfileRequest(input, 'save');
  input.profile.displayName = 'Changed Synthetic Name';
  input.consent.memberDiscovery = false;
  expect(request.profile.displayName).toBe('Synthetic Runner');
  expect(request.consent.memberDiscovery).toBe(true);
  expect(Object.isFrozen(request)).toBe(true);
  expect(() => readRunnerProfileRequest(input, 'unknown')).toThrow('Runner connection request is invalid.');
});

test('factory is not imported or exported by the deployment index; no runtime widening', () => {
  expect(fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')).not.toMatch(/runnerConnection/);
  expect(accountRateKey('synthetic-a')).toMatch(/^[0-9a-f]{64}$/);
  expect(accountRateKey('synthetic-a')).not.toBe(accountRateKey('synthetic-b'));
});
