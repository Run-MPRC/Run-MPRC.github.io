import React, {
  useEffect, useLayoutEffect, useRef, useState,
} from 'react';
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

const LOAD_FAILURE = 'We could not load this product right now. Please try again later.';
const SAVE_PENDING = 'Product save in progress. Do not start another save.';
const SAVE_UNKNOWN = 'We could not confirm that product save. Do not repeat it. Stop and contact the shop lead, treasurer, and platform owner.';

interface ProductLoadOutcome {
  firestore: unknown;
  slug: string;
  status: 'loading' | 'resolved' | 'missing' | 'unavailable';
}

interface ProductSaveOutcome {
  firestore: unknown;
  routeSlug: string | null;
  adminUid: string;
  requestId: number;
  status: 'pending' | 'unknown';
}

function Inner() {
  const { slug: routeSlug } = useParams<{ slug: string }>();
  const isEdit = !!routeSlug;
  const navigate = useNavigate();
  const { services, isReady } = useServiceLocator();
  const { user } = useAuth();
  const adminUid = user?.uid || null;
  const firestore = isReady && services
    ? services.firebaseResources.firestore
    : null;

  const [form, setForm] = useState<FormState>(EMPTY);
  const [loadOutcome, setLoadOutcome] = useState<ProductLoadOutcome | null>(null);
  const [saveOutcome, setSaveOutcome] = useState<ProductSaveOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveSequence = useRef(0);
  const saveRequestBlocked = useRef(false);
  const mounted = useRef(true);
  const saveContext = useRef({
    firestore,
    routeSlug: routeSlug ?? null,
    adminUid,
  });
  saveContext.current = {
    firestore,
    routeSlug: routeSlug ?? null,
    adminUid,
  };

  let currentLoadStatus: ProductLoadOutcome['status'] = 'loading';
  if (!isEdit) currentLoadStatus = 'resolved';
  else if (loadOutcome?.firestore === firestore && loadOutcome.slug === routeSlug) {
    currentLoadStatus = loadOutcome.status;
  }
  const currentSaveOutcome = saveOutcome?.firestore === firestore
    && saveOutcome.routeSlug === (routeSlug ?? null)
    && saveOutcome.adminUid === adminUid
    && saveOutcome.requestId === saveSequence.current
    ? saveOutcome
    : null;
  const savePending = currentSaveOutcome?.status === 'pending';
  const saveUnknown = currentSaveOutcome?.status === 'unknown';

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      saveSequence.current += 1;
      saveRequestBlocked.current = true;
    };
  }, []);

  useLayoutEffect(() => {
    saveSequence.current += 1;
    saveRequestBlocked.current = false;
    setSaveOutcome(null);
    return () => {
      saveSequence.current += 1;
      saveRequestBlocked.current = true;
    };
  }, [firestore, routeSlug, adminUid]);

  useEffect(() => {
    if (!isEdit || !firestore || !routeSlug) return () => undefined;
    let active = true;
    const outcomeKey = { firestore, slug: routeSlug };

    setLoadOutcome({ ...outcomeKey, status: 'loading' });
    setForm(EMPTY);
    setError(null);

    getProductBySlug(firestore, routeSlug)
      .then((p) => {
        if (!active) return;
        if (!p) {
          setError('Product not found');
          setLoadOutcome({ ...outcomeKey, status: 'missing' });
          return;
        }
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
        setLoadOutcome({ ...outcomeKey, status: 'resolved' });
      })
      .catch(() => {
        if (!active) return;
        setLoadOutcome({ ...outcomeKey, status: 'unavailable' });
      });

    return () => { active = false; };
  }, [firestore, routeSlug, isEdit]);

  function patch(p: Partial<FormState>) {
    setForm((f) => ({ ...f, ...p }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saveRequestBlocked.current) return;
    if (isEdit && currentLoadStatus !== 'resolved') return;
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

    const actionFirestore = firestore;
    const actionRouteSlug = routeSlug ?? null;
    const actionAdminUid = adminUid;
    if (
      !actionFirestore
      || !actionAdminUid
      || (isEdit && currentLoadStatus !== 'resolved')
      || saveContext.current.firestore !== actionFirestore
      || saveContext.current.routeSlug !== actionRouteSlug
      || saveContext.current.adminUid !== actionAdminUid
    ) return;

    const requestId = saveSequence.current + 1;
    saveSequence.current = requestId;
    saveRequestBlocked.current = true;
    const outcomeKey = {
      firestore: actionFirestore,
      routeSlug: actionRouteSlug,
      adminUid: actionAdminUid,
      requestId,
    };
    const isCurrentSave = () => mounted.current
      && saveSequence.current === requestId
      && saveContext.current.firestore === actionFirestore
      && saveContext.current.routeSlug === actionRouteSlug
      && saveContext.current.adminUid === actionAdminUid;

    setSaveOutcome({ ...outcomeKey, status: 'pending' });
    try {
      if (isEdit) {
        await updateProduct(actionFirestore, routeSlug!, input);
      } else {
        await createProduct(actionFirestore, input, actionAdminUid);
      }
    } catch {
      if (!isCurrentSave()) return;
      setSaveOutcome({ ...outcomeKey, status: 'unknown' });
      return;
    }
    if (!isCurrentSave()) return;
    navigate('/admin/products');
  }

  if (currentLoadStatus === 'loading') {
    return <div className="container mx-auto p-6">Loading...</div>;
  }

  if (currentLoadStatus === 'unavailable') {
    return (
      <>
        <SEO title="Edit product" noindex />
        <div className="container mx-auto p-4 max-w-2xl">
          <Link to="/admin/products" className="text-sm text-blue-600 hover:underline">
            ← All products
          </Link>
          <h1 className="text-2xl font-bold mt-2">Edit product</h1>
          <p
            className="text-red-600 text-sm mt-4"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >
            {LOAD_FAILURE}
          </p>
        </div>
      </>
    );
  }

  if (savePending || saveUnknown) {
    return (
      <>
        <SEO title={savePending ? 'Saving product' : 'Product save result'} noindex />
        <div className="container mx-auto p-4 max-w-2xl">
          <h1 className="text-2xl font-bold">
            {savePending ? 'Product save in progress' : 'Product save result unknown'}
          </h1>
          <p
            className={savePending ? 'text-gray-600 text-sm mt-4' : 'text-red-600 text-sm mt-4'}
            role={savePending ? 'status' : 'alert'}
            aria-live={savePending ? 'polite' : 'assertive'}
            aria-atomic="true"
          >
            {savePending ? SAVE_PENDING : SAVE_UNKNOWN}
          </p>
        </div>
      </>
    );
  }

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

          {error && (
            <p
              className="text-red-600 text-sm"
              role={error === 'Product not found' ? undefined : 'alert'}
              aria-live={error === 'Product not found' ? undefined : 'assertive'}
              aria-atomic={error === 'Product not found' ? undefined : 'true'}
            >
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={savePending || !firestore || !adminUid}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold px-6 py-2 rounded"
            >
              {savePending ? 'Saving...' : isEdit ? 'Save changes' : 'Create product'}
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
