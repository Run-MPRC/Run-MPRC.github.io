import * as Sentry from '@sentry/react';

/**
 * Initialize Sentry error monitoring iff REACT_APP_SENTRY_DSN is set.
 * Without the DSN this is a no-op, so the build works fine without Sentry
 * configured. To enable:
 *   1. Sign up at sentry.io (free tier works)
 *   2. Create a project, copy the DSN
 *   3. Set REACT_APP_SENTRY_DSN in your build environment
 */

let initialized = false;
const CAPABILITY_CALLBACK_PATHS = new Set([
  '/account/strava/callback',
  '/register/success',
  '/shop/purchase/success',
]);

function hasCapabilityCallbackState(): boolean {
  if (typeof window === 'undefined') return false;
  const { pathname, search, hash } = window.location;
  return CAPABILITY_CALLBACK_PATHS.has(pathname)
    && (search.length > 0 || hash.length > 0);
}

export function initSentry(): void {
  if (initialized) return;
  // Local/test sessions must not reach an outside monitoring service. In
  // production, do not initialize on callback URLs carrying OAuth or checkout
  // capabilities. #111 owns the broader hosted redaction/replay policy.
  if (process.env.NODE_ENV !== 'production' || hasCapabilityCallbackState()) return;
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
  initialized = true;
}

export function captureException(err: unknown): void {
  if (initialized) {
    Sentry.captureException(err);
  }
}

export function setUserContext(user: { uid: string; email?: string | null }): void {
  if (!initialized) return;
  Sentry.setUser({ id: user.uid, email: user.email || undefined });
}

export function clearUserContext(): void {
  if (!initialized) return;
  Sentry.setUser(null);
}
