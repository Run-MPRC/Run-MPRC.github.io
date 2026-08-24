import { FirebaseApp, FirebaseOptions, initializeApp } from 'firebase/app';
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
const FIREBASE_ENVIRONMENT_ERROR = (
  'Firebase environment configuration is unavailable; stop startup.'
);
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

type HostedFirebaseConfig = Required<Pick<FirebaseOptions,
  | 'apiKey'
  | 'appId'
  | 'authDomain'
  | 'messagingSenderId'
  | 'projectId'
  | 'storageBucket'
>> & Pick<FirebaseOptions, 'measurementId'>;

// Exact code-unit fixtures let staging reject a production-equal public field
// without placing a usable production Firebase identifier in its executable.
const PRODUCTION_FIREBASE_CONFIG_CODE_UNITS = Object.freeze({
  apiKey: [65, 73, 122, 97, 83, 121, 68, 50, 117, 49, 55, 72, 77, 104,
    68, 80, 90, 48, 84, 110, 57, 68, 51, 72, 55, 49, 102, 101, 112, 49,
    118, 90, 103, 84, 45, 110, 106, 110, 119],
  authDomain: [109, 105, 100, 45, 112, 101, 110, 105, 110, 115, 117, 108,
    97, 45, 114, 117, 110, 110, 105, 110, 103, 45, 99, 108, 117, 98, 46,
    102, 105, 114, 101, 98, 97, 115, 101, 97, 112, 112, 46, 99, 111, 109],
  projectId: [109, 105, 100, 45, 112, 101, 110, 105, 110, 115, 117, 108,
    97, 45, 114, 117, 110, 110, 105, 110, 103, 45, 99, 108, 117, 98],
  storageBucket: [109, 105, 100, 45, 112, 101, 110, 105, 110, 115, 117,
    108, 97, 45, 114, 117, 110, 110, 105, 110, 103, 45, 99, 108, 117, 98,
    46, 102, 105, 114, 101, 98, 97, 115, 101, 115, 116, 111, 114, 97, 103,
    101, 46, 97, 112, 112],
  messagingSenderId: [50, 53, 51, 50, 56, 57, 55, 49, 54, 51, 49, 52],
  appId: [49, 58, 50, 53, 51, 50, 56, 57, 55, 49, 54, 51, 49, 52, 58, 119,
    101, 98, 58, 100, 99, 97, 100, 57, 55, 54, 54, 100, 56, 50, 48, 48,
    52, 52, 100, 55, 102, 57, 54, 54, 51],
  measurementId: [71, 45, 69, 67, 78, 55, 84, 84, 48, 66, 71, 70],
} as const);

function firebaseEnvironmentError(): never {
  throw new Error(FIREBASE_ENVIRONMENT_ERROR);
}

function requiredHostedValue(value: string | undefined): string {
  if (!value
    || value.length > 256
    || value.trim() !== value) return firebaseEnvironmentError();
  return value;
}

function exactlyMatchesCodeUnits(
  value: string | undefined,
  expected: readonly number[],
): boolean {
  if (value === undefined || value.length !== expected.length) return false;
  return expected.every((codeUnit, index) => value.charCodeAt(index) === codeUnit);
}

function isKnownProductionIdentity(value: string | undefined): boolean {
  if (value === undefined) return false;
  return Object.values(PRODUCTION_FIREBASE_CONFIG_CODE_UNITS)
    .some((expected) => exactlyMatchesCodeUnits(value, expected));
}

function isExactProductionConfiguration(config: HostedFirebaseConfig): boolean {
  return Object.entries(PRODUCTION_FIREBASE_CONFIG_CODE_UNITS)
    .every(([key, expected]) => exactlyMatchesCodeUnits(
      config[key as keyof HostedFirebaseConfig],
      expected,
    ));
}

function hostedFirebaseConfig(environment: 'staging' | 'production'): FirebaseOptions {
  const measurementId = process.env.REACT_APP_FIREBASE_MEASUREMENT_ID;
  const config: HostedFirebaseConfig = {
    apiKey: requiredHostedValue(process.env.REACT_APP_FIREBASE_API_KEY),
    authDomain: requiredHostedValue(process.env.REACT_APP_FIREBASE_AUTH_DOMAIN),
    projectId: requiredHostedValue(process.env.REACT_APP_FIREBASE_PROJECT_ID),
    storageBucket: requiredHostedValue(
      process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
    ),
    messagingSenderId: requiredHostedValue(
      process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
    ),
    appId: requiredHostedValue(process.env.REACT_APP_FIREBASE_APP_ID),
    ...(measurementId ? { measurementId: requiredHostedValue(measurementId) } : {}),
  };
  const { projectId, messagingSenderId } = config;
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)
    || !/^[A-Za-z0-9_-]{20,128}$/.test(config.apiKey)
    || config.authDomain !== `${projectId}.firebaseapp.com`
    || (
      config.storageBucket !== `${projectId}.appspot.com`
      && config.storageBucket !== `${projectId}.firebasestorage.app`
    )
    || !/^[0-9]{6,20}$/.test(messagingSenderId)
    || !new RegExp(`^1:${messagingSenderId}:web:[A-Za-z0-9]{8,64}$`)
      .test(config.appId)
    || (config.measurementId !== undefined
      && !/^G-[A-Z0-9]{6,20}$/.test(config.measurementId))
    || (environment === 'production' && !isExactProductionConfiguration(config))
    || (environment === 'staging' && (
      !/(?:^|-)staging(?:-|$)/.test(projectId)
      || Object.values(config).some(isKnownProductionIdentity)
    ))) {
    return firebaseEnvironmentError();
  }
  return config;
}

function selectedFirebaseConfig(): FirebaseOptions {
  const selected = process.env.REACT_APP_FIREBASE_ENVIRONMENT;
  if (isLocalRuntime) {
    if (selected !== undefined && selected !== 'local') {
      return firebaseEnvironmentError();
    }
    return LOCAL_FIREBASE_CONFIG;
  }
  if (selected === 'production' || selected === 'staging') {
    return hostedFirebaseConfig(selected);
  }
  return firebaseEnvironmentError();
}

const FIREBASE_CONFIG = selectedFirebaseConfig();
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
