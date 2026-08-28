import React, { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import SEO from '../../components/SEO';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import { useAuth } from '../../services/hooks/useAuth';
import { Member } from '../../types/member';
import {
  getMyProfile,
  updateMyProfile,
  listMyRegistrations,
  MyRegistrationsResponse,
} from '../../services/account/accountService';
import { formatEventDate, formatPrice } from '../../services/events/eventsService';
import StravaSection from './StravaSection';

function roleLabel(role: string) {
  if (role === 'admin') return 'Admin';
  if (role === 'member') return 'Member';
  if (role === 'unverified') return 'Unverified';
  return role;
}

function tsToDate(ts: Timestamp | null | undefined) {
  if (!ts) return '';
  const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts as any);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function ResendVerificationButton() {
  const { services } = useServiceLocator();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function handleClick() {
    if (!services) return;
    setState('sending');
    try {
      await services.identityService.resendVerificationEmail();
      setState('sent');
    } catch {
      setState('error');
    }
  }

  if (state === 'sent') {
    return <span className="text-xs text-green-700">Verification email sent.</span>;
  }
  if (state === 'error') {
    return <span className="text-xs text-red-700">Failed to send — try again later.</span>;
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'sending'}
      className="text-sm text-blue-700 hover:underline disabled:opacity-50"
    >
      {state === 'sending' ? 'Sending...' : 'Resend verification email'}
    </button>
  );
}

function RegistrationRow({
  reg, event,
}: {
  reg: MyRegistrationsResponse['registrations'][number];
  event?: MyRegistrationsResponse['events'][string];
}) {
  const statusColor: Record<string, string> = {
    paid: 'bg-green-100 text-green-800',
    pending: 'bg-gray-200 text-gray-700',
    refunded: 'bg-red-100 text-red-800',
    partially_refunded: 'bg-amber-100 text-amber-800',
    cancelled: 'bg-gray-300 text-gray-600',
    comp: 'bg-purple-100 text-purple-800',
  };
  return (
    <div className="border rounded-lg p-3 mb-2 flex justify-between items-start gap-3">
      <div className="flex-1">
        {event ? (
          <Link
            to={`/events/${event.slug}`}
            className="font-semibold text-blue-700 hover:underline"
          >
            {event.title}
          </Link>
        ) : (
          <span className="font-semibold">Event no longer available</span>
        )}
        <p className="text-sm text-gray-600 mt-1">
          {event && formatEventDate(event.startAt as any)}
          {event?.location ? ` · ${event.location}` : ''}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Registered
          {' '}
          {tsToDate(reg.createdAt)}
          {' · '}
          ID:
          {' '}
          <code>{reg.id}</code>
        </p>
      </div>
      <div className="text-right">
        <span className={`text-xs px-2 py-0.5 rounded ${statusColor[reg.status] || 'bg-gray-100'}`}>
          {reg.status}
        </span>
        <p className="text-sm mt-1">{formatPrice(reg.amountCents || 0)}</p>
      </div>
    </div>
  );
}

function AccountContent({ user }: { user: NonNullable<ReturnType<typeof useAuth>['user']> }) {
  const { services } = useServiceLocator();
  const [profile, setProfile] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const [profileRetry, setProfileRetry] = useState(0);
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [regsData, setRegsData] = useState<MyRegistrationsResponse | null>(null);
  const [regsLoading, setRegsLoading] = useState(true);
  const [regsError, setRegsError] = useState<string | null>(null);

  useEffect(() => {
    if (!services) return;
    setLoading(true);
    setProfileError(false);
    getMyProfile(services.firebaseResources.firestore, user.uid)
      .then((p) => {
        if (!p) {
          setProfileError(true);
          setLoading(false);
          return;
        }
        setProfile(p);
        setFullName(p?.fullName || '');
        setPhoneNumber(p?.phoneNumber || '');
        setLoading(false);
      })
      .catch(() => {
        setProfileError(true);
        setLoading(false);
      });
  }, [services, user.uid, profileRetry]);

  useEffect(() => {
    if (!services) return;
    listMyRegistrations(services.firebaseResources.app)
      .then((r) => { setRegsData(r); setRegsLoading(false); })
      .catch(() => {
        setRegsError('We could not load your registrations. Try again later.');
        setRegsLoading(false);
      });
  }, [services]);

  async function handleSave() {
    if (!services) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      await updateMyProfile(
        services.firebaseResources.firestore,
        user.uid,
        { fullName, phoneNumber },
      );
      const fresh = await getMyProfile(services.firebaseResources.firestore, user.uid);
      setProfile(fresh);
      setEditing(false);
      setSaveSuccess(true);
    } catch {
      setSaveError('Your changes could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    if (!services) return;
    await services.identityService.signOut();
  }

  if (loading) return <div className="container mx-auto p-6">Loading profile...</div>;

  const upcoming = regsData?.registrations.filter((r) => {
    const ev = regsData.events[r.eventId];
    if (!ev?.startAt) return false;
    const ms = typeof (ev.startAt as any).toMillis === 'function'
      ? (ev.startAt as any).toMillis()
      : new Date(ev.startAt as any).getTime();
    return ms > Date.now();
  }) || [];
  const past = regsData?.registrations.filter((r) => !upcoming.includes(r)) || [];
  const trimmedName = fullName.trim();
  const trimmedPhone = phoneNumber.trim();
  const profileChanged = profile != null
    && (trimmedName !== (profile.fullName || '')
      || trimmedPhone !== (profile.phoneNumber || ''));
  const formValid = trimmedName.length <= 200 && trimmedPhone.length <= 40;

  return (
    <>
      <SEO title="My Account" noindex />
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex justify-between items-start gap-4">
          <div>
            <h1 className="text-3xl font-bold">My Account</h1>
            <p className="mt-1 text-sm text-gray-600">
              Manage your contact details, registrations, and connected services.
            </p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="text-sm text-gray-600 hover:underline"
          >
            Sign out
          </button>
        </div>

        <section className="border border-gray-200 rounded-xl p-5 mt-6 bg-white shadow-sm">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-semibold">Profile</h2>
            {!editing && profile && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-sm font-semibold text-blue-700 hover:underline"
              >
                Edit
              </button>
            )}
          </div>
          {profileError && (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <p className="font-semibold text-amber-900">Account details are unavailable</p>
              <p className="mt-1 text-sm text-amber-800">
                We could not securely load your profile. Your account is still signed in.
              </p>
              <button
                type="button"
                onClick={() => setProfileRetry((value) => value + 1)}
                className="mt-3 rounded border border-amber-700 px-3 py-1.5 text-sm font-semibold text-amber-900 hover:bg-amber-100"
              >
                Try again
              </button>
            </div>
          )}
          {saveSuccess && !editing && (
            <p role="status" className="mb-3 rounded bg-green-50 px-3 py-2 text-sm text-green-800">
              Profile updated.
            </p>
          )}
          {!editing && profile && (
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-6 text-sm">
              <div>
                <dt className="text-gray-500 text-xs">Name</dt>
                <dd>{profile.fullName || <span className="text-gray-400">not set</span>}</dd>
              </div>
              <div>
                <dt className="text-gray-500 text-xs">Email</dt>
                <dd>
                  {profile.email}
                  {profile.emailVerified ? '' : ' (unverified)'}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500 text-xs">Phone</dt>
                <dd>{profile.phoneNumber || <span className="text-gray-400">not set</span>}</dd>
              </div>
              <div>
                <dt className="text-gray-500 text-xs">Membership</dt>
                <dd>{roleLabel(profile.role)}</dd>
              </div>
              <div>
                <dt className="text-gray-500 text-xs">Member since</dt>
                <dd>{tsToDate(profile.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-gray-500 text-xs">Last sign-in</dt>
                <dd>{tsToDate(profile.lastLogin)}</dd>
              </div>
            </dl>
          )}
          {editing && (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                handleSave();
              }}
            >
              <label className="block">
                <span className="text-sm font-medium">Full name</span>
                <input
                  type="text"
                  maxLength={200}
                  autoComplete="name"
                  className="mt-1 border rounded-lg px-3 py-2.5 w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
                <span className="mt-1 block text-xs text-gray-500">
                  The name other club members and event organizers should use.
                </span>
              </label>
              <label className="block">
                <span className="text-sm font-medium">Phone number</span>
                <input
                  type="tel"
                  maxLength={40}
                  autoComplete="tel"
                  className="mt-1 border rounded-lg px-3 py-2.5 w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                />
                <span className="mt-1 block text-xs text-gray-500">
                  Optional. Used only for club-related communication.
                </span>
              </label>
              {saveError && <p role="alert" className="text-sm text-red-700">{saveError}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={saving || !profileChanged || !formValid}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded"
                >
                  {saving ? 'Saving...' : 'Save changes'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setFullName(profile?.fullName || '');
                    setPhoneNumber(profile?.phoneNumber || '');
                    setSaveError(null);
                    setSaveSuccess(false);
                  }}
                  className="border px-4 py-2 rounded hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {profile && !profile.emailVerified && (
            <div className="mt-3 p-3 bg-amber-100 border border-amber-300 rounded text-sm flex justify-between items-center gap-2">
              <span>Your email address is unverified.</span>
              <ResendVerificationButton />
            </div>
          )}
          {profile?.role === 'unverified' && (
            <div className="mt-3 p-3 bg-amber-100 border border-amber-300 rounded text-sm">
              Your account is pending member verification. An admin will upgrade your
              membership once dues are confirmed. You can still register for public events.
            </div>
          )}
        </section>

        <section className="mt-6">
          <h2 className="text-lg font-semibold mb-3">Upcoming events</h2>
          {regsLoading && <p className="text-gray-500 text-sm">Loading...</p>}
          {regsError && (
            <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-amber-900 text-sm">
              {regsError}
            </p>
          )}
          {!regsLoading && upcoming.length === 0 && (
            <p className="text-gray-500 text-sm">
              You haven&apos;t registered for any upcoming events.
              {' '}
              <Link to="/events" className="text-blue-600 hover:underline">
                Browse events
              </Link>
              .
            </p>
          )}
          {upcoming.map((r) => (
            <RegistrationRow
              key={r.id}
              reg={r}
              event={regsData?.events[r.eventId]}
            />
          ))}
        </section>

        {past.length > 0 && (
          <section className="mt-6">
            <h2 className="text-lg font-semibold mb-3">Past events</h2>
            {past.map((r) => (
              <RegistrationRow
                key={r.id}
                reg={r}
                event={regsData?.events[r.eventId]}
              />
            ))}
          </section>
        )}

        <StravaSection uid={user.uid} />
      </div>
    </>
  );
}

function Account() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const location = useLocation();

  if (isLoading) return <div className="container mx-auto p-6">Loading...</div>;
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <AccountContent user={user} />;
}

export default Account;
