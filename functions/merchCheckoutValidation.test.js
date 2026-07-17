const {
  STRIPE_MINIMUM_USD_CENTS,
  STRIPE_UNIT_AMOUNT_MAX_CENTS,
  projectMerchandisePriceCents,
} = require('./merchCheckoutValidation');

describe('merchandise Checkout price projection', () => {
  test.each([
    STRIPE_MINIMUM_USD_CENTS,
    2_000,
    STRIPE_UNIT_AMOUNT_MAX_CENTS,
  ])('copies exact valid integer cents %s', (priceCents) => {
    const product = { priceCents };

    const projected = projectMerchandisePriceCents(product);
    product.priceCents = 49;
    Object.defineProperty(product, 'priceCents', {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error('changed getter should not run');
      },
    });
    delete product.priceCents;

    expect(projected).toBe(priceCents);
  });

  test('accepts an enumerable frozen price data property', () => {
    expect(projectMerchandisePriceCents(Object.freeze({ priceCents: 2_000 })))
      .toBe(2_000);
  });

  test.each([
    ['explicit undefined', undefined],
    ['null', null],
    ['false', false],
    ['true', true],
    ['zero', 0],
    ['negative zero', -0],
    ['one cent', 1],
    ['one below the minimum', STRIPE_MINIMUM_USD_CENTS - 1],
    ['negative', -1],
    ['fractional', 50.5],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['one over the provider limit', STRIPE_UNIT_AMOUNT_MAX_CENTS + 1],
    ['numeric string', '2000'],
    ['bigint', 2_000n],
    ['boxed number', new Number(2_000)], // eslint-disable-line no-new-wrappers
    ['date', new Date(2_000)],
    ['array', [2_000]],
    ['plain object', { value: 2_000 }],
    ['map', new Map([['value', 2_000]])],
    ['set', new Set([2_000])],
    ['function', () => 2_000],
    ['symbol', Symbol('synthetic-price')],
  ])('rejects %s without conversion', (_name, priceCents) => {
    const conversion = jest.fn(() => {
      throw new Error('conversion should not run');
    });
    if (priceCents && (typeof priceCents === 'object' || typeof priceCents === 'function')) {
      Object.defineProperty(priceCents, Symbol.toPrimitive, {
        configurable: true,
        value: conversion,
      });
      Object.defineProperty(priceCents, 'valueOf', {
        configurable: true,
        value: conversion,
      });
      Object.defineProperty(priceCents, 'toString', {
        configurable: true,
        value: conversion,
      });
      Object.defineProperty(priceCents, 'toJSON', {
        configurable: true,
        value: conversion,
      });
      Object.defineProperty(priceCents, Symbol.iterator, {
        configurable: true,
        value: conversion,
      });
    }

    expect(projectMerchandisePriceCents({ priceCents })).toBeNull();
    expect(conversion).not.toHaveBeenCalled();
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['number primitive', 2_000],
    ['string primitive', '2000'],
    ['boolean primitive', true],
    ['bigint primitive', 2_000n],
    ['symbol primitive', Symbol('synthetic-product')],
    ['function', () => ({ priceCents: 2_000 })],
    ['boxed number', new Number(2_000)], // eslint-disable-line no-new-wrappers
    ['boxed string', new String('2000')], // eslint-disable-line no-new-wrappers
    ['boxed boolean', new Boolean(true)], // eslint-disable-line no-new-wrappers
    ['array', []],
    ['date', new Date(0)],
    ['map', new Map()],
    ['set', new Set()],
    ['null prototype', Object.create(null)],
    ['custom prototype', Object.create({})],
    ['class instance', new (class Product {})()],
  ])('rejects a %s product container', (_name, product) => {
    if (product && typeof product === 'object') product.priceCents = 2_000;
    expect(projectMerchandisePriceCents(product)).toBeNull();
  });

  test('rejects missing, inherited, non-enumerable, and accessor prices without reading them', () => {
    const getter = jest.fn(() => {
      throw new Error('getter should not run');
    });
    const accessorProduct = {};
    Object.defineProperty(accessorProduct, 'priceCents', {
      enumerable: true,
      get: getter,
    });
    const nonEnumerableProduct = {};
    Object.defineProperty(nonEnumerableProduct, 'priceCents', {
      enumerable: false,
      value: 2_000,
    });

    expect(projectMerchandisePriceCents({})).toBeNull();
    expect(projectMerchandisePriceCents(Object.create({ priceCents: 2_000 }))).toBeNull();
    expect(projectMerchandisePriceCents(nonEnumerableProduct)).toBeNull();
    expect(projectMerchandisePriceCents(accessorProduct)).toBeNull();
    expect(getter).not.toHaveBeenCalled();
  });

  test('ignores a polluted Object.prototype price getter', () => {
    const previousDescriptor = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'priceCents',
    );
    const getter = jest.fn(() => {
      throw new Error('inherited getter should not run');
    });

    try {
      Object.defineProperty(Object.prototype, 'priceCents', {
        configurable: true,
        enumerable: true,
        get: getter,
      });
      expect(projectMerchandisePriceCents({})).toBeNull();
      expect(getter).not.toHaveBeenCalled();
    } finally {
      if (previousDescriptor) {
        Object.defineProperty(Object.prototype, 'priceCents', previousDescriptor);
      } else {
        delete Object.prototype.priceCents;
      }
    }
  });

  test('rejects live and revoked proxies without invoking traps', () => {
    const trap = jest.fn(() => {
      throw new Error('proxy trap should not run');
    });
    const proxy = new Proxy({ priceCents: 2_000 }, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    const revoked = Proxy.revocable({ priceCents: 2_000 }, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    revoked.revoke();

    expect(projectMerchandisePriceCents(proxy)).toBeNull();
    expect(projectMerchandisePriceCents(revoked.proxy)).toBeNull();
    expect(trap).not.toHaveBeenCalled();
  });

  test('does not enumerate or inspect unrelated hostile fields', () => {
    const getter = jest.fn(() => {
      throw new Error('unrelated getter should not run');
    });
    const trap = jest.fn(() => {
      throw new Error('nested proxy trap should not run');
    });
    const product = { priceCents: 2_000 };
    product.self = product;
    product.nested = new Proxy({}, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    Object.defineProperty(product, 'unknown', {
      enumerable: true,
      get: getter,
    });
    Object.defineProperty(product, Symbol('synthetic-field'), {
      enumerable: true,
      get: getter,
    });

    expect(projectMerchandisePriceCents(product)).toBe(2_000);
    expect(getter).not.toHaveBeenCalled();
    expect(trap).not.toHaveBeenCalled();
  });

  test('uses captured intrinsics after import', () => {
    const utilTypes = require('node:util').types;
    const replacements = [
      [Object, 'getOwnPropertyDescriptor'],
      [Object, 'getPrototypeOf'],
      [Object, 'hasOwn'],
      [Object, 'is'],
      [Number, 'isSafeInteger'],
      [utilTypes, 'isProxy'],
    ];
    const originals = replacements.map(([owner, key]) => [owner, key, owner[key]]);
    const replacement = jest.fn(() => {
      throw new Error('patched intrinsic should not run');
    });
    let projected;

    try {
      replacements.forEach(([owner, key]) => {
        owner[key] = replacement;
      });
      projected = projectMerchandisePriceCents({ priceCents: 2_000 });
    } finally {
      originals.forEach(([owner, key, original]) => {
        owner[key] = original;
      });
    }

    expect(projected).toBe(2_000);
    expect(replacement).not.toHaveBeenCalled();
  });
});
