import {
  Auth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User,
  UserCredential,
  Unsubscribe,
  IdTokenResult,
} from 'firebase/auth';
import FirebaseResources from '../firebase/FirebaseResources';

export type UserRole = 'admin' | 'member' | 'unverified' | null;

export interface AuthUser {
  uid: string;
  email: string | null;
  role: UserRole;
}

type AuthStateCallback = (user: AuthUser | null) => void;

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

  async register(email: string, password: string): Promise<UserCredential> {
    const credential = await createUserWithEmailAndPassword(this.auth, email, password);
    this.currentUserRole = 'unverified';
    return credential;
  }

  async signOut(): Promise<void> {
    await firebaseSignOut(this.auth);
    this.currentUserRole = null;
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
