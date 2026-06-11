/**
 * Jest config scoped to Firestore security-rules tests.
 *
 * Run via:
 *   npm run test:rules            (boots the Firestore emulator first)
 *   npx jest --config ...         (emulator must already be running)
 */
module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/**/*.test.js'],
  testTimeout: 15000,
  // Polyfill ReadableStream/TextEncoder/etc. that undici (via the firebase
  // SDK) needs at import time but Jest 27's node sandbox doesn't expose.
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Tests share a single TestEnvironment (initialized lazily); run sequentially
  // so we don't fight over the same emulator state across worker processes.
  maxWorkers: 1,
};
