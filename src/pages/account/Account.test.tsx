/* eslint-env jest */

import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  act, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import {
  BrowserRouter, MemoryRouter, Route, Routes, useLocation, useNavigate,
  useNavigationType,
} from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import { useAuth } from '../../services/hooks/useAuth';
import {
  ensureMyProfile,
  getMyProfile,
  listMyRegistrations,
  updateMyProfile,
} from '../../services/account/accountService';
import {
  buildStravaAuthorizeUrl,
  getStravaConnection,
  stravaBeginAuthorization,
  stravaDisconnect,
  stravaExchangeCode,
  stravaFetchStats,
} from '../../services/strava/stravaService';
import AccountPage, { AccountContent, AccountPageShell } from './Account';
import StravaCallback from './StravaCallback';

const mockCaptureException = jest.fn();
const mockTrack = jest.fn();

jest.mock('../../services/ServiceLocatorContext', () => ({
  useServiceLocator: jest.fn(),
}));

jest.mock('../../services/hooks/useAuth', () => ({
  useAuth: jest.fn(),
}));

jest.mock('firebase/functions', () => ({
  getFunctions: jest.fn(),
  httpsCallable: jest.fn(),
}));

jest.mock('../../services/strava/stravaService', () => {
  const actual = jest.requireActual('../../services/strava/stravaService');
  return {
    ...actual,
    buildStravaAuthorizeUrl: jest.fn(actual.buildStravaAuthorizeUrl),
    getStravaConnection: jest.fn(),
    stravaBeginAuthorization: jest.fn(),
    stravaDisconnect: jest.fn(),
    stravaExchangeCode: jest.fn(),
    stravaFetchStats: jest.fn(),
  };
});

jest.mock('../../services/account/accountService', () => {
  const actual = jest.requireActual('../../services/account/accountService');
  return {
    ...actual,
    ensureMyProfile: jest.fn(),
    getMyProfile: jest.fn(),
    listMyRegistrations: jest.fn(),
    updateMyProfile: jest.fn(),
  };
});

jest.mock('../../components/SEO', () => function SEO() {
  return null;
});

jest.mock('../../services/monitoring/sentry', () => ({
  captureException: mockCaptureException,
}));

jest.mock('../../services/analytics/analytics', () => ({
  events: {},
  track: mockTrack,
}));

jest.mock('./StravaSection', () => function StravaSection() {
  return <div data-testid="strava-section" />;
});

const ActualStravaSection = jest.requireActual('./StravaSection').default;
const ActualStravaService = jest.requireActual('../../services/strava/stravaService');

const USER = {
  uid: 'synthetic-user',
  email: 'member@example.com',
  role: 'unverified' as const,
};

const PROFILE = {
  uid: USER.uid,
  email: USER.email,
  fullName: 'Synthetic Member',
  role: 'unverified' as const,
  emailVerified: false,
  provider: 'password',
  createdAt: null,
  lastLogin: null,
  updatedAt: null,
};

const app = { name: 'synthetic-app' };
const firestore = { name: 'synthetic-firestore' };
const signOut = jest.fn();
const resendVerificationEmail = jest.fn();
const STRAVA_AUTHORIZATION_STATE = 'A'.repeat(43);
const STRAVA_AUTHORIZATION_CHALLENGE = Object.freeze({
  state: STRAVA_AUTHORIZATION_STATE,
  expiresInSeconds: 600 as const,
});

const STRAVA_CONNECTION = {
  provider: 'strava' as const,
  athleteId: 123456,
  firstName: 'Synthetic',
  lastName: 'Athlete',
  username: 'synthetic-athlete',
  profileUrl: null,
  connectedAt: null,
  updatedAt: null,
};

const STRAVA_STATS = {
  connected: true as const,
  athlete: {
    id: 123456,
    firstName: 'Synthetic',
    lastName: 'Athlete',
    username: 'synthetic-athlete',
    profileUrl: null,
  },
  recentActivities: [{
    id: 987654,
    name: 'Synthetic Morning Run',
    type: 'Run',
    distanceMeters: 8046.72,
    movingTimeSeconds: 2700,
    startDate: '2026-07-13T14:00:00Z',
  }],
  yearToDate: {
    runMeters: 16093.44,
    runCount: 2,
    rideMeters: 0,
    rideCount: 0,
  },
  allTime: {
    runMeters: 32186.88,
    runCount: 4,
  },
};

function accountView(user = USER) {
  return (
    <MemoryRouter
      future={{
        v7_relativeSplatPath: true,
        v7_startTransition: true,
      }}
    >
      <AccountPageShell>
        <AccountContent user={user} />
      </AccountPageShell>
    </MemoryRouter>
  );
}

function renderAccount(user = USER) {
  return render(accountView(user));
}

function AccountCommitProbe({
  onCommit,
  user = USER,
}: {
  onCommit: (text: string) => void;
  user?: typeof USER;
}) {
  React.useLayoutEffect(() => {
    onCommit(document.body.textContent || '');
  });
  return accountView(user);
}

function accountDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('Account profile recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useServiceLocator as jest.Mock).mockReturnValue({
      services: {
        firebaseResources: { app, firestore },
        identityService: { signOut, resendVerificationEmail },
      },
      isReady: true,
    });
    (ensureMyProfile as jest.Mock).mockResolvedValue({ ready: true });
    (getMyProfile as jest.Mock).mockResolvedValue(PROFILE);
    (listMyRegistrations as jest.Mock).mockResolvedValue({
      registrations: [],
      events: {},
    });
    (updateMyProfile as jest.Mock).mockResolvedValue(undefined);
    resendVerificationEmail.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('ensures the caller profile before the first profile read', async () => {
    const calls: string[] = [];
    (ensureMyProfile as jest.Mock).mockImplementation(async () => {
      calls.push('ensure');
      return { ready: true };
    });
    (getMyProfile as jest.Mock).mockImplementation(async () => {
      calls.push('read');
      return PROFILE;
    });

    renderAccount();

    expect(await screen.findByText('Synthetic Member')).toBeInTheDocument();
    expect(calls).toEqual(['ensure', 'read']);
    expect(ensureMyProfile).toHaveBeenCalledWith(app);
    expect(getMyProfile).toHaveBeenCalledWith(firestore, USER.uid);
  });

  test('shows the shared page hero while authentication is loading', () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
      user: null,
    });
    const view = render(
      <MemoryRouter
        future={{
          v7_relativeSplatPath: true,
          v7_startTransition: true,
        }}
      >
        <AccountPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'My Account' }))
      .toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
    expect(view.container.querySelectorAll('.header')).toHaveLength(1);
  });

  test('keeps one decorative page hero while the profile loads and becomes ready', async () => {
    const request = accountDeferred<{ ready: true }>();
    (ensureMyProfile as jest.Mock).mockReturnValueOnce(request.promise);
    const view = renderAccount();

    expect(screen.getByRole('heading', { level: 1, name: 'My Account' }))
      .toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const image = view.container.querySelector('.header__container-lg img');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Loading profile...');

    await act(async () => request.resolve({ ready: true }));

    expect(await screen.findByText('Synthetic Member')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Account details' }))
      .toBeInTheDocument();
    expect(view.container.querySelectorAll('.header')).toHaveLength(1);
  });

  test('describes an empty registration result as no current account link', async () => {
    renderAccount();

    expect(await screen.findByText('Synthetic Member')).toBeInTheDocument();
    const emptyState = screen.getByText(
      /no upcoming registrations are linked to this account/i,
    );
    expect(emptyState).toHaveTextContent(
      'No upcoming registrations are linked to this account.',
    );
    expect(emptyState).toHaveTextContent(
      /a registration made while signed out may not appear/i,
    );
    expect(emptyState).toHaveTextContent(
      /do not register or pay again/i,
    );
    expect(emptyState).toHaveAttribute('aria-live', 'polite');
    expect(emptyState).toHaveAttribute('aria-atomic', 'true');
    expect(document.body).not.toHaveTextContent(
      /you haven.t registered for any upcoming events/i,
    );
  });

  test('keeps an unavailable registration result separate from an empty account', async () => {
    let rejectedValueReads = 0;
    const hostileRejection = new Proxy({}, {
      get() {
        rejectedValueReads += 1;
        throw new Error('registration rejection detail was inspected');
      },
    });
    (listMyRegistrations as jest.Mock).mockRejectedValueOnce(hostileRejection);

    renderAccount();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not load your registrations right now.',
    );
    expect(screen.queryByText(
      /no upcoming registrations are linked to this account/i,
    )).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Browse events' })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/registration rejection detail was inspected/i);
    expect(rejectedValueReads).toBe(0);
  });

  test.each([
    ['unverified', 'Unverified'],
    ['member', 'Member'],
    ['admin', 'Admin'],
  ] as const)(
    'keeps the %s website role separate from paid membership',
    async (role, displayedRole) => {
      (getMyProfile as jest.Mock).mockResolvedValue({ ...PROFILE, role });

      const view = renderAccount();

      expect(await screen.findByText('Synthetic Member')).toBeInTheDocument();
      const details = view.container.querySelector('dl');
      expect(details).not.toBeNull();
      const labels = Array.from(details?.querySelectorAll('dt') || [])
        .map((label) => label.textContent);
      const values = Array.from(details?.querySelectorAll('dd') || [])
        .map((value) => value.textContent);

      expect(labels).toContain('Account created');
      expect(labels).not.toContain('Membership');
      expect(labels).not.toContain('Member since');
      expect(values).not.toContain(displayedRole);
      expect(document.body).not.toHaveTextContent(/pending member verification/i);
      expect(document.body).not.toHaveTextContent(/upgrade your membership/i);
      expect(document.body).not.toHaveTextContent(/dues are confirmed/i);
      expect(screen.getByText(
        /current paid membership and dues status is not available in My Account yet/i,
      )).toBeInTheDocument();
      expect(screen.getByText(/your email address is unverified/i)).toBeInTheDocument();
    },
  );

  test('shows a generic recovery state and disables editing when setup fails', async () => {
    (ensureMyProfile as jest.Mock)
      .mockRejectedValueOnce(new Error('Missing or insufficient permissions.'))
      .mockResolvedValueOnce({ ready: true });

    renderAccount();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your profile is temporarily unavailable.',
    );
    expect(screen.queryByText('Missing or insufficient permissions.'))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(getMyProfile).not.toHaveBeenCalled();
    expect(listMyRegistrations).not.toHaveBeenCalled();
    expect(screen.queryByTestId('strava-section')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try profile again' }));

    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(ensureMyProfile).toHaveBeenCalledTimes(2);
  });

  test('treats an absent record after setup as unavailable and keeps Edit hidden', async () => {
    (getMyProfile as jest.Mock).mockResolvedValue(null);

    renderAccount();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your profile is temporarily unavailable.',
    );
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  test('pauses phone display and collection while keeping name editing available', async () => {
    const legacyProfile = {
      ...PROFILE,
      phoneNumber: 'synthetic-phone-canary',
    };
    (getMyProfile as jest.Mock).mockResolvedValue(legacyProfile);
    renderAccount();
    expect(await screen.findByText('Synthetic Member')).toBeInTheDocument();
    expect(screen.queryByText(legacyProfile.phoneNumber)).not.toBeInTheDocument();
    expect(screen.getByText(/phone collection is temporarily paused/i))
      .toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText('Full name')).toHaveAccessibleDescription(
      'Up to 200 characters.',
    );
    expect(screen.getByLabelText('Full name')).toHaveAttribute('autocomplete', 'name');
    expect(screen.getByLabelText('Full name')).toHaveAttribute('maxLength', '200');
    expect(screen.queryByLabelText('Phone')).not.toBeInTheDocument();
    expect(document.querySelector('input[autocomplete="tel"]')).toBeNull();
  });

  test('uses a safe state when the profile read fails after setup', async () => {
    (getMyProfile as jest.Mock).mockRejectedValue(
      new Error('FirebaseError: wrong project or rules mismatch'),
    );

    renderAccount();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your profile is temporarily unavailable.',
    );
    expect(screen.queryByText(/wrong project|rules mismatch/i)).not.toBeInTheDocument();
    expect(listMyRegistrations).not.toHaveBeenCalled();
    expect(screen.queryByTestId('strava-section')).not.toBeInTheDocument();
  });

  test('keeps a validation error local and does not call Firestore', async () => {
    renderAccount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Full name'), {
      target: { value: '🏃'.repeat(101) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Full name must be 200 characters or fewer.',
    );
    expect(updateMyProfile).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  test('does not expose a raw save error or leave editing enabled after a failed write', async () => {
    (updateMyProfile as jest.Mock).mockRejectedValue(
      new Error('FirebaseError: Missing or insufficient permissions.'),
    );
    renderAccount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Full name'), {
      target: { value: 'Updated Synthetic Member' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not confirm your profile change.',
    );
    expect(screen.queryByText(/FirebaseError|Missing or insufficient permissions/i))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    await waitFor(() => expect(updateMyProfile).toHaveBeenCalledWith(
      firestore,
      USER.uid,
      { fullName: 'Updated Synthetic Member' },
    ));
  });

  test('fails closed when a save succeeds but the confirmation read is missing', async () => {
    (getMyProfile as jest.Mock)
      .mockResolvedValueOnce(PROFILE)
      .mockResolvedValueOnce(null);
    renderAccount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not confirm your profile change.',
    );
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('strava-section')).not.toBeInTheDocument();
  });

  test('reports request acceptance without claiming delivery and blocks rapid repeats', async () => {
    let finishRequest: (() => void) | undefined;
    resendVerificationEmail.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishRequest = resolve;
    }));
    renderAccount();

    const button = await screen.findByRole('button', {
      name: 'Request another verification email',
    });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    expect(resendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Requesting...');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Requesting a verification email...',
    );

    await act(async () => finishRequest?.());

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('The request was accepted.');
    expect(status).toHaveTextContent('Delivery can take time.');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(status).not.toHaveTextContent(/\bsent\b|\bdelivered\b/i);
    expect(screen.getByRole('button', { name: 'Try again in 60 seconds' }))
      .toBeDisabled();
    expect(updateMyProfile).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  test('accepted resend guidance names the configured sender without claiming delivery', async () => {
    const ENV_KEY = 'REACT_APP_ACCOUNT_EMAIL_SENDER';
    const originalSender = process.env[ENV_KEY];
    process.env[ENV_KEY] = 'Synthetic Club Sender';
    try {
      let finishRequest: (() => void) | undefined;
      resendVerificationEmail.mockImplementationOnce(() => new Promise<void>((resolve) => {
        finishRequest = resolve;
      }));
      renderAccount();

      const button = await screen.findByRole('button', {
        name: 'Request another verification email',
      });
      await act(async () => {
        fireEvent.click(button);
      });
      await act(async () => finishRequest?.());

      const status = screen.getByRole('status');
      expect(status).toHaveTextContent('The request was accepted.');
      expect(status).toHaveTextContent('mark the message from Synthetic Club Sender as');
      expect(status).toHaveTextContent('it does not fix delivery for everyone');
      expect(status).not.toHaveTextContent(/\bsent\b|\bdelivered\b/i);
    } finally {
      if (originalSender === undefined) {
        delete process.env[ENV_KEY];
      } else {
        process.env[ENV_KEY] = originalSender;
      }
    }
  });

  test('shows one fixed failure result without provider details', async () => {
    const consoleSpies = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
    resendVerificationEmail.mockRejectedValueOnce(Object.assign(
      new Error('provider-canary member@example.test'),
      {
        code: 'auth/provider-canary',
        actionLink: 'https://identity.example.test/action?code=secret-canary',
      },
    ));
    renderAccount();

    fireEvent.click(await screen.findByRole('button', {
      name: 'Request another verification email',
    }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('We could not request an email right now.');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(document.body).not.toHaveTextContent(/provider-canary|member@example\.test|secret-canary/i);
    expect(JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls)))
      .not.toMatch(/provider-canary|member@example\.test|secret-canary/i);
    expect(resendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Try again in 60 seconds' }))
      .toBeDisabled();
    expect(updateMyProfile).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => spy.mockRestore());
  });

  test('restores one retry after the visible cooldown', async () => {
    resendVerificationEmail
      .mockRejectedValueOnce(new Error('synthetic provider unavailable'))
      .mockResolvedValueOnce(undefined);
    renderAccount();
    const button = await screen.findByRole('button', {
      name: 'Request another verification email',
    });
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-13T12:00:00Z'));

    fireEvent.click(button);
    await act(async () => Promise.resolve());

    expect(screen.getByRole('alert')).toHaveTextContent(
      'We could not request an email right now.',
    );
    expect(screen.getByRole('button', { name: 'Try again in 60 seconds' }))
      .toBeDisabled();
    act(() => jest.advanceTimersByTime(59_000));
    expect(screen.getByRole('button', { name: 'Try again in 1 second' }))
      .toBeDisabled();
    expect(screen.getByText('Another request is available in 1 second.'))
      .toBeInTheDocument();
    act(() => jest.advanceTimersByTime(1_000));

    const retry = screen.getByRole('button', {
      name: 'Request another verification email',
    });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    await act(async () => Promise.resolve());
    expect(resendVerificationEmail).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('The request was accepted.');
  });

  test('a remount resets the browser-only cooldown without making another request', async () => {
    const first = renderAccount();
    jest.useFakeTimers();
    fireEvent.click(await screen.findByRole('button', {
      name: 'Request another verification email',
    }));
    await act(async () => Promise.resolve());
    expect(await screen.findByRole('status')).toHaveTextContent('The request was accepted.');
    expect(screen.getByRole('button', { name: /Try again in/ })).toBeDisabled();
    expect(jest.getTimerCount()).toBe(1);

    first.unmount();
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
    renderAccount();

    expect(await screen.findByRole('button', {
      name: 'Request another verification email',
    })).toBeEnabled();
    expect(screen.queryByText(/The request was accepted\./i)).not.toBeInTheDocument();
    expect(resendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  test('a UID change discards an in-flight result instead of showing it to another user', async () => {
    let finishRequest: (() => void) | undefined;
    resendVerificationEmail.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishRequest = resolve;
    }));
    const view = renderAccount();
    fireEvent.click(await screen.findByRole('button', {
      name: 'Request another verification email',
    }));

    const otherUser = {
      uid: 'other-synthetic-user',
      email: 'other-member@example.test',
      role: 'unverified' as const,
    };
    (getMyProfile as jest.Mock).mockImplementation(async (_firestore, uid) => ({
      ...PROFILE,
      uid,
      email: uid === otherUser.uid ? otherUser.email : PROFILE.email,
    }));
    view.rerender(accountView(otherUser));
    await act(async () => finishRequest?.());

    expect(await screen.findByRole('button', {
      name: 'Request another verification email',
    })).toBeEnabled();
    expect(screen.queryByText(/The request was accepted\./i)).not.toBeInTheDocument();
    expect(resendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(updateMyProfile).not.toHaveBeenCalled();
  });

  test('uses a focusable native button and a 48px focus-visible CSS target', async () => {
    renderAccount();
    const button = await screen.findByRole('button', {
      name: 'Request another verification email',
    });

    expect(button).toHaveAttribute('type', 'button');
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.click(button, { detail: 0 });
    await act(async () => Promise.resolve());
    expect(resendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(updateMyProfile).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();

    const css = readFileSync(join(__dirname, 'Account.css'), 'utf8');
    expect(css).toMatch(/\.verification-resend__button\s*\{[\s\S]*min-height:\s*3rem;/);
    expect(css).toMatch(/\.verification-resend__button:focus-visible\s*\{[\s\S]*outline:/);
  });

  describe('My Account sign-out result boundary', () => {
    const SIGN_OUT_PENDING = 'Signing out. Keep this page open.';
    const SIGN_OUT_RETRY = 'We could not confirm sign-out. You may still be signed in. Try sign out once more.';
    const SIGN_OUT_TERMINAL = 'We still could not confirm sign-out. You may still be signed in. Close the browser and do not let anyone else use this device until the membership lead or platform owner helps.';

    test('blocks rapid repeats and hides private account content immediately', async () => {
      const request = accountDeferred<void>();
      const futureStart = {
        toDate: () => new Date('2099-01-01T12:00:00Z'),
        toMillis: () => new Date('2099-01-01T12:00:00Z').getTime(),
      };
      signOut.mockReturnValueOnce(request.promise);
      (listMyRegistrations as jest.Mock).mockResolvedValue({
        registrations: [{
          amountCents: 1234,
          cancelledAt: null,
          createdAt: null,
          currency: 'usd',
          eventId: 'private-event',
          id: 'private-registration',
          paidAt: null,
          priceTier: 'synthetic-tier',
          refundedAt: null,
          runner: {
            email: 'private-runner@example.test',
            firstName: 'Private',
            lastName: 'Runner',
            shirtSize: null,
          },
          status: 'paid',
        }],
        events: {
          'private-event': {
            id: 'private-event',
            location: 'Private Location',
            slug: 'private-event',
            startAt: futureStart,
            title: 'Private Synthetic Race',
          },
        },
      });
      renderAccount();

      expect(await screen.findByText('Synthetic Member')).toBeInTheDocument();
      expect(await screen.findByText('Private Synthetic Race')).toBeInTheDocument();
      expect(screen.getByText('$12.34')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      expect(screen.getByLabelText('Full name')).toBeInTheDocument();
      const button = screen.getByRole('button', { name: 'Sign out' });
      act(() => {
        fireEvent.click(button);
        fireEvent.click(button);
      });

      expect(signOut).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('status')).toHaveTextContent(SIGN_OUT_PENDING);
      expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
      expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true');
      expect(screen.getByRole('button', { name: 'Sign out' }))
        .toHaveAccessibleDescription(SIGN_OUT_PENDING);
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeDisabled();
      expect(screen.queryByText('Synthetic Member')).not.toBeInTheDocument();
      expect(screen.queryByText(USER.email)).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', {
        name: 'Request another verification email',
      })).not.toBeInTheDocument();
      expect(screen.queryByText(/current paid membership and dues status/i))
        .not.toBeInTheDocument();
      expect(screen.queryByText('Private Synthetic Race')).not.toBeInTheDocument();
      expect(screen.queryByText('$12.34')).not.toBeInTheDocument();
      expect(screen.queryByText('private-registration')).not.toBeInTheDocument();
      expect(screen.queryByTestId('strava-section')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'My Account' }))
        .toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 2, name: 'Sign out' }))
        .toBeInTheDocument();
      expect(document.querySelectorAll('.header')).toHaveLength(1);
    });

    test('keeps the private pending boundary after the command resolves', async () => {
      const request = accountDeferred<void>();
      signOut.mockReturnValueOnce(request.promise);
      renderAccount();

      const button = await screen.findByRole('button', { name: 'Sign out' });
      fireEvent.click(button);
      await act(async () => request.resolve());

      expect(screen.getByRole('status')).toHaveTextContent(SIGN_OUT_PENDING);
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      expect(signOut).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(USER.email)).not.toBeInTheDocument();
    });

    test('keeps a fulfilled retry private and pending without claiming success', async () => {
      const retryRequest = accountDeferred<void>();
      signOut
        .mockRejectedValueOnce(new Error('synthetic-first-sign-out-failure'))
        .mockReturnValueOnce(retryRequest.promise);
      renderAccount();

      fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
      fireEvent.click(await screen.findByRole('button', {
        name: 'Try sign out once more',
      }), { detail: 0 });
      await act(async () => retryRequest.resolve());

      expect(signOut).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('status')).toHaveTextContent(SIGN_OUT_PENDING);
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeDisabled();
      expect(document.body).not.toHaveTextContent(/\bsigned out\b|\bsuccess\b/i);
      expect(screen.queryByText(USER.email)).not.toBeInTheDocument();
    });

    test('uses the same synchronous repeat lock during StrictMode replay', async () => {
      const request = accountDeferred<void>();
      signOut.mockReturnValueOnce(request.promise);
      render(
        <React.StrictMode>
          {accountView()}
        </React.StrictMode>,
      );

      const button = await screen.findByRole('button', { name: 'Sign out' });
      act(() => {
        fireEvent.click(button, { detail: 0 });
        fireEvent.click(button, { detail: 0 });
      });

      expect(signOut).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('status')).toHaveTextContent(SIGN_OUT_PENDING);
      expect(screen.queryByText(USER.email)).not.toBeInTheDocument();
    });

    test('accepts keyboard activation once on each allowed attempt', async () => {
      signOut
        .mockRejectedValueOnce(new Error('synthetic-first-keyboard-failure'))
        .mockRejectedValueOnce(new Error('synthetic-second-keyboard-failure'));
      renderAccount();

      const initial = await screen.findByRole('button', { name: 'Sign out' });
      initial.focus();
      expect(initial).toHaveFocus();
      act(() => {
        fireEvent.click(initial, { detail: 0 });
        fireEvent.click(initial, { detail: 0 });
      });
      const retry = await screen.findByRole('button', {
        name: 'Try sign out once more',
      });
      retry.focus();
      expect(retry).toHaveFocus();
      act(() => {
        fireEvent.click(retry, { detail: 0 });
        fireEvent.click(retry, { detail: 0 });
      });

      expect(signOut).toHaveBeenCalledTimes(2);
      expect(await screen.findByRole('alert')).toHaveTextContent(SIGN_OUT_TERMINAL);
      expect(screen.getByRole('button', { name: 'Sign out unavailable' }))
        .toBeDisabled();
    });

    test('allows one deliberate retry, then shows a fixed terminal result', async () => {
      signOut
        .mockRejectedValueOnce(new Error('synthetic-provider-canary@example.test'))
        .mockRejectedValueOnce(new Error('second-synthetic-provider-canary@example.test'));
      renderAccount();

      fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

      const firstResult = await screen.findByRole('alert');
      expect(firstResult).toHaveTextContent(SIGN_OUT_RETRY);
      expect(firstResult).toHaveAttribute('aria-live', 'assertive');
      expect(firstResult).toHaveAttribute('aria-atomic', 'true');
      expect(document.body).not.toHaveTextContent(/synthetic-provider-canary/i);
      const retry = screen.getByRole('button', { name: 'Try sign out once more' });
      expect(retry).toBeEnabled();
      expect(retry).toHaveAccessibleDescription(SIGN_OUT_RETRY);
      act(() => {
        fireEvent.click(retry);
        fireEvent.click(retry);
      });

      const terminalResult = await screen.findByRole('alert');
      expect(terminalResult).toHaveTextContent(SIGN_OUT_TERMINAL);
      expect(terminalResult).toHaveAttribute('aria-live', 'assertive');
      expect(terminalResult).toHaveAttribute('aria-atomic', 'true');
      const terminalButton = screen.getByRole('button', {
        name: 'Sign out unavailable',
      });
      expect(terminalButton).toBeDisabled();
      expect(terminalButton).toHaveAccessibleDescription(SIGN_OUT_TERMINAL);
      fireEvent.click(screen.getByRole('button', { name: 'Sign out unavailable' }));
      expect(signOut).toHaveBeenCalledTimes(2);
      expect(document.body).not.toHaveTextContent(/synthetic-provider-canary/i);
    });

    test.each([
      ['Error', () => ({
        reads: () => 0,
        reason: new Error('hostile-sign-out-canary@example.test'),
      })],
      ['primitive', () => ({
        reads: () => 0,
        reason: 409,
      })],
      ['accessor-backed object', () => {
        let reads = 0;
        const reason = {};
        Object.defineProperty(reason, 'message', {
          get() {
            reads += 1;
            throw new Error('accessor-sign-out-canary@example.test');
          },
        });
        return { reads: () => reads, reason };
      }],
      ['Proxy', () => {
        let reads = 0;
        const reason = new Proxy({}, {
          get() {
            reads += 1;
            throw new Error('proxy-sign-out-canary@example.test');
          },
        });
        return { reads: () => reads, reason };
      }],
      ['coercible object', () => {
        let reads = 0;
        const reason = {
          [Symbol.toPrimitive]() {
            reads += 1;
            throw new Error('coercion-sign-out-canary@example.test');
          },
          toString() {
            reads += 1;
            throw new Error('coercion-sign-out-canary@example.test');
          },
        };
        return { reads: () => reads, reason };
      }],
      ['thenable-style object', () => {
        let reads = 0;
        const reason = {};
        Object.defineProperty(reason, 'then', {
          get() {
            reads += 1;
            throw new Error('thenable-sign-out-canary@example.test');
          },
        });
        return { reads: () => reads, reason };
      }],
    ])(
      'does not inspect or send a %s rejection on either attempt',
      async (_label, createReason) => {
        const firstReason = createReason();
        const secondReason = createReason();
        const storageSpies = [
          jest.spyOn(Storage.prototype, 'clear'),
          jest.spyOn(Storage.prototype, 'getItem'),
          jest.spyOn(Storage.prototype, 'removeItem'),
          jest.spyOn(Storage.prototype, 'setItem'),
        ];
      const consoleSpies = [
        jest.spyOn(console, 'log').mockImplementation(() => undefined),
        jest.spyOn(console, 'warn').mockImplementation(() => undefined),
        jest.spyOn(console, 'error').mockImplementation(() => undefined),
      ];
        signOut
          .mockRejectedValueOnce(firstReason.reason)
          .mockRejectedValueOnce(secondReason.reason);
        renderAccount();

        fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
        fireEvent.click(await screen.findByRole('button', {
          name: 'Try sign out once more',
        }));

        expect(await screen.findByRole('alert')).toHaveTextContent(SIGN_OUT_TERMINAL);
        expect(firstReason.reads()).toBe(0);
        expect(secondReason.reads()).toBe(0);
        expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
        expect(storageSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
        expect(mockCaptureException).not.toHaveBeenCalled();
        expect(mockTrack).not.toHaveBeenCalled();
        expect(document.body).not.toHaveTextContent(/sign-out-canary/i);
      },
    );

    test('keeps a pending result across a new wrapper with the same identity and app', async () => {
      const request = accountDeferred<void>();
      const stableIdentityService = { signOut, resendVerificationEmail };
      signOut.mockReturnValueOnce(request.promise);
      (useServiceLocator as jest.Mock).mockReturnValue({
        services: {
          firebaseResources: { app, firestore },
          identityService: stableIdentityService,
        },
        isReady: true,
      });
      const view = renderAccount();
      fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

      (useServiceLocator as jest.Mock).mockReturnValue({
        services: {
          firebaseResources: { app, firestore },
          identityService: stableIdentityService,
        },
        isReady: true,
      });
      await act(async () => {
        view.rerender(accountView());
        await Promise.resolve();
      });

      expect(screen.getByRole('status')).toHaveTextContent(SIGN_OUT_PENDING);
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeDisabled();
      expect(signOut).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(USER.email)).not.toBeInTheDocument();
    });

    test('keeps a newer attempt current after an A to B to A service change', async () => {
      const obsoleteRequest = accountDeferred<void>();
      const currentRequest = accountDeferred<void>();
      const identityServiceA = {
        resendVerificationEmail,
        signOut: jest.fn()
          .mockReturnValueOnce(obsoleteRequest.promise)
          .mockReturnValueOnce(currentRequest.promise),
      };
      const identityServiceB = {
        resendVerificationEmail,
        signOut: jest.fn(),
      };
      const view = renderAccount();
      expect(await screen.findByText('Synthetic Member')).toBeInTheDocument();
      (useServiceLocator as jest.Mock).mockReturnValue({
        services: {
          firebaseResources: { app, firestore },
          identityService: identityServiceA,
        },
        isReady: true,
      });
      await act(async () => {
        view.rerender(accountView());
        await Promise.resolve();
      });
      fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

      (useServiceLocator as jest.Mock).mockReturnValue({
        services: {
          firebaseResources: { app, firestore },
          identityService: identityServiceB,
        },
        isReady: true,
      });
      await act(async () => {
        view.rerender(accountView());
        await Promise.resolve();
      });
      (useServiceLocator as jest.Mock).mockReturnValue({
        services: {
          firebaseResources: { app, firestore },
          identityService: identityServiceA,
        },
        isReady: true,
      });
      await act(async () => {
        view.rerender(accountView());
        await Promise.resolve();
      });
      fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
      expect(screen.getByRole('status')).toHaveTextContent(SIGN_OUT_PENDING);

      await act(async () => obsoleteRequest.reject(
        new Error('obsolete-sign-out-canary@example.test'),
      ));
      expect(screen.getByRole('status')).toHaveTextContent(SIGN_OUT_PENDING);
      await act(async () => currentRequest.reject(
        new Error('current-sign-out-canary@example.test'),
      ));

      expect(screen.getByRole('alert')).toHaveTextContent(SIGN_OUT_RETRY);
      expect(screen.getByRole('button', { name: 'Try sign out once more' }))
        .toBeEnabled();
      expect(identityServiceA.signOut).toHaveBeenCalledTimes(2);
      expect(identityServiceB.signOut).not.toHaveBeenCalled();
      expect(document.body).not.toHaveTextContent(/obsolete-sign-out-canary/i);
    });

    test.each([
      'UID',
      'identity service',
      'Firebase app',
    ])(
      'never commits prior profile or registration data after a %s-only change',
      async (transition) => {
        const request = accountDeferred<void>();
        const replacementProfile = accountDeferred<typeof PROFILE>();
        const stableIdentityService = {
          resendVerificationEmail,
          signOut: jest.fn().mockReturnValueOnce(request.promise),
        };
        const replacementIdentityService = transition === 'identity service'
          ? { resendVerificationEmail, signOut: jest.fn() }
          : stableIdentityService;
        const replacementApp = transition === 'Firebase app'
          ? { name: 'replacement-synthetic-app' }
          : app;
        const replacementUser = transition === 'UID'
          ? {
            uid: 'replacement-sign-out-user',
            email: 'replacement-sign-out-user@example.test',
            role: 'unverified' as const,
          }
          : USER;
        const oldStart = {
          toDate: () => new Date('2099-01-01T12:00:00Z'),
          toMillis: () => new Date('2099-01-01T12:00:00Z').getTime(),
        };
        (useServiceLocator as jest.Mock).mockReturnValue({
          services: {
            firebaseResources: { app, firestore },
            identityService: stableIdentityService,
          },
          isReady: true,
        });
        (getMyProfile as jest.Mock)
          .mockResolvedValueOnce(PROFILE)
          .mockReturnValueOnce(replacementProfile.promise);
        (listMyRegistrations as jest.Mock).mockResolvedValueOnce({
          registrations: [{
            amountCents: 4321,
            cancelledAt: null,
            createdAt: null,
            currency: 'usd',
            eventId: 'old-private-event',
            id: 'old-private-registration',
            paidAt: null,
            priceTier: 'synthetic-tier',
            refundedAt: null,
            runner: {
              email: 'old-runner@example.test',
              firstName: 'Old',
              lastName: 'Runner',
              shirtSize: null,
            },
            status: 'paid',
          }],
          events: {
            'old-private-event': {
              id: 'old-private-event',
              location: 'Old Private Location',
              slug: 'old-private-event',
              startAt: oldStart,
              title: 'Old Private Race',
            },
          },
        });
        const commits: string[] = [];
        const onCommit = (text: string) => commits.push(text);
        const view = render(<AccountCommitProbe onCommit={onCommit} />);

        expect(await screen.findByText('Synthetic Member')).toBeInTheDocument();
        expect(await screen.findByText('Old Private Race')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
        commits.length = 0;
        (useServiceLocator as jest.Mock).mockReturnValue({
          services: {
            firebaseResources: { app: replacementApp, firestore },
            identityService: replacementIdentityService,
          },
          isReady: true,
        });
        await act(async () => {
          view.rerender(
            <AccountCommitProbe onCommit={onCommit} user={replacementUser} />,
          );
        });

        expect(commits.length).toBeGreaterThan(0);
        expect(commits.join(' ')).toContain('Loading profile...');
        expect(commits.join(' ')).not.toMatch(
          /Synthetic Member|member@example\.com|Old Private Race|\$43\.21|old-private-registration/,
        );
        expect(document.body).not.toHaveTextContent(/Synthetic Member|Old Private Race/);
        expect(screen.getByRole('status')).toHaveTextContent('Loading profile...');
        await act(async () => request.reject(
          new Error('obsolete-account-canary@example.test'),
        ));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(stableIdentityService.signOut).toHaveBeenCalledTimes(1);
        expect(document.body).not.toHaveTextContent(/obsolete-account-canary/i);
      },
    );

    test('makes a pending rejection inert after unmount', async () => {
      const request = accountDeferred<void>();
      signOut.mockReturnValueOnce(request.promise);
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const view = renderAccount();
      fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

      view.unmount();
      await act(async () => request.reject(new Error('unmounted-sign-out-canary@example.test')));

      expect(signOut).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(consoleError.mock.calls))
        .not.toMatch(/unmounted-sign-out-canary|state update on an unmounted/i);
    });

    test('makes a pending fulfillment inert after unmount', async () => {
      const request = accountDeferred<void>();
      signOut.mockReturnValueOnce(request.promise);
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const view = renderAccount();
      fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

      view.unmount();
      await act(async () => request.resolve());

      expect(signOut).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(consoleError.mock.calls))
        .not.toMatch(/state update on an unmounted/i);
    });

    test('uses a native 48px sign-out button with a visible focus target', async () => {
      const view = render(
        <main id="main-content">
          {accountView()}
        </main>,
      );
      const button = await screen.findByRole('button', { name: 'Sign out' });

      expect(button).toHaveAttribute('type', 'button');
      button.focus();
      expect(button).toHaveFocus();
      fireEvent.click(button);
      expect(view.container.querySelectorAll('main')).toHaveLength(1);
      expect(screen.getByRole('status')).toHaveTextContent(SIGN_OUT_PENDING);

      const css = readFileSync(join(__dirname, 'Account.css'), 'utf8');
      expect(css).toMatch(/\.account-sign-out__button\s*\{[\s\S]*min-height:\s*3rem;/);
      expect(css).toMatch(/\.account-sign-out__button:focus-visible\s*\{[\s\S]*outline:/);
    });
  });
});

const STRAVA_ACTIVITY_FAILURE = 'We could not load your Strava activity right now. Please try again later.';
const STRAVA_CONNECT_FAILURE = 'We could not start your Strava connection. Please try again.';

function renderActualStravaSection() {
  return render(<ActualStravaSection uid={USER.uid} />);
}

function installStravaLocationRecorder() {
  const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
  if (originalDescriptor === undefined) throw new Error('missing synthetic Location descriptor');
  let assignedHref = 'https://example.test/account';
  const replacement = {
    origin: 'https://example.test',
    get href() {
      return assignedHref;
    },
    set href(value: string) {
      assignedHref = String(value);
    },
  };
  Reflect.deleteProperty(window, 'location');
  Object.defineProperty(window, 'location', {
    configurable: true,
    enumerable: true,
    value: replacement,
  });
  return {
    get assignedHref() {
      return assignedHref;
    },
    restore() {
      Reflect.deleteProperty(window, 'location');
      Object.defineProperty(window, 'location', originalDescriptor);
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function stravaConnectionFor(label: string, athleteId: number) {
  return {
    ...STRAVA_CONNECTION,
    athleteId,
    firstName: label,
    lastName: 'Athlete',
    username: `${label.toLowerCase()}-athlete`,
  };
}

function stravaStatsFor(label: string, athleteId: number) {
  return {
    ...STRAVA_STATS,
    athlete: {
      ...STRAVA_STATS.athlete,
      id: athleteId,
      firstName: label,
      username: `${label.toLowerCase()}-athlete`,
    },
    recentActivities: [{
      ...STRAVA_STATS.recentActivities[0],
      id: athleteId * 10,
      name: `${label} Morning Run`,
    }],
  };
}

describe('Strava authorization service boundary', () => {
  const functions = { name: 'synthetic-functions' };

  beforeEach(() => {
    jest.clearAllMocks();
    (getFunctions as jest.Mock).mockReturnValue(functions);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('accepts one exact server challenge without browser state storage', async () => {
    const callable = jest.fn().mockResolvedValue({
      data: STRAVA_AUTHORIZATION_CHALLENGE,
    });
    const storageRead = jest.spyOn(Storage.prototype, 'getItem');
    const storageWrite = jest.spyOn(Storage.prototype, 'setItem');
    const storageRemove = jest.spyOn(Storage.prototype, 'removeItem');
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    const challenge = await ActualStravaService.stravaBeginAuthorization(app);
    const authorizationUrl = ActualStravaService.buildStravaAuthorizeUrl(
      'synthetic-client-id',
      'https://example.test/account/strava/callback',
      challenge,
    );
    const parsedUrl = new URL(authorizationUrl);

    expect(challenge).toEqual(STRAVA_AUTHORIZATION_CHALLENGE);
    expect(Object.isFrozen(challenge)).toBe(true);
    expect(getFunctions).toHaveBeenCalledWith(app);
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'stravaBeginAuthorization');
    expect(callable).toHaveBeenCalledWith({});
    expect(parsedUrl.origin).toBe('https://www.strava.com');
    expect(parsedUrl.pathname).toBe('/oauth/authorize');
    expect(parsedUrl.searchParams.get('state')).toBe(STRAVA_AUTHORIZATION_STATE);
    expect(parsedUrl.searchParams.get('client_id')).toBe('synthetic-client-id');
    expect(parsedUrl.searchParams.get('redirect_uri'))
      .toBe('https://example.test/account/strava/callback');
    expect(storageRead).not.toHaveBeenCalled();
    expect(storageWrite).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
  });

  test.each([
    ['missing state', { expiresInSeconds: 600 }],
    ['short state', { state: 'A'.repeat(42), expiresInSeconds: 600 }],
    ['long state', { state: 'A'.repeat(44), expiresInSeconds: 600 }],
    ['non-base64url state', { state: `${'A'.repeat(42)}=`, expiresInSeconds: 600 }],
    ['non-canonical state', { state: `${'A'.repeat(42)}B`, expiresInSeconds: 600 }],
    ['wrong lifetime', { state: STRAVA_AUTHORIZATION_STATE, expiresInSeconds: 599 }],
    ['extra field', { ...STRAVA_AUTHORIZATION_CHALLENGE, extra: true }],
    ['an array', [STRAVA_AUTHORIZATION_CHALLENGE]],
    ['a null-prototype record', Object.assign(Object.create(null), STRAVA_AUTHORIZATION_CHALLENGE)],
  ])('rejects a malformed %s response before URL construction', async (_case, data) => {
    const callable = jest.fn().mockResolvedValue({ data });
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    await expect(ActualStravaService.stravaBeginAuthorization(app))
      .rejects.toThrow('Invalid Strava authorization response.');
    expect(buildStravaAuthorizeUrl).not.toHaveBeenCalled();
  });

  test('does not invoke a response field getter while rejecting it', async () => {
    const stateGetter = jest.fn(() => STRAVA_AUTHORIZATION_STATE);
    const data = Object.defineProperty(
      { expiresInSeconds: 600 },
      'state',
      { enumerable: true, get: stateGetter },
    );
    const callable = jest.fn().mockResolvedValue({ data });
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    await expect(ActualStravaService.stravaBeginAuthorization(app))
      .rejects.toThrow('Invalid Strava authorization response.');
    expect(stateGetter).not.toHaveBeenCalled();
  });

  test('sends the captured code and state in one exact exchange request', async () => {
    const callable = jest.fn().mockResolvedValue({
      data: { ok: true, athleteId: null },
    });
    (httpsCallable as jest.Mock).mockReturnValue(callable);

    await expect(ActualStravaService.stravaExchangeCode(
      app,
      'synthetic-code',
      STRAVA_AUTHORIZATION_STATE,
    )).resolves.toEqual({ ok: true, athleteId: null });

    expect(getFunctions).toHaveBeenCalledWith(app);
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'stravaExchangeCode');
    expect(callable).toHaveBeenCalledTimes(1);
    expect(callable).toHaveBeenCalledWith({
      code: 'synthetic-code',
      state: STRAVA_AUTHORIZATION_STATE,
    });
  });
});

describe('Strava authorization start browser boundary', () => {
  const originalClientId = process.env.REACT_APP_STRAVA_CLIENT_ID;
  let locationRecorder: ReturnType<typeof installStravaLocationRecorder> | null;

  beforeEach(() => {
    jest.clearAllMocks();
    locationRecorder = null;
    process.env.REACT_APP_STRAVA_CLIENT_ID = 'synthetic-client-id';
    (useServiceLocator as jest.Mock).mockReturnValue({
      services: { firebaseResources: { app, firestore } },
      isReady: true,
    });
    (getStravaConnection as jest.Mock).mockResolvedValue(null);
    (stravaBeginAuthorization as jest.Mock).mockResolvedValue(
      STRAVA_AUTHORIZATION_CHALLENGE,
    );
    (buildStravaAuthorizeUrl as jest.Mock).mockImplementation(
      ActualStravaService.buildStravaAuthorizeUrl,
    );
  });

  afterEach(() => {
    locationRecorder?.restore();
    if (originalClientId === undefined) {
      delete process.env.REACT_APP_STRAVA_CLIENT_ID;
    } else {
      process.env.REACT_APP_STRAVA_CLIENT_ID = originalClientId;
    }
    jest.restoreAllMocks();
  });

  test('waits for begin and blocks a repeated activation while pending', async () => {
    const begin = deferred<typeof STRAVA_AUTHORIZATION_CHALLENGE>();
    (stravaBeginAuthorization as jest.Mock).mockReturnValueOnce(begin.promise);
    renderActualStravaSection();
    const button = await screen.findByRole('button', { name: 'Connect Strava' });

    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Connecting...' }));

    expect(screen.getByRole('button', { name: 'Connecting...' })).toBeDisabled();
    expect(stravaBeginAuthorization).toHaveBeenCalledWith(app);
    expect(stravaBeginAuthorization).toHaveBeenCalledTimes(1);
    expect(buildStravaAuthorizeUrl).not.toHaveBeenCalled();
  });

  test('navigates only after one valid begin response', async () => {
    const begin = deferred<typeof STRAVA_AUTHORIZATION_CHALLENGE>();
    locationRecorder = installStravaLocationRecorder();
    (stravaBeginAuthorization as jest.Mock).mockReturnValueOnce(begin.promise);
    renderActualStravaSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Connect Strava' }));
    expect(locationRecorder.assignedHref).toBe('https://example.test/account');
    await act(async () => begin.resolve(STRAVA_AUTHORIZATION_CHALLENGE));

    const expectedUrl = ActualStravaService.buildStravaAuthorizeUrl(
      'synthetic-client-id',
      'https://example.test/account/strava/callback',
      STRAVA_AUTHORIZATION_CHALLENGE,
    );
    expect(buildStravaAuthorizeUrl).toHaveBeenCalledWith(
      'synthetic-client-id',
      'https://example.test/account/strava/callback',
      STRAVA_AUTHORIZATION_CHALLENGE,
    );
    expect(buildStravaAuthorizeUrl).toHaveBeenCalledTimes(1);
    expect(locationRecorder.assignedHref).toBe(expectedUrl);
    expect(screen.getByRole('button', { name: 'Connecting...' })).toBeDisabled();
  });

  test('shows one accessible retry state without inspecting a begin rejection', async () => {
    const messageGetter = jest.fn(() => {
      throw new Error('begin-message-getter-canary');
    });
    (stravaBeginAuthorization as jest.Mock).mockRejectedValueOnce(
      Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }),
    );
    (stravaBeginAuthorization as jest.Mock).mockReturnValueOnce(new Promise(() => {
      // Keep the retry pending so no navigation is attempted.
    }));
    renderActualStravaSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Connect Strava' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(STRAVA_CONNECT_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(messageGetter).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('begin-message-getter-canary');
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    expect(screen.getByRole('button', { name: 'Connecting...' })).toBeDisabled();
    expect(stravaBeginAuthorization).toHaveBeenCalledTimes(2);
    expect(buildStravaAuthorizeUrl).not.toHaveBeenCalled();
  });

  test('rejects a malformed begin response without navigating', async () => {
    locationRecorder = installStravaLocationRecorder();
    const malformed = {
      state: STRAVA_AUTHORIZATION_STATE,
      expiresInSeconds: 599,
    };
    (stravaBeginAuthorization as jest.Mock).mockResolvedValueOnce(malformed);
    renderActualStravaSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Connect Strava' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(STRAVA_CONNECT_FAILURE);
    expect(buildStravaAuthorizeUrl).toHaveBeenCalledWith(
      'synthetic-client-id',
      'https://example.test/account/strava/callback',
      malformed,
    );
    expect(locationRecorder.assignedHref).toBe('https://example.test/account');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  test.each([
    ['UID', 'uid'],
    ['service', 'service'],
  ])('discards an obsolete begin success after a %s change', async (_case, change) => {
    const begin = deferred<typeof STRAVA_AUTHORIZATION_CHALLENGE>();
    locationRecorder = installStravaLocationRecorder();
    (stravaBeginAuthorization as jest.Mock).mockReturnValueOnce(begin.promise);
    const firstServices = { firebaseResources: { app, firestore } };
    const locator = { current: { services: firstServices, isReady: true } };
    (useServiceLocator as jest.Mock).mockImplementation(() => locator.current);
    const view = render(<ActualStravaSection uid={USER.uid} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Strava' }));

    if (change === 'uid') {
      view.rerender(<ActualStravaSection uid="second-synthetic-user" />);
    } else {
      locator.current = {
        services: { firebaseResources: { app, firestore } },
        isReady: true,
      };
      view.rerender(<ActualStravaSection uid={USER.uid} />);
    }
    await waitFor(() => expect(getStravaConnection).toHaveBeenCalledTimes(2));
    await act(async () => begin.resolve(STRAVA_AUTHORIZATION_CHALLENGE));

    expect(buildStravaAuthorizeUrl).not.toHaveBeenCalled();
    expect(locationRecorder.assignedHref).toBe('https://example.test/account');
    expect(stravaBeginAuthorization).toHaveBeenCalledTimes(1);
  });

  test('makes an obsolete begin rejection inert after unmount', async () => {
    const begin = deferred<typeof STRAVA_AUTHORIZATION_CHALLENGE>();
    const messageGetter = jest.fn(() => {
      throw new Error('unmounted-begin-getter-canary');
    });
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method as any).mockImplementation(() => undefined));
    (stravaBeginAuthorization as jest.Mock).mockReturnValueOnce(begin.promise);
    const view = renderActualStravaSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Strava' }));
    view.unmount();

    await act(async () => begin.reject(Object.defineProperty({}, 'message', {
      configurable: true,
      get: messageGetter,
    })));

    expect(messageGetter).not.toHaveBeenCalled();
    expect(buildStravaAuthorizeUrl).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('unmounted-begin-getter-canary');
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });
});

describe('Strava activity browser failure boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useServiceLocator as jest.Mock).mockReturnValue({
      services: { firebaseResources: { app, firestore } },
      isReady: true,
    });
    (getStravaConnection as jest.Mock).mockResolvedValue(STRAVA_CONNECTION);
    (stravaFetchStats as jest.Mock).mockResolvedValue(STRAVA_STATS);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('waits for the connection before requesting stats once', async () => {
    let resolveConnection: ((connection: typeof STRAVA_CONNECTION) => void) | undefined;
    (getStravaConnection as jest.Mock).mockReturnValueOnce(
      new Promise<typeof STRAVA_CONNECTION>((resolve) => {
        resolveConnection = resolve;
      }),
    );

    renderActualStravaSection();

    await waitFor(() => expect(getStravaConnection).toHaveBeenCalledWith(firestore, USER.uid));
    expect(stravaFetchStats).not.toHaveBeenCalled();

    await act(async () => resolveConnection?.(STRAVA_CONNECTION));

    await waitFor(() => expect(stravaFetchStats).toHaveBeenCalledWith(app));
    expect(stravaFetchStats).toHaveBeenCalledTimes(1);
  });

  test('replaces rejected stats details with one fixed actionable alert', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method as any).mockImplementation(() => undefined));
    (stravaFetchStats as jest.Mock).mockRejectedValueOnce(Object.assign(
      new Error('provider-private-canary member@example.test'),
      {
        code: 'functions/provider-private-canary',
        endpoint: 'https://provider.example.test/?token=secret-canary',
      },
    ));

    renderActualStravaSection();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(STRAVA_ACTIVITY_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(document.body).toHaveTextContent('Synthetic Athlete');
    expect(document.body).not.toHaveTextContent(
      /provider-private-canary|member@example\.test|provider\.example|secret-canary/i,
    );
    expect(screen.queryByText('Loading recent activity...')).not.toBeInTheDocument();
    expect(getStravaConnection).toHaveBeenCalledWith(firestore, USER.uid);
    expect(stravaFetchStats).toHaveBeenCalledWith(app);
    expect(stravaFetchStats).toHaveBeenCalledTimes(1);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('preserves the successful activity projection', async () => {
    renderActualStravaSection();

    expect(await screen.findByText('Synthetic Morning Run')).toBeInTheDocument();
    expect(screen.getByText('Runs this year')).toBeInTheDocument();
    expect(screen.getByText('All-time runs')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(stravaFetchStats).toHaveBeenCalledWith(app);
    expect(stravaFetchStats).toHaveBeenCalledTimes(1);
  });

  test('does not inspect a hostile stats rejection', async () => {
    const messageGetter = jest.fn(() => {
      throw new Error('message-getter-canary');
    });
    (stravaFetchStats as jest.Mock).mockRejectedValueOnce(
      Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }),
    );

    renderActualStravaSection();

    expect(await screen.findByRole('alert')).toHaveTextContent(STRAVA_ACTIVITY_FAILURE);
    expect(messageGetter).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('message-getter-canary');
    expect(screen.queryByText('Loading recent activity...')).not.toBeInTheDocument();
    expect(stravaFetchStats).toHaveBeenCalledTimes(1);
  });
});

const STRAVA_CONNECTION_FAILURE = 'We could not check your Strava connection right now. Please refresh this page and try again.';

describe('Strava current-account lifecycle privacy boundary', () => {
  const userA = 'synthetic-user-a';
  const userB = 'synthetic-user-b';
  const connectionA = stravaConnectionFor('Alpha', 111111);
  const connectionB = stravaConnectionFor('Bravo', 222222);
  const statsA = stravaStatsFor('Alpha', 111111);
  const statsB = stravaStatsFor('Bravo', 222222);
  let appA: { name: string };
  let appB: { name: string };
  let firestoreA: { name: string };
  let firestoreB: { name: string };
  let locator: {
    current: {
      services: {
        firebaseResources: {
          app: { name: string };
          firestore: { name: string };
        };
      };
      isReady: boolean;
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    appA = { name: 'synthetic-app-a' };
    appB = { name: 'synthetic-app-b' };
    firestoreA = { name: 'synthetic-firestore-a' };
    firestoreB = { name: 'synthetic-firestore-b' };
    locator = {
      current: {
        services: { firebaseResources: { app: appA, firestore: firestoreA } },
        isReady: true,
      },
    };
    (useServiceLocator as jest.Mock).mockImplementation(() => locator.current);
    (stravaDisconnect as jest.Mock).mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    ['UID', ({ rerender }: { rerender: (node: React.ReactElement) => void }) => {
      rerender(<ActualStravaSection uid={userB} />);
    }],
    ['services', ({ rerender }: { rerender: (node: React.ReactElement) => void }) => {
      locator.current = {
        ...locator.current,
        services: { ...locator.current.services },
      };
      rerender(<ActualStravaSection uid={userA} />);
    }],
    ['Firebase resources', ({ rerender }: { rerender: (node: React.ReactElement) => void }) => {
      locator.current.services.firebaseResources = {
        app: appA,
        firestore: firestoreA,
      };
      rerender(<ActualStravaSection uid={userA} />);
    }],
    ['Firestore', ({ rerender }: { rerender: (node: React.ReactElement) => void }) => {
      locator.current.services.firebaseResources.firestore = firestoreB;
      rerender(<ActualStravaSection uid={userA} />);
    }],
    ['Firebase app', ({ rerender }: { rerender: (node: React.ReactElement) => void }) => {
      locator.current.services.firebaseResources.app = appB;
      rerender(<ActualStravaSection uid={userA} />);
    }],
    ['readiness', ({ rerender }: { rerender: (node: React.ReactElement) => void }) => {
      locator.current.isReady = false;
      rerender(<ActualStravaSection uid={userA} />);
    }],
  ])('hides prior account data in the first commit after a %s change', async (
    _case,
    changeContext,
  ) => {
    const commits: string[] = [];
    (getStravaConnection as jest.Mock)
      .mockResolvedValueOnce(connectionA)
      .mockResolvedValue(connectionB);
    (stravaFetchStats as jest.Mock)
      .mockResolvedValueOnce(statsA)
      .mockResolvedValue(statsB);
    const onRender = () => {
      commits.push(document.body.textContent || '');
    };
    const view = render(
      <React.Profiler id="strava-attempt" onRender={onRender}>
        <ActualStravaSection uid={userA} />
      </React.Profiler>,
    );
    expect(await screen.findByText('Alpha Morning Run')).toBeInTheDocument();

    commits.length = 0;
    changeContext({
      rerender: (node: React.ReactElement) => view.rerender(
        <React.Profiler id="strava-attempt" onRender={onRender}>
          {node}
        </React.Profiler>,
      ),
    });

    expect(commits[0]).not.toMatch(/Alpha Athlete|Alpha Morning Run/);
    expect(commits[0]).not.toContain('Connect Strava');
    if (_case !== 'readiness') {
      expect(await screen.findByText('Bravo Morning Run')).toBeInTheDocument();
    }
  });

  test('keeps a rejected current connection unavailable without revealing prior account data', async () => {
    const nextConnection = deferred<null>();
    const messageGetter = jest.fn(() => {
      throw new Error('connection-message-getter-canary');
    });
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method as any).mockImplementation(() => undefined));
    (getStravaConnection as jest.Mock)
      .mockResolvedValueOnce(connectionA)
      .mockReturnValueOnce(nextConnection.promise);
    (stravaFetchStats as jest.Mock).mockResolvedValueOnce(statsA);
    const view = render(<ActualStravaSection uid={userA} />);
    expect(await screen.findByText('Alpha Morning Run')).toBeInTheDocument();

    view.rerender(<ActualStravaSection uid={userB} />);
    expect(document.body).not.toHaveTextContent(/Alpha Athlete|Alpha Morning Run/);
    await act(async () => nextConnection.reject(
      Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }),
    ));

    expect(await screen.findByRole('alert')).toHaveTextContent(STRAVA_CONNECTION_FAILURE);
    expect(screen.queryByRole('button', { name: 'Connect Strava' })).not.toBeInTheDocument();
    expect(messageGetter).not.toHaveBeenCalled();
    expect(stravaFetchStats).toHaveBeenCalledTimes(1);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('ignores an obsolete connection success after a different account becomes current', async () => {
    const firstConnection = deferred<ReturnType<typeof stravaConnectionFor>>();
    const firstNameGetter = jest.fn(() => {
      throw new Error('obsolete-connection-getter-canary');
    });
    const hostileConnection = Object.defineProperty(
      { ...connectionA },
      'firstName',
      { configurable: true, get: firstNameGetter },
    ) as ReturnType<typeof stravaConnectionFor>;
    (getStravaConnection as jest.Mock).mockImplementation(
      (_firestore: unknown, uid: string) => (uid === userA
        ? firstConnection.promise
        : Promise.resolve(connectionB)),
    );
    (stravaFetchStats as jest.Mock).mockResolvedValue(statsB);
    const view = render(<ActualStravaSection uid={userA} />);

    view.rerender(<ActualStravaSection uid={userB} />);
    expect(await screen.findByText('Bravo Morning Run')).toBeInTheDocument();
    await act(async () => firstConnection.resolve(hostileConnection));

    expect(document.body).toHaveTextContent('Bravo Athlete');
    expect(document.body).toHaveTextContent('Bravo Morning Run');
    expect(document.body).not.toHaveTextContent(/Alpha Athlete|Alpha Morning Run/);
    expect(firstNameGetter).not.toHaveBeenCalled();
    expect(stravaFetchStats).toHaveBeenCalledTimes(1);
  });

  test('ignores an obsolete connection rejection while the current account is loading', async () => {
    const firstConnection = deferred<ReturnType<typeof stravaConnectionFor>>();
    const currentConnection = deferred<ReturnType<typeof stravaConnectionFor>>();
    const messageGetter = jest.fn(() => {
      throw new Error('obsolete-connection-rejection-canary');
    });
    (getStravaConnection as jest.Mock).mockImplementation(
      (_firestore: unknown, uid: string) => (uid === userA
        ? firstConnection.promise
        : currentConnection.promise),
    );
    (stravaFetchStats as jest.Mock).mockResolvedValue(statsB);
    const view = render(<ActualStravaSection uid={userA} />);
    await waitFor(() => expect(getStravaConnection).toHaveBeenCalledTimes(1));

    view.rerender(<ActualStravaSection uid={userB} />);
    await waitFor(() => expect(getStravaConnection).toHaveBeenCalledTimes(2));
    await act(async () => firstConnection.reject(
      Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }),
    ));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect Strava' })).not.toBeInTheDocument();
    expect(messageGetter).not.toHaveBeenCalled();
    await act(async () => currentConnection.resolve(connectionB));
    expect(await screen.findByText('Bravo Morning Run')).toBeInTheDocument();
  });

  test('ignores obsolete activity success and failure after a different account becomes current', async () => {
    const firstStats = deferred<ReturnType<typeof stravaStatsFor>>();
    const currentStats = deferred<ReturnType<typeof stravaStatsFor>>();
    (getStravaConnection as jest.Mock).mockImplementation(
      (_firestore: unknown, uid: string) => Promise.resolve(
        uid === userA ? connectionA : connectionB,
      ),
    );
    (stravaFetchStats as jest.Mock).mockImplementation(
      (activeApp: unknown) => (activeApp === appA ? firstStats.promise : currentStats.promise),
    );
    const view = render(<ActualStravaSection uid={userA} />);
    await waitFor(() => expect(stravaFetchStats).toHaveBeenCalledWith(appA));

    locator.current = {
      services: { firebaseResources: { app: appB, firestore: firestoreB } },
      isReady: true,
    };
    view.rerender(<ActualStravaSection uid={userB} />);
    await waitFor(() => expect(stravaFetchStats).toHaveBeenCalledWith(appB));
    expect(screen.getByText('Loading recent activity...')).toBeInTheDocument();

    await act(async () => firstStats.resolve(statsA));
    expect(document.body).not.toHaveTextContent('Alpha Morning Run');
    expect(screen.getByText('Loading recent activity...')).toBeInTheDocument();

    await act(async () => currentStats.resolve(statsB));
    expect(await screen.findByText('Bravo Morning Run')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('Alpha Morning Run');
  });

  test('keeps an obsolete activity rejection out of the current loading account', async () => {
    const firstStats = deferred<ReturnType<typeof stravaStatsFor>>();
    const currentStats = deferred<ReturnType<typeof stravaStatsFor>>();
    const messageGetter = jest.fn(() => {
      throw new Error('obsolete-stats-message-getter-canary');
    });
    (getStravaConnection as jest.Mock).mockImplementation(
      (_firestore: unknown, uid: string) => Promise.resolve(
        uid === userA ? connectionA : connectionB,
      ),
    );
    (stravaFetchStats as jest.Mock).mockImplementation(
      (activeApp: unknown) => (activeApp === appA ? firstStats.promise : currentStats.promise),
    );
    const view = render(<ActualStravaSection uid={userA} />);
    await waitFor(() => expect(stravaFetchStats).toHaveBeenCalledWith(appA));

    locator.current = {
      services: { firebaseResources: { app: appB, firestore: firestoreB } },
      isReady: true,
    };
    view.rerender(<ActualStravaSection uid={userB} />);
    await waitFor(() => expect(stravaFetchStats).toHaveBeenCalledWith(appB));
    await act(async () => firstStats.reject(
      Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }),
    ));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Loading recent activity...')).toBeInTheDocument();
    expect(messageGetter).not.toHaveBeenCalled();
    await act(async () => currentStats.resolve(statsB));
    expect(await screen.findByText('Bravo Morning Run')).toBeInTheDocument();
  });

  test('uses a new opaque generation when the account changes A to B to A', async () => {
    const firstA = deferred<ReturnType<typeof stravaConnectionFor>>();
    const middleB = deferred<ReturnType<typeof stravaConnectionFor>>();
    const firstAGetter = jest.fn(() => {
      throw new Error('first-a-generation-canary');
    });
    const middleBGetter = jest.fn(() => {
      throw new Error('middle-b-generation-canary');
    });
    const currentConnection = stravaConnectionFor('Current Alpha', 333333);
    const currentStats = stravaStatsFor('Current Alpha', 333333);
    (getStravaConnection as jest.Mock)
      .mockReturnValueOnce(firstA.promise)
      .mockReturnValueOnce(middleB.promise)
      .mockResolvedValueOnce(currentConnection);
    (stravaFetchStats as jest.Mock).mockResolvedValue(currentStats);
    const view = render(<ActualStravaSection uid={userA} />);
    await waitFor(() => expect(getStravaConnection).toHaveBeenCalledTimes(1));

    view.rerender(<ActualStravaSection uid={userB} />);
    await waitFor(() => expect(getStravaConnection).toHaveBeenCalledTimes(2));
    view.rerender(<ActualStravaSection uid={userA} />);
    expect(await screen.findByText('Current Alpha Morning Run')).toBeInTheDocument();
    expect(getStravaConnection).toHaveBeenCalledTimes(3);

    await act(async () => {
      firstA.resolve(Object.defineProperty(
        { ...connectionA },
        'firstName',
        { configurable: true, get: firstAGetter },
      ) as ReturnType<typeof stravaConnectionFor>);
      middleB.resolve(Object.defineProperty(
        { ...connectionB },
        'firstName',
        { configurable: true, get: middleBGetter },
      ) as ReturnType<typeof stravaConnectionFor>);
    });

    expect(firstAGetter).not.toHaveBeenCalled();
    expect(middleBGetter).not.toHaveBeenCalled();
    expect(document.body).toHaveTextContent('Current Alpha Athlete');
    expect(document.body).toHaveTextContent('Current Alpha Morning Run');
    expect(document.body).not.toHaveTextContent('Bravo Athlete');
    expect(stravaFetchStats).toHaveBeenCalledTimes(1);
  });

  test('keeps the first StrictMode effect replay inert after the current replay resolves', async () => {
    const firstReplay = deferred<ReturnType<typeof stravaConnectionFor>>();
    const currentReplay = deferred<ReturnType<typeof stravaConnectionFor>>();
    const firstNameGetter = jest.fn(() => {
      throw new Error('strict-replay-getter-canary');
    });
    (getStravaConnection as jest.Mock)
      .mockReturnValueOnce(firstReplay.promise)
      .mockReturnValueOnce(currentReplay.promise);
    (stravaFetchStats as jest.Mock).mockResolvedValue(statsA);

    render(
      <React.StrictMode>
        <ActualStravaSection uid={userA} />
      </React.StrictMode>,
    );
    await waitFor(() => expect(getStravaConnection).toHaveBeenCalledTimes(2));
    await act(async () => currentReplay.resolve(connectionA));
    expect(await screen.findByText('Alpha Morning Run')).toBeInTheDocument();
    await act(async () => firstReplay.resolve(Object.defineProperty(
      { ...connectionB },
      'firstName',
      { configurable: true, get: firstNameGetter },
    ) as ReturnType<typeof stravaConnectionFor>));

    expect(firstNameGetter).not.toHaveBeenCalled();
    expect(document.body).toHaveTextContent('Alpha Athlete');
    expect(document.body).not.toHaveTextContent('Bravo Athlete');
    expect(stravaFetchStats).toHaveBeenCalledTimes(1);
  });

  test('does not let an obsolete disconnect clear the current account', async () => {
    const disconnect = deferred<{ ok: true }>();
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    (getStravaConnection as jest.Mock).mockImplementation(
      (_firestore: unknown, uid: string) => Promise.resolve(
        uid === userA ? connectionA : connectionB,
      ),
    );
    (stravaFetchStats as jest.Mock).mockImplementation(
      (activeApp: unknown) => Promise.resolve(activeApp === appA ? statsA : statsB),
    );
    (stravaDisconnect as jest.Mock).mockReturnValueOnce(disconnect.promise);
    const view = render(<ActualStravaSection uid={userA} />);
    expect(await screen.findByText('Alpha Morning Run')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    locator.current = {
      services: { firebaseResources: { app: appB, firestore: firestoreB } },
      isReady: true,
    };
    view.rerender(<ActualStravaSection uid={userB} />);
    expect(await screen.findByText('Bravo Morning Run')).toBeInTheDocument();
    await act(async () => disconnect.resolve({ ok: true }));

    expect(document.body).toHaveTextContent('Bravo Athlete');
    expect(document.body).toHaveTextContent('Bravo Morning Run');
    expect(screen.queryByRole('button', { name: 'Connect Strava' })).not.toBeInTheDocument();
  });

  test('does not let an obsolete disconnect rejection warn the current account', async () => {
    const disconnect = deferred<{ ok: true }>();
    const messageGetter = jest.fn(() => {
      throw new Error('obsolete-disconnect-rejection-canary');
    });
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    (getStravaConnection as jest.Mock).mockImplementation(
      (_firestore: unknown, uid: string) => Promise.resolve(
        uid === userA ? connectionA : connectionB,
      ),
    );
    (stravaFetchStats as jest.Mock).mockImplementation(
      (activeApp: unknown) => Promise.resolve(activeApp === appA ? statsA : statsB),
    );
    (stravaDisconnect as jest.Mock).mockReturnValueOnce(disconnect.promise);
    const view = render(<ActualStravaSection uid={userA} />);
    expect(await screen.findByText('Alpha Morning Run')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    locator.current = {
      services: { firebaseResources: { app: appB, firestore: firestoreB } },
      isReady: true,
    };
    view.rerender(<ActualStravaSection uid={userB} />);
    expect(await screen.findByText('Bravo Morning Run')).toBeInTheDocument();
    await act(async () => disconnect.reject(Object.defineProperty({}, 'message', {
      configurable: true,
      get: messageGetter,
    })));

    expect(messageGetter).not.toHaveBeenCalled();
    expect(document.body).toHaveTextContent('Bravo Athlete');
    expect(document.body).toHaveTextContent('Bravo Morning Run');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('invalidates pending activity before a current disconnect success settles', async () => {
    const pendingStats = deferred<ReturnType<typeof stravaStatsFor>>();
    const recentActivitiesGetter = jest.fn(() => {
      throw new Error('post-disconnect-activity-getter-canary');
    });
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    (getStravaConnection as jest.Mock).mockResolvedValue(connectionA);
    (stravaFetchStats as jest.Mock).mockReturnValue(pendingStats.promise);
    const view = render(<ActualStravaSection uid={userA} />);
    expect(await screen.findByText('Loading recent activity...')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    expect(await screen.findByRole('button', { name: 'Connect Strava' })).toBeInTheDocument();
    await act(async () => pendingStats.resolve(Object.defineProperty(
      { ...statsA },
      'recentActivities',
      { configurable: true, get: recentActivitiesGetter },
    ) as ReturnType<typeof stravaStatsFor>));

    expect(recentActivitiesGetter).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Connect Strava' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Alpha Athlete|Alpha Morning Run/);
    view.unmount();
  });

  test('makes pending connection and activity work inert after unmount', async () => {
    const pendingConnection = deferred<ReturnType<typeof stravaConnectionFor>>();
    const connectionGetter = jest.fn(() => {
      throw new Error('unmounted-connection-getter-canary');
    });
    (getStravaConnection as jest.Mock).mockReturnValueOnce(pendingConnection.promise);
    const connectionView = render(<ActualStravaSection uid={userA} />);
    await waitFor(() => expect(getStravaConnection).toHaveBeenCalledTimes(1));
    connectionView.unmount();
    await act(async () => pendingConnection.resolve(Object.defineProperty(
      { ...connectionA },
      'firstName',
      { configurable: true, get: connectionGetter },
    ) as ReturnType<typeof stravaConnectionFor>));
    expect(connectionGetter).not.toHaveBeenCalled();
    expect(stravaFetchStats).not.toHaveBeenCalled();

    jest.clearAllMocks();
    const pendingStats = deferred<ReturnType<typeof stravaStatsFor>>();
    const statsGetter = jest.fn(() => {
      throw new Error('unmounted-stats-getter-canary');
    });
    (useServiceLocator as jest.Mock).mockImplementation(() => locator.current);
    (getStravaConnection as jest.Mock).mockResolvedValueOnce(connectionA);
    (stravaFetchStats as jest.Mock).mockReturnValueOnce(pendingStats.promise);
    const statsView = render(<ActualStravaSection uid={userA} />);
    await waitFor(() => expect(stravaFetchStats).toHaveBeenCalledTimes(1));
    statsView.unmount();
    await act(async () => pendingStats.resolve(Object.defineProperty(
      { ...statsA },
      'recentActivities',
      { configurable: true, get: statsGetter },
    ) as ReturnType<typeof stravaStatsFor>));
    expect(statsGetter).not.toHaveBeenCalled();
  });

  test('makes a pending disconnect rejection inert after unmount', async () => {
    const disconnect = deferred<{ ok: true }>();
    const messageGetter = jest.fn(() => {
      throw new Error('unmounted-disconnect-getter-canary');
    });
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method as any).mockImplementation(() => undefined));
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    (getStravaConnection as jest.Mock).mockResolvedValue(connectionA);
    (stravaFetchStats as jest.Mock).mockResolvedValue(statsA);
    (stravaDisconnect as jest.Mock).mockReturnValueOnce(disconnect.promise);
    const view = render(<ActualStravaSection uid={userA} />);
    expect(await screen.findByText('Alpha Morning Run')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    view.unmount();

    await act(async () => disconnect.reject(Object.defineProperty({}, 'message', {
      configurable: true,
      get: messageGetter,
    })));

    expect(messageGetter).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('shows Connect only after the current account lookup confirms no connection', async () => {
    (getStravaConnection as jest.Mock).mockResolvedValue(null);

    render(<ActualStravaSection uid={userA} />);

    expect(await screen.findByRole('button', { name: 'Connect Strava' })).toBeInTheDocument();
    expect(stravaFetchStats).not.toHaveBeenCalled();
  });
});

const STRAVA_DISCONNECT_FAILURE = 'We could not confirm the Strava disconnect. Please refresh this page before trying again.';

describe('Strava disconnect browser failure boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useServiceLocator as jest.Mock).mockReturnValue({
      services: { firebaseResources: { app, firestore } },
      isReady: true,
    });
    (getStravaConnection as jest.Mock).mockResolvedValue(STRAVA_CONNECTION);
    (stravaFetchStats as jest.Mock).mockResolvedValue(STRAVA_STATS);
    (stravaDisconnect as jest.Mock).mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('replaces rejected disconnect details with one fixed refresh-before-retry alert', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method as any).mockImplementation(() => undefined));
    let rejectDisconnect: ((reason?: unknown) => void) | undefined;
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    (stravaDisconnect as jest.Mock).mockReturnValueOnce(new Promise((_resolve, reject) => {
      rejectDisconnect = reject;
    }));
    const privateFailure = Object.assign(
      new Error('disconnect-private-canary member@example.test'),
      {
        code: 'functions/disconnect-private-canary',
        endpoint: 'https://provider.example.test/?token=secret-canary',
      },
    );

    renderActualStravaSection();
    expect(await screen.findByText('Synthetic Morning Run')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    const pendingButton = screen.getByRole('button', { name: 'Disconnecting...' });
    expect(pendingButton).toBeDisabled();
    fireEvent.click(pendingButton);
    expect(stravaDisconnect).toHaveBeenCalledTimes(1);
    await act(async () => { rejectDisconnect?.(privateFailure); });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(STRAVA_DISCONNECT_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(document.body).toHaveTextContent('Synthetic Athlete');
    expect(document.body).toHaveTextContent('Synthetic Morning Run');
    expect(document.body).not.toHaveTextContent(
      /disconnect-private-canary|member@example\.test|provider\.example|secret-canary/i,
    );
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled();
    expect(stravaDisconnect).toHaveBeenCalledWith(app);
    expect(stravaDisconnect).toHaveBeenCalledTimes(1);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('does not inspect a hostile disconnect rejection', async () => {
    const messageGetter = jest.fn(() => {
      throw new Error('disconnect-message-getter-canary');
    });
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    (stravaDisconnect as jest.Mock).mockRejectedValueOnce(
      Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }),
    );

    renderActualStravaSection();
    expect(await screen.findByText('Synthetic Morning Run')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    expect((await screen.findByRole('alert')).textContent).toBe(STRAVA_DISCONNECT_FAILURE);
    expect(messageGetter).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('disconnect-message-getter-canary');
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled();
  });

  test('keeps the disconnect warning when a pending stats request later fails', async () => {
    let rejectStats: ((reason?: unknown) => void) | undefined;
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    (stravaFetchStats as jest.Mock).mockReturnValueOnce(new Promise((_resolve, reject) => {
      rejectStats = reject;
    }));
    (stravaDisconnect as jest.Mock).mockRejectedValueOnce(
      new Error('disconnect-priority-canary'),
    );

    renderActualStravaSection();
    expect(await screen.findByText('Loading recent activity...')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    expect((await screen.findByRole('alert')).textContent).toBe(STRAVA_DISCONNECT_FAILURE);
    await act(async () => { rejectStats?.(new Error('stats-priority-canary')); });

    expect(screen.getByRole('alert').textContent).toBe(STRAVA_DISCONNECT_FAILURE);
    expect(document.body).not.toHaveTextContent(
      /disconnect-priority-canary|stats-priority-canary/i,
    );
    expect(document.body).toHaveTextContent('Synthetic Athlete');
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled();
    expect(stravaDisconnect).toHaveBeenCalledTimes(1);
  });

  test('does not request a disconnect when confirmation is cancelled', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(false);

    renderActualStravaSection();
    expect(await screen.findByText('Synthetic Morning Run')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    expect(stravaDisconnect).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled();
  });

  test('preserves the successful disconnect transition', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    renderActualStravaSection();
    expect(await screen.findByText('Synthetic Morning Run')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    expect(await screen.findByRole('button', { name: 'Connect Strava' })).toBeInTheDocument();
    expect(screen.queryByText('Synthetic Athlete')).not.toBeInTheDocument();
    expect(screen.queryByText('Synthetic Morning Run')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(stravaDisconnect).toHaveBeenCalledWith(app);
    expect(stravaDisconnect).toHaveBeenCalledTimes(1);
  });
});

const STRAVA_CALLBACK_FAILURE = 'We could not connect Strava. Please return to My Account and try again.';
const prepareStravaCallbackAppCheck = jest.fn();

function makeCallbackFirebaseResources(firebaseApp: object = app) {
  return {
    app: firebaseApp,
    prepareAppCheckAfterStravaCallbackCleanup: prepareStravaCallbackAppCheck,
  };
}

function CallbackAccountDestination() {
  const navigationType = useNavigationType();

  return (
    <div>
      Account destination
      <span data-testid="callback-navigation-type">{navigationType}</span>
    </div>
  );
}

function CallbackLocationWitness() {
  const location = useLocation();

  return (
    <span
      hidden
      data-testid="strava-callback-location"
      data-search-clean={String(location.search === '')}
      data-hash-clean={String(location.hash === '')}
      data-state-clean={String(location.state === null)}
    />
  );
}

type CallbackRouterSnapshot = Readonly<{
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
}>;

type CallbackRouterObservation = {
  current: CallbackRouterSnapshot | null;
  onLocation?: (snapshot: CallbackRouterSnapshot) => void;
};

function CallbackSameRouteProbe() {
  const navigate = useNavigate();

  return (
    <>
      <button
        type="button"
        onClick={() => navigate(
          '/account/strava/callback?code=second-code-canary&state=second-state-canary'
          + '#second-fragment-canary',
        )}
      >
        Load another callback
      </button>
      <button
        type="button"
        onClick={() => navigate(
          '/account/strava/callback',
          { replace: true, state: { privateRouterState: 'second-router-state-canary' } },
        )}
      >
        Inject callback Router state
      </button>
      <button
        type="button"
        onClick={() => navigate(
          '/account/strava/callback',
          { replace: true, state: null },
        )}
      >
        Replace clean callback entry
      </button>
    </>
  );
}

function CallbackRouteHarness({
  observation,
}: {
  observation?: CallbackRouterObservation;
}) {
  const location = useLocation();
  const observationTarget = observation;
  if (observationTarget) {
    const snapshot = {
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
      state: location.state,
    };
    observationTarget.current = snapshot;
    observationTarget.onLocation?.(snapshot);
  }

  return (
    <>
      <StravaCallback />
      <CallbackLocationWitness />
      <CallbackSameRouteProbe />
    </>
  );
}

function renderBrowserStravaCallback(
  entry = '/account/strava/callback?code=synthetic-code&state=synthetic-state',
  seedHistory = true,
  strictMode = false,
  observation?: CallbackRouterObservation,
) {
  if (seedHistory) {
    window.history.replaceState(
      {
        idx: 0,
        key: 'synthetic-callback-entry',
        usr: { privateCallbackState: 'history-state-canary' },
      },
      '',
      entry,
    );
  }

  const router = (
    <BrowserRouter
      future={{
        v7_relativeSplatPath: true,
        v7_startTransition: true,
      }}
    >
      <Routes>
        <Route
          path="/account/strava/callback"
          element={<CallbackRouteHarness observation={observation} />}
        />
        <Route path="/account" element={<CallbackAccountDestination />} />
      </Routes>
    </BrowserRouter>
  );
  return render(strictMode ? <React.StrictMode>{router}</React.StrictMode> : router);
}

function renderStravaCallback(
  entry = '/account/strava/callback?code=synthetic-code&state=synthetic-state',
) {
  return renderBrowserStravaCallback(entry);
}

describe('Strava callback error boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prepareStravaCallbackAppCheck.mockResolvedValue(undefined);
    (useServiceLocator as jest.Mock).mockReturnValue({
      services: { firebaseResources: makeCallbackFirebaseResources() },
      isReady: true,
    });
    (useAuth as jest.Mock).mockReturnValue({
      user: USER,
      isAuthenticated: true,
      isLoading: false,
    });
    (stravaExchangeCode as jest.Mock).mockResolvedValue({
      ok: true,
      athleteId: null,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  describe('current browser history cleanup', () => {
    test('prepares App Check after cleanup and before starting the exchange', async () => {
      const calls: string[] = [];
      let markAppCheckReady: (() => void) | undefined;
      const prepareAppCheckAfterStravaCallbackCleanup = jest.fn(() => {
        calls.push('prepare');
        return new Promise<void>((resolve) => {
          markAppCheckReady = resolve;
        });
      });
      (useServiceLocator as jest.Mock).mockReturnValue({
        services: {
          firebaseResources: {
            app,
            prepareAppCheckAfterStravaCallbackCleanup,
          },
        },
        isReady: true,
      });
      (stravaExchangeCode as jest.Mock).mockImplementationOnce(() => {
        calls.push('exchange');
        return new Promise(() => {
          // Keep the made-up exchange pending after the readiness gate opens.
        });
      });

      renderBrowserStravaCallback();

      await waitFor(() => expect(calls).not.toHaveLength(0));
      expect(calls).toEqual(['prepare']);
      expect(prepareAppCheckAfterStravaCallbackCleanup).toHaveBeenCalledTimes(1);
      expect(prepareAppCheckAfterStravaCallbackCleanup).toHaveBeenCalledWith();
      expect(stravaExchangeCode).not.toHaveBeenCalled();

      await act(async () => {
        markAppCheckReady?.();
        await Promise.resolve();
      });

      await waitFor(() => expect(stravaExchangeCode).toHaveBeenCalledTimes(1));
      expect(calls).toEqual(['prepare', 'exchange']);
      expect(stravaExchangeCode).toHaveBeenCalledWith(
        app,
        'synthetic-code',
        'synthetic-state',
      );
    });

    test.each([
      ['short', 0.5, 'i'],
      ['empty', 0, ''],
    ])('accepts a %s key produced by the pinned BrowserRouter', async (
      _case,
      randomValue,
      nativeKey,
    ) => {
      jest.spyOn(Math, 'random').mockReturnValue(randomValue);
      (stravaExchangeCode as jest.Mock).mockReturnValueOnce(new Promise(() => {
        // Keep the made-up exchange pending on the short-key callback entry.
      }));

      renderBrowserStravaCallback();

      await waitFor(() => expect(stravaExchangeCode).toHaveBeenCalledTimes(1));
      expect(window.history.state).toEqual(expect.objectContaining({
        key: nativeKey,
        usr: null,
      }));
      expect(prepareStravaCallbackAppCheck).toHaveBeenCalledTimes(1);
    });

    test.each([
      [
        'case-changed',
        '/ACCOUNT/STRAVA/CALLBACK?code=variant-code&state=variant-state',
      ],
      [
        'encoded segments',
        '/%61ccount/%73trava/%63allback?code=variant-code&state=variant-state',
      ],
      [
        'trailing slashes',
        '/account/strava/callback///?code=variant-code&state=variant-state',
      ],
    ])('keeps every %s readiness and exchange boundary clean', async (
      _case,
      entry,
    ) => {
      const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const routerObservation: CallbackRouterObservation = { current: null };
      const observations: Array<{
        boundary: string;
        nativePathname: string;
        native: string;
        router: CallbackRouterSnapshot | null;
      }> = [];
      const observe = (boundary: string) => {
        observations.push({
          boundary,
          nativePathname: window.location.pathname,
          native: `${window.location.search}${window.location.hash}`,
          router: routerObservation.current,
        });
      };
      prepareStravaCallbackAppCheck.mockImplementationOnce(async () => {
        observe('prepare');
      });
      (stravaExchangeCode as jest.Mock).mockImplementationOnce(() => {
        observe('exchange');
        return new Promise(() => {
          // Keep the made-up exchange pending after both clean observations.
        });
      });

      renderBrowserStravaCallback(entry, true, false, routerObservation);

      await waitFor(() => expect(stravaExchangeCode).toHaveBeenCalledTimes(1));
      expect(observations.map(({ boundary }) => boundary)).toEqual([
        'prepare',
        'exchange',
      ]);
      observations.forEach(({ nativePathname, native, router }) => {
        expect(native).toBe('');
        expect(router).not.toBeNull();
        expect(router).toMatchObject({ search: '', hash: '', state: null });
        expect(nativePathname).toBe(router?.pathname);
      });
      expect(prepareStravaCallbackAppCheck).toHaveBeenCalledWith();
      expect(stravaExchangeCode).toHaveBeenCalledWith(
        app,
        'variant-code',
        'variant-state',
      );
      expect(consoleWarn).not.toHaveBeenCalled();
    });

    test.each([
      ['synchronous throw', 'throw'],
      ['asynchronous rejection', 'reject'],
    ])('uses one fixed stop for a hostile preparation %s', async (_case, outcome) => {
      const messageGetter = jest.fn(() => {
        throw new Error('app-check-message-getter-canary');
      });
      const rejection = Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      });
      const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
        .map((method) => jest.spyOn(console, method as any).mockImplementation(() => undefined));
      if (outcome === 'throw') {
        prepareStravaCallbackAppCheck.mockImplementationOnce(() => {
          throw rejection;
        });
      } else {
        prepareStravaCallbackAppCheck.mockRejectedValueOnce(rejection);
      }

      renderBrowserStravaCallback();

      expect(await screen.findByRole('alert')).toHaveTextContent(STRAVA_CALLBACK_FAILURE);
      expect(prepareStravaCallbackAppCheck).toHaveBeenCalledTimes(1);
      expect(stravaExchangeCode).not.toHaveBeenCalled();
      expect(messageGetter).not.toHaveBeenCalled();
      expect(document.body).not.toHaveTextContent('app-check-message-getter-canary');
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });

    test('fails closed when the current Firebase resources lack the preparation boundary', async () => {
      (useServiceLocator as jest.Mock).mockReturnValue({
        services: { firebaseResources: { app } },
        isReady: true,
      });

      renderBrowserStravaCallback();

      expect(await screen.findByRole('alert')).toHaveTextContent(STRAVA_CALLBACK_FAILURE);
      expect(stravaExchangeCode).not.toHaveBeenCalled();
    });

    test('cleans native and Router state before hooks or exchange', async () => {
      const routerObservation: CallbackRouterObservation = { current: null };
      const observedLocations: Array<{
        native: string;
        router: CallbackRouterSnapshot | null;
      }> = [];
      const observeLocation = () => {
        observedLocations.push({
          native: `${window.location.search}${window.location.hash}`,
          router: routerObservation.current,
        });
      };
      const observedServices = {
        firebaseResources: {
          app,
          prepareAppCheckAfterStravaCallbackCleanup: jest.fn(async () => {
            observeLocation();
          }),
        },
      };
      (useServiceLocator as jest.Mock).mockImplementation(() => {
        observeLocation();
        return {
          services: observedServices,
          isReady: true,
        };
      });
      (useAuth as jest.Mock).mockImplementation(() => {
        observeLocation();
        return {
          user: USER,
          isAuthenticated: true,
          isLoading: false,
        };
      });
      (stravaExchangeCode as jest.Mock).mockImplementationOnce(() => {
        observeLocation();
        return new Promise(() => {
          // Keep the made-up exchange pending so the clean callback route remains mounted.
        });
      });
      const initialHistoryLength = window.history.length;

      renderBrowserStravaCallback(
        '/account/strava/callback?code=private-code-canary&state=private-state-canary'
        + '#private-fragment-canary',
        true,
        false,
        routerObservation,
      );

      await waitFor(() => expect(stravaExchangeCode).toHaveBeenCalledTimes(1));
      expect(observedLocations).not.toHaveLength(0);
      expect(observedLocations).toEqual(observedLocations.map(() => ({
        native: '',
        router: {
          pathname: '/account/strava/callback',
          search: '',
          hash: '',
          state: null,
        },
      })));
      expect(window.location.pathname).toBe('/account/strava/callback');
      expect(window.location.search).toBe('');
      expect(window.location.hash).toBe('');
      expect(JSON.stringify(window.history.state)).not.toMatch(
        /history-state-canary|private-code-canary|private-state-canary|private-fragment-canary/,
      );
      expect(window.history.length).toBe(initialHistoryLength);
      expect(screen.getByTestId('strava-callback-location')).toHaveAttribute(
        'data-search-clean',
        'true',
      );
      expect(screen.getByTestId('strava-callback-location')).toHaveAttribute(
        'data-hash-clean',
        'true',
      );
      expect(screen.getByTestId('strava-callback-location')).toHaveAttribute(
        'data-state-clean',
        'true',
      );
      expect(stravaExchangeCode).toHaveBeenCalledWith(
        app,
        'private-code-canary',
        'private-state-canary',
      );
      expect(document.body).not.toHaveTextContent(
        /private-code-canary|private-state-canary|private-fragment-canary|history-state-canary/,
      );
    });

    test.each([
      ['Firebase services are not ready', false, false],
      ['authentication is loading', true, true],
    ])('cleans the current entry before waiting when %s', async (_case, isReady, isLoading) => {
      const observedLocations: string[] = [];
      const observedServices = { firebaseResources: makeCallbackFirebaseResources() };
      const observeLocation = () => {
        observedLocations.push(`${window.location.search}${window.location.hash}`);
      };
      (useServiceLocator as jest.Mock).mockImplementation(() => {
        observeLocation();
        return {
          services: isReady ? observedServices : null,
          isReady,
        };
      });
      (useAuth as jest.Mock).mockImplementation(() => {
        observeLocation();
        return {
          user: USER,
          isAuthenticated: true,
          isLoading,
        };
      });

      renderBrowserStravaCallback(
        '/account/strava/callback?code=waiting-code-canary&state=waiting-state-canary'
        + '#waiting-fragment-canary',
      );

      await waitFor(() => expect(window.location.search).toBe(''));
      expect(window.location.hash).toBe('');
      expect(observedLocations).not.toHaveLength(0);
      expect(observedLocations).toEqual(observedLocations.map(() => ''));
      expect(screen.getByText('Connecting your Strava...')).toBeInTheDocument();
      expect(stravaExchangeCode).not.toHaveBeenCalled();
      expect(document.body).not.toHaveTextContent(/waiting-.*-canary/);
    });

    test('fails closed before hooks or exchange when the current entry cannot be replaced', async () => {
      window.history.replaceState(
        {
          idx: 0,
          key: 'synthetic-failure-entry',
          usr: { privateCallbackState: 'history-failure-state-canary' },
        },
        '',
        '/account/strava/callback?code=history-failure-code-canary'
        + '&state=history-failure-state-canary#history-failure-fragment-canary',
      );
      jest.spyOn(window.history, 'replaceState').mockImplementation(() => {
        throw new Error('history-replace-private-canary');
      });
      (stravaExchangeCode as jest.Mock).mockReturnValueOnce(new Promise(() => {
        // The old source reaches this promise; the fixed source must not.
      }));

      renderBrowserStravaCallback(undefined, false);

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(STRAVA_CALLBACK_FAILURE);
      expect(alert).toHaveAttribute('aria-live', 'assertive');
      expect(alert).toHaveAttribute('aria-atomic', 'true');
      expect(useServiceLocator).not.toHaveBeenCalled();
      expect(useAuth).not.toHaveBeenCalled();
      expect(stravaExchangeCode).not.toHaveBeenCalled();
      expect(document.body).not.toHaveTextContent(/history-.*-canary/);
    });

    test('fails closed when native replacement returns without cleaning the address', async () => {
      window.history.replaceState(
        {
          idx: 0,
          key: 'synthetic-noop-entry',
          usr: { privateCallbackState: 'history-noop-state-canary' },
        },
        '',
        '/account/strava/callback?code=history-noop-code-canary'
        + '&state=history-noop-state-canary#history-noop-fragment-canary',
      );
      jest.spyOn(window.history, 'replaceState').mockImplementation(() => undefined);

      renderBrowserStravaCallback(undefined, false);

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(STRAVA_CALLBACK_FAILURE);
      expect(useServiceLocator).not.toHaveBeenCalled();
      expect(useAuth).not.toHaveBeenCalled();
      expect(stravaExchangeCode).not.toHaveBeenCalled();
      expect(document.body).not.toHaveTextContent(/history-noop-.*-canary/);
    });

    test.each([
      ['another path', '/silent-path-divergence'],
      ['an equivalent case-changed path', '/ACCOUNT/STRAVA/CALLBACK'],
    ])('fails closed when native replacement silently changes to %s', async (
      _case,
      divergentPath,
    ) => {
      const routerObservation: CallbackRouterObservation = {
        current: null,
        onLocation: (location) => {
          if (
            location.search === ''
            && location.hash === ''
            && location.state === null
            && window.location.pathname === '/account/strava/callback'
          ) {
            window.history.replaceState(
              window.history.state,
              '',
              divergentPath,
            );
          }
        },
      };

      renderBrowserStravaCallback(
        '/account/strava/callback?code=history-divergent-code-canary'
        + '&state=history-divergent-state-canary#history-divergent-fragment-canary',
        true,
        false,
        routerObservation,
      );

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(STRAVA_CALLBACK_FAILURE);
      expect(window.location.pathname).toBe(divergentPath);
      expect(useServiceLocator).not.toHaveBeenCalled();
      expect(useAuth).not.toHaveBeenCalled();
      expect(stravaExchangeCode).not.toHaveBeenCalled();
      expect(document.body).not.toHaveTextContent(/history-divergent-.*-canary/);
    });

    test('rejects a later same-route callback without reusing either capability', async () => {
      (stravaExchangeCode as jest.Mock).mockReturnValue(new Promise(() => {
        // Keep the first made-up exchange pending while the route changes.
      }));
      renderBrowserStravaCallback();
      await waitFor(() => expect(stravaExchangeCode).toHaveBeenCalledTimes(1));

      fireEvent.click(screen.getByRole('button', { name: 'Load another callback' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(STRAVA_CALLBACK_FAILURE);
      expect(window.location.search).toBe('');
      expect(window.location.hash).toBe('');
      expect(stravaExchangeCode).toHaveBeenCalledTimes(1);
      expect(document.body).not.toHaveTextContent(
        /second-code-canary|second-state-canary|second-fragment-canary/,
      );
    });

    test('makes one exchange across StrictMode replay and ordinary rerenders', async () => {
      let finishExchange: (() => void) | undefined;
      (stravaExchangeCode as jest.Mock).mockReturnValueOnce(new Promise((resolve) => {
        finishExchange = () => resolve({ ok: true, athleteId: null });
      }));
      const page = renderBrowserStravaCallback(undefined, true, true);

      await waitFor(() => expect(stravaExchangeCode).toHaveBeenCalledTimes(1));
      expect(prepareStravaCallbackAppCheck).toHaveBeenCalledTimes(1);
      page.rerender(
        <React.StrictMode>
          <BrowserRouter
            future={{
              v7_relativeSplatPath: true,
              v7_startTransition: true,
            }}
          >
            <Routes>
              <Route path="/account/strava/callback" element={<CallbackRouteHarness />} />
              <Route path="/account" element={<CallbackAccountDestination />} />
            </Routes>
          </BrowserRouter>
        </React.StrictMode>,
      );

      expect(stravaExchangeCode).toHaveBeenCalledTimes(1);
      expect(prepareStravaCallbackAppCheck).toHaveBeenCalledTimes(1);
      await act(async () => {
        finishExchange?.();
        await Promise.resolve();
      });
      expect(await screen.findByText('Account destination')).toBeInTheDocument();
      expect(screen.getByTestId('callback-navigation-type')).toHaveTextContent('REPLACE');
    });

    test.each([
      ['signed-in UID'],
      ['service identity'],
      ['Firebase resources'],
      ['Firebase app'],
    ])('discards App Check readiness after a %s change', async (changedContext) => {
      const readiness = accountDeferred<void>();
      prepareStravaCallbackAppCheck.mockReturnValueOnce(readiness.promise);
      let firstFirebaseResources = makeCallbackFirebaseResources();
      const firstServices = { firebaseResources: firstFirebaseResources };
      let nextUser = USER;
      let nextServices = firstServices;
      (useServiceLocator as jest.Mock).mockImplementation(() => ({
        services: nextServices,
        isReady: true,
      }));
      (useAuth as jest.Mock).mockImplementation(() => ({
        user: nextUser,
        isAuthenticated: true,
        isLoading: false,
      }));
      const page = renderBrowserStravaCallback();
      await waitFor(() => expect(prepareStravaCallbackAppCheck).toHaveBeenCalledTimes(1));
      expect(stravaExchangeCode).not.toHaveBeenCalled();

      if (changedContext === 'signed-in UID') {
        nextUser = { ...USER, uid: 'second-synthetic-user' };
      } else if (changedContext === 'service identity') {
        nextServices = { firebaseResources: firstFirebaseResources };
      } else if (changedContext === 'Firebase resources') {
        firstFirebaseResources = makeCallbackFirebaseResources();
        firstServices.firebaseResources = firstFirebaseResources;
      } else {
        firstFirebaseResources.app = { name: 'second-synthetic-app' };
      }

      page.rerender(
        <BrowserRouter
          future={{
            v7_relativeSplatPath: true,
            v7_startTransition: true,
          }}
        >
          <Routes>
            <Route path="/account/strava/callback" element={<CallbackRouteHarness />} />
            <Route path="/account" element={<CallbackAccountDestination />} />
          </Routes>
        </BrowserRouter>,
      );

      expect(await screen.findByRole('alert')).toHaveTextContent(STRAVA_CALLBACK_FAILURE);
      await act(async () => {
        readiness.resolve();
        await Promise.resolve();
      });
      expect(stravaExchangeCode).not.toHaveBeenCalled();
      expect(prepareStravaCallbackAppCheck).toHaveBeenCalledTimes(1);
    });

    test.each([
      ['a later callback', 'Load another callback'],
      ['non-null Router state', 'Inject callback Router state'],
      ['a replacement Router entry', 'Replace clean callback entry'],
    ])('makes readiness inert after reinjection of %s', async (_case, buttonName) => {
      const readiness = accountDeferred<void>();
      prepareStravaCallbackAppCheck.mockReturnValueOnce(readiness.promise);
      renderBrowserStravaCallback();
      await waitFor(() => expect(prepareStravaCallbackAppCheck).toHaveBeenCalledTimes(1));

      fireEvent.click(screen.getByRole('button', { name: buttonName }));

      expect(await screen.findByRole('alert')).toHaveTextContent(STRAVA_CALLBACK_FAILURE);
      await act(async () => {
        readiness.resolve();
        await Promise.resolve();
      });
      expect(stravaExchangeCode).not.toHaveBeenCalled();
      expect(document.body).not.toHaveTextContent(/second-.*-canary/);
    });

    test('blocks native Router state before a transition render commits', async () => {
      const readiness = accountDeferred<void>();
      prepareStravaCallbackAppCheck.mockReturnValueOnce(readiness.promise);
      renderBrowserStravaCallback();
      await waitFor(() => expect(prepareStravaCallbackAppCheck).toHaveBeenCalledTimes(1));

      window.history.replaceState(
        {
          idx: 0,
          key: 'silent-router-state-entry',
          usr: { privateRouterState: 'silent-router-state-canary' },
        },
        '',
        '/account/strava/callback',
      );
      await act(async () => {
        readiness.resolve();
        await Promise.resolve();
      });

      expect(await screen.findByRole('alert')).toHaveTextContent(STRAVA_CALLBACK_FAILURE);
      expect(stravaExchangeCode).not.toHaveBeenCalled();
      expect(document.body).not.toHaveTextContent('silent-router-state-canary');
    });

    test('blocks extra native history detail injected before preparation', async () => {
      let injected = false;
      const routerObservation: CallbackRouterObservation = {
        current: null,
        onLocation: (location) => {
          if (
            !injected
            && location.search === ''
            && location.hash === ''
            && location.state === null
          ) {
            injected = true;
            const nativeState = window.history.state as {
              idx: number;
              key: string;
              usr: null;
            };
            window.history.replaceState(
              {
                ...nativeState,
                code: 'preparation-saved-code-canary',
              },
              '',
              window.location.pathname,
            );
          }
        },
      };

      renderBrowserStravaCallback(undefined, true, false, routerObservation);

      expect(await screen.findByRole('alert')).toHaveTextContent(STRAVA_CALLBACK_FAILURE);
      expect(injected).toBe(true);
      expect(prepareStravaCallbackAppCheck).not.toHaveBeenCalled();
      expect(stravaExchangeCode).not.toHaveBeenCalled();
      expect(document.body).not.toHaveTextContent('preparation-saved-code-canary');
    });

    test.each([
      ['extra saved detail'],
      ['a mismatched Router key'],
    ])('blocks native history with %s after readiness', async (historyCase) => {
      const readiness = accountDeferred<void>();
      prepareStravaCallbackAppCheck.mockReturnValueOnce(readiness.promise);
      renderBrowserStravaCallback();
      await waitFor(() => expect(prepareStravaCallbackAppCheck).toHaveBeenCalledTimes(1));
      const cleanState = window.history.state as {
        idx: number;
        key: string;
        usr: null;
      };
      const changedState = historyCase === 'extra saved detail'
        ? { ...cleanState, state: 'readiness-saved-state-canary' }
        : { ...cleanState, key: 'different-router-key' };

      window.history.replaceState(changedState, '', '/account/strava/callback');
      await act(async () => {
        readiness.resolve();
        await Promise.resolve();
      });

      expect(await screen.findByRole('alert')).toHaveTextContent(STRAVA_CALLBACK_FAILURE);
      expect(stravaExchangeCode).not.toHaveBeenCalled();
      expect(document.body).not.toHaveTextContent('readiness-saved-state-canary');
    });

    test('rechecks the native address after readiness without relying on a Router render', async () => {
      const readiness = accountDeferred<void>();
      prepareStravaCallbackAppCheck.mockReturnValueOnce(readiness.promise);
      renderBrowserStravaCallback();
      await waitFor(() => expect(prepareStravaCallbackAppCheck).toHaveBeenCalledTimes(1));

      window.history.replaceState(
        window.history.state,
        '',
        '/silent-readiness-divergence?private=native-readiness-canary',
      );
      await act(async () => {
        readiness.resolve();
        await Promise.resolve();
      });

      expect(await screen.findByRole('alert')).toHaveTextContent(STRAVA_CALLBACK_FAILURE);
      expect(stravaExchangeCode).not.toHaveBeenCalled();
      expect(document.body).not.toHaveTextContent('native-readiness-canary');
    });

    test('makes pending App Check readiness inert after unmount without logging', async () => {
      const readiness = accountDeferred<void>();
      const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
        .map((method) => jest.spyOn(console, method as any).mockImplementation(() => undefined));
      prepareStravaCallbackAppCheck.mockReturnValueOnce(readiness.promise);
      const page = renderBrowserStravaCallback();
      await waitFor(() => expect(prepareStravaCallbackAppCheck).toHaveBeenCalledTimes(1));
      page.unmount();

      await act(async () => {
        readiness.resolve();
        await Promise.resolve();
      });

      expect(stravaExchangeCode).not.toHaveBeenCalled();
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });

    test('keeps App Check readiness invalid after the account changes away and back', async () => {
      const readiness = accountDeferred<void>();
      const firstServices = { firebaseResources: makeCallbackFirebaseResources() };
      let nextUser = USER;
      (useServiceLocator as jest.Mock).mockReturnValue({
        services: firstServices,
        isReady: true,
      });
      (useAuth as jest.Mock).mockImplementation(() => ({
        user: nextUser,
        isAuthenticated: true,
        isLoading: false,
      }));
      prepareStravaCallbackAppCheck.mockReturnValueOnce(readiness.promise);
      const page = renderBrowserStravaCallback();
      await waitFor(() => expect(prepareStravaCallbackAppCheck).toHaveBeenCalledTimes(1));

      nextUser = { ...USER, uid: 'second-synthetic-user' };
      page.rerender(
        <BrowserRouter
          future={{
            v7_relativeSplatPath: true,
            v7_startTransition: true,
          }}
        >
          <Routes>
            <Route path="/account/strava/callback" element={<CallbackRouteHarness />} />
            <Route path="/account" element={<CallbackAccountDestination />} />
          </Routes>
        </BrowserRouter>,
      );
      expect(await screen.findByRole('alert')).toHaveTextContent(STRAVA_CALLBACK_FAILURE);

      nextUser = USER;
      page.rerender(
        <BrowserRouter
          future={{
            v7_relativeSplatPath: true,
            v7_startTransition: true,
          }}
        >
          <Routes>
            <Route path="/account/strava/callback" element={<CallbackRouteHarness />} />
            <Route path="/account" element={<CallbackAccountDestination />} />
          </Routes>
        </BrowserRouter>,
      );
      await act(async () => {
        readiness.resolve();
        await Promise.resolve();
      });

      expect(screen.getByRole('alert')).toHaveTextContent(STRAVA_CALLBACK_FAILURE);
      expect(stravaExchangeCode).not.toHaveBeenCalled();
      expect(prepareStravaCallbackAppCheck).toHaveBeenCalledTimes(1);
    });

    test.each([
      ['signed-in UID', 'resolve'],
      ['service identity', 'reject'],
      ['Firebase app', 'resolve'],
    ])('discards a pending result after a %s change when it would %s', async (
      changedContext,
      outcome,
    ) => {
      let settleExchange: (() => void) | undefined;
      const firstFirebaseResources = makeCallbackFirebaseResources();
      const firstServices = { firebaseResources: firstFirebaseResources };
      (useServiceLocator as jest.Mock).mockReturnValue({
        services: firstServices,
        isReady: true,
      });
      (useAuth as jest.Mock).mockReturnValue({
        user: USER,
        isAuthenticated: true,
        isLoading: false,
      });
      (stravaExchangeCode as jest.Mock).mockReturnValueOnce(new Promise((resolve, reject) => {
        settleExchange = outcome === 'resolve'
          ? () => resolve({ ok: true, athleteId: null })
          : () => reject(Object.defineProperty({}, 'message', {
            get() {
              throw new Error('obsolete-context-private-canary');
            },
          }));
      }));
      const page = renderBrowserStravaCallback();
      await waitFor(() => expect(stravaExchangeCode).toHaveBeenCalledTimes(1));

      let nextUser = USER;
      let nextServices = firstServices;
      if (changedContext === 'signed-in UID') {
        nextUser = { ...USER, uid: 'second-synthetic-user' };
      } else if (changedContext === 'service identity') {
        nextServices = { firebaseResources: firstFirebaseResources };
      } else {
        nextServices = {
          firebaseResources: makeCallbackFirebaseResources({ name: 'second-synthetic-app' }),
        };
      }
      (useServiceLocator as jest.Mock).mockReturnValue({
        services: nextServices,
        isReady: true,
      });
      (useAuth as jest.Mock).mockReturnValue({
        user: nextUser,
        isAuthenticated: true,
        isLoading: false,
      });
      page.rerender(
        <BrowserRouter
          future={{
            v7_relativeSplatPath: true,
            v7_startTransition: true,
          }}
        >
          <Routes>
            <Route path="/account/strava/callback" element={<CallbackRouteHarness />} />
            <Route path="/account" element={<CallbackAccountDestination />} />
          </Routes>
        </BrowserRouter>,
      );

      expect(await screen.findByRole('alert')).toHaveTextContent(STRAVA_CALLBACK_FAILURE);
      expect(stravaExchangeCode).toHaveBeenCalledTimes(1);
      await act(async () => {
        settleExchange?.();
        await Promise.resolve();
      });
      expect(screen.queryByText('Account destination')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(STRAVA_CALLBACK_FAILURE);
      expect(document.body).not.toHaveTextContent('obsolete-context-private-canary');
      expect(stravaExchangeCode).toHaveBeenCalledTimes(1);
    });

    test('keeps a pending attempt invalid after the account changes away and back', async () => {
      let finishExchange: (() => void) | undefined;
      const firstServices = { firebaseResources: makeCallbackFirebaseResources() };
      (useServiceLocator as jest.Mock).mockReturnValue({
        services: firstServices,
        isReady: true,
      });
      (useAuth as jest.Mock).mockReturnValue({
        user: USER,
        isAuthenticated: true,
        isLoading: false,
      });
      (stravaExchangeCode as jest.Mock).mockReturnValueOnce(new Promise((resolve) => {
        finishExchange = () => resolve({ ok: true, athleteId: null });
      }));
      const page = renderBrowserStravaCallback();
      await waitFor(() => expect(stravaExchangeCode).toHaveBeenCalledTimes(1));

      (useAuth as jest.Mock).mockReturnValue({
        user: { ...USER, uid: 'second-synthetic-user' },
        isAuthenticated: true,
        isLoading: false,
      });
      page.rerender(
        <BrowserRouter
          future={{
            v7_relativeSplatPath: true,
            v7_startTransition: true,
          }}
        >
          <Routes>
            <Route path="/account/strava/callback" element={<CallbackRouteHarness />} />
            <Route path="/account" element={<CallbackAccountDestination />} />
          </Routes>
        </BrowserRouter>,
      );
      expect(await screen.findByRole('alert')).toHaveTextContent(STRAVA_CALLBACK_FAILURE);

      (useAuth as jest.Mock).mockReturnValue({
        user: USER,
        isAuthenticated: true,
        isLoading: false,
      });
      page.rerender(
        <BrowserRouter
          future={{
            v7_relativeSplatPath: true,
            v7_startTransition: true,
          }}
        >
          <Routes>
            <Route path="/account/strava/callback" element={<CallbackRouteHarness />} />
            <Route path="/account" element={<CallbackAccountDestination />} />
          </Routes>
        </BrowserRouter>,
      );

      await act(async () => {
        finishExchange?.();
        await Promise.resolve();
      });
      expect(screen.queryByText('Account destination')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(STRAVA_CALLBACK_FAILURE);
      expect(stravaExchangeCode).toHaveBeenCalledTimes(1);
    });

    test('makes a pending result inert after unmount without logging', async () => {
      let finishExchange: (() => void) | undefined;
      const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
        .map((method) => jest.spyOn(console, method as any).mockImplementation(() => undefined));
      (stravaExchangeCode as jest.Mock).mockReturnValueOnce(new Promise((resolve) => {
        finishExchange = () => resolve({ ok: true, athleteId: null });
      }));
      const page = renderBrowserStravaCallback();
      await waitFor(() => expect(stravaExchangeCode).toHaveBeenCalledTimes(1));
      page.unmount();

      await act(async () => {
        finishExchange?.();
        await Promise.resolve();
      });

      expect(document.body).not.toHaveTextContent('Account destination');
      expect(stravaExchangeCode).toHaveBeenCalledTimes(1);
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });
  });

  test.each([
    ['Firebase services are not ready', false, false],
    ['authentication is loading', true, true],
  ])('waits without callback work when %s', async (_case, isReady, isLoading) => {
    (useServiceLocator as jest.Mock).mockReturnValue({
      services: isReady ? { firebaseResources: makeCallbackFirebaseResources() } : null,
      isReady,
    });
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      isLoading,
    });

    renderStravaCallback();

    expect(await screen.findByText('Connecting your Strava...')).toBeInTheDocument();
    expect(prepareStravaCallbackAppCheck).not.toHaveBeenCalled();
    expect(stravaExchangeCode).not.toHaveBeenCalled();
  });

  test('requires sign-in before exposing or acting on query failure details', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });

    renderStravaCallback(
      '/account/strava/callback?error=signed-out-provider-canary&code=hidden-code&state=hidden-state',
    );

    expect(await screen.findByText('You need to be signed in to connect Strava.'))
      .toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/signed-out-provider-canary|hidden-code|hidden-state/);
    expect(prepareStravaCallbackAppCheck).not.toHaveBeenCalled();
    expect(stravaExchangeCode).not.toHaveBeenCalled();
  });

  test('replaces a provider query error with one fixed actionable alert', async () => {
    renderStravaCallback(
      '/account/strava/callback?error=provider%3Aprivate-query-canary&code=hidden-code&state=hidden-state',
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(STRAVA_CALLBACK_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(document.body).not.toHaveTextContent(/private-query-canary|hidden-code|hidden-state/);
    expect(stravaExchangeCode).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Back to account' }))
      .toHaveAttribute('href', '/account');
    expect(prepareStravaCallbackAppCheck).not.toHaveBeenCalled();
  });

  test('stops a missing code before exchange', async () => {
    renderStravaCallback('/account/strava/callback?state=synthetic-state');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Missing authorization code from Strava.',
    );
    expect(prepareStravaCallbackAppCheck).not.toHaveBeenCalled();
    expect(stravaExchangeCode).not.toHaveBeenCalled();
  });

  test.each([
    ['missing', '/account/strava/callback?code=synthetic-code'],
    ['empty', '/account/strava/callback?code=synthetic-code&state='],
  ])('stops a %s captured state before exchange', async (_case, entry) => {
    renderStravaCallback(entry);

    expect(await screen.findByRole('alert')).toHaveTextContent(STRAVA_CALLBACK_FAILURE);
    expect(prepareStravaCallbackAppCheck).not.toHaveBeenCalled();
    expect(stravaExchangeCode).not.toHaveBeenCalled();
  });

  test('sends captured state in one exact exchange and replaces the account route', async () => {
    const calls: string[] = [];
    (stravaExchangeCode as jest.Mock).mockImplementation(async () => {
      calls.push('exchange');
      return { ok: true, athleteId: null };
    });

    renderStravaCallback();

    expect(await screen.findByText('Account destination')).toBeInTheDocument();
    expect(calls).toEqual(['exchange']);
    expect(stravaExchangeCode).toHaveBeenCalledWith(
      app,
      'synthetic-code',
      'synthetic-state',
    );
    expect(stravaExchangeCode).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('callback-navigation-type')).toHaveTextContent('REPLACE');
  });

  test('does not navigate while the exchange result is pending', async () => {
    (stravaExchangeCode as jest.Mock).mockReturnValue(new Promise(() => {
      // Keep this synthetic exchange pending until the test unmounts the page.
    }));

    renderStravaCallback();

    await waitFor(() => expect(stravaExchangeCode).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Connecting your Strava...')).toBeInTheDocument();
    expect(screen.queryByText('Account destination')).not.toBeInTheDocument();
  });

  test.each([
    ['ordinary error', () => new Error('ordinary-provider-canary')],
    ['hostile message getter', () => Object.defineProperty({}, 'message', {
      configurable: true,
      get() {
        throw new Error('message-getter-canary');
      },
    })],
  ])('does not inspect or render an %s rejection', async (_case, makeRejection) => {
    const consoleSpies = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
    (stravaExchangeCode as jest.Mock).mockRejectedValueOnce(makeRejection());

    renderStravaCallback();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(STRAVA_CALLBACK_FAILURE);
    expect(document.body).not.toHaveTextContent(/ordinary-provider-canary|message-getter-canary/);
    expect(screen.queryByText('Account destination')).not.toBeInTheDocument();
    expect(stravaExchangeCode).toHaveBeenCalledTimes(1);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });
});
