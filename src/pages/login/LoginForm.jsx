import React, { useEffect, useRef, useState } from 'react';
import {
  Link, useLocation, useNavigate,
} from 'react-router-dom';
import HeaderImage from '../../images/activities/header_bg_1.jpg';
import Header from '../../components/Header';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import SEO from '../../components/SEO';
import { getSafeLoginReturnPath } from './loginReturnPath';
import { getSpamGuidance } from '../../services/accountEmail/accountEmailSender';
import './LoginForm.css';

const RESET_COOLDOWN_SECONDS = 60;

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { services, isReady } = useServiceLocator();
  const [registrationOutcome, setRegistrationOutcome] = useState(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [resetState, setResetState] = useState('idle');
  const [resetSecondsRemaining, setResetSecondsRemaining] = useState(0);
  const emailInputRef = useRef(null);
  const registrationStatusRef = useRef(null);
  const resetStatusRef = useRef(null);
  const resetInFlightRef = useRef(false);
  const resetRetryAtRef = useRef(0);
  const mountedRef = useRef(true);
  const location = useLocation();
  const navigate = useNavigate();
  const resetIsRequesting = resetState === 'requesting';
  const resetIsCoolingDown = resetState === 'finished' && resetSecondsRemaining > 0;
  const authActionBusy = isLoading || resetIsRequesting;
  let submitLabel = 'Sign in';
  if (isLoading) submitLabel = 'Working...';
  else if (isRegistering) submitLabel = 'Create account';

  let resetButtonLabel = 'Forgot password?';
  if (resetIsRequesting) resetButtonLabel = 'Requesting reset help...';
  else if (resetIsCoolingDown) {
    resetButtonLabel = `Try again in ${resetSecondsRemaining} ${resetSecondsRemaining === 1 ? 'second' : 'seconds'}`;
  } else if (resetState === 'finished') {
    resetButtonLabel = 'Request password reset again';
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (registrationOutcome) {
      registrationStatusRef.current?.focus();
    }
  }, [registrationOutcome]);

  useEffect(() => {
    if (resetState === 'finished') {
      resetStatusRef.current?.focus();
    }
  }, [resetState]);

  useEffect(() => {
    if (resetState !== 'finished') {
      return undefined;
    }

    const getRemaining = () => Math.max(
      0,
      Math.ceil((resetRetryAtRef.current - Date.now()) / 1000),
    );
    const initialRemaining = getRemaining();
    setResetSecondsRemaining(initialRemaining);
    if (initialRemaining === 0) {
      resetRetryAtRef.current = 0;
      return undefined;
    }

    let intervalId;
    const updateCountdown = () => {
      const remaining = getRemaining();
      setResetSecondsRemaining(remaining);
      if (remaining === 0) {
        resetRetryAtRef.current = 0;
        window.clearInterval(intervalId);
      }
    };
    intervalId = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(intervalId);
  }, [resetState]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setRegistrationOutcome(null);

    if (!isReady || !services) {
      setError('Services not ready. Please try again.');
      return;
    }

    setIsLoading(true);

    try {
      const { identityService } = services;
      if (isRegistering) {
        const result = await identityService.register(email, password);
        setRegistrationOutcome(result.verificationEmailRequest);
      } else {
        await identityService.signIn(email, password);
        navigate(getSafeLoginReturnPath(location.state?.from), { replace: true });
      }
    } catch {
      setError(isRegistering
        ? 'We could not create the account. Please try again.'
        : 'Failed to authenticate. Please check your credentials and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleMode = () => {
    setIsRegistering(!isRegistering);
    setError('');
    setRegistrationOutcome(null);
  };

  const handleForgotPassword = async () => {
    setError('');
    if (!email.trim()) {
      setError('Enter your email above first, then click "Forgot password?" again.');
      emailInputRef.current?.focus();
      return;
    }
    if (!isReady || !services) {
      setError('Services not ready. Please try again.');
      return;
    }

    const now = Date.now();
    if (resetInFlightRef.current || now < resetRetryAtRef.current) {
      return;
    }

    resetInFlightRef.current = true;
    setResetState('requesting');
    setResetSecondsRemaining(0);
    try {
      await services.identityService.sendPasswordReset(email.trim());
    } catch {
      // Intentionally swallow — we don't want to leak whether the email exists.
    } finally {
      if (mountedRef.current) {
        resetRetryAtRef.current = Date.now() + (RESET_COOLDOWN_SECONDS * 1000);
        setResetSecondsRemaining(RESET_COOLDOWN_SECONDS);
        setResetState('finished');
      }
      resetInFlightRef.current = false;
    }
  };

  return (
    <>
      <SEO title={isRegistering ? 'Register' : 'Member Login'} noindex />
      <Header
        title={isRegistering ? 'Register' : 'Login'}
        image={HeaderImage}
      />
      <div className="container mx-auto px-4 py-10 flex justify-center">
        <div className="w-full max-w-sm border rounded-lg p-6 bg-white shadow-sm">
          <h2 className="text-xl font-semibold mb-4 text-center">
            {isRegistering ? 'Create your account' : 'Sign in'}
          </h2>

          {registrationOutcome && (
            <div
              ref={registrationStatusRef}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              tabIndex="-1"
              className={`registration-outcome registration-outcome--${registrationOutcome}`}
            >
              <p className="registration-outcome__title">Account created.</p>
              {registrationOutcome === 'accepted' ? (
                <p className="registration-outcome__message">
                  The email service accepted the verification email request.
                  Delivery is not guaranteed. Check your Inbox and Spam folder.
                  {' '}
                  {getSpamGuidance()}
                </p>
              ) : (
                <p className="registration-outcome__message">
                  The verification email request did not finish. Keep this account.
                  Check My Account for the next available step. If My Account is unavailable,
                  stop and ask the club membership contact for help.
                </p>
              )}
              <Link
                to="/account"
                className="registration-outcome__action"
              >
                Check My Account
              </Link>
            </div>
          )}

          {error && (
            <div
              role="alert"
              aria-live="assertive"
              className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700"
            >
              {error}
            </div>
          )}

          {!isRegistering && resetState === 'requesting' && (
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="password-reset-outcome password-reset-outcome--requesting"
            >
              Finishing the password reset request...
            </div>
          )}

          {!isRegistering && resetState === 'finished' && (
            <div className="password-reset-outcome password-reset-outcome--finished">
              <div
                id="password-reset-status"
                ref={resetStatusRef}
                role="status"
                aria-live="polite"
                aria-atomic="true"
                tabIndex="-1"
                className="password-reset-outcome__result"
              >
                <p className="password-reset-outcome__title">Password reset request finished.</p>
                <p className="password-reset-outcome__message">
                  For privacy, this page always shows the same result. Email delivery
                  cannot be confirmed. Wait a few minutes, then check Inbox and Spam.
                  {' '}
                  {getSpamGuidance()}
                  {' '}
                  Never share a reset link or code.
                </p>
              </div>
              <p
                id="password-reset-wait"
                aria-live="off"
                className="password-reset-outcome__wait"
              >
                {resetSecondsRemaining > 0
                  ? `You can try once more in ${resetSecondsRemaining} ${resetSecondsRemaining === 1 ? 'second' : 'seconds'}.`
                  : 'You can request password reset help again now.'}
              </p>
            </div>
          )}

          {!isRegistering
            && resetState === 'finished'
            && resetSecondsRemaining === 0 && (
              <span
                role="status"
                aria-live="polite"
                className="password-reset-ready-announcement"
              >
                Password reset help is available again.
              </span>
          )}

          {!registrationOutcome && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <label htmlFor="login-email" className="block">
                <span className="text-sm font-medium">Email</span>
                <input
                  id="login-email"
                  ref={emailInputRef}
                  type="email"
                  aria-label="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={authActionBusy}
                  className="border rounded px-3 py-2 w-full mt-1 disabled:bg-gray-100"
                  autoComplete="email"
                />
              </label>
              <label htmlFor="login-password" className="block">
                <span className="text-sm font-medium">Password</span>
                <input
                  id="login-password"
                  type="password"
                  aria-label="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={authActionBusy}
                  className="border rounded px-3 py-2 w-full mt-1 disabled:bg-gray-100"
                  autoComplete={isRegistering ? 'new-password' : 'current-password'}
                />
              </label>
              <button
                type="submit"
                disabled={authActionBusy}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-2 rounded w-full"
              >
                {submitLabel}
              </button>
            </form>
          )}

          {!registrationOutcome && (
            <div className="mt-4 flex justify-between items-center text-sm">
              <button
                type="button"
                onClick={handleToggleMode}
                disabled={authActionBusy}
                className="text-blue-600 hover:underline"
              >
                {isRegistering ? 'Have an account? Sign in' : 'New here? Register'}
              </button>
              {!isRegistering && (
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={authActionBusy || resetIsCoolingDown}
                  aria-describedby={resetState === 'finished'
                    ? 'password-reset-status password-reset-wait'
                    : undefined}
                  className="password-reset-action"
                >
                  {resetButtonLabel}
                </button>
              )}
            </div>
          )}

          <p className="mt-6 pt-4 border-t text-xs text-gray-500 text-center">
            By continuing you agree to the
            {' '}
            <Link to="/terms" className="underline">Terms</Link>
            {' '}
            and
            {' '}
            <Link to="/privacy" className="underline">Privacy Policy</Link>
            .
          </p>
        </div>
      </div>
    </>
  );
}

export default LoginForm;
