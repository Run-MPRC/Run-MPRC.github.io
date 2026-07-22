import { FirebaseApp, initializeApp } from 'firebase/app';
import {
  AppCheck, getToken, initializeAppCheck, ReCaptchaEnterpriseProvider,
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

import hasCapabilityCallbackState, {
  browserRouterStateIsClean,
  isCapabilityCallbackPath,
  isStravaCapabilityCallbackPath,
} from '../monitoring/capabilityCallback';
import {
  clientFailureEvents,
  reportClientFailure,
} from '../monitoring/clientDiagnostics';

const isLocalRuntime = process.env.NODE_ENV !== 'production';
const LOCAL_FIREBASE_PROJECT_ID = 'demo-mprc-local';
const FUNCTION_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const STRAVA_APP_CHECK_PREPARATION_FAILED = (
  'Strava callback App Check preparation failed.'
);

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
const initialPageHadUrlCapabilityCallbackState = typeof window !== 'undefined'
  && hasCapabilityCallbackState(window.location);
const initialPagePathWasCapabilityCallback = typeof window !== 'undefined'
  && isCapabilityCallbackPath(window.location.pathname);
const initialPageHadCapabilityCallbackState = initialPageHadUrlCapabilityCallbackState
  || (
    typeof window !== 'undefined'
    && initialPagePathWasCapabilityCallback
    && !browserRouterStateIsClean(window.history.state)
  );
const initialPageWasStravaCapabilityCallback = typeof window !== 'undefined'
  && initialPageHadUrlCapabilityCallbackState
  && isStravaCapabilityCallbackPath(window.location.pathname);

function currentNativeStravaCallbackIsClean(): boolean {
  return typeof window !== 'undefined'
    && isStravaCapabilityCallbackPath(window.location.pathname)
    && window.location.search === ''
    && window.location.hash === ''
    && browserRouterStateIsClean(window.history.state);
}

function stravaAppCheckPreparationError(): Error {
  return new Error(STRAVA_APP_CHECK_PREPARATION_FAILED);
}

class FirebaseResources {
  readonly app: FirebaseApp;

  readonly auth: Auth;

  readonly firestore: Firestore;

  readonly functions: Functions;

  readonly analytics: null = null;

  private _appCheck: AppCheck | null = null;

  private _stravaAppCheckPreparation: Promise<void> | null = null;

  private _stravaAppCheckPreparationInvalidated = false;

  private _stravaAppCheckPreparationReady = false;

  private static _instance: FirebaseResources | null = null;

  private static _emulatorsConnected = false;

  private constructor() {
    this.app = initializeApp(FIREBASE_CONFIG);
    this.initAppCheck();
    this.auth = getAuth(this.app);
    this.firestore = getFirestore(this.app);
    this.functions = getFunctions(this.app);

    this.connectEmulators();
  }

  private initAppCheck(): void {
    // App Check has no local Emulator Suite target. Do not initialize a
    // provider or exchange a debug token from development or tests.
    // Its reCAPTCHA Enterprise provider is also an outside script, so do not start it
    // while an initial OAuth/checkout capability remains in the page URL or saved
    // Router entry.
    if (
      isLocalRuntime
      || initialPageHadCapabilityCallbackState
      || (typeof window !== 'undefined' && hasCapabilityCallbackState(window.location))
    ) return;

    this._appCheck = this.initializeAppCheckProvider();
  }

  private initializeAppCheckProvider(
    beforeInitialization?: () => boolean,
  ): AppCheck | null {
    const siteKey = process.env.REACT_APP_RECAPTCHA_SITE_KEY;
    if (!siteKey) {
      reportClientFailure(clientFailureEvents.appCheckDisabled);
      return null;
    }
    try {
      const provider = new ReCaptchaEnterpriseProvider(siteKey);
      if (beforeInitialization && !beforeInitialization()) return null;
      return initializeAppCheck(this.app, {
        provider,
        isTokenAutoRefreshEnabled: true,
      });
    } catch {
      reportClientFailure(clientFailureEvents.appCheckInitializationFailed);
      return null;
    }
  }

  private stravaAppCheckPreparationIsCurrent(): boolean {
    if (
      this._stravaAppCheckPreparationInvalidated
      || !currentNativeStravaCallbackIsClean()
    ) {
      this._stravaAppCheckPreparationInvalidated = true;
      return false;
    }
    return true;
  }

  private async prepareStravaAppCheckOnce(): Promise<void> {
    // The first public check and this queued check bracket the microtask that
    // establishes the single flight. Do not initialize after a reinjection.
    if (!this.stravaAppCheckPreparationIsCurrent()) {
      throw stravaAppCheckPreparationError();
    }

    const appCheck = this.initializeAppCheckProvider(
      () => this.stravaAppCheckPreparationIsCurrent(),
    );
    if (appCheck === null) {
      throw stravaAppCheckPreparationError();
    }
    this._appCheck = appCheck;

    if (!this.stravaAppCheckPreparationIsCurrent()) {
      throw stravaAppCheckPreparationError();
    }

    let tokenReadiness: ReturnType<typeof getToken>;
    try {
      // Readiness is the only result used here. The token value is never
      // accepted, returned, inspected, logged, or stored by application code.
      tokenReadiness = Promise.resolve(getToken(appCheck));
    } catch {
      reportClientFailure(clientFailureEvents.appCheckInitializationFailed);
      throw stravaAppCheckPreparationError();
    }

    if (!this.stravaAppCheckPreparationIsCurrent()) {
      // The SDK request cannot be cancelled. Attach a value-blind rejection
      // sink before this preparation stops so a later SDK failure is inert.
      tokenReadiness.then(() => undefined, () => undefined);
      throw stravaAppCheckPreparationError();
    }

    try {
      await tokenReadiness;
    } catch {
      reportClientFailure(clientFailureEvents.appCheckInitializationFailed);
      throw stravaAppCheckPreparationError();
    }

    if (!this.stravaAppCheckPreparationIsCurrent()) {
      throw stravaAppCheckPreparationError();
    }
  }

  prepareAppCheckAfterStravaCallbackCleanup(): Promise<void> {
    // App Check has no local emulator. Its deliberate local/test no-op must
    // not turn an otherwise valid synthetic callback into a failure.
    if (isLocalRuntime) return Promise.resolve();

    if (!initialPageWasStravaCapabilityCallback) {
      this._stravaAppCheckPreparationInvalidated = true;
      return Promise.reject(stravaAppCheckPreparationError());
    }

    if (!currentNativeStravaCallbackIsClean()) {
      this._stravaAppCheckPreparationInvalidated = true;
      return Promise.reject(stravaAppCheckPreparationError());
    }

    if (this._stravaAppCheckPreparationInvalidated) {
      if (
        this._stravaAppCheckPreparation !== null
        && !this._stravaAppCheckPreparationReady
      ) return this._stravaAppCheckPreparation;
      return Promise.reject(stravaAppCheckPreparationError());
    }

    if (this._stravaAppCheckPreparation === null) {
      // Queue the irreversible provider work so the promise is cached before
      // any provider code can re-enter this method.
      this._stravaAppCheckPreparation = Promise.resolve()
        .then(() => this.prepareStravaAppCheckOnce())
        .then(() => {
          // The async preparation and this final handler are separate
          // microtasks. A concurrent dirty observation between them must
          // poison the flight before it can be marked ready.
          if (!this.stravaAppCheckPreparationIsCurrent()) {
            throw stravaAppCheckPreparationError();
          }
          this._stravaAppCheckPreparationReady = true;
        });
    }
    return this._stravaAppCheckPreparation;
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
