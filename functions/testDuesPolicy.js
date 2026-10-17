'use strict';
const { createHash } = require('node:crypto');
const { parseStrictObject } = require('./requestValidation');
const fail = (code = 'failed-precondition') => { const e = new Error('Test dues are unavailable. Refresh status or ask the test owner.'); e.code = code; throw e; };
const check = (ok, code) => { if (!ok) fail(code); };
const UID = /^[A-Za-z0-9_-]{1,80}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const WAIVER = Object.freeze({ version: 'synthetic-dues-v1', text: 'SYNTHETIC TEST ONLY. I understand this checkout uses fictional membership and test payment information. This is not an approved club waiver.' });
const RETURN_URL = 'https://run-mprc-staging.web.app/community/dues';
function assertTestDuesEnvironment(env = process.env) {
  const local = /^demo-[a-z0-9-]+$/.test(env.GCLOUD_PROJECT || '')
    && ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FUNCTIONS_EMULATOR_HOST'].every(k => /^127\.0\.0\.1:\d+$/.test(env[k] || ''));
  check((env.GCLOUD_PROJECT === 'run-mprc-staging' || local)
    && env.COMMERCE_ENABLED === 'false' && env.MPRC_TEST_DUES_ENABLED === 'true');
}
function parseDuesRequest(input) {
  try {
    const r = parseStrictObject(input, { requiredKeys: ['action', 'accountUid'], optionalKeys: ['requestId', 'offerId', 'waiverVersion', 'waiverAccepted'] });
    check(UID.test(r.accountUid) && typeof r.accountUid === 'string', 'invalid-argument');
    const keys = r.action === 'prepare' ? ['action', 'accountUid', 'requestId', 'offerId', 'waiverVersion', 'waiverAccepted'] : ['action', 'accountUid'];
    check(['status', 'prepare', 'resume', 'reconcile'].includes(r.action), 'invalid-argument');
    parseStrictObject(r, { requiredKeys: keys });
    if (r.action === 'prepare') check(typeof r.requestId === 'string' && UUID.test(r.requestId)
      && typeof r.offerId === 'string' && /^dues-\d{4}-(individual|family)-v1$/.test(r.offerId)
      && r.waiverAccepted === true && r.waiverVersion === WAIVER.version, 'invalid-argument');
    return r;
  } catch { fail('invalid-argument'); }
}
// Find local Jan 1 midnight from the timezone itself rather than assuming an offset.
function yearStart(year) {
  let instant = Date.UTC(year, 0, 1);
  for (let n = 0; n < 3; n++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(instant).map(p => [p.type, p.value]));
    const represented = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    instant += Date.UTC(year, 0, 1) - represented;
  }
  return instant;
}
function offers(now) {
  check(Number.isSafeInteger(now) && now >= Date.UTC(2020, 0, 1) && now < Date.UTC(2100, 0, 1));
  const year = +new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'America/Los_Angeles' }).format(now);
  return ['individual', 'family'].map(kind => ({ membershipDuesCheckoutSchemaVersion: 1,
    planRef: `dues-${year}-${kind}-v1`, policyVersion: 'test-dues-calendar-v1', termId: `calendar-${year}`,
    amountMinor: kind === 'individual' ? 2500 : 3000, currency: 'usd', startsAtMs: yearStart(year), endsAtMs: yearStart(year + 1),
    offerable: yearStart(year + 1) - now >= 31 * 60_000,
  }));
}
module.exports = { fail, check, hash, UID, WAIVER, RETURN_URL, offers, yearStart, assertTestDuesEnvironment, parseDuesRequest };
