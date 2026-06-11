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
      const me = await db({ uid: 'u1', role: 'member' });
      await assertFails(me.doc('members/u2').get());
    });

    test('admin CAN read any member doc (via catch-all)', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertSucceeds(admin.doc('members/u1').get());
    });

    test('user CANNOT list the members collection', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      await seed('members/u2', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'member' });
      // No query constraint can satisfy `request.auth.uid == uid` for every
      // doc, so a collection list is denied — users can't enumerate members.
      await assertFails(me.collection('members').get());
    });
  });

  describe('updates: self-edit allowed, immutable fields pinned', () => {
    test('user CAN update their own fullName + phone', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertSucceeds(me.doc('members/u1').update({
        fullName: 'New Name',
        phoneNumber: '555-1234',
      }));
    });

    test('user CAN update fullName + phoneNumber + updatedAt together', async () => {
      // Mirrors the real client write (accountService.updateMyProfile).
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertSucceeds(me.doc('members/u1').update({
        fullName: 'New Name',
        phoneNumber: '555-1234',
        updatedAt: new Date(),
      }));
    });

    test('user CANNOT inject an arbitrary field', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertFails(me.doc('members/u1').update({ favoriteColor: 'blue' }));
    });

    test('user CANNOT plant a privilege field (isAdmin)', async () => {
      // The catch-all checks the auth token's role claim, not a doc field, so
      // this wouldn't grant access — but the allowlist blocks it outright.
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
      await assertFails(me.doc('members/u1').update({ fullName: 12345 }));
    });

    test('user CANNOT set an oversized fullName', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const me = await db({ uid: 'u1', role: 'unverified' });
      await assertFails(me.doc('members/u1').update({ fullName: 'x'.repeat(201) }));
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
      const me = await db({ uid: 'u1', role: 'member' });
      await assertFails(me.doc('members/u2').update({ fullName: 'Hax' }));
    });

    test('admin CAN promote another user\'s role (via catch-all)', async () => {
      await seed('members/u1', SAMPLE_MEMBER);
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertSucceeds(admin.doc('members/u1').update({ role: 'admin' }));
    });
  });

  describe('creation', () => {
    test('user CANNOT create their own member doc directly (cloud function only)', async () => {
      const me = await db({ uid: 'u1' });
      await assertFails(me.doc('members/u1').set(SAMPLE_MEMBER));
    });

    test('admin CAN create a member doc', async () => {
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertSucceeds(admin.doc('members/u9').set(SAMPLE_MEMBER));
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

  test('admin CAN read/write any connections doc (via catch-all)', async () => {
    await seed('members/u1/connections/strava', conn);
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertSucceeds(admin.doc('members/u1/connections/strava').get());
    await assertSucceeds(admin.doc('members/u1/connections/strava').update({ athleteId: 99999 }));
  });

  test('user CANNOT collectionGroup-query all connections', async () => {
    // collectionGroup queries bypass path nesting; the per-doc `uid` match
    // can't hold for every member's doc, so the query is denied — a user
    // cannot harvest everyone's Strava connection metadata.
    await seed('members/u1/connections/strava', conn);
    await seed('members/u2/connections/strava', conn);
    const me = await db({ uid: 'u1', role: 'member' });
    await assertFails(me.collectionGroup('connections').get());
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
    const m = await db({ uid: 'u1', role: 'member' });
    await assertFails(m.doc('members/u2/secrets/strava').get());
  });

  // Note: admins CAN read secrets via the catch-all rule. This is intentional
  // for token rotation/recovery — admins are highly trusted. Documenting via
  // a test so the behavior is explicit and any future change is caught.
  test('admin CAN read secrets (via catch-all — intentional)', async () => {
    await seed('members/u1/secrets/strava', secret);
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertSucceeds(admin.doc('members/u1/secrets/strava').get());
  });

  test('member CANNOT collectionGroup-query all secrets', async () => {
    await seed('members/u1/secrets/strava', secret);
    await seed('members/u2/secrets/strava', secret);
    const m = await db({ uid: 'u1', role: 'member' });
    await assertFails(m.collectionGroup('secrets').get());
  });
});
