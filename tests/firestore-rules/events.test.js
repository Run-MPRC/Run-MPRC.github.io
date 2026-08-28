/* eslint-env jest */

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

const LEGACY_DRAFT = {
  // no visibility field, but a draft status must never be public
  member_only: false,
  status: 'draft',
  title: 'Legacy draft',
  startAt: NOW,
};

function adminEvent(slug, overrides = {}) {
  return {
    slug,
    title: 'Admin Event',
    description: 'Event description',
    startAt: NOW,
    endAt: null,
    location: 'Clubhouse',
    locationDetails: '',
    capacity: 50,
    registeredCount: 0,
    status: 'draft',
    visibility: 'public',
    pricing: {
      memberCents: 2500,
      nonMemberCents: 3500,
    },
    stripePriceIds: {},
    waiverText: 'Test waiver',
    waiverVersion: '1',
    customFields: [],
    volunteerEnabled: false,
    volunteerFields: [],
    resultsUrl: null,
    resultsText: null,
    resultsPublishedAt: null,
    registrationOpensAt: null,
    registrationClosesAt: null,
    heroImageUrl: null,
    createdBy: 'a1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function editorUpdate() {
  return {
    title: 'Renamed Event',
    description: 'Updated description',
    startAt: new Date(NOW.getTime() + 1000),
    endAt: new Date(NOW.getTime() + 7200000),
    location: 'Track',
    locationDetails: 'Lane one',
    capacity: 75,
    status: 'open',
    visibility: 'members_only',
    pricing: {
      memberCents: 3000,
      nonMemberCents: 4000,
      earlyBirdCents: 2000,
      earlyBirdUntil: new Date(NOW.getTime() + 86400000),
    },
    waiverText: 'Updated waiver',
    waiverVersion: '2',
    customFields: [{
      key: 'pace', label: 'Pace', type: 'text', required: false,
    }],
    volunteerEnabled: true,
    volunteerFields: [{
      key: 'role', label: 'Role', type: 'text', required: true,
    }],
    resultsUrl: 'https://example.com/results',
    resultsText: 'Official results',
    resultsPublishedAt: NOW,
    registrationOpensAt: NOW,
    registrationClosesAt: new Date(NOW.getTime() + 86400000),
    heroImageUrl: 'https://example.com/hero.jpg',
    updatedAt: NOW,
  };
}

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

    test('admin CAN read draft event through the explicit events rule', async () => {
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

    test('anonymous CANNOT read a legacy draft event', async () => {
      await seed('events/e1', LEGACY_DRAFT);
      const anon = await db();
      await assertFails(anon.doc('events/e1').get());
    });

    test('admin CAN read a legacy draft event', async () => {
      await seed('events/e1', LEGACY_DRAFT);
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertSucceeds(admin.doc('events/e1').get());
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

    test('admin CAN list all events for the current admin screen', async () => {
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertSucceeds(admin.collection('events').get());
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
      await assertSucceeds(admin.doc('events/new').set(adminEvent('new')));
    });

    test('admin CAN update an event with the current editor payload', async () => {
      await seed('events/e1', adminEvent('e1'));
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertSucceeds(admin.doc('events/e1').update(editorUpdate()));
    });

    test('admin CANNOT delete an event directly', async () => {
      await seed('events/e1', adminEvent('e1'));
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertFails(admin.doc('events/e1').delete());
    });

    test.each([
      ['mismatched slug', { slug: 'different' }],
      ['mismatched creator', { createdBy: 'attacker' }],
      ['Stripe product ID', { stripeProductId: 'prod_test' }],
      ['non-zero registered count', { registeredCount: 1 }],
      ['Stripe price ID', { stripePriceIds: { member: 'price_test' } }],
      ['payment state', { paymentStatus: 'paid' }],
      ['capacity counters', { capacityCounters: { reserved: 1 } }],
      ['inventory state', { inventory: { onHand: 10 } }],
      ['audit data', { auditLog: [{ action: 'created' }] }],
    ])('admin CANNOT create an event containing protected %s', async (_label, patch) => {
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertFails(
        admin.doc('events/protected').set(adminEvent('protected', patch)),
      );
    });

    test('admin CANNOT inject Stripe fields into event pricing', async () => {
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertFails(admin.doc('events/protected').set(adminEvent('protected', {
        pricing: {
          memberCents: 2500,
          nonMemberCents: 3500,
          stripePriceId: 'price_test',
        },
      })));
    });

    test('admin CANNOT inject Stripe fields while updating event pricing', async () => {
      await seed('events/e1', adminEvent('e1'));
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertFails(admin.doc('events/e1').update({
        pricing: {
          memberCents: 2500,
          nonMemberCents: 3500,
          stripePriceId: 'price_test',
        },
      }));
    });

    test.each([
      ['slug', { slug: 'changed' }],
      ['creator', { createdBy: 'attacker' }],
      ['creation timestamp', { createdAt: new Date(0) }],
      ['registered count', { registeredCount: 99 }],
      ['Stripe price IDs', { stripePriceIds: { member: 'price_test' } }],
      ['Stripe product ID', { stripeProductId: 'prod_test' }],
      ['payment state', { paymentStatus: 'paid' }],
      ['capacity counters', { capacityCounters: { reserved: 1 } }],
      ['inventory state', { inventory: { onHand: 10 } }],
      ['audit data', { auditLog: [{ action: 'tampered' }] }],
    ])('admin CANNOT update protected event %s', async (_label, patch) => {
      await seed('events/e1', adminEvent('e1'));
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertFails(admin.doc('events/e1').update(patch));
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

  test('admin CAN read a registration through the explicit registrations rule', async () => {
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

  test('admin CANNOT create a registration directly', async () => {
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertFails(
      admin.doc('events/e1/registrations/r2').set({ status: 'paid' }),
    );
  });

  test('admin CANNOT update registration financial state directly', async () => {
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertFails(
      admin.doc('events/e1/registrations/r1').update({
        status: 'refunded',
        amountCents: 0,
      }),
    );
  });

  test('admin CANNOT delete a registration directly', async () => {
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertFails(admin.doc('events/e1/registrations/r1').delete());
  });

  test('admin CAN list registrations for a known event', async () => {
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertSucceeds(admin.collection('events/e1/registrations').get());
  });

  test('member CANNOT list registrations across events', async () => {
    const member = await db({ uid: 'u1', role: 'member' });
    await assertFails(member.collectionGroup('registrations').get());
  });
});
