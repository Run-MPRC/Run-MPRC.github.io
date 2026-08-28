import { FirebaseApp, initializeApp } from 'firebase/app';
import { Analytics, getAnalytics, isSupported } from 'firebase/analytics';
import {
  AppCheck, initializeAppCheck, ReCaptchaV3Provider,
} from 'firebase/app-check';
import { Auth, connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  Firestore,
  getFirestore,
} from 'firebase/firestore';
import {
  connectFunctionsEmulator,
  Functions,
  getFunctions,
} from 'firebase/functions';

const isLocalRuntime = process.env.NODE_ENV !== 'production';
const LOCAL_FIREBASE_PROJECT_ID = 'demo-mprc-local';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyD2u17HMhDPZ0Tn9D3H71fep1vZgT-njnw',
  authDomain: 'mid-peninsula-running-club.firebaseapp.com',
  // A demo-* project ID is intentionally non-addressable outside the Emulator
  // Suite. It also keeps local Functions URLs aligned with `npm run emulators`.
  projectId: isLocalRuntime
    ? LOCAL_FIREBASE_PROJECT_ID
    : 'mid-peninsula-running-club',
  storageBucket: 'mid-peninsula-running-club.firebasestorage.app',
  messagingSenderId: '253289716314',
  appId: '1:253289716314:web:dcad9766d820044d7f9663',
  measurementId: 'G-ECN7TT0BGF',
} as const;

class FirebaseResources {
  readonly app: FirebaseApp;

  readonly auth: Auth;

  readonly firestore: Firestore;

  readonly functions: Functions;

  private _analytics: Analytics | null = null;

  private _appCheck: AppCheck | null = null;

  private static _instance: FirebaseResources | null = null;

  private static _emulatorsConnected = false;

  private constructor() {
    this.app = initializeApp(FIREBASE_CONFIG);
    this.initAppCheck();
    this.auth = getAuth(this.app);
    this.firestore = getFirestore(this.app);
    this.functions = getFunctions(this.app);

    this.connectEmulators();
    this.initAnalytics();
  }

  private initAppCheck(): void {
    const siteKey = process.env.REACT_APP_RECAPTCHA_SITE_KEY;
    if (!siteKey) {
      if (!isLocalRuntime) {
        console.warn(
          'App Check disabled: set REACT_APP_RECAPTCHA_SITE_KEY to enable',
        );
      }
      return;
    }
    if (isLocalRuntime) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    try {
      this._appCheck = initializeAppCheck(this.app, {
        provider: new ReCaptchaV3Provider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (error) {
      console.warn('App Check init failed:', error);
    }
  }

  static getInstance(): FirebaseResources {
    if (!FirebaseResources._instance) {
      FirebaseResources._instance = new FirebaseResources();
    }
    return FirebaseResources._instance;
  }

  private connectEmulators(): void {
    if (isLocalRuntime && !FirebaseResources._emulatorsConnected) {
      try {
        connectAuthEmulator(this.auth, 'http://localhost:9099', { disableWarnings: true });
        connectFirestoreEmulator(this.firestore, '127.0.0.1', 8080);
        connectFunctionsEmulator(this.functions, '127.0.0.1', 5001);
        FirebaseResources._emulatorsConnected = true;
      } catch (_error) {
        // Development must fail closed. Continuing after a partial emulator
        // connection can send a later SDK call to the configured live service.
        throw new Error('Local Firebase emulator isolation failed; stop development startup.');
      }
    }
  }

  private async initAnalytics(): Promise<void> {
    // Firebase Analytics has no Emulator Suite target. Never initialize it
    // from `npm start`, even if production measurement config is present.
    if (isLocalRuntime) return;
    try {
      const supported = await isSupported();
      if (supported) {
        this._analytics = getAnalytics(this.app);
      }
    } catch (error) {
      console.warn('Analytics not supported:', error);
    }
  }

  get analytics(): Analytics | null {
    return this._analytics;
  }
}

export default FirebaseResources;
