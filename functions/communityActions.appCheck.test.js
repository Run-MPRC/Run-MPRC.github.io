const { EventEmitter } = require('node:events');
jest.mock('firebase-admin/app', () => ({ getApp: () => ({ name: 'synthetic' }) }));
jest.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: jest.fn().mockImplementation(async (token) => {
  if (token === 'synthetic-invalid-auth') throw new Error('synthetic denial');
  if (token.startsWith('synthetic-race-')) return { uid: token === 'synthetic-race-other' ? 'stage_race_other' : 'stage_race_native',
    email_verified: token !== 'synthetic-race-unverified', auth_time: Math.floor(Date.now() / 1000),
    firebase: { sign_in_provider: token === 'synthetic-race-custom' ? 'custom' : 'password',
      ...(token === 'synthetic-race-tenant' ? { tenant: 'other' } : {}) } };
  return { uid: 'synthetic-uid', email_verified: token !== 'synthetic-unverified-auth' };
}) }) }));
jest.mock('firebase-admin/app-check', () => ({ getAppCheck: () => ({ verifyToken: jest.fn().mockImplementation(async (token) => {
  if (token !== 'synthetic-valid-app-token') throw new Error('synthetic denial');
  return { appId: 'synthetic-app' };
}) }) }));
jest.mock('firebase-admin', () => ({ firestore: jest.fn(), app: jest.fn() }));
jest.mock('firebase-functions/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
const admin = require('firebase-admin');
const { communityActions } = require('./communityActions');
async function request(headers = {}, data = { action: 'status', accountUid: 'synthetic-uid' }) {
  const requestHeaders = { 'content-type': 'application/json', ...headers };
  const req = { method: 'POST', body: { data }, headers: requestHeaders, header: (key) => requestHeaders[key.toLowerCase()] };
  const res = new EventEmitter(); const values = new Map();
  res.setHeader = (key, value) => values.set(key.toLowerCase(), value);
  res.getHeader = (key) => values.get(key.toLowerCase());
  res.status = (code) => { res.statusCode = code; return res; };
  res.send = (body) => { res.body = body; res.emit('finish'); return res; };
  await communityActions(req, res); return { status: res.statusCode, body: res.body };
}
test.each([undefined, 'synthetic-invalid-app-token'])('native App Check rejects %s before business work', async (token) => {
  const headers = { authorization: 'Bearer synthetic-auth-token' };
  if (token) headers['x-firebase-appcheck'] = token;
  expect((await request(headers)).status).toBe(401);
  expect(admin.firestore).not.toHaveBeenCalled();
});
describe('native authenticated boundary and context binding', () => {
  const keys = ['GCLOUD_PROJECT', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'];
  const saved = {};
  beforeAll(() => {
    keys.forEach((key) => { saved[key] = process.env[key]; });
    process.env.GCLOUD_PROJECT = 'demo-community-native-test';
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  });
  afterAll(() => keys.forEach((key) => {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }));
  beforeEach(() => jest.clearAllMocks());
  const app = { 'x-firebase-appcheck': 'synthetic-valid-app-token' };
  test.each([undefined, 'synthetic-invalid-auth'])('valid App Check does not replace valid Auth %s', async (token) => {
    const headers = { ...app };
    if (token) headers.authorization = `Bearer ${token}`;
    expect((await request(headers)).status).toBe(401);
    expect(admin.firestore).not.toHaveBeenCalled();
  });
  test('a caller cannot select another account or use a context from before switching accounts', async () => {
    expect((await request({ ...app, authorization: 'Bearer synthetic-auth' }, { action: 'status', accountUid: 'other-uid' })).status).toBe(403);
    expect(admin.firestore).not.toHaveBeenCalled();
  });
  test('unverified Auth cannot mutate membership', async () => {
    expect((await request({ ...app, authorization: 'Bearer synthetic-unverified-auth' }, {
      action: 'membership_join', accountUid: 'synthetic-uid', expectedRevision: 0, requestId: '123e4567-e89b-42d3-a456-426614174000',
    })).status).toBe(403);
    expect(admin.firestore).not.toHaveBeenCalled();
  });
  test('native verified single-factor token cannot enter officer business work', async () => {
    expect((await request({ ...app, authorization: 'Bearer synthetic-auth' }, { action: 'admin_status', accountUid: 'synthetic-uid' })).status).toBe(403);
    expect(admin.firestore).not.toHaveBeenCalled();
  });
  const dues = { action: 'admin_dues_record', accountUid: 'synthetic-uid', requestId: '123e4567-e89b-42d3-a456-426614174000', expectedRevision: 0, reason: 'synthetic_staging_review', confirmationId: '123e4567-e89b-42d3-a456-426614174001', externalConfirmed: true, policyRevision: 1 };
  test('dues native boundary requires App Check, bound UID and recent MFA before business work', async () => {
    expect((await request({ authorization: 'Bearer synthetic-auth' }, dues)).status).toBe(401);
    expect((await request({ ...app, authorization: 'Bearer synthetic-auth' }, { ...dues, accountUid: 'other' })).status).toBe(403);
    expect((await request({ ...app, authorization: 'Bearer synthetic-auth' }, dues)).status).toBe(403);
    expect((await request({ ...app, authorization: 'Bearer synthetic-unverified-auth' }, dues)).status).toBe(403);
    expect(admin.firestore).not.toHaveBeenCalled();
  });
  test('linking native boundary cannot be authorized by fields, another UID or single-factor/unverified Auth', async () => {
    const link = { action: 'admin_dues_link', accountUid: 'synthetic-uid', requestId: '123e4567-e89b-42d3-a456-426614174000', expectedRevision: 1, reason: 'synthetic_staging_review', membershipId: `stage_dues_${'a'.repeat(64)}`, targetUid: 'disposable-target', associationConfirmed: true };
    expect((await request({ authorization: 'Bearer synthetic-auth' }, link)).status).toBe(401);
    expect((await request({ ...app, authorization: 'Bearer synthetic-auth' }, { ...link, accountUid: 'other' })).status).toBe(403);
    expect((await request({ ...app, authorization: 'Bearer synthetic-auth' }, link)).status).toBe(403);
    expect((await request({ ...app, authorization: 'Bearer synthetic-unverified-auth' }, link)).status).toBe(403);
    expect((await request({ ...app, authorization: 'Bearer synthetic-auth' }, { ...link, role: 'admin' })).status).toBe(400);
    expect(admin.firestore).not.toHaveBeenCalled();
  });
  test('fictional race native HTTP wrapper verifies mocked Auth/App Check and binds platform UID before SDK work', async () => {
    // SDK verifier doubles prove wrapper wiring only, not genuine hosted tokens.
    const data = { action: 'race_status', accountUid: 'stage_race_native', incomingEntryId: null };
    const authenticated = { authorization: 'Bearer synthetic-race-password' };
    expect((await request(authenticated, data)).status).toBe(401);
    expect((await request({ ...authenticated, 'x-firebase-appcheck': 'synthetic-invalid-app-token' }, data)).status).toBe(401);
    expect((await request(app, data)).status).toBe(401);
    for (const token of ['synthetic-invalid-auth', 'synthetic-race-other', 'synthetic-race-unverified', 'synthetic-race-custom', 'synthetic-race-tenant']) {
      expect((await request({ ...app, authorization: `Bearer ${token}` }, data)).status).toBe(token === 'synthetic-invalid-auth' ? 401 : 403);
    }
    expect((await request({ ...app, ...authenticated }, { ...data, accountUid: 'stage_race_other' })).status).toBe(403);
    expect((await request({ ...app, ...authenticated }, { ...data, role: 'admin' })).status).toBe(400);
    expect(admin.app).not.toHaveBeenCalled(); expect(admin.firestore).not.toHaveBeenCalled();
  });
  test('qualified native HTTP context enters bounded status with live authority and no write', async () => {
    const { memoryDb } = require('./testSupport/communityMemoryDb');
    const f = require('./testSupport/fictionalRaceFixtures');
    const { POLICY } = require('./fictionalRaceTransitions');
    const { db, docs } = memoryDb(); const uid = 'stage_race_native'; const now = Date.now();
    docs.set('communityConfig/fictionalRaces', { schemaVersion: 1, simulationOnly: true, policyVersion: POLICY, eventIds: [] });
    docs.set(`communityRaceTargets/${uid}`, f.marker(uid, now)); docs.set(`communityRacePermissions/${uid}`, f.permission(uid, now));
    const metadata = { getUser: jest.fn(async target => ({ uid: target, emailVerified: true, disabled: false })) };
    admin.app.mockReturnValue({ options: { projectId: process.env.GCLOUD_PROJECT }, firestore: () => db, auth: () => metadata });
    const before = JSON.stringify([...docs]);
    const response = await request({ ...app, authorization: 'Bearer synthetic-race-password' }, { action: 'race_status', accountUid: uid, incomingEntryId: null });
    expect(response.status).toBe(200); expect(response.body.result).toMatchObject({ simulationOnly: true, events: [], incoming: null });
    expect(metadata.getUser.mock.calls).toEqual([[uid]]); expect(JSON.stringify([...docs])).toBe(before);
    docs.get(`communityRacePermissions/${uid}`).enabled = false;
    expect((await request({ ...app, authorization: 'Bearer synthetic-race-password' }, { action: 'race_status', accountUid: uid, incomingEntryId: null })).status).toBe(403);
  });
});
