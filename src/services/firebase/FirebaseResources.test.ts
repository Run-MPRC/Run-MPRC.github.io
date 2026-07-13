export {};

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

  test('test runtime also uses the demo project and local emulators', () => {
    const resources = createResourcesFor('test', 'configured-public-site-key');

    expect(resources.app.options.projectId).toBe('demo-mprc-local');
    expect(mockConnectAuthEmulator).toHaveBeenCalled();
    expect(mockConnectFirestoreEmulator).toHaveBeenCalled();
    expect(mockConnectFunctionsEmulator).toHaveBeenCalled();
    expect(mockInitializeAppCheck).not.toHaveBeenCalled();
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
    '/register/%73uccess?registration=r1&token=example-capability',
    '/%72egister/success#example-capability',
    '/register/%ZZsuccess?token=example-capability',
  ])('production keeps App Check and Analytics off a capability callback: %s', (pathName) => {
    createResourcesFor('production', 'configured-public-site-key', pathName);

    expect(mockReCaptchaEnterpriseProvider).not.toHaveBeenCalled();
    expect(mockReCaptchaV3Provider).not.toHaveBeenCalled();
    expect(mockInitializeAppCheck).not.toHaveBeenCalled();
    expect(mockIsAnalyticsSupported).not.toHaveBeenCalled();
    expect(mockGetAnalytics).not.toHaveBeenCalled();
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
