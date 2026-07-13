import * as Sentry from '@sentry/react';
import type {
  Event,
  EventHint,
  Exception,
  SeverityLevel,
  StackFrame,
} from '@sentry/react';

import hasCapabilityCallbackState from './capabilityCallback';

/**
 * Initialize Sentry error monitoring iff REACT_APP_SENTRY_DSN is set.
 * Without the DSN this is a no-op, so the build works fine without Sentry
 * configured. To enable:
 *   1. Sign up at sentry.io (free tier works)
 *   2. Create a project, copy the DSN
 *   3. Set REACT_APP_SENTRY_DSN in your build environment
 */

let initialized = false;

const SAFE_EVENT_ID = /^[a-f0-9]{32}$/i;
const SAFE_BUNDLE_FILENAME = /^\/static\/js\/(?:main|[0-9]+)\.[a-f0-9]{8}(?:\.chunk)?\.js$/i;
const SAFE_RELEASE = /^(?:mprc-web[-@])?[a-f0-9]{7,40}$/i;
const SAFE_ENVIRONMENTS = new Set(['preview', 'production', 'staging']);
const SAFE_ERROR_TYPES = new Set([
  'AggregateError',
  'DOMException',
  'Error',
  'EvalError',
  'FirebaseError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
]);
const SAFE_LEVELS: ReadonlySet<SeverityLevel> = new Set<SeverityLevel>([
  'debug',
  'info',
  'log',
  'warning',
  'error',
  'fatal',
]);
const SAFE_DEFAULT_INTEGRATIONS = new Set(['GlobalHandlers', 'TryCatch']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeLevel(value: unknown): value is SeverityLevel {
  return typeof value === 'string' && SAFE_LEVELS.has(value as SeverityLevel);
}

function safeInteger(value: unknown, maximum: number): number | undefined {
  return Number.isSafeInteger(value)
    && (value as number) >= 0
    && (value as number) <= maximum
    ? value as number
    : undefined;
}

function safeFilename(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  let path = value;
  try {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(path)) {
      path = new URL(path).pathname;
    }
  } catch {
    return undefined;
  }

  [path] = path.split(/[?#]/, 1);
  if (!path.startsWith('/')) path = `/${path}`;
  return SAFE_BUNDLE_FILENAME.test(path) ? path : undefined;
}

function sanitizeStackFrame(frame: unknown): StackFrame | undefined {
  if (!isRecord(frame)) return undefined;

  const filenameCandidate = frame.filename;
  const linenoCandidate = frame.lineno;
  const colnoCandidate = frame.colno;
  const inAppCandidate = frame.in_app;
  const filename = safeFilename(filenameCandidate);
  if (!filename) return undefined;

  const safeFrame: StackFrame = { filename };
  const lineno = safeInteger(linenoCandidate, 10_000_000);
  const colno = safeInteger(colnoCandidate, 100_000);

  if (lineno !== undefined) safeFrame.lineno = lineno;
  if (colno !== undefined) safeFrame.colno = colno;
  if (typeof inAppCandidate === 'boolean') safeFrame.in_app = inAppCandidate;

  return safeFrame;
}

function sanitizeException(exception: unknown): Exception | undefined {
  if (!isRecord(exception)) return undefined;

  const typeCandidate = exception.type;
  const stacktraceCandidate = exception.stacktrace;
  const stacktrace = isRecord(stacktraceCandidate) ? stacktraceCandidate : undefined;
  const framesCandidate = stacktrace?.frames;
  const rawFrames = Array.isArray(framesCandidate) ? framesCandidate : [];
  const frames = rawFrames
    .slice(-50)
    .map(sanitizeStackFrame)
    .filter((frame): frame is StackFrame => frame !== undefined);
  const safeException: Exception = {
    type: typeof typeCandidate === 'string' && SAFE_ERROR_TYPES.has(typeCandidate)
      ? typeCandidate
      : 'Error',
  };

  if (frames && frames.length > 0) {
    safeException.stacktrace = { frames };
  }

  return safeException;
}

/**
 * Sentry receives only a small diagnostic projection. Unknown fields are
 * intentionally dropped so new SDK integrations cannot silently add PII.
 */
export function sanitizeSentryEvent(event: Event): Event | null {
  try {
    if (!isRecord(event)) return null;

    const exceptionCandidate = event.exception;
    const exceptionContainer = isRecord(exceptionCandidate) ? exceptionCandidate : undefined;
    const exceptionValuesCandidate = exceptionContainer?.values;
    const rawExceptions = Array.isArray(exceptionValuesCandidate)
      ? exceptionValuesCandidate
      : [];
    const exceptions = rawExceptions
      .slice(0, 5)
      .map(sanitizeException)
      .filter((exception): exception is Exception => exception !== undefined);

    if (exceptions.length === 0) return null;

    const safeEvent: Event = {
      exception: { values: exceptions },
    };

    const eventIdCandidate = event.event_id;
    const timestampCandidate = event.timestamp;
    const levelCandidate = event.level;
    const platformCandidate = event.platform;
    const environmentCandidate = event.environment;
    const releaseCandidate = event.release;

    if (typeof eventIdCandidate === 'string' && SAFE_EVENT_ID.test(eventIdCandidate)) {
      safeEvent.event_id = eventIdCandidate;
    }
    if (
      typeof timestampCandidate === 'number'
      && Number.isFinite(timestampCandidate)
      && timestampCandidate >= 0
      && timestampCandidate <= 4_102_444_800
    ) {
      safeEvent.timestamp = timestampCandidate;
    }
    if (isSafeLevel(levelCandidate)) {
      safeEvent.level = levelCandidate;
    }

    if (platformCandidate === 'javascript') safeEvent.platform = platformCandidate;
    if (
      typeof environmentCandidate === 'string'
      && SAFE_ENVIRONMENTS.has(environmentCandidate)
    ) {
      safeEvent.environment = environmentCandidate;
    }
    if (typeof releaseCandidate === 'string' && SAFE_RELEASE.test(releaseCandidate)) {
      safeEvent.release = releaseCandidate;
    }

    return safeEvent;
  } catch {
    return null;
  }
}

function sanitizeSentryEventAndHint(event: Event, hint: EventHint): Event | null {
  try {
    // Sentry serializes hint attachments after beforeSend. Clearing the same
    // hint object is therefore part of the fail-closed payload boundary.
    const attachments = hint?.attachments;
    if (attachments !== undefined) {
      if (!Array.isArray(attachments)) return null;
      attachments.splice(0, attachments.length);
    }
    return sanitizeSentryEvent(event);
  } catch {
    return null;
  }
}

export function initSentry(): void {
  if (initialized) return;
  // Local/test sessions must not reach an outside monitoring service. In
  // production, do not initialize on callback URLs carrying OAuth or checkout
  // capabilities. Hosted events then pass through the allowlist below.
  if (
    process.env.NODE_ENV !== 'production'
    || (typeof window !== 'undefined' && hasCapabilityCallbackState(window.location))
  ) return;
  const dsn = process.env.REACT_APP_SENTRY_DSN;
  if (!dsn) return;
  const environment = process.env.REACT_APP_SENTRY_ENV
    || process.env.NODE_ENV
    || 'production';
  Sentry.init({
    dsn,
    environment,
    autoSessionTracking: false,
    sendClientReports: false,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    integrations: (defaultIntegrations) => defaultIntegrations.filter(
      (integration) => SAFE_DEFAULT_INTEGRATIONS.has(integration.name),
    ),
    beforeBreadcrumb: () => null,
    beforeSend: sanitizeSentryEventAndHint,
    beforeSendTransaction: () => null,
  });
  initialized = true;
}

export function captureException(err: unknown): void {
  if (initialized) {
    Sentry.captureException(err);
  }
}

export function setUserContext(user: { uid: string; email?: string | null }): void {
  if (!initialized || !user) return;
  Sentry.setUser(null);
}

export function clearUserContext(): void {
  if (!initialized) return;
  Sentry.setUser(null);
}
