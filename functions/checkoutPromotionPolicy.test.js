const mockCheckoutCreate = jest.fn();
const mockProductCreate = jest.fn();

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
  let registrationSequence = 0;
  let orderSequence = 0;

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
      store.set(this.path, { ...data });
    }

    async update(data) {
      store.set(this.path, { ...(store.get(this.path) || {}), ...data });
    }
  }

  class CollectionReference {
    constructor(path) {
      this.path = path;
    }

    doc(id) {
      let resolvedId = id;
      if (!resolvedId && this.path.endsWith('/registrations')) {
        registrationSequence += 1;
        resolvedId = `reg-new-${registrationSequence}`;
      } else if (!resolvedId && this.path === 'orders') {
        orderSequence += 1;
        resolvedId = `order-new-${orderSequence}`;
      }
      return new DocumentReference(`${this.path}/${resolvedId}`);
    }
  }

  const firestore = {
    collection: (name) => new CollectionReference(name),
  };

  return {
    apps: [{}],
    firestore: () => firestore,
    __clear: () => {
      store.clear();
      registrationSequence = 0;
      orderSequence = 0;
    },
    __seed: (path, data) => store.set(path, { ...data }),
    __get: (path) => store.get(path),
  };
});

jest.mock('./stripeHelpers', () => ({
  getStripe: () => ({
    checkout: { sessions: { create: mockCheckoutCreate } },
    products: { create: mockProductCreate },
  }),
  generateToken: () => 'synthetic-confirmation-token',
  resolveCallerRole: async () => null,
  requireAppCheck: () => {},
  validateRunner: () => [],
  pickPriceCents: (event, tier) => event.pricing?.[`${tier}Cents`] ?? null,
  isEarlyBirdActive: () => false,
  isRegistrationOpen: () => true,
  countActiveRegistrations: async () => 0,
  auditEntry: ({ action, note }) => ({ action, note }),
  isValidEmail: () => true,
  Timestamp: { now: () => ({ _milliseconds: 1_800_000_000_000 }) },
}));

jest.mock('./rateLimit', () => ({
  checkRateLimit: async () => {},
  extractIp: () => 'synthetic-test-ip',
}));

const admin = require('firebase-admin');
const { createCheckoutSession } = require('./createCheckoutSession');
const { createMerchCheckout } = require('./createMerchCheckout');

describe('Checkout promotion policy', () => {
  beforeEach(() => {
    admin.__clear();
    mockCheckoutCreate.mockReset();
    mockProductCreate.mockReset();
    mockCheckoutCreate.mockImplementation(async (payload) => ({
      id: payload.metadata.type === 'merch' ? 'cs_order_policy' : 'cs_registration_policy',
      url: 'https://checkout.stripe.test/synthetic-session',
    }));
    process.env.SITE_ORIGIN = 'https://runmprc.test';
  });

  afterAll(() => {
    delete process.env.SITE_ORIGIN;
  });

  test('race checkout sends the exact disabled-adjustment payload', async () => {
    admin.__seed('events/race-1', {
      title: 'Synthetic Race',
      description: 'Synthetic test event',
      slug: 'synthetic-race',
      status: 'open',
      visibility: 'public',
      pricing: { nonMemberCents: 5000 },
      stripeProductId: 'prod_race_policy',
      waiverVersion: 'synthetic-v1',
    });

    const result = await createCheckoutSession({
      eventId: 'race-1',
      runner: {
        firstName: 'Test',
        lastName: 'Runner',
        email: 'runner@example.test',
      },
      priceTier: 'nonMember',
      acceptedWaiver: true,
    }, { auth: null, rawRequest: {} });

    expect(mockCheckoutCreate).toHaveBeenCalledTimes(1);
    const expectedMetadata = {
      schemaVersion: '1',
      eventId: 'race-1',
      registrationId: 'reg-new-1',
      priceTier: 'nonMember',
    };
    expect(mockCheckoutCreate).toHaveBeenCalledWith({
      mode: 'payment',
      customer_email: 'runner@example.test',
      allow_promotion_codes: false,
      automatic_tax: { enabled: false },
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: 5000,
          product: 'prod_race_policy',
        },
        quantity: 1,
      }],
      success_url: 'https://runmprc.test/register/success?session_id={CHECKOUT_SESSION_ID}&reg=reg-new-1&token=synthetic-confirmation-token&event=race-1',
      cancel_url: 'https://runmprc.test/events/synthetic-race?cancelled=1',
      metadata: expectedMetadata,
      payment_intent_data: { metadata: expectedMetadata },
    });
    expect(result).toMatchObject({
      sessionId: 'cs_registration_policy',
      registrationId: 'reg-new-1',
    });
    expect(admin.__get('events/race-1/registrations/reg-new-1')).toMatchObject({
      amountCents: 5000,
      currency: 'usd',
      promoCode: null,
      stripeSessionId: 'cs_registration_policy',
    });
    expect(mockProductCreate).not.toHaveBeenCalled();
  });

  test('merchandise checkout sends the exact disabled-adjustment payload', async () => {
    admin.__seed('products/hat', {
      title: 'Synthetic Hat',
      description: 'Synthetic test product',
      slug: 'hat',
      status: 'active',
      priceCents: 2000,
      sizes: ['M'],
      colors: ['blue'],
      stripeProductId: 'prod_hat_policy',
    });

    const result = await createMerchCheckout({
      productSlug: 'hat',
      buyer: {
        firstName: 'Test',
        lastName: 'Buyer',
        email: 'buyer@example.test',
      },
      size: 'M',
      color: 'blue',
    }, { auth: null, rawRequest: {} });

    expect(mockCheckoutCreate).toHaveBeenCalledTimes(1);
    const expectedMetadata = {
      schemaVersion: '1',
      type: 'merch',
      productSlug: 'hat',
      orderId: 'order-new-1',
      size: 'M',
      color: 'blue',
    };
    expect(mockCheckoutCreate).toHaveBeenCalledWith({
      mode: 'payment',
      customer_email: 'buyer@example.test',
      allow_promotion_codes: false,
      automatic_tax: { enabled: false },
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: 2000,
          product: 'prod_hat_policy',
        },
        quantity: 1,
      }],
      shipping_address_collection: { allowed_countries: ['US', 'CA'] },
      phone_number_collection: { enabled: true },
      success_url: 'https://runmprc.test/shop/purchase/success?session_id={CHECKOUT_SESSION_ID}&order=order-new-1&token=synthetic-confirmation-token',
      cancel_url: 'https://runmprc.test/shop/hat?cancelled=1',
      metadata: expectedMetadata,
      payment_intent_data: { metadata: expectedMetadata },
    });
    expect(result).toMatchObject({
      sessionId: 'cs_order_policy',
      orderId: 'order-new-1',
    });
    expect(admin.__get('orders/order-new-1')).toMatchObject({
      amountCents: 2000,
      currency: 'usd',
      stripeSessionId: 'cs_order_policy',
    });
    expect(mockProductCreate).not.toHaveBeenCalled();
  });
});
