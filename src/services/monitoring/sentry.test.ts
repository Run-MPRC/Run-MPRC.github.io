export {};

const mockInit = jest.fn();
const mockCaptureException = jest.fn();
const mockSetUser = jest.fn();

jest.mock('@sentry/react', () => ({
  init: mockInit,
  captureException: mockCaptureException,
  setUser: mockSetUser,
}));

function setNodeEnv(value: string | undefined) {
  Object.defineProperty(process.env, 'NODE_ENV', {
    configurable: true,
    value,
    writable: true,
  });
}

function initializeFor(nodeEnv: string, locationPath = '/') {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDsn = process.env.REACT_APP_SENTRY_DSN;
  const originalLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  setNodeEnv(nodeEnv);
  process.env.REACT_APP_SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
  window.history.replaceState(null, '', locationPath);

  try {
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      require('./sentry').initSentry();
    });
  } finally {
    window.history.replaceState(null, '', originalLocation);
    setNodeEnv(originalNodeEnv);
    if (originalDsn === undefined) delete process.env.REACT_APP_SENTRY_DSN;
    else process.env.REACT_APP_SENTRY_DSN = originalDsn;
  }
}

describe('Sentry environment and callback isolation', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each(['development', 'test'])(
    'does not initialize an external client during %s',
    (nodeEnv) => {
      initializeFor(nodeEnv);
      expect(mockInit).not.toHaveBeenCalled();
    },
  );

  test('allows an explicitly configured ordinary production page to initialize', () => {
    initializeFor('production', '/events');

    expect(mockInit).toHaveBeenCalledWith(expect.objectContaining({
      dsn: 'https://public@example.ingest.sentry.io/1',
    }));
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
  ])('does not initialize monitoring on a capability callback: %s', (locationPath) => {
    initializeFor('production', locationPath);
    expect(mockInit).not.toHaveBeenCalled();
  });
});
