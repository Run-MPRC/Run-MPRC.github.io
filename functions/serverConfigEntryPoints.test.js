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
  process.env.STRIPE_SECRET_KEY = [
    'sk', 'test', 'synthetic_entrypoint_key',
  ].join('_');
}

function qualifyingUpdateChange() {
  return {
    before: { data: () => ({ status: 'pending' }) },
    after: {
      data: () => ({
        status: 'paid',
        runner: { email: 'runner@example.test' },
      }),
      ref: { update: mockMarkerUpdate },
    },
  };
}

function qualifyingCreateSnapshot() {
  return {
    data: () => ({
      status: 'paid',
      runner: { email: 'runner@example.test' },
    }),
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
    delete process.env.STRIPE_SECRET_KEY;
  });

  test('admin order rejects invalid configuration before Firestore or Stripe', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { adminOrderAction } = require('./adminOrderAction');

    await expect(adminOrderAction({
      orderId: 'order-1',
      action: 'refund_full',
    }, {
      auth: { uid: 'admin-1', token: { role: 'admin' } },
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
        text: expect.stringContaining(
          'https://runmprc.test/events/synthetic-race',
        ),
      }),
    }));
    expect(mockMarkerUpdate).toHaveBeenCalledTimes(1);
    expect(mockStripeConstructor).not.toHaveBeenCalled();
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
