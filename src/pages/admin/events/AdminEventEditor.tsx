import React, { useEffect, useState } from 'react';
import {
  Link, useNavigate, useParams,
} from 'react-router-dom';
import SEO from '../../../components/SEO';
import { useServiceLocator } from '../../../services/ServiceLocatorContext';
import { useAuth } from '../../../services/hooks/useAuth';
import AdminGuard from '../AdminGuard';
import { CustomField, Event } from '../../../types/events';
import {
  createEvent,
  EventEditorInput,
  updateEvent,
} from '../../../services/events/adminService';
import { getEventBySlug } from '../../../services/events/eventsService';

function slugify(s: string) {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function dollarsToCents(v: string | number): number {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (Number.isNaN(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function centsToDollars(c?: number): string {
  if (typeof c !== 'number') return '';
  return (c / 100).toFixed(2);
}

function tsToInputLocal(ts: any): string {
  if (!ts) return '';
  const d: Date = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function inputLocalToDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

interface FormState {
  slug: string;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  location: string;
  locationDetails: string;
  capacity: string;
  status: 'draft' | 'open' | 'closed' | 'cancelled';
  visibility: 'public' | 'members_only' | 'draft';
  memberDollars: string;
  nonMemberDollars: string;
  earlyBirdDollars: string;
  earlyBirdUntil: string;
  waiverText: string;
  waiverVersion: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  heroImageUrl: string;
  customFields: CustomField[];
  volunteerEnabled: boolean;
  volunteerFields: CustomField[];
  resultsUrl: string;
  resultsText: string;
}

const DEFAULT_FORM: FormState = {
  slug: '',
  title: '',
  description: '',
  startAt: '',
  endAt: '',
  location: '',
  locationDetails: '',
  capacity: '',
  status: 'draft',
  visibility: 'public',
  memberDollars: '',
  nonMemberDollars: '',
  earlyBirdDollars: '',
  earlyBirdUntil: '',
  waiverText: '',
  waiverVersion: '1',
  registrationOpensAt: '',
  registrationClosesAt: '',
  heroImageUrl: '',
  customFields: [],
  volunteerEnabled: false,
  volunteerFields: [],
  resultsUrl: '',
  resultsText: '',
};

function eventToForm(e: Event): FormState {
  return {
    slug: e.slug,
    title: e.title,
    description: e.description,
    startAt: tsToInputLocal(e.startAt),
    endAt: tsToInputLocal(e.endAt),
    location: e.location,
    locationDetails: e.locationDetails || '',
    capacity: e.capacity != null ? String(e.capacity) : '',
    status: e.status,
    visibility: e.visibility,
    memberDollars: centsToDollars(e.pricing?.memberCents),
    nonMemberDollars: centsToDollars(e.pricing?.nonMemberCents),
    earlyBirdDollars: centsToDollars(e.pricing?.earlyBirdCents),
    earlyBirdUntil: tsToInputLocal(e.pricing?.earlyBirdUntil),
    waiverText: e.waiverText,
    waiverVersion: e.waiverVersion || '1',
    registrationOpensAt: tsToInputLocal(e.registrationOpensAt),
    registrationClosesAt: tsToInputLocal(e.registrationClosesAt),
    heroImageUrl: e.heroImageUrl || '',
    customFields: e.customFields || [],
    volunteerEnabled: e.volunteerEnabled === true,
    volunteerFields: e.volunteerFields || [],
    resultsUrl: e.resultsUrl || '',
    resultsText: e.resultsText || '',
  };
}

function formToInput(f: FormState): EventEditorInput | { error: string } {
  const startDate = inputLocalToDate(f.startAt);
  if (!startDate) return { error: 'Start date/time is required' };
  if (!f.title.trim()) return { error: 'Title is required' };
  if (!f.slug.trim()) return { error: 'Slug is required' };
  if (!/^[a-z0-9-]+$/.test(f.slug)) return { error: 'Slug must be lowercase letters, digits, and hyphens' };

  return {
    slug: f.slug,
    title: f.title.trim(),
    description: f.description,
    startAt: startDate,
    endAt: inputLocalToDate(f.endAt),
    location: f.location,
    locationDetails: f.locationDetails,
    capacity: f.capacity ? parseInt(f.capacity, 10) : null,
    status: f.status,
    visibility: f.visibility,
    pricing: {
      memberCents: dollarsToCents(f.memberDollars || '0'),
      nonMemberCents: dollarsToCents(f.nonMemberDollars || '0'),
      ...(f.earlyBirdDollars
        ? { earlyBirdCents: dollarsToCents(f.earlyBirdDollars) }
        : {}),
      ...(f.earlyBirdUntil
        ? { earlyBirdUntil: inputLocalToDate(f.earlyBirdUntil) }
        : {}),
    },
    waiverText: f.waiverText,
    waiverVersion: f.waiverVersion || '1',
    customFields: f.customFields,
    volunteerEnabled: f.volunteerEnabled,
    volunteerFields: f.volunteerFields,
    resultsUrl: f.resultsUrl.trim() || null,
    resultsText: f.resultsText.trim() || null,
    registrationOpensAt: inputLocalToDate(f.registrationOpensAt),
    registrationClosesAt: inputLocalToDate(f.registrationClosesAt),
    heroImageUrl: f.heroImageUrl,
  };
}

function CustomFieldsEditor({
  fields, onChange,
}: {
  fields: CustomField[];
  onChange: (f: CustomField[]) => void;
}) {
  function update(idx: number, patch: Partial<CustomField>) {
    const next = [...fields];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  }
  function remove(idx: number) {
    onChange(fields.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([
      ...fields,
      {
        key: `field_${fields.length + 1}`,
        label: 'New field',
        type: 'text',
        required: false,
      },
    ]);
  }

  return (
    <div className="border rounded p-3 space-y-2">
      <div className="flex justify-between items-center">
        <span className="font-semibold text-sm">Custom registration fields</span>
        <button type="button" onClick={add} className="text-sm text-blue-600 hover:underline">
          + Add field
        </button>
      </div>
      {fields.length === 0 && (
        <p className="text-xs text-gray-500">
          None. Add fields like a pace group, team name, distance, etc.
        </p>
      )}
      {fields.map((f, i) => (
        <div key={i} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end border-b pb-2">
          <label className="text-xs">
            Key
            <input
              className="border rounded px-2 py-1 w-full text-sm"
              value={f.key}
              onChange={(e) => update(i, { key: e.target.value })}
            />
          </label>
          <label className="text-xs">
            Label
            <input
              className="border rounded px-2 py-1 w-full text-sm"
              value={f.label}
              onChange={(e) => update(i, { label: e.target.value })}
            />
          </label>
          <label className="text-xs">
            Type
            <select
              className="border rounded px-2 py-1 w-full text-sm"
              value={f.type}
              onChange={(e) => update(i, { type: e.target.value as any })}
            >
              <option value="text">text</option>
              <option value="email">email</option>
              <option value="tel">tel</option>
              <option value="number">number</option>
              <option value="date">date</option>
              <option value="textarea">textarea</option>
              <option value="select">select</option>
              <option value="checkbox">checkbox</option>
            </select>
          </label>
          <label className="text-xs flex items-center gap-1 pt-4">
            <input
              type="checkbox"
              checked={f.required}
              onChange={(e) => update(i, { required: e.target.checked })}
            />
            required
          </label>
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-red-600 text-xs hover:underline"
            >
              Remove
            </button>
          </div>
          {f.type === 'select' && (
            <label className="text-xs md:col-span-5">
              Options (comma-separated)
              <input
                className="border rounded px-2 py-1 w-full text-sm"
                value={(f.options || []).join(', ')}
                onChange={(e) => update(i, {
                  options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                })}
              />
            </label>
          )}
        </div>
      ))}
    </div>
  );
}

function Inner() {
  const { slug: routeSlug } = useParams<{ slug: string }>();
  const isEdit = !!routeSlug;
  const navigate = useNavigate();
  const { services, isReady } = useServiceLocator();
  const { user } = useAuth();

  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEdit) return;
    if (!isReady || !services) return;
    getEventBySlug(services.firebaseResources.firestore, routeSlug!)
      .then((e) => {
        if (!e) {
          setError('Event not found');
        } else {
          setForm(eventToForm(e));
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
    const result = formToInput(form);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await updateEvent(services!.firebaseResources.firestore, routeSlug!, result);
      } else {
        await createEvent(services!.firebaseResources.firestore, result, user?.uid || 'admin');
      }
      navigate('/admin/events');
    } catch (err: any) {
      setError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="container mx-auto p-6">Loading...</div>;

  return (
    <>
      <SEO title={isEdit ? 'Edit event' : 'New event'} noindex />
      <div className="container mx-auto p-4 max-w-3xl">
        <Link to="/admin/events" className="text-sm text-blue-600 hover:underline">
          ← All events
        </Link>
        <h1 className="text-2xl font-bold mt-2">
          {isEdit ? `Edit: ${form.title}` : 'Create event'}
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
            <span className="text-sm font-medium">Slug (URL path) *</span>
            <input
              required
              disabled={isEdit}
              className="border rounded px-3 py-2 w-full font-mono text-sm disabled:bg-gray-100"
              value={form.slug}
              onChange={(e) => patch({ slug: e.target.value })}
            />
            <span className="text-xs text-gray-500">
              {`runmprc.com/events/${form.slug || 'your-slug'}`}
              {isEdit && ' (locked after creation)'}
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
              <span className="text-sm font-medium">Start *</span>
              <input
                required
                type="datetime-local"
                className="border rounded px-3 py-2 w-full"
                value={form.startAt}
                onChange={(e) => patch({ startAt: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">End</span>
              <input
                type="datetime-local"
                className="border rounded px-3 py-2 w-full"
                value={form.endAt}
                onChange={(e) => patch({ endAt: e.target.value })}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium">Registration opens</span>
              <input
                type="datetime-local"
                className="border rounded px-3 py-2 w-full"
                value={form.registrationOpensAt}
                onChange={(e) => patch({ registrationOpensAt: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Registration closes</span>
              <input
                type="datetime-local"
                className="border rounded px-3 py-2 w-full"
                value={form.registrationClosesAt}
                onChange={(e) => patch({ registrationClosesAt: e.target.value })}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium">Location</span>
            <input
              className="border rounded px-3 py-2 w-full"
              value={form.location}
              onChange={(e) => patch({ location: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Location details</span>
            <input
              className="border rounded px-3 py-2 w-full"
              placeholder="Parking, check-in, etc."
              value={form.locationDetails}
              onChange={(e) => patch({ locationDetails: e.target.value })}
            />
          </label>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="block">
              <span className="text-sm font-medium">Capacity</span>
              <input
                type="number"
                min={0}
                className="border rounded px-3 py-2 w-full"
                placeholder="unlimited"
                value={form.capacity}
                onChange={(e) => patch({ capacity: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Status</span>
              <select
                className="border rounded px-3 py-2 w-full"
                value={form.status}
                onChange={(e) => patch({ status: e.target.value as any })}
              >
                <option value="draft">draft</option>
                <option value="open">open</option>
                <option value="closed">closed</option>
                <option value="cancelled">cancelled</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium">Visibility</span>
              <select
                className="border rounded px-3 py-2 w-full"
                value={form.visibility}
                onChange={(e) => patch({ visibility: e.target.value as any })}
              >
                <option value="public">public</option>
                <option value="members_only">members only</option>
                <option value="draft">draft (hidden)</option>
              </select>
            </label>
          </div>

          <fieldset className="border rounded p-3">
            <legend className="text-sm font-medium px-1">Pricing (USD)</legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm">Member price</span>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  className="border rounded px-3 py-2 w-full"
                  value={form.memberDollars}
                  onChange={(e) => patch({ memberDollars: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="text-sm">Non-member price</span>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  className="border rounded px-3 py-2 w-full"
                  value={form.nonMemberDollars}
                  onChange={(e) => patch({ nonMemberDollars: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="text-sm">Early-bird price (optional)</span>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  className="border rounded px-3 py-2 w-full"
                  value={form.earlyBirdDollars}
                  onChange={(e) => patch({ earlyBirdDollars: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="text-sm">Early-bird until</span>
                <input
                  type="datetime-local"
                  className="border rounded px-3 py-2 w-full"
                  value={form.earlyBirdUntil}
                  onChange={(e) => patch({ earlyBirdUntil: e.target.value })}
                />
              </label>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Enter $0.00 to create a free event (no Stripe charge).
            </p>
          </fieldset>

          <fieldset className="border rounded p-3">
            <legend className="text-sm font-medium px-1">Waiver</legend>
            <label className="block">
              <span className="text-sm">Waiver version</span>
              <input
                className="border rounded px-3 py-2 w-full"
                value={form.waiverVersion}
                onChange={(e) => patch({ waiverVersion: e.target.value })}
              />
              <span className="text-xs text-gray-500">
                Bump when you change the waiver text — old accepted versions stay linked to past registrations.
              </span>
            </label>
            <label className="block mt-2">
              <span className="text-sm">Waiver text</span>
              <textarea
                rows={6}
                className="border rounded px-3 py-2 w-full text-sm"
                value={form.waiverText}
                onChange={(e) => patch({ waiverText: e.target.value })}
              />
            </label>
          </fieldset>

          <CustomFieldsEditor
            fields={form.customFields}
            onChange={(f) => patch({ customFields: f })}
          />

          <fieldset className="border rounded p-3">
            <legend className="text-sm font-medium px-1">Volunteer signup</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.volunteerEnabled}
                onChange={(e) => patch({ volunteerEnabled: e.target.checked })}
              />
              Allow volunteers to sign up for this event
            </label>
            {form.volunteerEnabled && (
              <div className="mt-3">
                <div className="text-xs text-gray-600 mb-2">
                  Fields shown only when someone chooses &quot;Volunteer&quot;.
                  Use these for role preference, shift, dietary needs, etc.
                </div>
                <CustomFieldsEditor
                  fields={form.volunteerFields}
                  onChange={(f) => patch({ volunteerFields: f })}
                />
              </div>
            )}
          </fieldset>

          <fieldset className="border rounded p-3">
            <legend className="text-sm font-medium px-1">Race results (post-event)</legend>
            <label className="block">
              <span className="text-sm">Results URL</span>
              <input
                className="border rounded px-3 py-2 w-full"
                placeholder="https://... (PDF, Google Sheet, or external page)"
                value={form.resultsUrl}
                onChange={(e) => patch({ resultsUrl: e.target.value })}
              />
            </label>
            <label className="block mt-2">
              <span className="text-sm">Results intro text (optional)</span>
              <textarea
                rows={3}
                className="border rounded px-3 py-2 w-full text-sm"
                placeholder="Recap, course conditions, notable finishes..."
                value={form.resultsText}
                onChange={(e) => patch({ resultsText: e.target.value })}
              />
            </label>
            <p className="text-xs text-gray-500 mt-2">
              Fill these in after the race. They&apos;ll show up on the event page for everyone.
            </p>
          </fieldset>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold px-6 py-2 rounded"
            >
              {saving ? 'Saving...' : isEdit ? 'Save changes' : 'Create event'}
            </button>
            <Link
              to="/admin/events"
              className="border px-6 py-2 rounded hover:bg-gray-50"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </>
  );
}

function AdminEventEditor() {
  return (
    <AdminGuard>
      <Inner />
    </AdminGuard>
  );
}

export default AdminEventEditor;
