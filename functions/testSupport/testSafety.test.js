const dgram = require('dgram');
const dns = require('dns');
const http = require('http');
const http2 = require('http2');
const https = require('https');
const net = require('net');
const tls = require('tls');

const {
  NETWORK_ERROR_MESSAGE,
  TEST_ENVIRONMENT_ERROR_MESSAGE,
  TEST_INPUT_ERROR_MESSAGE,
  assertEndpointAllowed,
  assertSafeTestEnvironment,
  createSignedStripePayload,
  createSyntheticContact,
  createSyntheticMember,
  createSyntheticOrder,
  createSyntheticStripeEvent,
  installNetworkGuard,
} = require('./testSafety');

const SYNTHETIC_SIGNING_MATERIAL = 'stripe_webhook_synthetic_test_material';
const LIVE_KEY_CANARY = ['sk', 'live', 'hostile', 'canary', 'material'].join('_');
const WEBHOOK_SECRET_CANARY = ['whsec', 'hostile', 'canary', 'material'].join('_');

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected a fixed safety error');
}

function expectSafeError(callback, expectedMessage, hostileValue) {
  const error = captureError(callback);
  expect(error).toBeTruthy();
  expect(error.message).toBe(expectedMessage);
  expect(JSON.stringify(error)).toBe('{}');
  if (hostileValue) {
    expect(error.message).not.toContain(hostileValue);
    expect(JSON.stringify(error)).not.toContain(hostileValue);
    expect(error.stack).not.toContain(hostileValue);
  }
}

function expectDeeplyFrozen(value) {
  expect(Object.isFrozen(value)).toBe(true);
  if (value === null || typeof value !== 'object') return;
  Reflect.ownKeys(value).forEach((key) => expectDeeplyFrozen(value[key]));
}

describe('synthetic Functions fixtures', () => {
  test.each([
    ['contact', createSyntheticContact],
    ['member', createSyntheticMember],
    ['order', createSyntheticOrder],
    ['Stripe event', createSyntheticStripeEvent],
  ])('%s fixture is deterministic, fresh, and deeply frozen', (_name, factory) => {
    const first = factory(42);
    const second = factory(42);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expectDeeplyFrozen(first);
    expect(JSON.stringify(first)).toContain('test');
    expect(JSON.stringify(first)).not.toContain('runmprc.com');
  });

  test('uses reserved, non-deliverable contact data', () => {
    const contact = createSyntheticContact(7);

    expect(contact.email).toMatch(/@example\.test$/);
    expect(contact.phoneNumber).toMatch(/^\+120255501\d{2}$/);
    expect(contact.address.postalCode).toBe('00000');
    expect(contact.fullName).toMatch(/^Synthetic Runner /);
  });

  test.each([
    () => createSyntheticContact(-1),
    () => createSyntheticMember('real-person'),
    () => createSyntheticOrder(Number.MAX_SAFE_INTEGER),
    () => createSyntheticMember(1, { email: 'hostile-personal-input.invalid' }),
    () => createSyntheticStripeEvent(1, 'customer.created'),
    () => createSyntheticStripeEvent(1, 'checkout.session.async_payment_failed'),
    () => createSyntheticStripeEvent(1, 'checkout.session.expired'),
    () => createSyntheticStripeEvent(1, 'checkout.session.completed', { livemode: true }),
  ])('rejects unsafe seeds, event types, and override-shaped inputs', (createFixture) => {
    expectSafeError(createFixture, TEST_INPUT_ERROR_MESSAGE, 'hostile-personal-input.invalid');
  });

  test('signs exact raw event bytes deterministically without returning the secret', () => {
    const event = createSyntheticStripeEvent(9);
    const first = createSignedStripePayload({
      event,
      secret: SYNTHETIC_SIGNING_MATERIAL,
      timestamp: 1800000009,
    });
    const second = createSignedStripePayload({
      event,
      secret: SYNTHETIC_SIGNING_MATERIAL,
      timestamp: 1800000009,
    });

    expect(first.rawBody).toEqual(Buffer.from(JSON.stringify(event), 'utf8'));
    expect(first.signatureHeader).toBe(second.signatureHeader);
    expect(first.signatureHeader).toMatch(/^t=1800000009,v1=[a-f0-9]{64}$/);
    expect(Object.isFrozen(first)).toBe(true);
    expect(JSON.stringify(first)).not.toContain(SYNTHETIC_SIGNING_MATERIAL);
    expect(first.signatureHeader).not.toContain(SYNTHETIC_SIGNING_MATERIAL);
  });

  test.each([
    [null, 'hostile-signing-input-canary'],
    [new Proxy({}, {
      get() {
        throw new Error('hostile-signing-input-canary');
      },
      getPrototypeOf() {
        throw new Error('hostile-signing-input-canary');
      },
    }), 'hostile-signing-input-canary'],
    [Object.defineProperty({}, 'event', {
      get() {
        throw new Error('hostile-signing-input-canary');
      },
    }), 'hostile-signing-input-canary'],
    [{ event: undefined, secret: SYNTHETIC_SIGNING_MATERIAL, timestamp: 1800000000 }],
    [{ event: createSyntheticStripeEvent(1), secret: 'hostile-live-like-material', timestamp: 1800000000 }],
    [{ event: createSyntheticStripeEvent(1), secret: SYNTHETIC_SIGNING_MATERIAL, timestamp: 0 }],
    [{ event: { object: 'event', livemode: 'true', data: {} }, secret: SYNTHETIC_SIGNING_MATERIAL, timestamp: 1800000000 }],
    [{
      event: {
        ...createSyntheticStripeEvent(1),
        toJSON() {
          return { ...createSyntheticStripeEvent(1), livemode: true };
        },
      },
      secret: SYNTHETIC_SIGNING_MATERIAL,
      timestamp: 1800000000,
    }],
    [{
      event: {
        ...createSyntheticStripeEvent(1),
        data: { object: { syntheticText: '😀'.repeat(300000) } },
      },
      secret: SYNTHETIC_SIGNING_MATERIAL,
      timestamp: 1800000000,
    }],
  ])('rejects malformed or unsafe Stripe signing input', (input, canary = 'hostile-live-like-material') => {
    expectSafeError(
      () => createSignedStripePayload(input),
      TEST_INPUT_ERROR_MESSAGE,
      canary,
    );
  });
});

describe('Functions test environment safety', () => {
  test.each([
    {},
    {
      ENVIRONMENT_NAME: 'test',
      SITE_ORIGIN: 'https://functions.example.test',
      GCLOUD_PROJECT: 'demo-functions-test',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099',
      STRIPE_LIVEMODE_EXPECTED: 'false',
      STRIPE_SECRET_KEY: 'sk_test_synthetic_functions_key',
      STRIPE_WEBHOOK_SECRET: SYNTHETIC_SIGNING_MATERIAL,
    },
    {
      ENVIRONMENT_NAME: 'local',
      SITE_ORIGIN: 'http://[::1]:5001',
      GOOGLE_CLOUD_PROJECT: 'demo-mprc-local',
      FIREBASE_CONFIG: JSON.stringify({
        databaseURL: 'https://demo-mprc-local.firebaseio.com',
        projectId: 'demo-mprc-local',
        storageBucket: 'demo-mprc-local.appspot.com',
      }),
      FUNCTIONS_EMULATOR_HOST: '[::1]:5001',
    },
  ])('accepts missing optional values and explicit synthetic environments', (environment) => {
    expect(assertSafeTestEnvironment(environment)).toBe(true);
  });

  test.each([
    ['production environment', { ENVIRONMENT_NAME: 'production' }, 'production'],
    ['production project', { GCLOUD_PROJECT: 'mid-peninsula-running-club' }, 'mid-peninsula-running-club'],
    ['malformed Firebase config', { FIREBASE_CONFIG: 'hostile-config-text' }, 'hostile-config-text'],
    ['Firebase config with database authority', {
      FIREBASE_CONFIG: JSON.stringify({
        projectId: 'demo-functions-test',
        databaseURL: 'https://hostile-database.invalid',
      }),
    }, 'hostile-database.invalid'],
    ['Firebase config with browser authority', {
      FIREBASE_CONFIG: JSON.stringify({
        projectId: 'demo-functions-test',
        apiKey: 'hostile-browser-authority',
      }),
    }, 'hostile-browser-authority'],
    ['Firebase service account', { FIREBASE_SERVICE_ACCOUNT: 'hostile-service-account' }, 'hostile-service-account'],
    ['Firebase CLI token', { FIREBASE_TOKEN: 'hostile-firebase-token' }, 'hostile-firebase-token'],
    ['Google credential path', { GOOGLE_APPLICATION_CREDENTIALS: '/hostile/credential/path' }, '/hostile/credential/path'],
    ['rotating Google credential path', {
      GOOGLE_APPLICATION_CREDENTIALS_NEXT: '/hostile/credential/path',
    }, '/hostile/credential/path'],
    ['Google access token', { GOOGLE_OAUTH_ACCESS_TOKEN: 'hostile-google-token' }, 'hostile-google-token'],
    ['rotating Google Cloud token', {
      GCLOUD_ACCESS_TOKEN_ROTATING: 'hostile-google-token',
    }, 'hostile-google-token'],
    ['Google API key', { GOOGLE_API_KEY: 'hostile-google-api-key' }, 'hostile-google-api-key'],
    ['Google ID token', { GOOGLE_ID_TOKEN: 'hostile-google-id-token' }, 'hostile-google-id-token'],
    ['Firebase API key', { FIREBASE_API_KEY: 'hostile-firebase-api-key' }, 'hostile-firebase-api-key'],
    ['Firebase auth token', { FIREBASE_AUTH_TOKEN: 'hostile-firebase-auth-token' }, 'hostile-firebase-auth-token'],
    ['old Firebase service account', {
      FIREBASE_SERVICE_ACCOUNT_OLD: 'hostile-service-account',
    }, 'hostile-service-account'],
    ['production origin', { SITE_ORIGIN: 'https://runmprc.com' }, 'https://runmprc.com'],
    ['deceptive test origin', { SITE_ORIGIN: 'https://example.test.attacker.invalid' }, 'example.test.attacker.invalid'],
    ['live mode', { STRIPE_LIVEMODE_EXPECTED: 'true' }, 'true'],
    ['live key', { STRIPE_SECRET_KEY: LIVE_KEY_CANARY }, LIVE_KEY_CANARY],
    ['rotating live key', { STRIPE_SECRET_KEY_NEXT: LIVE_KEY_CANARY }, LIVE_KEY_CANARY],
    ['rotating API key', { STRIPE_API_KEY_ROTATING: LIVE_KEY_CANARY }, LIVE_KEY_CANARY],
    ['real-shaped webhook secret', { STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET_CANARY }, WEBHOOK_SECRET_CANARY],
    ['old webhook secret', {
      STRIPE_WEBHOOK_SECRET_OLD: WEBHOOK_SECRET_CANARY,
    }, WEBHOOK_SECRET_CANARY],
    ['external emulator', { FIRESTORE_EMULATOR_HOST: 'attacker.invalid:8080' }, 'attacker.invalid'],
    ['unspecified emulator', { FIRESTORE_EMULATOR_HOST: '0.0.0.0:8080' }, '0.0.0.0'],
    ['emulator without port', { FIRESTORE_EMULATOR_HOST: 'localhost' }, 'localhost'],
    ['credential-bearing emulator', { FIRESTORE_EMULATOR_HOST: 'user@localhost:8080' }, 'user@localhost'],
  ])('rejects %s with one redacted fixed error', (_name, environment, hostileValue) => {
    expectSafeError(
      () => assertSafeTestEnvironment(environment),
      TEST_ENVIRONMENT_ERROR_MESSAGE,
      hostileValue,
    );
  });

  test.each([
    ['null input', null],
    ['proxy input', new Proxy({}, {
      ownKeys() {
        throw new Error('hostile-environment-canary');
      },
    })],
    ['accessor input', Object.defineProperty({}, 'SITE_ORIGIN', {
      enumerable: true,
      get() {
        throw new Error('hostile-environment-canary');
      },
    })],
  ])('rejects %s without echoing accessor failures', (_name, environment) => {
    expectSafeError(
      () => assertSafeTestEnvironment(environment),
      TEST_ENVIRONMENT_ERROR_MESSAGE,
      'hostile-environment-canary',
    );
  });
});

describe('process-wide network safety', () => {
  test('installation is idempotent', () => {
    const request = http.request;
    const connect = net.connect;
    const fetch = globalThis.fetch;

    expect(installNetworkGuard()).toBe(true);
    expect(installNetworkGuard()).toBe(true);
    expect(http.request).toBe(request);
    expect(net.connect).toBe(connect);
    expect(globalThis.fetch).toBe(fetch);
  });

  test('allows only exact loopback emulator host and port pairs', () => {
    const environment = {
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      FIREBASE_AUTH_EMULATOR_HOST: '[::1]:9099',
    };

    expect(() => assertEndpointAllowed('127.0.0.1', 8080, environment)).not.toThrow();
    expect(() => assertEndpointAllowed('::1', 9099, environment)).not.toThrow();
    expectSafeError(
      () => assertEndpointAllowed('localhost', 8080, environment),
      NETWORK_ERROR_MESSAGE,
    );
    expectSafeError(
      () => assertEndpointAllowed('127.0.0.1', 8081, environment),
      NETWORK_ERROR_MESSAGE,
    );
    const valueOf = jest.fn(() => {
      throw new Error('hostile-port-coercion-canary');
    });
    expectSafeError(
      () => assertEndpointAllowed('127.0.0.1', { valueOf }, environment),
      NETWORK_ERROR_MESSAGE,
      'hostile-port-coercion-canary',
    );
    expect(valueOf).not.toHaveBeenCalled();
  });

  test.each([
    ['HTTP request', () => http.request('http://external-network-canary.invalid/path')],
    ['HTTP get', () => http.get('http://external-network-canary.invalid/path')],
    ['HTTPS request', () => https.request('https://external-network-canary.invalid/path')],
    ['HTTPS get', () => https.get('https://external-network-canary.invalid/path')],
    ['HTTP/2', () => http2.connect('https://external-network-canary.invalid')],
    ['TCP connect', () => net.connect(443, 'external-network-canary.invalid')],
    ['TCP createConnection', () => net.createConnection(443, 'external-network-canary.invalid')],
    ['TLS connect', () => tls.connect(443, 'external-network-canary.invalid')],
    ['TLS port/options connect', () => tls.connect(443, {
      host: 'external-network-canary.invalid',
    })],
    ['direct Socket connect', () => (
      new net.Socket().connect(443, 'external-network-canary.invalid')
    )],
    ['UDP send', () => {
      const socket = dgram.createSocket('udp4');
      socket.send(Buffer.from('synthetic'), 53, 'external-network-canary.invalid');
    }],
  ])('blocks %s before an outside connection with a redacted fixed error', (_name, connect) => {
    expectSafeError(connect, NETWORK_ERROR_MESSAGE, 'external-network-canary.invalid');
  });

  test('blocks fetch before an outside connection when fetch is available', () => {
    if (typeof globalThis.fetch !== 'function') return;
    expectSafeError(
      () => globalThis.fetch('https://external-network-canary.invalid/path'),
      NETWORK_ERROR_MESSAGE,
      'external-network-canary.invalid',
    );
  });

  test.each([
    ['lookup', (callback) => dns.lookup('external-network-canary.invalid', callback)],
    ['resolve', (callback) => dns.resolve('external-network-canary.invalid', callback)],
    ['reverse', (callback) => dns.reverse('203.0.113.10', callback)],
    ['Resolver.resolve', (callback) => (
      new dns.Resolver().resolve('external-network-canary.invalid', callback)
    )],
    ['promises.lookup', () => dns.promises.lookup('external-network-canary.invalid')],
    ['promises.resolve', () => dns.promises.resolve('external-network-canary.invalid')],
    ['promises Resolver.resolve', () => (
      new dns.promises.Resolver().resolve('external-network-canary.invalid')
    )],
  ])('blocks DNS %s before resolver contact or callback', (_name, resolve) => {
    const callback = jest.fn();
    expectSafeError(
      () => resolve(callback),
      NETWORK_ERROR_MESSAGE,
      'external-network-canary.invalid',
    );
    expect(callback).not.toHaveBeenCalled();
  });

  test.each([
    ['HTTP lookup', (callback) => http.request({
      host: '127.0.0.1', port: 54321, path: '/', lookup: callback,
    })],
    ['HTTP agent', (callback) => http.request({
      host: '127.0.0.1', port: 54321, path: '/', agent: { createConnection: callback },
    })],
    ['direct ClientRequest agent', (callback) => new http.ClientRequest({
      host: '127.0.0.1', port: 54321, path: '/', agent: { addRequest: callback },
    })],
    ['HTTP _defaultAgent', (callback) => http.request({
      host: '127.0.0.1',
      port: 54321,
      path: '/',
      _defaultAgent: { createConnection: callback },
    })],
    ['HTTPS createConnection', (callback) => https.request({
      host: '127.0.0.1', port: 54321, path: '/', createConnection: callback,
    })],
    ['HTTP socketPath', () => http.request({
      host: '127.0.0.1', port: 54321, path: '/', socketPath: '/hostile/socket',
    })],
    ['TCP lookup', (callback) => net.connect({
      host: '127.0.0.1', port: 54321, lookup: callback,
    })],
    ['TCP inherited lookup', (callback) => net.connect(Object.assign(
      Object.create({ lookup: callback }),
      { host: '127.0.0.1', port: 54321 },
    ))],
    ['HTTP accessor lookup', (callback) => {
      const options = { host: '127.0.0.1', port: 54321, path: '/' };
      Object.defineProperty(options, 'lookup', { get: callback });
      return http.request(options);
    }],
    ['direct Socket path', () => new net.Socket().connect({ path: '/hostile/socket' })],
    ['TLS second-argument lookup', (callback) => tls.connect(
      54321,
      { host: '127.0.0.1', lookup: callback },
    )],
    ['TLS socket override', () => tls.connect({
      host: '127.0.0.1', port: 54321, socket: {},
    })],
    ['UDP lookup', (callback) => dgram.createSocket({ type: 'udp4', lookup: callback })],
  ])('rejects a safe declared host with a custom %s route before its callback', (
    _name,
    attempt,
  ) => {
    const previous = process.env.TEST_SAFETY_EMULATOR_HOST;
    process.env.TEST_SAFETY_EMULATOR_HOST = '127.0.0.1:54321';
    const callback = jest.fn();
    try {
      expectSafeError(() => attempt(callback), NETWORK_ERROR_MESSAGE, '/hostile/socket');
      expect(callback).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.TEST_SAFETY_EMULATOR_HOST;
      else process.env.TEST_SAFETY_EMULATOR_HOST = previous;
    }
  });

  test('rejects and destroys an unmarked HTTP/2 factory socket before provider contact', () => {
    const previous = process.env.TEST_SAFETY_EMULATOR_HOST;
    process.env.TEST_SAFETY_EMULATOR_HOST = '127.0.0.1:54321';
    const socket = { destroy: jest.fn() };
    const createConnection = jest.fn(() => socket);
    try {
      expectSafeError(
        () => http2.connect('http://127.0.0.1:54321', { createConnection }),
        NETWORK_ERROR_MESSAGE,
      );
      expect(createConnection).toHaveBeenCalledTimes(1);
      expect(socket.destroy).toHaveBeenCalledTimes(1);
    } finally {
      if (previous === undefined) delete process.env.TEST_SAFETY_EMULATOR_HOST;
      else process.env.TEST_SAFETY_EMULATOR_HOST = previous;
    }
  });

  test('rejects a safe fetch target with a custom dispatcher before dispatch', () => {
    if (typeof globalThis.fetch !== 'function') return;
    const previous = process.env.TEST_SAFETY_EMULATOR_HOST;
    process.env.TEST_SAFETY_EMULATOR_HOST = '127.0.0.1:54321';
    const dispatch = jest.fn();
    try {
      expectSafeError(
        () => globalThis.fetch('http://127.0.0.1:54321/', {
          dispatcher: { dispatch },
        }),
        NETWORK_ERROR_MESSAGE,
      );
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.TEST_SAFETY_EMULATOR_HOST;
      else process.env.TEST_SAFETY_EMULATOR_HOST = previous;
    }
  });

  test('rejects a routing hook inherited through Object.prototype pollution', () => {
    const previous = process.env.TEST_SAFETY_EMULATOR_HOST;
    const lookup = jest.fn();
    process.env.TEST_SAFETY_EMULATOR_HOST = '127.0.0.1:54321';
    Object.defineProperty(Object.prototype, 'lookup', {
      configurable: true,
      value: lookup,
    });
    try {
      expectSafeError(
        () => net.connect({ host: '127.0.0.1', port: 54321 }),
        NETWORK_ERROR_MESSAGE,
      );
      expect(lookup).not.toHaveBeenCalled();
    } finally {
      delete Object.prototype.lookup;
      if (previous === undefined) delete process.env.TEST_SAFETY_EMULATOR_HOST;
      else process.env.TEST_SAFETY_EMULATOR_HOST = previous;
    }
  });

  test('resolves exact loopback names synthetically without outside DNS', async () => {
    await expect(dns.promises.lookup('127.0.0.1')).resolves.toEqual({
      address: '127.0.0.1',
      family: 4,
    });
    await expect(dns.promises.lookup('localhost', { family: 6 })).resolves.toEqual({
      address: '::1',
      family: 6,
    });
    await expect(dns.promises.lookup('::1', { all: true })).resolves.toEqual([{
      address: '::1',
      family: 6,
    }]);

    await expect(new Promise((resolve, reject) => {
      dns.lookup('localhost', (error, address, family) => {
        if (error) reject(error);
        else resolve({ address, family });
      });
    })).resolves.toEqual({ address: '127.0.0.1', family: 4 });
  });

  test('allows an HTTP request whose declared emulator target defaults to localhost', async () => {
    const server = http.createServer((_request, response) => response.end('synthetic-ok'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const previous = process.env.TEST_SAFETY_EMULATOR_HOST;
    process.env.TEST_SAFETY_EMULATOR_HOST = `localhost:${port}`;
    try {
      const body = await new Promise((resolve, reject) => {
        http.get({ port, path: '/' }, (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        }).on('error', reject);
      });
      expect(body).toBe('synthetic-ok');
    } finally {
      if (previous === undefined) delete process.env.TEST_SAFETY_EMULATOR_HOST;
      else process.env.TEST_SAFETY_EMULATOR_HOST = previous;
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('allows a UDP connection to its exact declared loopback endpoint', async () => {
    const server = dgram.createSocket('udp4');
    await new Promise((resolve) => server.bind(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const previous = process.env.TEST_UDP_EMULATOR_HOST;
    process.env.TEST_UDP_EMULATOR_HOST = `127.0.0.1:${port}`;
    const client = dgram.createSocket('udp4');
    try {
      await new Promise((resolve, reject) => {
        client.once('error', reject);
        client.connect(port, '127.0.0.1', resolve);
      });
      expect(client.remoteAddress()).toMatchObject({
        address: '127.0.0.1',
        family: 'IPv4',
        port,
      });
    } finally {
      client.close();
      await new Promise((resolve) => server.close(resolve));
      if (previous === undefined) delete process.env.TEST_UDP_EMULATOR_HOST;
      else process.env.TEST_UDP_EMULATOR_HOST = previous;
    }
  });

});
