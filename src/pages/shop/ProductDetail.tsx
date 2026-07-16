import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import SEO from '../../components/SEO';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import { useAuth } from '../../services/hooks/useAuth';
import { Product } from '../../types/shop';
import {
  createMerchCheckout,
  formatPrice,
  getProductBySlug,
} from '../../services/shop/shopService';

function ProductDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { services, isReady } = useServiceLocator();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const cancelled = params.get('cancelled') === '1';

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState('');
  const [size, setSize] = useState('');
  const [color, setColor] = useState('');

  useEffect(() => {
    if (!isReady || !services || !slug) return () => undefined;
    let active = true; setLoading(true); setProduct(null); setError(null);
    getProductBySlug(services.firebaseResources.firestore, slug)
      .then((p) => {
        if (!active) return;
        setProduct(p); setLoading(false);
        if (!p) setError('Product not found');
      })
      .catch(() => { if (active) { setError('We could not load this product right now. Please try again later.'); setLoading(false); } }); return () => { active = false; };
  }, [services, isReady, slug]);

  useEffect(() => {
    if (user?.email && !email) setEmail(user.email);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (loading) return <div className="container mx-auto p-6">Loading...</div>;
  if (!product) {
    return (
      <div className="container mx-auto p-6">
        <p role={!product && error ? 'alert' : undefined} aria-live={!product && error ? 'assertive' : undefined} aria-atomic={!product && error ? true : undefined} className="text-red-500">{error || 'Product not found.'}</p>
        <Link to="/shop" className="text-blue-600 hover:underline">← Back to shop</Link>
      </div>
    );
  }

  const soldOut = product.status === 'sold_out';
  const hasSizes = (product.sizes || []).length > 0;
  const hasColors = (product.colors || []).length > 0;
  const canBuy = !soldOut
    && product.status === 'active'
    && firstName && lastName && email
    && (!hasSizes || size)
    && (!hasColors || color);

  async function handleBuy(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!product) return;
    setSubmitting(true);
    try {
      const result = await createMerchCheckout(
        services!.firebaseResources.app,
        {
          productSlug: product.slug,
          buyer: { firstName, lastName, email, phone },
          size: size || undefined,
          color: color || undefined,
        },
      );
      window.location.href = result.url;
    } catch {
      setError('We could not confirm checkout. Please wait before trying again.');
      setSubmitting(false);
    }
  }

  return (
    <>
      <SEO
        title={product.title}
        description={product.description.slice(0, 160)}
        url={`https://runmprc.com/shop/${product.slug}`}
        canonicalUrl={`https://runmprc.com/shop/${product.slug}`}
      />
      <div className="container mx-auto p-4 max-w-4xl">
        <Link to="/shop" className="text-sm text-blue-600 hover:underline">← Shop</Link>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
          <div className="aspect-square bg-gray-100 rounded overflow-hidden flex items-center justify-center">
            {product.imageUrl
              ? <img src={product.imageUrl} alt={product.title} className="w-full h-full object-cover" />
              : <span className="text-gray-400">No image</span>}
          </div>
          <div>
            <h1 className="text-2xl font-bold">{product.title}</h1>
            <p className="text-2xl font-bold mt-2">{formatPrice(product.priceCents)}</p>
            {soldOut && (
              <p className="mt-2 text-red-600 font-semibold">Sold out</p>
            )}
            {cancelled && (
              <div className="mt-3 p-3 bg-amber-100 border border-amber-300 rounded text-sm">
                Your checkout was cancelled. You can try again below.
              </div>
            )}
            <p className="mt-4 whitespace-pre-wrap text-gray-800">{product.description}</p>

            <form onSubmit={handleBuy} className="mt-6 space-y-3">
              {hasSizes && (
                <label className="block">
                  <span className="text-sm font-medium">Size</span>
                  <select
                    required
                    className="border rounded px-3 py-2 w-full"
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                  >
                    <option value="">Select size...</option>
                    {product.sizes!.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
              )}
              {hasColors && (
                <label className="block">
                  <span className="text-sm font-medium">Color</span>
                  <select
                    required
                    className="border rounded px-3 py-2 w-full"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                  >
                    <option value="">Select color...</option>
                    {product.colors!.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
              )}
              <div className="grid grid-cols-2 gap-3">
                <input
                  required
                  className="border rounded px-3 py-2"
                  placeholder="First name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
                <input
                  required
                  className="border rounded px-3 py-2"
                  placeholder="Last name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
              <input
                required
                type="email"
                className="border rounded px-3 py-2 w-full"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                type="tel"
                className="border rounded px-3 py-2 w-full"
                placeholder="Phone (optional)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              {error && <p role="alert" aria-live="assertive" aria-atomic="true" className="text-red-600 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={!canBuy || submitting}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded w-full"
              >
                {submitting
                  ? 'Redirecting to checkout...'
                  : soldOut
                    ? 'Sold out'
                    : `Buy — ${formatPrice(product.priceCents)}`}
              </button>
              <p className="text-xs text-gray-500 text-center">
                Shipping address collected at checkout. Payment via Stripe.
              </p>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}

export default ProductDetail;
