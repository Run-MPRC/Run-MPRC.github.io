/* eslint-env jest */

const {
  clearFirestore, teardown, db, seed, assertFails, assertSucceeds,
} = require('./setup');

const PRIVATE_CONTENT = {
  discounts: '<p>Members save 10%.</p>',
};

beforeEach(clearFirestore);
afterAll(teardown);

describe('members_only collection', () => {
  test('anonymous users CANNOT read private content', async () => {
    await seed('members_only/benefits', PRIVATE_CONTENT);
    const anon = await db();

    await assertFails(anon.doc('members_only/benefits').get());
  });

  test('unverified users CANNOT read private content', async () => {
    await seed('members_only/benefits', PRIVATE_CONTENT);
    const unverified = await db({ uid: 'u1', role: 'unverified' });

    await assertFails(unverified.doc('members_only/benefits').get());
  });

  test('members CAN read private content', async () => {
    await seed('members_only/benefits', PRIVATE_CONTENT);
    const member = await db({ uid: 'u1', role: 'member' });

    await assertSucceeds(member.doc('members_only/benefits').get());
  });

  test('admins CAN read private content through the admin catch-all', async () => {
    await seed('members_only/benefits', PRIVATE_CONTENT);
    const admin = await db({ uid: 'a1', role: 'admin' });

    await assertSucceeds(admin.doc('members_only/benefits').get());
  });

  test('members CANNOT create, update, or delete private content', async () => {
    await seed('members_only/benefits', PRIVATE_CONTENT);
    const member = await db({ uid: 'u1', role: 'member' });

    await assertFails(member.doc('members_only/new-benefit').set(PRIVATE_CONTENT));
    await assertFails(member.doc('members_only/benefits').update({
      discounts: '<p>Changed by a member.</p>',
    }));
    await assertFails(member.doc('members_only/benefits').delete());
  });
});
