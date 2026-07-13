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
const mockReCaptchaV3Provider = jest.fn((siteKey: string) => ({ siteKey }));

jest.mock('firebase/app', () => ({ initializeApp: mockInitializeApp }));
jest.mock('firebase/analytics', () => ({
  getAnalytics: mockGetAnalytics,
  isSupported: mockIsAnalyticsSupported,
}));
jest.mock('firebase/app-check', () => ({
  initializeAppCheck: mockInitializeAppCheck,
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

function createResourcesFor(nodeEnv: string, siteKey?: string) {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSiteKey = process.env.REACT_APP_RECAPTCHA_SITE_KEY;
  setNodeEnv(nodeEnv);
  if (siteKey === undefined) delete process.env.REACT_APP_RECAPTCHA_SITE_KEY;
  else process.env.REACT_APP_RECAPTCHA_SITE_KEY = siteKey;

  try {
    let resources: import('./FirebaseResources').default;
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      const FirebaseResources = require('./FirebaseResources').default;
      resources = FirebaseResources.getInstance();
    });
    return resources!;
  } finally {
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
    expect(mockReCaptchaV3Provider).not.toHaveBeenCalled();
    expect(mockIsAnalyticsSupported).not.toHaveBeenCalled();
  });

  test('production retains its project and never connects an emulator', async () => {
    const resources = createResourcesFor('production', 'configured-public-site-key');

    expect(resources.app.options.projectId).toBe('mid-peninsula-running-club');
    expect(mockConnectAuthEmulator).not.toHaveBeenCalled();
    expect(mockConnectFirestoreEmulator).not.toHaveBeenCalled();
    expect(mockConnectFunctionsEmulator).not.toHaveBeenCalled();
    expect(mockReCaptchaV3Provider).toHaveBeenCalledWith('configured-public-site-key');
    expect(mockInitializeAppCheck).toHaveBeenCalled();
    expect(mockIsAnalyticsSupported).toHaveBeenCalled();
    await Promise.resolve();
    expect(resources.getHttpFunctionUrl('exportRegistrationsCsv')).toBe(
      'https://us-central1-mid-peninsula-running-club.cloudfunctions.net/'
      + 'exportRegistrationsCsv',
    );
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
