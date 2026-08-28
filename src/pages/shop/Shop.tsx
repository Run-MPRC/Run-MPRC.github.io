import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '../../components/SEO';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import { Product } from '../../types/shop';
import { listActiveProducts, formatPrice } from '../../services/shop/shopService';
import { MEMBER_DISCOUNTS_URI } from '../../text/externalLinks';

function Shop() {
  const { services, isReady } = useServiceLocator();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady || !services) return;
    listActiveProducts(services.firebaseResources.firestore)
      .then((ps) => { setProducts(ps); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, [services, isReady]);

  return (
    <>
      <SEO
        title="MPRC Shop"
        description="Mid-Peninsula Running Club merchandise: shirts, hats, and gear"
        url="https://runmprc.com/shop"
        canonicalUrl="https://runmprc.com/shop"
      />
      <div className="container mx-auto p-4 max-w-5xl">
        <h1 className="text-2xl font-bold mb-4">MPRC Shop</h1>
        <aside className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h2 className="text-lg font-semibold">Member discounts</h2>
          <p className="mt-1 text-sm text-gray-700">
            View current offers from businesses that support the MPRC community.
          </p>
          <a
            href={MEMBER_DISCOUNTS_URI}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-blue-700 font-semibold hover:underline"
          >
            View discounts →
          </a>
        </aside>
        {loading && <p className="text-gray-500">Loading...</p>}
        {error && <p className="text-red-500">{error}</p>}
        {!loading && !error && products.length === 0 && (
          <p className="text-gray-600">No items available right now. Check back soon.</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {products.map((p) => {
            const soldOut = p.status === 'sold_out';
            return (
              <Link
                key={p.id}
                to={`/shop/${p.slug}`}
                className="border rounded-lg overflow-hidden hover:shadow-md transition"
              >
                <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
                  {p.imageUrl
                    ? (
                      <img
                        src={p.imageUrl}
                        alt={p.title}
                        className="w-full h-full object-cover"
                      />
                    )
                    : <span className="text-gray-400 text-sm">No image</span>}
                </div>
                <div className="p-3">
                  <div className="font-semibold">{p.title}</div>
                  <div className="flex justify-between items-baseline mt-1">
                    <span className="text-lg font-bold">
                      {formatPrice(p.priceCents)}
                    </span>
                    {soldOut && (
                      <span className="text-xs text-red-600 font-semibold">Sold out</span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default Shop;
