const {
  clearFirestore, teardown, db, seed, assertFails, assertSucceeds,
} = require('./setup');

const NOW = new Date();

const PUBLIC_OPEN = {
  visibility: 'public',
  status: 'open',
  title: 'Public Open Race',
  startAt: NOW,
};

const PUBLIC_DRAFT = {
  visibility: 'public',
  status: 'draft',
  title: 'Draft',
  startAt: NOW,
};

const MEMBERS_ONLY = {
  visibility: 'members_only',
  status: 'open',
  title: 'Members Run',
  startAt: NOW,
};

const LEGACY_OPEN = {
  // no visibility field
  member_only: false,
  title: 'Legacy public',
  startAt: NOW,
};

const LEGACY_MEMBERS_ONLY = {
  member_only: true,
  title: 'Legacy members',
  startAt: NOW,
};

beforeEach(clearFirestore);
afterAll(teardown);

describe('events collection', () => {
  describe('reads', () => {
    test('anonymous CAN read public+open event', async () => {
      await seed('events/e1', PUBLIC_OPEN);
      const anon = await db();
      await assertSucceeds(anon.doc('events/e1').get());
    });

    test('anonymous CANNOT read public+draft event', async () => {
      await seed('events/e1', PUBLIC_DRAFT);
      const anon = await db();
      await assertFails(anon.doc('events/e1').get());
    });

    test('anonymous CANNOT read members_only event', async () => {
      await seed('events/e1', MEMBERS_ONLY);
      const anon = await db();
      await assertFails(anon.doc('events/e1').get());
    });

    test('member CAN read members_only event', async () => {
      await seed('events/e1', MEMBERS_ONLY);
      const member = await db({ uid: 'u1', role: 'member' });
      await assertSucceeds(member.doc('events/e1').get());
    });

    test('admin CAN read draft event (via catch-all)', async () => {
      await seed('events/e1', PUBLIC_DRAFT);
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertSucceeds(admin.doc('events/e1').get());
    });

    test('anonymous CAN read legacy event (no visibility, member_only=false)', async () => {
      await seed('events/e1', LEGACY_OPEN);
      const anon = await db();
      await assertSucceeds(anon.doc('events/e1').get());
    });

    test('anonymous CANNOT read legacy member_only=true event', async () => {
      await seed('events/e1', LEGACY_MEMBERS_ONLY);
      const anon = await db();
      await assertFails(anon.doc('events/e1').get());
    });

    test('member CAN read legacy member_only=true event', async () => {
      await seed('events/e1', LEGACY_MEMBERS_ONLY);
      const member = await db({ uid: 'u1', role: 'member' });
      await assertSucceeds(member.doc('events/e1').get());
    });
  });

  describe('list queries (rules-are-not-filters)', () => {
    beforeEach(async () => {
      await seed('events/e1', PUBLIC_OPEN);
      await seed('events/e2', PUBLIC_DRAFT);
      await seed('events/e3', MEMBERS_ONLY);
    });

    test('anonymous CANNOT list the whole events collection', async () => {
      const anon = await db();
      await assertFails(anon.collection('events').get());
    });

    test('anonymous CAN list public open/closed events (mirrors listPublicEvents)', async () => {
      const anon = await db();
      await assertSucceeds(
        anon.collection('events')
          .where('visibility', '==', 'public')
          .where('status', 'in', ['open', 'closed'])
          .get(),
      );
    });

    test('member list with status filter ONLY is denied (no visibility filter)', async () => {
      // A `visibility:'draft'` event with an open status would match this query
      // but is unreadable, so Firestore denies the whole list. This is why
      // listMemberEvents must instead run two visibility-scoped queries (the
      // two assertSucceeds cases here) and merge them client-side.
      const member = await db({ uid: 'u1', role: 'member' });
      await assertFails(
        member.collection('events').where('status', 'in', ['open', 'closed']).get(),
      );
    });

    test('member CAN list members_only open/closed events with a visibility filter', async () => {
      const member = await db({ uid: 'u1', role: 'member' });
      await assertSucceeds(
        member.collection('events')
          .where('visibility', '==', 'members_only')
          .where('status', 'in', ['open', 'closed'])
          .get(),
      );
    });
  });

  describe('writes', () => {
    test('anonymous CANNOT create an event', async () => {
      const anon = await db();
      await assertFails(anon.doc('events/new').set(PUBLIC_OPEN));
    });

    test('member CANNOT create an event', async () => {
      const member = await db({ uid: 'u1', role: 'member' });
      await assertFails(member.doc('events/new').set(PUBLIC_OPEN));
    });

    test('unverified user CANNOT create an event', async () => {
      const unv = await db({ uid: 'u1', role: 'unverified' });
      await assertFails(unv.doc('events/new').set(PUBLIC_OPEN));
    });

    test('admin CAN create an event', async () => {
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertSucceeds(admin.doc('events/new').set(PUBLIC_OPEN));
    });

    test('admin CAN update an event', async () => {
      await seed('events/e1', PUBLIC_OPEN);
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertSucceeds(admin.doc('events/e1').update({ title: 'Renamed' }));
    });

    test('admin CAN delete an event', async () => {
      await seed('events/e1', PUBLIC_OPEN);
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertSucceeds(admin.doc('events/e1').delete());
    });
  });
});

describe('registrations subcollection', () => {
  beforeEach(async () => {
    await seed('events/e1', PUBLIC_OPEN);
    await seed('events/e1/registrations/r1', {
      eventId: 'e1',
      runner: { firstName: 'Test', lastName: 'User', email: 't@example.com' },
      status: 'paid',
      amountCents: 5000,
    });
  });

  test('anonymous CANNOT read a registration', async () => {
    const anon = await db();
    await assertFails(anon.doc('events/e1/registrations/r1').get());
  });

  test('member CANNOT read a registration', async () => {
    const member = await db({ uid: 'u1', role: 'member' });
    await assertFails(member.doc('events/e1/registrations/r1').get());
  });

  test('unverified CANNOT read a registration', async () => {
    const unv = await db({ uid: 'u1', role: 'unverified' });
    await assertFails(unv.doc('events/e1/registrations/r1').get());
  });

  test('admin CAN read a registration (via catch-all)', async () => {
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertSucceeds(admin.doc('events/e1/registrations/r1').get());
  });

  test('anonymous CANNOT write a registration', async () => {
    const anon = await db();
    await assertFails(
      anon.doc('events/e1/registrations/r2').set({ status: 'paid' }),
    );
  });

  test('member CANNOT write a registration', async () => {
    const member = await db({ uid: 'u1', role: 'member' });
    await assertFails(
      member.doc('events/e1/registrations/r2').set({ status: 'paid' }),
    );
  });

  test('admin CAN write a registration (via catch-all)', async () => {
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertSucceeds(
      admin.doc('events/e1/registrations/r2').set({ status: 'paid' }),
    );
  });

  test('admin CAN list registrations across events', async () => {
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertSucceeds(admin.collectionGroup('registrations').get());
  });

  test('member CANNOT list registrations across events', async () => {
    const member = await db({ uid: 'u1', role: 'member' });
    await assertFails(member.collectionGroup('registrations').get());
  });
});
