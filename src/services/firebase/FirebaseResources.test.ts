export {};

const mockApp = { name: 'test-app' };
const mockAuth = { name: 'test-auth' };
const mockFirestore = { name: 'test-firestore' };
const mockFunctions = { name: 'test-functions' };

const mockInitializeApp = jest.fn(() => mockApp);
const mockGetAuth = jest.fn(() => mockAuth);
const mockGetFirestore = jest.fn(() => mockFirestore);
const mockGetFunctions = jest.fn(() => mockFunctions);
const mockConnectAuthEmulator = jest.fn();
const mockConnectFirestoreEmulator = jest.fn();
const mockConnectFunctionsEmulator = jest.fn();
const mockGetAnalytics = jest.fn();
const mockIsAnalyticsSupported = jest.fn(() => Promise.resolve(false));

jest.mock('firebase/app', () => ({ initializeApp: mockInitializeApp }));
jest.mock('firebase/analytics', () => ({
  getAnalytics: mockGetAnalytics,
  isSupported: mockIsAnalyticsSupported,
}));
jest.mock('firebase/app-check', () => ({
  initializeAppCheck: jest.fn(),
  ReCaptchaV3Provider: jest.fn(),
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

function loadResourcesFor(nodeEnv: string) {
  const originalNodeEnv = process.env.NODE_ENV;
  Object.defineProperty(process.env, 'NODE_ENV', {
    configurable: true,
    value: nodeEnv,
    writable: true,
  });
  let FirebaseResources: typeof import('./FirebaseResources').default;
  jest.isolateModules(() => {
    // eslint-disable-next-line global-require
    FirebaseResources = require('./FirebaseResources').default;
  });
  Object.defineProperty(process.env, 'NODE_ENV', {
    configurable: true,
    value: originalNodeEnv,
    writable: true,
  });
  return FirebaseResources!;
}

describe('FirebaseResources emulator routing', () => {
  beforeEach(() => {
    mockInitializeApp.mockReturnValue(mockApp);
    mockGetAuth.mockReturnValue(mockAuth);
    mockGetFirestore.mockReturnValue(mockFirestore);
    mockGetFunctions.mockReturnValue(mockFunctions);
  });

  test('development connects Auth, Firestore, and Functions to local emulators', () => {
    const FirebaseResources = loadResourcesFor('development');
    const resources = FirebaseResources.getInstance();

    expect(resources.functions).toBe(mockFunctions);
    expect(mockConnectAuthEmulator).toHaveBeenCalledWith(
      mockAuth,
      'http://localhost:9099',
      { disableWarnings: true },
    );
    expect(mockConnectFirestoreEmulator).toHaveBeenCalledWith(mockFirestore, '127.0.0.1', 8080);
    expect(mockConnectFunctionsEmulator).toHaveBeenCalledWith(mockFunctions, '127.0.0.1', 5001);
    expect(mockInitializeApp).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'demo-mprc-local',
    }));
    expect(mockIsAnalyticsSupported).not.toHaveBeenCalled();
    expect(mockGetAnalytics).not.toHaveBeenCalled();
  });

  test('development startup fails closed when an emulator cannot be configured', () => {
    mockConnectFunctionsEmulator.mockImplementationOnce(() => {
      throw new Error('already initialized');
    });
    const FirebaseResources = loadResourcesFor('development');

    expect(() => FirebaseResources.getInstance()).toThrow(
      'Local Firebase emulator isolation failed; stop development startup.',
    );
  });

  test('test runtime also uses the demo project and local emulators', () => {
    const FirebaseResources = loadResourcesFor('test');
    FirebaseResources.getInstance();

    expect(mockInitializeApp).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'demo-mprc-local',
    }));
    expect(mockConnectAuthEmulator).toHaveBeenCalled();
    expect(mockConnectFirestoreEmulator).toHaveBeenCalled();
    expect(mockConnectFunctionsEmulator).toHaveBeenCalled();
    expect(mockIsAnalyticsSupported).not.toHaveBeenCalled();
  });

  test('production does not connect any Firebase service to an emulator', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const FirebaseResources = loadResourcesFor('production');
    FirebaseResources.getInstance();

    expect(mockInitializeApp).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'mid-peninsula-running-club',
    }));

    expect(mockConnectAuthEmulator).not.toHaveBeenCalled();
    expect(mockConnectFirestoreEmulator).not.toHaveBeenCalled();
    expect(mockConnectFunctionsEmulator).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
