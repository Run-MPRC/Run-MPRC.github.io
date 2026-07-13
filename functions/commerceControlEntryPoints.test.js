const mockStripeConstructor = jest.fn();
const mockRefundCreate = jest.fn();
const mockProductCreate = jest.fn();
const mockPriceCreate = jest.fn();
const mockPaymentLinkCreate = jest.fn();
const mockBusinessWrite = jest.fn();

jest.mock('stripe', () => mockStripeConstructor);

jest.mock('firebase-functions', () => {
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  const https = {
    HttpsError,
    onCall: (handler) => handler,
    onRequest: (handler) => handler,
  };
  return {
    https,
    runWith: () => ({ https }),
  };
});

jest.mock('firebase-admin', () => {
  const store = new Map();
  let autoId = 0;

  class Snapshot {
    constructor(ref) {
      this.ref = ref;
      this.id = ref.id;
      this.exists = store.has(ref.path);
    }

    data() {
      return store.get(this.ref.path);
    }
  }

  class DocumentReference {
    constructor(path) {
      this.path = path;
      this.id = path.split('/').at(-1);
    }

    collection(name) {
      return new CollectionReference(`${this.path}/${name}`);
    }

    async get() {
      return new Snapshot(this);
    }

    async set(data) {
      mockBusinessWrite('set', this.path, data);
      store.set(this.path, { ...data });
    }

    async update(data) {
      mockBusinessWrite('update', this.path, data);
      store.set(this.path, { ...(store.get(this.path) || {}), ...data });
    }
  }

  class CollectionReference {
    constructor(path) {
      this.path = path;
    }

    doc(id) {
      let resolvedId = id;
      if (!resolvedId) {
        autoId += 1;
        resolvedId = `auto-${autoId}`;
      }
      return new DocumentReference(`${this.path}/${resolvedId}`);
    }
  }

  const firestore = {
    collection: (name) => new CollectionReference(name),
    getAll: async (...refs) => refs.map((ref) => new Snapshot(ref)),
  };
  const firestoreFunction = () => firestore;
  firestoreFunction.FieldValue = { arrayUnion: (value) => [value] };

  return {
    apps: [{}],
    firestore: firestoreFunction,
    __clear: () => {
      store.clear();
      autoId = 0;
    },
    __seed: (path, data) => store.set(path, { ...data }),
    __get: (path) => store.get(path),
  };
});

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { arrayUnion: (value) => [value] },
  Timestamp: { now: () => ({ _milliseconds: 1_800_000_000_000 }) },
}));

const admin = require('firebase-admin');
const { adminRegistrationAction } = require('./adminRegistrationAction');
const { adminOrderAction } = require('./adminOrderAction');

function control(overrides = {}) {
  return {
    schemaVersion: 1,
    revision: 1,
    newCommerceEnabled: true,
    raceRegistrationEnabled: true,
    merchandiseCheckoutEnabled: true,
    incidentRefundsEnabled: true,
    ...overrides,
  };
}

function adminContext() {
  return {
    app: { appId: 'synthetic-app' },
    auth: {
      uid: 'admin-1',
      token: { role: 'admin', email: 'officer@example.test' },
    },
  };
}

function registrationInput(amountCents) {
  return {
    runner: {
      firstName: 'Test',
      lastName: 'Runner',
      email: 'runner@example.test',
    },
    amountCents,
    priceTier: amountCents === 0 ? 'comp' : 'nonMember',
  };
}

describe('commerce admission at admin entry points', () => {
  beforeEach(() => {
    admin.__clear();
    mockBusinessWrite.mockClear();
    mockRefundCreate.mockReset();
    mockProductCreate.mockReset();
    mockPriceCreate.mockReset();
    mockPaymentLinkCreate.mockReset();
    mockStripeConstructor.mockReset();
    mockStripeConstructor.mockReturnValue({
      refunds: { create: mockRefundCreate },
      products: { create: mockProductCreate },
      prices: { create: mockPriceCreate },
      paymentLinks: { create: mockPaymentLinkCreate },
    });
    mockRefundCreate.mockResolvedValue({ id: 're_synthetic' });
    mockProductCreate.mockResolvedValue({ id: 'prod_synthetic' });
    mockPriceCreate.mockResolvedValue({ id: 'price_synthetic' });
    mockPaymentLinkCreate.mockResolvedValue({
      id: 'plink_synthetic',
      url: 'https://buy.stripe.test/synthetic',
    });
    process.env.ENVIRONMENT_NAME = 'test';
    process.env.SITE_ORIGIN = 'https://runmprc.test';
    process.env.STRIPE_LIVEMODE_EXPECTED = 'false';
    process.env.STRIPE_SECRET_KEY = [
      'sk', 'test', 'synthetic_commerce_control',
    ].join('_');
    process.env.COMMERCE_ENABLED = 'true';
    process.env.ENFORCE_APP_CHECK = 'false';
  });

  afterAll(() => {
    delete process.env.ENVIRONMENT_NAME;
    delete process.env.SITE_ORIGIN;
    delete process.env.STRIPE_LIVEMODE_EXPECTED;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.COMMERCE_ENABLED;
    delete process.env.ENFORCE_APP_CHECK;
  });

  test.each([
    ['mark_comp', registrationInput(0)],
    ['add_late_registration', registrationInput(0)],
    ['add_late_registration', registrationInput(2500)],
  ])('blocks admin %s before registration or Stripe work', async (action, registration) => {
    admin.__seed('systemConfig/commerce', control({ newCommerceEnabled: false }));
    admin.__seed('events/race-1', {
      checkoutEnabled: true,
      title: 'Synthetic Race',
      slug: 'synthetic-race',
    });

    await expect(adminRegistrationAction({
      eventId: 'race-1',
      action,
      payload: { registration },
    }, adminContext())).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'Commerce is temporarily unavailable',
    });

    expect(mockBusinessWrite).not.toHaveBeenCalled();
    expect(mockStripeConstructor).not.toHaveBeenCalled();
    expect(mockProductCreate).not.toHaveBeenCalled();
    expect(mockPriceCreate).not.toHaveBeenCalled();
    expect(mockPaymentLinkCreate).not.toHaveBeenCalled();
  });

  test.each([
    ['mark_comp', registrationInput(0), 0],
    ['add_late_registration', registrationInput(0), 0],
    ['add_late_registration', registrationInput(2500), 1],
  ])('keeps admitted admin %s behavior available', async (
    action,
    registration,
    expectedProviderCreates,
  ) => {
    admin.__seed('systemConfig/commerce', control());
    admin.__seed('events/race-1', {
      checkoutEnabled: true,
      title: 'Synthetic Race',
      slug: 'synthetic-race',
      waiverVersion: 'synthetic-v1',
    });

    await expect(adminRegistrationAction({
      eventId: 'race-1',
      action,
      payload: { registration },
    }, adminContext())).resolves.toMatchObject({
      ok: true,
      registrationId: 'auto-1',
    });

    expect(admin.__get('events/race-1/registrations/auto-1')).toMatchObject({
      eventId: 'race-1',
      amountCents: registration.amountCents,
    });
    expect(mockProductCreate).toHaveBeenCalledTimes(expectedProviderCreates);
    expect(mockPriceCreate).toHaveBeenCalledTimes(expectedProviderCreates);
    expect(mockPaymentLinkCreate).toHaveBeenCalledTimes(expectedProviderCreates);
  });

  test.each([
    ['registration', adminRegistrationAction, {
      eventId: 'race-1',
      registrationId: 'reg-1',
      action: 'refund_full',
    }, 'events/race-1/registrations/reg-1'],
    ['order', adminOrderAction, {
      orderId: 'order-1',
      action: 'refund_full',
    }, 'orders/order-1'],
  ])('blocks %s refund when incident refunds are off', async (
    _name,
    handler,
    data,
    recordPath,
  ) => {
    admin.__seed('systemConfig/commerce', control({ incidentRefundsEnabled: false }));
    admin.__seed(recordPath, {
      status: 'paid',
      amountCents: 2500,
      stripePaymentIntentId: 'pi_synthetic',
    });

    await expect(handler(data, adminContext())).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'Commerce is temporarily unavailable',
    });

    expect(mockRefundCreate).not.toHaveBeenCalled();
    expect(mockBusinessWrite).not.toHaveBeenCalled();
  });

  test.each([
    ['registration', adminRegistrationAction, {
      eventId: 'race-1',
      registrationId: 'reg-1',
      action: 'refund_full',
    }, 'events/race-1/registrations/reg-1'],
    ['order', adminOrderAction, {
      orderId: 'order-1',
      action: 'refund_full',
    }, 'orders/order-1'],
  ])('admits %s refund independently while new commerce is off', async (
    _name,
    handler,
    data,
    recordPath,
  ) => {
    process.env.COMMERCE_ENABLED = 'false';
    admin.__seed('systemConfig/commerce', control({
      newCommerceEnabled: false,
      raceRegistrationEnabled: false,
      merchandiseCheckoutEnabled: false,
      incidentRefundsEnabled: true,
    }));
    admin.__seed(recordPath, {
      status: 'paid',
      amountCents: 2500,
      stripePaymentIntentId: 'pi_synthetic',
    });

    await expect(handler(data, adminContext())).resolves.toMatchObject({
      ok: true,
      refundId: 're_synthetic',
    });

    expect(mockRefundCreate).toHaveBeenCalledWith({
      payment_intent: 'pi_synthetic',
    });
    expect(mockBusinessWrite).toHaveBeenCalledTimes(1);
  });

  test('existing-record note bypasses an absent runtime commerce control', async () => {
    process.env.COMMERCE_ENABLED = 'false';
    admin.__seed('events/race-1/registrations/reg-1', {
      status: 'paid',
      amountCents: 0,
    });

    await expect(adminRegistrationAction({
      eventId: 'race-1',
      registrationId: 'reg-1',
      action: 'add_note',
      payload: { note: 'Synthetic note' },
    }, adminContext())).resolves.toEqual({ ok: true });

    expect(mockBusinessWrite).toHaveBeenCalledTimes(1);
    expect(mockRefundCreate).not.toHaveBeenCalled();
  });

  test('order fulfillment work bypasses the new-commerce pause', async () => {
    process.env.COMMERCE_ENABLED = 'false';
    admin.__seed('orders/order-1', {
      status: 'paid',
      amountCents: 2500,
    });

    await expect(adminOrderAction({
      orderId: 'order-1',
      action: 'mark_fulfilled',
      payload: { note: 'Synthetic fulfillment' },
    }, adminContext())).resolves.toEqual({ ok: true });

    expect(admin.__get('orders/order-1')).toMatchObject({ status: 'fulfilled' });
    expect(mockBusinessWrite).toHaveBeenCalledTimes(1);
    expect(mockRefundCreate).not.toHaveBeenCalled();
  });

  test('App Check and admin authorization keep precedence over commerce state', async () => {
    process.env.ENFORCE_APP_CHECK = 'true';

    await expect(adminOrderAction({
      orderId: 'order-1',
      action: 'refund_full',
    }, { auth: null })).rejects.toMatchObject({ code: 'failed-precondition' });

    process.env.ENFORCE_APP_CHECK = 'false';
    await expect(adminOrderAction({
      orderId: 'order-1',
      action: 'refund_full',
    }, { auth: null })).rejects.toMatchObject({ code: 'unauthenticated' });

    expect(mockRefundCreate).not.toHaveBeenCalled();
    expect(mockBusinessWrite).not.toHaveBeenCalled();
  });
});
