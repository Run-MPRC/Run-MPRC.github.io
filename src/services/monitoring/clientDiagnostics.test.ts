export {};

const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const ts = require('typescript');
const { fireEvent, render, screen } = require('@testing-library/react');

const mockCaptureException = jest.fn();
const mockCreateUserWithEmailAndPassword = jest.fn();
const mockDoc = jest.fn();
const mockGetDoc = jest.fn();
const mockOnAuthStateChanged = jest.fn(() => jest.fn());
const mockSendEmailVerification = jest.fn();
const mockUseServiceLocator = jest.fn();

jest.mock('./sentry', () => ({
  captureException: mockCaptureException,
}));
jest.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: mockCreateUserWithEmailAndPassword,
  onAuthStateChanged: mockOnAuthStateChanged,
  sendEmailVerification: mockSendEmailVerification,
  sendPasswordResetEmail: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
}));
jest.mock('firebase/firestore', () => ({
  doc: mockDoc,
  getDoc: mockGetDoc,
}));
jest.mock('../ServiceLocatorContext', () => ({
  useServiceLocator: mockUseServiceLocator,
}));

const ErrorBoundary = require('../../components/ErrorBoundary').default;
const MembersOnly = require('../../components/MembersOnly').default;
const IdentityService = require('../identity/Identity').default;
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
const ERROR_BOUNDARY_SOURCE = path.join(
  'src',
  'components',
  'ErrorBoundary.tsx',
);
const RENDER_FAILURE_MESSAGE = (
  'Try again, and contact an MPRC officer if this keeps happening.'
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

function staticStringValue(node: any): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (
    ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticStringValue(node.left);
    const right = staticStringValue(node.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}

function containsConsoleToken(value: string): boolean {
  return /(?:\bconsole\b|con\\u(?:0073|\{73\})ole)/i.test(value);
}

function hasConsoleReference(source: string, filename = 'fixture.ts'): boolean {
  if (path.extname(filename).toLowerCase() === '.html') {
    // Public HTML is not a TypeScript source file. Conservatively reject the
    // console token even in text/comments so a script insertion cannot hide.
    return containsConsoleToken(source);
  }

  const extension = path.extname(filename).toLowerCase();
  let scriptKind = ts.ScriptKind.JS;
  if (extension === '.tsx') scriptKind = ts.ScriptKind.TSX;
  else if (extension === '.jsx') scriptKind = ts.ScriptKind.JSX;
  else if (extension === '.ts') scriptKind = ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  let found = false;
  const visit = (node: any) => {
    if (found) return;
    if (
      (ts.isIdentifier(node) && node.text === 'console')
      || ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        && containsConsoleToken(node.text))
      || (ts.isBinaryExpression(node)
        && containsConsoleToken(staticStringValue(node) || ''))
      || (ts.isElementAccessExpression(node)
        && staticStringValue(node.argumentExpression) === 'console')
      || (ts.isComputedPropertyName(node)
        && staticStringValue(node.expression) === 'console')
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

describe('client diagnostic privacy', () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    jest.clearAllMocks();
    mockOnAuthStateChanged.mockReturnValue(jest.fn());
    mockDoc.mockReturnValue({ path: 'members_only/synthetic' });
    mockUseServiceLocator.mockReturnValue({
      isReady: true,
      services: { firebaseResources: { firestore: { name: 'synthetic-firestore' } } },
    });
  });

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

  test('keeps only the closed render-failed state, not the thrown value', () => {
    const getTrap = jest.fn(() => { throw new Error('private-get-canary'); });
    const ownKeysTrap = jest.fn(() => { throw new Error('private-keys-canary'); });
    const descriptorTrap = jest.fn(() => { throw new Error('private-descriptor-canary'); });
    const hostileFailure = new Proxy(Object.create(null), {
      get: getTrap,
      ownKeys: ownKeysTrap,
      getOwnPropertyDescriptor: descriptorTrap,
    });

    [null, undefined, false, '', hostileFailure].forEach((failure) => {
      const state = ErrorBoundary.getDerivedStateFromError(failure);
      const hasErrorDescriptor = Object.getOwnPropertyDescriptor(state, 'hasError');

      expect(Reflect.ownKeys(state)).toEqual(['hasError']);
      expect(hasErrorDescriptor).toBeDefined();
      expect(hasErrorDescriptor?.value).toBe(true);
    });
    expect(getTrap).not.toHaveBeenCalled();
    expect(ownKeysTrap).not.toHaveBeenCalled();
    expect(descriptorTrap).not.toHaveBeenCalled();
  });

  test('renders one fixed accessible fallback without environment-specific detail', () => {
    const error = new Error('private-message-canary');
    error.stack = 'private-stack-canary';
    const previousEnvironment = process.env.NODE_ENV;
    const fallbackMarkup: Record<string, string> = {};

    try {
      ['test', 'development'].forEach((environment) => {
        process.env.NODE_ENV = environment;
        const boundary = new ErrorBoundary({ children: null });
        (boundary as any).state = ErrorBoundary.getDerivedStateFromError(error);
        const view = render(boundary.render());
        fallbackMarkup[environment] = view.container.innerHTML;
        view.unmount();
      });
    } finally {
      process.env.NODE_ENV = previousEnvironment;
    }

    expect(fallbackMarkup.development).not.toContain('private-message-canary');
    expect(fallbackMarkup.development).not.toContain('private-stack-canary');
    expect(fallbackMarkup.development).toBe(fallbackMarkup.test);

    const boundary = new ErrorBoundary({ children: null });
    (boundary as any).state = ErrorBoundary.getDerivedStateFromError(error);
    const view = render(boundary.render());
    const alerts = screen.getAllByRole('alert');

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveAttribute('aria-live', 'assertive');
    expect(alerts[0]).toHaveAttribute('aria-atomic', 'true');
    expect(alerts[0].textContent).toBe(RENDER_FAILURE_MESSAGE);
    expect(view.container).not.toHaveTextContent('private-message-canary');
    expect(view.container).not.toHaveTextContent('private-stack-canary');
    expect(view.container).not.toHaveTextContent('team has been notified');
  });

  test('has no raw-error or environment-specific fallback branch in source', () => {
    const projectRoot = path.resolve(__dirname, '../../..');
    const source = fs.readFileSync(path.join(projectRoot, ERROR_BOUNDARY_SOURCE), 'utf8');

    expect(source).not.toMatch(/\berror\.(?:message|stack)\b/);
    expect(source).not.toContain('process.env.NODE_ENV');
    expect(source).not.toContain('The team has been notified');
  });

  test('passes the original failure only to captureException and emits fixed diagnostics', () => {
    const hostileFailure = {};
    const messageGetter = jest.fn(() => { throw new Error('private-message-canary'); });
    const stackGetter = jest.fn(() => { throw new Error('private-stack-canary'); });
    const toString = jest.fn(() => { throw new Error('private-string-canary'); });
    Object.defineProperties(hostileFailure, {
      message: { get: messageGetter },
      stack: { get: stackGetter },
      toString: { value: toString },
    });
    const boundary = new ErrorBoundary({ children: null });

    expect(() => boundary.componentDidCatch(hostileFailure)).not.toThrow();
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException.mock.calls[0][0]).toBe(hostileFailure);
    expect(consoleError.mock.calls).toEqual([['[MPRC client] render_failed']]);
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(messageGetter).not.toHaveBeenCalled();
    expect(stackGetter).not.toHaveBeenCalled();
    expect(toString).not.toHaveBeenCalled();
  });

  test('keeps fixed recovery diagnostics when the monitoring adapter fails', () => {
    const adapterFailureCanary = 'private-monitoring-adapter-canary';
    mockCaptureException.mockImplementationOnce(() => {
      throw new Error(adapterFailureCanary);
    });
    const boundary = new ErrorBoundary({ children: null });

    expect(() => boundary.componentDidCatch(new Error('synthetic render failure'))).not.toThrow();
    expect(consoleError.mock.calls).toEqual([['[MPRC client] render_failed']]);
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(adapterFailureCanary);
  });

  test('keeps recovery and home actions after a render failure', () => {
    let shouldThrow = true;
    function RecoverableChild() {
      if (shouldThrow) throw new Error('synthetic render failure');
      return React.createElement('p', null, 'Recovered child');
    }

    render(React.createElement(
      ErrorBoundary,
      null,
      React.createElement(RecoverableChild),
    ));

    expect(screen.getByRole('alert').textContent).toBe(RENDER_FAILURE_MESSAGE);
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('Recovered child')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('verification-email failure returns unavailable without logging provider data', async () => {
    const canaries = [
      'registration-member@example.test',
      'auth/provider-response-canary',
      'verification-token-canary',
    ];
    const credential = {
      user: { uid: 'synthetic-uid', email: canaries[0] },
    };
    const providerError = Object.assign(new Error(canaries.join(' ')), {
      code: canaries[1],
      token: canaries[2],
    });
    mockCreateUserWithEmailAndPassword.mockResolvedValueOnce(credential);
    mockSendEmailVerification.mockRejectedValueOnce(providerError);
    const identity = new IdentityService({ auth: { currentUser: null } });

    await expect(identity.register(canaries[0], 'synthetic-password'))
      .resolves.toEqual({
        credential,
        user: credential.user,
        verificationEmailRequest: 'unavailable',
      });
    expect(mockSendEmailVerification).toHaveBeenCalledWith(credential.user);
    expect(consoleWarn).toHaveBeenCalledWith(
      '[MPRC client] email_verification_failed',
    );
    const serializedConsole = JSON.stringify(consoleWarn.mock.calls);
    canaries.forEach((canary) => expect(serializedConsole).not.toContain(canary));
  });

  test('members-only fetch failure completes loading without logging Firestore data', async () => {
    const canaries = [
      'members-only-member@example.test',
      'firestore-provider-response-canary',
      'https://runmprc.com/private?token=members-only-token#details',
    ];
    mockGetDoc.mockRejectedValueOnce(Object.assign(new Error(canaries.join(' ')), {
      response: canaries[1],
      url: canaries[2],
    }));

    render(React.createElement(MembersOnly, {
      dataKey: 'discounts',
      style: {},
    }));

    expect(await screen.findByText(/Failed to fetch data/)).toBeInTheDocument();
    expect(consoleWarn).toHaveBeenCalledWith(
      '[MPRC client] members_only_fetch_failed',
    );
    const serializedConsole = JSON.stringify(consoleWarn.mock.calls);
    canaries.forEach((canary) => expect(serializedConsole).not.toContain(canary));
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
      return hasConsoleReference(fs.readFileSync(sourcePath, 'utf8'), sourcePath)
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
    ['optional chaining', 'console?.error(privateValue);'],
    ['parenthesized access', '(console).error(privateValue);'],
    ['comment-separated access', 'console /* private */ .error(privateValue);'],
    ['alias', 'const c = console; c.error(privateValue);'],
    ['destructure', 'const { error } = console; error(privateValue);'],
    ['computed global', 'globalThis["console"].error(privateValue);'],
    ['computed window', 'window["console"].warn(privateValue);'],
    ['escaped identifier', 'con\\u0073ole.error(privateValue);'],
    ['constructed property', "globalThis['con' + 'sole'].error(privateValue);"],
    ['evaluated source', 'eval("console.error(privateValue)");'],
  ])('recognizes the %s bypass', (_label, source) => {
    expect(hasConsoleReference(source)).toBe(true);
  });
});
