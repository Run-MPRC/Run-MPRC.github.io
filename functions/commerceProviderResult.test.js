'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const { inspect } = require('node:util');

const {
  providerResultPolicySchemaVersion,
  PROVIDER_RESULT_POLICY_ENUMS,
  CommerceProviderResultError,
  classifyAuthorizedStripeCheckoutResultEvidence,
} = require('./commerceProviderResult');

const HOSTILE_CANARY = 'private-runner@example.test/token?secret=do-not-copy';

function evidence(overrides = {}) {
  return {
    providerResultPolicySchemaVersion: 1,
    provider: 'stripe',
    providerAttempt: 2,
    providerOperation: 'checkout_session_create',
    planBinding: 'exact',
    sendEvidenceBinding: 'exact',
    evidenceSource: 'reported_direct_response',
    evidenceCompleteness: 'complete',
    responseEvidence: 'accepted',
    providerObjectEvidence: 'exact_open',
    environmentEvidence: 'exact',
    parameterEvidence: 'exact',
    resultReferenceEvidence: 'bounded_opaque',
    redirectEvidence: 'validated_checkout',
    paymentEvidence: 'unpaid',
    expiryEvidence: 'valid_future',
    ...overrides,
  };
}

function serializedEvidence(overrides = {}) {
  return JSON.stringify(evidence(overrides));
}

function rebrandWithEvidence(root) {
  Object.setPrototypeOf(root, Object.prototype);
  for (const [field, value] of Object.entries(evidence())) {
    Object.defineProperty(root, field, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return root;
}

function runPreloadPrototypeProbe(mutationSource) {
  const modulePath = path.join(__dirname, 'commerceProviderResult.js');
  const script = `
    'use strict';
    const mutationKeys = [
      'temporaryPreloadPollution',
      'hasOwnProperty',
      '__proto__',
      'value',
      'writable',
      'get',
      'set',
    ];
    const originals = new Map(mutationKeys.map((key) => [
      key,
      Object.getOwnPropertyDescriptor(Object.prototype, key),
    ]));
    const originalProto = originals.get('__proto__');
    let getterCalls = 0;
    let api;
    try {
      ${mutationSource}
      api = require(${JSON.stringify(modulePath)});
    } finally {
      for (const key of originals.keys()) {
        delete Object.prototype[key];
      }
      for (const [key, descriptor] of originals) {
        if (descriptor) {
          Object.defineProperty(Object.prototype, key, descriptor);
        }
      }
    }
    let error;
    try {
      api.classifyAuthorizedStripeCheckoutResultEvidence(
        ${JSON.stringify(serializedEvidence())},
      );
    } catch (caught) {
      error = caught;
    }
    if (!error
      || error.name !== 'CommerceProviderResultError'
      || error.code !== 'invalid_provider_result_evidence'
      || error.message !== 'Commerce provider result evidence is invalid.'
      || getterCalls !== 0) {
      process.exit(2);
    }
    process.stdout.write('fixed-redacted-rejection');
  `;
  return spawnSync(process.execPath, ['-e', script], {
    cwd: __dirname,
    encoding: 'utf8',
  });
}

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected callback to throw');
}

function expectSafeError(callback, rawValue = HOSTILE_CANARY) {
  const error = captureError(callback);
  expect(error).toBeInstanceOf(CommerceProviderResultError);
  expect(error).toMatchObject({
    name: 'CommerceProviderResultError',
    code: 'invalid_provider_result_evidence',
    message: 'Commerce provider result evidence is invalid.',
  });
  expect(Object.isFrozen(error)).toBe(true);

  for (const [field, expectedValue] of Object.entries({
    name: 'CommerceProviderResultError',
    code: 'invalid_provider_result_evidence',
    message: 'Commerce provider result evidence is invalid.',
  })) {
    expect(Object.getOwnPropertyDescriptor(error, field)).toEqual({
      value: expectedValue,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  const rendered = [
    error.message,
    String(error),
    JSON.stringify(error),
    inspect(error),
    error.stack,
  ].join('\n');
  if (rawValue) expect(rendered).not.toContain(String(rawValue));
  expect(rendered).not.toContain(HOSTILE_CANARY);
  return error;
}

function expectResult(input, classification, state) {
  const result = classifyAuthorizedStripeCheckoutResultEvidence(JSON.stringify(input));
  expect(result).toEqual({
    providerResultPolicySchemaVersion: 1,
    classification,
    state,
  });
  expect(Object.keys(result)).toEqual([
    'providerResultPolicySchemaVersion',
    'classification',
    'state',
  ]);
  expect(Object.isFrozen(result)).toBe(true);
  expect(JSON.stringify(result)).not.toContain(HOSTILE_CANARY);
  return result;
}

describe('unbound attempt-2 Checkout Session result evidence policy', () => {
  test('exports one frozen versioned API and exact frozen enum catalog', () => {
    const api = require('./commerceProviderResult');
    expect(providerResultPolicySchemaVersion).toBe(1);
    expect(Object.isFrozen(api)).toBe(true);
    expect(PROVIDER_RESULT_POLICY_ENUMS).toEqual({
      planBinding: ['exact', 'missing', 'conflicting'],
      sendEvidenceBinding: ['exact', 'missing', 'conflicting'],
      evidenceSource: [
        'reported_direct_response',
        'unverified_or_missing',
        'conflicting',
      ],
      evidenceCompleteness: ['complete', 'partial', 'conflicting'],
      responseEvidence: [
        'none',
        'accepted',
        'timeout',
        'connection_lost',
        'conflict',
        'external_dependency_failure',
        'rate_limited',
        'server_failure',
        'other_failure',
        'unknown',
        'conflicting',
      ],
      providerObjectEvidence: [
        'none',
        'exact_open',
        'exact_complete',
        'exact_expired',
        'exact_unknown',
        'missing_reference',
        'not_found',
        'conflicting',
      ],
      environmentEvidence: ['exact', 'missing', 'conflicting'],
      parameterEvidence: ['exact', 'missing', 'conflicting'],
      resultReferenceEvidence: ['bounded_opaque', 'missing', 'invalid', 'conflicting'],
      redirectEvidence: ['validated_checkout', 'missing', 'invalid', 'conflicting'],
      paymentEvidence: [
        'none',
        'unpaid',
        'paid',
        'no_payment_required',
        'processing',
        'unknown',
        'conflicting',
      ],
      expiryEvidence: [
        'valid_future',
        'missing',
        'invalid',
        'expired',
        'unknown',
        'conflicting',
      ],
    });
    expect(Object.isFrozen(PROVIDER_RESULT_POLICY_ENUMS)).toBe(true);
    for (const values of Object.values(PROVIDER_RESULT_POLICY_ENUMS)) {
      expect(Object.isFrozen(values)).toBe(true);
    }
    expect(Object.isFrozen(CommerceProviderResultError)).toBe(true);
    expect(Object.isFrozen(CommerceProviderResultError.prototype)).toBe(true);
  });

  test('classifies only the sole complete reported response shape as an unbound candidate', () => {
    const input = Object.freeze(evidence());
    const before = JSON.stringify(input);
    const first = expectResult(
      input,
      'unbound_result_candidate',
      'requires_dispatch_evidence_persistence_and_business_validation',
    );
    const second = classifyAuthorizedStripeCheckoutResultEvidence(serializedEvidence());
    expect(second).toBe(first);
    expect(JSON.stringify(input)).toBe(before);
  });

  test('all 46 single-enum alternates return one reconciliation singleton', () => {
    const baseline = evidence();
    const results = new Set();
    let alternates = 0;

    for (const [field, values] of Object.entries(PROVIDER_RESULT_POLICY_ENUMS)) {
      for (const value of values) {
        if (value === baseline[field]) continue;
        alternates += 1;
        results.add(expectResult(
          { ...baseline, [field]: value },
          'reconciliation_required',
          'requires_reconciliation',
        ));
      }
    }

    expect(alternates).toBe(46);
    expect(results.size).toBe(1);
  });

  test('explicit failure, ambiguity, and non-open provider states always reconcile', () => {
    const unsafe = [
      { planBinding: 'missing' },
      { sendEvidenceBinding: 'conflicting' },
      { evidenceSource: 'unverified_or_missing' },
      { evidenceCompleteness: 'partial' },
      { responseEvidence: 'timeout' },
      { responseEvidence: 'connection_lost' },
      { responseEvidence: 'conflict' },
      { responseEvidence: 'external_dependency_failure' },
      { responseEvidence: 'rate_limited' },
      { responseEvidence: 'server_failure' },
      { responseEvidence: 'other_failure' },
      { responseEvidence: 'unknown' },
      { providerObjectEvidence: 'exact_complete' },
      { providerObjectEvidence: 'exact_expired' },
      { providerObjectEvidence: 'exact_unknown' },
      { providerObjectEvidence: 'missing_reference' },
      { providerObjectEvidence: 'not_found' },
      { environmentEvidence: 'missing' },
      { environmentEvidence: 'conflicting' },
      { parameterEvidence: 'missing' },
      { parameterEvidence: 'conflicting' },
      { resultReferenceEvidence: 'invalid' },
      { redirectEvidence: 'invalid' },
      { paymentEvidence: 'paid' },
      { paymentEvidence: 'no_payment_required' },
      { paymentEvidence: 'processing' },
      { expiryEvidence: 'missing' },
      { expiryEvidence: 'invalid' },
      { expiryEvidence: 'expired' },
      { expiryEvidence: 'unknown' },
    ];

    const results = unsafe.map((override) => expectResult(
      evidence(override),
      'reconciliation_required',
      'requires_reconciliation',
    ));
    expect(new Set(results).size).toBe(1);
  });

  test('a classification exposes no authorization, replay, or business control', () => {
    const results = [
      classifyAuthorizedStripeCheckoutResultEvidence(serializedEvidence()),
      classifyAuthorizedStripeCheckoutResultEvidence(serializedEvidence({
        responseEvidence: 'timeout',
      })),
    ];
    for (const result of results) {
      for (const forbidden of [
        'send',
        'dispatch',
        'execute',
        'persist',
        'success',
        'providerAttempt',
        'sessionId',
        'url',
        'amount',
        'key',
        'commitment',
        'response',
        'businessTransition',
      ]) {
        expect(result).not.toHaveProperty(forbidden);
      }
    }
  });
});

describe('hostile and malformed result evidence fails with one fixed error', () => {
  test.each([
    undefined,
    null,
    true,
    1,
    'stripe',
    [],
    new Date(0),
    new Number(1),
    new String('stripe'),
    new Boolean(false),
  ])('rejects a non-plain root case %#', (input) => {
    expectSafeError(() => classifyAuthorizedStripeCheckoutResultEvidence(input));
  });

  test.each([
    ['Date', () => new Date(0)],
    ['boxed Number', () => new Number(1)],
    ['boxed Boolean', () => new Boolean(false)],
    ['boxed BigInt', () => Object(1n)],
    ['boxed Symbol', () => Object(Symbol('provider-result'))],
    ['Map', () => new Map()],
    ['Set', () => new Set()],
    ['WeakMap', () => new WeakMap()],
    ['WeakSet', () => new WeakSet()],
    ['Promise', () => Promise.resolve()],
    ['URL', () => new URL('https://example.test/provider-result')],
    ['URLSearchParams', () => new URLSearchParams('state=unbound')],
    ['Headers', () => new Headers()],
    ['AbortController', () => new AbortController()],
    ['WebAssembly.Module', () => new WebAssembly.Module(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
    )],
    ['WebAssembly.Memory', () => new WebAssembly.Memory({ initial: 1 })],
    ['Intl.DateTimeFormat', () => new Intl.DateTimeFormat('en')],
    ['Intl.NumberFormat', () => new Intl.NumberFormat('en')],
    ['private-slot class instance', () => vm.runInNewContext(
      'new (class PrivateEvidence { #privateState = 1 })()',
    )],
  ])('rejects a re-branded %s with the exact 16 own data fields', (_name, makeRoot) => {
    const input = rebrandWithEvidence(makeRoot());
    expect(Object.getPrototypeOf(input)).toBe(Object.prototype);
    expect(Reflect.ownKeys(input)).toEqual(Object.keys(evidence()));
    expectSafeError(() => classifyAuthorizedStripeCheckoutResultEvidence(input));
  });

  test('requires one bounded canonical JSON encoding', () => {
    const canonical = serializedEvidence();
    const missing = evidence();
    delete missing.provider;
    const { provider, ...rest } = evidence();
    const reordered = JSON.stringify({ provider, ...rest });
    const malformed = [
      '',
      ' ',
      '{',
      'null',
      'true',
      '1',
      '[]',
      '{}',
      JSON.stringify(evidence(), null, 2),
      reordered,
      JSON.stringify(missing),
      `${canonical.slice(0, -1)},"extra":"${HOSTILE_CANARY}"}`,
      canonical.replace(
        '"provider":"stripe"',
        '"provider":"stripe","provider":"stripe"',
      ),
      canonical.replace('"stripe"', '"\\u0073tripe"'),
      canonical.replace(':1,', ':1.0,'),
      'x'.repeat(1025),
    ];

    expect(new Set(malformed).size).toBe(malformed.length);
    for (const input of malformed) {
      expectSafeError(() => classifyAuthorizedStripeCheckoutResultEvidence(input));
    }
  });

  test('rejects every serialized missing field and every extra string field', () => {
    for (const field of Object.keys(evidence())) {
      const input = evidence();
      delete input[field];
      expectSafeError(
        () => classifyAuthorizedStripeCheckoutResultEvidence(JSON.stringify(input)),
      );
    }

    expectSafeError(() => classifyAuthorizedStripeCheckoutResultEvidence({
      ...evidence(),
      [HOSTILE_CANARY]: 'extra',
    }));
    expectSafeError(() => classifyAuthorizedStripeCheckoutResultEvidence(JSON.stringify({
      ...evidence(),
      [HOSTILE_CANARY]: 'extra',
    })));

    for (const field of ['__proto__', 'constructor', 'prototype']) {
      const input = evidence();
      Object.defineProperty(input, field, {
        value: HOSTILE_CANARY,
        enumerable: true,
        configurable: true,
      });
      expectSafeError(
        () => classifyAuthorizedStripeCheckoutResultEvidence(JSON.stringify(input)),
      );
    }
  });

  test('rejects inherited, custom, null, and polluted prototypes', () => {
    const inherited = Object.create(evidence());
    expectSafeError(() => classifyAuthorizedStripeCheckoutResultEvidence(inherited));

    const custom = Object.assign(Object.create({ inherited: HOSTILE_CANARY }), evidence());
    expectSafeError(() => classifyAuthorizedStripeCheckoutResultEvidence(custom));

    const nullPrototype = Object.assign(Object.create(null), evidence());
    expectSafeError(() => classifyAuthorizedStripeCheckoutResultEvidence(nullPrototype));

    Object.defineProperty(Object.prototype, 'temporaryProviderResultPollution', {
      value: HOSTILE_CANARY,
      enumerable: true,
      configurable: true,
    });
    try {
      expectSafeError(() => classifyAuthorizedStripeCheckoutResultEvidence(
        serializedEvidence(),
      ));
    } finally {
      delete Object.prototype.temporaryProviderResultPollution;
    }
  });

  test('rejects shadowed enumerable and added non-enumerable Object.prototype fields', () => {
    const input = serializedEvidence();
    let shadowedError;
    Object.defineProperty(Object.prototype, 'provider', {
      value: HOSTILE_CANARY,
      enumerable: true,
      configurable: true,
    });
    try {
      shadowedError = captureError(
        () => classifyAuthorizedStripeCheckoutResultEvidence(input),
      );
    } finally {
      delete Object.prototype.provider;
    }
    expectSafeError(() => { throw shadowedError; });

    let nonEnumerableError;
    Object.defineProperty(Object.prototype, 'temporaryHiddenProviderResultPollution', {
      value: HOSTILE_CANARY,
      enumerable: false,
      configurable: true,
    });
    try {
      nonEnumerableError = captureError(
        () => classifyAuthorizedStripeCheckoutResultEvidence(input),
      );
    } finally {
      delete Object.prototype.temporaryHiddenProviderResultPollution;
    }
    expectSafeError(() => { throw nonEnumerableError; });
  });

  test('rejects changed Object.prototype.hasOwnProperty without using it', () => {
    const original = Object.getOwnPropertyDescriptor(Object.prototype, 'hasOwnProperty');
    const input = serializedEvidence();

    let replacedError;
    Object.defineProperty(Object.prototype, 'hasOwnProperty', {
      value: null,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    try {
      replacedError = captureError(
        () => classifyAuthorizedStripeCheckoutResultEvidence(input),
      );
    } finally {
      Object.defineProperty(Object.prototype, 'hasOwnProperty', original);
    }
    expectSafeError(() => { throw replacedError; });

    let getterCalls = 0;
    let accessorError;
    Object.defineProperty(Object.prototype, 'hasOwnProperty', {
      enumerable: false,
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error(HOSTILE_CANARY);
      },
    });
    try {
      accessorError = captureError(
        () => classifyAuthorizedStripeCheckoutResultEvidence(input),
      );
    } finally {
      Object.defineProperty(Object.prototype, 'hasOwnProperty', original);
    }
    expect(getterCalls).toBe(0);
    expectSafeError(() => { throw accessorError; });
  });

  test.each(['value', 'writable', 'get', 'set'])(
    'rejects post-load Object.prototype.%s accessors without invoking them',
    (field) => {
      const original = Object.getOwnPropertyDescriptor(Object.prototype, field);
      const input = serializedEvidence();
      let getterCalls = 0;
      let error;
      Object.defineProperty(Object.prototype, field, {
        enumerable: false,
        configurable: true,
        get() {
          getterCalls += 1;
          throw new Error(HOSTILE_CANARY);
        },
      });
      try {
        error = captureError(
          () => classifyAuthorizedStripeCheckoutResultEvidence(input),
        );
      } finally {
        if (original) {
          Object.defineProperty(Object.prototype, field, original);
        } else {
          delete Object.prototype[field];
        }
      }
      expect(getterCalls).toBe(0);
      expectSafeError(() => { throw error; });
    },
  );

  test('rejects Object.prototype pollution present before module load', () => {
    const probes = [
      runPreloadPrototypeProbe(`
        Object.defineProperty(Object.prototype, 'temporaryPreloadPollution', {
          value: ${JSON.stringify(HOSTILE_CANARY)},
          enumerable: false,
          configurable: true,
        });
      `),
      runPreloadPrototypeProbe(`
        Object.defineProperty(Object.prototype, 'hasOwnProperty', {
          value: null,
          enumerable: false,
          writable: true,
          configurable: true,
        });
      `),
      runPreloadPrototypeProbe(`
        Object.defineProperty(Object.prototype, 'hasOwnProperty', {
          enumerable: false,
          configurable: true,
          get() {
            getterCalls += 1;
            throw new Error(${JSON.stringify(HOSTILE_CANARY)});
          },
        });
      `),
      runPreloadPrototypeProbe(`
        const hostileGetter = new Proxy(function hostileGetter() {}, {
          get() {
            getterCalls += 1;
            throw new Error(${JSON.stringify(HOSTILE_CANARY)});
          },
        });
        Object.defineProperty(Object.prototype, '__proto__', {
          enumerable: false,
          configurable: true,
          get: hostileGetter,
          set: originalProto.set,
        });
      `),
      runPreloadPrototypeProbe(`
        Object.defineProperty(Object.prototype, 'value', {
          enumerable: false,
          configurable: true,
          get() {
            getterCalls += 1;
            throw new Error(${JSON.stringify(HOSTILE_CANARY)});
          },
        });
      `),
      runPreloadPrototypeProbe(`
        Object.defineProperty(Object.prototype, 'get', {
          enumerable: false,
          configurable: true,
          get() {
            getterCalls += 1;
            throw new Error(${JSON.stringify(HOSTILE_CANARY)});
          },
        });
      `),
      runPreloadPrototypeProbe(`
        Object.defineProperty(Object.prototype, 'writable', {
          enumerable: false,
          configurable: true,
          get() {
            getterCalls += 1;
            throw new Error(${JSON.stringify(HOSTILE_CANARY)});
          },
        });
      `),
      runPreloadPrototypeProbe(`
        Object.defineProperty(Object.prototype, 'set', {
          enumerable: false,
          configurable: true,
          get() {
            getterCalls += 1;
            throw new Error(${JSON.stringify(HOSTILE_CANARY)});
          },
        });
      `),
    ];

    for (const probe of probes) {
      expect({
        status: probe.status,
        signal: probe.signal,
        stdout: probe.stdout,
        stderr: probe.stderr,
      }).toEqual({
        status: 0,
        signal: null,
        stdout: 'fixed-redacted-rejection',
        stderr: '',
      });
    }
  });

  test('rejects accessors without invoking them', () => {
    let getterCalls = 0;
    const input = evidence();
    Object.defineProperty(input, 'provider', {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error(HOSTILE_CANARY);
      },
    });
    expectSafeError(() => classifyAuthorizedStripeCheckoutResultEvidence(input));
    expect(getterCalls).toBe(0);
  });

  test('rejects proxies before invoking any hostile trap', () => {
    let trapCalls = 0;
    const handler = new Proxy({}, {
      get() {
        return () => {
          trapCalls += 1;
          throw new Error(HOSTILE_CANARY);
        };
      },
    });
    const input = new Proxy(evidence(), handler);
    expectSafeError(() => classifyAuthorizedStripeCheckoutResultEvidence(input));
    expect(trapCalls).toBe(0);
  });

  test('rejects non-enumerable data fields without reading through them', () => {
    const input = evidence();
    Object.defineProperty(input, 'provider', {
      value: 'stripe',
      enumerable: false,
      configurable: true,
    });
    expectSafeError(() => classifyAuthorizedStripeCheckoutResultEvidence(input));
  });

  test.each([
    ['providerResultPolicySchemaVersion', 2],
    ['providerResultPolicySchemaVersion', '1'],
    ['provider', 'STRIPE'],
    ['provider', 'str\u0131pe'],
    ['providerAttempt', 1],
    ['providerAttempt', 3],
    ['providerAttempt', '2'],
    ['providerOperation', 'checkout_session_creat\u0435'],
    ['providerOperation', 'checkout_session_create '],
    ['planBinding', 1],
    ['sendEvidenceBinding', { state: 'exact' }],
    ['evidenceSource', Symbol(HOSTILE_CANARY)],
    ['evidenceCompleteness', true],
    ['responseEvidence', 200],
    ['providerObjectEvidence', 'cs_test_private'],
    ['environmentEvidence', false],
    ['parameterEvidence', ['exact']],
    ['resultReferenceEvidence', 'opaque-id'],
    ['redirectEvidence', 'https://private.example.test'],
    ['paymentEvidence', 'PAID'],
    ['expiryEvidence', new Date(0)],
  ])('rejects a wrong fixed identity or field type for %s', (field, value) => {
    expectSafeError(
      () => classifyAuthorizedStripeCheckoutResultEvidence(serializedEvidence({
        [field]: value,
      })),
      typeof value === 'string' && value.length >= 5 ? value : HOSTILE_CANARY,
    );
  });

  test('rejects an unknown or future value in every enum dimension', () => {
    for (const field of Object.keys(PROVIDER_RESULT_POLICY_ENUMS)) {
      const value = `future_${field}_${HOSTILE_CANARY}`;
      expectSafeError(
        () => classifyAuthorizedStripeCheckoutResultEvidence(serializedEvidence({
          [field]: value,
        })),
        value,
      );
    }
  });

  test('all validation errors are byte-equivalent and never contain supplied input', () => {
    const errors = [
      captureError(() => classifyAuthorizedStripeCheckoutResultEvidence(null)),
      captureError(() => classifyAuthorizedStripeCheckoutResultEvidence(serializedEvidence({
        evidenceSource: HOSTILE_CANARY,
      }))),
      captureError(() => classifyAuthorizedStripeCheckoutResultEvidence(JSON.stringify({
        ...evidence(),
        extra: HOSTILE_CANARY,
      }))),
    ];
    const publicShapes = errors.map((error) => JSON.stringify({
      name: error.name,
      code: error.code,
      message: error.message,
      enumerable: JSON.stringify(error),
    }));
    expect(new Set(publicShapes).size).toBe(1);
    expect(publicShapes[0]).not.toContain(HOSTILE_CANARY);
  });
});

describe('immutability, redaction, and zero-side-effect boundary', () => {
  test('callers cannot mutate canonical outputs, enum arrays, or error fields', () => {
    const result = classifyAuthorizedStripeCheckoutResultEvidence(serializedEvidence());
    expect(() => { result.classification = HOSTILE_CANARY; }).toThrow(TypeError);
    expect(() => { result.extra = HOSTILE_CANARY; }).toThrow(TypeError);
    expect(() => { PROVIDER_RESULT_POLICY_ENUMS.planBinding.push(HOSTILE_CANARY); })
      .toThrow(TypeError);

    const error = captureError(() => classifyAuthorizedStripeCheckoutResultEvidence(null));
    expect(() => { error.message = HOSTILE_CANARY; }).toThrow(TypeError);
    expect(() => { error.code = HOSTILE_CANARY; }).toThrow(TypeError);
  });

  test('source has no provider, persistence, trust, or runtime side-effect edge', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'commerceProviderResult.js'),
      'utf8',
    );
    const requires = [...source.matchAll(/require\((['"])([^'"]+)\1\)/g)]
      .map((match) => match[2]);
    expect(requires).toEqual([]);

    for (const forbidden of [
      'firebase',
      "require('stripe')",
      'process.env',
      'console.',
      'Math.random',
      'Date.',
      'new Date',
      'fetch(',
      'node:http',
      'node:https',
      'node:net',
      'node:dns',
      'node:fs',
      'child_process',
      'import(',
      'commerceCommandJournal',
      'providerAttempts/',
      'dispatchBinding',
      'dispatchEvidence',
      'idempotencyEvidence',
      'resultBinding',
      'execution_started',
      'active_exact',
      'send_permitted',
      'shouldExecute',
      'shouldAdvance',
      'session.id',
      'session.url',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  test('no production source imports the unused policy module', () => {
    const files = fs.readdirSync(__dirname)
      .filter((fileName) => fileName.endsWith('.js'))
      .filter((fileName) => !fileName.endsWith('.test.js'))
      .filter((fileName) => fileName !== 'commerceProviderResult.js');
    const importers = [];
    for (const fileName of files) {
      const source = fs.readFileSync(path.join(__dirname, fileName), 'utf8');
      if (source.includes('commerceProviderResult')) importers.push(fileName);
    }
    expect(importers).toEqual([]);

    const indexSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(indexSource).not.toContain('commerceProviderResult');
  });
});
