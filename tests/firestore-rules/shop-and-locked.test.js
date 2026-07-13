/* eslint-env jest */

const {
  clearFirestore, teardown, db, seed, assertFails, assertSucceeds,
} = require('./setup');

beforeEach(clearFirestore);
afterAll(teardown);

const UNSAFE_SCRIPT_URL = ['javascript', 'alert(1)'].join(':');

function adminProduct(slug, overrides = {}) {
  return {
    slug,
    title: 'MPRC Hat',
    description: 'A lightweight running hat',
    priceCents: 0,
    imageUrl: null,
    sizes: [],
    colors: [],
    status: 'draft',
    createdBy: 'a1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function productEditorUpdate(overrides = {}) {
  return {
    title: 'Updated MPRC Hat',
    description: 'Updated description',
    priceCents: 0,
    imageUrl: 'https://example.com/hat.jpg',
    sizes: [],
    colors: [],
    status: 'draft',
    updatedAt: new Date(),
    ...overrides,
  };
}

function withoutField(value, field) {
  const copy = { ...value };
  delete copy[field];
  return copy;
}

const INVALID_SLUGS = ['Bad-Slug', 'bad slug', 'bad?query', 'résumé'];

describe('products collection', () => {
  test('anonymous CAN read active product', async () => {
    await seed('products/hat', { status: 'active', title: 'Hat', priceCents: 1000 });
    const anon = await db();
    await assertSucceeds(anon.doc('products/hat').get());
  });

  test('anonymous CAN read sold_out product', async () => {
    await seed('products/jacket', { status: 'sold_out', title: 'Jacket', priceCents: 1500 });
    const anon = await db();
    await assertSucceeds(anon.doc('products/jacket').get());
  });

  test('anonymous CANNOT read draft product', async () => {
    await seed('products/secret', { status: 'draft', title: 'Secret', priceCents: 0 });
    const anon = await db();
    await assertFails(anon.doc('products/secret').get());
  });

  test('anonymous CANNOT read archived product', async () => {
    await seed('products/old', { status: 'archived', title: 'Retired', priceCents: 0 });
    const anon = await db();
    await assertFails(anon.doc('products/old').get());
  });

  test('admin CAN read draft product through the explicit products rule', async () => {
    await seed('products/secret', { status: 'draft', title: 'Secret', priceCents: 0 });
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertSucceeds(admin.doc('products/secret').get());
  });

  test('anonymous CANNOT create a product', async () => {
    const anon = await db();
    await assertFails(anon.doc('products/new').set({ status: 'active' }));
  });

  test('member CANNOT create a product', async () => {
    const member = await db({ uid: 'u1', role: 'member' });
    await assertFails(member.doc('products/new').set({ status: 'active' }));
  });

  test('admin CAN create a product', async () => {
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertSucceeds(admin.doc('products/new').set(adminProduct('new')));
  });

  test('admin CAN deliberately create a zero-price draft product', async () => {
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertSucceeds(admin.doc('products/free').set(adminProduct('free', {
      priceCents: 0,
    })));
  });

  test.each(INVALID_SLUGS)('admin CANNOT create a product with invalid slug %s', async (slug) => {
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertFails(admin.doc(`products/${slug}`).set(adminProduct(slug)));
  });

  test('admin CAN update a product with the current editor payload', async () => {
    await seed('products/hat', adminProduct('hat'));
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertSucceeds(admin.doc('products/hat').update(productEditorUpdate()));
  });

  test('admin CAN edit content while preserving a server-owned product price', async () => {
    const sizes = ['One size'];
    const colors = ['Navy'];
    await seed('products/hat', adminProduct('hat', {
      priceCents: 1000,
      status: 'active',
      sizes,
      colors,
    }));
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertSucceeds(admin.doc('products/hat').update({
      ...productEditorUpdate({ status: 'active' }),
      priceCents: 1000,
      sizes,
      colors,
    }));
  });

  test('admin CANNOT delete a product directly', async () => {
    await seed('products/hat', adminProduct('hat'));
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertFails(admin.doc('products/hat').delete());
  });

  test.each([
    ['a user without a role claim', { uid: 'u1' }],
    ['an unverified user', { uid: 'u2', role: 'unverified' }],
    ['a member', { uid: 'u3', role: 'member' }],
  ])('%s CANNOT update or delete a product', async (_label, auth) => {
    await seed('products/hat', adminProduct('hat'));
    const user = await db(auth);
    await assertFails(user.doc('products/hat').update({ title: 'Unauthorized' }));
    await assertFails(user.doc('products/hat').delete());
  });

  test.each([
    ['a missing title', (product) => withoutField(product, 'title')],
    ['an empty title', (product) => ({ ...product, title: '' })],
    ['a missing price', (product) => withoutField(product, 'priceCents')],
    ['a negative price', (product) => ({ ...product, priceCents: -1 })],
    ['an active zero price', (product) => ({
      ...product,
      status: 'active',
      priceCents: 0,
    })],
    ['a fractional price', (product) => ({ ...product, priceCents: 1.5 })],
    ['a NaN price', (product) => ({ ...product, priceCents: Number.NaN })],
    ['an unknown status', (product) => ({ ...product, status: 'unexpected' })],
    ['a string size list', (product) => ({ ...product, sizes: 'S,M,L' })],
    ['configured sizes', (product) => ({ ...product, sizes: ['S', 'M'] })],
    ['configured colors', (product) => ({ ...product, colors: ['Navy'] })],
    ['an unsafe image URL', (product) => ({
      ...product, imageUrl: UNSAFE_SCRIPT_URL,
    })],
    ['a missing creation timestamp', (product) => withoutField(product, 'createdAt')],
    ['only slug and creator', (product) => ({
      slug: product.slug,
      createdBy: product.createdBy,
    })],
  ])('admin CANNOT create a product with %s', async (_label, buildInvalid) => {
    const admin = await db({ uid: 'a1', role: 'admin' });
    const product = buildInvalid(adminProduct('invalid'));
    await assertFails(admin.doc('products/invalid').set(product));
  });

  test.each([
    ['an empty title', { title: '' }],
    ['a negative price', { priceCents: -1 }],
    ['an active zero price', { status: 'active', priceCents: 0 }],
    ['a fractional price', { priceCents: 1.5 }],
    ['a NaN price', { priceCents: Number.NaN }],
    ['an unknown status', { status: 'unexpected' }],
    ['a string size list', { sizes: 'S,M,L' }],
    ['configured sizes', { sizes: ['S', 'M'] }],
    ['configured colors', { colors: ['Navy'] }],
    ['an unsafe image URL', { imageUrl: UNSAFE_SCRIPT_URL }],
    ['an invalid updatedAt', { updatedAt: 'not-a-timestamp' }],
  ])('admin CANNOT update a product with %s', async (_label, patch) => {
    await seed('products/hat', adminProduct('hat'));
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertFails(admin.doc('products/hat').update(patch));
  });

  test.each([
    ['mismatched slug', { slug: 'different' }],
    ['mismatched creator', { createdBy: 'attacker' }],
    ['non-zero price', { priceCents: 1000 }],
    ['active status', { status: 'active', priceCents: 1000 }],
    ['checkout enablement', { checkoutEnabled: true }],
    ['Stripe product ID', { stripeProductId: 'prod_test' }],
    ['Stripe price ID', { stripePriceId: 'price_test' }],
    ['inventory state', { inventory: { onHand: 10, reserved: 0 } }],
    ['payment state', { paymentStatus: 'paid' }],
    ['audit data', { auditLog: [{ action: 'created' }] }],
  ])('admin CANNOT create a product containing protected %s', async (_label, patch) => {
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertFails(
      admin.doc('products/protected').set(adminProduct('protected', patch)),
    );
  });

  test.each([
    ['slug', { slug: 'changed' }],
    ['creator', { createdBy: 'attacker' }],
    ['creation timestamp', { createdAt: new Date(0) }],
    ['availability status', { status: 'active' }],
    ['checkout enablement', { checkoutEnabled: true }],
    ['Stripe product ID', { stripeProductId: 'prod_test' }],
    ['Stripe price ID', { stripePriceId: 'price_test' }],
    ['inventory state', { inventory: { onHand: 10, reserved: 0 } }],
    ['variant state', { variants: [{ sku: 'hat-navy' }] }],
    ['payment state', { paymentStatus: 'paid' }],
    ['audit data', { auditLog: [{ action: 'tampered' }] }],
  ])('admin CANNOT update protected product %s', async (_label, patch) => {
    await seed('products/hat', adminProduct('hat'));
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertFails(admin.doc('products/hat').update(patch));
  });
});

describe('products list queries (rules-are-not-filters)', () => {
  beforeEach(async () => {
    await seed('products/hat', { status: 'active', title: 'Hat', priceCents: 1000 });
    await seed('products/old', { status: 'archived', title: 'Retired', priceCents: 0 });
  });

  test('anonymous CANNOT list the whole products collection', async () => {
    // Unconstrained list could surface draft/archived docs, so it is denied.
    const anon = await db();
    await assertFails(anon.collection('products').get());
  });

  test('anonymous CAN list active/sold_out products (mirrors shopService)', async () => {
    const anon = await db();
    await assertSucceeds(
      anon.collection('products').where('status', 'in', ['active', 'sold_out']).get(),
    );
  });

  test('anonymous CANNOT list archived products', async () => {
    const anon = await db();
    await assertFails(
      anon.collection('products').where('status', '==', 'archived').get(),
    );
  });

  test('admin CAN list all products for the current admin screen', async () => {
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertSucceeds(admin.collection('products').get());
  });
});

describe('orders collection', () => {
  beforeEach(async () => {
    await seed('orders/o1', {
      productSlug: 'hat',
      buyer: { email: 'buyer@example.com' },
      amountCents: 1000,
      status: 'paid',
    });
  });

  test('anonymous CANNOT read an order', async () => {
    const anon = await db();
    await assertFails(anon.doc('orders/o1').get());
  });

  test('member CANNOT read an order', async () => {
    const m = await db({ uid: 'u1', role: 'member' });
    await assertFails(m.doc('orders/o1').get());
  });

  test('admin CAN read an order through the explicit orders rule', async () => {
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertSucceeds(admin.doc('orders/o1').get());
  });

  test('admin CAN list orders for the current admin screen', async () => {
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertSucceeds(admin.collection('orders').get());
  });

  test('anonymous CANNOT write an order', async () => {
    const anon = await db();
    await assertFails(anon.doc('orders/o2').set({ status: 'paid' }));
  });

  test('member CANNOT write an order', async () => {
    const m = await db({ uid: 'u1', role: 'member' });
    await assertFails(m.doc('orders/o2').set({ status: 'paid' }));
  });

  test('admin CANNOT create an order directly', async () => {
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertFails(admin.doc('orders/o2').set({ status: 'paid' }));
  });

  test('admin CANNOT update order financial state directly', async () => {
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertFails(admin.doc('orders/o1').update({
      status: 'refunded',
      amountCents: 0,
    }));
  });

  test('admin CANNOT delete an order directly', async () => {
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertFails(admin.doc('orders/o1').delete());
  });
});

describe('server-only operational collections', () => {
  describe('systemConfig/commerce', () => {
    const existingPath = 'systemConfig/commerce';
    const newPath = 'systemConfig/commerce-probe';
    const control = {
      schemaVersion: 1,
      revision: 1,
      newCommerceEnabled: false,
      raceRegistrationEnabled: false,
      merchandiseCheckoutEnabled: false,
      incidentRefundsEnabled: true,
    };

    test.each([
      ['anonymous', undefined],
      ['member', { uid: 'member-1', role: 'member' }],
      ['browser admin', { uid: 'admin-1', role: 'admin' }],
    ])('%s CANNOT read or write the commerce control', async (_label, auth) => {
      await seed(existingPath, control);
      const client = await db(auth);

      await assertFails(client.doc(existingPath).get());
      await assertFails(client.doc(newPath).set(control));
      await assertFails(client.doc(existingPath).update({ newCommerceEnabled: true }));
      await assertFails(client.doc(existingPath).delete());
    });
  });

  describe.each([
    ['promoCodes/PROMO1', 'promoCodes/PROMO2', { discountPercent: 10 }],
    ['ratelimits/checkout_ip__1.2.3.4', 'ratelimits/checkout_ip__5.6.7.8', { count: 5 }],
    ['mail/message1', 'mail/message2', { to: ['runner@example.com'] }],
    ['stripeEvents/evt_test_1', 'stripeEvents/evt_test_2', { status: 'processed' }],
    ['checkoutRequests/request1', 'checkoutRequests/request2', { status: 'created' }],
    ['auditEvents/audit1', 'auditEvents/audit2', { action: 'refund' }],
    ['retentionJobs/job1', 'retentionJobs/job2', { status: 'queued' }],
    ['products/hat/variants/black-m', 'products/hat/variants/black-l', { onHand: 5 }],
    ['events/e1/auditEvents/audit1', 'events/e1/auditEvents/audit2', { action: 'edit' }],
  ])('%s', (path_, newPath, sample) => {
    test('anonymous CANNOT read', async () => {
      await seed(path_, sample);
      const anon = await db();
      await assertFails(anon.doc(path_).get());
    });

    test('member CANNOT read', async () => {
      await seed(path_, sample);
      const m = await db({ uid: 'u1', role: 'member' });
      await assertFails(m.doc(path_).get());
    });

    test('anonymous CANNOT write', async () => {
      const anon = await db();
      await assertFails(anon.doc(path_).set(sample));
    });

    test('admin CANNOT read', async () => {
      await seed(path_, sample);
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertFails(admin.doc(path_).get());
    });

    test('admin CANNOT create, update, or delete', async () => {
      await seed(path_, sample);
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertFails(admin.doc(newPath).set(sample));
      await assertFails(admin.doc(path_).update({ probe: true }));
      await assertFails(admin.doc(path_).delete());
    });
  });

  test.each([
    ['variants', 'products/hat/variants/black-m', { onHand: 5 }],
    ['auditEvents', 'events/e1/auditEvents/audit1', { action: 'edit' }],
  ])('admin CANNOT collectionGroup-list protected %s', async (group, path_, sample) => {
    await seed(path_, sample);
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertFails(admin.collectionGroup(group).get());
  });
});

describe('default-deny boundary', () => {
  test('admin CANNOT read an arbitrary future collection', async () => {
    await seed('totallyMadeUp/x', { foo: 'bar' });
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertFails(admin.doc('totallyMadeUp/x').get());
  });

  test('admin CANNOT create, update, or delete in an arbitrary future collection', async () => {
    await seed('totallyMadeUp/x', { foo: 'bar' });
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertFails(admin.doc('totallyMadeUp/new').set({ foo: 'bar' }));
    await assertFails(admin.doc('totallyMadeUp/x').update({ foo: 'changed' }));
    await assertFails(admin.doc('totallyMadeUp/x').delete());
  });

  test('non-admin CANNOT read an arbitrary collection', async () => {
    await seed('totallyMadeUp/x', { foo: 'bar' });
    const m = await db({ uid: 'u1', role: 'member' });
    await assertFails(m.doc('totallyMadeUp/x').get());
  });

  test('user with role=member is NOT treated as admin', async () => {
    await seed('orders/o1', { status: 'paid' });
    const m = await db({ uid: 'u1', role: 'member' });
    await assertFails(m.doc('orders/o1').get());
  });

  test('user with no role claim is NOT treated as admin', async () => {
    await seed('orders/o1', { status: 'paid' });
    const u = await db({ uid: 'u1' });
    await assertFails(u.doc('orders/o1').get());
  });
});
