const {
  MerchCatalogError,
  MerchCheckoutValidationError,
  STRIPE_MINIMUM_USD_CENTS,
  STRIPE_UNIT_AMOUNT_MAX_CENTS,
  matchMerchandiseOptions,
  parseMerchCheckoutRequest,
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

const validRequest = () => ({
  productSlug: 'hat',
  buyer: {
    firstName: 'Test',
    lastName: 'Buyer',
    email: 'buyer@example.test',
  },
});

describe('merchandise checkout request validation', () => {
  test('accepts and freezes a minimal valid request', () => {
    const result = parseMerchCheckoutRequest(validRequest());

    expect(result).toEqual({
      productSlug: 'hat',
      buyer: {
        firstName: 'Test',
        lastName: 'Buyer',
        email: 'buyer@example.test',
        phone: null,
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.buyer)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result, 'size')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, 'color')).toBe(false);
  });

  test('accepts an opaque slug byte for byte', () => {
    const result = parseMerchCheckoutRequest({
      ...validRequest(),
      productSlug: 'hat?color=blue#fragment%25',
    });
    expect(result.productSlug).toBe('hat?color=blue#fragment%25');
  });

  test('normalizes the email and trims names and phone', () => {
    const result = parseMerchCheckoutRequest({
      productSlug: 'hat',
      buyer: {
        firstName: '  Ada  ',
        lastName: '  Lovelace ',
        email: '  Buyer@Example.Test  ',
        phone: '  555-0100  ',
      },
    });

    expect(result.buyer).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'buyer@example.test',
      phone: '555-0100',
    });
  });

  test('keeps a supplied, trimmed size and color as own keys', () => {
    const result = parseMerchCheckoutRequest({
      ...validRequest(),
      size: '  M  ',
      color: 'blue',
    });

    expect(result.size).toBe('M');
    expect(result.color).toBe('blue');
  });

  test('treats a blank phone as null', () => {
    const result = parseMerchCheckoutRequest({
      productSlug: 'hat',
      buyer: { ...validRequest().buyer, phone: '   ' },
    });
    expect(result.buyer.phone).toBeNull();
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'hat'],
    ['number', 1],
    ['boolean', true],
    ['array', [{ productSlug: 'hat' }]],
  ])('rejects a %s payload', (_name, data) => {
    expect(() => parseMerchCheckoutRequest(data))
      .toThrow(MerchCheckoutValidationError);
  });

  test('rejects an unknown root key', () => {
    expect(() => parseMerchCheckoutRequest({ ...validRequest(), coupon: 'x' }))
      .toThrow(MerchCheckoutValidationError);
  });

  test.each([
    ['missing productSlug', (request) => { delete request.productSlug; }],
    ['missing buyer', (request) => { delete request.buyer; }],
  ])('rejects a request %s', (_name, mutate) => {
    const request = validRequest();
    mutate(request);
    expect(() => parseMerchCheckoutRequest(request))
      .toThrow(MerchCheckoutValidationError);
  });

  test.each([
    ['non-string', 123],
    ['empty', ''],
    ['whitespace only', '   '],
    ['leading whitespace', ' hat'],
    ['trailing whitespace', 'hat '],
    ['a slash', 'shop/hat'],
    ['a single dot', '.'],
    ['a double dot', '..'],
    ['a control character', 'hat'],
    ['a newline', 'hat\nx'],
    ['a zero-width format character', 'hat​'],
    ['over 128 code points', 'h'.repeat(129)],
  ])('rejects a productSlug that is %s', (_name, productSlug) => {
    expect(() => parseMerchCheckoutRequest({ ...validRequest(), productSlug }))
      .toThrow(MerchCheckoutValidationError);
  });

  test.each([
    ['not an object', 'buyer'],
    ['an unknown key', {
      firstName: 'A', lastName: 'B', email: 'a@b.test', role: 'admin',
    }],
    ['missing firstName', { lastName: 'B', email: 'a@b.test' }],
    ['missing lastName', { firstName: 'A', email: 'a@b.test' }],
    ['missing email', { firstName: 'A', lastName: 'B' }],
    ['an empty firstName', { firstName: '   ', lastName: 'B', email: 'a@b.test' }],
    ['a non-string lastName', { firstName: 'A', lastName: 5, email: 'a@b.test' }],
    ['an invalid email', { firstName: 'A', lastName: 'B', email: 'not-an-email' }],
  ])('rejects a buyer that is %s', (_name, buyer) => {
    expect(() => parseMerchCheckoutRequest({ productSlug: 'hat', buyer }))
      .toThrow(MerchCheckoutValidationError);
  });

  test.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['non-string', 5],
    ['a control character', 'M'],
    ['over 100 code points', 'x'.repeat(101)],
  ])('rejects a size that is %s', (_name, size) => {
    expect(() => parseMerchCheckoutRequest({ ...validRequest(), size }))
      .toThrow(MerchCheckoutValidationError);
  });

  test('rejects a color under the same rules as size', () => {
    expect(() => parseMerchCheckoutRequest({ ...validRequest(), color: '' }))
      .toThrow(MerchCheckoutValidationError);
  });

  test('does not invoke proxy traps on a hostile payload', () => {
    const trap = jest.fn(() => {
      throw new Error('trap should not run');
    });
    const hostile = new Proxy(validRequest(), {
      get: trap,
      getOwnPropertyDescriptor: trap,
      ownKeys: trap,
      getPrototypeOf: trap,
    });

    expect(() => parseMerchCheckoutRequest(hostile))
      .toThrow(MerchCheckoutValidationError);
    expect(trap).not.toHaveBeenCalled();
  });

  test('does not read a hostile buyer accessor', () => {
    const getter = jest.fn(() => {
      throw new Error('getter should not run');
    });
    const buyer = { firstName: 'A', lastName: 'B', email: 'a@b.test' };
    Object.defineProperty(buyer, 'phone', { enumerable: true, get: getter });

    expect(() => parseMerchCheckoutRequest({ productSlug: 'hat', buyer }))
      .toThrow(MerchCheckoutValidationError);
    expect(getter).not.toHaveBeenCalled();
  });

  test('rejects the request when Object.prototype is polluted', () => {
    // A polluted prototype makes an inherited key look like an ordinary field;
    // the strict parser rejects rather than silently trusting the payload.
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'coupon');
    try {
      Object.defineProperty(Object.prototype, 'coupon', {
        configurable: true,
        enumerable: true,
        value: 'injected',
      });
      expect(() => parseMerchCheckoutRequest(validRequest()))
        .toThrow(MerchCheckoutValidationError);
    } finally {
      if (previous) Object.defineProperty(Object.prototype, 'coupon', previous);
      else delete Object.prototype.coupon;
    }
  });
});

describe('merchandise option matching', () => {
  test('returns matched selections frozen', () => {
    const result = matchMerchandiseOptions(
      { sizes: ['S', 'M'], colors: ['blue', 'red'] },
      { size: 'M', color: 'red' },
    );

    expect(result).toEqual({ size: 'M', color: 'red' });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('returns nulls when the product has no option dimensions', () => {
    expect(matchMerchandiseOptions({ priceCents: 2_000 }, {}))
      .toEqual({ size: null, color: null });
  });

  test.each([
    ['empty arrays', { sizes: [], colors: [] }],
    ['null', { sizes: null, colors: null }],
    ['undefined', { sizes: undefined, colors: undefined }],
  ])('treats %s option lists as absent', (_name, product) => {
    expect(matchMerchandiseOptions(product, {}))
      .toEqual({ size: null, color: null });
  });

  test('normalizes stored options before matching', () => {
    // The catalog stores a decomposed "é"; the request supplies the composed form.
    const result = matchMerchandiseOptions(
      { sizes: ['Café'] },
      { size: 'Café' },
    );
    expect(result.size).toBe('Café');
  });

  test.each([
    ['a selection for an absent dimension', { priceCents: 1 }, { size: 'M' }],
    ['a size omitted for a present dimension', { sizes: ['M'] }, {}],
    ['a size outside the allowlist', { sizes: ['M'] }, { size: 'XL' }],
    ['a color outside the allowlist',
      { sizes: ['M'], colors: ['blue'] }, { size: 'M', color: 'green' }],
    ['a selection for an empty option array', { sizes: [] }, { size: 'M' }],
  ])('rejects %s as a request fault', (_name, product, request) => {
    expect(() => matchMerchandiseOptions(product, request))
      .toThrow(MerchCheckoutValidationError);
  });

  test.each([
    ['a non-array option list', { sizes: 'M' }],
    ['a numeric option', { sizes: [5] }],
    ['a null option', { sizes: [null] }],
    ['an object option', { sizes: [{}] }],
    ['an empty-string option', { sizes: [''] }],
    ['a control-character option', { sizes: ['M'] }],
    ['a duplicate option', { sizes: ['M', 'M'] }],
    ['too many options', { sizes: Array.from({ length: 51 }, (_v, index) => `s${index}`) }],
  ])('rejects %s as a catalog fault', (_name, product) => {
    expect(() => matchMerchandiseOptions(product, { size: 'M' }))
      .toThrow(MerchCatalogError);
  });

  test.each([
    ['null', null],
    ['array', ['sizes']],
    ['class instance', new (class Product {})()],
  ])('rejects a %s product container as a catalog fault', (_name, product) => {
    expect(() => matchMerchandiseOptions(product, {}))
      .toThrow(MerchCatalogError);
  });

  test('rejects an accessor option list without reading it', () => {
    const getter = jest.fn(() => {
      throw new Error('getter should not run');
    });
    const product = {};
    Object.defineProperty(product, 'sizes', { enumerable: true, get: getter });

    expect(() => matchMerchandiseOptions(product, { size: 'M' }))
      .toThrow(MerchCatalogError);
    expect(getter).not.toHaveBeenCalled();
  });

  test('rejects a sparse option array as a catalog fault', () => {
    const sizes = ['M'];
    sizes[2] = 'L'; // leaves a hole at index 1
    expect(() => matchMerchandiseOptions({ sizes }, { size: 'M' }))
      .toThrow(MerchCatalogError);
  });

  test('does not invoke option-array proxy traps', () => {
    const trap = jest.fn(() => {
      throw new Error('trap should not run');
    });
    const sizes = new Proxy(['M'], {
      get: trap,
      getOwnPropertyDescriptor: trap,
      ownKeys: trap,
      getPrototypeOf: trap,
    });

    expect(() => matchMerchandiseOptions({ sizes }, { size: 'M' }))
      .toThrow(MerchCatalogError);
    expect(trap).not.toHaveBeenCalled();
  });
});
