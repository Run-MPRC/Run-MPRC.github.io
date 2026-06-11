import { Timestamp } from 'firebase/firestore';

export type ProductStatus = 'draft' | 'active' | 'sold_out' | 'archived';
export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'fulfilled'
  | 'cancelled'
  | 'refunded'
  | 'partially_refunded';

export interface ProductVariantSize {
  label: string;
  stripePriceId?: string;
}

export interface Product {
  id: string;
  slug: string;
  title: string;
  description: string;
  priceCents: number;
  imageUrl: string | null;
  extraImages?: string[];
  sizes?: string[];
  colors?: string[];
  status: ProductStatus;
  stripeProductId?: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface OrderBuyer {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
}

export interface OrderShipping {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface Order {
  id: string;
  productSlug: string;
  productTitle: string;
  buyer: OrderBuyer;
  shipping: OrderShipping | null;
  size?: string | null;
  color?: string | null;
  amountCents: number;
  currency: string;
  status: OrderStatus;
  stripeSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeChargeId?: string | null;
  stripeRefundIds?: string[];
  confirmationToken: string;
  trackingNumber?: string | null;
  fulfillmentNote?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  paidAt?: Timestamp | null;
  fulfilledAt?: Timestamp | null;
  refundedAt?: Timestamp | null;
  cancelledAt?: Timestamp | null;
  auditLog: Array<{
    ts: Timestamp;
    actorUid: string | null;
    actorEmail: string | null;
    action: string;
    note?: string;
  }>;
}
