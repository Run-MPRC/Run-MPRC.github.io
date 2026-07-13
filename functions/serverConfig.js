const functions = require('firebase-functions');

const CONFIGURATION_ERROR_MESSAGE = 'Server configuration is unavailable';
const ENVIRONMENT_NAMES = new Set(['local', 'test', 'staging', 'production']);
const STAGING_SITE_ORIGIN = 'https://dev.runmprc.com';
const PRODUCTION_SITE_ORIGIN = 'https://runmprc.com';

/**
 * @typedef {'local'|'test'|'staging'|'production'} EnvironmentName
 */

/**
 * @typedef {Object} ServerConfig
 * @property {EnvironmentName} environmentName
 * @property {string} siteOrigin
 * @property {boolean} stripeLivemodeExpected
 * @property {boolean} [commerceEnabled]
 */

class ServerConfigError extends Error {
  constructor(reason) {
    super(CONFIGURATION_ERROR_MESSAGE);
    Object.defineProperty(this, 'name', {
      value: 'ServerConfigError',
      enumerable: false,
    });
    Object.defineProperty(this, 'reason', {
      value: reason,
      enumerable: false,
    });
    Error.captureStackTrace?.(this, ServerConfigError);
  }
}

function reject(reason) {
  throw new ServerConfigError(reason);
}

function requiredExactString(environment, name, missingReason, invalidReason) {
  const value = environment?.[name];
  if (typeof value !== 'string' || value.length === 0) reject(missingReason);
  if (value.trim() !== value) reject(invalidReason);
  return value;
}

function parseCanonicalOrigin(rawOrigin) {
  let parsed;
  try {
    parsed = new URL(rawOrigin);
  } catch {
    reject('site_origin_invalid');
  }

  if (parsed.origin !== rawOrigin
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== '') {
    reject('site_origin_invalid');
  }
  return parsed;
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '[::1]'
    || hostname === '::1';
}

function isValidDnsLabel(label) {
  return label.length >= 1
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label);
}

function isSyntheticTestHost(hostname) {
  if (hostname.length > 253 || !hostname.endsWith('.test')) return false;
  const syntheticName = hostname.slice(0, -'.test'.length);
  return syntheticName.length > 0
    && syntheticName.split('.').every(isValidDnsLabel);
}

function originMatchesEnvironment(environmentName, rawOrigin, parsedOrigin) {
  if (environmentName === 'local') {
    return (parsedOrigin.protocol === 'http:' || parsedOrigin.protocol === 'https:')
      && isLoopbackHost(parsedOrigin.hostname);
  }
  if (environmentName === 'test') {
    return parsedOrigin.protocol === 'https:'
      && isSyntheticTestHost(parsedOrigin.hostname);
  }
  if (environmentName === 'staging') return rawOrigin === STAGING_SITE_ORIGIN;
  return rawOrigin === PRODUCTION_SITE_ORIGIN;
}

function stripeServerKeyMode(key) {
  const modes = [
    ['sk_test_', false],
    ['rk_test_', false],
    ['sk_live_', true],
    ['rk_live_', true],
  ];
  const matched = modes.find(([prefix]) => key.startsWith(prefix));
  if (!matched || key.length === matched[0].length) return null;
  return matched[1];
}

function validateStripeServerKey(environment, expectedLivemode) {
  const key = environment?.STRIPE_SECRET_KEY;
  if (typeof key !== 'string' || key.length === 0) reject('stripe_key_missing');
  if (key.trim() !== key) reject('stripe_key_invalid');
  const keyLivemode = stripeServerKeyMode(key);
  if (keyLivemode === null) reject('stripe_key_invalid');
  if (keyLivemode !== expectedLivemode) reject('stripe_key_environment_mismatch');
}

function parseCommerceCeiling(environment) {
  const value = requiredExactString(
    environment,
    'COMMERCE_ENABLED',
    'commerce_enabled_missing',
    'commerce_enabled_invalid',
  );
  if (value !== 'true' && value !== 'false') reject('commerce_enabled_invalid');
  return value === 'true';
}

/**
 * Parse a supplied environment object without retaining secret material.
 *
 * @param {NodeJS.ProcessEnv|Object<string, string|undefined>} environment
 * @param {{requireStripeKey?: boolean, requireCommerceCeiling?: boolean}} options
 * @returns {Readonly<ServerConfig>}
 */
function parseServerConfig(environment, {
  requireStripeKey = false,
  requireCommerceCeiling = false,
} = {}) {
  const environmentName = requiredExactString(
    environment,
    'ENVIRONMENT_NAME',
    'environment_name_missing',
    'environment_name_invalid',
  );
  if (!ENVIRONMENT_NAMES.has(environmentName)) reject('environment_name_invalid');

  const siteOrigin = requiredExactString(
    environment,
    'SITE_ORIGIN',
    'site_origin_missing',
    'site_origin_invalid',
  );
  const parsedOrigin = parseCanonicalOrigin(siteOrigin);
  if (!originMatchesEnvironment(environmentName, siteOrigin, parsedOrigin)) {
    reject('site_origin_environment_mismatch');
  }

  const stripeMode = requiredExactString(
    environment,
    'STRIPE_LIVEMODE_EXPECTED',
    'stripe_mode_missing',
    'stripe_mode_invalid',
  );
  if (stripeMode !== 'true' && stripeMode !== 'false') reject('stripe_mode_invalid');
  const stripeLivemodeExpected = stripeMode === 'true';
  if (stripeLivemodeExpected !== (environmentName === 'production')) {
    reject('stripe_mode_environment_mismatch');
  }

  if (requireStripeKey) validateStripeServerKey(environment, stripeLivemodeExpected);

  const commerceEnabled = requireCommerceCeiling
    ? parseCommerceCeiling(environment)
    : undefined;

  const config = {
    environmentName,
    siteOrigin,
    stripeLivemodeExpected,
  };
  if (requireCommerceCeiling) config.commerceEnabled = commerceEnabled;
  return Object.freeze(config);
}

function loadServerConfig(options) {
  return parseServerConfig(process.env, options);
}

function loadCallableServerConfig(options) {
  try {
    return loadServerConfig(options);
  } catch (error) {
    if (!(error instanceof ServerConfigError)) throw error;
    throw new functions.https.HttpsError(
      'failed-precondition',
      CONFIGURATION_ERROR_MESSAGE,
    );
  }
}

module.exports = {
  CONFIGURATION_ERROR_MESSAGE,
  ServerConfigError,
  loadCallableServerConfig,
  loadServerConfig,
  parseServerConfig,
};
