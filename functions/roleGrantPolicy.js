const VERIFIED_EMAIL_REQUIRED_ROLES = new Set(['admin', 'member']);

const EMAIL_UNVERIFIED_GRANT_CODE = 'email-unverified';
const EMAIL_UNVERIFIED_GRANT_MESSAGE =
  'Target account is not eligible for this role';

function assertVerifiedEmailForRole(userRecord, role) {
  if (!VERIFIED_EMAIL_REQUIRED_ROLES.has(role)) return;
  if (userRecord?.emailVerified === true) return;

  const error = new Error(EMAIL_UNVERIFIED_GRANT_MESSAGE);
  error.code = EMAIL_UNVERIFIED_GRANT_CODE;
  throw error;
}

module.exports = {
  assertVerifiedEmailForRole,
  EMAIL_UNVERIFIED_GRANT_CODE,
};
