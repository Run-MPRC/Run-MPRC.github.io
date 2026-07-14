/* eslint-env jest */
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  act, fireEvent, render, screen,
} from '@testing-library/react';
import {
  BrowserRouter, MemoryRouter, Route, Routes, useLocation, useNavigate,
} from 'react-router-dom';
import VerifyEmailAction from './VerifyEmailAction';
import { useServiceLocator } from '../../services/ServiceLocatorContext';

jest.mock('../../services/ServiceLocatorContext', () => ({
  useServiceLocator: jest.fn(),
}));

jest.mock('../../components/Header', () => function Header({ title }: { title: string }) {
  return <div>{title}</div>;
});

jest.mock('../../components/SEO', () => function SEO() {
  return null;
});

const mockUseServiceLocator = useServiceLocator as jest.MockedFunction<
  typeof useServiceLocator
>;
const verifyEmailAction = jest.fn();

function RouterLocationWitness() {
  const currentLocation = useLocation();
  return (
    <span
      hidden
      data-testid="router-location"
      data-search-clean={String(currentLocation.search === '')}
      data-hash-clean={String(currentLocation.hash === '')}
      data-state-clean={String(currentLocation.state === null)}
    />
  );
}

function SameRouteNavigationProbe() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(
        '/auth/action?mode=verifyEmail&oobCode=second-synthetic-code#second-fragment',
      )}
    >
      Load another private action
    </button>
  );
}

function setReadyServices() {
  mockUseServiceLocator.mockReturnValue({
    isReady: true,
    services: {
      identityService: { verifyEmailAction },
    },
  } as unknown as ReturnType<typeof useServiceLocator>);
}

function renderAction(
  target = '/auth/action?mode=verifyEmail&oobCode=synthetic-action-code',
) {
  window.history.replaceState(null, '', target);
  return render(
    <BrowserRouter
      future={{
        v7_relativeSplatPath: true,
        v7_startTransition: true,
      }}
    >
      <Routes>
        <Route
          path="/auth/action"
          element={(
            <>
              <VerifyEmailAction />
              <RouterLocationWitness />
              <SameRouteNavigationProbe />
            </>
          )}
        />
        <Route path="/account" element={<div>Fixed account destination</div>} />
      </Routes>
    </BrowserRouter>,
  );
}

describe('VerifyEmailAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setReadyServices();
    verifyEmailAction.mockResolvedValue('verified');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  test('scrubs the capability before showing a deliberate action and makes no load-time call', () => {
    const token = 'private-action-code-canary';
    const fragment = 'private-fragment-canary';
    renderAction(`/auth/action?mode=verifyEmail&oobCode=${token}#${fragment}`);

    expect(window.location.pathname).toBe('/auth/action');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
    expect(window.history.state).not.toEqual(expect.objectContaining({ token }));
    expect(screen.getByTestId('router-location')).toHaveAttribute(
      'data-search-clean',
      'true',
    );
    expect(screen.getByTestId('router-location')).toHaveAttribute(
      'data-hash-clean',
      'true',
    );
    expect(screen.getByTestId('router-location')).toHaveAttribute(
      'data-state-clean',
      'true',
    );
    expect(verifyEmailAction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Verify email' })).toBeEnabled();
    expect(document.body).not.toHaveTextContent(token);
    expect(document.body).not.toHaveTextContent(fragment);
  });

  test('checks one code only after deliberate keyboard-compatible activation', async () => {
    renderAction();
    const button = screen.getByRole('button', { name: 'Verify email' });

    expect(button).toHaveAttribute('type', 'button');
    fireEvent.click(button, { detail: 0 });

    expect(verifyEmailAction).toHaveBeenCalledTimes(1);
    expect(verifyEmailAction).toHaveBeenCalledWith('synthetic-action-code');
    await screen.findByText('Email verified.');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Email verified.');
    expect(status).toHaveTextContent('does not grant club membership');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(status).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Continue to My Account' }))
      .toHaveAttribute('href', '/account');
  });

  test('blocks rapid repeat activation while the provider check is pending', async () => {
    let finish: (value: string) => void = () => undefined;
    verifyEmailAction.mockImplementationOnce(() => new Promise((resolve) => {
      finish = resolve;
    }));
    renderAction();
    const button = screen.getByRole('button', { name: 'Verify email' });

    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    expect(verifyEmailAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Checking verification...' }))
      .toBeDisabled();

    await act(async () => {
      finish('verified');
      await Promise.resolve();
    });
    expect(await screen.findByText('Email verified.')).toBeInTheDocument();
  });

  test.each([
    ['already-complete', 'Email verification is already complete.'],
    ['wrong-account', 'A different account is signed in.'],
    ['unusable', 'This verification link cannot be used.'],
  ])('shows the fixed %s result without private details', async (result, message) => {
    const canaries = [
      'private-member@example.test',
      'private-action-code-canary',
      'https://example.test/?oobCode=private-action-code-canary',
    ];
    verifyEmailAction.mockResolvedValueOnce(result);
    renderAction(`/auth/action?mode=verifyEmail&oobCode=${canaries[1]}`);

    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));

    await screen.findByText(message);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(message);
    canaries.forEach((canary) => expect(document.body).not.toHaveTextContent(canary));
    expect(status).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Continue to My Account' }))
      .toHaveAttribute('href', '/account');
  });

  test('uses one temporary result and retries the same in-memory code deliberately', async () => {
    verifyEmailAction
      .mockResolvedValueOnce('unavailable')
      .mockResolvedValueOnce('verified');
    renderAction();
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));

    expect(await screen.findByText('Verification is temporarily unavailable.'))
      .toBeInTheDocument();
    expect(window.location.search).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Try verification again' }));

    expect(verifyEmailAction).toHaveBeenCalledTimes(2);
    expect(verifyEmailAction).toHaveBeenNthCalledWith(2, 'synthetic-action-code');
    expect(await screen.findByText('Email verified.')).toBeInTheDocument();
  });

  test.each([
    '/auth/action',
    '/auth/action?mode=resetPassword&oobCode=synthetic-action-code',
    '/auth/action?mode=verifyEmail',
    '/auth/action?mode=verifyEmail&mode=verifyEmail&oobCode=synthetic-action-code',
    '/auth/action?mode=verifyEmail&oobCode=one&oobCode=two',
    '/auth/action?mode=verifyEmail&oobCode=',
    `/auth/action?mode=verifyEmail&oobCode=${'a'.repeat(2049)}`,
    '/auth/action?mode=verifyEmail&oobCode=control%0Acode',
    '/auth/action?mode=verifyEmail&oobCode=%ZZ',
    '/auth/action?mode=verifyEmail&oobCode=%E0%A4%A',
    '/auth/action?mode=verifyEmail&oobCode=%23',
    '/auth/action?mode=verifyEmail&oobCode=%E2%80%8B',
    '/auth/action?mode=verifyEmail&oobCode=%F0%9F%98%80',
  ])('fails closed without a provider call for malformed request %s', (target) => {
    renderAction(target);

    expect(screen.getByRole('status')).toHaveTextContent(
      'This verification link cannot be used.',
    );
    expect(verifyEmailAction).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
  });

  test('scrubs and rejects a later same-route capability without reusing the first code', () => {
    renderAction();

    fireEvent.click(screen.getByRole('button', { name: 'Load another private action' }));

    expect(window.location.pathname).toBe('/auth/action');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
    expect(screen.getByTestId('router-location')).toHaveAttribute(
      'data-search-clean',
      'true',
    );
    expect(screen.getByTestId('router-location')).toHaveAttribute(
      'data-hash-clean',
      'true',
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'This verification link cannot be used.',
    );
    expect(verifyEmailAction).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('second-synthetic-code');
    expect(document.body).not.toHaveTextContent('second-fragment');
  });

  test('ignores hostile authority and navigation parameters', async () => {
    const canaries = [
      'hostile-api-key-canary',
      'https://attacker.example/collect?code=private-action-code-canary',
      '//attacker.example/collect',
    ];
    renderAction(
      '/auth/action?mode=verifyEmail&oobCode=synthetic-action-code'
      + `&apiKey=${canaries[0]}&continueUrl=${encodeURIComponent(canaries[1])}`
      + `#${encodeURIComponent(canaries[2])}`,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));

    expect(await screen.findByText('Email verified.')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/auth/action');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
    canaries.forEach((canary) => expect(document.body).not.toHaveTextContent(canary));
    expect(verifyEmailAction).toHaveBeenCalledWith('synthetic-action-code');
  });

  test('waits for local services without attempting verification', () => {
    mockUseServiceLocator.mockReturnValue({
      isReady: false,
      services: null,
    });
    renderAction();

    expect(screen.getByRole('button', { name: 'Preparing verification...' }))
      .toBeDisabled();
    expect(verifyEmailAction).not.toHaveBeenCalled();
  });

  test('does not contact the provider while the browser is offline', () => {
    jest.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    renderAction();

    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));

    expect(screen.getByRole('status')).toHaveTextContent(
      'Verification is temporarily unavailable.',
    );
    expect(verifyEmailAction).not.toHaveBeenCalled();
  });

  test('fails closed without a provider call when browser history cannot be scrubbed', () => {
    window.history.replaceState(
      null,
      '',
      '/auth/action?mode=verifyEmail&oobCode=synthetic-action-code',
    );
    jest.spyOn(window.history, 'replaceState').mockImplementation(() => {
      throw new Error('private-history-canary');
    });

    render(
      <MemoryRouter
        future={{
          v7_relativeSplatPath: true,
          v7_startTransition: true,
        }}
        initialEntries={[
          '/auth/action?mode=verifyEmail&oobCode=synthetic-action-code',
        ]}
      >
        <Routes>
          <Route path="/auth/action" element={<VerifyEmailAction />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'This verification link cannot be used.',
    );
    expect(verifyEmailAction).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('private-history-canary');
  });

  test('discards a late provider result after unmount', async () => {
    let finish: (value: string) => void = () => undefined;
    verifyEmailAction.mockImplementationOnce(() => new Promise((resolve) => {
      finish = resolve;
    }));
    const page = renderAction();
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));
    page.unmount();

    await act(async () => {
      finish('verified');
      await Promise.resolve();
    });

    expect(verifyEmailAction).toHaveBeenCalledTimes(1);
    expect(document.body).not.toHaveTextContent('Email verified.');
  });

  test('uses a scoped 48px native action with visible keyboard focus', () => {
    renderAction();
    const button = screen.getByRole('button', { name: 'Verify email' });
    button.focus();
    expect(button).toHaveFocus();

    const css = readFileSync(join(__dirname, 'VerifyEmailAction.css'), 'utf8');
    expect(css).toMatch(/\.verify-email-action\s*\{[\s\S]*min-height:\s*3rem;/);
    expect(css).toMatch(/\.verify-email-action:focus-visible\s*\{[\s\S]*outline:/);
  });
});
