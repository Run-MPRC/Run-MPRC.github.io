const crypto = require('crypto');
const dgram = require('dgram');
const dns = require('dns');
const http = require('http');
const http2 = require('http2');
const https = require('https');
const net = require('net');
const tls = require('tls');

const TEST_INPUT_ERROR_MESSAGE = 'Unsafe Functions test input.';
const TEST_ENVIRONMENT_ERROR_MESSAGE = 'Unsafe Functions test environment.';
const NETWORK_ERROR_MESSAGE = 'External network is blocked in Functions tests.';

const CORE_GUARD_STATE = Symbol.for('runmprc.functionsTestSafety.coreGuard');
const FETCH_GUARD_STATE = Symbol.for('runmprc.functionsTestSafety.fetchGuard');
const DGRAM_ENDPOINT_STATE = Symbol.for('runmprc.functionsTestSafety.dgramEndpoint');
const APPROVED_SOCKET_ENDPOINTS = new WeakMap();
const SAFE_EVENT_TYPES = new Set([
  'checkout.session.completed',
]);
const PROJECT_ENVIRONMENT_KEYS = [
  'GCLOUD_PROJECT',
  'GOOGLE_CLOUD_PROJECT',
  'FIREBASE_PROJECT_ID',
];
const CLOUD_AUTHORITY_KEYS = new Set([
  'FIREBASE_CREDENTIALS',
  'FIREBASE_SERVICE_ACCOUNT',
  'FIREBASE_SERVICE_ACCOUNT_KEY',
  'FIREBASE_TOKEN',
  'GCLOUD_SERVICE_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  'GOOGLE_CLOUD_CREDENTIALS',
  'GOOGLE_CLOUD_KEYFILE_JSON',
  'GOOGLE_SERVICE_ACCOUNT',
]);

function isCloudAuthorityKey(key) {
  if (!/^(?:FIREBASE|GCLOUD|GOOGLE)_/.test(key)) return false;
  const tokens = new Set(key.split('_'));
  return ['CREDENTIAL', 'CREDENTIALS', 'KEY', 'SECRET', 'TOKEN']
    .some((token) => tokens.has(token))
    || (tokens.has('SERVICE') && tokens.has('ACCOUNT'));
}

function rejectInput() {
  throw new Error(TEST_INPUT_ERROR_MESSAGE);
}

function rejectEnvironment() {
  throw new Error(TEST_ENVIRONMENT_ERROR_MESSAGE);
}

function rejectNetwork() {
  throw new Error(NETWORK_ERROR_MESSAGE);
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function syntheticToken(seed) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 999999) rejectInput();
  return seed.toString(10).padStart(6, '0');
}

function createSyntheticContact(seed = 1) {
  if (arguments.length > 1) rejectInput();
  const token = syntheticToken(seed);
  const reservedPhoneSuffix = (100 + (seed % 100)).toString(10);
  return deepFreeze({
    fixture: 'synthetic-contact-v1',
    fullName: `Synthetic Runner ${token}`,
    email: `runner-${token}@example.test`,
    phoneNumber: `+12025550${reservedPhoneSuffix}`,
    address: {
      line1: `${100 + (seed % 900)} Test Only Avenue`,
      line2: null,
      city: 'Example',
      state: 'CA',
      postalCode: '00000',
      country: 'US',
    },
  });
}

function createSyntheticMember(seed = 1) {
  if (arguments.length > 1) rejectInput();
  const token = syntheticToken(seed);
  return deepFreeze({
    fixture: 'synthetic-member-v1',
    uid: `member_test_${token}`,
    emailVerified: true,
    membershipStatus: 'synthetic_test_only',
    contact: createSyntheticContact(seed),
  });
}

function createSyntheticOrder(seed = 1) {
  if (arguments.length > 1) rejectInput();
  const token = syntheticToken(seed);
  return deepFreeze({
    fixture: 'synthetic-order-v1',
    id: `order_test_${token}`,
    memberId: `member_test_${token}`,
    status: 'pending',
    amountCents: 2500 + (seed % 500),
    currency: 'usd',
    contact: createSyntheticContact(seed),
    items: [{
      sku: 'synthetic_test_item',
      quantity: 1,
    }],
  });
}

function createSyntheticStripeEvent(seed = 1, type = 'checkout.session.completed') {
  if (arguments.length > 2) rejectInput();
  const token = syntheticToken(seed);
  if (!SAFE_EVENT_TYPES.has(type)) rejectInput();
  return deepFreeze({
    id: `evt_test_${token}`,
    object: 'event',
    api_version: '2023-10-16',
    created: 1800000000 + seed,
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type,
    data: {
      object: {
        id: `cs_test_${token}`,
        object: 'checkout.session',
        livemode: false,
        mode: 'payment',
        payment_status: 'paid',
        amount_total: 2500 + (seed % 500),
        currency: 'usd',
        metadata: {
          fixture: 'synthetic_test_only',
          orderId: `order_test_${token}`,
        },
      },
    },
  });
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSyntheticSecret(secret) {
  return typeof secret === 'string'
    && secret.length >= 12
    && secret.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(secret)
    && /(test|synthetic|example|demo)/.test(secret)
    && !/^(?:sk|rk|pk)_live_/.test(secret)
    && !/^whsec_/.test(secret);
}

function createSignedStripePayload(input) {
  try {
    if (!isPlainRecord(input)) rejectInput();
    const inputDescriptors = Object.getOwnPropertyDescriptors(input);
    const expectedInputKeys = ['event', 'secret', 'timestamp'];
    if (Reflect.ownKeys(inputDescriptors).length !== expectedInputKeys.length
      || expectedInputKeys.some((key) => (
        !Object.prototype.hasOwnProperty.call(inputDescriptors, key)
        || !Object.prototype.hasOwnProperty.call(inputDescriptors[key], 'value')
      ))) {
      rejectInput();
    }
    const event = inputDescriptors.event.value;
    const secret = inputDescriptors.secret.value;
    const timestamp = inputDescriptors.timestamp.value;

    return createSignedStripePayloadFromValues(event, secret, timestamp);
  } catch {
    rejectInput();
  }
}

function createSignedStripePayloadFromValues(event, secret, timestamp) {
  const eventDescriptors = isPlainRecord(event) ? Object.getOwnPropertyDescriptors(event) : null;
  if (!isPlainRecord(event)
    || !eventDescriptors
    || Reflect.ownKeys(eventDescriptors).some((key) => (
      typeof key !== 'string'
      || !Object.prototype.hasOwnProperty.call(eventDescriptors[key], 'value')
      || typeof eventDescriptors[key].value === 'function'
    ))
    || event.object !== 'event'
    || typeof event.livemode !== 'boolean'
    || !isPlainRecord(event.data)
    || !isSyntheticSecret(secret)
    || !Number.isSafeInteger(timestamp)
    || timestamp < 1
    || timestamp > 4102444800) {
    rejectInput();
  }

  const serialized = JSON.stringify(event);
  if (typeof serialized !== 'string' || serialized.length < 2 || serialized.length > 1048576) {
    rejectInput();
  }
  const serializedEvent = JSON.parse(serialized);
  if (!isPlainRecord(serializedEvent)
    || serializedEvent.object !== 'event'
    || typeof serializedEvent.livemode !== 'boolean'
    || !isPlainRecord(serializedEvent.data)) {
    rejectInput();
  }

  const rawBody = Buffer.from(serialized, 'utf8');
  if (rawBody.length > 1048576) rejectInput();
  const digest = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.`, 'utf8')
    .update(rawBody)
    .digest('hex');
  return Object.freeze({
    rawBody,
    signatureHeader: `t=${timestamp},v1=${digest}`,
  });
}

function supplied(environment, key) {
  return Object.prototype.hasOwnProperty.call(environment, key)
    && environment[key] !== undefined;
}

function isSafeProjectId(projectId) {
  return typeof projectId === 'string'
    && projectId.length >= 10
    && projectId.length <= 63
    && /^demo-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(projectId)
    && /(?:^|-)(?:test|local)(?:-|$)/.test(projectId);
}

function normalizeLoopbackHost(host) {
  if (host === '[::1]' || host === '::1') return '::1';
  if (host === '127.0.0.1' || host === 'localhost') return host;
  return null;
}

function parseEmulatorHost(value) {
  if (typeof value !== 'string' || value === '' || value.trim() !== value
    || value.includes('/') || value.includes('@') || value.includes('?') || value.includes('#')) {
    rejectEnvironment();
  }
  let parsed;
  try {
    parsed = new URL(`http://${value}`);
  } catch {
    rejectEnvironment();
  }
  const host = normalizeLoopbackHost(parsed.hostname);
  const port = Number(parsed.port);
  if (!host
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== ''
    || !Number.isInteger(port)
    || port < 1
    || port > 65535) {
    rejectEnvironment();
  }
  return { host, port };
}

function isSafeTestDnsName(hostname) {
  if (!hostname.endsWith('.test') || hostname === '.test' || hostname.length > 253) return false;
  return hostname.split('.').every((label) => (
    label.length >= 1
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ));
}

function assertSafeOrigin(value) {
  if (typeof value !== 'string' || value === '' || value.trim() !== value) rejectEnvironment();
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    rejectEnvironment();
  }
  if (parsed.origin !== value
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== '') {
    rejectEnvironment();
  }
  const loopback = normalizeLoopbackHost(parsed.hostname);
  if (loopback) {
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.port === '') rejectEnvironment();
    return;
  }
  if (parsed.protocol !== 'https:' || parsed.port !== '' || !isSafeTestDnsName(parsed.hostname)) {
    rejectEnvironment();
  }
}

function assertSafeStripeValue(key, value) {
  if (typeof value !== 'string' || value === '' || value.trim() !== value) rejectEnvironment();
  const keyTokens = new Set(key.split('_'));
  if (keyTokens.has('LIVEMODE')) {
    if (value !== 'false') rejectEnvironment();
    return;
  }
  if (keyTokens.has('MODE')) {
    if (value !== 'test') rejectEnvironment();
    return;
  }
  if (keyTokens.has('KEY') || keyTokens.has('SECRET')) {
    if (!isSyntheticSecret(value)) rejectEnvironment();
  }
}

function assertSafeTestEnvironment(environment = process.env) {
  try {
    return assertSafeTestEnvironmentValues(environment);
  } catch {
    rejectEnvironment();
  }
}

function assertSafeTestEnvironmentValues(environment) {
  if (!environment || typeof environment !== 'object') rejectEnvironment();

  if (supplied(environment, 'ENVIRONMENT_NAME')
    && !['local', 'test'].includes(environment.ENVIRONMENT_NAME)) {
    rejectEnvironment();
  }
  if (supplied(environment, 'SITE_ORIGIN')) assertSafeOrigin(environment.SITE_ORIGIN);

  PROJECT_ENVIRONMENT_KEYS.forEach((key) => {
    if (supplied(environment, key) && !isSafeProjectId(environment[key])) rejectEnvironment();
  });

  if (supplied(environment, 'FIREBASE_CONFIG')) {
    let config;
    try {
      config = JSON.parse(environment.FIREBASE_CONFIG);
    } catch {
      rejectEnvironment();
    }
    const allowedKeys = new Set(['databaseURL', 'projectId', 'storageBucket']);
    const keys = isPlainRecord(config) ? Object.keys(config) : [];
    if (!isPlainRecord(config)
      || !isSafeProjectId(config.projectId)
      || keys.some((key) => !allowedKeys.has(key))
      || (config.databaseURL !== undefined
        && ![
          `https://${config.projectId}.firebaseio.com`,
          `https://${config.projectId}-default-rtdb.firebaseio.com`,
        ].includes(config.databaseURL))
      || (config.storageBucket !== undefined
        && config.storageBucket !== `${config.projectId}.appspot.com`)) {
      rejectEnvironment();
    }
  }

  Object.keys(environment).forEach((key) => {
    if (CLOUD_AUTHORITY_KEYS.has(key) || isCloudAuthorityKey(key)) {
      rejectEnvironment();
    }
    if (key.endsWith('_EMULATOR_HOST')) parseEmulatorHost(environment[key]);
    const stripeKeyTokens = key.startsWith('STRIPE_') ? new Set(key.split('_')) : null;
    if (stripeKeyTokens
      && ['KEY', 'SECRET', 'MODE', 'LIVEMODE']
        .some((token) => stripeKeyTokens.has(token))) {
      assertSafeStripeValue(key, environment[key]);
    }
  });
  return true;
}

function configuredEmulatorEndpoints(environment = process.env) {
  assertSafeTestEnvironment(environment);
  const endpoints = new Set();
  Object.keys(environment).forEach((key) => {
    if (!key.endsWith('_EMULATOR_HOST')) return;
    const { host, port } = parseEmulatorHost(environment[key]);
    endpoints.add(`${host}:${port}`);
  });
  return endpoints;
}

function assertEndpointAllowed(host, port, environment) {
  const selectedEnvironment = environment
    || http[CORE_GUARD_STATE]?.environment
    || process.env;
  const normalizedHost = normalizeLoopbackHost(host);
  let normalizedPort;
  if (typeof port === 'number') normalizedPort = port;
  else if (typeof port === 'string'
    && /^[1-9][0-9]{0,4}$/.test(port)) {
    normalizedPort = Number.parseInt(port, 10);
    if (String(normalizedPort) !== port) rejectNetwork();
  } else {
    rejectNetwork();
  }
  if (!normalizedHost
    || !Number.isInteger(normalizedPort)
    || normalizedPort < 1
    || normalizedPort > 65535
    || !configuredEmulatorEndpoints(selectedEnvironment).has(`${normalizedHost}:${normalizedPort}`)) {
    rejectNetwork();
  }
}

function endpointFromUrl(value, expectedProtocols) {
  let parsed;
  try {
    parsed = value instanceof URL ? value : new URL(value);
  } catch {
    rejectNetwork();
  }
  if (!expectedProtocols.includes(parsed.protocol)
    || parsed.username !== ''
    || parsed.password !== '') {
    rejectNetwork();
  }
  const port = parsed.port || (parsed.protocol === 'https:' ? 443 : 80);
  return { host: parsed.hostname, port };
}

function rejectRoutingOptions(options, forbiddenKeys) {
  if (options === undefined || options === null || typeof options !== 'object') return options;
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(options);
    descriptors = Object.getOwnPropertyDescriptors(options);
  } catch {
    rejectNetwork();
  }
  try {
    if (prototype !== null && Object.getPrototypeOf(prototype) !== null) rejectNetwork();
  } catch {
    rejectNetwork();
  }
  for (const forbiddenKey of forbiddenKeys) {
    let cursor = options;
    try {
      while (cursor !== null) {
        const descriptor = Object.getOwnPropertyDescriptor(cursor, forbiddenKey);
        if (descriptor
          && descriptor.value !== undefined
          && descriptor.value !== null) {
          rejectNetwork();
        }
        cursor = Object.getPrototypeOf(cursor);
      }
    } catch {
      rejectNetwork();
    }
  }
  const snapshot = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (typeof key !== 'string'
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || (forbiddenKeys.includes(key)
        && descriptor.value !== undefined
        && descriptor.value !== null)) {
      rejectNetwork();
    }
    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: descriptor.enumerable,
      value: descriptor.value,
      writable: true,
    });
  }
  return snapshot;
}

function syntheticDnsLookup(hostname, rawOptions) {
  let options = rawOptions;
  if (options === undefined) options = {};
  else if (Number.isInteger(options)) options = { family: options };
  else options = rejectRoutingOptions(options, []);
  if (!options || typeof options !== 'object'
    || Object.keys(options).some((key) => ![
      'all', 'family', 'hints', 'order', 'verbatim',
    ].includes(key))
    || (options.family !== undefined && ![0, 4, 6].includes(options.family))
    || (options.hints !== undefined
      && (!Number.isInteger(options.hints) || options.hints < 0))
    || (options.all !== undefined && typeof options.all !== 'boolean')) {
    rejectNetwork();
  }

  let address;
  let family;
  if (hostname === '127.0.0.1' && options.family !== 6) {
    address = hostname;
    family = 4;
  } else if (hostname === '::1' && options.family !== 4) {
    address = hostname;
    family = 6;
  } else if (hostname === '0.0.0.0' && options.family !== 6) {
    address = hostname;
    family = 4;
  } else if (hostname === '::' && options.family !== 4) {
    address = hostname;
    family = 6;
  } else if (hostname === 'localhost') {
    family = options.family === 6 ? 6 : 4;
    address = family === 6 ? '::1' : '127.0.0.1';
  } else {
    rejectNetwork();
  }
  return options.all ? [{ address, family }] : { address, family };
}

function endpointFromHttpArguments(args, defaultProtocol) {
  const first = args[0];
  const optionsIndex = (typeof first === 'string' || first instanceof URL) ? 1 : 0;
  const options = args[optionsIndex];
  let endpoint = (typeof first === 'string' || first instanceof URL)
    ? endpointFromUrl(first, [`${defaultProtocol}:`])
    : null;
  if (options && typeof options === 'object') {
    const safeOptions = rejectRoutingOptions(options, [
      'agent',
      'createConnection',
      '_defaultAgent',
      'lookup',
      'localAddress',
      'socket',
      'socketPath',
    ]);
    args[optionsIndex] = safeOptions;
    const protocol = safeOptions.protocol || `${defaultProtocol}:`;
    if (protocol !== `${defaultProtocol}:`) rejectNetwork();
    const host = safeOptions.hostname || safeOptions.host || endpoint?.host || 'localhost';
    const port = safeOptions.port || endpoint?.port || (defaultProtocol === 'https' ? 443 : 80);
    endpoint = { host, port };
  }
  if (!endpoint) rejectNetwork();
  return endpoint;
}

function endpointFromSocketArguments(args, defaultPort) {
  const normalized = Array.isArray(args[0]) ? args[0] : null;
  const first = normalized ? normalized[0] : args[0];
  const routingKeys = [
    'createConnection',
    'fd',
    'handle',
    'localAddress',
    'lookup',
    'path',
    'socket',
  ];
  if (first && typeof first === 'object') {
    const safeOptions = rejectRoutingOptions(first, routingKeys);
    if (normalized) normalized[0] = safeOptions;
    else args[0] = safeOptions;
    return {
      host: safeOptions.host || safeOptions.hostname || 'localhost',
      port: safeOptions.port || defaultPort,
    };
  }
  const laterOptions = args.find((value, index) => index > 0
    && value !== null
    && typeof value === 'object');
  const safeLaterOptions = rejectRoutingOptions(laterOptions, routingKeys);
  if (laterOptions) args[args.indexOf(laterOptions)] = safeLaterOptions;
  return {
    host: typeof args[1] === 'string'
      ? args[1]
      : (safeLaterOptions?.host || safeLaterOptions?.hostname || 'localhost'),
    port: first || defaultPort,
  };
}

function guardHttpModule(module, protocol) {
  const originalRequest = module.request;
  const originalGet = module.get;
  module.request = function guardedRequest(...args) {
    const endpoint = endpointFromHttpArguments(args, protocol);
    assertEndpointAllowed(endpoint.host, endpoint.port);
    return Reflect.apply(originalRequest, this, args);
  };
  module.get = function guardedGet(...args) {
    const endpoint = endpointFromHttpArguments(args, protocol);
    assertEndpointAllowed(endpoint.host, endpoint.port);
    return Reflect.apply(originalGet, this, args);
  };
}

function guardDirectHttpClientRequest() {
  const OriginalClientRequest = http.ClientRequest;
  function GuardedClientRequest(...args) {
    const endpoint = endpointFromHttpArguments(args, 'http');
    assertEndpointAllowed(endpoint.host, endpoint.port);
    const constructor = new.target === GuardedClientRequest
      ? OriginalClientRequest
      : (new.target || OriginalClientRequest);
    return Reflect.construct(OriginalClientRequest, args, constructor);
  }
  Object.setPrototypeOf(GuardedClientRequest, OriginalClientRequest);
  GuardedClientRequest.prototype = OriginalClientRequest.prototype;
  http.ClientRequest = GuardedClientRequest;
}

function installCoreNetworkGuard() {
  if (http[CORE_GUARD_STATE]) {
    http[CORE_GUARD_STATE].environment = process.env;
    return http[CORE_GUARD_STATE];
  }

  guardHttpModule(http, 'http');
  guardHttpModule(https, 'https');
  guardDirectHttpClientRequest();

  const originalHttp2Connect = http2.connect;
  http2.connect = function guardedHttp2Connect(authority, ...args) {
    const safeOptions = rejectRoutingOptions(args[0], [
      'localAddress',
      'lookup',
      'path',
      'socket',
    ]);
    const endpoint = endpointFromUrl(authority, ['http:', 'https:']);
    assertEndpointAllowed(endpoint.host, endpoint.port);
    if (safeOptions && typeof safeOptions === 'object'
      && safeOptions.createConnection !== undefined
      && safeOptions.createConnection !== null) {
      if (typeof safeOptions.createConnection !== 'function') rejectNetwork();
      const createConnection = safeOptions.createConnection;
      let socket;
      try {
        const parsedAuthority = authority instanceof URL ? authority : new URL(authority);
        socket = createConnection(parsedAuthority, safeOptions);
      } catch (error) {
        if (error?.message === NETWORK_ERROR_MESSAGE) throw error;
        rejectNetwork();
      }
      const marker = socket && typeof socket === 'object'
        ? APPROVED_SOCKET_ENDPOINTS.get(socket)
        : null;
      const expectedHost = normalizeLoopbackHost(endpoint.host);
      const hasRemoteHost = typeof socket?.remoteAddress === 'string'
        && socket.remoteAddress !== '';
      const remoteHost = hasRemoteHost ? normalizeLoopbackHost(socket.remoteAddress) : null;
      const remoteHostMatches = !hasRemoteHost
        || remoteHost === expectedHost
        || (expectedHost === 'localhost' && ['127.0.0.1', '::1'].includes(remoteHost));
      if (!marker
        || marker.host !== expectedHost
        || marker.port !== Number(endpoint.port)
        || !remoteHostMatches
        || (socket.remotePort !== undefined
          && socket.remotePort !== Number(endpoint.port))) {
        if (socket && typeof socket.destroy === 'function') socket.destroy();
        rejectNetwork();
      }
      safeOptions.createConnection = () => socket;
    }
    args[0] = safeOptions;
    return Reflect.apply(originalHttp2Connect, this, [authority, ...args]);
  };

  const originalSocketConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedSocketConnect(...args) {
    const endpoint = endpointFromSocketArguments(args);
    assertEndpointAllowed(endpoint.host, endpoint.port);
    const result = Reflect.apply(originalSocketConnect, this, args);
    APPROVED_SOCKET_ENDPOINTS.set(this, Object.freeze({
      host: normalizeLoopbackHost(endpoint.host),
      port: Number(endpoint.port),
    }));
    return result;
  };

  const originalNetConnect = net.createConnection;
  const guardedNetConnect = function guardedNetCreateConnection(...args) {
    if (args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      args[0] = rejectRoutingOptions(args[0], [
        'createConnection',
        'fd',
        'handle',
        'localAddress',
        'lookup',
        'path',
        'socket',
      ]);
    }
    return Reflect.apply(originalNetConnect, this, args);
  };
  net.connect = guardedNetConnect;
  net.createConnection = guardedNetConnect;

  const originalTlsConnect = tls.connect;
  tls.connect = function guardedTlsConnect(...args) {
    const endpoint = endpointFromSocketArguments(args, 443);
    assertEndpointAllowed(endpoint.host, endpoint.port);
    return Reflect.apply(originalTlsConnect, this, args);
  };

  const originalCreateDgramSocket = dgram.createSocket;
  dgram.createSocket = function guardedCreateDgramSocket(options, ...args) {
    const safeOptions = rejectRoutingOptions(options, ['lookup', 'path', 'socket']);
    return Reflect.apply(originalCreateDgramSocket, this, [safeOptions, ...args]);
  };

  const originalDgramConnect = dgram.Socket.prototype.connect;
  dgram.Socket.prototype.connect = function guardedDgramConnect(port, address, ...args) {
    const endpoint = {
      host: typeof address === 'string' ? address : 'localhost',
      port,
    };
    assertEndpointAllowed(endpoint.host, endpoint.port);
    Object.defineProperty(this, DGRAM_ENDPOINT_STATE, {
      configurable: true,
      value: endpoint,
    });
    return Reflect.apply(originalDgramConnect, this, [port, address, ...args]);
  };
  const originalDgramSend = dgram.Socket.prototype.send;
  dgram.Socket.prototype.send = function guardedDgramSend(...args) {
    let port;
    let address = 'localhost';
    if (typeof args[1] === 'number' && typeof args[2] === 'number') {
      port = args[3];
      if (typeof args[4] === 'string') address = args[4];
    } else {
      port = args[1];
      if (typeof args[2] === 'string') address = args[2];
    }
    if (!Number.isInteger(port) && this[DGRAM_ENDPOINT_STATE]) {
      ({ host: address, port } = this[DGRAM_ENDPOINT_STATE]);
    }
    assertEndpointAllowed(address, port);
    return Reflect.apply(originalDgramSend, this, args);
  };

  const dnsMethodNames = [
    'lookupService',
    'resolve',
    'resolve4',
    'resolve6',
    'resolveAny',
    'resolveCaa',
    'resolveCname',
    'resolveMx',
    'resolveNaptr',
    'resolveNs',
    'resolvePtr',
    'resolveSoa',
    'resolveSrv',
    'resolveTxt',
    'reverse',
  ];
  const blockDnsMethods = (target) => {
    if (!target) return;
    dnsMethodNames.forEach((method) => {
      if (typeof target[method] !== 'function') return;
      target[method] = function blockedDnsCall() {
        rejectNetwork();
      };
    });
  };
  blockDnsMethods(dns);
  blockDnsMethods(dns.promises);
  blockDnsMethods(dns.Resolver?.prototype);
  blockDnsMethods(dns.promises?.Resolver?.prototype);
  dns.lookup = function guardedDnsLookup(hostname, options, callback) {
    let actualOptions = options;
    let actualCallback = callback;
    if (typeof options === 'function') {
      actualOptions = undefined;
      actualCallback = options;
    }
    if (typeof actualCallback !== 'function') rejectNetwork();
    const result = syntheticDnsLookup(hostname, actualOptions);
    process.nextTick(() => {
      if (Array.isArray(result)) actualCallback(null, result);
      else actualCallback(null, result.address, result.family);
    });
  };
  dns.promises.lookup = function guardedDnsPromisesLookup(hostname, options) {
    const result = syntheticDnsLookup(hostname, options);
    return Promise.resolve(result);
  };

  const state = { installed: true, environment: process.env };
  Object.defineProperty(http, CORE_GUARD_STATE, { value: state });
  return state;
}

function installFetchNetworkGuard() {
  if (globalThis[FETCH_GUARD_STATE]) return globalThis[FETCH_GUARD_STATE];
  if (typeof globalThis.fetch !== 'function') {
    const state = Object.freeze({ installed: false });
    Object.defineProperty(globalThis, FETCH_GUARD_STATE, { value: state });
    return state;
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function guardedFetch(input, ...args) {
    args[0] = rejectRoutingOptions(args[0], [
      'agent',
      'createConnection',
      'dispatcher',
      'lookup',
      'socket',
      'socketPath',
    ]);
    const target = typeof input === 'string' || input instanceof URL ? input : input?.url;
    const endpoint = endpointFromUrl(target, ['http:', 'https:']);
    assertEndpointAllowed(endpoint.host, endpoint.port);
    return Reflect.apply(originalFetch, this, [input, ...args]);
  };
  const state = Object.freeze({ installed: true });
  Object.defineProperty(globalThis, FETCH_GUARD_STATE, { value: state });
  return state;
}

function installNetworkGuard() {
  assertSafeTestEnvironment(process.env);
  installCoreNetworkGuard();
  installFetchNetworkGuard();
  return true;
}

module.exports = Object.freeze({
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
  deepFreeze,
  installNetworkGuard,
});
