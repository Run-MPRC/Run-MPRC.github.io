/* eslint-env jest */

const {
  clearFirestore, teardown, db, seed, assertFails, assertSucceeds,
} = require('./setup');

const SAMPLE_MEMBER = {
  email: 'user@example.com',
  fullName: 'Sample User',
  role: 'unverified',
  phoneNumber: '',
  emailVerified: false,
  provider: 'password',
  createdAt: new Date(),
};

beforeEach(clearFirestore);
afterAll(teardown);

describe('members collection', () => {
  describe('reads', () => {
    test('anonymous CANNOT read any member doc', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const anon = await db();
      await assertFails(anon.doc('members/u1').get());
    });

    test('user CAN read their own member doc', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertSucceeds(me.doc('members/u1').get());
    });

    test('user CANNOT read another user\'s member doc', async () => {
      await seed('members/u2', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'member', emailVerified: true });
      await assertFails(me.doc('members/u2').get());
    });

    test('admin CAN read any member doc through the explicit members rule', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const admin = await db({ uid: 'a1', role: 'admin', emailVerified: true });
      await assertSucceeds(admin.doc('members/u1').get());
    });

    test('admin CAN list member docs for the current admin screen', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      await seed('members/u2', SAMPLE_MEMBER);
      const admin = await db({ uid: 'a1', role: 'admin', emailVerified: true });
      await assertSucceeds(admin.collection('members').get());
    });

    test.each([
      ['a missing verification claim', {
        uid: 'a-missing', role: 'admin', omitEmailVerified: true,
      }],
      ['a false verification claim', {
        uid: 'a-false', role: 'admin', emailVerified: false,
      }],
      ['a string verification claim', {
        uid: 'a-string', role: 'admin', emailVerified: 'true',
      }],
      ['a numeric verification claim', {
        uid: 'a-number', role: 'admin', emailVerified: 1,
      }],
    ])('admin with %s CANNOT read or list another member profile', async (_label, auth) => {
      // A profile mirror is data, not authorization. Seed it true to prove it
      // cannot replace the signed Firebase token claim.
      await seed('members/u1', { ...SAMPLE_MEMBER, emailVerified: true });
      const admin = await db(auth);

      await assertFails(admin.doc('members/u1').get());
      await assertFails(admin.collection('members').get());
    });

    test('an unverified user retains UID-bound profile recovery access', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'member', emailVerified: false });

      await assertSucceeds(me.doc('members/u1').get());
      await assertSucceeds(me.doc('members/u1').update({
        fullName: 'Recovery Name',
        updatedAt: new Date(),
      }));
      await assertFails(me.doc('members/u2').get());
    });

    test('user CANNOT list the members collection', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      await seed('members/u2', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'member', emailVerified: true });
      // No query constraint can satisfy `request.auth.uid == uid` for every
      // doc, so a collection list is denied — users can't enumerate members.
      await assertFails(me.collection('members').get());
    });
  });

  describe('updates: self-edit allowed, immutable fields pinned', () => {
    test('user CANNOT omit updatedAt from a profile edit', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertFails(me.doc('members/u1').update({
        fullName: 'New Name',
      }));
    });

    test.each([
      ['a user without a role claim', { uid: 'u1' }],
      ['an unverified user', { uid: 'u1', role: 'unverified' }],
      ['a member', { uid: 'u1', role: 'member', emailVerified: true }],
      ['an admin editing their own profile', { uid: 'u1', role: 'admin', emailVerified: true }],
    ])('%s CAN make the exact existing-profile edit', async (_label, auth) => {
      // Mirrors accountService.updateMyProfile. The role grants no extra write
      // authority; ownership and the exact field/value contract are decisive.
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db(auth);
      await assertSucceeds(me.doc('members/u1').update({
        fullName: 'New Name',
        updatedAt: new Date(),
      }));
    });

    test('name length boundary is accepted', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertSucceeds(me.doc('members/u1').update({
        fullName: 'n'.repeat(200),
        updatedAt: new Date(),
      }));
    });

    test('name Unicode boundary matches the browser validator', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'unverified' });

      await assertSucceeds(me.doc('members/u1').update({
        // Firestore Rules and browser maxlength both count these astral
        // symbols as two UTF-16 units. Keep the client validation aligned
        // with the behavior proven by this emulator suite.
        fullName: '🏃'.repeat(100),
        updatedAt: new Date(),
      }));
    });

    test.each([
      ['a Unicode name over the 200-unit limit', {
        fullName: '🏃'.repeat(101),
      }],
    ])('user CANNOT set %s', async (_label, fields) => {
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertFails(me.doc('members/u1').update({
        ...fields,
        updatedAt: new Date(),
      }));
    });

    test('user CANNOT update a missing profile document', async () => {
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertFails(me.doc('members/u1').update({
        fullName: 'New Name',
        updatedAt: new Date(),
      }));
    });

    test('user CANNOT inject an arbitrary field', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertFails(me.doc('members/u1').update({ favoriteColor: 'blue' }));
    });

    test('user CANNOT plant a privilege field (isAdmin)', async () => {
      // Rules check the signed token's role claim, not a document field, so
      // this would not grant access; the allowlist blocks it outright too.
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertFails(me.doc('members/u1').update({ isAdmin: true }));
    });

    test('user CANNOT update fullName alongside a disallowed field', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertFails(me.doc('members/u1').update({
        fullName: 'New Name',
        role: 'admin',
      }));
    });

    test('user CANNOT set fullName to a non-string', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertFails(me.doc('members/u1').update({
        fullName: 12345,
        updatedAt: new Date(),
      }));
    });

    test('user CANNOT set an oversized fullName', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertFails(me.doc('members/u1').update({
        fullName: 'x'.repeat(201),
        updatedAt: new Date(),
      }));
    });

    test('user CANNOT add a non-empty phone during the privacy pause', async () => {
      const memberWithoutPhone = { ...SAMPLE_MEMBER };
      delete memberWithoutPhone.phoneNumber;
      await seed('members/u1', memberWithoutPhone);
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertFails(me.doc('members/u1').update({
        phoneNumber: 'synthetic-phone-canary',
        updatedAt: new Date(),
      }));
    });

    test('user CANNOT replace a non-empty phone during the privacy pause', async () => {
      await seed('members/u1', { ...SAMPLE_MEMBER, phoneNumber: 'existing-value' });
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertFails(me.doc('members/u1').update({
        phoneNumber: 'synthetic-phone-canary',
        updatedAt: new Date(),
      }));
    });

    test('user CANNOT clear an existing phone outside an approved deletion flow', async () => {
      await seed('members/u1', { ...SAMPLE_MEMBER, phoneNumber: 'existing-value' });
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertFails(me.doc('members/u1').update({
        phoneNumber: '',
        updatedAt: new Date(),
      }));
    });

    test('a name-only edit preserves an existing phone value byte-for-byte', async () => {
      await seed('members/u1', { ...SAMPLE_MEMBER, phoneNumber: 'existing-value' });
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertSucceeds(me.doc('members/u1').update({
        fullName: 'New Name',
        updatedAt: new Date(),
      }));

      const updated = await me.doc('members/u1').get();
      expect(updated.data().phoneNumber).toBe('existing-value');
    });

    test.each([
      ['a non-string phone number', 12345],
      ['an oversized phone number', '1'.repeat(41)],
    ])('user CANNOT set %s', async (_label, phoneNumber) => {
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertFails(me.doc('members/u1').update({
        phoneNumber,
        updatedAt: new Date(),
      }));
    });

    test('user CANNOT set updatedAt to a non-timestamp', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertFails(me.doc('members/u1').update({
        fullName: 'New Name',
        updatedAt: 'now',
      }));
    });

    test('user CANNOT escalate their own role', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertFails(me.doc('members/u1').update({ role: 'admin' }));
    });

    test('user CANNOT change their own email', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertFails(me.doc('members/u1').update({ email: 'new@example.com' }));
    });

    test('user CANNOT mark themselves emailVerified', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertFails(me.doc('members/u1').update({ emailVerified: true }));
    });

    test('user CANNOT change createdAt', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertFails(me.doc('members/u1').update({ createdAt: new Date(0) }));
    });

    test('user CANNOT change provider', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertFails(me.doc('members/u1').update({ provider: 'google.com' }));
    });

    test('user CANNOT update someone else\'s member doc', async () => {
      await seed('members/u2', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'member', emailVerified: true });
      await assertFails(me.doc('members/u2').update({ fullName: 'Hax' }));
    });

    test('admin CANNOT promote another user\'s role directly', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const admin = await db({ uid: 'a1', role: 'admin', emailVerified: true });
      await assertFails(admin.doc('members/u1').update({ role: 'admin' }));
    });

    test('admin CANNOT update another member profile directly', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const admin = await db({ uid: 'a1', role: 'admin', emailVerified: true });
      await assertFails(admin.doc('members/u1').update({ fullName: 'Changed by admin' }));
    });

    test('user and admin CANNOT delete a member profile directly', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'member', emailVerified: true });
      const admin = await db({ uid: 'a1', role: 'admin', emailVerified: true });
      await assertFails(me.doc('members/u1').delete());
      await assertFails(admin.doc('members/u1').delete());
    });
  });

  describe('creation', () => {
    test('user CANNOT create their own member doc directly (cloud function only)', async () => {
      const me = await db({ uid: 'u1' });
      await assertFails(me.doc('members/u1').set(SAMPLE_MEMBER));
    });

    test('admin CANNOT create a member doc directly', async () => {
      const admin = await db({ uid: 'a1', role: 'admin', emailVerified: true });
      await assertFails(admin.doc('members/u9').set(SAMPLE_MEMBER));
    });
  });
});

describe('members/{uid}/connections subcollection', () => {
  const conn = {
    provider: 'strava',
    athleteId: 12345,
    firstName: 'Strava',
    lastName: 'User',
  };

  test('user CAN read their own connections doc', async () => {
    await seed('members/u1/connections/strava', conn);
    const me = await db({ uid: 'u1' });
    await assertSucceeds(me.doc('members/u1/connections/strava').get());
  });

  test('user CANNOT read another user\'s connections doc', async () => {
    await seed('members/u2/connections/strava', conn);
    const me = await db({ uid: 'u1' });
    await assertFails(me.doc('members/u2/connections/strava').get());
  });

  test('user CANNOT write their own connections doc (server-only)', async () => {
    const me = await db({ uid: 'u1' });
    await assertFails(me.doc('members/u1/connections/strava').set(conn));
  });

  test('admin CANNOT read or write connection metadata without an explicit need', async () => {
    await seed('members/u1/connections/strava', conn);
    const admin = await db({ uid: 'a1', role: 'admin', emailVerified: true });
    await assertFails(admin.doc('members/u1/connections/strava').get());
    await assertFails(admin.doc('members/u1/connections/strava').update({ athleteId: 99999 }));
  });

  test('user CANNOT collectionGroup-query all connections', async () => {
    // collectionGroup queries bypass path nesting; the per-doc `uid` match
    // can't hold for every member's doc, so the query is denied — a user
    // cannot harvest everyone's Strava connection metadata.
    await seed('members/u1/connections/strava', conn);
    await seed('members/u2/connections/strava', conn);
    const me = await db({ uid: 'u1', role: 'member', emailVerified: true });
    await assertFails(me.collectionGroup('connections').get());
  });

  test('admin CANNOT collectionGroup-query all connections', async () => {
    await seed('members/u1/connections/strava', conn);
    await seed('members/u2/connections/strava', conn);
    const admin = await db({ uid: 'a1', role: 'admin', emailVerified: true });
    await assertFails(admin.collectionGroup('connections').get());
  });
});

describe('members/{uid}/secrets subcollection', () => {
  const secret = {
    access_token: 'AT-secret',
    refresh_token: 'RT-secret',
    expires_at: 9999999999,
  };

  test('user CANNOT read their own secrets', async () => {
    await seed('members/u1/secrets/strava', secret);
    const me = await db({ uid: 'u1' });
    await assertFails(me.doc('members/u1/secrets/strava').get());
  });

  test('user CANNOT write their own secrets', async () => {
    const me = await db({ uid: 'u1' });
    await assertFails(me.doc('members/u1/secrets/strava').set(secret));
  });

  test('member CANNOT read another user\'s secrets', async () => {
    await seed('members/u2/secrets/strava', secret);
    const m = await db({ uid: 'u1', role: 'member', emailVerified: true });
    await assertFails(m.doc('members/u2/secrets/strava').get());
  });

  test('admin CANNOT read OAuth secrets', async () => {
    await seed('members/u1/secrets/strava', secret);
    const admin = await db({ uid: 'a1', role: 'admin', emailVerified: true });
    await assertFails(admin.doc('members/u1/secrets/strava').get());
  });

  test('admin CANNOT create, update, or delete OAuth secrets', async () => {
    await seed('members/u1/secrets/strava', secret);
    const admin = await db({ uid: 'a1', role: 'admin', emailVerified: true });
    await assertFails(admin.doc('members/u2/secrets/strava').set(secret));
    await assertFails(admin.doc('members/u1/secrets/strava').update({ expires_at: 1 }));
    await assertFails(admin.doc('members/u1/secrets/strava').delete());
  });

  test('member CANNOT collectionGroup-query all secrets', async () => {
    await seed('members/u1/secrets/strava', secret);
    await seed('members/u2/secrets/strava', secret);
    const m = await db({ uid: 'u1', role: 'member', emailVerified: true });
    await assertFails(m.collectionGroup('secrets').get());
  });

  test('admin CANNOT collectionGroup-query all secrets', async () => {
    await seed('members/u1/secrets/strava', secret);
    await seed('members/u2/secrets/strava', secret);
    const admin = await db({ uid: 'a1', role: 'admin', emailVerified: true });
    await assertFails(admin.collectionGroup('secrets').get());
  });
});
