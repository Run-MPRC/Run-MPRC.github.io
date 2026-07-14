export {};

const mockCreateUserWithEmailAndPassword = jest.fn();
const mockApplyActionCode = jest.fn();
const mockCheckActionCode = jest.fn();
type MockAuthStateCallback = (
  user: Record<string, unknown> | null,
) => Promise<void>;
const mockOnAuthStateChanged = jest.fn((
  auth: unknown,
  callback: MockAuthStateCallback,
) => {
  if (auth === undefined || typeof callback !== 'function') {
    throw new Error('invalid synthetic auth mock setup');
  }
  return jest.fn();
});
const mockReportClientFailure = jest.fn();
const mockSendEmailVerification = jest.fn();
const mockSignInWithEmailAndPassword = jest.fn();
const mockSignOut = jest.fn();
const { deserialize, serialize } = require('v8');

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
  signInWithEmailAndPassword: mockSignInWithEmailAndPassword,
  signOut: mockSignOut,
}));

jest.mock('../monitoring/clientDiagnostics', () => ({
  clientFailureEvents: {
    emailVerificationFailed: 'email_verification_failed',
  },
  reportClientFailure: mockReportClientFailure,
}));

const {
  default: IdentityService,
  projectUserRoleFromTokenClaims,
} = require('./Identity');

function createIdentity(currentUser: Record<string, unknown> | null = null) {
  return new IdentityService({
    auth: {
      authStateReady: jest.fn().mockResolvedValue(undefined),
      currentUser,
    },
  });
}

interface CapturedIdentity {
  auth: {
    authStateReady: jest.Mock;
    currentUser: Record<string, unknown> | null;
  };
  emitAuthState: MockAuthStateCallback;
  identity: InstanceType<typeof IdentityService>;
}

function createCapturedIdentity(
  currentUser: Record<string, unknown> | null = null,
): CapturedIdentity {
  let emitAuthState: MockAuthStateCallback = async () => undefined;
  mockOnAuthStateChanged.mockImplementationOnce((_auth, callback) => {
    emitAuthState = callback;
    return jest.fn();
  });
  const auth = {
    authStateReady: jest.fn().mockResolvedValue(undefined),
    currentUser,
  };

  return {
    auth,
    emitAuthState: (user) => emitAuthState(user),
    identity: new IdentityService({ auth }),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

function createRoleUser(
  uid: string,
  tokenResult: unknown | Promise<unknown>,
) {
  return {
    email: `${uid}@example.test`,
    getIdTokenResult: jest.fn().mockImplementation(() => Promise.resolve(tokenResult)),
    uid,
  };
}

describe('Identity browser role projection', () => {
  const originalStructuredClone = globalThis.structuredClone;

  beforeAll(() => {
    // Jest's jsdom global omits the browser API. V8 serialization uses the
    // same relevant boundary here: plain ID-token data clones and Proxy
    // objects reject. Runtime browsers use their native structuredClone.
    Object.defineProperty(globalThis, 'structuredClone', {
      configurable: true,
      value: (value: unknown) => deserialize(serialize(value)),
      writable: true,
    });
  });

  afterAll(() => {
    if (originalStructuredClone === undefined) {
      delete (globalThis as { structuredClone?: unknown }).structuredClone;
      return;
    }
    Object.defineProperty(globalThis, 'structuredClone', {
      configurable: true,
      value: originalStructuredClone,
      writable: true,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each([
    ['member', 'member'],
    ['admin', 'admin'],
  ])('projects exact verified %s claims', (role, expected) => {
    const claims = Object.freeze({
      email_verified: true,
      role,
      synthetic_extra: 'preserved',
    });

    expect(projectUserRoleFromTokenClaims(claims)).toBe(expected);
    expect(claims.synthetic_extra).toBe('preserved');
  });

  test.each([
    ['missing', undefined],
    ['false', false],
    ['string', 'true'],
    ['number', 1],
    ['null', null],
  ])('does not project a privileged role with %s verification', (_name, value) => {
    const claims: Record<string, unknown> = { role: 'admin' };
    if (value !== undefined) claims.email_verified = value;

    expect(projectUserRoleFromTokenClaims(claims)).toBeNull();
  });

  test('does not accept the Firebase profile-style emailVerified field', () => {
    expect(projectUserRoleFromTokenClaims({
      emailVerified: true,
      role: 'admin',
    })).toBeNull();
  });

  test.each([
    ['missing', undefined],
    ['unknown', 'officer'],
    ['case changed', 'Admin'],
    ['empty', ''],
    ['number', 1],
  ])('rejects a %s role', (_name, value) => {
    const claims: Record<string, unknown> = { email_verified: true };
    if (value !== undefined) claims.role = value;

    expect(projectUserRoleFromTokenClaims(claims)).toBeNull();
  });

  test('rejects an array-shaped claim record', () => {
    const claims = Object.assign([], {
      email_verified: true,
      role: 'admin',
    });

    expect(projectUserRoleFromTokenClaims(claims)).toBeNull();
  });

  test.each([
    { role: 'unverified' },
    { email_verified: false, role: 'unverified' },
    { email_verified: true, role: 'unverified' },
  ])('preserves exact unverified only as a non-privileged state', (claims) => {
    expect(projectUserRoleFromTokenClaims(claims)).toBe('unverified');
  });

  test('rejects inherited claims', () => {
    expect(projectUserRoleFromTokenClaims(Object.create({
      email_verified: true,
      role: 'admin',
    }))).toBeNull();

    const inheritedRole = Object.create({ role: 'member' });
    inheritedRole.email_verified = true;
    expect(projectUserRoleFromTokenClaims(inheritedRole)).toBeNull();
  });

  test('rejects an accessor-backed verification claim without invoking it', () => {
    const verificationGetter = jest.fn(() => true);
    const claims = { role: 'admin' };
    Object.defineProperty(claims, 'email_verified', {
      enumerable: true,
      get: verificationGetter,
    });

    expect(projectUserRoleFromTokenClaims(claims)).toBeNull();
    expect(verificationGetter).not.toHaveBeenCalled();
  });

  test('rejects an accessor-backed role with data verification', () => {
    const roleGetter = jest.fn(() => 'admin');
    const claims = { email_verified: true };
    Object.defineProperty(claims, 'role', {
      enumerable: true,
      get: roleGetter,
    });

    expect(projectUserRoleFromTokenClaims(claims)).toBeNull();
    expect(roleGetter).not.toHaveBeenCalled();
  });

  test('rejects cyclic or symbol-bearing claim data', () => {
    const cyclic: Record<string, unknown> = {
      email_verified: true,
      role: 'admin',
    };
    cyclic.loop = cyclic;
    const symbolBearing = {
      email_verified: true,
      role: 'admin',
      [Symbol('private-claim')]: 'private-symbol-value',
    };

    expect(projectUserRoleFromTokenClaims(cyclic)).toBeNull();
    expect(projectUserRoleFromTokenClaims(symbolBearing)).toBeNull();
  });

  test('rejects transparent and throwing proxies without logging canaries', () => {
    const consoleSpies = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
    const target = {
      email_verified: true,
      role: 'admin',
      private_claim_canary: 'private-claim-value-canary',
    };
    const transparent = new Proxy(target, {});
    const throwing = new Proxy(target, {
      getOwnPropertyDescriptor() {
        throw new Error('private-proxy-error-canary');
      },
    });

    expect(projectUserRoleFromTokenClaims(transparent)).toBeNull();
    expect(projectUserRoleFromTokenClaims(throwing)).toBeNull();
    expect(JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls)))
      .not.toMatch(/private-claim|private-proxy/);
    consoleSpies.forEach((spy) => spy.mockRestore());
  });

  test('fails closed when the browser cannot safely clone claim data', () => {
    const testStructuredClone = globalThis.structuredClone;
    delete (globalThis as { structuredClone?: unknown }).structuredClone;

    try {
      expect(projectUserRoleFromTokenClaims({
        email_verified: true,
        role: 'admin',
      })).toBeNull();
    } finally {
      Object.defineProperty(globalThis, 'structuredClone', {
        configurable: true,
        value: testStructuredClone,
        writable: true,
      });
    }
  });

  test('emits no privileged browser role when Auth reports an unverified role token', async () => {
    const { auth, emitAuthState, identity } = createCapturedIdentity();
    const listener = jest.fn();
    identity.onAuthStateChanged(listener);
    const user = {
      email: 'synthetic-member@example.test',
      getIdTokenResult: jest.fn().mockResolvedValue({
        claims: { email_verified: false, role: 'admin' },
      }),
      uid: 'synthetic-user',
    };
    auth.currentUser = user;

    await emitAuthState(user);

    expect(user.getIdTokenResult).toHaveBeenCalledWith(true);
    expect(listener).toHaveBeenLastCalledWith({
      email: 'synthetic-member@example.test',
      role: null,
      uid: 'synthetic-user',
    });
  });

  test.each(['member', 'admin'])(
    'emits exact verified %s after one forced Auth token refresh',
    async (role) => {
      const { auth, emitAuthState, identity } = createCapturedIdentity();
      const listener = jest.fn();
      identity.onAuthStateChanged(listener);
      const user = createRoleUser(`synthetic-${role}`, {
        claims: { email_verified: true, role },
      });
      auth.currentUser = user;

      await emitAuthState(user);

      expect(user.getIdTokenResult).toHaveBeenCalledTimes(1);
      expect(user.getIdTokenResult).toHaveBeenCalledWith(true);
      expect(listener).toHaveBeenNthCalledWith(1, {
        email: `synthetic-${role}@example.test`,
        role: null,
        uid: `synthetic-${role}`,
      });
      expect(listener).toHaveBeenLastCalledWith({
        email: `synthetic-${role}@example.test`,
        role,
        uid: `synthetic-${role}`,
      });
    },
  );

  test('does not expose account A role while account B projection is pending', async () => {
    const { auth, emitAuthState, identity } = createCapturedIdentity();
    const listener = jest.fn();
    identity.onAuthStateChanged(listener);
    const accountA = createRoleUser('account-a', {
      claims: { email_verified: true, role: 'admin' },
    });
    auth.currentUser = accountA;
    await emitAuthState(accountA);
    expect(identity.currentUser).toEqual({
      email: 'account-a@example.test',
      role: 'admin',
      uid: 'account-a',
    });

    const firstAccountBResult = createDeferred<unknown>();
    const deniedAccountBResult = {
      claims: { email_verified: false, role: 'admin' },
    };
    const accountB = createRoleUser('account-b', firstAccountBResult.promise);
    accountB.getIdTokenResult
      .mockImplementationOnce(() => firstAccountBResult.promise)
      .mockResolvedValue(deniedAccountBResult);
    auth.currentUser = accountB;

    const immediateListener = jest.fn();
    identity.onAuthStateChanged(immediateListener);
    expect(immediateListener).toHaveBeenCalledWith({
      email: 'account-b@example.test',
      role: null,
      uid: 'account-b',
    });
    expect(identity.currentUser).toEqual({
      email: 'account-b@example.test',
      role: null,
      uid: 'account-b',
    });

    const accountBRefresh = emitAuthState(accountB);
    expect(listener).toHaveBeenLastCalledWith({
      email: 'account-b@example.test',
      role: null,
      uid: 'account-b',
    });
    expect(immediateListener).toHaveBeenLastCalledWith({
      email: 'account-b@example.test',
      role: null,
      uid: 'account-b',
    });
    expect(identity.currentUser).toEqual({
      email: 'account-b@example.test',
      role: null,
      uid: 'account-b',
    });
    await expect(identity.checkAdmin()).resolves.toBe(false);
    await expect(identity.checkMembership()).resolves.toBe(false);

    firstAccountBResult.resolve(deniedAccountBResult);
    await accountBRefresh;
    expect(identity.currentUser).toEqual({
      email: 'account-b@example.test',
      role: null,
      uid: 'account-b',
    });
  });

  test('ignores account A completion after account B completes first', async () => {
    const { auth, emitAuthState, identity } = createCapturedIdentity();
    const listener = jest.fn();
    identity.onAuthStateChanged(listener);
    const accountAResult = createDeferred<unknown>();
    const accountBResult = createDeferred<unknown>();
    const accountA = createRoleUser('account-a', accountAResult.promise);
    const accountB = createRoleUser('account-b', accountBResult.promise);

    auth.currentUser = accountA;
    const accountARefresh = emitAuthState(accountA);
    auth.currentUser = accountB;
    const accountBRefresh = emitAuthState(accountB);
    expect(listener).toHaveBeenLastCalledWith({
      email: 'account-b@example.test',
      role: null,
      uid: 'account-b',
    });

    accountBResult.resolve({
      claims: { email_verified: true, role: 'member' },
    });
    await accountBRefresh;
    expect(listener).toHaveBeenLastCalledWith({
      email: 'account-b@example.test',
      role: 'member',
      uid: 'account-b',
    });

    accountAResult.resolve({
      claims: { email_verified: true, role: 'admin' },
    });
    await accountARefresh;
    expect(identity.currentUser).toEqual({
      email: 'account-b@example.test',
      role: 'member',
      uid: 'account-b',
    });
    expect(listener).toHaveBeenLastCalledWith({
      email: 'account-b@example.test',
      role: 'member',
      uid: 'account-b',
    });
  });

  test('ignores a pending role completion after sign-out', async () => {
    const { auth, emitAuthState, identity } = createCapturedIdentity();
    const listener = jest.fn();
    identity.onAuthStateChanged(listener);
    const accountResult = createDeferred<unknown>();
    const account = createRoleUser('account-a', accountResult.promise);
    auth.currentUser = account;
    const accountRefresh = emitAuthState(account);

    auth.currentUser = null;
    await emitAuthState(null);
    expect(identity.currentUser).toBeNull();
    expect(listener).toHaveBeenLastCalledWith(null);

    accountResult.resolve({
      claims: { email_verified: true, role: 'admin' },
    });
    await accountRefresh;
    expect(identity.currentUser).toBeNull();
    expect(listener).toHaveBeenLastCalledWith(null);
    await expect(identity.checkAdmin()).resolves.toBe(false);
    await expect(identity.checkMembership()).resolves.toBe(false);
  });

  test('ignores a stale null callback while the current account remains signed in', async () => {
    const { auth, emitAuthState, identity } = createCapturedIdentity();
    const listener = jest.fn();
    identity.onAuthStateChanged(listener);
    const account = createRoleUser('account-b', {
      claims: { email_verified: true, role: 'member' },
    });
    auth.currentUser = account;
    await emitAuthState(account);
    const callsBeforeStaleNull = listener.mock.calls.length;

    await emitAuthState(null);

    expect(identity.currentUser).toEqual({
      email: 'account-b@example.test',
      role: 'member',
      uid: 'account-b',
    });
    expect(listener).toHaveBeenCalledTimes(callsBeforeStaleNull);
    await expect(identity.checkMembership()).resolves.toBe(true);
  });

  describe('direct Auth command lifecycle', () => {
    test('keeps successful sign-in fulfilled when one subscriber throws', async () => {
      const { auth, identity } = createCapturedIdentity();
      const account = createRoleUser('sign-in-account', {
        claims: { email_verified: true, role: 'member' },
      });
      const credential = { operationType: 'signIn', user: account };
      mockSignInWithEmailAndPassword.mockImplementationOnce(async () => {
        auth.currentUser = account;
        return credential;
      });
      const throwingSubscriber = jest.fn(() => {
        throw new Error('synthetic-subscriber-failure');
      });
      const observer = jest.fn();
      identity.onAuthStateChanged(throwingSubscriber);
      identity.onAuthStateChanged(observer);

      await expect(identity.signIn(
        'sign-in-account@example.test',
        'synthetic-password',
      )).resolves.toBe(credential);

      expect(mockSignInWithEmailAndPassword).toHaveBeenCalledWith(
        auth,
        'sign-in-account@example.test',
        'synthetic-password',
      );
      expect(account.getIdTokenResult).toHaveBeenCalledWith(true);
      expect(throwingSubscriber).toHaveBeenCalled();
      expect(observer).toHaveBeenLastCalledWith({
        email: 'sign-in-account@example.test',
        role: 'member',
        uid: 'sign-in-account',
      });
    });

    test('keeps successful registration and verification request after a subscriber throws', async () => {
      const { auth, identity } = createCapturedIdentity();
      const account = {
        email: 'registration-account@example.test',
        uid: 'registration-account',
      };
      const credential = { operationType: 'signIn', user: account };
      mockCreateUserWithEmailAndPassword.mockImplementationOnce(async () => {
        auth.currentUser = account;
        return credential;
      });
      mockSendEmailVerification.mockResolvedValueOnce(undefined);
      const throwingSubscriber = jest.fn(() => {
        throw new Error('synthetic-subscriber-failure');
      });
      const observer = jest.fn();
      identity.onAuthStateChanged(throwingSubscriber);
      identity.onAuthStateChanged(observer);

      await expect(identity.register(
        'registration-account@example.test',
        'synthetic-password',
      )).resolves.toEqual({
        credential,
        user: account,
        verificationEmailRequest: 'accepted',
      });

      expect(mockCreateUserWithEmailAndPassword).toHaveBeenCalledWith(
        auth,
        'registration-account@example.test',
        'synthetic-password',
      );
      expect(mockSendEmailVerification).toHaveBeenCalledTimes(1);
      expect(mockSendEmailVerification).toHaveBeenCalledWith(account);
      expect(throwingSubscriber).toHaveBeenCalled();
      expect(observer).toHaveBeenLastCalledWith({
        email: 'registration-account@example.test',
        role: 'unverified',
        uid: 'registration-account',
      });
    });

    test.each([
      'provider callback before command completion',
      'provider callback after command completion',
    ])('emits one signed-out event with %s', async (callbackOrder) => {
      const { auth, emitAuthState, identity } = createCapturedIdentity();
      const account = createRoleUser('sign-out-account', {
        claims: { email_verified: true, role: 'member' },
      });
      const throwingSubscriber = jest.fn(() => {
        throw new Error('synthetic-subscriber-failure');
      });
      const listener = jest.fn();
      identity.onAuthStateChanged(throwingSubscriber);
      identity.onAuthStateChanged(listener);
      auth.currentUser = account;
      await emitAuthState(account);
      throwingSubscriber.mockClear();
      listener.mockClear();

      if (callbackOrder === 'provider callback before command completion') {
        mockSignOut.mockImplementationOnce(async () => {
          auth.currentUser = null;
          await emitAuthState(null);
        });
      } else {
        mockSignOut.mockImplementationOnce(async () => {
          auth.currentUser = null;
        });
      }

      await expect(identity.signOut()).resolves.toBeUndefined();
      if (callbackOrder === 'provider callback after command completion') {
        await emitAuthState(null);
      }

      expect(mockSignOut).toHaveBeenCalledTimes(1);
      expect(mockSignOut).toHaveBeenCalledWith(auth);
      expect(identity.currentUser).toBeNull();
      expect(throwingSubscriber).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls).toEqual([[null]]);
    });
  });
});

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
