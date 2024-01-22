import { FirebaseApp, initializeApp } from 'firebase/app';
import { Analytics, getAnalytics } from 'firebase/analytics';
import { Auth, connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  Firestore,
  getFirestore,
} from 'firebase/firestore';

class FirebaseResources {
  private readonly app: FirebaseApp;

  private readonly analytics: Analytics;

  private readonly auth: Auth;

  private readonly firestore: Firestore;

  constructor() {
    const firebaseConfig = {
      apiKey: 'AIzaSyD0-xVlhYZvUk-A2zRO5pJ3_2vYDI8Phc0',
      authDomain: 'runmprc-97922.firebaseapp.com',
      projectId: 'runmprc-97922',
      storageBucket: 'runmprc-97922.appspot.com',
      messagingSenderId: '421024796584',
      appId: '1:421024796584:web:608b41bd53f0dd44a1179d',
      measurementId: 'G-BJX9HM4FQ8',
    };

    this.app = initializeApp(firebaseConfig);

    this.analytics = getAnalytics(this.app);
    this.auth = getAuth(this.app);
    this.firestore = getFirestore(this.app);

    if (process.env.NODE_ENV === 'development') {
      connectAuthEmulator(this.auth, 'http://localhost:9099');
      connectFirestoreEmulator(this.firestore, '127.0.0.1', 8080);
    }
  }

  get getAnalytics(): Analytics {
    return this.analytics;
  }

  get getAuth(): Auth {
    return this.auth;
  }

  get getFirestore(): Firestore {
    return this.firestore;
  }
}

export default FirebaseResources;
