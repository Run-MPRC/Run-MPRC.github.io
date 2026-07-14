/* eslint-env jest */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { resolvePath } from 'react-router-dom';
import { useServiceLocator } from './services/ServiceLocatorContext';
import { listActiveProducts } from './services/shop/shopService';
import App from './App';

jest.mock('./services/ServiceLocatorProvider', () => function TestServiceLocatorProvider({
  children,
}) {
  return children;
});

jest.mock('./services/ServiceLocatorContext', () => ({
  useServiceLocator: jest.fn(() => ({ services: null, isReady: false })),
}));

jest.mock('./services/shop/shopService', () => {
  const actual = jest.requireActual('./services/shop/shopService');
  return {
    ...actual,
    listActiveProducts: jest.fn(),
  };
});

jest.mock('./services/hooks/useAuth', () => ({
  useAuth: () => ({
    user: null,
    isLoading: false,
    isAuthenticated: false,
    isMember: false,
    isAdmin: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
    register: jest.fn(),
  }),
}));

beforeEach(() => {
  useServiceLocator.mockReset();
  useServiceLocator.mockReturnValue({ services: null, isReady: false });
  listActiveProducts.mockReset();
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

test('renders the MPRC home route without contacting Firebase', () => {
  const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

  try {
    render(<App />);
    expect(screen.getByRole('heading', {
      level: 1,
      name: /mid-peninsula running club/i,
    })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /skip to content/i })).toHaveAttribute(
      'href',
      '#main-content',
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(consoleWarn).not.toHaveBeenCalled();
  } finally {
    consoleWarn.mockRestore();
  }
});

test('normalizes embedded double slashes before resolving a route', () => {
  const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

  try {
    const resolved = resolvePath('/safe/../..//attacker.example/path');

    expect(resolved.pathname).toBe('/attacker.example/path');
    expect(resolved.pathname).not.toMatch(/^\/\//);
    expect(new URL(resolved.pathname, window.location.origin).origin).toBe(
      window.location.origin,
    );
  } finally {
    consoleWarn.mockRestore();
  }
});

test('navigates from the wildcard route to home with future behavior enabled', async () => {
  window.history.pushState({}, '', '/missing/nested-page');
  render(<App />);

  expect(screen.getByRole('heading', {
    level: 2,
    name: /page not found/i,
  })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('link', {
    name: /home club info, history, and what we do/i,
  }));

  expect(await screen.findByRole('heading', {
    level: 1,
    name: /mid-peninsula running club/i,
  })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/');
});

test('renders the Auth action route and removes its query and fragment before use', () => {
  window.history.pushState(
    {},
    '',
    '/auth/action?mode=verifyEmail&oobCode=synthetic-action-code#private-fragment',
  );

  render(<App />);

  expect(screen.getByRole('heading', {
    level: 1,
    name: /email verification/i,
  })).toBeInTheDocument();
  expect(screen.queryByRole('heading', {
    level: 2,
    name: /page not found/i,
  })).not.toBeInTheDocument();
  expect(window.location.pathname).toBe('/auth/action');
  expect(window.location.search).toBe('');
  expect(window.location.hash).toBe('');
});

const SHOP_LOAD_FAILURE = 'We could not load the shop right now. Please try again later.';
const firestore = { name: 'synthetic-firestore' };

function renderPublicShop() {
  window.history.pushState({}, '', '/shop');
  return render(<App />);
}

describe('public Shop catalog failure boundary', () => {
  beforeEach(() => {
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore } },
      isReady: true,
    });
    listActiveProducts.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('replaces rejected catalog details with one fixed accessible result', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    listActiveProducts.mockRejectedValueOnce(Object.assign(
      new Error('shop-provider-private-canary member@example.test'),
      {
        code: 'firestore/shop-provider-private-canary',
        endpoint: 'https://provider.example.test/?token=secret-canary',
      },
    ));

    renderPublicShop();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(SHOP_LOAD_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(document.body).not.toHaveTextContent(
      /shop-provider-private-canary|member@example\.test|provider\.example|secret-canary/i,
    );
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(screen.queryByText('No items available right now. Check back soon.'))
      .not.toBeInTheDocument();
    expect(listActiveProducts).toHaveBeenCalledWith(firestore);
    expect(listActiveProducts).toHaveBeenCalledTimes(1);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('does not inspect or log a hostile catalog rejection', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    const messageGetter = jest.fn(() => {
      throw new Error('shop-message-getter-canary');
    });
    listActiveProducts.mockRejectedValueOnce(
      Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }),
    );

    renderPublicShop();

    expect((await screen.findByRole('alert')).textContent).toBe(SHOP_LOAD_FAILURE);
    expect(messageGetter).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('shop-message-getter-canary');
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('preserves the existing empty catalog result', async () => {
    renderPublicShop();

    expect(await screen.findByText('No items available right now. Check back soon.'))
      .toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(listActiveProducts).toHaveBeenCalledWith(firestore);
    expect(listActiveProducts).toHaveBeenCalledTimes(1);
  });

  test('preserves the existing successful product projection', async () => {
    listActiveProducts.mockResolvedValueOnce([{
      id: 'synthetic-product',
      slug: 'synthetic-club-shirt',
      title: 'Synthetic Club Shirt',
      imageUrl: '',
      priceCents: 2500,
      status: 'active',
    }]);

    renderPublicShop();

    expect(await screen.findByRole('link', { name: /Synthetic Club Shirt/ }))
      .toHaveAttribute('href', '/shop/synthetic-club-shirt');
    expect(screen.getByText('$25.00')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(listActiveProducts).toHaveBeenCalledWith(firestore);
    expect(listActiveProducts).toHaveBeenCalledTimes(1);
  });
});
