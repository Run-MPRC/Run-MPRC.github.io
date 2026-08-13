/**
 * Frontend routing only. This is not an authorization boundary.
 *
 * Keep the production default fail-closed until the protected backend-first
 * release has deployed and read back every required directory dependency.
 */
const MEMBER_DIRECTORY_BACKEND_AVAILABLE: boolean = false;

export default MEMBER_DIRECTORY_BACKEND_AVAILABLE;
