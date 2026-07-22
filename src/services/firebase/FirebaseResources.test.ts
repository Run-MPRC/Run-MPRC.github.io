import { browserRouterStateIsClean } from '../monitoring/capabilityCallback';

const fs = require('node:fs');
const path = require('node:path');

const mockAuth = { name: 'test-auth' };
const mockFirestore = { name: 'test-firestore' };
const mockFunctions = { name: 'test-functions' };

const mockInitializeApp = jest.fn((options: Record<string, string>) => ({
  name: 'test-app',
  options,
}));
const mockGetAuth = jest.fn(() => mockAuth);
const mockGetFirestore = jest.fn(() => mockFirestore);
const mockGetFunctions = jest.fn(() => mockFunctions);
const mockConnectAuthEmulator = jest.fn();
const mockConnectFirestoreEmulator = jest.fn();
const mockConnectFunctionsEmulator = jest.fn();
const mockGetAnalytics = jest.fn(() => ({ name: 'test-analytics' }));
const mockIsAnalyticsSupported = jest.fn(() => Promise.resolve(false));
const mockInitializeAppCheck = jest.fn();
const mockGetToken = jest.fn();
const mockReCaptchaEnterpriseProvider = jest.fn((siteKey: string) => ({
  kind: 'enterprise',
  siteKey,
}));
const mockReCaptchaV3Provider = jest.fn((siteKey: string) => ({ siteKey }));

jest.mock('firebase/app', () => ({ initializeApp: mockInitializeApp }));
jest.mock('firebase/analytics', () => ({
  getAnalytics: mockGetAnalytics,
  isSupported: mockIsAnalyticsSupported,
}));
jest.mock('firebase/app-check', () => ({
  getToken: mockGetToken,
  initializeAppCheck: mockInitializeAppCheck,
  ReCaptchaEnterpriseProvider: mockReCaptchaEnterpriseProvider,
  ReCaptchaV3Provider: mockReCaptchaV3Provider,
}));
jest.mock('firebase/auth', () => ({
  connectAuthEmulator: mockConnectAuthEmulator,
  getAuth: mockGetAuth,
}));
jest.mock('firebase/firestore', () => ({
  connectFirestoreEmulator: mockConnectFirestoreEmulator,
  getFirestore: mockGetFirestore,
}));
jest.mock('firebase/functions', () => ({
  connectFunctionsEmulator: mockConnectFunctionsEmulator,
  getFunctions: mockGetFunctions,
}));

function setNodeEnv(value: string | undefined) {
  Object.defineProperty(process.env, 'NODE_ENV', {
    configurable: true,
    value,
    writable: true,
  });
}

function createResourcesFor(
  nodeEnv: string,
  siteKey?: string,
  locationPath = '/',
) {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSiteKey = process.env.REACT_APP_RECAPTCHA_SITE_KEY;
  const originalLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  setNodeEnv(nodeEnv);
  if (siteKey === undefined) delete process.env.REACT_APP_RECAPTCHA_SITE_KEY;
  else process.env.REACT_APP_RECAPTCHA_SITE_KEY = siteKey;
  window.history.replaceState(null, '', locationPath);

  try {
    let resources: import('./FirebaseResources').default;
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      const FirebaseResources = require('./FirebaseResources').default;
      resources = FirebaseResources.getInstance();
    });
    return resources!;
  } finally {
    window.history.replaceState(null, '', originalLocation);
    setNodeEnv(originalNodeEnv);
    if (originalSiteKey === undefined) delete process.env.REACT_APP_RECAPTCHA_SITE_KEY;
    else process.env.REACT_APP_RECAPTCHA_SITE_KEY = originalSiteKey;
  }
}

async function withFirebaseModuleFor(
  nodeEnv: string,
  siteKey: string | undefined,
  initialLocation: string,
  body: (
    FirebaseResources: typeof import('./FirebaseResources').default,
  ) => void | Promise<void>,
  initialHistoryState: unknown = null,
) {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSiteKey = process.env.REACT_APP_RECAPTCHA_SITE_KEY;
  const originalLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  setNodeEnv(nodeEnv);
  if (siteKey === undefined) delete process.env.REACT_APP_RECAPTCHA_SITE_KEY;
  else process.env.REACT_APP_RECAPTCHA_SITE_KEY = siteKey;
  window.history.replaceState(initialHistoryState, '', initialLocation);

  try {
    let FirebaseResources!: typeof import('./FirebaseResources').default;
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      FirebaseResources = require('./FirebaseResources').default;
    });
    await body(FirebaseResources);
  } finally {
    window.history.replaceState(null, '', originalLocation);
    setNodeEnv(originalNodeEnv);
    if (originalSiteKey === undefined) delete process.env.REACT_APP_RECAPTCHA_SITE_KEY;
    else process.env.REACT_APP_RECAPTCHA_SITE_KEY = originalSiteKey;
  }
}

describe('FirebaseResources environment isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInitializeApp.mockImplementation((options: Record<string, string>) => ({
      name: 'test-app',
      options,
    }));
    mockGetAuth.mockReturnValue(mockAuth);
    mockGetFirestore.mockReturnValue(mockFirestore);
    mockGetFunctions.mockReturnValue(mockFunctions);
    mockGetAnalytics.mockReturnValue({ name: 'test-analytics' });
    mockInitializeAppCheck.mockReturnValue({ name: 'test-app-check' });
    mockGetToken.mockResolvedValue({ token: 'synthetic-app-check-token' });
    mockReCaptchaEnterpriseProvider.mockImplementation((siteKey: string) => ({
      kind: 'enterprise',
      siteKey,
    }));
    mockReCaptchaV3Provider.mockImplementation((siteKey: string) => ({ siteKey }));
    mockConnectAuthEmulator.mockImplementation(() => undefined);
    mockConnectFirestoreEmulator.mockImplementation(() => undefined);
    mockConnectFunctionsEmulator.mockImplementation(() => undefined);
    mockIsAnalyticsSupported.mockImplementation(() => Promise.resolve(false));
  });

  test('accepts only empty or exact clean BrowserRouter history state', () => {
    const exactState = { idx: 0, key: 'abcd1234', usr: null };
    const userStateGetter = jest.fn(() => null);
    const callbackDetailGetter = jest.fn(() => 'private-callback-canary');
    const accessorState = { idx: 0, key: 'abcd1234' };
    Object.defineProperty(accessorState, 'usr', { get: userStateGetter });
    const extraState = { ...exactState } as typeof exactState & { code?: string };
    Object.defineProperty(extraState, 'code', { get: callbackDetailGetter });
    const hostileState = new Proxy(exactState, {
      getPrototypeOf() {
        throw new Error('private-history-proxy-canary');
      },
    });
    const arrayState = Object.assign([], exactState);
    const callableState = Object.assign(() => undefined, exactState);
    const nullPrototypeState = Object.assign(Object.create(null), exactState);

    expect(browserRouterStateIsClean(null)).toBe(true);
    expect(browserRouterStateIsClean(null, 'default')).toBe(true);
    expect(browserRouterStateIsClean(null, 'abcd1234')).toBe(false);
    expect(browserRouterStateIsClean(exactState)).toBe(true);
    expect(browserRouterStateIsClean(exactState, 'abcd1234')).toBe(true);
    expect(browserRouterStateIsClean({ ...exactState, key: 'i' }, 'i')).toBe(true);
    expect(browserRouterStateIsClean({ ...exactState, key: '' }, '')).toBe(true);
    expect(browserRouterStateIsClean({ ...exactState, key: '' }, 'default')).toBe(true);
    expect(browserRouterStateIsClean(exactState, 'wxyz5678')).toBe(false);
    expect(browserRouterStateIsClean({ ...exactState, key: 'abcdefghi' })).toBe(false);
    expect(browserRouterStateIsClean({ ...exactState, code: 'private-code-canary' })).toBe(false);
    expect(browserRouterStateIsClean({ ...exactState, state: 'private-state-canary' })).toBe(false);
    expect(browserRouterStateIsClean(accessorState)).toBe(false);
    expect(browserRouterStateIsClean(extraState)).toBe(false);
    expect(browserRouterStateIsClean(hostileState)).toBe(false);
    expect(browserRouterStateIsClean(arrayState)).toBe(false);
    expect(browserRouterStateIsClean(callableState)).toBe(false);
    expect(browserRouterStateIsClean(nullPrototypeState)).toBe(false);
    expect(userStateGetter).not.toHaveBeenCalled();
    expect(callbackDetailGetter).not.toHaveBeenCalled();
  });

  test('development uses only the demo namespace and all three emulators', () => {
    const resources = createResourcesFor('development', 'configured-public-site-key');

    expect(resources.app.options).toEqual(expect.objectContaining({
      apiKey: 'demo-api-key',
      authDomain: 'demo-mprc-local.firebaseapp.com',
      projectId: 'demo-mprc-local',
      storageBucket: 'demo-mprc-local.appspot.com',
    }));
    expect(resources.app.options).not.toEqual(expect.objectContaining({
      projectId: 'mid-peninsula-running-club',
    }));
    expect(JSON.stringify(resources.app.options)).not.toContain(
      'mid-peninsula-running-club',
    );
    expect(JSON.stringify(resources.app.options)).not.toContain('253289716314');
    expect(resources.functions).toBe(mockFunctions);
    expect(mockConnectAuthEmulator).toHaveBeenCalledWith(
      mockAuth,
      'http://127.0.0.1:9099',
      { disableWarnings: true },
    );
    expect(mockConnectFirestoreEmulator).toHaveBeenCalledWith(
      mockFirestore,
      '127.0.0.1',
      8080,
    );
    expect(mockConnectFunctionsEmulator).toHaveBeenCalledWith(
      mockFunctions,
      '127.0.0.1',
      5001,
    );
    expect(mockInitializeAppCheck).not.toHaveBeenCalled();
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockReCaptchaEnterpriseProvider).not.toHaveBeenCalled();
    expect(mockReCaptchaV3Provider).not.toHaveBeenCalled();
    expect(mockIsAnalyticsSupported).not.toHaveBeenCalled();
    expect(mockGetAnalytics).not.toHaveBeenCalled();
    expect(resources.getHttpFunctionUrl('exportRegistrationsCsv')).toBe(
      'http://127.0.0.1:5001/demo-mprc-local/us-central1/exportRegistrationsCsv',
    );
  });

  test.each([
    ['Auth', mockConnectAuthEmulator],
    ['Firestore', mockConnectFirestoreEmulator],
    ['Functions', mockConnectFunctionsEmulator],
  ])('development startup fails closed when %s cannot be configured', (_name, connector) => {
    connector.mockImplementationOnce(() => {
      throw new Error('connection setup failed');
    });

    expect(() => createResourcesFor('development')).toThrow(
      'Local Firebase emulator isolation failed; stop development startup.',
    );
  });

  test('suppresses startup when an empty Router user state has extra saved detail', async () => {
    await withFirebaseModuleFor(
      'production',
      'configured-public-site-key',
      '/account/strava/callback',
      async (FirebaseResources) => {
        FirebaseResources.getInstance();

        expect(mockReCaptchaEnterpriseProvider).not.toHaveBeenCalled();
        expect(mockInitializeAppCheck).not.toHaveBeenCalled();
        expect(mockGetToken).not.toHaveBeenCalled();
      },
      {
        idx: 0,
        key: 'abcd1234',
        usr: null,
        code: 'private-saved-code-canary',
      },
    );
  });

  test('test runtime also uses the demo project and local emulators', () => {
    const resources = createResourcesFor('test', 'configured-public-site-key');

    expect(resources.app.options.projectId).toBe('demo-mprc-local');
    expect(mockConnectAuthEmulator).toHaveBeenCalled();
    expect(mockConnectFirestoreEmulator).toHaveBeenCalled();
    expect(mockConnectFunctionsEmulator).toHaveBeenCalled();
    expect(mockInitializeAppCheck).not.toHaveBeenCalled();
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockReCaptchaEnterpriseProvider).not.toHaveBeenCalled();
    expect(mockReCaptchaV3Provider).not.toHaveBeenCalled();
    expect(mockIsAnalyticsSupported).not.toHaveBeenCalled();
  });

  test('production uses only the Enterprise App Check provider without Analytics', async () => {
    const enterpriseProvider = {
      kind: 'enterprise',
      siteKey: 'configured-public-site-key',
    };
    mockReCaptchaEnterpriseProvider.mockReturnValueOnce(enterpriseProvider);
    const resources = createResourcesFor('production', 'configured-public-site-key');

    expect(resources.app.options.projectId).toBe('mid-peninsula-running-club');
    expect(mockConnectAuthEmulator).not.toHaveBeenCalled();
    expect(mockConnectFirestoreEmulator).not.toHaveBeenCalled();
    expect(mockConnectFunctionsEmulator).not.toHaveBeenCalled();
    expect(mockReCaptchaEnterpriseProvider).toHaveBeenCalledTimes(1);
    expect(mockReCaptchaEnterpriseProvider).toHaveBeenCalledWith(
      'configured-public-site-key',
    );
    expect(mockReCaptchaV3Provider).not.toHaveBeenCalled();
    expect(mockInitializeAppCheck).toHaveBeenCalledTimes(1);
    expect(mockInitializeAppCheck).toHaveBeenCalledWith(
      resources.app,
      {
        provider: enterpriseProvider,
        isTokenAutoRefreshEnabled: true,
      },
    );
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockIsAnalyticsSupported).not.toHaveBeenCalled();
    expect(mockGetAnalytics).not.toHaveBeenCalled();
    expect(resources.analytics).toBeNull();
    await Promise.resolve();
    expect(resources.getHttpFunctionUrl('exportRegistrationsCsv')).toBe(
      'https://us-central1-mid-peninsula-running-club.cloudfunctions.net/'
      + 'exportRegistrationsCsv',
    );
  });

  test('production without an App Check key continues with one fixed diagnostic', () => {
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const resources = createResourcesFor('production');

      expect(resources.auth).toBe(mockAuth);
      expect(resources.firestore).toBe(mockFirestore);
      expect(resources.functions).toBe(mockFunctions);
      expect(mockReCaptchaEnterpriseProvider).not.toHaveBeenCalled();
      expect(mockReCaptchaV3Provider).not.toHaveBeenCalled();
      expect(mockInitializeAppCheck).not.toHaveBeenCalled();
      expect(mockGetToken).not.toHaveBeenCalled();
      expect(consoleWarn).toHaveBeenCalledTimes(1);
      expect(consoleWarn).toHaveBeenCalledWith('[MPRC client] app_check_disabled');
    } finally {
      consoleWarn.mockRestore();
    }
  });

  test('App Check failure continues without logging provider details', () => {
    const canaries = [
      'app-check-member@example.test',
      'app-check-provider-response-canary',
      'app-check-token-canary',
    ];
    const providerError = Object.assign(new Error(canaries.join(' ')), {
      response: canaries[1],
      token: canaries[2],
    });
    mockInitializeAppCheck.mockImplementationOnce(() => { throw providerError; });
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const resources = createResourcesFor('production', 'configured-public-site-key');

      expect(resources.auth).toBe(mockAuth);
      expect(resources.firestore).toBe(mockFirestore);
      expect(resources.functions).toBe(mockFunctions);
      expect(consoleWarn).toHaveBeenCalledWith(
        '[MPRC client] app_check_initialization_failed',
      );
      expect(consoleWarn).toHaveBeenCalledTimes(1);
      const serializedConsole = JSON.stringify(consoleWarn.mock.calls);
      canaries.forEach((canary) => expect(serializedConsole).not.toContain(canary));
    } finally {
      consoleWarn.mockRestore();
    }
  });

  test('Enterprise provider failure continues without logging provider details', () => {
    const canary = 'enterprise-provider-private-canary';
    mockReCaptchaEnterpriseProvider.mockImplementationOnce(() => {
      throw new Error(canary);
    });
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const resources = createResourcesFor('production', 'configured-public-site-key');

      expect(resources.auth).toBe(mockAuth);
      expect(resources.firestore).toBe(mockFirestore);
      expect(resources.functions).toBe(mockFunctions);
      expect(mockInitializeAppCheck).not.toHaveBeenCalled();
      expect(mockGetToken).not.toHaveBeenCalled();
      expect(consoleWarn).toHaveBeenCalledTimes(1);
      expect(consoleWarn).toHaveBeenCalledWith(
        '[MPRC client] app_check_initialization_failed',
      );
      expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain(canary);
    } finally {
      consoleWarn.mockRestore();
    }
  });

  test.each([
    '/account/strava/callback?code=example&state=example-state',
    '/register/success?registration=r1&token=example-capability',
    '/shop/purchase/success?order=o1&token=example-capability',
    '/register/success#example-capability',
    '/REGISTER/SUCCESS?registration=r1&token=example-capability',
    '/shop/purchase/success/?order=o1&token=example-capability',
    '/auth/action?mode=verifyEmail&oobCode=example-action-code',
    '/AUTH/ACTION/?mode=verifyEmail&oobCode=example-action-code',
    '/%61uth/action#example-action-code',
    '/register/%73uccess?registration=r1&token=example-capability',
    '/%72egister/success#example-capability',
    '/register/%ZZsuccess?token=example-capability',
  ])('production keeps App Check and Analytics off a capability callback: %s', (pathName) => {
    createResourcesFor('production', 'configured-public-site-key', pathName);

    expect(mockReCaptchaEnterpriseProvider).not.toHaveBeenCalled();
    expect(mockReCaptchaV3Provider).not.toHaveBeenCalled();
    expect(mockInitializeAppCheck).not.toHaveBeenCalled();
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockIsAnalyticsSupported).not.toHaveBeenCalled();
    expect(mockGetAnalytics).not.toHaveBeenCalled();
  });

  test('remembers the initial Auth capability after the visible URL is scrubbed', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSiteKey = process.env.REACT_APP_RECAPTCHA_SITE_KEY;
    const originalLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    setNodeEnv('production');
    process.env.REACT_APP_RECAPTCHA_SITE_KEY = 'configured-public-site-key';
    window.history.replaceState(
      null,
      '',
      '/auth/action?mode=verifyEmail&oobCode=example-action-code#private',
    );

    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line global-require
        const FirebaseResources = require('./FirebaseResources').default;
        window.history.replaceState(null, '', '/auth/action');
        FirebaseResources.getInstance();
      });

      expect(mockReCaptchaEnterpriseProvider).not.toHaveBeenCalled();
      expect(mockReCaptchaV3Provider).not.toHaveBeenCalled();
      expect(mockInitializeAppCheck).not.toHaveBeenCalled();
      expect(mockGetToken).not.toHaveBeenCalled();
      expect(mockIsAnalyticsSupported).not.toHaveBeenCalled();
      expect(mockGetAnalytics).not.toHaveBeenCalled();
    } finally {
      window.history.replaceState(null, '', originalLocation);
      setNodeEnv(originalNodeEnv);
      if (originalSiteKey === undefined) {
        delete process.env.REACT_APP_RECAPTCHA_SITE_KEY;
      } else {
        process.env.REACT_APP_RECAPTCHA_SITE_KEY = originalSiteKey;
      }
    }
  });

  test.each([
    '/account/strava/callback',
    '/auth/action',
    '/register/success',
    '/shop/purchase/success',
  ])('suppresses startup on a clean capability path with non-null Router state: %s', async (
    initialLocation,
  ) => {
    await withFirebaseModuleFor(
      'production',
      'configured-public-site-key',
      initialLocation,
      async (FirebaseResources) => {
        const resources = FirebaseResources.getInstance();

        expect(mockReCaptchaEnterpriseProvider).not.toHaveBeenCalled();
        expect(mockInitializeAppCheck).not.toHaveBeenCalled();
        expect(mockGetToken).not.toHaveBeenCalled();

        window.history.replaceState(
          { idx: 0, key: 'abcd1234', usr: null },
          '',
          initialLocation,
        );
        await expect(
          resources.prepareAppCheckAfterStravaCallbackCleanup(),
        ).rejects.toThrow('Strava callback App Check preparation failed.');
        expect(mockReCaptchaEnterpriseProvider).not.toHaveBeenCalled();
        expect(mockInitializeAppCheck).not.toHaveBeenCalled();
        expect(mockGetToken).not.toHaveBeenCalled();
      },
      {
        idx: 0,
        key: 'private-callback-entry',
        usr: { privateCallbackState: 'router-state-canary' },
      },
    );
  });

  test.each([
    [
      'plain',
      '/account/strava/callback?code=synthetic-code&state=synthetic-state',
      '/account/strava/callback',
    ],
    [
      'case-changed',
      '/ACCOUNT/STRAVA/CALLBACK?code=synthetic-code&state=synthetic-state',
      '/ACCOUNT/STRAVA/CALLBACK',
    ],
    [
      'encoded segments',
      '/%61ccount/%73trava/%63allback?code=synthetic-code&state=synthetic-state',
      '/%61ccount/%73trava/%63allback',
    ],
    [
      'trailing slashes',
      '/account/strava/callback///?code=synthetic-code&state=synthetic-state',
      '/account/strava/callback///',
    ],
  ])('prepares App Check after a clean %s initial Strava callback', async (
    _case,
    initialLocation,
    cleanLocation,
  ) => {
    const appCheck = { name: 'delayed-test-app-check' };
    const tokenGetter = jest.fn(() => 'private-token-canary');
    const toJSON = jest.fn(() => 'private-token-serialization-canary');
    const tokenResult = { toJSON };
    Object.defineProperty(tokenResult, 'token', { get: tokenGetter });
    mockInitializeAppCheck.mockReturnValueOnce(appCheck);
    mockGetToken.mockResolvedValueOnce(tokenResult);

    await withFirebaseModuleFor(
      'production',
      'configured-public-site-key',
      initialLocation,
      async (FirebaseResources) => {
        // The module remembers the initial capability even if cleanup wins
        // before the service singleton is constructed.
        window.history.replaceState(
          { idx: 0, key: 'abcd1234', usr: null },
          '',
          cleanLocation,
        );
        const resources = FirebaseResources.getInstance();

        expect(mockReCaptchaEnterpriseProvider).not.toHaveBeenCalled();
        expect(mockInitializeAppCheck).not.toHaveBeenCalled();
        expect(mockGetToken).not.toHaveBeenCalled();

        await expect(
          resources.prepareAppCheckAfterStravaCallbackCleanup(),
        ).resolves.toBeUndefined();

        expect(mockReCaptchaEnterpriseProvider).toHaveBeenCalledTimes(1);
        expect(mockReCaptchaEnterpriseProvider).toHaveBeenCalledWith(
          'configured-public-site-key',
        );
        expect(mockInitializeAppCheck).toHaveBeenCalledTimes(1);
        expect(mockInitializeAppCheck).toHaveBeenCalledWith(resources.app, {
          provider: {
            kind: 'enterprise',
            siteKey: 'configured-public-site-key',
          },
          isTokenAutoRefreshEnabled: true,
        });
        expect(mockGetToken).toHaveBeenCalledTimes(1);
        expect(mockGetToken).toHaveBeenCalledWith(appCheck);
      },
    );

    expect(tokenGetter).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
  });

  test.each(['development', 'test'])(
    '%s keeps delayed App Check preparation as a local no-op',
    async (nodeEnv) => {
      const resources = createResourcesFor(
        nodeEnv,
        'configured-public-site-key',
        '/account/strava/callback?code=synthetic-code&state=synthetic-state',
      );

      await expect(
        resources.prepareAppCheckAfterStravaCallbackCleanup(),
      ).resolves.toBeUndefined();
      expect(mockReCaptchaEnterpriseProvider).not.toHaveBeenCalled();
      expect(mockInitializeAppCheck).not.toHaveBeenCalled();
      expect(mockGetToken).not.toHaveBeenCalled();
    },
  );

  test.each([
    [
      'query remains',
      '/account/strava/callback?code=reinjected-code&state=reinjected-state',
    ],
    ['fragment remains', '/account/strava/callback#reinjected-fragment'],
    ['path is wrong', '/account'],
    ['path encoding is malformed', '/account/%ZZ/callback'],
  ])('rejects delayed App Check preparation when the current native %s', async (
    _case,
    currentLocation,
  ) => {
    await withFirebaseModuleFor(
      'production',
      'configured-public-site-key',
      '/account/strava/callback?code=synthetic-code&state=synthetic-state',
      async (FirebaseResources) => {
        window.history.replaceState(null, '', currentLocation);
        const resources = FirebaseResources.getInstance();

        await expect(
          resources.prepareAppCheckAfterStravaCallbackCleanup(),
        ).rejects.toThrow('Strava callback App Check preparation failed.');
        expect(mockReCaptchaEnterpriseProvider).not.toHaveBeenCalled();
        expect(mockInitializeAppCheck).not.toHaveBeenCalled();
        expect(mockGetToken).not.toHaveBeenCalled();
      },
    );
  });

  test('rejects delayed preparation when clean Router metadata has extra saved detail', async () => {
    await withFirebaseModuleFor(
      'production',
      'configured-public-site-key',
      '/account/strava/callback?code=synthetic-code&state=synthetic-state',
      async (FirebaseResources) => {
        window.history.replaceState(
          {
            idx: 0,
            key: 'abcd1234',
            usr: null,
            state: 'private-saved-state-canary',
          },
          '',
          '/account/strava/callback',
        );
        const resources = FirebaseResources.getInstance();

        await expect(
          resources.prepareAppCheckAfterStravaCallbackCleanup(),
        ).rejects.toThrow('Strava callback App Check preparation failed.');
        expect(mockReCaptchaEnterpriseProvider).not.toHaveBeenCalled();
        expect(mockInitializeAppCheck).not.toHaveBeenCalled();
        expect(mockGetToken).not.toHaveBeenCalled();
      },
    );
  });

  test.each([
    '/auth/action?mode=verifyEmail&oobCode=synthetic-action-code',
    '/register/success?registration=r1&token=synthetic-capability',
    '/shop/purchase/success?order=o1&token=synthetic-capability',
    '/account/%ZZ/callback?code=synthetic-code&state=synthetic-state',
  ])('does not restart App Check from a non-Strava initial capability: %s', async (
    initialLocation,
  ) => {
    await withFirebaseModuleFor(
      'production',
      'configured-public-site-key',
      initialLocation,
      async (FirebaseResources) => {
        window.history.replaceState(null, '', '/account/strava/callback');
        const resources = FirebaseResources.getInstance();

        await expect(
          resources.prepareAppCheckAfterStravaCallbackCleanup(),
        ).rejects.toThrow('Strava callback App Check preparation failed.');
        expect(mockReCaptchaEnterpriseProvider).not.toHaveBeenCalled();
        expect(mockInitializeAppCheck).not.toHaveBeenCalled();
        expect(mockGetToken).not.toHaveBeenCalled();
      },
    );
  });

  test('shares one provider and token-readiness flight across concurrent calls', async () => {
    const appCheck = { name: 'single-flight-test-app-check' };
    let finishToken: (() => void) | undefined;
    mockInitializeAppCheck.mockReturnValueOnce(appCheck);
    mockGetToken.mockImplementationOnce(() => new Promise((resolve) => {
      finishToken = () => resolve({ token: 'synthetic-app-check-token' });
    }));

    await withFirebaseModuleFor(
      'production',
      'configured-public-site-key',
      '/account/strava/callback?code=synthetic-code&state=synthetic-state',
      async (FirebaseResources) => {
        window.history.replaceState(null, '', '/account/strava/callback');
        const resources = FirebaseResources.getInstance();
        const first = resources.prepareAppCheckAfterStravaCallbackCleanup();
        const second = resources.prepareAppCheckAfterStravaCallbackCleanup();

        expect(second).toBe(first);
        await Promise.resolve();
        await Promise.resolve();
        expect(mockReCaptchaEnterpriseProvider).toHaveBeenCalledTimes(1);
        expect(mockInitializeAppCheck).toHaveBeenCalledTimes(1);
        expect(mockGetToken).toHaveBeenCalledTimes(1);

        finishToken?.();
        await expect(Promise.all([first, second])).resolves.toEqual([
          undefined,
          undefined,
        ]);

        const afterReady = resources.prepareAppCheckAfterStravaCallbackCleanup();
        expect(afterReady).toBe(first);
        await expect(afterReady).resolves.toBeUndefined();
        expect(mockReCaptchaEnterpriseProvider).toHaveBeenCalledTimes(1);
        expect(mockInitializeAppCheck).toHaveBeenCalledTimes(1);
        expect(mockGetToken).toHaveBeenCalledTimes(1);
      },
    );
  });

  test('a dirty concurrent call poisons the queued clean preparation', async () => {
    await withFirebaseModuleFor(
      'production',
      'configured-public-site-key',
      '/account/strava/callback?code=synthetic-code&state=synthetic-state',
      async (FirebaseResources) => {
        window.history.replaceState(null, '', '/account/strava/callback');
        const resources = FirebaseResources.getInstance();
        const first = resources.prepareAppCheckAfterStravaCallbackCleanup();

        window.history.replaceState(
          null,
          '',
          '/account/strava/callback?code=reinjected-code-canary',
        );
        const dirty = resources.prepareAppCheckAfterStravaCallbackCleanup();
        window.history.replaceState(null, '', '/account/strava/callback');

        await expect(dirty).rejects.toThrow(
          'Strava callback App Check preparation failed.',
        );
        await expect(first).rejects.toThrow(
          'Strava callback App Check preparation failed.',
        );
        expect(mockReCaptchaEnterpriseProvider).not.toHaveBeenCalled();
        expect(mockInitializeAppCheck).not.toHaveBeenCalled();
        expect(mockGetToken).not.toHaveBeenCalled();
      },
    );
  });

  test('a clean provider reentry shares the queued preparation', async () => {
    let reenteredPreparation: Promise<void> | undefined;

    await withFirebaseModuleFor(
      'production',
      'configured-public-site-key',
      '/account/strava/callback?code=synthetic-code&state=synthetic-state',
      async (FirebaseResources) => {
        window.history.replaceState(null, '', '/account/strava/callback');
        const resources = FirebaseResources.getInstance();
        mockReCaptchaEnterpriseProvider.mockImplementationOnce((siteKey: string) => {
          reenteredPreparation = resources.prepareAppCheckAfterStravaCallbackCleanup();
          return { kind: 'enterprise', siteKey };
        });

        const preparation = resources.prepareAppCheckAfterStravaCallbackCleanup();
        await expect(preparation).resolves.toBeUndefined();
        expect(reenteredPreparation).toBe(preparation);
        expect(mockReCaptchaEnterpriseProvider).toHaveBeenCalledTimes(1);
        expect(mockInitializeAppCheck).toHaveBeenCalledTimes(1);
        expect(mockGetToken).toHaveBeenCalledTimes(1);
      },
    );
  });

  test.each([
    ['Enterprise construction', 'provider'],
    ['App Check initialization', 'initialization'],
    ['token request', 'token'],
  ])('stops at the next boundary when %s dirties the callback', async (
    _case,
    boundary,
  ) => {
    const dirtyCallback = () => {
      window.history.replaceState(
        null,
        '',
        '/account/strava/callback?code=boundary-reinjection-canary',
      );
    };
    if (boundary === 'provider') {
      mockReCaptchaEnterpriseProvider.mockImplementationOnce((siteKey: string) => {
        dirtyCallback();
        return { kind: 'enterprise', siteKey };
      });
    } else if (boundary === 'initialization') {
      mockInitializeAppCheck.mockImplementationOnce(() => {
        dirtyCallback();
        return { name: 'dirty-initialization-app-check' };
      });
    } else {
      mockGetToken.mockImplementationOnce(() => {
        dirtyCallback();
        return new Promise(() => {
          // Keep the SDK request pending after its synchronous route mutation.
        });
      });
    }

    await withFirebaseModuleFor(
      'production',
      'configured-public-site-key',
      '/account/strava/callback?code=synthetic-code&state=synthetic-state',
      async (FirebaseResources) => {
        window.history.replaceState(null, '', '/account/strava/callback');
        const resources = FirebaseResources.getInstance();
        const preparation = resources.prepareAppCheckAfterStravaCallbackCleanup();

        await expect(preparation).rejects.toThrow(
          'Strava callback App Check preparation failed.',
        );
        expect(mockReCaptchaEnterpriseProvider).toHaveBeenCalledTimes(1);
        expect(mockInitializeAppCheck).toHaveBeenCalledTimes(
          boundary === 'provider' ? 0 : 1,
        );
        expect(mockGetToken).toHaveBeenCalledTimes(boundary === 'token' ? 1 : 0);

        window.history.replaceState(null, '', '/account/strava/callback');
        const retry = resources.prepareAppCheckAfterStravaCallbackCleanup();
        expect(retry).toBe(preparation);
        await expect(retry).rejects.toThrow(
          'Strava callback App Check preparation failed.',
        );
      },
    );
  });

  test('caches failure when the native callback becomes dirty during token readiness', async () => {
    let finishToken: (() => void) | undefined;
    mockGetToken.mockImplementationOnce(() => new Promise((resolve) => {
      finishToken = () => resolve({ token: 'synthetic-app-check-token' });
    }));

    await withFirebaseModuleFor(
      'production',
      'configured-public-site-key',
      '/account/strava/callback?code=synthetic-code&state=synthetic-state',
      async (FirebaseResources) => {
        window.history.replaceState(null, '', '/account/strava/callback');
        const resources = FirebaseResources.getInstance();
        const preparation = resources.prepareAppCheckAfterStravaCallbackCleanup();
        await Promise.resolve();
        await Promise.resolve();
        expect(mockGetToken).toHaveBeenCalledTimes(1);

        window.history.replaceState(
          null,
          '',
          '/account/strava/callback?code=reinjected-code-canary',
        );
        finishToken?.();
        await expect(preparation).rejects.toThrow(
          'Strava callback App Check preparation failed.',
        );

        window.history.replaceState(null, '', '/account/strava/callback');
        const retry = resources.prepareAppCheckAfterStravaCallbackCleanup();
        expect(retry).toBe(preparation);
        await expect(retry).rejects.toThrow(
          'Strava callback App Check preparation failed.',
        );
        expect(mockReCaptchaEnterpriseProvider).toHaveBeenCalledTimes(1);
        expect(mockInitializeAppCheck).toHaveBeenCalledTimes(1);
        expect(mockGetToken).toHaveBeenCalledTimes(1);
      },
    );
  });

  test('a dirty microtask before the ready marker poisons the completed flight', async () => {
    let finishToken: (() => void) | undefined;
    mockGetToken.mockImplementationOnce(() => new Promise((resolve) => {
      finishToken = () => resolve({ token: 'synthetic-app-check-token' });
    }));

    await withFirebaseModuleFor(
      'production',
      'configured-public-site-key',
      '/account/strava/callback?code=synthetic-code&state=synthetic-state',
      async (FirebaseResources) => {
        window.history.replaceState(null, '', '/account/strava/callback');
        const resources = FirebaseResources.getInstance();
        const preparation = resources.prepareAppCheckAfterStravaCallbackCleanup();
        await Promise.resolve();
        await Promise.resolve();
        expect(mockGetToken).toHaveBeenCalledTimes(1);

        finishToken?.();
        const dirtyObservation = Promise.resolve().then(() => {
          window.history.replaceState(
            null,
            '',
            '/account/strava/callback?code=microtask-reinjection-canary',
          );
          const dirty = resources.prepareAppCheckAfterStravaCallbackCleanup();
          window.history.replaceState(null, '', '/account/strava/callback');
          return dirty;
        });

        await expect(dirtyObservation).rejects.toThrow(
          'Strava callback App Check preparation failed.',
        );
        await expect(preparation).rejects.toThrow(
          'Strava callback App Check preparation failed.',
        );
        expect(mockReCaptchaEnterpriseProvider).toHaveBeenCalledTimes(1);
        expect(mockInitializeAppCheck).toHaveBeenCalledTimes(1);
        expect(mockGetToken).toHaveBeenCalledTimes(1);
      },
    );
  });

  test.each([
    ['missing key', 'missing-key'],
    ['Enterprise constructor failure', 'provider'],
    ['App Check initialization failure', 'initialization'],
    ['synchronous token failure', 'token-sync'],
    ['asynchronous token failure', 'token-async'],
  ])('uses one fixed redacted failure for %s', async (_case, failureStage) => {
    const canary = `private-${failureStage}-canary`;
    const messageGetter = jest.fn(() => {
      throw new Error(`${canary}-getter-read`);
    });
    const hostileFailure = {};
    Object.defineProperty(hostileFailure, 'message', { get: messageGetter });
    const siteKey = failureStage === 'missing-key'
      ? undefined
      : 'configured-public-site-key';
    const expectedDiagnostic = failureStage === 'missing-key'
      ? '[MPRC client] app_check_disabled'
      : '[MPRC client] app_check_initialization_failed';
    if (failureStage === 'provider') {
      mockReCaptchaEnterpriseProvider.mockImplementationOnce(() => {
        throw hostileFailure;
      });
    } else if (failureStage === 'initialization') {
      mockInitializeAppCheck.mockImplementationOnce(() => {
        throw hostileFailure;
      });
    } else if (failureStage === 'token-sync') {
      mockGetToken.mockImplementationOnce(() => {
        throw hostileFailure;
      });
    } else if (failureStage === 'token-async') {
      mockGetToken.mockImplementationOnce(() => Promise.reject(hostileFailure));
    }
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await withFirebaseModuleFor(
        'production',
        siteKey,
        '/account/strava/callback?code=synthetic-code&state=synthetic-state',
        async (FirebaseResources) => {
          window.history.replaceState(null, '', '/account/strava/callback');
          const resources = FirebaseResources.getInstance();
          const first = resources.prepareAppCheckAfterStravaCallbackCleanup();
          const second = resources.prepareAppCheckAfterStravaCallbackCleanup();

          expect(second).toBe(first);
          await expect(first).rejects.toThrow(
            'Strava callback App Check preparation failed.',
          );
          await expect(second).rejects.toThrow(
            'Strava callback App Check preparation failed.',
          );
          expect(consoleWarn).toHaveBeenCalledTimes(1);
          expect(consoleWarn).toHaveBeenCalledWith(expectedDiagnostic);
          expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain(canary);
          expect(mockReCaptchaEnterpriseProvider).toHaveBeenCalledTimes(
            failureStage === 'missing-key' ? 0 : 1,
          );
          expect(mockInitializeAppCheck).toHaveBeenCalledTimes(
            ['missing-key', 'provider'].includes(failureStage) ? 0 : 1,
          );
          expect(mockGetToken).toHaveBeenCalledTimes(
            failureStage.startsWith('token-') ? 1 : 0,
          );
        },
      );
      expect(messageGetter).not.toHaveBeenCalled();
    } finally {
      consoleWarn.mockRestore();
    }
  });

  test('ordinary production query pages keep Analytics disabled', async () => {
    mockIsAnalyticsSupported.mockResolvedValueOnce(true);

    const resources = createResourcesFor(
      'production',
      'configured-public-site-key',
      '/events?source=public-calendar',
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(mockIsAnalyticsSupported).not.toHaveBeenCalled();
    expect(mockGetAnalytics).not.toHaveBeenCalled();
    expect(resources.analytics).toBeNull();
  });

  test('production source contains no legacy v3 App Check provider', () => {
    const source = fs.readFileSync(path.join(__dirname, 'FirebaseResources.ts'), 'utf8');

    expect(source).toContain('ReCaptchaEnterpriseProvider');
    expect(source).not.toContain('ReCaptchaV3Provider');
    expect(source).not.toContain('initialBrowserLocation');
    expect(source).not.toMatch(/pathname:\s*window\.location\.pathname/);
    expect(source).not.toMatch(/search:\s*window\.location\.search/);
    expect(source).not.toMatch(/hash:\s*window\.location\.hash/);
  });

  test('rejects malformed direct Function names before building a URL', () => {
    const resources = createResourcesFor('development');

    expect(() => resources.getHttpFunctionUrl('../other')).toThrow(
      'Invalid Firebase Function name.',
    );
    expect(() => resources.getHttpFunctionUrl('https://example.test')).toThrow(
      'Invalid Firebase Function name.',
    );
  });

  test('the direct CSV export uses the environment-aware Function URL helper', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../pages/admin/events/AdminEventRegistrations.tsx'),
      'utf8',
    );

    expect(source).toMatch(
      /firebaseResources\.getHttpFunctionUrl\('exportRegistrationsCsv'\)/,
    );
    expect(source).not.toMatch(/cloudfunctions\.net/);
  });

  test('the root and Functions emulator scripts select demo-only projects', () => {
    const rootPackage = JSON.parse(fs.readFileSync(
      path.join(__dirname, '../../../package.json'),
      'utf8',
    ));
    const functionsPackage = JSON.parse(fs.readFileSync(
      path.join(__dirname, '../../../functions/package.json'),
      'utf8',
    ));

    expect(rootPackage.scripts.emulators).toContain('--project demo-mprc-local');
    expect(rootPackage.scripts.emulators).toContain('--only auth,firestore,functions');
    expect(functionsPackage.scripts.serve).toContain('--project demo-mprc-local');
    expect(functionsPackage.scripts.shell).toContain('--project demo-mprc-local');
    expect(functionsPackage.scripts.test).toContain('--project demo-functions-test');
  });
});
