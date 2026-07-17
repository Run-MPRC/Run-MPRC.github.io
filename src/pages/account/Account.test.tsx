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
});

const STRAVA_ACTIVITY_FAILURE = 'We could not load your Strava activity right now. Please try again later.';

function renderActualStravaSection() {
  return render(<ActualStravaSection uid={USER.uid} />);
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
    <button
      type="button"
      onClick={() => navigate(
        '/account/strava/callback?code=second-code-canary&state=second-state-canary'
        + '#second-fragment-canary',
      )}
    >
      Load another callback
    </button>
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
  window.history.replaceState(null, '', '/account/strava/callback');
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
      user: USER,
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
    window.history.replaceState(null, '', '/');
  });

  describe('current browser history cleanup', () => {
    test('cleans native and Router state before hooks, state verification, or exchange', async () => {
      const routerObservation: CallbackRouterObservation = { current: null };
      const observedLocations: Array<{
        native: string;
        router: CallbackRouterSnapshot | null;
      }> = [];
      const observedServices = { firebaseResources: { app } };
      const observeLocation = () => {
        observedLocations.push({
          native: `${window.location.search}${window.location.hash}`,
          router: routerObservation.current,
        });
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
      (verifyStravaState as jest.Mock).mockImplementation(() => {
        observeLocation();
        return true;
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
        router: { search: '', hash: '', state: null },
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
      expect(verifyStravaState).toHaveBeenCalledWith('private-state-canary');
      expect(stravaExchangeCode).toHaveBeenCalledWith(app, 'private-code-canary');
      expect(document.body).not.toHaveTextContent(
        /private-code-canary|private-state-canary|private-fragment-canary|history-state-canary/,
      );
    });

    test.each([
      ['Firebase services are not ready', false, false],
      ['authentication is loading', true, true],
    ])('cleans the current entry before waiting when %s', async (_case, isReady, isLoading) => {
      const observedLocations: string[] = [];
      const observedServices = { firebaseResources: { app } };
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
      expect(verifyStravaState).not.toHaveBeenCalled();
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
      expect(verifyStravaState).not.toHaveBeenCalled();
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
      expect(verifyStravaState).not.toHaveBeenCalled();
      expect(stravaExchangeCode).not.toHaveBeenCalled();
      expect(document.body).not.toHaveTextContent(/history-noop-.*-canary/);
    });

    test('fails closed when native replacement silently changes to another path', async () => {
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
              '/silent-path-divergence',
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
      expect(window.location.pathname).toBe('/silent-path-divergence');
      expect(useServiceLocator).not.toHaveBeenCalled();
      expect(useAuth).not.toHaveBeenCalled();
      expect(verifyStravaState).not.toHaveBeenCalled();
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
      expect(verifyStravaState).toHaveBeenCalledTimes(1);
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

      expect(verifyStravaState).toHaveBeenCalledTimes(1);
      expect(stravaExchangeCode).toHaveBeenCalledTimes(1);
      await act(async () => {
        finishExchange?.();
        await Promise.resolve();
      });
      expect(await screen.findByText('Account destination')).toBeInTheDocument();
      expect(screen.getByTestId('callback-navigation-type')).toHaveTextContent('REPLACE');
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
      const firstFirebaseResources = { app };
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
          firebaseResources: { app: { name: 'second-synthetic-app' } },
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
      expect(verifyStravaState).toHaveBeenCalledTimes(1);
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
      const firstServices = { firebaseResources: { app } };
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
      expect(verifyStravaState).toHaveBeenCalledTimes(1);
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
