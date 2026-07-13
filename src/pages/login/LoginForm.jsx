import React, { useEffect, useRef, useState } from 'react';
import {
  Link, useLocation, useNavigate,
} from 'react-router-dom';
import HeaderImage from '../../images/activities/header_bg_1.jpg';
import Header from '../../components/Header';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import SEO from '../../components/SEO';
import { getSafeLoginReturnPath } from './loginReturnPath';
import './LoginForm.css';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { services, isReady } = useServiceLocator();
  const [registrationOutcome, setRegistrationOutcome] = useState(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const registrationStatusRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  let submitLabel = 'Sign in';
  if (isLoading) submitLabel = 'Working...';
  else if (isRegistering) submitLabel = 'Create account';

  useEffect(() => {
    if (registrationOutcome) {
      registrationStatusRef.current?.focus();
    }
  }, [registrationOutcome]);

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
    setResetSent(false);
  };

  const handleForgotPassword = async () => {
    setError('');
    setResetSent(false);
    if (!email) {
      setError('Enter your email above first, then click "Forgot password?" again.');
      return;
    }
    if (!isReady || !services) {
      setError('Services not ready. Please try again.');
      return;
    }
    try {
      await services.identityService.sendPasswordReset(email);
    } catch {
      // Intentionally swallow — we don't want to leak whether the email exists.
    }
    setResetSent(true);
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
                  If it is in Spam, mark it “Not spam.”
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
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              {error}
            </div>
          )}

          {resetSent && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
              If an account exists for that email, a password reset link is on its way.
            </div>
          )}

          {!registrationOutcome && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <label htmlFor="login-email" className="block">
                <span className="text-sm font-medium">Email</span>
                <input
                  id="login-email"
                  type="email"
                  aria-label="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
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
                  disabled={isLoading}
                  className="border rounded px-3 py-2 w-full mt-1 disabled:bg-gray-100"
                  autoComplete={isRegistering ? 'new-password' : 'current-password'}
                />
              </label>
              <button
                type="submit"
                disabled={isLoading}
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
                disabled={isLoading}
                className="text-blue-600 hover:underline"
              >
                {isRegistering ? 'Have an account? Sign in' : 'New here? Register'}
              </button>
              {!isRegistering && (
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={isLoading}
                  className="text-blue-600 hover:underline"
                >
                  Forgot password?
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
