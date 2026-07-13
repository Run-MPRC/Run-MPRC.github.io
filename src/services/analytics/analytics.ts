/**
 * Compatibility wrapper for existing call sites.
 *
 * Firebase Analytics is intentionally disabled until #110 records an
 * approved purpose, consent, event schema, retention, access, and deletion
 * policy. Keep this function transport-free so telemetry can never affect a
 * member flow or silently resume collection from an SDK/config change.
 */
// Arguments stay source-compatible while the approved future API is undecided.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function track(eventName: string, params?: Record<string, unknown>): void {}

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
