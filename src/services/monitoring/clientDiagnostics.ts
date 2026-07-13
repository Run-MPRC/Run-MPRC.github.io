export const clientFailureEvents = {
  appCheckDisabled: 'app_check_disabled',
  appCheckInitializationFailed: 'app_check_initialization_failed',
  emailVerificationFailed: 'email_verification_failed',
  membersOnlyFetchFailed: 'members_only_fetch_failed',
  renderFailed: 'render_failed',
} as const;

type ClientFailureEvent = typeof clientFailureEvents[keyof typeof clientFailureEvents];

const SAFE_FAILURE_EVENTS: ReadonlySet<string> = new Set(
  Object.values(clientFailureEvents),
);

/**
 * Emit one closed, low-cardinality outcome without accepting diagnostic data.
 * Unknown input is dropped without coercion so errors, provider responses,
 * URLs, form values, and member data cannot reach the browser console.
 */
export function reportClientFailure(eventName: unknown): void {
  if (typeof eventName !== 'string' || !SAFE_FAILURE_EVENTS.has(eventName)) return;

  const message = `[MPRC client] ${eventName as ClientFailureEvent}`;
  try {
    if (eventName === clientFailureEvents.renderFailed) {
      // eslint-disable-next-line no-console
      console.error(message);
      return;
    }
    // eslint-disable-next-line no-console
    console.warn(message);
  } catch {
    // Diagnostics must never alter the underlying member flow.
  }
}
