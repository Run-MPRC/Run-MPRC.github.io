import { httpsCallable } from 'firebase/functions';
import {
 parseRaceCommand, parseRaceResult, parseRaceStatus, readFictionalStatus, sendFictionalCommand
} from './fictionalRaceService';
import {
 command, result, state, uid, entryId
} from './testSupport/fictionalRaceFixtures';

let mockCommunityEnabled = true;
jest.mock('./communityService', () => ({
  get COMMUNITY_ENABLED() { return mockCommunityEnabled; }
}));
jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn()
}));
const callable = httpsCallable as jest.Mock;
let rpc: jest.Mock;
let app: any;
let auth: any;
let functions: any;
beforeEach(() => {
  jest.clearAllMocks();
  mockCommunityEnabled = true;
  app = {
    options: {
      projectId: 'run-mprc-staging'
    }
  };
  auth = {
    app,
    tenantId: null,
    currentUser: {
      uid,
      emailVerified: true
    }
  };
  functions = {
    app
  };
  rpc = jest.fn(async () => ({
    data: state()
  }));
  callable.mockReturnValue(rpc);
});
test.each(['none', 'confirmed', 'offered', 'cancelled', 'incoming', 'transferred'] as const)('valid minimal projection %s is copied, frozen and private', (kind) => {
  const raw = state(kind);
  const parsed = parseRaceStatus(raw, kind === 'incoming' ? entryId : null);
  expect(parsed).toEqual(raw);
  expect(parsed).not.toBe(raw);
  expect(parsed.events).not.toBe(raw.events);
  expect(Object.isFrozen(parsed.events)).toBe(true);
  expect(Object.isFrozen(parsed.events[0])).toBe(true);
});
test.each([{
  schemaVersion: 2
}, {
  simulationOnly: false
}, {
  policyVersion: 'paid'
}, {
  observedAtMs: '1800000000000'
}, {
  accessExpiresAtMs: 1800000000000
}, {
  incoming: {}
}, {
  events: null
}, {
  uid: 'other'
}, {
  totals: []
}])('malformed top-level response fails fixed %#', (extra) => {
  expect(() => parseRaceStatus({
    ...state(),
    ...extra
  }, null)).toThrow('Fictional race status is unavailable.');
});
test.each([{
  eventId: 'real-race'
}, {
  revision: 0
}, {
  currency: 'EUR'
}, {
  fictionalAmountCents: 1.5
}, {
  fictionalAmountCents: 10001
}, {
  canJoin: 'true'
}, {
  signupStatus: 'maybe'
}, {
  signupStatus: 'ended'
}, {
  waiverVersion: 'actual-waiver'
}, {
  closesAtMs: 1800000030000
}, {
  joinEntryId: null
}, {
  confirmedCount: 1
}, {
  enrollment: {
    status: 'confirmed',
    revision: 1
  }
}])('bad event projection fails closed %#', (extra) => {
  const raw = state();
  raw.events[0] = {
    ...raw.events[0],
    ...extra
  } as any;
  expect(() => parseRaceStatus(raw, null)).toThrow('Fictional race status is unavailable.');
});
test.each([{
  fictionalReturnedCents: 1000
}, {
  canCancel: false
}, {
  transferCount: '0'
}, {
  isOriginalCreditOwner: false
}, {
  runnerUid: 'other'
}, {
  offerExpiresAtMs: 1800000030000
}])('impossible entry or private field rejects %#', (extra) => {
  const raw = state('confirmed');
  raw.events[0].entry = {
    ...raw.events[0].entry,
    ...extra
  } as any;
  expect(() => parseRaceStatus(raw, null)).toThrow();
});
test('exact requested incoming ID/event/revision/recipient state required, not any offer', () => {
  const raw = state('incoming');
  expect(() => parseRaceStatus(raw, 'stage_race_other')).toThrow();
  expect(() => parseRaceStatus(raw, null)).toThrow();
  [{
    eventRevision: 3
  }, {
    canAccept: false
  }, {
    isCurrentRunner: true
  }, {
    offerExpiresAtMs: raw.observedAtMs
  }, {
    eventId: 'stage_race_other'
  }].forEach((extra) => {
    expect(() => parseRaceStatus({
      ...raw,
      incoming: {
        ...raw.incoming,
        ...extra
      }
    }, entryId)).toThrow();
  });
});
test('twenty unique events only; sparse/extra/accessor arrays reject without reading getters', () => {
  const raw = state();
  raw.events = Array.from({
    length: 20
  }, (_, n) => ({
    ...state().events[0],
    eventId: `stage_race_${n}`
  }));
  expect(parseRaceStatus(raw, null).events).toHaveLength(20);
  expect(() => parseRaceStatus({
    ...raw,
    events: [...raw.events, state().events[0]]
  }, null)).toThrow();
  expect(() => parseRaceStatus({
    ...raw,
    events: [raw.events[0], raw.events[0]]
  }, null)).toThrow();
  const getter = jest.fn();
  const hostile = [state().events[0]];
  Object.defineProperty(hostile, '0', {
    enumerable: true,
    get: getter
  });
  expect(() => parseRaceStatus({
    ...state(),
    events: hostile
  }, null)).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(() => parseRaceStatus({
    ...state(),
    events: new Array(1)
  }, null)).toThrow();
});
test('getters/coercion hooks/prototypes never become display or request authority', () => {
  const getter = jest.fn();
  const raw = state();
  Object.defineProperty(raw, 'policyVersion', {
    get: getter,
    enumerable: true
  });
  expect(() => parseRaceStatus(raw, null)).toThrow();
  const req = command();
  Object.defineProperty(req, 'action', {
    get: getter,
    enumerable: true
  });
  expect(() => parseRaceCommand(req)).toThrow();
  const coercion = {
    toString: getter
  };
  const event = {
    ...state().events[0],
    signupStatus: coercion
  };
  expect(() => parseRaceStatus({
    ...state(),
    events: [event]
  }, null)).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(() => parseRaceStatus(Object.assign(Object.create({
    private: true
  }), state()), null)).toThrow();
});
test.each(['race_join', 'race_cancel', 'race_offer', 'race_accept', 'race_revoke'] as const)('exact request/ack contract %s', (action) => {
  const req = command(action);
  expect(parseRaceCommand(req)).toEqual(req);
  expect(parseRaceResult(result(req), req)).toEqual(result(req));
  [{
    action: 'paid'
  }, {
    entryId: 'stage_race_other'
  }, {
    entryRevision: 99
  }, {
    eventRevision: 99
  }, {
    paid: true
  }].forEach((extra) => {
    expect(() => parseRaceResult({
      ...result(req),
      ...extra
    }, req)).toThrow();
  });
});
test.each(['amountCents', 'expiresAtMs', 'role', 'uid', 'currency', 'email_verified'])('client authority field %s denies before SDK', async (key) => {
  await expect(sendFictionalCommand(functions, auth, {
    ...command(),
    [key]: 'forged'
  } as any)).rejects.toThrow();
  expect(callable).not.toHaveBeenCalled();
});
test('verified current app/account only, without token/profile/roster extraction', async () => {
  expect(await readFictionalStatus(functions, auth, uid)).toEqual(state());
  expect(callable).toHaveBeenCalledWith(functions, 'communityActions');
  expect(rpc).toHaveBeenCalledWith({
    action: 'race_status',
    accountUid: uid,
    incomingEntryId: null
  });
  rpc.mockResolvedValueOnce({
    data: result(command())
  });
  expect(await sendFictionalCommand(functions, auth, command())).toEqual(result(command()));
});
test.each(['production', 'other-app', 'signed-out', 'unverified', 'wrong-uid', 'tenant', 'feature-off'])('disabled context %s never calls native RPC', async (kind) => {
  if (kind === 'production') app.options.projectId = 'production';
  if (kind === 'other-app') { auth.app = {
    ...app
  }; }
  if (kind === 'signed-out') auth.currentUser = null;
  if (kind === 'unverified') auth.currentUser.emailVerified = false;
  if (kind === 'wrong-uid') auth.currentUser.uid = 'stage_race_other';
  if (kind === 'tenant') auth.tenantId = 'other-tenant';
  if (kind === 'feature-off') mockCommunityEnabled = false;
  await expect(readFictionalStatus(functions, auth, uid)).rejects.toThrow();
  expect(callable).not.toHaveBeenCalled();
});
test('late response after same-UID renewed SDK session or app switch is refused', async () => {
  let resolve!: (value: unknown) => void;
  rpc.mockReturnValue(new Promise((value) => {
    resolve = value;
  }));
  const original = auth.currentUser;
  const first = readFictionalStatus(functions, auth, uid);
  auth.currentUser = {
    ...original
  };
  resolve({
    data: state()
  });
  await expect(first).rejects.toThrow();
  auth.currentUser = original;
  rpc.mockImplementation(async () => {
    functions.app = {
      ...app
    };
    return {
      data: state()
    };
  });
  await expect(readFictionalStatus(functions, auth, uid)).rejects.toThrow();
});
test('transport/provider error stays fixed with no raw response/body/token logging', async () => {
  rpc.mockRejectedValue(Error('private provider response'));
  await expect(readFictionalStatus(functions, auth, uid)).rejects.toThrow('Fictional race status is unavailable.');
});
test('expired incoming offer denies while owner can still withdraw the projected offer', () => {
  const offered = state('offered');
  offered.observedAtMs += 6000;
  expect(parseRaceStatus(offered, null).events[0].entry!.canRevoke).toBe(true);
  const incoming = state('incoming');
  incoming.observedAtMs += 6000;
  expect(() => parseRaceStatus(incoming, entryId)).toThrow('Fictional race status is unavailable.');
});
