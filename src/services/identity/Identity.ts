import {
  ActionCodeOperation,
  Auth,
  applyActionCode,
  checkActionCode,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User,
  UserCredential,
  Unsubscribe,
  IdTokenResult,
} from 'firebase/auth';
import {
  clientFailureEvents,
  reportClientFailure,
} from '../monitoring/clientDiagnostics';
import FirebaseResources from '../firebase/FirebaseResources';

export type UserRole = 'admin' | 'member' | 'unverified' | null;

export type VerificationEmailRequestStatus = 'accepted' | 'unavailable';

export type EmailVerificationActionResult =
  | 'verified'
  | 'already-complete'
  | 'wrong-account'
  | 'unusable'
  | 'unavailable';

const UNUSABLE_ACTION_CODE_ERRORS = new Set([
  'auth/expired-action-code',
  'auth/invalid-action-code',
  'auth/user-disabled',
  'auth/user-not-found',
]);

function ownDataValue(record: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
    return undefined;
  }
  return descriptor.value;
}

function hasOnlyPlainData(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object') return true;
  if (seen.has(value)) return false;

  const prototype = Object.getPrototypeOf(value);
  if (
    prototype !== Object.prototype
    && prototype !== Array.prototype
    && prototype !== null
  ) {
    return false;
  }

  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).every((key) => {
    if (typeof key === 'symbol') return false;
    const descriptor = descriptors[key as keyof typeof descriptors];
    return Object.prototype.hasOwnProperty.call(descriptor, 'value')
      && hasOnlyPlainData(descriptor.value, seen);
  });
}

export function projectUserRoleFromTokenClaims(claims: unknown): UserRole {
  if (claims === null || typeof claims !== 'object') return null;

  try {
    const prototype = Object.getPrototypeOf(claims);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (!hasOnlyPlainData(claims)) return null;
    if (typeof globalThis.structuredClone !== 'function') return null;

    // Structured clone rejects Proxy objects. Browser role state is guidance,
    // not authority, but it should mirror the server's fail-closed projection.
    globalThis.structuredClone(claims);

    const role = ownDataValue(claims, 'role');
    if (role === 'unverified') return 'unverified';
    if (ownDataValue(claims, 'email_verified') !== true) return null;
    return role === 'member' || role === 'admin' ? role : null;
  } catch {
    return null;
  }
}

export function isValidEmailActionCode(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    return false;
  }
  // Firebase action codes use its web-safe Base64 alphabet. The dot is the
  // web-safe padding character; percent escapes and decoded Unicode are not
  // provider codes and must fail before a network call.
  return /^[A-Za-z0-9._-]+$/u.test(value);
}

function readProviderErrorCode(error: unknown): string | null {
  try {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
      return null;
    }
    const { code } = error as { code?: unknown };
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
}

function actionFailureResult(error: unknown): EmailVerificationActionResult {
  const code = readProviderErrorCode(error);
  return code !== null && UNUSABLE_ACTION_CODE_ERRORS.has(code)
    ? 'unusable'
    : 'unavailable';
}

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase('en-US');
}

export interface RegistrationResult {
  credential: UserCredential;
  user: User;
  verificationEmailRequest: VerificationEmailRequestStatus;
}

export interface AuthUser {
  uid: string;
  email: string | null;
  role: UserRole;
}

export type AuthStateCallback = (user: AuthUser | null) => void;

class IdentityService {
  private readonly auth: Auth;

  private currentUserRole: UserRole = null;

  private currentUserRoleUid: string | null = null;

  private roleRequestVersion = 0;

  private signedOutStatePublished = false;

  private authStateListeners: Set<AuthStateCallback> = new Set();

  constructor(firebase: FirebaseResources) {
    this.auth = firebase.auth;
    this.initAuthStateListener();
  }

  private initAuthStateListener(): void {
    onAuthStateChanged(this.auth, async (user) => {
      if (!user) {
        // Ignore an older sign-out callback after another account is current.
        if (this.auth.currentUser !== null) return;

        this.roleRequestVersion += 1;
        this.clearUserRole();
        if (!this.signedOutStatePublished) this.notifyListeners(null);
        return;
      }

      await this.refreshUserRole(user);
    });
  }

  private clearUserRole(): void {
    this.currentUserRole = null;
    this.currentUserRoleUid = null;
  }

  private roleForUser(user: User): UserRole {
    return this.currentUserRoleUid === user.uid ? this.currentUserRole : null;
  }

  private async refreshUserRole(user: User): Promise<UserRole> {
    // Firebase Auth callbacks can finish out of order. Never let an older
    // account clear or populate the role projection for the current account.
    if (this.auth.currentUser?.uid !== user.uid) return null;

    const requestVersion = this.roleRequestVersion + 1;
    this.roleRequestVersion = requestVersion;
    this.clearUserRole();
    this.notifyListeners(user);

    const role = await this.fetchUserRole(user);
    if (
      requestVersion !== this.roleRequestVersion
      || this.auth.currentUser?.uid !== user.uid
    ) {
      return null;
    }

    this.currentUserRole = role;
    this.currentUserRoleUid = user.uid;
    this.notifyListeners(user);
    return role;
  }

  // eslint-disable-next-line class-methods-use-this
  private async fetchUserRole(user: User): Promise<UserRole> {
    try {
      const idTokenResult: IdTokenResult = await user.getIdTokenResult(true);
      return projectUserRoleFromTokenClaims(idTokenResult.claims);
    } catch {
      return null;
    }
  }

  private notifyListeners(user: User | null): void {
    const authUser = user ? this.mapToAuthUser(user) : null;
    this.signedOutStatePublished = user === null;
    this.authStateListeners.forEach((callback) => {
      try {
        callback(authUser);
      } catch {
        // A UI subscriber must not change the truthful provider outcome.
      }
    });
  }

  private mapToAuthUser(user: User): AuthUser {
    return {
      uid: user.uid,
      email: user.email,
      role: this.roleForUser(user),
    };
  }

  get currentUser(): AuthUser | null {
    const user = this.auth.currentUser;
    return user ? this.mapToAuthUser(user) : null;
  }

  get isAuthenticated(): boolean {
    return this.auth.currentUser !== null;
  }

  async checkMembership(): Promise<boolean> {
    await this.auth.authStateReady();
    const { currentUser } = this.auth;

    if (!currentUser) {
      return false;
    }

    let role = this.roleForUser(currentUser);
    if (role === null) role = await this.refreshUserRole(currentUser);

    return role === 'member' || role === 'admin';
  }

  async checkAdmin(): Promise<boolean> {
    await this.auth.authStateReady();
    const { currentUser } = this.auth;

    if (!currentUser) {
      return false;
    }

    let role = this.roleForUser(currentUser);
    if (role === null) role = await this.refreshUserRole(currentUser);

    return role === 'admin';
  }

  onAuthStateChanged(callback: AuthStateCallback): Unsubscribe {
    this.authStateListeners.add(callback);

    // Call immediately with current state if user is already authenticated
    if (this.auth.currentUser) {
      this.signedOutStatePublished = false;
      try {
        callback(this.mapToAuthUser(this.auth.currentUser));
      } catch {
        // Keep one faulty subscriber isolated from the Auth service.
      }
    }

    return () => {
      this.authStateListeners.delete(callback);
    };
  }

  async signIn(email: string, password: string): Promise<UserCredential> {
    const credential = await signInWithEmailAndPassword(this.auth, email, password);
    await this.refreshUserRole(credential.user);
    return credential;
  }

  async register(email: string, password: string): Promise<RegistrationResult> {
    const credential = await createUserWithEmailAndPassword(this.auth, email, password);
    if (this.auth.currentUser?.uid === credential.user.uid) {
      this.roleRequestVersion += 1;
      this.currentUserRole = 'unverified';
      this.currentUserRoleUid = credential.user.uid;
      this.notifyListeners(credential.user);
    }
    try {
      await sendEmailVerification(credential.user);
      return {
        credential,
        user: credential.user,
        verificationEmailRequest: 'accepted',
      };
    } catch {
      reportClientFailure(clientFailureEvents.emailVerificationFailed);
      return {
        credential,
        user: credential.user,
        verificationEmailRequest: 'unavailable',
      };
    }
  }

  async signOut(): Promise<void> {
    await firebaseSignOut(this.auth);
    if (this.auth.currentUser === null) {
      this.roleRequestVersion += 1;
      this.clearUserRole();
      if (!this.signedOutStatePublished) this.notifyListeners(null);
    }
  }

  async sendPasswordReset(email: string): Promise<void> {
    await sendPasswordResetEmail(this.auth, email);
  }

  async resendVerificationEmail(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) {
      throw new Error('Not signed in');
    }
    await sendEmailVerification(user);
  }

  async verifyEmailAction(actionCode: string): Promise<EmailVerificationActionResult> {
    if (!isValidEmailActionCode(actionCode)) {
      return 'unusable';
    }

    let actionInfo;
    try {
      actionInfo = await checkActionCode(this.auth, actionCode);
    } catch (error: unknown) {
      return actionFailureResult(error);
    }

    if (actionInfo.operation !== ActionCodeOperation.VERIFY_EMAIL) {
      return 'unusable';
    }

    const { email: targetEmail } = actionInfo.data;
    if (typeof targetEmail !== 'string' || targetEmail.trim() === '') {
      return 'unusable';
    }

    try {
      await this.auth.authStateReady();
    } catch {
      return 'unavailable';
    }
    const { currentUser } = this.auth;
    if (currentUser) {
      if (
        typeof currentUser.email !== 'string'
        || normalizeEmail(currentUser.email) !== normalizeEmail(targetEmail)
      ) {
        return 'wrong-account';
      }
      if (currentUser.emailVerified) {
        return 'already-complete';
      }
    }

    try {
      await applyActionCode(this.auth, actionCode);
      return 'verified';
    } catch (error: unknown) {
      return actionFailureResult(error);
    }
  }

  async refreshToken(): Promise<string | null> {
    const { currentUser } = this.auth;
    if (!currentUser) {
      return null;
    }
    return currentUser.getIdToken(true);
  }
}

export default IdentityService;
