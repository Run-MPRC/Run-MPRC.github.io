/**
 * Jest config scoped to Firestore security-rules tests.
 *
 * Run via:
 *   npm run test:rules            (boots the Firestore emulator first)
 *   npx jest --config ...         (emulator must already be running)
 */
module.exports = {
  rootDir: __dirname,
  testEnvironment: '<rootDir>/node20-environment.js',
  testMatch: ['<rootDir>/**/*.test.js'],
  testTimeout: 15000,
  // Add the remaining web-platform globals that Jest 27's node sandbox does
  // not expose. The custom environment supplies Node 20's native fetch API.
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Tests share a single TestEnvironment (initialized lazily); run sequentially
  // so we don't fight over the same emulator state across worker processes.
  maxWorkers: 1,
};
