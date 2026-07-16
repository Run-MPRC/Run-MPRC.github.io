import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '../../../components/SEO';
import AdminGuard from '../AdminGuard';
import { useServiceLocator } from '../../../services/ServiceLocatorContext';
import { Product } from '../../../types/shop';
import { listAllProducts, formatPrice } from '../../../services/shop/shopService';

const LOAD_FAILURE = 'We could not load products right now. Please try again later.';

function StatusPill({ status }: { status: string }) {
  const m: Record<string, string> = {
    draft: 'bg-gray-200 text-gray-700',
    active: 'bg-green-100 text-green-800',
    sold_out: 'bg-red-100 text-red-800',
    archived: 'bg-gray-300 text-gray-600',
  };
  return <span className={`text-xs px-2 py-0.5 rounded ${m[status] || 'bg-gray-100'}`}>{status}</span>;
}

function Inner() {
  const { services, isReady } = useServiceLocator();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady || !services) return;
    listAllProducts(services.firebaseResources.firestore)
      .then((ps) => { setProducts(ps); setLoading(false); })
      .catch(() => { setError(LOAD_FAILURE); setLoading(false); });
  }, [services, isReady]);

  return (
    <>
      <SEO title="Admin — Products" noindex />
      <div className="container mx-auto p-4 max-w-5xl">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Products</h1>
          <div className="flex gap-2">
            <Link to="/admin/orders" className="border px-4 py-2 rounded hover:bg-gray-50">
              Orders
            </Link>
            <Link
              to="/admin/products/new"
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
            >
              + New product
            </Link>
          </div>
        </div>

        {loading && <p>Loading...</p>}
        {error && (
          <p className="text-red-500" role="alert" aria-live="assertive" aria-atomic="true">
            {error}
          </p>
        )}

        {!error && !loading && products.length === 0 && (
          <p className="text-gray-600">
            No products yet.
            {' '}
            <Link to="/admin/products/new" className="text-blue-600 underline">Create one</Link>
            .
          </p>
        )}
        {!error && !loading && products.length > 0 && (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left p-2">Title</th>
                <th className="text-left p-2">Price</th>
                <th className="text-left p-2">Status</th>
                <th className="text-right p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b hover:bg-gray-50">
                  <td className="p-2">
                    <Link
                      to={`/admin/products/${p.slug}/edit`}
                      className="font-semibold text-blue-700 hover:underline"
                    >
                      {p.title || <em>Untitled</em>}
                    </Link>
                    <div className="text-xs text-gray-500">{p.slug}</div>
                  </td>
                  <td className="p-2">{formatPrice(p.priceCents)}</td>
                  <td className="p-2"><StatusPill status={p.status} /></td>
                  <td className="p-2 text-right">
                    <Link
                      to={`/admin/products/${p.slug}/edit`}
                      className="text-blue-600 hover:underline text-sm"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function AdminProducts() {
  return <AdminGuard><Inner /></AdminGuard>;
}

export default AdminProducts;
