const { inspect } = require('node:util');

jest.mock('firebase-functions', () => {
  let loggerCalls = 0;

  class HttpsError extends Error {
    constructor(code, message, details) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }

  return {
    __loggerCalls: () => loggerCalls,
    __resetLoggerCalls: () => {
      loggerCalls = 0;
    },
    https: {
      HttpsError,
      onCall: (handler) => handler,
    },
    logger: new Proxy(Object.create(null), {
      get: () => () => {
        loggerCalls += 1;
      },
    }),
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
  let registrationQueryFailure = null;
  let registrationQueryStages = [];
  let registrationSnapshotFailure = null;
  let eventLookupFailure = null;
  let eventLookupStages = [];
  let eventSnapshotFailure = null;
  let eventSnapshotStages = [];

  function enterRegistrationQueryStage(stage) {
    registrationQueryStages.push(stage);
    if (registrationQueryFailure?.stage === stage) {
      throw registrationQueryFailure.value;
    }
  }

  function fieldValue(record, field) {
    return field.split('.').reduce((value, key) => value?.[key], record);
  }

  function enterEventLookupStage(stage, eventId = null) {
    eventLookupStages.push(eventId === null ? stage : `${stage}:${eventId}`);
    if (eventLookupFailure?.stage === stage) {
      throw eventLookupFailure.value;
    }
  }

  function enterEventSnapshotStage(stage, eventId) {
    eventSnapshotStages.push(`${stage}:${eventId}`);
    if (eventSnapshotFailure?.stage === stage) {
      throw eventSnapshotFailure.value;
    }
  }

  function registrationSnapshot(records) {
    return {
      forEach(callback) {
        if (registrationSnapshotFailure !== null) {
          throw registrationSnapshotFailure;
        }
        records.forEach(callback);
      },
    };
  }

  const firestoreApi = {
    collectionGroup: jest.fn((name) => {
      enterRegistrationQueryStage('collectionGroup');
      if (name !== 'registrations') {
        throw new Error(`Unexpected collection group: ${name}`);
      }
      return {
        where: jest.fn((field, operator, value) => {
          enterRegistrationQueryStage('where');
          queries.push({ field, operator, value });
          return {
            get: jest.fn(async () => {
              enterRegistrationQueryStage('get');
              return registrationSnapshot(
                registrations.filter((document) => (
                  operator === '=='
                  && fieldValue(document.data(), field) === value
                )),
              );
            }),
          };
        }),
      };
    }),
    collection: jest.fn((name) => {
      enterEventLookupStage('collection');
      if (name !== 'events') throw new Error(`Unexpected collection: ${name}`);
      return {
        doc: jest.fn((eventId) => {
          enterEventLookupStage('doc', eventId);
          return {
            get: jest.fn(async () => {
              enterEventLookupStage('get', eventId);
              eventReads.push(eventId);
              const event = events.get(eventId);
              return {
                get exists() {
                  enterEventSnapshotStage('exists', eventId);
                  return event !== undefined;
                },
                data: () => {
                  enterEventSnapshotStage('data', eventId);
                  return event;
                },
              };
            }),
          };
        }),
      };
    }),
  };

  return {
    firestore: jest.fn(() => {
      enterRegistrationQueryStage('firestore');
      return firestoreApi;
    }),
    __eventCollectionCalls: () => firestoreApi.collection.mock.calls.length,
    __eventLookupStages: () => [...eventLookupStages],
    __eventReads: () => [...eventReads],
    __eventSnapshotStages: () => [...eventSnapshotStages],
    __failEventLookupAt: (stage, value) => {
      eventLookupFailure = { stage, value };
    },
    __failEventSnapshotAt: (stage, value) => {
      eventSnapshotFailure = { stage, value };
    },
    __failRegistrationQueryAt: (stage, value) => {
      registrationQueryFailure = { stage, value };
    },
    __queries: () => queries.map((query) => ({ ...query })),
    __registrationQueryStages: () => [...registrationQueryStages],
    __failRegistrationSnapshot: (value) => {
      registrationSnapshotFailure = value;
    },
    __reset: () => {
      registrations = [];
      events = new Map();
      queries = [];
      eventReads = [];
      registrationQueryFailure = null;
      registrationQueryStages = [];
      registrationSnapshotFailure = null;
      eventLookupFailure = null;
      eventLookupStages = [];
      eventSnapshotFailure = null;
      eventSnapshotStages = [];
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
const firebaseFunctions = require('firebase-functions');
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
    firebaseFunctions.__resetLoggerCalls();
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

  test('DATA-001A4 does not read or return unused runner details', async () => {
    const runnerCanaries = {
      email: 'unused-runner-email@example.test',
      firstName: 'UnusedRunnerFirstCanary',
      lastName: 'UnusedRunnerLastCanary',
      shirtSize: 'UnusedRunnerSizeCanary',
    };
    let runnerReads = 0;
    const document = registrationDocument({
      createdSeconds: 1_800_000_030,
      eventId: 'privacy-event',
      id: 'privacy-registration',
    });
    const record = document.data();
    Object.defineProperty(record, 'runner', {
      configurable: true,
      enumerable: true,
      get() {
        runnerReads += 1;
        return runnerCanaries;
      },
    });
    document.data.mockClear();
    admin.__seedRegistrations([document]);
    admin.__seedEvent('privacy-event', {
      location: 'Synthetic Privacy Park',
      slug: 'privacy-event',
      startAt: { _seconds: 1_900_000_030 },
      title: 'Synthetic Privacy Event',
    });

    const result = await listMyRegistrations({}, CONTEXT);
    const serialized = JSON.stringify(result);

    expect({
      hasRunner: Object.prototype.hasOwnProperty.call(
        result.registrations[0],
        'runner',
      ),
      runnerReads,
      serializedRunnerCanaries: Object.values(runnerCanaries)
        .filter((canary) => serialized.includes(canary)),
    }).toEqual({
      hasRunner: false,
      runnerReads: 0,
      serializedRunnerCanaries: [],
    });
    expect(result).toEqual({
      events: {
        'privacy-event': {
          id: 'privacy-event',
          location: 'Synthetic Privacy Park',
          slug: 'privacy-event',
          startAt: { _seconds: 1_900_000_030 },
          title: 'Synthetic Privacy Event',
        },
      },
      registrations: [{
        amountCents: 2500,
        cancelledAt: null,
        createdAt: { _seconds: 1_800_000_030 },
        currency: 'usd',
        eventId: 'privacy-event',
        id: 'privacy-registration',
        paidAt: { _seconds: 1_800_000_040 },
        priceTier: 'nonMember',
        refundedAt: null,
        status: 'paid',
      }],
    });
    expect(admin.__queries()).toEqual([{
      field: 'uid',
      operator: '==',
      value: CONTEXT.auth.uid,
    }]);
    expect(admin.__eventReads()).toEqual(['privacy-event']);
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

describe('DATA-001A5 registration query failure boundary', () => {
  beforeEach(() => {
    admin.__reset();
    admin.firestore.mockClear();
    firebaseFunctions.__resetLoggerCalls();
    requireAppCheck.mockReset();
  });

  test.each([
    ['firestore', ['firestore'], []],
    ['collectionGroup', ['firestore', 'collectionGroup'], []],
    ['where', ['firestore', 'collectionGroup', 'where'], []],
    ['get', ['firestore', 'collectionGroup', 'where', 'get'], [{
      field: 'uid',
      operator: '==',
      value: CONTEXT.auth.uid,
    }]],
  ])('maps a hostile %s failure to one fixed result', async (
    stage,
    expectedStages,
    expectedQueries,
  ) => {
    let hostileReads = 0;
    const hostileFailureTarget = Object.create(null);
    Object.defineProperty(hostileFailureTarget, inspect.custom, {
      value: () => {
        hostileReads += 1;
        throw new Error('hostile query failure formatter was inspected');
      },
    });
    const hostileFailure = new Proxy(hostileFailureTarget, {
      get() {
        hostileReads += 1;
        throw new Error('hostile query failure getter was inspected');
      },
      getOwnPropertyDescriptor() {
        hostileReads += 1;
        throw new Error('hostile query failure descriptor was inspected');
      },
      ownKeys() {
        hostileReads += 1;
        throw new Error('hostile query failure keys were inspected');
      },
    });
    const document = registrationDocument({
      eventId: 'must-not-read-event',
      id: 'must-not-project-registration',
    });
    admin.__seedRegistrations([document]);
    admin.__failRegistrationQueryAt(stage, hostileFailure);
    const logSpies = ['debug', 'error', 'info', 'log', 'warn'].map((method) => (
      jest.spyOn(console, method).mockImplementation(() => {})
    ));

    let caught;
    let logCalls;
    try {
      try {
        await listMyRegistrations({}, CONTEXT);
      } catch (error) {
        caught = error;
      }
    } finally {
      logCalls = logSpies.map((spy) => spy.mock.calls.length);
      logSpies.forEach((spy) => spy.mockRestore());
    }
    const rawFailureEscaped = caught === hostileFailure;
    const publicFailure = rawFailureEscaped ? null : {
      causeAbsent: caught?.cause === undefined,
      code: caught?.code,
      detailsAbsent: caught?.details === undefined,
      message: caught?.message,
    };

    expect({
      dataReads: document.data.mock.calls.length,
      eventReads: admin.__eventReads(),
      functionLoggerCalls: firebaseFunctions.__loggerCalls(),
      hostileReads,
      logCalls,
      publicFailure,
      queries: admin.__queries(),
      queryStages: admin.__registrationQueryStages(),
      rawFailureEscaped,
    }).toEqual({
      dataReads: 0,
      eventReads: [],
      functionLoggerCalls: 0,
      hostileReads: 0,
      logCalls: [0, 0, 0, 0, 0],
      publicFailure: {
        causeAbsent: true,
        code: 'unavailable',
        detailsAbsent: true,
        message: 'Registration data could not be loaded.',
      },
      queries: expectedQueries,
      queryStages: expectedStages,
      rawFailureEscaped: false,
    });
    expect(requireAppCheck).toHaveBeenCalledWith(CONTEXT);
    expect(admin.firestore).toHaveBeenCalledTimes(1);
  });
});

describe('DATA-001A6 registration snapshot-processing failure boundary', () => {
  beforeEach(() => {
    admin.__reset();
    admin.firestore.mockClear();
    firebaseFunctions.__resetLoggerCalls();
    requireAppCheck.mockReset();
  });

  test.each([
    ['forEach', 1],
    ['ref.path', 1],
    ['data', 2],
    ['status', 2],
  ])('maps a hostile %s failure to one fixed result', async (
    stage,
    expectedFailingDataCalls,
  ) => {
    let hostileReads = 0;
    const hostileFailureTarget = Object.create(null);
    Object.defineProperty(hostileFailureTarget, inspect.custom, {
      value: () => {
        hostileReads += 1;
        throw new Error('hostile snapshot failure formatter was inspected');
      },
    });
    const hostileFailure = new Proxy(hostileFailureTarget, {
      get() {
        hostileReads += 1;
        throw new Error('hostile snapshot failure getter was inspected');
      },
      getOwnPropertyDescriptor() {
        hostileReads += 1;
        throw new Error('hostile snapshot failure descriptor was inspected');
      },
      ownKeys() {
        hostileReads += 1;
        throw new Error('hostile snapshot failure keys were inspected');
      },
    });
    const failingDocument = registrationDocument({
      eventId: 'must-not-read-failing-event',
      id: 'must-fail-projection',
    });
    const failingRecord = failingDocument.data();
    failingDocument.data.mockClear();
    const laterDocument = registrationDocument({
      eventId: 'must-not-read-later-event',
      id: 'must-not-project-later-registration',
    });

    if (stage === 'forEach') {
      admin.__failRegistrationSnapshot(hostileFailure);
    } else if (stage === 'ref.path') {
      Object.defineProperty(failingDocument.ref, 'path', {
        get: () => {
          throw hostileFailure;
        },
      });
    } else if (stage === 'data') {
      failingDocument.data
        .mockImplementationOnce(() => failingRecord)
        .mockImplementationOnce(() => {
          throw hostileFailure;
        });
    } else {
      Object.defineProperty(failingRecord, 'status', {
        get: () => {
          throw hostileFailure;
        },
      });
    }

    admin.__seedRegistrations([failingDocument, laterDocument]);
    const logSpies = ['debug', 'error', 'info', 'log', 'warn'].map((method) => (
      jest.spyOn(console, method).mockImplementation(() => {})
    ));

    let caught;
    let logCalls;
    try {
      try {
        await listMyRegistrations({}, CONTEXT);
      } catch (error) {
        caught = error;
      }
    } finally {
      logCalls = logSpies.map((spy) => spy.mock.calls.length);
      logSpies.forEach((spy) => spy.mockRestore());
    }
    const rawFailureEscaped = caught === hostileFailure;
    const publicFailure = rawFailureEscaped ? null : {
      causeAbsent: caught?.cause === undefined,
      code: caught?.code,
      detailsAbsent: caught?.details === undefined,
      message: caught?.message,
    };

    expect({
      eventCollectionCalls: admin.__eventCollectionCalls(),
      eventReads: admin.__eventReads(),
      failingDataCalls: failingDocument.data.mock.calls.length,
      functionLoggerCalls: firebaseFunctions.__loggerCalls(),
      hostileReads,
      laterDataCalls: laterDocument.data.mock.calls.length,
      logCalls,
      publicFailure,
      queries: admin.__queries(),
      queryStages: admin.__registrationQueryStages(),
      rawFailureEscaped,
    }).toEqual({
      eventCollectionCalls: 0,
      eventReads: [],
      failingDataCalls: expectedFailingDataCalls,
      functionLoggerCalls: 0,
      hostileReads: 0,
      laterDataCalls: 1,
      logCalls: [0, 0, 0, 0, 0],
      publicFailure: {
        causeAbsent: true,
        code: 'unavailable',
        detailsAbsent: true,
        message: 'Registration data could not be loaded.',
      },
      queries: [{
        field: 'uid',
        operator: '==',
        value: CONTEXT.auth.uid,
      }],
      queryStages: ['firestore', 'collectionGroup', 'where', 'get'],
      rawFailureEscaped: false,
    });
    expect(requireAppCheck).toHaveBeenCalledWith(CONTEXT);
    expect(admin.firestore).toHaveBeenCalledTimes(1);
  });
});

describe('DATA-001A7 registration event-acquisition failure boundary', () => {
  beforeEach(() => {
    admin.__reset();
    admin.firestore.mockClear();
    firebaseFunctions.__resetLoggerCalls();
    requireAppCheck.mockReset();
  });

  test.each([
    ['collection', ['collection']],
    ['doc', ['collection', 'doc:synthetic-event']],
    ['get', [
      'collection',
      'doc:synthetic-event',
      'get:synthetic-event',
    ]],
  ])('maps a hostile event %s failure to one fixed result', async (
    stage,
    expectedEventStages,
  ) => {
    let hostileReads = 0;
    const hostileFailureTarget = Object.create(null);
    Object.defineProperty(hostileFailureTarget, inspect.custom, {
      value: () => {
        hostileReads += 1;
        throw new Error('hostile event failure formatter was inspected');
      },
    });
    const hostileFailure = new Proxy(hostileFailureTarget, {
      get() {
        hostileReads += 1;
        throw new Error('hostile event failure getter was inspected');
      },
      getOwnPropertyDescriptor() {
        hostileReads += 1;
        throw new Error('hostile event failure descriptor was inspected');
      },
      ownKeys() {
        hostileReads += 1;
        throw new Error('hostile event failure keys were inspected');
      },
    });
    let eventProjectionReads = 0;
    const eventProjectionCanary = new Proxy(Object.create(null), {
      get() {
        eventProjectionReads += 1;
        throw new Error('event projection started after acquisition failure');
      },
    });
    const document = registrationDocument();
    admin.__seedRegistrations([document]);
    admin.__seedEvent('synthetic-event', eventProjectionCanary);
    admin.__failEventLookupAt(stage, hostileFailure);
    const logSpies = ['debug', 'error', 'info', 'log', 'warn'].map((method) => (
      jest.spyOn(console, method).mockImplementation(() => {})
    ));

    let caught;
    let logCalls;
    try {
      try {
        await listMyRegistrations({}, CONTEXT);
      } catch (error) {
        caught = error;
      }
    } finally {
      logCalls = logSpies.map((spy) => spy.mock.calls.length);
      logSpies.forEach((spy) => spy.mockRestore());
    }
    const rawFailureEscaped = caught === hostileFailure;
    const publicFailure = rawFailureEscaped ? null : {
      causeAbsent: caught?.cause === undefined,
      code: caught?.code,
      detailsAbsent: caught?.details === undefined,
      message: caught?.message,
    };

    expect({
      eventCollectionCalls: admin.__eventCollectionCalls(),
      eventLookupStages: admin.__eventLookupStages(),
      eventProjectionReads,
      eventReads: admin.__eventReads(),
      functionLoggerCalls: firebaseFunctions.__loggerCalls(),
      hostileReads,
      logCalls,
      publicFailure,
      queries: admin.__queries(),
      queryStages: admin.__registrationQueryStages(),
      rawFailureEscaped,
      registrationDataCalls: document.data.mock.calls.length,
    }).toEqual({
      eventCollectionCalls: 1,
      eventLookupStages: expectedEventStages,
      eventProjectionReads: 0,
      eventReads: [],
      functionLoggerCalls: 0,
      hostileReads: 0,
      logCalls: [0, 0, 0, 0, 0],
      publicFailure: {
        causeAbsent: true,
        code: 'unavailable',
        detailsAbsent: true,
        message: 'Registration data could not be loaded.',
      },
      queries: [{
        field: 'uid',
        operator: '==',
        value: CONTEXT.auth.uid,
      }],
      queryStages: ['firestore', 'collectionGroup', 'where', 'get'],
      rawFailureEscaped: false,
      registrationDataCalls: 2,
    });
    expect(requireAppCheck).toHaveBeenCalledWith(CONTEXT);
    expect(admin.firestore).toHaveBeenCalledTimes(1);
  });
});

describe('DATA-001A8 registration event snapshot/projection failure boundary', () => {
  beforeEach(() => {
    admin.__reset();
    admin.firestore.mockClear();
    firebaseFunctions.__resetLoggerCalls();
    requireAppCheck.mockReset();
  });

  test.each([
    ['exists', ['exists:synthetic-event'], []],
    ['data', [
      'exists:synthetic-event',
      'data:synthetic-event',
    ], []],
    ['slug', [
      'exists:synthetic-event',
      'data:synthetic-event',
    ], ['slug']],
    ['title', [
      'exists:synthetic-event',
      'data:synthetic-event',
    ], ['slug', 'title']],
    ['startAt', [
      'exists:synthetic-event',
      'data:synthetic-event',
    ], ['slug', 'title', 'startAt']],
    ['location', [
      'exists:synthetic-event',
      'data:synthetic-event',
    ], ['slug', 'title', 'startAt', 'location']],
  ])('maps a hostile event %s failure to one fixed result', async (
    stage,
    expectedSnapshotStages,
    expectedProjectionStages,
  ) => {
    let hostileReads = 0;
    const hostileFailureTarget = Object.create(null);
    Object.defineProperty(hostileFailureTarget, inspect.custom, {
      value: () => {
        hostileReads += 1;
        throw new Error('hostile event snapshot formatter was inspected');
      },
    });
    const hostileFailure = new Proxy(hostileFailureTarget, {
      get() {
        hostileReads += 1;
        throw new Error('hostile event snapshot getter was inspected');
      },
      getOwnPropertyDescriptor() {
        hostileReads += 1;
        throw new Error('hostile event snapshot descriptor was inspected');
      },
      ownKeys() {
        hostileReads += 1;
        throw new Error('hostile event snapshot keys were inspected');
      },
    });
    const projectionValues = {
      slug: 'synthetic-event',
      title: 'Synthetic Projection Event',
      startAt: { _seconds: 1_900_000_000 },
      location: 'Synthetic Projection Park',
    };
    const projectionStages = [];
    const event = Object.create(null);
    Object.keys(projectionValues).forEach((field) => {
      Object.defineProperty(event, field, {
        enumerable: true,
        get() {
          projectionStages.push(field);
          if (stage === field) throw hostileFailure;
          return projectionValues[field];
        },
      });
    });
    const documents = [
      registrationDocument({
        createdSeconds: 1_800_000_020,
        id: 'synthetic-registration-newer',
      }),
      registrationDocument({
        createdSeconds: 1_800_000_010,
        id: 'synthetic-registration-older',
      }),
    ];
    let sortReads = 0;
    documents.forEach((document) => {
      const createdAt = document.data().createdAt;
      document.data.mockClear();
      Object.defineProperty(createdAt, '_seconds', {
        get() {
          sortReads += 1;
          throw new Error('registration sort started after event failure');
        },
      });
    });
    admin.__seedRegistrations(documents);
    admin.__seedEvent('synthetic-event', event);
    if (stage === 'exists' || stage === 'data') {
      admin.__failEventSnapshotAt(stage, hostileFailure);
    }
    const logSpies = ['debug', 'error', 'info', 'log', 'warn'].map((method) => (
      jest.spyOn(console, method).mockImplementation(() => {})
    ));

    let caught;
    let logCalls;
    try {
      try {
        await listMyRegistrations({}, CONTEXT);
      } catch (error) {
        caught = error;
      }
    } finally {
      logCalls = logSpies.map((spy) => spy.mock.calls.length);
      logSpies.forEach((spy) => spy.mockRestore());
    }
    const rawFailureEscaped = caught === hostileFailure;
    const publicFailure = rawFailureEscaped ? null : {
      causeAbsent: caught?.cause === undefined,
      code: caught?.code,
      detailsAbsent: caught?.details === undefined,
      message: caught?.message,
    };

    expect({
      eventCollectionCalls: admin.__eventCollectionCalls(),
      eventLookupStages: admin.__eventLookupStages(),
      eventReads: admin.__eventReads(),
      eventSnapshotStages: admin.__eventSnapshotStages(),
      functionLoggerCalls: firebaseFunctions.__loggerCalls(),
      hostileReads,
      logCalls,
      projectionStages,
      publicFailure,
      queries: admin.__queries(),
      queryStages: admin.__registrationQueryStages(),
      rawFailureEscaped,
      registrationDataCalls: documents.map(
        (document) => document.data.mock.calls.length,
      ),
      sortReads,
    }).toEqual({
      eventCollectionCalls: 1,
      eventLookupStages: [
        'collection',
        'doc:synthetic-event',
        'get:synthetic-event',
      ],
      eventReads: ['synthetic-event'],
      eventSnapshotStages: expectedSnapshotStages,
      functionLoggerCalls: 0,
      hostileReads: 0,
      logCalls: [0, 0, 0, 0, 0],
      projectionStages: expectedProjectionStages,
      publicFailure: {
        causeAbsent: true,
        code: 'unavailable',
        detailsAbsent: true,
        message: 'Registration data could not be loaded.',
      },
      queries: [{
        field: 'uid',
        operator: '==',
        value: CONTEXT.auth.uid,
      }],
      queryStages: ['firestore', 'collectionGroup', 'where', 'get'],
      rawFailureEscaped: false,
      registrationDataCalls: [2, 2],
      sortReads: 0,
    });
    expect(requireAppCheck).toHaveBeenCalledWith(CONTEXT);
    expect(admin.firestore).toHaveBeenCalledTimes(1);
  });

  test('preserves distinct event slugs and the exact empty-slug fallback', async () => {
    admin.__seedRegistrations([
      registrationDocument({
        createdSeconds: 1_800_000_020,
        eventId: 'event-with-custom-slug',
        id: 'registration-with-custom-slug',
      }),
      registrationDocument({
        createdSeconds: 1_800_000_010,
        eventId: 'event-with-empty-slug',
        id: 'registration-with-empty-slug',
      }),
    ]);
    admin.__seedEvent('event-with-custom-slug', {
      location: 'Synthetic Custom Park',
      slug: 'distinct-route-slug',
      startAt: { _seconds: 1_900_000_020 },
      title: 'Synthetic Custom Slug Event',
    });
    admin.__seedEvent('event-with-empty-slug', {
      location: 'Synthetic Fallback Park',
      slug: '',
      startAt: { _seconds: 1_900_000_010 },
      title: 'Synthetic Empty Slug Event',
    });

    await expect(listMyRegistrations({}, CONTEXT)).resolves.toEqual({
      events: {
        'event-with-custom-slug': {
          id: 'event-with-custom-slug',
          location: 'Synthetic Custom Park',
          slug: 'distinct-route-slug',
          startAt: { _seconds: 1_900_000_020 },
          title: 'Synthetic Custom Slug Event',
        },
        'event-with-empty-slug': {
          id: 'event-with-empty-slug',
          location: 'Synthetic Fallback Park',
          slug: 'event-with-empty-slug',
          startAt: { _seconds: 1_900_000_010 },
          title: 'Synthetic Empty Slug Event',
        },
      },
      registrations: [
        expect.objectContaining({
          eventId: 'event-with-custom-slug',
          id: 'registration-with-custom-slug',
        }),
        expect.objectContaining({
          eventId: 'event-with-empty-slug',
          id: 'registration-with-empty-slug',
        }),
      ],
    });
    expect(admin.__eventReads().sort()).toEqual([
      'event-with-custom-slug',
      'event-with-empty-slug',
    ]);
  });

  test('keeps a missing event snapshot as the exact successful empty summary', async () => {
    admin.__seedRegistrations([registrationDocument()]);

    await expect(listMyRegistrations({}, CONTEXT)).resolves.toEqual({
      events: {},
      registrations: [{
        amountCents: 2500,
        cancelledAt: null,
        createdAt: { _seconds: 1_800_000_000 },
        currency: 'usd',
        eventId: 'synthetic-event',
        id: 'synthetic-registration',
        paidAt: { _seconds: 1_800_000_010 },
        priceTier: 'nonMember',
        refundedAt: null,
        status: 'paid',
      }],
    });
    expect(admin.__eventLookupStages()).toEqual([
      'collection',
      'doc:synthetic-event',
      'get:synthetic-event',
    ]);
    expect(admin.__eventReads()).toEqual(['synthetic-event']);
    expect(admin.__eventSnapshotStages()).toEqual(['exists:synthetic-event']);
  });
});
