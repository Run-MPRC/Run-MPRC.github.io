import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import SEO from '../../components/SEO';
import {
  getEventBySlug,
  createCheckoutSession,
  formatPrice,
  formatEventDate,
} from '../../services/events/eventsService';
import { Event, CustomField } from '../../types/events';
import { useAuth } from '../../services/hooks/useAuth';
import { track, events as analyticsEvents } from '../../services/analytics/analytics';
import buildRaceCheckoutRequest, {
  customValuesAfterSignupTypeChange,
} from './raceCheckoutRequest';

type PriceTier = 'member' | 'nonMember' | 'earlyBird';

interface RunnerFormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  shirtSize: string;
  dob: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
}

const EMPTY_RUNNER: RunnerFormState = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  shirtSize: '',
  dob: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
};
const EVENT_LOAD_FAILURE = 'We could not load this event right now. Please try again later.';
function CustomFieldInput({
  field, value, onChange,
}: {
  field: CustomField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const strVal = typeof value === 'string' ? value : '';
  const common = {
    id: `cf_${field.key}`,
    name: field.key,
    required: field.required,
    className: 'border rounded px-3 py-2 w-full',
  };

  if (field.type === 'textarea') {
    return (
      <textarea
        {...common}
        value={strVal}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (field.type === 'select') {
    return (
      <select {...common} value={strVal} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select...</option>
        {(field.options || []).map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  }
  if (field.type === 'checkbox') {
    return (
      <input
        type="checkbox"
        id={`cf_${field.key}`}
        name={field.key}
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  return (
    <input
      type={field.type}
      {...common}
      value={strVal}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function EventRegister() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { services, isReady } = useServiceLocator();
  const { user, isMember, isAuthenticated } = useAuth();

  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [runner, setRunner] = useState<RunnerFormState>({
    ...EMPTY_RUNNER,
    email: user?.email || '',
  });
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [signupType, setSignupType] = useState<'participant' | 'volunteer'>('participant');

  useEffect(() => {
    if (user?.email && !runner.email) {
      setRunner((r) => ({ ...r, email: user.email || '' }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!isReady || !services || !slug) return () => undefined;
    let active = true; setLoading(true); setEvent(null); setError(null);
    getEventBySlug(services.firebaseResources.firestore, slug)
      .then((e) => {
        if (!active) return;
        setEvent(e); setLoading(false);
        if (!e) setError('Event not found');
      })
      .catch(() => { if (active) { setError(EVENT_LOAD_FAILURE); setLoading(false); } });
    return () => { active = false; };
  }, [services, isReady, slug]);
  const effectiveTier: PriceTier = useMemo(() => {
    if (!event) return 'nonMember';
    const now = Date.now();
    const eb = event.pricing?.earlyBirdUntil;
    const ebActive = !!event.pricing?.earlyBirdCents
      && !!eb
      && now < (eb as any).toMillis();
    if (ebActive) return 'earlyBird';
    if (isMember) return 'member';
    return 'nonMember';
  }, [event, isMember]);

  const displayPrice = useMemo(() => {
    if (!event) return 0;
    if (effectiveTier === 'member') return event.pricing.memberCents;
    if (effectiveTier === 'earlyBird') return event.pricing.earlyBirdCents || 0;
    return event.pricing.nonMemberCents;
  }, [event, effectiveTier]);

  if (loading) return <div className="container mx-auto p-6">Loading...</div>;
  if (error || !event) {
    return (
      <div className="container mx-auto p-6">
        <p role={error === EVENT_LOAD_FAILURE ? 'alert' : undefined} aria-live={error === EVENT_LOAD_FAILURE ? 'assertive' : undefined} aria-atomic={error === EVENT_LOAD_FAILURE ? true : undefined} className="text-red-500">{error || 'Event not found.'}</p>
        <Link to="/events" className="text-blue-600 hover:underline">
          ← Back to events
        </Link>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!event) return;
    if (!waiverAccepted) {
      setError('You must accept the waiver to register.');
      return;
    }

    track(analyticsEvents.registrationSubmitAttempt, {
      slug: event.slug,
      tier: signupType === 'volunteer' ? 'comp' : effectiveTier,
      signup_type: signupType,
    });

    setSubmitting(true);
    try {
      const result = await createCheckoutSession(
        services!.firebaseResources.app,
        buildRaceCheckoutRequest({
          eventId: event.id,
          runner: {
            firstName: runner.firstName,
            lastName: runner.lastName,
            email: runner.email,
            phone: runner.phone,
            dob: runner.dob,
            shirtSize: runner.shirtSize,
            emergencyContactName: runner.emergencyContactName,
            emergencyContactPhone: runner.emergencyContactPhone,
          },
          customValues,
          eventCustomFields: event.customFields || [],
          volunteerCustomFields: event.volunteerFields,
          priceTier: effectiveTier,
          signupType,
        }),
      );

      if (result.free) {
        track(analyticsEvents.registrationCheckoutFree, {
          slug: event.slug, tier: effectiveTier,
        });
        navigate(
          `/register/success?reg=${result.registrationId}&token=${result.confirmationToken || ''}&event=${event.id}`,
        );
        return;
      }
      if (result.url) {
        track(analyticsEvents.registrationCheckoutInitiated, {
          slug: event.slug, tier: effectiveTier, amount_cents: displayPrice,
        });
        window.location.href = result.url;
        return;
      }
      setError('Unexpected response from checkout service.');
    } catch (err: any) {
      track(analyticsEvents.registrationError, {
        slug: event?.slug, message: err?.message?.slice(0, 100),
      });
      setError(err?.message || 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  }

  function selectSignupType(nextType: 'participant' | 'volunteer') {
    setCustomValues((currentValues) => customValuesAfterSignupTypeChange(
      signupType,
      nextType,
      currentValues,
    ));
    setSignupType(nextType);
  }

  return (
    <>
      <SEO title={`Register — ${event.title}`} noindex url={`https://runmprc.com/events/${event.slug}/register`} />
      <div className="container mx-auto p-4 max-w-2xl">
        <Link to={`/events/${event.slug}`} className="text-sm text-blue-600 hover:underline">
          ← Back to event
        </Link>
        <h1 className="text-2xl font-bold mt-2">
          Register for
          {' '}
          {event.title}
        </h1>
        <p className="text-gray-600 mt-1">
          {formatEventDate(event.startAt)}
          {event.location ? ` · ${event.location}` : ''}
        </p>

        {event.volunteerEnabled && (
          <div className="mt-4 p-3 border rounded bg-gray-50">
            <div className="text-sm font-medium mb-2">I want to:</div>
            <div className="flex gap-2 flex-wrap">
              <label className={`flex-1 min-w-[140px] border rounded p-2 cursor-pointer ${signupType === 'participant' ? 'border-blue-600 bg-blue-50' : 'bg-white'}`}>
                <input
                  type="radio"
                  name="signupType"
                  value="participant"
                  checked={signupType === 'participant'}
                  onChange={() => selectSignupType('participant')}
                  className="mr-2"
                />
                Register as participant
              </label>
              <label className={`flex-1 min-w-[140px] border rounded p-2 cursor-pointer ${signupType === 'volunteer' ? 'border-green-600 bg-green-50' : 'bg-white'}`}>
                <input
                  type="radio"
                  name="signupType"
                  value="volunteer"
                  checked={signupType === 'volunteer'}
                  onChange={() => selectSignupType('volunteer')}
                  className="mr-2"
                />
                Volunteer for this event
              </label>
            </div>
          </div>
        )}

        {signupType === 'participant' ? (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded">
            <div className="flex justify-between">
              <span>Your price</span>
              <span className="font-semibold">
                {formatPrice(displayPrice)}
                {' '}
                <span className="text-xs text-gray-600">
                  (
                  {effectiveTier === 'member'
                    ? 'member'
                    : effectiveTier === 'earlyBird'
                      ? 'early bird'
                      : 'non-member'}
                  )
                </span>
              </span>
            </div>
            {!isAuthenticated && (
              <p className="text-xs text-gray-700 mt-2">
                Are you a member?
                {' '}
                <Link to="/login" className="text-blue-600 underline">Sign in</Link>
                {' '}
                for the member price.
              </p>
            )}
          </div>
        ) : (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-900">
            Thanks for volunteering! There&apos;s no charge. Please fill in the info below
            so we know how to reach you and what role suits you.
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium">First name *</span>
              <input
                required
                type="text"
                className="border rounded px-3 py-2 w-full"
                value={runner.firstName}
                onChange={(e) => setRunner({ ...runner, firstName: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Last name *</span>
              <input
                required
                type="text"
                className="border rounded px-3 py-2 w-full"
                value={runner.lastName}
                onChange={(e) => setRunner({ ...runner, lastName: e.target.value })}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium">Email *</span>
            <input
              required
              type="email"
              className="border rounded px-3 py-2 w-full"
              value={runner.email}
              onChange={(e) => setRunner({ ...runner, email: e.target.value })}
            />
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium">Phone</span>
              <input
                type="tel"
                className="border rounded px-3 py-2 w-full"
                value={runner.phone}
                onChange={(e) => setRunner({ ...runner, phone: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Date of birth</span>
              <input
                type="date"
                className="border rounded px-3 py-2 w-full"
                value={runner.dob}
                onChange={(e) => setRunner({ ...runner, dob: e.target.value })}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium">Shirt size</span>
            <select
              className="border rounded px-3 py-2 w-full"
              value={runner.shirtSize}
              onChange={(e) => setRunner({ ...runner, shirtSize: e.target.value })}
            >
              <option value="">—</option>
              <option>XS</option>
              <option>S</option>
              <option>M</option>
              <option>L</option>
              <option>XL</option>
              <option>XXL</option>
            </select>
          </label>

          <fieldset className="border rounded p-3">
            <legend className="text-sm font-medium px-1">Emergency contact</legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm">Name</span>
                <input
                  type="text"
                  className="border rounded px-3 py-2 w-full"
                  value={runner.emergencyContactName}
                  onChange={(e) => setRunner({ ...runner, emergencyContactName: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="text-sm">Phone</span>
                <input
                  type="tel"
                  className="border rounded px-3 py-2 w-full"
                  value={runner.emergencyContactPhone}
                  onChange={(e) => setRunner({ ...runner, emergencyContactPhone: e.target.value })}
                />
              </label>
            </div>
          </fieldset>

          {((signupType === 'volunteer' && event.volunteerFields?.length
            ? event.volunteerFields
            : event.customFields) || []).map((field) => (
              <label key={field.key} className="block">
                <span className="text-sm font-medium">
                  {field.label}
                  {field.required ? ' *' : ''}
                </span>
                <CustomFieldInput
                  field={field}
                  value={customValues[field.key]}
                  onChange={(v) => setCustomValues({ ...customValues, [field.key]: v })}
                />
                {field.helpText && (
                  <span className="text-xs text-gray-500">{field.helpText}</span>
                )}
              </label>
          ))}

          {event.waiverText && (
            <fieldset className="border rounded p-3 bg-gray-50">
              <legend className="text-sm font-medium px-1">Waiver</legend>
              <div className="max-h-40 overflow-y-auto text-sm whitespace-pre-wrap mb-2">
                {event.waiverText}
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={waiverAccepted}
                  onChange={(e) => setWaiverAccepted(e.target.checked)}
                  required
                />
                <span>I have read and accept the waiver.</span>
              </label>
            </fieldset>
          )}

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !waiverAccepted}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded w-full"
          >
            {submitting
              ? (signupType === 'volunteer' ? 'Submitting...' : 'Redirecting to secure checkout...')
              : signupType === 'volunteer'
                ? 'Sign up to volunteer'
                : displayPrice === 0
                  ? 'Complete registration'
                  : `Continue to payment — ${formatPrice(displayPrice)}`}
          </button>

          <p className="text-xs text-gray-500 text-center">
            Payment processed securely by Stripe. Your card details are never seen by MPRC.
            By registering you agree to the
            {' '}
            <Link to="/terms" className="underline">Terms</Link>
            {' '}
            and
            {' '}
            <Link to="/privacy" className="underline">Privacy Policy</Link>
            .
          </p>
        </form>
      </div>
    </>
  );
}

export default EventRegister;
