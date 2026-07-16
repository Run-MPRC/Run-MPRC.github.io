/* eslint-env jest */

import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { resolvePath } from 'react-router-dom';
import { useServiceLocator } from './services/ServiceLocatorContext';
import {
  createCheckoutSession,
  formatEventDate,
  getEventBySlug,
  listEventRegistrations,
  listMemberEvents,
  listPublicEvents,
} from './services/events/eventsService';
import { listAllEvents } from './services/events/adminService';
import {
  listAllMembers,
  setMemberRole,
} from './services/account/adminMembersService';
import { events as analyticsEvents, track } from './services/analytics/analytics';
import { useAuth } from './services/hooks/useAuth';
import {
  adminOrderAction,
  createMerchCheckout,
  getProductBySlug,
  listActiveProducts,
  listAllOrders,
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
    adminOrderAction: jest.fn(),
    createMerchCheckout: jest.fn(),
    getProductBySlug: jest.fn(),
    listActiveProducts: jest.fn(),
    listAllOrders: jest.fn(),
    listAllProducts: jest.fn(),
  };
});

jest.mock('./services/events/eventsService', () => {
  const actual = jest.requireActual('./services/events/eventsService');
  return {
    ...actual,
    createCheckoutSession: jest.fn(),
    getEventBySlug: jest.fn(),
    listEventRegistrations: jest.fn(),
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

jest.mock('./services/account/adminMembersService', () => {
  const actual = jest.requireActual('./services/account/adminMembersService');
  return {
    ...actual,
    listAllMembers: jest.fn(),
    setMemberRole: jest.fn(),
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
  adminOrderAction.mockReset();
  createMerchCheckout.mockReset();
  getProductBySlug.mockReset();
  listActiveProducts.mockReset();
  listAllOrders.mockReset();
  listAllProducts.mockReset();
  createCheckoutSession.mockReset();
  getEventBySlug.mockReset();
  listEventRegistrations.mockReset();
  listMemberEvents.mockReset();
  listPublicEvents.mockReset();
  listAllEvents.mockReset();
  listAllMembers.mockReset();
  setMemberRole.mockReset();
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
const ADMIN_PRODUCT_EDITOR_LOAD_FAILURE = 'We could not load this product right now. Please try again later.';
const ADMIN_EVENTS_LOAD_FAILURE = 'We could not load events right now. Please try again later.';
const ADMIN_DASHBOARD_LOAD_FAILURE = 'We could not load the admin summary right now. Please try again later.';
const ADMIN_ORDERS_LOAD_FAILURE = 'We could not load orders right now. Stop and contact the treasurer and platform owner before taking any order action.';
const ADMIN_MEMBERS_LOAD_FAILURE = 'We could not load website accounts right now. Stop and contact the membership lead and platform owner before changing website access.';
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

function renderAdminProductEditor() {
  window.history.pushState({}, '', '/admin/products/synthetic-product/edit');
  return render(<App />);
}

function renderAdminEvents() {
  window.history.pushState({}, '', '/admin/events');
  return render(<App />);
}

function renderAdminDashboard() {
  window.history.pushState({}, '', '/admin');
  return render(<App />);
}

function renderAdminOrders() {
  window.history.pushState({}, '', '/admin/orders');
  return render(<App />);
}

function renderAdminMembers() {
  window.history.pushState({}, '', '/admin/members');
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

describe('Admin Product editor load-failure boundary', () => {
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
    getProductBySlug.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('replaces rejected load details with one fixed accessible result and no editable form', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    getProductBySlug.mockRejectedValueOnce(Object.assign(
      new Error('admin-product-editor-private-canary officer@example.test'),
      {
        code: 'firestore/admin-product-editor-private-canary',
        endpoint: 'https://provider.example.test/?token=admin-product-editor-secret-canary',
      },
    ));

    renderAdminProductEditor();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(ADMIN_PRODUCT_EDITOR_LOAD_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(document.body).not.toHaveTextContent(
      /admin-product-editor-private-canary|officer@example\.test|provider\.example|admin-product-editor-secret-canary/i,
    );
    expect(JSON.stringify(track.mock.calls)).not.toMatch(
      /admin-product-editor-private-canary|officer@example\.test|provider\.example|admin-product-editor-secret-canary/i,
    );
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(screen.queryByText('Product not found')).not.toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Edit product' }))
      .toBeInTheDocument();
    expect(screen.getByRole('link', { name: /All products/ }))
      .toHaveAttribute('href', '/admin/products');
    expect(getProductBySlug).toHaveBeenCalledWith(firestore, 'synthetic-product');
    expect(getProductBySlug).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/admin/products/synthetic-product/edit');
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('does not inspect, log, or measure a hostile load rejection', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    const messageGetter = jest.fn(() => {
      throw new Error('admin-product-editor-message-getter-canary');
    });
    getProductBySlug.mockRejectedValueOnce(
      Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }),
    );

    renderAdminProductEditor();

    expect((await screen.findByRole('alert')).textContent)
      .toBe(ADMIN_PRODUCT_EDITOR_LOAD_FAILURE);
    expect(messageGetter).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('admin-product-editor-message-getter-canary');
    expect(JSON.stringify(track.mock.calls))
      .not.toContain('admin-product-editor-message-getter-canary');
    expect(document.querySelector('form')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('fails closed for a later service rejection and recovers on a later current success', async () => {
    getProductBySlug.mockResolvedValueOnce({
      id: 'synthetic-product',
      slug: 'synthetic-product',
      title: 'Synthetic Product',
      description: 'A made-up product used only for this test.',
      imageUrl: '',
      priceCents: 3000,
      status: 'active',
      sizes: ['S'],
      colors: ['Blue'],
    });
    const view = renderAdminProductEditor();
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit: Synthetic Product' }))
      .toBeInTheDocument();
    expect(document.querySelector('form')).not.toBeNull();

    const retryFirestore = { name: 'synthetic-firestore-retry' };
    getProductBySlug.mockRejectedValueOnce(
      new Error('admin-product-editor-transition-private-canary'),
    );
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore: retryFirestore } },
      isReady: true,
    });
    view.rerender(<App />);

    expect((await screen.findByRole('alert')).textContent)
      .toBe(ADMIN_PRODUCT_EDITOR_LOAD_FAILURE);
    expect(document.querySelector('form')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('Synthetic Product');
    expect(document.body).not.toHaveTextContent(
      'admin-product-editor-transition-private-canary',
    );

    const recoveredFirestore = { name: 'synthetic-firestore-recovered' };
    getProductBySlug.mockResolvedValueOnce({
      id: 'recovered-product',
      slug: 'synthetic-product',
      title: 'Recovered Product',
      description: 'A recovered made-up product.',
      imageUrl: 'https://images.example.test/recovered-product.jpg',
      priceCents: 3250,
      status: 'draft',
      sizes: ['M', 'L'],
      colors: ['Green'],
    });
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore: recoveredFirestore } },
      isReady: true,
    });
    view.rerender(<App />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Edit: Recovered Product' }))
      .toBeInTheDocument();
    expect(screen.getByLabelText('Title *')).toHaveValue('Recovered Product');
    expect(screen.getByLabelText('Price (USD) *')).toHaveValue(32.5);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      'admin-product-editor-transition-private-canary',
    );
    expect(getProductBySlug).toHaveBeenNthCalledWith(1, firestore, 'synthetic-product');
    expect(getProductBySlug).toHaveBeenNthCalledWith(2, retryFirestore, 'synthetic-product');
    expect(getProductBySlug).toHaveBeenNthCalledWith(3, recoveredFirestore, 'synthetic-product');
    expect(getProductBySlug).toHaveBeenCalledTimes(3);
  });

  test('ignores an older hostile rejection after the current route loads', async () => {
    let rejectOlderLookup;
    const olderLookup = new Promise((_resolve, reject) => {
      rejectOlderLookup = reject;
    });
    getProductBySlug
      .mockReturnValueOnce(olderLookup)
      .mockResolvedValueOnce({
        id: 'current-product',
        slug: 'current-product',
        title: 'Current Product',
        description: 'A made-up current product.',
        imageUrl: '',
        priceCents: 4000,
        status: 'active',
        sizes: [],
        colors: [],
      });

    renderAdminProductEditor();
    expect(await screen.findByText('Loading...')).toBeInTheDocument();

    window.history.pushState({}, '', '/admin/products/current-product/edit');
    fireEvent(window, new PopStateEvent('popstate'));

    expect(await screen.findByRole('heading', { level: 1, name: 'Edit: Current Product' }))
      .toBeInTheDocument();
    expect(screen.getByLabelText('Title *')).toHaveValue('Current Product');

    const messageGetter = jest.fn(() => {
      throw new Error('admin-product-editor-older-message-getter-canary');
    });
    await act(async () => {
      rejectOlderLookup(Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }));
      await olderLookup.catch(() => undefined);
      await Promise.resolve();
    });

    expect(messageGetter).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Edit: Current Product' }))
      .toBeInTheDocument();
    expect(screen.getByLabelText('Title *')).toHaveValue('Current Product');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      'admin-product-editor-older-message-getter-canary',
    );
    expect(window.location.pathname).toBe('/admin/products/current-product/edit');
    expect(getProductBySlug).toHaveBeenNthCalledWith(1, firestore, 'synthetic-product');
    expect(getProductBySlug).toHaveBeenNthCalledWith(2, firestore, 'current-product');
    expect(getProductBySlug).toHaveBeenCalledTimes(2);
  });

  test('ignores an older hostile success after the current route loads', async () => {
    let resolveOlderLookup;
    const olderLookup = new Promise((resolve) => {
      resolveOlderLookup = resolve;
    });
    getProductBySlug
      .mockReturnValueOnce(olderLookup)
      .mockResolvedValueOnce({
        id: 'current-product',
        slug: 'current-product',
        title: 'Current Product',
        description: 'A made-up current product.',
        imageUrl: '',
        priceCents: 4000,
        status: 'active',
        sizes: [],
        colors: [],
      });

    renderAdminProductEditor();
    expect(await screen.findByText('Loading...')).toBeInTheDocument();

    window.history.pushState({}, '', '/admin/products/current-product/edit');
    fireEvent(window, new PopStateEvent('popstate'));

    expect(await screen.findByRole('heading', { level: 1, name: 'Edit: Current Product' }))
      .toBeInTheDocument();

    const titleGetter = jest.fn(() => {
      throw new Error('admin-product-editor-older-title-getter-canary');
    });
    const olderProduct = Object.defineProperty({
      id: 'older-product',
      slug: 'synthetic-product',
      description: 'An obsolete made-up product.',
      imageUrl: '',
      priceCents: 1000,
      status: 'draft',
      sizes: [],
      colors: [],
    }, 'title', {
      configurable: true,
      get: titleGetter,
    });
    await act(async () => {
      resolveOlderLookup(olderProduct);
      await olderLookup;
      await Promise.resolve();
    });

    expect(titleGetter).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Edit: Current Product' }))
      .toBeInTheDocument();
    expect(screen.getByLabelText('Title *')).toHaveValue('Current Product');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      'admin-product-editor-older-title-getter-canary',
    );
    expect(window.location.pathname).toBe('/admin/products/current-product/edit');
    expect(getProductBySlug).toHaveBeenNthCalledWith(1, firestore, 'synthetic-product');
    expect(getProductBySlug).toHaveBeenNthCalledWith(2, firestore, 'current-product');
    expect(getProductBySlug).toHaveBeenCalledTimes(2);
  });

  test('preserves the fresh new-product route without starting a product lookup', async () => {
    window.history.pushState({}, '', '/admin/products/new');
    render(<App />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Create product' }))
      .toBeInTheDocument();
    expect(screen.getByLabelText('Title *')).toHaveValue('');
    expect(screen.getByLabelText(/^Slug \*/)).toHaveValue('');
    expect(screen.getByLabelText(/^Slug \*/)).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Create product' })).toBeEnabled();
    expect(screen.getByRole('link', { name: /All products/ }))
      .toHaveAttribute('href', '/admin/products');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(getProductBySlug).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/admin/products/new');
  });

  test('preserves AdminGuard denial without starting a product lookup', async () => {
    useAuth.mockReturnValue({
      user: { uid: 'synthetic-non-admin' },
      isLoading: false,
      isAuthenticated: true,
      isMember: true,
      isAdmin: false,
      signIn: jest.fn(),
      signOut: jest.fn(),
      register: jest.fn(),
    });

    renderAdminProductEditor();

    expect(await screen.findByRole('heading', { level: 1, name: 'Admins only' }))
      .toBeInTheDocument();
    expect(screen.getByText('This page is restricted to club admins.'))
      .toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();
    expect(screen.queryByRole('link', { name: /All products/ })).not.toBeInTheDocument();
    expect(getProductBySlug).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/admin/products/synthetic-product/edit');
  });

  test('preserves the existing missing-product result', async () => {
    renderAdminProductEditor();

    expect(await screen.findByText('Product not found')).toBeInTheDocument();
    expect(document.querySelector('form')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(screen.getByRole('link', { name: /All products/ }))
      .toHaveAttribute('href', '/admin/products');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(getProductBySlug).toHaveBeenCalledWith(firestore, 'synthetic-product');
    expect(getProductBySlug).toHaveBeenCalledTimes(1);
  });

  test('preserves the existing loaded product projection and admin route', async () => {
    getProductBySlug.mockResolvedValueOnce({
      id: 'synthetic-product',
      slug: 'synthetic-product',
      title: 'Synthetic Club Shirt',
      description: 'A made-up product used only for this test.',
      imageUrl: 'https://images.example.test/synthetic-club-shirt.jpg',
      priceCents: 3250,
      status: 'active',
      sizes: ['S', 'M'],
      colors: ['Blue', 'Green'],
    });

    renderAdminProductEditor();

    expect(await screen.findByRole('heading', { level: 1, name: 'Edit: Synthetic Club Shirt' }))
      .toBeInTheDocument();
    expect(screen.getByLabelText('Title *')).toHaveValue('Synthetic Club Shirt');
    expect(screen.getByLabelText(/^Slug \*/)).toHaveValue('synthetic-product');
    expect(screen.getByLabelText(/^Slug \*/)).toBeDisabled();
    expect(screen.getByLabelText('Description'))
      .toHaveValue('A made-up product used only for this test.');
    expect(screen.getByLabelText('Price (USD) *')).toHaveValue(32.5);
    expect(screen.getByLabelText(/^Image URL/))
      .toHaveValue('https://images.example.test/synthetic-club-shirt.jpg');
    expect(screen.getByLabelText('Sizes (comma-separated, optional)')).toHaveValue('S, M');
    expect(screen.getByLabelText('Colors (comma-separated, optional)'))
      .toHaveValue('Blue, Green');
    expect(screen.getByLabelText('Status')).toHaveValue('active');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(screen.getByRole('link', { name: /All products/ }))
      .toHaveAttribute('href', '/admin/products');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(getProductBySlug).toHaveBeenCalledWith(firestore, 'synthetic-product');
    expect(getProductBySlug).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/admin/products/synthetic-product/edit');
  });
});

describe('Admin dashboard summary load-failure boundary', () => {
  function timestamp(value) {
    const date = new Date(value);
    return {
      toDate: () => date,
      toMillis: () => date.getTime(),
    };
  }

  function adminEvent({
    id,
    slug,
    title,
    startsAt,
    status = 'open',
    location = 'Synthetic Park',
    capacity = null,
  }) {
    return {
      id,
      slug,
      title,
      startAt: timestamp(startsAt),
      status,
      location,
      capacity,
    };
  }

  function expectSummaryToBeHidden() {
    expect(screen.queryByText('Next event')).not.toBeInTheDocument();
    expect(screen.queryByText('Overall')).not.toBeInTheDocument();
    expect(screen.queryByText('Total events')).not.toBeInTheDocument();
    expect(screen.queryByText('Upcoming')).not.toBeInTheDocument();
    expect(screen.queryByText('Drafts')).not.toBeInTheDocument();
    expect(screen.queryByText('Paid')).not.toBeInTheDocument();
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
    expect(screen.queryByText('Refunded')).not.toBeInTheDocument();
    expect(screen.queryByText('Gross')).not.toBeInTheDocument();
    expect(screen.queryByText(/Capacity:/)).not.toBeInTheDocument();
  }

  function expectManagementNavigation() {
    expect(document.querySelector('a[href="/admin/events"]')).not.toBeNull();
    expect(document.querySelector('a[href="/admin/events/new"]')).not.toBeNull();
    expect(document.querySelector('a[href="/admin/members"]')).not.toBeNull();
    expect(document.querySelector('a[href="/admin/products"]')).not.toBeNull();
    expect(document.querySelector('a[href="/admin/orders"]')).not.toBeNull();
  }

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
    listEventRegistrations.mockResolvedValue([]);
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-01-01T00:00:00Z').getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('hides every summary while the current event lookup is pending', async () => {
    listAllEvents.mockReturnValueOnce(new Promise(() => {}));

    const view = renderAdminDashboard();

    expect(await screen.findByText('Loading...')).toBeInTheDocument();
    expectSummaryToBeHidden();
    expect(screen.getByRole('heading', { level: 1, name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByText('Manage')).toBeInTheDocument();
    expectManagementNavigation();
    expect(listEventRegistrations).not.toHaveBeenCalled();
    view.unmount();
  });

  test('replaces event-list rejection details with one accessible fixed result', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    listAllEvents.mockRejectedValueOnce(Object.assign(
      new Error('admin-summary-private-canary officer@example.test'),
      {
        code: 'firestore/admin-summary-private-canary',
        endpoint: 'https://provider.example.test/?token=admin-summary-secret-canary',
      },
    ));

    renderAdminDashboard();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(ADMIN_DASHBOARD_LOAD_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(document.body).not.toHaveTextContent(
      /admin-summary-private-canary|officer@example\.test|provider\.example|admin-summary-secret-canary/i,
    );
    expect(JSON.stringify(track.mock.calls)).not.toMatch(
      /admin-summary-private-canary|officer@example\.test|provider\.example|admin-summary-secret-canary/i,
    );
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expectSummaryToBeHidden();
    expect(screen.getByRole('heading', { level: 1, name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByText('Manage')).toBeInTheDocument();
    expectManagementNavigation();
    expect(listAllEvents).toHaveBeenCalledWith(firestore);
    expect(listAllEvents).toHaveBeenCalledTimes(1);
    expect(listEventRegistrations).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('does not inspect or log a hostile event-list rejection', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    const messageGetter = jest.fn(() => {
      throw new Error('admin-summary-message-getter-canary');
    });
    listAllEvents.mockRejectedValueOnce(
      Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }),
    );

    renderAdminDashboard();

    expect((await screen.findByRole('alert')).textContent)
      .toBe(ADMIN_DASHBOARD_LOAD_FAILURE);
    expect(messageGetter).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('admin-summary-message-getter-canary');
    expectSummaryToBeHidden();
    expect(listEventRegistrations).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('hides partial event totals when the registration lookup rejects', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    listAllEvents.mockResolvedValueOnce([adminEvent({
      id: 'synthetic-next-event',
      slug: 'synthetic-next-run',
      title: 'Synthetic Next Run',
      startsAt: '2030-01-12T20:00:00Z',
      capacity: 8,
    })]);
    listEventRegistrations.mockRejectedValueOnce(Object.assign(
      new Error('admin-summary-registration-private-canary officer@example.test'),
      {
        endpoint: 'https://provider.example.test/?token=registration-secret-canary',
      },
    ));

    renderAdminDashboard();

    expect((await screen.findByRole('alert')).textContent)
      .toBe(ADMIN_DASHBOARD_LOAD_FAILURE);
    expect(document.body).not.toHaveTextContent(
      /admin-summary-registration-private-canary|officer@example\.test|provider\.example|registration-secret-canary/i,
    );
    expectSummaryToBeHidden();
    expect(listAllEvents).toHaveBeenCalledWith(firestore);
    expect(listEventRegistrations).toHaveBeenCalledWith(
      firestore,
      'synthetic-next-event',
    );
    expect(listEventRegistrations).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('preserves a complete successful empty summary', async () => {
    renderAdminDashboard();

    const overall = (await screen.findByText('Overall')).parentElement;
    expect(overall).toHaveTextContent(/Total events\s*0/);
    expect(overall).toHaveTextContent(/Upcoming\s*0/);
    expect(overall).toHaveTextContent(/Drafts\s*0/);
    expect(screen.queryByText('Next event')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(listAllEvents).toHaveBeenCalledWith(firestore);
    expect(listEventRegistrations).not.toHaveBeenCalled();
  });

  test('preserves complete event, registration, money, and capacity summaries', async () => {
    const selectedEvent = adminEvent({
      id: 'synthetic-next-event',
      slug: 'synthetic-next-run',
      title: 'Synthetic Next Run',
      startsAt: '2030-01-12T20:00:00Z',
      capacity: 8,
    });
    listAllEvents.mockResolvedValueOnce([
      adminEvent({
        id: 'synthetic-later-event',
        slug: 'synthetic-later-run',
        title: 'Synthetic Later Run',
        startsAt: '2031-02-12T20:00:00Z',
        status: 'closed',
      }),
      selectedEvent,
      adminEvent({
        id: 'synthetic-draft-event',
        slug: 'synthetic-draft-run',
        title: 'Synthetic Draft Run',
        startsAt: '2029-01-12T20:00:00Z',
        status: 'draft',
      }),
      adminEvent({
        id: 'synthetic-past-event',
        slug: 'synthetic-past-run',
        title: 'Synthetic Past Run',
        startsAt: '2020-01-12T20:00:00Z',
      }),
    ]);
    listEventRegistrations.mockResolvedValueOnce([
      { status: 'paid', amountCents: 1500 },
      { status: 'paid', amountCents: 2000 },
      { status: 'pending', amountCents: 3500 },
      { status: 'refunded', amountCents: 3500 },
      { status: 'partially_refunded', amountCents: 500 },
    ]);

    renderAdminDashboard();

    const eventLink = await screen.findByRole('link', { name: 'Synthetic Next Run' });
    expect(eventLink).toHaveAttribute(
      'href',
      '/admin/events/synthetic-next-run/registrations',
    );
    expect(screen.getByRole('link', { name: /View signups/ })).toHaveAttribute(
      'href',
      '/admin/events/synthetic-next-run/registrations',
    );
    const nextEventSection = screen.getByText('Next event').parentElement;
    expect(nextEventSection).toHaveTextContent(
      `${formatEventDate(selectedEvent.startAt)} · Synthetic Park`,
    );
    expect(nextEventSection).toHaveTextContent(/Paid\s*2/);
    expect(nextEventSection).toHaveTextContent(/Pending\s*1/);
    expect(nextEventSection).toHaveTextContent(/Refunded\s*2/);
    expect(nextEventSection).toHaveTextContent(/Gross\s*\$35\.00/);
    expect(nextEventSection).toHaveTextContent(/Capacity:\s*3 \/ 8\s*\(38%\)/);
    const overall = screen.getByText('Overall').parentElement;
    expect(overall).toHaveTextContent(/Total events\s*4/);
    expect(overall).toHaveTextContent(/Upcoming\s*3/);
    expect(overall).toHaveTextContent(/Drafts\s*1/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(listEventRegistrations).toHaveBeenCalledWith(
      firestore,
      'synthetic-next-event',
    );
    expect(listEventRegistrations).toHaveBeenCalledTimes(1);
    expect(listAllEvents).toHaveBeenCalledWith(firestore);
    expect(listAllEvents).toHaveBeenCalledTimes(1);
  });

  test('clears a previous summary while a changed database lookup is pending', async () => {
    listAllEvents.mockResolvedValueOnce([adminEvent({
      id: 'synthetic-previous-event',
      slug: 'synthetic-previous-run',
      title: 'Synthetic Previous Run',
      startsAt: '2030-01-12T20:00:00Z',
    })]);
    const view = renderAdminDashboard();
    expect(await screen.findByRole('link', { name: 'Synthetic Previous Run' }))
      .toBeInTheDocument();

    let resolveCurrentLookup;
    listAllEvents.mockReturnValueOnce(new Promise((resolve) => {
      resolveCurrentLookup = resolve;
    }));
    const currentFirestore = { name: 'synthetic-firestore-current-dashboard' };
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore: currentFirestore } },
      isReady: true,
    });
    view.rerender(<App />);

    expect(await screen.findByText('Loading...')).toBeInTheDocument();
    expectSummaryToBeHidden();
    expect(document.body).not.toHaveTextContent('Synthetic Previous Run');

    await act(async () => {
      resolveCurrentLookup([]);
      await Promise.resolve();
    });

    const overall = await screen.findByText('Overall');
    expect(overall.parentElement).toHaveTextContent(/Total events\s*0/);
    expect(screen.queryByText('Next event')).not.toBeInTheDocument();
    expect(listAllEvents).toHaveBeenNthCalledWith(1, firestore);
    expect(listAllEvents).toHaveBeenNthCalledWith(2, currentFirestore);
  });

  test('ignores an older event-list success after a newer empty result', async () => {
    let resolveOlderLookup;
    const olderLookup = new Promise((resolve) => {
      resolveOlderLookup = resolve;
    });
    listAllEvents.mockReturnValueOnce(olderLookup);
    const view = renderAdminDashboard();
    expect(await screen.findByText('Loading...')).toBeInTheDocument();

    const currentFirestore = { name: 'synthetic-firestore-newer-dashboard' };
    listAllEvents.mockResolvedValueOnce([]);
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore: currentFirestore } },
      isReady: true,
    });
    view.rerender(<App />);
    expect((await screen.findByText('Overall')).parentElement)
      .toHaveTextContent(/Total events\s*0/);

    await act(async () => {
      resolveOlderLookup([adminEvent({
        id: 'synthetic-older-event',
        slug: 'synthetic-older-run',
        title: 'Synthetic Older Run',
        startsAt: '2030-01-12T20:00:00Z',
      })]);
      await olderLookup;
      await Promise.resolve();
    });

    expect(screen.getByText('Overall').parentElement)
      .toHaveTextContent(/Total events\s*0/);
    expect(document.body).not.toHaveTextContent('Synthetic Older Run');
    expect(listEventRegistrations).not.toHaveBeenCalled();
    expect(listAllEvents).toHaveBeenNthCalledWith(1, firestore);
    expect(listAllEvents).toHaveBeenNthCalledWith(2, currentFirestore);
  });

  test('ignores an older registration success after a newer empty result', async () => {
    let resolveOlderRegistrations;
    const olderRegistrations = new Promise((resolve) => {
      resolveOlderRegistrations = resolve;
    });
    listAllEvents.mockResolvedValueOnce([adminEvent({
      id: 'synthetic-older-event',
      slug: 'synthetic-older-run',
      title: 'Synthetic Older Run',
      startsAt: '2030-01-12T20:00:00Z',
      capacity: 4,
    })]);
    listEventRegistrations.mockReturnValueOnce(olderRegistrations);
    const view = renderAdminDashboard();
    await waitFor(() => expect(listEventRegistrations).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Loading...')).toBeInTheDocument();
    expectSummaryToBeHidden();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    const currentFirestore = { name: 'synthetic-firestore-newest-dashboard' };
    listAllEvents.mockResolvedValueOnce([]);
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore: currentFirestore } },
      isReady: true,
    });
    view.rerender(<App />);
    expect((await screen.findByText('Overall')).parentElement)
      .toHaveTextContent(/Total events\s*0/);

    await act(async () => {
      resolveOlderRegistrations([{ status: 'paid', amountCents: 4800 }]);
      await olderRegistrations;
      await Promise.resolve();
    });

    expect(screen.queryByText('Next event')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Overall').parentElement)
      .toHaveTextContent(/Total events\s*0/);
    expect(document.body).not.toHaveTextContent('Synthetic Older Run');
    expect(document.body).not.toHaveTextContent('$48.00');
    expect(listAllEvents).toHaveBeenNthCalledWith(1, firestore);
    expect(listAllEvents).toHaveBeenNthCalledWith(2, currentFirestore);
  });

  test('ignores an older hostile registration rejection after a newer success', async () => {
    let rejectOlderRegistrations;
    listAllEvents.mockResolvedValueOnce([adminEvent({
      id: 'synthetic-older-event',
      slug: 'synthetic-older-run',
      title: 'Synthetic Older Run',
      startsAt: '2030-01-12T20:00:00Z',
    })]);
    listEventRegistrations.mockReturnValueOnce(new Promise((_resolve, reject) => {
      rejectOlderRegistrations = reject;
    }));
    const view = renderAdminDashboard();
    await waitFor(() => expect(listEventRegistrations).toHaveBeenCalledTimes(1));

    const currentFirestore = { name: 'synthetic-firestore-latest-dashboard' };
    listAllEvents.mockResolvedValueOnce([]);
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore: currentFirestore } },
      isReady: true,
    });
    view.rerender(<App />);
    expect((await screen.findByText('Overall')).parentElement)
      .toHaveTextContent(/Total events\s*0/);

    const messageGetter = jest.fn(() => {
      throw new Error('admin-summary-older-message-getter-canary');
    });
    await act(async () => {
      rejectOlderRegistrations(Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }));
      await Promise.resolve();
    });

    expect(messageGetter).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Overall').parentElement)
      .toHaveTextContent(/Total events\s*0/);
    expect(document.body).not.toHaveTextContent(
      'admin-summary-older-message-getter-canary',
    );
    expect(listAllEvents).toHaveBeenNthCalledWith(1, firestore);
    expect(listAllEvents).toHaveBeenNthCalledWith(2, currentFirestore);
  });

  test('does not start a registration lookup after the dashboard unmounts', async () => {
    let resolveLookup;
    const pendingLookup = new Promise((resolve) => {
      resolveLookup = resolve;
    });
    listAllEvents.mockReturnValueOnce(pendingLookup);
    const view = renderAdminDashboard();
    expect(await screen.findByText('Loading...')).toBeInTheDocument();
    view.unmount();

    await act(async () => {
      resolveLookup([adminEvent({
        id: 'synthetic-unmounted-event',
        slug: 'synthetic-unmounted-run',
        title: 'Synthetic Unmounted Run',
        startsAt: '2030-01-12T20:00:00Z',
      })]);
      await pendingLookup;
      await Promise.resolve();
    });

    expect(listEventRegistrations).not.toHaveBeenCalled();
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

describe('Admin Orders list-load failure boundary', () => {
  function syntheticTimestamp(value) {
    const date = new Date(value);
    return { toDate: () => date };
  }

  function syntheticOrder({
    id = 'synthetic-order',
    title = 'Synthetic Club Shirt',
    status = 'paid',
    amountCents = 1500,
    createdAt = '2030-01-12T20:00:00Z',
  } = {}) {
    return {
      id,
      productTitle: title,
      buyer: {
        firstName: 'Synthetic',
        lastName: id,
        email: `${id}@example.test`,
      },
      shipping: null,
      size: null,
      color: null,
      amountCents,
      currency: 'usd',
      status,
      trackingNumber: null,
      createdAt: syntheticTimestamp(createdAt),
    };
  }

  function expectOrderResultsToBeHidden() {
    expect(screen.queryAllByText('Paid')).toHaveLength(0);
    expect(screen.queryByText('Gross revenue')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search by buyer or product...'))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('No orders')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Fulfill|Refund|Cancel)$/ }))
      .not.toBeInTheDocument();
  }

  function getSummaryTile(label) {
    return screen.getAllByText(label)
      .find((element) => element.tagName === 'DIV')
      ?.parentElement;
  }

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
      services: { firebaseResources: { app: firebaseApp, firestore } },
      isReady: true,
    });
    listAllOrders.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('hides order-derived content while the current lookup is pending', async () => {
    listAllOrders.mockReturnValueOnce(new Promise(() => {}));

    const view = renderAdminOrders();

    expect(await screen.findByRole('heading', { level: 1, name: 'Orders' }))
      .toBeInTheDocument();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expectOrderResultsToBeHidden();
    expect(screen.getByRole('link', { name: /^Products/ }))
      .toHaveAttribute('href', '/admin/products');
    expect(listAllOrders).toHaveBeenCalledWith(firestore);
    expect(listAllOrders).toHaveBeenCalledTimes(1);
    expect(adminOrderAction).not.toHaveBeenCalled();
    view.unmount();
  });

  test('replaces a rejected lookup with one fixed accessible stop result', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    listAllOrders.mockRejectedValueOnce(Object.assign(
      new Error('admin-orders-private-canary buyer-private@example.test'),
      {
        code: 'firestore/admin-orders-private-canary',
        endpoint: 'https://provider.example.test/?token=admin-orders-secret-canary',
      },
    ));

    renderAdminOrders();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(ADMIN_ORDERS_LOAD_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expectOrderResultsToBeHidden();
    expect(screen.getByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Products/ }))
      .toHaveAttribute('href', '/admin/products');
    expect(document.body).not.toHaveTextContent(
      /admin-orders-private-canary|buyer-private@example\.test|provider\.example|admin-orders-secret-canary/i,
    );
    expect(JSON.stringify(track.mock.calls)).not.toMatch(
      /admin-orders-private-canary|buyer-private@example\.test|provider\.example|admin-orders-secret-canary/i,
    );
    expect(listAllOrders).toHaveBeenCalledWith(firestore);
    expect(listAllOrders).toHaveBeenCalledTimes(1);
    expect(adminOrderAction).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('does not inspect a hostile rejected message property', async () => {
    const messageGetter = jest.fn(() => 'admin-orders-message-getter-canary');
    listAllOrders.mockRejectedValueOnce(
      Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }),
    );

    renderAdminOrders();

    expect((await screen.findByRole('alert')).textContent).toBe(ADMIN_ORDERS_LOAD_FAILURE);
    expect(messageGetter).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('admin-orders-message-getter-canary');
    expectOrderResultsToBeHidden();
    expect(track).not.toHaveBeenCalled();
    expect(adminOrderAction).not.toHaveBeenCalled();
  });

  test('preserves a genuine successful empty-order result', async () => {
    renderAdminOrders();

    expect(await screen.findByText('No orders')).toBeInTheDocument();
    expect(getSummaryTile('Paid')).toHaveTextContent(/Paid\s*0/);
    expect(getSummaryTile('Gross revenue'))
      .toHaveTextContent(/Gross revenue\s*\$0\.00/);
    expect(screen.getByPlaceholderText('Search by buyer or product...')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('all');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(listAllOrders).toHaveBeenCalledWith(firestore);
    expect(listAllOrders).toHaveBeenCalledTimes(1);
    expect(adminOrderAction).not.toHaveBeenCalled();
  });

  test('preserves populated totals, formatting, filtering, and row projection', async () => {
    const paidOrder = syntheticOrder({
      id: 'synthetic-paid-order',
      title: 'Synthetic Paid Shirt',
      amountCents: 1500,
    });
    const fulfilledOrder = syntheticOrder({
      id: 'synthetic-fulfilled-order',
      title: 'Synthetic Fulfilled Hat',
      status: 'fulfilled',
      amountCents: 2500,
      createdAt: '2030-02-13T20:00:00Z',
    });
    const pendingOrder = syntheticOrder({
      id: 'synthetic-pending-order',
      title: 'Synthetic Pending Socks',
      status: 'pending',
      amountCents: 9900,
    });
    const refundedOrder = syntheticOrder({
      id: 'synthetic-refunded-order',
      title: 'Synthetic Refunded Bottle',
      status: 'refunded',
      amountCents: 7500,
    });
    listAllOrders.mockResolvedValueOnce([
      paidOrder,
      fulfilledOrder,
      pendingOrder,
      refundedOrder,
    ]);

    renderAdminOrders();

    expect(await screen.findByText('Synthetic Paid Shirt')).toBeInTheDocument();
    expect(getSummaryTile('Paid')).toHaveTextContent(/Paid\s*2/);
    expect(getSummaryTile('Gross revenue'))
      .toHaveTextContent(/Gross revenue\s*\$40\.00/);
    expect(screen.getByText('synthetic-paid-order@example.test')).toBeInTheDocument();
    expect(screen.getAllByText(
      paidOrder.createdAt.toDate().toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      }),
    ).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Refund' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Cancel' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Fulfill' })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search by buyer or product...'), {
      target: { value: 'fulfilled hat' },
    });
    expect(screen.getByText('Synthetic Fulfilled Hat')).toBeInTheDocument();
    expect(screen.queryByText('Synthetic Paid Shirt')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search by buyer or product...'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'refunded' } });
    expect(screen.getByText('Synthetic Refunded Bottle')).toBeInTheDocument();
    expect(screen.queryByText('Synthetic Fulfilled Hat')).not.toBeInTheDocument();
    expect(listAllOrders).toHaveBeenCalledWith(firestore);
    expect(listAllOrders).toHaveBeenCalledTimes(1);
    expect(adminOrderAction).not.toHaveBeenCalled();
  });

  test('does not reload when only the services wrapper changes', async () => {
    listAllOrders.mockResolvedValueOnce([syntheticOrder()]);
    const view = renderAdminOrders();
    expect(await screen.findByText('Synthetic Club Shirt')).toBeInTheDocument();

    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { app: firebaseApp, firestore } },
      isReady: true,
    });
    view.rerender(<App />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText('Synthetic Club Shirt')).toBeInTheDocument();
    expect(listAllOrders).toHaveBeenCalledTimes(1);
    expect(adminOrderAction).not.toHaveBeenCalled();
  });

  test('hides earlier results while a new Firestore lookup is pending, then shows current empty truth', async () => {
    listAllOrders.mockResolvedValueOnce([syntheticOrder()]);
    const view = renderAdminOrders();
    expect(await screen.findByText('Synthetic Club Shirt')).toBeInTheDocument();

    let resolveCurrentLookup;
    listAllOrders.mockReturnValueOnce(new Promise((resolve) => {
      resolveCurrentLookup = resolve;
    }));
    const currentFirestore = { name: 'synthetic-firestore-current' };
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { app: firebaseApp, firestore: currentFirestore } },
      isReady: true,
    });
    view.rerender(<App />);

    await waitFor(() => expect(listAllOrders).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expectOrderResultsToBeHidden();

    await act(async () => { resolveCurrentLookup([]); });
    expect(await screen.findByText('No orders')).toBeInTheDocument();
    expect(getSummaryTile('Paid')).toHaveTextContent(/Paid\s*0/);
    expect(getSummaryTile('Gross revenue'))
      .toHaveTextContent(/Gross revenue\s*\$0\.00/);
    expect(listAllOrders).toHaveBeenNthCalledWith(1, firestore);
    expect(listAllOrders).toHaveBeenNthCalledWith(2, currentFirestore);
    expect(adminOrderAction).not.toHaveBeenCalled();
  });

  test('hides earlier results when the current Firestore lookup fails', async () => {
    listAllOrders.mockResolvedValueOnce([syntheticOrder()]);
    const view = renderAdminOrders();
    expect(await screen.findByText('Synthetic Club Shirt')).toBeInTheDocument();

    const currentFirestore = { name: 'synthetic-firestore-failure' };
    listAllOrders.mockRejectedValueOnce(new Error('admin-orders-transition-private-canary'));
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { app: firebaseApp, firestore: currentFirestore } },
      isReady: true,
    });
    view.rerender(<App />);

    expect((await screen.findByRole('alert')).textContent).toBe(ADMIN_ORDERS_LOAD_FAILURE);
    expectOrderResultsToBeHidden();
    expect(document.body).not.toHaveTextContent('admin-orders-transition-private-canary');
    expect(listAllOrders).toHaveBeenNthCalledWith(1, firestore);
    expect(listAllOrders).toHaveBeenNthCalledWith(2, currentFirestore);
    expect(adminOrderAction).not.toHaveBeenCalled();
  });

  test('ignores an older success after a newer Firestore lookup resolves empty', async () => {
    let resolveOlderLookup;
    listAllOrders.mockReturnValueOnce(new Promise((resolve) => {
      resolveOlderLookup = resolve;
    }));
    const view = renderAdminOrders();
    await waitFor(() => expect(listAllOrders).toHaveBeenCalledTimes(1));

    const currentFirestore = { name: 'synthetic-firestore-newer-empty' };
    listAllOrders.mockResolvedValueOnce([]);
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { app: firebaseApp, firestore: currentFirestore } },
      isReady: true,
    });
    view.rerender(<App />);
    expect(await screen.findByText('No orders')).toBeInTheDocument();

    await act(async () => { resolveOlderLookup([syntheticOrder({ title: 'Obsolete Order' })]); });

    expect(screen.getByText('No orders')).toBeInTheDocument();
    expect(screen.queryByText('Obsolete Order')).not.toBeInTheDocument();
    expect(getSummaryTile('Paid')).toHaveTextContent(/Paid\s*0/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(listAllOrders).toHaveBeenNthCalledWith(1, firestore);
    expect(listAllOrders).toHaveBeenNthCalledWith(2, currentFirestore);
    expect(adminOrderAction).not.toHaveBeenCalled();
  });

  test('ignores an older hostile rejection after a newer Firestore lookup succeeds', async () => {
    let rejectOlderLookup;
    listAllOrders.mockReturnValueOnce(new Promise((_resolve, reject) => {
      rejectOlderLookup = reject;
    }));
    const view = renderAdminOrders();
    await waitFor(() => expect(listAllOrders).toHaveBeenCalledTimes(1));

    const currentFirestore = { name: 'synthetic-firestore-newer-success' };
    listAllOrders.mockResolvedValueOnce([syntheticOrder({ title: 'Current Order' })]);
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { app: firebaseApp, firestore: currentFirestore } },
      isReady: true,
    });
    view.rerender(<App />);
    expect(await screen.findByText('Current Order')).toBeInTheDocument();

    const messageGetter = jest.fn(() => 'obsolete-order-private-canary');
    await act(async () => {
      rejectOlderLookup(Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }));
      await Promise.resolve();
    });

    expect(messageGetter).not.toHaveBeenCalled();
    expect(screen.getByText('Current Order')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('obsolete-order-private-canary');
    expect(listAllOrders).toHaveBeenNthCalledWith(1, firestore);
    expect(listAllOrders).toHaveBeenNthCalledWith(2, currentFirestore);
    expect(adminOrderAction).not.toHaveBeenCalled();
  });

  test('ignores a hostile rejection after the Admin Orders page unmounts', async () => {
    let rejectLookup;
    listAllOrders.mockReturnValueOnce(new Promise((_resolve, reject) => {
      rejectLookup = reject;
    }));
    const view = renderAdminOrders();
    await waitFor(() => expect(listAllOrders).toHaveBeenCalledTimes(1));
    view.unmount();

    const messageGetter = jest.fn(() => 'unmounted-order-private-canary');
    await act(async () => {
      rejectLookup(Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }));
      await Promise.resolve();
    });

    expect(messageGetter).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
    expect(adminOrderAction).not.toHaveBeenCalled();
  });
});

describe('Admin website-account role-list load failure boundary', () => {
  function syntheticTimestamp(value) {
    const date = new Date(value);
    return { toDate: () => date };
  }

  function syntheticWebsiteAccount({
    uid = 'synthetic-account',
    email = `${uid}@example.test`,
    fullName = 'Synthetic Website Account',
    role = 'member',
    emailVerified = true,
    createdAt = '2030-01-12T20:00:00Z',
  } = {}) {
    return {
      uid,
      email,
      fullName,
      role,
      emailVerified,
      createdAt: syntheticTimestamp(createdAt),
    };
  }

  function expectGenericAdminMembersShell() {
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Admin home/ }))
      .toHaveAttribute('href', '/admin');
    expect(window.location.pathname).toBe('/admin/members');
  }

  function expectWebsiteAccountResultsToBeHidden() {
    [
      'Admins',
      'Members',
      'Pending verification',
      'Total',
      'Admin website access',
      'Member website access',
      'Pending website verification',
      'Total website accounts',
    ].forEach((label) => {
      const summaryLabels = screen.queryAllByText(label)
        .filter((element) => element.tagName === 'DIV');
      expect(summaryLabels).toHaveLength(0);
    });
    expect(screen.queryByPlaceholderText('Search by name or email...'))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('No members matched')).not.toBeInTheDocument();
    expect(screen.queryByText('No website accounts matched')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', {
      name: /^(admin|member|unverified)$/i,
    })).toHaveLength(0);
  }

  function getWebsiteAccountSummaryTile(label) {
    return screen.getByText(label).parentElement;
  }

  function spyOnBrowserConsole() {
    return ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
  }

  beforeEach(() => {
    useAuth.mockReturnValue({
      user: { uid: 'synthetic-current-admin' },
      isLoading: false,
      isAuthenticated: true,
      isMember: true,
      isAdmin: true,
      signIn: jest.fn(),
      signOut: jest.fn(),
      register: jest.fn(),
    });
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { app: firebaseApp, firestore } },
      isReady: true,
    });
    listAllMembers.mockResolvedValue([]);
  });

  afterEach(() => {
    expect(setMemberRole).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  test('hides every account-derived result and role control while the current read is pending', async () => {
    listAllMembers.mockReturnValueOnce(new Promise(() => {}));

    const view = renderAdminMembers();

    expect(await screen.findByText('Loading...')).toBeInTheDocument();
    expectGenericAdminMembersShell();
    expectWebsiteAccountResultsToBeHidden();
    expect(listAllMembers).toHaveBeenCalledWith(firestore);
    expect(listAllMembers).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  test('replaces an ordinary rejection with one fixed accessible stop result', async () => {
    const consoleSpies = spyOnBrowserConsole();
    listAllMembers.mockRejectedValueOnce(Object.assign(
      new Error('admin-members-private-canary officer-private@example.test'),
      {
        code: 'firestore/admin-members-private-canary',
        endpoint: 'https://provider.example.test/?token=admin-members-secret-canary',
      },
    ));

    renderAdminMembers();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(ADMIN_MEMBERS_LOAD_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expectWebsiteAccountResultsToBeHidden();
    expectGenericAdminMembersShell();
    expect(document.body).not.toHaveTextContent(
      /admin-members-private-canary|officer-private@example\.test|provider\.example|admin-members-secret-canary/i,
    );
    expect(JSON.stringify(track.mock.calls)).not.toMatch(
      /admin-members-private-canary|officer-private@example\.test|provider\.example|admin-members-secret-canary/i,
    );
    expect(track).not.toHaveBeenCalled();
    expect(listAllMembers).toHaveBeenCalledWith(firestore);
    expect(listAllMembers).toHaveBeenCalledTimes(1);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('does not inspect, log, measure, or render a hostile rejected value', async () => {
    const consoleSpies = spyOnBrowserConsole();
    const messageGetter = jest.fn(() => 'admin-members-message-getter-canary');
    listAllMembers.mockRejectedValueOnce(
      Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }),
    );

    renderAdminMembers();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(ADMIN_MEMBERS_LOAD_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(messageGetter).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('admin-members-message-getter-canary');
    expect(JSON.stringify(track.mock.calls))
      .not.toContain('admin-members-message-getter-canary');
    expectWebsiteAccountResultsToBeHidden();
    expectGenericAdminMembersShell();
    expect(track).not.toHaveBeenCalled();
    expect(listAllMembers).toHaveBeenCalledWith(firestore);
    expect(listAllMembers).toHaveBeenCalledTimes(1);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('shows a genuine successful empty result with website-account labels', async () => {
    renderAdminMembers();

    expect(await screen.findByText('No website accounts matched')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Website accounts' }))
      .toBeInTheDocument();
    expect(getWebsiteAccountSummaryTile('Admin website access'))
      .toHaveTextContent(/Admin website access\s*0/);
    expect(getWebsiteAccountSummaryTile('Member website access'))
      .toHaveTextContent(/Member website access\s*0/);
    expect(getWebsiteAccountSummaryTile('Pending website verification'))
      .toHaveTextContent(/Pending website verification\s*0/);
    expect(getWebsiteAccountSummaryTile('Total website accounts'))
      .toHaveTextContent(/Total website accounts\s*0/);
    expect(screen.getByPlaceholderText('Search by name or email...')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('all');
    expect(screen.getByRole('option', { name: 'All website roles' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Website role' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Account created' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Change website role to...' }))
      .toBeInTheDocument();
    expect(screen.queryByText('Members')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Role' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Joined' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      /paid annual membership|dues paid|member pricing|discount access/i,
    );
    expect(listAllMembers).toHaveBeenCalledWith(firestore);
    expect(listAllMembers).toHaveBeenCalledTimes(1);
  });

  test('preserves populated projection, filtering, dates, and the self-demotion guard under truthful labels', async () => {
    const currentAdmin = syntheticWebsiteAccount({
      uid: 'synthetic-current-admin',
      fullName: 'Synthetic Current Admin',
      role: 'admin',
      createdAt: '2030-01-12T20:00:00Z',
    });
    const otherAdmin = syntheticWebsiteAccount({
      uid: 'synthetic-other-admin',
      fullName: 'Synthetic Other Admin',
      role: 'admin',
      createdAt: '2030-02-13T20:00:00Z',
    });
    const memberAccount = syntheticWebsiteAccount({
      uid: 'synthetic-member-account',
      fullName: 'Synthetic Member Account',
      role: 'member',
      createdAt: '2030-03-14T20:00:00Z',
    });
    const unverifiedAccount = syntheticWebsiteAccount({
      uid: 'synthetic-unverified-account',
      fullName: 'Synthetic Unverified Account',
      role: 'unverified',
      emailVerified: false,
      createdAt: '2030-04-15T20:00:00Z',
    });
    listAllMembers.mockResolvedValueOnce([
      currentAdmin,
      otherAdmin,
      memberAccount,
      unverifiedAccount,
    ]);

    renderAdminMembers();

    expect(await screen.findByText('Synthetic Current Admin')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Website accounts' }))
      .toBeInTheDocument();
    expect(getWebsiteAccountSummaryTile('Admin website access'))
      .toHaveTextContent(/Admin website access\s*2/);
    expect(getWebsiteAccountSummaryTile('Member website access'))
      .toHaveTextContent(/Member website access\s*1/);
    expect(getWebsiteAccountSummaryTile('Pending website verification'))
      .toHaveTextContent(/Pending website verification\s*1/);
    expect(getWebsiteAccountSummaryTile('Total website accounts'))
      .toHaveTextContent(/Total website accounts\s*4/);
    expect(screen.getByRole('columnheader', { name: 'Website role' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Account created' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Change website role to...' }))
      .toBeInTheDocument();
    expect(screen.getByText('synthetic-member-account@example.test')).toBeInTheDocument();
    expect(screen.getByText(
      memberAccount.createdAt.toDate().toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
      }),
    )).toBeInTheDocument();
    expect(screen.getAllByText('yes').length).toBeGreaterThan(0);
    expect(screen.getByText('no')).toBeInTheDocument();

    const selfRow = screen.getByText('synthetic-current-admin@example.test').closest('tr');
    expect(selfRow).not.toBeNull();
    expect(within(selfRow).getByRole('button', { name: 'member' })).toBeDisabled();
    expect(within(selfRow).getByRole('button', { name: 'unverified' })).toBeDisabled();

    const search = screen.getByPlaceholderText('Search by name or email...');
    fireEvent.change(search, { target: { value: 'member account' } });
    expect(screen.getByText('Synthetic Member Account')).toBeInTheDocument();
    expect(screen.queryByText('Synthetic Current Admin')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: '' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'unverified' } });
    expect(screen.getByText('Synthetic Unverified Account')).toBeInTheDocument();
    expect(screen.queryByText('Synthetic Member Account')).not.toBeInTheDocument();
    expect(screen.queryByText('Members')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Role' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Joined' })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      /paid annual membership|dues paid|member pricing|discount access/i,
    );
    expect(listAllMembers).toHaveBeenCalledWith(firestore);
    expect(listAllMembers).toHaveBeenCalledTimes(1);
  });

  test('does not reload when only the services wrapper changes around the same Firestore object', async () => {
    listAllMembers.mockResolvedValueOnce([syntheticWebsiteAccount()]);
    const view = renderAdminMembers();
    expect(await screen.findByText('Synthetic Website Account')).toBeInTheDocument();

    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { app: firebaseApp, firestore } },
      isReady: true,
    });
    view.rerender(<App />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText('Synthetic Website Account')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(listAllMembers).toHaveBeenCalledTimes(1);
  });

  test('ignores an older success after a newer read for the same Firestore object', async () => {
    let resolveOlderLookup;
    listAllMembers.mockReturnValueOnce(new Promise((resolve) => {
      resolveOlderLookup = resolve;
    }));
    const view = renderAdminMembers();
    await waitFor(() => expect(listAllMembers).toHaveBeenCalledTimes(1));

    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { app: firebaseApp, firestore } },
      isReady: false,
    });
    view.rerender(<App />);

    listAllMembers.mockResolvedValueOnce([
      syntheticWebsiteAccount({ fullName: 'Current Same-Database Account' }),
    ]);
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { app: firebaseApp, firestore } },
      isReady: true,
    });
    view.rerender(<App />);

    expect(await screen.findByText('Current Same-Database Account')).toBeInTheDocument();

    await act(async () => {
      resolveOlderLookup([
        syntheticWebsiteAccount({ fullName: 'Obsolete Same-Database Account' }),
      ]);
      await Promise.resolve();
    });

    expect(screen.getByText('Current Same-Database Account')).toBeInTheDocument();
    expect(screen.queryByText('Obsolete Same-Database Account')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(listAllMembers).toHaveBeenNthCalledWith(1, firestore);
    expect(listAllMembers).toHaveBeenNthCalledWith(2, firestore);
    expect(listAllMembers).toHaveBeenCalledTimes(2);
  });

  test('hides earlier account truth during a current Firestore read, then shows current empty truth', async () => {
    listAllMembers.mockResolvedValueOnce([syntheticWebsiteAccount()]);
    const view = renderAdminMembers();
    expect(await screen.findByText('Synthetic Website Account')).toBeInTheDocument();

    let resolveCurrentLookup;
    listAllMembers.mockReturnValueOnce(new Promise((resolve) => {
      resolveCurrentLookup = resolve;
    }));
    const currentFirestore = { name: 'synthetic-members-firestore-current' };
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { app: firebaseApp, firestore: currentFirestore } },
      isReady: true,
    });
    view.rerender(<App />);

    await waitFor(() => expect(listAllMembers).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expectWebsiteAccountResultsToBeHidden();
    expect(screen.queryByText('Synthetic Website Account')).not.toBeInTheDocument();

    await act(async () => { resolveCurrentLookup([]); });
    expect(await screen.findByText('No website accounts matched')).toBeInTheDocument();
    expect(getWebsiteAccountSummaryTile('Total website accounts'))
      .toHaveTextContent(/Total website accounts\s*0/);
    expect(listAllMembers).toHaveBeenNthCalledWith(1, firestore);
    expect(listAllMembers).toHaveBeenNthCalledWith(2, currentFirestore);
  });

  test('hides earlier account truth when the current Firestore read rejects', async () => {
    const consoleSpies = spyOnBrowserConsole();
    listAllMembers.mockResolvedValueOnce([syntheticWebsiteAccount()]);
    const view = renderAdminMembers();
    expect(await screen.findByText('Synthetic Website Account')).toBeInTheDocument();

    const currentFirestore = { name: 'synthetic-members-firestore-failure' };
    listAllMembers.mockRejectedValueOnce(
      new Error('admin-members-transition-private-canary'),
    );
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { app: firebaseApp, firestore: currentFirestore } },
      isReady: true,
    });
    view.rerender(<App />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(ADMIN_MEMBERS_LOAD_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expectWebsiteAccountResultsToBeHidden();
    expect(screen.queryByText('Synthetic Website Account')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('admin-members-transition-private-canary');
    expect(track).not.toHaveBeenCalled();
    expect(listAllMembers).toHaveBeenNthCalledWith(1, firestore);
    expect(listAllMembers).toHaveBeenNthCalledWith(2, currentFirestore);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('ignores an older success after a newer Firestore read resolves empty', async () => {
    let resolveOlderLookup;
    listAllMembers.mockReturnValueOnce(new Promise((resolve) => {
      resolveOlderLookup = resolve;
    }));
    const view = renderAdminMembers();
    await waitFor(() => expect(listAllMembers).toHaveBeenCalledTimes(1));

    const currentFirestore = { name: 'synthetic-members-firestore-newer-empty' };
    listAllMembers.mockResolvedValueOnce([]);
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { app: firebaseApp, firestore: currentFirestore } },
      isReady: true,
    });
    view.rerender(<App />);
    expect(await screen.findByText('No website accounts matched')).toBeInTheDocument();

    await act(async () => {
      resolveOlderLookup([syntheticWebsiteAccount({ fullName: 'Obsolete Website Account' })]);
      await Promise.resolve();
    });

    expect(screen.getByText('No website accounts matched')).toBeInTheDocument();
    expect(screen.queryByText('Obsolete Website Account')).not.toBeInTheDocument();
    expect(getWebsiteAccountSummaryTile('Total website accounts'))
      .toHaveTextContent(/Total website accounts\s*0/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(listAllMembers).toHaveBeenNthCalledWith(1, firestore);
    expect(listAllMembers).toHaveBeenNthCalledWith(2, currentFirestore);
  });

  test('ignores an older hostile rejection after a newer Firestore read succeeds', async () => {
    const consoleSpies = spyOnBrowserConsole();
    let rejectOlderLookup;
    listAllMembers.mockReturnValueOnce(new Promise((_resolve, reject) => {
      rejectOlderLookup = reject;
    }));
    const view = renderAdminMembers();
    await waitFor(() => expect(listAllMembers).toHaveBeenCalledTimes(1));

    const currentFirestore = { name: 'synthetic-members-firestore-newer-success' };
    listAllMembers.mockResolvedValueOnce([
      syntheticWebsiteAccount({ fullName: 'Current Website Account' }),
    ]);
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { app: firebaseApp, firestore: currentFirestore } },
      isReady: true,
    });
    view.rerender(<App />);
    expect(await screen.findByText('Current Website Account')).toBeInTheDocument();

    const messageGetter = jest.fn(() => 'obsolete-admin-members-private-canary');
    await act(async () => {
      rejectOlderLookup(Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }));
      await Promise.resolve();
    });

    expect(messageGetter).not.toHaveBeenCalled();
    expect(screen.getByText('Current Website Account')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('obsolete-admin-members-private-canary');
    expect(track).not.toHaveBeenCalled();
    expect(listAllMembers).toHaveBeenNthCalledWith(1, firestore);
    expect(listAllMembers).toHaveBeenNthCalledWith(2, currentFirestore);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('ignores a hostile rejection after the Admin website-account page unmounts', async () => {
    const consoleSpies = spyOnBrowserConsole();
    let rejectLookup;
    listAllMembers.mockReturnValueOnce(new Promise((_resolve, reject) => {
      rejectLookup = reject;
    }));
    const view = renderAdminMembers();
    await waitFor(() => expect(listAllMembers).toHaveBeenCalledTimes(1));
    view.unmount();

    const messageGetter = jest.fn(() => 'unmounted-admin-members-private-canary');
    await act(async () => {
      rejectLookup(Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }));
      await Promise.resolve();
    });

    expect(messageGetter).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });
});
