import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  serverTimestamp,
  Firestore,
  Timestamp,
  where,
  DocumentData,
} from 'firebase/firestore';
import { FirebaseApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Product, Order, ProductStatus } from '../../types/shop';

function toProduct(id: string, d: DocumentData): Product {
  return {
    id,
    slug: d.slug || id,
    title: d.title || '',
    description: d.description || '',
    priceCents: d.priceCents || 0,
    imageUrl: d.imageUrl || null,
    extraImages: d.extraImages || [],
    sizes: d.sizes || [],
    colors: d.colors || [],
    status: d.status || 'draft',
    stripeProductId: d.stripeProductId,
    createdBy: d.createdBy || '',
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

// Dev-only placeholder products so the Shop UI has something to render
// before real products exist in Firestore. Safe: the "Buy" flow calls a
// Cloud Function which will fail to look up these slugs in Firestore,
// so no orders can actually be created from them.
const IS_DEV = process.env.NODE_ENV === 'development';
const PLACEHOLDERS: Product[] = IS_DEV ? [
  {
    id: 'mprc-hat',
    slug: 'mprc-hat',
    title: 'MPRC Running Hat',
    description: 'Lightweight running cap with the MPRC logo. Breathable fabric, adjustable strap.',
    priceCents: 1000,
    imageUrl: 'https://placehold.co/600x600/1e40af/ffffff/png?text=MPRC+Hat',
    extraImages: [],
    sizes: ['One size'],
    colors: ['Navy', 'Black'],
    status: 'active',
    createdBy: 'placeholder',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
  {
    id: 'mprc-jacket',
    slug: 'mprc-jacket',
    title: 'MPRC Windbreaker Jacket',
    description: 'Lightweight windbreaker for cool morning runs. Water-resistant, reflective details, zip pocket.',
    priceCents: 1500,
    imageUrl: 'https://placehold.co/600x600/059669/ffffff/png?text=MPRC+Jacket',
    extraImages: [],
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    colors: ['Black', 'Navy'],
    status: 'active',
    createdBy: 'placeholder',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  },
] : [];

export async function listActiveProducts(db: Firestore): Promise<Product[]> {
  const col = collection(db, 'products');
  const q = query(col, where('status', 'in', ['active', 'sold_out']), orderBy('updatedAt', 'desc'));
  try {
    const snap = await getDocs(q);
    const real = snap.docs.map((d) => toProduct(d.id, d.data()));
    if (real.length > 0) return real;
    return PLACEHOLDERS;
  } catch (err) {
    if (IS_DEV) return PLACEHOLDERS;
    throw err;
  }
}

export async function listAllProducts(db: Firestore): Promise<Product[]> {
  const col = collection(db, 'products');
  const q = query(col, orderBy('updatedAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => toProduct(d.id, d.data()));
}

export async function getProductBySlug(
  db: Firestore,
  slug: string,
): Promise<Product | null> {
  const ref = doc(db, 'products', slug);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) return toProduct(snap.id, snap.data());
  } catch (err) {
    if (!IS_DEV) throw err;
  }
  return PLACEHOLDERS.find((p) => p.slug === slug) || null;
}

export interface ProductInput {
  slug: string;
  title: string;
  description: string;
  priceCents: number;
  imageUrl?: string | null;
  sizes?: string[];
  colors?: string[];
  status: ProductStatus;
}

export async function createProduct(
  db: Firestore,
  input: ProductInput,
  createdBy: string,
): Promise<void> {
  const ref = doc(db, 'products', input.slug);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    throw new Error(`Product with slug "${input.slug}" already exists`);
  }
  const now = Timestamp.now();
  await setDoc(ref, {
    slug: input.slug,
    title: input.title,
    description: input.description,
    priceCents: input.priceCents,
    imageUrl: input.imageUrl || null,
    sizes: input.sizes || [],
    colors: input.colors || [],
    status: input.status,
    createdBy,
    createdAt: now,
    updatedAt: now,
  });
}

export async function updateProduct(
  db: Firestore,
  slug: string,
  input: ProductInput,
): Promise<void> {
  const ref = doc(db, 'products', slug);
  await updateDoc(ref, {
    title: input.title,
    description: input.description,
    priceCents: input.priceCents,
    imageUrl: input.imageUrl || null,
    sizes: input.sizes || [],
    colors: input.colors || [],
    status: input.status,
    updatedAt: serverTimestamp(),
  });
}

export async function listAllOrders(db: Firestore): Promise<Order[]> {
  const col = collection(db, 'orders');
  const q = query(col, orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Order, 'id'>) }));
}

export interface MerchCheckoutArgs {
  productSlug: string;
  buyer: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
  };
  size?: string;
  color?: string;
}

export interface MerchCheckoutResult {
  sessionId: string;
  url: string;
  orderId: string;
}

export async function createMerchCheckout(
  app: FirebaseApp,
  args: MerchCheckoutArgs,
): Promise<MerchCheckoutResult> {
  const functions = getFunctions(app);
  const callable = httpsCallable<MerchCheckoutArgs, MerchCheckoutResult>(
    functions,
    'createMerchCheckout',
  );
  const result = await callable(args);
  return result.data;
}

export interface OrderLookupResult {
  id: string;
  status: string;
  amountCents: number;
  currency: string;
  productSlug: string;
  productTitle: string;
  size: string | null;
  color: string | null;
  buyer: { firstName: string; lastName: string; email: string };
  paidAt: Timestamp | null;
  createdAt: Timestamp | null;
}

export async function lookupOrder(
  app: FirebaseApp,
  args: { orderId: string; token: string },
): Promise<OrderLookupResult> {
  const functions = getFunctions(app);
  const callable = httpsCallable<typeof args, OrderLookupResult>(functions, 'lookupOrder');
  const result = await callable(args);
  return result.data;
}

export type AdminOrderAction =
  | 'mark_fulfilled'
  | 'set_tracking'
  | 'add_note'
  | 'cancel'
  | 'refund_full'
  | 'refund_partial';

export async function adminOrderAction(
  app: FirebaseApp,
  args: { orderId: string; action: AdminOrderAction; payload?: Record<string, unknown> },
): Promise<{ ok: boolean; refundId?: string }> {
  const functions = getFunctions(app);
  const callable = httpsCallable<typeof args, any>(functions, 'adminOrderAction');
  const result = await callable(args);
  return result.data;
}

export function formatPrice(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}
