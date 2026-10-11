jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn(() => jest.fn(async () => ({ data: { synthetic: true } }))) }));
export {};

const saved = {
  environment: process.env.REACT_APP_FIREBASE_ENVIRONMENT,
  flag: process.env.REACT_APP_COMMUNITY_STAGING,
};
afterAll(() => {
  if (saved.environment === undefined) delete process.env.REACT_APP_FIREBASE_ENVIRONMENT;
  else process.env.REACT_APP_FIREBASE_ENVIRONMENT = saved.environment;
  if (saved.flag === undefined) delete process.env.REACT_APP_COMMUNITY_STAGING;
  else process.env.REACT_APP_COMMUNITY_STAGING = saved.flag;
});
test.each([['production', 'true'], ['staging', 'false'], ['staging', undefined]])('disabled environment %s / flag %s makes no call', async (environment, flag) => {
  process.env.REACT_APP_FIREBASE_ENVIRONMENT = environment;
  if (flag === undefined) delete process.env.REACT_APP_COMMUNITY_STAGING;
  else process.env.REACT_APP_COMMUNITY_STAGING = flag;
  jest.resetModules();
  const { COMMUNITY_ENABLED, callCommunity } = await import('./communityService');
  expect(COMMUNITY_ENABLED).toBe(false);
  await expect(callCommunity({ app: { options: { projectId: 'run-mprc-staging' } } } as any, { action: 'status', accountUid: 'synthetic' })).rejects.toThrow();
},);
test('a staging flag cannot admit a production Firebase project', async () => {
  process.env.REACT_APP_FIREBASE_ENVIRONMENT = 'staging'; process.env.REACT_APP_COMMUNITY_STAGING = 'true';
  jest.resetModules(); const { callCommunity } = await import('./communityService');
  await expect(callCommunity({ app: { options: { projectId: 'mid-peninsula-running-club' } } } as any, { action: 'status', accountUid: 'synthetic' })).rejects.toThrow();
});
