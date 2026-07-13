const fs = require('node:fs');
const path = require('node:path');
const { inspect } = require('node:util');

const {
  commandIdentityVersion,
  INTERNAL_SYSTEM_PRINCIPAL,
  COMMAND_IDENTITY_LIMITS,
  CommandIdentityError,
  createCommandKey,
  createPayloadFingerprint,
  createStripeIdempotencyKey,
} = require('./commerceCommandIdentity');

const COMMAND_ID = '018f1f6a-9d2b-4c3d-8e5f-0123456789ab';
const OTHER_COMMAND_ID = '123e4567-e89b-42d3-a456-426614174000';
const RAW_CALLER = 'private-runner@example.test';
const HOSTILE_CANARY = 'private-runner@example.test/token?secret=do-not-copy';
const GOLDEN_COMMAND_HASH = 'c00de203eff15a20861ca8503464f2f89cccc7f4a0649171f1eef3435ba057eb';
const GOLDEN_PAYLOAD_HASH = 'b7876f30027ff2f25d4387eb276c7387bf7f784f0d1e7dcbab5906e8519f2650';
const GOLDEN_STRIPE_KEY = 'mprc_ci_v1_test_4dd719b9bbb0f0f7a00a1bc08ff00cc1a92be1acb1f92e1151a3ce8ba3a85eff';

function frozenRecord(entries = []) {
  const value = Object.create(null);
  for (const [key, child] of entries) value[key] = child;
  return Object.freeze(value);
}

function commandArgs(overrides = {}) {
  return {
    environment: 'test',
    callerScope: { kind: 'firebase_uid', value: 'uid_abc123' },
    commandId: COMMAND_ID,
    ...overrides,
  };
}

function stripeArgs(commandKeyHash, overrides = {}) {
  return {
    stripeMode: 'test',
    environment: 'test',
    providerOperation: 'checkout.session.create',
    commandKeyHash,
    providerAttempt: 1,
    ...overrides,
  };
}

function goldenPayload() {
  return frozenRecord([
    ['amountCents', 2500],
    ['currency', 'usd'],
    ['target', frozenRecord([['eventId', 'race_2026']])],
    ['lines', Object.freeze([
      frozenRecord([
        ['sku', 'shirt_s'],
        ['quantity', 1],
      ]),
    ])],
  ]);
}

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected callback to throw');
}

function expectSafeError(callback, reason, rawValue = HOSTILE_CANARY) {
  const error = captureError(callback);
  expect(error).toBeInstanceOf(CommandIdentityError);
  expect(error).toMatchObject({
    name: 'CommandIdentityError',
    code: 'invalid_command_identity',
    reason,
  });
  expect(Object.isFrozen(error)).toBe(true);
  const serialized = [
    error.message,
    error.stack,
    String(error),
    JSON.stringify(error),
    inspect(error),
  ].join('\n');
  if (rawValue) expect(serialized).not.toContain(rawValue);
  expect(serialized).not.toContain(HOSTILE_CANARY);
  return error;
}

describe('versioned command identity wire contract', () => {
  test('exports a closed frozen API and fixed bounds', () => {
    const api = require('./commerceCommandIdentity');
    expect(commandIdentityVersion).toBe(1);
    expect(INTERNAL_SYSTEM_PRINCIPAL).toBe('mprc_internal_system');
    expect(COMMAND_IDENTITY_LIMITS.maximumProviderAttempt).toBe(1000000);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(COMMAND_IDENTITY_LIMITS)).toBe(true);
    expect(Object.isFrozen(CommandIdentityError)).toBe(true);
    expect(Object.isFrozen(CommandIdentityError.prototype)).toBe(true);
  });

  test('matches hard-coded golden command, payload, and Stripe outputs', () => {
    const command = createCommandKey(commandArgs());
    const fingerprint = createPayloadFingerprint({
      commandType: 'race.checkout.create',
      payload: goldenPayload(),
    });
    const stripe = createStripeIdempotencyKey(stripeArgs(command.commandKeyHash));

    expect(command).toEqual({ version: 1, commandKeyHash: GOLDEN_COMMAND_HASH });
    expect(fingerprint).toEqual({ version: 1, payloadFingerprint: GOLDEN_PAYLOAD_HASH });
    expect(stripe).toEqual({ version: 1, stripeIdempotencyKey: GOLDEN_STRIPE_KEY });
    for (const result of [command, fingerprint, stripe]) expect(Object.isFrozen(result)).toBe(true);
  });

  test('is stable and separates every command-key dimension', () => {
    const baseline = createCommandKey(commandArgs()).commandKeyHash;
    expect(createCommandKey(commandArgs()).commandKeyHash).toBe(baseline);
    expect(new Set([
      baseline,
      createCommandKey(commandArgs({ environment: 'local' })).commandKeyHash,
      createCommandKey(commandArgs({
        callerScope: { kind: 'anonymous_principal', value: 'uid_abc123' },
      })).commandKeyHash,
      createCommandKey(commandArgs({
        callerScope: { kind: 'firebase_uid', value: 'uid_xyz789' },
      })).commandKeyHash,
      createCommandKey(commandArgs({ commandId: OTHER_COMMAND_ID })).commandKeyHash,
    ])).toHaveProperty('size', 5);
  });

  test('length frames and field tags distinguish swapped and concatenation-like tuples', () => {
    const first = createCommandKey(commandArgs({
      environment: 'test',
      callerScope: { kind: 'firebase_uid', value: 'production' },
    })).commandKeyHash;
    const swapped = createCommandKey(commandArgs({
      environment: 'production',
      callerScope: { kind: 'firebase_uid', value: 'test' },
    })).commandKeyHash;
    const shortLeft = createCommandKey(commandArgs({
      callerScope: { kind: 'firebase_uid', value: 'a:bc' },
    })).commandKeyHash;
    const shortRight = createCommandKey(commandArgs({
      callerScope: { kind: 'firebase_uid', value: 'ab:c' },
    })).commandKeyHash;
    expect(new Set([first, swapped, shortLeft, shortRight]).size).toBe(4);
  });
});

describe('canonical UUID and trusted caller scope', () => {
  test.each([
    undefined,
    null,
    '',
    ` ${COMMAND_ID}`,
    `${COMMAND_ID} `,
    COMMAND_ID.toUpperCase(),
    `{${COMMAND_ID}}`,
    `urn:uuid:${COMMAND_ID}`,
    `${COMMAND_ID}\u0000`,
    '00000000-0000-0000-0000-000000000000',
    '018f1f6a-9d2b-3c3d-8e5f-0123456789ab',
    '018f1f6a-9d2b-4c3d-0e5f-0123456789ab',
    '018f1f6a-9d2b-4c3d-1e5f-0123456789ab',
    '018f1f6a-9d2b-4c3d-fe5f-0123456789ab',
    '018f1f6a-9d2b-4c3d-7e5f-0123456789ab',
    '018f1f6a-9d2b-4c3d-ce5f-0123456789ab',
    '018f1f6a‐9d2b-4c3d-8e5f-0123456789ab',
    '０18f1f6a-9d2b-4c3d-8e5f-0123456789ab',
    123,
  ])('rejects noncanonical UUID case %# without reflecting it', (commandId) => {
    expectSafeError(
      () => createCommandKey(commandArgs({ commandId })),
      'invalid_command_id',
      typeof commandId === 'string' ? commandId : HOSTILE_CANARY,
    );
  });

  test.each(['local', 'test', 'staging', 'production'])('accepts exact environment %s', (environment) => {
    expect(createCommandKey(commandArgs({ environment })).commandKeyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test.each(['dev', 'prod', 'TEST', '', null, HOSTILE_CANARY])('rejects environment case %#', (environment) => {
    expectSafeError(
      () => createCommandKey(commandArgs({ environment })),
      'invalid_environment',
      typeof environment === 'string' ? environment : HOSTILE_CANARY,
    );
  });

  test('accepts an email-looking verified Firebase UID but hashes it out of output', () => {
    const result = createCommandKey(commandArgs({
      callerScope: { kind: 'firebase_uid', value: RAW_CALLER },
    }));
    expect(JSON.stringify(result)).not.toContain(RAW_CALLER);
    expect(result.commandKeyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('accepts each closed caller kind and only the fixed internal principal', () => {
    const scopes = [
      { kind: 'firebase_uid', value: 'custom uid/with+provider@example.test' },
      { kind: 'anonymous_principal', value: 'anon_01J0MPRC:server' },
      { kind: 'internal_system', value: INTERNAL_SYSTEM_PRINCIPAL },
    ];
    for (const callerScope of scopes) {
      expect(createCommandKey(commandArgs({ callerScope })).commandKeyHash)
        .toMatch(/^[0-9a-f]{64}$/);
    }
    expectSafeError(
      () => createCommandKey(commandArgs({
        callerScope: { kind: 'internal_system', value: 'another_system' },
      })),
      'invalid_caller_scope',
      'another_system',
    );
  });

  test.each([
    { kind: 'email', value: 'uid_abc123' },
    { kind: 'phone', value: 'uid_abc123' },
    { kind: 'firebase_uid', value: '' },
    { kind: 'firebase_uid', value: 'uid\u0000canary' },
    { kind: 'firebase_uid', value: '\uD800' },
    { kind: 'anonymous_principal', value: RAW_CALLER },
    { kind: 'anonymous_principal', value: ' spaced' },
    { kind: 'browser_role', value: 'admin' },
  ])('rejects forbidden or malformed caller scope %#', (callerScope) => {
    expectSafeError(
      () => createCommandKey(commandArgs({ callerScope })),
      'invalid_caller_scope',
      callerScope.value || HOSTILE_CANARY,
    );
  });
});

describe('canonical deeply frozen payload fingerprint', () => {
  test('ignores object insertion order but preserves nested array order', () => {
    const first = frozenRecord([
      ['z', frozenRecord([['second', 2], ['first', 1]])],
      ['a', Object.freeze(['one', 'two'])],
    ]);
    const equivalent = frozenRecord([
      ['a', Object.freeze(['one', 'two'])],
      ['z', frozenRecord([['first', 1], ['second', 2]])],
    ]);
    const reordered = frozenRecord([
      ['z', frozenRecord([['second', 2], ['first', 1]])],
      ['a', Object.freeze(['two', 'one'])],
    ]);
    const one = createPayloadFingerprint({ commandType: 'race.checkout.create', payload: first });
    const two = createPayloadFingerprint({ commandType: 'race.checkout.create', payload: equivalent });
    const three = createPayloadFingerprint({ commandType: 'race.checkout.create', payload: reordered });
    expect(one.payloadFingerprint).toBe(two.payloadFingerprint);
    expect(three.payloadFingerprint).not.toBe(one.payloadFingerprint);
  });

  test('changes for command type, JSON-like type, and every value', () => {
    const inputs = [null, true, false, 0, 1, '1', Object.freeze([1]), frozenRecord([['v', 1]])]
      .map((value) => frozenRecord([['value', value]]));
    const fingerprints = inputs.map((payload) => createPayloadFingerprint({
      commandType: 'race.checkout.create',
      payload,
    }).payloadFingerprint);
    expect(new Set(fingerprints).size).toBe(inputs.length);
    const firstType = createPayloadFingerprint({
      commandType: 'race.checkout.create',
      payload: frozenRecord([['value', 1]]),
    });
    const secondType = createPayloadFingerprint({
      commandType: 'merch.checkout.create',
      payload: frozenRecord([['value', 1]]),
    });
    expect(firstType.payloadFingerprint).not.toBe(secondType.payloadFingerprint);
    expect(createCommandKey(commandArgs()).commandKeyHash)
      .toBe(createCommandKey(commandArgs()).commandKeyHash);
  });

  test('enforces the command-type grammar and bound without echoing input', () => {
    expect(createPayloadFingerprint({
      commandType: 'a'.repeat(COMMAND_IDENTITY_LIMITS.maximumCommandTypeLength),
      payload: frozenRecord(),
    }).payloadFingerprint).toMatch(/^[0-9a-f]{64}$/);
    for (const commandType of [
      '',
      'Race.Checkout',
      'race checkout',
      'race/checkout',
      'race..checkout',
      `${'a'.repeat(COMMAND_IDENTITY_LIMITS.maximumCommandTypeLength)}b`,
      HOSTILE_CANARY,
    ]) {
      expectSafeError(
        () => createPayloadFingerprint({ commandType, payload: frozenRecord() }),
        'invalid_command_type',
        commandType || HOSTILE_CANARY,
      );
    }
  });

  test('accepts safe integer boundaries and rejects all other numeric forms', () => {
    const valid = frozenRecord([
      ['minimum', Number.MIN_SAFE_INTEGER],
      ['maximum', Number.MAX_SAFE_INTEGER],
      ['zero', 0],
    ]);
    expect(createPayloadFingerprint({ commandType: 'refund.request', payload: valid })
      .payloadFingerprint).toMatch(/^[0-9a-f]{64}$/);
    for (const value of [-0, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expectSafeError(
        () => createPayloadFingerprint({
          commandType: 'refund.request',
          payload: frozenRecord([['value', value]]),
        }),
        'invalid_payload',
      );
    }
  });

  test('keeps valid Unicode exact bytes distinct and rejects malformed Unicode', () => {
    const composed = createPayloadFingerprint({
      commandType: 'race.update',
      payload: frozenRecord([['value', 'caf\u00e9']]),
    });
    const decomposed = createPayloadFingerprint({
      commandType: 'race.update',
      payload: frozenRecord([['value', 'cafe\u0301']]),
    });
    expect(composed.payloadFingerprint).not.toBe(decomposed.payloadFingerprint);
    for (const payload of ['\uD800', '\uDC00', `safe${String.fromCharCode(0xD800)}tail`]) {
      expectSafeError(
        () => createPayloadFingerprint({
          commandType: 'race.update',
          payload: frozenRecord([['value', payload]]),
        }),
        'invalid_payload',
      );
    }
  });

  test('requires null-prototype records and recursive freezing', () => {
    const mutableRoot = Object.create(null);
    mutableRoot.value = 1;
    expectSafeError(
      () => createPayloadFingerprint({ commandType: 'race.update', payload: mutableRoot }),
      'payload_not_frozen',
    );

    const mutableNested = Object.create(null);
    mutableNested.value = 1;
    const frozenRoot = frozenRecord([['nested', mutableNested]]);
    expectSafeError(
      () => createPayloadFingerprint({ commandType: 'race.update', payload: frozenRoot }),
      'payload_not_frozen',
    );

    expectSafeError(
      () => createPayloadFingerprint({
        commandType: 'race.update',
        payload: Object.freeze({ value: 1 }),
      }),
      'invalid_payload',
    );
    expectSafeError(
      () => createPayloadFingerprint({
        commandType: 'race.update',
        payload: Object.freeze(Object.create({ polluted: true })),
      }),
      'invalid_payload',
    );
  });

  test.each([null, true, 1, 'value', Object.freeze([frozenRecord([['value', 1]])])])(
    'rejects a non-record payload root: %p',
    (payload) => {
      expectSafeError(
        () => createPayloadFingerprint({ commandType: 'race.update', payload }),
        'invalid_payload',
      );
    },
  );

  test('rejects live and revoked root or nested proxies before any reflection trap', () => {
    let trapCalls = 0;
    const liveProxy = new Proxy(frozenRecord([['value', 1]]), {
      getPrototypeOf() { trapCalls += 1; throw new Error(HOSTILE_CANARY); },
      ownKeys() { trapCalls += 1; throw new Error(HOSTILE_CANARY); },
      getOwnPropertyDescriptor() { trapCalls += 1; throw new Error(HOSTILE_CANARY); },
      get() { trapCalls += 1; throw new Error(HOSTILE_CANARY); },
    });
    const revocable = Proxy.revocable(frozenRecord([['value', 1]]), {});
    revocable.revoke();

    for (const candidate of [liveProxy, revocable.proxy]) {
      for (const payload of [candidate, frozenRecord([['nested', candidate]])]) {
        expectSafeError(
          () => createPayloadFingerprint({ commandType: 'race.update', payload }),
          'invalid_payload',
        );
      }
    }
    expect(trapCalls).toBe(0);
  });

  test('rejects cycles, symbols, dangerous keys, sparse arrays, and extra array keys', () => {
    const cycle = Object.create(null);
    cycle.self = cycle;
    Object.freeze(cycle);
    expectSafeError(
      () => createPayloadFingerprint({ commandType: 'race.update', payload: cycle }),
      'invalid_payload',
    );

    const symbolRecord = Object.create(null);
    symbolRecord.safe = true;
    symbolRecord[Symbol('private')] = HOSTILE_CANARY;
    Object.freeze(symbolRecord);
    expectSafeError(
      () => createPayloadFingerprint({ commandType: 'race.update', payload: symbolRecord }),
      'invalid_payload',
    );

    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const dangerous = Object.create(null);
      Object.defineProperty(dangerous, key, {
        value: HOSTILE_CANARY,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      Object.freeze(dangerous);
      expectSafeError(
        () => createPayloadFingerprint({ commandType: 'race.update', payload: dangerous }),
        'invalid_payload',
      );
    }

    const sparse = new Array(2);
    sparse[0] = 'one';
    Object.freeze(sparse);
    const extra = ['one'];
    extra.extra = 'two';
    Object.freeze(extra);
    for (const nestedArray of [sparse, extra]) {
      expectSafeError(
        () => createPayloadFingerprint({
          commandType: 'race.update',
          payload: frozenRecord([['items', nestedArray]]),
        }),
        'invalid_payload',
      );
    }
  });

  test('allows shared frozen aliases but rejects cycles', () => {
    const shared = frozenRecord([['value', 7]]);
    const aliased = frozenRecord([['left', shared], ['right', shared]]);
    const copied = frozenRecord([
      ['left', frozenRecord([['value', 7]])],
      ['right', frozenRecord([['value', 7]])],
    ]);
    expect(createPayloadFingerprint({ commandType: 'race.update', payload: aliased }))
      .toEqual(createPayloadFingerprint({ commandType: 'race.update', payload: copied }));
  });

  test.each([
    new Date('2026-01-01T00:00:00Z'),
    new Map([['value', 1]]),
    new Set([1]),
    Buffer.from('synthetic'),
    new Uint8Array([1]),
    new (class Example { constructor() { this.value = 1; } })(),
  ])('rejects non-JSON object type case %# without inspecting contents', (nested) => {
    expectSafeError(
      () => createPayloadFingerprint({
        commandType: 'race.update',
        payload: frozenRecord([['value', nested]]),
      }),
      'invalid_payload',
    );
  });

  test('rejects Object.prototype pollution before reading inherited values', () => {
    Object.defineProperty(Object.prototype, 'temporaryCommandIdentityProbe', {
      value: HOSTILE_CANARY,
      enumerable: true,
      configurable: true,
    });
    try {
      expectSafeError(
        () => createPayloadFingerprint({
          commandType: 'race.update',
          payload: frozenRecord([['value', 1]]),
        }),
        'invalid_argument_shape',
      );
    } finally {
      delete Object.prototype.temporaryCommandIdentityProbe;
    }
  });

  test('rejects accessors and proxies without invoking hostile code', () => {
    let getterCalls = 0;
    const accessor = Object.create(null);
    Object.defineProperty(accessor, 'secret', {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error(HOSTILE_CANARY);
      },
    });
    Object.freeze(accessor);
    expectSafeError(
      () => createPayloadFingerprint({
        commandType: 'race.update',
        payload: frozenRecord([['nested', accessor]]),
      }),
      'invalid_payload',
    );
    expect(getterCalls).toBe(0);

    let trapCalls = 0;
    const proxy = new Proxy(frozenRecord([['safe', true]]), {
      getPrototypeOf() { trapCalls += 1; throw new Error(HOSTILE_CANARY); },
      ownKeys() { trapCalls += 1; throw new Error(HOSTILE_CANARY); },
      getOwnPropertyDescriptor() { trapCalls += 1; throw new Error(HOSTILE_CANARY); },
      get() { trapCalls += 1; throw new Error(HOSTILE_CANARY); },
    });
    expectSafeError(
      () => createPayloadFingerprint({
        commandType: 'race.update',
        payload: frozenRecord([['nested', proxy]]),
      }),
      'invalid_payload',
    );
    expect(trapCalls).toBe(0);
  });

  test('enforces depth, entry, key, string, and total byte limits', () => {
    let nested = 1;
    for (let index = 1; index < COMMAND_IDENTITY_LIMITS.maximumPayloadDepth; index += 1) {
      nested = Object.freeze([nested]);
    }
    const atDepth = frozenRecord([['nested', nested]]);
    expect(createPayloadFingerprint({ commandType: 'race.update', payload: atDepth })
      .payloadFingerprint).toMatch(/^[0-9a-f]{64}$/);
    const tooDeep = frozenRecord([['nested', Object.freeze([nested])]]);
    expectSafeError(
      () => createPayloadFingerprint({ commandType: 'race.update', payload: tooDeep }),
      'payload_too_deep',
    );

    const maximumEntries = frozenRecord(Array.from(
      { length: COMMAND_IDENTITY_LIMITS.maximumPayloadEntries },
      (_unused, index) => [`value${index}`, null],
    ));
    expect(createPayloadFingerprint({ commandType: 'race.update', payload: maximumEntries })
      .payloadFingerprint).toMatch(/^[0-9a-f]{64}$/);
    const tooMany = frozenRecord(Array.from(
      { length: COMMAND_IDENTITY_LIMITS.maximumPayloadEntries + 1 },
      (_unused, index) => [`value${index}`, null],
    ));
    expectSafeError(
      () => createPayloadFingerprint({ commandType: 'race.update', payload: tooMany }),
      'payload_too_many_entries',
    );

    const maximumArray = frozenRecord([['items', Object.freeze(
      Array(COMMAND_IDENTITY_LIMITS.maximumPayloadArrayLength).fill(null),
    )]]);
    expect(createPayloadFingerprint({ commandType: 'race.update', payload: maximumArray })
      .payloadFingerprint).toMatch(/^[0-9a-f]{64}$/);
    const oversizedArray = frozenRecord([['items', Object.freeze(
      Array(COMMAND_IDENTITY_LIMITS.maximumPayloadArrayLength + 1).fill(null),
    )]]);
    expectSafeError(
      () => createPayloadFingerprint({ commandType: 'race.update', payload: oversizedArray }),
      'payload_too_many_entries',
    );

    const maximumKey = 'k'.repeat(COMMAND_IDENTITY_LIMITS.maximumPayloadKeyBytes);
    expect(createPayloadFingerprint({
      commandType: 'race.update',
      payload: frozenRecord([[maximumKey, true]]),
    }).payloadFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expectSafeError(
      () => createPayloadFingerprint({
        commandType: 'race.update',
        payload: frozenRecord([[
          `${maximumKey}x`,
          true,
        ]]),
      }),
      'payload_too_large',
    );

    const maximumString = 'x'.repeat(COMMAND_IDENTITY_LIMITS.maximumPayloadStringBytes);
    expect(createPayloadFingerprint({
      commandType: 'race.update',
      payload: frozenRecord([['value', maximumString]]),
    })
      .payloadFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expectSafeError(
      () => createPayloadFingerprint({
        commandType: 'race.update',
        payload: frozenRecord([['value', `${maximumString}x`]]),
      }),
      'payload_too_large',
    );
    expectSafeError(
      () => createPayloadFingerprint({
        commandType: 'race.update',
        payload: frozenRecord([['values', Object.freeze([
          maximumString,
          maximumString,
          maximumString,
          maximumString,
        ])]]),
      }),
      'payload_too_large',
    );
  });
});

describe('deterministic Stripe idempotency key', () => {
  const commandKeyHash = GOLDEN_COMMAND_HASH;

  test('is stable, safe, short, and contains no raw command material', () => {
    const first = createStripeIdempotencyKey(stripeArgs(commandKeyHash));
    const second = createStripeIdempotencyKey(stripeArgs(commandKeyHash));
    expect(first).toEqual(second);
    expect(first.stripeIdempotencyKey).toMatch(/^[a-z0-9_]+$/);
    expect(first.stripeIdempotencyKey.length).toBeLessThan(255);
    for (const raw of [COMMAND_ID, RAW_CALLER, HOSTILE_CANARY, 'checkout.session.create']) {
      expect(first.stripeIdempotencyKey).not.toContain(raw);
    }
  });

  test('separates environment, mode, operation, command, and logical provider attempt', () => {
    const keys = [
      createStripeIdempotencyKey(stripeArgs(commandKeyHash)).stripeIdempotencyKey,
      createStripeIdempotencyKey(stripeArgs(commandKeyHash, {
        environment: 'local',
      })).stripeIdempotencyKey,
      createStripeIdempotencyKey(stripeArgs(commandKeyHash, {
        environment: 'staging',
      })).stripeIdempotencyKey,
      createStripeIdempotencyKey(stripeArgs(commandKeyHash, {
        environment: 'production',
        stripeMode: 'live',
      })).stripeIdempotencyKey,
      createStripeIdempotencyKey(stripeArgs(commandKeyHash, {
        providerOperation: 'refund.create',
      })).stripeIdempotencyKey,
      createStripeIdempotencyKey(stripeArgs('a'.repeat(64))).stripeIdempotencyKey,
      createStripeIdempotencyKey(stripeArgs(commandKeyHash, {
        providerAttempt: 2,
      })).stripeIdempotencyKey,
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  test.each([
    ['production', 'test'],
    ['local', 'live'],
    ['test', 'live'],
    ['staging', 'live'],
  ])('rejects environment/mode mismatch %s/%s', (environment, stripeMode) => {
    expectSafeError(
      () => createStripeIdempotencyKey(stripeArgs(commandKeyHash, {
        environment,
        stripeMode,
      })),
      'invalid_stripe_mode',
    );
  });

  test('accepts the fixed provider-attempt bounds and rejects invalid attempts', () => {
    for (const providerAttempt of [1, COMMAND_IDENTITY_LIMITS.maximumProviderAttempt]) {
      expect(createStripeIdempotencyKey(stripeArgs(commandKeyHash, { providerAttempt }))
        .stripeIdempotencyKey).toMatch(/^[a-z0-9_]+$/);
    }
    for (const providerAttempt of [
      0,
      -0,
      -1,
      1.5,
      NaN,
      Infinity,
      1n,
      Object(1),
      '1',
      COMMAND_IDENTITY_LIMITS.maximumProviderAttempt + 1,
    ]) {
      expectSafeError(
        () => createStripeIdempotencyKey(stripeArgs(commandKeyHash, { providerAttempt })),
        'invalid_provider_attempt',
      );
    }
  });

  test.each([
    '',
    'Checkout.Create',
    'checkout create',
    'checkout/create',
    'checkout..create',
    HOSTILE_CANARY,
  ])('rejects unsafe provider operation case %#', (providerOperation) => {
    expectSafeError(
      () => createStripeIdempotencyKey(stripeArgs(commandKeyHash, { providerOperation })),
      'invalid_provider_operation',
      providerOperation || HOSTILE_CANARY,
    );
  });

  test('accepts the maximum provider-operation length and rejects the next byte', () => {
    const maximum = 'a'.repeat(COMMAND_IDENTITY_LIMITS.maximumProviderOperationLength);
    expect(createStripeIdempotencyKey(stripeArgs(commandKeyHash, {
      providerOperation: maximum,
    })).stripeIdempotencyKey).toMatch(/^[a-z0-9_]+$/);
    expectSafeError(
      () => createStripeIdempotencyKey(stripeArgs(commandKeyHash, {
        providerOperation: `${maximum}b`,
      })),
      'invalid_provider_operation',
    );
  });

  test.each(['', 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63), HOSTILE_CANARY, null])(
    'rejects noncanonical command hash case %#',
    (commandKeyHashValue) => {
      expectSafeError(
        () => createStripeIdempotencyKey(stripeArgs(commandKeyHashValue)),
        'invalid_command_key_hash',
        typeof commandKeyHashValue === 'string' ? commandKeyHashValue : HOSTILE_CANARY,
      );
    },
  );
});

describe('fail-closed shape and side-effect boundary', () => {
  test('rejects missing, extra, accessor, symbol, custom-prototype, and proxy arguments', () => {
    expectSafeError(() => createCommandKey({}), 'invalid_argument_shape');
    expectSafeError(
      () => createCommandKey({ ...commandArgs(), extra: HOSTILE_CANARY }),
      'invalid_argument_shape',
    );

    let getterCalls = 0;
    const accessor = commandArgs();
    Object.defineProperty(accessor, 'commandId', {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error(HOSTILE_CANARY);
      },
    });
    expectSafeError(() => createCommandKey(accessor), 'invalid_argument_shape');
    expect(getterCalls).toBe(0);

    const symbolInput = commandArgs();
    symbolInput[Symbol('secret')] = HOSTILE_CANARY;
    expectSafeError(() => createCommandKey(symbolInput), 'invalid_argument_shape');
    expectSafeError(
      () => createCommandKey(Object.assign(Object.create({ polluted: true }), commandArgs())),
      'invalid_argument_shape',
    );

    let trapCalls = 0;
    const proxy = new Proxy(commandArgs(), {
      ownKeys() { trapCalls += 1; throw new Error(HOSTILE_CANARY); },
      get() { trapCalls += 1; throw new Error(HOSTILE_CANARY); },
    });
    expectSafeError(() => createCommandKey(proxy), 'invalid_argument_shape');
    expect(trapCalls).toBe(0);
  });

  test('does not mutate descriptors and is repeatable without console output', () => {
    const payload = goldenPayload();
    const input = { commandType: 'race.checkout.create', payload };
    const beforeInput = Object.getOwnPropertyDescriptors(input);
    const beforePayload = Object.getOwnPropertyDescriptors(payload);
    const spies = ['log', 'info', 'warn', 'error', 'debug']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => {}));
    try {
      const results = Array.from({ length: 10 }, () => createPayloadFingerprint(input));
      expect(new Set(results.map((result) => result.payloadFingerprint)).size).toBe(1);
      expect(Object.getOwnPropertyDescriptors(input)).toEqual(beforeInput);
      expect(Object.getOwnPropertyDescriptors(payload)).toEqual(beforePayload);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  test('never serializes or inspects raw hostile values through errors', () => {
    const error = expectSafeError(
      () => createCommandKey(commandArgs({ commandId: HOSTILE_CANARY })),
      'invalid_command_id',
      HOSTILE_CANARY,
    );
    expect(Object.keys(error).sort()).toEqual(['code', 'name', 'reason']);
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      name: 'CommandIdentityError',
      code: 'invalid_command_identity',
      reason: 'invalid_command_id',
    });
  });

  test('imports only crypto/util and contains no forbidden runtime or side-effect primitive', () => {
    const source = fs.readFileSync(path.join(__dirname, 'commerceCommandIdentity.js'), 'utf8');
    const imports = [...source.matchAll(/require\((['"])([^'"]+)\1\)/g)]
      .map((match) => match[2]);
    expect(imports).toEqual(['node:crypto', 'node:util']);
    for (const pattern of [
      /require\(['"](?:firebase|stripe|fs|node:fs|http|https|net)/,
      /process\s*\./,
      /console\s*\./,
      /Math\.random/,
      /\bDate\s*\(/,
      /\bfetch\s*\(/,
      /setTimeout\s*\(/,
      /setInterval\s*\(/,
    ]) {
      expect(source).not.toMatch(pattern);
    }
  });

  test('import itself has no console output', () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => {}));
    try {
      jest.isolateModules(() => {
        const isolated = require('./commerceCommandIdentity');
        expect(isolated.commandIdentityVersion).toBe(1);
      });
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
