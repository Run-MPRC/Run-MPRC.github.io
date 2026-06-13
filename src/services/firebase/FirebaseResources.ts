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

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyD2u17HMhDPZ0Tn9D3H71fep1vZgT-njnw',
  authDomain: 'mid-peninsula-running-club.firebaseapp.com',
  projectId: 'mid-peninsula-running-club',
  storageBucket: 'mid-peninsula-running-club.firebasestorage.app',
  messagingSenderId: '253289716314',
  appId: '1:253289716314:web:dcad9766d820044d7f9663',
  measurementId: 'G-ECN7TT0BGF',
} as const;

const isDevelopment = process.env.NODE_ENV === 'development';

class FirebaseResources {
  readonly app: FirebaseApp;

  readonly auth: Auth;

  readonly firestore: Firestore;

  private _analytics: Analytics | null = null;

  private _appCheck: AppCheck | null = null;

  private static _instance: FirebaseResources | null = null;

  private static _emulatorsConnected = false;

  private constructor() {
    this.app = initializeApp(FIREBASE_CONFIG);
    this.initAppCheck();
    this.auth = getAuth(this.app);
    this.firestore = getFirestore(this.app);

    this.connectEmulators();
    this.initAnalytics();
  }

  private initAppCheck(): void {
    const siteKey = process.env.REACT_APP_RECAPTCHA_SITE_KEY;
    if (!siteKey) {
      if (!isDevelopment) {
        console.warn(
          'App Check disabled: set REACT_APP_RECAPTCHA_SITE_KEY to enable',
        );
      }
      return;
    }
    if (isDevelopment) {
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
    if (isDevelopment && !FirebaseResources._emulatorsConnected) {
      try {
        connectAuthEmulator(this.auth, 'http://localhost:9099', { disableWarnings: true });
        connectFirestoreEmulator(this.firestore, '127.0.0.1', 8080);
        FirebaseResources._emulatorsConnected = true;
      } catch (error) {
        console.warn('Failed to connect to Firebase emulators:', error);
      }
    }
  }

  private async initAnalytics(): Promise<void> {
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
