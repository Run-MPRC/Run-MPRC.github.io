export {};

const mockInit = jest.fn();

jest.mock('@sentry/react', () => ({
  init: mockInit,
  captureException: jest.fn(),
  setUser: jest.fn(),
}));

function initializeFor(nodeEnv: string, dsn: string) {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDsn = process.env.REACT_APP_SENTRY_DSN;
  Object.defineProperty(process.env, 'NODE_ENV', {
    configurable: true,
    value: nodeEnv,
    writable: true,
  });
  process.env.REACT_APP_SENTRY_DSN = dsn;
  jest.isolateModules(() => {
    // eslint-disable-next-line global-require
    require('./sentry').initSentry();
  });
  Object.defineProperty(process.env, 'NODE_ENV', {
    configurable: true,
    value: originalNodeEnv,
    writable: true,
  });
  if (originalDsn === undefined) delete process.env.REACT_APP_SENTRY_DSN;
  else process.env.REACT_APP_SENTRY_DSN = originalDsn;
}

describe('Sentry environment isolation', () => {
  beforeEach(() => mockInit.mockClear());

  test('does not initialize an external client during local development', () => {
    initializeFor('development', 'https://public@example.ingest.sentry.io/1');
    expect(mockInit).not.toHaveBeenCalled();
  });

  test('allows an explicitly configured production build to initialize', () => {
    initializeFor('production', 'https://public@example.ingest.sentry.io/1');
    expect(mockInit).toHaveBeenCalledWith(expect.objectContaining({
      dsn: 'https://public@example.ingest.sentry.io/1',
    }));
  });
});
