const mockCheckoutCreate = jest.fn();
const mockProductCreate = jest.fn();
const mockGetStripe = jest.fn();
const mockRateLimit = jest.fn();
const mockFirestoreAccess = jest.fn();
const mockFirestoreWrite = jest.fn();
const mockGenerateToken = jest.fn();
const mockResolveCallerRole = jest.fn();
const mockCountActiveRegistrations = jest.fn();
const mockRegistrationAllocation = jest.fn();
const mockOrderAllocation = jest.fn();

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
    pickPriceCents,
    isEarlyBirdActive,
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

const admin = require('firebase-admin');
const { createCheckoutSession } = require('./createCheckoutSession');
const { createMerchCheckout } = require('./createMerchCheckout');

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
    mockRegistrationAllocation.mockReset();
    mockOrderAllocation.mockReset();
    mockGetStripe.mockReturnValue({
      checkout: { sessions: { create: mockCheckoutCreate } },
      products: { create: mockProductCreate },
    });
    mockRateLimit.mockResolvedValue(undefined);
    mockGenerateToken.mockReturnValue('synthetic-confirmation-token');
    mockCountActiveRegistrations.mockResolvedValue(0);
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
      stripeSessionId: 'cs_registration_policy',
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
      sessionId: 'cs_registration_policy',
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
    ['size', { sizes: ['M'], colors: ['blue'] }, { size: 'XL' }, 'Invalid size'],
    ['color', { sizes: ['M'], colors: ['blue'] }, { color: 'red' }, 'Invalid color'],
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

  test('keeps valid missing-Product mapping and checkout behavior', async () => {
    admin.__seed('products/hat', {
      checkoutEnabled: true,
      title: 'Synthetic Hat',
      slug: 'hat',
      status: 'active',
      priceCents: 2_000,
    });
    mockProductCreate.mockResolvedValue({ id: 'prod_hat_created' });

    await createMerchCheckout({
      productSlug: 'hat',
      buyer: {
        firstName: 'Test',
        lastName: 'Buyer',
        email: 'buyer@example.test',
      },
    }, { auth: null, rawRequest: {} });

    expect(mockProductCreate).toHaveBeenCalledTimes(1);
    expect(admin.__get('products/hat').stripeProductId).toBe('prod_hat_created');
    expect(admin.__get('orders/order-new-1').amountCents).toBe(2_000);
    expect(mockCheckoutCreate.mock.calls[0][0]
      .line_items[0].price_data.unit_amount).toBe(2_000);
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
