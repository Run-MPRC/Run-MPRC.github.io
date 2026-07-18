const crypto = require('crypto');
const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const Stripe = require('stripe');
const tls = require('tls');
const { types: { isProxy } } = require('node:util');

// Stripe labels the injected HttpClient API experimental. This suite therefore
// observes only the exact lockfile version and must be reviewed on any upgrade.
const EXPECTED_STRIPE_VERSION = '14.25.0';
const OBSERVATION_HOST = 'stripe-observation.invalid';
const OBSERVATION_PORT = 443;
const OBSERVATION_PROTOCOL = 'https';
const OBSERVATION_TIMEOUT_MS = 37;
const CHECKOUT_CREATE_PATH = '/v1/checkout/sessions';
const SYNTHETIC_API_KEY = 'inert-stripe-constructor-value-test-only';
const SYNTHETIC_IDEMPOTENCY_KEY = 'sdk-observation-idempotency-test-only-0001';
const SYNTHETIC_REQUEST_ID = 'inert_request_observation_0001';
const SYNTHETIC_ACCOUNT_ID = 'inert_account_observation_0001';
const SYNTHETIC_API_VERSION = '2023-10-16';
const STANDARD_CHECKOUT_URL =
  'https://checkout.stripe.com/c/pay/inert-observation-only#synthetic-fragment';
const CUSTOM_CHECKOUT_URL =
  'https://pay.mprc-observation.invalid/session/sdk-observation#synthetic-fragment';
const EXPECTED_REQUEST_DATA =
  'mode=payment&line_items[0][price]=inert_price_reference'
  + '&line_items[0][quantity]=1'
  + '&success_url=https%3A%2F%2Fclub.example.test%2Fcheckout%2Fsuccess'
  + '&cancel_url=https%3A%2F%2Fclub.example.test%2Fcheckout%2Fcancel';

const EXPECTED_REQUEST_FACTS = Object.freeze({
  requestCount: 1,
  exactHost: true,
  exactPort: true,
  exactPath: true,
  exactMethod: true,
  exactProtocol: true,
  exactTimeout: true,
  exactIdempotencyKey: true,
  exactRequestData: true,
});

const ZERO_CALL_GUARD_TARGETS = Object.freeze([
  Object.freeze({ label: 'cryptoRandomBytes', target: crypto, key: 'randomBytes' }),
  Object.freeze({ label: 'cryptoRandomUuid', target: crypto, key: 'randomUUID' }),
  Object.freeze({ label: 'dnsLookup', target: dns, key: 'lookup' }),
  Object.freeze({ label: 'dnsResolve', target: dns, key: 'resolve' }),
  Object.freeze({ label: 'dnsPromisesLookup', target: dns.promises, key: 'lookup' }),
  Object.freeze({ label: 'dnsPromisesResolve', target: dns.promises, key: 'resolve' }),
  Object.freeze({ label: 'httpRequest', target: http, key: 'request' }),
  Object.freeze({ label: 'httpsRequest', target: https, key: 'request' }),
  Object.freeze({ label: 'mathRandom', target: Math, key: 'random' }),
  Object.freeze({ label: 'netConnect', target: net, key: 'connect' }),
  Object.freeze({ label: 'netCreateConnection', target: net, key: 'createConnection' }),
  Object.freeze({ label: 'processEmitWarning', target: process, key: 'emitWarning' }),
  Object.freeze({ label: 'tlsConnect', target: tls, key: 'connect' }),
].filter(({ target, key }) => typeof target?.[key] === 'function'));
const CONSOLE_GUARD_METHODS = Object.freeze(['debug', 'error', 'info', 'log', 'warn']);

let activeSideEffectGuards = null;

function createSessionFixture(overrides = {}) {
  return {
    id: 'inert_session_observation_0001',
    object: 'checkout.session',
    livemode: false,
    mode: 'payment',
    status: 'open',
    payment_status: 'unpaid',
    amount_total: 2500,
    currency: 'usd',
    customer_email: 'sdk-observation-buyer@example.test',
    created: 1800000000,
    expires_at: 1800001800,
    success_url: 'https://club.example.test/checkout/success',
    cancel_url: 'https://club.example.test/checkout/cancel',
    url: STANDARD_CHECKOUT_URL,
    metadata: {
      schemaVersion: '1',
      eventId: 'sdk_observation_event',
      registrationId: 'sdk_observation_registration',
      priceTier: 'nonMember',
    },
    ...overrides,
  };
}

function responseHeaders(overrides = {}) {
  return {
    'request-id': SYNTHETIC_REQUEST_ID,
    'stripe-version': SYNTHETIC_API_VERSION,
    'idempotency-key': SYNTHETIC_IDEMPOTENCY_KEY,
    'stripe-account': SYNTHETIC_ACCOUNT_ID,
    ...overrides,
  };
}

function sameDescriptor(left, right) {
  if (left === undefined || right === undefined) return left === right;
  if (left.configurable !== right.configurable
    || left.enumerable !== right.enumerable) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(right, 'value')) {
    return Object.prototype.hasOwnProperty.call(left, 'value')
      && left.writable === right.writable
      && Object.is(left.value, right.value);
  }
  return !Object.prototype.hasOwnProperty.call(left, 'value')
    && Object.is(left.get, right.get)
    && Object.is(left.set, right.set);
}

function installSideEffectGuards() {
  if (activeSideEffectGuards !== null) {
    throw new Error('Synthetic Stripe observation guards already active.');
  }

  const zeroCallTargets = [...ZERO_CALL_GUARD_TARGETS];
  if (typeof globalThis.fetch === 'function') {
    zeroCallTargets.push(Object.freeze({
      label: 'globalFetch',
      target: globalThis,
      key: 'fetch',
    }));
  }

  const zeroCallCounts = Object.create(null);
  const zeroCallEntries = zeroCallTargets.map(({ label, target, key }) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor || typeof descriptor.value !== 'function') {
      throw new Error('Synthetic Stripe observation zero-call guard unavailable.');
    }
    zeroCallCounts[label] = 0;
    Object.defineProperty(target, key, {
      ...descriptor,
      value: function blockedSideEffectCall() {
        zeroCallCounts[label] += 1;
        throw new Error('Unexpected side effect during synthetic Stripe observation.');
      },
    });
    return Object.freeze({ descriptor, key, target });
  });

  let outputCount = 0;
  const consoleEntries = CONSOLE_GUARD_METHODS.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(console, key);
    if (!descriptor || typeof descriptor.value !== 'function') {
      throw new Error('Synthetic Stripe observation output guard unavailable.');
    }
    Object.defineProperty(console, key, {
      ...descriptor,
      value: function blockedConsoleOutput() {
        outputCount += 1;
        throw new Error('Unexpected output during synthetic Stripe observation.');
      },
    });
    return Object.freeze({ descriptor, key, target: console });
  });

  activeSideEffectGuards = {
    consoleEntries,
    getOutputCount: () => outputCount,
    zeroCallCounts,
    zeroCallEntries,
  };
}

function restoreSideEffectGuards() {
  const state = activeSideEffectGuards;
  activeSideEffectGuards = null;
  if (state === null) {
    throw new Error('Synthetic Stripe observation guards were not active.');
  }

  [...state.zeroCallEntries, ...state.consoleEntries].forEach((entry) => {
    Object.defineProperty(entry.target, entry.key, entry.descriptor);
  });

  const noBlockedCalls = Object.values(state.zeroCallCounts)
    .every((count) => count === 0);
  const noOutputCalls = state.getOutputCount() === 0;
  const exactRestoration = [...state.zeroCallEntries, ...state.consoleEntries]
    .every((entry) => sameDescriptor(
      Object.getOwnPropertyDescriptor(entry.target, entry.key),
      entry.descriptor
    ));
  if (!noBlockedCalls || !noOutputCalls || !exactRestoration) {
    throw new Error('Synthetic Stripe observation side-effect guard failed.');
  }
}

class SyntheticHttpResponse extends Stripe.HttpClientResponse {
  constructor({ statusCode, headers, rawJson }) {
    super(statusCode, headers);
    this.rawJson = rawJson;
    this.rawResponse = { statusCode };
  }

  getRawResponse() {
    return this.rawResponse;
  }

  toJSON() {
    return Promise.resolve().then(() => JSON.parse(this.rawJson));
  }

  toStream() {
    throw new Error('Unexpected streaming response in synthetic Stripe observation.');
  }
}

class SyntheticHttpClient extends Stripe.HttpClient {
  constructor(responseFactory) {
    super();
    this.responseFactory = responseFactory;
    this.requestFacts = {
      requestCount: 0,
      exactHost: false,
      exactPort: false,
      exactPath: false,
      exactMethod: false,
      exactProtocol: false,
      exactTimeout: false,
      exactIdempotencyKey: false,
      exactRequestData: false,
    };
  }

  getClientName() {
    return 'run-mprc-synthetic-stripe-observation';
  }

  makeRequest(host, port, path, method, headers, requestData, protocol, timeout) {
    const responseFactory = this.responseFactory;
    this.responseFactory = null;
    this.requestFacts.requestCount += 1;
    this.requestFacts.exactHost = host === OBSERVATION_HOST;
    this.requestFacts.exactPort = port === OBSERVATION_PORT;
    this.requestFacts.exactPath = path === CHECKOUT_CREATE_PATH;
    this.requestFacts.exactMethod = method === 'POST';
    this.requestFacts.exactProtocol = protocol === OBSERVATION_PROTOCOL;
    this.requestFacts.exactTimeout = timeout === OBSERVATION_TIMEOUT_MS;
    this.requestFacts.exactIdempotencyKey =
      headers !== null
      && typeof headers === 'object'
      && Object.prototype.hasOwnProperty.call(headers, 'Idempotency-Key')
      && headers['Idempotency-Key'] === SYNTHETIC_IDEMPOTENCY_KEY;
    this.requestFacts.exactRequestData = requestData === EXPECTED_REQUEST_DATA;

    if (this.requestFacts.requestCount !== 1
      || !this.requestFacts.exactHost
      || !this.requestFacts.exactPort
      || !this.requestFacts.exactPath
      || !this.requestFacts.exactMethod
      || !this.requestFacts.exactProtocol
      || !this.requestFacts.exactTimeout
      || !this.requestFacts.exactIdempotencyKey
      || !this.requestFacts.exactRequestData) {
      return Promise.reject(new Error('Unexpected synthetic Stripe SDK request.'));
    }

    if (typeof responseFactory !== 'function') {
      return Promise.reject(new Error('Synthetic Stripe SDK response unavailable.'));
    }
    return Promise.resolve().then(() => responseFactory());
  }

  snapshotRequestFacts() {
    return Object.freeze({ ...this.requestFacts });
  }
}

function createStripe(httpClient) {
  return new Stripe(SYNTHETIC_API_KEY, {
    apiVersion: SYNTHETIC_API_VERSION,
    host: OBSERVATION_HOST,
    port: OBSERVATION_PORT,
    protocol: OBSERVATION_PROTOCOL,
    timeout: OBSERVATION_TIMEOUT_MS,
    maxNetworkRetries: 0,
    telemetry: false,
    httpClient,
  });
}

function createResponse({
  body = createSessionFixture(),
  rawJson = JSON.stringify(body),
  statusCode = 200,
  headers = responseHeaders(),
} = {}) {
  return new SyntheticHttpResponse({ statusCode, headers, rawJson });
}

function createHarness(responseFactory) {
  try {
    const httpClient = new SyntheticHttpClient(responseFactory);
    const stripe = createStripe(httpClient);
    return { httpClient, stripe };
  } catch {
    throw new Error('Synthetic Stripe SDK harness unavailable.');
  }
}

function createCheckoutSession(stripe) {
  return stripe.checkout.sessions.create(
    {
      mode: 'payment',
      line_items: [{ price: 'inert_price_reference', quantity: 1 }],
      success_url: 'https://club.example.test/checkout/success',
      cancel_url: 'https://club.example.test/checkout/cancel',
    },
    { idempotencyKey: SYNTHETIC_IDEMPOTENCY_KEY }
  );
}

function expectOwnDataProperty(object, key, expectedValue) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  expect(descriptor !== undefined).toBe(true);
  expect(Object.prototype.hasOwnProperty.call(descriptor, 'value')).toBe(true);
  expect(Object.prototype.hasOwnProperty.call(descriptor, 'get')).toBe(false);
  expect(Object.prototype.hasOwnProperty.call(descriptor, 'set')).toBe(false);
  expect(Object.is(descriptor.value, expectedValue)).toBe(true);
  return descriptor;
}

function requestFactsMatch(httpClient) {
  const facts = httpClient.snapshotRequestFacts();
  const keys = Object.keys(EXPECTED_REQUEST_FACTS);
  return Object.keys(facts).length === keys.length
    && keys.every((key) => Object.is(facts[key], EXPECTED_REQUEST_FACTS[key]));
}

function allObservationsTrue(observations) {
  return Object.values(observations).every((value) => value === true);
}

async function captureFixedResolution(operation) {
  try {
    return await operation();
  } catch {
    throw new Error('Synthetic Stripe SDK response did not resolve.');
  }
}

async function captureFixedBoundaryRejection(operation) {
  let returnedPromise = false;
  try {
    const result = operation();
    returnedPromise = result instanceof Promise;
    await result;
    return Object.freeze({
      factoryDiscarded: false,
      messageMatchesExpected: false,
      rejected: false,
      returnedPromise,
    });
  } catch (error) {
    return Object.freeze({
      factoryDiscarded: true,
      messageMatchesExpected:
        error?.message === 'Unexpected synthetic Stripe SDK request.',
      rejected: true,
      returnedPromise,
    });
  }
}

async function captureFixedRejection(operation, expected) {
  try {
    await operation();
    return Object.freeze({
      rejected: false,
      requestIdMatchesExpected: false,
      statusCodeMatchesExpected: false,
      typeMatchesExpected: false,
    });
  } catch (error) {
    return Object.freeze({
      rejected: true,
      requestIdMatchesExpected: Object.is(error?.requestId, expected.requestId),
      statusCodeMatchesExpected: Object.is(error?.statusCode, expected.statusCode),
      typeMatchesExpected: Object.is(error?.type, expected.type),
    });
  }
}

beforeEach(installSideEffectGuards);
afterEach(restoreSideEffectGuards);

describe('Stripe 14.25.0 Checkout Session SDK observations', () => {
  test('rejects an unexpected fake boundary asynchronously and discards its factory', async () => {
    const { httpClient } = createHarness(() => createResponse());

    const rejection = await captureFixedBoundaryRejection(() =>
      httpClient.makeRequest(
        OBSERVATION_HOST,
        OBSERVATION_PORT,
        '/unexpected-synthetic-path',
        'POST',
        { 'Idempotency-Key': SYNTHETIC_IDEMPOTENCY_KEY },
        EXPECTED_REQUEST_DATA,
        OBSERVATION_PROTOCOL,
        OBSERVATION_TIMEOUT_MS
      ));

    expect(allObservationsTrue(rejection)).toBe(true);
    expect(httpClient.responseFactory === null).toBe(true);
  });

  test('pins the installed public SDK and exact synthetic create request boundary', async () => {
    expect(Stripe.PACKAGE_VERSION === EXPECTED_STRIPE_VERSION).toBe(true);
    const response = createResponse();
    const { httpClient, stripe } = createHarness(() => response);

    const session = await captureFixedResolution(() => createCheckoutSession(stripe));

    expect(requestFactsMatch(httpClient)).toBe(true);
    expect(Object.getPrototypeOf(session)).toBe(Object.prototype);
    expect(isProxy(session)).toBe(false);
    [
      ['id', 'inert_session_observation_0001'],
      ['object', 'checkout.session'],
      ['livemode', false],
      ['mode', 'payment'],
      ['status', 'open'],
      ['payment_status', 'unpaid'],
      ['amount_total', 2500],
      ['currency', 'usd'],
      ['customer_email', 'sdk-observation-buyer@example.test'],
      ['created', 1800000000],
      ['expires_at', 1800001800],
      ['success_url', 'https://club.example.test/checkout/success'],
      ['cancel_url', 'https://club.example.test/checkout/cancel'],
      ['url', STANDARD_CHECKOUT_URL],
    ].forEach(([key, value]) => {
      const descriptor = expectOwnDataProperty(session, key, value);
      expect(descriptor.enumerable).toBe(true);
      expect(descriptor.writable).toBe(true);
      expect(descriptor.configurable).toBe(true);
    });

    const metadataDescriptor = expectOwnDataProperty(
      session,
      'metadata',
      session.metadata,
    );
    expect(metadataDescriptor.enumerable).toBe(true);
    expect(metadataDescriptor.writable).toBe(true);
    expect(metadataDescriptor.configurable).toBe(true);
    expect(Object.getPrototypeOf(session.metadata)).toBe(Object.prototype);
    expect(isProxy(session.metadata)).toBe(false);
    expect(session.metadata).toEqual({
      schemaVersion: '1',
      eventId: 'sdk_observation_event',
      registrationId: 'sdk_observation_registration',
      priceTier: 'nonMember',
    });
    [
      ['schemaVersion', '1'],
      ['eventId', 'sdk_observation_event'],
      ['registrationId', 'sdk_observation_registration'],
      ['priceTier', 'nonMember'],
    ].forEach(([key, value]) => {
      const descriptor = expectOwnDataProperty(session.metadata, key, value);
      expect(descriptor.enumerable).toBe(true);
      expect(descriptor.writable).toBe(true);
      expect(descriptor.configurable).toBe(true);
    });

    const rawResponse = response.getRawResponse();
    expect(isProxy(rawResponse)).toBe(false);
    const lastResponseDescriptor = expectOwnDataProperty(
      session,
      'lastResponse',
      rawResponse
    );
    expect(lastResponseDescriptor.configurable === false).toBe(true);
    expect(lastResponseDescriptor.enumerable === false).toBe(true);
    expect(Object.is(lastResponseDescriptor.value, rawResponse)).toBe(true);
    expect(lastResponseDescriptor.writable === false).toBe(true);

    [
      ['statusCode', 200],
      ['requestId', SYNTHETIC_REQUEST_ID],
      ['apiVersion', SYNTHETIC_API_VERSION],
      ['idempotencyKey', SYNTHETIC_IDEMPOTENCY_KEY],
      ['stripeAccount', SYNTHETIC_ACCOUNT_ID],
    ].forEach(([key, value]) => {
      const descriptor = expectOwnDataProperty(rawResponse, key, value);
      expect(descriptor.enumerable).toBe(true);
      expect(descriptor.writable).toBe(true);
      expect(descriptor.configurable).toBe(true);
    });

    expect(Object.isExtensible(rawResponse)).toBe(true);
    expect(Object.isExtensible(session)).toBe(true);
  });

  test.each([
    ['standard fragment-bearing URL', STANDARD_CHECKOUT_URL],
    ['custom HTTPS URL', CUSTOM_CHECKOUT_URL],
  ])('preserves an unvalidated %s unchanged', async (_name, url) => {
    const response = createResponse({ body: createSessionFixture({ url }) });
    const { httpClient, stripe } = createHarness(() => response);

    const session = await captureFixedResolution(() => createCheckoutSession(stripe));

    expect(Object.is(session.url, url)).toBe(true);
    expect(requestFactsMatch(httpClient)).toBe(true);
  });

  test('preserves unknown and sensitive fields while raw serialization omits lastResponse only', async () => {
    const sensitiveFixture = createSessionFixture({
      client_secret: 'inert-client-value-observation-only',
      customer_email: 'sdk-observation-runner@example.test',
      customer_details: {
        email: 'sdk-observation-runner@example.test',
        phone: 'not-a-phone-test-only',
      },
      metadata: {
        private_note: 'synthetic_metadata_private_canary',
      },
      future_private_field: 'synthetic_unknown_private_canary',
    });
    const response = createResponse({ body: sensitiveFixture });
    const { httpClient, stripe } = createHarness(() => response);

    const session = await captureFixedResolution(() => createCheckoutSession(stripe));
    const serialized = JSON.stringify(session);

    expect(Object.is(
      session.client_secret,
      'inert-client-value-observation-only'
    )).toBe(true);
    expect(Object.is(
      session.customer_email,
      'sdk-observation-runner@example.test'
    )).toBe(true);
    expect(Object.is(session.customer_details.phone, 'not-a-phone-test-only'))
      .toBe(true);
    expect(Object.is(
      session.metadata.private_note,
      'synthetic_metadata_private_canary'
    )).toBe(true);
    expect(Object.is(
      session.future_private_field,
      'synthetic_unknown_private_canary'
    )).toBe(true);
    expect(serialized.includes(STANDARD_CHECKOUT_URL)).toBe(true);
    expect(serialized.includes('inert-client-value-observation-only')).toBe(true);
    expect(serialized.includes('sdk-observation-runner@example.test')).toBe(true);
    expect(serialized.includes('synthetic_metadata_private_canary')).toBe(true);
    expect(serialized.includes('synthetic_unknown_private_canary')).toBe(true);
    expect(serialized.includes('lastResponse')).toBe(false);
    expect(serialized.includes(SYNTHETIC_REQUEST_ID)).toBe(false);
    expect(requestFactsMatch(httpClient)).toBe(true);
  });

  test.each([
    ['missing', undefined],
    ['mismatched', 'sdk-observation-response-key-mismatch'],
  ])('leaves a %s idempotency response header untrusted', async (_name, headerValue) => {
    const headers = responseHeaders();
    if (headerValue === undefined) delete headers['idempotency-key'];
    else headers['idempotency-key'] = headerValue;
    const response = createResponse({ headers });
    const { httpClient, stripe } = createHarness(() => response);

    const session = await captureFixedResolution(() => createCheckoutSession(stripe));

    expect(Object.is(session.lastResponse.idempotencyKey, headerValue)).toBe(true);
    expect(requestFactsMatch(httpClient)).toBe(true);
  });

  test('leaves an absent optional Stripe account response header untrusted', async () => {
    const headers = responseHeaders();
    delete headers['stripe-account'];
    const response = createResponse({ headers });
    const { httpClient, stripe } = createHarness(() => response);

    const session = await captureFixedResolution(() => createCheckoutSession(stripe));

    expectOwnDataProperty(session.lastResponse, 'stripeAccount', undefined);
    expect(requestFactsMatch(httpClient)).toBe(true);
  });

  test('resolves unsafe business shapes without validating them', async () => {
    const unsafeFixture = createSessionFixture({
      id: 'inert_wrong_environment_observation',
      object: 'unexpected.resource',
      livemode: true,
      mode: 'setup',
      status: 'complete',
      payment_status: 'paid',
      amount_total: -1.25,
      currency: 'EUR',
      expires_at: 0,
      url: 'http://unsafe-checkout.invalid/capability',
    });
    const response = createResponse({ body: unsafeFixture });
    const { httpClient, stripe } = createHarness(() => response);

    const session = await captureFixedResolution(() => createCheckoutSession(stripe));

    const unsafeShapeSurvived =
      session.id === 'inert_wrong_environment_observation'
      && session.object === 'unexpected.resource'
      && session.livemode === true
      && session.mode === 'setup'
      && session.status === 'complete'
      && session.payment_status === 'paid'
      && session.amount_total === -1.25
      && session.currency === 'EUR'
      && session.expires_at === 0
      && session.url === 'http://unsafe-checkout.invalid/capability';
    expect(unsafeShapeSurvived).toBe(true);
    expect(requestFactsMatch(httpClient)).toBe(true);
  });

  test('rejects a normal non-2xx Stripe error envelope without output or retry', async () => {
    const response = createResponse({
      body: {
        error: {
          type: 'invalid_request_error',
          message: 'synthetic_non_2xx_private_canary',
        },
      },
      statusCode: 400,
      headers: responseHeaders({ 'stripe-should-retry': 'false' }),
    });
    const { httpClient, stripe } = createHarness(() => response);

    const rejection = await captureFixedRejection(
      () => createCheckoutSession(stripe),
      {
        type: 'StripeInvalidRequestError',
        statusCode: 400,
        requestId: SYNTHETIC_REQUEST_ID,
      }
    );

    expect(allObservationsTrue(rejection)).toBe(true);
    expect(requestFactsMatch(httpClient)).toBe(true);
  });

  test('can resolve a non-2xx body without an error field and therefore proves no trust', async () => {
    const response = createResponse({
      body: createSessionFixture({ status: 'expired' }),
      statusCode: 502,
      headers: responseHeaders({ 'stripe-should-retry': 'false' }),
    });
    const { httpClient, stripe } = createHarness(() => response);

    const session = await captureFixedResolution(() => createCheckoutSession(stripe));

    expect(session.status === 'expired').toBe(true);
    expect(session.lastResponse.statusCode === 502).toBe(true);
    expect(requestFactsMatch(httpClient)).toBe(true);
  });

  test('rejects malformed JSON without exposing its body, output, or retry', async () => {
    const response = createResponse({
      rawJson: '{"synthetic_malformed_json_canary":',
      statusCode: 200,
    });
    const { httpClient, stripe } = createHarness(() => response);

    const rejection = await captureFixedRejection(
      () => createCheckoutSession(stripe),
      {
        type: 'StripeAPIError',
        statusCode: undefined,
        requestId: SYNTHETIC_REQUEST_ID,
      }
    );

    expect(allObservationsTrue(rejection)).toBe(true);
    expect(requestFactsMatch(httpClient)).toBe(true);
  });

  test('rejects a generic fake transport failure without output or retry', async () => {
    const { httpClient, stripe } = createHarness(() => {
      throw new Error('synthetic_transport_private_canary');
    });

    const rejection = await captureFixedRejection(
      () => createCheckoutSession(stripe),
      {
        type: 'StripeConnectionError',
        statusCode: undefined,
        requestId: undefined,
      }
    );

    expect(allObservationsTrue(rejection)).toBe(true);
    expect(requestFactsMatch(httpClient)).toBe(true);
  });
});
