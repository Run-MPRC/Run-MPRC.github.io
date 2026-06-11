import * as Sentry from '@sentry/react';

/**
 * Initialize Sentry error monitoring iff REACT_APP_SENTRY_DSN is set.
 * Without the DSN this is a no-op, so the build works fine without Sentry
 * configured. To enable:
 *   1. Sign up at sentry.io (free tier works)
 *   2. Create a project, copy the DSN
 *   3. Set REACT_APP_SENTRY_DSN in your build environment
 */

let _initialized = false;

export function initSentry(): void {
  if (_initialized) return;
  const dsn = process.env.REACT_APP_SENTRY_DSN;
  if (!dsn) return;
  const environment = process.env.REACT_APP_SENTRY_ENV
    || process.env.NODE_ENV
    || 'production';
  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });
  _initialized = true;
}

export function captureException(err: unknown): void {
  if (_initialized) {
    Sentry.captureException(err);
  }
}

export function setUserContext(user: { uid: string; email?: string | null }): void {
  if (!_initialized) return;
  Sentry.setUser({ id: user.uid, email: user.email || undefined });
}

export function clearUserContext(): void {
  if (!_initialized) return;
  Sentry.setUser(null);
}
