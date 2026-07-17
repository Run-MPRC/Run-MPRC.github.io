// Single source of truth for the account-email sender named in member-facing
// anti-spam guidance. AUTH-MAIL-001 (#119) owns the authenticated club sender
// identity and its DNS; once that work sets REACT_APP_ACCOUNT_EMAIL_SENDER,
// every guidance surface names the approved sender with no code change. Until
// then the copy stays generic and promises nothing about a specific address.

const GENERIC_SENDER_LABEL = "the club's account email";

// Read at call time (not module load) so a build-time environment change flows
// through every guidance string without a code fork.
export function getAccountEmailSenderLabel(): string {
  const configured = process.env.REACT_APP_ACCOUNT_EMAIL_SENDER;
  if (typeof configured === 'string' && configured.trim() !== '') {
    return configured.trim();
  }
  return GENERIC_SENDER_LABEL;
}

// Shared Spam-folder guidance used by every account-email surface. It names the
// configured sender, offers the one safe personal action, and is explicit that
// this does not fix delivery for everyone. It never claims a message was sent.
export function getSpamGuidance(): string {
  return `If it lands in Spam, mark the message from ${getAccountEmailSenderLabel()} as `
    + '“Not spam.” That can help your future messages, but it does not fix delivery '
    + 'for everyone.';
}
