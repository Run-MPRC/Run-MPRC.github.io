export {};

const mockCreateUserWithEmailAndPassword = jest.fn();
const mockApplyActionCode = jest.fn();
const mockCheckActionCode = jest.fn();
const mockOnAuthStateChanged = jest.fn(() => jest.fn());
const mockReportClientFailure = jest.fn();
const mockSendEmailVerification = jest.fn();

jest.mock('firebase/auth', () => ({
  ActionCodeOperation: {
    RECOVER_EMAIL: 'RECOVER_EMAIL',
    VERIFY_EMAIL: 'VERIFY_EMAIL',
  },
  applyActionCode: mockApplyActionCode,
  checkActionCode: mockCheckActionCode,
  createUserWithEmailAndPassword: mockCreateUserWithEmailAndPassword,
  onAuthStateChanged: mockOnAuthStateChanged,
  sendEmailVerification: mockSendEmailVerification,
  sendPasswordResetEmail: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
}));

jest.mock('../monitoring/clientDiagnostics', () => ({
  clientFailureEvents: {
    emailVerificationFailed: 'email_verification_failed',
  },
  reportClientFailure: mockReportClientFailure,
}));

const IdentityService = require('./Identity').default;

function createIdentity(currentUser: Record<string, unknown> | null = null) {
  return new IdentityService({
    auth: {
      authStateReady: jest.fn().mockResolvedValue(undefined),
      currentUser,
    },
  });
}

describe('Identity registration email outcome', () => {
  const credential = {
    operationType: 'signIn',
    providerId: 'password',
    user: {
      email: 'synthetic-member@example.test',
      uid: 'synthetic-uid',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateUserWithEmailAndPassword.mockResolvedValue(credential);
    mockSendEmailVerification.mockResolvedValue(undefined);
  });

  test('reports account creation and an accepted verification request separately', async () => {
    await expect(createIdentity().register(
      'synthetic-member@example.test',
      'synthetic-password',
    )).resolves.toEqual({
      credential,
      user: credential.user,
      verificationEmailRequest: 'accepted',
    });

    expect(mockSendEmailVerification).toHaveBeenCalledWith(credential.user);
    expect(mockReportClientFailure).not.toHaveBeenCalled();
    expect(credential).not.toHaveProperty('verificationEmailRequest');
  });

  test('preserves the account and reports unavailable when the request fails', async () => {
    const providerError = Object.assign(
      new Error('provider-response-canary synthetic-member@example.test'),
      {
        code: 'auth/provider-code-canary',
        token: 'verification-action-token-canary',
      },
    );
    mockSendEmailVerification.mockRejectedValueOnce(providerError);

    const result = await createIdentity().register(
      'synthetic-member@example.test',
      'synthetic-password',
    );

    expect(result).toEqual({
      credential,
      user: credential.user,
      verificationEmailRequest: 'unavailable',
    });
    expect(result.credential).toBe(credential);
    expect(result.user).toBe(credential.user);
    expect(mockReportClientFailure).toHaveBeenCalledWith('email_verification_failed');
    expect(JSON.stringify(mockReportClientFailure.mock.calls)).not.toContain(
      'provider-response-canary',
    );
    expect(JSON.stringify(mockReportClientFailure.mock.calls)).not.toContain(
      'synthetic-member@example.test',
    );
    expect(JSON.stringify(mockReportClientFailure.mock.calls)).not.toContain(
      'verification-action-token-canary',
    );
  });

  test('does not request verification or report email success when account creation fails', async () => {
    const providerError = new Error('create-account-provider-canary');
    mockCreateUserWithEmailAndPassword.mockRejectedValueOnce(providerError);

    await expect(createIdentity().register(
      'synthetic-member@example.test',
      'synthetic-password',
    )).rejects.toBe(providerError);

    expect(mockSendEmailVerification).not.toHaveBeenCalled();
    expect(mockReportClientFailure).not.toHaveBeenCalled();
  });
});

describe('Identity email verification action', () => {
  const checkedVerification = {
    data: { email: 'synthetic-member@example.test' },
    operation: 'VERIFY_EMAIL',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckActionCode.mockResolvedValue(checkedVerification);
    mockApplyActionCode.mockResolvedValue(undefined);
  });

  test('checks the provider operation before applying one valid code', async () => {
    await expect(createIdentity().verifyEmailAction('synthetic-action-code'))
      .resolves.toBe('verified');

    expect(mockCheckActionCode).toHaveBeenCalledWith(
      expect.any(Object),
      'synthetic-action-code',
    );
    expect(mockApplyActionCode).toHaveBeenCalledWith(
      expect.any(Object),
      'synthetic-action-code',
    );
    expect(mockCheckActionCode.mock.invocationCallOrder[0])
      .toBeLessThan(mockApplyActionCode.mock.invocationCallOrder[0]);
  });

  test('returns already complete only for the matching verified signed-in account', async () => {
    const currentUser = {
      email: 'SYNTHETIC-MEMBER@example.test',
      emailVerified: true,
    };

    await expect(createIdentity(currentUser).verifyEmailAction('synthetic-action-code'))
      .resolves.toBe('already-complete');

    expect(mockApplyActionCode).not.toHaveBeenCalled();
  });

  test('blocks a valid code for a different signed-in account without returning either address', async () => {
    const currentUser = {
      email: 'different-account@example.test',
      emailVerified: false,
    };

    const result = await createIdentity(currentUser)
      .verifyEmailAction('synthetic-action-code');

    expect(result).toBe('wrong-account');
    expect(mockApplyActionCode).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('different-account');
    expect(JSON.stringify(result)).not.toContain('synthetic-member');
  });

  test('blocks an email-less signed-in account without applying the code', async () => {
    const currentUser = {
      email: null,
      emailVerified: false,
    };

    await expect(createIdentity(currentUser).verifyEmailAction('synthetic-action-code'))
      .resolves.toBe('wrong-account');

    expect(mockApplyActionCode).not.toHaveBeenCalled();
  });

  test('re-reads the current account after the provider check settles', async () => {
    const auth = {
      authStateReady: jest.fn().mockResolvedValue(undefined),
      currentUser: null as Record<string, unknown> | null,
    };
    mockCheckActionCode.mockImplementationOnce(async () => {
      auth.currentUser = {
        email: 'different-account@example.test',
        emailVerified: false,
      };
      return checkedVerification;
    });
    const identity = new IdentityService({ auth });

    await expect(identity.verifyEmailAction('synthetic-action-code'))
      .resolves.toBe('wrong-account');

    expect(mockApplyActionCode).not.toHaveBeenCalled();
  });

  test('does not apply a code whose provider operation is not email verification', async () => {
    mockCheckActionCode.mockResolvedValueOnce({
      data: { email: 'synthetic-member@example.test' },
      operation: 'RECOVER_EMAIL',
    });

    await expect(createIdentity().verifyEmailAction('recover-email-code'))
      .resolves.toBe('unusable');

    expect(mockApplyActionCode).not.toHaveBeenCalled();
  });

  test.each([
    '',
    'control\ncode',
    'a'.repeat(2049),
    '%ZZ',
    '\uFFFD',
    '#',
    '\u200B',
    '😀',
  ])('rejects malformed direct action code input without a provider call', async (actionCode) => {
    await expect(createIdentity().verifyEmailAction(actionCode))
      .resolves.toBe('unusable');

    expect(mockCheckActionCode).not.toHaveBeenCalled();
    expect(mockApplyActionCode).not.toHaveBeenCalled();
  });

  test('maps Auth startup failure to the fixed temporary result', async () => {
    const identity = new IdentityService({
      auth: {
        authStateReady: jest.fn().mockRejectedValue(new Error('private-auth-state-canary')),
        currentUser: null,
      },
    });

    await expect(identity.verifyEmailAction('synthetic-action-code'))
      .resolves.toBe('unavailable');

    expect(mockApplyActionCode).not.toHaveBeenCalled();
  });

  test('fails closed when checked verification metadata has no target email', async () => {
    mockCheckActionCode.mockResolvedValueOnce({
      data: {},
      operation: 'VERIFY_EMAIL',
    });

    await expect(createIdentity().verifyEmailAction('missing-metadata-code'))
      .resolves.toBe('unusable');

    expect(mockApplyActionCode).not.toHaveBeenCalled();
  });

  test.each([
    'auth/expired-action-code',
    'auth/invalid-action-code',
    'auth/user-disabled',
    'auth/user-not-found',
  ])('maps an unusable check error %s to one fixed result', async (code) => {
    mockCheckActionCode.mockRejectedValueOnce(Object.assign(
      new Error('private-check-error-canary synthetic-member@example.test'),
      { code, actionUrl: 'https://example.test/?oobCode=private-code-canary' },
    ));

    await expect(createIdentity().verifyEmailAction('synthetic-action-code'))
      .resolves.toBe('unusable');

    expect(mockApplyActionCode).not.toHaveBeenCalled();
  });

  test.each([
    'auth/expired-action-code',
    'auth/invalid-action-code',
    'auth/user-disabled',
    'auth/user-not-found',
  ])('maps an apply race %s to the same unusable result', async (code) => {
    mockApplyActionCode.mockRejectedValueOnce(Object.assign(
      new Error('private-apply-error-canary synthetic-member@example.test'),
      { code, token: 'private-code-canary' },
    ));

    await expect(createIdentity().verifyEmailAction('synthetic-action-code'))
      .resolves.toBe('unusable');
  });

  test.each([
    'auth/network-request-failed',
    'auth/too-many-requests',
    'auth/internal-error',
  ])('maps a temporary provider error %s to one fixed result', async (code) => {
    mockCheckActionCode.mockRejectedValueOnce(Object.assign(
      new Error('temporary-private-canary synthetic-member@example.test'),
      { code, token: 'temporary-code-canary' },
    ));

    await expect(createIdentity().verifyEmailAction('synthetic-action-code'))
      .resolves.toBe('unavailable');
  });

  test('does not log or return a hostile unknown provider failure', async () => {
    const consoleSpies = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
    mockApplyActionCode.mockRejectedValueOnce(Object.assign(
      new Error('unknown-private-canary synthetic-member@example.test'),
      { token: 'unknown-code-canary' },
    ));

    const result = await createIdentity().verifyEmailAction('synthetic-action-code');

    expect(result).toBe('unavailable');
    expect(JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls)))
      .not.toMatch(/unknown-private|synthetic-member|unknown-code/);
    consoleSpies.forEach((spy) => spy.mockRestore());
  });
});
