/* eslint-env jest */

const {
  clearFirestore, teardown, db, seed, assertFails,
} = require('./setup');

// Approval-gated social posts (INSTAGRAM-002) are a server-owned boundary: the
// lifecycle reducer, approval binding, optimistic concurrency, and the appended
// audit row are one server-authoritative operation through a capability-scoped
// callable Function. No browser principal — anonymous, the post's would-be
// author, a verified member, or a browser admin — may read or write the post
// document or its audit trail directly.

const ACTORS = [
  ['anonymous', undefined],
  ['unverified account', { uid: 'u1', role: 'unverified' }],
  ['verified member', { uid: 'member-1', role: 'member', emailVerified: true }],
  ['unverified browser admin', { uid: 'admin-unverified', role: 'admin', emailVerified: false }],
  ['verified browser admin', { uid: 'admin-verified', role: 'admin', emailVerified: true }],
];

const SERVER_ONLY_COLLECTIONS = [
  ['social posts', 'socialPosts'],
  ['social-post audit events', 'auditEvents'],
];

const SAMPLE_POST = {
  socialPostStoreSchemaVersion: 1,
  socialPostSchemaVersion: 1,
  revision: 1,
  lifecycleStatus: 'draft',
  sourceKind: 'public_event',
  marker: 'synthetic-social-post-boundary-test',
};

beforeEach(clearFirestore);
afterAll(teardown);

describe.each(ACTORS)('social post server-only boundary — %s', (_actorLabel, auth) => {
  test.each(SERVER_ONLY_COLLECTIONS)(
    'CANNOT get, list, create, update, delete, or collection-group-query %s',
    async (_collectionLabel, collectionName) => {
      const existingPath = `${collectionName}/post-1`;
      const newPath = `${collectionName}/post-new`;
      await seed(existingPath, SAMPLE_POST);
      const client = await db(auth);

      await assertFails(client.doc(existingPath).get());
      await assertFails(client.collection(collectionName).get());
      await assertFails(client.doc(newPath).set(SAMPLE_POST));
      await assertFails(client.doc(existingPath).update({ lifecycleStatus: 'approved' }));
      await assertFails(client.doc(existingPath).delete());
      await assertFails(client.collectionGroup(collectionName).get());
    },
  );

  test('CANNOT access nested records below socialPosts', async () => {
    const nestedCollection = 'revisions';
    const existingPath = `socialPosts/post-1/${nestedCollection}/existing`;
    const newPath = `socialPosts/post-1/${nestedCollection}/new-record`;
    await seed(existingPath, SAMPLE_POST);
    const client = await db(auth);

    await assertFails(client.doc(existingPath).get());
    await assertFails(client.collection(`socialPosts/post-1/${nestedCollection}`).get());
    await assertFails(client.doc(newPath).set(SAMPLE_POST));
    await assertFails(client.doc(existingPath).update({ marker: 'changed' }));
    await assertFails(client.doc(existingPath).delete());
    await assertFails(client.collectionGroup(nestedCollection).get());
  });
});
