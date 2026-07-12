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
        <Route path="/login" element={<LoginForm />} />
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

describe('LoginForm return navigation', () => {
  const signIn = jest.fn();
  const register = jest.fn();
  const sendPasswordReset = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    signIn.mockResolvedValue({ user: { email: 'member@example.com' } });
    register.mockResolvedValue({ user: { email: 'member@example.com' } });
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

  test('keeps the registration confirmation on the login page', async () => {
    renderLogin({ pathname: '/login', state: { from: '/discounts' } });
    fireEvent.click(screen.getByRole('button', { name: 'New here? Register' }));
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'member@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Check your inbox for a verification email.'))
      .toBeInTheDocument();
    expect(screen.queryByText('Discounts destination')).not.toBeInTheDocument();
    expect(register).toHaveBeenCalledWith(
      'member@example.com',
      'correct horse battery staple',
    );
  });
});
