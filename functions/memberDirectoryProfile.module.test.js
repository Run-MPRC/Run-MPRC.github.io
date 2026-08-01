'use strict';

jest.mock('sharp', () => {
  throw new Error('synthetic native image module unavailable');
});

jest.mock('firebase-functions', () => {
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  return {
    https: { HttpsError },
    runWith: jest.fn(() => ({
      https: { onCall: jest.fn((handler) => handler) },
    })),
  };
});

jest.mock('./stripeHelpers', () => ({ requireAppCheck: jest.fn() }));
jest.mock('./rateLimit', () => ({ checkRateLimit: jest.fn() }));

test('loads non-photo profile exports without loading the native image processor', () => {
  let profileModule;

  expect(() => {
    profileModule = require('./memberDirectoryProfile');
  }).not.toThrow();

  expect(profileModule.getMyMemberDirectoryProfile).toEqual(expect.any(Function));
  expect(profileModule.setMyMemberDirectoryVisibility).toEqual(expect.any(Function));
  expect(profileModule.removeMyMemberDirectoryPhoto).toEqual(expect.any(Function));
});
