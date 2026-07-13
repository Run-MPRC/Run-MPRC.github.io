/* eslint-env jest */
import React from 'react';
import PropTypes from 'prop-types';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  MemoryRouter, Route, Routes, useLocation,
} from 'react-router-dom';
import {
  act, fireEvent, render, screen,
} from '@testing-library/react';
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
    <MemoryRouter
      future={{
        v7_relativeSplatPath: true,
        v7_startTransition: true,
      }}
      initialEntries={[initialEntry]}
    >
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

function requestPasswordReset(email = 'synthetic-member@example.test') {
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: email },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
}

describe('LoginForm return navigation', () => {
  const signIn = jest.fn();
  const register = jest.fn();
  const sendPasswordReset = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    signIn.mockReset();
    register.mockReset();
    sendPasswordReset.mockReset();
    signIn.mockResolvedValue({ user: { email: 'member@example.com' } });
    register.mockResolvedValue({
      user: { email: 'member@example.test' },
      verificationEmailRequest: 'accepted',
    });
    sendPasswordReset.mockResolvedValue(undefined);
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

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
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

  test.each(['', '   '])('requires a local email value without making a reset request', (email) => {
    renderLogin({
      pathname: '/login',
      state: { from: '/discounts?kind=race#active' },
    });
    jest.useFakeTimers();
    if (email) {
      fireEvent.change(screen.getByLabelText('Email address'), {
        target: { value: email },
      });
    }

    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter your email above first, then click "Forgot password?" again.',
    );
    expect(screen.getByLabelText('Email address')).toHaveFocus();
    expect(sendPasswordReset).not.toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
    expect(screen.getByTestId('return-path'))
      .toHaveTextContent('/discounts?kind=race#active');
  });

  test('blocks rapid repeat activation before React can disable the reset action', async () => {
    let finishRequest;
    sendPasswordReset.mockImplementationOnce(() => new Promise((resolve) => {
      finishRequest = resolve;
    }));
    renderLogin();
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'synthetic-member@example.test' },
    });
    const button = screen.getByRole('button', { name: 'Forgot password?' });

    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    expect(sendPasswordReset).toHaveBeenCalledTimes(1);
    expect(sendPasswordReset).toHaveBeenCalledWith('synthetic-member@example.test');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Requesting reset help...');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Finishing the password reset request...',
    );
    expect(screen.getByLabelText('Email address')).toBeDisabled();
    expect(screen.getByLabelText('Password')).toBeDisabled();
    expect(signIn).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();

    await act(async () => {
      finishRequest();
      await Promise.resolve();
    });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Password reset request finished.',
    );
    expect(screen.getByRole('button', { name: 'Try again in 60 seconds' }))
      .toBeDisabled();
  });

  test('renders byte-equivalent public state after provider success or hostile failure', async () => {
    const capturePublicState = () => ({
      result: screen.getByRole('status').outerHTML,
      wait: screen.getByText(/You can try once more in 60 seconds/).outerHTML,
      button: screen.getByRole('button', { name: 'Try again in 60 seconds' }).outerHTML,
    });
    const first = renderLogin();
    requestPasswordReset();
    await screen.findByText('Password reset request finished.');
    const successState = capturePublicState();
    first.unmount();

    const consoleSpies = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
    const canaries = [
      'private-member@example.test',
      'synthetic-private-uid',
      'auth/provider-code-canary',
      'https://identity.example.test/action?code=reset-token-canary#private',
    ];
    sendPasswordReset.mockRejectedValueOnce(Object.assign(
      new Error(canaries.join(' ')),
      { code: canaries[2], actionLink: canaries[3] },
    ));
    renderLogin();
    requestPasswordReset('private-member@example.test');
    await screen.findByText('Password reset request finished.');
    const failureState = capturePublicState();

    expect(failureState).toEqual(successState);
    const result = screen.getByRole('status');
    expect(result).toHaveTextContent('this page always shows the same result');
    expect(result).toHaveTextContent('Email delivery cannot be confirmed');
    expect(result).toHaveTextContent('check Inbox and Spam');
    expect(result).toHaveAttribute('aria-live', 'polite');
    expect(result).toHaveAttribute('aria-atomic', 'true');
    expect(result).toHaveFocus();
    expect(result).not.toHaveTextContent(
      /\bsent\b|\bdelivered\b|\baccepted\b|\bfailed\b|on its way|account exists|account missing/i,
    );
    canaries.forEach((canary) => expect(document.body).not.toHaveTextContent(canary));
    expect(JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls)))
      .not.toMatch(/private-member|private-uid|provider-code|reset-token/i);
  });

  test('uses the same 60-second wait after failure and permits one later retry', async () => {
    sendPasswordReset
      .mockRejectedValueOnce(new Error('synthetic provider unavailable'))
      .mockResolvedValueOnce(undefined);
    renderLogin({
      pathname: '/login',
      state: { from: '/discounts?kind=race#active' },
    });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'synthetic-member@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'synthetic-password' },
    });
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-13T13:30:00Z'));

    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    await act(async () => Promise.resolve());

    expect(screen.getByRole('button', { name: 'Try again in 60 seconds' }))
      .toBeDisabled();
    expect(screen.getByText('You can try once more in 60 seconds.'))
      .toHaveAttribute('aria-live', 'off');
    expect(jest.getTimerCount()).toBe(1);
    act(() => jest.advanceTimersByTime(59_000));
    expect(screen.getByRole('button', { name: 'Try again in 1 second' }))
      .toBeDisabled();
    expect(screen.getByText('You can try once more in 1 second.'))
      .toBeInTheDocument();
    act(() => jest.advanceTimersByTime(1_000));

    const retry = screen.getByRole('button', { name: 'Request password reset again' });
    expect(retry).toBeEnabled();
    expect(screen.getByText('You can request password reset help again now.'))
      .toBeInTheDocument();
    expect(screen.getByText('Password reset help is available again.'))
      .toHaveAttribute('aria-live', 'polite');
    expect(jest.getTimerCount()).toBe(0);
    fireEvent.click(retry, { detail: 0 });
    await act(async () => Promise.resolve());

    expect(sendPasswordReset).toHaveBeenCalledTimes(2);
    expect(sendPasswordReset).toHaveBeenNthCalledWith(
      2,
      'synthetic-member@example.test',
    );
    expect(screen.getByRole('button', { name: 'Try again in 60 seconds' }))
      .toBeDisabled();
    expect(screen.getByLabelText('Email address'))
      .toHaveValue('synthetic-member@example.test');
    expect(screen.getByLabelText('Password')).toHaveValue('synthetic-password');
    expect(screen.getByTestId('return-path'))
      .toHaveTextContent('/discounts?kind=race#active');
    expect(signIn).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  test('cleans a completed countdown and returns to idle after remount', async () => {
    const first = renderLogin();
    jest.useFakeTimers();
    requestPasswordReset();
    await act(async () => Promise.resolve());
    expect(screen.getByRole('button', { name: 'Try again in 60 seconds' }))
      .toBeDisabled();
    expect(jest.getTimerCount()).toBe(1);

    first.unmount();
    expect(jest.getTimerCount()).toBe(0);
    renderLogin();

    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeEnabled();
    expect(screen.queryByText('Password reset request finished.')).not.toBeInTheDocument();
    expect(sendPasswordReset).toHaveBeenCalledTimes(1);
  });

  test('recovers when the deadline expires before the countdown effect starts', async () => {
    renderLogin();
    jest.useFakeTimers();
    const nowSpy = jest.spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(61_000);

    requestPasswordReset();
    await act(async () => Promise.resolve());

    expect(screen.getByRole('button', { name: 'Request password reset again' }))
      .toBeEnabled();
    expect(screen.getByText('You can request password reset help again now.'))
      .toBeInTheDocument();
    expect(screen.getByText('Password reset help is available again.'))
      .toHaveClass('password-reset-ready-announcement');
    expect(jest.getTimerCount()).toBe(0);
    expect(sendPasswordReset).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(0);
    fireEvent.click(screen.getByRole('button', { name: 'Request password reset again' }));
    await act(async () => Promise.resolve());
    expect(sendPasswordReset).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Try again in 60 seconds' }))
      .toBeDisabled();
  });

  test.each(['resolve', 'reject'])('discards a pending %s after unmount', async (outcome) => {
    let finishRequest;
    sendPasswordReset.mockImplementationOnce(() => new Promise((resolve, reject) => {
      finishRequest = outcome === 'resolve' ? resolve : reject;
    }));
    const first = renderLogin();
    jest.useFakeTimers();
    requestPasswordReset();
    expect(sendPasswordReset).toHaveBeenCalledTimes(1);
    first.unmount();

    await act(async () => {
      finishRequest(new Error('post-unmount-private-canary'));
      await Promise.resolve();
    });

    expect(jest.getTimerCount()).toBe(0);
    renderLogin();
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeEnabled();
    expect(screen.queryByText('Password reset request finished.')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('post-unmount-private-canary');
  });

  test('preserves route, inputs, mode, and cooldown without unrelated identity calls', async () => {
    renderLogin({
      pathname: '/login',
      state: { from: '/discounts?kind=race#active' },
    });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'synthetic-member@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'synthetic-password' },
    });
    jest.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    await act(async () => Promise.resolve());

    expect(screen.getByTestId('location')).toHaveTextContent('/login');
    expect(screen.getByTestId('return-path'))
      .toHaveTextContent('/discounts?kind=race#active');
    expect(screen.getByLabelText('Email address'))
      .toHaveValue('synthetic-member@example.test');
    expect(screen.getByLabelText('Password')).toHaveValue('synthetic-password');
    fireEvent.click(screen.getByRole('button', { name: 'New here? Register' }));
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
    expect(screen.queryByText('Password reset request finished.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Have an account? Sign in' }));

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText('Password reset request finished.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again in 60 seconds' }))
      .toBeDisabled();
    expect(sendPasswordReset).toHaveBeenCalledTimes(1);
    expect(signIn).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  test('uses a native keyboard action and scoped 48px focus-visible styling', async () => {
    renderLogin();
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'synthetic-member@example.test' },
    });
    const button = screen.getByRole('button', { name: 'Forgot password?' });
    expect(button).toHaveAttribute('type', 'button');
    button.focus();
    expect(button).toHaveFocus();

    fireEvent.click(button, { detail: 0 });
    await screen.findByText('Password reset request finished.');

    const result = screen.getByRole('status');
    expect(result).toHaveFocus();
    expect(result).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('button', { name: 'Try again in 60 seconds' }))
      .toHaveAttribute(
        'aria-describedby',
        'password-reset-status password-reset-wait',
      );
    expect(sendPasswordReset).toHaveBeenCalledTimes(1);
    expect(signIn).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();

    const css = readFileSync(join(__dirname, 'LoginForm.css'), 'utf8');
    expect(css).toMatch(/\.password-reset-action\s*\{[\s\S]*min-height:\s*3rem;/);
    expect(css).toMatch(/\.password-reset-action:focus-visible\s*\{[\s\S]*outline:/);
    expect(css).toMatch(
      /\.password-reset-ready-announcement\s*\{[\s\S]*position:\s*absolute;[\s\S]*clip-path:\s*inset\(50%\);/,
    );
  });
});
