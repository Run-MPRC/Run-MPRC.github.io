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

import hasCapabilityCallbackState from '../monitoring/capabilityCallback';

const isLocalRuntime = process.env.NODE_ENV !== 'production';
const LOCAL_FIREBASE_PROJECT_ID = 'demo-mprc-local';
const FUNCTION_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

const LOCAL_FIREBASE_CONFIG = {
  apiKey: 'demo-api-key',
  authDomain: `${LOCAL_FIREBASE_PROJECT_ID}.firebaseapp.com`,
  projectId: LOCAL_FIREBASE_PROJECT_ID,
  storageBucket: `${LOCAL_FIREBASE_PROJECT_ID}.appspot.com`,
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:demo',
} as const;

const PRODUCTION_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyD2u17HMhDPZ0Tn9D3H71fep1vZgT-njnw',
  authDomain: 'mid-peninsula-running-club.firebaseapp.com',
  projectId: 'mid-peninsula-running-club',
  storageBucket: 'mid-peninsula-running-club.firebasestorage.app',
  messagingSenderId: '253289716314',
  appId: '1:253289716314:web:dcad9766d820044d7f9663',
  measurementId: 'G-ECN7TT0BGF',
} as const;

const FIREBASE_CONFIG = isLocalRuntime
  ? LOCAL_FIREBASE_CONFIG
  : PRODUCTION_FIREBASE_CONFIG;

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
    // App Check has no local Emulator Suite target. Do not initialize a
    // provider or exchange a debug token from development or tests.
    if (isLocalRuntime) return;

    const siteKey = process.env.REACT_APP_RECAPTCHA_SITE_KEY;
    if (!siteKey) {
      console.warn(
        'App Check disabled: set REACT_APP_RECAPTCHA_SITE_KEY to enable',
      );
      return;
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
        connectAuthEmulator(this.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
        connectFirestoreEmulator(this.firestore, '127.0.0.1', 8080);
        connectFunctionsEmulator(this.functions, '127.0.0.1', 5001);
        FirebaseResources._emulatorsConnected = true;
      } catch {
        // Continuing after a partial connection could send a later SDK call
        // to a live service. Stop local startup instead.
        throw new Error(
          'Local Firebase emulator isolation failed; stop development startup.',
        );
      }
    }
  }

  private async initAnalytics(): Promise<void> {
    // Analytics has no Emulator Suite target. Never initialize it from local
    // development or tests, even when a production measurement ID is present.
    // A restored OAuth/checkout callback may contain a capability in its URL;
    // do not let automatic analytics startup observe that initial location.
    if (
      isLocalRuntime
      || (typeof window !== 'undefined' && hasCapabilityCallbackState(window.location))
    ) return;
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

  getHttpFunctionUrl(functionName: string): string {
    if (!FUNCTION_NAME_PATTERN.test(functionName)) {
      throw new Error('Invalid Firebase Function name.');
    }

    const { projectId } = this.app.options;
    if (!projectId) {
      throw new Error('Firebase project ID is unavailable.');
    }

    if (isLocalRuntime) {
      return `http://127.0.0.1:5001/${projectId}/us-central1/${functionName}`;
    }
    return `https://us-central1-${projectId}.cloudfunctions.net/${functionName}`;
  }
}

export default FirebaseResources;
