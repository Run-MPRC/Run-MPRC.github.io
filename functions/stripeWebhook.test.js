const crypto = require('crypto');

jest.mock('firebase-admin', () => {
  const update = jest.fn().mockResolvedValue();
  const docRef = { update };
  const regDocSnap = {
    ref: docRef,
    data: () => ({ status: 'pending', amountCents: 5000 }),
  };
  const query = {
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({
      empty: false,
      docs: [regDocSnap],
    }),
  };
  const firestore = {
    collectionGroup: jest.fn(() => query),
  };
  firestore.FieldValue = { arrayUnion: (x) => x };
  return {
    initializeApp: jest.fn(),
    apps: [{}],
    firestore: Object.assign(() => firestore, { FieldValue: firestore.FieldValue }),
    __mockRef: docRef,
  };
});

jest.mock('firebase-functions', () => {
  const chain = {
    https: {
      onRequest: (fn) => fn,
      onCall: (fn) => fn,
      HttpsError: class HttpsError extends Error {
        constructor(code, message) {
          super(message);
          this.code = code;
        }
      },
    },
  };
  const config = () => ({});
  return {
    runWith: () => chain,
    https: chain.https,
    config,
  };
});

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: { now: () => ({ _seconds: Math.floor(Date.now() / 1000) }) },
  FieldValue: { arrayUnion: (x) => x },
}));

describe('stripeWebhook', () => {
  const WEBHOOK_SECRET = 'whsec_testsecret';
  const STRIPE_KEY = 'sk_test_testing';

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = STRIPE_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    jest.resetModules();
  });

  function signedRequest(payload) {
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signed = `${timestamp}.${body}`;
    const signature = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(signed, 'utf8')
      .digest('hex');
    return {
      body,
      rawBody: Buffer.from(body),
      headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` },
    };
  }

  function mockResponse() {
    return {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
    };
  }

  test('rejects request with no signature', async () => {
    const { stripeWebhook } = require('./stripeWebhook');
    const req = {
      method: 'POST',
      rawBody: Buffer.from('{}'),
      get: () => undefined,
    };
    const res = mockResponse();
    await stripeWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects request with tampered signature', async () => {
    const { stripeWebhook } = require('./stripeWebhook');
    const { body, rawBody } = signedRequest({ id: 'evt_1', type: 'checkout.session.completed' });
    const req = {
      method: 'POST',
      rawBody,
      body,
      get: (h) => (h === 'stripe-signature' ? 't=1,v1=0000' : undefined),
    };
    const res = mockResponse();
    await stripeWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects non-POST', async () => {
    const { stripeWebhook } = require('./stripeWebhook');
    const res = mockResponse();
    await stripeWebhook({ method: 'GET', get: () => undefined }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
