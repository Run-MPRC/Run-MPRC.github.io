import React, {
  useEffect, useRef, useState,
} from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import SEO from '../../components/SEO';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import { useAuth } from '../../services/hooks/useAuth';
import {
  ensureMyProfile,
  getMyProfile,
  updateMyProfile,
  listMyRegistrations,
  MEMBER_PROFILE_LIMITS,
  validateMemberProfileFields,
  MyRegistrationsResponse,
  MyMemberProfile,
} from '../../services/account/accountService';
import { formatEventDate, formatPrice } from '../../services/events/eventsService';
import StravaSection from './StravaSection';
import { getLocationReturnPath } from '../login/loginReturnPath';
import './Account.css';

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

const VERIFICATION_RESEND_COOLDOWN_SECONDS = 60;

function ResendVerificationButton() {
  const { services } = useServiceLocator();
  const [state, setState] = useState<
    'idle' | 'sending' | 'accepted' | 'unavailable'
  >('idle');
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const inFlightRef = useRef(false);
  const retryAtRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!retryAt) return undefined;
    const deadline = retryAt;

    function updateCountdown() {
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemainingSeconds(seconds);
      if (seconds === 0) {
        retryAtRef.current = 0;
        setRetryAt(null);
      }
    }

    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  async function handleClick() {
    if (
      !services
      || inFlightRef.current
      || retryAtRef.current > Date.now()
    ) return;

    inFlightRef.current = true;
    setState('sending');
    try {
      await services.identityService.resendVerificationEmail();
      if (mountedRef.current) setState('accepted');
    } catch {
      if (mountedRef.current) setState('unavailable');
    } finally {
      const nextRetryAt = Date.now() + VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000;
      retryAtRef.current = nextRetryAt;
      inFlightRef.current = false;
      if (mountedRef.current) {
        setRemainingSeconds(VERIFICATION_RESEND_COOLDOWN_SECONDS);
        setRetryAt(nextRetryAt);
      }
    }
  }

  const coolingDown = remainingSeconds > 0;
  let buttonLabel = 'Request another verification email';
  const countdownUnit = remainingSeconds === 1 ? 'second' : 'seconds';
  if (state === 'sending') {
    buttonLabel = 'Requesting...';
  } else if (coolingDown) {
    buttonLabel = `Try again in ${remainingSeconds} ${countdownUnit}`;
  }

  return (
    <div className="verification-resend">
      {state === 'sending' && (
        <p
          id="verification-resend-result"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="verification-resend__result verification-resend__result--sending"
        >
          Requesting a verification email...
        </p>
      )}
      {state === 'accepted' && (
        <p
          id="verification-resend-result"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="verification-resend__result verification-resend__result--accepted"
        >
          The request was accepted. Delivery can take time. Check Inbox and Spam.
        </p>
      )}
      {state === 'unavailable' && (
        <p
          id="verification-resend-result"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          className="verification-resend__result verification-resend__result--unavailable"
        >
          We could not request an email right now. Wait for the countdown, then try
          once more.
        </p>
      )}
      {coolingDown && (
        <p id="verification-resend-countdown" className="verification-resend__countdown">
          Another request is available in
          {' '}
          {remainingSeconds}
          {' '}
          {countdownUnit}
          .
        </p>
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={!services || state === 'sending' || coolingDown}
        aria-describedby={[
          state !== 'idle'
            ? 'verification-resend-result'
            : null,
          coolingDown ? 'verification-resend-countdown' : null,
        ].filter(Boolean).join(' ') || undefined}
        className="verification-resend__button"
      >
        {buttonLabel}
      </button>
    </div>
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

const PROFILE_UNAVAILABLE_MESSAGE = 'Your profile is temporarily unavailable. Sign out and try again later. No membership or payment status was changed.';
const PROFILE_CHANGE_UNCONFIRMED_MESSAGE = 'We could not confirm your profile change. Try the profile again before making another change.';

export function AccountContent({
  user,
}: {
  user: NonNullable<ReturnType<typeof useAuth>['user']>;
}) {
  const { services } = useServiceLocator();
  const [profile, setProfile] = useState<MyMemberProfile | null>(null);
  const [profileState, setProfileState] = useState<'loading' | 'ready' | 'unavailable'>(
    'loading',
  );
  const [profileLoadAttempt, setProfileLoadAttempt] = useState(0);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [regsData, setRegsData] = useState<MyRegistrationsResponse | null>(null);
  const [regsLoading, setRegsLoading] = useState(true);
  const [regsError, setRegsError] = useState<string | null>(null);

  useEffect(() => {
    if (!services) return undefined;
    const activeServices = services;
    let active = true;

    async function loadProfile() {
      setProfileState('loading');
      setProfile(null);
      setProfileError(null);
      setEditing(false);
      setSaveError(null);

      try {
        await ensureMyProfile(activeServices.firebaseResources.app);
        const nextProfile = await getMyProfile(
          activeServices.firebaseResources.firestore,
          user.uid,
        );
        if (!nextProfile) throw new Error('Profile unavailable after setup.');
        if (!active) return;
        setProfile(nextProfile);
        setFullName(nextProfile.fullName || '');
        setProfileState('ready');
      } catch {
        if (!active) return;
        setProfileError(PROFILE_UNAVAILABLE_MESSAGE);
        setProfileState('unavailable');
      }
    }

    loadProfile();
    return () => { active = false; };
  }, [services, user.uid, profileLoadAttempt]);

  useEffect(() => {
    if (!services || profileState !== 'ready') return undefined;
    let active = true;
    setRegsData(null);
    setRegsError(null);
    setRegsLoading(true);
    listMyRegistrations(services.firebaseResources.app)
      .then((result) => {
        if (!active) return;
        setRegsData(result);
        setRegsLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setRegsError('We could not load your registrations right now.');
        setRegsLoading(false);
      });
    return () => { active = false; };
  }, [services, profileState, user.uid]);

  async function handleSave() {
    if (!services) return;
    const validation = validateMemberProfileFields({ fullName });
    if (!validation.valid) {
      setSaveError(validation.message);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await updateMyProfile(
        services.firebaseResources.firestore,
        user.uid,
        validation.fields,
      );
      const fresh = await getMyProfile(services.firebaseResources.firestore, user.uid);
      if (!fresh) throw new Error('Profile unavailable after save.');
      setProfile(fresh);
      setFullName(fresh.fullName || '');
      setProfileError(null);
      setProfileState('ready');
      setEditing(false);
    } catch {
      setProfile(null);
      setEditing(false);
      setSaveError(null);
      setProfileError(PROFILE_CHANGE_UNCONFIRMED_MESSAGE);
      setProfileState('unavailable');
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    if (!services) return;
    await services.identityService.signOut();
  }

  if (profileState === 'loading') {
    return (
      <div role="status" className="container mx-auto p-6">
        Loading profile...
      </div>
    );
  }

  const upcoming = regsData?.registrations.filter((r) => {
    const ev = regsData.events[r.eventId];
    if (!ev?.startAt) return false;
    const ms = typeof (ev.startAt as any).toMillis === 'function'
      ? (ev.startAt as any).toMillis()
      : new Date(ev.startAt as any).getTime();
    return ms > Date.now();
  }) || [];
  const past = regsData?.registrations.filter((r) => !upcoming.includes(r)) || [];

  return (
    <>
      <SEO title="My Account" noindex />
      <div className="container mx-auto p-4 max-w-3xl">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">My Account</h1>
          <button
            type="button"
            onClick={handleSignOut}
            className="text-sm text-gray-600 hover:underline"
          >
            Sign out
          </button>
        </div>

        <section className="border rounded-lg p-4 mt-4 bg-gray-50">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-semibold">Profile</h2>
            {!editing && profileState === 'ready' && profile && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-sm text-blue-600 hover:underline"
              >
                Edit
              </button>
            )}
          </div>
          {profileError && (
            <div
              role="alert"
              className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700"
            >
              <p>{profileError}</p>
              <button
                type="button"
                onClick={() => setProfileLoadAttempt((attempt) => attempt + 1)}
                className="mt-2 text-blue-700 underline"
              >
                Try profile again
              </button>
            </div>
          )}
          {!editing && profileState === 'ready' && profile && (
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
          {profileState === 'ready' && profile && (
            <p className="mt-3 text-sm text-gray-600">
              Phone collection is temporarily paused while we review how contact
              information is handled. This update does not change existing stored
              information.
            </p>
          )}
          {editing && (
            <div className="space-y-3">
              <div>
                <label htmlFor="profile-full-name" className="block">
                  <span className="text-sm font-medium">Full name</span>
                  <input
                    id="profile-full-name"
                    type="text"
                    className="border rounded px-3 py-2 w-full"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    aria-describedby="full-name-limit"
                    autoComplete="name"
                    disabled={saving}
                    maxLength={MEMBER_PROFILE_LIMITS.fullName}
                  />
                </label>
                <span id="full-name-limit" className="text-xs text-gray-500">
                  Up to
                  {' '}
                  {MEMBER_PROFILE_LIMITS.fullName}
                  {' '}
                  characters.
                </span>
              </div>
              {saveError && (
                <p role="alert" className="text-sm text-red-600">{saveError}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setFullName(profile?.fullName || '');
                    setSaveError(null);
                  }}
                  disabled={saving}
                  className="border px-4 py-2 rounded hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {profile && !profile.emailVerified && (
            <div className="account-verification-notice">
              <span>Your email address is unverified.</span>
              <ResendVerificationButton key={user.uid} />
            </div>
          )}
          {profile?.role === 'unverified' && (
            <div className="mt-3 p-3 bg-amber-100 border border-amber-300 rounded text-sm">
              Your account is pending member verification. An admin will upgrade your
              membership once dues are confirmed. You can still register for public events.
            </div>
          )}
        </section>

        {profileState === 'ready' && (
          <section className="mt-6">
            <h2 className="text-lg font-semibold mb-3">Upcoming events</h2>
            {regsLoading && <p className="text-gray-500 text-sm">Loading...</p>}
            {regsError && <p role="alert" className="text-red-500 text-sm">{regsError}</p>}
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
        )}

        {profileState === 'ready' && past.length > 0 && (
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

        {profileState === 'ready' && <StravaSection uid={user.uid} />}
      </div>
    </>
  );
}

function Account() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const location = useLocation();

  if (isLoading) return <div className="container mx-auto p-6">Loading...</div>;
  if (!isAuthenticated || !user) {
    return (
      <Navigate
        to="/login"
        state={{ from: getLocationReturnPath(location) }}
        replace
      />
    );
  }
  return <AccountContent user={user} />;
}

export default Account;
