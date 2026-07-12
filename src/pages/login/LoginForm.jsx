import React, { useState } from 'react';
import {
  Link, useLocation, useNavigate,
} from 'react-router-dom';
import HeaderImage from '../../images/activities/header_bg_1.jpg';
import Header from '../../components/Header';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import SEO from '../../components/SEO';
import { getSafeLoginReturnPath } from './loginReturnPath';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { services, isReady } = useServiceLocator();
  const [currentUser, setCurrentUser] = useState(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!isReady || !services) {
      setError('Services not ready. Please try again.');
      return;
    }

    setIsLoading(true);

    try {
      const { identityService } = services;
      if (isRegistering) {
        const credential = await identityService.register(email, password);
        setCurrentUser(credential.user);
      } else {
        const credential = await identityService.signIn(email, password);
        setCurrentUser(credential.user);
        navigate(getSafeLoginReturnPath(location.state?.from), { replace: true });
      }
    } catch (loginError) {
      setError('Failed to authenticate. Please check your credentials and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleMode = () => {
    setIsRegistering(!isRegistering);
    setError('');
    setCurrentUser(null);
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

          {currentUser && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-800">
              Welcome,
              {' '}
              {currentUser.email}
              !
              {isRegistering && (
                <p className="mt-1 text-xs">
                  Check your inbox for a verification email.
                </p>
              )}
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

          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium">Email</span>
              <input
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
            <label className="block">
              <span className="text-sm font-medium">Password</span>
              <input
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
              {isLoading
                ? 'Working...'
                : isRegistering
                  ? 'Create account'
                  : 'Sign in'}
            </button>
          </form>

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
