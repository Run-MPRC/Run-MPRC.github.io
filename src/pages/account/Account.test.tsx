/* eslint-env jest */

import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  act, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import {
  ensureMyProfile,
  getMyProfile,
  listMyRegistrations,
  updateMyProfile,
} from '../../services/account/accountService';
import { AccountContent } from './Account';

jest.mock('../../services/ServiceLocatorContext', () => ({
  useServiceLocator: jest.fn(),
}));

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
