/* eslint-env jest */
import React from 'react';
import PropTypes from 'prop-types';
import {
  MemoryRouter, Route, Routes, useLocation,
} from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import LoginForm from './LoginForm';
import AdminGuard from '../admin/AdminGuard';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import { useAuth } from '../../services/hooks/useAuth';

jest.mock('../../services/ServiceLocatorContext', () => ({
  useServiceLocator: jest.fn(),
}));

jest.mock('../../services/hooks/useAuth', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../components/Header', () => function Header() {
  return null;
});

jest.mock('../../components/SEO', () => function SEO() {
  return null;
});

function LocationProbe({ label }) {
  const location = useLocation();
  return (
    <div>
      {label}
      {' '}
      <span data-testid="location">
        {location.pathname}
        {location.search}
        {location.hash}
      </span>
      {location.state?.from && (
        <span data-testid="return-path">{location.state.from}</span>
      )}
    </div>
  );
}

LocationProbe.propTypes = {
  label: PropTypes.string.isRequired,
};

function renderLogin(initialEntry = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/login"
          element={(
            <>
              <LoginForm />
              <LocationProbe label="Login location" />
            </>
          )}
        />
        <Route path="/account" element={<LocationProbe label="Account destination" />} />
        <Route path="/discounts" element={<LocationProbe label="Discounts destination" />} />
        <Route
          path="/admin/events"
          element={(
            <AdminGuard>
              <LocationProbe label="Admin destination" />
            </AdminGuard>
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function submitCredentials() {
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'member@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'correct horse battery staple' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

function submitRegistration(email = 'member@example.test') {
  fireEvent.click(screen.getByRole('button', { name: 'New here? Register' }));
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'correct horse battery staple' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('LoginForm return navigation', () => {
  const signIn = jest.fn();
  const register = jest.fn();
  const sendPasswordReset = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    signIn.mockResolvedValue({ user: { email: 'member@example.com' } });
    register.mockResolvedValue({
      user: { email: 'member@example.test' },
      verificationEmailRequest: 'accepted',
    });
    useServiceLocator.mockReturnValue({
      isReady: true,
      services: {
        identityService: { signIn, register, sendPasswordReset },
      },
    });
    useAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      isAdmin: false,
    });
  });

  test('round trips query and hash through an actual protected-route redirect', async () => {
    signIn.mockImplementation(async () => {
      useAuth.mockReturnValue({
        isLoading: false,
        isAuthenticated: true,
        isAdmin: true,
      });
      return { user: { email: 'member@example.com' } };
    });
    renderLogin('/admin/events?view=drafts#pending');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    submitCredentials();

    expect(await screen.findByText('Admin destination')).toBeInTheDocument();
    expect(screen.getByTestId('location'))
      .toHaveTextContent('/admin/events?view=drafts#pending');
  });

  test('returns to the requested safe internal route after sign-in', async () => {
    renderLogin({
      pathname: '/login',
      state: { from: '/discounts?kind=race#active' },
    });

    submitCredentials();

    expect(await screen.findByText('Discounts destination')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/discounts?kind=race#active');
  });

  test('defaults to the account page after sign-in', async () => {
    renderLogin();

    submitCredentials();

    expect(await screen.findByText('Account destination')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/account');
  });

  test.each([
    '//evil.example/path',
    'https://evil.example/path',
    '/\\evil.example/path',
    '/%2F%2Fevil.example/path',
    '/.//evil.example/path',
    '/a/..//evil.example/path',
    '/%2e%2e//evil.example/path',
    '/safe/%2e%2e/%2F%2Fevil.example/path',
    '/discounts%00',
    '/discounts%',
  ])('rejects unsafe return target %s', async (from) => {
    renderLogin({ pathname: '/login', state: { from } });

    submitCredentials();

    expect(await screen.findByText('Account destination')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/account');
  });

  test('stays on login and shows a generic error when sign-in fails', async () => {
    signIn.mockRejectedValue(new Error('provider detail'));
    renderLogin({ pathname: '/login', state: { from: '/discounts' } });

    submitCredentials();

    expect(await screen.findByText(
      'Failed to authenticate. Please check your credentials and try again.',
    )).toBeInTheDocument();
    expect(screen.queryByText('Discounts destination')).not.toBeInTheDocument();
  });

  test('separates account creation from an accepted email request without promising delivery', async () => {
    renderLogin({ pathname: '/login', state: { from: '/discounts' } });
    submitRegistration();

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Account created.');
    expect(status).toHaveTextContent(
      'The email service accepted the verification email request.',
    );
    expect(status).toHaveTextContent('Delivery is not guaranteed.');
    expect(status).toHaveTextContent('Check your Inbox and Spam folder.');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(status).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Check My Account' }))
      .toHaveAttribute('href', '/account');
    expect(screen.queryByText('Discounts destination')).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
    expect(screen.getByTestId('return-path')).toHaveTextContent('/discounts');
    expect(screen.queryByRole('button', { name: 'Create account' }))
      .not.toBeInTheDocument();
    expect(register).toHaveBeenCalledWith(
      'member@example.test',
      'correct horse battery staple',
    );
  });

  test('shows a recovery action without inbox guidance when the email request is unavailable', async () => {
    register.mockResolvedValueOnce({
      user: { email: 'private-member@example.test' },
      verificationEmailRequest: 'unavailable',
    });
    renderLogin({ pathname: '/login', state: { from: '/discounts?kind=race' } });
    submitRegistration('private-member@example.test');

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Account created.');
    expect(status).toHaveTextContent('The verification email request did not finish.');
    expect(status).toHaveTextContent('Keep this account.');
    expect(status).toHaveTextContent(
      'Check My Account for the next available step.',
    );
    expect(status).toHaveTextContent(
      'If My Account is unavailable, stop and ask the club membership contact for help.',
    );
    expect(status).not.toHaveTextContent('Resend');
    expect(status).not.toHaveTextContent('Inbox');
    expect(status).not.toHaveTextContent('Spam');
    expect(status).not.toHaveTextContent('private-member@example.test');
    expect(status).toHaveFocus();
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
    expect(screen.getByTestId('return-path'))
      .toHaveTextContent('/discounts?kind=race');
    expect(screen.queryByRole('button', { name: 'Create account' }))
      .not.toBeInTheDocument();
  });

  test('shows only a generic error when account creation fails', async () => {
    const providerCanaries = [
      'private-member@example.test',
      'auth/provider-response-canary',
      'https://example.test/action?token=verification-token-canary',
    ];
    register.mockRejectedValueOnce(new Error(providerCanaries.join(' ')));
    renderLogin({ pathname: '/login', state: { from: '/discounts' } });
    submitRegistration('private-member@example.test');

    expect(await screen.findByText(
      'We could not create the account. Please try again.',
    )).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('Account created.')).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
    const visibleText = document.body.textContent;
    providerCanaries.forEach((canary) => expect(visibleText).not.toContain(canary));
  });
});
