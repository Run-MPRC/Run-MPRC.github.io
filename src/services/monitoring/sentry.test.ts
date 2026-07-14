export {};

const mockInit = jest.fn();
const mockCaptureException = jest.fn();
const mockSetUser = jest.fn();

type SentryModule = typeof import('./sentry');

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

function initializeFor(nodeEnv: string, locationPath = '/'): SentryModule | undefined {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDsn = process.env.REACT_APP_SENTRY_DSN;
  const originalLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  let sentryModule: SentryModule | undefined;
  setNodeEnv(nodeEnv);
  process.env.REACT_APP_SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
  window.history.replaceState(null, '', locationPath);

  try {
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      sentryModule = require('./sentry') as SentryModule;
      sentryModule.initSentry();
    });
  } finally {
    window.history.replaceState(null, '', originalLocation);
    setNodeEnv(originalNodeEnv);
    if (originalDsn === undefined) delete process.env.REACT_APP_SENTRY_DSN;
    else process.env.REACT_APP_SENTRY_DSN = originalDsn;
  }

  return sentryModule;
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
    '/auth/action?mode=verifyEmail&oobCode=example-action-code',
    '/AUTH/ACTION/?mode=verifyEmail&oobCode=example-action-code',
    '/%61uth/action#example-action-code',
    '/register/%73uccess?registration=r1&token=example-capability',
    '/%72egister/success#example-capability',
    '/register/%ZZsuccess?token=example-capability',
  ])('does not initialize monitoring on a capability callback: %s', (locationPath) => {
    initializeFor('production', locationPath);
    expect(mockInit).not.toHaveBeenCalled();
  });

  test('disables replay, tracing, default PII, breadcrumbs, and transactions', () => {
    initializeFor('production', '/events');

    const options = mockInit.mock.calls[0][0];
    expect(options).toEqual(expect.objectContaining({
      autoSessionTracking: false,
      beforeBreadcrumb: expect.any(Function),
      beforeSend: expect.any(Function),
      beforeSendTransaction: expect.any(Function),
      integrations: expect.any(Function),
      replaysOnErrorSampleRate: 0,
      replaysSessionSampleRate: 0,
      sendClientReports: false,
      sendDefaultPii: false,
      tracesSampleRate: 0,
    }));
    expect(options.integrations([
      { name: 'Breadcrumbs' },
      { name: 'BrowserProfiling' },
      { name: 'BrowserTracing' },
      { name: 'ContextLines' },
      { name: 'ExtraErrorData' },
      { name: 'Feedback' },
      { name: 'HttpContext' },
      { name: 'Replay' },
      { name: 'UnknownFutureIntegration' },
      { name: 'GlobalHandlers' },
      { name: 'TryCatch' },
    ])).toEqual([
      { name: 'GlobalHandlers' },
      { name: 'TryCatch' },
    ]);
    expect(options.beforeBreadcrumb({ message: 'private form value' })).toBeNull();
    expect(options.beforeSendTransaction({ transaction: '/account?token=secret' })).toBeNull();
  });

  test('keeps only allowlisted error type and safe stack locations', () => {
    initializeFor('production', '/events');

    const options = mockInit.mock.calls[0][0];
    const canaries = [
      'member-canary@example.test',
      '+1-555-010-4242',
      '123 Canary Street',
      '1940-01-02',
      'Emergency Contact Canary',
      'oauth-token-canary',
      'reset-code-canary',
      'provider-response-canary',
      'private-form-value-canary',
      'request-body-canary',
      'capability-token-canary',
      'uid-canary',
    ];
    const unsafeEvent = {
      event_id: '0123456789abcdef0123456789abcdef',
      timestamp: 1_700_000_000,
      level: 'error',
      platform: 'javascript',
      environment: 'production',
      release: 'mprc-web-e86a0f7',
      dist: canaries[5],
      logger: canaries[6],
      user: { id: canaries[11], email: canaries[0], phone: canaries[1] },
      request: {
        url: `https://runmprc.com/register/success?token=${canaries[10]}#fragment`,
        data: canaries[9],
        headers: { authorization: `Bearer ${canaries[5]}` },
      },
      message: `${canaries[0]} ${canaries[2]} ${canaries[3]}`,
      breadcrumbs: [{ message: canaries[8], data: { phone: canaries[1] } }],
      tags: { email: canaries[0] },
      extra: { emergencyContact: canaries[4], provider: canaries[7] },
      contexts: { auth: { resetCode: canaries[6] } },
      exception: {
        values: [{
          type: 'TypeError',
          value: `${canaries[0]} failed with ${canaries[5]}`,
          module: canaries[7],
          stacktrace: {
            frames: [{
              filename: `https://${canaries[11]}.example.test/static/js/main.e86a0f7a.js?token=${canaries[10]}#fragment`,
              function: canaries[5],
              module: canaries[2],
              platform: canaries[3],
              abs_path: `https://runmprc.com/main.js?token=${canaries[10]}`,
              lineno: 42,
              colno: 7,
              in_app: true,
              context_line: canaries[8],
              pre_context: [canaries[2]],
              post_context: [canaries[4]],
              vars: { response: canaries[7] },
            }, {
              filename: `/static/js/${canaries[10]}.js`,
              function: canaries[5],
              lineno: 99,
            }],
          },
        }, {
          type: canaries[5],
          value: canaries[9],
        }],
      },
    };

    const sanitized = options.beforeSend(unsafeEvent, {});
    expect(sanitized).toEqual({
      environment: 'production',
      event_id: '0123456789abcdef0123456789abcdef',
      exception: {
        values: [{
          stacktrace: {
            frames: [{
              colno: 7,
              filename: '/static/js/main.e86a0f7a.js',
              in_app: true,
              lineno: 42,
            }],
          },
          type: 'TypeError',
        }, {
          type: 'Error',
        }],
      },
      level: 'error',
      platform: 'javascript',
      release: 'mprc-web-e86a0f7',
      timestamp: 1_700_000_000,
    });

    const serialized = JSON.stringify(sanitized);
    canaries.forEach((canary) => expect(serialized).not.toContain(canary));
    expect(options.beforeSend({ message: canaries[8] }, {})).toBeNull();

    const unsafeHint = {
      attachments: [{
        data: canaries[9],
        filename: canaries[0],
      }],
    };
    expect(options.beforeSend(unsafeEvent, unsafeHint)).toBeNull();
    expect(unsafeHint.attachments).toHaveLength(1);
  });

  test('stabilizes the attachment-free hint before the SDK reads it again', () => {
    initializeFor('production', '/events');

    const options = mockInit.mock.calls[0][0];
    const hint: Record<string, unknown> = {};
    const event = { exception: { values: [{ type: 'TypeError' }] } };
    const sanitized = options.beforeSend(event, hint);

    expect(sanitized).toEqual(event);
    // Mirrors BaseClient.sendEvent's later read after beforeSend returns.
    expect(hint.attachments).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(hint, 'attachments')).toEqual({
      configurable: false,
      enumerable: false,
      value: undefined,
      writable: false,
    });
    expect(() => {
      Object.defineProperty(hint, 'attachments', {
        value: [{ data: 'late-attachment-canary' }],
      });
    }).toThrow();
    expect(hint.attachments).toBeUndefined();
  });

  test('fails closed for malformed events, hints, and stack frames', () => {
    initializeFor('production', '/events');

    const options = mockInit.mock.calls[0][0];
    [
      null,
      undefined,
      {},
      { exception: null },
      { exception: { values: null } },
      { exception: { values: {} } },
      { exception: { values: [null, 'not-an-exception'] } },
    ].forEach((event) => expect(options.beforeSend(event, {})).toBeNull());

    const throwingEvent = {};
    Object.defineProperty(throwingEvent, 'exception', {
      get: () => { throw new Error('private-getter-canary'); },
    });
    expect(options.beforeSend(throwingEvent, {})).toBeNull();

    const validEvent = { exception: { values: [{ type: 'TypeError' }] } };
    expect(options.beforeSend(validEvent, { attachments: {} })).toBeNull();
    expect(options.beforeSend(validEvent, {
      attachments: Object.freeze([{ data: 'frozen-attachment-canary' }]),
    })).toBeNull();

    const poisonedAttachments = [{ data: 'poisoned-attachment-canary' }];
    const noOpSplice = jest.fn(() => []);
    Object.defineProperty(poisonedAttachments, 'splice', { value: noOpSplice });
    expect(options.beforeSend(validEvent, {
      attachments: poisonedAttachments,
    })).toBeNull();
    expect(noOpSplice).not.toHaveBeenCalled();

    const accessorHint = {};
    let attachmentReadCount = 0;
    const attachmentGetter = jest.fn(() => {
      attachmentReadCount += 1;
      return attachmentReadCount === 1
        ? undefined
        : [{ data: 'private-hint-toctou-canary' }];
    });
    Object.defineProperty(accessorHint, 'attachments', {
      get: attachmentGetter,
    });
    expect(options.beforeSend(validEvent, accessorHint)).toBeNull();
    expect(attachmentGetter).not.toHaveBeenCalled();

    const inheritedAttachmentGetter = jest.fn(() => undefined);
    const inheritedHint = Object.create(Object.defineProperty({}, 'attachments', {
      get: inheritedAttachmentGetter,
    }));
    expect(options.beforeSend(validEvent, inheritedHint)).toBeNull();
    expect(inheritedAttachmentGetter).not.toHaveBeenCalled();

    const coercingIdentifier = {
      privateValue: 'coercion-canary',
      toString: () => '0123456789abcdef0123456789abcdef',
    };
    const coerced = options.beforeSend({
      event_id: coercingIdentifier,
      release: coercingIdentifier,
      exception: { values: [{ type: 'TypeError' }] },
    }, {});
    expect(coerced).toEqual({
      exception: { values: [{ type: 'TypeError' }] },
    });
    expect(JSON.stringify(coerced)).not.toContain('coercion-canary');

    expect(options.beforeSend({
      exception: {
        values: [{
          type: 'TypeError',
          stacktrace: {
            frames: [{
              filename: '/static/js/123.e86a0f7a.chunk.js',
              lineno: 10_000_001,
              colno: 100_001,
            }],
          },
        }],
      },
    }, {})).toEqual({
      exception: {
        values: [{
          stacktrace: {
            frames: [{ filename: '/static/js/123.e86a0f7a.chunk.js' }],
          },
          type: 'TypeError',
        }],
      },
    });
  });

  test('does not invoke methods overridden by untrusted array subclasses', () => {
    initializeFor('production', '/events');

    const options = mockInit.mock.calls[0][0];
    const methodCanary = 'private-array-method-canary';
    class PoisonedArray<T> extends Array<T> {}
    const frames = new PoisonedArray<Record<string, unknown>>();
    frames[0] = {
      filename: '/static/js/main.e86a0f7a.js',
      function: methodCanary,
    };
    const exceptions = new PoisonedArray<Record<string, unknown>>();
    exceptions[0] = {
      type: 'TypeError',
      value: methodCanary,
      stacktrace: { frames },
    };
    const poisonedMethods: jest.Mock[] = [];

    [frames, exceptions].forEach((array) => {
      ['slice', 'map', 'filter'].forEach((method) => {
        const poisonedMethod = jest.fn(() => {
          throw new Error(methodCanary);
        });
        poisonedMethods[poisonedMethods.length] = poisonedMethod;
        Object.defineProperty(array, method, { value: poisonedMethod });
      });
    });

    const sanitized = options.beforeSend({
      exception: { values: exceptions },
    }, {});
    expect(sanitized).toEqual({
      exception: {
        values: [{
          stacktrace: {
            frames: [{ filename: '/static/js/main.e86a0f7a.js' }],
          },
          type: 'TypeError',
        }],
      },
    });
    poisonedMethods.forEach((method) => expect(method).not.toHaveBeenCalled());
    expect(JSON.stringify(sanitized)).not.toContain(methodCanary);
  });

  test('reads each retained event field once before validating it', () => {
    initializeFor('production', '/events');

    const options = mockInit.mock.calls[0][0];
    const readCounts = new Map<string, number>();
    const mutationCanary = 'mutating-getter-canary';
    const defineMutatingGetter = (
      target: Record<string, unknown>,
      key: string,
      label: string,
      safeValue: unknown,
    ) => Object.defineProperty(target, key, {
      configurable: true,
      get: () => {
        const count = (readCounts.get(label) || 0) + 1;
        readCounts.set(label, count);
        return count === 1 ? safeValue : mutationCanary;
      },
    });

    const frame: Record<string, unknown> = {};
    defineMutatingGetter(frame, 'filename', 'frame.filename', '/static/js/main.e86a0f7a.js');
    defineMutatingGetter(frame, 'lineno', 'frame.lineno', 42);
    defineMutatingGetter(frame, 'colno', 'frame.colno', 7);
    defineMutatingGetter(frame, 'in_app', 'frame.in_app', true);

    const stacktrace: Record<string, unknown> = {};
    defineMutatingGetter(stacktrace, 'frames', 'stacktrace.frames', [frame]);

    const exception: Record<string, unknown> = {};
    defineMutatingGetter(exception, 'type', 'exception.type', 'TypeError');
    defineMutatingGetter(exception, 'stacktrace', 'exception.stacktrace', stacktrace);

    const exceptionContainer: Record<string, unknown> = {};
    defineMutatingGetter(exceptionContainer, 'values', 'exception.values', [exception]);

    const event: Record<string, unknown> = {};
    defineMutatingGetter(event, 'exception', 'event.exception', exceptionContainer);
    defineMutatingGetter(
      event,
      'event_id',
      'event.event_id',
      '0123456789abcdef0123456789abcdef',
    );
    defineMutatingGetter(event, 'timestamp', 'event.timestamp', 1_700_000_000);
    defineMutatingGetter(event, 'level', 'event.level', 'error');
    defineMutatingGetter(event, 'platform', 'event.platform', 'javascript');
    defineMutatingGetter(event, 'environment', 'event.environment', 'production');
    defineMutatingGetter(event, 'release', 'event.release', 'mprc-web-e86a0f7');

    const sanitized = options.beforeSend(event, {});
    expect(sanitized).toEqual({
      environment: 'production',
      event_id: '0123456789abcdef0123456789abcdef',
      exception: {
        values: [{
          stacktrace: {
            frames: [{
              colno: 7,
              filename: '/static/js/main.e86a0f7a.js',
              in_app: true,
              lineno: 42,
            }],
          },
          type: 'TypeError',
        }],
      },
      level: 'error',
      platform: 'javascript',
      release: 'mprc-web-e86a0f7',
      timestamp: 1_700_000_000,
    });
    expect(Array.from(readCounts.values()).every((count) => count === 1)).toBe(true);
    expect(JSON.stringify(sanitized)).not.toContain(mutationCanary);
  });

  test('clears rather than attaching direct member identifiers', () => {
    const sentryModule = initializeFor('production', '/account');

    sentryModule?.setUserContext({
      uid: 'uid-canary',
      email: 'member-canary@example.test',
    });

    expect(mockSetUser).toHaveBeenCalledWith(null);
    expect(JSON.stringify(mockSetUser.mock.calls)).not.toContain('uid-canary');
    expect(JSON.stringify(mockSetUser.mock.calls)).not.toContain('member-canary@example.test');
  });
});
