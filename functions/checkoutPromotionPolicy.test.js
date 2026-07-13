const mockCheckoutCreate = jest.fn();
const mockProductCreate = jest.fn();
const mockGetStripe = jest.fn();
const mockRateLimit = jest.fn();
const mockFirestoreAccess = jest.fn();

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
    getAll: async (...refs) => refs.map((ref) => new Snapshot(ref)),
  };

  return {
    apps: [{}],
    firestore: () => {
      mockFirestoreAccess();
      return firestore;
    },
    __clear: () => {
      store.clear();
      registrationSequence = 0;
      orderSequence = 0;
    },
    __seed: (path, data) => store.set(path, { ...data }),
    __delete: (path) => store.delete(path),
    __get: (path) => store.get(path),
  };
});

jest.mock('./stripeHelpers', () => ({
  getStripe: mockGetStripe,
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
  checkRateLimit: mockRateLimit,
  extractIp: () => 'synthetic-test-ip',
}));

const admin = require('firebase-admin');
const { createCheckoutSession } = require('./createCheckoutSession');
const { createMerchCheckout } = require('./createMerchCheckout');

describe('Checkout promotion policy', () => {
  beforeEach(() => {
    admin.__clear();
    admin.__seed('systemConfig/commerce', {
      schemaVersion: 1,
      revision: 1,
      newCommerceEnabled: true,
      raceRegistrationEnabled: true,
      merchandiseCheckoutEnabled: true,
      incidentRefundsEnabled: true,
    });
    mockCheckoutCreate.mockReset();
    mockProductCreate.mockReset();
    mockGetStripe.mockReset();
    mockRateLimit.mockReset();
    mockFirestoreAccess.mockClear();
    mockGetStripe.mockReturnValue({
      checkout: { sessions: { create: mockCheckoutCreate } },
      products: { create: mockProductCreate },
    });
    mockRateLimit.mockResolvedValue(undefined);
    mockCheckoutCreate.mockImplementation(async (payload) => ({
      id: payload.metadata.type === 'merch' ? 'cs_order_policy' : 'cs_registration_policy',
      url: 'https://checkout.stripe.test/synthetic-session',
    }));
    process.env.ENVIRONMENT_NAME = 'test';
    process.env.SITE_ORIGIN = 'https://runmprc.test';
    process.env.STRIPE_LIVEMODE_EXPECTED = 'false';
    process.env.COMMERCE_ENABLED = 'true';
    process.env.STRIPE_SECRET_KEY = [
      'sk', 'test', 'synthetic_checkout_policy',
    ].join('_');
  });

  afterAll(() => {
    delete process.env.ENVIRONMENT_NAME;
    delete process.env.SITE_ORIGIN;
    delete process.env.STRIPE_LIVEMODE_EXPECTED;
    delete process.env.COMMERCE_ENABLED;
    delete process.env.STRIPE_SECRET_KEY;
  });

  test.each([
    ['paid race checkout', createCheckoutSession, {
      eventId: 'race-1',
      runner: {
        firstName: 'Test',
        lastName: 'Runner',
        email: 'runner@example.test',
      },
      priceTier: 'nonMember',
      acceptedWaiver: true,
    }],
    ['free volunteer checkout', createCheckoutSession, {
      eventId: 'race-1',
      runner: {
        firstName: 'Test',
        lastName: 'Volunteer',
        email: 'volunteer@example.test',
      },
      acceptedWaiver: true,
      signupType: 'volunteer',
    }],
    ['merchandise checkout', createMerchCheckout, {
      productSlug: 'hat',
      buyer: {
        firstName: 'Test',
        lastName: 'Buyer',
        email: 'buyer@example.test',
      },
    }],
  ])('rejects invalid configuration before %s side effects', async (_name, handler, data) => {
    delete process.env.ENVIRONMENT_NAME;

    await expect(handler(data, { auth: null, rawRequest: {} })).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'Server configuration is unavailable',
    });

    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockFirestoreAccess).not.toHaveBeenCalled();
    expect(mockGetStripe).not.toHaveBeenCalled();
    expect(mockProductCreate).not.toHaveBeenCalled();
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  test('deployment ceiling blocks new race commerce before command side effects', async () => {
    process.env.COMMERCE_ENABLED = 'false';
    admin.__seed('events/race-1', {
      checkoutEnabled: true,
      title: 'Synthetic Race',
      status: 'open',
      pricing: { nonMemberCents: 5000 },
      stripeProductId: 'prod_race_policy',
    });

    await expect(createCheckoutSession({
      eventId: 'race-1',
      runner: {
        firstName: 'Test',
        lastName: 'Runner',
        email: 'runner@example.test',
      },
      priceTier: 'nonMember',
      acceptedWaiver: true,
    }, { auth: null, rawRequest: {} })).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'Commerce is temporarily unavailable',
    });

    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockGetStripe).not.toHaveBeenCalled();
    expect(mockProductCreate).not.toHaveBeenCalled();
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  test.each([
    ['missing', undefined],
    ['malformed', { schemaVersion: 1, revision: 1 }],
  ])('%s runtime control blocks merchandise before command side effects', async (
    _name,
    runtimeControl,
  ) => {
    if (runtimeControl) {
      admin.__seed('systemConfig/commerce', runtimeControl);
    } else {
      admin.__delete('systemConfig/commerce');
    }
    admin.__seed('products/hat', {
      checkoutEnabled: true,
      title: 'Synthetic Hat',
      status: 'active',
      priceCents: 2000,
    });

    await expect(createMerchCheckout({
      productSlug: 'hat',
      buyer: {
        firstName: 'Test',
        lastName: 'Buyer',
        email: 'buyer@example.test',
      },
    }, { auth: null, rawRequest: {} })).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'Commerce is temporarily unavailable',
    });

    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockGetStripe).not.toHaveBeenCalled();
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  test('race checkout sends the exact disabled-adjustment payload', async () => {
    admin.__seed('events/race-1', {
      checkoutEnabled: true,
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

  test('admitted volunteer signup remains free and does not call Stripe', async () => {
    admin.__seed('events/race-1', {
      checkoutEnabled: true,
      title: 'Synthetic Race',
      slug: 'synthetic-race',
      status: 'open',
      volunteerEnabled: true,
      waiverVersion: 'synthetic-v1',
    });

    const result = await createCheckoutSession({
      eventId: 'race-1',
      runner: {
        firstName: 'Test',
        lastName: 'Volunteer',
        email: 'volunteer@example.test',
      },
      acceptedWaiver: true,
      signupType: 'volunteer',
    }, { auth: null, rawRequest: {} });

    expect(result).toMatchObject({
      free: true,
      registrationId: 'reg-new-1',
    });
    expect(admin.__get('events/race-1/registrations/reg-new-1')).toMatchObject({
      signupType: 'volunteer',
      status: 'paid',
      amountCents: 0,
    });
    expect(mockGetStripe).not.toHaveBeenCalled();
    expect(mockProductCreate).not.toHaveBeenCalled();
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  test('admitted zero-price participant signup remains free and does not call Stripe', async () => {
    admin.__seed('events/race-1', {
      checkoutEnabled: true,
      title: 'Synthetic Free Race',
      slug: 'synthetic-free-race',
      status: 'open',
      pricing: { nonMemberCents: 0 },
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

    expect(result).toMatchObject({
      free: true,
      registrationId: 'reg-new-1',
    });
    expect(admin.__get('events/race-1/registrations/reg-new-1')).toMatchObject({
      signupType: 'participant',
      status: 'paid',
      amountCents: 0,
    });
    expect(mockGetStripe).not.toHaveBeenCalled();
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  test('merchandise checkout sends the exact disabled-adjustment payload', async () => {
    admin.__seed('products/hat', {
      checkoutEnabled: true,
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

  test.each([
    ['paid race while the global switch is off', createCheckoutSession, {
      eventId: 'race-1',
      runner: {
        firstName: 'Test',
        lastName: 'Runner',
        email: 'runner@example.test',
      },
      priceTier: 'nonMember',
      acceptedWaiver: true,
    }, 'events/race-1', {
      checkoutEnabled: true,
      status: 'open',
      pricing: { nonMemberCents: 5000 },
    }, { newCommerceEnabled: false }],
    ['zero-price participant while the global switch is off', createCheckoutSession, {
      eventId: 'race-1',
      runner: {
        firstName: 'Test',
        lastName: 'Runner',
        email: 'runner@example.test',
      },
      priceTier: 'nonMember',
      acceptedWaiver: true,
    }, 'events/race-1', {
      checkoutEnabled: true,
      status: 'open',
      pricing: { nonMemberCents: 0 },
    }, { newCommerceEnabled: false }],
    ['free volunteer while the event switch is off', createCheckoutSession, {
      eventId: 'race-1',
      runner: {
        firstName: 'Test',
        lastName: 'Volunteer',
        email: 'volunteer@example.test',
      },
      acceptedWaiver: true,
      signupType: 'volunteer',
    }, 'events/race-1', {
      checkoutEnabled: false,
      status: 'open',
      volunteerEnabled: true,
    }, {}],
    ['merchandise while the merchandise domain is off', createMerchCheckout, {
      productSlug: 'hat',
      buyer: {
        firstName: 'Test',
        lastName: 'Buyer',
        email: 'buyer@example.test',
      },
    }, 'products/hat', {
      checkoutEnabled: true,
      status: 'active',
      priceCents: 2000,
    }, { merchandiseCheckoutEnabled: false }],
  ])('blocks %s before command side effects', async (
    _name,
    handler,
    data,
    targetPath,
    targetData,
    controlPatch,
  ) => {
    admin.__seed(targetPath, targetData);
    admin.__seed('systemConfig/commerce', {
      schemaVersion: 1,
      revision: 2,
      newCommerceEnabled: true,
      raceRegistrationEnabled: true,
      merchandiseCheckoutEnabled: true,
      incidentRefundsEnabled: true,
      ...controlPatch,
    });

    await expect(handler(data, { auth: null, rawRequest: {} })).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'Commerce is temporarily unavailable',
    });

    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockGetStripe).not.toHaveBeenCalled();
    expect(mockProductCreate).not.toHaveBeenCalled();
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
    expect(admin.__get('events/race-1/registrations/reg-new-1')).toBeUndefined();
    expect(admin.__get('orders/order-new-1')).toBeUndefined();
  });
});
