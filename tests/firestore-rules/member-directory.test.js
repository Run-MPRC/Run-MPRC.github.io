/* eslint-env jest */

const {
  clearFirestore, teardown, db, seed, assertFails,
} = require('./setup');

const ACTORS = [
  ['anonymous', undefined],
  ['document owner', { uid: 'u1', role: 'unverified' }],
  ['verified member', { uid: 'member-1', role: 'member', emailVerified: true }],
  ['unverified browser admin', { uid: 'admin-unverified', role: 'admin', emailVerified: false }],
  ['verified browser admin', { uid: 'admin-verified', role: 'admin', emailVerified: true }],
];

const SERVER_ONLY_COLLECTIONS = [
  ['member directory preferences', 'memberDirectoryPreferences'],
  ['member directory photos', 'memberDirectoryPhotos'],
  ['directory audit events', 'auditEvents'],
];

const SAMPLE_RECORD = {
  schemaVersion: 1,
  marker: 'synthetic-directory-boundary-test',
};

beforeEach(clearFirestore);
afterAll(teardown);

describe.each(ACTORS)('member directory server-only boundary — %s', (_actorLabel, auth) => {
  test.each(SERVER_ONLY_COLLECTIONS)(
    'CANNOT get, list, create, update, delete, or collection-group-query %s',
    async (_collectionLabel, collectionName) => {
      const existingPath = `${collectionName}/u1`;
      const newPath = `${collectionName}/new-record`;
      await seed(existingPath, SAMPLE_RECORD);
      const client = await db(auth);

      await assertFails(client.doc(existingPath).get());
      await assertFails(client.collection(collectionName).get());
      await assertFails(client.doc(newPath).set(SAMPLE_RECORD));
      await assertFails(client.doc(existingPath).update({ marker: 'changed' }));
      await assertFails(client.doc(existingPath).delete());
      await assertFails(client.collectionGroup(collectionName).get());
    },
  );

  test.each(SERVER_ONLY_COLLECTIONS)(
    'CANNOT access nested records below %s',
    async (_collectionLabel, collectionName) => {
      const nestedCollection = 'privateDirectoryRecords';
      const existingPath = `${collectionName}/u1/${nestedCollection}/existing`;
      const newPath = `${collectionName}/u1/${nestedCollection}/new-record`;
      await seed(existingPath, SAMPLE_RECORD);
      const client = await db(auth);

      await assertFails(client.doc(existingPath).get());
      await assertFails(
        client.collection(`${collectionName}/u1/${nestedCollection}`).get(),
      );
      await assertFails(client.doc(newPath).set(SAMPLE_RECORD));
      await assertFails(client.doc(existingPath).update({ marker: 'changed' }));
      await assertFails(client.doc(existingPath).delete());
      await assertFails(client.collectionGroup(nestedCollection).get());
    },
  );
});
