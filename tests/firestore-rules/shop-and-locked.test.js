const {
  clearFirestore, teardown, db, seed, assertFails, assertSucceeds,
} = require('./setup');

beforeEach(clearFirestore);
afterAll(teardown);

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

  test('admin CAN read draft product (via catch-all)', async () => {
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
    await assertSucceeds(admin.doc('products/new').set({
      status: 'active', title: 'Hat', priceCents: 1000,
    }));
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

  test('admin CAN read an order (via catch-all)', async () => {
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertSucceeds(admin.doc('orders/o1').get());
  });

  test('anonymous CANNOT write an order', async () => {
    const anon = await db();
    await assertFails(anon.doc('orders/o2').set({ status: 'paid' }));
  });

  test('member CANNOT write an order', async () => {
    const m = await db({ uid: 'u1', role: 'member' });
    await assertFails(m.doc('orders/o2').set({ status: 'paid' }));
  });

  test('admin CAN write an order (via catch-all)', async () => {
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertSucceeds(admin.doc('orders/o2').set({ status: 'paid' }));
  });
});

describe('locked-down collections (server/admin only)', () => {
  describe.each([
    ['promoCodes/PROMO1', { discountPercent: 10 }],
    ['ratelimits/checkout_ip__1.2.3.4', { count: 5 }],
  ])('%s', (path_, sample) => {
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

    test('admin CAN read (via catch-all)', async () => {
      await seed(path_, sample);
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertSucceeds(admin.doc(path_).get());
    });

    test('admin CAN write (via catch-all)', async () => {
      const admin = await db({ uid: 'a1', role: 'admin' });
      await assertSucceeds(admin.doc(path_).set(sample));
    });
  });
});

describe('catch-all admin rule', () => {
  test('admin can read an arbitrary collection that has no specific rule', async () => {
    await seed('totallyMadeUp/x', { foo: 'bar' });
    const admin = await db({ uid: 'a1', role: 'admin' });
    await assertSucceeds(admin.doc('totallyMadeUp/x').get());
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
