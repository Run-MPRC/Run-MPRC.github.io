export {};

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mockAnalytics = { name: 'test-analytics' };
const mockGetInstance = jest.fn(() => ({ analytics: mockAnalytics }));
const mockLogEvent = jest.fn();

jest.mock('../firebase/FirebaseResources', () => ({
  __esModule: true,
  default: { getInstance: mockGetInstance },
}));
jest.mock('firebase/analytics', () => ({ logEvent: mockLogEvent }));

type AnalyticsModule = typeof import('./analytics');

function loadAnalyticsModule(): AnalyticsModule {
  // eslint-disable-next-line global-require
  return require('./analytics') as AnalyticsModule;
}

function runtimeSourceFiles(directory: string, includeHtml = false): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry: any) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return runtimeSourceFiles(entryPath, includeHtml);
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
    ...runtimeSourceFiles(path.join(projectRoot, 'src')),
    ...runtimeSourceFiles(path.join(projectRoot, 'public'), true),
  ];
}

const FORBIDDEN_ANALYTICS_RUNTIME = [
  /(?:@firebase|firebase(?:\/compat)?)\/analytics/,
  /\bfirebase\s*\.\s*analytics\b/,
  /\b(?:getAnalytics|initializeAnalytics|isSupported|logEvent|setAnalyticsCollectionEnabled)\s*\(/,
  /\bgtag\s*\(/,
  /\bdataLayer\b/,
  /(?:google-analytics|googletagmanager)\.com/,
];

function hasAnalyticsRuntime(source: string): boolean {
  return FORBIDDEN_ANALYTICS_RUNTIME.some((pattern) => pattern.test(source));
}

describe('Firebase Analytics containment', () => {
  beforeEach(() => jest.clearAllMocks());

  test('keeps the compatibility wrapper provider-free for arbitrary input', () => {
    const { events, track } = loadAnalyticsModule();
    const privateCanary = 'member-canary@example.test';
    const params: Record<string, unknown> = {
      eventId: 'private-event-id',
      message: `private raw error ${privateCanary}`,
    };
    Object.defineProperty(params, 'lateValue', {
      get: () => { throw new Error('analytics-param-getter-canary'); },
    });

    expect(() => track(events.registrationError, params)).not.toThrow();
    expect(() => track('unknown-event-name', { email: privateCanary })).not.toThrow();
    expect(mockGetInstance).not.toHaveBeenCalled();
    expect(mockLogEvent).not.toHaveBeenCalled();
  });

  test('enumerates CRA runtime .mjs plus public HTML and JavaScript', () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mprc-analytics-runtime-'));
    fs.mkdirSync(path.join(fixtureRoot, 'src'));
    fs.mkdirSync(path.join(fixtureRoot, 'public'));
    fs.writeFileSync(path.join(fixtureRoot, 'src', 'future-runtime.mjs'), 'export {};');
    fs.writeFileSync(path.join(fixtureRoot, 'src', 'ignored.test.mjs'), 'export {};');
    fs.writeFileSync(path.join(fixtureRoot, 'public', 'index.html'), '<main></main>');
    fs.writeFileSync(path.join(fixtureRoot, 'public', 'runtime.test.js'), 'void 0;');
    fs.writeFileSync(path.join(fixtureRoot, 'public', 'spa-navigation.js'), 'void 0;');
    fs.writeFileSync(path.join(fixtureRoot, 'public', 'manifest.json'), '{}');

    try {
      expect(applicationRuntimeFiles(fixtureRoot).map((sourcePath) => (
        path.relative(fixtureRoot, sourcePath)
      )).sort()).toEqual([
        path.join('public', 'index.html'),
        path.join('public', 'runtime.test.js'),
        path.join('public', 'spa-navigation.js'),
        path.join('src', 'future-runtime.mjs'),
      ]);
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test('has no application runtime import or call path to Firebase Analytics', () => {
    const projectRoot = path.resolve(__dirname, '../../..');
    const offenders = applicationRuntimeFiles(projectRoot).flatMap((sourcePath) => {
      const source = fs.readFileSync(sourcePath, 'utf8');
      return hasAnalyticsRuntime(source)
        ? [path.relative(projectRoot, sourcePath)]
        : [];
    });

    expect(offenders).toEqual([]);
  });

  test.each([
    ['modular import alias', "import { logEvent as emit } from '@firebase/analytics';"],
    ['compat side-effect import', "import 'firebase/compat/analytics';"],
    ['compat initializer', 'firebase.analytics();'],
    ['modular initializer', 'initializeAnalytics(app);'],
    ['collection enablement', 'setAnalyticsCollectionEnabled(analytics, true);'],
    ['Google tag API', "window.gtag('event', 'signup');"],
    ['Google data layer', "window.dataLayer.push({ event: 'signup' });"],
    ['Google tag script', 'https://www.googletagmanager.com/gtag/js'],
  ])('rejects the %s bypass', (_label, source) => {
    expect(hasAnalyticsRuntime(source)).toBe(true);
  });

  test('allows inert public Firebase configuration without an Analytics runtime', () => {
    expect(hasAnalyticsRuntime("measurementId: 'G-SYNTHETIC'")).toBe(false);
  });

  test('preserves the waiver confirmation behavior without telemetry', () => {
    const waiverSource = fs.readFileSync(
      path.resolve(__dirname, '../../pages/joinUs/Waiver.jsx'),
      'utf8',
    );

    expect(hasAnalyticsRuntime(waiverSource)).toBe(false);
    expect(waiverSource).toContain("localStorage.setItem('waiverSigned', 'true')");
    expect(waiverSource).toMatch(/onWaiverSubmit\(\)/);
  });
});
