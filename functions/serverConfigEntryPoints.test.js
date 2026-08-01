const mockFirestoreAccess = jest.fn();
const mockStripeConstructor = jest.fn();
const mockMarkerUpdate = jest.fn();
const mockEventGet = jest.fn();
const mockMailAdd = jest.fn();

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
    firestore: {
      document: () => ({
        onCreate: (handler) => handler,
        onUpdate: (handler) => handler,
      }),
    },
    https,
    runWith: () => ({ https }),
  };
});

jest.mock('firebase-admin', () => {
  const firestore = {
    FieldValue: { arrayUnion: (value) => value },
    collection: (name) => {
      if (name === 'events') {
        return {
          doc: () => ({ get: mockEventGet }),
        };
      }
      if (name === 'mail') return { add: mockMailAdd };
      throw new Error(`Unexpected synthetic collection: ${name}`);
    },
  };
  const firestoreFunction = () => {
    mockFirestoreAccess();
    return firestore;
  };
  firestoreFunction.FieldValue = firestore.FieldValue;
  return {
    apps: [{}],
    firestore: firestoreFunction,
  };
});

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { arrayUnion: (value) => value },
  Timestamp: { now: () => ({ _seconds: 0 }) },
}));

function setValidTestConfig() {
  process.env.ENVIRONMENT_NAME = 'test';
  process.env.SITE_ORIGIN = 'https://runmprc.test';
  process.env.STRIPE_LIVEMODE_EXPECTED = 'false';
  process.env.COMMERCE_ENABLED = 'true';
  process.env.STRIPE_SECRET_KEY = [
    'sk', 'test', 'synthetic_entrypoint_key',
  ].join('_');
}

function confirmationRegistration(overrides = {}) {
  const { runner = {}, ...registration } = overrides;
  return {
    status: 'paid',
    ...registration,
    runner: {
      email: 'runner@example.test',
      ...runner,
    },
  };
}

function qualifyingUpdateChange(overrides = {}) {
  return {
    before: { data: () => ({ status: 'pending' }) },
    after: {
      data: () => confirmationRegistration(overrides),
      ref: { update: mockMarkerUpdate },
    },
  };
}

function qualifyingCreateSnapshot(overrides = {}) {
  return {
    data: () => confirmationRegistration(overrides),
    ref: { update: mockMarkerUpdate },
  };
}

describe('server configuration entry-point guards', () => {
  beforeEach(() => {
    jest.resetModules();
    setValidTestConfig();
    mockFirestoreAccess.mockClear();
    mockStripeConstructor.mockReset();
    mockStripeConstructor.mockReturnValue({ synthetic: true });
    mockMarkerUpdate.mockReset();
    mockMarkerUpdate.mockResolvedValue(undefined);
    mockEventGet.mockReset();
    mockEventGet.mockResolvedValue({
      exists: true,
      id: 'race-1',
      data: () => ({
        title: 'Synthetic Race',
        slug: 'synthetic-race',
        location: 'Synthetic Park',
      }),
    });
    mockMailAdd.mockReset();
    mockMailAdd.mockResolvedValue({ id: 'mail-synthetic-1' });
  });

  afterAll(() => {
    delete process.env.ENVIRONMENT_NAME;
    delete process.env.SITE_ORIGIN;
    delete process.env.STRIPE_LIVEMODE_EXPECTED;
    delete process.env.COMMERCE_ENABLED;
    delete process.env.STRIPE_SECRET_KEY;
  });

  test('admin order rejects invalid configuration before Firestore or Stripe', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { adminOrderAction } = require('./adminOrderAction');

    await expect(adminOrderAction({
      orderId: 'order-1',
      action: 'refund_full',
    }, {
      auth: {
        uid: 'admin-1',
        token: { email_verified: true, role: 'admin' },
      },
    })).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'Server configuration is unavailable',
    });

    expect(mockFirestoreAccess).not.toHaveBeenCalled();
    expect(mockStripeConstructor).not.toHaveBeenCalled();
  });

  test('qualifying registration update rejects invalid base config before mail work', async () => {
    delete process.env.STRIPE_LIVEMODE_EXPECTED;
    const { sendConfirmationEmail } = require('./sendConfirmationEmail');

    await expect(sendConfirmationEmail(
      qualifyingUpdateChange(),
      { params: { eventId: 'race-1', regId: 'reg-1' } },
    )).rejects.toMatchObject({
      message: 'Server configuration is unavailable',
    });

    expect(mockFirestoreAccess).not.toHaveBeenCalled();
    expect(mockMarkerUpdate).not.toHaveBeenCalled();
    expect(mockStripeConstructor).not.toHaveBeenCalled();
  });

  test('qualifying registration create rejects invalid base config before mail work', async () => {
    delete process.env.SITE_ORIGIN;
    const { sendConfirmationEmailOnCreate } = require('./sendConfirmationEmail');

    await expect(sendConfirmationEmailOnCreate(
      qualifyingCreateSnapshot(),
      { params: { eventId: 'race-1', regId: 'reg-1' } },
    )).rejects.toMatchObject({
      message: 'Server configuration is unavailable',
    });

    expect(mockFirestoreAccess).not.toHaveBeenCalled();
    expect(mockMarkerUpdate).not.toHaveBeenCalled();
    expect(mockStripeConstructor).not.toHaveBeenCalled();
  });

  test('irrelevant email trigger remains a no-op even when configuration is absent', async () => {
    delete process.env.ENVIRONMENT_NAME;
    const { sendConfirmationEmail } = require('./sendConfirmationEmail');
    const change = {
      before: { data: () => ({ status: 'pending' }) },
      after: { data: () => ({ status: 'pending' }) },
    };

    await expect(sendConfirmationEmail(change, {
      params: { eventId: 'race-1', regId: 'reg-1' },
    })).resolves.toBeUndefined();

    expect(mockFirestoreAccess).not.toHaveBeenCalled();
  });

  test.each([
    ['update', 'sendConfirmationEmail', qualifyingUpdateChange],
    ['create', 'sendConfirmationEmailOnCreate', qualifyingCreateSnapshot],
  ])('valid config keeps the confirmation-email %s path working', async (
    _name,
    exportName,
    inputFactory,
  ) => {
    delete process.env.COMMERCE_ENABLED;
    const emailFunctions = require('./sendConfirmationEmail');

    await emailFunctions[exportName](
      inputFactory(),
      { params: { eventId: 'race-1', regId: 'reg-1' } },
    );

    expect(mockFirestoreAccess).toHaveBeenCalledTimes(2);
    expect(mockEventGet).toHaveBeenCalledTimes(1);
    expect(mockMailAdd).toHaveBeenCalledWith(expect.objectContaining({
      to: 'runner@example.test',
      message: expect.objectContaining({
        html: expect.stringContaining(
          'href="https://runmprc.test/events/synthetic-race"',
        ),
        text: expect.stringContaining(
          'https://runmprc.test/events/synthetic-race',
        ),
      }),
    }));
    expect(mockMarkerUpdate).toHaveBeenCalledTimes(1);
    expect(mockStripeConstructor).not.toHaveBeenCalled();
  });

  describe('MAIL-001A1 hostile confirmation HTML', () => {
    const hostileTitle = 'Race </h2><a href="https://attacker.example.test/title">title-canary</a> & "quoted"';
    const hostileFirstName = 'Runner <img src=x onerror="runner-canary"> & \'quoted\'';
    const hostileLocation = 'Park <svg onload="location-canary"> & \'quoted\'';
    const hostileRegistrationId = 'reg/"><img src=x onerror="id-canary">';
    const hostileSlug = 'race/../?next="><a href="https://attacker.example.test/slug">&part=1';

    test.each([
      ['update', 'sendConfirmationEmail', qualifyingUpdateChange],
      ['create', 'sendConfirmationEmailOnCreate', qualifyingCreateSnapshot],
    ])('escapes record-derived HTML on the %s trigger', async (
      _name,
      exportName,
      inputFactory,
    ) => {
      mockEventGet.mockResolvedValueOnce({
        exists: true,
        id: 'hostile-event',
        data: () => ({
          location: hostileLocation,
          slug: hostileSlug,
          title: hostileTitle,
        }),
      });
      const emailFunctions = require('./sendConfirmationEmail');

      await emailFunctions[exportName](
        inputFactory({
          runner: {
            firstName: hostileFirstName,
          },
        }),
        {
          params: {
            eventId: 'hostile-event',
            regId: hostileRegistrationId,
          },
        },
      );

      expect(mockMailAdd).toHaveBeenCalledTimes(1);
      const queuedMail = mockMailAdd.mock.calls[0][0];
      const { html, subject, text } = queuedMail.message;
      const encodedSlug = encodeURIComponent(hostileSlug);

      expect(html).toContain(
        'Runner &lt;img src=x onerror=&quot;runner-canary&quot;&gt; &amp; &#39;quoted&#39;',
      );
      expect(html).toContain(
        'Race &lt;/h2&gt;&lt;a href=&quot;https://attacker.example.test/title&quot;&gt;title-canary&lt;/a&gt; &amp; &quot;quoted&quot;',
      );
      expect(html).toContain(
        'Park &lt;svg onload=&quot;location-canary&quot;&gt; &amp; &#39;quoted&#39;',
      );
      expect(html).toContain(
        'reg/&quot;&gt;&lt;img src=x onerror=&quot;id-canary&quot;&gt;',
      );
      expect(html).toContain(
        `href="https://runmprc.test/events/${encodedSlug}"`,
      );
      expect(html).not.toMatch(/<(?:img|svg)\b/i);
      expect(html).not.toContain('<a href="https://attacker.example.test/');
      expect(html.match(/<a href=/g)).toHaveLength(1);

      expect(subject).toBe(`Registration confirmed — ${hostileTitle}`);
      expect(text).toContain(hostileTitle);
      expect(text).toContain(hostileLocation);
      expect(text).toContain(`https://runmprc.test/events/${encodedSlug}`);
      expect(queuedMail.to).toBe('runner@example.test');
      expect(mockMailAdd.mock.invocationCallOrder[0])
        .toBeLessThan(mockMarkerUpdate.mock.invocationCallOrder[0]);
      expect(mockMarkerUpdate).toHaveBeenCalledTimes(1);
      expect(mockStripeConstructor).not.toHaveBeenCalled();
    });

    test('uses a fixed safe link when a stored slug cannot be URI encoded', async () => {
      const malformedSlug = 'synthetic-unpaired-surrogate-\ud800';
      mockEventGet.mockResolvedValueOnce({
        exists: true,
        id: 'malformed-slug-event',
        data: () => ({
          location: 'Synthetic Park',
          slug: malformedSlug,
          title: 'Synthetic Race',
        }),
      });
      const { sendConfirmationEmailOnCreate } = require('./sendConfirmationEmail');

      await sendConfirmationEmailOnCreate(
        qualifyingCreateSnapshot({ runner: { firstName: 'Synthetic Runner' } }),
        {
          params: {
            eventId: 'malformed-slug-event',
            regId: 'malformed-slug-registration',
          },
        },
      );

      const queuedMail = mockMailAdd.mock.calls[0][0];
      expect(queuedMail.message.html).toContain(
        '<a href="https://runmprc.test/events/">Event page</a>',
      );
      expect(queuedMail.message.text).toContain('https://runmprc.test/events/');
      expect(queuedMail.message.html).not.toContain(malformedSlug);
      expect(queuedMail.message.text).not.toContain(malformedSlug);
      expect(mockMarkerUpdate).toHaveBeenCalledTimes(1);
    });
  });

  test('cached Stripe client never bypasses a later configuration failure', () => {
    const { getStripe } = require('./stripeHelpers');

    expect(getStripe()).toEqual({ synthetic: true });
    expect(getStripe()).toEqual({ synthetic: true });
    expect(mockStripeConstructor).toHaveBeenCalledTimes(1);

    delete process.env.ENVIRONMENT_NAME;

    expect(() => getStripe()).toThrow('Server configuration is unavailable');
    expect(mockStripeConstructor).toHaveBeenCalledTimes(1);
  });
});
