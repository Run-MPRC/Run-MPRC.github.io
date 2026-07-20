const mockCheckoutCreate = jest.fn();
const mockProductCreate = jest.fn();
const mockGetStripe = jest.fn();
const mockRateLimit = jest.fn();
const mockFirestoreAccess = jest.fn();
const mockFirestoreWrite = jest.fn();
const mockGenerateToken = jest.fn();
const mockResolveCallerRole = jest.fn();
const mockCountActiveRegistrations = jest.fn();
const mockProjectEventCheckoutAudience = jest.fn();
const mockProjectParticipantCapacityLimit = jest.fn();
const mockPickPriceCents = jest.fn();
const mockIsEarlyBirdActive = jest.fn();
const mockRegistrationAllocation = jest.fn();
const mockOrderAllocation = jest.fn();
const mockProjectStoredStripeProductId = jest.fn();
const mockProjectCreatedStripeProductId = jest.fn();

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
      mockFirestoreWrite(this.path);
      store.set(this.path, { ...data });
    }

    async update(data) {
      mockFirestoreWrite(this.path);
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
        mockRegistrationAllocation(this.path);
        registrationSequence += 1;
        resolvedId = `reg-new-${registrationSequence}`;
      } else if (!resolvedId && this.path === 'orders') {
        mockOrderAllocation(this.path);
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

jest.mock('./stripeHelpers', () => {
  const { resolveVerifiedCallerRole } = jest.requireActual('./verifiedRolePolicy');
  const {
    isEarlyBirdActive,
    pickPriceCents,
    projectEventCheckoutAudience,
    projectParticipantCapacityLimit,
  } = jest.requireActual('./stripeHelpers');
  return {
    getStripe: mockGetStripe,
    generateToken: mockGenerateToken,
    resolveCallerRole: async (context) => {
      mockResolveCallerRole(context);
      return resolveVerifiedCallerRole(context?.auth?.token);
    },
    requireAppCheck: () => {},
    validateRunner: () => [],
    pickPriceCents: (...args) => {
      mockPickPriceCents(...args);
      return pickPriceCents(...args);
    },
    projectEventCheckoutAudience: (...args) => {
      mockProjectEventCheckoutAudience(...args);
      return projectEventCheckoutAudience(...args);
    },
    projectParticipantCapacityLimit: (...args) => {
      mockProjectParticipantCapacityLimit(...args);
      return projectParticipantCapacityLimit(...args);
    },
    isEarlyBirdActive: (...args) => {
      mockIsEarlyBirdActive(...args);
      return isEarlyBirdActive(...args);
    },
    isRegistrationOpen: () => true,
    countActiveRegistrations: mockCountActiveRegistrations,
    auditEntry: ({ action, note }) => ({ action, note }),
    isValidEmail: () => true,
    Timestamp: { now: () => ({ _milliseconds: 1_800_000_000_000 }) },
  };
});

jest.mock('./rateLimit', () => ({
  checkRateLimit: mockRateLimit,
  extractIp: () => 'synthetic-test-ip',
}));

jest.mock('./stripeProductBinding', () => {
  const {
    projectCreatedStripeProductId,
    projectStoredStripeProductId,
  } = jest.requireActual('./stripeProductBinding');
  return {
    projectCreatedStripeProductId: (...args) => {
      mockProjectCreatedStripeProductId(...args);
      return projectCreatedStripeProductId(...args);
    },
    projectStoredStripeProductId: (...args) => {
      mockProjectStoredStripeProductId(...args);
      return projectStoredStripeProductId(...args);
    },
  };
});

const admin = require('firebase-admin');
const { createCheckoutSession } = require('./createCheckoutSession');
const { createMerchCheckout } = require('./createMerchCheckout');
const {
  LEGACY_CHECKOUT_RESULT_FAILURE_MESSAGE,
} = require('./legacyCheckoutSessionResult');

function validRaceRequest(overrides = {}) {
  return {
    eventId: 'race-1',
    runner: {
      firstName: 'Test',
      lastName: 'Runner',
      email: 'runner@example.test',
    },
    priceTier: 'nonMember',
    acceptedWaiver: true,
    ...overrides,
  };
}

function validCreatedProduct(overrides = {}, responseOverrides = {}) {
  const product = {
    id: 'custom_product_created_test_only',
    object: 'product',
    livemode: false,
    ...overrides,
  };
  Object.defineProperty(product, 'lastResponse', {
    configurable: false,
    enumerable: false,
    value: { statusCode: 200, ...responseOverrides },
    writable: false,
  });
  return product;
}

function validCheckoutSessionForPayload(
  payload,
  overrides = {},
  responseOverrides = {},
) {
  const isMerchandise = payload.metadata.type === 'merch';
  const id = isMerchandise
    ? 'cs_test_orderpolicy'
    : 'cs_test_registrationpolicy';
  const session = {
    id,
    object: 'checkout.session',
    livemode: false,
    mode: 'payment',
    status: 'open',
    payment_status: 'unpaid',
    // Stripe multiplies the unit amount by the line quantity for amount_total.
    amount_total: payload.line_items[0].price_data.unit_amount
      * payload.line_items[0].quantity,
    currency: 'usd',
    customer_email: payload.customer_email,
    metadata: { ...payload.metadata },
    success_url: payload.success_url,
    cancel_url: payload.cancel_url,
    url: `https://checkout.stripe.com/c/pay/${id}#synthetic-test-only`,
    ...overrides,
  };
  Object.defineProperty(session, 'lastResponse', {
    configurable: false,
    enumerable: false,
    value: { statusCode: 200, ...responseOverrides },
    writable: false,
  });
  return session;
}

function seedProductBindingTarget(domain) {
  if (domain === 'race') {
    admin.__seed('events/race-1', {
      checkoutEnabled: true,
      title: 'Synthetic Race',
      slug: 'synthetic-race',
      status: 'open',
      visibility: 'public',
      pricing: { nonMemberCents: 5_000 },
      waiverVersion: 'synthetic-v1',
    });
    return admin.__get('events/race-1');
  }

  admin.__seed('products/hat', {
    checkoutEnabled: true,
    title: 'Synthetic Hat',
    slug: 'hat',
    status: 'active',
    priceCents: 2_000,
  });
  return admin.__get('products/hat');
}

function runProductBindingCheckout(domain) {
  if (domain === 'race') {
    return createCheckoutSession(
      validRaceRequest(),
      { auth: null, rawRequest: {} },
    );
  }
  return createMerchCheckout({
    productSlug: 'hat',
    buyer: {
      firstName: 'Test',
      lastName: 'Buyer',
      email: 'buyer@example.test',
    },
  }, { auth: null, rawRequest: {} });
}

function productBindingFailureMessage(domain) {
  return domain === 'race'
    ? 'Registration is unavailable for this event'
    : 'This item is unavailable';
}

function productBindingBusinessPath(domain) {
  return domain === 'race'
    ? 'events/race-1/registrations/reg-new-1'
    : 'orders/order-new-1';
}

function seedPaidCheckoutTarget(domain) {
  if (domain === 'race') {
    admin.__seed('events/race-1', {
      checkoutEnabled: true,
      title: 'Synthetic Race',
      slug: 'synthetic-race',
      status: 'open',
      visibility: 'public',
      pricing: { nonMemberCents: 5_000 },
      stripeProductId: 'custom_race_product_test_only',
      waiverVersion: 'synthetic-v1',
    });
    return;
  }
  admin.__seed('products/hat', {
    checkoutEnabled: true,
    title: 'Synthetic Hat',
    slug: 'hat',
    status: 'active',
    priceCents: 2_000,
    stripeProductId: 'custom_shop_product_test_only',
  });
}

function installStoredBindingCase(target, caseName, canary) {
  let hookCalls = 0;
  const values = {
    'present undefined': undefined,
    'present null': null,
    'present empty string': '',
    'present false': false,
    'structured value': { canary },
  };
  if (caseName === 'accessor-backed value') {
    Object.defineProperty(target, 'stripeProductId', {
      configurable: true,
      enumerable: true,
      get() {
        hookCalls += 1;
        throw new Error(canary);
      },
    });
  } else {
    Object.defineProperty(target, 'stripeProductId', {
      configurable: true,
      enumerable: true,
      value: values[caseName],
      writable: true,
    });
  }
  return () => hookCalls;
}

function malformedCreatedProduct(caseName, canary) {
  let hookCalls = 0;
  let product;
  if (caseName === 'missing ID') {
    product = validCreatedProduct();
    delete product.id;
  } else if (caseName === 'wrong object kind') {
    product = validCreatedProduct({ object: 'price' });
  } else if (caseName === 'mode mismatch') {
    product = validCreatedProduct({ livemode: true });
  } else if (caseName === 'non-2xx response') {
    product = validCreatedProduct({}, { statusCode: 502 });
  } else {
    product = validCreatedProduct();
    Object.defineProperty(product, 'id', {
      configurable: true,
      enumerable: true,
      get() {
        hookCalls += 1;
        throw new Error(canary);
      },
    });
  }
  product.private_canary = canary;
  return {
    product,
    readHookCalls: () => hookCalls,
  };
}

function expectNoRaceCommandSideEffects(expectedFirestoreAccesses) {
  expect(mockFirestoreAccess).toHaveBeenCalledTimes(expectedFirestoreAccesses);
  expect(mockFirestoreWrite).not.toHaveBeenCalled();
  expect(mockRateLimit).not.toHaveBeenCalled();
  expect(mockResolveCallerRole).not.toHaveBeenCalled();
  expect(mockCountActiveRegistrations).not.toHaveBeenCalled();
  expect(mockGenerateToken).not.toHaveBeenCalled();
  expect(mockGetStripe).not.toHaveBeenCalled();
  expect(mockProductCreate).not.toHaveBeenCalled();
  expect(mockCheckoutCreate).not.toHaveBeenCalled();
  expect(admin.__get('events/race-1/registrations/reg-new-1')).toBeUndefined();
}

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
    mockFirestoreWrite.mockClear();
    mockGenerateToken.mockReset();
    mockResolveCallerRole.mockReset();
    mockCountActiveRegistrations.mockReset();
    mockProjectEventCheckoutAudience.mockReset();
    mockProjectParticipantCapacityLimit.mockReset();
    mockPickPriceCents.mockReset();
    mockIsEarlyBirdActive.mockReset();
    mockRegistrationAllocation.mockReset();
    mockOrderAllocation.mockReset();
    mockProjectStoredStripeProductId.mockReset();
    mockProjectCreatedStripeProductId.mockReset();
    mockGetStripe.mockReturnValue({
      checkout: { sessions: { create: mockCheckoutCreate } },
      products: { create: mockProductCreate },
    });
    mockRateLimit.mockResolvedValue(undefined);
    mockGenerateToken.mockReturnValue('synthetic-confirmation-token');
    mockCountActiveRegistrations.mockResolvedValue(0);
    mockCheckoutCreate.mockImplementation(
      async (payload) => validCheckoutSessionForPayload(payload),
    );
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

  test.each([
    ['an unexpected outer field', validRaceRequest({
      unexpected: 'checkout_secret_canary',
    })],
    ['an unknown signup type', validRaceRequest({
      signupType: 'waitlist',
    })],
    ['a truthy non-boolean waiver', validRaceRequest({
      acceptedWaiver: 'true',
    })],
    ['a nested runner value', validRaceRequest({
      runner: {
        firstName: 'Test',
        lastName: 'Runner',
        email: 'runner@example.test',
        phone: { value: 'checkout_secret_canary' },
      },
    })],
    ['a nested custom answer', validRaceRequest({
      customFields: { note: { value: 'checkout_secret_canary' } },
    })],
  ])('rejects %s before Firestore and command side effects', async (_name, request) => {
    await expect(createCheckoutSession(
      request,
      { auth: null, rawRequest: {} },
    )).rejects.toMatchObject({
      code: 'invalid-argument',
      message: 'Request data is invalid',
    });

    expectNoRaceCommandSideEffects(0);
  });

  test('rejects accessor and proxy envelopes without invoking attacker code', async () => {
    let getterCalls = 0;
    let trapCalls = 0;
    const accessorRequest = validRaceRequest();
    Object.defineProperty(accessorRequest, 'eventId', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'checkout_secret_canary';
      },
    });
    const proxyRequest = new Proxy(validRaceRequest(), {
      get() {
        trapCalls += 1;
        return 'checkout_secret_canary';
      },
      getOwnPropertyDescriptor() {
        trapCalls += 1;
        return undefined;
      },
      ownKeys() {
        trapCalls += 1;
        return [];
      },
    });

    for (const request of [accessorRequest, proxyRequest]) {
      await expect(createCheckoutSession(
        request,
        { auth: null, rawRequest: {} },
      )).rejects.toMatchObject({
        code: 'invalid-argument',
        message: 'Request data is invalid',
      });
    }

    expect(getterCalls).toBe(0);
    expect(trapCalls).toBe(0);
    expectNoRaceCommandSideEffects(0);
  });

  test.each([
    ['a falsy malformed event field definition', null, {}],
    ['a malformed event field definition', [
      {
        key: 'distance',
        label: 'Distance',
        type: 'select',
        required: 'true',
        options: ['5K', '10K'],
      },
    ], { distance: '5K' }],
    ['an unknown answer', [
      {
        key: 'distance',
        label: 'Distance',
        type: 'select',
        required: true,
        options: ['5K', '10K'],
      },
    ], { distance: '5K', unexpected: 'checkout_secret_canary' }],
    ['a missing required answer', [
      {
        key: 'distance',
        label: 'Distance',
        type: 'select',
        required: true,
        options: ['5K', '10K'],
      },
    ], {}],
    ['a wrong answer type', [
      {
        key: 'distance',
        label: 'Distance',
        type: 'select',
        required: true,
        options: ['5K', '10K'],
      },
    ], { distance: true }],
    ['an unavailable select option', [
      {
        key: 'distance',
        label: 'Distance',
        type: 'select',
        required: true,
        options: ['5K', '10K'],
      },
    ], { distance: 'checkout_secret_canary' }],
  ])('rejects %s after admission but before command side effects', async (
    _name,
    customFields,
    answers,
  ) => {
    admin.__seed('events/race-1', {
      checkoutEnabled: true,
      title: 'Synthetic Race',
      status: 'open',
      pricing: { nonMemberCents: 5000 },
      stripeProductId: 'prod_race_policy',
      customFields,
    });

    await expect(createCheckoutSession(
      validRaceRequest({ customFields: answers }),
      { auth: null, rawRequest: {} },
    )).rejects.toMatchObject({
      code: 'invalid-argument',
      message: 'Request data is invalid',
    });

    expectNoRaceCommandSideEffects(1);
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

  test('rejects a selected price accessor before token, registration allocation, or Stripe use', async () => {
    const selectedPriceRead = jest.fn(() => Number.NaN);
    const pricing = {};
    Object.defineProperty(pricing, 'nonMemberCents', {
      enumerable: true,
      get: selectedPriceRead,
    });
    admin.__seed('events/race-1', {
      checkoutEnabled: true,
      title: 'Synthetic Race',
      slug: 'synthetic-race',
      status: 'open',
      visibility: 'public',
      pricing,
      waiverVersion: 'synthetic-v1',
    });
    mockProductCreate.mockResolvedValueOnce({ id: 'prod_synthetic_generated' });
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => {}));

    try {
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
        message: 'Selected price tier is not available for this event',
      });

      expect(mockRateLimit).toHaveBeenCalledTimes(2);
      expect(mockResolveCallerRole).toHaveBeenCalledTimes(1);
      const lastRateLimitCall = Math.max(...mockRateLimit.mock.invocationCallOrder);
      expect(lastRateLimitCall).toBeLessThan(
        mockResolveCallerRole.mock.invocationCallOrder[0],
      );
      expect(mockCountActiveRegistrations).not.toHaveBeenCalled();
      expect(selectedPriceRead).not.toHaveBeenCalled();
      expect(mockGenerateToken).not.toHaveBeenCalled();
      expect(mockRegistrationAllocation).not.toHaveBeenCalled();
      expect(mockFirestoreWrite).not.toHaveBeenCalled();
      expect(admin.__get('events/race-1/registrations/reg-new-1')).toBeUndefined();
      expect(mockGetStripe).not.toHaveBeenCalled();
      expect(mockProductCreate).not.toHaveBeenCalled();
      expect(mockCheckoutCreate).not.toHaveBeenCalled();
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    } finally {
      consoleSpies.forEach((spy) => spy.mockRestore());
    }
  });

  test('rejects an explicit early-bird request with a malformed cutoff before later work', async () => {
    const malformedCutoff = '2999-01-01T00:00:00.000Z';
    const eventBefore = {
      checkoutEnabled: true,
      title: 'Synthetic Race',
      slug: 'synthetic-race',
      status: 'open',
      visibility: 'public',
      capacity: 10,
      pricing: {
        earlyBirdCents: 2_000,
        earlyBirdUntil: malformedCutoff,
      },
      waiverVersion: 'synthetic-v1',
    };
    admin.__seed('events/race-1', eventBefore);
    mockProductCreate.mockResolvedValueOnce({ id: 'prod_should_not_exist' });
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => {}));

    try {
      const outcome = await createCheckoutSession(validRaceRequest({
        priceTier: 'earlyBird',
      }), { auth: null, rawRequest: {} }).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );

      expect(outcome.error).toMatchObject({
        code: 'failed-precondition',
        message: 'Early-bird pricing is no longer available',
      });
      const publicError = [
        outcome.error.code,
        outcome.error.message,
        outcome.error.stack,
      ].join('\n');
      expect(publicError).not.toContain(malformedCutoff);
      expect(publicError).not.toContain('earlyBirdUntil');

      expect(mockFirestoreAccess).toHaveBeenCalledTimes(1);
      expect(mockRateLimit).toHaveBeenCalledTimes(2);
      expect(mockCountActiveRegistrations).toHaveBeenCalledTimes(1);
      expect(mockCountActiveRegistrations).toHaveBeenCalledWith('race-1');
      expect(mockResolveCallerRole).toHaveBeenCalledTimes(1);
      const lastRateLimitCall = Math.max(...mockRateLimit.mock.invocationCallOrder);
      expect(lastRateLimitCall).toBeLessThan(
        mockCountActiveRegistrations.mock.invocationCallOrder[0],
      );
      expect(mockCountActiveRegistrations.mock.invocationCallOrder[0]).toBeLessThan(
        mockResolveCallerRole.mock.invocationCallOrder[0],
      );

      expect(mockGenerateToken).not.toHaveBeenCalled();
      expect(mockRegistrationAllocation).not.toHaveBeenCalled();
      expect(mockFirestoreWrite).not.toHaveBeenCalled();
      expect(admin.__get('events/race-1/registrations/reg-new-1')).toBeUndefined();
      expect(mockGetStripe).not.toHaveBeenCalled();
      expect(mockProductCreate).not.toHaveBeenCalled();
      expect(mockCheckoutCreate).not.toHaveBeenCalled();
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
      expect(admin.__get('events/race-1')).toEqual(eventBefore);
    } finally {
      consoleSpies.forEach((spy) => spy.mockRestore());
    }
  });

  describe('participant capacity format guard', () => {
    async function expectMalformedCapacityRejected({
      capacity,
      activeRegistrations = 0,
      configureStoredEvent,
      hooks = [],
    }) {
      const eventBefore = {
        checkoutEnabled: true,
        title: 'Synthetic Capacity Race',
        slug: 'synthetic-capacity-race',
        status: 'open',
        visibility: 'public',
        pricing: { nonMemberCents: 5_000 },
        stripeProductId: 'prod_capacity_policy',
        waiverVersion: 'synthetic-v1',
      };
      if (capacity !== undefined) eventBefore.capacity = capacity;
      admin.__seed('events/race-1', eventBefore);
      const storedEvent = admin.__get('events/race-1');
      configureStoredEvent?.(storedEvent);
      const storedDescriptors = Object.getOwnPropertyDescriptors(storedEvent);
      mockCountActiveRegistrations.mockResolvedValue(activeRegistrations);
      mockProductCreate.mockResolvedValueOnce({ id: 'prod_should_not_exist' });
      const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
        .map((method) => jest.spyOn(console, method).mockImplementation(() => {}));

      try {
        const outcome = await createCheckoutSession(validRaceRequest(), {
          auth: null,
          rawRequest: {},
        }).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );

        expect(outcome.error).toMatchObject({
          code: 'failed-precondition',
          message: 'Registration is unavailable for this event',
        });
        expect(mockFirestoreAccess).toHaveBeenCalledTimes(1);
        expect(mockRateLimit).toHaveBeenCalledTimes(2);
        expect(mockCountActiveRegistrations).not.toHaveBeenCalled();
        expect(mockResolveCallerRole).not.toHaveBeenCalled();
        expect(mockIsEarlyBirdActive).not.toHaveBeenCalled();
        expect(mockPickPriceCents).not.toHaveBeenCalled();
        expect(mockGenerateToken).not.toHaveBeenCalled();
        expect(mockRegistrationAllocation).not.toHaveBeenCalled();
        expect(mockFirestoreWrite).not.toHaveBeenCalled();
        expect(admin.__get('events/race-1/registrations/reg-new-1')).toBeUndefined();
        expect(mockGetStripe).not.toHaveBeenCalled();
        expect(mockProductCreate).not.toHaveBeenCalled();
        expect(mockCheckoutCreate).not.toHaveBeenCalled();
        consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
        hooks.forEach((hook) => expect(hook).not.toHaveBeenCalled());
        expect(Object.getOwnPropertyDescriptors(storedEvent))
          .toEqual(storedDescriptors);
      } finally {
        consoleSpies.forEach((spy) => spy.mockRestore());
      }
    }

    test.each([
      ['zero', () => ({ capacity: 0 })],
      ['NaN', () => ({ capacity: Number.NaN })],
      ['fractional', () => ({ capacity: 1.5, activeRegistrations: 1 })],
      ['infinite', () => ({
        capacity: Number.POSITIVE_INFINITY,
        activeRegistrations: 1,
      })],
      ['coercible', () => {
        const valueOf = jest.fn(() => 10);
        return {
          capacity: { valueOf },
          activeRegistrations: 1,
          hooks: [valueOf],
        };
      }],
    ])('rejects a %s stored capacity before later work', async (
      _name,
      makeFixture,
    ) => {
      await expectMalformedCapacityRejected(makeFixture());
    });

    test('does not invoke an accessor-backed stored capacity', async () => {
      const getter = jest.fn(() => 10);

      await expectMalformedCapacityRejected({
        configureStoredEvent: (event) => {
          Object.defineProperty(event, 'capacity', {
            enumerable: true,
            get: getter,
          });
        },
        hooks: [getter],
      });
    });

    test.each([
      ['missing', false],
      ['null', true],
    ])('keeps %s capacity unlimited without counting', async (
      _name,
      includeNull,
    ) => {
      const event = {
        checkoutEnabled: true,
        title: 'Synthetic Unlimited Race',
        slug: 'synthetic-unlimited-race',
        status: 'open',
        visibility: 'public',
        pricing: { nonMemberCents: 5_000 },
        stripeProductId: 'prod_unlimited_policy',
        waiverVersion: 'synthetic-v1',
      };
      if (includeNull) event.capacity = null;
      admin.__seed('events/race-1', event);

      await expect(createCheckoutSession(validRaceRequest(), {
        auth: null,
        rawRequest: {},
      })).resolves.toMatchObject({
        sessionId: 'cs_test_registrationpolicy',
        registrationId: 'reg-new-1',
      });

      expect(mockCountActiveRegistrations).not.toHaveBeenCalled();
      expect(mockResolveCallerRole).toHaveBeenCalledTimes(1);
      expect(mockRegistrationAllocation).toHaveBeenCalledTimes(1);
      expect(mockCheckoutCreate).toHaveBeenCalledTimes(1);
    });

    test('counts a valid limit before resolving the participant price role', async () => {
      admin.__seed('events/race-1', {
        checkoutEnabled: true,
        title: 'Synthetic Limited Race',
        slug: 'synthetic-limited-race',
        status: 'open',
        visibility: 'public',
        capacity: 1,
        pricing: { nonMemberCents: 5_000 },
        stripeProductId: 'prod_limited_policy',
        waiverVersion: 'synthetic-v1',
      });
      mockCountActiveRegistrations.mockResolvedValue(0);

      await expect(createCheckoutSession(validRaceRequest(), {
        auth: null,
        rawRequest: {},
      })).resolves.toMatchObject({
        sessionId: 'cs_test_registrationpolicy',
      });

      expect(mockCountActiveRegistrations).toHaveBeenCalledTimes(1);
      expect(mockCountActiveRegistrations).toHaveBeenCalledWith('race-1');
      expect(mockResolveCallerRole).toHaveBeenCalledTimes(1);
      expect(mockCountActiveRegistrations.mock.invocationCallOrder[0]).toBeLessThan(
        mockResolveCallerRole.mock.invocationCallOrder[0],
      );
    });

    test('keeps equality full for a valid configured limit', async () => {
      admin.__seed('events/race-1', {
        checkoutEnabled: true,
        title: 'Synthetic Full Race',
        slug: 'synthetic-full-race',
        status: 'open',
        visibility: 'public',
        capacity: 1,
        pricing: { nonMemberCents: 5_000 },
        waiverVersion: 'synthetic-v1',
      });
      mockCountActiveRegistrations.mockResolvedValue(1);

      await expect(createCheckoutSession(validRaceRequest(), {
        auth: null,
        rawRequest: {},
      })).rejects.toMatchObject({
        code: 'resource-exhausted',
        message: 'This event is full',
      });

      expect(mockCountActiveRegistrations).toHaveBeenCalledTimes(1);
      expect(mockResolveCallerRole).not.toHaveBeenCalled();
      expect(mockGenerateToken).not.toHaveBeenCalled();
      expect(mockRegistrationAllocation).not.toHaveBeenCalled();
      expect(mockFirestoreWrite).not.toHaveBeenCalled();
      expect(mockGetStripe).not.toHaveBeenCalled();
      expect(mockCheckoutCreate).not.toHaveBeenCalled();
    });

    test('keeps malformed participant capacity outside the volunteer path', async () => {
      admin.__seed('events/race-1', {
        checkoutEnabled: true,
        title: 'Synthetic Volunteer Race',
        slug: 'synthetic-volunteer-race',
        status: 'open',
        visibility: 'public',
        capacity: 0,
        volunteerEnabled: true,
        waiverVersion: 'synthetic-v1',
      });

      await expect(createCheckoutSession({
        eventId: 'race-1',
        runner: {
          firstName: 'Test',
          lastName: 'Volunteer',
          email: 'volunteer@example.test',
        },
        acceptedWaiver: true,
        signupType: 'volunteer',
      }, { auth: null, rawRequest: {} })).resolves.toMatchObject({
        free: true,
        registrationId: 'reg-new-1',
      });

      expect(mockCountActiveRegistrations).not.toHaveBeenCalled();
      expect(mockResolveCallerRole).not.toHaveBeenCalled();
      expect(mockGetStripe).not.toHaveBeenCalled();
      expect(mockCheckoutCreate).not.toHaveBeenCalled();
    });
  });

  describe('event audience format guard', () => {
    async function expectMalformedAudienceRejected({
      audience = {},
      configureStoredEvent,
      canary = 'synthetic_audience_canary',
      hooks = [],
      request = validRaceRequest(),
    }) {
      const eventBefore = {
        checkoutEnabled: true,
        title: 'Synthetic Audience Race',
        slug: 'synthetic-audience-race',
        status: 'open',
        capacity: null,
        pricing: { nonMemberCents: 5_000 },
        stripeProductId: 'prod_audience_policy',
        waiverVersion: 'synthetic-v1',
        ...audience,
      };
      admin.__seed('events/race-1', eventBefore);
      const storedEvent = admin.__get('events/race-1');
      configureStoredEvent?.(storedEvent);
      const storedDescriptors = Object.getOwnPropertyDescriptors(storedEvent);
      mockProductCreate.mockResolvedValueOnce({ id: 'prod_should_not_exist' });
      const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
        .map((method) => jest.spyOn(console, method).mockImplementation(() => {}));

      try {
        const outcome = await createCheckoutSession(request, {
          auth: null,
          rawRequest: {},
        }).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );

        expect(outcome.error).toMatchObject({
          code: 'failed-precondition',
          message: 'Registration is unavailable for this event',
        });
        const publicError = JSON.stringify({
          code: outcome.error?.code,
          message: outcome.error?.message,
          stack: outcome.error?.stack,
        });
        expect(publicError).not.toContain(canary);
        expect(publicError).not.toContain('visibility');
        expect(publicError).not.toContain('member_only');
        expect(mockFirestoreAccess).toHaveBeenCalledTimes(1);
        expect(mockRateLimit).toHaveBeenCalledTimes(2);
        expect(mockProjectEventCheckoutAudience).toHaveBeenCalledTimes(1);
        expect(mockProjectEventCheckoutAudience).toHaveBeenCalledWith(storedEvent);
        expect(mockRateLimit.mock.invocationCallOrder[1]).toBeLessThan(
          mockProjectEventCheckoutAudience.mock.invocationCallOrder[0],
        );
        expect(mockResolveCallerRole).not.toHaveBeenCalled();
        expect(mockProjectParticipantCapacityLimit).not.toHaveBeenCalled();
        expect(mockCountActiveRegistrations).not.toHaveBeenCalled();
        expect(mockIsEarlyBirdActive).not.toHaveBeenCalled();
        expect(mockPickPriceCents).not.toHaveBeenCalled();
        expect(mockGenerateToken).not.toHaveBeenCalled();
        expect(mockRegistrationAllocation).not.toHaveBeenCalled();
        expect(mockFirestoreWrite).not.toHaveBeenCalled();
        expect(admin.__get('events/race-1/registrations/reg-new-1')).toBeUndefined();
        expect(mockGetStripe).not.toHaveBeenCalled();
        expect(mockProductCreate).not.toHaveBeenCalled();
        expect(mockCheckoutCreate).not.toHaveBeenCalled();
        consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
        hooks.forEach((hook) => expect(hook).not.toHaveBeenCalled());
        expect(Object.getOwnPropertyDescriptors(storedEvent))
          .toEqual(storedDescriptors);
      } finally {
        consoleSpies.forEach((spy) => spy.mockRestore());
      }
    }

    test.each([
      ['draft', { visibility: 'draft' }],
      ['unknown', { visibility: 'synthetic_audience_canary' }],
      ['both markers missing', {}],
      ['malformed legacy marker', { member_only: 'true' }],
      ['mixed modern and legacy markers', {
        visibility: 'public',
        member_only: false,
      }],
    ])('rejects a %s audience before later checkout work', async (
      _name,
      audience,
    ) => {
      await expectMalformedAudienceRejected({ audience });
    });

    test('does not invoke an accessor-backed audience marker', async () => {
      const getter = jest.fn(() => 'public');

      await expectMalformedAudienceRejected({
        configureStoredEvent: (event) => {
          Object.defineProperty(event, 'visibility', {
            configurable: true,
            enumerable: true,
            get: getter,
          });
        },
        hooks: [getter],
      });
    });

    test('does not accept a hidden audience marker', async () => {
      await expectMalformedAudienceRejected({
        configureStoredEvent: (event) => {
          Object.defineProperty(event, 'visibility', {
            configurable: true,
            value: 'public',
          });
        },
      });
    });

    test('rejects malformed audience before the volunteer branch', async () => {
      await expectMalformedAudienceRejected({
        audience: {
          visibility: 'draft',
          volunteerEnabled: true,
        },
        request: {
          eventId: 'race-1',
          runner: {
            firstName: 'Test',
            lastName: 'Volunteer',
            email: 'volunteer@example.test',
          },
          acceptedWaiver: true,
          signupType: 'volunteer',
        },
      });
    });

    test.each([
      ['modern public', { visibility: 'public' }, null, 1],
      ['modern members-only', { visibility: 'members_only' }, {
        uid: 'synthetic-member',
        token: {
          email_verified: true,
          role: 'member',
        },
      }, 2],
      ['legacy public', { member_only: false }, null, 1],
      ['legacy members-only', { member_only: true }, {
        uid: 'synthetic-member',
        token: {
          email_verified: true,
          role: 'member',
        },
      }, 2],
    ])('preserves the %s checkout path', async (
      _name,
      audience,
      auth,
      expectedRoleCalls,
    ) => {
      admin.__seed('events/race-1', {
        checkoutEnabled: true,
        title: 'Synthetic Recognized Audience Race',
        slug: 'synthetic-recognized-audience-race',
        status: 'open',
        capacity: null,
        pricing: { nonMemberCents: 5_000 },
        stripeProductId: 'prod_recognized_audience_policy',
        waiverVersion: 'synthetic-v1',
        ...audience,
      });

      await expect(createCheckoutSession(validRaceRequest(), {
        auth,
        rawRequest: {},
      })).resolves.toMatchObject({
        sessionId: 'cs_test_registrationpolicy',
        registrationId: 'reg-new-1',
      });

      expect(mockProjectEventCheckoutAudience).toHaveBeenCalledTimes(1);
      expect(mockResolveCallerRole).toHaveBeenCalledTimes(expectedRoleCalls);
      expect(mockProjectParticipantCapacityLimit).toHaveBeenCalledTimes(1);
      expect(mockCountActiveRegistrations).not.toHaveBeenCalled();
      expect(mockCheckoutCreate).toHaveBeenCalledTimes(1);
      expect(mockProjectEventCheckoutAudience.mock.invocationCallOrder[0])
        .toBeLessThan(mockResolveCallerRole.mock.invocationCallOrder[0]);
    });

    test('keeps the existing denial for legacy members-only access', async () => {
      admin.__seed('events/race-1', {
        checkoutEnabled: true,
        title: 'Synthetic Legacy Members Race',
        slug: 'synthetic-legacy-members-race',
        status: 'open',
        member_only: true,
        pricing: { memberCents: 3_000, nonMemberCents: 5_000 },
        stripeProductId: 'prod_legacy_members_policy',
        waiverVersion: 'synthetic-v1',
      });

      await expect(createCheckoutSession(validRaceRequest({
        priceTier: 'member',
      }), {
        auth: {
          uid: 'synthetic-user',
          token: { role: 'member' },
        },
        rawRequest: {},
      })).rejects.toMatchObject({
        code: 'permission-denied',
        message: 'This event is open to club members only',
      });

      expect(mockProjectEventCheckoutAudience).toHaveBeenCalledTimes(1);
      expect(mockResolveCallerRole).toHaveBeenCalledTimes(1);
      expect(mockProjectParticipantCapacityLimit).not.toHaveBeenCalled();
      expect(mockRegistrationAllocation).not.toHaveBeenCalled();
      expect(mockFirestoreWrite).not.toHaveBeenCalled();
      expect(mockGetStripe).not.toHaveBeenCalled();
      expect(mockCheckoutCreate).not.toHaveBeenCalled();
    });

    test.each([
      ['modern', { visibility: 'members_only' }],
      ['legacy', { member_only: true }],
    ])('preserves the %s members-only volunteer path', async (
      _name,
      audience,
    ) => {
      admin.__seed('events/race-1', {
        checkoutEnabled: true,
        title: 'Synthetic Members Volunteer Race',
        slug: 'synthetic-members-volunteer-race',
        status: 'open',
        volunteerEnabled: true,
        waiverVersion: 'synthetic-v1',
        ...audience,
      });

      await expect(createCheckoutSession({
        eventId: 'race-1',
        runner: {
          firstName: 'Test',
          lastName: 'Volunteer',
          email: 'volunteer@example.test',
        },
        acceptedWaiver: true,
        signupType: 'volunteer',
      }, {
        auth: {
          uid: 'synthetic-member',
          token: {
            email_verified: true,
            role: 'member',
          },
        },
        rawRequest: {},
      })).resolves.toMatchObject({
        free: true,
        registrationId: 'reg-new-1',
      });

      expect(mockProjectEventCheckoutAudience).toHaveBeenCalledTimes(1);
      expect(mockResolveCallerRole).toHaveBeenCalledTimes(1);
      expect(mockProjectParticipantCapacityLimit).not.toHaveBeenCalled();
      expect(mockRegistrationAllocation).toHaveBeenCalledTimes(1);
      expect(mockGetStripe).not.toHaveBeenCalled();
      expect(mockCheckoutCreate).not.toHaveBeenCalled();
    });
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
      sessionId: 'cs_test_registrationpolicy',
      registrationId: 'reg-new-1',
    });
    const storedRegistration = admin.__get(
      'events/race-1/registrations/reg-new-1',
    );
    expect(storedRegistration).toMatchObject({
      amountCents: 5000,
      currency: 'usd',
      promoCode: null,
      stripeSessionId: 'cs_test_registrationpolicy',
    });
    expect(Object.hasOwn(storedRegistration, 'url')).toBe(false);
    expect(Object.values(storedRegistration))
      .not.toContain(result.url);
    expect(mockProductCreate).not.toHaveBeenCalled();
  });

  test('race checkout preserves an opaque event ID and URL-encodes callback values', async () => {
    const eventId = 'race?wave=1&return=#finish%25';
    const encodedEventId = encodeURIComponent(eventId);
    admin.__seed(`events/${eventId}`, {
      checkoutEnabled: true,
      title: 'Synthetic Opaque-ID Race',
      status: 'open',
      visibility: 'public',
      pricing: { nonMemberCents: 5000 },
      stripeProductId: 'prod_opaque_event_policy',
      waiverVersion: 'synthetic-v1',
    });

    await createCheckoutSession(validRaceRequest({ eventId }), {
      auth: null,
      rawRequest: {},
    });

    const payload = mockCheckoutCreate.mock.calls[0][0];
    expect(payload.metadata.eventId).toBe(eventId);
    expect(payload.success_url).toBe(
      `https://runmprc.test/register/success?session_id={CHECKOUT_SESSION_ID}`
      + `&reg=reg-new-1&token=synthetic-confirmation-token&event=${encodedEventId}`,
    );
    expect(payload.cancel_url).toBe(
      `https://runmprc.test/events/${encodedEventId}?cancelled=1`,
    );
    expect(payload.success_url).not.toContain(`event=${eventId}`);
    expect(admin.__get(`events/${eventId}/registrations/reg-new-1`)).toMatchObject({
      eventId,
      stripeSessionId: 'cs_test_registrationpolicy',
    });
  });

  test('an unverified role cannot unlock a members-only event', async () => {
    admin.__seed('events/race-1', {
      checkoutEnabled: true,
      title: 'Synthetic Members Race',
      slug: 'synthetic-members-race',
      status: 'open',
      visibility: 'members_only',
      pricing: { memberCents: 3000, nonMemberCents: 5000 },
      stripeProductId: 'prod_members_race_policy',
      waiverVersion: 'synthetic-v1',
    });

    await expect(createCheckoutSession({
      eventId: 'race-1',
      runner: {
        firstName: 'Test',
        lastName: 'Runner',
        email: 'runner@example.test',
      },
      priceTier: 'member',
      acceptedWaiver: true,
    }, {
      auth: { uid: 'synthetic-user', token: { role: 'member' } },
      rawRequest: {},
    })).rejects.toMatchObject({
      code: 'permission-denied',
      message: 'This event is open to club members only',
    });

    expect(mockRateLimit).toHaveBeenCalledTimes(2);
    expect(admin.__get('events/race-1/registrations/reg-new-1')).toBeUndefined();
    expect(mockGetStripe).not.toHaveBeenCalled();
    expect(mockProductCreate).not.toHaveBeenCalled();
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  test('malformed verification cannot unlock explicit member pricing', async () => {
    admin.__seed('events/race-1', {
      checkoutEnabled: true,
      title: 'Synthetic Public Race',
      slug: 'synthetic-public-race',
      status: 'open',
      visibility: 'public',
      pricing: { memberCents: 3000, nonMemberCents: 5000 },
      stripeProductId: 'prod_public_race_policy',
      waiverVersion: 'synthetic-v1',
    });

    await expect(createCheckoutSession({
      eventId: 'race-1',
      runner: {
        firstName: 'Test',
        lastName: 'Runner',
        email: 'runner@example.test',
      },
      priceTier: 'member',
      acceptedWaiver: true,
    }, {
      auth: {
        uid: 'synthetic-user',
        token: { email_verified: 'true', role: 'admin' },
      },
      rawRequest: {},
    })).rejects.toMatchObject({
      code: 'permission-denied',
      message: 'Sign in as a member to claim the member price',
    });

    expect(mockRateLimit).toHaveBeenCalledTimes(2);
    expect(admin.__get('events/race-1/registrations/reg-new-1')).toBeUndefined();
    expect(mockGetStripe).not.toHaveBeenCalled();
    expect(mockProductCreate).not.toHaveBeenCalled();
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  test('a verified member preserves the existing member-price path', async () => {
    admin.__seed('events/race-1', {
      checkoutEnabled: true,
      title: 'Synthetic Members Race',
      slug: 'synthetic-members-race',
      status: 'open',
      visibility: 'members_only',
      pricing: { memberCents: 3000, nonMemberCents: 5000 },
      stripeProductId: 'prod_members_race_policy',
      waiverVersion: 'synthetic-v1',
    });

    await expect(createCheckoutSession({
      eventId: 'race-1',
      runner: {
        firstName: 'Test',
        lastName: 'Runner',
        email: 'runner@example.test',
      },
      priceTier: 'member',
      acceptedWaiver: true,
    }, {
      auth: {
        uid: 'synthetic-member',
        token: { email_verified: true, role: 'member' },
      },
      rawRequest: {},
    })).resolves.toMatchObject({
      sessionId: 'cs_test_registrationpolicy',
      registrationId: 'reg-new-1',
    });

    expect(mockCheckoutCreate).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: 3000,
          product: 'prod_members_race_policy',
        },
        quantity: 1,
      }],
    }));
    expect(admin.__get('events/race-1/registrations/reg-new-1')).toMatchObject({
      uid: 'synthetic-member',
      priceTier: 'member',
      amountCents: 3000,
    });
  });

  test('admitted volunteer signup remains free and does not call Stripe', async () => {
    admin.__seed('events/race-1', {
      checkoutEnabled: true,
      title: 'Synthetic Race',
      slug: 'synthetic-race',
      status: 'open',
      visibility: 'public',
      volunteerEnabled: true,
      waiverVersion: 'synthetic-v1',
    });
    let bindingGetterCalls = 0;
    Object.defineProperty(admin.__get('events/race-1'), 'stripeProductId', {
      configurable: true,
      enumerable: true,
      get() {
        bindingGetterCalls += 1;
        throw new Error('free volunteer Product binding getter executed');
      },
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
    expect(bindingGetterCalls).toBe(0);
    expect(mockProjectStoredStripeProductId).not.toHaveBeenCalled();
    expect(mockProjectCreatedStripeProductId).not.toHaveBeenCalled();
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
      visibility: 'public',
      pricing: { nonMemberCents: 0 },
      waiverVersion: 'synthetic-v1',
    });
    let bindingGetterCalls = 0;
    Object.defineProperty(admin.__get('events/race-1'), 'stripeProductId', {
      configurable: true,
      enumerable: true,
      get() {
        bindingGetterCalls += 1;
        throw new Error('free participant Product binding getter executed');
      },
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
    expect(bindingGetterCalls).toBe(0);
    expect(mockProjectStoredStripeProductId).not.toHaveBeenCalled();
    expect(mockProjectCreatedStripeProductId).not.toHaveBeenCalled();
    expect(mockGetStripe).not.toHaveBeenCalled();
    expect(mockProductCreate).not.toHaveBeenCalled();
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
      sessionId: 'cs_test_orderpolicy',
      orderId: 'order-new-1',
    });
    const storedOrder = admin.__get('orders/order-new-1');
    expect(storedOrder).toMatchObject({
      amountCents: 2000,
      currency: 'usd',
      stripeSessionId: 'cs_test_orderpolicy',
    });
    expect(Object.hasOwn(storedOrder, 'url')).toBe(false);
    expect(Object.values(storedOrder)).not.toContain(result.url);
    expect(mockProductCreate).not.toHaveBeenCalled();
  });

  test('merchandise checkout charges the unit times the requested quantity', async () => {
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
      quantity: 3,
    }, { auth: null, rawRequest: {} });

    expect(mockCheckoutCreate).toHaveBeenCalledTimes(1);
    // The server sends a per-unit price and the quantity; Stripe multiplies.
    // The quantity never enters the fixed merch metadata key set.
    const expectedMetadata = {
      schemaVersion: '1',
      type: 'merch',
      productSlug: 'hat',
      orderId: 'order-new-1',
      size: 'M',
      color: 'blue',
    };
    expect(mockCheckoutCreate).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: 2000,
          product: 'prod_hat_policy',
        },
        quantity: 3,
      }],
      metadata: expectedMetadata,
      payment_intent_data: { metadata: expectedMetadata },
    }));
    expect(result).toMatchObject({
      sessionId: 'cs_test_orderpolicy',
      orderId: 'order-new-1',
    });
    const storedOrder = admin.__get('orders/order-new-1');
    // amountCents is the immutable total (unit x quantity), not the unit price.
    expect(storedOrder).toMatchObject({
      quantity: 3,
      amountCents: 6000,
      currency: 'usd',
      priceSnapshot: {
        schemaVersion: '1',
        currency: 'usd',
        unitAmountCents: 2000,
        quantity: 3,
        totalAmountCents: 6000,
      },
      stripeSessionId: 'cs_test_orderpolicy',
    });
    expect(mockProductCreate).not.toHaveBeenCalled();
  });

  test('merchandise checkout without a quantity persists a single-unit snapshot', async () => {
    admin.__seed('products/hat', {
      checkoutEnabled: true,
      title: 'Synthetic Hat',
      slug: 'hat',
      status: 'active',
      priceCents: 2000,
      stripeProductId: 'prod_hat_policy',
    });

    await createMerchCheckout({
      productSlug: 'hat',
      buyer: {
        firstName: 'Test',
        lastName: 'Buyer',
        email: 'buyer@example.test',
      },
    }, { auth: null, rawRequest: {} });

    // Backward compatible: an absent quantity is one, amountCents is the unit
    // price, and the order still carries the structured immutable snapshot.
    const storedOrder = admin.__get('orders/order-new-1');
    expect(storedOrder).toMatchObject({
      quantity: 1,
      amountCents: 2000,
      priceSnapshot: {
        unitAmountCents: 2000,
        quantity: 1,
        totalAmountCents: 2000,
      },
    });
    expect(mockCheckoutCreate.mock.calls[0][0].line_items[0].quantity).toBe(1);
  });

  test.each([
    ['a string price', '2000'],
    ['a sub-minimum paid price', 49],
    ['zero', 0],
    ['a fractional price', 50.5],
    ['a non-finite price', Number.NaN],
    ['a price over the provider limit', 100_000_000],
  ])('rejects %s before order and provider side effects', async (
    _name,
    priceCents,
  ) => {
    admin.__seed('products/hat', {
      checkoutEnabled: true,
      title: 'Synthetic Hat',
      description: 'Synthetic test product',
      slug: 'hat',
      status: 'active',
      priceCents,
    });
    mockProductCreate.mockResolvedValue({ id: 'prod_should_not_exist' });

    const outcome = await createMerchCheckout({
      productSlug: 'hat',
      buyer: {
        firstName: 'Test',
        lastName: 'Buyer',
        email: 'buyer@example.test',
      },
    }, { auth: null, rawRequest: {} }).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );

    expect({
      settled: outcome.error ? 'rejected' : 'resolved',
      code: outcome.error?.code || null,
      message: outcome.error?.message || null,
      rateLimitCalls: mockRateLimit.mock.calls.length,
      tokenCalls: mockGenerateToken.mock.calls.length,
      orderAllocations: mockOrderAllocation.mock.calls.length,
      writes: mockFirestoreWrite.mock.calls.length,
      stripeAccesses: mockGetStripe.mock.calls.length,
      productCreates: mockProductCreate.mock.calls.length,
      checkoutCreates: mockCheckoutCreate.mock.calls.length,
    }).toEqual({
      settled: 'rejected',
      code: 'failed-precondition',
      message: 'This item is unavailable',
      rateLimitCalls: 2,
      tokenCalls: 0,
      orderAllocations: 0,
      writes: 0,
      stripeAccesses: 0,
      productCreates: 0,
      checkoutCreates: 0,
    });
    expect(admin.__get('products/hat').stripeProductId).toBeUndefined();
    expect(admin.__get('orders/order-new-1')).toBeUndefined();
  });

  test.each([50, 99_999_999])(
    'preserves the valid merchandise boundary %s in the order and Session',
    async (priceCents) => {
      admin.__seed('products/hat', {
        checkoutEnabled: true,
        title: 'Synthetic Hat',
        slug: 'hat',
        status: 'active',
        priceCents,
        stripeProductId: 'prod_hat_policy',
      });

      await createMerchCheckout({
        productSlug: 'hat',
        buyer: {
          firstName: 'Test',
          lastName: 'Buyer',
          email: 'buyer@example.test',
        },
      }, { auth: null, rawRequest: {} });

      expect(admin.__get('orders/order-new-1')).toMatchObject({
        amountCents: priceCents,
        currency: 'usd',
      });
      expect(mockCheckoutCreate.mock.calls[0][0]
        .line_items[0].price_data.unit_amount).toBe(priceCents);
      expect(mockProductCreate).not.toHaveBeenCalled();
    },
  );

  test('uses one copied price when the admitted product changes after projection', async () => {
    admin.__seed('products/hat', {
      checkoutEnabled: true,
      title: 'Synthetic Hat',
      slug: 'hat',
      status: 'active',
      priceCents: 2_000,
      stripeProductId: 'prod_hat_policy',
    });
    mockGenerateToken.mockImplementation(() => {
      admin.__get('products/hat').priceCents = 49;
      return 'synthetic-confirmation-token';
    });

    await createMerchCheckout({
      productSlug: 'hat',
      buyer: {
        firstName: 'Test',
        lastName: 'Buyer',
        email: 'buyer@example.test',
      },
    }, { auth: null, rawRequest: {} });

    expect(admin.__get('products/hat').priceCents).toBe(49);
    expect(admin.__get('orders/order-new-1').amountCents).toBe(2_000);
    expect(mockCheckoutCreate.mock.calls[0][0]
      .line_items[0].price_data.unit_amount).toBe(2_000);
  });

  test('does not log or copy a hostile invalid merchandise price', async () => {
    const canary = 'merch_price_secret_canary';
    const productBefore = {
      checkoutEnabled: true,
      title: 'Synthetic Hat',
      slug: 'hat',
      status: 'active',
      priceCents: canary,
    };
    admin.__seed('products/hat', productBefore);
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => {}));

    try {
      const outcome = await createMerchCheckout({
        productSlug: 'hat',
        buyer: {
          firstName: 'Test',
          lastName: 'Buyer',
          email: 'buyer@example.test',
        },
      }, { auth: null, rawRequest: {} }).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );

      expect(outcome.error).toMatchObject({
        code: 'failed-precondition',
        message: 'This item is unavailable',
      });
      const publicError = [
        outcome.error.code,
        outcome.error.message,
        outcome.error.stack,
      ].join('\n');
      expect(publicError).not.toContain(canary);
      expect(publicError).not.toContain('priceCents');

      expect(mockRateLimit).toHaveBeenCalledTimes(2);
      expect(mockGenerateToken).not.toHaveBeenCalled();
      expect(mockOrderAllocation).not.toHaveBeenCalled();
      expect(mockFirestoreWrite).not.toHaveBeenCalled();
      expect(mockGetStripe).not.toHaveBeenCalled();
      expect(mockProductCreate).not.toHaveBeenCalled();
      expect(mockCheckoutCreate).not.toHaveBeenCalled();
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
      expect(admin.__get('products/hat')).toEqual(productBefore);
      expect(admin.__get('orders/order-new-1')).toBeUndefined();
    } finally {
      consoleSpies.forEach((spy) => spy.mockRestore());
    }
  });

  test.each([
    ['size', { sizes: ['M'], colors: ['blue'] }, { size: 'XL', color: 'blue' }, 'Request data is invalid'],
    ['color', { sizes: ['M'], colors: ['blue'] }, { size: 'M', color: 'red' }, 'Request data is invalid'],
  ])('keeps invalid %s ahead of the price guard', async (
    _name,
    options,
    selection,
    message,
  ) => {
    admin.__seed('products/hat', {
      checkoutEnabled: true,
      title: 'Synthetic Hat',
      slug: 'hat',
      status: 'active',
      priceCents: 'invalid-price',
      ...options,
    });

    await expect(createMerchCheckout({
      productSlug: 'hat',
      buyer: {
        firstName: 'Test',
        lastName: 'Buyer',
        email: 'buyer@example.test',
      },
      ...selection,
    }, { auth: null, rawRequest: {} })).rejects.toMatchObject({
      code: 'invalid-argument',
      message,
    });

    expect(mockRateLimit).toHaveBeenCalledTimes(2);
    expect(mockGenerateToken).not.toHaveBeenCalled();
    expect(mockOrderAllocation).not.toHaveBeenCalled();
    expect(mockFirestoreWrite).not.toHaveBeenCalled();
    expect(mockGetStripe).not.toHaveBeenCalled();
  });

  test('keeps sold-out status ahead of the price guard', async () => {
    admin.__seed('products/hat', {
      checkoutEnabled: true,
      title: 'Synthetic Hat',
      slug: 'hat',
      status: 'sold_out',
      priceCents: 'invalid-price',
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
      message: 'This item is sold out',
    });

    expect(mockRateLimit).toHaveBeenCalledTimes(2);
    expect(mockGenerateToken).not.toHaveBeenCalled();
    expect(mockOrderAllocation).not.toHaveBeenCalled();
    expect(mockFirestoreWrite).not.toHaveBeenCalled();
    expect(mockGetStripe).not.toHaveBeenCalled();
  });

  test.each(['race', 'shop'])(
    'keeps valid missing-Product mapping, Session, and %s record order',
    async (domain) => {
      const target = seedProductBindingTarget(domain);
      const createdId = `custom_${domain}_product_created_test_only`;
      const createdProduct = validCreatedProduct({ id: createdId });
      mockProductCreate.mockResolvedValue(createdProduct);

      await runProductBindingCheckout(domain);

      const targetPath = domain === 'race' ? 'events/race-1' : 'products/hat';
      const businessPath = productBindingBusinessPath(domain);
      expect(mockProjectStoredStripeProductId).toHaveBeenCalledTimes(1);
      expect(mockProjectStoredStripeProductId.mock.calls[0][0]).toBe(target);
      expect(mockProjectCreatedStripeProductId)
        .toHaveBeenCalledWith(createdProduct, false);
      expect(mockProductCreate).toHaveBeenCalledTimes(1);
      expect(admin.__get(targetPath).stripeProductId).toBe(createdId);
      expect(admin.__get(businessPath)).toBeDefined();
      expect(mockCheckoutCreate.mock.calls[0][0]
        .line_items[0].price_data.product).toBe(createdId);
      expect(mockFirestoreWrite.mock.calls.map(([path]) => path)).toEqual([
        targetPath,
        businessPath,
      ]);
      expect(mockProductCreate.mock.invocationCallOrder[0]).toBeLessThan(
        mockProjectCreatedStripeProductId.mock.invocationCallOrder[0],
      );
      expect(mockProjectCreatedStripeProductId.mock.invocationCallOrder[0])
        .toBeLessThan(mockFirestoreWrite.mock.invocationCallOrder[0]);
      expect(mockFirestoreWrite.mock.invocationCallOrder[0]).toBeLessThan(
        mockCheckoutCreate.mock.invocationCallOrder[0],
      );
      expect(mockCheckoutCreate.mock.invocationCallOrder[0]).toBeLessThan(
        mockFirestoreWrite.mock.invocationCallOrder[1],
      );
    },
  );

  test.each(
    ['race', 'shop'].flatMap((domain) => [
      'present undefined',
      'present null',
      'present empty string',
      'present false',
      'structured value',
      'accessor-backed value',
      'shared prototype value',
    ].map((caseName) => [domain, caseName])),
  )(
    'PAY-PRODUCT-001A RED: %s rejects a %s before later work',
    async (domain, caseName) => {
      const canary = `synthetic_${domain}_stored_product_private_canary`;
      const target = seedProductBindingTarget(domain);
      const originalSharedDescriptor = Object.getOwnPropertyDescriptor(
        Object.prototype,
        'stripeProductId',
      );
      let readHookCalls = () => 0;
      if (caseName === 'shared prototype value') {
        let hookCalls = 0;
        Object.defineProperty(Object.prototype, 'stripeProductId', {
          configurable: true,
          enumerable: false,
          get() {
            hookCalls += 1;
            throw new Error(canary);
          },
        });
        readHookCalls = () => hookCalls;
      } else {
        readHookCalls = installStoredBindingCase(target, caseName, canary);
      }
      const descriptorsBefore = Object.getOwnPropertyDescriptors(target);
      const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
        .map((method) => jest.spyOn(console, method).mockImplementation(() => {}));

      try {
        const outcome = await runProductBindingCheckout(domain).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );

        expect(outcome.error).toMatchObject({
          code: 'failed-precondition',
          message: productBindingFailureMessage(domain),
        });
        expect([
          outcome.error.code,
          outcome.error.message,
          outcome.error.stack,
        ].join('\n')).not.toContain(canary);
        expect(readHookCalls()).toBe(0);
        expect(Object.getOwnPropertyDescriptors(target)).toEqual(
          descriptorsBefore,
        );
        expect(mockRateLimit).toHaveBeenCalledTimes(2);
        expect(mockProjectStoredStripeProductId).toHaveBeenCalledTimes(1);
        expect(mockProjectStoredStripeProductId.mock.calls[0][0]).toBe(target);
        expect(Math.max(...mockRateLimit.mock.invocationCallOrder))
          .toBeLessThan(
            mockProjectStoredStripeProductId.mock.invocationCallOrder[0],
          );
        expect(mockProjectCreatedStripeProductId).not.toHaveBeenCalled();
        expect(mockGenerateToken).not.toHaveBeenCalled();
        expect(mockRegistrationAllocation).not.toHaveBeenCalled();
        expect(mockOrderAllocation).not.toHaveBeenCalled();
        expect(mockFirestoreWrite).not.toHaveBeenCalled();
        expect(mockGetStripe).not.toHaveBeenCalled();
        expect(mockProductCreate).not.toHaveBeenCalled();
        expect(mockCheckoutCreate).not.toHaveBeenCalled();
        expect(admin.__get(productBindingBusinessPath(domain))).toBeUndefined();
        consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
      } finally {
        consoleSpies.forEach((spy) => spy.mockRestore());
        if (caseName === 'shared prototype value') {
          if (originalSharedDescriptor === undefined) {
            delete Object.prototype.stripeProductId;
          } else {
            Object.defineProperty(
              Object.prototype,
              'stripeProductId',
              originalSharedDescriptor,
            );
          }
        }
      }
    },
  );

  test.each(
    ['race', 'shop'].flatMap((domain) => [
      'missing ID',
      'wrong object kind',
      'mode mismatch',
      'non-2xx response',
      'accessor-backed ID',
    ].map((caseName) => [domain, caseName])),
  )(
    'PAY-PRODUCT-001A RED: %s rejects a created Product with %s',
    async (domain, caseName) => {
      const canary = `synthetic_${domain}_created_product_private_canary`;
      const target = seedProductBindingTarget(domain);
      const { product, readHookCalls } = malformedCreatedProduct(
        caseName,
        canary,
      );
      mockProductCreate.mockResolvedValue(product);
      const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
        .map((method) => jest.spyOn(console, method).mockImplementation(() => {}));

      try {
        const outcome = await runProductBindingCheckout(domain).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );

        expect(outcome.error).toMatchObject({
          code: 'failed-precondition',
          message: productBindingFailureMessage(domain),
        });
        expect([
          outcome.error.code,
          outcome.error.message,
          outcome.error.stack,
        ].join('\n')).not.toContain(canary);
        expect(readHookCalls()).toBe(0);
        expect(mockProjectStoredStripeProductId).toHaveBeenCalledTimes(1);
        expect(mockProjectStoredStripeProductId.mock.calls[0][0]).toBe(target);
        expect(mockGenerateToken).toHaveBeenCalledTimes(1);
        expect(mockRegistrationAllocation)
          .toHaveBeenCalledTimes(domain === 'race' ? 1 : 0);
        expect(mockOrderAllocation)
          .toHaveBeenCalledTimes(domain === 'shop' ? 1 : 0);
        expect(mockGetStripe).toHaveBeenCalledTimes(1);
        expect(mockProductCreate).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(mockProductCreate.mock.calls))
          .not.toContain(canary);
        expect(mockProjectCreatedStripeProductId)
          .toHaveBeenCalledWith(product, false);
        expect(mockCheckoutCreate).not.toHaveBeenCalled();
        expect(mockFirestoreWrite).not.toHaveBeenCalled();
        expect(admin.__get(productBindingBusinessPath(domain))).toBeUndefined();
        expect(mockProjectStoredStripeProductId.mock.invocationCallOrder[0])
          .toBeLessThan(mockGenerateToken.mock.invocationCallOrder[0]);
        expect(mockGenerateToken.mock.invocationCallOrder[0]).toBeLessThan(
          (domain === 'race'
            ? mockRegistrationAllocation
            : mockOrderAllocation).mock.invocationCallOrder[0],
        );
        expect(mockProductCreate.mock.invocationCallOrder[0]).toBeLessThan(
          mockProjectCreatedStripeProductId.mock.invocationCallOrder[0],
        );
        consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
      } finally {
        consoleSpies.forEach((spy) => spy.mockRestore());
      }
    },
  );

  test.each(['race', 'shop'])(
    '%s copies one valid custom stored Product ID before later mutation',
    async (domain) => {
      const target = seedProductBindingTarget(domain);
      const originalId = `custom ${domain}/product ID test only`;
      target.stripeProductId = originalId;
      mockGenerateToken.mockImplementation(() => {
        target.stripeProductId = 'changed-after-stored-projection';
        return 'synthetic-confirmation-token';
      });

      await runProductBindingCheckout(domain);

      expect(target.stripeProductId).toBe('changed-after-stored-projection');
      expect(mockProjectStoredStripeProductId).toHaveBeenCalledTimes(1);
      expect(mockProjectCreatedStripeProductId).not.toHaveBeenCalled();
      expect(mockProductCreate).not.toHaveBeenCalled();
      expect(mockCheckoutCreate.mock.calls[0][0]
        .line_items[0].price_data.product).toBe(originalId);
    },
  );

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

  test.each(['race', 'shop'])(
    'maps a hostile %s Session-create rejection to one fixed unknown outcome',
    async (domain) => {
      const canary = `${domain}_checkout_rejection_private_canary`;
      const messageGetter = jest.fn(() => {
        throw new Error(canary);
      });
      const rejection = Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      });
      seedPaidCheckoutTarget(domain);
      mockCheckoutCreate.mockRejectedValueOnce(rejection);
      const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
        .map((method) => jest.spyOn(console, method).mockImplementation(() => {}));

      try {
        const outcome = await runProductBindingCheckout(domain).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );

        expect(outcome.error).toMatchObject({
          code: 'failed-precondition',
          message: LEGACY_CHECKOUT_RESULT_FAILURE_MESSAGE,
        });
        expect(outcome.value).toBeUndefined();
        expect(messageGetter).not.toHaveBeenCalled();
        expect(mockCheckoutCreate).toHaveBeenCalledTimes(1);
        expect(mockProductCreate).not.toHaveBeenCalled();
        expect(mockFirestoreWrite).not.toHaveBeenCalled();
        expect(admin.__get(productBindingBusinessPath(domain))).toBeUndefined();
        expect([
          outcome.error.code,
          outcome.error.message,
          outcome.error.stack,
        ].join('\n')).not.toContain(canary);
        consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
      } finally {
        consoleSpies.forEach((spy) => spy.mockRestore());
      }
    },
  );

  test.each(['race', 'shop'])(
    'rejects a mismatched resolved %s Session before its business record',
    async (domain) => {
      const canary = `${domain}_resolved_session_private_canary`;
      seedPaidCheckoutTarget(domain);
      mockCheckoutCreate.mockImplementationOnce(async (payload) => {
        if (domain === 'race') {
          return validCheckoutSessionForPayload(payload, {
            amount_total: payload.line_items[0].price_data.unit_amount + 1,
            future_private_field: canary,
          });
        }
        return validCheckoutSessionForPayload(payload, {
          url: `https://attacker.example.test/${canary}`,
          future_private_field: canary,
        });
      });
      const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
        .map((method) => jest.spyOn(console, method).mockImplementation(() => {}));

      try {
        const outcome = await runProductBindingCheckout(domain).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );

        expect(outcome.error).toMatchObject({
          code: 'failed-precondition',
          message: LEGACY_CHECKOUT_RESULT_FAILURE_MESSAGE,
        });
        expect(outcome.value).toBeUndefined();
        expect(mockCheckoutCreate).toHaveBeenCalledTimes(1);
        expect(mockProductCreate).not.toHaveBeenCalled();
        expect(mockFirestoreWrite).not.toHaveBeenCalled();
        expect(admin.__get(productBindingBusinessPath(domain))).toBeUndefined();
        expect([
          outcome.error.code,
          outcome.error.message,
          outcome.error.stack,
        ].join('\n')).not.toContain(canary);
        consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
      } finally {
        consoleSpies.forEach((spy) => spy.mockRestore());
      }
    },
  );

  test('encodes one opaque Shop slug path segment in the cancel callback', async () => {
    const productSlug = 'hat?color=blue#fragment%25';
    admin.__seed(`products/${productSlug}`, {
      checkoutEnabled: true,
      title: 'Synthetic Opaque-Slug Hat',
      slug: productSlug,
      status: 'active',
      priceCents: 2_000,
      stripeProductId: 'custom_opaque_shop_product_test_only',
    });

    const outcome = await createMerchCheckout({
      productSlug,
      buyer: {
        firstName: 'Test',
        lastName: 'Buyer',
        email: 'buyer@example.test',
      },
    }, { auth: null, rawRequest: {} });

    const expectedCancelUrl = 'https://runmprc.test/shop/'
      + `${encodeURIComponent(productSlug)}?cancelled=1`;
    expect(mockCheckoutCreate.mock.calls[0][0].cancel_url)
      .toBe(expectedCancelUrl);
    expect(outcome.url).toMatch(/^https:\/\/checkout\.stripe\.com\//u);
    expect(admin.__get('orders/order-new-1')).toMatchObject({
      productSlug,
      stripeSessionId: 'cs_test_orderpolicy',
    });
  });
});
