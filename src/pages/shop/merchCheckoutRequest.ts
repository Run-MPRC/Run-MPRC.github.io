import type { MerchCheckoutArgs } from '../../services/shop/shopService';
import type { Product } from '../../types/shop';

interface BuildMerchCheckoutRequestInput {
  product: Product;
  buyer: MerchCheckoutArgs['buyer'];
  size: string;
  color: string;
}

/**
 * Project the current form state into the exact callable shape.
 *
 * This is compatibility hygiene only. The server independently validates the
 * product, buyer, and every option against the stored catalog. Only send a
 * size/color the product actually offers so the payload never carries a
 * selection for an option dimension the product does not have.
 */
function buildMerchCheckoutRequest({
  product,
  buyer,
  size,
  color,
}: BuildMerchCheckoutRequestInput): MerchCheckoutArgs {
  const hasSizes = (product.sizes || []).length > 0;
  const hasColors = (product.colors || []).length > 0;

  return {
    productSlug: product.slug,
    buyer,
    ...(hasSizes && size ? { size } : {}),
    ...(hasColors && color ? { color } : {}),
  };
}

export default buildMerchCheckoutRequest;
