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
import {
  createCheckoutSession,
  getEventBySlug,
  listMemberEvents,
  listPublicEvents,
} from './services/events/eventsService';
import { listAllEvents } from './services/events/adminService';
import { events as analyticsEvents, track } from './services/analytics/analytics';
import { useAuth } from './services/hooks/useAuth';
import {
  createMerchCheckout,
  getProductBySlug,
  listActiveProducts,
  listAllProducts,
} from './services/shop/shopService';
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
    createMerchCheckout: jest.fn(),
    getProductBySlug: jest.fn(),
    listActiveProducts: jest.fn(),
    listAllProducts: jest.fn(),
  };
});

jest.mock('./services/events/eventsService', () => {
  const actual = jest.requireActual('./services/events/eventsService');
  return {
    ...actual,
    createCheckoutSession: jest.fn(),
    getEventBySlug: jest.fn(),
    listMemberEvents: jest.fn(),
    listPublicEvents: jest.fn(),
  };
});

jest.mock('./services/events/adminService', () => {
  const actual = jest.requireActual('./services/events/adminService');
  return {
    ...actual,
    listAllEvents: jest.fn(),
  };
});

jest.mock('./services/analytics/analytics', () => {
  const actual = jest.requireActual('./services/analytics/analytics');
  return { ...actual, track: jest.fn() };
});

jest.mock('./services/hooks/useAuth', () => ({
  useAuth: jest.fn(() => ({
    user: null,
    isLoading: false,
    isAuthenticated: false,
    isMember: false,
    isAdmin: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
    register: jest.fn(),
  })),
}));

beforeEach(() => {
  useServiceLocator.mockReset();
  useServiceLocator.mockReturnValue({ services: null, isReady: false });
  createMerchCheckout.mockReset();
  getProductBySlug.mockReset();
  listActiveProducts.mockReset();
  listAllProducts.mockReset();
  createCheckoutSession.mockReset();
  getEventBySlug.mockReset();
  listMemberEvents.mockReset();
  listPublicEvents.mockReset();
  listAllEvents.mockReset();
  track.mockReset();
  useAuth.mockReset();
  useAuth.mockReturnValue({
    user: null,
    isLoading: false,
    isAuthenticated: false,
    isMember: false,
    isAdmin: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
    register: jest.fn(),
  });
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
const SHOP_CHECKOUT_FAILURE = 'We could not confirm checkout. Please wait before trying again.';
const EVENTS_LOAD_FAILURE = 'Error: We could not load events right now. Please try again later.';
const EVENTS_CALENDAR_LOAD_FAILURE = 'We could not load events right now. Please try again later.';
const EVENT_DETAIL_LOAD_FAILURE = 'We could not load this event right now. Please try again later.';
const EVENT_REGISTER_LOAD_FAILURE = 'We could not load this event right now. Please try again later.';
const EVENT_REGISTER_SUBMIT_FAILURE = 'We could not confirm your registration. Please wait before trying again.';
const ADMIN_PRODUCTS_LOAD_FAILURE = 'We could not load products right now. Please try again later.';
const ADMIN_EVENTS_LOAD_FAILURE = 'We could not load events right now. Please try again later.';
const firebaseApp = { name: 'synthetic-firebase-app' };
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

function renderPublicEventCalendar() {
  window.history.pushState({}, '', '/events/calendar');
  return render(<App />);
}

function renderPublicEventDetail() {
  window.history.pushState({}, '', '/events/synthetic-event');
  return render(<App />);
}

function renderPublicEventRegister() {
  window.history.pushState({}, '', '/events/synthetic-event/register');
  return render(<App />);
}

function renderAdminProducts() {
  window.history.pushState({}, '', '/admin/products');
  return render(<App />);
}

function renderAdminEvents() {
  window.history.pushState({}, '', '/admin/events');
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

describe('public Events-calendar failure boundary', () => {
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
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('replaces rejected calendar details with one fixed accessible result', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    listPublicEvents.mockImplementationOnce((_db, _onChange, onError) => {
      onError(Object.assign(
        new Error('calendar-provider-private-canary member@example.test'),
        {
          code: 'firestore/calendar-provider-private-canary',
          endpoint: 'https://provider.example.test/?token=calendar-secret-canary',
        },
      ));
      return unsubscribe;
    });

    renderPublicEventCalendar();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(EVENTS_CALENDAR_LOAD_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(document.body).not.toHaveTextContent(
      /calendar-provider-private-canary|member@example\.test|provider\.example|calendar-secret-canary/i,
    );
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(screen.queryByText('Sun')).not.toBeInTheDocument();
    expect(listPublicEvents).toHaveBeenCalledWith(
      firestore,
      expect.any(Function),
      expect.any(Function),
    );
    expect(listPublicEvents).toHaveBeenCalledTimes(1);
    expect(listMemberEvents).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('does not inspect or log a hostile calendar rejection', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    const messageGetter = jest.fn(() => {
      throw new Error('calendar-message-getter-canary');
    });
    listPublicEvents.mockImplementationOnce((_db, _onChange, onError) => {
      onError(Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }));
      return unsubscribe;
    });

    renderPublicEventCalendar();

    expect((await screen.findByRole('alert')).textContent)
      .toBe(EVENTS_CALENDAR_LOAD_FAILURE);
    expect(messageGetter).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('calendar-message-getter-canary');
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('preserves the empty calendar, public lister, and unsubscribe', async () => {
    const { unmount } = renderPublicEventCalendar();

    expect(await screen.findByText('Sun')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeInTheDocument();
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

  test('preserves a successful public event in the current calendar month', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2030, 0, 15, 12));
    const currentMonth = new Date();
    listPublicEvents.mockImplementationOnce((_db, onChange) => {
      onChange([{
        id: 'synthetic-calendar-event',
        slug: 'synthetic-calendar-run',
        title: 'Synthetic Calendar Run',
        startAt: {
          toDate: () => new Date(
            currentMonth.getFullYear(),
            currentMonth.getMonth(),
            12,
            8,
          ),
        },
        capacity: null,
        registeredCount: 0,
        status: 'open',
        visibility: 'public',
        pricing: { memberCents: 0, nonMemberCents: 0 },
      }]);
      return unsubscribe;
    });

    renderPublicEventCalendar();

    expect(await screen.findByRole('link', { name: 'Synthetic Calendar Run' }))
      .toHaveAttribute('href', '/events/synthetic-calendar-run');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(listPublicEvents).toHaveBeenCalledTimes(1);
    expect(listMemberEvents).not.toHaveBeenCalled();
  });
});

describe('public Event-detail load failure boundary', () => {
  function makeEvent(slug, title) {
    return {
      id: slug,
      slug,
      title,
      description: `A made-up ${title} used only for this test.`,
      startAt: { toDate: () => new Date('2030-01-12T16:00:00Z') },
      location: 'Made-up Park',
      capacity: null,
      registeredCount: 0,
      status: 'open',
      visibility: 'public',
      pricing: { memberCents: 1000, nonMemberCents: 1500 },
      resultsUrl: null,
    };
  }

  beforeEach(() => {
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore } },
      isReady: true,
    });
    getEventBySlug.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('replaces rejected event details with one fixed accessible result', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    getEventBySlug.mockRejectedValueOnce(Object.assign(
      new Error('event-detail-provider-private-canary member@example.test'),
      {
        code: 'firestore/event-detail-provider-private-canary',
        endpoint: 'https://provider.example.test/?token=event-detail-secret-canary',
      },
    ));

    renderPublicEventDetail();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(EVENT_DETAIL_LOAD_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(document.body).not.toHaveTextContent(
      /event-detail-provider-private-canary|member@example\.test|provider\.example|event-detail-secret-canary/i,
    );
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(screen.queryByText('Event not found')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to events/ })).toHaveAttribute('href', '/events');
    expect(getEventBySlug).toHaveBeenCalledWith(firestore, 'synthetic-event');
    expect(getEventBySlug).toHaveBeenCalledTimes(1);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('does not inspect or log a hostile event-detail rejection', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    const messageGetter = jest.fn(() => {
      throw new Error('event-detail-message-getter-canary');
    });
    getEventBySlug.mockRejectedValueOnce(
      Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }),
    );

    renderPublicEventDetail();

    expect((await screen.findByRole('alert')).textContent).toBe(EVENT_DETAIL_LOAD_FAILURE);
    expect(messageGetter).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('event-detail-message-getter-canary');
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('preserves the existing missing-event result', async () => {
    renderPublicEventDetail();

    expect(await screen.findByText('Event not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to events/ })).toHaveAttribute('href', '/events');
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(getEventBySlug).toHaveBeenCalledWith(firestore, 'synthetic-event');
    expect(getEventBySlug).toHaveBeenCalledTimes(1);
  });

  test('preserves the existing successful event projection and registration link', async () => {
    getEventBySlug.mockResolvedValueOnce({
      id: 'synthetic-event',
      slug: 'synthetic-event',
      title: 'Synthetic Club Event',
      description: 'A made-up event used only for this test.',
      startAt: { toDate: () => new Date('2030-01-12T16:00:00Z') },
      location: 'Made-up Park',
      capacity: null,
      registeredCount: 0,
      status: 'open',
      visibility: 'public',
      pricing: { memberCents: 1000, nonMemberCents: 1500 },
      resultsUrl: null,
    });

    renderPublicEventDetail();

    expect(await screen.findByRole('heading', { level: 1, name: 'Synthetic Club Event' }))
      .toBeInTheDocument();
    expect(screen.getByText('Made-up Park', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('$10.00')).toBeInTheDocument();
    expect(screen.getByText('$15.00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Register' }))
      .toHaveAttribute('href', '/events/synthetic-event/register');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(getEventBySlug).toHaveBeenCalledWith(firestore, 'synthetic-event');
    expect(getEventBySlug).toHaveBeenCalledTimes(1);
  });

  test('clears a prior lookup failure when the current slug succeeds', async () => {
    getEventBySlug
      .mockRejectedValueOnce(new Error('prior-event-failure-canary'))
      .mockResolvedValueOnce(makeEvent('current-event', 'Current Event'));

    renderPublicEventDetail();
    expect((await screen.findByRole('alert')).textContent).toBe(EVENT_DETAIL_LOAD_FAILURE);

    window.history.pushState({}, '', '/events/current-event');
    fireEvent(window, new PopStateEvent('popstate'));

    expect(await screen.findByRole('heading', { level: 1, name: 'Current Event' }))
      .toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Register' }))
      .toHaveAttribute('href', '/events/current-event/register');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('prior-event-failure-canary');
    expect(getEventBySlug).toHaveBeenNthCalledWith(2, firestore, 'current-event');
  });

  test('clears a prior not-found result when the current slug succeeds', async () => {
    getEventBySlug
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeEvent('current-event', 'Current Event'));

    renderPublicEventDetail();
    expect(await screen.findByText('Event not found')).toBeInTheDocument();

    window.history.pushState({}, '', '/events/current-event');
    fireEvent(window, new PopStateEvent('popstate'));

    expect(await screen.findByRole('heading', { level: 1, name: 'Current Event' }))
      .toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Register' }))
      .toHaveAttribute('href', '/events/current-event/register');
    expect(screen.queryByText('Event not found')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(getEventBySlug).toHaveBeenNthCalledWith(2, firestore, 'current-event');
  });

  test('ignores an older rejection after the current slug succeeds', async () => {
    const olderLookup = {};
    olderLookup.promise = new Promise((_resolve, reject) => {
      olderLookup.reject = reject;
    });
    getEventBySlug
      .mockImplementationOnce(() => olderLookup.promise)
      .mockResolvedValueOnce(makeEvent('current-event', 'Current Event'));

    renderPublicEventDetail();
    expect(getEventBySlug).toHaveBeenCalledWith(firestore, 'synthetic-event');

    window.history.pushState({}, '', '/events/current-event');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Current Event' }))
      .toBeInTheDocument();

    await act(async () => {
      olderLookup.reject(new Error('older-event-rejection-canary'));
      await olderLookup.promise.catch(() => undefined);
    });

    expect(screen.getByRole('heading', { level: 1, name: 'Current Event' }))
      .toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Register' }))
      .toHaveAttribute('href', '/events/current-event/register');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('older-event-rejection-canary');
    expect(window.location.pathname).toBe('/events/current-event');
  });

  test('ignores an older event and analytics after the current slug succeeds', async () => {
    const olderLookup = {};
    olderLookup.promise = new Promise((resolve) => {
      olderLookup.resolve = resolve;
    });
    getEventBySlug
      .mockImplementationOnce(() => olderLookup.promise)
      .mockResolvedValueOnce(makeEvent('current-event', 'Current Event'));

    renderPublicEventDetail();
    expect(getEventBySlug).toHaveBeenCalledWith(firestore, 'synthetic-event');

    window.history.pushState({}, '', '/events/current-event');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Current Event' }))
      .toBeInTheDocument();
    expect(track).toHaveBeenCalledWith('event_view', {
      slug: 'current-event',
      title: 'Current Event',
    });
    expect(track).toHaveBeenCalledTimes(1);

    await act(async () => {
      olderLookup.resolve(makeEvent('older-event', 'Older Event'));
      await olderLookup.promise;
    });

    expect(screen.getByRole('heading', { level: 1, name: 'Current Event' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Older Event' }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Register' }))
      .toHaveAttribute('href', '/events/current-event/register');
    expect(window.location.pathname).toBe('/events/current-event');
    expect(track).toHaveBeenCalledTimes(1);
  });
});

describe('public Event-registration load failure boundary', () => {
  function makeRegistrationEvent(slug, title, nonMemberCents = 1500) {
    return {
      id: slug,
      slug,
      title,
      description: `A made-up ${title} used only for this test.`,
      startAt: { toDate: () => new Date('2030-01-12T16:00:00Z') },
      location: 'Made-up Park',
      capacity: null,
      registeredCount: 0,
      status: 'open',
      visibility: 'public',
      pricing: { memberCents: 1000, nonMemberCents },
      customFields: [],
      volunteerFields: [],
      volunteerEnabled: false,
      waiverText: `Made-up waiver for ${title}.`,
    };
  }

  beforeEach(() => {
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore } },
      isReady: true,
    });
    getEventBySlug.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('replaces rejected event details with one fixed accessible result', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    getEventBySlug.mockRejectedValueOnce(Object.assign(
      new Error('event-register-provider-private-canary member@example.test'),
      {
        code: 'firestore/event-register-provider-private-canary',
        endpoint: 'https://provider.example.test/?token=event-register-secret-canary',
      },
    ));

    renderPublicEventRegister();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(EVENT_REGISTER_LOAD_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(document.body).not.toHaveTextContent(
      /event-register-provider-private-canary|member@example\.test|provider\.example|event-register-secret-canary/i,
    );
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(screen.queryByText('Event not found')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to events/ })).toHaveAttribute('href', '/events');
    expect(getEventBySlug).toHaveBeenCalledWith(firestore, 'synthetic-event');
    expect(getEventBySlug).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('does not inspect or log a hostile event-registration rejection', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    const messageGetter = jest.fn(() => {
      throw new Error('event-register-message-getter-canary');
    });
    getEventBySlug.mockRejectedValueOnce(
      Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }),
    );

    renderPublicEventRegister();

    expect((await screen.findByRole('alert')).textContent).toBe(EVENT_REGISTER_LOAD_FAILURE);
    expect(messageGetter).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('event-register-message-getter-canary');
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('preserves the existing missing-event result', async () => {
    renderPublicEventRegister();

    expect(await screen.findByText('Event not found')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to events/ })).toHaveAttribute('href', '/events');
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(getEventBySlug).toHaveBeenCalledWith(firestore, 'synthetic-event');
    expect(getEventBySlug).toHaveBeenCalledTimes(1);
  });

  test('preserves the existing successful registration form and public price', async () => {
    getEventBySlug.mockResolvedValueOnce({
      id: 'synthetic-event',
      slug: 'synthetic-event',
      title: 'Synthetic Registration Event',
      description: 'A made-up event used only for this test.',
      startAt: { toDate: () => new Date('2030-01-12T16:00:00Z') },
      location: 'Made-up Park',
      capacity: null,
      registeredCount: 0,
      status: 'open',
      visibility: 'public',
      pricing: { memberCents: 1000, nonMemberCents: 1500 },
      customFields: [],
      volunteerFields: [],
      volunteerEnabled: false,
      waiverText: 'Made-up waiver text.',
    });

    renderPublicEventRegister();

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Register for Synthetic Registration Event',
    })).toBeInTheDocument();
    expect(screen.getByText('Made-up Park', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('$15.00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to event/ }))
      .toHaveAttribute('href', '/events/synthetic-event');
    expect(screen.getByRole('checkbox', { name: /accept the waiver/i })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(getEventBySlug).toHaveBeenCalledWith(firestore, 'synthetic-event');
    expect(getEventBySlug).toHaveBeenCalledTimes(1);
  });

  test('clears a prior lookup failure when the current registration slug succeeds', async () => {
    getEventBySlug
      .mockRejectedValueOnce(new Error('prior-registration-failure-canary'))
      .mockResolvedValueOnce(makeRegistrationEvent('current-event', 'Current Registration'));

    renderPublicEventRegister();
    expect((await screen.findByRole('alert')).textContent).toBe(EVENT_REGISTER_LOAD_FAILURE);

    window.history.pushState({}, '', '/events/current-event/register');
    fireEvent(window, new PopStateEvent('popstate'));

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Register for Current Registration',
    })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to event/ }))
      .toHaveAttribute('href', '/events/current-event');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('prior-registration-failure-canary');
    expect(getEventBySlug).toHaveBeenNthCalledWith(2, firestore, 'current-event');
    expect(track).not.toHaveBeenCalled();
  });

  test('clears a prior not-found result when the current registration slug succeeds', async () => {
    getEventBySlug
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeRegistrationEvent('current-event', 'Current Registration'));

    renderPublicEventRegister();
    expect(await screen.findByText('Event not found')).toBeInTheDocument();

    window.history.pushState({}, '', '/events/current-event/register');
    fireEvent(window, new PopStateEvent('popstate'));

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Register for Current Registration',
    })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to event/ }))
      .toHaveAttribute('href', '/events/current-event');
    expect(screen.queryByText('Event not found')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(getEventBySlug).toHaveBeenNthCalledWith(2, firestore, 'current-event');
    expect(track).not.toHaveBeenCalled();
  });

  test('ignores an older rejection after the current registration slug succeeds', async () => {
    const olderLookup = {};
    olderLookup.promise = new Promise((_resolve, reject) => {
      olderLookup.reject = reject;
    });
    getEventBySlug
      .mockImplementationOnce(() => olderLookup.promise)
      .mockResolvedValueOnce(makeRegistrationEvent('current-event', 'Current Registration'));

    renderPublicEventRegister();
    expect(getEventBySlug).toHaveBeenCalledWith(firestore, 'synthetic-event');

    window.history.pushState({}, '', '/events/current-event/register');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Register for Current Registration',
    })).toBeInTheDocument();

    await act(async () => {
      olderLookup.reject(new Error('older-registration-rejection-canary'));
      await olderLookup.promise.catch(() => undefined);
    });

    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Register for Current Registration',
    })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to event/ }))
      .toHaveAttribute('href', '/events/current-event');
    expect(screen.getByText('$15.00')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('older-registration-rejection-canary');
    expect(window.location.pathname).toBe('/events/current-event/register');
    expect(track).not.toHaveBeenCalled();
  });

  test('ignores an older event after the current registration slug succeeds', async () => {
    const olderLookup = {};
    olderLookup.promise = new Promise((resolve) => {
      olderLookup.resolve = resolve;
    });
    getEventBySlug
      .mockImplementationOnce(() => olderLookup.promise)
      .mockResolvedValueOnce(makeRegistrationEvent(
        'current-event',
        'Current Registration',
        2500,
      ));

    renderPublicEventRegister();
    expect(getEventBySlug).toHaveBeenCalledWith(firestore, 'synthetic-event');

    window.history.pushState({}, '', '/events/current-event/register');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Register for Current Registration',
    })).toBeInTheDocument();
    expect(screen.getByText('$25.00')).toBeInTheDocument();

    await act(async () => {
      olderLookup.resolve(makeRegistrationEvent('older-event', 'Older Registration', 9900));
      await olderLookup.promise;
    });

    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Register for Current Registration',
    })).toBeInTheDocument();
    expect(screen.queryByRole('heading', {
      level: 1,
      name: 'Register for Older Registration',
    })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to event/ }))
      .toHaveAttribute('href', '/events/current-event');
    expect(screen.getByText('$25.00')).toBeInTheDocument();
    expect(screen.queryByText('$99.00')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/events/current-event/register');
    expect(track).not.toHaveBeenCalled();
  });
});

describe('public Event-registration submit failure boundary', () => {
  const syntheticEvent = {
    id: 'synthetic-event',
    slug: 'synthetic-event',
    title: 'Synthetic Registration Event',
    description: 'A made-up event used only for this test.',
    startAt: { toDate: () => new Date('2030-01-12T16:00:00Z') },
    location: 'Made-up Park',
    capacity: null,
    registeredCount: 0,
    status: 'open',
    visibility: 'public',
    pricing: { memberCents: 1000, nonMemberCents: 1500 },
    customFields: [],
    volunteerFields: [],
    volunteerEnabled: false,
    waiverText: 'Made-up waiver text.',
  };

  beforeEach(() => {
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { app: firebaseApp, firestore } },
      isReady: true,
    });
    getEventBySlug.mockResolvedValue(syntheticEvent);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function fillRequiredRegistrationFields() {
    fireEvent.change(screen.getByRole('textbox', { name: 'First name *' }), {
      target: { value: 'Synthetic' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Last name *' }), {
      target: { value: 'Runner' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Email *' }), {
      target: { value: 'runner@example.test' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /accept the waiver/i }));
  }

  test('replaces rejected submission details with one fixed accessible result', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    createCheckoutSession.mockRejectedValueOnce(Object.assign(
      new Error('registration-provider-private-canary private-leak@example.test'),
      {
        code: 'functions/registration-provider-private-canary',
        endpoint: 'https://provider.example.test/?token=registration-secret-canary',
      },
    ));

    renderPublicEventRegister();
    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Register for Synthetic Registration Event',
    })).toBeInTheDocument();
    fillRequiredRegistrationFields();
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Phone' })[0], {
      target: { value: '+1 555 010 2740' },
    });
    fireEvent.change(screen.getByLabelText('Date of birth'), {
      target: { value: '1990-01-02' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Shirt size' }), {
      target: { value: 'M' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Synthetic Contact' },
    });
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Phone' })[1], {
      target: { value: '+1 555 010 2741' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment — $15.00' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(EVENT_REGISTER_SUBMIT_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(document.body).not.toHaveTextContent(
      /registration-provider-private-canary|private-leak@example\.test|provider\.example|registration-secret-canary/i,
    );
    expect(JSON.stringify(track.mock.calls)).not.toMatch(
      /registration-provider-private-canary|private-leak@example\.test|provider\.example|registration-secret-canary/i,
    );
    expect(createCheckoutSession).toHaveBeenCalledWith(firebaseApp, {
      eventId: 'synthetic-event',
      runner: {
        firstName: 'Synthetic',
        lastName: 'Runner',
        email: 'runner@example.test',
        phone: '+1 555 010 2740',
        dob: '1990-01-02',
        shirtSize: 'M',
        emergencyContactName: 'Synthetic Contact',
        emergencyContactPhone: '+1 555 010 2741',
      },
      customFields: {},
      signupType: 'participant',
      acceptedWaiver: true,
      priceTier: 'nonMember',
    });
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenNthCalledWith(1, analyticsEvents.registrationSubmitAttempt, {
      slug: 'synthetic-event', tier: 'nonMember', signup_type: 'participant',
    });
    expect(track).toHaveBeenNthCalledWith(2, analyticsEvents.registrationError, {
      slug: 'synthetic-event',
    });
    expect(track).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Register for Synthetic Registration Event',
    })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'First name *' })).toHaveValue('Synthetic');
    expect(screen.getByRole('textbox', { name: 'Last name *' })).toHaveValue('Runner');
    expect(screen.getByRole('textbox', { name: 'Email *' })).toHaveValue('runner@example.test');
    expect(screen.getByRole('checkbox', { name: /accept the waiver/i })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Continue to payment — $15.00' })).toBeEnabled();
    expect(window.location.pathname).toBe('/events/synthetic-event/register');
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('does not inspect or log a hostile submission rejection', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    const messageGetter = jest.fn(() => {
      throw new Error('registration-message-getter-canary');
    });
    createCheckoutSession.mockRejectedValueOnce(
      Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }),
    );

    renderPublicEventRegister();
    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Register for Synthetic Registration Event',
    })).toBeInTheDocument();
    fillRequiredRegistrationFields();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment — $15.00' }));

    expect((await screen.findByRole('alert')).textContent).toBe(EVENT_REGISTER_SUBMIT_FAILURE);
    expect(messageGetter).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('registration-message-getter-canary');
    expect(JSON.stringify(track.mock.calls)).not.toContain('registration-message-getter-canary');
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenNthCalledWith(2, analyticsEvents.registrationError, {
      slug: 'synthetic-event',
    });
    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Register for Synthetic Registration Event',
    })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Email *' })).toHaveValue('runner@example.test');
    expect(screen.getByRole('checkbox', { name: /accept the waiver/i })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Continue to payment — $15.00' })).toBeEnabled();
    expect(window.location.pathname).toBe('/events/synthetic-event/register');
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
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
      services: { firebaseResources: { app: firebaseApp, firestore } },
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

  test('replaces rejected checkout details with one fixed accessible result', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
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
    createMerchCheckout.mockRejectedValueOnce(Object.assign(
      new Error('checkout-provider-private-canary private-leak@example.test'),
      {
        code: 'functions/checkout-provider-private-canary',
        endpoint: 'https://provider.example.test/?token=checkout-secret-canary',
      },
    ));

    renderPublicProduct();
    expect(await screen.findByRole('heading', { level: 1, name: 'Synthetic Product' }))
      .toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('First name'), {
      target: { value: 'Synthetic' },
    });
    fireEvent.change(screen.getByPlaceholderText('Last name'), {
      target: { value: 'Buyer' },
    });
    fireEvent.change(screen.getByPlaceholderText('Email'), {
      target: { value: 'buyer@example.test' },
    });
    fireEvent.change(screen.getByPlaceholderText('Phone (optional)'), {
      target: { value: '+1 555 010 2720' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buy — $30.00' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(SHOP_CHECKOUT_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(document.body).not.toHaveTextContent(
      /checkout-provider-private-canary|private-leak@example\.test|provider\.example|checkout-secret-canary/i,
    );
    expect(createMerchCheckout).toHaveBeenCalledWith(firebaseApp, {
      productSlug: 'synthetic-product',
      buyer: {
        firstName: 'Synthetic',
        lastName: 'Buyer',
        email: 'buyer@example.test',
        phone: '+1 555 010 2720',
      },
      size: undefined,
      color: undefined,
    });
    expect(createMerchCheckout).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText('First name')).toHaveValue('Synthetic');
    expect(screen.getByPlaceholderText('Last name')).toHaveValue('Buyer');
    expect(screen.getByPlaceholderText('Email')).toHaveValue('buyer@example.test');
    expect(screen.getByPlaceholderText('Phone (optional)')).toHaveValue('+1 555 010 2720');
    expect(screen.getByRole('button', { name: 'Buy — $30.00' })).toBeEnabled();
    expect(window.location.pathname).toBe('/shop/synthetic-product');
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('does not inspect or log a hostile checkout rejection', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    const messageGetter = jest.fn(() => {
      throw new Error('checkout-message-getter-canary');
    });
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
    createMerchCheckout.mockRejectedValueOnce(
      Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }),
    );

    renderPublicProduct();
    expect(await screen.findByRole('heading', { level: 1, name: 'Synthetic Product' }))
      .toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('First name'), {
      target: { value: 'Synthetic' },
    });
    fireEvent.change(screen.getByPlaceholderText('Last name'), {
      target: { value: 'Buyer' },
    });
    fireEvent.change(screen.getByPlaceholderText('Email'), {
      target: { value: 'buyer@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buy — $30.00' }));

    expect((await screen.findByRole('alert')).textContent).toBe(SHOP_CHECKOUT_FAILURE);
    expect(messageGetter).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('checkout-message-getter-canary');
    expect(createMerchCheckout).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Synthetic Product' }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy — $30.00' })).toBeEnabled();
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });
});

describe('Admin Products list-load failure boundary', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({
      user: { uid: 'synthetic-admin' },
      isLoading: false,
      isAuthenticated: true,
      isMember: true,
      isAdmin: true,
      signIn: jest.fn(),
      signOut: jest.fn(),
      register: jest.fn(),
    });
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore } },
      isReady: true,
    });
    listAllProducts.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('replaces rejected list details with one fixed accessible unknown outcome', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    listAllProducts.mockRejectedValueOnce(Object.assign(
      new Error('admin-products-private-canary officer@example.test'),
      {
        code: 'firestore/admin-products-private-canary',
        endpoint: 'https://provider.example.test/?token=admin-products-secret-canary',
      },
    ));

    renderAdminProducts();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(ADMIN_PRODUCTS_LOAD_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(document.body).not.toHaveTextContent(
      /admin-products-private-canary|officer@example\.test|provider\.example|admin-products-secret-canary/i,
    );
    expect(JSON.stringify(track.mock.calls)).not.toMatch(
      /admin-products-private-canary|officer@example\.test|provider\.example|admin-products-secret-canary/i,
    );
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create one' })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Products' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('href', '/admin/orders');
    expect(screen.getByRole('link', { name: '+ New product' }))
      .toHaveAttribute('href', '/admin/products/new');
    expect(listAllProducts).toHaveBeenCalledWith(firestore);
    expect(listAllProducts).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/admin/products');
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('does not inspect or log a hostile list rejection', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    const messageGetter = jest.fn(() => {
      throw new Error('admin-products-message-getter-canary');
    });
    listAllProducts.mockRejectedValueOnce(
      Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }),
    );

    renderAdminProducts();

    expect((await screen.findByRole('alert')).textContent).toBe(ADMIN_PRODUCTS_LOAD_FAILURE);
    expect(messageGetter).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('admin-products-message-getter-canary');
    expect(JSON.stringify(track.mock.calls)).not.toContain('admin-products-message-getter-canary');
    expect(screen.queryByRole('link', { name: 'Create one' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Products' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('href', '/admin/orders');
    expect(screen.getByRole('link', { name: '+ New product' }))
      .toHaveAttribute('href', '/admin/products/new');
    expect(listAllProducts).toHaveBeenCalledWith(firestore);
    expect(listAllProducts).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/admin/products');
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('preserves the existing successful empty-catalog result', async () => {
    renderAdminProducts();

    const emptyStateLink = await screen.findByRole('link', { name: 'Create one' });
    expect(emptyStateLink).toHaveAttribute('href', '/admin/products/new');
    expect(emptyStateLink.parentElement).toHaveTextContent('No products yet. Create one.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(listAllProducts).toHaveBeenCalledWith(firestore);
    expect(listAllProducts).toHaveBeenCalledTimes(1);
  });

  test('preserves the existing successful product projection', async () => {
    listAllProducts.mockResolvedValueOnce([{
      id: 'synthetic-product',
      slug: 'synthetic-club-shirt',
      title: 'Synthetic Club Shirt',
      description: 'A made-up product used only for this test.',
      imageUrl: '',
      priceCents: 2500,
      status: 'active',
      sizes: [],
      colors: [],
    }]);

    renderAdminProducts();

    expect(await screen.findByRole('link', { name: 'Synthetic Club Shirt' }))
      .toHaveAttribute('href', '/admin/products/synthetic-club-shirt/edit');
    expect(screen.getByText('$25.00')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit' }))
      .toHaveAttribute('href', '/admin/products/synthetic-club-shirt/edit');
    expect(screen.queryByRole('link', { name: 'Create one' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(listAllProducts).toHaveBeenCalledWith(firestore);
    expect(listAllProducts).toHaveBeenCalledTimes(1);
  });
});

describe('Admin Events list-load failure boundary', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({
      user: { uid: 'synthetic-admin' },
      isLoading: false,
      isAuthenticated: true,
      isMember: true,
      isAdmin: true,
      signIn: jest.fn(),
      signOut: jest.fn(),
      register: jest.fn(),
    });
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore } },
      isReady: true,
    });
    listAllEvents.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('replaces rejected list details with one fixed accessible unknown outcome', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    listAllEvents.mockRejectedValueOnce(Object.assign(
      new Error('admin-events-private-canary officer@example.test'),
      {
        code: 'firestore/admin-events-private-canary',
        endpoint: 'https://provider.example.test/?token=admin-events-secret-canary',
      },
    ));

    renderAdminEvents();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(ADMIN_EVENTS_LOAD_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(document.body).not.toHaveTextContent(
      /admin-events-private-canary|officer@example\.test|provider\.example|admin-events-secret-canary/i,
    );
    expect(JSON.stringify(track.mock.calls)).not.toMatch(
      /admin-events-private-canary|officer@example\.test|provider\.example|admin-events-secret-canary/i,
    );
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create the first one' }))
      .not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('No events yet.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Events' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+ New event' }))
      .toHaveAttribute('href', '/admin/events/new');
    expect(listAllEvents).toHaveBeenCalledWith(firestore);
    expect(listAllEvents).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/admin/events');
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('does not inspect or log a hostile list rejection', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    const messageGetter = jest.fn(() => {
      throw new Error('admin-events-message-getter-canary');
    });
    listAllEvents.mockRejectedValueOnce(
      Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }),
    );

    renderAdminEvents();

    expect((await screen.findByRole('alert')).textContent).toBe(ADMIN_EVENTS_LOAD_FAILURE);
    expect(messageGetter).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('admin-events-message-getter-canary');
    expect(JSON.stringify(track.mock.calls)).not.toContain('admin-events-message-getter-canary');
    expect(screen.queryByRole('link', { name: 'Create the first one' }))
      .not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('No events yet.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Events' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+ New event' }))
      .toHaveAttribute('href', '/admin/events/new');
    expect(listAllEvents).toHaveBeenCalledWith(firestore);
    expect(listAllEvents).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/admin/events');
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('preserves the existing successful empty-events result', async () => {
    renderAdminEvents();

    const emptyStateLink = await screen.findByRole('link', {
      name: 'Create the first one',
    });
    expect(emptyStateLink).toHaveAttribute('href', '/admin/events/new');
    expect(emptyStateLink.parentElement).toHaveTextContent(
      'No events yet. Create the first one.',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(listAllEvents).toHaveBeenCalledWith(firestore);
    expect(listAllEvents).toHaveBeenCalledTimes(1);
  });

  test('preserves the existing successful event projection', async () => {
    listAllEvents.mockResolvedValueOnce([{
      id: 'synthetic-event',
      slug: 'synthetic-club-run',
      title: 'Synthetic Club Run',
      startAt: { toDate: () => new Date(2030, 0, 12, 12, 0) },
      capacity: 20,
      registeredCount: 7,
      status: 'open',
      visibility: 'public',
      pricing: { memberCents: 1000, nonMemberCents: 1500 },
    }]);

    renderAdminEvents();

    expect(await screen.findByRole('link', { name: 'Synthetic Club Run' }))
      .toHaveAttribute('href', '/admin/events/synthetic-club-run/edit');
    expect(screen.getByText(/Jan 12, 2030/)).toBeInTheDocument();
    expect(screen.getByText('$10.00 / $15.00')).toBeInTheDocument();
    expect(screen.getByText('7 / 20')).toBeInTheDocument();
    expect(screen.getByText('open')).toBeInTheDocument();
    expect(screen.getByText('public')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Signups' }))
      .toHaveAttribute('href', '/admin/events/synthetic-club-run/registrations');
    expect(screen.getByRole('link', { name: 'Edit' }))
      .toHaveAttribute('href', '/admin/events/synthetic-club-run/edit');
    expect(screen.queryByRole('link', { name: 'Create the first one' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(listAllEvents).toHaveBeenCalledWith(firestore);
    expect(listAllEvents).toHaveBeenCalledTimes(1);
  });

  test('hides a previously loaded table when a later lookup fails', async () => {
    listAllEvents.mockResolvedValueOnce([{
      id: 'synthetic-event',
      slug: 'synthetic-club-run',
      title: 'Synthetic Club Run',
      startAt: { toDate: () => new Date(2030, 0, 12, 12, 0) },
      capacity: 20,
      registeredCount: 7,
      status: 'open',
      visibility: 'public',
      pricing: { memberCents: 1000, nonMemberCents: 1500 },
    }]);
    const view = renderAdminEvents();
    expect(await screen.findByRole('table')).toBeInTheDocument();

    const retryFirestore = { name: 'synthetic-firestore-retry' };
    listAllEvents.mockRejectedValueOnce(
      new Error('admin-events-stale-private-canary'),
    );
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore: retryFirestore } },
      isReady: true,
    });
    view.rerender(<App />);

    expect((await screen.findByRole('alert')).textContent).toBe(ADMIN_EVENTS_LOAD_FAILURE);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create the first one' }))
      .not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('No events yet.');
    expect(document.body).not.toHaveTextContent('admin-events-stale-private-canary');
    expect(listAllEvents).toHaveBeenNthCalledWith(1, firestore);
    expect(listAllEvents).toHaveBeenNthCalledWith(2, retryFirestore);
    expect(listAllEvents).toHaveBeenCalledTimes(2);
  });

  test('shows a later successful empty result after an earlier failure', async () => {
    listAllEvents.mockRejectedValueOnce(new Error('admin-events-first-failure-canary'));
    const view = renderAdminEvents();
    expect((await screen.findByRole('alert')).textContent).toBe(ADMIN_EVENTS_LOAD_FAILURE);

    const retryFirestore = { name: 'synthetic-firestore-success-retry' };
    listAllEvents.mockResolvedValueOnce([]);
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore: retryFirestore } },
      isReady: true,
    });
    view.rerender(<App />);

    const emptyStateLink = await screen.findByRole('link', {
      name: 'Create the first one',
    });
    expect(emptyStateLink.parentElement).toHaveTextContent(
      'No events yet. Create the first one.',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('admin-events-first-failure-canary');
    expect(listAllEvents).toHaveBeenNthCalledWith(1, firestore);
    expect(listAllEvents).toHaveBeenNthCalledWith(2, retryFirestore);
    expect(listAllEvents).toHaveBeenCalledTimes(2);
  });

  test('ignores an older hostile rejection after a newer successful lookup', async () => {
    let rejectOlderLookup;
    listAllEvents.mockReturnValueOnce(new Promise((_resolve, reject) => {
      rejectOlderLookup = reject;
    }));
    const view = renderAdminEvents();
    expect(await screen.findByText('Loading...')).toBeInTheDocument();

    const currentFirestore = { name: 'synthetic-firestore-current' };
    listAllEvents.mockResolvedValueOnce([{
      id: 'synthetic-current-event',
      slug: 'synthetic-current-run',
      title: 'Synthetic Current Run',
      startAt: { toDate: () => new Date(2030, 0, 12, 12, 0) },
      capacity: null,
      registeredCount: 2,
      status: 'open',
      visibility: 'public',
      pricing: { memberCents: 0, nonMemberCents: 0 },
    }]);
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore: currentFirestore } },
      isReady: true,
    });
    view.rerender(<App />);
    expect(await screen.findByRole('link', { name: 'Synthetic Current Run' }))
      .toHaveAttribute('href', '/admin/events/synthetic-current-run/edit');

    const messageGetter = jest.fn(() => {
      throw new Error('admin-events-older-message-getter-canary');
    });
    await act(async () => {
      rejectOlderLookup(Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }));
      await Promise.resolve();
    });

    expect(messageGetter).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Synthetic Current Run' }))
      .toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      'admin-events-older-message-getter-canary',
    );
    expect(listAllEvents).toHaveBeenNthCalledWith(1, firestore);
    expect(listAllEvents).toHaveBeenNthCalledWith(2, currentFirestore);
    expect(listAllEvents).toHaveBeenCalledTimes(2);
  });
});
