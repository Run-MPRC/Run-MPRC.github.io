/* eslint-env jest */

const {
  clearFirestore, teardown, db, seed, assertFails, assertSucceeds,
} = require('./setup');

const NOW = new Date();
const UNSAFE_SCRIPT_URL = ['javascript', 'alert(1)'].join(':');

const PUBLIC_OPEN = {
  visibility: 'public',
  status: 'open',
  title: 'Public Open Race',
  startAt: NOW,
  capacity: null,
  pricing: { memberCents: 0, nonMemberCents: 0 },
};

const PUBLIC_DRAFT = {
  visibility: 'public',
  status: 'draft',
  title: 'Draft',
  startAt: NOW,
  capacity: null,
  pricing: { memberCents: 0, nonMemberCents: 0 },
};

const MEMBERS_ONLY = {
  visibility: 'members_only',
  status: 'open',
  title: 'Members Run',
  startAt: NOW,
  capacity: null,
  pricing: { memberCents: 0, nonMemberCents: 0 },
};

const MEMBERS_ONLY_DRAFT = {
  ...MEMBERS_ONLY,
  status: 'draft',
  title: 'Unpublished member draft',
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

const LEGACY_MEMBERS_ONLY_DRAFT = {
  ...LEGACY_MEMBERS_ONLY,
  status: 'draft',
  title: 'Legacy unpublished member draft',
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
    capacity: null,
    registeredCount: 0,
    status: 'draft',
    visibility: 'public',
    pricing: {
      memberCents: 0,
      nonMemberCents: 0,
    },
    stripePriceIds: {},
    waiverText: '',
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

function editorUpdate(overrides = {}) {
  return {
    title: 'Renamed Event',
    description: 'Updated description',
    startAt: new Date(NOW.getTime() + 1000),
    endAt: new Date(NOW.getTime() + 7200000),
    location: 'Track',
    locationDetails: 'Lane one',
    capacity: null,
    status: 'draft',
    visibility: 'public',
    pricing: {
      memberCents: 0,
      nonMemberCents: 0,
    },
    waiverText: '',
    waiverVersion: '1',
    customFields: [],
    volunteerEnabled: false,
    volunteerFields: [],
    resultsUrl: 'https://example.com/results',
    resultsText: 'Official results',
    resultsPublishedAt: NOW,
    registrationOpensAt: null,
    registrationClosesAt: null,
    heroImageUrl: 'https://example.com/hero.jpg',
    updatedAt: NOW,
    ...overrides,
  };
}

function withoutField(value, field) {
  const copy = { ...value };
  delete copy[field];
  return copy;
}

const INVALID_SLUGS = ['Bad-Slug', 'bad slug', 'bad?query', 'résumé'];

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

    test('member CANNOT read a new-schema members_only draft', async () => {
      await seed('events/e1', MEMBERS_ONLY_DRAFT);
      const member = await db({ uid: 'u1', role: 'member' });
      await assertFails(member.doc('events/e1').get());
    });

    test('member CANNOT read a legacy members-only draft', async () => {
      await seed('events/e1', LEGACY_MEMBERS_ONLY_DRAFT);
      const member = await db({ uid: 'u1', role: 'member' });
      await assertFails(member.doc('events/e1').get());
    });

    test('unknown event status is not treated as public or published member content', async () => {
      await seed('events/public-unknown', { ...PUBLIC_OPEN, status: 'unexpected' });
      await seed('events/member-unknown', { ...MEMBERS_ONLY, status: 'unexpected' });
      await seed('events/legacy-unknown', {
        ...LEGACY_MEMBERS_ONLY,
        status: 'unexpected',
      });
      const anon = await db();
      const member = await db({ uid: 'u1', role: 'member' });

      await assertFails(anon.doc('events/public-unknown').get());
      await assertFails(member.doc('events/member-unknown').get());
      await assertFails(member.doc('events/legacy-unknown').get());
    });

    test('visibility=draft remains admin-only even with an open status', async () => {
      await seed('events/e1', { ...PUBLIC_OPEN, visibility: 'draft' });
      const anon = await db();
      const member = await db({ uid: 'u1', role: 'member' });
      const admin = await db({ uid: 'a1', role: 'admin' });

      await assertFails(anon.doc('events/e1').get());
      await assertFails(member.doc('events/e1').get());
      await assertSucceeds(admin.doc('events/e1').get());
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

    test('admin CAN create the current client payload only as a hidden inert draft', async () => {
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertSucceeds(admin.doc('events/free').set(adminEvent('free', {
        capacity: null,
        pricing: { memberCents: 0, nonMemberCents: 0 },
      })));
    });

    test.each(INVALID_SLUGS)('admin CANNOT create an event with invalid slug %s', async (slug) => {
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertFails(admin.doc(`events/${slug}`).set(adminEvent(slug)));
    });

    test('admin CAN update an event with the current editor payload', async () => {
      await seed('events/e1', adminEvent('e1'));
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertSucceeds(admin.doc('events/e1').update(editorUpdate()));
    });

    test('admin CAN edit content while preserving server-owned price and capacity', async () => {
      const pricing = { memberCents: 2500, nonMemberCents: 3500 };
      const registrationOpensAt = NOW;
      const registrationClosesAt = new Date(NOW.getTime() + 86400000);
      const customFields = [{
        key: 'pace', label: 'Pace', type: 'text', required: false,
      }];
      const volunteerFields = [{
        key: 'role', label: 'Role', type: 'text', required: true,
      }];
      const operational = {
        capacity: 50,
        pricing,
        status: 'open',
        visibility: 'members_only',
        waiverText: 'Approved synthetic waiver',
        waiverVersion: 'approved-v1',
        customFields,
        volunteerEnabled: true,
        volunteerFields,
        registrationOpensAt,
        registrationClosesAt,
      };
      await seed('events/e1', adminEvent('e1', operational));
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertSucceeds(admin.doc('events/e1').update(editorUpdate({
        ...operational,
      })));
    });

    test('admin CANNOT delete an event directly', async () => {
      await seed('events/e1', adminEvent('e1'));
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertFails(admin.doc('events/e1').delete());
    });

    test.each([
      ['a user without a role claim', { uid: 'u1' }],
      ['an unverified user', { uid: 'u2', role: 'unverified' }],
      ['a member', { uid: 'u3', role: 'member' }],
    ])('%s CANNOT update or delete an event', async (_label, auth) => {
      await seed('events/e1', adminEvent('e1'));
      const user = await db(auth);
      await assertFails(user.doc('events/e1').update({ title: 'Unauthorized' }));
      await assertFails(user.doc('events/e1').delete());
    });

    test.each([
      ['a missing title', (event) => withoutField(event, 'title')],
      ['an empty title', (event) => ({ ...event, title: '' })],
      ['an unknown status', (event) => ({ ...event, status: 'unexpected' })],
      ['an unknown visibility', (event) => ({ ...event, visibility: 'everyone' })],
      ['a string start time', (event) => ({ ...event, startAt: 'tomorrow' })],
      ['an unsafe results URL', (event) => ({
        ...event, resultsUrl: UNSAFE_SCRIPT_URL,
      })],
      ['an insecure hero-image URL', (event) => ({
        ...event, heroImageUrl: 'http://example.com/hero.jpg',
      })],
      ['a negative capacity', (event) => ({ ...event, capacity: -1 })],
      ['a zero capacity', (event) => ({ ...event, capacity: 0 })],
      ['a fractional capacity', (event) => ({ ...event, capacity: 1.5 })],
      ['a NaN capacity', (event) => ({ ...event, capacity: Number.NaN })],
      ['a missing pricing field', (event) => withoutField(event, 'pricing')],
      ['a missing required price tier', (event) => ({
        ...event,
        pricing: { memberCents: 1000 },
      })],
      ['a negative member price', (event) => ({
        ...event,
        pricing: { memberCents: -1, nonMemberCents: 1000 },
      })],
      ['a fractional non-member price', (event) => ({
        ...event,
        pricing: { memberCents: 1000, nonMemberCents: 1000.5 },
      })],
      ['a NaN non-member price', (event) => ({
        ...event,
        pricing: { memberCents: 1000, nonMemberCents: Number.NaN },
      })],
      ['an invalid early-bird timestamp', (event) => ({
        ...event,
        pricing: {
          memberCents: 1000,
          nonMemberCents: 1500,
          earlyBirdCents: 500,
          earlyBirdUntil: 'later',
        },
      })],
      ['a map instead of custom-field list', (event) => ({
        ...event,
        customFields: { key: 'pace' },
      })],
      ['a missing creation timestamp', (event) => withoutField(event, 'createdAt')],
    ])('admin CANNOT create an event with %s', async (_label, buildInvalid) => {
      const admin = await db({ uid: 'a1', role: 'admin' });
      const event = buildInvalid(adminEvent('invalid'));
      await assertFails(admin.doc('events/invalid').set(event));
    });

    test.each([
      ['an unknown status', { status: 'unexpected' }],
      ['an unknown visibility', { visibility: 'everyone' }],
      ['a negative capacity', { capacity: -1 }],
      ['a zero capacity', { capacity: 0 }],
      ['a fractional capacity', { capacity: 1.5 }],
      ['a negative price', {
        pricing: { memberCents: -1, nonMemberCents: 1000 },
      }],
      ['a NaN price', {
        pricing: { memberCents: 1000, nonMemberCents: Number.NaN },
      }],
      ['an invalid updatedAt', { updatedAt: 'not-a-timestamp' }],
      ['an invalid custom-field value', { customFields: { key: 'pace' } }],
      ['an unsafe results URL', { resultsUrl: UNSAFE_SCRIPT_URL }],
      ['an insecure hero-image URL', { heroImageUrl: 'http://example.com/hero.jpg' }],
    ])('admin CANNOT update an event with %s', async (_label, patch) => {
      await seed('events/e1', adminEvent('e1'));
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertFails(admin.doc('events/e1').update(patch));
    });

    test.each([
      ['mismatched slug', { slug: 'different' }],
      ['mismatched creator', { createdBy: 'attacker' }],
      ['Stripe product ID', { stripeProductId: 'prod_test' }],
      ['non-zero registered count', { registeredCount: 1 }],
      ['configured capacity', { capacity: 50 }],
      ['non-zero pricing', {
        pricing: { memberCents: 2500, nonMemberCents: 3500 },
      }],
      ['open status', { status: 'open' }],
      ['members-only visibility', { visibility: 'members_only' }],
      ['registration window', { registrationOpensAt: NOW }],
      ['waiver configuration', {
        waiverText: 'Unapproved text', waiverVersion: 'v1',
      }],
      ['registration custom fields', {
        customFields: [{
          key: 'dob', label: 'Date of birth', type: 'date', required: true,
        }],
      }],
      ['volunteer comp configuration', {
        volunteerEnabled: true,
        volunteerFields: [{
          key: 'role', label: 'Role', type: 'text', required: true,
        }],
      }],
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
      ['capacity', { capacity: 50 }],
      ['pricing', { pricing: { memberCents: 2500, nonMemberCents: 3500 } }],
      ['status', { status: 'open' }],
      ['visibility', { visibility: 'members_only' }],
      ['registration window', { registrationOpensAt: NOW }],
      ['waiver configuration', {
        waiverText: 'Changed text', waiverVersion: 'v2',
      }],
      ['registration custom fields', {
        customFields: [{
          key: 'dob', label: 'Date of birth', type: 'date', required: true,
        }],
      }],
      ['volunteer comp configuration', {
        volunteerEnabled: true,
        volunteerFields: [{
          key: 'role', label: 'Role', type: 'text', required: true,
        }],
      }],
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

  test('admin CANNOT collectionGroup-list registrations across events', async () => {
    await seed('events/e2/registrations/r2', {
      eventId: 'e2',
      status: 'paid',
      amountCents: 5000,
    });
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertFails(admin.collectionGroup('registrations').get());
  });
});
