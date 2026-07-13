const {
  CONFIGURATION_ERROR_MESSAGE,
  ServerConfigError,
  parseServerConfig,
} = require('./serverConfig');

function serverKey(mode, type = 'sk') {
  return `${type}_${mode}_synthetic_config_key`;
}

const TEST_KEY = serverKey('test');
const LIVE_KEY = serverKey('live');

function validEnvironment(overrides = {}) {
  return {
    ENVIRONMENT_NAME: 'test',
    SITE_ORIGIN: 'https://runmprc.test',
    STRIPE_LIVEMODE_EXPECTED: 'false',
    STRIPE_SECRET_KEY: TEST_KEY,
    ...overrides,
  };
}

function captureConfigError(environment, options = {}) {
  try {
    parseServerConfig(environment, options);
  } catch (error) {
    return error;
  }
  throw new Error('Expected server configuration to be rejected');
}

describe('serverConfig', () => {
  test.each([
    ['local loopback', {
      ENVIRONMENT_NAME: 'local',
      SITE_ORIGIN: 'http://localhost:3000',
      STRIPE_LIVEMODE_EXPECTED: 'false',
      STRIPE_SECRET_KEY: TEST_KEY,
    }],
    ['local IPv4 loopback', {
      ENVIRONMENT_NAME: 'local',
      SITE_ORIGIN: 'http://127.0.0.1:5001',
      STRIPE_LIVEMODE_EXPECTED: 'false',
      STRIPE_SECRET_KEY: TEST_KEY,
    }],
    ['local IPv6 loopback', {
      ENVIRONMENT_NAME: 'local',
      SITE_ORIGIN: 'http://[::1]:5001',
      STRIPE_LIVEMODE_EXPECTED: 'false',
      STRIPE_SECRET_KEY: TEST_KEY,
    }],
    ['test synthetic host', validEnvironment()],
    ['staging club subdomain', {
      ENVIRONMENT_NAME: 'staging',
      SITE_ORIGIN: 'https://dev.runmprc.com',
      STRIPE_LIVEMODE_EXPECTED: 'false',
      STRIPE_SECRET_KEY: serverKey('test', 'rk'),
    }],
    ['production canonical origin', {
      ENVIRONMENT_NAME: 'production',
      SITE_ORIGIN: 'https://runmprc.com',
      STRIPE_LIVEMODE_EXPECTED: 'true',
      STRIPE_SECRET_KEY: LIVE_KEY,
    }],
    ['production restricted server key', {
      ENVIRONMENT_NAME: 'production',
      SITE_ORIGIN: 'https://runmprc.com',
      STRIPE_LIVEMODE_EXPECTED: 'true',
      STRIPE_SECRET_KEY: serverKey('live', 'rk'),
    }],
  ])('accepts %s without returning the Stripe key', (_name, environment) => {
    const config = parseServerConfig(environment, { requireStripeKey: true });

    expect(config).toEqual({
      environmentName: environment.ENVIRONMENT_NAME,
      siteOrigin: environment.SITE_ORIGIN,
      stripeLivemodeExpected: environment.STRIPE_LIVEMODE_EXPECTED === 'true',
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(JSON.stringify(config)).not.toContain(environment.STRIPE_SECRET_KEY);
  });

  test('base webhook and mail configuration does not require a Stripe API key', () => {
    const environment = validEnvironment();
    delete environment.STRIPE_SECRET_KEY;

    expect(parseServerConfig(environment)).toEqual({
      environmentName: 'test',
      siteOrigin: 'https://runmprc.test',
      stripeLivemodeExpected: false,
    });
  });

  test.each([
    ['missing environment', { ENVIRONMENT_NAME: undefined }, 'environment_name_missing'],
    ['unknown environment', { ENVIRONMENT_NAME: 'preview' }, 'environment_name_invalid'],
    ['padded environment', { ENVIRONMENT_NAME: ' test ' }, 'environment_name_invalid'],
    ['missing origin', { SITE_ORIGIN: undefined }, 'site_origin_missing'],
    ['malformed origin', { SITE_ORIGIN: 'not a URL' }, 'site_origin_invalid'],
    ['credential-bearing origin', {
      SITE_ORIGIN: 'https://member:password@runmprc.test',
    }, 'site_origin_invalid'],
    ['origin path', { SITE_ORIGIN: 'https://runmprc.test/account' }, 'site_origin_invalid'],
    ['origin query', { SITE_ORIGIN: 'https://runmprc.test?next=account' }, 'site_origin_invalid'],
    ['origin fragment', { SITE_ORIGIN: 'https://runmprc.test#account' }, 'site_origin_invalid'],
    ['origin trailing slash', { SITE_ORIGIN: 'https://runmprc.test/' }, 'site_origin_invalid'],
    ['origin default port alias', {
      SITE_ORIGIN: 'https://runmprc.test:443',
    }, 'site_origin_invalid'],
    ['origin uppercase alias', {
      SITE_ORIGIN: 'https://RUNMPRC.test',
    }, 'site_origin_invalid'],
    ['local external host', {
      ENVIRONMENT_NAME: 'local',
      SITE_ORIGIN: 'http://example.test',
    }, 'site_origin_environment_mismatch'],
    ['deceptive local host', {
      ENVIRONMENT_NAME: 'local',
      SITE_ORIGIN: 'http://localhost.example.test',
    }, 'site_origin_environment_mismatch'],
    ['unspecified local address', {
      ENVIRONMENT_NAME: 'local',
      SITE_ORIGIN: 'http://0.0.0.0:3000',
    }, 'site_origin_environment_mismatch'],
    ['insecure test origin', {
      SITE_ORIGIN: 'http://runmprc.test',
    }, 'site_origin_environment_mismatch'],
    ['test non-synthetic host', {
      SITE_ORIGIN: 'https://example.com',
    }, 'site_origin_environment_mismatch'],
    ['test bare reserved suffix', {
      SITE_ORIGIN: 'https://.test',
    }, 'site_origin_environment_mismatch'],
    ['test empty DNS label', {
      SITE_ORIGIN: 'https://foo..test',
    }, 'site_origin_environment_mismatch'],
    ['test leading label hyphen', {
      SITE_ORIGIN: 'https://-foo.test',
    }, 'site_origin_environment_mismatch'],
    ['test trailing label hyphen', {
      SITE_ORIGIN: 'https://foo-.test',
    }, 'site_origin_environment_mismatch'],
    ['test invalid label character', {
      SITE_ORIGIN: 'https://_.test',
    }, 'site_origin_environment_mismatch'],
    ['test overlong DNS label', {
      SITE_ORIGIN: `https://${'a'.repeat(64)}.test`,
    }, 'site_origin_environment_mismatch'],
    ['test overlong DNS name', {
      SITE_ORIGIN: `https://${`${'a'.repeat(63)}.`.repeat(4)}test`,
    }, 'site_origin_environment_mismatch'],
    ['insecure staging origin', {
      ENVIRONMENT_NAME: 'staging',
      SITE_ORIGIN: 'http://dev.runmprc.com',
    }, 'site_origin_environment_mismatch'],
    ['outside staging domain', {
      ENVIRONMENT_NAME: 'staging',
      SITE_ORIGIN: 'https://example.com',
    }, 'site_origin_environment_mismatch'],
    ['production origin in staging', {
      ENVIRONMENT_NAME: 'staging',
      SITE_ORIGIN: 'https://runmprc.com',
    }, 'site_origin_environment_mismatch'],
    ['unapproved club subdomain in staging', {
      ENVIRONMENT_NAME: 'staging',
      SITE_ORIGIN: 'https://staging.runmprc.com',
    }, 'site_origin_environment_mismatch'],
    ['noncanonical production origin', {
      ENVIRONMENT_NAME: 'production',
      SITE_ORIGIN: 'https://www.runmprc.com',
      STRIPE_LIVEMODE_EXPECTED: 'true',
      STRIPE_SECRET_KEY: LIVE_KEY,
    }, 'site_origin_environment_mismatch'],
    ['missing expected mode', {
      STRIPE_LIVEMODE_EXPECTED: undefined,
    }, 'stripe_mode_missing'],
    ['malformed expected mode', {
      STRIPE_LIVEMODE_EXPECTED: 'FALSE',
    }, 'stripe_mode_invalid'],
    ['live mode in test', {
      STRIPE_LIVEMODE_EXPECTED: 'true',
      STRIPE_SECRET_KEY: LIVE_KEY,
    }, 'stripe_mode_environment_mismatch'],
    ['test mode in production', {
      ENVIRONMENT_NAME: 'production',
      SITE_ORIGIN: 'https://runmprc.com',
      STRIPE_LIVEMODE_EXPECTED: 'false',
    }, 'stripe_mode_environment_mismatch'],
  ])('rejects %s with a fixed safe error', (_name, overrides, reason) => {
    const environment = validEnvironment(overrides);
    Object.keys(environment).forEach((key) => {
      if (environment[key] === undefined) delete environment[key];
    });

    const error = captureConfigError(environment, { requireStripeKey: true });

    expect(error).toBeInstanceOf(ServerConfigError);
    expect(error.message).toBe(CONFIGURATION_ERROR_MESSAGE);
    expect(error.reason).toBe(reason);
    expect(error.stack).not.toContain(environment.STRIPE_SECRET_KEY);
  });

  test.each([
    ['missing key', undefined, 'stripe_key_missing'],
    ['blank key', '', 'stripe_key_missing'],
    ['padded key', ` ${TEST_KEY}`, 'stripe_key_invalid'],
    ['unrecognized key', 'synthetic_unknown_key', 'stripe_key_invalid'],
    ['publishable key', serverKey('test', 'pk'), 'stripe_key_invalid'],
    ['webhook secret', ['whsec', 'synthetic_config_value'].join('_'), 'stripe_key_invalid'],
    ['test prefix only', 'sk_test_', 'stripe_key_invalid'],
    ['live prefix only', 'rk_live_', 'stripe_key_invalid'],
    ['live key in test', LIVE_KEY, 'stripe_key_environment_mismatch'],
    ['live restricted key in staging', serverKey('live', 'rk'), 'stripe_key_environment_mismatch'],
  ])('rejects %s before exposing key material', (_name, key, reason) => {
    const environment = validEnvironment({ STRIPE_SECRET_KEY: key });
    if (key === undefined) delete environment.STRIPE_SECRET_KEY;

    const error = captureConfigError(environment, { requireStripeKey: true });

    expect(error).toBeInstanceOf(ServerConfigError);
    expect(error.message).toBe(CONFIGURATION_ERROR_MESSAGE);
    expect(error.reason).toBe(reason);
    expect(error.stack).not.toContain(key || 'synthetic_unknown_key');
  });

  test.each([serverKey('test'), serverKey('test', 'rk')])(
    'rejects test key %s in production',
    (key) => {
      const environment = {
        ENVIRONMENT_NAME: 'production',
        SITE_ORIGIN: 'https://runmprc.com',
        STRIPE_LIVEMODE_EXPECTED: 'true',
        STRIPE_SECRET_KEY: key,
      };

      const error = captureConfigError(environment, { requireStripeKey: true });

      expect(error.reason).toBe('stripe_key_environment_mismatch');
      expect(error.message).toBe(CONFIGURATION_ERROR_MESSAGE);
      expect(error.stack).not.toContain(key);
    },
  );

  test('does not serialize a supplied unsafe value or the complete key', () => {
    const unsafeOrigin = 'https://member:password@runmprc.test/private?token=canary';
    const environment = validEnvironment({ SITE_ORIGIN: unsafeOrigin });

    const error = captureConfigError(environment, { requireStripeKey: true });

    expect(JSON.stringify(error)).toBe('{}');
    expect(error.stack).not.toContain(unsafeOrigin);
    expect(error.stack).not.toContain(TEST_KEY);
  });
});
