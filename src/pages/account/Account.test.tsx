/* eslint-env jest */

import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  act, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import {
  MemoryRouter, Route, Routes, useNavigationType,
} from 'react-router-dom';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import { useAuth } from '../../services/hooks/useAuth';
import {
  ensureMyProfile,
  getMyProfile,
  listMyRegistrations,
  updateMyProfile,
} from '../../services/account/accountService';
import {
  getStravaConnection,
  stravaDisconnect,
  stravaExchangeCode,
  stravaFetchStats,
  verifyStravaState,
} from '../../services/strava/stravaService';
import { AccountContent } from './Account';
import StravaCallback from './StravaCallback';

jest.mock('../../services/ServiceLocatorContext', () => ({
  useServiceLocator: jest.fn(),
}));

jest.mock('../../services/hooks/useAuth', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../services/strava/stravaService', () => {
  const actual = jest.requireActual('../../services/strava/stravaService');
  return {
    ...actual,
    getStravaConnection: jest.fn(),
    stravaDisconnect: jest.fn(),
    stravaExchangeCode: jest.fn(),
    stravaFetchStats: jest.fn(),
    verifyStravaState: jest.fn(),
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

jest.mock('./StravaSection', () => function StravaSection() {
  return <div data-testid="strava-section" />;
});

const ActualStravaSection = jest.requireActual('./StravaSection').default;

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
      <AccountContent user={user} />
    </MemoryRouter>
  );
}

function renderAccount(user = USER) {
  return render(accountView(user));
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
    expect(await screen.findByText('The request was accepted. Delivery can take time. Check Inbox and Spam.'))
      .toBeInTheDocument();
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
});

const STRAVA_ACTIVITY_FAILURE = 'We could not load your Strava activity right now. Please try again later.';

function renderActualStravaSection() {
  return render(<ActualStravaSection uid={USER.uid} />);
}

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

function CallbackAccountDestination() {
  const navigationType = useNavigationType();

  return (
    <div>
      Account destination
      <span data-testid="callback-navigation-type">{navigationType}</span>
    </div>
  );
}

function renderStravaCallback(
  entry = '/account/strava/callback?code=synthetic-code&state=synthetic-state',
) {
  return render(
    <MemoryRouter
      initialEntries={[entry]}
      future={{
        v7_relativeSplatPath: true,
        v7_startTransition: true,
      }}
    >
      <Routes>
        <Route path="/account/strava/callback" element={<StravaCallback />} />
        <Route path="/account" element={<CallbackAccountDestination />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Strava callback error boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useServiceLocator as jest.Mock).mockReturnValue({
      services: { firebaseResources: { app } },
      isReady: true,
    });
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    (verifyStravaState as jest.Mock).mockReturnValue(true);
    (stravaExchangeCode as jest.Mock).mockResolvedValue({
      ok: true,
      athleteId: null,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    ['Firebase services are not ready', false, false],
    ['authentication is loading', true, true],
  ])('waits without callback work when %s', async (_case, isReady, isLoading) => {
    (useServiceLocator as jest.Mock).mockReturnValue({
      services: isReady ? { firebaseResources: { app } } : null,
      isReady,
    });
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      isLoading,
    });

    renderStravaCallback();

    expect(await screen.findByText('Connecting your Strava...')).toBeInTheDocument();
    expect(verifyStravaState).not.toHaveBeenCalled();
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
    expect(verifyStravaState).not.toHaveBeenCalled();
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
    expect(verifyStravaState).not.toHaveBeenCalled();
    expect(stravaExchangeCode).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Back to account' }))
      .toHaveAttribute('href', '/account');
  });

  test('stops a missing code before state verification or exchange', async () => {
    renderStravaCallback('/account/strava/callback?state=synthetic-state');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Missing authorization code from Strava.',
    );
    expect(verifyStravaState).not.toHaveBeenCalled();
    expect(stravaExchangeCode).not.toHaveBeenCalled();
  });

  test('stops an invalid state before exchange', async () => {
    (verifyStravaState as jest.Mock).mockReturnValue(false);

    renderStravaCallback();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Security check failed (state mismatch). Please try connecting again.',
    );
    expect(verifyStravaState).toHaveBeenCalledTimes(1);
    expect(verifyStravaState).toHaveBeenCalledWith('synthetic-state');
    expect(stravaExchangeCode).not.toHaveBeenCalled();
  });

  test('verifies state before one exact exchange and replaces the account route on success', async () => {
    const calls: string[] = [];
    (verifyStravaState as jest.Mock).mockImplementation(() => {
      calls.push('verify');
      return true;
    });
    (stravaExchangeCode as jest.Mock).mockImplementation(async () => {
      calls.push('exchange');
      return { ok: true, athleteId: null };
    });

    renderStravaCallback();

    expect(await screen.findByText('Account destination')).toBeInTheDocument();
    expect(calls).toEqual(['verify', 'exchange']);
    expect(verifyStravaState).toHaveBeenCalledWith('synthetic-state');
    expect(stravaExchangeCode).toHaveBeenCalledWith(app, 'synthetic-code');
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
    expect(verifyStravaState).toHaveBeenCalledTimes(1);
    expect(stravaExchangeCode).toHaveBeenCalledTimes(1);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });
});
