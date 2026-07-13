export {};

const mockCreateUserWithEmailAndPassword = jest.fn();
const mockOnAuthStateChanged = jest.fn(() => jest.fn());
const mockReportClientFailure = jest.fn();
const mockSendEmailVerification = jest.fn();

jest.mock('firebase/auth', () => ({
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

function createIdentity() {
  return new IdentityService({ auth: { currentUser: null } });
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
