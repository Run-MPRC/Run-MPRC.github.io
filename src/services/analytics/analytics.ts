import { Analytics, logEvent } from 'firebase/analytics';
import FirebaseResources from '../firebase/FirebaseResources';

/**
 * Thin wrapper around Firebase Analytics that no-ops when analytics isn't
 * available (SSR, unsupported environments, users who disabled tracking).
 *
 * Call sites should fire these at key funnel points so we can see where
 * users drop off in the registration flow.
 */

function getAnalytics(): Analytics | null {
  try {
    return FirebaseResources.getInstance().analytics;
  } catch {
    return null;
  }
}

export function track(eventName: string, params?: Record<string, unknown>): void {
  const analytics = getAnalytics();
  if (!analytics) return;
  try {
    logEvent(analytics, eventName as any, params as any);
  } catch {
    // swallow — analytics should never break the user flow
  }
}

export const events = {
  eventView: 'event_view',
  eventRegisterClick: 'event_register_click',
  registrationFormStart: 'registration_form_start',
  registrationSubmitAttempt: 'registration_submit_attempt',
  registrationCheckoutInitiated: 'checkout_initiated',
  registrationCheckoutFree: 'registration_free_completed',
  registrationConfirmed: 'registration_confirmed',
  registrationError: 'registration_error',
  accountView: 'account_view',
  adminView: 'admin_view',
};
