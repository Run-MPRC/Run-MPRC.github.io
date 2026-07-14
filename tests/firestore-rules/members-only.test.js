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
    const member = await db({ uid: 'u1', role: 'member', emailVerified: true });

    await assertSucceeds(member.doc('members_only/benefits').get());
  });

  test('admins CAN read private content through the explicit collection rule', async () => {
    await seed('members_only/benefits', PRIVATE_CONTENT);
    const admin = await db({ uid: 'a1', role: 'admin', emailVerified: true });

    await assertSucceeds(admin.doc('members_only/benefits').get());
  });

  test.each([
    ['member with no verification claim', {
      uid: 'm-missing', role: 'member', omitEmailVerified: true,
    }],
    ['member with a false verification claim', {
      uid: 'm-false', role: 'member', emailVerified: false,
    }],
    ['member with a string verification claim', {
      uid: 'm-string', role: 'member', emailVerified: 'true',
    }],
    ['member with a numeric verification claim', {
      uid: 'm-number', role: 'member', emailVerified: 1,
    }],
    ['admin with no verification claim', {
      uid: 'a-missing', role: 'admin', omitEmailVerified: true,
    }],
    ['admin with a false verification claim', {
      uid: 'a-false', role: 'admin', emailVerified: false,
    }],
    ['admin with a string verification claim', {
      uid: 'a-string', role: 'admin', emailVerified: 'true',
    }],
    ['admin with a numeric verification claim', {
      uid: 'a-number', role: 'admin', emailVerified: 1,
    }],
  ])('%s CANNOT read private content', async (_label, auth) => {
    await seed('members_only/benefits', PRIVATE_CONTENT);
    const user = await db(auth);

    await assertFails(user.doc('members_only/benefits').get());
  });

  test.each([
    ['anonymous users', undefined],
    ['users without a role claim', { uid: 'u1' }],
    ['unverified users', { uid: 'u2', role: 'unverified' }],
    ['members', { uid: 'u3', role: 'member', emailVerified: true }],
  ])('%s CANNOT create, update, or delete private content', async (_label, auth) => {
    await seed('members_only/benefits', PRIVATE_CONTENT);
    const user = await db(auth);

    await assertFails(user.doc('members_only/new-benefit').set(PRIVATE_CONTENT));
    await assertFails(user.doc('members_only/benefits').update({
      discounts: '<p>Changed without admin access.</p>',
    }));
    await assertFails(user.doc('members_only/benefits').delete());
  });

  test('admins CANNOT write private content from the browser', async () => {
    await seed('members_only/benefits', PRIVATE_CONTENT);
    const admin = await db({ uid: 'a1', role: 'admin', emailVerified: true });

    await assertFails(admin.doc('members_only/new-benefit').set(PRIVATE_CONTENT));
    await assertFails(admin.doc('members_only/benefits').update({
      discounts: '<p>Changed directly.</p>',
    }));
    await assertFails(admin.doc('members_only/benefits').delete());
  });
});
