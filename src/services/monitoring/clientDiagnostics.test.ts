export {};

const fs = require('node:fs');
const path = require('node:path');

const mockCaptureException = jest.fn();

jest.mock('./sentry', () => ({
  captureException: mockCaptureException,
}));

const ErrorBoundary = require('../../components/ErrorBoundary').default;
const {
  clientFailureEvents,
  reportClientFailure,
} = require('./clientDiagnostics');

const SAFE_CONSOLE_OWNER = path.join(
  'src',
  'services',
  'monitoring',
  'clientDiagnostics.ts',
);

function runtimeFiles(directory: string, includeHtml = false): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry: any) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return runtimeFiles(entryPath, includeHtml);
    const runtimeExtension = includeHtml
      ? /\.(?:html|js|mjs)$/
      : /\.(?:js|jsx|mjs|ts|tsx)$/;
    if (!runtimeExtension.test(entry.name)) return [];
    if (!includeHtml && /\.(?:test|spec)\.(?:js|jsx|mjs|ts|tsx)$/.test(entry.name)) return [];
    return [entryPath];
  });
}

function applicationRuntimeFiles(projectRoot: string): string[] {
  return [
    ...runtimeFiles(path.join(projectRoot, 'src')),
    ...runtimeFiles(path.join(projectRoot, 'public'), true),
  ];
}

function hasDirectConsoleCall(source: string): boolean {
  return /\bconsole\s*(?:\.|\[)/.test(source);
}

describe('client diagnostic privacy', () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => jest.clearAllMocks());

  afterAll(() => {
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });

  test.each([
    [clientFailureEvents.appCheckDisabled, 'warn'],
    [clientFailureEvents.appCheckInitializationFailed, 'warn'],
    [clientFailureEvents.emailVerificationFailed, 'warn'],
    [clientFailureEvents.membersOnlyFetchFailed, 'warn'],
    [clientFailureEvents.renderFailed, 'error'],
  ])('emits the closed %s outcome without diagnostic data', (eventName, level) => {
    reportClientFailure(eventName);

    const expected = `[MPRC client] ${eventName}`;
    if (level === 'error') {
      expect(consoleError).toHaveBeenCalledWith(expected);
      expect(consoleWarn).not.toHaveBeenCalled();
    } else {
      expect(consoleWarn).toHaveBeenCalledWith(expected);
      expect(consoleError).not.toHaveBeenCalled();
    }
  });

  test('drops hostile and sensitive input without reading or coercing it', () => {
    const canaries = [
      'member-canary@example.test',
      '+1-555-010-4242',
      '123 Canary Street',
      '1940-01-02',
      'Emergency Contact Canary',
      'oauth-token-canary',
      'provider-response-canary',
      'https://runmprc.com/account?token=capability-canary#private',
      'private-form-value-canary',
      'private-stack-canary',
    ];
    const hostileInput = {};
    const valueGetter = jest.fn(() => { throw new Error(canaries[6]); });
    const toString = jest.fn(() => { throw new Error(canaries[5]); });
    Object.defineProperty(hostileInput, 'value', { get: valueGetter });
    Object.defineProperty(hostileInput, 'toString', { value: toString });

    expect(() => reportClientFailure(canaries.join(' '))).not.toThrow();
    expect(() => reportClientFailure(hostileInput)).not.toThrow();
    expect(valueGetter).not.toHaveBeenCalled();
    expect(toString).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  test('does not let a broken console alter the underlying member flow', () => {
    const consoleFailureCanary = 'private-console-failure-canary';
    consoleWarn.mockImplementationOnce(() => {
      throw new Error(consoleFailureCanary);
    });

    expect(() => reportClientFailure(
      clientFailureEvents.emailVerificationFailed,
    )).not.toThrow();
    expect(consoleWarn).toHaveBeenCalledWith(
      '[MPRC client] email_verification_failed',
    );
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain(consoleFailureCanary);
  });

  test('preserves Sentry capture while keeping render details out of console', () => {
    const emailCanary = 'render-member@example.test';
    const tokenCanary = 'render-token-canary';
    const error = new Error(`${emailCanary} ${tokenCanary}`);
    const boundary = new ErrorBoundary({ children: null });

    boundary.componentDidCatch(error, {
      componentStack: `private component stack ${emailCanary}`,
    });

    expect(mockCaptureException).toHaveBeenCalledWith(error);
    expect(consoleError).toHaveBeenCalledWith('[MPRC client] render_failed');
    const serializedConsole = JSON.stringify([
      ...consoleError.mock.calls,
      ...consoleWarn.mock.calls,
    ]);
    expect(serializedConsole).not.toContain(emailCanary);
    expect(serializedConsole).not.toContain(tokenCanary);
    expect(serializedConsole).not.toContain('private component stack');
  });

  test('allows console output only through the closed diagnostic helper', () => {
    const projectRoot = path.resolve(__dirname, '../../..');
    const runtimeSources = applicationRuntimeFiles(projectRoot);
    const relativeSources = runtimeSources.map((sourcePath) => (
      path.relative(projectRoot, sourcePath)
    ));
    const offenders = runtimeSources.flatMap((sourcePath) => {
      const relativePath = path.relative(projectRoot, sourcePath);
      if (relativePath === SAFE_CONSOLE_OWNER) return [];
      return hasDirectConsoleCall(fs.readFileSync(sourcePath, 'utf8'))
        ? [relativePath]
        : [];
    });

    expect(relativeSources).toEqual(expect.arrayContaining([
      path.join('public', 'index.html'),
      path.join('src', 'components', 'ErrorBoundary.tsx'),
      path.join('src', 'services', 'identity', 'Identity.ts'),
    ]));
    expect(offenders).toEqual([]);
  });

  test.each([
    ['dot access', 'console.error(privateValue);'],
    ['window access', 'window.console.warn(privateValue);'],
    ['computed access', "console['error'](privateValue);"],
  ])('recognizes the %s bypass', (_label, source) => {
    expect(hasDirectConsoleCall(source)).toBe(true);
  });
});
