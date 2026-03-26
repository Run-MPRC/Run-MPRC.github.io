import { FirebaseApp, initializeApp } from 'firebase/app';
import { Analytics, getAnalytics, isSupported } from 'firebase/analytics';
import { Auth, connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  Firestore,
  getFirestore,
} from 'firebase/firestore';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyD0-xVlhYZvUk-A2zRO5pJ3_2vYDI8Phc0',
  authDomain: 'runmprc-97922.firebaseapp.com',
  projectId: 'runmprc-97922',
  storageBucket: 'runmprc-97922.appspot.com',
  messagingSenderId: '421024796584',
  appId: '1:421024796584:web:608b41bd53f0dd44a1179d',
  measurementId: 'G-BJX9HM4FQ8',
} as const;

const isDevelopment = process.env.NODE_ENV === 'development';

class FirebaseResources {
  readonly app: FirebaseApp;

  readonly auth: Auth;

  readonly firestore: Firestore;

  private _analytics: Analytics | null = null;

  private static _instance: FirebaseResources | null = null;

  private static _emulatorsConnected = false;

  private constructor() {
    this.app = initializeApp(FIREBASE_CONFIG);
    this.auth = getAuth(this.app);
    this.firestore = getFirestore(this.app);

    this.connectEmulators();
    this.initAnalytics();
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
