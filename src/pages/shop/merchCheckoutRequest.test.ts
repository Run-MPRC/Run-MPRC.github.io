/* eslint-env jest */

import type { Product } from '../../types/shop';
import buildMerchCheckoutRequest from './merchCheckoutRequest';

const buyer = {
  firstName: 'Test',
  lastName: 'Buyer',
  email: 'buyer@example.test',
};

function product(overrides: Partial<Product> = {}): Product {
  return {
    slug: 'hat',
    sizes: [],
    colors: [],
    ...overrides,
  } as Product;
}

describe('merch checkout browser request projection', () => {
  test('includes a size and color the product offers', () => {
    const result = buildMerchCheckoutRequest({
      product: product({ sizes: ['S', 'M'], colors: ['blue'] }),
      buyer,
      size: 'M',
      color: 'blue',
    });

    expect(result).toEqual({
      productSlug: 'hat',
      buyer,
      size: 'M',
      color: 'blue',
    });
  });

  test('omits both option keys for a product with no option dimensions', () => {
    const result = buildMerchCheckoutRequest({
      product: product({ sizes: [], colors: [] }),
      buyer,
      size: 'stray-should-not-leave-browser',
      color: 'stray-should-not-leave-browser',
    });

    expect(result).toEqual({ productSlug: 'hat', buyer });
    expect('size' in result).toBe(false);
    expect('color' in result).toBe(false);
  });

  test('omits the color key when only sizes are offered', () => {
    const result = buildMerchCheckoutRequest({
      product: product({ sizes: ['M'], colors: [] }),
      buyer,
      size: 'M',
      color: 'blue',
    });

    expect(result).toEqual({ productSlug: 'hat', buyer, size: 'M' });
    expect('color' in result).toBe(false);
  });

  test('omits the size key when only colors are offered', () => {
    const result = buildMerchCheckoutRequest({
      product: product({ sizes: undefined, colors: ['blue'] }),
      buyer,
      size: 'M',
      color: 'blue',
    });

    expect(result).toEqual({ productSlug: 'hat', buyer, color: 'blue' });
    expect('size' in result).toBe(false);
  });

  test('omits an offered dimension while its selection is still empty', () => {
    const result = buildMerchCheckoutRequest({
      product: product({ sizes: ['M'], colors: ['blue'] }),
      buyer,
      size: '',
      color: '',
    });

    expect(result).toEqual({ productSlug: 'hat', buyer });
    expect('size' in result).toBe(false);
    expect('color' in result).toBe(false);
  });
});
