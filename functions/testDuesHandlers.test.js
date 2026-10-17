'use strict';
const { createTestDuesHandlers } = require('./testDuesHandlers');
const env = { GCLOUD_PROJECT: 'run-mprc-staging', COMMERCE_ENABLED: 'false', MPRC_TEST_DUES_ENABLED: 'true' };
const context = { app: { appId: 'native' }, auth: { uid: 'fictional', token: { email_verified: true, auth_time: 1000, firebase: {} } } };
const request = { action: 'status', accountUid: 'fictional' };
let service; let provider; let handlers;
beforeEach(() => { service = { status: jest.fn(async () => 'safe'), webhook: jest.fn() }; provider = { verify: jest.fn() }; handlers = createTestDuesHandlers({ service, provider, env, clock: () => 1000000 }); });
test('native context accepted', async () => { expect(await handlers.callable(request, context)).toBe('safe'); });
test.each([{}, { app: context.app }, { ...context, app: undefined }, { ...context, auth: { uid: 'foreign', token: context.auth.token } },
  { ...context, auth: { ...context.auth, token: { ...context.auth.token, email_verified: false } } },
  { ...context, auth: { ...context.auth, token: { ...context.auth.token, firebase: { tenant: 'foreign' } } } },
  { ...context, auth: { ...context.auth, token: { ...context.auth.token, auth_time: 1001 } } }])('missing/foreign/stale identity rejected %j', async c => {
  await expect(handlers.callable(request, c)).rejects.toThrow(); expect(service.status).not.toHaveBeenCalled();
});
test('no raw provider exception escapes', async () => { service.status.mockRejectedValue(new Error('SENSITIVE')); await expect(handlers.callable(request, context)).rejects.toThrow('Test dues are unavailable'); });
test('invalid signature never writes; webhook failure responds retryable fixed503', async () => {
  const res = { status: jest.fn().mockReturnThis(), send: jest.fn() }; const req = { method: 'POST', rawBody: Buffer.from('{}'), get: () => 'signature' };
  provider.verify.mockImplementationOnce(() => { const e = new Error('raw'); e.code = 'invalid-argument'; throw e; });
  await handlers.webhook(req, res); expect(res.status).toHaveBeenLastCalledWith(400); expect(service.webhook).not.toHaveBeenCalled();
  service.webhook.mockRejectedValue(new Error('raw')); await handlers.webhook(req, res); expect(res.status).toHaveBeenLastCalledWith(503); expect(res.send).toHaveBeenLastCalledWith('unavailable');
});
