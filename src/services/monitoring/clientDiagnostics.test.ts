export {};

const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const ts = require('typescript');
const { render, screen } = require('@testing-library/react');

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
