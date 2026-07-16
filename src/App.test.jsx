/* eslint-env jest */

import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { resolvePath } from 'react-router-dom';
import { useServiceLocator } from './services/ServiceLocatorContext';
import { listMemberEvents, listPublicEvents } from './services/events/eventsService';
import { getProductBySlug, listActiveProducts } from './services/shop/shopService';
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
    getProductBySlug: jest.fn(),
    listActiveProducts: jest.fn(),
  };
});

jest.mock('./services/events/eventsService', () => {
  const actual = jest.requireActual('./services/events/eventsService');
  return {
    ...actual,
    listMemberEvents: jest.fn(),
    listPublicEvents: jest.fn(),
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
  getProductBySlug.mockReset();
  listActiveProducts.mockReset();
  listMemberEvents.mockReset();
  listPublicEvents.mockReset();
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
const PRODUCT_LOAD_FAILURE = 'We could not load this product right now. Please try again later.';
const EVENTS_LOAD_FAILURE = 'Error: We could not load events right now. Please try again later.';
const firestore = { name: 'synthetic-firestore' };

function renderPublicShop() {
  window.history.pushState({}, '', '/shop');
  return render(<App />);
}

function renderPublicProduct() {
  window.history.pushState({}, '', '/shop/synthetic-product');
  return render(<App />);
}

function renderPublicEvents() {
  window.history.pushState({}, '', '/events');
  return render(<App />);
}

describe('public Events-list failure boundary', () => {
  let unsubscribe;

  beforeEach(() => {
    unsubscribe = jest.fn();
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore } },
      isReady: true,
    });
    listPublicEvents.mockImplementation((_db, onChange) => {
      onChange([]);
      return unsubscribe;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('replaces rejected event details with one fixed result', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    listPublicEvents.mockImplementationOnce((_db, _onChange, onError) => {
      onError(Object.assign(
        new Error('events-provider-private-canary member@example.test'),
        {
          code: 'firestore/events-provider-private-canary',
          endpoint: 'https://provider.example.test/?token=events-secret-canary',
        },
      ));
      return unsubscribe;
    });

    renderPublicEvents();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(EVENTS_LOAD_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(document.body).not.toHaveTextContent(
      /events-provider-private-canary|member@example\.test|provider\.example|events-secret-canary/i,
    );
    expect(screen.queryByText('Loading events...')).not.toBeInTheDocument();
    expect(screen.queryByText('No events scheduled at this time.')).not.toBeInTheDocument();
    expect(listPublicEvents).toHaveBeenCalledWith(
      firestore,
      expect.any(Function),
      expect.any(Function),
    );
    expect(listPublicEvents).toHaveBeenCalledTimes(1);
    expect(listMemberEvents).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('does not inspect or log a hostile event rejection', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    const messageGetter = jest.fn(() => {
      throw new Error('events-message-getter-canary');
    });
    listPublicEvents.mockImplementationOnce((_db, _onChange, onError) => {
      onError(Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }));
      return unsubscribe;
    });

    renderPublicEvents();

    expect((await screen.findByRole('alert')).textContent).toBe(EVENTS_LOAD_FAILURE);
    expect(messageGetter).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('events-message-getter-canary');
    expect(screen.queryByText('Loading events...')).not.toBeInTheDocument();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('preserves the empty result, public lister, and unsubscribe', async () => {
    const { unmount } = renderPublicEvents();

    expect(await screen.findByText('No events scheduled at this time.'))
      .toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(listPublicEvents).toHaveBeenCalledWith(
      firestore,
      expect.any(Function),
      expect.any(Function),
    );
    expect(listPublicEvents).toHaveBeenCalledTimes(1);
    expect(listMemberEvents).not.toHaveBeenCalled();

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  test('preserves the successful public event projection', async () => {
    listPublicEvents.mockImplementationOnce((_db, onChange) => {
      onChange([{
        id: 'synthetic-event',
        slug: 'synthetic-club-run',
        title: 'Synthetic Club Run',
        startAt: { toDate: () => new Date('2030-01-12T16:00:00Z') },
        location: 'Made-up Park',
        capacity: null,
        registeredCount: 0,
        status: 'open',
        visibility: 'public',
        pricing: { memberCents: 0, nonMemberCents: 0 },
        resultsUrl: null,
      }]);
      return unsubscribe;
    });

    renderPublicEvents();

    expect(await screen.findByRole('link', { name: /Synthetic Club Run/ }))
      .toHaveAttribute('href', '/events/synthetic-club-run');
    expect(screen.getByText('Made-up Park', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(listPublicEvents).toHaveBeenCalledTimes(1);
    expect(listMemberEvents).not.toHaveBeenCalled();
  });
});

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

describe('public Shop product-load failure boundary', () => {
  beforeEach(() => {
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore } },
      isReady: true,
    });
    getProductBySlug.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('replaces rejected product details with one fixed accessible result', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    getProductBySlug.mockRejectedValueOnce(Object.assign(
      new Error('product-provider-private-canary member@example.test'),
      {
        code: 'firestore/product-provider-private-canary',
        endpoint: 'https://provider.example.test/?token=product-secret-canary',
      },
    ));

    renderPublicProduct();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(PRODUCT_LOAD_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(document.body).not.toHaveTextContent(
      /product-provider-private-canary|member@example\.test|provider\.example|product-secret-canary/i,
    );
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(screen.queryByText('Product not found')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to shop/ })).toHaveAttribute('href', '/shop');
    expect(getProductBySlug).toHaveBeenCalledWith(firestore, 'synthetic-product');
    expect(getProductBySlug).toHaveBeenCalledTimes(1);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('does not inspect or log a hostile product rejection', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    const messageGetter = jest.fn(() => {
      throw new Error('product-message-getter-canary');
    });
    getProductBySlug.mockRejectedValueOnce(
      Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }),
    );

    renderPublicProduct();

    expect((await screen.findByRole('alert')).textContent).toBe(PRODUCT_LOAD_FAILURE);
    expect(messageGetter).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('product-message-getter-canary');
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('announces a rejected slug after a product was already loaded', async () => {
    getProductBySlug
      .mockResolvedValueOnce({
        id: 'synthetic-product',
        slug: 'synthetic-product',
        title: 'Synthetic Product',
        description: 'A made-up product used only for this test.',
        imageUrl: '',
        priceCents: 3000,
        status: 'active',
        sizes: [],
        colors: [],
      })
      .mockRejectedValueOnce(new Error('product-transition-private-canary'));

    renderPublicProduct();

    expect(await screen.findByRole('heading', { level: 1, name: 'Synthetic Product' }))
      .toBeInTheDocument();

    window.history.pushState({}, '', '/shop/rejected-product');
    fireEvent(window, new PopStateEvent('popstate'));

    expect((await screen.findByRole('alert')).textContent).toBe(PRODUCT_LOAD_FAILURE);
    expect(screen.queryByRole('heading', { level: 1, name: 'Synthetic Product' }))
      .not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('product-transition-private-canary');
    expect(getProductBySlug).toHaveBeenNthCalledWith(1, firestore, 'synthetic-product');
    expect(getProductBySlug).toHaveBeenNthCalledWith(2, firestore, 'rejected-product');
    expect(getProductBySlug).toHaveBeenCalledTimes(2);
  });

  test('ignores an older lookup rejection after the current slug loads', async () => {
    const firstLookup = {};
    firstLookup.promise = new Promise((resolve, reject) => {
      firstLookup.resolve = resolve;
      firstLookup.reject = reject;
    });
    getProductBySlug
      .mockImplementationOnce(() => firstLookup.promise)
      .mockResolvedValueOnce({
        id: 'current-product',
        slug: 'current-product',
        title: 'Current Product',
        description: 'A made-up current product used only for this test.',
        imageUrl: '',
        priceCents: 4000,
        status: 'active',
        sizes: [],
        colors: [],
      });

    renderPublicProduct();
    expect(getProductBySlug).toHaveBeenCalledWith(firestore, 'synthetic-product');

    window.history.pushState({}, '', '/shop/current-product');
    fireEvent(window, new PopStateEvent('popstate'));

    expect(await screen.findByRole('heading', { level: 1, name: 'Current Product' }))
      .toBeInTheDocument();

    await act(async () => {
      firstLookup.reject(new Error('stale-product-private-canary'));
      await firstLookup.promise.catch(() => undefined);
    });

    expect(screen.getByRole('heading', { level: 1, name: 'Current Product' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('stale-product-private-canary');
    expect(getProductBySlug).toHaveBeenNthCalledWith(2, firestore, 'current-product');
    expect(getProductBySlug).toHaveBeenCalledTimes(2);
  });

  test('preserves the existing missing-product result', async () => {
    renderPublicProduct();

    expect(await screen.findByText('Product not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to shop/ })).toHaveAttribute('href', '/shop');
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(getProductBySlug).toHaveBeenCalledWith(firestore, 'synthetic-product');
    expect(getProductBySlug).toHaveBeenCalledTimes(1);
  });

  test('preserves the existing successful product projection and form', async () => {
    getProductBySlug.mockResolvedValueOnce({
      id: 'synthetic-product',
      slug: 'synthetic-product',
      title: 'Synthetic Product',
      description: 'A made-up product used only for this test.',
      imageUrl: '',
      priceCents: 3000,
      status: 'active',
      sizes: [],
      colors: [],
    });

    renderPublicProduct();

    expect(await screen.findByRole('heading', { level: 1, name: 'Synthetic Product' }))
      .toBeInTheDocument();
    expect(screen.getByText('$30.00')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('First name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Last name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Email')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(getProductBySlug).toHaveBeenCalledWith(firestore, 'synthetic-product');
    expect(getProductBySlug).toHaveBeenCalledTimes(1);
  });
});
