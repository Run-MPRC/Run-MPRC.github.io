jest.mock('firebase-functions', () => {
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  return {
    https: {
      HttpsError,
      onCall: (handler) => handler,
    },
  };
});

jest.mock('./stripeHelpers', () => ({
  requireAppCheck: jest.fn(),
}));

jest.mock('firebase-admin', () => {
  let registrations = [];
  let events = new Map();
  let queries = [];
  let eventReads = [];

  function fieldValue(record, field) {
    return field.split('.').reduce((value, key) => value?.[key], record);
  }

  function registrationSnapshot(records) {
    return {
      forEach(callback) {
        records.forEach(callback);
      },
    };
  }

  const firestoreApi = {
    collectionGroup: jest.fn((name) => {
      if (name !== 'registrations') {
        throw new Error(`Unexpected collection group: ${name}`);
      }
      return {
        where: jest.fn((field, operator, value) => {
          queries.push({ field, operator, value });
          return {
            get: jest.fn(async () => registrationSnapshot(
              registrations.filter((document) => (
                operator === '=='
                && fieldValue(document.data(), field) === value
              )),
            )),
          };
        }),
      };
    }),
    collection: jest.fn((name) => {
      if (name !== 'events') throw new Error(`Unexpected collection: ${name}`);
      return {
        doc: jest.fn((eventId) => ({
          get: jest.fn(async () => {
            eventReads.push(eventId);
            const event = events.get(eventId);
            return {
              exists: event !== undefined,
              data: () => event,
            };
          }),
        })),
      };
    }),
  };

  return {
    firestore: jest.fn(() => firestoreApi),
    __eventReads: () => [...eventReads],
    __queries: () => queries.map((query) => ({ ...query })),
    __reset: () => {
      registrations = [];
      events = new Map();
      queries = [];
      eventReads = [];
      firestoreApi.collectionGroup.mockClear();
      firestoreApi.collection.mockClear();
    },
    __seedEvent: (eventId, event) => {
      events.set(eventId, event);
    },
    __seedRegistrations: (documents) => {
      registrations = documents;
    },
  };
});

const admin = require('firebase-admin');
const { requireAppCheck } = require('./stripeHelpers');
const { listMyRegistrations } = require('./listMyRegistrations');

const CONTEXT = {
  app: { appId: 'synthetic-app' },
  auth: {
    uid: 'account-owner-uid',
    token: {},
  },
};

function registrationDocument({
  createdSeconds = 1_800_000_000,
  eventId = 'synthetic-event',
  id = 'synthetic-registration',
  runnerEmail = 'runner@example.test',
  uid = CONTEXT.auth.uid,
} = {}) {
  const record = {
    amountCents: 2500,
    cancelledAt: null,
    createdAt: { _seconds: createdSeconds },
    currency: 'usd',
    eventId,
    paidAt: { _seconds: createdSeconds + 10 },
    priceTier: 'nonMember',
    refundedAt: null,
    runner: {
      email: runnerEmail,
      firstName: 'Synthetic',
      lastName: 'Runner',
      phone: 'not-projected',
      shirtSize: 'synthetic-size',
    },
    status: 'paid',
    uid,
  };
  return {
    data: jest.fn(() => record),
    id,
    ref: { path: `events/${eventId}/registrations/${id}` },
  };
}

describe('My Account registration UID ownership', () => {
  beforeEach(() => {
    admin.__reset();
    admin.firestore.mockClear();
    requireAppCheck.mockReset();
  });

  test('preserves App Check and stops an unauthenticated request before Firestore', async () => {
    await expect(listMyRegistrations({}, {
      app: CONTEXT.app,
      auth: null,
    })).rejects.toMatchObject({
      code: 'unauthenticated',
      message: 'Sign-in required',
    });

    expect(requireAppCheck).toHaveBeenCalledTimes(1);
    expect(admin.firestore).not.toHaveBeenCalled();
    expect(admin.__queries()).toEqual([]);
  });

  test('stops before Firestore when the existing App Check guard denies', async () => {
    const denial = new Error('synthetic App Check denial');
    requireAppCheck.mockImplementationOnce(() => {
      throw denial;
    });

    await expect(listMyRegistrations({}, CONTEXT)).rejects.toBe(denial);

    expect(requireAppCheck).toHaveBeenCalledWith(CONTEXT);
    expect(admin.firestore).not.toHaveBeenCalled();
    expect(admin.__queries()).toEqual([]);
  });

  test('returns the existing sanitized projection, event summaries, and sort for exact UID rows', async () => {
    admin.__seedRegistrations([
      registrationDocument({
        createdSeconds: 1_800_000_010,
        eventId: 'event-older',
        id: 'registration-older',
      }),
      registrationDocument({
        createdSeconds: 1_800_000_020,
        eventId: 'event-newer',
        id: 'registration-newer',
      }),
    ]);
    admin.__seedEvent('event-older', {
      location: 'Synthetic Park',
      slug: 'event-older',
      startAt: { _seconds: 1_900_000_010 },
      title: 'Older Synthetic Event',
      privateField: 'not-projected',
    });
    admin.__seedEvent('event-newer', {
      location: 'Synthetic Track',
      slug: 'event-newer',
      startAt: { _seconds: 1_900_000_020 },
      title: 'Newer Synthetic Event',
      privateField: 'not-projected',
    });

    const result = await listMyRegistrations({}, CONTEXT);

    expect(result).toEqual({
      events: {
        'event-newer': {
          id: 'event-newer',
          location: 'Synthetic Track',
          slug: 'event-newer',
          startAt: { _seconds: 1_900_000_020 },
          title: 'Newer Synthetic Event',
        },
        'event-older': {
          id: 'event-older',
          location: 'Synthetic Park',
          slug: 'event-older',
          startAt: { _seconds: 1_900_000_010 },
          title: 'Older Synthetic Event',
        },
      },
      registrations: [
        expect.objectContaining({
          eventId: 'event-newer',
          id: 'registration-newer',
          runner: {
            email: 'runner@example.test',
            firstName: 'Synthetic',
            lastName: 'Runner',
            shirtSize: 'synthetic-size',
          },
        }),
        expect.objectContaining({
          eventId: 'event-older',
          id: 'registration-older',
        }),
      ],
    });
    expect(admin.__queries()).toEqual([{
      field: 'uid',
      operator: '==',
      value: CONTEXT.auth.uid,
    }]);
    expect(admin.__eventReads().sort()).toEqual(['event-newer', 'event-older']);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('not-projected');
  });

  test.each([
    ['no UID', null],
    ['another account UID', 'different-account-uid'],
  ])('does not return an email-matched registration with %s', async (_label, uid) => {
    const matchingEmail = 'matching-runner@example.test';
    admin.__seedRegistrations([
      registrationDocument({
        eventId: 'email-only-event',
        id: 'email-only-registration',
        runnerEmail: matchingEmail,
        uid,
      }),
    ]);
    admin.__seedEvent('email-only-event', {
      location: 'Must Not Be Read',
      title: 'Must Not Be Returned',
    });
    const context = {
      ...CONTEXT,
      auth: {
        uid: CONTEXT.auth.uid,
        token: {
          email: matchingEmail,
          email_verified: true,
        },
      },
    };

    await expect(listMyRegistrations({}, context)).resolves.toEqual({
      events: {},
      registrations: [],
    });
    expect(admin.__queries()).toEqual([{
      field: 'uid',
      operator: '==',
      value: CONTEXT.auth.uid,
    }]);
    expect(admin.__eventReads()).toEqual([]);
  });

  test.each([
    ['accessor-backed', () => {
      let reads = 0;
      const token = {};
      Object.defineProperties(token, {
        email: {
          get() {
            reads += 1;
            return 'accessor-runner@example.test';
          },
        },
        email_verified: {
          get() {
            reads += 1;
            return true;
          },
        },
      });
      return { reads: () => reads, token };
    }],
    ['proxied', () => {
      let reads = 0;
      const token = new Proxy({}, {
        get(_target, property) {
          if (property === 'email' || property === 'email_verified') reads += 1;
          if (property === 'email') return 'proxy-runner@example.test';
          if (property === 'email_verified') return true;
          return undefined;
        },
      });
      return { reads: () => reads, token };
    }],
  ])('does not inspect %s email claims for registration authority', async (_label, makeToken) => {
    const { reads, token } = makeToken();
    admin.__seedRegistrations([
      registrationDocument({
        eventId: 'owned-event',
        id: 'owned-registration',
      }),
    ]);

    const result = await listMyRegistrations({}, {
      ...CONTEXT,
      auth: {
        uid: CONTEXT.auth.uid,
        token,
      },
    });

    expect(result.registrations.map(({ id }) => id)).toEqual(['owned-registration']);
    expect(reads()).toBe(0);
    expect(admin.__queries()).toEqual([{
      field: 'uid',
      operator: '==',
      value: CONTEXT.auth.uid,
    }]);
  });

  test('does not read an event when the exact UID query is empty', async () => {
    admin.__seedRegistrations([
      registrationDocument({
        eventId: 'different-event',
        id: 'different-registration',
        uid: 'different-account-uid',
      }),
    ]);

    await expect(listMyRegistrations({}, CONTEXT)).resolves.toEqual({
      events: {},
      registrations: [],
    });
    expect(admin.__eventReads()).toEqual([]);
  });
});
