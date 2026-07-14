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

  private authStateListeners: Set<AuthStateCallback> = new Set();

  constructor(firebase: FirebaseResources) {
    this.auth = firebase.auth;
    this.initAuthStateListener();
  }

  private initAuthStateListener(): void {
    onAuthStateChanged(this.auth, async (user) => {
      if (user) {
        this.currentUserRole = await this.fetchUserRole(user);
      } else {
        this.currentUserRole = null;
      }
      this.notifyListeners(user);
    });
  }

  // eslint-disable-next-line class-methods-use-this
  private async fetchUserRole(user: User): Promise<UserRole> {
    try {
      const idTokenResult: IdTokenResult = await user.getIdTokenResult(true);
      return (idTokenResult.claims.role as UserRole) || null;
    } catch {
      return null;
    }
  }

  private notifyListeners(user: User | null): void {
    const authUser = user ? this.mapToAuthUser(user) : null;
    this.authStateListeners.forEach((callback) => callback(authUser));
  }

  private mapToAuthUser(user: User): AuthUser {
    return {
      uid: user.uid,
      email: user.email,
      role: this.currentUserRole,
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

    if (this.currentUserRole === null) {
      this.currentUserRole = await this.fetchUserRole(currentUser);
    }

    return this.currentUserRole === 'member' || this.currentUserRole === 'admin';
  }

  async checkAdmin(): Promise<boolean> {
    await this.auth.authStateReady();
    const { currentUser } = this.auth;

    if (!currentUser) {
      return false;
    }

    if (this.currentUserRole === null) {
      this.currentUserRole = await this.fetchUserRole(currentUser);
    }

    return this.currentUserRole === 'admin';
  }

  onAuthStateChanged(callback: AuthStateCallback): Unsubscribe {
    this.authStateListeners.add(callback);

    // Call immediately with current state if user is already authenticated
    if (this.auth.currentUser) {
      callback(this.mapToAuthUser(this.auth.currentUser));
    }

    return () => {
      this.authStateListeners.delete(callback);
    };
  }

  async signIn(email: string, password: string): Promise<UserCredential> {
    const credential = await signInWithEmailAndPassword(this.auth, email, password);
    this.currentUserRole = await this.fetchUserRole(credential.user);
    return credential;
  }

  async register(email: string, password: string): Promise<RegistrationResult> {
    const credential = await createUserWithEmailAndPassword(this.auth, email, password);
    this.currentUserRole = 'unverified';
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
    this.currentUserRole = null;
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
