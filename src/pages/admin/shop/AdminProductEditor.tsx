import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import SEO from '../../../components/SEO';
import AdminGuard from '../AdminGuard';
import { useServiceLocator } from '../../../services/ServiceLocatorContext';
import { useAuth } from '../../../services/hooks/useAuth';
import { ProductStatus } from '../../../types/shop';
import {
  createProduct, getProductBySlug, updateProduct,
} from '../../../services/shop/shopService';

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

interface FormState {
  slug: string;
  title: string;
  description: string;
  priceDollars: string;
  imageUrl: string;
  sizes: string;
  colors: string;
  status: ProductStatus;
}

const EMPTY: FormState = {
  slug: '', title: '', description: '', priceDollars: '',
  imageUrl: '', sizes: '', colors: '', status: 'draft',
};

function Inner() {
  const { slug: routeSlug } = useParams<{ slug: string }>();
  const isEdit = !!routeSlug;
  const navigate = useNavigate();
  const { services, isReady } = useServiceLocator();
  const { user } = useAuth();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEdit) return;
    if (!isReady || !services) return;
    getProductBySlug(services.firebaseResources.firestore, routeSlug!)
      .then((p) => {
        if (!p) { setError('Product not found'); }
        else {
          setForm({
            slug: p.slug,
            title: p.title,
            description: p.description,
            priceDollars: (p.priceCents / 100).toFixed(2),
            imageUrl: p.imageUrl || '',
            sizes: (p.sizes || []).join(', '),
            colors: (p.colors || []).join(', '),
            status: p.status,
          });
        }
        setLoading(false);
      })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, [services, isReady, routeSlug, isEdit]);

  function patch(p: Partial<FormState>) {
    setForm((f) => ({ ...f, ...p }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.title.trim()) { setError('Title required'); return; }
    if (!form.slug.trim() || !/^[a-z0-9-]+$/.test(form.slug)) {
      setError('Slug must be lowercase letters, digits, hyphens');
      return;
    }
    const priceCents = Math.round(parseFloat(form.priceDollars || '0') * 100);
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      setError('Invalid price');
      return;
    }
    setSaving(true);
    const input = {
      slug: form.slug,
      title: form.title.trim(),
      description: form.description,
      priceCents,
      imageUrl: form.imageUrl || null,
      sizes: form.sizes.split(',').map((s) => s.trim()).filter(Boolean),
      colors: form.colors.split(',').map((s) => s.trim()).filter(Boolean),
      status: form.status,
    };
    try {
      if (isEdit) {
        await updateProduct(services!.firebaseResources.firestore, routeSlug!, input);
      } else {
        await createProduct(services!.firebaseResources.firestore, input, user?.uid || 'admin');
      }
      navigate('/admin/products');
    } catch (err: any) {
      setError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="container mx-auto p-6">Loading...</div>;

  return (
    <>
      <SEO title={isEdit ? 'Edit product' : 'New product'} noindex />
      <div className="container mx-auto p-4 max-w-2xl">
        <Link to="/admin/products" className="text-sm text-blue-600 hover:underline">
          ← All products
        </Link>
        <h1 className="text-2xl font-bold mt-2">
          {isEdit ? `Edit: ${form.title}` : 'Create product'}
        </h1>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <label className="block">
            <span className="text-sm font-medium">Title *</span>
            <input
              required
              className="border rounded px-3 py-2 w-full"
              value={form.title}
              onChange={(e) => {
                const next: Partial<FormState> = { title: e.target.value };
                if (!isEdit && !form.slug) next.slug = slugify(e.target.value);
                patch(next);
              }}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Slug *</span>
            <input
              required
              disabled={isEdit}
              className="border rounded px-3 py-2 w-full font-mono text-sm disabled:bg-gray-100"
              value={form.slug}
              onChange={(e) => patch({ slug: e.target.value })}
            />
            <span className="text-xs text-gray-500">
              {`runmprc.com/shop/${form.slug || 'your-slug'}`}
            </span>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Description</span>
            <textarea
              rows={5}
              className="border rounded px-3 py-2 w-full"
              value={form.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium">Price (USD) *</span>
              <input
                required
                type="number"
                step="0.01"
                min={0}
                className="border rounded px-3 py-2 w-full"
                value={form.priceDollars}
                onChange={(e) => patch({ priceDollars: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Status</span>
              <select
                className="border rounded px-3 py-2 w-full"
                value={form.status}
                onChange={(e) => patch({ status: e.target.value as ProductStatus })}
              >
                <option value="draft">draft (hidden)</option>
                <option value="active">active (on sale)</option>
                <option value="sold_out">sold out</option>
                <option value="archived">archived</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium">Image URL</span>
            <input
              className="border rounded px-3 py-2 w-full"
              placeholder="https://..."
              value={form.imageUrl}
              onChange={(e) => patch({ imageUrl: e.target.value })}
            />
            <span className="text-xs text-gray-500">
              Paste a URL from your hosted image (Firebase Storage, imgur, etc.)
            </span>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Sizes (comma-separated, optional)</span>
            <input
              className="border rounded px-3 py-2 w-full"
              placeholder="XS, S, M, L, XL"
              value={form.sizes}
              onChange={(e) => patch({ sizes: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Colors (comma-separated, optional)</span>
            <input
              className="border rounded px-3 py-2 w-full"
              placeholder="Black, Heather Gray"
              value={form.colors}
              onChange={(e) => patch({ colors: e.target.value })}
            />
          </label>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold px-6 py-2 rounded"
            >
              {saving ? 'Saving...' : isEdit ? 'Save changes' : 'Create product'}
            </button>
            <Link to="/admin/products" className="border px-6 py-2 rounded hover:bg-gray-50">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </>
  );
}

function AdminProductEditor() {
  return <AdminGuard><Inner /></AdminGuard>;
}

export default AdminProductEditor;
