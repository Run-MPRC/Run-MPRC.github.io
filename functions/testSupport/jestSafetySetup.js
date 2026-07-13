const {
  assertSafeTestEnvironment,
  installNetworkGuard,
} = require('./testSafety');

assertSafeTestEnvironment(process.env);
installNetworkGuard();

beforeEach(() => {
  assertSafeTestEnvironment(process.env);
});

afterEach(() => {
  assertSafeTestEnvironment(process.env);
});
