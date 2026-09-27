/* eslint-env jest */

const { clearFirestore, teardown, db, seed, assertFails } = require('./setup');

const actors = [
  ['anonymous', undefined],
  ['owner without member authority', { uid: 'synthetic-runner' }],
  ['verified member owner', { uid: 'synthetic-runner', role: 'member', emailVerified: true }],
  ['another verified member', { uid: 'synthetic-other', role: 'member', emailVerified: true }],
  ['verified browser admin', { uid: 'synthetic-admin', role: 'admin', emailVerified: true }],
];

beforeEach(clearFirestore);
afterAll(teardown);

describe.each(actors)('runner connection profile boundary — %s', (_label, auth) => {
  test.each([
    'runnerConnectionProfiles',
    'runnerConnectionProfiles/synthetic-runner/privateRecords',
    'memberships',
    'memberships/synthetic-runner/privateRecords',
  ])('cannot read, enumerate or mutate %s', async (collectionPath) => {
    const documentPath = `${collectionPath}/synthetic-runner`;
    await seed(documentPath, { marker: 'synthetic-private-card' });
    const client = await db(auth);
    await assertFails(client.doc(documentPath).get());
    await assertFails(client.collection(collectionPath).get());
    await assertFails(client.collectionGroup(collectionPath.split('/').pop()).get());
    await assertFails(client.doc(`${collectionPath}/synthetic-new`).set({ marker: 'synthetic-forged' }));
    await assertFails(client.doc(documentPath).update({ discoverable: true }));
    await assertFails(client.doc(documentPath).delete());
  });
});
