'use strict';

const utilTypes = require('node:util').types;

const {
  MAX_STRIPE_PRODUCT_ID_LENGTH,
  projectCreatedStripeProductId,
  projectStoredStripeProductId,
} = require('./stripeProductBinding');

function createdProduct(overrides = {}, responseOverrides = {}) {
  const product = {
    id: 'custom_product_reference_test_only',
    object: 'product',
    livemode: false,
    ...overrides,
  };
  const lastResponse = { statusCode: 200, ...responseOverrides };
  Object.defineProperty(product, 'lastResponse', {
    configurable: false,
    enumerable: false,
    value: lastResponse,
    writable: false,
  });
  return product;
}

function throwingValue(canary) {
  return Object.freeze({
    [Symbol.iterator]() {
      throw canary;
    },
    toJSON() {
      throw canary;
    },
    toString() {
      throw canary;
    },
    valueOf() {
      throw canary;
    },
  });
}

describe('stored Stripe Product binding projection', () => {
  test.each([
    ['a one-character custom ID', 'x'],
    ['an ordinary custom ID without a Stripe prefix', 'club-race-2026/test mode'],
    ['the local maximum', 'x'.repeat(MAX_STRIPE_PRODUCT_ID_LENGTH)],
  ])('copies %s without prefix inference or mutation', (_name, stripeProductId) => {
    const resource = { stripeProductId };
    const before = Object.getOwnPropertyDescriptors(resource);

    const result = projectStoredStripeProductId(resource);
    resource.stripeProductId = 'changed-after-projection';

    expect(result).toBe(stripeProductId);
    expect(Object.getOwnPropertyDescriptors(resource)).not.toEqual(before);
    expect(typeof result).toBe('string');
  });

  test('keeps a genuinely missing field distinct from malformed present values', () => {
    expect(projectStoredStripeProductId({})).toBeUndefined();
    expect(projectStoredStripeProductId({ stripeProductId: undefined })).toBeNull();
    expect(projectStoredStripeProductId({ stripeProductId: null })).toBeNull();
  });

  test.each([
    ['empty string', ''],
    ['over-bound string', 'x'.repeat(MAX_STRIPE_PRODUCT_ID_LENGTH + 1)],
    ['false', false],
    ['zero', 0],
    ['number', 1],
    ['bigint', 1n],
    ['symbol', Symbol('synthetic-product-id')],
    ['function', () => 'synthetic-product-id'],
    ['boxed string', new String('custom_product_reference_test_only')], // eslint-disable-line no-new-wrappers
    ['array', ['custom_product_reference_test_only']],
    ['plain object', { id: 'custom_product_reference_test_only' }],
    ['map', new Map([['id', 'custom_product_reference_test_only']])],
    ['set', new Set(['custom_product_reference_test_only'])],
  ])('rejects a present %s without conversion', (_name, stripeProductId) => {
    expect(projectStoredStripeProductId({ stripeProductId })).toBeNull();
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['primitive string', 'custom_product_reference_test_only'],
    ['array', []],
    ['null-prototype record', Object.create(null)],
    ['custom-prototype record', Object.create({})],
    ['proxy', new Proxy({}, {})],
  ])('rejects a %s top-level resource', (_name, resource) => {
    expect(projectStoredStripeProductId(resource)).toBeNull();
  });

  test('rejects a revoked Proxy without invoking its traps', () => {
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();
    expect(projectStoredStripeProductId(revocable.proxy)).toBeNull();
  });

  test('rejects hidden, inherited, and accessor-backed fields without reading them', () => {
    const canary = new Error('stored Product binding getter executed');
    let getterCalls = 0;
    const hidden = {};
    Object.defineProperty(hidden, 'stripeProductId', {
      enumerable: false,
      value: 'custom_hidden_product_reference',
    });
    const inherited = Object.create({
      stripeProductId: 'custom_inherited_product_reference',
    });
    const accessor = {};
    Object.defineProperty(accessor, 'stripeProductId', {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw canary;
      },
    });

    expect(projectStoredStripeProductId(hidden)).toBeNull();
    expect(projectStoredStripeProductId(inherited)).toBeNull();
    expect(projectStoredStripeProductId(accessor)).toBeNull();
    expect(getterCalls).toBe(0);
  });

  test('rejects a shared Object prototype binding without reading it', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'stripeProductId',
    );
    let getterCalls = 0;
    Object.defineProperty(Object.prototype, 'stripeProductId', {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error('shared Product binding getter executed');
      },
    });

    try {
      expect(projectStoredStripeProductId({})).toBeNull();
      expect(getterCalls).toBe(0);
    } finally {
      if (originalDescriptor === undefined) {
        delete Object.prototype.stripeProductId;
      } else {
        Object.defineProperty(
          Object.prototype,
          'stripeProductId',
          originalDescriptor,
        );
      }
    }
  });

  test('does not inspect unrelated cyclic, symbol, or hostile fields', () => {
    const canary = new Error('unrelated Product binding field inspected');
    const resource = {
      stripeProductId: 'custom_product_reference_test_only',
      hostile: throwingValue(canary),
    };
    resource.cycle = resource;
    resource[Symbol('synthetic-unrelated-field')] = throwingValue(canary);

    expect(projectStoredStripeProductId(resource))
      .toBe('custom_product_reference_test_only');
  });

  test('uses captured platform functions after module load', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      utilTypes,
      'isProxy',
    );
    Object.defineProperty(utilTypes, 'isProxy', {
      ...originalDescriptor,
      value() {
        throw new Error('mutated isProxy invoked');
      },
    });
    const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    Object.getOwnPropertyDescriptor = () => {
      throw new Error('mutated descriptor reader invoked');
    };

    try {
      expect(projectStoredStripeProductId({
        stripeProductId: 'custom_product_reference_test_only',
      })).toBe('custom_product_reference_test_only');
    } finally {
      Object.getOwnPropertyDescriptor = originalGetOwnPropertyDescriptor;
      Object.defineProperty(utilTypes, 'isProxy', originalDescriptor);
    }
  });
});

describe('created Stripe Product projection', () => {
  test.each([
    ['test mode', false],
    ['live mode', true],
  ])('copies a structurally valid %s Product result', (_name, livemode) => {
    const id = 'custom_product_reference_test_only';
    const product = createdProduct({ id, livemode });

    const result = projectCreatedStripeProductId(product, livemode);
    product.id = 'changed-after-projection';

    expect(result).toBe(id);
  });

  test.each([
    ['undefined ID', { id: undefined }],
    ['empty ID', { id: '' }],
    ['over-bound ID', { id: 'x'.repeat(MAX_STRIPE_PRODUCT_ID_LENGTH + 1) }],
    ['wrong ID kind', { id: { value: 'custom_product_reference_test_only' } }],
    ['undefined object kind', { object: undefined }],
    ['wrong object kind', { object: 'price' }],
    ['undefined mode', { livemode: undefined }],
    ['wrong mode kind', { livemode: 'false' }],
    ['mode mismatch', { livemode: true }],
  ])('rejects %s', (_name, overrides) => {
    expect(projectCreatedStripeProductId(
      createdProduct(overrides),
      false,
    )).toBeNull();
  });

  test.each(['id', 'object', 'livemode'])(
    'rejects a genuinely missing %s field',
    (field) => {
      const product = createdProduct();
      delete product[field];

      expect(projectCreatedStripeProductId(product, false)).toBeNull();
    },
  );

  test.each([
    ['undefined status', { statusCode: undefined }],
    ['non-number status', { statusCode: '200' }],
    ['fractional status', { statusCode: 200.5 }],
    ['non-finite status', { statusCode: Number.NaN }],
    ['informational status', { statusCode: 199 }],
    ['redirect status', { statusCode: 300 }],
    ['client-error status', { statusCode: 400 }],
    ['server-error status', { statusCode: 502 }],
  ])('rejects an installed SDK response with %s', (_name, responseOverrides) => {
    expect(projectCreatedStripeProductId(
      createdProduct({}, responseOverrides),
      false,
    )).toBeNull();
  });

  test('rejects a genuinely missing installed-SDK response status', () => {
    const product = createdProduct();
    delete product.lastResponse.statusCode;

    expect(projectCreatedStripeProductId(product, false)).toBeNull();
  });

  test('accepts the exact 200 and 299 local response-status boundaries', () => {
    expect(projectCreatedStripeProductId(
      createdProduct({}, { statusCode: 200 }),
      false,
    )).toBe('custom_product_reference_test_only');
    expect(projectCreatedStripeProductId(
      createdProduct({}, { statusCode: 299 }),
      false,
    )).toBe('custom_product_reference_test_only');
  });

  test('rejects missing or wrong installed-SDK lastResponse descriptors', () => {
    const missing = {
      id: 'custom_product_reference_test_only',
      object: 'product',
      livemode: false,
    };
    const enumerable = { ...missing, lastResponse: { statusCode: 200 } };
    const writable = { ...missing };
    Object.defineProperty(writable, 'lastResponse', {
      configurable: false,
      enumerable: false,
      value: { statusCode: 200 },
      writable: true,
    });

    expect(projectCreatedStripeProductId(missing, false)).toBeNull();
    expect(projectCreatedStripeProductId(enumerable, false)).toBeNull();
    expect(projectCreatedStripeProductId(writable, false)).toBeNull();
  });

  test.each(['id', 'object', 'livemode'])(
    'rejects an accessor-backed %s without invoking it',
    (field) => {
      let getterCalls = 0;
      const product = createdProduct();
      Object.defineProperty(product, field, {
        configurable: true,
        enumerable: true,
        get() {
          getterCalls += 1;
          throw new Error(`created Product ${field} getter executed`);
        },
      });

      expect(projectCreatedStripeProductId(product, false)).toBeNull();
      expect(getterCalls).toBe(0);
    },
  );

  test('rejects an accessor-backed lastResponse without invoking it', () => {
    let getterCalls = 0;
    const product = {
      id: 'custom_product_reference_test_only',
      object: 'product',
      livemode: false,
    };
    Object.defineProperty(product, 'lastResponse', {
      configurable: true,
      enumerable: false,
      get() {
        getterCalls += 1;
        throw new Error('created Product lastResponse getter executed');
      },
    });

    expect(projectCreatedStripeProductId(product, false)).toBeNull();
    expect(getterCalls).toBe(0);
  });

  test('rejects an accessor-backed response status without invoking it', () => {
    const canary = new Error('created Product status getter executed');
    let getterCalls = 0;
    const product = createdProduct();
    Object.defineProperty(product.lastResponse, 'statusCode', {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        throw canary;
      },
    });

    expect(projectCreatedStripeProductId(product, false)).toBeNull();
    expect(getterCalls).toBe(0);
  });

  test.each([
    ['root Proxy', new Proxy(createdProduct(), {})],
    ['custom prototype', Object.assign(Object.create({}), createdProduct())],
  ])('rejects a created Product with a %s', (_name, product) => {
    expect(projectCreatedStripeProductId(product, false)).toBeNull();
  });

  test('rejects a root Proxy without invoking any reflection trap', () => {
    let trapCalls = 0;
    const product = new Proxy(createdProduct(), {
      get() {
        trapCalls += 1;
        throw new Error('Product get trap executed');
      },
      getOwnPropertyDescriptor() {
        trapCalls += 1;
        throw new Error('Product descriptor trap executed');
      },
      getPrototypeOf() {
        trapCalls += 1;
        throw new Error('Product prototype trap executed');
      },
      ownKeys() {
        trapCalls += 1;
        throw new Error('Product ownKeys trap executed');
      },
    });

    expect(projectCreatedStripeProductId(product, false)).toBeNull();
    expect(trapCalls).toBe(0);
  });

  test('rejects a Proxy lastResponse without invoking traps', () => {
    const product = {
      id: 'custom_product_reference_test_only',
      object: 'product',
      livemode: false,
    };
    const response = new Proxy({ statusCode: 200 }, {
      get() {
        throw new Error('lastResponse get trap executed');
      },
    });
    Object.defineProperty(product, 'lastResponse', {
      configurable: false,
      enumerable: false,
      value: response,
      writable: false,
    });

    expect(projectCreatedStripeProductId(product, false)).toBeNull();
  });

  test('does not inspect or copy unknown returned Product fields', () => {
    const canary = new Error('unknown Product result field inspected');
    const product = createdProduct({
      metadata: throwingValue(canary),
      private_canary: throwingValue(canary),
    });
    product.cycle = product;
    product[Symbol('synthetic-returned-field')] = throwingValue(canary);

    expect(projectCreatedStripeProductId(product, false))
      .toBe('custom_product_reference_test_only');
  });

  test('rejects a malformed expected mode without inspecting a Product', () => {
    let trapCalls = 0;
    const product = new Proxy({}, {
      get() {
        trapCalls += 1;
        throw new Error('Product proxy accessed');
      },
    });

    expect(projectCreatedStripeProductId(product, 'false')).toBeNull();
    expect(trapCalls).toBe(0);
  });
});
