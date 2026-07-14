const mockVerifyIdToken = jest.fn();
const mockFirestoreAccess = jest.fn();
const mockQueryGet = jest.fn();

jest.mock('firebase-functions', () => ({
  https: { onRequest: (handler) => handler },
}));

jest.mock('firebase-admin', () => {
  const registrations = {
    orderBy: jest.fn(() => ({ get: (...args) => mockQueryGet(...args) })),
  };
  const event = { collection: jest.fn(() => registrations) };
  const events = { doc: jest.fn(() => event) };
  return {
    auth: jest.fn(() => ({
      verifyIdToken: (...args) => mockVerifyIdToken(...args),
    })),
    firestore: jest.fn(() => {
      mockFirestoreAccess();
      return { collection: jest.fn(() => events) };
    }),
  };
});

const { exportRegistrationsCsv } = require('./exportRegistrationsCsv');

function request({ authorization = 'Bearer synthetic-token', method = 'GET' } = {}) {
  return {
    method,
    query: { eventId: 'event-synthetic' },
    get: jest.fn((name) => {
      if (name === 'Authorization') return authorization;
      if (name === 'origin') return 'https://runmprc.com';
      return '';
    }),
  };
}

function response() {
  const result = {
    set: jest.fn(),
    status: jest.fn(),
    send: jest.fn(),
  };
  result.status.mockReturnValue(result);
  result.send.mockReturnValue(result);
  return result;
}

describe('registration CSV verified-admin boundary', () => {
  beforeEach(() => {
    mockVerifyIdToken.mockReset();
    mockFirestoreAccess.mockClear();
    mockQueryGet.mockReset();
  });

  test('rejects a missing bearer token before token verification or Firestore', async () => {
    const res = response();
    await exportRegistrationsCsv(request({ authorization: '' }), res);

    expect(mockVerifyIdToken).not.toHaveBeenCalled();
    expect(mockFirestoreAccess).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith('Admin auth required');
  });

  test('rejects provider token-verification failure before Firestore', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('synthetic verification failure'));
    const res = response();
    await exportRegistrationsCsv(request(), res);

    expect(mockFirestoreAccess).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith('Admin auth required');
  });

  test.each([
    ['missing verification', { role: 'admin' }],
    ['false verification', { email_verified: false, role: 'admin' }],
    ['string verification', { email_verified: 'true', role: 'admin' }],
    ['numeric verification', { email_verified: 1, role: 'admin' }],
    ['profile mirror', { emailVerified: true, role: 'admin' }],
    ['verified member', { email_verified: true, role: 'member' }],
    ['case-changed admin', { email_verified: true, role: 'Admin' }],
  ])('rejects %s before any registration query', async (_name, decoded) => {
    mockVerifyIdToken.mockResolvedValue(decoded);
    const res = response();
    await exportRegistrationsCsv(request(), res);

    expect(mockFirestoreAccess).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith('Admin auth required');
  });

  test('does not invoke accessor-backed decoded-token claims', async () => {
    const emailGetter = jest.fn(() => true);
    const roleGetter = jest.fn(() => 'admin');
    const verificationAccessor = { role: 'admin' };
    Object.defineProperty(verificationAccessor, 'email_verified', {
      get: emailGetter,
    });
    const roleAccessor = { email_verified: true };
    Object.defineProperty(roleAccessor, 'role', {
      get: roleGetter,
    });
    mockVerifyIdToken
      .mockResolvedValueOnce(verificationAccessor)
      .mockResolvedValueOnce(roleAccessor);
    const firstResponse = response();
    const secondResponse = response();

    await exportRegistrationsCsv(request(), firstResponse);
    await exportRegistrationsCsv(request(), secondResponse);

    expect(emailGetter).not.toHaveBeenCalled();
    expect(roleGetter).not.toHaveBeenCalled();
    expect(mockFirestoreAccess).not.toHaveBeenCalled();
    expect(firstResponse.status).toHaveBeenCalledWith(403);
    expect(secondResponse.status).toHaveBeenCalledWith(403);
  });

  test('preserves verified-admin CSV behavior with synthetic records', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'synthetic-admin',
      email_verified: true,
      role: 'admin',
      unrelated: 'allowed',
    });
    mockQueryGet.mockResolvedValue({
      forEach(callback) {
        callback({
          id: 'registration-synthetic',
          data: () => ({
            status: 'paid',
            signupType: 'participant',
            priceTier: 'nonMember',
            amountCents: 2500,
            currency: 'usd',
            runner: {
              firstName: 'Synthetic',
              lastName: 'Runner',
              email: 'runner@example.test',
            },
          }),
        });
      },
    });
    const res = response();

    await exportRegistrationsCsv(request(), res);

    expect(mockFirestoreAccess).toHaveBeenCalledTimes(1);
    expect(mockQueryGet).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.set).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('registration-synthetic'));
  });

  test('does not echo the bearer token when role authorization fails', async () => {
    const hostileToken = 'synthetic-private-token-canary';
    mockVerifyIdToken.mockResolvedValue({ role: 'admin' });
    const res = response();

    await exportRegistrationsCsv(request({
      authorization: `Bearer ${hostileToken}`,
    }), res);

    expect(JSON.stringify(res.send.mock.calls)).not.toContain(hostileToken);
    expect(res.send).toHaveBeenCalledWith('Admin auth required');
  });
});
