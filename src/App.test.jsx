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
  lookupRegistration,
} from './services/events/eventsService';
import {
  adminRegistrationAction,
  createEvent,
  listAllEvents,
  listRegistrationsForEvent,
  updateEvent,
} from './services/events/adminService';
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
    lookupRegistration: jest.fn(),
  };
});

jest.mock('./services/events/adminService', () => {
  const actual = jest.requireActual('./services/events/adminService');
  return {
    ...actual,
    adminRegistrationAction: jest.fn(),
    createEvent: jest.fn(),
    listAllEvents: jest.fn(),
    listRegistrationsForEvent: jest.fn(),
    updateEvent: jest.fn(),
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
  lookupRegistration.mockReset();
  adminRegistrationAction.mockReset();
  createEvent.mockReset();
  listAllEvents.mockReset();
  listRegistrationsForEvent.mockReset();
  updateEvent.mockReset();
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
const ADMIN_EVENT_EDITOR_LOAD_FAILURE = 'We could not load this event right now. Please try again later.';
const ADMIN_EVENT_REGISTRATIONS_LOAD_FAILURE = 'We could not load registrations right now. Stop and contact the event lead, treasurer, and platform owner before taking any registration action.';
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

function registrationSuccessPath({
  event = 'synthetic-confirmation-event',
  reg = 'synthetic-confirmation-registration',
  token = 'synthetic-confirmation-capability',
} = {}) {
  const params = new URLSearchParams();
  if (event !== null) params.set('event', event);
  if (reg !== null) params.set('reg', reg);
  if (token !== null) params.set('token', token);
  return `/register/success?${params.toString()}`;
}

function renderRegistrationSuccess(query) {
  window.history.pushState({}, '', registrationSuccessPath(query));
  return render(<App />);
}

let registrationHistoryKey = 0;

function navigateRegistrationSuccess(query) {
  registrationHistoryKey += 1;
  const currentIndex = typeof window.history.state?.idx === 'number'
    ? window.history.state.idx
    : 0;
  const nextState = {
    usr: null,
    key: `synthetic-registration-${registrationHistoryKey}`,
    idx: currentIndex + 1,
  };
  window.history.pushState(nextState, '', registrationSuccessPath(query));
  fireEvent(window, new PopStateEvent('popstate', { state: nextState }));
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

function renderAdminEventEditor(slug = 'synthetic-event') {
  window.history.pushState({}, '', `/admin/events/${slug}/edit`);
  return render(<App />);
}

function renderAdminEventRegistrations(slug = 'synthetic-event') {
  window.history.pushState({}, '', `/admin/events/${slug}/registrations`);
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

describe('DATA-001A1 registration confirmation attempt isolation', () => {
  const routeA = {
    event: 'synthetic-route-a-event',
    reg: 'synthetic-route-a-registration',
    token: 'synthetic-route-a-capability',
  };
  const routeB = {
    event: 'synthetic-route-b-event',
    reg: 'synthetic-route-b-registration',
    token: 'synthetic-route-b-capability',
  };

  function readyLocator(app = firebaseApp) {
    return {
      services: { firebaseResources: { app } },
      isReady: true,
    };
  }

  function registrationResult({
    status = 'pending',
    id = 'synthetic-confirmation-registration',
    eventId = 'synthetic-confirmation-event',
    firstName = 'Synthetic',
    email = 'synthetic-runner@example.test',
    amountCents = 1500,
  } = {}) {
    return {
      id,
      status,
      priceTier: 'nonMember',
      amountCents,
      currency: 'usd',
      runner: {
        firstName,
        lastName: 'Runner',
        email,
        shirtSize: null,
      },
      eventId,
      paidAt: null,
      createdAt: null,
    };
  }

  function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  }

  async function flushRegistrationWork() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function resolveDeferred(job, value) {
    await act(async () => {
      job.resolve(value);
      await job.promise;
      await Promise.resolve();
    });
  }

  async function rejectDeferred(job, reason) {
    await act(async () => {
      job.reject(reason);
      await job.promise.catch(() => undefined);
      await Promise.resolve();
    });
  }

  async function advancePollIntervals(remaining) {
    if (remaining === 0) return;
    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    await advancePollIntervals(remaining - 1);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2030-01-12T16:00:00Z'));
    useServiceLocator.mockReturnValue(readyLocator());
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test('hides route A immediately and keeps a pending route B unconfirmed', async () => {
    const routeBLookup = deferred();
    lookupRegistration
      .mockResolvedValueOnce(registrationResult({
        status: 'paid',
        id: routeA.reg,
        eventId: routeA.event,
        firstName: 'Prior',
        email: 'prior-runner@example.test',
      }))
      .mockReturnValueOnce(routeBLookup.promise);

    renderRegistrationSuccess(routeA);
    await flushRegistrationWork();
    expect(screen.getByRole('heading', { name: "You're in!" })).toBeInTheDocument();
    expect(document.body).toHaveTextContent('prior-runner@example.test');

    navigateRegistrationSuccess(routeB);
    const immediateRouteText = document.body.textContent;

    await resolveDeferred(routeBLookup, registrationResult({
      status: 'pending',
      id: routeB.reg,
      eventId: routeB.event,
      firstName: 'Pending',
      email: 'pending-runner@example.test',
    }));
    const pendingRouteText = document.body.textContent;

    expect(immediateRouteText).toContain('Processing your registration...');
    expect(immediateRouteText).not.toMatch(
      /Prior|prior-runner@example\.test|synthetic-route-a-registration|You're in!/,
    );
    expect(pendingRouteText).toContain('Processing your registration...');
    expect(pendingRouteText).not.toMatch(
      /Pending|pending-runner@example\.test|synthetic-route-b-registration|You're in!/,
    );
    expect(track).toHaveBeenCalledTimes(1);
  });

  test.each([
    'route',
    'services identity',
    'Firebase app identity',
    'readiness',
  ])('hides confirmed details in the first %s-change commit', async (changedBoundary) => {
    const initialLocator = readyLocator();
    const commits = [];
    const captureCommit = () => {
      commits.push(document.querySelector('main')?.textContent ?? '');
    };
    const profiledApp = () => (
      <React.Profiler id="registration-confirmation" onRender={captureCommit}>
        <App />
      </React.Profiler>
    );
    useServiceLocator.mockReturnValue(initialLocator);
    lookupRegistration.mockResolvedValueOnce(registrationResult({
      status: 'paid',
      id: routeA.reg,
      eventId: routeA.event,
      firstName: 'Prior',
      email: 'prior-commit@example.test',
    }));
    window.history.pushState({}, '', registrationSuccessPath(routeA));
    const view = render(profiledApp());
    await flushRegistrationWork();
    expect(document.body).toHaveTextContent('prior-commit@example.test');

    commits.length = 0;
    lookupRegistration.mockReturnValueOnce(new Promise(() => {}));
    if (changedBoundary === 'route') {
      navigateRegistrationSuccess(routeB);
    } else {
      let nextLocator = readyLocator();
      if (changedBoundary === 'Firebase app identity') {
        initialLocator.services.firebaseResources.app = {
          name: 'synthetic-confirmation-app-b',
        };
        nextLocator = initialLocator;
      } else if (changedBoundary === 'readiness') {
        nextLocator = { services: initialLocator.services, isReady: false };
      }
      useServiceLocator.mockReturnValue(nextLocator);
      view.rerender(profiledApp());
    }

    expect(commits).not.toHaveLength(0);
    expect(commits[0]).toContain('Processing your registration...');
    expect(commits[0]).not.toMatch(
      /Prior|prior-commit@example\.test|synthetic-route-a-registration|You're in!/,
    );
  });

  test('keeps one attempt when the router republishes the same history entry', async () => {
    const commits = [];
    const captureCommit = () => {
      commits.push(document.querySelector('main')?.textContent ?? '');
    };
    lookupRegistration.mockResolvedValueOnce(registrationResult({
      status: 'paid',
      id: routeA.reg,
      eventId: routeA.event,
      firstName: 'Current',
      email: 'same-history-entry@example.test',
    }));
    window.history.pushState({}, '', registrationSuccessPath(routeA));
    render(
      <React.Profiler id="registration-confirmation" onRender={captureCommit}>
        <App />
      </React.Profiler>,
    );
    await flushRegistrationWork();
    expect(document.body).toHaveTextContent('same-history-entry@example.test');

    commits.length = 0;
    const sameEntryState = {
      ...window.history.state,
      usr: { syntheticObjectRefresh: true },
    };
    window.history.replaceState(
      sameEntryState,
      '',
      registrationSuccessPath(routeA),
    );
    fireEvent(window, new PopStateEvent('popstate', { state: sameEntryState }));
    await flushRegistrationWork();

    expect(commits).not.toHaveLength(0);
    expect(document.body).toHaveTextContent('same-history-entry@example.test');
    expect(lookupRegistration).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['event', { ...routeA, event: routeB.event }],
    ['registration', { ...routeA, reg: routeB.reg }],
    ['token', { ...routeA, token: routeB.token }],
  ])('hides confirmed details when one history key changes only %s', async (
    _changedField,
    changedRoute,
  ) => {
    const routeBLookup = deferred();
    const commits = [];
    const captureCommit = () => {
      commits.push(document.querySelector('main')?.textContent ?? '');
    };
    lookupRegistration
      .mockResolvedValueOnce(registrationResult({
        status: 'paid',
        id: routeA.reg,
        eventId: routeA.event,
        firstName: 'Prior',
        email: 'prior-same-key@example.test',
      }))
      .mockReturnValueOnce(routeBLookup.promise);
    window.history.pushState({}, '', registrationSuccessPath(routeA));
    render(
      <React.Profiler id="registration-confirmation" onRender={captureCommit}>
        <App />
      </React.Profiler>,
    );
    await flushRegistrationWork();
    expect(document.body).toHaveTextContent('prior-same-key@example.test');
    expect(track).toHaveBeenCalledTimes(1);

    commits.length = 0;
    const preservedHistoryState = { ...window.history.state };
    const preservedHistoryKey = window.history.state?.key;
    window.history.replaceState(
      preservedHistoryState,
      '',
      registrationSuccessPath(changedRoute),
    );
    fireEvent(window, new PopStateEvent('popstate', { state: preservedHistoryState }));

    expect(window.history.state?.key).toBe(preservedHistoryKey);
    expect(commits).not.toHaveLength(0);
    expect(commits[0]).toContain('Processing your registration...');
    expect(commits[0]).not.toMatch(
      /Prior|prior-same-key@example\.test|synthetic-route-a-registration|You're in!/,
    );
    expect(lookupRegistration).toHaveBeenNthCalledWith(2, firebaseApp, {
      eventId: changedRoute.event,
      registrationId: changedRoute.reg,
      token: changedRoute.token,
    });

    await resolveDeferred(routeBLookup, registrationResult({
      status: 'pending',
      id: changedRoute.reg,
      eventId: changedRoute.event,
      firstName: 'Pending',
      email: 'pending-same-key@example.test',
    }));

    expect(screen.getByRole('heading', { name: 'Processing your registration...' }))
      .toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(
      /prior-same-key@example\.test|pending-same-key@example\.test|You're in!/,
    );
    expect(track).toHaveBeenCalledTimes(1);
  });

  test('ignores a stale route success before inspecting it or emitting analytics', async () => {
    const staleLookup = deferred();
    lookupRegistration
      .mockReturnValueOnce(staleLookup.promise)
      .mockResolvedValueOnce(registrationResult({
        status: 'paid',
        id: routeB.reg,
        eventId: routeB.event,
        firstName: 'Current',
        email: 'current-runner@example.test',
      }));

    renderRegistrationSuccess(routeA);
    navigateRegistrationSuccess(routeB);
    await flushRegistrationWork();

    const statusGetter = jest.fn(() => 'paid');
    const staleResult = registrationResult({
      id: routeA.reg,
      eventId: routeA.event,
      firstName: 'Obsolete',
      email: 'obsolete-runner@example.test',
    });
    delete staleResult.status;
    Object.defineProperty(staleResult, 'status', {
      configurable: true,
      enumerable: true,
      get: statusGetter,
    });
    await resolveDeferred(staleLookup, staleResult);

    expect(screen.getByRole('heading', { name: "You're in!" })).toBeInTheDocument();
    expect(document.body).toHaveTextContent('current-runner@example.test');
    expect(document.body).not.toHaveTextContent('obsolete-runner@example.test');
    expect(statusGetter).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith(analyticsEvents.registrationConfirmed, {
      eventId: routeB.event,
      status: 'paid',
      amount_cents: 1500,
    });
    expect(track).toHaveBeenCalledTimes(1);
  });

  test('ignores a stale hostile rejection before reading code or details', async () => {
    const staleLookup = deferred();
    lookupRegistration
      .mockReturnValueOnce(staleLookup.promise)
      .mockResolvedValueOnce(registrationResult({
        status: 'comp',
        id: routeB.reg,
        eventId: routeB.event,
        firstName: 'Current',
        email: 'current-comp@example.test',
        amountCents: 0,
      }));

    renderRegistrationSuccess(routeA);
    navigateRegistrationSuccess(routeB);
    await flushRegistrationWork();

    const codeGetter = jest.fn(() => '');
    const detailsGetter = jest.fn(() => ({ code: 'permission-denied' }));
    const hostileRejection = {};
    Object.defineProperties(hostileRejection, {
      code: { configurable: true, get: codeGetter },
      details: { configurable: true, get: detailsGetter },
    });
    await rejectDeferred(staleLookup, hostileRejection);

    expect(codeGetter).not.toHaveBeenCalled();
    expect(detailsGetter).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: "You're in!" })).toBeInTheDocument();
    expect(document.body).toHaveTextContent('current-comp@example.test');
    expect(screen.queryByText("Can't confirm this registration")).not.toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    expect(track).toHaveBeenCalledTimes(1);
  });

  test('clears a route-owned poll timer and prevents another old lookup', async () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    const routeBLookup = deferred();
    const neverSettles = new Promise(() => {});
    lookupRegistration
      .mockResolvedValueOnce(registrationResult({
        status: 'pending',
        id: routeA.reg,
        eventId: routeA.event,
      }))
      .mockReturnValueOnce(routeBLookup.promise)
      .mockReturnValue(neverSettles);

    renderRegistrationSuccess(routeA);
    await flushRegistrationWork();
    const pollTimerIndex = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 2000);
    expect(pollTimerIndex).toBeGreaterThanOrEqual(0);
    const pollTimerId = setTimeoutSpy.mock.results[pollTimerIndex].value;

    navigateRegistrationSuccess(routeB);
    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    const routeACalls = lookupRegistration.mock.calls.filter(([, args]) => (
      args.registrationId === routeA.reg
    ));
    expect(routeACalls).toHaveLength(1);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(pollTimerId);
    expect(lookupRegistration).toHaveBeenCalledTimes(2);
  });

  test.each([
    'services identity',
    'Firebase app identity',
  ])('invalidates an in-flight lookup when %s changes', async (changedIdentity) => {
    const appA = { name: 'synthetic-confirmation-app-a' };
    const appB = changedIdentity === 'Firebase app identity'
      ? { name: 'synthetic-confirmation-app-b' }
      : appA;
    const initialLocator = readyLocator(appA);
    const staleLookup = deferred();
    lookupRegistration
      .mockReturnValueOnce(staleLookup.promise)
      .mockResolvedValueOnce(registrationResult({
        status: 'paid',
        id: routeA.reg,
        eventId: routeA.event,
        firstName: 'Current',
        email: 'current-service@example.test',
      }));
    useServiceLocator.mockReturnValue(initialLocator);

    const view = renderRegistrationSuccess(routeA);
    if (changedIdentity === 'Firebase app identity') {
      initialLocator.services.firebaseResources.app = appB;
      useServiceLocator.mockReturnValue(initialLocator);
    } else {
      useServiceLocator.mockReturnValue(readyLocator(appB));
    }
    view.rerender(<App />);
    await flushRegistrationWork();
    await resolveDeferred(staleLookup, registrationResult({
      status: 'paid',
      id: routeA.reg,
      eventId: routeA.event,
      firstName: 'Obsolete',
      email: 'obsolete-service@example.test',
    }));

    expect(lookupRegistration).toHaveBeenNthCalledWith(1, appA, {
      eventId: routeA.event,
      registrationId: routeA.reg,
      token: routeA.token,
    });
    expect(lookupRegistration).toHaveBeenNthCalledWith(2, appB, {
      eventId: routeA.event,
      registrationId: routeA.reg,
      token: routeA.token,
    });
    expect(document.body).toHaveTextContent('current-service@example.test');
    expect(document.body).not.toHaveTextContent('obsolete-service@example.test');
    expect(track).toHaveBeenCalledTimes(1);
  });

  test('invalidates an in-flight lookup when readiness is lost', async () => {
    const staleLookup = deferred();
    lookupRegistration.mockReturnValueOnce(staleLookup.promise);
    const view = renderRegistrationSuccess(routeA);

    useServiceLocator.mockReturnValue({ services: null, isReady: false });
    view.rerender(<App />);
    await resolveDeferred(staleLookup, registrationResult({
      status: 'paid',
      id: routeA.reg,
      eventId: routeA.event,
      firstName: 'Obsolete',
      email: 'obsolete-readiness@example.test',
    }));

    expect(screen.getByRole('heading', { name: 'Processing your registration...' }))
      .toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('obsolete-readiness@example.test');
    expect(track).not.toHaveBeenCalled();
  });

  test('treats A to B to A as three generations', async () => {
    const firstRouteALookup = deferred();
    const routeBLookup = deferred();
    lookupRegistration
      .mockReturnValueOnce(firstRouteALookup.promise)
      .mockReturnValueOnce(routeBLookup.promise)
      .mockResolvedValueOnce(registrationResult({
        status: 'paid',
        id: routeA.reg,
        eventId: routeA.event,
        firstName: 'Current',
        email: 'current-returned-route@example.test',
      }));

    renderRegistrationSuccess(routeA);
    navigateRegistrationSuccess(routeB);
    navigateRegistrationSuccess(routeA);
    await flushRegistrationWork();
    await resolveDeferred(firstRouteALookup, registrationResult({
      status: 'paid',
      id: routeA.reg,
      eventId: routeA.event,
      firstName: 'Obsolete',
      email: 'obsolete-first-route@example.test',
    }));

    expect(document.body).toHaveTextContent('current-returned-route@example.test');
    expect(document.body).not.toHaveTextContent('obsolete-first-route@example.test');
    expect(track).toHaveBeenCalledTimes(1);
  });

  test('keeps the second StrictMode effect current and ignores the first effect', async () => {
    const firstEffectLookup = deferred();
    const secondEffectLookup = deferred();
    lookupRegistration
      .mockReturnValueOnce(firstEffectLookup.promise)
      .mockReturnValueOnce(secondEffectLookup.promise);
    window.history.pushState({}, '', registrationSuccessPath(routeA));

    render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
    expect(lookupRegistration).toHaveBeenCalledTimes(2);

    await resolveDeferred(secondEffectLookup, registrationResult({
      status: 'paid',
      id: routeA.reg,
      eventId: routeA.event,
      firstName: 'Current',
      email: 'current-strict-mode@example.test',
    }));
    const statusGetter = jest.fn(() => 'paid');
    const firstEffectResult = registrationResult({
      id: routeA.reg,
      eventId: routeA.event,
      firstName: 'Obsolete',
      email: 'obsolete-strict-mode@example.test',
    });
    delete firstEffectResult.status;
    Object.defineProperty(firstEffectResult, 'status', {
      configurable: true,
      enumerable: true,
      get: statusGetter,
    });
    await resolveDeferred(firstEffectLookup, firstEffectResult);

    expect(statusGetter).not.toHaveBeenCalled();
    expect(document.body).toHaveTextContent('current-strict-mode@example.test');
    expect(document.body).not.toHaveTextContent('obsolete-strict-mode@example.test');
    expect(track).toHaveBeenCalledWith(analyticsEvents.registrationConfirmed, {
      eventId: routeA.event,
      status: 'paid',
      amount_cents: 1500,
    });
    expect(track).toHaveBeenCalledTimes(1);
  });

  test('does not emit analytics when a lookup resolves after unmount', async () => {
    const staleLookup = deferred();
    lookupRegistration.mockReturnValueOnce(staleLookup.promise);
    const view = renderRegistrationSuccess(routeA);

    view.unmount();
    await resolveDeferred(staleLookup, registrationResult({
      status: 'paid',
      id: routeA.reg,
      eventId: routeA.event,
      firstName: 'Unmounted',
      email: 'unmounted-runner@example.test',
    }));

    expect(track).not.toHaveBeenCalled();
  });

  test('does not inspect a rejection that arrives after unmount', async () => {
    const staleLookup = deferred();
    lookupRegistration.mockReturnValueOnce(staleLookup.promise);
    const view = renderRegistrationSuccess(routeA);
    const codeGetter = jest.fn(() => '');
    const detailsGetter = jest.fn(() => ({ code: 'permission-denied' }));
    const hostileRejection = {};
    Object.defineProperties(hostileRejection, {
      code: { configurable: true, get: codeGetter },
      details: { configurable: true, get: detailsGetter },
    });

    view.unmount();
    await rejectDeferred(staleLookup, hostileRejection);

    expect(codeGetter).not.toHaveBeenCalled();
    expect(detailsGetter).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  test.each([
    ['paid', 1500],
    ['comp', 0],
  ])('preserves a current %s confirmation and bounded analytics', async (status, amountCents) => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    lookupRegistration.mockResolvedValueOnce(registrationResult({
      status,
      id: routeA.reg,
      eventId: routeA.event,
      firstName: 'Confirmed',
      email: 'confirmed-runner@example.test',
      amountCents,
    }));

    renderRegistrationSuccess(routeA);
    await flushRegistrationWork();

    expect(screen.getByRole('heading', { name: "You're in!" })).toBeInTheDocument();
    expect(document.body).toHaveTextContent('Confirmed');
    expect(document.body).toHaveTextContent('confirmed-runner@example.test');
    expect(document.body).toHaveTextContent(routeA.reg);
    expect(track).toHaveBeenCalledWith(analyticsEvents.registrationConfirmed, {
      eventId: routeA.event,
      status,
      amount_cents: amountCents,
    });
    expect(track).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(track.mock.calls)).not.toContain(routeA.token);
    expect(setTimeoutSpy.mock.calls.some(([, delay]) => delay === 2000)).toBe(false);
  });

  test('preserves current pending polling before a paid confirmation', async () => {
    lookupRegistration
      .mockResolvedValueOnce(registrationResult({
        status: 'pending',
        id: routeA.reg,
        eventId: routeA.event,
      }))
      .mockResolvedValueOnce(registrationResult({
        status: 'paid',
        id: routeA.reg,
        eventId: routeA.event,
        firstName: 'Polled',
        email: 'polled-runner@example.test',
      }));

    renderRegistrationSuccess(routeA);
    await flushRegistrationWork();
    expect(screen.getByRole('heading', { name: 'Processing your registration...' }))
      .toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();

    await advancePollIntervals(1);

    expect(screen.getByRole('heading', { name: "You're in!" })).toBeInTheDocument();
    expect(document.body).toHaveTextContent('polled-runner@example.test');
    expect(lookupRegistration).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenCalledTimes(1);
  });

  test('preserves the current pending timeout outcome', async () => {
    lookupRegistration.mockResolvedValue(registrationResult({
      status: 'pending',
      id: routeA.reg,
      eventId: routeA.event,
    }));

    renderRegistrationSuccess(routeA);
    await flushRegistrationWork();
    await advancePollIntervals(15);

    expect(screen.getByRole('heading', { name: 'Processing your registration...' }))
      .toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();

    await advancePollIntervals(1);

    expect(screen.getByRole('heading', { name: 'Still processing...' })).toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();
  });

  test.each([
    ['top-level', { code: 'permission-denied' }],
    ['nested', { details: { code: 'permission-denied' } }],
    ['nested after an empty direct code', { code: '', details: { code: 'permission-denied' } }],
  ])('preserves the current %s permission-denied outcome', async (_shape, rejection) => {
    lookupRegistration.mockRejectedValueOnce(rejection);

    renderRegistrationSuccess(routeA);
    await flushRegistrationWork();

    expect(screen.getByRole('heading', { name: "Can't confirm this registration" }))
      .toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();
  });

  test('preserves a truthy malformed direct code ahead of nested permission denial', async () => {
    lookupRegistration.mockRejectedValueOnce({
      code: {},
      details: { code: 'permission-denied' },
    });

    renderRegistrationSuccess(routeA);
    await flushRegistrationWork();

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.queryByText("Can't confirm this registration")).not.toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();
  });

  test('classifies current accessor error fields without invoking them', async () => {
    const codeGetter = jest.fn(() => 'permission-denied');
    const detailsGetter = jest.fn(() => ({ code: 'permission-denied' }));
    const rejection = {};
    Object.defineProperties(rejection, {
      code: { configurable: true, get: codeGetter },
      details: { configurable: true, get: detailsGetter },
    });
    lookupRegistration.mockRejectedValueOnce(rejection);

    renderRegistrationSuccess(routeA);
    await flushRegistrationWork();

    expect(codeGetter).not.toHaveBeenCalled();
    expect(detailsGetter).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.queryByText("Can't confirm this registration")).not.toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();
  });

  test('classifies inherited error fields without invoking them', async () => {
    const codeGetter = jest.fn(() => 'permission-denied');
    const detailsGetter = jest.fn(() => ({ code: 'permission-denied' }));
    const prototype = {};
    Object.defineProperties(prototype, {
      code: { configurable: true, get: codeGetter },
      details: { configurable: true, get: detailsGetter },
    });
    const rejection = Object.create(prototype);
    lookupRegistration.mockRejectedValueOnce(rejection);

    renderRegistrationSuccess(routeA);
    await flushRegistrationWork();

    expect(codeGetter).not.toHaveBeenCalled();
    expect(detailsGetter).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.queryByText("Can't confirm this registration")).not.toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();
  });

  test('contains a throwing descriptor trap while classifying a current error', async () => {
    const descriptorTrap = jest.fn(() => {
      throw new Error('synthetic-descriptor-trap-private-canary');
    });
    const valueReadTrap = jest.fn(() => {
      throw new Error('synthetic-value-read-trap-private-canary');
    });
    const rejection = new Proxy({}, {
      get: valueReadTrap,
      getOwnPropertyDescriptor: descriptorTrap,
    });
    lookupRegistration.mockRejectedValueOnce(rejection);

    renderRegistrationSuccess(routeA);
    await flushRegistrationWork();

    expect(descriptorTrap).toHaveBeenCalledTimes(2);
    expect(valueReadTrap).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      /synthetic-(descriptor|value-read)-trap-private-canary/,
    );
    expect(screen.queryByText("Can't confirm this registration")).not.toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();
  });

  test('preserves a generic current lookup error without exposing its message', async () => {
    lookupRegistration.mockRejectedValueOnce(
      new Error('synthetic-registration-provider-private-canary'),
    );

    renderRegistrationSuccess(routeA);
    await flushRegistrationWork();

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      'synthetic-registration-provider-private-canary',
    );
    expect(track).not.toHaveBeenCalled();
  });

  test('waits for services and then uses the current Firebase app and capability', async () => {
    useServiceLocator.mockReturnValue({ services: null, isReady: false });
    lookupRegistration.mockResolvedValueOnce(registrationResult({
      status: 'paid',
      id: routeA.reg,
      eventId: routeA.event,
      firstName: 'Ready',
      email: 'ready-runner@example.test',
    }));

    const view = renderRegistrationSuccess(routeA);
    expect(screen.getByRole('heading', { name: 'Processing your registration...' }))
      .toBeInTheDocument();
    expect(lookupRegistration).not.toHaveBeenCalled();

    useServiceLocator.mockReturnValue(readyLocator());
    view.rerender(<App />);
    await flushRegistrationWork();

    expect(lookupRegistration).toHaveBeenCalledWith(firebaseApp, {
      eventId: routeA.event,
      registrationId: routeA.reg,
      token: routeA.token,
    });
    expect(lookupRegistration).toHaveBeenCalledTimes(1);
    expect(document.body).toHaveTextContent('ready-runner@example.test');
  });

  test('preserves the missing-parameter error without starting a lookup', () => {
    renderRegistrationSuccess({ ...routeA, token: null });

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(lookupRegistration).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
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

describe('Admin Event editor load-failure boundary', () => {
  function syntheticAdminEvent({
    slug = 'synthetic-event',
    title = 'Synthetic Club Run',
  } = {}) {
    const timestamp = (year, month, day, hour, minute) => ({
      toDate: () => new Date(year, month, day, hour, minute),
    });
    return {
      id: slug,
      slug,
      title,
      description: 'A made-up event used only for this test.',
      startAt: timestamp(2030, 0, 12, 9, 30),
      endAt: timestamp(2030, 0, 12, 11, 0),
      location: 'Synthetic Park',
      locationDetails: 'Synthetic entrance',
      capacity: 40,
      status: 'open',
      visibility: 'public',
      pricing: {
        memberCents: 2500,
        nonMemberCents: 3000,
        earlyBirdCents: 2000,
      },
      waiverText: 'Synthetic waiver text.',
      waiverVersion: '7',
      registrationOpensAt: null,
      registrationClosesAt: null,
      heroImageUrl: '',
      customFields: [],
      volunteerEnabled: false,
      volunteerFields: [],
      resultsUrl: null,
      resultsText: null,
    };
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
    getEventBySlug.mockResolvedValue(null);
  });

  afterEach(() => {
    expect(createEvent).not.toHaveBeenCalled();
    expect(updateEvent).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  test('keeps a pending edit lookup in a non-editable loading state', async () => {
    getEventBySlug.mockReturnValueOnce(new Promise(() => {}));

    renderAdminEventEditor();

    expect(await screen.findByText('Loading...')).toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(getEventBySlug).toHaveBeenCalledWith(firestore, 'synthetic-event');
    expect(getEventBySlug).toHaveBeenCalledTimes(1);
  });

  test('replaces rejected load details with one fixed accessible result and no event form', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    getEventBySlug.mockRejectedValueOnce(Object.assign(
      new Error('admin-event-editor-private-canary officer@example.test'),
      {
        code: 'firestore/admin-event-editor-private-canary',
        endpoint: 'https://provider.example.test/?token=admin-event-editor-secret-canary',
      },
    ));

    renderAdminEventEditor();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(ADMIN_EVENT_EDITOR_LOAD_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(document.body).not.toHaveTextContent(
      /admin-event-editor-private-canary|officer@example\.test|provider\.example|admin-event-editor-secret-canary/i,
    );
    expect(JSON.stringify(track.mock.calls)).not.toMatch(
      /admin-event-editor-private-canary|officer@example\.test|provider\.example|admin-event-editor-secret-canary/i,
    );
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(screen.queryByText('Event not found')).not.toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Edit event' }))
      .toBeInTheDocument();
    expect(screen.getByRole('link', { name: /All events/ }))
      .toHaveAttribute('href', '/admin/events');
    expect(getEventBySlug).toHaveBeenCalledWith(firestore, 'synthetic-event');
    expect(getEventBySlug).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('does not inspect, log, or measure a hostile load rejection', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    const messageGetter = jest.fn(() => 'admin-event-editor-message-getter-canary');
    getEventBySlug.mockRejectedValueOnce(
      Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }),
    );

    renderAdminEventEditor();

    expect((await screen.findByRole('alert')).textContent)
      .toBe(ADMIN_EVENT_EDITOR_LOAD_FAILURE);
    expect(messageGetter).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('admin-event-editor-message-getter-canary');
    expect(JSON.stringify(track.mock.calls))
      .not.toContain('admin-event-editor-message-getter-canary');
    expect(document.querySelector('form')).toBeNull();
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('treats a current missing event as a non-editable result', async () => {
    renderAdminEventEditor();

    expect(await screen.findByText('Event not found')).toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Edit event' }))
      .toBeInTheDocument();
    expect(screen.getByRole('link', { name: /All events/ }))
      .toHaveAttribute('href', '/admin/events');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(getEventBySlug).toHaveBeenCalledWith(firestore, 'synthetic-event');
    expect(getEventBySlug).toHaveBeenCalledTimes(1);
  });

  test('hides an earlier event while a changed database lookup is pending and rejected', async () => {
    getEventBySlug.mockResolvedValueOnce(syntheticAdminEvent());
    const view = renderAdminEventEditor();
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit: Synthetic Club Run' }))
      .toBeInTheDocument();

    let rejectCurrentLookup;
    const currentLookup = new Promise((_resolve, reject) => {
      rejectCurrentLookup = reject;
    });
    getEventBySlug.mockReturnValueOnce(currentLookup);
    const currentFirestore = { name: 'synthetic-firestore-current-event-editor' };
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore: currentFirestore } },
      isReady: true,
    });
    view.rerender(<App />);

    await waitFor(() => expect(getEventBySlug).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();
    expect(document.body).not.toHaveTextContent('Synthetic Club Run');

    await act(async () => {
      rejectCurrentLookup(new Error('admin-event-editor-current-private-canary'));
      await currentLookup.catch(() => undefined);
      await Promise.resolve();
    });

    expect((await screen.findByRole('alert')).textContent)
      .toBe(ADMIN_EVENT_EDITOR_LOAD_FAILURE);
    expect(document.querySelector('form')).toBeNull();
    expect(document.body).not.toHaveTextContent('Synthetic Club Run');
    expect(document.body).not.toHaveTextContent('admin-event-editor-current-private-canary');
    expect(getEventBySlug).toHaveBeenNthCalledWith(1, firestore, 'synthetic-event');
    expect(getEventBySlug).toHaveBeenNthCalledWith(
      2,
      currentFirestore,
      'synthetic-event',
    );
  });

  test('hides the earlier route while the current route lookup is pending', async () => {
    getEventBySlug.mockResolvedValueOnce(syntheticAdminEvent());
    const view = renderAdminEventEditor();
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit: Synthetic Club Run' }))
      .toBeInTheDocument();

    let resolveCurrentLookup;
    const currentLookup = new Promise((resolve) => { resolveCurrentLookup = resolve; });
    getEventBySlug.mockReturnValueOnce(currentLookup);
    window.history.pushState({}, '', '/admin/events/current-event/edit');
    fireEvent(window, new PopStateEvent('popstate'));

    await waitFor(() => expect(getEventBySlug).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();
    expect(document.body).not.toHaveTextContent('Synthetic Club Run');

    await act(async () => {
      resolveCurrentLookup(syntheticAdminEvent({
        slug: 'current-event',
        title: 'Current Synthetic Run',
      }));
      await currentLookup;
      await Promise.resolve();
    });

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Edit: Current Synthetic Run',
    })).toBeInTheDocument();
    expect(screen.getByLabelText('Title *')).toHaveValue('Current Synthetic Run');
    expect(getEventBySlug).toHaveBeenNthCalledWith(1, firestore, 'synthetic-event');
    expect(getEventBySlug).toHaveBeenNthCalledWith(2, firestore, 'current-event');
    view.unmount();
  });

  test('recovers from a failed database lookup on a later current success', async () => {
    getEventBySlug.mockRejectedValueOnce(new Error('admin-event-editor-first-canary'));
    const view = renderAdminEventEditor();
    expect((await screen.findByRole('alert')).textContent)
      .toBe(ADMIN_EVENT_EDITOR_LOAD_FAILURE);

    const recoveredFirestore = { name: 'synthetic-firestore-recovered-event-editor' };
    getEventBySlug.mockResolvedValueOnce(syntheticAdminEvent({
      title: 'Recovered Synthetic Run',
    }));
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore: recoveredFirestore } },
      isReady: true,
    });
    view.rerender(<App />);

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Edit: Recovered Synthetic Run',
    })).toBeInTheDocument();
    expect(screen.getByLabelText('Title *')).toHaveValue('Recovered Synthetic Run');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('admin-event-editor-first-canary');
    expect(getEventBySlug).toHaveBeenNthCalledWith(1, firestore, 'synthetic-event');
    expect(getEventBySlug).toHaveBeenNthCalledWith(
      2,
      recoveredFirestore,
      'synthetic-event',
    );
  });

  test('does not reload for a new services wrapper with the same database and route', async () => {
    getEventBySlug.mockResolvedValue(syntheticAdminEvent());
    const view = renderAdminEventEditor();
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit: Synthetic Club Run' }))
      .toBeInTheDocument();

    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore } },
      isReady: true,
    });
    view.rerender(<App />);
    await act(async () => { await Promise.resolve(); });

    expect(getEventBySlug).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Edit: Synthetic Club Run' }))
      .toBeInTheDocument();
  });

  test('never restores a resolved form while the same database becomes ready again', async () => {
    getEventBySlug.mockResolvedValueOnce(syntheticAdminEvent());
    const view = renderAdminEventEditor();
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit: Synthetic Club Run' }))
      .toBeInTheDocument();

    useServiceLocator.mockReturnValue({ services: null, isReady: false });
    view.rerender(<App />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();

    let resolveCurrentLookup;
    const currentLookup = new Promise((resolve) => { resolveCurrentLookup = resolve; });
    getEventBySlug.mockReturnValueOnce(currentLookup);
    const transientForms = [];
    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches('form') || node.querySelector('form')) transientForms.push(node);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore } },
      isReady: true,
    });
    view.rerender(<App />);

    await waitFor(() => expect(getEventBySlug).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });
    observer.disconnect();
    expect(transientForms).toHaveLength(0);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('Synthetic Club Run');

    await act(async () => {
      resolveCurrentLookup(syntheticAdminEvent({ title: 'Current Readiness Run' }));
      await currentLookup;
      await Promise.resolve();
    });

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Edit: Current Readiness Run',
    })).toBeInTheDocument();
    expect(screen.getByLabelText('Title *')).toHaveValue('Current Readiness Run');
  });

  test('ignores an older same-route result after a readiness cycle starts a new attempt', async () => {
    let resolveOlderLookup;
    const olderLookup = new Promise((resolve) => { resolveOlderLookup = resolve; });
    getEventBySlug.mockReturnValueOnce(olderLookup);
    const view = renderAdminEventEditor();
    expect(await screen.findByText('Loading...')).toBeInTheDocument();

    useServiceLocator.mockReturnValue({ services: null, isReady: false });
    view.rerender(<App />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();

    getEventBySlug.mockResolvedValueOnce(syntheticAdminEvent({
      title: 'Current Readiness Run',
    }));
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore } },
      isReady: true,
    });
    view.rerender(<App />);
    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Edit: Current Readiness Run',
    })).toBeInTheDocument();

    const titleGetter = jest.fn(() => {
      throw new Error('admin-event-editor-readiness-title-getter-canary');
    });
    const olderEvent = Object.defineProperty(
      syntheticAdminEvent({ title: 'Obsolete Readiness Run' }),
      'title',
      { configurable: true, get: titleGetter },
    );
    await act(async () => {
      resolveOlderLookup(olderEvent);
      await olderLookup;
      await Promise.resolve();
    });

    expect(titleGetter).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Edit: Current Readiness Run',
    })).toBeInTheDocument();
    expect(screen.getByLabelText('Title *')).toHaveValue('Current Readiness Run');
    expect(document.body).not.toHaveTextContent(
      'admin-event-editor-readiness-title-getter-canary',
    );
    expect(getEventBySlug).toHaveBeenNthCalledWith(1, firestore, 'synthetic-event');
    expect(getEventBySlug).toHaveBeenNthCalledWith(2, firestore, 'synthetic-event');
    expect(getEventBySlug).toHaveBeenCalledTimes(2);
  });

  test('ignores an older hostile rejection after the current route loads', async () => {
    let rejectOlderLookup;
    const olderLookup = new Promise((_resolve, reject) => {
      rejectOlderLookup = reject;
    });
    getEventBySlug
      .mockReturnValueOnce(olderLookup)
      .mockResolvedValueOnce(syntheticAdminEvent({
        slug: 'current-event',
        title: 'Current Synthetic Run',
      }));

    renderAdminEventEditor();
    expect(await screen.findByText('Loading...')).toBeInTheDocument();
    window.history.pushState({}, '', '/admin/events/current-event/edit');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Edit: Current Synthetic Run',
    })).toBeInTheDocument();

    const messageGetter = jest.fn(() => {
      throw new Error('admin-event-editor-older-message-getter-canary');
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
    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Edit: Current Synthetic Run',
    })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      'admin-event-editor-older-message-getter-canary',
    );
    expect(getEventBySlug).toHaveBeenNthCalledWith(1, firestore, 'synthetic-event');
    expect(getEventBySlug).toHaveBeenNthCalledWith(2, firestore, 'current-event');
  });

  test('ignores an older hostile success after the current route loads', async () => {
    let resolveOlderLookup;
    const olderLookup = new Promise((resolve) => {
      resolveOlderLookup = resolve;
    });
    getEventBySlug
      .mockReturnValueOnce(olderLookup)
      .mockResolvedValueOnce(syntheticAdminEvent({
        slug: 'current-event',
        title: 'Current Synthetic Run',
      }));

    renderAdminEventEditor();
    expect(await screen.findByText('Loading...')).toBeInTheDocument();
    window.history.pushState({}, '', '/admin/events/current-event/edit');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Edit: Current Synthetic Run',
    })).toBeInTheDocument();

    const titleGetter = jest.fn(() => {
      throw new Error('admin-event-editor-older-title-getter-canary');
    });
    const olderEvent = Object.defineProperty(
      syntheticAdminEvent({ title: 'Obsolete Synthetic Run' }),
      'title',
      { configurable: true, get: titleGetter },
    );
    await act(async () => {
      resolveOlderLookup(olderEvent);
      await olderLookup;
      await Promise.resolve();
    });

    expect(titleGetter).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Edit: Current Synthetic Run',
    })).toBeInTheDocument();
    expect(screen.getByLabelText('Title *')).toHaveValue('Current Synthetic Run');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      'admin-event-editor-older-title-getter-canary',
    );
  });

  test('does not inspect an event result after the editor unmounts', async () => {
    let resolveLookup;
    const lookup = new Promise((resolve) => { resolveLookup = resolve; });
    getEventBySlug.mockReturnValueOnce(lookup);
    const view = renderAdminEventEditor();
    expect(await screen.findByText('Loading...')).toBeInTheDocument();
    view.unmount();

    const titleGetter = jest.fn(() => {
      throw new Error('admin-event-editor-unmounted-title-getter-canary');
    });
    const unmountedEvent = Object.defineProperty(
      syntheticAdminEvent(),
      'title',
      { configurable: true, get: titleGetter },
    );
    await act(async () => {
      resolveLookup(unmountedEvent);
      await lookup;
      await Promise.resolve();
    });

    expect(titleGetter).not.toHaveBeenCalled();
  });

  test('preserves the new-event route without starting an edit lookup', async () => {
    window.history.pushState({}, '', '/admin/events/new');
    render(<App />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Create event' }))
      .toBeInTheDocument();
    expect(screen.getByLabelText('Title *')).toHaveValue('');
    expect(screen.getByLabelText(/^Slug \(URL path\) \*/)).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Create event' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(getEventBySlug).not.toHaveBeenCalled();
  });

  test('starts a blank new-event draft after leaving a loaded edit route', async () => {
    getEventBySlug.mockResolvedValueOnce(syntheticAdminEvent());
    renderAdminEventEditor();
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit: Synthetic Club Run' }))
      .toBeInTheDocument();

    window.history.pushState({}, '', '/admin/events/new');
    fireEvent(window, new PopStateEvent('popstate'));

    expect(await screen.findByRole('heading', { level: 1, name: 'Create event' }))
      .toBeInTheDocument();
    expect(screen.getByLabelText('Title *')).toHaveValue('');
    expect(screen.getByLabelText(/^Slug \(URL path\) \*/)).toHaveValue('');
    expect(screen.getByLabelText(/^Slug \(URL path\) \*/)).toBeEnabled();
    expect(screen.getByLabelText('Description')).toHaveValue('');
    expect(screen.getByLabelText('Member price')).toHaveValue(null);
    expect(screen.getByLabelText('Waiver text')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Create event' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(getEventBySlug).toHaveBeenCalledTimes(1);
  });

  test('keeps a new-event draft across readiness changes and an equivalent wrapper', async () => {
    window.history.pushState({}, '', '/admin/events/new');
    const view = render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Create event' }))
      .toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Title *'), {
      target: { value: 'Synthetic Draft Run' },
    });
    expect(screen.getByLabelText(/^Slug \(URL path\) \*/)).toHaveValue('synthetic-draft-run');

    useServiceLocator.mockReturnValue({ services: null, isReady: false });
    view.rerender(<App />);
    expect(screen.getByLabelText('Title *')).toHaveValue('Synthetic Draft Run');
    expect(screen.getByLabelText(/^Slug \(URL path\) \*/)).toHaveValue('synthetic-draft-run');

    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore } },
      isReady: true,
    });
    view.rerender(<App />);

    expect(screen.getByLabelText('Title *')).toHaveValue('Synthetic Draft Run');
    expect(screen.getByLabelText(/^Slug \(URL path\) \*/)).toHaveValue('synthetic-draft-run');
    expect(getEventBySlug).not.toHaveBeenCalled();
  });

  test('preserves the loaded event projection without submitting the form', async () => {
    getEventBySlug.mockResolvedValueOnce(syntheticAdminEvent());

    renderAdminEventEditor();

    expect(await screen.findByRole('heading', { level: 1, name: 'Edit: Synthetic Club Run' }))
      .toBeInTheDocument();
    expect(screen.getByLabelText('Title *')).toHaveValue('Synthetic Club Run');
    expect(screen.getByLabelText(/^Slug \(URL path\) \*/)).toHaveValue('synthetic-event');
    expect(screen.getByLabelText(/^Slug \(URL path\) \*/)).toBeDisabled();
    expect(screen.getByLabelText('Description'))
      .toHaveValue('A made-up event used only for this test.');
    expect(screen.getByLabelText('Location')).toHaveValue('Synthetic Park');
    expect(screen.getByLabelText('Capacity')).toHaveValue(40);
    expect(screen.getByLabelText('Status')).toHaveValue('open');
    expect(screen.getByLabelText('Visibility')).toHaveValue('public');
    expect(screen.getByLabelText('Member price')).toHaveValue(25);
    expect(screen.getByLabelText('Non-member price')).toHaveValue(30);
    expect(screen.getByLabelText(/^Waiver version/)).toHaveValue('7');
    expect(screen.getByLabelText('Waiver text')).toHaveValue('Synthetic waiver text.');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(getEventBySlug).toHaveBeenCalledWith(firestore, 'synthetic-event');
    expect(getEventBySlug).toHaveBeenCalledTimes(1);
  });
});

describe('Admin Event registrations load-failure privacy boundary', () => {
  let originalFetch;

  function syntheticEvent({
    slug = 'synthetic-event',
    title = 'Synthetic Registration Run',
  } = {}) {
    return {
      id: slug,
      slug,
      title,
      startAt: { toDate: () => new Date(2030, 0, 12, 9, 30) },
      location: 'Synthetic Registration Park',
      capacity: 40,
      status: 'open',
      visibility: 'public',
      pricing: { memberCents: 2500, nonMemberCents: 3000 },
    };
  }

  function syntheticRegistration({
    id = 'synthetic-paid-registration',
    status = 'paid',
    amountCents = 2500,
    firstName = 'Synthetic',
    lastName = 'Runner',
  } = {}) {
    return {
      id,
      status,
      amountCents,
      signupType: 'participant',
      priceTier: 'member',
      runner: {
        firstName,
        lastName,
        email: `${id}@example.test`,
        shirtSize: 'M',
      },
    };
  }

  function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, reject, resolve };
  }

  function expectRegistrationResultsToBeHidden(...privateText) {
    expect(document.body).not.toHaveTextContent(
      /Synthetic Registration Run|Synthetic Registration Park|synthetic-paid-registration@example\.test/i,
    );
    privateText.forEach((text) => expect(document.body).not.toHaveTextContent(text));
    expect(screen.queryByText('Paid registrations')).not.toBeInTheDocument();
    expect(screen.queryByText('Refunds')).not.toBeInTheDocument();
    expect(screen.queryByText('Gross revenue')).not.toBeInTheDocument();
    expect(screen.queryByText('Refunded amount')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search by name or email...'))
      .not.toBeInTheDocument();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: '+ Late add' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Comp registration' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('No registrations')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {
      name: /^(Refund|Partial|Sub|Cancel|Note|Issue full refund)$/,
    })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', {
      name: /^(Refund full|Partial refund|Cancel|Substitute runner|Add note|Comp registration|Late add)/,
    })).not.toBeInTheDocument();
  }

  function setAdminLocator(currentFirestore = firestore) {
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { app: firebaseApp, firestore: currentFirestore } },
      isReady: true,
    });
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
    setAdminLocator();
    getEventBySlug.mockResolvedValue(syntheticEvent());
    listRegistrationsForEvent.mockResolvedValue([]);
    originalFetch = global.fetch;
    global.fetch = jest.fn();
    jest.spyOn(window, 'prompt').mockImplementation(() => null);
    jest.spyOn(window, 'confirm').mockImplementation(() => false);
  });

  afterEach(() => {
    try {
      expect(adminRegistrationAction).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(window.prompt).not.toHaveBeenCalled();
      expect(window.confirm).not.toHaveBeenCalled();
    } finally {
      if (originalFetch === undefined) delete global.fetch;
      else global.fetch = originalFetch;
      jest.restoreAllMocks();
    }
  });

  test('preserves AdminGuard denial without starting either lookup', async () => {
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

    renderAdminEventRegistrations();

    expect(await screen.findByRole('heading', { level: 1, name: 'Admins only' }))
      .toBeInTheDocument();
    expect(getEventBySlug).not.toHaveBeenCalled();
    expect(listRegistrationsForEvent).not.toHaveBeenCalled();
  });

  test('hides all registration results while the event lookup is pending', async () => {
    getEventBySlug.mockReturnValueOnce(new Promise(() => {}));

    const view = renderAdminEventRegistrations();

    expect(await screen.findByText('Loading...')).toBeInTheDocument();
    expectRegistrationResultsToBeHidden();
    expect(screen.getByRole('link', { name: /All events/ }))
      .toHaveAttribute('href', '/admin/events');
    expect(getEventBySlug).toHaveBeenCalledWith(firestore, 'synthetic-event');
    expect(listRegistrationsForEvent).not.toHaveBeenCalled();
    view.unmount();
  });

  test('hides all registration results while the registrations lookup is pending', async () => {
    listRegistrationsForEvent.mockReturnValueOnce(new Promise(() => {}));

    const view = renderAdminEventRegistrations();

    await waitFor(() => expect(listRegistrationsForEvent).toHaveBeenCalledWith(
      firestore,
      'synthetic-event',
    ));
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expectRegistrationResultsToBeHidden();
    view.unmount();
  });

  test.each([
    ['event', () => getEventBySlug.mockRejectedValueOnce(new Error(
      'admin-event-registrations-event-private-canary officer@example.test',
    ))],
    ['registrations', () => listRegistrationsForEvent.mockRejectedValueOnce(new Error(
      'admin-event-registrations-list-private-canary runner@example.test',
    ))],
  ])('replaces a rejected %s lookup with one fixed accessible stop result', async (
    _stage,
    arrange,
  ) => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    arrange();

    renderAdminEventRegistrations();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(ADMIN_EVENT_REGISTRATIONS_LOAD_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(document.body).not.toHaveTextContent(
      /admin-event-registrations-(event|list)-private-canary|officer@example\.test|runner@example\.test/i,
    );
    expectRegistrationResultsToBeHidden();
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('does not inspect a hostile event rejection or start the registrations lookup', async () => {
    const messageGetter = jest.fn(() => 'admin-event-registrations-message-getter-canary');
    getEventBySlug.mockRejectedValueOnce(
      Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }),
    );

    renderAdminEventRegistrations();

    expect((await screen.findByRole('alert')).textContent)
      .toBe(ADMIN_EVENT_REGISTRATIONS_LOAD_FAILURE);
    expect(messageGetter).not.toHaveBeenCalled();
    expect(listRegistrationsForEvent).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent(
      'admin-event-registrations-message-getter-canary',
    );
    expect(track).not.toHaveBeenCalled();
  });

  test('does not inspect a hostile registrations rejection after the event resolves', async () => {
    const messageGetter = jest.fn(() => 'admin-registrations-message-getter-canary');
    listRegistrationsForEvent.mockRejectedValueOnce(
      Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }),
    );

    renderAdminEventRegistrations();

    expect((await screen.findByRole('alert')).textContent)
      .toBe(ADMIN_EVENT_REGISTRATIONS_LOAD_FAILURE);
    expect(messageGetter).not.toHaveBeenCalled();
    expect(listRegistrationsForEvent).toHaveBeenCalledTimes(1);
    expectRegistrationResultsToBeHidden('admin-registrations-message-getter-canary');
    expect(track).not.toHaveBeenCalled();
  });

  test('keeps a missing event distinct and never reads orphaned registrations', async () => {
    getEventBySlug.mockResolvedValueOnce(null);
    listRegistrationsForEvent.mockResolvedValueOnce([
      syntheticRegistration({ firstName: 'Orphaned', lastName: 'Runner' }),
    ]);

    renderAdminEventRegistrations();

    expect(await screen.findByText('Event not found')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(listRegistrationsForEvent).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent(/Orphaned Runner|synthetic-paid-registration/i);
    expectRegistrationResultsToBeHidden();
  });

  test('preserves a complete successful empty registration result', async () => {
    renderAdminEventRegistrations();

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Synthetic Registration Run',
    })).toBeInTheDocument();
    expect(document.body).toHaveTextContent('Synthetic Registration Park');
    expect(screen.getByText('Paid registrations').nextElementSibling).toHaveTextContent(/^0$/);
    expect(screen.getByText('Refunds').nextElementSibling).toHaveTextContent(/^0$/);
    expect(screen.getByText('Gross revenue').nextElementSibling).toHaveTextContent(/^\$0\.00$/);
    expect(screen.getByText('Refunded amount').nextElementSibling)
      .toHaveTextContent(/^\$0\.00$/);
    expect(screen.getByPlaceholderText('Search by name or email...')).toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '+ Late add' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Comp registration' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('No registrations');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(getEventBySlug).toHaveBeenCalledWith(firestore, 'synthetic-event');
    expect(listRegistrationsForEvent).toHaveBeenCalledWith(firestore, 'synthetic-event');
  });

  test('preserves populated totals, filtering, rows, and action entry points', async () => {
    listRegistrationsForEvent.mockResolvedValueOnce([
      syntheticRegistration(),
      syntheticRegistration({
        id: 'synthetic-refunded-registration',
        status: 'partially_refunded',
        amountCents: 500,
        firstName: 'Refunded',
        lastName: 'Runner',
      }),
    ]);

    renderAdminEventRegistrations();

    expect(await screen.findByText('synthetic-paid-registration@example.test'))
      .toBeInTheDocument();
    expect(screen.getByText('synthetic-refunded-registration@example.test'))
      .toBeInTheDocument();
    expect(screen.getByText('Paid registrations').nextElementSibling).toHaveTextContent(/^1$/);
    expect(screen.getByText('Refunds').nextElementSibling).toHaveTextContent(/^1$/);
    expect(screen.getByText('Gross revenue').nextElementSibling)
      .toHaveTextContent(/^\$25\.00$/);
    expect(screen.getByText('Refunded amount').nextElementSibling)
      .toHaveTextContent(/^\$5\.00$/);
    expect(screen.getAllByRole('button', { name: 'Refund' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Sub' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Note' })).toHaveLength(2);

    fireEvent.change(screen.getByPlaceholderText('Search by name or email...'), {
      target: { value: 'refunded' },
    });
    expect(screen.queryByText('synthetic-paid-registration@example.test'))
      .not.toBeInTheDocument();
    expect(screen.getByText('synthetic-refunded-registration@example.test'))
      .toBeInTheDocument();
  });

  test('does not reload for an equivalent services wrapper and database', async () => {
    const view = renderAdminEventRegistrations();
    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Synthetic Registration Run',
    })).toBeInTheDocument();

    setAdminLocator();
    view.rerender(<App />);
    await act(async () => { await Promise.resolve(); });

    expect(getEventBySlug).toHaveBeenCalledTimes(1);
    expect(listRegistrationsForEvent).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Synthetic Registration Run',
    })).toBeInTheDocument();
  });

  test('hides old runner data, controls, and a modal during a changed-database lookup', async () => {
    listRegistrationsForEvent.mockResolvedValueOnce([syntheticRegistration()]);
    const view = renderAdminEventRegistrations();
    expect(await screen.findByText('synthetic-paid-registration@example.test'))
      .toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Refund' })[0]);
    expect(screen.getByRole('heading', {
      name: /Refund full — synthetic-paid-registration@example\.test/,
    })).toBeInTheDocument();

    const currentRegistrations = deferred();
    getEventBySlug.mockResolvedValueOnce(syntheticEvent({
      title: 'Current Database Registration Run',
    }));
    listRegistrationsForEvent.mockReturnValueOnce(currentRegistrations.promise);
    const currentFirestore = { name: 'synthetic-current-registration-firestore' };
    setAdminLocator(currentFirestore);
    view.rerender(<App />);

    await waitFor(() => expect(listRegistrationsForEvent).toHaveBeenNthCalledWith(
      2,
      currentFirestore,
      'synthetic-event',
    ));
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expectRegistrationResultsToBeHidden();
    expect(getEventBySlug).toHaveBeenNthCalledWith(
      2,
      currentFirestore,
      'synthetic-event',
    );

    await act(async () => {
      currentRegistrations.resolve([syntheticRegistration({
        id: 'current-database-registration',
        firstName: 'Current',
      })]);
      await currentRegistrations.promise;
    });

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Current Database Registration Run',
    })).toBeInTheDocument();
    expect(screen.getByText('current-database-registration@example.test'))
      .toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search by name or email...')).toHaveValue('');
    expect(document.body).not.toHaveTextContent('synthetic-paid-registration@example.test');
    expect(screen.queryByRole('heading', { name: /Refund full —/ })).not.toBeInTheDocument();
  });

  test('does not restore an old result when the changed database rejects', async () => {
    listRegistrationsForEvent.mockResolvedValueOnce([syntheticRegistration()]);
    const view = renderAdminEventRegistrations();
    expect(await screen.findByText('synthetic-paid-registration@example.test'))
      .toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Refund' })[0]);

    const rejectedFirestore = { name: 'synthetic-rejected-registration-firestore' };
    getEventBySlug.mockRejectedValueOnce(new Error('changed-database-private-canary'));
    setAdminLocator(rejectedFirestore);
    view.rerender(<App />);

    expect((await screen.findByRole('alert')).textContent)
      .toBe(ADMIN_EVENT_REGISTRATIONS_LOAD_FAILURE);
    expectRegistrationResultsToBeHidden('changed-database-private-canary');
    expect(screen.queryByRole('heading', { name: /Refund full —/ })).not.toBeInTheDocument();
    expect(listRegistrationsForEvent).toHaveBeenCalledTimes(1);
    expect(getEventBySlug).toHaveBeenNthCalledWith(
      2,
      rejectedFirestore,
      'synthetic-event',
    );
  });

  test('starts a blank current-route boundary without old filters, rows, or modals', async () => {
    listRegistrationsForEvent.mockResolvedValueOnce([syntheticRegistration()]);
    renderAdminEventRegistrations();
    expect(await screen.findByText('synthetic-paid-registration@example.test'))
      .toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search by name or email...'), {
      target: { value: 'synthetic-paid' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Refund' })[0]);
    const [statusSelect, typeSelect] = screen.getAllByRole('combobox');
    fireEvent.change(statusSelect, { target: { value: 'refunded' } });
    fireEvent.change(typeSelect, { target: { value: 'volunteer' } });

    const currentRegistrations = deferred();
    getEventBySlug.mockResolvedValueOnce(syntheticEvent({
      slug: 'current-event',
      title: 'Current Route Registration Run',
    }));
    listRegistrationsForEvent.mockReturnValueOnce(currentRegistrations.promise);
    window.history.pushState({}, '', '/admin/events/current-event/registrations');
    fireEvent(window, new PopStateEvent('popstate'));

    await waitFor(() => expect(listRegistrationsForEvent).toHaveBeenNthCalledWith(
      2,
      firestore,
      'current-event',
    ));
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expectRegistrationResultsToBeHidden();
    expect(getEventBySlug).toHaveBeenNthCalledWith(2, firestore, 'current-event');

    await act(async () => {
      currentRegistrations.resolve([syntheticRegistration({
        id: 'current-route-registration',
        firstName: 'Current',
      })]);
      await currentRegistrations.promise;
    });

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Current Route Registration Run',
    })).toBeInTheDocument();
    expect(screen.getByText('current-route-registration@example.test')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search by name or email...')).toHaveValue('');
    const [currentStatusSelect, currentTypeSelect] = screen.getAllByRole('combobox');
    expect(currentStatusSelect).toHaveValue('all');
    expect(currentTypeSelect).toHaveValue('all');
    expect(document.body).not.toHaveTextContent('synthetic-paid-registration@example.test');
    expect(screen.queryByRole('heading', { name: /Refund full —/ })).not.toBeInTheDocument();
  });

  test('never flashes an old result across a not-ready to ready cycle', async () => {
    listRegistrationsForEvent.mockResolvedValueOnce([syntheticRegistration()]);
    const view = renderAdminEventRegistrations();
    expect(await screen.findByText('synthetic-paid-registration@example.test'))
      .toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Refund' })[0]);

    useServiceLocator.mockReturnValue({ services: null, isReady: false });
    view.rerender(<App />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expectRegistrationResultsToBeHidden();

    const flashedPrivateText = [];
    const observer = new MutationObserver((records) => {
      records.forEach((record) => record.addedNodes.forEach((node) => {
        const text = node.textContent || '';
        if (/Synthetic Registration Run|synthetic-paid-registration@example\.test|Refund full —/i
          .test(text)) {
          flashedPrivateText.push(text);
        }
      }));
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const readyRegistrations = deferred();
    getEventBySlug.mockResolvedValueOnce(syntheticEvent({
      title: 'Ready Registration Run',
    }));
    listRegistrationsForEvent.mockReturnValueOnce(readyRegistrations.promise);
    setAdminLocator();
    view.rerender(<App />);
    await waitFor(() => expect(listRegistrationsForEvent).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expectRegistrationResultsToBeHidden();

    await act(async () => {
      readyRegistrations.resolve([syntheticRegistration({
        id: 'ready-registration',
        firstName: 'Ready',
      })]);
      await readyRegistrations.promise;
    });
    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Ready Registration Run',
    })).toBeInTheDocument();
    expect(screen.getByText('ready-registration@example.test')).toBeInTheDocument();
    observer.disconnect();

    expect(flashedPrivateText).toEqual([]);
    expect(screen.getByPlaceholderText('Search by name or email...')).toHaveValue('');
    expect(document.body).not.toHaveTextContent('synthetic-paid-registration@example.test');
    expect(screen.queryByRole('heading', { name: /Refund full —/ })).not.toBeInTheDocument();
  });

  test('ignores an older hostile success after the current route resolves', async () => {
    let resolveOlderEvent;
    let resolveOlderRegistrations;
    const olderEvent = new Promise((resolve) => { resolveOlderEvent = resolve; });
    const olderRegistrations = new Promise((resolve) => {
      resolveOlderRegistrations = resolve;
    });
    getEventBySlug.mockImplementation((_db, slug) => (
      slug === 'synthetic-event'
        ? olderEvent
        : Promise.resolve(syntheticEvent({
          slug: 'current-event',
          title: 'Current Registration Run',
        }))
    ));
    listRegistrationsForEvent.mockImplementation((_db, slug) => (
      slug === 'synthetic-event'
        ? olderRegistrations
        : Promise.resolve([syntheticRegistration({
          id: 'current-registration',
          firstName: 'Current',
        })])
    ));
    renderAdminEventRegistrations();
    expect(await screen.findByText('Loading...')).toBeInTheDocument();

    window.history.pushState({}, '', '/admin/events/current-event/registrations');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByText('current-registration@example.test')).toBeInTheDocument();
    expect(listRegistrationsForEvent).toHaveBeenCalledTimes(1);
    expect(listRegistrationsForEvent).toHaveBeenCalledWith(firestore, 'current-event');

    const titleGetter = jest.fn(() => 'Obsolete Registration Run');
    const obsoleteEvent = Object.defineProperty(
      syntheticEvent(),
      'title',
      { configurable: true, get: titleGetter },
    );
    await act(async () => {
      resolveOlderEvent(obsoleteEvent);
      resolveOlderRegistrations([syntheticRegistration({ id: 'obsolete-registration' })]);
      await olderEvent;
      await olderRegistrations;
      await Promise.resolve();
    });

    expect(titleGetter).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Current Registration Run' }))
      .toBeInTheDocument();
    expect(screen.getByText('current-registration@example.test')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('obsolete-registration@example.test');
    expect(listRegistrationsForEvent).toHaveBeenCalledTimes(1);
  });

  test('ignores an older hostile rejection after the current route resolves', async () => {
    let rejectOlderEvent;
    const olderEvent = new Promise((_resolve, reject) => { rejectOlderEvent = reject; });
    getEventBySlug.mockImplementation((_db, slug) => (
      slug === 'synthetic-event'
        ? olderEvent
        : Promise.resolve(syntheticEvent({
          slug: 'current-event',
          title: 'Current Registration Run',
        }))
    ));
    listRegistrationsForEvent.mockResolvedValue([
      syntheticRegistration({ id: 'current-registration', firstName: 'Current' }),
    ]);
    renderAdminEventRegistrations();
    expect(await screen.findByText('Loading...')).toBeInTheDocument();

    window.history.pushState({}, '', '/admin/events/current-event/registrations');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByText('current-registration@example.test')).toBeInTheDocument();
    expect(listRegistrationsForEvent).toHaveBeenCalledTimes(1);
    expect(listRegistrationsForEvent).toHaveBeenCalledWith(firestore, 'current-event');

    const messageGetter = jest.fn(() => 'obsolete-registration-rejection-canary');
    await act(async () => {
      rejectOlderEvent(Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }));
      await olderEvent.catch(() => undefined);
      await Promise.resolve();
    });

    expect(messageGetter).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Current Registration Run' }))
      .toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('obsolete-registration-rejection-canary');
    expect(listRegistrationsForEvent).toHaveBeenCalledTimes(1);
  });

  test('ignores an older hostile registrations success after the current route resolves', async () => {
    const olderRegistrations = deferred();
    getEventBySlug.mockImplementation((_db, slug) => Promise.resolve(syntheticEvent({
      slug,
      title: slug === 'synthetic-event'
        ? 'Older Registration Run'
        : 'Current Registration Run',
    })));
    listRegistrationsForEvent.mockImplementation((_db, slug) => (
      slug === 'synthetic-event'
        ? olderRegistrations.promise
        : Promise.resolve([syntheticRegistration({
          id: 'current-registration',
          firstName: 'Current',
        })])
    ));
    renderAdminEventRegistrations();
    await waitFor(() => expect(listRegistrationsForEvent).toHaveBeenCalledWith(
      firestore,
      'synthetic-event',
    ));

    window.history.pushState({}, '', '/admin/events/current-event/registrations');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByText('current-registration@example.test')).toBeInTheDocument();

    const runnerGetter = jest.fn(() => ({
      firstName: 'Obsolete',
      lastName: 'Runner',
      email: 'obsolete-registration@example.test',
    }));
    const obsoleteRegistration = Object.defineProperty(
      syntheticRegistration({ id: 'obsolete-registration' }),
      'runner',
      { configurable: true, get: runnerGetter },
    );
    await act(async () => {
      olderRegistrations.resolve([obsoleteRegistration]);
      await olderRegistrations.promise;
      await Promise.resolve();
    });

    expect(runnerGetter).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Current Registration Run' }))
      .toBeInTheDocument();
    expect(screen.getByText('current-registration@example.test')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('obsolete-registration@example.test');
  });

  test('ignores an older hostile registrations rejection after the current route resolves', async () => {
    const olderRegistrations = deferred();
    getEventBySlug.mockImplementation((_db, slug) => Promise.resolve(syntheticEvent({
      slug,
      title: slug === 'synthetic-event'
        ? 'Older Registration Run'
        : 'Current Registration Run',
    })));
    listRegistrationsForEvent.mockImplementation((_db, slug) => (
      slug === 'synthetic-event'
        ? olderRegistrations.promise
        : Promise.resolve([syntheticRegistration({
          id: 'current-registration',
          firstName: 'Current',
        })])
    ));
    renderAdminEventRegistrations();
    await waitFor(() => expect(listRegistrationsForEvent).toHaveBeenCalledWith(
      firestore,
      'synthetic-event',
    ));

    window.history.pushState({}, '', '/admin/events/current-event/registrations');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByText('current-registration@example.test')).toBeInTheDocument();

    const messageGetter = jest.fn(() => 'obsolete-list-rejection-canary');
    await act(async () => {
      olderRegistrations.reject(Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }));
      await olderRegistrations.promise.catch(() => undefined);
      await Promise.resolve();
    });

    expect(messageGetter).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Current Registration Run' }))
      .toBeInTheDocument();
    expect(screen.getByText('current-registration@example.test')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('obsolete-list-rejection-canary');
  });

  test('does not inspect an event result or start registrations after unmount', async () => {
    let resolveEvent;
    const eventLookup = new Promise((resolve) => { resolveEvent = resolve; });
    getEventBySlug.mockReturnValueOnce(eventLookup);
    const view = renderAdminEventRegistrations();
    expect(await screen.findByText('Loading...')).toBeInTheDocument();
    view.unmount();

    const titleGetter = jest.fn(() => 'Unmounted Registration Run');
    await act(async () => {
      resolveEvent(Object.defineProperty(syntheticEvent(), 'title', {
        configurable: true,
        get: titleGetter,
      }));
      await eventLookup;
      await Promise.resolve();
    });

    expect(titleGetter).not.toHaveBeenCalled();
    expect(listRegistrationsForEvent).not.toHaveBeenCalled();
  });

  test('does not inspect a registrations result after unmount', async () => {
    const registrationsLookup = deferred();
    listRegistrationsForEvent.mockReturnValueOnce(registrationsLookup.promise);
    const view = renderAdminEventRegistrations();
    await waitFor(() => expect(listRegistrationsForEvent).toHaveBeenCalledTimes(1));
    view.unmount();

    const runnerGetter = jest.fn(() => ({
      firstName: 'Unmounted',
      lastName: 'Runner',
      email: 'unmounted-registration@example.test',
    }));
    const unmountedRegistration = Object.defineProperty(
      syntheticRegistration({ id: 'unmounted-registration' }),
      'runner',
      { configurable: true, get: runnerGetter },
    );
    await act(async () => {
      registrationsLookup.resolve([unmountedRegistration]);
      await registrationsLookup.promise;
      await Promise.resolve();
    });

    expect(runnerGetter).not.toHaveBeenCalled();
  });

  test('does not inspect a registrations rejection after unmount', async () => {
    const registrationsLookup = deferred();
    listRegistrationsForEvent.mockReturnValueOnce(registrationsLookup.promise);
    const view = renderAdminEventRegistrations();
    await waitFor(() => expect(listRegistrationsForEvent).toHaveBeenCalledTimes(1));
    view.unmount();

    const messageGetter = jest.fn(() => 'unmounted-registration-rejection-canary');
    await act(async () => {
      registrationsLookup.reject(Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }));
      await registrationsLookup.promise.catch(() => undefined);
      await Promise.resolve();
    });

    expect(messageGetter).not.toHaveBeenCalled();
  });

  test('recovers from a failed load only after a later current complete success', async () => {
    getEventBySlug.mockRejectedValueOnce(new Error('first-registration-load-canary'));
    const view = renderAdminEventRegistrations();
    expect((await screen.findByRole('alert')).textContent)
      .toBe(ADMIN_EVENT_REGISTRATIONS_LOAD_FAILURE);

    const recoveredFirestore = { name: 'synthetic-recovered-registration-firestore' };
    getEventBySlug.mockResolvedValueOnce(syntheticEvent({
      title: 'Recovered Registration Run',
    }));
    listRegistrationsForEvent.mockResolvedValueOnce([]);
    setAdminLocator(recoveredFirestore);
    view.rerender(<App />);

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Recovered Registration Run',
    })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('No registrations');
    expect(document.body).not.toHaveTextContent('first-registration-load-canary');
    expect(getEventBySlug).toHaveBeenNthCalledWith(
      2,
      recoveredFirestore,
      'synthetic-event',
    );
    expect(listRegistrationsForEvent).toHaveBeenCalledWith(
      recoveredFirestore,
      'synthetic-event',
    );
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
