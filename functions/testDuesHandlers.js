'use strict';
const { assertTestDuesEnvironment, parseDuesRequest, check, fail } = require('./testDuesPolicy');
function createTestDuesHandlers({ service, provider, env = process.env, clock = Date.now }) {
  return {
    async callable(data, context) {
      assertTestDuesEnvironment(env);
      check(context.app && typeof context.auth?.uid === 'string', 'unauthenticated');
      const r = parseDuesRequest(data); const token = context.auth.token;
      check(r.accountUid === context.auth.uid && token?.email_verified === true && !token.firebase?.tenant
        && Number.isSafeInteger(token.auth_time) && token.auth_time * 1000 <= clock()
        && clock() - token.auth_time * 1000 <= 24 * 3600000, 'permission-denied');
      try {
        return r.action === 'prepare' ? await service.prepare(context.auth.uid, r) : await service[r.action](context.auth.uid);
      } catch (e) {
        if (['permission-denied', 'failed-precondition', 'already-exists', 'resource-exhausted'].includes(e?.code)) fail(e.code);
        fail('unavailable');
      }
    },
    async webhook(req, res) {
      try {
        assertTestDuesEnvironment(env);
        check(req.method === 'POST', 'invalid-argument');
        const event = provider.verify(req.rawBody, req.get('stripe-signature'));
        await service.webhook(event); res.status(200).send('received');
      } catch (e) { res.status(e?.code === 'invalid-argument' ? 400 : 503).send('unavailable'); }
    },
  };
}
module.exports = { createTestDuesHandlers };
